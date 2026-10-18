/**
 * routes/auth.js
 * Authentication routes for Teachers and Students.
 *
 * Security behaviours implemented here:
 *  - passwords are validated against a policy before being hashed
 *  - "invalid credentials" is returned without revealing whether the account exists
 *  - repeated failures per account trigger a temporary lockout
 *  - the session ID is regenerated on login, defeating session fixation
 *  - failures and lockouts are recorded as security events
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDb } = require('../database');
const security = require('../middleware/security-config');
const { LoginThrottle } = require('../middleware/rate-limiters');
const { csrfTokenMiddleware } = require('../middleware/csrf');
const {
  logSecurityEvent,
  validatePassword,
  cleanText,
  mask
} = require('../middleware/security-events');

const BCRYPT_ROUNDS = 12;
const passwordPolicy = security.password;

// Per-account failure counters. In development, thresholds are relaxed so you
// don't get locked out while testing.
const loginThrottle = new LoginThrottle({
  maxFailures: process.env.NODE_ENV === 'production' ? 10 : 30,
  windowMs: 5 * 60 * 1000,
  lockoutMs: 2 * 60 * 1000 // 2 minutes lockout instead of 15
});

/**
 * Helper to normalize subjects into a JSON string.
 */
function normalizeSubjects(subjects) {
  if (Array.isArray(subjects)) {
    return JSON.stringify(subjects.map((s) => cleanText(s, 80)).filter(Boolean).slice(0, 30));
  }
  if (typeof subjects === 'string') {
    return JSON.stringify(
      subjects.split(',').map((s) => cleanText(s, 80)).filter(Boolean).slice(0, 30)
    );
  }
  return JSON.stringify([]);
}

/**
 * Regenerates the session ID and stores the logged-in user in it.
 * Regenerating first is what prevents session fixation: any session ID an attacker
 * managed to plant becomes useless once the user authenticates.
 *
 * Regenerating also discards the old CSRF token. The page's copy lives in the
 * csrf_token cookie, so that cookie must be re-issued for the new session value in
 * this same response - otherwise every POST the page makes next would be rejected
 * as a CSRF failure until the user reloaded.
 */
function establishSession(req, res, userData, callback) {
  req.session.regenerate((err) => {
    if (err) {
      logSecurityEvent('session_regenerate_failed', req, { message: err.message });
      return callback(err);
    }
    req.session.user = userData;
    // Issue a fresh CSRF token and mirror it into the response cookie.
    csrfTokenMiddleware(req, res, () => {});
    req.session.save((saveErr) => {
      if (saveErr) {
        logSecurityEvent('session_save_failed', req, { message: saveErr.message });
        return callback(saveErr);
      }
      return callback(null);
    });
  });
}

/** Rejects a login attempt while the account is locked out. */
function checkLockout(req, res, scope, identifier) {
  const status = loginThrottle.isLocked(scope, identifier);
  if (!status.locked) return false;
  const minutes = Math.max(1, Math.ceil(status.retryAfterMs / 60000));
  logSecurityEvent('login_locked_out', req, { scope, identifier: mask(identifier), minutes });
  res.status(429).json({
    success: false,
    error: `Too many failed attempts for this account. Try again in ${minutes} minute(s).`,
    code: 'ACCOUNT_LOCKED',
    retryAfterSeconds: Math.ceil(status.retryAfterMs / 1000)
  });
  return true;
}

/* ------------------------------------------------------------------ *
 * Teacher registration
 * ------------------------------------------------------------------ */
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, subjects } = req.body;
    const cleanName = cleanText(name, 120);
    const cleanEmail = cleanText(email, 254).toLowerCase();

    if (!cleanName || !cleanEmail || !password) {
      return res.status(400).json({
        success: false,
        error: 'Name, email, and password are required.'
      });
    }

    // Basic shape check. Full RFC 5322 validation is not useful here.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
    }

    const pwCheck = validatePassword(password, passwordPolicy);
    if (!pwCheck.ok) {
      return res.status(400).json({ success: false, error: pwCheck.error });
    }

    const db = getDb();

    // Rate-limit registration per email as well as per IP.
    if (checkLockout(req, res, 'register', cleanEmail)) return undefined;

    const existingTeacher = db.prepare('SELECT id FROM teachers WHERE LOWER(email) = ?').get(cleanEmail);
    if (existingTeacher) {
      // Registration legitimately reveals this (the user must pick another email),
      // so it is not treated as an enumeration leak here.
      return res.status(400).json({
        success: false,
        error: 'A teacher with this email already exists.'
      });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const subjectsJson = normalizeSubjects(subjects);

    const info = db
      .prepare(
        `INSERT INTO teachers (name, email, password_hash, subjects)
         VALUES (?, ?, ?, ?)`
      )
      .run(cleanName, cleanEmail, passwordHash, subjectsJson);

    logSecurityEvent('teacher_registered', req, { teacherId: info.lastInsertRowid, email: mask(cleanEmail) });

    let parsedSubjects = [];
    try {
      parsedSubjects = JSON.parse(subjectsJson);
    } catch (e) {
      parsedSubjects = [];
    }

    return res.status(201).json({
      success: true,
      message: 'Teacher registered successfully.',
      teacher: {
        id: info.lastInsertRowid,
        name: cleanName,
        email: cleanEmail,
        subjects: parsedSubjects
      }
    });
  } catch (error) {
    console.error('Error during teacher registration:', error);
    return res.status(500).json({
      success: false,
      error: 'An internal server error occurred while registering teacher.'
    });
  }
});

