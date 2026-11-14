import { lazy, Suspense } from 'react';
import { nativeApp } from '../lib/transport';
import { downloadBlob } from '../lib/download';
const NativePdf = lazy(() => import('./NativePdf'));
import React, { useEffect, useRef, useState } from 'react';
import { pdfBlob } from '../lib/api';
import { saveFile, savedBlob } from '../lib/saved';
export default function InAppViewer({ file, onClose }) {
  const [url, setUrl] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState(''), [saving, setSaving] = useState(false);
  const closeRef = useRef(null);
  const title = file.title ?? file.TITLE ?? 'Study material';
  useEffect(() => {
    const previous = document.activeElement; closeRef.current?.focus();
    let active = true, objectUrl;
    (async () => { try { const blob = await savedBlob(file) || await pdfBlob(file.file_url ?? file.FILE_URL); objectUrl = URL.createObjectURL(blob); if (active) setUrl(objectUrl); else URL.revokeObjectURL(objectUrl); } catch(e) { if(active) setError(e.message); } })();
    const close = e => { if(e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', close); const old = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { active = false; if(objectUrl) URL.revokeObjectURL(objectUrl); document.body.style.overflow = old; document.removeEventListener('keydown', close); previous?.focus(); };
  }, [file, onClose]);
  return <div className="pdf-viewer" role="dialog" aria-modal="true" aria-label={title} onKeyDown={e => { if(e.key==='Tab'){const nodes=[...e.currentTarget.querySelectorAll('button,a[href],iframe')].filter(n=>!n.disabled);const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}} }}>
    <header><div><span className="eyebrow">THE READING ROOM</span><h2>{title}</h2></div><div className="button-row">{url && <button className="secondary-btn" onClick={async()=>{try{await downloadBlob(await (await fetch(url)).blob(), `${title}.pdf`);}catch(e){setMessage(e.message);}}}>Download PDF</button>}<button className="primary-btn" disabled={saving || !url} onClick={async()=>{setSaving(true);try{await saveFile(file);setMessage('Saved on this device. Available offline until sign-out.');}catch(e){setMessage(e.message);}finally{setSaving(false);}}}>{saving?'Saving…':'Save offline'}</button><button ref={closeRef} className="secondary-btn" onClick={onClose}>Close ✕</button></div></header>
    {message && <p role="status" className="viewer-message">{message}</p>}{error ? <p role="alert" className="viewer-message">{error}</p> : url ? nativeApp ? <Suspense fallback={<p>Opening PDF…</p>}><NativePdf url={url} /></Suspense> : <><p className="viewer-message">PDF not displaying on your phone? <a href={url} target="_blank" rel="noreferrer">Open it in a new tab ↗</a> or download it above.</p><iframe title={title} src={url} /></> : <p className="viewer-message">Opening your notes…</p>}
  </div>;
}
