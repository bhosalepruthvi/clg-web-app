/**
 * test_studyflow_v2.js
 * Backend test suite for the StudyFlow v2 stack (server_studyflow_v2.js).
 *
 * Runs entirely without Oracle: the suite injects a mock query executor via
 * setQueryExecutor() and exercises the real Express app over HTTP.
 *
 *   npm run test:v2               mocked suite (default)
 *   npm run test:v2:integration   also runs a live-Oracle end-to-end flow
 *                                 (requires ORACLE_* env vars; mutates the DB)
 */

'use strict';

// Headroom for the test run against the /api/auth rate limiter.
process.env.AUTH_RATE_LIMIT_OVERRIDE = process.env.AUTH_RATE_LIMIT_OVERRIDE || '200';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_UPLOADS = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-test-uploads-'));
process.env.UPLOADS_DIR = TMP_UPLOADS;

const bcrypt = require('bcryptjs');
const { app, setQueryExecutor, resetQueryExecutor } = require('./server_studyflow_v2');

// ---------------------------------------------------------------------------
// In-memory stand-in for Oracle. Handlers are matched on SQL substrings and
// return rows with UPPERCASE keys, mirroring oracledb OUT_FORMAT_OBJECT.
// ---------------------------------------------------------------------------
function createMockDb() {
  const state = {
    nextId: 100,
    teachers: [],   // {ID, NAME, EMAIL, PASSWORD_HASH}
    students: [],   // {ID, NAME, ACADEMIC_YEAR, BRANCH, DIVISION, BATCH, ROLL_NUMBER, ACCESS_CODE}
    classes: [],    // {ID, TEACHER_ID, ACADEMIC_YEAR, BRANCH, DIVISION, SUBJECT_NAME, CLASS_TYPE}
    batches: [],    // {ID, CLASS_ID, BATCH_NAME}
    materials: [],  // {ID, CLASS_ID, BATCH_TARGET_ID, UNIT_NUMBER, TITLE, FILE_URL}
    attendance: [], // {STUDENT_ID, CLASS_ID, ATTENDANCE_DATE, STATUS}
    notices: [],    // {ID, TEACHER_ID, ACADEMIC_YEAR, BRANCH, DIVISION, BATCH, TITLE, BODY, IS_PINNED, CREATED_AT}
    calls: []
  };
  const up = (v) => String(v == null ? '' : v).toUpperCase();
  const bv = (binds, key, idx) => {
    if (Array.isArray(binds)) return binds[idx];
    return binds ? binds[key] : undefined;
  };

  async function executor(sql, binds = []) {
    const S = sql.replace(/\s+/g, ' ').trim();
    state.calls.push({ sql: S, binds });

    // This legacy fixture has no disabled faculty or learning records.
    if (S === 'SELECT * FROM app_records') return { rows: [] };
    // ---- teachers ----
    if (S.includes('SELECT id, name, email, password_hash FROM teachers')) {
      const email = String(bv(binds, 'email', 0) || '').toLowerCase();
      return { rows: state.teachers.filter((t) => String(t.EMAIL).toLowerCase() === email) };
    }
    if (S.includes('SELECT id FROM teachers WHERE LOWER(email)')) {
      const email = String(bv(binds, 'email', 0) || '').toLowerCase();
      return { rows: state.teachers.filter((t) => String(t.EMAIL).toLowerCase() === email).map((t) => ({ ID: t.ID })) };
    }
    if (S.startsWith('INSERT INTO teachers')) {
      const id = ++state.nextId;
      state.teachers.push({ ID: id, NAME: binds.name, EMAIL: binds.email, PASSWORD_HASH: binds.password_hash });
      return { rows: [], outBinds: { out_id: [id] } };
    }

    // ---- students ----
    if (S.startsWith('INSERT INTO students')) {
      const id = ++state.nextId;
      state.students.push({
        ID: id, NAME: binds.name, ACADEMIC_YEAR: binds.academic_year, BRANCH: binds.branch,
        DIVISION: binds.division, BATCH: binds.batch, ROLL_NUMBER: binds.roll_number,
        ACCESS_CODE: binds.access_code, PASSWORD_HASH: binds.password_hash, IS_FIRST_LOGIN: 1
      });
      return { rows: [], outBinds: { out_id: [id] } };
    }
    if (S.startsWith('UPDATE students SET')) {
      const id = Number(binds.id);
      const student = state.students.find(s => s.ID === id);
      if (binds.previous_hash && (!student || student.PASSWORD_HASH !== binds.previous_hash || Number(student.IS_FIRST_LOGIN) !== 1)) return { rowsAffected: 0 };
      if (student) {
        if (binds.password_hash !== undefined) student.PASSWORD_HASH=binds.password_hash;
        if (binds.is_first_login !== undefined) student.IS_FIRST_LOGIN=binds.is_first_login;
        if (binds.name !== undefined) student.NAME = binds.name;
        if (binds.academic_year !== undefined) student.ACADEMIC_YEAR = binds.academic_year;
        if (binds.branch !== undefined) student.BRANCH = binds.branch;
        if (binds.division !== undefined) student.DIVISION = binds.division;
        if (binds.batch !== undefined) student.BATCH = binds.batch;
        if (binds.roll_number !== undefined) student.ROLL_NUMBER = binds.roll_number;
        if (binds.access_code !== undefined) student.ACCESS_CODE = binds.access_code;
      }
      return { rows: [], rowsAffected: student ? 1 : 0 };
    }
    if (S.startsWith('DELETE FROM students')) {
      const id = Number(binds.id || (Array.isArray(binds) ? binds[0] : 0));
      state.students = state.students.filter(s => s.ID !== id);
      return { rows: [] };
    }
    if (S.includes('FROM students') && (S.includes('id = :id') || S.includes('WHERE id = :id'))) {
      const id = Number(bv(binds, 'id', 0));
      return { rows: state.students.filter((s) => s.ID === id) };
    }
    if (S.includes('FROM students') && S.includes('UPPER(access_code)')) {
      const code = up(bv(binds, 'code', 0));
      return { rows: state.students.filter((s) => up(s.ACCESS_CODE) === code) };
    }
    if (S.includes('FROM students')) {
      let rows = state.students.slice();
      if (binds && binds.year !== undefined) rows = rows.filter((s) => up(s.ACADEMIC_YEAR) === up(binds.year));
      if (binds && binds.branch !== undefined) rows = rows.filter((s) => up(s.BRANCH) === up(binds.branch));
      if (binds && binds.div !== undefined) rows = rows.filter((s) => up(s.DIVISION) === up(binds.div));
      if (binds && binds.division !== undefined) rows = rows.filter((s) => up(s.DIVISION) === up(binds.division));
      if (binds && binds.batch !== undefined) rows = rows.filter((s) => up(s.BATCH) === up(binds.batch));
      return { rows };
    }

    // ---- classes & batches ----
    if (S.includes('SELECT teacher_id FROM classes WHERE id')) {
      const id = Number(bv(binds, 'id', 0));
      return { rows: state.classes.filter((c) => c.ID === id).map((c) => ({ TEACHER_ID: c.TEACHER_ID })) };
    }
    if (S.includes('SELECT * FROM classes WHERE id')) {
      const id = Number(bv(binds, 'id', 0));
      return { rows: state.classes.filter((c) => c.ID === id) };
    }
    if (S.startsWith('UPDATE classes SET')) {
      const id = Number(binds.id);
      const cls = state.classes.find(c => c.ID === id);
      if (cls && binds.subject_name !== undefined) {
        cls.SUBJECT_NAME = binds.subject_name;
      }
      return { rows: [] };
    }
    if (S.startsWith('DELETE FROM classes')) {
      const id = Number(binds.id || (Array.isArray(binds) ? binds[0] : 0));
      state.classes = state.classes.filter(c => c.ID !== id);
      return { rows: [] };
    }
    if (S.startsWith('DELETE FROM class_batches')) {
      const cid = Number(binds.id || (Array.isArray(binds) ? binds[0] : 0));
      state.batches = state.batches.filter(b => b.CLASS_ID !== cid);
      return { rows: [] };
    }
    if (S.startsWith('INSERT INTO classes')) {
      const id = ++state.nextId;
      state.classes.push({
        ID: id, TEACHER_ID: Number(binds.teacher_id), ACADEMIC_YEAR: binds.academic_year,
        BRANCH: binds.branch, DIVISION: binds.division, SUBJECT_NAME: binds.subject_name,
        CLASS_TYPE: binds.class_type
      });
      return { rows: [], outBinds: { out_id: [id] } };
    }
    if (S.startsWith('INSERT INTO class_batches')) {
      const id = ++state.nextId;
      state.batches.push({ ID: id, CLASS_ID: Number(binds.class_id), BATCH_NAME: binds.batch_name });
      return { rows: [], outBinds: { out_b_id: [id] } };
    }
    if (S.includes('FROM class_batches')) {
      const cid = Number(bv(binds, 'class_id', 0));
      return { rows: state.batches.filter((b) => b.CLASS_ID === cid) };
    }
    if (S.includes('FROM classes')) {
      const tid = Number(bv(binds, 'teacher_id', 0));
      return { rows: state.classes.filter((c) => c.TEACHER_ID === tid) };
    }

    // ---- attendance ----
    if (S.startsWith('DELETE FROM attendance')) {
      const cid = bv(binds, 'id', 0) ?? bv(binds, 'class_id', 0);
      const sid = bv(binds, 'id', 0) ?? bv(binds, 'student_id', 0);
      if (S.includes('class_id = :id')) state.attendance = state.attendance.filter(a => a.CLASS_ID !== Number(cid));
      else if (S.includes('student_id = :id')) state.attendance = state.attendance.filter(a => a.STUDENT_ID !== Number(sid));
      return { rows: [] };
    }
    if (S.startsWith('MERGE INTO attendance')) {
      state.attendance.push({
        STUDENT_ID: Number(binds.student_id),
        CLASS_ID: Number(binds.class_id),
        ATTENDANCE_DATE: binds.att_date,
        STATUS: binds.status
      });
      return { rows: [] };
    }
    if (S.includes('COUNT(*) AS total_count')) {
      const sid = Number(bv(binds, 'student_id', 0));
      const mine = state.attendance.filter((a) => a.STUDENT_ID === sid);
      const present = mine.filter((a) => a.STATUS === 'present').length;
      return { rows: [{ TOTAL_COUNT: mine.length, PRESENT_COUNT: present, ABSENT_COUNT: mine.length - present }] };
    }
    if (S.includes('COUNT(a.id) AS total_sessions') || S.includes('FROM attendance a JOIN classes c')) {
      const sid = Number(bv(binds, 'student_id', 0));
      const mine = state.attendance.filter((a) => a.STUDENT_ID === sid);
      // Group by class
      const byClass = {};
      for (const att of mine) {
        if (!byClass[att.CLASS_ID]) {
          const cls = state.classes.find(c => c.ID === att.CLASS_ID) || {};
          byClass[att.CLASS_ID] = {
            CLASS_ID: att.CLASS_ID,
            SUBJECT_NAME: cls.SUBJECT_NAME || 'Subject',
            CLASS_TYPE: cls.CLASS_TYPE || 'Lecture',
            TOTAL_SESSIONS: 0,
            PRESENT_SESSIONS: 0,
            ABSENT_SESSIONS: 0
          };
        }
        byClass[att.CLASS_ID].TOTAL_SESSIONS++;
        if (att.STATUS === 'present') byClass[att.CLASS_ID].PRESENT_SESSIONS++;
        else byClass[att.CLASS_ID].ABSENT_SESSIONS++;
      }
      return { rows: Object.values(byClass) };
    }

    // ---- materials ----
    if (S.startsWith('INSERT INTO study_materials')) {
      const id = ++state.nextId;
      state.materials.push({
        ID: id, CLASS_ID: Number(binds.class_id), BATCH_TARGET_ID: binds.batch_target_id,
        UNIT_NUMBER: binds.unit_number, TITLE: binds.title, FILE_URL: binds.file_url
      });
      return { rows: [] };
    }
    if (S.includes('SELECT sm.file_url, c.teacher_id')) {
      const id = Number(bv(binds, 'id', 0));
      const rows = state.materials.filter((m) => m.ID === id).map((m) => {
        const cls = state.classes.find((c) => c.ID === m.CLASS_ID) || {};
        return { FILE_URL: m.FILE_URL, TEACHER_ID: cls.TEACHER_ID };
      });
      return { rows };
    }
    if (S.startsWith('DELETE FROM study_materials WHERE class_id')) {
      const cid = Number(bv(binds, 'id', 0) ?? bv(binds, 'class_id', 0));
      state.materials = state.materials.filter(m => m.CLASS_ID !== cid);
      return { rows: [] };
    }
    if (S.startsWith('DELETE FROM study_materials')) {
      const id = Number(bv(binds, 'id', 0));
      state.materials = state.materials.filter((m) => m.ID !== id);
      return { rows: [] };
    }
    if (S.includes('FROM study_materials')) {
      const attach = (m) => {
        const cls = state.classes.find((c) => c.ID === m.CLASS_ID) || {};
        const bt = state.batches.find((b) => b.ID === m.BATCH_TARGET_ID);
        const tch = state.teachers.find((t) => t.ID === cls.TEACHER_ID) || {};
        return {
          ID: m.ID, CLASS_ID: m.CLASS_ID, TITLE: m.TITLE, UNIT_NUMBER: m.UNIT_NUMBER,
          TEACHER_ID: cls.TEACHER_ID, FILE_URL: m.FILE_URL, FILE_TYPE: 'pdf', SUBJECT_NAME: cls.SUBJECT_NAME,
          CLASS_TYPE: cls.CLASS_TYPE, ACADEMIC_YEAR: cls.ACADEMIC_YEAR, BRANCH: cls.BRANCH,
          DIVISION: cls.DIVISION, TARGET_BATCH: bt ? bt.BATCH_NAME : null, TEACHER_NAME: tch.NAME
        };
      };
      let rows = state.materials.map(attach).filter((r) => r.SUBJECT_NAME !== undefined);
      if (S.includes('c.teacher_id = :teacher_id')) {
        const tid = Number(Array.isArray(binds) ? binds[0] : binds.teacher_id);
        rows = rows.filter((r) => {
          const cls = state.classes.find((c) => c.ID === r.CLASS_ID);
          return cls && cls.TEACHER_ID === tid;
        });
      } else if (binds && binds.academic_year !== undefined) {
        rows = rows.filter((r) =>
          up(r.ACADEMIC_YEAR) === up(binds.academic_year) &&
          up(r.BRANCH) === up(binds.branch) &&
          up(r.DIVISION) === up(binds.division) &&
          (r.TARGET_BATCH == null || up(r.TARGET_BATCH) === up(binds.batch))
        );
      }
      return { rows };
    }

    // ---- notices ----
    if (S.startsWith('INSERT INTO notices')) {
      const id = ++state.nextId;
      state.notices.push({
        ID: id, TEACHER_ID: Number(binds.teacher_id), ACADEMIC_YEAR: binds.academic_year,
        BRANCH: binds.branch, DIVISION: binds.division, BATCH: binds.batch ?? null,
        TITLE: binds.title, BODY: binds.body, IS_PINNED: binds.is_pinned ?? 0,
        CREATED_AT: binds.__created_at || new Date().toISOString()
      });
      return { rows: [], outBinds: { out_id: [id] } };
    }
    if (S.includes('SELECT teacher_id FROM notices WHERE id')) {
      const id = Number(bv(binds, 'id', 0));
      return { rows: state.notices.filter((n) => n.ID === id).map((n) => ({ TEACHER_ID: n.TEACHER_ID })) };
    }
    if (S.startsWith('DELETE FROM notices')) {
      const id = Number(bv(binds, 'id', 0));
      const before = state.notices.length;
      state.notices = state.notices.filter((n) => n.ID !== id);
      return { rows: [], rowsAffected: before - state.notices.length };
    }
    if (S.includes('FROM notices n')) {
      // Student feed: scoped + pinned-first. Route guards role; mock applies the
      // same UPPER() comparisons as the real SQL.
      let rows = state.notices.filter((n) =>
        up(n.ACADEMIC_YEAR) === up(binds.academic_year) &&
        up(n.BRANCH) === up(binds.branch) &&
        up(n.DIVISION) === up(binds.division) &&
        (n.BATCH == null || up(n.BATCH) === up(binds.batch))
      );
      rows = rows.map((n) => {
        const t = state.teachers.find((tc) => tc.ID === n.TEACHER_ID) || {};
        return { ...n, TEACHER_NAME: t.NAME || null };
      });
      rows.sort((a, b) =>
        (b.IS_PINNED - a.IS_PINNED) || String(b.CREATED_AT).localeCompare(String(a.CREATED_AT)));
      return { rows };
    }
    if (S.includes('FROM notices')) {
      // Teacher list: own notices, pinned first.
      const tid = Number(bv(binds, 'teacher_id', 0));
      const rows = state.notices
        .filter((n) => n.TEACHER_ID === tid)
        .sort((a, b) =>
          (b.IS_PINNED - a.IS_PINNED) || String(b.CREATED_AT).localeCompare(String(a.CREATED_AT)));
      return { rows };
    }

    throw new Error(`Mock DB: unhandled SQL: ${S.slice(0, 120)}`);
  }

  return { state, executor };
}

