import React, { useEffect, useState } from 'react';
import { logout } from '../lib/api';
export default function AppStatus() {
  const [update,setUpdate]=useState(null);
  const [online, setOnline] = useState(navigator.onLine), [install, setInstall] = useState(null), [expired, setExpired] = useState(false);
  useEffect(() => {
    const network = () => setOnline(navigator.onLine), prompt = e => { e.preventDefault(); setInstall(e); }, session = () => setExpired(true);
    const available=e=>setUpdate(e.detail);window.addEventListener('app-update',available);
    window.addEventListener('online', network); window.addEventListener('offline', network); window.addEventListener('beforeinstallprompt', prompt); window.addEventListener('session-expired', session);
    return () => { window.removeEventListener('app-update',available);window.removeEventListener('online', network); window.removeEventListener('offline', network); window.removeEventListener('beforeinstallprompt', prompt); window.removeEventListener('session-expired', session); };
  }, []);
  return <>{update&&<button className="install-app" onClick={()=>{navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});update.waiting?.postMessage('ACTIVATE_UPDATE');}}>Update ready · Reload</button>}{!online && <div className="status-strip" role="status">You’re offline. Saved PDFs are available in Materials → Saved.</div>}{install && !update && <button className="install-app" onClick={async () => { await install.prompt(); setInstall(null); }}>Install StudyFlow ↗</button>}{expired && <div className="modal-backdrop"><section className="paper-card" role="alertdialog" aria-modal="true" aria-labelledby="session-title"><h2 id="session-title">Let’s sign in again</h2><p>Your session expired. Sign in to reconnect to your class.</p><button className="primary-btn" onClick={logout}>Back to sign in</button></section></div>}</>;
}
