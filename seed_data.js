/**
 * seed_data.js
 * Populates sample realistic demo data for testing the College Study Portal.
 * Creates:
 *  - 1 Teacher (Prof. Sharma)
 *  - 6 Students across Year 1 (FE) and Year 2 (SE) with clear Login Codes
 *  - 4 Study Materials (with real PDF sample files & YouTube links)
 *  - 12 Attendance records showing different percentages (Green >=75%, Amber 65-74%, Red <65%)
 *  - 3 Notices (pinned & targeted)
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { getDb, initializeDatabase } = require('./database');

async function seed() {
  console.log('--- Starting Demo Data Seeder ---');
  initializeDatabase();
  const db = getDb();

  // 1. Create uploads folder and a sample dummy PDF
  const sampleDir = path.join(__dirname, 'uploads', '2', 'Data Structures');
  if (!fs.existsSync(sampleDir)) {
    fs.mkdirSync(sampleDir, { recursive: true });
  }
  const samplePdfPath = path.join(sampleDir, 'unit1-arrays-linked-lists.pdf');
  if (!fs.existsSync(samplePdfPath)) {
    fs.writeFileSync(samplePdfPath, '%PDF-1.4\n1 0 obj\n<< /Title (Data Structures Unit 1) >>\nendobj\ntrailer\n<< >>\n%%EOF');
  }

  // 2. Clear previous test records (clean slate for demo)
  console.warn('[seed] WARNING: deleting all existing teachers, students, materials,');
  console.warn('[seed]          attendance and notices from the database.');
  db.prepare('DELETE FROM notice_reads').run();
  db.prepare('DELETE FROM notices').run();
  db.prepare('DELETE FROM attendance').run();
  db.prepare('DELETE FROM materials').run();
  db.prepare('DELETE FROM students').run();
  db.prepare('DELETE FROM teachers').run();

  // 3. Create Demo Teacher
  const teacherHash = await bcrypt.hash('teacher123', 10);
  const teacherStmt = db.prepare(`
    INSERT INTO teachers (name, email, password_hash, subjects)
    VALUES (?, ?, ?, ?)
  `);
  const teacherInfo = teacherStmt.run(
    'Prof. Rajesh Sharma',
    'sharma@college.edu',
    teacherHash,
    JSON.stringify(['Data Structures', 'Database Systems', 'Computer Networks'])
  );
  const teacherId = teacherInfo.lastInsertRowid;
  console.log(`[+] Created Teacher: Prof. Rajesh Sharma (email: sharma@college.edu / password: teacher123)`);

  // 4. Create Demo Students
  // Student 1: FE-A-01 (First login pending)
  // Student 2: SE-A-101 (Active student with high attendance ~90%)
  // Student 3: SE-A-102 (Active student with warning attendance ~70%)
  // Student 4: SE-A-103 (Active student with defaulter attendance ~50%)
  // Student 5: SE-B-201
  // Student 6: TE-A-301
  const studentHash = await bcrypt.hash('student123', 10);

  const studentStmt = db.prepare(`
    INSERT INTO students (name, roll_number, login_code, password_hash, year, semester, division, teacher_id, is_first_login)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const s1 = studentStmt.run('Aarav Patel', '01', 'FE-A-01', null, 1, 1, 'A', teacherId, 1);
  const s2 = studentStmt.run('Priya Singh', '101', 'SE-A-101', studentHash, 2, 3, 'A', teacherId, 0);
  const s3 = studentStmt.run('Rohan Deshmukh', '102', 'SE-A-102', studentHash, 2, 3, 'A', teacherId, 0);
  const s4 = studentStmt.run('Neha Kulkarni', '103', 'SE-A-103', studentHash, 2, 3, 'A', teacherId, 0);
  const s5 = studentStmt.run('Vikram Joshi', '201', 'SE-B-201', studentHash, 2, 3, 'B', teacherId, 0);
  const s6 = studentStmt.run('Ananya Verma', '301', 'TE-A-301', studentHash, 3, 5, 'A', teacherId, 0);

  console.log(`[+] Created 6 Students with login codes:`);
  console.log(`    - FE-A-01  : Aarav Patel (First-time onboarding demo, no password yet)`);
  console.log(`    - SE-A-101 : Priya Singh (Pass: student123 | High 90% attendance)`);
  console.log(`    - SE-A-102 : Rohan Deshmukh (Pass: student123 | Amber 70% attendance)`);
  console.log(`    - SE-A-103 : Neha Kulkarni (Pass: student123 | Red 50% defaulter attendance)`);

  // 5. Create Study Materials
  const matStmt = db.prepare(`
    INSERT INTO materials (title, description, file_path, file_type, link_url, year, semester, subject, unit, teacher_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  matStmt.run(
    'Unit 1: Linear Data Structures (Arrays & Linked Lists)',
    'Comprehensive lecture notes covering Singly and Doubly Linked Lists with Big-O complexity analysis.',
    'uploads/2/Data Structures/unit1-arrays-linked-lists.pdf',
    'pdf',
    null,
    2,
    3,
    'Data Structures',
    'Unit 1',
    teacherId
  );

  matStmt.run(
    'Unit 2: Stacks & Queues Applications',
    'Expression evaluation, infix to postfix conversions and recursion stacks.',
    null,
    'link',
    'https://www.youtube.com/watch?v=wjI1WNcIntg',
    2,
    3,
    'Data Structures',
    'Unit 2',
    teacherId
  );

  matStmt.run(
    'Unit 3: Trees and Binary Search Trees (BST)',
    'BST insertion, deletion, and tree traversal algorithms (Inorder, Preorder, Postorder).',
    null,
    'link',
    'https://drive.google.com/drive/folders/sample-bst-notes',
    2,
    3,
    'Data Structures',
    'Unit 3',
    teacherId
  );

  matStmt.run(
    'ER-Diagram & Relational Schema Guide',
    'Step-by-step ER to Relational schema mapping guidelines with case studies.',
    null,
    'link',
    'https://www.youtube.com/watch?v=QpdhBUYk7Kk',
    2,
    3,
    'Database Systems',
    'Unit 1',
    teacherId
  );
  console.log(`[+] Added 4 Course Materials (PDFs and external lecture links).`);

  // 6. Create Attendance Records for SE-A Students
  const attStmt = db.prepare(`
    INSERT OR REPLACE INTO attendance (student_id, teacher_id, subject, date, status)
    VALUES (?, ?, ?, ?, ?)
  `);

  const dates = [
    '2026-10-01', '2026-10-03', '2026-10-05', '2026-10-07',
    '2026-10-08', '2026-10-10', '2026-10-11', '2026-10-12',
    '2026-10-13', '2026-10-14'
  ];

  // Priya (s2.lastInsertRowid): 9 Present, 1 Absent = 90% (Green)
  dates.forEach((d, idx) => {
    attStmt.run(s2.lastInsertRowid, teacherId, 'Data Structures', d, idx === 3 ? 'absent' : 'present');
  });

  // Rohan (s3.lastInsertRowid): 7 Present, 3 Absent = 70% (Amber)
  dates.forEach((d, idx) => {
    attStmt.run(s3.lastInsertRowid, teacherId, 'Data Structures', d, idx % 3 === 0 ? 'absent' : 'present');
  });

  // Neha (s4.lastInsertRowid): 5 Present, 5 Absent = 50% (Red)
  dates.forEach((d, idx) => {
    attStmt.run(s4.lastInsertRowid, teacherId, 'Data Structures', d, idx % 2 === 0 ? 'absent' : 'present');
  });
  console.log(`[+] Added 30 Attendance logs covering Green, Amber, and Red thresholds.`);

  // 7. Create Notices
  const noticeStmt = db.prepare(`
    INSERT INTO notices (title, message, subject, year, division, teacher_id, is_pinned)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  noticeStmt.run(
    '🚨 Unit Test 1 Dates Announced for SE Computer',
    'The first unit test for Data Structures will be conducted on October 25th. Syllabus covers Unit 1 & Unit 2.',
    'Data Structures',
    2,
    'A',
    teacherId,
    1
  );

  noticeStmt.run(
    'Assignment 1 Submission Deadline',
    'Please submit your handwritten assignments on Linked List implementations before Friday 5 PM.',
    'Data Structures',
    2,
    'A',
    teacherId,
    0
  );

  noticeStmt.run(
    'Lab Schedule Update for Batch A2',
    'Data Structures practical lab will be conducted in Lab 304 instead of 202 this Thursday.',
    'Data Structures',
    2,
    'A',
    teacherId,
    0
  );
  console.log(`[+] Added 3 Class Notices (including 1 Pinned Notice).`);

  console.log('\n--- Demo Data Seeding Completed Successfully! ---');
}

// Guarded so that requiring this file (for example from a test harness) does not
// start seeding as a side effect. Run it directly with: node seed_data.js
if (require.main === module) {
  seed().catch(err => {
    console.error('Seeding failed:', err);
    process.exit(1);
  });
}

module.exports = { seed };