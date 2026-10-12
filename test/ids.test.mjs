import { parseTransaction } from "../src/lib/parse.js";
import { PDFDocument } from "pdf-lib";
const b64 = async () => { const d = await PDFDocument.create(); d.addPage(); return Buffer.from(await d.save()).toString("base64"); };
const data = { loan: {
  documentdtls: [
    { docUniqueId: "DOC-1001", docData: await b64() },   // no name, unusual id key
    { documentID: "DOC-1002", docData: await b64() },    // no name
    { documentID: "DOC-1003", documentName: "Loan Agreement", docData: await b64() },
  ],
  prtcptentty: [{ fulnm: "Rajni Devi", reltocntrct: "debtor", documentID: ["DOC-1001", "DOC-1002", "DOC-1003"] }],
} };
const r = parseTransaction(data);
console.log(r.documents.map((d) => d.id + " | " + d.name), r.warnings);
