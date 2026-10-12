import assert from "node:assert/strict";
import { PDFArray, PDFDocument, PDFName, StandardFonts, degrees, rgb } from "pdf-lib";
import { A4, buildOutputs, isCleanA4, normalizeToA4, toA4 } from "../src/lib/merge.js";

const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

// ---- every kind of awkward page ends up exactly A4 ----
const d = await PDFDocument.create();
const f = await d.embedFont(StandardFonts.HelveticaBold);
const add = (w, h, label, rotation = 0, box) => {
  const p = d.addPage([w, h]);
  p.drawRectangle({ x: 2, y: 2, width: w - 4, height: h - 4, borderWidth: 3, borderColor: rgb(0.1, 0.3, 0.8), color: rgb(1, 1, 1) });
  p.drawText(label, { x: 20, y: h - 50, size: 26, font: f });
  if (rotation) p.setRotation(degrees(rotation));
  if (box) { p.setMediaBox(...box); p.setCropBox(...box); }
  return p;
};
add(612, 792, "LETTER");
add(841.89, 1190.55, "A3");
add(841.89, 595.28, "A4 LANDSCAPE");
add(595.28, 841.89, "ROT 90", 90);
add(595.28, 841.89, "ROT 180", 180);
add(595.28, 841.89, "ROT 270", 270);
add(400, 300, "SMALL");
add(595, 842, "ROUNDED A4");
add(595.28, 841.89, "OFF ORIGIN", 0, [100, 50, 100 + 595.28, 50 + 841.89]);
d.addPage([612, 792]); // blank page without any content
d.addPage([A4.width, A4.height]); // already A4
const raw = new Uint8Array(await d.save());
const out = await PDFDocument.load(await normalizeToA4(raw));
assert.equal(out.getPageCount(), 11);
assert.ok(out.getPages().every(isCleanA4), "every page must be exactly A4 at origin 0,0");
console.log("A4: 11 awkward pages ->", out.getPages().filter(isCleanA4).length, "exact A4 pages");

// already-A4 input is returned untouched
const clean = await PDFDocument.create(); clean.addPage([A4.width, A4.height]);
const cleanBytes = new Uint8Array(await clean.save());
assert.equal(await normalizeToA4(cleanBytes), cleanBytes);
assert.equal((await toA4(raw)).converted, 10);

// ---- annotations (e.g. a visible signature stamp) move together with the page ----
{
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const ctx = doc.context;
  const ap = ctx.register(ctx.stream("1 0 0 rg 0 0 100 50 re f", { Type: "XObject", Subtype: "Form", BBox: [0, 0, 100, 50] }));
  const annot = ctx.register(ctx.obj({ Type: "Annot", Subtype: "Stamp", Rect: [50, 40, 150, 90], F: 4, AP: { N: ap } }));
  page.node.set(PDFName.of("Annots"), ctx.obj([annot]));
  const res = await PDFDocument.load(await normalizeToA4(new Uint8Array(await doc.save())));
  const rect = res.getPage(0).node.Annots().lookup(0).lookup(PDFName.of("Rect"), PDFArray).asArray().map((n) => n.asNumber());
  const s = Math.min(A4.width / 612, A4.height / 792);
  const oy = (A4.height - 792 * s) / 2;
  const expected = [50 * s, 40 * s + oy, 150 * s, 90 * s + oy];
  assert.ok(rect.every((v, i) => near(v, expected[i], 0.01)), `annotation rect ${rect} != ${expected}`);
  console.log("A4: annotation moved with the page");
}

// ---- certificate header: same group of stamps -> every page of target doc, others clean ----
async function mk(label, w = 612, h = 792, pages = 2) {
  const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) doc.addPage([w, h]).drawText(`${label} p${i + 1}`, { x: 60, y: 400, size: 20, font });
  return new Uint8Array(await doc.save());
}
const documents = [
  { id: "1", name: "", bytes: await mk("DOC1") },
  { id: "2", name: "", bytes: await mk("DOC2") },
  { id: "3", name: "", bytes: await mk("DOC3", 841, 595) },
];
const groups = [{ key: "1|2|3", documentIds: ["1", "2", "3"], participants: ["Bank"], members: [], relations: [{ label: "Creditor", raw: "creditor" }], order: 0 }];
const st = async (id, target, cert) => ({ id, fileName: id + ".pdf", bytes: await mk("STAMP-" + id, 595, 842, 1), targetDocumentId: target, certificateNumber: cert });
const stamps = [await st("a", "2", "in-1"), await st("b", "3", "in-9"), await st("c", "2", "in-2"), await st("d", "2", "in-3")];
const { outputs, warnings } = await buildOutputs({ documents, groups, stamps });
assert.deepEqual(warnings, []);
assert.equal(outputs[0].sequence.map((s) => (s.kind === "stamp" ? `S(${s.certificate})` : `D${s.id}`)).join(">"), "D1>S(IN-1)>S(IN-2)>S(IN-3)>D2>S(IN-9)>D3");
const merged = await PDFDocument.load(outputs[0].bytes);
assert.ok(merged.getPages().every(isCleanA4), "merged output must be all exact A4");
console.log("merge: order OK, all", merged.getPageCount(), "merged pages exact A4");

// ---- certificate header: vector outlines (NOT text), first in the page content, RIGHT-aligned ----
{
  const { decodePDFRawStream, PDFArray, PDFRawStream } = await import("pdf-lib");
  const { HEADER } = await import("../src/lib/merge.js");
  const rightEdge = A4.width - HEADER.marginRight; // 549.28
  const pdf = await PDFDocument.load(outputs[0].bytes);
  let checked = 0;
  for (const page of pdf.getPages()) {
    const contents = page.node.Contents();
    const first = contents instanceof PDFArray ? contents.lookup(0) : contents;
    if (!(first instanceof PDFRawStream)) continue;
    const text = Buffer.from(decodePDFRawStream(first).decode()).toString("latin1");
    if (!/\bf\b/.test(text) || !/\bm\b/.test(text)) continue; // not a header stream
    assert.ok(!/\bTj\b|\bTJ\b|\bBT\b|\bTf\b/.test(text), "header must contain NO text operators (so it cannot be edited as text)");
    // every x coordinate of every outline point
    const xs = [...text.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) (?:m|l)\b/g)].map((m) => Number(m[1]));
    assert.ok(xs.length > 50, "header should contain glyph outlines");
    const maxX = Math.max(...xs);
    assert.ok(maxX <= rightEdge + 0.5 && maxX >= rightEdge - 8, `header must END at the right margin (x≈${rightEdge.toFixed(1)}), got ${maxX.toFixed(1)}`);
    checked++;
  }
  assert.ok(checked >= 4, `expected outlined header streams on the target pages, found ${checked}`);
  console.log("header: vector outlines, no text operators, right-aligned (ends at x =", rightEdge.toFixed(1) + ") on", checked, "pages");
}
console.log("a4 tests passed");
