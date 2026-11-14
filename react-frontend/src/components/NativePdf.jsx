import React, { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc = workerUrl;

export default function NativePdf({ url }) {
  const canvas = useRef(null), [doc, setDoc] = useState(null), [page, setPage] = useState(1), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const task = getDocument(url);
    task.promise.then(pdf => { if (active) { setDoc(pdf); setPage(1); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; task.destroy(); };
  }, [url]);
  useEffect(() => {
    if (!doc) return;
    let cancelled = false, render;
    doc.getPage(page).then(pdf => {
      if (cancelled) return;
      const scale = Math.min(2, (window.innerWidth - 24) / pdf.getViewport({ scale: 1 }).width);
      const view = pdf.getViewport({ scale });
      canvas.current.width = view.width; canvas.current.height = view.height;
      render = pdf.render({ canvasContext: canvas.current.getContext('2d'), viewport: view });
      return render.promise;
    }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; render?.cancel(); };
  }, [doc, page]);
  return <div style={{ overflow: 'auto', flex: 1, textAlign: 'center', padding: 12 }}>
    {error && <p role="alert">Could not display PDF: {error}</p>}
    {doc && <div className="button-row" style={{ justifyContent: 'center', marginBottom: 12 }}>
      <button className="secondary-btn" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
      <span>Page {page} of {doc.numPages}</span>
      <button className="secondary-btn" disabled={page === doc.numPages} onClick={() => setPage(page + 1)}>Next</button>
    </div>}
    <canvas ref={canvas} style={{ maxWidth: '100%', height: 'auto' }} aria-label={`PDF page ${page}`} />
  </div>;
}