// ---------------------------------------------------------------------------
// HTTP helper + shared fixtures
// ---------------------------------------------------------------------------
let server;
let base;

async function api(method, p, { body, token, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(base + p, { method, headers, body: payload });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON body */ }
  return { status: res.status, json, headers: res.headers };
}

const TEACHER_A = { id: 1, name: 'Teacher A', email: 'a@x.dev', password: 'Passw0rd!A' };
const TEACHER_B = { id: 2, name: 'Teacher B', email: 'b@x.dev', password: 'Passw0rd!B' };

function seedTeacher(db, t) {
  db.state.teachers.push({ ID: t.id, NAME: t.name, EMAIL: t.email, PASSWORD_HASH: bcrypt.hashSync(t.password, 10) });
}

function seedStudent(db, over = {}) {
  const s = {
    ID: 500, NAME: 'Test Student', ACADEMIC_YEAR: 'SE', BRANCH: 'CE', DIVISION: 'A',
    BATCH: 'A1', ROLL_NUMBER: '01', ACCESS_CODE: 'SE-CE-A-A1-01', PASSWORD_HASH: bcrypt.hashSync('StudentPass!2026', 4), IS_FIRST_LOGIN: 0, ...over
  };
  db.state.students.push(s);
  return s;
}

function seedClass(db, over = {}) {
  const c = {
    ID: 10, TEACHER_ID: TEACHER_A.id, ACADEMIC_YEAR: 'SE', BRANCH: 'CE', DIVISION: 'A',
    SUBJECT_NAME: 'Applied Mechanics', CLASS_TYPE: 'Lecture', ...over
  };
  db.state.classes.push(c);
  return c;
}

