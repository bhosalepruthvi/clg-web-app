'use strict';
const oracle = require('oracledb');
const rateLimit = require('express-rate-limit');

module.exports = function discussionRoutes({ app, authenticateJWT, query }) {
  const categories = ['Study doubts', 'Assignments', 'Exams', 'General'];
  const scope = u => [u.academic_year ?? u.ACADEMIC_YEAR, u.branch ?? u.BRANCH, u.division ?? u.DIVISION].map(v => String(v || '').toUpperCase()).join('|');
  const route = fn => async (req, res, next) => { try { await fn(req, res); } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); } };
  const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
  const field = (value, max) => { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, `Enter text between 1 and ${max} characters.`); return value.trim(); };
  const load = async user => {
    const scopes = user.role === 'student' ? [scope(user)] : user.role === 'teacher' ? (await query('SELECT * FROM classes')).rows.filter(c => Number(c.TEACHER_ID) === Number(user.id)).map(scope) : [];
    const items = (await query('SELECT * FROM discussion_items')).rows.map(r => ({ ...JSON.parse(r.PAYLOAD), id: Number(r.ID), kind: r.KIND, owner_id: Number(r.OWNER_ID) })).filter(i => scopes.includes(i.scope));
    return { scopes: [...new Set(scopes)], items };
  };
  const json = payload => { const value = JSON.stringify(payload); if (Buffer.byteLength(value) > 3900) fail(400, 'Message is too large. Please shorten it.'); return value; };
  const write = async (kind, user, payload) => (await query('INSERT INTO discussion_items (kind, owner_id, payload) VALUES (:kind, :owner_id, :payload) RETURNING id INTO :out_id', { kind, owner_id: user.id, payload: json(payload), out_id: { type: oracle.NUMBER, dir: oracle.BIND_OUT } })).outBinds.out_id[0];
  const update = async (item, changes) => { const { id, kind, owner_id, ...payload } = item; await query('UPDATE discussion_items SET payload = :payload WHERE id = :id', { id, payload: json({ ...payload, ...changes }) }); };
  const limiter = rateLimit({ windowMs: 60000, limit: 30, keyGenerator: req => `${req.user.role}:${req.user.id}`, message: { error: 'Too many discussion changes. Please wait a minute.' } });
  app.use('/api/discussions', authenticateJWT);
  app.get('/api/discussions', route(async (req, res) => {
    const { scopes, items } = await load(req.user);
    res.json({ scopes, items: items.filter(i => i.kind !== 'report' || req.user.role === 'teacher').map(i => ({ ...i, can_edit: req.user.role === 'student' && i.owner_id === Number(req.user.id), can_delete: req.user.role === 'teacher' || i.owner_id === Number(req.user.id) })) });
  }));
  app.post('/api/discussions', limiter, route(async (req, res) => {
    if (req.user.role !== 'student') return res.status(403).json({ error: 'Only students can start discussions.' });
    const category = req.body.category;
    if (!categories.includes(category)) fail(400, 'Choose a discussion category.');
    const id = await write('post', req.user, { scope: scope(req.user), title: field(req.body.title, 100), body: field(req.body.body, 700), category, author: req.user.name, created_at: new Date().toISOString() });
    res.status(201).json({ id });
  }));
  app.post('/api/discussions/:id/:action', limiter, route(async (req, res) => {
    const { items } = await load(req.user);
    const item = items.find(i => i.id === Number(req.params.id) && ['post', 'reply'].includes(i.kind) && !i.deleted);
    if (!item) fail(404, 'Discussion not found.');
    if (req.user.role !== 'student') fail(403, 'Student access required.');
    if (req.params.action === 'reply') {
      if (item.kind !== 'post') fail(400, 'Reply to a discussion post.');
      const id = await write('reply', req.user, { scope: item.scope, post_id: item.id, body: field(req.body.body, 700), author: req.user.name, created_at: new Date().toISOString() });
      return res.status(201).json({ id });
    }
    if (req.params.action !== 'report') fail(404, 'Unknown action.');
    if (items.some(i => i.kind === 'report' && i.target_id === item.id && i.owner_id === Number(req.user.id))) fail(409, 'You already reported this message.');
    await write('report', req.user, { scope: item.scope, target_id: item.id, reason: field(req.body.reason, 300), created_at: new Date().toISOString() });
    res.status(201).json({ success: true });
  }));
  for (const method of ['patch', 'delete']) app[method]('/api/discussions/:id', limiter, route(async (req, res) => {
    const { items } = await load(req.user);
    const item = items.find(i => i.id === Number(req.params.id) && ['post', 'reply'].includes(i.kind) && !i.deleted);
    if (!item) fail(404, 'Message not found.');
    const own = req.user.role === 'student' && item.owner_id === Number(req.user.id);
    if (!own && !(method === 'delete' && req.user.role === 'teacher')) fail(403, 'You cannot change this message.');
    if (method === 'delete') await update(item, { body: '', title: item.kind === 'post' ? 'Deleted discussion' : undefined, deleted: true, deleted_at: new Date().toISOString(), deleted_by: `${req.user.role}:${req.user.id}` });
    else await update(item, { body: field(req.body.body, 700), ...(item.kind === 'post' ? { title: field(req.body.title, 100) } : {}), edited_at: new Date().toISOString() });
    res.json({ success: true });
  }));
};
