import React, { useState } from 'react';
import { api, logout } from '../lib/api';

export default function PasswordSettings() {
  const [values, setValues] = useState({ current_password: '', new_password: '', confirm: '' });
  const [visible, setVisible] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false);
  async function submit(e) {
    e.preventDefault(); setError('');
    if (values.new_password !== values.confirm) return setError('New passwords do not match.');
    setBusy(true);
    try { await api('/api/account/change-password', { method: 'POST', body: JSON.stringify(values) }); setValues({current_password:'',new_password:'',confirm:''}); setDone(true); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <details className="paper-card my-4"><summary>Change password</summary>
    {done ? <div role="status"><p>Password changed. Sign in again with your new password.</p><button className="primary-btn" onClick={logout}>Return to sign in</button></div> :
      <form className="space-y-4" onSubmit={submit}>
        <p>Changing your password signs out existing sessions.</p>
        {error && <p role="alert" className="error-card">{error}</p>}
        {[['current_password','Current password'],['new_password','New password'],['confirm','Confirm new password']].map(([key,label]) =>
          <label className="block" key={key}>{label}<input className="w-full border border-slate-300 rounded-lg p-3 bg-white text-slate-900" required type={visible?'text':'password'} autoComplete={key==='current_password'?'current-password':'new-password'} minLength={key==='current_password'?1:8} maxLength={72} value={values[key]} onChange={e=>setValues({...values,[key]:e.target.value})}/></label>)}
        <button type="button" className="secondary-btn" aria-pressed={visible} onClick={()=>setVisible(!visible)}>{visible?'Hide':'Show'} passwords</button>
        <button className="primary-btn" disabled={busy}>{busy?'Saving…':'Change password'}</button>
      </form>}
  </details>;
}
