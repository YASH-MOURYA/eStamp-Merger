import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  appendBezierCurve,
  closePath,
  degrees,
  fill,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  setFillingGrayscaleColor,
} from "pdf-lib";

import { GLYPHS, UPM } from "./glyphs.js";

/** A4 portrait in PDF points (210 x 297 mm). */
export const A4 = { width: 595.28, height: 841.89 };

const EPS = 0.01;

export function safeName(value) {
  return (
    String(value || "document")
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/\.+$/g, "")
      .slice(0, 120) || "document"
  );
}

/** Returns page count, or throws if the bytes are not a readable PDF. */
export async function inspectPdf(bytes) {
  const pdf = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
  });

  return pdf.getPageCount();
}

// ---------------------------------------------------------------------------
// A4 NORMALIZATION
// Keeps vector content and annotations such as signature stamps.
// ---------------------------------------------------------------------------

function pageBox(page) {
  const crop = page.getCropBox();
  const box =
    crop.width > 0 && crop.height > 0
      ? crop
      : page.getMediaBox();

  const rotation =
    ((page.getRotation().angle % 360) + 360) % 360;

  return { box, rotation };
}

const sameBox = (a, b) =>
  Math.abs(a.x - b.x) < EPS &&
  Math.abs(a.y - b.y) < EPS &&
  Math.abs(a.width - b.width) < EPS &&
  Math.abs(a.height - b.height) < EPS;

const USER_UNIT = PDFName.of("UserUnit");

function userUnit(page) {
  const value = page.node.lookupMaybe(USER_UNIT, PDFNumber);
  return value ? value.asNumber() : 1;
}

/**
 * True when the page is already exactly A4 portrait,
 * origin (0,0), unrotated, with normal user units.
 */
export function isCleanA4(page) {
  const a4 = {
    x: 0,
    y: 0,
    width: A4.width,
    height: A4.height,
  };

  return (
    page.getRotation().angle % 360 === 0 &&
    Math.abs(userUnit(page) - 1) < 1e-9 &&
    sameBox(page.getMediaBox(), a4) &&
    sameBox(page.getCropBox(), a4)
  );
}

const fmt = (n) => String(Number(n.toFixed(6)));

/**
 * Affine matrix [a b c d e f] mapping the visible page box,
 * including rotation, onto A4 while preserving aspect ratio.
 */
function a4Matrix(box, rotation) {
  const {
    x: bx,
    y: by,
    width: w,
    height: h,
  } = box;

  const sideways = rotation === 90 || rotation === 270;

  const visibleW = sideways ? h : w;
  const visibleH = sideways ? w : h;

  const s = Math.min(
    A4.width / visibleW,
    A4.height / visibleH
  );

  const ox = (A4.width - visibleW * s) / 2;
  const oy = (A4.height - visibleH * s) / 2;

  // PDF /Rotate is clockwise.
  const base =
    {
      0: [1, 0, 0, 1, -bx, -by],
      90: [0, -1, 1, 0, -by, w + bx],
      180: [-1, 0, 0, -1, w + bx, h + by],
      270: [0, 1, -1, 0, h + by, -bx],
    }[rotation] ?? [1, 0, 0, 1, -bx, -by];

  return [
    base[0] * s,
    base[1] * s,
    base[2] * s,
    base[3] * s,
    base[4] * s + ox,
    base[5] * s + oy,
  ];
}

function moveAnnotations(doc, page, m) {
  const annots = page.node.Annots();

  if (!annots) return;

  for (let i = 0; i < annots.size(); i++) {
    try {
      const annot = annots.lookupMaybe(i, PDFDict);

      const rect = annot?.lookupMaybe(
        PDFName.of("Rect"),
        PDFArray
      );

      if (!rect || rect.size() < 4) continue;

      const [x1, y1, x2, y2] = [0, 1, 2, 3].map(
        (k) => rect.lookup(k, PDFNumber).asNumber()
      );

      const corners = [
        [x1, y1],
        [x2, y2],
        [x1, y2],
        [x2, y1],
      ].map(([x, y]) => [
        m[0] * x + m[2] * y + m[4],
        m[1] * x + m[3] * y + m[5],
      ]);

      const xs = corners.map((c) => c[0]);
      const ys = corners.map((c) => c[1]);

      annot.set(
        PDFName.of("Rect"),
        doc.context.obj([
          Math.min(...xs),
          Math.min(...ys),
          Math.max(...xs),
          Math.max(...ys),
        ])
      );
    } catch {
      // Leave a malformed annotation unchanged.
    }
  }
}

/** Fits one page onto an exact A4 portrait page. */
function fitPageToA4(doc, page) {
  if (isCleanA4(page)) return false;

  const { box, rotation } = pageBox(page);
  const m = a4Matrix(box, rotation);

  if (page.node.Contents()) {
    const context = doc.context;

    const start = context.register(
      context.stream(`q ${m.map(fmt).join(" ")} cm\n`)
    );

    const end = context.register(
      context.stream("\nQ")
    );

    page.node.wrapContentStreams(start, end);
  }

  moveAnnotations(doc, page, m);

  page.setMediaBox(0, 0, A4.width, A4.height);
  page.setCropBox(0, 0, A4.width, A4.height);

  [
    "TrimBox",
    "BleedBox",
    "ArtBox",
    "UserUnit",
  ].forEach((key) => {
    page.node.delete(PDFName.of(key));
  });

  page.setRotation(degrees(0));

  return true;
}

