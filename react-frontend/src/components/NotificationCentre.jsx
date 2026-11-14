import { nativeApp } from '../lib/transport';
import React,{useEffect,useState} from 'react';
import {api,owner} from '../lib/api';
export default function NotificationCentre(){
 const [data,setData]=useState({items:[]}),[error,setError]=useState(''),[enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false);
 const key=`studyflow-notifications:${owner()}`;
 const [read,setRead]=useState(()=>{try{return JSON.parse(localStorage.getItem(key)||'[]');}catch{return [];}});
 const load=async()=>{try{setData(await api('/api/notifications'));setError('');}catch(e){setError(e.message);}};
 useEffect(()=>{load();navigator.serviceWorker?.getRegistration().then(async r=>setEnabled(Boolean(await r?.pushManager?.getSubscription()))).catch(()=>{});const timer=setInterval(load,60000);return()=>clearInterval(timer);},[]);
 const toggle=async()=>{setBusy(true);setError('');try{
  if(!('serviceWorker'in navigator)||!('PushManager'in window))throw new Error('This browser does not support push notifications.');
  const reg=await navigator.serviceWorker.getRegistration();if(!reg?.active)throw new Error('Install or reload the production app over HTTPS or localhost first.');
  const existing=await reg.pushManager.getSubscription();
  if(existing){await api('/api/notifications/unsubscribe',{method:'POST',body:JSON.stringify({endpoint:existing.endpoint})});await existing.unsubscribe();setEnabled(false);return;}
  if(await Notification.requestPermission()!=='granted')throw new Error('Allow notifications in your browser settings to enable reminders.');
  const raw=atob(data.public_key.replace(/-/g,'+').replace(/_/g,'/'));const applicationServerKey=Uint8Array.from(raw,c=>c.charCodeAt(0));
  const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey});
  try{await api('/api/notifications/subscribe',{method:'POST',body:JSON.stringify({subscription:sub.toJSON()})});}catch(e){await sub.unsubscribe();throw e;}
  setEnabled(true);
 }catch(e){setError(e.message);}finally{setBusy(false);}};
 return <section className="learning-hub"><h2>Activity & reminders</h2><p className="muted">Replies to your discussions, teacher feedback, exam results, and assignments due within 24 hours.</p>{error&&<p role="alert" className="error-card">{error}</p>}<div>{nativeApp ? <p className="muted">Your activity feed updates while the app is open. Background push notifications are not available in this Android version.</p> : <><button className="secondary-btn" disabled={busy||(!enabled&&!data.push_available)} onClick={toggle}>{enabled?'Turn off push notifications':'Enable push notifications'}</button>{!data.push_available&&<p className="muted">Push delivery will be available after server setup. Your activity feed works now.</p>}</>}</div>
 {data.items.map(n=><article className="paper-card" key={n.id}><span className="eyebrow">{read.includes(n.id)?'READ':'NEW'}</span><h3>{n.title}</h3><p>{n.body}</p><a className="quiet-link" href={`/student-dashboard?view=${n.view}`} onClick={()=>{const next=[...new Set([...read,n.id])].slice(-100);setRead(next);localStorage.setItem(key,JSON.stringify(next));}}>View update ↗</a></article>)}{!data.items.length&&<p className="empty-note">You’re up to date.</p>}</section>;
}
