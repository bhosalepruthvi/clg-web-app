/**
 * database.js
 * SQLite Database setup and table schemas for the College Study Portal.
 * Uses better-sqlite3 with seamless compatibility for node:sqlite.
 * Manages tables for teachers, students, materials, attendance, notices, and notice reads.
 */

const path = require('path');
const fs = require('fs');

let DatabaseConstructor;

try {
  const BetterSqlite3 = require('better-sqlite3');
  // Test if native binary is allowed to execute in current environment
  const testDb = new BetterSqlite3(':memory:');
  testDb.close();
  DatabaseConstructor = BetterSqlite3;
} catch (err) {
  // If native .node binary is blocked by Windows Application Control or unavailable,
  // fall back to Node's built-in SQLite engine (node:sqlite)
  const { DatabaseSync } = require('node:sqlite');
  DatabaseConstructor = function (filename, options) {
    const db = new DatabaseSync(filename);
    db.pragma = function (str) {
      try {
        return db.exec('PRAGMA ' + str);
      } catch (e) {
        // Ignore pragma errors if unsupported
      }
    };
    if (!db.transaction) {
      db.transaction = function (fn) {
        return function (...args) {
          db.exec('BEGIN TRANSACTION');
          try {
            const result = fn.apply(this, args);
            db.exec('COMMIT');
            return result;
          } catch (error) {
            db.exec('ROLLBACK');
            throw error;
          }
        };
      };
    }
    return db;
  };
}

// The database file can be relocated with DB_PATH, which is useful for tests and
// for running the app against a separate copy of the data.
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, 'portal.db');
let dbInstance = null;

/**
 * Returns the singleton SQLite database instance.
 */
function getDb() {
  if (!dbInstance) {
    dbInstance = new DatabaseConstructor(DB_PATH);
    // Enable WAL mode for better concurrency and foreign keys for data integrity
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('foreign_keys = ON');
  }
  return dbInstance;
}

/**
 * Initializes the database tables if they do not exist.
 * Sets up 6 tables: teachers, students, materials, attendance, notices, notice_reads.
 */
function initializeDatabase() {
  const db = getDb();

  db.exec(`
    -- Teachers Table
    CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      subjects TEXT, -- JSON array of subjects e.g. ["Maths", "DSA"]
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Students Table
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      roll_number TEXT NOT NULL,
      login_code TEXT UNIQUE NOT NULL,
      password_hash TEXT DEFAULT NULL, -- Set on first login
      year INTEGER NOT NULL, -- 1, 2, 3, 4
      semester INTEGER NOT NULL, -- 1 to 8
      division TEXT NOT NULL, -- A, B, C, D, E
      teacher_id INTEGER,
      is_first_login INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL
    );

    -- Materials Table
    CREATE TABLE IF NOT EXISTS materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      file_path TEXT,
      file_type TEXT,
      link_url TEXT, -- for external links
      year INTEGER NOT NULL,
      semester INTEGER NOT NULL,
      subject TEXT NOT NULL,
      unit TEXT,
      teacher_id INTEGER,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
    );

    -- Attendance Table
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      teacher_id INTEGER NOT NULL,
      subject TEXT NOT NULL,
      date TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('present', 'absent', 'late')),
      marked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
      UNIQUE (student_id, subject, date)
    );

    -- Notices Table
    CREATE TABLE IF NOT EXISTS notices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      subject TEXT,
      year INTEGER,
      division TEXT,
      teacher_id INTEGER NOT NULL,
      is_pinned INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
    );

    -- Notice Reads Table (Tracks student read status for unread notice counts)
    CREATE TABLE IF NOT EXISTS notice_reads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notice_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (notice_id) REFERENCES notices(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
      UNIQUE (notice_id, student_id)
    );

    -- Indexes for efficient queries
    CREATE INDEX IF NOT EXISTS idx_students_teacher ON students(teacher_id);
    CREATE INDEX IF NOT EXISTS idx_students_year_div ON students(year, division);
    CREATE INDEX IF NOT EXISTS idx_materials_filters ON materials(year, semester, subject);
    CREATE INDEX IF NOT EXISTS idx_attendance_query ON attendance(student_id, subject, date);
    CREATE INDEX IF NOT EXISTS idx_notices_target ON notices(year, division);
  `);

  console.log('Database initialized successfully with 6 tables.');
  return db;
}

module.exports = {
  getDb,
  initializeDatabase
};
