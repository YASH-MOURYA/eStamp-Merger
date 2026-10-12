import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import Icon from "./components/Icon.jsx";
import PdfViewer from "./components/PdfViewer.jsx";
import { parseTransaction } from "./lib/parse.js";
import { buildOutputs, inspectPdf, normalizeToA4, planFilenames, safeName } from "./lib/merge.js";
import "./App.css";

const MIN_LEFT = 340;
const MAX_LEFT = 760;
const DEFAULT_LEFT = 450;
const clampLeft = (value) => Math.min(MAX_LEFT, Math.max(MIN_LEFT, Math.round(value)));

let idCounter = 0;
// crypto.randomUUID() only exists on HTTPS/localhost; this works everywhere.
const uid = () => `id${Date.now().toString(36)}${(idCounter++).toString(36)}`;

// Always show the real document ID (the name is only extra context when the JSON has one).
const docLabel = (d) => (d.name && d.name !== d.id ? `${d.id} · ${d.name}` : d.id);

const createStamp = (request = null) => ({
  id: uid(),
  fixed: Boolean(request), // true = created from an eStamp request in the JSON
  targetDocumentId: request?.documentId ?? "",
  description: request?.description ?? "",
  amount: request?.amount ?? "",
  firstParty: request?.firstParty ?? "",
  fileName: "",
  bytes: null,
  pages: 0,
  error: "",
  certificateNumber: "",
});

const isTouched = (s) => Boolean(s.bytes || s.fileName || s.targetDocumentId || s.certificateNumber.trim());
const isComplete = (s) => Boolean(s.bytes && s.targetDocumentId && s.certificateNumber.trim());

const relRank = (label) => (label.toLowerCase() === "creditor" ? 0 : label.toLowerCase() === "debtor" ? 1 : 2);
const docIdsOf = (output) => output.sequence.filter((x) => x.kind === "doc").map((x) => x.id);

