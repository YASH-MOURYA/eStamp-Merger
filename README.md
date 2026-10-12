# eStamp Merger

React + Vite tool that inserts eStamp PDFs into transaction documents and produces
**one merged A4 PDF per relation to contract** (creditor, debtor, ...). Runs fully in the browser.

## Run

```bash
npm install
npm run dev      # Codespaces: already bound to 0.0.0.0 via vite.config.js
npm test         # parsing, A4, certificates, naming
```

Upload your transaction JSON and required PDF documents using the application interface to get started.

## Deploy

Static site, no backend: see **DEPLOY.md** (Netlify drag-and-drop or GitHub, `netlify.toml` included).

## Workflow

1. Enter the **DDE TXN ID** and drop the transaction **JSON**. Every document is converted to **A4** straight away.
2. **eStamps** come from `estampdtls` in the JSON: exactly one slot per request (no more, no fewer), each showing its
   **Document ID**. For every slot add the eStamp PDF and the **certificate number (required)**.
   If the JSON has no `estampdtls`, slots are added manually and you pick the document ID yourself.
3. The preview **updates live**. In *Download* choose **Individual PDFs** (each merged PDF downloads as its own file) or
   **One ZIP** (`<relation>/<TXN ID>.pdf`). The choice is remembered. Download is blocked until every eStamp is complete.

## Rules implemented

- **A4 everywhere**: source documents and eStamp PDFs are converted to exact A4 portrait (595.28 x 841.89 pt) *before*
  merging, so every page of every merged file is A4. Letter / A3 / landscape / rotated / off-origin pages are scaled to fit and
  centred (aspect ratio kept, `/Rotate` baked in). Content stays vector and annotations (e.g. visible signature stamps) move
  with the page. Pages that are already exact A4 are left untouched.
- **Merge order**: all eStamps of a target document are inserted immediately before it, in the order they appear in `estampdtls`.
- **Certificate numbers grouped by target document ID**: every page of that document gets
  `Certificate Number: n1,n2,n3` at the top-left in regular Arial/Helvetica 12 pt (wrapped at commas if long, never
  truncated), at the same position on every page, whatever the page's own geometry. Documents without an eStamp get nothing. Any number of eStamps per document is supported.
- **One merged PDF per set of documents** (not per relation):
  - everyone holds the same document IDs -> ONE merged PDF, written once into each relation folder
    (`creditor/`, `debtor/`, `co-obligant/` ... identical file);
  - participants hold different document IDs (e.g. debtor 1,2 / creditor 3,4) -> a separate merged PDF for each set;
  - same set in a different order counts as the same set; a participant without a document list holds every document.
- **ZIP layout** (flat, no per-participant folders): `<relation>/<DDE TXN ID>.pdf`, e.g. `creditor/DDE_807911.pdf`,
  `debtor/DDE_807911.pdf`. Folder = the `reltocntrct` value in lower case. Only if one relation folder needs several
  different files (two debtors holding different documents) the extra ones become `DDE_807911_2.pdf`, `_3` ...

## Preview

Tabs All / Creditor / Debtor, *Merged* or *Source* view, zoom, and a page box (type a page number + Enter, or scroll).
Drag the divider between the panels to resize them (double-click resets, arrow keys work too).

## JSON assumptions

Documents `loan.documentdtls[]` (`documentID`, Base64 in `docData`) · participants `loan.prtcptentty[]`
(`fulnm`, `reltocntrct`, `documentID`) · eStamp requests `loan.estampdtls[]` (`documentID`, `descriptionofDocument`,
`stampDutyAmount`, `firstparty`). Key names are tried case-insensitively; add more spellings at the top of `src/lib/parse.js`.

## Layout

```
src/lib/parse.js              JSON -> documents, document-set groups, eStamp requests
src/lib/merge.js              A4 fitting, merging, certificate header, file naming
src/components/PdfViewer.jsx  PDF.js preview + page navigator
src/App.jsx / App.css         interface (dark theme)
```
