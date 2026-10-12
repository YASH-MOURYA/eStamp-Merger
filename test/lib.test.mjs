import assert from "node:assert/strict";
import fs from "node:fs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { parseTransaction } from "../src/lib/parse.js";
import { buildOutputs, planFilenames } from "../src/lib/merge.js";

async function makePdf(label, pages = 1) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) pdf.addPage([612, 792]).drawText(`${label} p${i + 1}`, { x: 60, y: 400, size: 20, font });
  return Buffer.from(await pdf.save()).toString("base64");
}
const docs = async (ids) => Promise.all(ids.map(async (id) => ({ documentID: id, docData: await makePdf(`DOC${id}`) })));
const run = async (participants, ids = ["1", "2", "3", "4"]) => {
  const parsed = parseTransaction({ loan: { documentdtls: await docs(ids), prtcptentty: participants } });
  const built = await buildOutputs({ documents: parsed.documents, groups: parsed.groups, stamps: [] });
  return { parsed, built, named: planFilenames(built.outputs, "DDE_1") };
};
const seq = (o) => o.sequence.filter((x) => x.kind === "doc").map((x) => x.id).join("-");

// A) everybody holds the same documents -> ONE merged PDF for all participants
{
  const { named } = await run([
    { fulnm: "Bank", reltocntrct: "creditor", documentID: ["1", "2", "3", "4"] },
    { fulnm: "Ravi", reltocntrct: "debtor", documentID: ["1", "2", "3", "4"] },
    { fulnm: "Asha", reltocntrct: "co-obligant", documentID: ["1", "2", "3", "4"] },
  ]);
  assert.equal(named.length, 1, "same document set must give ONE output");
  assert.deepEqual(named[0].files.map((f) => f.path), ["creditor/DDE_1.pdf", "debtor/DDE_1.pdf", "co-obligant/DDE_1.pdf"]);
  console.log("A) same docs for all     ->", named.length, "merged PDF, placed in:", named[0].files.map((f) => f.path).join(", "));
}

// B) debtor holds 1,2 and creditor holds 3,4 -> DIFFERENT documents
{
  const { named } = await run([
    { fulnm: "Ravi", reltocntrct: "debtor", documentID: ["1", "2"] },
    { fulnm: "Bank", reltocntrct: "creditor", documentID: ["3", "4"] },
  ]);
  assert.equal(named.length, 2);
  const byFolder = Object.fromEntries(named.map((o) => [o.files[0].folder, seq(o)]));
  assert.deepEqual(byFolder, { debtor: "1-2", creditor: "3-4" });
  console.log("B) debtor 1,2 / creditor 3,4 ->", JSON.stringify(byFolder));
}

// C) creditor+debtor share 1,2 while a co-obligant holds only 3
{
  const { named } = await run([
    { fulnm: "Bank", reltocntrct: "creditor", documentID: ["1", "2"] },
    { fulnm: "Ravi", reltocntrct: "debtor", documentID: ["2", "1"] }, // same set, other order
    { fulnm: "Asha", reltocntrct: "co-obligant", documentID: ["3"] },
  ]);
  assert.equal(named.length, 2);
  assert.deepEqual(named[0].files.map((f) => f.path), ["creditor/DDE_1.pdf", "debtor/DDE_1.pdf"]);
  assert.deepEqual(named[1].files.map((f) => f.path), ["co-obligant/DDE_1.pdf"]);
  console.log("C) shared + one different ->", named.map((o) => `${seq(o)} => ${o.files.map((f) => f.path)}`).join(" | "));
}

// D) two debtors with different documents -> same folder, second file gets _2
{
  const { named } = await run([
    { fulnm: "Ravi", reltocntrct: "debtor", documentID: ["1", "2"] },
    { fulnm: "Asha", reltocntrct: "debtor", documentID: ["1", "3"] },
  ]);
  assert.deepEqual(named.flatMap((o) => o.files.map((f) => f.path)), ["debtor/DDE_1.pdf", "debtor/DDE_1_2.pdf"]);
  console.log("D) two debtors, different docs ->", named.flatMap((o) => o.files.map((f) => f.path)).join(", "));
}

// E) participant without a document list holds every document (same set as one that lists them all)
{
  const { named } = await run([
    { fulnm: "Bank", reltocntrct: "creditor" },
    { fulnm: "Ravi", reltocntrct: "debtor", documentID: ["1", "2", "3", "4"] },
  ]);
  assert.equal(named.length, 1);
  console.log("E) empty list = all docs ->", named.length, "merged PDF");
}

// F) fallbacks: unknown key names, no participants
{
  const alt = parseTransaction({ x: { files: [{ id: "9", docData: await makePdf("Z") }] } });
  assert.equal(alt.documents.length, 1);
  assert.equal(alt.groups[0].relations[0].label, "Participant");
}

// G) eStamp requests (estampdtls): exactly one slot per request
{
  const transaction = {
    loan: {
      documentdtls: [
        { documentID: "50", docData: await makePdf("Document 50") },
        { documentID: "42", docData: await makePdf("Document 42") },
        { documentID: "22", docData: await makePdf("Document 22") },
        { documentID: "35", docData: await makePdf("Document 35") },
      ],
      prtcptentty: [
        { fulnm: "Borrower", reltocntrct: "debtor", documentID: ["50", "42", "22", "35"] },
      ],
      estampdtls: [
        { documentID: "50", stampDutyAmount: "10", articleCode: "0003" },
        { documentID: "42", stampDutyAmount: "10", articleCode: "0003" },
        { documentID: "22", stampDutyAmount: "100", articleCode: "0001" },
        { documentID: "35", stampDutyAmount: "100", articleCode: "0001" },
      ],
    },
  };

  const parsed = parseTransaction(transaction);
  assert.equal(parsed.requests.map((r) => r.documentId).join(), "50,42,22,35");
  console.log("G) estampdtls            -> 4 requests: 50,42,22,35");
}
console.log("lib tests passed");
