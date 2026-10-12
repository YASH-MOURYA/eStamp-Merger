// Generates samples/sample-transaction.json (+ sample eStamp PDFs). Documents are deliberately NOT A4.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fs from "node:fs";

async function pdf(title, pages, [w, h]) {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.HelveticaBold);
  for (let i = 0; i < pages; i++) {
    const p = d.addPage([w, h]);
    p.drawRectangle({ x: 3, y: 3, width: w - 6, height: h - 6, borderWidth: 2, borderColor: rgb(0.15, 0.35, 0.8), color: rgb(1, 1, 1) });
    p.drawText(title, { x: 40, y: h - 90, size: 24, font: f });
    p.drawText(`Page ${i + 1} of ${pages}`, { x: 40, y: h - 120, size: 13, font: f });
  }
  return Buffer.from(await d.save()).toString("base64");
}

const LETTER = [612, 792], A4 = [595.28, 841.89], LAND = [841.89, 595.28];
const docs = [
  ["50", "CIBIL Undertaking Borrower", 2, LETTER],
  ["42", "Letter of Continuity", 1, A4],
  ["22", "Term Loan Agreement", 3, LETTER],
  ["35", "Letter of General Lien", 2, LAND],
  ["99", "Sanction Letter (no eStamp)", 1, A4],
];
const request = (documentID, descriptionofDocument, stampDutyAmount, articleCode) => ({
  articleCode, considerationPrice: "180000.00", descriptionofDocument, documentID,
  firstparty: "Rajni Devi", secondparty: "UNION BANK OF INDIA", stampDutyAmount, stampdutyPaidby: "Rajni Devi",
});
const data = { loan: {
  documentdtls: await Promise.all(docs.map(async ([id, name, n, size]) => ({ documentID: id, docData: await pdf(`Document ${id} - ${name}`, n, size) }))),
  prtcptentty: [
    { fulnm: "UNION BANK OF INDIA", reltocntrct: "creditor", documentID: ["50", "42", "22", "35", "99"] },
    { fulnm: "Rajni Devi", reltocntrct: "debtor", documentID: ["50", "42", "22", "35"] },
  ],
  estampdtls: [
    request("50", "CIBIL Undertaking Borrower", "10", "0003"),
    request("42", "Letter of Continuity", "10", "0003"),
    request("22", "Term Loan Agreement (Hypothecation of Movables)", "100", "0001"),
    request("35", "Letter of General Lien and Set-off", "100", "0001"),
  ] } };
fs.mkdirSync("samples", { recursive: true });
fs.writeFileSync("samples/sample-transaction.json", JSON.stringify(data, null, 2));
for (const n of [1, 2, 3, 4]) fs.writeFileSync(`samples/sample-estamp-${n}.pdf`, Buffer.from(await pdf(`eStamp certificate ${n}`, 1, A4), "base64"));
fs.rmSync("samples/sample-estamp.pdf", { force: true });
console.log("samples written");
