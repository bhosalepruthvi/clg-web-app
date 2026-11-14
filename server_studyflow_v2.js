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
// Enable only behind the deployment's single reverse proxy; port 3000 stays private.
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// ----------------------------------------------------
// JWT Secret — never fall back to a committed value.
// Production refuses to boot without one; development
// uses an ephemeral random secret (tokens die on restart).
// ----------------------------------------------------
let JWT_SECRET = process.env.JWT_SECRET;
if (process.env.NODE_ENV === 'production' && JWT_SECRET && JWT_SECRET.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters in production.');
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
let isUsingLocalStore = false;
let localStore = null;

async function initOraclePool() {
  if (oraclePool) return oraclePool;

  const walletDir = process.env.TNS_ADMIN || path.join(__dirname, 'wallet');
  const hasWallet = fs.existsSync(walletDir);

  if (!hasWallet && !process.env.ORACLE_PASSWORD) {
    const err = new Error('ORACLE_WALLET_NOT_FOUND');
    err.code = 'NJS-516';
    throw err;
  }

  oraclePool = await oracledb.createPool({
    user: process.env.ORACLE_USER || 'ADMIN',
    password: process.env.ORACLE_PASSWORD || 'YourPassword123#',
    connectString: process.env.ORACLE_CONNECT_STRING || 'studyflow_high',
    ...(oracledb.thin ? {
      configDir: walletDir,
      walletLocation: hasWallet ? walletDir : undefined,
      walletPassword: process.env.ORACLE_WALLET_PASSWORD
    } : {}),
    poolMin: 2,
    poolMax: 10,
    poolIncrement: 2
  });

  console.log('✅ Oracle Autonomous Database Connection Pool Ready.');
  return oraclePool;
}

async function executeQuery(sql, binds = [], options = {}) {
  // If local store fallback is active, route through it
  if (isUsingLocalStore && localStore) {
    return localStore.executor(sql, binds);
  }

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
  } catch (err) {
    // If Oracle wallet is not configured or connection failed, activate seamless local dev mode
    if (process.env.NODE_ENV !== 'production' && process.env.LOCAL_DEV_MODE !== '0' && !oraclePool && (err.code === 'NJS-516' || err.message === 'ORACLE_WALLET_NOT_FOUND' || /ORA-12154/.test(err.message || ''))) {
      if (!isUsingLocalStore) {
        isUsingLocalStore = true;
        const { createLocalStore } = require('./local_dev_store');
        localStore = createLocalStore({ file: process.env.LOCAL_STORE_PATH || path.join(__dirname, '.local-data', 'studyflow.json') });
        console.log('💡 Oracle wallet not found in ./wallet. Activated LOCAL OFFLINE DEV MODE (Demo data loaded).');
        console.log('👉 Teacher login: teacher@studyflow.dev / Teach#2026');
        console.log('👉 Student login: FE-E-E1-36 or SE-CE-A-A1-12');
      }
      return localStore.executor(sql, binds);
    }
    throw err;
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
app.use(helmet({ contentSecurityPolicy: { directives: { 'frame-src': ["'self'", 'blob:'], 'object-src': ["'none'"] } } }));
app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
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

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'StudyFlow API', timestamp: new Date().toISOString() });
});

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
app.use('/uploads', authenticateJWT, async (req, res, next) => {
  try {
    const result = await queryExecutor('SELECT sm.*, c.teacher_id, c.academic_year, c.branch, c.division, cb.batch_name AS target_batch FROM study_materials sm JOIN classes c ON c.id = sm.class_id LEFT JOIN class_batches cb ON cb.id = sm.batch_target_id WHERE sm.file_url = :file_url', { file_url: '/uploads' + req.path });
    const item = (result.rows || []).find(r => r.FILE_URL === '/uploads' + req.path);
    const eq = (a,b) => String(a).toUpperCase() === String(b).toUpperCase();
    const allowed = item && (req.user.role === 'teacher' ? Number(item.TEACHER_ID) === Number(req.user.id) : req.user.role === 'student' && eq(item.ACADEMIC_YEAR,req.user.academic_year) && eq(item.BRANCH,req.user.branch) && eq(item.DIVISION,req.user.division) && (!item.TARGET_BATCH || eq(item.TARGET_BATCH,req.user.batch)));
    if (!allowed) return res.status(404).json({ success: false, error: 'File not found.' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  } catch (err) { next(err); }
}, express.static(UPLOADS_DIR, { dotfiles: 'deny', index: false, fallthrough: false }));

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
async function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Authorization token required.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (decoded.role === 'student') {
      const student = (await queryExecutor('SELECT * FROM students WHERE id = :id', [Number(decoded.id)])).rows?.[0];
      if (!student || !student.PASSWORD_HASH || decoded.credential_version !== crypto.createHash('sha256').update(student.PASSWORD_HASH).digest('hex')) return res.status(401).json({ error: 'Your account changed. Please sign in again.' });
      Object.assign(decoded, { academic_year: student.ACADEMIC_YEAR, branch: student.BRANCH, division: student.DIVISION, batch: student.BATCH });
    }
    if (decoded.role === 'teacher') {
      const access = (await queryExecutor('SELECT * FROM app_records')).rows || [];
      const version = access.find(r => r.KIND === 'password_version' && Number(r.OWNER_ID) === Number(decoded.id));
      if (version && JSON.parse(version.PAYLOAD).version !== decoded.credential_version) return res.status(401).json({error:'Your password changed. Please sign in again.'});
      if (access.some(r => r.KIND === 'faculty_access' && Number(r.OWNER_ID) === Number(decoded.id) && JSON.parse(r.PAYLOAD).disabled)) return res.status(403).json({error:'Your faculty access has been disabled. Contact an administrator.'});
    }
    req.user = decoded;
    next();
  } catch (err) {
    if (!['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(err.name)) return next(err);
    return res.status(401).json({ success: false, error: 'Invalid or expired token.' });
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
    if (process.env.NODE_ENV === 'production' && (!process.env.FACULTY_INVITE_CODE || req.body.invite_code !== process.env.FACULTY_INVITE_CODE)) return res.status(403).json({ error: 'A faculty invitation is required. Contact your college administrator.' });
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
        credential_version: crypto.createHash('sha256').update(teacher.PASSWORD_HASH).digest('hex'),
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
    const { access_code, password, new_password, email } = req.body;
    const byEmail = typeof email === 'string' && email.trim();
    if (!byEmail && (typeof access_code !== 'string' || !access_code.trim())) return res.status(400).json({error:'Enter your email or existing student code.'});
    if (!byEmail && !parseAccessCode(access_code)) return res.status(400).json({error:'Invalid access code format. Enter your email or existing student code.'});
    const cleanCode = typeof access_code === 'string' ? access_code.trim().toUpperCase() : '';
    const sql = byEmail ? 'SELECT * FROM students WHERE LOWER(email) = :email' : 'SELECT * FROM students WHERE UPPER(access_code) = :code';
    const result = await queryExecutor(sql, [byEmail ? email.trim().toLowerCase() : cleanCode]);

    if (!result.rows || result.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'No student found with this access code.' });
    }

    const student = result.rows[0];
    if (typeof password !== 'string' || password.length > 72 || !student.PASSWORD_HASH || !await bcrypt.compare(password, student.PASSWORD_HASH)) {
      return res.status(401).json({ success: false, error: 'Invalid student code or password. Ask your teacher for an invitation if this is your first visit.' });
    }
    if (Number(student.IS_FIRST_LOGIN) === 1) {
      if (!new_password) return res.json({ requires_password_change: true });
      if (typeof new_password !== 'string' || new_password.length < 10 || Buffer.byteLength(new_password) > 72 || new_password === password) return res.status(400).json({ error: 'Choose a different password with 10–72 bytes.' });
      const hash = await bcrypt.hash(new_password, 12);
      const changed = await queryExecutor('UPDATE students SET password_hash = :password_hash, is_first_login = :is_first_login WHERE id = :id AND password_hash = :previous_hash AND is_first_login = 1', { password_hash: hash, is_first_login: 0, id: student.ID, previous_hash: student.PASSWORD_HASH });
      if (changed.rowsAffected !== 1) return res.status(409).json({ error: 'This invitation was already used. Sign in with your new password.' });
      student.PASSWORD_HASH = hash;
    }

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
        role: 'student',
        credential_version: crypto.createHash('sha256').update(student.PASSWORD_HASH).digest('hex')
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
        access_code: student.ACCESS_CODE, email: student.EMAIL
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

    const registrationCode = 'STU-' + crypto.randomBytes(12).toString('hex').toUpperCase();
    const insertSql = `
      INSERT INTO students (name, academic_year, branch, division, batch, roll_number, access_code, password_hash, is_first_login, registration_code)
      VALUES (:name, :academic_year, :branch, :division, :batch, :roll_number, :access_code, :password_hash, 1, :registration_code)
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
      password_hash: null, registration_code: registrationCode,
      out_id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
    });

    return res.status(201).json({
      success: true,
      message: 'Share the private registration code. The student creates an account with their own email and password.',
      student: {
        id: result.outBinds.out_id[0],
        name,
        academic_year: academicYear,
        branch,
        division: division.toUpperCase(),
        batch: batch.toUpperCase(),
        roll_number: rollNumber,
        access_code: accessCode, registration_code: registrationCode
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
        const registrationCode = 'STU-' + crypto.randomBytes(12).toString('hex').toUpperCase();
    const insertSql = `
          INSERT INTO students (name, academic_year, branch, division, batch, roll_number, access_code, password_hash, is_first_login, registration_code)
          VALUES (:name, :academic_year, :branch, :division, :batch, :roll_number, :access_code, :password_hash, 1, :registration_code)
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
      password_hash: null, registration_code: registrationCode,
          out_id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
        });
        created.push({
          id: result.outBinds.out_id[0],
          name,
          access_code: accessCode, registration_code: registrationCode
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
      SELECT id, name, academic_year, branch, division, batch, roll_number, access_code, created_at, is_first_login, email, registration_code
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

// PUT /api/students/:id - update an existing student's details and recalculate access code
app.put('/api/students/:id', authenticateJWT, async (req, res) => {
  try {
    if (!requireTeacher(req, res)) return;

    const studentId = Number(req.params.id);
    if (!studentId) {
      return res.status(400).json({ success: false, error: 'Invalid student ID.' });
    }

    const checkRes = await queryExecutor('SELECT * FROM students WHERE id = :id', [studentId]);
    if (!checkRes.rows || checkRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Student not found.' });
    }
    const current = checkRes.rows[0];

    const name = isNonEmpty(req.body.name, 120) || current.NAME || current.name;
    const academicYear = cleanStr(req.body.academic_year || current.ACADEMIC_YEAR || current.academic_year, 10).toUpperCase();
    let branch = cleanStr(req.body.branch || current.BRANCH || current.branch, 30).toUpperCase();
    const division = isNonEmpty(req.body.division, 5) || current.DIVISION || current.division;
    const batch = isNonEmpty(req.body.batch, 10) || current.BATCH || current.batch;
    const rollNumber = isNonEmpty(req.body.roll_number, 30) || current.ROLL_NUMBER || current.roll_number;

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

    const updateSql = `
      UPDATE students
      SET name = :name,
          academic_year = :academic_year,
          branch = :branch,
          division = :division,
          batch = :batch,
          roll_number = :roll_number,
          access_code = :access_code
      WHERE id = :id
    `;
    await queryExecutor(updateSql, {
      id: studentId,
      name,
      academic_year: academicYear,
      branch,
      division: division.toUpperCase(),
      batch: batch.toUpperCase(),
      roll_number: rollNumber,
      access_code: accessCode
    });

    return res.json({
      success: true,
      message: 'Student updated successfully.',
      student: {
        id: studentId,
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
      return res.status(409).json({ success: false, error: 'Duplicate access code conflict.' });
    }
    console.error('Update student error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update student.' });
  }
});

// DELETE /api/students/:id - remove a student and their attendance records
app.delete('/api/students/:id', authenticateJWT, async (req, res) => {
  try {
    if (!requireTeacher(req, res)) return;

    const studentId = Number(req.params.id);
    if (!studentId) {
      return res.status(400).json({ success: false, error: 'Invalid student ID.' });
    }

    const checkRes = await queryExecutor('SELECT id FROM students WHERE id = :id', [studentId]);
    if (!checkRes.rows || checkRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Student not found.' });
    }

    // Clean up attendance first
    await queryExecutor('DELETE FROM attendance WHERE student_id = :id', [studentId]);
    await queryExecutor('DELETE FROM students WHERE id = :id', [studentId]);

    return res.json({ success: true, message: 'Student and attendance records deleted successfully.' });
  } catch (error) {
    console.error('Delete student error:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete student.' });
  }
});

// POST /api/students/:id/regenerate-code - re-issue or refresh access code
app.post('/api/students/:id/regenerate-code', authenticateJWT, async (req, res) => {
  try {
    if (!requireTeacher(req, res)) return;

    const studentId = Number(req.params.id);
    const checkRes = await queryExecutor('SELECT * FROM students WHERE id = :id', [studentId]);
    if (!checkRes.rows || checkRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Student not found.' });
    }
    const student = checkRes.rows[0];

    const accessCode = generateAccessCode({
      academic_year: student.ACADEMIC_YEAR || student.academic_year,
      branch: student.BRANCH || student.branch,
      division: student.DIVISION || student.division,
      batch: student.BATCH || student.batch,
      roll_number: student.ROLL_NUMBER || student.roll_number
    });

    await queryExecutor('UPDATE students SET access_code = :access_code WHERE id = :id', {
      id: studentId,
      access_code: accessCode
    });

    return res.json({
      success: true,
      message: 'Access code regenerated successfully.',
      access_code: accessCode
    });
  } catch (error) {
    console.error('Regenerate code error:', error);
    return res.status(500).json({ success: false, error: 'Failed to regenerate access code.' });
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

// PUT /api/classes/:id - update a class's subject name or batches (owning teacher only)
app.put('/api/classes/:id', authenticateJWT, async (req, res) => {
  try {
    if (!requireTeacher(req, res)) return;

    const classId = Number(req.params.id);
    const checkRes = await queryExecutor('SELECT * FROM classes WHERE id = :id', [classId]);
    if (!checkRes.rows || checkRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Class not found.' });
    }
    const cls = checkRes.rows[0];
    if (Number(cls.TEACHER_ID) !== Number(req.user.id)) {
      return res.status(403).json({ success: false, error: 'You can only update your own classes.' });
    }

    const subjectName = isNonEmpty(req.body.subject_name, 120);
    if (!subjectName) {
      return res.status(400).json({ success: false, error: 'subject_name is required.' });
    }

    await queryExecutor('UPDATE classes SET subject_name = :subject_name WHERE id = :id', {
      id: classId,
      subject_name: subjectName
    });

    // If new batch names supplied for a Lab, append any that don't already exist
    const isLab = (cls.CLASS_TYPE || cls.class_type) === 'Lab/Practical';
    if (isLab && Array.isArray(req.body.batch_names)) {
      const existingBatchesRes = await queryExecutor('SELECT batch_name FROM class_batches WHERE class_id = :id', [classId]);
      const existingNames = new Set((existingBatchesRes.rows || []).map(b => (b.BATCH_NAME || b.batch_name).toUpperCase()));

      const insertBatchSql = `
        INSERT INTO class_batches (class_id, batch_name)
        VALUES (:class_id, :batch_name)
      `;
      for (const b of req.body.batch_names) {
        const cleanB = String(b).trim().toUpperCase();
        if (cleanB && !existingNames.has(cleanB)) {
          await queryExecutor(insertBatchSql, { class_id: classId, batch_name: cleanB });
          existingNames.add(cleanB);
        }
      }
    }

    return res.json({ success: true, message: 'Class updated successfully.' });
  } catch (error) {
    console.error('Update class error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update class.' });
  }
});

// DELETE /api/classes/:id - delete class and clean up its batches, attendance, and materials
app.delete('/api/classes/:id', authenticateJWT, async (req, res) => {
  try {
    if (!requireTeacher(req, res)) return;

    const classId = Number(req.params.id);
    const checkRes = await queryExecutor('SELECT * FROM classes WHERE id = :id', [classId]);
    if (!checkRes.rows || checkRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Class not found.' });
    }
    const cls = checkRes.rows[0];
    if (Number(cls.TEACHER_ID) !== Number(req.user.id)) {
      return res.status(403).json({ success: false, error: 'You can only delete your own classes.' });
    }

    // Clean up associated records
    await queryExecutor('DELETE FROM attendance WHERE class_id = :id', [classId]);
    await queryExecutor('DELETE FROM study_materials WHERE class_id = :id', [classId]);
    await queryExecutor('DELETE FROM class_batches WHERE class_id = :id', [classId]);
    await queryExecutor('DELETE FROM classes WHERE id = :id', [classId]);

    return res.json({ success: true, message: 'Class deleted successfully.' });
  } catch (error) {
    console.error('Delete class error:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete class.' });
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

// GET /api/attendance/history - get past attendance logs for a teacher's class
app.get('/api/attendance/history', authenticateJWT, async (req, res) => {
  try {
    if (!requireTeacher(req, res)) return;

    const classId = Number(req.query.class_id);
    if (!classId) {
      return res.status(400).json({ success: false, error: 'class_id query parameter is required.' });
    }

    // Verify ownership
    const classRes = await queryExecutor('SELECT teacher_id, subject_name FROM classes WHERE id = :id', [classId]);
    if (!classRes.rows || classRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Class not found.' });
    }
    if (Number(classRes.rows[0].TEACHER_ID) !== Number(req.user.id)) {
      return res.status(403).json({ success: false, error: 'Access denied to this class.' });
    }

    const sql = `
      SELECT
        TO_CHAR(attendance_date, 'YYYY-MM-DD') AS att_date,
        COUNT(*) AS total_marked,
        SUM(CASE WHEN LOWER(status) = 'present' THEN 1 ELSE 0 END) AS present_count,
        SUM(CASE WHEN LOWER(status) = 'absent' THEN 1 ELSE 0 END) AS absent_count
      FROM attendance
      WHERE class_id = :class_id
      GROUP BY attendance_date
      ORDER BY attendance_date DESC
    `;
    const result = await queryExecutor(sql, [classId]);
    return res.json({ success: true, history: result.rows || [] });
  } catch (error) {
    console.error('Attendance history error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch attendance history.' });
  }
});

// GET /api/attendance/export - export attendance report for a class as CSV-friendly records
app.get('/api/attendance/export', authenticateJWT, async (req, res) => {
  try {
    if (!requireTeacher(req, res)) return;

    const classId = Number(req.query.class_id);
    if (!classId) {
      return res.status(400).json({ success: false, error: 'class_id is required.' });
    }

    const classRes = await queryExecutor('SELECT * FROM classes WHERE id = :id', [classId]);
    if (!classRes.rows || classRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Class not found.' });
    }
    if (Number(classRes.rows[0].TEACHER_ID) !== Number(req.user.id)) {
      return res.status(403).json({ success: false, error: 'Access denied.' });
    }

    const sql = `
      SELECT
        s.roll_number,
        s.name,
        s.division,
        s.batch,
        s.access_code,
        TO_CHAR(a.attendance_date, 'YYYY-MM-DD') AS att_date,
        a.status
      FROM attendance a
      JOIN students s ON a.student_id = s.id
      WHERE a.class_id = :class_id
      ORDER BY TO_NUMBER(REGEXP_SUBSTR(s.roll_number, '^[0-9]+')) NULLS LAST, s.roll_number ASC, a.attendance_date ASC
    `;
    const result = await queryExecutor(sql, [classId]);
    return res.json({ success: true, class: classRes.rows[0], records: result.rows || [] });
  } catch (error) {
    console.error('Attendance export error:', error);
    return res.status(500).json({ success: false, error: 'Failed to export attendance.' });
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
      WHERE UPPER(c.academic_year) = UPPER(:academic_year)
        AND UPPER(c.branch) = UPPER(:branch)
        AND UPPER(c.division) = UPPER(:division)
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

    const termConfig = (await require('./app_records').records((...args)=>queryExecutor(...args)).all()).find(r=>r.kind==='config');
    if (termConfig?.term_started_at) {
      const {scope}=require('./app_records');
      const classes=(await queryExecutor('SELECT * FROM classes')).rows.filter(c=>scope(c)===scope(req.user));
      const ids=new Set(classes.map(c=>Number(c.ID)));
      const rows=(await queryExecutor('SELECT * FROM attendance WHERE student_id = :student_id',[Number(studentId)])).rows.filter(a=>ids.has(Number(a.CLASS_ID))&&new Date(a.ATTENDANCE_DATE)>=new Date(termConfig.term_started_at.slice(0,10)));
      const summarize=list=>{const total=list.length,present=list.filter(a=>String(a.STATUS).toLowerCase()==='present').length;return {total,present,absent:total-present,percentage:total?Math.round(100*present/total):null};};
      return res.json({success:true,stats:summarize(rows),subjects:classes.map(c=>({class_id:c.ID,subject_name:c.SUBJECT_NAME,class_type:c.CLASS_TYPE,...summarize(rows.filter(a=>Number(a.CLASS_ID)===Number(c.ID)))}))});
    }

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

    // Also fetch per-subject breakdown for this student
    const subjectsSql = `
      SELECT
        c.id AS class_id,
        c.subject_name,
        c.class_type,
        COUNT(a.id) AS total_sessions,
        SUM(CASE WHEN LOWER(a.status) = 'present' THEN 1 ELSE 0 END) AS present_sessions,
        SUM(CASE WHEN LOWER(a.status) = 'absent' THEN 1 ELSE 0 END) AS absent_sessions
      FROM attendance a
      JOIN classes c ON a.class_id = c.id
      WHERE a.student_id = :student_id
      GROUP BY c.id, c.subject_name, c.class_type
      ORDER BY c.subject_name ASC
    `;
    const subjectsRes = await queryExecutor(subjectsSql, [Number(studentId)]);
    const subjectsList = (subjectsRes.rows || []).map(r => {
      const tot = Number(r.TOTAL_SESSIONS || r.total_sessions || 0);
      const pr = Number(r.PRESENT_SESSIONS || r.present_sessions || 0);
      const ab = Number(r.ABSENT_SESSIONS || r.absent_sessions || 0);
      return {
        class_id: r.CLASS_ID || r.class_id,
        subject_name: r.SUBJECT_NAME || r.subject_name,
        class_type: r.CLASS_TYPE || r.class_type,
        total: tot,
        present: pr,
        absent: ab,
        percentage: tot > 0 ? Math.round((pr / tot) * 100) : null
      };
    });

    return res.json({
      success: true,
      stats: { total, present, absent, percentage },
      subjects: subjectsList
    });
  } catch (error) {
    console.error('Student attendance error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch attendance.' });
  }
});

// ----------------------------------------------------
// 7. Notice Routes
// ----------------------------------------------------

// POST /api/notices - teacher posts a notice targeted to a year/branch/division
// (batch omitted or empty = whole division)
app.post('/api/notices', authenticateJWT, async (req, res) => {
  try {
    if (!requireTeacher(req, res)) return;

    const academicYear = cleanStr(req.body.academic_year, 10).toUpperCase();
    let branch = cleanStr(req.body.branch, 30).toUpperCase() || 'COMMON';
    const division = isNonEmpty(req.body.division, 5);
    const batchRaw = cleanStr(req.body.batch, 10);
    const title = isNonEmpty(req.body.title, 200);
    const body = isNonEmpty(req.body.body, 2000);
    const isPinned = req.body.is_pinned ? 1 : 0;

    if (!division || !title || !body) {
      return res.status(400).json({ success: false, error: 'division, title, and body are required.' });
    }
    if (!ACADEMIC_YEARS.includes(academicYear)) {
      return res.status(400).json({ success: false, error: `academic_year must be one of: ${ACADEMIC_YEARS.join(', ')}.` });
    }
    if (academicYear === 'FE') {
      branch = 'Common';
    }

    const batch = batchRaw ? batchRaw.toUpperCase() : null;

    const insertSql = `
      INSERT INTO notices (teacher_id, academic_year, branch, division, batch, title, body, is_pinned)
      VALUES (:teacher_id, :academic_year, :branch, :division, :batch, :title, :body, :is_pinned)
      RETURNING id INTO :out_id
    `;
    const result = await queryExecutor(insertSql, {
      teacher_id: Number(req.user.id),
      academic_year: academicYear,
      branch,
      division: division.toUpperCase(),
      batch,
      title,
      body,
      is_pinned: isPinned,
      out_id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
    });

    return res.status(201).json({
      success: true,
      message: 'Notice posted.',
      notice: {
        id: result.outBinds.out_id[0],
        academic_year: academicYear,
        branch,
        division: division.toUpperCase(),
        batch,
        title,
        body,
        is_pinned: isPinned
      }
    });
  } catch (error) {
    console.error('Notice creation error:', error);
    return res.status(500).json({ success: false, error: 'Failed to post notice.' });
  }
});

// GET /api/notices/teacher - the logged-in teacher's own notices, pinned first
app.get('/api/notices/teacher', authenticateJWT, async (req, res) => {
  try {
    if (!requireTeacher(req, res)) return;

    const sql = `
      SELECT id, academic_year, branch, division, batch, title, body, is_pinned, created_at
      FROM notices
      WHERE teacher_id = :teacher_id
      ORDER BY is_pinned DESC, created_at DESC
    `;
    const result = await queryExecutor(sql, [Number(req.user.id)]);
    return res.json({ success: true, count: result.rows ? result.rows.length : 0, notices: result.rows || [] });
  } catch (error) {
    console.error('Fetch teacher notices error:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve notices.' });
  }
});

// DELETE /api/notices/:id - own notices only
app.delete('/api/notices/:id', authenticateJWT, async (req, res) => {
  try {
    if (!requireTeacher(req, res)) return;

    const noticeId = Number(req.params.id);
    const lookup = await queryExecutor('SELECT teacher_id FROM notices WHERE id = :id', [noticeId]);
    if (!lookup.rows || lookup.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Notice not found.' });
    }
    if (Number(lookup.rows[0].TEACHER_ID) !== Number(req.user.id)) {
      return res.status(403).json({ success: false, error: 'You can only delete your own notices.' });
    }

    await queryExecutor('DELETE FROM notices WHERE id = :id', [noticeId]);
    return res.json({ success: true, message: 'Notice deleted.' });
  } catch (error) {
    console.error('Notice delete error:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete notice.' });
  }
});

// GET /api/notices/student - notices scoped to the student's JWT credentials
app.get('/api/notices/student', authenticateJWT, async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ success: false, error: 'Student access required.' });
    }

    const { academic_year, branch, division, batch } = req.user;

    const sql = `
      SELECT
        n.id, n.title, n.body, n.is_pinned, n.academic_year, n.branch,
        n.division, n.batch, n.created_at,
        t.name AS teacher_name
      FROM notices n
      JOIN teachers t ON n.teacher_id = t.id
      WHERE UPPER(n.academic_year) = UPPER(:academic_year)
        AND UPPER(n.branch) = UPPER(:branch)
        AND UPPER(n.division) = UPPER(:division)
        AND (n.batch IS NULL OR UPPER(n.batch) = UPPER(:batch))
      ORDER BY n.is_pinned DESC, n.created_at DESC
    `;

    const result = await queryExecutor(sql, {
      academic_year: String(academic_year),
      branch: String(branch),
      division: String(division),
      batch: String(batch)
    });

    return res.json({
      success: true,
      count: result.rows ? result.rows.length : 0,
      notices: result.rows || []
    });
  } catch (error) {
    console.error('Student fetch notices error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load notices.' });
  }
});

