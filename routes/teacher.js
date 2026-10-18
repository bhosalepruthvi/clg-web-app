/**
 * routes/teacher.js
 * Teacher API endpoints for managing dashboard, students, materials, attendance, and notices.
 * Protected by requireTeacher middleware.
 *
 * Inputs are validated and length-capped before they reach the database, uploads are
 * restricted by extension and MIME type, and every mutation is scoped to the
 * authenticated teacher so one teacher cannot touch another's records.
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { parse } = require('json2csv');
const { getDb } = require('../database');
const { requireTeacher } = require('../middleware/auth');
const security = require('../middleware/security-config');
const { createLimiters } = require('../middleware/rate-limiters');
const {
  logSecurityEvent,
  isSafeExternalUrl,
  cleanText
} = require('../middleware/security-events');

const limiters = createLimiters(security.rateLimits);
const uploadPolicy = security.upload;

// Uploaded files live here. UPLOADS_DIR lets a test run (or a deployment with a
// separate data volume) point somewhere else without touching the code.
const UPLOADS_ROOT = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(__dirname, '..', 'uploads');

// Apply teacher authentication to all routes in this file
router.use(requireTeacher);

/**
 * Strips anything that is not alphanumeric, underscore or hyphen.
 * Used for path segments built from user input, so a crafted subject or year can
 * never introduce "../" or a drive letter into the upload path.
 */
function sanitizePathSegment(value, fallback = 'general') {
  const cleaned = String(value === undefined || value === null ? '' : value)
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 60);
  return cleaned || fallback;
}

/** True when the extension is on the allow-list. */
function hasAllowedExtension(originalName) {
  const ext = path.extname(String(originalName || '')).toLowerCase();
  return Boolean(ext) && uploadPolicy.allowedExtensions.has(ext);
}

/** True when the browser-reported MIME type is plausible for this portal. */
function hasAllowedMimeType(mimetype) {
  return uploadPolicy.allowedMimeTypes.has(String(mimetype || '').toLowerCase());
}

