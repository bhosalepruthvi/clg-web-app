/**
 * routes/student.js
 * Student API endpoints for dashboard, materials, attendance, profile, and notices.
 * Protected by requireStudent middleware.
 *
 * Every query is scoped to the authenticated student's own id, so one student can
 * never read another's attendance or profile. Free-text inputs are length-capped.
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { requireStudent } = require('../middleware/auth');
const { cleanText } = require('../middleware/security-events');

// Apply student authentication to all routes in this file
router.use(requireStudent);

/**
 * Helper to determine status color based on attendance percentage:
 * green >= 75%, amber 65-74%, red < 65%
 */
function getAttendanceStatusColor(percentage) {
  if (percentage >= 75) return 'green';
  if (percentage >= 65) return 'amber';
  return 'red';
}

/**
 * Reads the authenticated student's row fresh from the database.
 * The session copy of year/semester can go stale if a teacher edits the record,
 * so anything that filters on those values uses this.
 */
function loadStudent(db, studentId) {
  return db
    .prepare('SELECT id, name, roll_number, login_code, year, semester, division, created_at FROM students WHERE id = ?')
    .get(studentId);
}

// GET /api/student/dashboard
router.get('/dashboard', (req, res) => {
  try {
    const studentId = req.session.user.id;
    const db = getDb();

    const student = loadStudent(db, studentId);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student record not found.' });
    }

    // Material count for this student's year and semester. Teachers publish to a
    // year+semester, so those are the two dimensions that matter here.
    const matCountRow = db
      .prepare('SELECT COUNT(*) as count FROM materials WHERE year = ? AND semester = ?')
      .get(student.year, student.semester);
    const materialCount = matCountRow ? matCountRow.count : 0;

    // Unread notices targeted to this student and not yet recorded as read.
    const unreadNoticeRow = db
      .prepare(
        `SELECT COUNT(*) as count
         FROM notices n
         WHERE (n.year IS NULL OR n.year = ?)
           AND (n.division IS NULL OR n.division = '' OR UPPER(n.division) = UPPER(?))
           AND n.id NOT IN (SELECT notice_id FROM notice_reads WHERE student_id = ?)`
      )
      .get(student.year, student.division, studentId);
    const unreadNoticesCount = unreadNoticeRow ? unreadNoticeRow.count : 0;

    const attendanceStats = db
      .prepare(
        `SELECT
           COUNT(*) as totalClasses,
           SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present,
           SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent,
           SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late
         FROM attendance WHERE student_id = ?`
      )
      .get(studentId);

    const totalClasses = attendanceStats ? Number(attendanceStats.totalClasses || 0) : 0;
    const present = attendanceStats ? Number(attendanceStats.present || 0) : 0;
    const absent = attendanceStats ? Number(attendanceStats.absent || 0) : 0;
    const late = attendanceStats ? Number(attendanceStats.late || 0) : 0;
    const percentage = totalClasses > 0 ? Math.round((present / totalClasses) * 100) : 100;
    const statusColor = getAttendanceStatusColor(percentage);

    return res.json({
      success: true,
      student: {
        id: student.id,
        name: student.name,
        rollNumber: student.roll_number,
        year: student.year,
        semester: student.semester,
        division: student.division
      },
      materialCount,
      unreadNoticesCount,
      attendanceSummary: {
        totalClasses,
        present,
        absent,
        late,
        percentage,
        statusColor
      }
    });
  } catch (error) {
    console.error('Error fetching student dashboard:', error);
    return res.status(500).json({ success: false, error: 'Failed to load dashboard data.' });
  }
});

// GET /api/student/materials
router.get('/materials', (req, res) => {
  try {
    const studentId = req.session.user.id;
    const { subject, unit, search } = req.query;
    const db = getDb();

    const student = loadStudent(db, studentId);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student record not found.' });
    }

    let query = `
      SELECT
        m.id, m.title, m.description, m.file_path, m.file_type, m.link_url,
        m.year, m.semester, m.subject, m.unit, m.uploaded_at,
        t.name as teacher_name
      FROM materials m
      LEFT JOIN teachers t ON m.teacher_id = t.id
      WHERE m.year = ? AND m.semester = ?
    `;
    const params = [student.year, student.semester];

    if (subject && String(subject).trim()) {
      query += ' AND LOWER(m.subject) = ?';
      params.push(cleanText(subject, 80).toLowerCase());
    }
    if (unit && String(unit).trim()) {
      query += ' AND LOWER(m.unit) = ?';
      params.push(cleanText(unit, 80).toLowerCase());
    }
    if (search && String(search).trim()) {
      query += ' AND (LOWER(m.title) LIKE ? OR LOWER(m.description) LIKE ?)';
      // Cap the term so a huge string cannot be turned into an expensive LIKE scan.
      const term = `%${cleanText(search, 100).toLowerCase()}%`;
      params.push(term, term);
    }

    query += ' ORDER BY m.uploaded_at DESC LIMIT 500';

    const materials = db.prepare(query).all(...params);

    return res.json({ success: true, materials });
  } catch (error) {
    console.error('Error fetching materials for student:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve study materials.' });
  }
});

