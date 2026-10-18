/**
 * server_studyflow_oracle.js
 * StudyFlow - Node.js / Express Server connected to Oracle Autonomous Database
 *
 * Implements:
 * 1. Oracle DB connection pool using `oracledb`
 * 2. Teacher Auth (email/password) returning JWT
 * 3. Student Auth (access_code only) returning JWT with division and roll number
 * 4. Multer PDF upload to local /uploads and inserting into STUDY_MATERIALS table
 * 5. Batch attendance submission route for teachers
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { executeQuery, initOraclePool } = require('./db_oracle');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'studyflow_jwt_secret_key_2026';

// ----------------------------------------------------
// Middleware
// ----------------------------------------------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Local uploads directory placeholder (before Oracle Object Storage)
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
app.use('/uploads', express.static(UPLOADS_DIR));

// ----------------------------------------------------
// Multer Configuration for PDF File Uploads
// ----------------------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are supported for notes!'));
    }
  }
});

// ----------------------------------------------------
// JWT Authentication Middleware Guard
// ----------------------------------------------------
function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Access token required.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ success: false, error: 'Invalid or expired token.' });
  }
}

// ----------------------------------------------------
// Route 1: Teacher Authentication (Email / Password -> JWT)
// ----------------------------------------------------
app.post('/api/auth/teacher/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }

    const query = `
      SELECT id, name, email, password_hash
      FROM teachers
      WHERE LOWER(email) = LOWER(:email)
    `;
    const result = await executeQuery(query, [email.trim()]);

    if (!result.rows || result.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    const teacher = result.rows[0];
    const passwordValid = await bcrypt.compare(password, teacher.PASSWORD_HASH);
    if (!passwordValid) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    // Generate JWT
    const token = jwt.sign(
      {
        id: teacher.ID,
        name: teacher.NAME,
        email: teacher.EMAIL,
        role: 'teacher'
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      success: true,
      message: 'Teacher authenticated successfully.',
      token,
      user: {
        id: teacher.ID,
        name: teacher.NAME,
        email: teacher.EMAIL,
        role: 'teacher'
      }
    });
  } catch (error) {
    console.error('Teacher login error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error.' });
  }
});

// ----------------------------------------------------
// Route 2: Student Authentication (Single access_code -> JWT)
// ----------------------------------------------------
app.post('/api/auth/student/login', async (req, res) => {
  try {
    const { access_code } = req.body;
    if (!access_code || !access_code.trim()) {
      return res.status(400).json({ success: false, error: 'access_code is required.' });
    }

    const cleanCode = access_code.trim().toUpperCase();

    const query = `
      SELECT id, name, division, roll_number, access_code
      FROM students
      WHERE UPPER(access_code) = UPPER(:access_code)
    `;
    const result = await executeQuery(query, [cleanCode]);

    if (!result.rows || result.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid access code.' });
    }

    const student = result.rows[0];

    // Return JWT containing division and roll number as requested
    const token = jwt.sign(
      {
        id: student.ID,
        name: student.NAME,
        division: student.DIVISION,
        roll_number: student.ROLL_NUMBER,
        access_code: student.ACCESS_CODE,
        role: 'student'
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      success: true,
      message: 'Student authenticated successfully.',
      token,
      student: {
        id: student.ID,
        name: student.NAME,
        division: student.DIVISION,
        roll_number: student.ROLL_NUMBER,
        access_code: student.ACCESS_CODE
      }
    });
  } catch (error) {
    console.error('Student login error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error.' });
  }
});

// ----------------------------------------------------
// Route 3: Multer File Upload for Study Materials (Teacher only)
// ----------------------------------------------------
app.post('/api/materials/upload', authenticateJWT, upload.single('file'), async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ success: false, error: 'Only teachers can upload materials.' });
    }

    const { subject_id, unit_number, title, description } = req.body;
    if (!subject_id || !title || !req.file) {
      return res.status(400).json({ success: false, error: 'subject_id, title, and PDF file are required.' });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    const teacherId = req.user.id;

    const insertSql = `
      INSERT INTO study_materials (subject_id, teacher_id, unit_number, title, description, file_url, file_type)
      VALUES (:subject_id, :teacher_id, :unit_number, :title, :description, :file_url, 'pdf')
    `;

    await executeQuery(insertSql, {
      subject_id: Number(subject_id),
      teacher_id: Number(teacherId),
      unit_number: unit_number || null,
      title: title.trim(),
      description: description ? description.trim() : null,
      file_url: fileUrl
    });

    return res.status(201).json({
      success: true,
      message: 'Study material uploaded successfully.',
      file_url: fileUrl
    });
  } catch (error) {
    console.error('Material upload error:', error);
    return res.status(500).json({ success: false, error: 'Failed to upload material.' });
  }
});

// ----------------------------------------------------
// Route 4: Batch Attendance Submission (Teacher only)
// ----------------------------------------------------
app.post('/api/attendance', authenticateJWT, async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ success: false, error: 'Only teachers can submit attendance.' });
    }

    const { subject_id, date, records } = req.body;
    // records is an array of objects: [{ student_id: 1, status: 'present' }, ...]

    if (!subject_id || !date || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'subject_id, date, and a non-empty records array are required.'
      });
    }

    // Upsert using Oracle MERGE statement for concurrency and idempotency
    const mergeSql = `
      MERGE INTO attendance a
      USING (SELECT :student_id AS s_id, :subject_id AS sub_id, TO_DATE(:att_date, 'YYYY-MM-DD') AS a_date FROM dual) src
      ON (a.student_id = src.s_id AND a.subject_id = src.sub_id AND a.attendance_date = src.a_date)
      WHEN MATCHED THEN
        UPDATE SET a.status = :status, a.marked_at = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN
        INSERT (student_id, subject_id, attendance_date, status)
        VALUES (src.s_id, src.sub_id, src.a_date, :status)
    `;

    for (const record of records) {
      await executeQuery(mergeSql, {
        student_id: Number(record.student_id),
        subject_id: Number(subject_id),
        att_date: date,
        status: record.status.toLowerCase()
      });
    }

    return res.json({
      success: true,
      message: `Successfully processed attendance for ${records.length} students.`,
      date,
      subject_id
    });
  } catch (error) {
    console.error('Attendance error:', error);
    return res.status(500).json({ success: false, error: 'Failed to save attendance.' });
  }
});

module.exports = app;