// Configure Multer storage to organize files into uploads/{year}/{subject}/
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const year = sanitizePathSegment(req.body.year, 'general');
    const subject = sanitizePathSegment(req.body.subject, 'general');
    const uploadDir = path.join(UPLOADS_ROOT, year, subject);

    try {
      fs.mkdirSync(uploadDir, { recursive: true });
    } catch (err) {
      return cb(err);
    }
    return cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Keep only the extension from the client-supplied name; the stem is generated.
    // This removes any chance of traversal, control characters or double extensions.
    const ext = path.extname(String(file.originalname || '')).toLowerCase().slice(0, 10);
    const uniqueSuffix = Date.now() + '-' + require('crypto').randomBytes(6).toString('hex');
    return cb(null, `material-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: uploadPolicy.maxFileSizeBytes,
    files: 1 // one file per upload
  },
  fileFilter: function (req, file, cb) {
    // Reject on both extension and MIME type. Either signal alone is spoofable.
    if (!hasAllowedExtension(file.originalname)) {
      logSecurityEvent('upload_rejected', req, {
        reason: 'extension_not_allowed',
        extension: path.extname(String(file.originalname || '')).toLowerCase()
      });
      return cb(new UploadValidationError('That file type is not allowed. Upload a document, image, or zip archive.'));
    }
    if (!hasAllowedMimeType(file.mimetype)) {
      logSecurityEvent('upload_rejected', req, {
        reason: 'mime_not_allowed',
        mimetype: String(file.mimetype || '')
      });
      return cb(new UploadValidationError('That file type is not allowed. Upload a document, image, or zip archive.'));
    }
    return cb(null, true);
  }
});

/** Distinguishes a validation rejection (400) from a server fault (500). */
class UploadValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UploadValidationError';
    this.expected = true;
  }
}

/**
 * Helper to get Year Code from Year number (1->FE, 2->SE, 3->TE, 4->BE)
 */
function getYearCode(year) {
  const y = parseInt(year, 10);
  switch (y) {
    case 1:
      return 'FE';
    case 2:
      return 'SE';
    case 3:
      return 'TE';
    case 4:
      return 'BE';
    default:
      return `Y${y || 1}`;
  }
}

/** Parses an id from the URL and rejects anything that is not a positive integer. */
function parseId(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/* ------------------------------------------------------------------ *
 * Dashboard
 * ------------------------------------------------------------------ */
router.get('/dashboard', (req, res) => {
  try {
    const teacherId = req.session.user.id;
    const db = getDb();

    const studentCountRow = db
      .prepare('SELECT COUNT(*) as count FROM students WHERE teacher_id = ?')
      .get(teacherId);
    const totalStudents = studentCountRow ? studentCountRow.count : 0;

    const materialCountRow = db
      .prepare('SELECT COUNT(*) as count FROM materials WHERE teacher_id = ?')
      .get(teacherId);
    const totalMaterials = materialCountRow ? materialCountRow.count : 0;

    const noticeCountRow = db
      .prepare('SELECT COUNT(*) as count FROM notices WHERE teacher_id = ?')
      .get(teacherId);
    const totalNotices = noticeCountRow ? noticeCountRow.count : 0;

    const recentMaterials = db
      .prepare(
        `SELECT id, title, subject, year, semester, uploaded_at as date, 'material' as type
         FROM materials WHERE teacher_id = ?
         ORDER BY uploaded_at DESC LIMIT 5`
      )
      .all(teacherId);

    const recentNotices = db
      .prepare(
        `SELECT id, title, subject, year, division, created_at as date, 'notice' as type
         FROM notices WHERE teacher_id = ?
         ORDER BY created_at DESC LIMIT 5`
      )
      .all(teacherId);

    const combinedActivity = [...recentMaterials, ...recentNotices]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 5);

    return res.json({
      success: true,
      totalStudents,
      totalMaterials,
      totalNotices,
      recentActivity: combinedActivity
    });
  } catch (error) {
    console.error('Error fetching teacher dashboard data:', error);
    return res.status(500).json({ success: false, error: 'Failed to load dashboard metrics.' });
  }
});

/* ------------------------------------------------------------------ *
 * Students
 * ------------------------------------------------------------------ */

// POST /api/teacher/students - add a student and generate their login code
router.post('/students', (req, res) => {
  try {
    const teacherId = req.session.user.id;
    const { name, rollNumber, year, semester, division } = req.body;

    if (!name || !rollNumber || !year || !semester || !division) {
      return res.status(400).json({
        success: false,
        error: 'Name, roll number, year, semester, and division are all required.'
      });
    }

    const cleanName = cleanText(name, 120);
    const cleanRoll = cleanText(rollNumber, 30).toUpperCase();
    const cleanDiv = cleanText(division, 5).toUpperCase();
    const parsedYear = Number.parseInt(year, 10);
    const parsedSem = Number.parseInt(semester, 10);

    if (!cleanName || !cleanRoll) {
      return res.status(400).json({ success: false, error: 'Name and roll number are required.' });
    }
    if (isNaN(parsedYear) || parsedYear < 1 || parsedYear > 4) {
      return res.status(400).json({ success: false, error: 'Year must be between 1 and 4.' });
    }
    if (isNaN(parsedSem) || parsedSem < 1 || parsedSem > 8) {
      return res.status(400).json({ success: false, error: 'Semester must be between 1 and 8.' });
    }
    if (!/^[A-Z0-9-]{1,30}$/.test(cleanRoll)) {
      return res.status(400).json({
        success: false,
        error: 'Roll number may only contain letters, numbers, and hyphens.'
      });
    }
    if (!/^[A-E]$/.test(cleanDiv)) {
      return res.status(400).json({ success: false, error: 'Division must be a letter from A to E.' });
    }

    const yearCode = getYearCode(parsedYear);
    const db = getDb();

    // Generate unique login code: {yearCode}-{division}-{rollNumber}
    let loginCode = `${yearCode}-${cleanDiv}-${cleanRoll}`;
    let counter = 1;
    while (db.prepare('SELECT id FROM students WHERE login_code = ?').get(loginCode)) {
      loginCode = `${yearCode}-${cleanDiv}-${cleanRoll}-${counter}`;
      counter++;
      if (counter > 500) {
        return res.status(409).json({
          success: false,
          error: 'Could not generate a unique login code for this roll number.'
        });
      }
    }

    const insertStmt = db.prepare(
      `INSERT INTO students (name, roll_number, login_code, year, semester, division, teacher_id, is_first_login)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
    );

    const result = insertStmt.run(
      cleanName,
      cleanRoll,
      loginCode,
      parsedYear,
      parsedSem,
      cleanDiv,
      teacherId
    );

    logSecurityEvent('student_added', req, { studentId: result.lastInsertRowid, teacherId });

    const createdStudent = {
      id: result.lastInsertRowid,
      name: cleanName,
      roll_number: cleanRoll,
      login_code: loginCode,
      year: parsedYear,
      semester: parsedSem,
      division: cleanDiv,
      teacher_id: teacherId,
      is_first_login: 1
    };

    return res.status(201).json({
      success: true,
      message: 'Student added successfully.',
      student: createdStudent
    });
  } catch (error) {
    console.error('Error adding student:', error);
    return res.status(500).json({ success: false, error: 'Failed to add student.' });
  }
});

