'use strict';
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { records, route, fail, isAdmin } = require('./app_records');

module.exports = function passwordRoutes({ app, authenticateJWT, query }) {
  const store = records(query);
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false });
  async function replacePassword(role, account, password) {
    const hash = await bcrypt.hash(password, 12);
    if (role === 'teacher') {
      // Revoke existing sessions before changing the hash; a failed write fails closed.
      const old = (await store.all()).find(r => r.kind === 'password_version' && r.owner_id === Number(account.ID));
      const payload = { version: crypto.createHash('sha256').update(hash).digest('hex') };
      if (old) await store.update(old, payload); else await store.add('password_version', Number(account.ID), payload);
      await query('UPDATE teachers SET password_hash = :password_hash WHERE id = :id', { id: account.ID, password_hash: hash });
    } else {
      await query('UPDATE students SET password_hash = :password_hash, is_first_login = :is_first_login WHERE id = :id', { id: account.ID, password_hash: hash, is_first_login: 0 });
    }
  }
  app.post('/api/account/change-password', authenticateJWT, limiter, route(async (req, res) => {
    const role = req.user.role;
    if (!['teacher', 'student'].includes(role)) fail(403, 'Account access required.');
    const { current_password, new_password } = req.body;
    if (typeof current_password !== 'string' || current_password.length > 128 || typeof new_password !== 'string' || new_password.length < 8 || Buffer.byteLength(new_password, 'utf8') > 72) fail(400, 'Enter your current password and a new password of at least 8 characters and at most 72 UTF-8 bytes.');
    if (current_password === new_password) fail(400, 'Choose a different new password.');
    const account = role === 'teacher'
      ? (await query('SELECT * FROM teachers')).rows.find(t => Number(t.ID) === Number(req.user.id))
      : (await query('SELECT * FROM students WHERE id = :id', [Number(req.user.id)])).rows[0];
    if (!account?.PASSWORD_HASH || !await bcrypt.compare(current_password, account.PASSWORD_HASH)) fail(400, 'Current password is incorrect.');
    await replacePassword(role, account, new_password);
    res.json({ success: true });
  }));
  app.post('/api/admin/faculty/:id/reset-password', authenticateJWT, limiter, route(async (req, res) => {
    if (!isAdmin(req.user)) fail(403, 'Administrator access required.');
    if (Number(req.params.id) === Number(req.user.id)) fail(400, 'Use Change password for your own account.');
    const account = (await query('SELECT * FROM teachers')).rows.find(t => Number(t.ID) === Number(req.params.id));
    if (!account) fail(404, 'Faculty member not found.');
    const password = crypto.randomBytes(18).toString('base64url');
    await replacePassword('teacher', account, password);
    res.set('Cache-Control', 'no-store').json({ email: account.EMAIL, initial_password: password });
  }));
};