// GET /api/student/profile
router.get('/profile', (req, res) => {
  try {
    const studentId = req.session.user.id;
    const db = getDb();

    const student = loadStudent(db, studentId);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student record not found.' });
    }

    const overallStats = db
      .prepare(
        `SELECT
           COUNT(*) as totalClasses,
           SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present,
           SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent,
           SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late
         FROM attendance WHERE student_id = ?`
      )
      .get(studentId);

    const totalClasses = overallStats ? Number(overallStats.totalClasses || 0) : 0;
    const present = overallStats ? Number(overallStats.present || 0) : 0;
    const absent = overallStats ? Number(overallStats.absent || 0) : 0;
    const late = overallStats ? Number(overallStats.late || 0) : 0;
    const percentage = totalClasses > 0 ? Math.round((present / totalClasses) * 100) : 100;

    const subjectRows = db
      .prepare(
        `SELECT
           subject,
           COUNT(*) as totalClasses,
           SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present,
           SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent,
           SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late
         FROM attendance WHERE student_id = ?
         GROUP BY subject ORDER BY subject ASC`
      )
      .all(studentId);

    const subjectAttendance = subjectRows.map((s) => {
      const subTotal = Number(s.totalClasses || 0);
      const subPresent = Number(s.present || 0);
      const subPct = subTotal > 0 ? Math.round((subPresent / subTotal) * 100) : 100;
      return {
        subject: s.subject,
        totalClasses: subTotal,
        present: subPresent,
        absent: Number(s.absent || 0),
        late: Number(s.late || 0),
        percentage: subPct,
        statusColor: getAttendanceStatusColor(subPct)
      };
    });

    return res.json({
      success: true,
      student: {
        id: student.id,
        name: student.name,
        rollNumber: student.roll_number,
        loginCode: student.login_code,
        year: student.year,
        semester: student.semester,
        division: student.division,
        createdAt: student.created_at
      },
      overallAttendance: {
        totalClasses,
        present,
        absent,
        late,
        percentage,
        statusColor: getAttendanceStatusColor(percentage)
      },
      subjectAttendance
    });
  } catch (error) {
    console.error('Error fetching student profile:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve student profile.' });
  }
});

// GET /api/student/attendance
router.get('/attendance', (req, res) => {
  try {
    const studentId = req.session.user.id;
    const db = getDb();

    const subjectRows = db
      .prepare(
        `SELECT
           subject,
           COUNT(*) as totalClasses,
           SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present,
           SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent,
           SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late
         FROM attendance WHERE student_id = ?
         GROUP BY subject ORDER BY subject ASC`
      )
      .all(studentId);

    let overallTotal = 0;
    let overallPresent = 0;
    let overallAbsent = 0;
    let overallLate = 0;

    const subjects = subjectRows.map((s) => {
      const subTotal = Number(s.totalClasses || 0);
      const subPresent = Number(s.present || 0);
      const subAbsent = Number(s.absent || 0);
      const subLate = Number(s.late || 0);
      const subPct = subTotal > 0 ? Math.round((subPresent / subTotal) * 100) : 100;

      overallTotal += subTotal;
      overallPresent += subPresent;
      overallAbsent += subAbsent;
      overallLate += subLate;

      return {
        subject: s.subject,
        totalClasses: subTotal,
        present: subPresent,
        absent: subAbsent,
        late: subLate,
        percentage: subPct,
        statusColor: getAttendanceStatusColor(subPct)
      };
    });

    const overallPct = overallTotal > 0 ? Math.round((overallPresent / overallTotal) * 100) : 100;

    const records = db
      .prepare(
        `SELECT a.id, a.subject, a.date, a.status, a.marked_at, t.name as teacher_name
         FROM attendance a
         LEFT JOIN teachers t ON a.teacher_id = t.id
         WHERE a.student_id = ?
         ORDER BY a.date DESC LIMIT 2000`
      )
      .all(studentId);

    return res.json({
      success: true,
      summary: {
        overall: {
          totalClasses: overallTotal,
          present: overallPresent,
          absent: overallAbsent,
          late: overallLate,
          percentage: overallPct,
          statusColor: getAttendanceStatusColor(overallPct)
        },
        subjects
      },
      records
    });
  } catch (error) {
    console.error('Error fetching student attendance history:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve attendance history.' });
  }
});

// GET /api/student/notices
router.get('/notices', (req, res) => {
  try {
    const studentId = req.session.user.id;
    const db = getDb();

    const student = loadStudent(db, studentId);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student record not found.' });
    }

    const notices = db
      .prepare(
        `SELECT
           n.id, n.title, n.message, n.subject, n.year, n.division, n.is_pinned, n.created_at,
           t.name as teacher_name,
           CASE WHEN nr.id IS NOT NULL THEN 1 ELSE 0 END as is_read
         FROM notices n
         LEFT JOIN teachers t ON n.teacher_id = t.id
         LEFT JOIN notice_reads nr ON nr.notice_id = n.id AND nr.student_id = ?
         WHERE (n.year IS NULL OR n.year = ?)
           AND (n.division IS NULL OR n.division = '' OR UPPER(n.division) = UPPER(?))
         ORDER BY n.is_pinned DESC, n.created_at DESC
         LIMIT 500`
      )
      .all(studentId, student.year, student.division);

    // Record the read state so the dashboard's unread badge clears.
    // Prepared once per request; the surrounding read is what varies.
    const markReadStmt = db.prepare(
      'INSERT OR IGNORE INTO notice_reads (notice_id, student_id) VALUES (?, ?)'
    );
    for (const notice of notices) {
      if (!notice.is_read) {
        markReadStmt.run(notice.id, studentId);
      }
    }

    return res.json({ success: true, notices });
  } catch (error) {
    console.error('Error fetching notices for student:', error);
    return res.status(500).json({ success: false, error: 'Failed to load notices.' });
  }
});

module.exports = router;
