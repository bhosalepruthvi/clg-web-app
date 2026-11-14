import React, { useEffect, useState } from 'react';
import SubjectVault from './SubjectVault';
import { savedFiles, removeSaved } from '../lib/saved';
import { owner } from '../lib/api';
export default function MaterialLibrary({ onSelectFile }) {
  const [tab,setTab]=useState(navigator.onLine?'all':'saved'),[saved,setSaved]=useState([]),[error,setError]=useState('');
  const key=`studyflow-recent:${owner()}`;
  const readRecent=()=>{try{return JSON.parse(localStorage.getItem(key)||'[]');}catch{return [];}};
  const [recent,setRecent]=useState(readRecent);
  const load=()=>savedFiles().then(setSaved).catch(()=>setError('Device storage is unavailable. You can still open materials online.'));
  useEffect(()=>{load();},[tab]);
  const open=file=>{const next=[file,...readRecent().filter(f=>(f.id??f.ID)!==(file.id??file.ID))].slice(0,8);try{localStorage.setItem(key,JSON.stringify(next));}catch{}setRecent(next);onSelectFile(file);};
  return <div className="space-y-5"><div className="section-heading"><div><span className="eyebrow">KEEP THE GOOD STUFF CLOSE</span><h2>Your reading shelf</h2></div></div><div className="segmented" aria-label="Material views">{[['all','All materials'],['saved','Saved offline'],['recent','Recently opened']].map(([id,label])=><button key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</div>{error&&<p role="alert">{error}</p>}{tab==='all'?<SubjectVault onSelectFile={open}/>:<><p className="muted">{tab==='saved'?'Saved on this device. Sign-out removes these copies.':'Your last eight opened materials. Save a PDF to read it offline.'}</p>{(tab==='saved'?saved.map(x=>x.file):recent).map(file=><article key={file.id??file.ID} className="paper-card library-row"><div><span className="eyebrow">{file.subject_name??file.SUBJECT_NAME??'PDF'}</span><h3>{file.title??file.TITLE}</h3></div><div className="button-row"><button className="primary-btn" onClick={()=>open(file)}>Read ↗</button>{tab==='saved'&&<button className="secondary-btn" onClick={async()=>{try{await removeSaved(file);load();}catch{setError('Could not remove this saved copy.');}}}>Remove</button>}</div></article>)}{(tab==='saved'?saved:recent).length===0&&<div className="empty-note"><h3>Your shelf is ready.</h3><p>{tab==='saved'?'Open a PDF and choose Save offline.':'Open a material to find it here next time.'}</p></div>}</>}</div>;
}