/**
 * Makes every page A4 portrait.
 * Returns { document, changed }.
 */
export async function toA4Document(source) {
  let changed = false;

  for (const page of source.getPages()) {
    if (fitPageToA4(source, page)) {
      changed = true;
    }
  }

  return {
    document: source,
    changed,
  };
}

/** Returns A4 bytes, preserving the original bytes if no conversion is needed. */
export async function normalizeToA4(bytes) {
  const source = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
  });

  const { document, changed } = await toA4Document(source);

  return changed ? await document.save() : bytes;
}

/** Converts pages to A4 and reports how many pages needed conversion. */
export async function toA4(bytes) {
  const source = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
  });

  const converted = source
    .getPages()
    .filter((page) => !isCleanA4(page)).length;

  const { document, changed } = await toA4Document(source);

  return {
    bytes: changed ? await document.save() : bytes,
    converted,
  };
}

// ---------------------------------------------------------------------------
// CERTIFICATE HEADER
//
// All certificate numbers are drawn on ONE continuous line.
// No wrapping, line breaks, or font shrinking.
// Text is allowed to extend beyond the page boundaries.
// ---------------------------------------------------------------------------

export const HEADER = {
  size: 12,
  minSize: 5,
  marginRight: 46,
  marginLeft: 24,
  firstBaseline: 20,
  lineGap: 3,
};

const fallbackGlyph = GLYPHS["?"];

const glyphOf = (ch) => GLYPHS[ch] ?? fallbackGlyph;

/** Width of text in PDF points at the specified font size. */
export function textWidth(text, size) {
  let units = 0;

  for (const ch of text) {
    units += glyphOf(ch).a;
  }

  return (units * size) / UPM;
}

/**
 * Places all certificate numbers on one continuous line.
 *
 * Rules:
 * - Never wrap onto another line.
 * - Never split a certificate number.
 * - Never shrink the font to fit the page.
 * - Allow text to extend beyond the page boundary.
 *
 * Returns { lines, size } for compatibility with the drawing function.
 */
export function layoutCertificates(
  numbers,
  maxWidth = A4.width - HEADER.marginRight - HEADER.marginLeft
) {
  // Retained for compatibility with existing callers.
  // Intentionally unused because the text must not wrap.
  void maxWidth;

  const cleanNumbers = numbers
    .map((number) => cleanCertificate(number))
    .filter(Boolean);

  if (cleanNumbers.length === 0) {
    return {
      lines: [],
      size: HEADER.size,
    };
  }

  // Keep every certificate number on the same line.
  const line = `Certificate Number: ${cleanNumbers.join(", ")}`;

  return {
    lines: [line],
    size: HEADER.size,
  };
}

const compiled = new Map();

function commandsOf(ch) {
  if (!compiled.has(ch)) {
    const commands = [];

    for (const m of glyphOf(ch).p.matchAll(/([MLCZ])([^MLCZ]*)/g)) {
      const args = m[2].trim()
        ? m[2].trim().split(/\s+/).map(Number)
        : [];

      commands.push([m[1], args]);
    }

    compiled.set(ch, commands);
  }

  return compiled.get(ch);
}

/**
 * Creates PDF path operators for text drawn as filled glyph shapes.
 */
function outlineOperators(text, x, y, size) {
  const k = size / UPM;
  const operators = [];

  let pen = x;

  for (const ch of text) {
    for (const [command, a] of commandsOf(ch)) {
      if (command === "M") {
        operators.push(
          moveTo(
            pen + a[0] * k,
            y + a[1] * k
          )
        );
      } else if (command === "L") {
        operators.push(
          lineTo(
            pen + a[0] * k,
            y + a[1] * k
          )
        );
      } else if (command === "C") {
        operators.push(
          appendBezierCurve(
            pen + a[0] * k,
            y + a[1] * k,
            pen + a[2] * k,
            y + a[3] * k,
            pen + a[4] * k,
            y + a[5] * k
          )
        );
      } else {
        operators.push(closePath());
      }
    }

    pen += glyphOf(ch).a * k;
  }

  return operators;
}

/**
 * Draws the certificate header on the page.
 * The complete header remains on one line.
 */
function stampCertificateHeader(page, numbers) {
  const { lines, size } = layoutCertificates(numbers);

  const operators = [
    pushGraphicsState(),
    setFillingGrayscaleColor(0),
  ];

  lines.forEach((line) => {
    const baseline =
      A4.height - HEADER.firstBaseline;

    // Preserve right alignment.
    // A long line may extend beyond the left page boundary.
    const x =
      A4.width -
      HEADER.marginRight -
      textWidth(line, size);

    operators.push(
      ...outlineOperators(line, x, baseline, size)
    );
  });

  operators.push(fill(), popGraphicsState());

  page.pushOperators(...operators);

  // Place the header before the original document content.
  const contents = page.node.normalizedEntries().Contents;

  if (contents && contents.size() > 1) {
    const drawn = contents.get(contents.size() - 1);

    contents.remove(contents.size() - 1);
    contents.insert(0, drawn);
  }
}