require('./student_registration')({ app, query: (...args) => queryExecutor(...args) });
require('./password_routes')({ app, authenticateJWT, query: (...args) => queryExecutor(...args) });
require('./campus_routes')({ app, authenticateJWT, query: (...args) => queryExecutor(...args) });
require('./discussion_routes')({ app, authenticateJWT, query: (...args) => queryExecutor(...args) });
require('./file_routes')({ app, authenticateJWT, query: (...args) => queryExecutor(...args) });
require('./learning_routes')({ app, authenticateJWT, query: (...args) => queryExecutor(...args) });
require('./admin_routes')({ app, authenticateJWT, query: (...args) => queryExecutor(...args) });
const notifications = require('./notification_routes')({ app, authenticateJWT, query: (...args) => queryExecutor(...args) });

// ----------------------------------------------------
// Optional: serve the built React SPA (production mode)
// ----------------------------------------------------
if (process.env.SERVE_FRONTEND === '1') {
  const distDir = path.join(__dirname, 'react-frontend', 'dist');
  if (!fs.existsSync(distDir)) {
    console.error(`SERVE_FRONTEND=1 but ${distDir} does not exist. Run "npm run build:frontend" first.`);
    process.exit(1);
  }
  app.get('/.well-known/assetlinks.json', (req, res) => {
    res.type('application/json').sendFile(path.join(distDir, '.well-known', 'assetlinks.json'), { dotfiles: 'allow' });
  });
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
  if (err?.status === 400) return res.status(400).json({ error: err.message });
  console.error('Unhandled error:', err);
  return res.status(500).json({ success: false, error: 'Internal server error.' });
});