const relClass = (label) => {
  const key = label.toLowerCase();
  return key === "creditor" ? "rel-creditor" : key === "debtor" ? "rel-debtor" : "rel-other";
};

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function Card({ step, title, hint, action, children }) {
  return (
    <section className="card">
      <header className="card-head">
        <span className="step">{step}</span>
        <div className="card-title">
          <h2>{title}</h2>
          {hint && <p>{hint}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export default function App() {
  const [txnId, setTxnId] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [jsonName, setJsonName] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [loadingJson, setLoadingJson] = useState(false);
  const loadToken = useRef(0);

  const [documents, setDocuments] = useState([]);
  const [groups, setGroups] = useState([]);
  const [parseWarnings, setParseWarnings] = useState([]);

  const [stamps, setStamps] = useState(() => [createStamp()]);
  const [fixedStamps, setFixedStamps] = useState(false); // eStamp slots dictated by the JSON

  const [outputs, setOutputs] = useState([]);
  const [buildWarnings, setBuildWarnings] = useState([]);
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState("");

  const [deselected, setDeselected] = useState([]);
  const [activeId, setActiveId] = useState("");
  const [mode, setMode] = useState("merged"); // "merged" | "source"
  const [relationFilter, setRelationFilter] = useState("all");
  const [activeDocId, setActiveDocId] = useState("");
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [outputMode, setOutputMode] = useState(() => {
    try { return localStorage.getItem("estamp.output") === "zip" ? "zip" : "pdf"; } catch { return "pdf"; }
  }); // "pdf" = individual PDFs, "zip" = one ZIP
  const [notice, setNotice] = useState(null);

  const [leftWidth, setLeftWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem("estamp.leftWidth"));
      return saved ? clampLeft(saved) : DEFAULT_LEFT;
    } catch {
      return DEFAULT_LEFT;
    }
  });

  useEffect(() => {
    try { localStorage.setItem("estamp.output", outputMode); } catch { /* storage unavailable */ }
  }, [outputMode]);

  useEffect(() => {
    try { localStorage.setItem("estamp.leftWidth", String(leftWidth)); } catch { /* storage unavailable */ }
  }, [leftWidth]);

  useEffect(() => {
    if (notice?.type !== "success") return undefined;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  // ---------- resizable cards (drag the divider) ----------
  function startResize(event) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = leftWidth;
    document.body.classList.add("resizing");
    const move = (e) => setLeftWidth(clampLeft(startWidth + e.clientX - startX));
    const up = () => {
      document.body.classList.remove("resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function resizeByKey(event) {
    if (event.key === "ArrowLeft") setLeftWidth((w) => clampLeft(w - 24));
    if (event.key === "ArrowRight") setLeftWidth((w) => clampLeft(w + 24));
    if (event.key === "Home") setLeftWidth(DEFAULT_LEFT);
  }

  // ---------- eStamp state ----------
  // A stamp takes part only when it has a PDF, a target document AND a certificate number.
  const readyStamps = useMemo(() => stamps.filter(isComplete), [stamps]);
  // With eStamp requests in the JSON, EVERY request must be completed; manual mode only checks rows being edited.
  const missingStamps = useMemo(
    () => stamps.filter((s) => !isComplete(s) && (fixedStamps || isTouched(s))),
    [stamps, fixedStamps]
  );

  // ---------- live build: re-merges whenever inputs change ----------
  useEffect(() => {
    if (!documents.length) {
      setOutputs([]);
      setBuildWarnings([]);
      return undefined;
    }
    let cancelled = false;
    setBuilding(true);
    const timer = setTimeout(async () => {
      try {
        const result = await buildOutputs({ documents, groups, stamps: readyStamps });
        if (cancelled) return;
        setOutputs(result.outputs);
        setBuildWarnings(result.warnings);
        setBuildError("");
      } catch (error) {
        console.error("PDF build error:", error);
        if (!cancelled) setBuildError(error instanceof Error ? error.message : "Unexpected error.");
      } finally {
        if (!cancelled) setBuilding(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [documents, groups, readyStamps]);

  // ---------- derived data ----------
  const named = useMemo(() => planFilenames(outputs, txnId.trim() || "TXN_ID"), [outputs, txnId]);
  const relations = useMemo(
    () => [...new Set(named.flatMap((o) => o.relations.map((r) => r.label)))].sort((a, b) => relRank(a) - relRank(b)),
    [named]
  );
  const servesRelation = (output, label) => output.relations.some((r) => r.label === label);
  const filter = relationFilter === "all" || relations.includes(relationFilter) ? relationFilter : "all";

  const visible = filter === "all" ? named : named.filter((o) => servesRelation(o, filter));
  const active = visible.find((o) => o.id === activeId) ?? visible[0];
  const selected = named.filter((o) => !deselected.includes(o.id));

  const sourceDocs = useMemo(() => {
    if (filter === "all") return documents;
    const ids = new Set(
      groups
        .filter((g) => g.relations.some((r) => r.label === filter))
        .flatMap((g) => (g.documentIds.length ? g.documentIds : documents.map((d) => d.id)))
    );
    return documents.filter((d) => ids.has(d.id));
  }, [documents, groups, filter]);
  const activeDoc = sourceDocs.find((d) => d.id === activeDocId) ?? sourceDocs[0];

  const folders = [...new Set(named.flatMap((o) => o.files.map((f) => f.folder)))];
  const fileCount = selected.reduce((n, o) => n + o.files.length, 0);

  const previewBytes = mode === "merged" ? active?.bytes : activeDoc?.bytes;

  // ---------- actions ----------
  async function loadJSON(text, name = "pasted JSON") {
    setJsonText(text);
    if (!text.trim()) {
      setNotice({ type: "error", text: "Please provide the transaction JSON." });
      return;
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      setNotice({ type: "error", text: "That is not valid JSON. Please check the file." });
      return;
    }
    const result = parseTransaction(data);
    if (!result.documents.length) {
      setNotice({
        type: "error",
        text: "JSON is valid, but no Base64 PDF data was found (expected loan.documentdtls[].docData).",
      });
      return;
    }

    // every source document is converted to A4 BEFORE any merging
    const token = ++loadToken.current;
    setLoadingJson(true);
    const prepared = await Promise.all(
      result.documents.map(async (d) => {
        try {
          return { ...d, bytes: await normalizeToA4(d.bytes) };
        } catch {
          return d; // unreadable files are reported by the build step
        }
      })
    );
    if (token !== loadToken.current) return; // a newer file was loaded meanwhile
    setLoadingJson(false);

    setJsonName(name);
    setDocuments(prepared);
    setGroups(result.groups);
    setParseWarnings(result.warnings);
    setDeselected([]);
    setActiveId("");
    setActiveDocId("");
    setRelationFilter("all");
    setMode("merged");

    if (result.requests.length) {
      // exactly one eStamp slot per request in the JSON - no more, no fewer
      setFixedStamps(true);
      setStamps(result.requests.map((request) => createStamp(request)));
    } else {
      setFixedStamps(false);
      setStamps((current) => {
        const manual = current.filter((s) => !s.fixed);
        const list = manual.length ? manual : [createStamp()];
        return list.map((s) => ({
          ...s,
          targetDocumentId: prepared.some((d) => d.id === s.targetDocumentId) ? s.targetDocumentId : "",
        }));
      });
    }

    setNotice({
      type: "success",
      text: result.requests.length
        ? `${prepared.length} document(s) converted to A4 · ${result.requests.length} eStamp request(s) found.`
        : `${prepared.length} document(s) converted to A4 · ${result.groups.length} output(s) ready.`,
    });
  }

  function readJsonFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => loadJSON(String(reader.result || ""), file.name);
    reader.onerror = () => setNotice({ type: "error", text: "Could not read the JSON file." });
    reader.readAsText(file);
  }

  const updateStamp = (id, changes) =>
    setStamps((current) => current.map((s) => (s.id === id ? { ...s, ...changes } : s)));

  const removeStamp = (id) =>
    setStamps((current) => {
      const next = current.filter((s) => s.id !== id);
      return next.length ? next : [createStamp()];
    });

  async function pickStamp(id, file) {
    if (!file) return;
    try {
      const raw = new Uint8Array(await file.arrayBuffer());
      const bytes = await normalizeToA4(raw); // eStamp pages are A4 before merging too
      const pages = await inspectPdf(bytes);
      updateStamp(id, { fileName: file.name, bytes, pages, error: "" });
    } catch {
      updateStamp(id, { fileName: file.name, bytes: null, pages: 0, error: "This file is not a readable PDF." });
    }
  }

  const toggleSelected = (id) =>
    setDeselected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  function readyToDownload() {
    if (!txnId.trim()) {
      setNotice({ type: "error", text: "Enter the DDE TXN ID before downloading." });
      return false;
    }
    if (missingStamps.length) {
      setNotice({
        type: "error",
        text: fixedStamps
          ? `${missingStamps.length} of ${stamps.length} eStamp request(s) still need a PDF and certificate number.`
          : "Complete every eStamp first: PDF, document ID and certificate number are all required.",
      });
      return false;
    }
    return true;
  }

  function downloadOne(output) {
    if (!output || !readyToDownload()) return;
    saveBlob(new Blob([output.bytes], { type: "application/pdf" }), output.singleName);
  }

  async function downloadZip() {
    if (!readyToDownload()) return;
    if (!selected.length) {
      setNotice({ type: "error", text: "Select at least one document to download." });
      return;
    }
    setBusy(true);
    try {
      const zip = new JSZip();
      // flat layout: <relation>/<TXN ID>.pdf - no per-participant folders
      // one merged PDF is written once into EACH relation folder it serves
      selected.forEach((o) => o.files.forEach((f) => zip.file(f.path, o.bytes, { createFolders: false })));
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      saveBlob(blob, `${safeName(txnId.trim())}_PDFs.zip`);
      setNotice({ type: "success", text: `${fileCount} file(s) added to the ZIP.` });
    } catch (error) {
      console.error("ZIP error:", error);
      setNotice({ type: "error", text: "ZIP creation failed. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  // Individual PDFs: one merged PDF per file, downloaded one after another.
  async function downloadPdfs() {
    if (!readyToDownload()) return;
    if (!selected.length) {
      setNotice({ type: "error", text: "Select at least one document to download." });
      return;
    }
    setBusy(true);
    try {
      for (const output of selected) {
        saveBlob(new Blob([output.bytes], { type: "application/pdf" }), output.singleName);
        if (selected.length > 1) await new Promise((resolve) => setTimeout(resolve, 400));
      }
      setNotice({
        type: "success",
        text:
          selected.length > 1
            ? `${selected.length} PDFs downloaded. If some are missing, allow multiple downloads for this site.`
            : "PDF downloaded.",
      });
    } finally {
      setBusy(false);
    }
  }

  const downloadSelected = () => (outputMode === "zip" ? downloadZip() : downloadPdfs());
  const pathsOf = (o) => (outputMode === "zip" ? o.files.map((f) => f.path).join("  ·  ") : o.singleName);

  const warnings = [...parseWarnings, ...buildWarnings];
  const readyCount = readyStamps.length;
  const status = loadingJson
    ? { cls: "busy", text: "Converting to A4…" }
    : !documents.length
    ? { cls: "idle", text: "Waiting for JSON" }
    : buildError
    ? { cls: "error", text: "Needs attention" }
    : building
    ? { cls: "busy", text: "Updating preview…" }
    : { cls: "live", text: "Live preview" };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true"><i /></span>
          <div>
            <h1>eStamp Merger</h1>
            <p>Merge eStamps into transaction PDFs · A4 output · runs in your browser</p>
          </div>
        </div>
        <span className={`status-pill ${status.cls}`}><b />{status.text}</span>
      </header>

      {notice && (
        <div className={`notice ${notice.type}`} role="status" aria-live="polite">
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss"><Icon name="close" size={14} /></button>
        </div>
      )}

      <main className="workspace" style={{ "--left": `${leftWidth}px` }}>
        {/* ================= LEFT: inputs ================= */}
        <div className="panel-left">
          <Card step="1" title="Transaction" hint="Enter the transaction ID and add the JSON file.">
            <label htmlFor="txn">DDE TXN ID</label>
            <input
              id="txn"
              className="input mono"
              value={txnId}
              onChange={(e) => setTxnId(e.target.value.toUpperCase())}
              placeholder="e.g. DDE_807911"
              autoComplete="off"
              spellCheck={false}
            />

            <label>Transaction JSON</label>
            <label
              className={`dropzone ${dragging ? "drag" : ""} ${documents.length ? "done" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); readJsonFile(e.dataTransfer.files?.[0]); }}
            >
              <input
                type="file"
                accept=".json,application/json,text/plain"
                onChange={(e) => { readJsonFile(e.target.files?.[0]); e.target.value = ""; }}
              />
              <span className="dz-icon"><Icon name={documents.length ? "check" : "upload"} size={20} /></span>
              <span className="dz-text">
                {documents.length ? (
                  <>
                    <strong>{jsonName}</strong>
                    <small>
                      {documents.length} documents · {stamps.filter((s) => s.fixed).length || "no"} eStamp request(s) · {named.length} merged PDF(s)
                    </small>
                  </>
                ) : (
                  <>
                    <strong>Drop JSON here or browse</strong>
                    <small>Contains the Base64 PDFs, participants and eStamp requests</small>
                  </>
                )}
              </span>
            </label>

            <button className="link" onClick={() => setShowPaste((v) => !v)}>
              {showPaste ? "Hide pasted JSON" : "Or paste JSON instead"}
            </button>
            {showPaste && (
              <div className="paste">
                <textarea
                  className="input"
                  value={jsonText}
                  onChange={(e) => setJsonText(e.target.value)}
                  placeholder="Paste the complete transaction JSON"
                  spellCheck={false}
                />
                <button className="btn btn-soft" onClick={() => loadJSON(jsonText)}>Load JSON</button>
              </div>
            )}
          </Card>

          <Card
            step="2"
            title="eStamps"
            hint={
              fixedStamps
                ? `${stamps.length} request(s) in the JSON. Add one PDF and certificate number for each.`
                : "Pick the document ID each stamp goes before."
            }
            action={
              fixedStamps ? (
                <span className={`count ${readyCount === stamps.length ? "ok" : ""}`}>{readyCount}/{stamps.length}</span>
              ) : (
                <button className="btn btn-soft small" onClick={() => setStamps((c) => [...c, createStamp()])}>
                  <Icon name="plus" size={14} /> Add
                </button>
              )
            }
          >
            {stamps.map((stamp, index) => {
              const done = isComplete(stamp);
              const needs = [
                !stamp.bytes && "eStamp PDF",
                !stamp.targetDocumentId && "document ID",
                !stamp.certificateNumber.trim() && "certificate number",
              ].filter(Boolean);
              const showNeeds = !done && (fixedStamps || isTouched(stamp));
              return (
                <div className={`stamp ${done ? "done" : ""}`} key={stamp.id}>
                  <div className="stamp-head">
                    <div className="doc-id">
                      <small>Document ID</small>
                      {stamp.fixed ? (
                        <strong title={stamp.targetDocumentId}>{stamp.targetDocumentId}</strong>
                      ) : (
                        <select
                          className="id-select"
                          value={stamp.targetDocumentId}
                          disabled={!documents.length}
                          aria-label="Document ID this eStamp goes before"
                          onChange={(e) => updateStamp(stamp.id, { targetDocumentId: e.target.value })}
                        >
                          <option value="">{documents.length ? "Select" : "Load JSON"}</option>
                          {documents.map((d) => <option key={d.id} value={d.id}>{docLabel(d)}</option>)}
                        </select>
                      )}
                    </div>
                    <div className="stamp-info">
                      <b title={stamp.description}>{stamp.description || `eStamp ${index + 1}`}</b>
                      <span>
                        {[
                          `eStamp ${index + 1} of ${stamps.length}`,
                          stamp.amount && `₹${stamp.amount}`,
                          stamp.firstParty,
                        ].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                    {stamp.fixed ? (
                      <span className={`chip ${done ? "ok" : "todo"}`}>{done ? "Ready" : "Pending"}</span>
                    ) : (
                      <button className="icon-btn" onClick={() => removeStamp(stamp.id)} aria-label="Remove eStamp">
                        <Icon name="close" size={14} />
                      </button>
                    )}
                  </div>

                  <label className={`file-pick ${stamp.bytes ? "has" : ""} ${stamp.error ? "bad" : ""}`}>
                    <input type="file" accept=".pdf,application/pdf" onChange={(e) => { pickStamp(stamp.id, e.target.files?.[0]); e.target.value = ""; }} />
                    <Icon name="file" size={16} />
                    <span>{stamp.fileName || "Choose eStamp PDF"}</span>
                    {stamp.bytes && <small>{stamp.pages} pg · A4</small>}
                  </label>
                  {stamp.error && <p className="field-error">{stamp.error}</p>}

                  <label htmlFor={`c-${stamp.id}`}>Certificate number <span className="req">*</span></label>
                  <input
                    id={`c-${stamp.id}`}
                    className={`input mono ${showNeeds && !stamp.certificateNumber.trim() && stamp.bytes ? "invalid" : ""}`}
                    value={stamp.certificateNumber}
                    onChange={(e) => updateStamp(stamp.id, { certificateNumber: e.target.value.toUpperCase() })}
                    placeholder="Required"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {showNeeds && <p className="field-hint warn">Still needed: {needs.join(", ")}.</p>}
                </div>
              );
            })}

            <p className="rule-note">
              Each eStamp goes <b>right before</b> its document. Its certificate number prints at the <b>top-right of every page</b> of that document.
            </p>
          </Card>

          <Card
            step="3"
            title="Download"
            hint="Choose how you want your files."
            action={
              named.length > 0 && (
                <span className="mini-actions">
                  <button className="link" onClick={() => setDeselected([])}>All</button>
                  <button className="link" onClick={() => setDeselected(named.map((o) => o.id))}>None</button>
                </span>
              )
            }
          >
            <div className="field-title">Output</div>
            <div className="seg wide" role="tablist" aria-label="Output type">
              <button role="tab" aria-selected={outputMode === "pdf"} className={outputMode === "pdf" ? "on" : ""} onClick={() => setOutputMode("pdf")}>
                Individual PDFs
              </button>
              <button role="tab" aria-selected={outputMode === "zip"} className={outputMode === "zip" ? "on" : ""} onClick={() => setOutputMode("zip")}>
                One ZIP
              </button>
            </div>

            {!named.length ? (
              <div className="empty">Merged documents appear here once JSON is loaded.</div>
            ) : (
              named.map((o) => (
                <div className={`out ${active?.id === o.id && mode === "merged" ? "active" : ""}`} key={o.id}>
                  <input
                    type="checkbox"
                    checked={!deselected.includes(o.id)}
                    onChange={() => toggleSelected(o.id)}
                    aria-label={`Include ${pathsOf(o)}`}
                  />
                  <button
                    className="out-body"
                    onClick={() => {
                      setMode("merged");
                      if (filter !== "all" && !servesRelation(o, filter)) setRelationFilter("all");
                      setActiveId(o.id);
                    }}
                  >
                    <span className="out-tags">
                      {o.relations.map((r) => (
                        <span key={r.label} className={`tag ${relClass(r.label)}`}>{r.label}</span>
                      ))}
                    </span>
                    <strong title={o.participants.join(", ")}>{o.participants.join(", ")}</strong>
                    <small>Document IDs {docIdsOf(o).join(" · ")} · {o.pageCount} pg</small>
                    <small className="out-paths">{pathsOf(o)}</small>
                  </button>
                </div>
              ))
            )}

            {warnings.length > 0 && (
              <ul className="warnings">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            )}
            {buildError && <p className="field-error">PDF build failed: {buildError}</p>}

            <button className="btn btn-primary wide" onClick={downloadSelected} disabled={busy || !selected.length}>
              <Icon name="download" size={16} />
              {busy
                ? outputMode === "zip" ? "Preparing ZIP…" : "Downloading…"
                : outputMode === "zip"
                ? `Download ZIP (${fileCount} file${fileCount === 1 ? "" : "s"})`
                : `Download ${selected.length} PDF${selected.length === 1 ? "" : "s"}`}
            </button>
            <p className="field-hint center">
              {outputMode === "zip"
                ? `ZIP folders: ${(folders.length ? folders : ["creditor", "debtor"]).map((f) => `${f}/${txnId.trim() || "DDE_TXN_ID"}.pdf`).join("  ·  ")}`
                : "Each merged PDF downloads as its own file."}
            </p>
          </Card>
        </div>

        {/* ================= DIVIDER: drag to resize ================= */}
        <div
          className="splitter"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panels"
          aria-valuenow={leftWidth}
          aria-valuemin={MIN_LEFT}
          aria-valuemax={MAX_LEFT}
          tabIndex={0}
          title="Drag to resize · double-click to reset"
          onPointerDown={startResize}
          onDoubleClick={() => setLeftWidth(DEFAULT_LEFT)}
          onKeyDown={resizeByKey}
        />

        {/* ================= RIGHT: preview ================= */}
        <aside className="preview">
          <div className="preview-bar">
            <h2>Preview</h2>
            <div className="seg" role="tablist" aria-label="Preview mode">
              <button role="tab" aria-selected={mode === "merged"} className={mode === "merged" ? "on" : ""} onClick={() => setMode("merged")}>Merged</button>
              <button role="tab" aria-selected={mode === "source"} className={mode === "source" ? "on" : ""} onClick={() => setMode("source")}>Source</button>
            </div>
          </div>

          {relations.length > 0 && (
            <div className="pills" role="tablist" aria-label="Relation to contract">
              <button className={`pill ${filter === "all" ? "on" : ""}`} onClick={() => setRelationFilter("all")}>
                All <span>{named.length}</span>
              </button>
              {relations.map((label) => (
                <button
                  key={label}
                  className={`pill ${relClass(label)} ${filter === label ? "on" : ""}`}
                  onClick={() => setRelationFilter(label)}
                >
                  <i /> {label} <span>{named.filter((o) => servesRelation(o, label)).length}</span>
                </button>
              ))}
            </div>
          )}

          <div className="preview-tools">
            {mode === "merged" ? (
              <select className="input" value={active?.id ?? ""} onChange={(e) => setActiveId(e.target.value)} disabled={!visible.length} aria-label="Merged document">
                {!visible.length && <option value="">No documents yet</option>}
                {visible.map((o) => (
                  <option key={o.id} value={o.id}>{o.relations.map((r) => r.label).join(" / ")} — IDs {docIdsOf(o).join(", ")} — {o.participants.join(", ")}</option>
                ))}
              </select>
            ) : (
              <select className="input" value={activeDoc?.id ?? ""} onChange={(e) => setActiveDocId(e.target.value)} disabled={!sourceDocs.length} aria-label="Source document">
                {!sourceDocs.length && <option value="">No documents yet</option>}
                {sourceDocs.map((d) => <option key={d.id} value={d.id}>{docLabel(d)}</option>)}
              </select>
            )}
            <div className="zoom">
              <button className="icon-btn" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} aria-label="Zoom out"><Icon name="zoomOut" size={16} /></button>
              <button className="zoom-val" onClick={() => setZoom(1)} title="Reset zoom">{Math.round(zoom * 100)}%</button>
              <button className="icon-btn" onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} aria-label="Zoom in"><Icon name="zoomIn" size={16} /></button>
            </div>
            {mode === "merged" && (
              <button className="btn btn-primary small" onClick={() => downloadOne(active)} disabled={!active}>
                <Icon name="download" size={15} /> PDF
              </button>
            )}
          </div>

          <div className="stage">
            {previewBytes ? (
              <PdfViewer bytes={previewBytes} zoom={zoom} />
            ) : (
              <div className="stage-empty">
                <div className="doc-art" aria-hidden="true"><i /><i /><i /></div>
                <strong>{documents.length ? "Preparing preview…" : "Your preview will appear here"}</strong>
                <p>{documents.length ? "Merging documents." : "Upload the transaction JSON to begin."}</p>
              </div>
            )}
          </div>

          {mode === "merged" && active && (
            <div className="preview-foot">
              <span className="foot-tags">
                {active.relations.map((r) => <span key={r.label} className={`tag ${relClass(r.label)}`}>{r.label}</span>)}
              </span>
              <span className="seq" title="Merge order">
                {active.sequence.map((item, i) => (
                  <Fragment key={i}>
                    {i > 0 && <span className="seq-arrow">→</span>}
                    <span className={`seq-item ${item.kind}`}>
                      {item.kind === "stamp" ? `eStamp · ${item.certificate}` : `ID ${item.id}`}
                    </span>
                  </Fragment>
                ))}
              </span>
              <span className="foot-pages">{active.pageCount} pages · A4</span>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
