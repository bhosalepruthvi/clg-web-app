/**
 * middleware/security-events.js
 * Security event logging and shared input-validation helpers.
 *
 * Events are written as one JSON line per event: easy to grep, easy to ship to a
 * log collector later, and never includes passwords or password hashes.
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'security.log');

// Only write a file when someone opts in; console logging always happens.
const FILE_LOGGING = process.env.SECURITY_LOG_FILE === '1';

let stream = null;
let streamFailed = false;

function getStream() {
  if (!FILE_LOGGING || streamFailed) return null;
  if (stream) return stream;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
    stream.on('error', () => {
      streamFailed = true;
      stream = null;
    });
    return stream;
  } catch (err) {
    // Logging must never break a request.
    streamFailed = true;
    return null;
  }
}

/**
 * Masks a login code / email so logs are useful without storing full identifiers.
 */
function mask(value) {
  if (!value || typeof value !== 'string') return '(none)';
  const s = value.trim();
  if (s.length <= 4) return '*'.repeat(s.length);
  return s.slice(0, 2) + '*'.repeat(Math.max(1, s.length - 4)) + s.slice(-2);
}

/**
 * Records a security-relevant event.
 *
 * @param {string} event   Machine-readable event name, e.g. 'login_failed'.
 * @param {object} req     Express request (used for IP and user agent).
 * @param {object} [details] Extra context. Never pass secrets here.
 */
function logSecurityEvent(event, req, details = {}) {
  const entry = {
    ts: new Date().toISOString(),
    event,
    ip: (req && (req.ip || (req.socket && req.socket.remoteAddress))) || 'unknown',
    method: req && req.method,
    path: req && req.originalUrl,
    actor: req && req.session && req.session.user
      ? { id: req.session.user.id, role: req.session.user.role }
      : null,
    ua: req && req.get ? String(req.get('user-agent') || '').slice(0, 200) : undefined,
    ...details
  };

  const line = JSON.stringify(entry);
  console.warn('[security] ' + line);

  const s = getStream();
  if (s) s.write(line + '\n');
}

/* ------------------------------------------------------------------ *
 * Validation helpers
 * ------------------------------------------------------------------ */

/** A password must be long enough, not absurdly long, and not a known-weak string. */
function validatePassword(password, policy) {
  if (typeof password !== 'string' || password.length === 0) {
    return { ok: false, error: 'Password is required.' };
  }
  if (password.length < policy.minLength) {
    return { ok: false, error: `Password must be at least ${policy.minLength} characters long.` };
  }
  if (password.length > policy.maxLength) {
    return { ok: false, error: `Password must be at most ${policy.maxLength} characters long.` };
  }
  const lower = password.toLowerCase();
  if (policy.banned.has(lower)) {
    return { ok: false, error: 'That password is too common. Please choose a different one.' };
  }
  // Require at least two character classes so a single repeated character fails.
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 2) {
    return {
      ok: false,
      error: 'Password must mix at least two of: lowercase letters, uppercase letters, numbers, symbols.'
    };
  }
  return { ok: true };
}

/** Restricts a stored external link to http/https. */
function isSafeExternalUrl(url, allowedProtocols) {
  if (typeof url !== 'string' || !url.trim()) return false;
  try {
    const parsed = new URL(url.trim());
    return allowedProtocols.has(parsed.protocol);
  } catch (err) {
    return false;
  }
}

/** Trims and caps a free-text field so a single field cannot bloat a row. */
function cleanText(value, maxLength = 5000) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, maxLength);
}

module.exports = {
  logSecurityEvent,
  validatePassword,
  isSafeExternalUrl,
  cleanText,
  mask,
  LOG_FILE
};
