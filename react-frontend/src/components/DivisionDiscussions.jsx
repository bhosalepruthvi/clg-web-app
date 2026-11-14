import Attachments from './Attachments';
import React, { useEffect, useState } from 'react';
import { api, owner } from '../lib/api';

const categories = ['Study doubts', 'Assignments', 'Exams', 'General'];
export default function DivisionDiscussions({ teacher = false }) {
  const [data, setData] = useState({ scopes: [], items: [] });
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null), [filter, setFilter] = useState('All'), [division, setDivision] = useState('All');
  const [editing, setEditing] = useState(null), [reporting, setReporting] = useState(null), [message, setMessage] = useState('');
  const key = `studyflow-discussion-read:${owner()}`;
  const [read, setRead] = useState(() => { try { const value = JSON.parse(localStorage.getItem(key) || '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; } });
  const load = async () => { try { setData(await api('/api/discussions')); setError(''); } catch (e) { setError(e.message); } finally { setLoading(false); } };
  useEffect(() => { load(); const timer = setInterval(load, 30000); return () => clearInterval(timer); }, []);
  const replies = id => data.items.filter(i => i.kind === 'reply' && i.post_id === id);
  const version = post => [post, ...replies(post.id)].map(i => i.edited_at || i.created_at).sort().at(-1);
  const open = post => { setSelected(post.id); const next = { ...read, [post.id]: version(post) }; setRead(next); try { localStorage.setItem(key, JSON.stringify(next)); } catch {} };
  const mutate = async (url, method, body) => { setBusy(true); setMessage(''); try { await api(url, { method, ...(body ? { body: JSON.stringify(body) } : {}) }); await load(); return true; } catch (e) { setError(e.message); return false; } finally { setBusy(false); } };
  const submit = async (event, url, done) => { event.preventDefault(); const form = event.currentTarget; if (await mutate(url, 'POST', Object.fromEntries(new FormData(form)))) { form.reset(); done?.(); } };
  const controls = item => !item.deleted && <div className="discussion-actions">
    {item.can_edit && <button className="quiet-link" onClick={() => setEditing(item.id)}>Edit</button>}
    {item.can_delete && <button className="quiet-link" disabled={busy} onClick={() => { if (window.confirm('Delete this message?')) mutate(`/api/discussions/${item.id}`, 'DELETE'); }}>Delete</button>}
    {!teacher && !item.can_edit && <button className="quiet-link" onClick={() => setReporting(item.id)}>Report</button>}
  </div>;
  const content = item => <>
    <p className="muted">{item.author} · {new Date(item.created_at).toLocaleString()}{item.edited_at ? ' · Edited' : ''}</p>
    {editing === item.id ? <form onSubmit={async e => { e.preventDefault(); if (await mutate(`/api/discussions/${item.id}`, 'PATCH', Object.fromEntries(new FormData(e.currentTarget)))) setEditing(null); }}>
      {item.kind === 'post' && <label>Title<input name="title" defaultValue={item.title} required maxLength={100}/></label>}
      <label>Message<textarea name="body" defaultValue={item.body} required maxLength={700}/></label><button className="primary-btn" disabled={busy}>Save changes</button> <button type="button" onClick={() => setEditing(null)}>Cancel</button>
    </form> : <p className="whitespace-pre-wrap">{item.deleted ? 'This message was deleted.' : item.body}</p>}
    {!item.deleted&&<Attachments type="discussion" id={item.id} editable={item.can_edit}/>} {controls(item)}
    {reporting === item.id && <form onSubmit={e => submit(e, `/api/discussions/${item.id}/report`, () => { setReporting(null); setMessage('Report sent to your assigned faculty.'); })}><label>Reason for reporting<textarea name="reason" required maxLength={300}/></label><button className="secondary-btn" disabled={busy}>Send report</button> <button type="button" onClick={() => setReporting(null)}>Cancel</button></form>}
    {teacher && data.items.filter(r => r.kind === 'report' && r.target_id === item.id).map(r => <p className="error-card" key={r.id}>Reported: {r.reason}</p>)}
  </>;
  const current = data.items.find(i => i.kind === 'post' && i.id === selected);
  return <section className="division-discussions">
    <div className="section-heading"><div><span className="eyebrow">YOUR DIVISION, YOUR CONVERSATION</span><h1>Division discussions</h1></div><button className="secondary-btn" onClick={load}>Refresh</button></div>
    <p className="muted">Discuss study doubts, assignments and exams with your division. Your name is visible. Assigned faculty can review reports and moderate messages.</p>
    {!teacher && <p className="eyebrow">{data.scopes[0]?.split('|').join(' · ')}</p>}
    {error && <div className="error-card" role="alert">{error} <button onClick={load}>Retry</button></div>}{message && <p role="status">{message}</p>}
    {loading ? <p role="status">Loading discussions…</p> : current ? <>
      <button className="quiet-link" onClick={() => { setSelected(null); setEditing(null); setReporting(null); }}>← All discussions</button>
      <article className="paper-card"><span className="eyebrow">{current.category}</span><h2>{current.title}</h2>{content(current)}</article>
      <h2>Replies ({replies(current.id).length})</h2>
      {replies(current.id).map(reply => <article className="paper-card" key={reply.id}>{content(reply)}</article>)}
      {!teacher && !current.deleted && <form className="paper-card" onSubmit={e => submit(e, `/api/discussions/${current.id}/reply`)}><label>Your reply<textarea name="body" required maxLength={700}/></label><button className="primary-btn" disabled={busy}>Post reply</button></form>}
    </> : <>
      {!teacher && <details className="paper-card"><summary>Start a discussion</summary><form onSubmit={e => submit(e, '/api/discussions', () => setMessage('Discussion posted.'))}><label>Title<input name="title" required maxLength={100}/></label><label>Category<select name="category">{categories.map(c => <option key={c}>{c}</option>)}</select></label><label>Message<textarea name="body" required maxLength={700} placeholder="What would you like to discuss?"/></label><button className="primary-btn" disabled={busy}>Post discussion</button></form></details>}
      <div className="discussion-actions"><label>Category filter<select value={filter} onChange={e => setFilter(e.target.value)}>{['All', ...categories].map(c => <option key={c}>{c}</option>)}</select></label>{teacher && <label>Division filter<select value={division} onChange={e => setDivision(e.target.value)}>{['All', ...data.scopes].map(s => <option key={s} value={s}>{s.split('|').join(' · ')}</option>)}</select></label>}</div>
      {data.items.filter(i => i.kind === 'post' && (filter === 'All' || i.category === filter) && (division === 'All' || i.scope === division)).sort((a, b) => version(b).localeCompare(version(a))).map(post => <article className="paper-card" key={post.id}><span className="eyebrow">{post.category} · {post.scope.split('|').join(' · ')}</span><h2><button className="quiet-link" onClick={() => open(post)}>{post.title}</button> {read[post.id] !== version(post) && <span className="new-dot">New activity</span>}</h2><p className="muted">{post.author} · {replies(post.id).length} replies</p><button className="secondary-btn" onClick={() => open(post)}>Open discussion</button></article>)}
      {!data.items.some(i => i.kind === 'post' && (filter === 'All' || i.category === filter) && (division === 'All' || i.scope === division)) && <div className="empty-note">No discussions here yet.</div>}
    </>}
  </section>;
}