module.exports = { app, setQueryExecutor, resetQueryExecutor, start };

async function start(port = PORT) {
  if (process.env.NODE_ENV === 'production') {
    await initOraclePool();
    try {
      await executeQuery('SELECT id FROM campus_items WHERE 1 = 0');
      await executeQuery('SELECT id FROM discussion_items WHERE 1 = 0');
      await executeQuery('SELECT id FROM app_records WHERE 1 = 0');
    }
    catch (error) {
      await oraclePool.close(0);
      oraclePool = null;
      throw new Error('Campus schema is unavailable. Apply migrations/2026_campus.sql and migrations/2026_discussions.sql and migrations/2026_learning.sql before starting this release. ' + error.message);
    }
  }
  const server = app.listen(port, () => {
    console.log(`StudyFlow Backend Server listening on http://localhost:${port}`);
  });
  if (notifications.configured()) {
    let running = false;
    const timer = setInterval(async () => { if(running)return;running=true;try{await notifications.tick();}catch{console.warn('Notification worker could not complete this check.');}finally{running=false;} }, 60000);
    timer.unref();server.on('close',()=>clearInterval(timer));
  }
  return server;
}

if (require.main === module) {
  start().catch(error => { console.error('Startup failed:', error.message); process.exitCode = 1; });
}


