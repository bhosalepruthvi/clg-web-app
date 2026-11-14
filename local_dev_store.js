/**
 * local_dev_store.js
 * High-fidelity in-memory database engine for StudyFlow local development & testing.
 * Automatically activates when Oracle Cloud wallet is not yet configured,
 * ensuring students, teachers, classes, attendance, and notices work out-of-the-box.
 */

'use strict';

const bcrypt = require('bcryptjs');

function createLocalStore({ file } = {}) {
  const state = {
    nextId: 1000,
    teachers: [],
    students: [],
    classes: [],
    batches: [],
    materials: [],
    attendance: [],
    notices: [], campus: []
  };

  const up = (v) => String(v == null ? '' : v).toUpperCase();
  const bv = (binds, key, idx) => {
    if (Array.isArray(binds)) return binds[idx];
    return binds ? binds[key] : undefined;
  };

  // Seed default demo data
  const defaultPasswordHash = bcrypt.hashSync('Teach#2026', 10);
  const studentPasswordHash = bcrypt.hashSync('student123', 10);

  state.teachers.push({
    ID: 1,
    NAME: 'Dr. A. Sharma',
    EMAIL: 'teacher@studyflow.dev',
    PASSWORD_HASH: defaultPasswordHash
  });
  state.teachers.push({
    ID: 2,
    NAME: 'Prof. Rajesh Sharma',
    EMAIL: 'sharma@college.edu',
    PASSWORD_HASH: bcrypt.hashSync('teacher123', 10)
  });

  // Demo Students
  state.students.push({
    ID: 101,
    NAME: 'Aarav Patel',
    ACADEMIC_YEAR: 'FE',
    BRANCH: 'Common',
    DIVISION: 'E',
    BATCH: 'E1',
    ROLL_NUMBER: '36',
    ACCESS_CODE: 'FE-E-E1-36',
    PASSWORD_HASH: studentPasswordHash
  });
  state.students.push({
    ID: 102,
    NAME: 'Priya Singh',
    ACADEMIC_YEAR: 'SE',
    BRANCH: 'CE',
    DIVISION: 'A',
    BATCH: 'A1',
    ROLL_NUMBER: '12',
    ACCESS_CODE: 'SE-CE-A-A1-12',
    PASSWORD_HASH: studentPasswordHash
  });
  state.students.push({
    ID: 103,
    NAME: 'Rohan Deshmukh',
    ACADEMIC_YEAR: 'SE',
    BRANCH: 'CE',
    DIVISION: 'A',
    BATCH: 'A1',
    ROLL_NUMBER: '01',
    ACCESS_CODE: 'SE-CE-A-A1-01',
    PASSWORD_HASH: studentPasswordHash
  });
  state.students.push({
    ID: 104,
    NAME: 'Neha Kulkarni',
    ACADEMIC_YEAR: 'SE',
    BRANCH: 'CE',
    DIVISION: 'A',
    BATCH: 'A2',
    ROLL_NUMBER: '02',
    ACCESS_CODE: 'SE-CE-A-A2-02',
    PASSWORD_HASH: studentPasswordHash
  });

  // Demo Classes
  state.classes.push({
    ID: 10,
    TEACHER_ID: 1,
    ACADEMIC_YEAR: 'FE',
    BRANCH: 'Common',
    DIVISION: 'E',
    SUBJECT_NAME: 'Applied Mathematics-I',
    CLASS_TYPE: 'Lecture'
  });
  state.classes.push({
    ID: 20,
    TEACHER_ID: 1,
    ACADEMIC_YEAR: 'FE',
    BRANCH: 'Common',
    DIVISION: 'E',
    SUBJECT_NAME: 'Engineering Physics Lab',
    CLASS_TYPE: 'Lab/Practical'
  });
  state.batches.push({ ID: 1, CLASS_ID: 20, BATCH_NAME: 'E1' });
  state.batches.push({ ID: 2, CLASS_ID: 20, BATCH_NAME: 'E2' });

  state.classes.push({
    ID: 30,
    TEACHER_ID: 1,
    ACADEMIC_YEAR: 'SE',
    BRANCH: 'CE',
    DIVISION: 'A',
    SUBJECT_NAME: 'Data Structures & Algorithms',
    CLASS_TYPE: 'Lecture'
  });
  state.classes.push({
    ID: 40,
    TEACHER_ID: 1,
    ACADEMIC_YEAR: 'SE',
    BRANCH: 'CE',
    DIVISION: 'A',
    SUBJECT_NAME: 'Web Development Lab',
    CLASS_TYPE: 'Lab/Practical'
  });
  state.batches.push({ ID: 3, CLASS_ID: 40, BATCH_NAME: 'A1' });
  state.batches.push({ ID: 4, CLASS_ID: 40, BATCH_NAME: 'A2' });

  // Demo Attendance for Aarav Patel (FE-E-E1-36, ID 101): 8 sessions, 6 present = 75%
  for (let d = 1; d <= 8; d++) {
    const day = String(d).padStart(2, '0');
    state.attendance.push({
      STUDENT_ID: 101,
      CLASS_ID: 10,
      ATTENDANCE_DATE: `2026-10-${day}`,
      STATUS: d <= 6 ? 'present' : 'absent'
    });
  }

  // Demo Attendance for Priya Singh (SE-CE-A-A1-12, ID 102): 10 sessions, 9 present = 90%
  for (let d = 1; d <= 10; d++) {
    const day = String(d).padStart(2, '0');
    state.attendance.push({
      STUDENT_ID: 102,
      CLASS_ID: 30,
      ATTENDANCE_DATE: `2026-10-${day}`,
      STATUS: d <= 9 ? 'present' : 'absent'
    });
  }

  // Demo Notices
  state.notices.push({
    ID: 1,
    TEACHER_ID: 1,
    ACADEMIC_YEAR: 'FE',
    BRANCH: 'Common',
    DIVISION: 'E',
    BATCH: null,
    TITLE: 'Mid-Semester Examination Schedule',
    BODY: 'The Unit Test-1 examination starts next Monday. Please bring your college ID cards and blue/black pens.',
    IS_PINNED: 1,
    CREATED_AT: new Date().toISOString()
  });

  state.notices.push({
    ID: 2,
    TEACHER_ID: 1,
    ACADEMIC_YEAR: 'FE',
    BRANCH: 'Common',
    DIVISION: 'E',
    BATCH: 'E1',
    ROLL_NUMBER: null,
    TITLE: 'E1 Batch Physics Submission',
    BODY: 'Lab journals for experiments 1-4 must be submitted by Friday 4 PM.',
    IS_PINNED: 0,
    CREATED_AT: new Date().toISOString()
  });

  const fs = require('fs');
  if (file && fs.existsSync(file)) Object.assign(state, JSON.parse(fs.readFileSync(file, 'utf8')));
  state.campus ||= []; state.discussions ||= []; state.records ||= [];
  const persist = () => { if (!file) return; fs.mkdirSync(require('path').dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(state), { mode: 0o600 }); fs.renameSync(file + '.tmp', file); };
  if (file && !fs.existsSync(file)) persist();
  async function execute(sql, binds = []) {
    const S = sql.replace(/\s+/g, ' ').trim();
    if (S.startsWith('UPDATE teachers SET password_hash')) { const teacher=state.teachers.find(t=>Number(t.ID)===Number(binds.id)); if(teacher){teacher.PASSWORD_HASH=binds.password_hash;persist();} return {rowsAffected:teacher?1:0}; }
    if (S === 'SELECT * FROM teachers') return { rows: state.teachers };
    if (S === 'SELECT * FROM study_materials') return {rows:state.materials};
    if (S === 'SELECT * FROM class_batches') return {rows:state.batches};
    if (S === 'SELECT * FROM notices') return {rows:state.notices};
    if (S === 'SELECT * FROM attendance WHERE student_id = :student_id') return {rows:state.attendance.filter(a=>a.STUDENT_ID===Number(bv(binds,'student_id',0)))};
    if (S.startsWith('SELECT * FROM app_records')) return { rows: state.records };
    if (S.startsWith('INSERT INTO app_records')) { const id=++state.nextId; state.records.push({ID:id,KIND:binds.kind,OWNER_ID:binds.owner_id,PAYLOAD:binds.payload}); return {outBinds:{out_id:[id]}}; }
    if (S.startsWith('UPDATE app_records')) { const item=state.records.find(x=>x.ID===binds.id); if(item)item.PAYLOAD=binds.payload; return {rowsAffected:item?1:0}; }
    if (S.startsWith('DELETE FROM app_records')) { state.records=state.records.filter(x=>x.ID!==binds.id); return {rowsAffected:1}; }
    if (S.startsWith('SELECT * FROM discussion_items')) return { rows: state.discussions };
    if (S.startsWith('INSERT INTO discussion_items')) { const id = ++state.nextId; state.discussions.push({ID:id,KIND:binds.kind,OWNER_ID:binds.owner_id,PAYLOAD:binds.payload}); return {outBinds:{out_id:[id]}}; }
    if (S.startsWith('UPDATE discussion_items')) { const item=state.discussions.find(x=>x.ID===binds.id); if(item)item.PAYLOAD=binds.payload;return {rowsAffected:item?1:0}; }
    if (S.startsWith('SELECT * FROM campus_items')) return { rows: state.campus };
    if (S.startsWith('INSERT INTO campus_items')) { const id = ++state.nextId; state.campus.push({ID:id,KIND:binds.kind,OWNER_ID:binds.owner_id,CLASS_ID:binds.class_id,PAYLOAD:binds.payload}); return {outBinds:{out_id:[id]}}; }
    if (S.startsWith('UPDATE campus_items')) { const item=state.campus.find(x=>x.ID===binds.id); if(item)item.PAYLOAD=binds.payload;return {rowsAffected:item?1:0}; }
    if (S.startsWith('DELETE FROM campus_items')) {state.campus=state.campus.filter(x=>x.ID!==binds.id);return {rowsAffected:1};}
    if (S === 'SELECT * FROM classes') return { rows: state.classes };


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
      if (state.students.some(s=>up(s.ACCESS_CODE)===up(binds.access_code))) throw Object.assign(new Error('Duplicate student'),{errorNum:1});
      const id = ++state.nextId;
      state.students.push({
        ID: id, NAME: binds.name, ACADEMIC_YEAR: binds.academic_year, BRANCH: binds.branch,
        DIVISION: binds.division, BATCH: binds.batch, ROLL_NUMBER: binds.roll_number,
        REGISTRATION_CODE: binds.registration_code || null, EMAIL: null, ACCESS_CODE: binds.access_code, PASSWORD_HASH: binds.password_hash, IS_FIRST_LOGIN: 1
      });
      return { rows: [], outBinds: { out_id: [id] } };
    }
    if (S.startsWith('UPDATE students SET')) {
      const id = Number(binds.id);
      const student = state.students.find(s => s.ID === id);
      if (binds.code && (!student || student.REGISTRATION_CODE !== binds.code || Number(student.IS_FIRST_LOGIN)!==1)) return {rowsAffected:0};
      if (binds.email && state.students.some(s=>s.ID!==id&&String(s.EMAIL||'').toLowerCase()===binds.email.toLowerCase())) throw Object.assign(new Error('Duplicate email'),{errorNum:1});
      if (binds.previous_hash && (!student || student.PASSWORD_HASH !== binds.previous_hash || Number(student.IS_FIRST_LOGIN) !== 1)) return { rowsAffected: 0 };
      if (student) {
        if(binds.email!==undefined) student.EMAIL=binds.email;
        if(binds.registration_code!==undefined) student.REGISTRATION_CODE=binds.registration_code;
        if(S.includes('registration_code = NULL')){student.REGISTRATION_CODE=null;student.IS_FIRST_LOGIN=0;}
        if (binds.password_hash !== undefined) student.PASSWORD_HASH = binds.password_hash;
        if (binds.is_first_login !== undefined) student.IS_FIRST_LOGIN = binds.is_first_login;
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
      state.campus = state.campus.filter(i => !(i.OWNER_ID === id && ['submission','correction'].includes(i.KIND)));
      return { rows: [] };
    }
    if (S.includes('FROM students') && (S.includes('id = :id') || S.includes('WHERE id = :id'))) {
      const id = Number(bv(binds, 'id', 0));
      return { rows: state.students.filter((s) => s.ID === id) };
    }
    if (S.includes('FROM students WHERE registration_code = :code')) return {rows:state.students.filter(s=>s.REGISTRATION_CODE===binds[0])};
    if (S.includes('FROM students WHERE LOWER(email) = :email')) return {rows:state.students.filter(s=>String(s.EMAIL||'').toLowerCase()===binds[0])};
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
      if (cls && binds.teacher_id !== undefined) cls.TEACHER_ID=Number(binds.teacher_id);
      if (cls && binds.subject_name !== undefined) {
        cls.SUBJECT_NAME = binds.subject_name;
      }
      return { rows: [] };
    }
    if (S.startsWith('DELETE FROM classes')) {
      const id = Number(binds.id || (Array.isArray(binds) ? binds[0] : 0));
      state.classes = state.classes.filter(c => c.ID !== id);
      state.campus = state.campus.filter(i => i.CLASS_ID !== id);
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
      const cid = Number(bv(binds, 'class_id', 0) ?? bv(binds, 'id', 0));
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
      state.attendance = state.attendance.filter(a=>!(a.STUDENT_ID===Number(binds.student_id)&&a.CLASS_ID===Number(binds.class_id)&&a.ATTENDANCE_DATE===binds.att_date));
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
          FILE_URL: m.FILE_URL, FILE_TYPE: 'pdf', SUBJECT_NAME: cls.SUBJECT_NAME,
          TEACHER_ID: cls.TEACHER_ID, CLASS_TYPE: cls.CLASS_TYPE, ACADEMIC_YEAR: cls.ACADEMIC_YEAR, BRANCH: cls.BRANCH,
          DIVISION: cls.DIVISION, TARGET_BATCH: bt ? bt.BATCH_NAME : null, TEACHER_NAME: tch.NAME
        };
      };
      let rows = state.materials.map(attach).filter((r) => r.SUBJECT_NAME !== undefined);
      if (S.includes('c.teacher_id = :teacher_id')) rows = rows.filter(r => Number(r.TEACHER_ID) === Number(Array.isArray(binds) ? binds[0] : binds.teacher_id));
      if (binds?.academic_year) rows = rows.filter(r => up(r.ACADEMIC_YEAR)===up(binds.academic_year)&&up(r.BRANCH)===up(binds.branch)&&up(r.DIVISION)===up(binds.division)&&(!r.TARGET_BATCH||up(r.TARGET_BATCH)===up(binds.batch)));
      if (binds && binds.class_id) {
        rows = rows.filter((r) => r.CLASS_ID === Number(binds.class_id));
      }
      return { rows };
    }

    // ---- notices ----
    if (S.startsWith('INSERT INTO notices')) {
      const id = ++state.nextId;
      state.notices.push({
        ID: id,
        TEACHER_ID: Number(binds.teacher_id),
        ACADEMIC_YEAR: binds.academic_year,
        BRANCH: binds.branch,
        DIVISION: binds.division,
        BATCH: binds.batch,
        TITLE: binds.title,
        BODY: binds.body,
        IS_PINNED: Number(binds.is_pinned || 0),
        CREATED_AT: new Date().toISOString()
      });
      return { rows: [], outBinds: { out_id: [id] } };
    }
    if (S.startsWith('DELETE FROM notices WHERE id')) {
      const id = Number(bv(binds, 'id', 0));
      const before = state.notices.length;
      state.notices = state.notices.filter((n) => n.ID !== id);
      return { rows: [], rowsAffected: before - state.notices.length };
    }
    if (S.includes('FROM notices n')) {
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
      const tid = Number(bv(binds, 'teacher_id', 0));
      const rows = state.notices
        .filter((n) => n.TEACHER_ID === tid)
        .sort((a, b) =>
          (b.IS_PINNED - a.IS_PINNED) || String(b.CREATED_AT).localeCompare(String(a.CREATED_AT)));
      return { rows };
    }

    return { rows: [] };
  }

  async function executor(sql, binds) {
    const result = await execute(sql, binds);
    if (/^\s*(INSERT|UPDATE|DELETE|MERGE)/i.test(sql)) persist();
    return result;
  }
  return { state, executor };
}

module.exports = { createLocalStore };


