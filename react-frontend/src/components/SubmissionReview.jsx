import React from 'react';
import Attachments from './Attachments';
export default function SubmissionReview({submission:s,teacher,mutate,busy,refresh,archived=false}){
 return <div className="submission-answer"><strong>{s.student_name}</strong><p className="muted">Submitted {new Date(s.submitted_at).toLocaleString()}{s.late?' · Late':''}</p><p className="whitespace-pre-wrap">{s.answer}</p>{s.link&&<a href={s.link} target="_blank" rel="noreferrer">Open submission link ↗</a>}
 <Attachments type="submission" id={s.id} editable={!teacher&&!archived} onChange={refresh}/>
 {s.grade&&<div className="success-note"><strong>Marks: {s.grade.score} / {s.grade.maximum}</strong><p>{s.grade.feedback}</p>{s.grade.resubmit&&<p>Please revise and resubmit your work.</p>}</div>}
 {teacher&&<form onSubmit={async e=>{e.preventDefault();const fields=Object.fromEntries(new FormData(e.currentTarget));await mutate(`/api/campus/${s.id}`,{...fields,resubmit:fields.resubmit==='on',submitted_at:s.submitted_at},'PATCH');}}><label>Marks<input type="number" name="score" required min="0" max="1000" step="0.5" defaultValue={s.grade?.score}/></label><label>Maximum marks<input type="number" name="maximum" required min="1" max="1000" defaultValue={s.grade?.maximum||100}/></label><label>Feedback<textarea name="feedback" maxLength={400} defaultValue={s.grade?.feedback}/></label><label><input type="checkbox" name="resubmit" defaultChecked={s.grade?.resubmit}/>Request resubmission</label><button className="primary-btn" disabled={busy}>Save grade & feedback</button></form>}
 </div>;
}
