/**
 * seed_oracle.js
 * Idempotent demo-data seeder for the StudyFlow Oracle backend.
 *
 * Safe to run repeatedly: existing rows (matched by email / access code) are
 * skipped, never duplicated. Nothing is ever deleted.
 *
 * Usage:
 *   npm run seed:oracle
 *
 * Requires the same environment variables as server_studyflow_v2.js
 * (ORACLE_USER, ORACLE_PASSWORD, ORACLE_CONNECT_STRING, TNS_ADMIN).
 */

require('dotenv').config();

const oracledb = require('oracledb');
const bcrypt = require('bcryptjs');
const path = require('path');

const TNS_ADMIN = process.env.TNS_ADMIN || path.join(__dirname, 'wallet');
if (process.env.TNS_ADMIN) {
  try {
    oracledb.initOracleClient({ configDir: TNS_ADMIN });
  } catch (err) {
    // Thin mode fallback
  }
}

const DEMO_TEACHER = {
  name: 'Dr. A. Sharma',
  email: 'teacher@studyflow.dev',
  password: 'Teach#2026'
};

// [name, year, branch, division, batch, roll]
function buildStudentRows() {
  const rows = [];
  // FE — Common branch, division E, lab batches E1/E2
  for (const batch of ['E1', 'E2']) {
    for (let roll = 1; roll <= 4; roll++) {
      const rollStr = String(roll).padStart(2, '0');
      rows.push({
        name: `FE Student ${batch}-${rollStr}`,
        academic_year: 'FE',
        branch: 'Common',
        division: 'E',
        batch,
        roll_number: rollStr
      });
    }
  }
  // SE — CE branch, division A, lab batches A1/A2
  for (const batch of ['A1', 'A2']) {
    for (let roll = 1; roll <= 3; roll++) {
      const rollStr = String(roll).padStart(2, '0');
      rows.push({
        name: `SE Student ${batch}-${rollStr}`,
        academic_year: 'SE',
        branch: 'CE',
        division: 'A',
        batch,
        roll_number: rollStr
      });
    }
  }
  return rows;
}

function accessCodeFor(s) {
  if (s.academic_year === 'FE') {
    return `FE-${s.division}-${s.batch}-${s.roll_number}`;
  }
  return `${s.academic_year}-${s.branch}-${s.division}-${s.batch}-${s.roll_number}`;
}

async function run() {
  const pool = await oracledb.createPool({
    user: process.env.ORACLE_USER || 'ADMIN',
    password: process.env.ORACLE_PASSWORD || 'YourPassword123#',
    connectString: process.env.ORACLE_CONNECT_STRING || 'studyflow_high',
    poolMin: 1,
    poolMax: 4
  });

  let conn;
  try {
    conn = await pool.getConnection();
    console.log('Connected to Oracle. Seeding demo data...\n');

    // ---- Teacher ----
    let teacherId;
    const tRes = await conn.execute(
      'SELECT id FROM teachers WHERE LOWER(email) = LOWER(:email)',
      [DEMO_TEACHER.email],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    if (tRes.rows.length > 0) {
      teacherId = tRes.rows[0].ID;
      console.log(`Teacher already exists: ${DEMO_TEACHER.email} (id ${teacherId}) — skipped.`);
    } else {
      const hash = await bcrypt.hash(DEMO_TEACHER.password, 10);
      const ins = await conn.execute(
        `INSERT INTO teachers (name, email, password_hash)
         VALUES (:name, :email, :hash)
         RETURNING id INTO :out_id`,
        {
          name: DEMO_TEACHER.name,
          email: DEMO_TEACHER.email,
          hash,
          out_id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
        },
        { autoCommit: true }
      );
      teacherId = ins.outBinds.out_id[0];
      console.log(`Created teacher: ${DEMO_TEACHER.name} <${DEMO_TEACHER.email}> (id ${teacherId})`);
    }

    // ---- Students ----
    const createdCodes = [];
    let created = 0;
    let skipped = 0;
    for (const s of buildStudentRows()) {
      const code = accessCodeFor(s);
      const exists = await conn.execute(
        'SELECT id FROM students WHERE UPPER(access_code) = :code',
        [code],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      if (exists.rows.length > 0) {
        skipped++;
        continue;
      }
      await conn.execute(
        `INSERT INTO students (name, academic_year, branch, division, batch, roll_number, access_code)
         VALUES (:name, :year, :branch, :division, :batch, :roll, :code)`,
        {
          name: s.name,
          year: s.academic_year,
          branch: s.branch.toUpperCase() === 'COMMON' ? 'Common' : s.branch,
          division: s.division,
          batch: s.batch,
          roll: s.roll_number,
          code
        },
        { autoCommit: true }
      );
      created++;
      createdCodes.push({ name: s.name, access_code: code });
    }
    console.log(`Students: ${created} created, ${skipped} already existed.`);

    // ---- Demo classes (only if the teacher has none yet) ----
    const cRes = await conn.execute(
      'SELECT COUNT(*) AS n FROM classes WHERE teacher_id = :id',
      [teacherId],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    if (Number(cRes.rows[0].N) > 0) {
      console.log('Classes already exist for this teacher — skipped.');
    } else {
      const classes = [
        {
          academic_year: 'SE', branch: 'CE', division: 'A',
          subject_name: 'Applied Mechanics', class_type: 'Lecture', batches: []
        },
        {
          academic_year: 'SE', branch: 'CE', division: 'A',
          subject_name: 'Engineering Graphics Lab', class_type: 'Lab/Practical', batches: ['A1', 'A2']
        },
        {
          academic_year: 'FE', branch: 'Common', division: 'E',
          subject_name: 'Engineering Mathematics', class_type: 'Lecture', batches: []
        }
      ];
      for (const c of classes) {
        const ins = await conn.execute(
          `INSERT INTO classes (teacher_id, academic_year, branch, division, subject_name, class_type)
           VALUES (:tid, :year, :branch, :division, :subject, :ctype)
           RETURNING id INTO :out_id`,
          {
            tid: teacherId,
            year: c.academic_year,
            branch: c.branch,
            division: c.division,
            subject: c.subject_name,
            ctype: c.class_type,
            out_id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
          },
          { autoCommit: true }
        );
        const classId = ins.outBinds.out_id[0];
        for (const b of c.batches) {
          await conn.execute(
            'INSERT INTO class_batches (class_id, batch_name) VALUES (:cid, :bname)',
            { cid: classId, bname: b },
            { autoCommit: true }
          );
        }
        console.log(`Created class: ${c.subject_name} (${c.academic_year} ${c.branch} Div ${c.division}, ${c.class_type})`);
      }
    }

    console.log('\n================ DEMO CREDENTIALS ================');
    console.log(`Teacher login : ${DEMO_TEACHER.email} / ${DEMO_TEACHER.password}`);
    console.log('Student codes (code-only login):');
    for (const c of createdCodes) {
      console.log(`  ${c.access_code}  ->  ${c.name}`);
    }
    console.log('==================================================\n');
    console.log('Seed complete.');
  } finally {
    if (conn) await conn.close();
    await pool.close();
  }
}

run().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
