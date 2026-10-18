/**
 * middleware/csrf.js
 * CSRF protection using the signed double-submit cookie pattern.
 *
 * How it works:
 *  1. Every request gets a random token stored in the session. The same value is
 *     mirrored into a readable cookie so the browser-side code can copy it into a
 *     request header.
 *  2. Any state-changing request (POST/PUT/PATCH/DELETE) must echo the token back
 *     in the X-CSRF-Token header.
 *  3. The header is compared, in constant time, against the token held in the
 *     session. An attacker on another origin can make the browser send the cookie
 *     automatically, but cannot read it to fill in the header, and cannot read the
 *     session token.
 *
 * Verification is skipped for:
 *  - safe methods (GET/HEAD/OPTIONS), which must not change state anyway;
 *  - requests whose session does not yet exist, because there is nothing to
 *    protect and no token the client could have obtained (see below).
 *
 * If a request arrives with no session token at all (for example a script that
 * never fetched a page first), it is rejected rather than silently allowed.
 */

const crypto = require('crypto');

const TOKEN_BYTES = 32;
const HEADER_NAME = 'x-csrf-token';
const COOKIE_NAME = 'csrf_token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

/**
 * Constant-time string comparison that does not leak length through early exit.
 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Issues/refreshes the session token and mirrors it into a readable cookie.
 * Mount this after the session middleware on every route.
 */
function csrfTokenMiddleware(req, res, next) {
  if (!req.session) return next();

  if (!req.session.csrfToken) {
    req.session.csrfToken = generateToken();
    // Persist immediately so the token survives even if the request never sends a
    // response (for example a page that only issues the cookie). A session-store
    // fault must not produce an unhandled rejection, so it is logged and ignored.
    if (typeof req.session.save === 'function') {
      req.session.save((err) => {
        if (err) console.error('[security] Could not persist CSRF token to the session store:', err.message);
      });
    }
  }

  // Always re-mirror the session's current token into the cookie.
  //
  // It must not be conditional on "we just created the token". If the session could
  // not be persisted (or expired, or was regenerated), express-session hands us a
  // fresh session with a fresh token while the browser still holds the previous
  // cookie value. Skipping the cookie write in that case leaves client and session
  // permanently out of step, and every state-changing request fails with 403.
  // Writing it unconditionally means the cookie always matches the session.
  //
  // Readable by JavaScript on purpose: the page must copy it into the header. It is
  // not a credential on its own - it is useless without the session cookie.
  res.cookie(COOKIE_NAME, req.session.csrfToken, {
    httpOnly: false,
    sameSite: 'lax',
    secure: req.secure || req.app.get('trust proxy') === true && req.protocol === 'https',
    path: '/'
  });

  // Handy for templates and for the /api/auth/csrf endpoint.
  res.locals.csrfToken = req.session.csrfToken;
  return next();
}

/**
 * Rejects state-changing requests that do not present the session token.
 * @param {object} [options]
 * @param {string[]} [options.exempt] Path prefixes that skip verification.
 */
function csrfProtection(options = {}) {
  const exempt = options.exempt || [];

  return function verifyCsrf(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();

    if (exempt.some((prefix) => req.path.startsWith(prefix))) return next();

    const sessionToken = req.session && req.session.csrfToken;
    const headerToken = req.get(HEADER_NAME) || (req.body && req.body._csrf);

    if (!sessionToken) {
      return res.status(403).json({
        success: false,
        error: 'Your session has expired or was not initialized. Please reload the page and try again.',
        code: 'CSRF_NO_SESSION'
      });
    }

    if (!headerToken || !safeEqual(headerToken, sessionToken)) {
      // Warn when the client presented a token that was valid for a *different*
      // session. That pattern means the session is not persisting between requests
      // (a session store that cannot write is the usual cause), which would break
      // every form on the site - so say so in the log rather than leaving it opaque.
      if (headerToken && !safeEqual(headerToken, sessionToken)) {
        console.warn(
          '[security] CSRF token mismatch: the client sent a token that does not match ' +
            'this session. If this repeats on every request, the session is not being ' +
            'persisted - check that the database file is writable (see SQLITE_READONLY).'
        );
      }
      return res.status(403).json({
        success: false,
        error: 'Security check failed. Please reload the page and try again.',
        code: 'CSRF_INVALID'
      });
    }

    return next();
  };
}

module.exports = {
  csrfTokenMiddleware,
  csrfProtection,
  COOKIE_NAME,
  HEADER_NAME
};
