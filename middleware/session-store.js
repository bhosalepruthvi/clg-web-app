/**
 * middleware/session-store.js
 * SQLite-backed express-session store.
 *
 * The default MemoryStore loses every session on restart (and warns about it in
 * production). This store keeps sessions in the same SQLite database as the rest
 * of the portal, so logins survive a server restart and nothing extra has to be
 * installed on the machine running the app.
 *
 * It implements the subset of the express-session Store contract that the
 * middleware actually calls: get, set, destroy, length, clear, touch and all.
 */

const { Store } = require('express-session');

const CLEANUP_INTERVAL_MS = 15 * 60 * 1000; // purge expired rows every 15 minutes

class SqliteSessionStore extends Store {
  /**
   * @param {object} options
   * @param {object} options.db        A better-sqlite3 / node:sqlite database handle.
   * @param {number} [options.ttlMs]   Session lifetime in milliseconds.
   */
  constructor({ db, ttlMs = 1000 * 60 * 60 * 24 * 7 }) {
    super();
    this.db = db;
    this.ttlMs = ttlMs;

    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          sid        TEXT PRIMARY KEY,
          data       TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
      `);
    } catch (err) {
      // Refusing to start is deliberate. Falling back to an in-memory store would
      // look like it works and then silently lose every session on restart, and the
      // real cause (an unwritable database file) would be hidden.
      const hint =
        err && err.code === 'SQLITE_READONLY'
          ? ' The database file is not writable by the account running the server.' +
            ' Check the file permissions on portal.db, portal.db-wal and portal.db-shm,' +
            ' and make sure the folder containing them is writable.'
          : '';
      throw new Error(
        `Could not prepare the session table in the database (${err.code || 'error'}: ${err.message}).${hint}`
      );
    }

    this._getStmt = db.prepare('SELECT data, expires_at FROM sessions WHERE sid = ?');
    this._setStmt = db.prepare(`
      INSERT INTO sessions (sid, data, expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at
    `);
    this._delStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this._touchStmt = db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?');
    this._allStmt = db.prepare('SELECT sid, data FROM sessions WHERE expires_at > ?');
    this._lenStmt = db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE expires_at > ?');
    this._clearStmt = db.prepare('DELETE FROM sessions');
    this._purgeStmt = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');

    // A single recurring timer, unref'd so it never holds the process open.
    this._cleanupTimer = setInterval(() => this.purgeExpired(), CLEANUP_INTERVAL_MS);
    if (typeof this._cleanupTimer.unref === 'function') this._cleanupTimer.unref();
  }

  _expiry() {
    return Date.now() + this.ttlMs;
  }

  /** Remove everything already past its expiry. */
  purgeExpired() {
    try {
      this._purgeStmt.run(Date.now());
    } catch (err) {
      // A purge failure must never take the request path down with it.
      console.error('Session store purge failed:', err.message);
    }
  }

  get(sid, callback) {
    try {
      const row = this._getStmt.get(sid);
      if (!row) return callback(null, null);
      if (row.expires_at <= Date.now()) {
        this._delStmt.run(sid);
        return callback(null, null);
      }
      return callback(null, JSON.parse(row.data));
    } catch (err) {
      return callback(err);
    }
  }

  set(sid, session, callback) {
    try {
      this._setStmt.run(sid, JSON.stringify(session), this._expiry());
      return callback ? callback(null) : undefined;
    } catch (err) {
      // A failing write means sessions silently never persist: every request then gets
      // a brand-new session, which reaches the user as "Security check failed" on every
      // form. Report the cause loudly, but not once per request.
      this._reportWriteFailure(err);
      return callback ? callback(err) : undefined;
    }
  }

  /** Logs the first session write failure, then every fiftieth, to avoid log spam. */
  _reportWriteFailure(err) {
    this._writeFailures = (this._writeFailures || 0) + 1;
    if (this._writeFailures === 1 || this._writeFailures % 50 === 0) {
      console.error(
        `[security] Session store cannot write to the database ` +
          `(${err.code || 'error'}: ${err.message}). Failure #${this._writeFailures}. ` +
          'Sessions will not persist, so logging in and every form submission will fail ' +
          'with a CSRF error. Fix the permissions on portal.db, portal.db-wal and ' +
          'portal.db-shm, and make sure the folder holding them is writable.'
      );
    }
  }

  destroy(sid, callback) {
    try {
      this._delStmt.run(sid);
      return callback ? callback(null) : undefined;
    } catch (err) {
      return callback ? callback(err) : undefined;
    }
  }

  touch(sid, session, callback) {
    try {
      this._touchStmt.run(this._expiry(), sid);
      return callback ? callback(null) : undefined;
    } catch (err) {
      return callback ? callback(err) : undefined;
    }
  }

  length(callback) {
    try {
      const row = this._lenStmt.get(Date.now());
      return callback(null, row ? row.count : 0);
    } catch (err) {
      return callback(err);
    }
  }

  clear(callback) {
    try {
      this._clearStmt.run();
      return callback ? callback(null) : undefined;
    } catch (err) {
      return callback ? callback(err) : undefined;
    }
  }

  all(callback) {
    try {
      const rows = this._allStmt.all(Date.now());
      return callback(null, rows.map((r) => JSON.parse(r.data)));
    } catch (err) {
      return callback(err);
    }
  }
}

module.exports = { SqliteSessionStore };