const cleanCertificate = (value) =>
  String(value)
    .trim()
    .toUpperCase()
    .replace(/[^\x20-\x7E]/g, "");

// ---------------------------------------------------------------------------
// MERGE
// ---------------------------------------------------------------------------

/**
 * Builds one merged A4 PDF per group.
 *
 * - Inserts every eStamp immediately before its target document.
 * - Prints all certificate numbers for a target document on one line.
 * - Prints the certificate header on every page of that document.
 * - Documents without eStamps receive no certificate header.
 *
 * Returns { outputs, warnings }.
 */
export async function buildOutputs({
  documents,
  groups,
  stamps,
}) {
  const warnings = [];

  const sources = new Map();

  // Load and normalize source documents.
  for (const doc of documents) {
    try {
      const loaded = await PDFDocument.load(doc.bytes, {
        ignoreEncryption: true,
      });

      sources.set(
        doc.id,
        (await toA4Document(loaded)).document
      );
    } catch {
      warnings.push(
        `Document ID ${doc.id} is not a readable PDF and was skipped.`
      );
    }
  }

  const stampDocs = new Map();

  // Load and normalize eStamp PDFs.
  for (const stamp of stamps) {
    try {
      const loaded = await PDFDocument.load(stamp.bytes, {
        ignoreEncryption: true,
      });

      stampDocs.set(
        stamp.id,
        (await toA4Document(loaded)).document
      );
    } catch {
      warnings.push(
        `eStamp "${stamp.fileName}" is not a readable PDF and was skipped.`
      );
    }
  }

  const outputs = [];

  for (const group of groups) {
    const merged = await PDFDocument.create();
    const sequence = [];

    for (const id of group.documentIds) {
      const source = sources.get(id);

      if (!source) continue;

      // Find all stamps mapped to this document in configured order.
      const targetStamps = stamps.filter(
        (stamp) =>
          stamp.targetDocumentId === id &&
          stampDocs.has(stamp.id)
      );

      // Insert eStamp pages before the corresponding document.
      for (const stamp of targetStamps) {
        const stampDoc = stampDocs.get(stamp.id);

        const stampPages = await merged.copyPages(
          stampDoc,
          stampDoc.getPageIndices()
        );

        stampPages.forEach((page) => {
          merged.addPage(page);
        });

        sequence.push({
          kind: "stamp",
          certificate: cleanCertificate(
            stamp.certificateNumber
          ),
        });
      }

      // Copy the target document pages.
      const pages = await merged.copyPages(
        source,
        source.getPageIndices()
      );

      // Collect certificate numbers in configured order.
      const numbers = targetStamps
        .map((stamp) =>
          cleanCertificate(stamp.certificateNumber)
        )
        .filter(Boolean);

      // Draw one continuous certificate header on every page.
      if (numbers.length > 0) {
        pages.forEach((page) => {
          stampCertificateHeader(page, numbers);
        });
      }

      pages.forEach((page) => {
        merged.addPage(page);
      });

      sequence.push({
        kind: "doc",
        id,
      });
    }

    const label = group.relations
      .map((relation) => relation.label)
      .join(" / ");

    if (merged.getPageCount() === 0) {
      warnings.push(
        `${label} (${group.participants.join(", ")}): no matching documents, nothing to merge.`
      );

      continue;
    }

    if (!merged.getPages().every(isCleanA4)) {
      warnings.push(
        `${label}: some pages are not exactly A4 - please report this file.`
      );
    }

    outputs.push({
      id: group.key,
      relations: group.relations,
      participants: group.participants,
      sequence,
      pageCount: merged.getPageCount(),
      bytes: await merged.save(),
    });
  }

  return {
    outputs,
    warnings,
  };
}

/**
 * Adds output file names.
 *
 * Flat ZIP layout:
 * <relation>/<TXN ID>.pdf
 *
 * If one relation folder needs multiple different files,
 * suffixes such as _2 and _3 prevent files from being overwritten.
 */
export function planFilenames(outputs, txnId) {
  const base = safeName(txnId);
  const counts = new Map();

  return outputs.map((output) => {
    const files = output.relations.map((relation) => {
      const folder = safeName(
        (relation.raw || relation.label).toLowerCase()
      );

      const n = (counts.get(folder) ?? 0) + 1;

      counts.set(folder, n);

      const suffix = n > 1 ? `_${n}` : "";

      return {
        relationLabel: relation.label,
        folder,
        path: `${folder}/${base}${suffix}.pdf`,
        suffix,
      };
    });

    return {
      ...output,
      files,
      singleName: `${base}_${files
        .map((file) => file.folder + file.suffix)
        .join("_")}.pdf`,
    };
  });
}