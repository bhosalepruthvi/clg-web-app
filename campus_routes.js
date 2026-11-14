'use strict';
const oracle = require('oracledb');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// Small, versioned records keep the planner extensible without changing the
// existing academic schema. Authorization always comes from the class record.
module.exports = function campusRoutes({ app, authenticateJWT, query }) {
  const eq = (a, b) => String(a).toUpperCase() === String(b).toUpperCase();
  const route = (handler) => async (req, res, next) => { try { await handler(req, res); } catch (e) { if(e.status)return res.status(e.status).json({error:e.message}); next(e); } };
  const text = (v, max = 200) => typeof v === 'string' ? v.trim().slice(0, max) : '';
  const threshold = Number(process.env.ATTENDANCE_TARGET || 75);
  if (!Number.isFinite(threshold) || threshold < 1 || threshold >= 100) throw new Error('ATTENDANCE_TARGET must be between 1 and 99.');
  const term = process.env.ACADEMIC_TERM || 'Current semester';
  const timezone = process.env.CAMPUS_TIMEZONE || 'Asia/Kolkata';
  new Intl.DateTimeFormat('en', { timeZone: timezone }); // Reject an invalid deployment timezone at startup.
  const visibleClass = (c, u) => u.role === 'teacher' ? Number(c.TEACHER_ID) === Number(u.id) : u.role === 'student' && eq(c.ACADEMIC_YEAR, u.academic_year) && eq(c.BRANCH, u.branch) && eq(c.DIVISION, u.division);
  const load = async (u) => {
    const classes = (await query('SELECT * FROM classes')).rows.filter(c => visibleClass(c, u));
    const ids = new Set(classes.map(c => Number(c.ID)));
    const rows = (await query('SELECT * FROM campus_items')).rows || [];
    const items = rows.filter(r => ids.has(Number(r.CLASS_ID))).map(r => ({ id: r.ID, kind: r.KIND, owner_id: r.OWNER_ID, class_id: r.CLASS_ID, ...JSON.parse(r.PAYLOAD) }));
    return { classes, items: items.filter(i => u.role === 'teacher' || (i.kind === 'submission' || i.kind === 'correction' ? Number(i.owner_id) === Number(u.id) : !i.batch || eq(i.batch, u.batch))) };
  };
  const write = async (kind, owner, classId, payload) => {
    const json = JSON.stringify(payload);
    if (Buffer.byteLength(json) > 3900) throw Object.assign(new Error('Record is too large.'), { status: 400 });
    const result = await query('INSERT INTO campus_items (kind, owner_id, class_id, payload) VALUES (:kind, :owner_id, :class_id, :payload) RETURNING id INTO :out_id', { kind, owner_id: owner, class_id: classId, payload: json, out_id: { type: oracle.NUMBER, dir: oracle.BIND_OUT } });
    return result.outBinds.out_id[0];
  };
  const update = (item, changes) => {
    const { id, kind, owner_id, class_id, ...payload } = item;
    const json = JSON.stringify({ ...payload, ...changes });
    if (Buffer.byteLength(json) > 3900) throw Object.assign(new Error('Record is too large. Shorten your text.'), {status:400});
    return query('UPDATE campus_items SET payload = :payload WHERE id = :id', { id, payload: json });
  };
  const activeTerm = async () => (await require('./app_records').records(query).all()).find(r=>r.kind==='config')?.term || term;
  app.get('/api/campus/config', authenticateJWT, route(async (req, res) => res.json({ threshold, term:await activeTerm(), timezone })));
  app.get('/api/campus', authenticateJWT, route(async (req, res) => res.json(await load(req.user))));

  app.post('/api/campus/:kind', authenticateJWT, route(async (req, res) => {
    const { classes, items } = await load(req.user);
    const classId = Number(req.body.class_id);
    if (!classes.some(c => Number(c.ID) === classId)) return res.status(403).json({ error: 'This class is not assigned to you.' });
    const kind = req.params.kind;
    const created_at = new Date().toISOString();
    let payload;
    if (kind === 'timetable' || kind === 'assignment') {
      if (req.user.role !== 'teacher') return res.status(403).json({ error: 'Teacher access required.' });
      const title = text(req.body.title, 100);
      if (!title) return res.status(400).json({ error: 'A title is required.' });
      const batch = text(req.body.batch, 10).toUpperCase();
      if (batch) {
        const batches = (await query('SELECT * FROM class_batches WHERE class_id = :class_id', [classId])).rows;
        if (!batches.some(b => eq(b.BATCH_NAME, batch))) return res.status(400).json({ error: 'Choose a batch belonging to this class.' });
      }
      payload = { title, batch, term:await activeTerm(), created_at, archived: false };
      if (kind === 'timetable') {
        const { day, start, end } = req.body;
        if (!Number.isInteger(day) || day < 0 || day > 6 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || end <= start) return res.status(400).json({ error: 'Choose a weekday and a valid start/end time.' });
        payload = { ...payload, day, start, end, room: text(req.body.room, 60) };
      } else {
        const due = new Date(req.body.due);
        if (!Number.isFinite(due.getTime()) || due.getTime() <= Date.now()) return res.status(400).json({ error: 'Choose a deadline in the future.' });
        payload = { ...payload, due: due.toISOString(), instructions: text(req.body.instructions, 1200) };
      }
    } else if (kind === 'submission') {
      if (req.user.role !== 'student') return res.status(403).json({ error: 'Student access required.' });
      const assignment = items.find(i => i.id === Number(req.body.assignment_id) && i.kind === 'assignment' && Number(i.class_id) === classId && !i.archived);
      if (!assignment) return res.status(404).json({ error: 'Assignment not found.' });
      const answer = text(req.body.answer, 1600);
      const link = text(req.body.link, 500);
      if (!answer && !link) return res.status(400).json({ error: 'Add an answer or a submission link.' });
      if (link && !/^https?:\/\//i.test(link)) return res.status(400).json({ error: 'Use an http or https link.' });
      payload = { assignment_id: assignment.id, answer, link, student_name: req.user.name, submitted_at: created_at, late: Date.now() > Date.parse(assignment.due), term: assignment.term, grade: null };
      const previous = items.find(i => i.kind === kind && i.assignment_id === assignment.id && i.owner_id === req.user.id);
      if (previous) { await update(previous, payload); return res.json({ success: true, id: previous.id }); }
    } else if (kind === 'correction') {
      if (req.user.role !== 'student') return res.status(403).json({ error: 'Student access required.' });
      const date = text(req.body.date, 10), reason = text(req.body.reason, 800);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || Date.parse(date) > Date.now() || !reason) return res.status(400).json({ error: 'Enter a valid past date and the reason for correction.' });
      if (items.some(i => i.kind === kind && i.class_id === classId && i.date === date && i.status === 'pending')) return res.status(409).json({ error: 'A request for this class and date is already pending.' });
      payload = { date, reason, status: 'pending', student_name: req.user.name, created_at, term };
    } else return res.status(404).json({ error: 'Unknown workflow.' });
    const id = await write(kind, req.user.id, classId, payload);
    res.status(201).json({ success: true, id });
  }));

  app.patch('/api/campus/:id', authenticateJWT, route(async (req, res) => {
    if (req.user.role !== 'teacher') return res.status(403).json({ error: 'Teacher access required.' });
    const { items } = await load(req.user);
    const item = items.find(i => Number(i.id) === Number(req.params.id));
    if (!item) return res.status(404).json({ error: 'Item not found.' });
    if (item.kind === 'correction') {
      if (item.status !== 'pending') return res.status(409).json({ error: 'This request has already been reviewed.' });
      if (!['approved', 'rejected'].includes(req.body.status)) return res.status(400).json({ error: 'Choose approve or reject.' });
      // Approval authorizes a correction to present; a dated audit record remains.
      if (req.body.status === 'approved') await query(`MERGE INTO attendance a USING (SELECT :student_id AS student_id, :class_id AS class_id, TO_DATE(:att_date, 'YYYY-MM-DD') AS attendance_date FROM dual) src ON (a.student_id = src.student_id AND a.class_id = src.class_id AND a.attendance_date = src.attendance_date) WHEN MATCHED THEN UPDATE SET a.status = :status, a.marked_at = CURRENT_TIMESTAMP WHEN NOT MATCHED THEN INSERT (student_id, class_id, attendance_date, status) VALUES (src.student_id, src.class_id, src.attendance_date, :status)`, { student_id: Number(item.owner_id), class_id: Number(item.class_id), att_date: item.date, status: 'present' });
      await update(item, { status: req.body.status, reviewed_at: new Date().toISOString(), reviewed_by: req.user.id });
    } else if (item.kind === 'submission') {
      if (req.body.submitted_at !== item.submitted_at) return res.status(409).json({error:'The student updated this submission. Refresh before grading.'});
      const score=Number(req.body.score), maximum=Number(req.body.maximum);
      if(req.body.score === '' || req.body.maximum === '' || !Number.isFinite(score)||!Number.isFinite(maximum)||maximum<=0||maximum>1000||score<0||score>maximum) return res.status(400).json({error:'Enter valid marks between zero and the maximum (up to 1000).'});
      await update(item,{grade:{score,maximum,feedback:text(req.body.feedback,400),resubmit:req.body.resubmit===true,reviewed_at:new Date().toISOString(),reviewed_by:req.user.id}});
    } else if (['assignment', 'timetable'].includes(item.kind)) {
      if (typeof req.body.archived !== 'boolean') return res.status(400).json({ error: 'Archive state is required.' });
      await update(item, { archived: req.body.archived });
    } else return res.status(400).json({ error: 'This item cannot be edited here.' });
    res.json({ success: true });
  }));

  app.post('/api/students/:id/reset-password', authenticateJWT, route(async (req, res) => {
    if (req.user.role !== 'teacher') return res.status(403).json({ error: 'Teacher access required.' });
    const student = (await query('SELECT * FROM students WHERE id = :id', [Number(req.params.id)])).rows[0];
    if (!student) return res.status(404).json({ error: 'Student not found.' });
    const classes = (await query('SELECT * FROM classes WHERE teacher_id = :teacher_id', [req.user.id])).rows;
    if (!classes.some(c => eq(c.ACADEMIC_YEAR, student.ACADEMIC_YEAR) && eq(c.BRANCH, student.BRANCH) && eq(c.DIVISION, student.DIVISION))) return res.status(403).json({ error: 'Only a teacher assigned to this division may reset its student passwords.' });
    const code = 'STU-' + crypto.randomBytes(12).toString('hex').toUpperCase();
    await query('UPDATE students SET password_hash = :password_hash, is_first_login = :is_first_login, registration_code = :registration_code WHERE id = :id', { id: student.ID, password_hash: null, is_first_login: 1, registration_code: code });
    res.json({ registration_code: code, access_code: student.ACCESS_CODE });
  }));
};
