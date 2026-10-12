import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import Icon from "./Icon.jsx";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

// PDF.js draws the pages itself, so the preview no longer depends on the
// browser's built-in PDF plugin (which is missing in Codespaces / embedded browsers).
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const PADDING = 36; // keep in sync with .viewer padding (18px * 2)

function Page({ doc, pageNumber, width, rootRef }) {
  const hostRef = useRef(null);
  const [size, setSize] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let off = false;
    doc.getPage(pageNumber).then((page) => {
      if (off) return;
      const view = page.getViewport({ scale: 1 });
      setSize({ w: view.width, h: view.height });
    }).catch(() => {});
    return () => { off = true; };
  }, [doc, pageNumber]);

  useEffect(() => {
    const node = hostRef.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { root: rootRef.current, rootMargin: "800px 0px" } // root = scroll box, so the margin pre-renders nearby pages
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [rootRef]);

  useEffect(() => {
    if (!visible || !size || !width) return undefined;
    let off = false;
    let task;
    (async () => {
      const page = await doc.getPage(pageNumber);
      if (off) return;
      const ratio = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: (width / size.w) * ratio });
      // A fresh canvas per render avoids "same canvas used twice" errors on resize/zoom.
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      task = page.render({ canvasContext: canvas.getContext("2d"), viewport });
      try {
        await task.promise;
        if (!off && hostRef.current) hostRef.current.replaceChildren(canvas);
      } catch (error) {
        if (error?.name !== "RenderingCancelledException") console.error("PDF render error:", error);
      }
    })();
    return () => { off = true; task?.cancel(); };
  }, [doc, pageNumber, visible, size, width]);

  const height = size && width ? (size.h / size.w) * width : 0;
  return <div ref={hostRef} className="pdf-page" style={{ width, height: height || 280 }} />;
}

export default function PdfViewer({ bytes, zoom = 1 }) {
  const scrollRef = useRef(null);
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [boxWidth, setBoxWidth] = useState(0);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return undefined;
    const observer = new ResizeObserver(() => setBoxWidth(node.clientWidth));
    observer.observe(node);
    setBoxWidth(node.clientWidth);
    return () => observer.disconnect();
  }, []);

  const docRef = useRef(null);

  useEffect(() => {
    if (!bytes) { setDoc(null); setError(""); return undefined; }
    let off = false;
    let finished = false;
    setLoading(true);
    // slice(): PDF.js transfers the buffer to its worker, which would empty our copy.
    const task = pdfjs.getDocument({ data: bytes.slice() });
    task.promise
      .then((loaded) => {
        finished = true;
        if (off) { loaded.destroy(); return; }
        const previous = docRef.current;
        docRef.current = loaded;
        setDoc(loaded);
        setError("");
        // keep the old document alive briefly so its pages can finish unmounting
        if (previous) setTimeout(() => previous.destroy(), 1000);
      })
      .catch((e) => {
        finished = true;
        if (off) return;
        console.error("PDF load error:", e);
        setDoc(null);
        setError("This PDF could not be displayed.");
      })
      .finally(() => { if (!off) setLoading(false); });
    return () => { off = true; if (!finished) task.destroy(); };
  }, [bytes]);

  useEffect(() => () => { docRef.current?.destroy(); }, []);

  const width = Math.max(200, Math.floor((boxWidth - PADDING) * zoom));

  // ---------- page navigation ----------
  const [current, setCurrent] = useState(1);
  const [draft, setDraft] = useState("1");
  const [editing, setEditing] = useState(false);
  const total = doc?.numPages ?? 0;

  // follow the scroll position to show which page is in view
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !doc) return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = node.scrollTop + node.clientHeight * 0.35;
      let found = 1;
      node.querySelectorAll(".pdf-page").forEach((el, i) => {
        if (el.offsetTop <= line) found = i + 1;
      });
      setCurrent(found);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    node.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => { node.removeEventListener("scroll", onScroll); cancelAnimationFrame(frame); };
  }, [doc, width]);

  useEffect(() => { if (!editing) setDraft(String(Math.min(current, total || 1))); }, [current, total, editing]);

  function goTo(value) {
    const node = scrollRef.current;
    const number = Math.max(1, Math.min(total, Math.round(Number(value))));
    if (!node || !total || Number.isNaN(number)) return;
    const el = node.querySelectorAll(".pdf-page")[number - 1];
    if (el) node.scrollTo({ top: Math.max(0, el.offsetTop - PADDING / 2), behavior: "smooth" });
    setCurrent(number);
    setDraft(String(number));
  }

  return (
    <div className="viewer-wrap">
      <div className="viewer" ref={scrollRef}>
        {error && <div className="viewer-msg">{error}</div>}
        {doc && !error &&
          Array.from({ length: doc.numPages }, (_, i) => (
            <Page key={i} doc={doc} pageNumber={i + 1} width={width} rootRef={scrollRef} />
          ))}
        {loading && <div className="viewer-loading">Rendering…</div>}
      </div>

      {doc && !error && (
        <div className="pager" role="group" aria-label="Page navigation">
          <button className="icon-btn" onClick={() => goTo(current - 1)} disabled={current <= 1} aria-label="Previous page">
            <Icon name="up" size={16} />
          </button>
          <span className="pager-field">
            <span>Page</span>
            <input
              inputMode="numeric"
              value={draft}
              aria-label="Go to page"
              onFocus={(e) => { setEditing(true); e.target.select(); }}
              onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
              onBlur={() => { setEditing(false); setDraft(String(current)); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { goTo(draft); e.currentTarget.blur(); }
                if (e.key === "Escape") e.currentTarget.blur();
              }}
            />
            <span>/ {total}</span>
          </span>
          <button className="icon-btn" onClick={() => goTo(current + 1)} disabled={current >= total} aria-label="Next page">
            <Icon name="down" size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