async function loginTeacher(t) {
  const r = await api('POST', '/api/auth/teacher/login', { body: { email: t.email, password: t.password } });
  assert.equal(r.status, 200, `login failed for ${t.email}: ${JSON.stringify(r.json)}`);
  return r.json.token;
}

async function loginStudentCode(code) {
  const r = await api('POST', '/api/auth/student/login', { body: { access_code: code, password: 'StudentPass!2026' } });
  assert.equal(r.status, 200, `student login failed: ${JSON.stringify(r.json)}`);
  return r.json.token;
}

function pdfForm(fields, filename = 'notes.pdf', content = '%PDF-1.4 test') {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append('file', new Blob([content], { type: 'application/pdf' }), filename);
  return fd;
}

function uploadsDirCount() {
  return fs.readdirSync(TMP_UPLOADS).length;
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------
let db;

test.before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  resetQueryExecutor();
  fs.rmSync(TMP_UPLOADS, { recursive: true, force: true });
});

test.beforeEach(() => {
  db = createMockDb();
  setQueryExecutor(db.executor);
});

test.afterEach(() => {
  resetQueryExecutor();
  for (const f of fs.readdirSync(TMP_UPLOADS)) fs.unlinkSync(path.join(TMP_UPLOADS, f));
});

// ---------------------------------------------------------------------------
// Security headers & rate limiting
// ---------------------------------------------------------------------------
test('security: helmet headers on API responses', async () => {
  const r = await api('GET', '/api/nope');
  assert.equal(r.status, 404);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(r.headers.get('content-security-policy'), 'missing CSP header');
  assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.deepEqual(r.json, { success: false, error: 'Endpoint not found.' });
});

