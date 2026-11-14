import React, { useEffect, useState } from 'react';
import { api, owner } from '../lib/api';
export default function NoticeAlerts({ onUpdate, visible }) {
  const key = `studyflow-alerts:${owner()}`;
  const [enabled,setEnabled] = useState(()=>localStorage.getItem(key)==='1'), [message,setMessage]=useState('');
  useEffect(()=>{
    let stopped=false, seen=null;
    const poll=async()=>{
      if(!navigator.onLine)return;
      try {
        const data=await api('/api/notices/student');
        if(stopped)return;
        const notices=data.notices||[];
        if(enabled&&seen&&'Notification' in window&&Notification.permission==='granted'){
          const fresh=notices.filter(n=>!seen.has(n.id??n.ID));
          const reg=await navigator.serviceWorker?.getRegistration();
          if(fresh.length&&reg&&!stopped)await reg.showNotification('New class update on StudyFlow',{body:`${fresh.length} new notice${fresh.length===1?'':'s'} from your teachers.`,tag:'studyflow-notices',icon:'/icon.svg'});
        }
        seen=new Set(notices.map(n=>n.id??n.ID));onUpdate(notices);
      }catch{/* The main notice view owns its visible error and retry state. */}
    };
    poll();const timer=setInterval(poll,60000);
    return()=>{stopped=true;clearInterval(timer);};
  },[enabled,onUpdate]);
  if(!visible)return null;
  return <div className="notice-alerts"><button className="secondary-btn" onClick={async()=>{
    if(enabled){setEnabled(false);localStorage.removeItem(key);return;}
    if(!('Notification'in window)||!('serviceWorker'in navigator)){setMessage('Notifications are not supported here. Check the notice board for updates.');return;}
    const permission=await Notification.requestPermission();
    if(permission==='granted'){setEnabled(true);localStorage.setItem(key,'1');setMessage('Alerts work while StudyFlow is open and online.');}
    else setMessage('Notifications are blocked. You can change this in your browser settings.');
  }}>{enabled?'Turn off notice alerts':'Notify me while open'}</button><span className="muted">{message||'Checks for new class notices every minute while this app is open.'}</span></div>;
}