// GET /api/teacher/students
router.get('/students', (req, res) => {
  try {
    const teacherId = req.session.user.id;
    const { year, division } = req.query;
    const db = getDb();

    let query = `
      SELECT id, name, roll_number, login_code, year, semester, division, is_first_login, created_at
      FROM students
      WHERE teacher_id = ?
    `;
    const params = [teacherId];

    if (year) {
      const parsedYear = Number.parseInt(year, 10);
      if (!Number.isInteger(parsedYear) || parsedYear < 1 || parsedYear > 4) {
        return res.status(400).json({ success: false, error: 'Invalid year filter.' });
      }
      query += ' AND year = ?';
      params.push(parsedYear);
    }
    if (division) {
      const cleanDiv = cleanText(division, 5).toUpperCase();
      if (!/^[A-E]$/.test(cleanDiv)) {
        return res.status(400).json({ success: false, error: 'Invalid division filter.' });
      }
      query += ' AND UPPER(division) = ?';
      params.push(cleanDiv);
    }

    query += ' ORDER BY year ASC, division ASC, roll_number ASC';

    const students = db.prepare(query).all(...params);

    return res.json({ success: true, students });
  } catch (error) {
    console.error('Error fetching students:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve students list.' });
  }
});

// DELETE /api/teacher/students/:id
router.delete('/students/:id', (req, res) => {
  try {
    const teacherId = req.session.user.id;
    const studentId = parseId(req.params.id);
    if (!studentId) {
      return res.status(400).json({ success: false, error: 'Invalid student id.' });
    }

    const db = getDb();
    const student = db
      .prepare('SELECT id FROM students WHERE id = ? AND teacher_id = ?')
      .get(studentId, teacherId);

    if (!student) {
      return res.status(404).json({
        success: false,
        error: 'Student not found or unauthorized to delete.'
      });
    }

    db.prepare('DELETE FROM students WHERE id = ?').run(studentId);

    logSecurityEvent('student_deleted', req, { studentId, teacherId });

    return res.json({ success: true, message: 'Student deleted successfully.' });
  } catch (error) {
    console.error('Error deleting student:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete student.' });
  }
});

// POST /api/teacher/students/:id/regenerate-code
router.post('/students/:id/regenerate-code', (req, res) => {
  try {
    const teacherId = req.session.user.id;
    const studentId = parseId(req.params.id);
    if (!studentId) {
      return res.status(400).json({ success: false, error: 'Invalid student id.' });
    }

    const db = getDb();
    const student = db
      .prepare('SELECT * FROM students WHERE id = ? AND teacher_id = ?')
      .get(studentId, teacherId);

    if (!student) {
      return res.status(404).json({ success: false, error: 'Student not found or unauthorized.' });
    }

    const yearCode = getYearCode(student.year);
    const baseCode = `${yearCode}-${student.division}-${student.roll_number}`;
    const randomSuffix = Math.floor(100 + Math.random() * 900);
    const newCode = `${baseCode}-${randomSuffix}`;

    db.prepare(
      `UPDATE students SET login_code = ?, password_hash = NULL, is_first_login = 1 WHERE id = ?`
    ).run(newCode, studentId);

    logSecurityEvent('student_code_regenerated', req, { studentId, teacherId });

    return res.json({
      success: true,
      message: 'Login code regenerated successfully.',
      login_code: newCode,
      student: { ...student, login_code: newCode, is_first_login: 1 }
    });
  } catch (error) {
    console.error('Error regenerating login code:', error);
    return res.status(500).json({ success: false, error: 'Failed to regenerate login code.' });
  }
});

/* ------------------------------------------------------------------ *
 * Materials
 * ------------------------------------------------------------------ */