test('security: auth endpoints advertise rate limiting', async () => {
  const r = await api('POST', '/api/auth/student/login', { body: { access_code: 'garbage' } });
  assert.equal(r.status, 400);
  assert.ok(r.headers.get('ratelimit-policy'), 'missing RateLimit-Policy header');
});

test('security: PDF bytes require login and correct class ownership', async () => {
  seedTeacher(db, TEACHER_A); seedTeacher(db, TEACHER_B); seedClass(db);
  fs.writeFileSync(path.join(TMP_UPLOADS, 'ok.pdf'), '%PDF-1.4 hello');
  db.state.materials.push({ ID: 42, CLASS_ID: 10, FILE_URL: '/uploads/ok.pdf' });
  assert.equal((await fetch(base + '/uploads/ok.pdf')).status, 401);
  const token = await loginTeacher(TEACHER_A);
  const response = await fetch(base + '/uploads/ok.pdf', { headers: { Authorization: 'Bearer ' + token } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/pdf/);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const other = await loginTeacher(TEACHER_B);
  assert.equal((await fetch(base + '/uploads/ok.pdf', { headers: { Authorization: 'Bearer ' + other } })).status, 404);
  assert.equal((await fetch(base + '/uploads/missing.pdf', { headers: { Authorization: 'Bearer ' + token } })).status, 404);
});

// ---------------------------------------------------------------------------
// Teacher auth
// ---------------------------------------------------------------------------
test('auth: teacher register validation', async () => {
  let r = await api('POST', '/api/auth/teacher/register', { body: {} });
  assert.equal(r.status, 400);

  r = await api('POST', '/api/auth/teacher/register', {
    body: { name: 'X', email: 'not-an-email', password: 'longenough1' }
  });
  assert.equal(r.status, 400);

  r = await api('POST', '/api/auth/teacher/register', {
    body: { name: 'X', email: 'x@x.dev', password: 'short' }
  });
  assert.equal(r.status, 400);
});

test('auth: teacher register success and duplicate conflict', async () => {
  const body = { name: TEACHER_A.name, email: TEACHER_A.email, password: TEACHER_A.password };
  const r1 = await api('POST', '/api/auth/teacher/register', { body });
  assert.equal(r1.status, 201);
  assert.ok(r1.json.token);
  assert.equal(r1.json.user.role, 'teacher');
  assert.equal(db.state.teachers.length, 1);

  const r2 = await api('POST', '/api/auth/teacher/register', { body });
  assert.equal(r2.status, 409);
  assert.equal(db.state.teachers.length, 1);
});

test('auth: teacher login wrong password rejected', async () => {
  seedTeacher(db, TEACHER_A);
  const r = await api('POST', '/api/auth/teacher/login', {
    body: { email: TEACHER_A.email, password: 'WrongPass1!' }
  });
  assert.equal(r.status, 401);
});

test('auth: teacher login success returns usable JWT', async () => {
  seedTeacher(db, TEACHER_A);
  const token = await loginTeacher(TEACHER_A);
  const r = await api('GET', '/api/classes', { token });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.classes));
});