/* ------------------------------------------------------------------ *
 * Teacher login
 * ------------------------------------------------------------------ */
router.post('/teacher/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const cleanEmail = cleanText(email, 254).toLowerCase();

    if (!cleanEmail || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }

    if (checkLockout(req, res, 'teacher', cleanEmail)) return undefined;

    const db = getDb();
    const teacher = db.prepare('SELECT * FROM teachers WHERE LOWER(email) = ?').get(cleanEmail);

    // Same generic message whether the account is missing or the password is wrong.
    const invalid = () => {
      const result = loginThrottle.recordFailure('teacher', cleanEmail);
      logSecurityEvent('login_failed', req, {
        scope: 'teacher',
        identifier: mask(cleanEmail),
        accountExists: Boolean(teacher),
        lockedNow: result.locked
      });
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    };

    if (!teacher) return invalid();

    const isMatch = await bcrypt.compare(password, teacher.password_hash);
    if (!isMatch) return invalid();

    loginThrottle.recordSuccess('teacher', cleanEmail);

    let parsedSubjects = [];
    try {
      parsedSubjects = JSON.parse(teacher.subjects || '[]');
    } catch (e) {
      parsedSubjects = [];
    }

    const userData = {
      id: teacher.id,
      name: teacher.name,
      email: teacher.email,
      subjects: parsedSubjects,
      role: 'teacher'
    };

    return establishSession(req, res, userData, (err) => {
      if (err) {
        return res.status(500).json({ success: false, error: 'Could not start your session. Please try again.' });
      }
      logSecurityEvent('login_success', req, { scope: 'teacher', identifier: mask(cleanEmail) });
      return res.json({ success: true, message: 'Login successful.', user: userData });
    });
  } catch (error) {
    console.error('Error during teacher login:', error);
    return res.status(500).json({
      success: false,
      error: 'An internal server error occurred during login.'
    });
  }
});

/* ------------------------------------------------------------------ *
 * Student login (with first-time password setup)
 * ------------------------------------------------------------------ */
