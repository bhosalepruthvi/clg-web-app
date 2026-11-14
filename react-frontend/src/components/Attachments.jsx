import { downloadBlob } from '../lib/download';
import React, {useEffect,useState} from 'react';
import {api,authFetch,token} from '../lib/api';
export default function Attachments({type,id,editable=false,onChange}){
 const [files,setFiles]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const load=async()=>{try{setFiles((await api(`/api/files/${type}/${id}`)).files);}catch(e){setError(e.message);}};
 useEffect(()=>{load();},[type,id]);
 const download=async f=>{setError('');try{const r=await authFetch(`/api/files/download/${f.id}/content`,{headers:{Authorization:`Bearer ${token()}`}});if(!r.ok)throw new Error('File is unavailable or you no longer have access.');await downloadBlob(await r.blob(),f.name);}catch(e){setError(e.message);}};
 return <section className="attachments" aria-label="Attachments"><strong>Attachments</strong>{error&&<p role="alert" className="error-card">{error}</p>}
 {files.map(f=><div className="button-row" key={f.id}><button type="button" className="quiet-link" onClick={()=>download(f)}>{f.name} · {Math.ceil(f.size/1024)} KB ↓</button>{editable&&<button type="button" disabled={busy} onClick={async()=>{if(!confirm('Remove this attachment?'))return;setBusy(true);try{await api(`/api/files/${f.id}`,{method:'DELETE'});await load();await onChange?.();}catch(e){setError(e.message);}finally{setBusy(false);}}}>Remove</button>}</div>)}
 {!files.length&&<p className="muted">No attachments.</p>}
 {editable&&files.length<3&&<label>Add PDF or image (up to 10 MB; three files maximum)<input type="file" accept="application/pdf,image/png,image/jpeg" disabled={busy} onChange={async e=>{const input=e.currentTarget;const file=input.files?.[0];if(!file)return;setBusy(true);setError('');try{if(file.size>10*1024*1024)throw new Error('Choose a file under 10 MB.');const body=new FormData();body.append('file',file);await api(`/api/files/${type}/${id}`,{method:'POST',body});await load();await onChange?.();}catch(e){setError(e.message);}finally{input.value='';setBusy(false);}}}/></label>}
 {busy&&<p role="status">Updating attachment…</p>}</section>;
}