// ---------------------------------------------------------------------------
// Student auth
// ---------------------------------------------------------------------------
test('auth: student login rejects malformed codes', async () => {
  const r = await api('POST', '/api/auth/student/login', { body: { access_code: 'garbage' } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /access code format/i);
});

test('auth: student login with unknown but well-formed code -> 401', async () => {
  const r = await api('POST', '/api/auth/student/login', { body: { access_code: 'SE-CE-A-A1-99' } });
  assert.equal(r.status, 401);
});

test('auth: student login success returns JWT with hierarchy claims', async () => {
  seedStudent(db);
  const token = await loginStudentCode('se-ce-a-a1-01'); // lowercase proves case-insensitivity
  const r = await api('GET', '/api/materials/student', { token });
  assert.equal(r.status, 200);
  assert.equal(r.json.student_profile.branch, 'CE');
});

// ---------------------------------------------------------------------------
// Authentication gates
// ---------------------------------------------------------------------------
test('gates: protected endpoints reject missing tokens with 401', async () => {
  for (const p of ['/api/classes', '/api/students', '/api/materials/teacher', '/api/attendance/student']) {
    const r = await api('GET', p);
    assert.equal(r.status, 401, `${p} should require a token`);
  }
});

test('gates: student tokens are rejected on teacher routes', async () => {
  seedStudent(db);
  const studentToken = await loginStudentCode('SE-CE-A-A1-01');
  for (const p of ['/api/classes', '/api/students', '/api/materials/teacher']) {
    const r = await api('GET', p, { token: studentToken });
    assert.equal(r.status, 403, `${p} should be teacher-only`);
  }
});

// ---------------------------------------------------------------------------
// Cross-teacher authorization
// ---------------------------------------------------------------------------
test('authorization: teacher A cannot act on teacher B\'s class', async () => {
  seedTeacher(db, TEACHER_A);
  seedTeacher(db, TEACHER_B);
  seedClass(db, { ID: 50, TEACHER_ID: TEACHER_B.id });
  db.state.materials.push({ ID: 60, CLASS_ID: 50, BATCH_TARGET_ID: null, UNIT_NUMBER: '1', TITLE: 'B file', FILE_URL: '/uploads/b.pdf' });

  const token = await loginTeacher(TEACHER_A);

  const att = await api('POST', '/api/attendance', {
    token,
    body: { class_id: 50, date: '2026-10-18', records: [{ student_id: 500, status: 'Present' }] }
  });
  assert.equal(att.status, 403);

  const del = await api('DELETE', '/api/materials/60', { token });
  assert.equal(del.status, 403);

  const up = await api('POST', '/api/materials/upload', {
    token,
    form: pdfForm({ class_id: '50', title: 'Hijack' })
  });
  assert.equal(up.status, 403);

  assert.equal(db.state.attendance.length, 0, 'no attendance may be recorded for a foreign class');
  assert.equal(db.state.materials.length, 1, 'no material may be added to a foreign class');
  assert.equal(uploadsDirCount(), 0, 'rejected uploads must not leave files behind');
});

// ---------------------------------------------------------------------------
// Upload validation
// ---------------------------------------------------------------------------
test('upload: non-PDF MIME type rejected before saving', async () => {
  seedTeacher(db, TEACHER_A);
  seedClass(db);
  const token = await loginTeacher(TEACHER_A);

  const fd = new FormData();
  fd.append('class_id', '10');
  fd.append('title', 'evil');
  fd.append('file', new Blob(['<html>evil</html>'], { type: 'text/html' }), 'evil.html');

  const r = await api('POST', '/api/materials/upload', { token, form: fd });
  assert.equal(r.status, 400);
  assert.equal(uploadsDirCount(), 0);
  assert.equal(db.state.materials.length, 0);
});

test('upload: PDF MIME with non-PDF content rejected and file removed', async () => {
  seedTeacher(db, TEACHER_A);
  seedClass(db);
  const token = await loginTeacher(TEACHER_A);

  const r = await api('POST', '/api/materials/upload', {
    token,
    form: pdfForm({ class_id: '10', title: 'fake' }, 'fake.pdf', '<html>not a real pdf</html>')
  });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /not a valid PDF/i);
  assert.equal(uploadsDirCount(), 0, 'fake file must be deleted');
  assert.equal(db.state.materials.length, 0);
});

test('upload: valid PDF accepted and recorded', async () => {
  seedTeacher(db, TEACHER_A);
  seedClass(db);
  const token = await loginTeacher(TEACHER_A);

  const r = await api('POST', '/api/materials/upload', {
    token,
    form: pdfForm({ class_id: '10', title: 'Unit 1 Notes', unit_number: '1' })
  });
  assert.equal(r.status, 201);
  assert.equal(db.state.materials.length, 1);
  assert.equal(db.state.materials[0].TITLE, 'Unit 1 Notes');
  assert.ok(db.state.materials[0].FILE_URL.startsWith('/uploads/'));
  assert.equal(uploadsDirCount(), 1, 'file must be stored on disk');

  const list = await api('GET', '/api/materials/teacher', { token });
  assert.equal(list.status, 200);
  assert.equal(list.json.count, 1);
  assert.equal(list.json.materials[0].SUBJECT_NAME, 'Applied Mechanics');
});

test('upload: missing fields rejected and stashed file cleaned up', async () => {
  seedTeacher(db, TEACHER_A);
  seedClass(db);
  const token = await loginTeacher(TEACHER_A);

  const fd = new FormData();
  fd.append('file', new Blob(['%PDF-1.4 x'], { type: 'application/pdf' }), 'a.pdf');
  const r = await api('POST', '/api/materials/upload', { token, form: fd });
  assert.equal(r.status, 400);
  assert.equal(uploadsDirCount(), 0);
});

test('materials: teacher can delete own material and its file is removed', async () => {
  seedTeacher(db, TEACHER_A);
  seedClass(db);
  const token = await loginTeacher(TEACHER_A);

  const up = await api('POST', '/api/materials/upload', {
    token,
    form: pdfForm({ class_id: '10', title: 'Temp' })
  });
  assert.equal(up.status, 201);
  assert.equal(uploadsDirCount(), 1);

  const del = await api('DELETE', `/api/materials/${db.state.materials[0].ID}`, { token });
  assert.equal(del.status, 200);
  assert.equal(db.state.materials.length, 0);
  assert.equal(uploadsDirCount(), 0, 'file must be deleted from disk');
});

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------
test('attendance: invalid date and empty records rejected', async () => {
  seedTeacher(db, TEACHER_A);
  seedClass(db);
  const token = await loginTeacher(TEACHER_A);

  const badDate = await api('POST', '/api/attendance', {
    token,
    body: { class_id: 10, date: '18-10-2026', records: [{ student_id: 500, status: 'Present' }] }
  });
  assert.equal(badDate.status, 400);

  const empty = await api('POST', '/api/attendance', {
    token,
    body: { class_id: 10, date: '2026-10-18', records: [] }
  });
  assert.equal(empty.status, 400);
});

