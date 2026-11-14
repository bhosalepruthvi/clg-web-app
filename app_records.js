'use strict';
const oracle = require('oracledb');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const route = fn => async (req, res, next) => { try { await fn(req, res); } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); } };
const text = (v, max = 100, optional = false) => { if (optional && (v === undefined || v === '')) return ''; if (typeof v !== 'string' || !v.trim() || v.trim().length > max) fail(400, `Enter text between 1 and ${max} characters.`); return v.trim(); };
const number = (v, min, max) => { if (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) || Number(v) < min || Number(v) > max) fail(400, `Enter a number from ${min} to ${max}.`); return Number(v); };
const scope = u => [u.academic_year ?? u.ACADEMIC_YEAR, u.branch ?? u.BRANCH, u.division ?? u.DIVISION].map(v => String(v || '').toUpperCase()).join('|');
const isAdmin = u => u.role === 'teacher' && (process.env.ADMIN_TEACHER_IDS || '').split(',').map(s => s.trim()).filter(Boolean).includes(String(u.id));
function records(query) {
  const json = p => { const s = JSON.stringify(p); if (Buffer.byteLength(s) > 3900) fail(400, 'This record is too large. Shorten its text.'); return s; };
  return {
    all: async () => (await query('SELECT * FROM app_records')).rows.map(r => ({ ...JSON.parse(r.PAYLOAD), id: Number(r.ID), kind: r.KIND, owner_id: Number(r.OWNER_ID) })),
    add: async (kind, owner, payload) => (await query('INSERT INTO app_records (kind, owner_id, payload) VALUES (:kind, :owner_id, :payload) RETURNING id INTO :out_id', { kind, owner_id: owner, payload: json({ ...payload, created_at: new Date().toISOString() }), out_id: { type: oracle.NUMBER, dir: oracle.BIND_OUT } })).outBinds.out_id[0],
    update: async (item, changes) => { const { id, kind, owner_id, ...payload } = item; await query('UPDATE app_records SET payload = :payload WHERE id = :id', { id, payload: json({ ...payload, ...changes }) }); },
    remove: async id => query('DELETE FROM app_records WHERE id = :id', { id })
  };
}
module.exports = { records, fail, route, text, number, scope, isAdmin };
