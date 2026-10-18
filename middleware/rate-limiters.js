/**
 * middleware/rate-limiters.js
 * Request throttling built on express-rate-limit.
 *
 * The default key is the client IP. In production behind a proxy, set TRUST_PROXY
 * (see server.js) or every request appears to come from the proxy address and one
 * noisy client would throttle everybody.
 *
 * All limiters return the portal's normal JSON error shape so the frontend shows a
 * sensible message instead of an HTML error page.
 */

const { rateLimit } = require('express-rate-limit');
const { logSecurityEvent } = require('./security-events');

/**
 * Builds a limiter that emits our JSON error contract and logs the trip.
 */
function makeLimiter({ windowMs, limit, name, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7', // RateLimit-* headers
    legacyHeaders: false, // no deprecated X-RateLimit-*
    // Keep the limiter key stable behind proxies; server.js sets trust proxy.
    validate: { xForwardedForHeader: false },
    handler: (req, res) => {
      logSecurityEvent('rate_limit_exceeded', req, { limiter: name, windowMs, limit });
      return res.status(429).json({
        success: false,
        error: message || 'Too many requests. Please slow down and try again shortly.',
        code: 'RATE_LIMITED',
        retryAfterSeconds: Math.ceil(windowMs / 1000)
      });
    }
  });
}

/**
 * Creates the limiter set for the portal using the configured windows.
 *
 * AUTH_RATE_LIMIT_OVERRIDE exists so an automated verification run can exercise
 * login behaviour without tripping the IP limiter. It has no effect unless the
 * environment variable is set explicitly.
 *
 * @param {object} rateLimits The rateLimits block from security-config.
 */
function createLimiters(rateLimits) {
  const auth = { ...rateLimits.auth };
  const override = Number.parseInt(process.env.AUTH_RATE_LIMIT_OVERRIDE || '', 10);
  if (Number.isFinite(override) && override > 0) {
    auth.limit = override;
  }

  return {
    // Applied to every request as a coarse backstop.
    global: makeLimiter({
      ...rateLimits.global,
      name: 'global',
      message: 'Too many requests from this address. Please try again later.'
    }),

    // Login and registration. Deliberately strict.
    auth: makeLimiter({
      ...auth,
      name: 'auth',
      message: 'Too many login attempts. Please wait 15 minutes before trying again.'
    }),

    // File uploads.
    upload: makeLimiter({
      ...rateLimits.upload,
      name: 'upload',
      message: 'Too many uploads. Please wait a few minutes and try again.'
    }),

    // Reports and CSV export.
    export: makeLimiter({
      ...rateLimits.export,
      name: 'export',
      message: 'Too many export requests. Please wait a few minutes and try again.'
    })
  };
}

/**
 * Per-account login throttle.
 *
 * The IP rate limiter alone is not enough: an attacker spread across many source
 * addresses could still hammer one account. This tracks failures per account and
 * locks that account's login for a cooldown after too many failures.
 *
 * Kept in memory on purpose - it is a short-lived counter, and losing it on
 * restart only means an attacker gets a fresh budget.
 */
class LoginThrottle {
  constructor({ maxFailures = 8, windowMs = 15 * 60 * 1000, lockoutMs = 15 * 60 * 1000 } = {}) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
    this.lockoutMs = lockoutMs;
    this.attempts = new Map(); // key -> { failures: number[], lockedUntil: number }

    this._timer = setInterval(() => this.sweep(), 5 * 60 * 1000);
    if (typeof this._timer.unref === 'function') this._timer.unref();
  }

  _key(scope, identifier) {
    return scope + ':' + String(identifier || '').toLowerCase();
  }

  _entry(key) {
    let e = this.attempts.get(key);
    if (!e) {
      e = { failures: [], lockedUntil: 0 };
      this.attempts.set(key, e);
    }
    return e;
  }

  /** True when the account is currently locked out. Returns ms remaining. */
  isLocked(scope, identifier) {
    const e = this.attempts.get(this._key(scope, identifier));
    if (!e) return { locked: false, retryAfterMs: 0 };
    const remaining = e.lockedUntil - Date.now();
    if (remaining > 0) return { locked: true, retryAfterMs: remaining };
    return { locked: false, retryAfterMs: 0 };
  }

  /** Records a failed attempt, locking the account if the threshold is reached. */
  recordFailure(scope, identifier) {
    const key = this._key(scope, identifier);
    const e = this._entry(key);
    const now = Date.now();
    e.failures = e.failures.filter((t) => now - t < this.windowMs);
    e.failures.push(now);

    if (e.failures.length >= this.maxFailures) {
      e.lockedUntil = now + this.lockoutMs;
      e.failures = [];
      return { locked: true };
    }
    return { locked: false, remainingAttempts: this.maxFailures - e.failures.length };
  }

  /** Clears the counter after a successful login. */
  recordSuccess(scope, identifier) {
    this.attempts.delete(this._key(scope, identifier));
  }

  /** Drops expired counters so the map cannot grow without bound. */
  sweep() {
    const now = Date.now();
    for (const [key, e] of this.attempts) {
      const stale = e.lockedUntil < now && e.failures.every((t) => now - t >= this.windowMs);
      if (stale) this.attempts.delete(key);
    }
  }
}

module.exports = { createLimiters, makeLimiter, LoginThrottle };