test('attendance: valid submission upserts with lowercase status', async () => {
  seedTeacher(db, TEACHER_A);
  seedClass(db);
  seedStudent(db, { ID: 500 });
  seedStudent(db, { ID: 501, ROLL_NUMBER: '02', ACCESS_CODE: 'SE-CE-A-A1-02' });
  const token = await loginTeacher(TEACHER_A);

  const r = await api('POST', '/api/attendance', {
    token,
    body: {
      class_id: 10,
      date: '2026-10-18',
      records: [
        { student_id: 500, status: 'Present' },
        { student_id: 501, status: 'Absent' }
      ]
    }
  });
  assert.equal(r.status, 201);
  assert.equal(db.state.attendance.length, 2);
  assert.equal(db.state.attendance[0].STATUS, 'present');
  assert.equal(db.state.attendance[1].STATUS, 'absent');
  assert.ok(db.state.calls.some((c) => c.sql.startsWith('MERGE INTO attendance')), 'upsert SQL must be used');
});

test('attendance: student sees real stats, null percentage when no records', async () => {
  seedTeacher(db, TEACHER_A);
  seedClass(db);
  seedStudent(db, { ID: 500 });
  const studentToken = await loginStudentCode('SE-CE-A-A1-01');

  const empty = await api('GET', '/api/attendance/student', { token: studentToken });
  assert.equal(empty.status, 200);
  assert.equal(empty.json.stats.percentage, null, 'no fake baseline percentage');
  assert.equal(empty.json.stats.total, 0);

  await api('POST', '/api/attendance', {
    token: await loginTeacher(TEACHER_A),
    body: { class_id: 10, date: '2026-10-18', records: [{ student_id: 500, status: 'Present' }] }
  });

  const after = await api('GET', '/api/attendance/student', { token: studentToken });
  assert.equal(after.json.stats.total, 1);
  assert.equal(after.json.stats.present, 1);
  assert.equal(after.json.stats.percentage, 100);
});

