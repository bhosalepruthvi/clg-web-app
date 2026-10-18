/**
 * server_studyflow_v2.js
 * StudyFlow - Node.js / Express Backend with Oracle Autonomous DB Integration
 *
 * Implements Prompt 2 requirements:
 * 1. Oracle connection pool using `oracledb`
 * 2. Teacher auth (email/password) returning JWT
 * 3. Student auth parsing flexible codes:
 *    - 'FE-E-E1-36' or 'FE-Common-E-E1-36' -> branch 'Common'
 *    - 'SE-CE-A-A1-12' -> branch 'CE'
 *    Returns JWT containing { id, name, academic_year, branch, division, batch, roll_number }
 * 4. Class Manager Route: POST /api/classes (supports Lab/Practical with array of batch_names)
 * 5. Upload Route: POST /api/materials/upload (Multer PDF upload with class_id & optional batch_id)
 * 6. Student Materials Route: GET /api/materials/student (scoped strictly by student's JWT credentials)
 *
 * Additions beyond Prompt 2:
 * - Teacher self-registration (POST /api/auth/teacher/register)
 * - Student management (GET/POST /api/students, POST /api/students/bulk) with generated access codes
 * - Teacher material list/delete (GET /api/materials/teacher, DELETE /api/materials/:id)
 * - Attendance upsert (re-marking a day updates instead of crashing on the unique constraint)
 * - Security: helmet, auth rate limiting, JWT secret enforcement, PDF magic-byte validation,
 *   safe /uploads headers, JSON error handling, input length validation
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const oracledb = require('oracledb');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ----------------------------------------------------
// JWT Secret — never fall back to a committed value.
// Production refuses to boot without one; development
// uses an ephemeral random secret (tokens die on restart).
// ----------------------------------------------------
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production.');
  }
  JWT_SECRET = crypto.randomBytes(48).toString('hex');
  console.warn('⚠️  JWT_SECRET is not set. Using an ephemeral random secret — all tokens are invalidated on restart. Set JWT_SECRET in your .env file.');
}

// ----------------------------------------------------
// 1. Oracle Autonomous Database Connection Pool
// ----------------------------------------------------
const WALLET_DIR = process.env.TNS_ADMIN || path.join(__dirname, 'wallet');
if (process.env.TNS_ADMIN) {
  try {
    oracledb.initOracleClient({ configDir: WALLET_DIR });
  } catch (err) {
    // Falls back to thin mode if client already initialized or unsupported
  }
}

let oraclePool = null;

async function initOraclePool() {
  if (oraclePool) return oraclePool;

  oraclePool = await oracledb.createPool({
    user: process.env.ORACLE_USER || 'ADMIN',
    password: process.env.ORACLE_PASSWORD || 'YourPassword123#',
    connectString: process.env.ORACLE_CONNECT_STRING || 'studyflow_high',
    poolMin: 2,
    poolMax: 10,
    poolIncrement: 2
  });

  console.log('✅ Oracle Autonomous Database Connection Pool Ready.');
  return oraclePool;
}

async function executeQuery(sql, binds = [], options = {}) {
  let conn;
  try {
    if (!oraclePool) await initOraclePool();
    conn = await oraclePool.getConnection();
    const result = await conn.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      autoCommit: true,
      ...options
    });
    return result;
  } finally {
    if (conn) {
      await conn.close();
    }
  }
}

// Test seam: every route calls queryExecutor instead of executeQuery
// directly, so the test suite can inject a mock database.
let queryExecutor = executeQuery;
function setQueryExecutor(fn) {
  queryExecutor = fn || executeQuery;
}
function resetQueryExecutor() {
  queryExecutor = executeQuery;
}

function isUniqueViolation(err) {
  return err && (err.errorNum === 1 || /ORA-00001/.test(err.message || ''));
}

// ----------------------------------------------------
// Middlewares & Storage Setup
// ----------------------------------------------------
app.use(helmet());
const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(cors({
  origin: corsOrigins,
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Auth rate limiting — access codes are short and guessable, so this
// endpoint is the brute-force target. AUTH_RATE_LIMIT_OVERRIDE exists
// for automated test runs only.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT_OVERRIDE) || 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, error: 'Too many attempts. Please try again later.' }
});
app.use('/api/auth', authLimiter);

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Serve uploads pinned to application/pdf + nosniff so a renamed hostile
// file can never be sniffed/executed by the browser; inline display is kept
// because the SPA's InAppViewer renders same-origin PDFs.
app.use('/uploads', (req, res, next) => {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}, express.static(UPLOADS_DIR, { dotfiles: 'ignore', index: false, fallthrough: false }));

// Multer storage for PDF study materials
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, unique);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 }, // 30 MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF documents are allowed.'));
  }
});

// JWT Verification Middleware
function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Authorization token required.' });
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

function requireTeacher(req, res) {
  if (req.user.role !== 'teacher') {
    res.status(403).json({ success: false, error: 'Teacher access required.' });
    return false;
  }
  return true;
}

// ----------------------------------------------------
// Validation helpers (schema limits come from schema_studyflow_v2.sql)
// ----------------------------------------------------
const ACADEMIC_YEARS = ['FE', 'SE', 'TE', 'BE'];
const CLASS_TYPES = ['Lecture', 'Lab/Practical'];

const cleanStr = (value, maxLen) => String(value ?? '').trim().slice(0, maxLen);
const isNonEmpty = (value, maxLen) => {
  const s = cleanStr(value, maxLen);
  return s.length > 0 ? s : null;
};
const isValidEmail = (email) =>
  typeof email === 'string' && email.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

// ----------------------------------------------------
// Helper: Access Code Parser
// Supports:
//  - 'FE-E-E1-36'         -> { academic_year: 'FE', branch: 'Common', division: 'E', batch: 'E1', roll_number: '36' }
//  - 'FE-Common-E-E1-36'  -> { academic_year: 'FE', branch: 'Common', division: 'E', batch: 'E1', roll_number: '36' }
//  - 'SE-CE-A-A1-12'      -> { academic_year: 'SE', branch: 'CE', division: 'A', batch: 'A1', roll_number: '12' }
// ----------------------------------------------------
function parseAccessCode(rawCode) {
  const parts = String(rawCode || '').trim().toUpperCase().split('-');

  if (parts[0] === 'FE') {
    if (parts.length === 4) {
      // Format: FE - Division - Batch - Roll (e.g. FE-E-E1-36)
      return {
        academic_year: 'FE',
        branch: 'Common',
        division: parts[1],
        batch: parts[2],
        roll_number: parts[3]
      };
    } else if (parts.length === 5 && parts[1] === 'COMMON') {
      // Format: FE - COMMON - Division - Batch - Roll (e.g. FE-Common-E-E1-36)
      return {
        academic_year: 'FE',
        branch: 'Common',
        division: parts[2],
        batch: parts[3],
        roll_number: parts[4]
      };
    }
  } else if (parts.length === 5) {
    // Format: Year - Branch - Division - Batch - Roll (e.g. SE-CE-A-A1-12)
    return {
      academic_year: parts[0],
      branch: parts[1],
      division: parts[2],
      batch: parts[3],
      roll_number: parts[4]
    };
  }

  return null;
}

// Canonical code generator — the inverse of parseAccessCode.
function generateAccessCode({ academic_year, branch, division, batch, roll_number }) {
  const roll = String(roll_number).trim().toUpperCase();
  if (academic_year === 'FE') {
    return `FE-${division}-${batch}-${roll}`;
  }
  return `${academic_year}-${branch}-${division}-${batch}-${roll}`;
}

function isPdfFile(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(5);
    fs.readSync(fd, header, 0, 5, 0);
    return header.toString('latin1') === '%PDF-';
  } finally {
    fs.closeSync(fd);
  }
}

// ----------------------------------------------------
// 2. Auth Routes
// ----------------------------------------------------

// POST /api/auth/teacher/register
app.post('/api/auth/teacher/register', async (req, res) => {
  try {
    const name = isNonEmpty(req.body.name, 120);
    const email = isValidEmail(req.body.email) ? req.body.email.trim() : null;
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!name || !email) {
      return res.status(400).json({ success: false, error: 'A valid name and email are required.' });
    }
    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({ success: false, error: 'Password must be between 8 and 128 characters.' });
    }

    const existing = await queryExecutor(
      'SELECT id FROM teachers WHERE LOWER(email) = LOWER(:email)',
      [email]
    );
    if (existing.rows && existing.rows.length > 0) {
      return res.status(409).json({ success: false, error: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const insertSql = `
      INSERT INTO teachers (name, email, password_hash)
      VALUES (:name, :email, :password_hash)
      RETURNING id INTO :out_id
    `;
    const result = await queryExecutor(insertSql, {
      name,
      email,
      password_hash: passwordHash,
      out_id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
    });
    const teacherId = result.outBinds.out_id[0];

    const token = jwt.sign({ id: teacherId, name, email, role: 'teacher' }, JWT_SECRET, { expiresIn: '7d' });

    return res.status(201).json({
      success: true,
      token,
      user: { id: teacherId, name, email, role: 'teacher' }
    });
  } catch (error) {
    console.error('Teacher registration error:', error);
    return res.status(500).json({ success: false, error: 'Failed to register teacher.' });
  }
});

// POST /api/auth/teacher/login
app.post('/api/auth/teacher/login', async (req, res) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }

    const sql = `
      SELECT id, name, email, password_hash
      FROM teachers
      WHERE LOWER(email) = LOWER(:email)
    `;
    const result = await queryExecutor(sql, [email]);

    if (!result.rows || result.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    const teacher = result.rows[0];
    const isMatch = await bcrypt.compare(password, teacher.PASSWORD_HASH);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

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
    return res.status(500).json({ success: false, error: 'Failed to process login.' });
  }
});

// POST /api/auth/student/login
app.post('/api/auth/student/login', async (req, res) => {
  try {
    const { access_code } = req.body;
    if (!access_code || !access_code.trim()) {
      return res.status(400).json({ success: false, error: 'access_code is required.' });
    }

    const parsed = parseAccessCode(access_code);
    if (!parsed) {
      return res.status(400).json({
        success: false,
        error: 'Invalid access code format. Expected e.g. FE-E-E1-36 or SE-CE-A-A1-12'
      });
    }

    const cleanCode = access_code.trim().toUpperCase();

    // Query students table matching access_code
    const sql = `
      SELECT id, name, academic_year, branch, division, batch, roll_number, access_code
      FROM students
      WHERE UPPER(access_code) = :code
    `;
    const result = await queryExecutor(sql, [cleanCode]);

    if (!result.rows || result.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'No student found with this access code.' });
    }

    const student = result.rows[0];

    // Return JWT containing exact year, branch, division, and batch
    const token = jwt.sign(
      {
        id: student.ID,
        name: student.NAME,
        academic_year: student.ACADEMIC_YEAR,
        branch: student.BRANCH,
        division: student.DIVISION,
        batch: student.BATCH,
        roll_number: student.ROLL_NUMBER,
        role: 'student'
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      success: true,
      token,
      student: {
        id: student.ID,
        name: student.NAME,
        academic_year: student.ACADEMIC_YEAR,
        branch: student.BRANCH,
        division: student.DIVISION,
        batch: student.BATCH,
        roll_number: student.ROLL_NUMBER,
        access_code: student.ACCESS_CODE
      }
    });
  } catch (error) {
    console.error('Student login error:', error);
    return res.status(500).json({ success: false, error: 'Failed to authenticate student.' });
  }
});

// ----------------------------------------------------
// 3. Student Management Routes (teacher only)
// ----------------------------------------------------

// POST /api/students - create a single student; the access code is generated
// in the canonical format and returned once here.
app.post('/api/students', authenticateJWT, async (req, res) => {
  try {
    if (!requireTeacher(req, res)) return;

    const name = isNonEmpty(req.body.name, 120);
    const academicYear = cleanStr(req.body.academic_year, 10).toUpperCase();
    let branch = cleanStr(req.body.branch, 30).toUpperCase() || 'COMMON';
    const division = isNonEmpty(req.body.division, 5);
    const batch = isNonEmpty(req.body.batch, 10);
    const rollNumber = isNonEmpty(req.body.roll_number, 30);

    if (!name || !division || !batch || !rollNumber) {
      return res.status(400).json({
        success: false,
        error: 'name, division, batch, and roll_number are required.'
      });
    }
    if (!ACADEMIC_YEARS.includes(academicYear)) {
      return res.status(400).json({ success: false, error: `academic_year must be one of: ${ACADEMIC_YEARS.join(', ')}.` });
    }
    if (academicYear === 'FE') {
      branch = 'Common';
    }

    const accessCode = generateAccessCode({
      academic_year: academicYear,
      branch,
      division: division.toUpperCase(),
      batch: batch.toUpperCase(),
      roll_number: rollNumber
    });

    const insertSql = `
      INSERT INTO students (name, academic_year, branch, division, batch, roll_number, access_code)
      VALUES (:name, :academic_year, :branch, :division, :batch, :roll_number, :access_code)
      RETURNING id INTO :out_id
    `;
    const result = await queryExecutor(insertSql, {
      name,
      academic_year: academicYear,
      branch,
      division: division.toUpperCase(),
      batch: batch.toUpperCase(),
      roll_number: rollNumber,
      access_code: accessCode,
      out_id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
    });

    return res.status(201).json({
      success: true,
      message: 'Student created. Share the access code with the student.',
      student: {
        id: result.outBinds.out_id[0],
        name,
        academic_year: academicYear,
        branch,
        division: division.toUpperCase(),
        batch: batch.toUpperCase(),
        roll_number: rollNumber,
        access_code: accessCode
      }
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return res.status(409).json({
        success: false,
        error: 'A student with this generated access code already exists. Check for a duplicate roll number in the same year/branch/division/batch.'
      });
    }
    console.error('Student creation error:', error);
    return res.status(500).json({ success: false, error: 'Failed to create student.' });
  }
});

// POST /api/students/bulk - create many students at once.
// Body: { students: [{ name, academic_year, branch, division, batch, roll_number }, ...] }
app.post('/api/students/bulk', authenticateJWT, async (req, res) => {
  try {
    if (!requireTeacher(req, res)) return;

    const list = Array.isArray(req.body) ? req.body : req.body.students;
    if (!Array.isArray(list) || list.length === 0) {
      return res.status(400).json({ success: false, error: 'A non-empty students array is required.' });
    }
    if (list.length > 200) {
      return res.status(400).json({ success: false, error: 'Maximum 200 students per bulk request.' });
    }

    const created = [];
    const failed = [];

    for (let i = 0; i < list.length; i++) {
      const s = list[i] || {};
      const name = isNonEmpty(s.name, 120);
      const academicYear = cleanStr(s.academic_year, 10).toUpperCase();
      let branch = cleanStr(s.branch, 30).toUpperCase() || 'COMMON';
      const division = isNonEmpty(s.division, 5);
      const batch = isNonEmpty(s.batch, 10);
      const rollNumber = isNonEmpty(s.roll_number, 30);

      if (!name || !division || !batch || !rollNumber || !ACADEMIC_YEARS.includes(academicYear)) {
        failed.push({ index: i, name: name || '(unnamed)', error: 'Missing or invalid fields (name, academic_year, division, batch, roll_number).' });
        continue;
      }
      if (academicYear === 'FE') branch = 'Common';

      const accessCode = generateAccessCode({
        academic_year: academicYear,
        branch,
        division: division.toUpperCase(),
        batch: batch.toUpperCase(),
        roll_number: rollNumber
      });

      try {
        const insertSql = `
          INSERT INTO students (name, academic_year, branch, division, batch, roll_number, access_code)
          VALUES (:name, :academic_year, :branch, :division, :batch, :roll_number, :access_code)
          RETURNING id INTO :out_id
        `;
        const result = await queryExecutor(insertSql, {
          name,
          academic_year: academicYear,
          branch,
          division: division.toUpperCase(),
          batch: batch.toUpperCase(),
          roll_number: rollNumber,
          access_code: accessCode,
          out_id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
        });
        created.push({
          id: result.outBinds.out_id[0],
          name,
          access_code: accessCode
        });
      } catch (err) {
        failed.push({
          index: i,
          name,
          error: isUniqueViolation(err)
            ? `Access code ${accessCode} already exists (duplicate roll number?).`
            : 'Database error while inserting.'
        });
      }
    }

    return res.status(created.length > 0 ? 201 : 400).json({
      success: created.length > 0,
      createdCount: created.length,
      failedCount: failed.length,
      created,
      failed
    });
  } catch (error) {
    console.error('Bulk student creation error:', error);
    return res.status(500).json({ success: false, error: 'Failed to process bulk student creation.' });
  }
});

// GET /api/students - roster for the teacher, with optional filters
app.get('/api/students', authenticateJWT, async (req, res) => {
  try {
    if (!requireTeacher(req, res)) return;

    const conditions = [];
    const binds = {};

    const year = cleanStr(req.query.academic_year, 10).toUpperCase();
    const branch = cleanStr(req.query.branch, 30).toUpperCase();
    const division = cleanStr(req.query.division, 5).toUpperCase();
    const batch = cleanStr(req.query.batch, 10).toUpperCase();

    if (year) { conditions.push('UPPER(academic_year) = :year'); binds.year = year; }
    if (branch) { conditions.push('UPPER(branch) = :branch'); binds.branch = branch; }
    if (division) { conditions.push('UPPER(division) = :division'); binds.division = division; }
    if (batch) { conditions.push('UPPER(batch) = :batch'); binds.batch = batch; }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `
      SELECT id, name, academic_year, branch, division, batch, roll_number, access_code, created_at
      FROM students
      ${where}
      ORDER BY academic_year, branch, division, batch,
               TO_NUMBER(REGEXP_SUBSTR(roll_number, '^[0-9]+')) NULLS LAST, roll_number ASC
    `;

    const result = await queryExecutor(sql, binds);
    return res.json({ success: true, count: result.rows ? result.rows.length : 0, students: result.rows || [] });
  } catch (error) {
    console.error('Fetch students error:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve students.' });
  }
});

// ----------------------------------------------------
// 4. Class Manager Routes
// ----------------------------------------------------

// POST /api/classes - dynamically create a class (Lecture or Lab/Practical with batches)
app.post('/api/classes', authenticateJWT, async (req, res) => {
  try {
    if (!requireTeacher(req, res)) return;

    const academicYear = cleanStr(req.body.academic_year, 10).toUpperCase();
    let branch = cleanStr(req.body.branch, 30).toUpperCase();
    const division = isNonEmpty(req.body.division, 5);
    const subjectName = isNonEmpty(req.body.subject_name, 120);
    const classType = cleanStr(req.body.class_type, 20);
    const batchNames = req.body.batch_names;

    if (!academicYear || !branch || !division || !subjectName || !classType) {
      return res.status(400).json({
        success: false,
        error: 'academic_year, branch, division, subject_name, and class_type are required.'
      });
    }
    if (!ACADEMIC_YEARS.includes(academicYear)) {
      return res.status(400).json({ success: false, error: `academic_year must be one of: ${ACADEMIC_YEARS.join(', ')}.` });
    }
    if (academicYear === 'FE') {
      branch = 'Common';
    }
    if (!CLASS_TYPES.includes(classType)) {
      return res.status(400).json({
        success: false,
        error: `class_type must be either '${CLASS_TYPES[0]}' or '${CLASS_TYPES[1]}'.`
      });
    }

    const teacherId = req.user.id;

    // Insert class record and return generated ID
    const insertClassSql = `
      INSERT INTO classes (teacher_id, academic_year, branch, division, subject_name, class_type)
      VALUES (:teacher_id, :academic_year, :branch, :division, :subject_name, :class_type)
      RETURNING id INTO :out_id
    `;

    const classBinds = {
      teacher_id: Number(teacherId),
      academic_year: academicYear,
      branch,
      division: division.toUpperCase(),
      subject_name: subjectName,
      class_type: classType,
      out_id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
    };

    const classRes = await queryExecutor(insertClassSql, classBinds);
    const newClassId = classRes.outBinds.out_id[0];

    // If Lab/Practical and batch names provided (e.g. ['E1', 'E2']), insert into class_batches
    const insertedBatches = [];
    if (classType === 'Lab/Practical' && Array.isArray(batchNames) && batchNames.length > 0) {
      const insertBatchSql = `
        INSERT INTO class_batches (class_id, batch_name)
        VALUES (:class_id, :batch_name)
        RETURNING id INTO :out_b_id
      `;

      for (const bName of batchNames) {
        const cleanBName = String(bName).trim().toUpperCase().slice(0, 10);
        if (!cleanBName) continue;
        const batchRes = await queryExecutor(insertBatchSql, {
          class_id: newClassId,
          batch_name: cleanBName,
          out_b_id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
        });
        insertedBatches.push({
          id: batchRes.outBinds.out_b_id[0],
          batch_name: cleanBName
        });
      }
    }

    return res.status(201).json({
      success: true,
      message: 'Class created successfully.',
      class: {
        id: newClassId,
        teacher_id: teacherId,
        academic_year: academicYear,
        branch,
        division: division.toUpperCase(),
        subject_name: subjectName,
        class_type: classType,
        batches: insertedBatches
      }
    });
  } catch (error) {
    console.error('Class creation error:', error);
    return res.status(500).json({ success: false, error: 'Failed to create class.' });
  }
});

// GET /api/classes - fetch all classes created by the logged-in teacher with their batches
app.get('/api/classes', authenticateJWT, async (req, res) => {
  try {
    if (!requireTeacher(req, res)) return;

    const teacherId = req.user.id;

    // Fetch classes
    const classesSql = `
      SELECT id, teacher_id, academic_year, branch, division, subject_name, class_type, created_at
      FROM classes
      WHERE teacher_id = :teacher_id
      ORDER BY created_at DESC
    `;
    const classResult = await queryExecutor(classesSql, [Number(teacherId)]);
    const classesList = classResult.rows || [];

    // Fetch batches for each class
    for (const c of classesList) {
      const batchesSql = `
        SELECT id, batch_name
        FROM class_batches
        WHERE class_id = :class_id
        ORDER BY batch_name ASC
      `;
      const batchRes = await queryExecutor(batchesSql, [c.ID || c.id]);
      c.batches = batchRes.rows || [];
    }

    return res.json({ success: true, classes: classesList });
  } catch (error) {
    console.error('Fetch classes error:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve classes.' });
  }
});

// GET /api/classes/:class_id/students - fetch student roster for a class and optional batch
app.get('/api/classes/:class_id/students', authenticateJWT, async (req, res) => {
  try {
    if (!requireTeacher(req, res)) return;

    const classId = req.params.class_id;
    const batchName = req.query.batch; // optional batch filter

    // Find class details
    const classSql = `SELECT * FROM classes WHERE id = :id`;
    const classRes = await queryExecutor(classSql, [Number(classId)]);
    if (!classRes.rows || classRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Class not found.' });
    }
    const cls = classRes.rows[0];

    // Query students belonging to this class's year, branch, division
    let studentsSql = `
      SELECT id, name, academic_year, branch, division, batch, roll_number, access_code
      FROM students
      WHERE UPPER(academic_year) = UPPER(:year)
        AND UPPER(branch) = UPPER(:branch)
        AND UPPER(division) = UPPER(:div)
    `;
    const binds = {
      year: cls.ACADEMIC_YEAR || cls.academic_year,
      branch: cls.BRANCH || cls.branch,
      div: cls.DIVISION || cls.division
    };

    if (batchName && batchName !== 'All') {
      studentsSql += ` AND UPPER(batch) = UPPER(:batch)`;
      binds.batch = batchName;
    }

    studentsSql += ` ORDER BY TO_NUMBER(REGEXP_SUBSTR(roll_number, '^[0-9]+')) NULLS LAST, roll_number ASC`;

    const studentsRes = await queryExecutor(studentsSql, binds);
    return res.json({
      success: true,
      class: cls,
      students: studentsRes.rows || []
    });
  } catch (error) {
    console.error('Fetch roster error:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve student roster.' });
  }
});

// POST /api/attendance - submit attendance roster (upsert: re-marking a day updates records)
app.post('/api/attendance', authenticateJWT, async (req, res) => {
  try {
    if (!requireTeacher(req, res)) return;

    const { class_id, date, records } = req.body;
    // records: [ { student_id: 12, status: 'Present' | 'Absent' }, ... ]
    if (!class_id || !date || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ success: false, error: 'class_id, date, and a non-empty records array are required.' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return res.status(400).json({ success: false, error: 'date must be in YYYY-MM-DD format.' });
    }

    // Only the owning teacher may mark attendance for a class
    const classRes = await queryExecutor('SELECT teacher_id FROM classes WHERE id = :id', [Number(class_id)]);
    if (!classRes.rows || classRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Class not found.' });
    }
    if (Number(classRes.rows[0].TEACHER_ID) !== Number(req.user.id)) {
      return res.status(403).json({ success: false, error: 'You can only mark attendance for your own classes.' });
    }

    // MERGE upsert keyed on the table's unique constraint so re-submission updates instead of erroring.
    // Status is stored lowercase to satisfy the schema CHECK constraint.
    const attendanceSql = `
      MERGE INTO attendance a
      USING (
        SELECT :student_id AS student_id, :class_id AS class_id,
               TO_DATE(:att_date, 'YYYY-MM-DD') AS attendance_date
        FROM dual
      ) src
      ON (a.student_id = src.student_id AND a.class_id = src.class_id AND a.attendance_date = src.attendance_date)
      WHEN MATCHED THEN
        UPDATE SET a.status = :status, a.marked_at = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN
        INSERT (student_id, class_id, attendance_date, status)
        VALUES (src.student_id, src.class_id, src.attendance_date, :status)
    `;

    for (const rec of records) {
      const status = String(rec.status).toLowerCase() === 'present' ? 'present' : 'absent';
      await queryExecutor(attendanceSql, {
        student_id: Number(rec.student_id),
        class_id: Number(class_id),
        att_date: String(date),
        status
      });
    }

    return res.status(201).json({
      success: true,
      message: `Recorded attendance for ${records.length} students.`
    });
  } catch (error) {
    console.error('Attendance submit error:', error);
    return res.status(500).json({ success: false, error: 'Failed to submit attendance.' });
  }
});

// ----------------------------------------------------
// 5. Upload & Material Routes
// ----------------------------------------------------

// POST /api/materials/upload
app.post('/api/materials/upload', authenticateJWT, upload.single('file'), async (req, res) => {
  try {
    if (!requireTeacher(req, res)) return;

    const { class_id, batch_id, unit_number, title } = req.body;

    if (!class_id || !title || !req.file) {
      // Clean up the stashed file when other fields fail validation
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({
        success: false,
        error: 'class_id, title, and PDF file are required.'
      });
    }

    // The client-sent MIME type is not trustworthy — verify the actual file header
    if (!isPdfFile(req.file.path)) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ success: false, error: 'File content is not a valid PDF.' });
    }

    // Only the owning teacher may upload to a class
    const classRes = await queryExecutor('SELECT teacher_id FROM classes WHERE id = :id', [Number(class_id)]);
    if (!classRes.rows || classRes.rows.length === 0) {
      fs.unlink(req.file.path, () => {});
      return res.status(404).json({ success: false, error: 'Class not found.' });
    }
    if (Number(classRes.rows[0].TEACHER_ID) !== Number(req.user.id)) {
      fs.unlink(req.file.path, () => {});
      return res.status(403).json({ success: false, error: 'You can only upload to your own classes.' });
    }

    const cleanTitle = cleanStr(title, 255);
    const cleanUnit = unit_number ? cleanStr(unit_number, 50) : null;
    const fileUrl = `/uploads/${req.file.filename}`;
    const batchTargetId = batch_id ? Number(batch_id) : null;

    const insertSql = `
      INSERT INTO study_materials (class_id, batch_target_id, unit_number, title, file_url, file_type)
      VALUES (:class_id, :batch_target_id, :unit_number, :title, :file_url, 'pdf')
    `;

    await queryExecutor(insertSql, {
      class_id: Number(class_id),
      batch_target_id: batchTargetId,
      unit_number: cleanUnit,
      title: cleanTitle,
      file_url: fileUrl
    });

    return res.status(201).json({
      success: true,
      message: 'Study material uploaded successfully.',
      material: {
        class_id: Number(class_id),
        batch_target_id: batchTargetId,
        unit_number: cleanUnit,
        title: cleanTitle,
        file_url: fileUrl
      }
    });
  } catch (error) {
    console.error('Material upload error:', error);
    return res.status(500).json({ success: false, error: 'Failed to upload study material.' });
  }
});

// GET /api/materials/teacher - everything the logged-in teacher has uploaded
app.get('/api/materials/teacher', authenticateJWT, async (req, res) => {
  try {
    if (!requireTeacher(req, res)) return;

    const sql = `
      SELECT
        sm.id,
        sm.title,
        sm.unit_number,
        sm.file_url,
        sm.file_type,
        sm.upload_timestamp,
        c.subject_name,
        c.class_type,
        c.academic_year,
        c.branch,
        c.division,
        cb.batch_name AS target_batch
      FROM study_materials sm
      JOIN classes c ON sm.class_id = c.id
      LEFT JOIN class_batches cb ON sm.batch_target_id = cb.id
      WHERE c.teacher_id = :teacher_id
      ORDER BY sm.upload_timestamp DESC
    `;

    const result = await queryExecutor(sql, [Number(req.user.id)]);
    return res.json({ success: true, count: result.rows ? result.rows.length : 0, materials: result.rows || [] });
  } catch (error) {
    console.error('Fetch teacher materials error:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve materials.' });
  }
});

// DELETE /api/materials/:id - remove a material and its file (owning teacher only)
app.delete('/api/materials/:id', authenticateJWT, async (req, res) => {
  try {
    if (!requireTeacher(req, res)) return;

    const materialId = Number(req.params.id);
    const lookupSql = `
      SELECT sm.file_url, c.teacher_id
      FROM study_materials sm
      JOIN classes c ON sm.class_id = c.id
      WHERE sm.id = :id
    `;
    const lookup = await queryExecutor(lookupSql, [materialId]);
    if (!lookup.rows || lookup.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Material not found.' });
    }
    if (Number(lookup.rows[0].TEACHER_ID) !== Number(req.user.id)) {
      return res.status(403).json({ success: false, error: 'You can only delete your own materials.' });
    }

    await queryExecutor('DELETE FROM study_materials WHERE id = :id', [materialId]);

    // Best-effort file cleanup; basename guards against path traversal
    const fileUrl = lookup.rows[0].FILE_URL || lookup.rows[0].file_url || '';
    const fileName = path.basename(fileUrl);
    if (fileName) {
      fs.unlink(path.join(UPLOADS_DIR, fileName), () => {});
    }

    return res.json({ success: true, message: 'Material deleted.' });
  } catch (error) {
    console.error('Material delete error:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete material.' });
  }
});

// GET /api/materials/student
// Uses student's JWT payload: { academic_year, branch, division, batch }
// Returns:
//  1. Division-wide materials (batch_target_id IS NULL)
//  2. Batch-targeted materials matching student's specific lab batch
app.get('/api/materials/student', authenticateJWT, async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ success: false, error: 'Student access required.' });
    }

    const { academic_year, branch, division, batch } = req.user;

    const sql = `
      SELECT 
        sm.id,
        sm.title,
        sm.unit_number,
        sm.file_url,
        sm.file_type,
        sm.upload_timestamp,
        c.subject_name,
        c.class_type,
        cb.batch_name AS target_batch,
        t.name AS teacher_name
      FROM study_materials sm
      JOIN classes c ON sm.class_id = c.id
      JOIN teachers t ON c.teacher_id = t.id
      LEFT JOIN class_batches cb ON sm.batch_target_id = cb.id
      WHERE c.academic_year = :academic_year
        AND c.branch = :branch
        AND c.division = :division
        AND (
          sm.batch_target_id IS NULL 
          OR UPPER(cb.batch_name) = UPPER(:batch)
        )
      ORDER BY sm.upload_timestamp DESC
    `;

    const result = await queryExecutor(sql, {
      academic_year: String(academic_year).toUpperCase(),
      branch: String(branch).toUpperCase(),
      division: String(division).toUpperCase(),
      batch: String(batch).toUpperCase()
    });

    return res.json({
      success: true,
      student_profile: { academic_year, branch, division, batch },
      count: result.rows ? result.rows.length : 0,
      materials: result.rows || []
    });
  } catch (error) {
    console.error('Student fetch materials error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load materials.' });
  }
});

// ----------------------------------------------------
// 6. Student Attendance Route
// ----------------------------------------------------

// GET /api/attendance/student
// Returns overall attendance percentage and breakdown for the logged in student
app.get('/api/attendance/student', authenticateJWT, async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ success: false, error: 'Student access required.' });
    }

    const studentId = req.user.id;

    const sql = `
      SELECT 
        COUNT(*) AS total_count,
        SUM(CASE WHEN LOWER(status) = 'present' THEN 1 ELSE 0 END) AS present_count,
        SUM(CASE WHEN LOWER(status) = 'absent' THEN 1 ELSE 0 END) AS absent_count
      FROM attendance
      WHERE student_id = :student_id
    `;

    const result = await queryExecutor(sql, [Number(studentId)]);
    const row = result.rows && result.rows.length > 0 ? result.rows[0] : null;

    const total = row ? Number(row.TOTAL_COUNT || row.total_count || 0) : 0;
    const present = row ? Number(row.PRESENT_COUNT || row.present_count || 0) : 0;
    const absent = row ? Number(row.ABSENT_COUNT || row.absent_count || 0) : 0;

    // No records yet: report zeros with a null percentage instead of inventing a number.
    const percentage = total > 0 ? Math.round((present / total) * 100) : null;

    return res.json({
      success: true,
      stats: { total, present, absent, percentage }
    });
  } catch (error) {
    console.error('Student attendance error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch attendance.' });
  }
});

// ----------------------------------------------------
// Optional: serve the built React SPA (production mode)
// ----------------------------------------------------
if (process.env.SERVE_FRONTEND === '1') {
  const distDir = path.join(__dirname, 'react-frontend', 'dist');
  if (!fs.existsSync(distDir)) {
    console.error(`SERVE_FRONTEND=1 but ${distDir} does not exist. Run "npm run build:frontend" first.`);
    process.exit(1);
  }
  app.use(express.static(distDir));
  // SPA fallback: every non-API, non-upload GET returns index.html
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

// ----------------------------------------------------
// 404 + JSON Error Handling
// ----------------------------------------------------
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ success: false, error: 'File exceeds the 30 MB limit.' });
    }
    return res.status(400).json({ success: false, error: `Upload error: ${err.message}` });
  }
  if (err && err.message === 'Only PDF documents are allowed.') {
    return res.status(400).json({ success: false, error: err.message });
  }
  // express.static (fallthrough: false) surfaces missing files as 404 errors
  if (err && (err.status === 404 || err.statusCode === 404)) {
    return res.status(404).json({ success: false, error: 'File not found.' });
  }
  console.error('Unhandled error:', err);
  return res.status(500).json({ success: false, error: 'Internal server error.' });
});

module.exports = { app, setQueryExecutor, resetQueryExecutor, start };

function start(port = PORT) {
  app.listen(port, () => {
    console.log(`StudyFlow Backend Server listening on http://localhost:${port}`);
  });
}

if (require.main === module) {
  start();
}
