import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import fs from "node:fs";
import { buildOutputs } from "../src/lib/merge.js";
async function mk(label, pages = 1) {
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) d.addPage([595.28, 841.89]).drawText(`${label} p${i + 1}`, { x: 60, y: 400, size: 20, font: f });
  return new Uint8Array(await d.save());
}
const documents = [{ id: "7", name: "", bytes: await mk("DOC7", 2) }, { id: "8", name: "", bytes: await mk("DOC8") }];
const groups = [{ key: "7|8", documentIds: ["7", "8"], participants: ["X"], members: [], relations: [{ label: "Debtor", raw: "debtor" }], order: 0 }];
const stamps = [];
for (let i = 1; i <= 12; i++) stamps.push({ id: "s" + i, fileName: "s.pdf", bytes: await mk("STAMP" + i), targetDocumentId: "7", certificateNumber: `IN-DL${String(i).padStart(4, "0")}-2026-LONGNUMBER` });
const { outputs } = await buildOutputs({ documents, groups, stamps });
fs.writeFileSync("/tmp/many.pdf", outputs[0].bytes);
assert.equal(outputs[0].pageCount, 15);
console.log("many-stamps test passed (15 pages)");
