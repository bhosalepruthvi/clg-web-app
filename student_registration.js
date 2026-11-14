'use strict';
const bcrypt = require('bcryptjs');
const { route, fail } = require('./app_records');
module.exports = ({ app, query }) => {
  app.post('/api/auth/student/register', route(async (req, res) => {
    const code = typeof req.body.code === 'string' ? req.body.code.trim().toUpperCase() : '';
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = req.body.password;
    if (!/^STU-[A-F0-9]{24}$/.test(code)) fail(400, 'Enter the private registration code issued by your teacher.');
    if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email address.');
    if (typeof password !== 'string' || password.length < 10 || Buffer.byteLength(password) > 72) fail(400, 'Choose a password of at least 10 characters and no more than 72 bytes.');
    const student = (await query('SELECT * FROM students WHERE registration_code = :code', [code])).rows[0];
    if (!student || Number(student.IS_FIRST_LOGIN) !== 1) fail(400, 'This registration code is invalid or already used. Ask your teacher for help.');
    const hash = await bcrypt.hash(password, 12);
    try {
      const result = await query('UPDATE students SET email = :email, password_hash = :password_hash, is_first_login = 0, registration_code = NULL WHERE id = :id AND registration_code = :code AND is_first_login = 1', { email, password_hash: hash, id: student.ID, code });
      if (result.rowsAffected !== 1) fail(409, 'This code was already used. Sign in instead.');
    } catch (e) { if (e.errorNum === 1) fail(409, 'That email is already registered. Use another email or ask your teacher for help.'); throw e; }
    res.status(201).json({ success: true, message: 'Account created. Sign in with your email and password.' });
  }));
};