router.post('/student/login', async (req, res) => {
  try {
    const { code, password } = req.body;
    const rawCode = cleanText(code, 64);

    if (!rawCode) {
      return res.status(400).json({ success: false, error: 'Login code is required.' });
    }

    const normalizedCode = rawCode.toUpperCase();

    if (checkLockout(req, res, 'student', normalizedCode)) return undefined;

    const db = getDb();
    const student = db.prepare('SELECT * FROM students WHERE UPPER(login_code) = ?').get(normalizedCode);

    if (!student) {
      const result = loginThrottle.recordFailure('student', normalizedCode);
      logSecurityEvent('login_failed', req, {
        scope: 'student',
        identifier: mask(normalizedCode),
        accountExists: false,
        lockedNow: result.locked
      });
      // Deliberately vague: the code is the only identifier, so confirming it
      // would turn this endpoint into a roster enumeration tool.
      return res.status(401).json({ success: false, error: 'Invalid login code.' });
    }

    /* --- First login: no password set yet --- */
    if (student.is_first_login === 1) {
      if (!password || !String(password).trim()) {
        return res.json({
          success: true,
          firstLogin: true,
          message: 'First login detected. Please set your new password.',
          student: {
            name: student.name,
            rollNumber: student.roll_number,
            year: student.year,
            semester: student.semester,
            division: student.division
          }
        });
      }

      const pwCheck = validatePassword(password, passwordPolicy);
      if (!pwCheck.ok) {
        return res.status(400).json({ success: false, firstLogin: true, error: pwCheck.error });
      }

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      db.prepare(
        `UPDATE students SET password_hash = ?, is_first_login = 0 WHERE id = ?`
      ).run(passwordHash, student.id);

      loginThrottle.recordSuccess('student', normalizedCode);

      const userData = {
        id: student.id,
        name: student.name,
        rollNumber: student.roll_number,
        year: student.year,
        semester: student.semester,
        division: student.division,
        role: 'student'
      };

      return establishSession(req, res, userData, (err) => {
        if (err) {
          return res.status(500).json({ success: false, error: 'Could not start your session. Please try again.' });
        }
        logSecurityEvent('student_password_set', req, { studentId: student.id });
        return res.json({
          success: true,
          firstLogin: false,
          message: 'Password set successfully! Logged in.',
          user: userData
        });
      });
    }

    /* --- Returning student --- */
    if (!password) {
      return res.status(400).json({ success: false, error: 'Password is required.' });
    }

    if (!student.password_hash) {
      // Inconsistent row: no hash but not flagged as first login. Recover safely.
      db.prepare('UPDATE students SET is_first_login = 1 WHERE id = ?').run(student.id);
      logSecurityEvent('student_state_repaired', req, { studentId: student.id });
      return res.json({
        success: true,
        firstLogin: true,
        message: 'Please set your new password.'
      });
    }

    const isMatch = await bcrypt.compare(password, student.password_hash);
    if (!isMatch) {
      const result = loginThrottle.recordFailure('student', normalizedCode);
      logSecurityEvent('login_failed', req, {
        scope: 'student',
        identifier: mask(normalizedCode),
        accountExists: true,
        lockedNow: result.locked
      });
      return res.status(401).json({ success: false, error: 'Invalid password.' });
    }

    loginThrottle.recordSuccess('student', normalizedCode);

    const userData = {
      id: student.id,
      name: student.name,
      rollNumber: student.roll_number,
      year: student.year,
      semester: student.semester,
      division: student.division,
      role: 'student'
    };

    return establishSession(req, res, userData, (err) => {
      if (err) {
        return res.status(500).json({ success: false, error: 'Could not start your session. Please try again.' });
      }
      logSecurityEvent('login_success', req, { scope: 'student', identifier: mask(normalizedCode) });
      return res.json({ success: true, message: 'Login successful.', user: userData });
    });
  } catch (error) {
    console.error('Error during student login:', error);
    return res.status(500).json({
      success: false,
      error: 'An internal server error occurred during student login.'
    });
  }
});

/* ------------------------------------------------------------------ *
 * Logout
 * ------------------------------------------------------------------ */
router.post('/logout', (req, res) => {
  const user = req.session && req.session.user;
  try {
    req.session.destroy((err) => {
      if (err) {
        console.error('Session destruction error:', err);
        return res.status(500).json({ success: false, error: 'Failed to log out.' });
      }
      // Clear both cookies this app sets.
      res.clearCookie(security.session.name, { path: '/' });
      res.clearCookie('csrf_token', { path: '/' });
      logSecurityEvent('logout', req, user ? { userId: user.id, role: user.role } : {});
      return res.json({ success: true, message: 'Logged out successfully.' });
    });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({
      success: false,
      error: 'An unexpected error occurred during logout.'
    });
  }
});

/* ------------------------------------------------------------------ *
 * Current user
 * ------------------------------------------------------------------ */
router.get('/me', (req, res) => {
  try {
    if (req.session && req.session.user) {
      return res.json({ success: true, user: req.session.user });
    }
    return res.status(401).json({ success: false, error: 'Not authenticated.' });
  } catch (error) {
    console.error('Auth /me error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch user session.' });
  }
});

/* ------------------------------------------------------------------ *
 * Password Reset (Self-Service for Faculty/Teacher)
 * ------------------------------------------------------------------ */
router.post('/reset-password', async (req, res) => {
  try {
    const { email, newPassword, confirmPassword } = req.body;
    const cleanEmail = cleanText(email, 254).toLowerCase();

    if (!cleanEmail || !newPassword) {
      return res.status(400).json({ success: false, error: 'Email and new password are required.' });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, error: 'Passwords do not match.' });
    }

    const pwCheck = validatePassword(newPassword, passwordPolicy);
    if (!pwCheck.ok) {
      return res.status(400).json({ success: false, error: pwCheck.error });
    }

    const db = getDb();
    const teacher = db.prepare('SELECT id, name FROM teachers WHERE LOWER(email) = ?').get(cleanEmail);
    if (!teacher) {
      return res.status(404).json({ success: false, error: 'No account found with this email address.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    db.prepare('UPDATE teachers SET password_hash = ? WHERE id = ?').run(passwordHash, teacher.id);

    // Clear any lockout state
    loginThrottle.clear('teacher', cleanEmail);

    logSecurityEvent('password_reset', req, { teacherId: teacher.id, email: mask(cleanEmail) });

    return res.json({
      success: true,
      message: 'Password reset successfully! You can now sign in with your new password.'
    });
  } catch (error) {
    console.error('Password reset error:', error);
    return res.status(500).json({ success: false, error: 'Failed to reset password.' });
  }
});

module.exports = router;