// POST /api/teacher/materials/upload
router.post('/materials/upload', limiters.upload, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      // Clean up nothing here: multer has not persisted a file when fileFilter rejects.
      if (err instanceof UploadValidationError || err.expected) {
        return res.status(400).json({ success: false, error: err.message });
      }
      return next(err); // size limit etc. handled centrally in server.js
    }
    return next();
  });
}, (req, res) => {
  try {
    const teacherId = req.session.user.id;
    const { title, description, year, semester, subject, unit, linkUrl } = req.body;

    /** Removes a file multer already wrote when the request turns out to be invalid. */
    const discardUpload = () => {
      if (req.file && req.file.path) {
        try {
          if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        } catch (e) {
          /* best effort */
        }
      }
    };

    if (!title || !year || !semester || !subject) {
      discardUpload();
      return res.status(400).json({
        success: false,
        error: 'Title, year, semester, and subject are required.'
      });
    }

    const cleanTitle = cleanText(title, 200);
    const cleanSubject = cleanText(subject, 80);
    const cleanUnit = cleanText(unit, 80);
    const cleanDescription = cleanText(description, 2000);
    const parsedYear = Number.parseInt(year, 10);
    const parsedSem = Number.parseInt(semester, 10);

    if (!cleanTitle || !cleanSubject) {
      discardUpload();
      return res.status(400).json({ success: false, error: 'Title and subject are required.' });
    }
    if (!Number.isInteger(parsedYear) || parsedYear < 1 || parsedYear > 4) {
      discardUpload();
      return res.status(400).json({ success: false, error: 'Year must be between 1 and 4.' });
    }
    if (!Number.isInteger(parsedSem) || parsedSem < 1 || parsedSem > 8) {
      discardUpload();
      return res.status(400).json({ success: false, error: 'Semester must be between 1 and 8.' });
    }

    const trimmedLink = cleanText(linkUrl, 2000);
    if (trimmedLink && !isSafeExternalUrl(trimmedLink, uploadPolicy.allowedLinkProtocols)) {
      discardUpload();
      logSecurityEvent('unsafe_link_rejected', req, { teacherId });
      return res.status(400).json({
        success: false,
        error: 'External links must be a valid http:// or https:// address.'
      });
    }

    if (!req.file && !trimmedLink) {
      return res.status(400).json({
        success: false,
        error: 'Please upload a file or provide an external resource link.'
      });
    }

    const sanitizedSubject = sanitizePathSegment(cleanSubject);

    let filePath = null;
    let fileType = 'link';

    if (req.file) {
      // Build the served path from our own generated filename, never the client's.
      filePath = `/uploads/${parsedYear}/${sanitizedSubject}/${path.basename(req.file.path)}`;
      fileType = path.extname(req.file.filename).replace('.', '').toUpperCase() || 'FILE';
    }

    const db = getDb();
    const insertStmt = db.prepare(
      `INSERT INTO materials (title, description, file_path, file_type, link_url, year, semester, subject, unit, teacher_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const result = insertStmt.run(
      cleanTitle,
      cleanDescription,
      filePath,
      fileType,
      trimmedLink || null,
      parsedYear,
      parsedSem,
      cleanSubject,
      cleanUnit,
      teacherId
    );

    logSecurityEvent('material_uploaded', req, {
      materialId: result.lastInsertRowid,
      teacherId,
      kind: req.file ? 'file' : 'link'
    });

    return res.status(201).json({
      success: true,
      message: 'Material uploaded successfully.',
      material: {
        id: result.lastInsertRowid,
        title: cleanTitle,
        description: cleanDescription,
        file_path: filePath,
        file_type: fileType,
        link_url: trimmedLink || null,
        year: parsedYear,
        semester: parsedSem,
        subject: cleanSubject,
        unit: cleanUnit,
        teacher_id: teacherId,
        uploaded_at: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error uploading material:', error);
    if (req.file && req.file.path) {
      try {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      } catch (e) {
        /* ignore cleanup error */
      }
    }
    return res.status(500).json({ success: false, error: 'Failed to upload material.' });
  }
});

// GET /api/teacher/materials
router.get('/materials', (req, res) => {
  try {
    const teacherId = req.session.user.id;
    const { year, semester, subject } = req.query;
    const db = getDb();

    let query = 'SELECT * FROM materials WHERE teacher_id = ?';
    const params = [teacherId];

    if (year) {
      const v = Number.parseInt(year, 10);
      if (!Number.isInteger(v) || v < 1 || v > 4) {
        return res.status(400).json({ success: false, error: 'Invalid year filter.' });
      }
      query += ' AND year = ?';
      params.push(v);
    }
    if (semester) {
      const v = Number.parseInt(semester, 10);
      if (!Number.isInteger(v) || v < 1 || v > 8) {
        return res.status(400).json({ success: false, error: 'Invalid semester filter.' });
      }
      query += ' AND semester = ?';
      params.push(v);
    }
    if (subject) {
      query += ' AND LOWER(subject) = ?';
      params.push(cleanText(subject, 80).toLowerCase());
    }

    query += ' ORDER BY uploaded_at DESC';

    const materials = db.prepare(query).all(...params);

    return res.json({ success: true, materials });
  } catch (error) {
    console.error('Error fetching teacher materials:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve materials.' });
  }
});

// DELETE /api/teacher/materials/:id
router.delete('/materials/:id', (req, res) => {
  try {
    const teacherId = req.session.user.id;
    const materialId = parseId(req.params.id);
    if (!materialId) {
      return res.status(400).json({ success: false, error: 'Invalid material id.' });
    }

    const db = getDb();
    const material = db
      .prepare('SELECT * FROM materials WHERE id = ? AND teacher_id = ?')
      .get(materialId, teacherId);

    if (!material) {
      return res.status(404).json({
        success: false,
        error: 'Material not found or unauthorized to delete.'
      });
    }

    if (material.file_path) {
      // Resolve inside uploads/ and confirm the result really is inside it before deleting.
      const relativePart = String(material.file_path).replace(/^\/uploads\//, '');
      const diskPath = path.resolve(uploadsRoot(), relativePart);
      const root = path.resolve(uploadsRoot());
      if (diskPath.startsWith(root + path.sep) && fs.existsSync(diskPath)) {
        try {
          fs.unlinkSync(diskPath);
        } catch (fileErr) {
          console.warn('Could not delete physical file:', fileErr.message);
        }
      } else if (!diskPath.startsWith(root + path.sep)) {
        logSecurityEvent('material_path_rejected', req, { materialId, reason: 'outside_uploads' });
      }
    }

    db.prepare('DELETE FROM materials WHERE id = ?').run(materialId);

    logSecurityEvent('material_deleted', req, { materialId, teacherId });

    return res.json({ success: true, message: 'Material deleted successfully.' });
  } catch (error) {
    console.error('Error deleting material:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete material.' });
  }
});

/** Absolute path of the uploads directory. */
function uploadsRoot() {
  return UPLOADS_ROOT;
}

/* ------------------------------------------------------------------ *
 * Attendance
 * ------------------------------------------------------------------ */

// GET /api/teacher/attendance/students
router.get('/attendance/students', (req, res) => {
  try {
    const teacherId = req.session.user.id;
    const { year, division } = req.query;

    if (!year || !division) {
      return res.status(400).json({
        success: false,
        error: 'Both year and division are required query parameters.'
      });
    }

    const parsedYear = Number.parseInt(year, 10);
    const cleanDiv = cleanText(division, 5).toUpperCase();
    if (!Number.isInteger(parsedYear) || parsedYear < 1 || parsedYear > 4) {
      return res.status(400).json({ success: false, error: 'Invalid year.' });
    }
    if (!/^[A-E]$/.test(cleanDiv)) {
      return res.status(400).json({ success: false, error: 'Invalid division.' });
    }

    const db = getDb();
    const students = db
      .prepare(
        `SELECT id, name, roll_number, year, semester, division
         FROM students
         WHERE teacher_id = ? AND year = ? AND UPPER(division) = ?
         ORDER BY roll_number ASC`
      )
      .all(teacherId, parsedYear, cleanDiv);

    return res.json({ success: true, students });
  } catch (error) {
    console.error('Error fetching students for attendance:', error);
    return res.status(500).json({ success: false, error: 'Failed to load student list for attendance.' });
  }
});

// POST /api/teacher/attendance
router.post('/attendance', (req, res) => {
  try {
    const teacherId = req.session.user.id;
    const { date, subject, records } = req.body;

    if (!date || !subject || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Date, subject, and a non-empty records array are required.'
      });
    }
    if (records.length > 500) {
      return res.status(400).json({ success: false, error: 'Too many attendance records in one request.' });
    }

    const cleanSubject = cleanText(subject, 80);
    const cleanDate = cleanText(date, 20);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
      return res.status(400).json({ success: false, error: 'Date must be in YYYY-MM-DD format.' });
    }
    if (!cleanSubject) {
      return res.status(400).json({ success: false, error: 'Subject is required.' });
    }

    const db = getDb();

    // Only allow marking students that belong to this teacher.
    const ownedIds = new Set(
      db
        .prepare('SELECT id FROM students WHERE teacher_id = ?')
        .all(teacherId)
        .map((r) => r.id)
    );

    const insertOrReplaceStmt = db.prepare(
      `INSERT INTO attendance (student_id, teacher_id, subject, date, status, marked_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(student_id, subject, date) DO UPDATE SET
         status = excluded.status,
         teacher_id = excluded.teacher_id,
         marked_at = CURRENT_TIMESTAMP`
    );

    const saveBatch = db.transaction((attendanceRecords) => {
      let count = 0;
      for (const rec of attendanceRecords) {
        const studentId = Number.parseInt(rec && rec.studentId, 10);
        if (!Number.isInteger(studentId) || !ownedIds.has(studentId)) continue;

        const validStatus = ['present', 'absent', 'late'].includes(rec.status) ? rec.status : 'present';
        insertOrReplaceStmt.run(studentId, teacherId, cleanSubject, cleanDate, validStatus);
        count++;
      }
      return count;
    });

    const savedCount = saveBatch(records);

    logSecurityEvent('attendance_marked', req, { teacherId, subject: cleanSubject, date: cleanDate, count: savedCount });

    return res.json({
      success: true,
      message: `Attendance marked successfully for ${savedCount} students.`,
      count: savedCount
    });
  } catch (error) {
    console.error('Error saving attendance:', error);
    return res.status(500).json({ success: false, error: 'Failed to record attendance.' });
  }
});

/**
 * Builds the attendance filter shared by the list and export endpoints.
 * Returns either { error } or { where, params }.
 */
function buildAttendanceFilter(req, teacherId) {
  const { year, division, subject, from, to } = req.query;

  let query = `
    SELECT
      a.id, a.student_id, s.name AS student_name, s.roll_number, s.year, s.division,
      a.subject, a.date, a.status, a.marked_at
    FROM attendance a
    JOIN students s ON a.student_id = s.id
    WHERE a.teacher_id = ?
  `;
  const params = [teacherId];

  if (year) {
    const v = Number.parseInt(year, 10);
    if (!Number.isInteger(v) || v < 1 || v > 4) return { error: 'Invalid year filter.' };
    query += ' AND s.year = ?';
    params.push(v);
  }
  if (division) {
    const v = cleanText(division, 5).toUpperCase();
    if (!/^[A-E]$/.test(v)) return { error: 'Invalid division filter.' };
    query += ' AND UPPER(s.division) = ?';
    params.push(v);
  }
  if (subject) {
    query += ' AND LOWER(a.subject) = ?';
    params.push(cleanText(subject, 80).toLowerCase());
  }
  if (from) {
    const v = cleanText(from, 20);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return { error: 'Invalid from date.' };
    query += ' AND a.date >= ?';
    params.push(v);
  }
  if (to) {
    const v = cleanText(to, 20);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return { error: 'Invalid to date.' };
    query += ' AND a.date <= ?';
    params.push(v);
  }

  query += ' ORDER BY a.date DESC, s.roll_number ASC';
  return { query, params };
}

// GET /api/teacher/attendance
router.get('/attendance', (req, res) => {
  try {
    const teacherId = req.session.user.id;
    const db = getDb();

    const filter = buildAttendanceFilter(req, teacherId);
    if (filter.error) return res.status(400).json({ success: false, error: filter.error });

    const records = db.prepare(filter.query).all(...filter.params);
    return res.json({ success: true, records });
  } catch (error) {
    console.error('Error fetching attendance records:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch attendance records.' });
  }
});

// GET /api/teacher/attendance/export
router.get('/attendance/export', limiters.export, (req, res) => {
  try {
    const teacherId = req.session.user.id;
    const db = getDb();

    const filter = buildAttendanceFilter(req, teacherId);
    if (filter.error) return res.status(400).json({ success: false, error: filter.error });

    const rows = db.prepare(filter.query).all(...filter.params);

    const formattedData = rows.map((r) => ({
      'Roll Number': r.roll_number,
      'Student Name': r.student_name,
      Year: r.year,
      Division: r.division,
      Subject: r.subject,
      Date: r.date,
      Status: String(r.status || '').toUpperCase(),
      'Marked At': r.marked_at
    }));

    const csv = parse(formattedData);
    const filename = `attendance-${Date.now()}.csv`;

    logSecurityEvent('attendance_exported', req, { teacherId, rows: rows.length });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(csv);
  } catch (error) {
    console.error('Error exporting attendance CSV:', error);
    return res.status(500).json({ success: false, error: 'Failed to generate attendance CSV export.' });
  }
});

/* ------------------------------------------------------------------ *
 * Notices
 * ------------------------------------------------------------------ */

// POST /api/teacher/notices
router.post('/notices', (req, res) => {
  try {
    const teacherId = req.session.user.id;
    const { title, message, subject, year, division, isPinned } = req.body;

    if (!title || !message) {
      return res.status(400).json({ success: false, error: 'Notice title and message are required.' });
    }

    const cleanTitle = cleanText(title, 200);
    const cleanMessage = cleanText(message, 5000);
    const cleanSubject = subject ? cleanText(subject, 80) : null;
    const cleanDivision = division ? cleanText(division, 5).toUpperCase() : null;
    const pinFlag = isPinned ? 1 : 0;

    if (!cleanTitle || !cleanMessage) {
      return res.status(400).json({ success: false, error: 'Notice title and message are required.' });
    }

    let parsedYear = null;
    if (year !== undefined && year !== null && String(year).trim() !== '') {
      parsedYear = Number.parseInt(year, 10);
      if (!Number.isInteger(parsedYear) || parsedYear < 1 || parsedYear > 4) {
        return res.status(400).json({ success: false, error: 'Year must be between 1 and 4.' });
      }
    }
    if (cleanDivision && !/^[A-E]$/.test(cleanDivision)) {
      return res.status(400).json({ success: false, error: 'Division must be a letter from A to E.' });
    }

    const db = getDb();
    const result = db
      .prepare(
        `INSERT INTO notices (title, message, subject, year, division, teacher_id, is_pinned)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(cleanTitle, cleanMessage, cleanSubject, parsedYear, cleanDivision, teacherId, pinFlag);

    logSecurityEvent('notice_created', req, { noticeId: result.lastInsertRowid, teacherId });

    return res.status(201).json({
      success: true,
      message: 'Notice created successfully.',
      notice: {
        id: result.lastInsertRowid,
        title: cleanTitle,
        message: cleanMessage,
        subject: cleanSubject,
        year: parsedYear,
        division: cleanDivision,
        teacher_id: teacherId,
        is_pinned: pinFlag,
        created_at: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error creating notice:', error);
    return res.status(500).json({ success: false, error: 'Failed to create notice.' });
  }
});

// GET /api/teacher/notices
router.get('/notices', (req, res) => {
  try {
    const teacherId = req.session.user.id;
    const db = getDb();

    const notices = db
      .prepare(
        `SELECT * FROM notices WHERE teacher_id = ?
         ORDER BY is_pinned DESC, created_at DESC`
      )
      .all(teacherId);

    return res.json({ success: true, notices });
  } catch (error) {
    console.error('Error fetching teacher notices:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve notices.' });
  }
});

// DELETE /api/teacher/notices/:id
router.delete('/notices/:id', (req, res) => {
  try {
    const teacherId = req.session.user.id;
    const noticeId = parseId(req.params.id);
    if (!noticeId) {
      return res.status(400).json({ success: false, error: 'Invalid notice id.' });
    }

    const db = getDb();
    const notice = db
      .prepare('SELECT id FROM notices WHERE id = ? AND teacher_id = ?')
      .get(noticeId, teacherId);

    if (!notice) {
      return res.status(404).json({
        success: false,
        error: 'Notice not found or unauthorized to delete.'
      });
    }

    db.prepare('DELETE FROM notices WHERE id = ?').run(noticeId);

    logSecurityEvent('notice_deleted', req, { noticeId, teacherId });

    return res.json({ success: true, message: 'Notice deleted successfully.' });
  } catch (error) {
    console.error('Error deleting notice:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete notice.' });
  }
});

module.exports = router;