// ---------------------------------------------------------------------------
// Student management
// ---------------------------------------------------------------------------
test('students: create single FE student generates canonical code', async () => {
  seedTeacher(db, TEACHER_A);
  const token = await loginTeacher(TEACHER_A);

  const r = await api('POST', '/api/students', {
    token,
    body: { name: 'Fresh Student', academic_year: 'FE', division: 'E', batch: 'E1', roll_number: '36' }
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.student.access_code, 'FE-E-E1-36');
  assert.equal(r.json.student.branch, 'Common', 'FE must normalize to Common branch');
  assert.equal(db.state.students.length, 1);
});

test('students: bulk create reports per-row failures', async () => {
  seedTeacher(db, TEACHER_A);
  const token = await loginTeacher(TEACHER_A);

  const r = await api('POST', '/api/students/bulk', {
    token,
    body: {
      students: [
        { name: 'S1', academic_year: 'SE', branch: 'CE', division: 'A', batch: 'A1', roll_number: '01' },
        { name: 'S2', academic_year: 'XX', branch: 'CE', division: 'A', batch: 'A1', roll_number: '02' },
        { name: 'S3', academic_year: 'SE', branch: 'CE', division: 'A', batch: 'A2', roll_number: '03' }
      ]
    }
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.createdCount, 2);
  assert.equal(r.json.failedCount, 1);
  assert.equal(r.json.failed[0].name, 'S2');
});

test('students: roster list with division filter', async () => {
  seedTeacher(db, TEACHER_A);
  seedStudent(db, { ID: 500 });
  seedStudent(db, { ID: 501, DIVISION: 'B', BATCH: 'B1', ROLL_NUMBER: '02', ACCESS_CODE: 'SE-CE-B-B1-02' });
  const token = await loginTeacher(TEACHER_A);

  const r = await api('GET', '/api/students?division=A', { token });
  assert.equal(r.status, 200);
  assert.equal(r.json.count, 1);
  assert.equal(r.json.students[0].DIVISION, 'A');
});

test('students: update student modifies fields and regenerates canonical access code', async () => {
  seedTeacher(db, TEACHER_A);
  const stu = seedStudent(db, { ID: 500, NAME: 'Old Name', ACADEMIC_YEAR: 'SE', BRANCH: 'CE', DIVISION: 'A', BATCH: 'A1', ROLL_NUMBER: '10' });
  const token = await loginTeacher(TEACHER_A);

  const res = await api('PUT', `/api/students/${stu.ID}`, {
    token,
    body: { name: 'New Name', roll_number: '99' }
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.student.name, 'New Name');
  assert.equal(res.json.student.roll_number, '99');
  assert.equal(res.json.student.access_code, 'SE-CE-A-A1-99');
});

test('students: update non-existent student returns 404', async () => {
  seedTeacher(db, TEACHER_A);
  const token = await loginTeacher(TEACHER_A);

  const res = await api('PUT', '/api/students/99999', {
    token,
    body: { name: 'Ghost' }
  });
  assert.equal(res.status, 404);
});

test('students: delete student removes student and cascades attendance', async () => {
  seedTeacher(db, TEACHER_A);
  const stu = seedStudent(db, { ID: 500 });
  db.state.attendance.push({ STUDENT_ID: 500, CLASS_ID: 10, ATTENDANCE_DATE: '2026-10-18', STATUS: 'present' });
  const token = await loginTeacher(TEACHER_A);

  const res = await api('DELETE', `/api/students/${stu.ID}`, { token });
  assert.equal(res.status, 200);
  assert.equal(db.state.students.some(s => s.ID === 500), false);
  assert.equal(db.state.attendance.some(a => a.STUDENT_ID === 500), false);
});

test('students: regenerate access code recalculates based on student attributes', async () => {
  seedTeacher(db, TEACHER_A);
  const stu = seedStudent(db, { ID: 500, ACADEMIC_YEAR: 'TE', BRANCH: 'IT', DIVISION: 'B', BATCH: 'B2', ROLL_NUMBER: '42', ACCESS_CODE: 'OLD-CODE' });
  const token = await loginTeacher(TEACHER_A);

  const res = await api('POST', `/api/students/${stu.ID}/regenerate-code`, { token });
  assert.equal(res.status, 200);
  assert.equal(res.json.access_code, 'TE-IT-B-B2-42');
  assert.equal(db.state.students.find(s => s.ID === 500).ACCESS_CODE, 'TE-IT-B-B2-42');
});

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------
test('classes: create lab with batches, then list with roster', async () => {
  seedTeacher(db, TEACHER_A);
  const token = await loginTeacher(TEACHER_A);

  const create = await api('POST', '/api/classes', {
    token,
    body: {
      academic_year: 'SE', branch: 'CE', division: 'A',
      subject_name: 'Graphics Lab', class_type: 'Lab/Practical',
      batch_names: ['A1', 'A2']
    }
  });
  assert.equal(create.status, 201);
  assert.equal(create.json.class.batches.length, 2);
  assert.equal(db.state.batches.length, 2);

  seedStudent(db);
  const roster = await api('GET', `/api/classes/${create.json.class.id}/students?batch=A1`, { token });
  assert.equal(roster.status, 200);
  assert.equal(roster.json.students.length, 1);
});

test('classes: FE creation forces Common branch', async () => {
  seedTeacher(db, TEACHER_A);
  const token = await loginTeacher(TEACHER_A);

  const r = await api('POST', '/api/classes', {
    token,
    body: { academic_year: 'FE', branch: 'CE', division: 'E', subject_name: 'Maths', class_type: 'Lecture' }
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.class.branch, 'Common');
});

test('classes: update class renames subject and adds batches', async () => {
  seedTeacher(db, TEACHER_A);
  const cls = seedClass(db, { ID: 300, CLASS_TYPE: 'Lab/Practical', SUBJECT_NAME: 'Old Lab' });
  db.state.batches.push({ ID: 1, CLASS_ID: 300, BATCH_NAME: 'A1' });
  const token = await loginTeacher(TEACHER_A);

  const res = await api('PUT', `/api/classes/${cls.ID}`, {
    token,
    body: { subject_name: 'Advanced Lab', batch_names: ['A1', 'A2', 'A3'] }
  });
  assert.equal(res.status, 200);
  assert.equal(db.state.classes.find(c => c.ID === 300).SUBJECT_NAME, 'Advanced Lab');
  assert.equal(db.state.batches.filter(b => b.CLASS_ID === 300).length, 3);
});

test('classes: foreign teacher cannot update or delete class', async () => {
  seedTeacher(db, TEACHER_A);
  seedTeacher(db, TEACHER_B);
  const cls = seedClass(db, { ID: 300, TEACHER_ID: TEACHER_A.id });
  const tokenB = await loginTeacher(TEACHER_B);

  const putRes = await api('PUT', `/api/classes/${cls.ID}`, {
    token: tokenB,
    body: { subject_name: 'Hacked' }
  });
  assert.equal(putRes.status, 403);

  const delRes = await api('DELETE', `/api/classes/${cls.ID}`, { token: tokenB });
  assert.equal(delRes.status, 403);
});

test('classes: delete class cascades batches, materials, and attendance', async () => {
  seedTeacher(db, TEACHER_A);
  const cls = seedClass(db, { ID: 300 });
  db.state.batches.push({ ID: 1, CLASS_ID: 300, BATCH_NAME: 'A1' });
  db.state.materials.push({ ID: 10, CLASS_ID: 300, TITLE: 'Notes', FILE_URL: '/test.pdf' });
  db.state.attendance.push({ STUDENT_ID: 500, CLASS_ID: 300, ATTENDANCE_DATE: '2026-10-18', STATUS: 'present' });
  const token = await loginTeacher(TEACHER_A);

  const res = await api('DELETE', `/api/classes/${cls.ID}`, { token });
  assert.equal(res.status, 200);
  assert.equal(db.state.classes.some(c => c.ID === 300), false);
  assert.equal(db.state.batches.some(b => b.CLASS_ID === 300), false);
  assert.equal(db.state.materials.some(m => m.CLASS_ID === 300), false);
  assert.equal(db.state.attendance.some(a => a.CLASS_ID === 300), false);
});

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

function seedNotice(dbState, over = {}) {
  const n = {
    ID: 9000 + dbState.state.notices.length,
    TEACHER_ID: TEACHER_A.id,
    ACADEMIC_YEAR: 'SE', BRANCH: 'CE', DIVISION: 'A', BATCH: null,
    TITLE: 'Notice', BODY: 'Body text.', IS_PINNED: 0,
    CREATED_AT: '2026-10-17T09:00:00Z',
    ...over
  };
  dbState.state.notices.push(n);
  return n;
}

test('notices: teacher posts with defaults; FE branch normalized to Common', async () => {
  seedTeacher(db, TEACHER_A);
  const token = await loginTeacher(TEACHER_A);

  const r = await api('POST', '/api/notices', {
    token,
    body: { academic_year: 'FE', division: 'E', title: 'Maths schedule', body: 'Unit 3 moved to Friday.' }
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.notice.branch, 'Common');
  assert.equal(r.json.notice.batch, null);
  assert.equal(r.json.notice.is_pinned, 0);
  assert.equal(r.json.notice.division, 'E');
  assert.equal(db.state.notices.length, 1);
});

test('notices: invalid year and missing fields rejected without insert', async () => {
  seedTeacher(db, TEACHER_A);
  const token = await loginTeacher(TEACHER_A);

  const badYear = await api('POST', '/api/notices', {
    token, body: { academic_year: 'XX', division: 'A', title: 't', body: 'b' }
  });
  assert.equal(badYear.status, 400);

  const missingBody = await api('POST', '/api/notices', {
    token, body: { academic_year: 'SE', division: 'A', title: 't' }
  });
  assert.equal(missingBody.status, 400);
  assert.equal(db.state.notices.length, 0);
});

test('notices: teacher list shows only own notices, pinned first', async () => {
  seedTeacher(db, TEACHER_A);
  seedTeacher(db, TEACHER_B);
  const token = await loginTeacher(TEACHER_A);

  seedNotice(db, { ID: 1, TEACHER_ID: TEACHER_A.id, TITLE: 'Older', CREATED_AT: '2026-10-16T09:00:00Z' });
  seedNotice(db, { ID: 2, TEACHER_ID: TEACHER_A.id, TITLE: 'Pinned', IS_PINNED: 1, CREATED_AT: '2026-10-15T09:00:00Z' });
  seedNotice(db, { ID: 3, TEACHER_ID: TEACHER_B.id, TITLE: 'Not mine', CREATED_AT: '2026-10-18T09:00:00Z' });

  const r = await api('GET', '/api/notices/teacher', { token });
  assert.equal(r.status, 200);
  assert.equal(r.json.count, 2);
  assert.deepEqual(r.json.notices.map((n) => n.TITLE), ['Pinned', 'Older']);
});

test('notices: delete own 200, foreign 403, missing 404', async () => {
  seedTeacher(db, TEACHER_A);
  seedTeacher(db, TEACHER_B);
  const tokenA = await loginTeacher(TEACHER_A);

  seedNotice(db, { ID: 1, TEACHER_ID: TEACHER_A.id });
  seedNotice(db, { ID: 2, TEACHER_ID: TEACHER_B.id });

  const foreign = await api('DELETE', '/api/notices/2', { token: tokenA });
  assert.equal(foreign.status, 403);

  const missing = await api('DELETE', '/api/notices/999', { token: tokenA });
  assert.equal(missing.status, 404);

  const own = await api('DELETE', '/api/notices/1', { token: tokenA });
  assert.equal(own.status, 200);
  assert.equal(db.state.notices.length, 1);
});

test('notices: student feed is hierarchy-scoped, division-wide included, pinned first', async () => {
  seedTeacher(db, TEACHER_A);
  const stu = seedStudent(db); // SE-CE-A-A1
  const token = await loginStudentCode(stu.ACCESS_CODE);

  seedNotice(db, { ID: 1, TITLE: 'Div-wide', BATCH: null, IS_PINNED: 1, CREATED_AT: '2026-10-15T09:00:00Z' });
  seedNotice(db, { ID: 2, TITLE: 'Batch A1', BATCH: 'A1', CREATED_AT: '2026-10-17T09:00:00Z' });
  seedNotice(db, { ID: 3, TITLE: 'Batch A2', BATCH: 'A2', CREATED_AT: '2026-10-17T09:00:00Z' });
  seedNotice(db, { ID: 4, TITLE: 'Other division', DIVISION: 'B', CREATED_AT: '2026-10-17T09:00:00Z' });
  seedNotice(db, { ID: 5, TITLE: 'Other year', ACADEMIC_YEAR: 'TE', CREATED_AT: '2026-10-17T09:00:00Z' });

  const r = await api('GET', '/api/notices/student', { token });
  assert.equal(r.status, 200);
  assert.equal(r.json.count, 2);
  assert.deepEqual(r.json.notices.map((n) => n.TITLE), ['Div-wide', 'Batch A1']);
  assert.equal(r.json.notices[0].TEACHER_NAME, TEACHER_A.name);
});

test('notices: role gates — students cannot post, teachers cannot read student feed', async () => {
  seedTeacher(db, TEACHER_A);
  const stu = seedStudent(db);
  const studentToken = await loginStudentCode(stu.ACCESS_CODE);
  const teacherToken = await loginTeacher(TEACHER_A);

  const post = await api('POST', '/api/notices', {
    token: studentToken,
    body: { academic_year: 'SE', division: 'A', title: 't', body: 'b' }
  });
  assert.equal(post.status, 403);

  const feed = await api('GET', '/api/notices/student', { token: teacherToken });
  assert.equal(feed.status, 403);
});

test('materials: FE student sees division-wide FE materials despite branch casing', async () => {
  seedTeacher(db, TEACHER_A);
  // Class branch stored title-case 'Common' (server normalization); student row
  // stored 'COMMON'. The route's UPPER() comparisons must still join them; the
  // mock mirrors that with case-insensitive filters on both sides.
  seedClass(db, { ID: 30, ACADEMIC_YEAR: 'FE', BRANCH: 'Common', DIVISION: 'E', SUBJECT_NAME: 'Maths' });
  db.state.materials.push({
    ID: 31, CLASS_ID: 30, BATCH_TARGET_ID: null,
    UNIT_NUMBER: '1', TITLE: 'Algebra notes', FILE_URL: '/uploads/algebra.pdf'
  });

  const stu = seedStudent(db, {
    ID: 600, ACADEMIC_YEAR: 'FE', BRANCH: 'COMMON', DIVISION: 'E',
    BATCH: 'E1', ROLL_NUMBER: '36', ACCESS_CODE: 'FE-E-E1-36'
  });
  const token = await loginStudentCode(stu.ACCESS_CODE);

  const r = await api('GET', '/api/materials/student', { token });
  assert.equal(r.status, 200);
  assert.equal(r.json.materials.length, 1);
  assert.equal(r.json.materials[0].TITLE, 'Algebra notes');
});

// ---------------------------------------------------------------------------
// Live-Oracle integration (opt-in only)
// ---------------------------------------------------------------------------
if (process.env.RUN_DB_INTEGRATION === '1') {
  test('integration: full flow against real Oracle', { timeout: 60000 }, async () => {
    resetQueryExecutor(); // use the real query executor

    const tag = Date.now().toString(36);
    const teacher = { name: 'IT Teacher', email: `it-${tag}@x.dev`, password: 'Integ#123' };

    const reg = await api('POST', '/api/auth/teacher/register', { body: teacher });
    assert.equal(reg.status, 201, JSON.stringify(reg.json));
    const token = reg.json.token;

    const stu = await api('POST', '/api/students', {
      token,
      body: { name: `IT Student ${tag}`, academic_year: 'SE', branch: 'CE', division: 'A', batch: 'A1', roll_number: tag.slice(-4) }
    });
    assert.equal(stu.status, 201, JSON.stringify(stu.json));
    const code = stu.json.student.access_code;

    const cls = await api('POST', '/api/classes', {
      token,
      body: { academic_year: 'SE', branch: 'CE', division: 'A', subject_name: `IT Subject ${tag}`, class_type: 'Lecture' }
    });
    assert.equal(cls.status, 201, JSON.stringify(cls.json));

    const roster = await api('GET', `/api/classes/${cls.json.class.id}/students`, { token });
    assert.ok(roster.json.students.some((s) => s.ACCESS_CODE === code || s.access_code === code), 'student must appear in roster');

    const att = await api('POST', '/api/attendance', {
      token,
      body: { class_id: cls.json.class.id, date: '2026-10-18', records: [{ student_id: stu.json.student.id, status: 'Present' }] }
    });
    assert.equal(att.status, 201, JSON.stringify(att.json));

    const studentToken = await loginStudentCode(code);
    const stats = await api('GET', '/api/attendance/student', { token: studentToken });
    assert.equal(stats.json.stats.total, 1, JSON.stringify(stats.json));
    assert.equal(stats.json.stats.percentage, 100);

    setQueryExecutor(db.executor); // restore mock for any subsequent tests
  });
} else {
  console.log('ℹ️  RUN_DB_INTEGRATION not set — skipping live Oracle integration test.');
}
