/**
 * middleware/security-config.js
 * Central security configuration for College Study Portal.
 *
 * Everything security-relevant that an operator might need to tune lives here, so
 * there is one place to audit. Secrets come from the environment; nothing sensitive
 * is committed to the repository.
 *
 * Environment variables:
 *   SESSION_SECRET  - required in production; a random per-boot value is used otherwise
 *   NODE_ENV        - 'production' enables secure cookies and strict proxy trust
 *   TRUST_PROXY     - set to '1' when running behind a reverse proxy (nginx, IIS)
 *   SESSION_HOURS   - session lifetime in hours (default 168 = 7 days)
 */

const crypto = require('crypto');

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Resolves the session secret.
 *
 * In production a missing secret is fatal: a known or rotating secret would let
 * anyone forge a session cookie. In development we generate a random one and warn,
 * so the app still runs out of the box but sessions do not survive a restart.
 */
function resolveSessionSecret() {
  const fromEnv = process.env.SESSION_SECRET;

  if (fromEnv && fromEnv.length >= 32) {
    return fromEnv;
  }

  if (isProduction) {
    throw new Error(
      'SESSION_SECRET must be set to a random string of at least 32 characters in production.\n' +
        'Generate one with:  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
    );
  }

  if (fromEnv) {
    console.warn(
      '[security] SESSION_SECRET is shorter than 32 characters. Use a longer random value before deploying.'
    );
    return fromEnv;
  }

  console.warn(
    '[security] SESSION_SECRET is not set. Generated a random development secret; ' +
      'all sessions will be invalidated when the server restarts.'
  );
  return crypto.randomBytes(48).toString('hex');
}

const SESSION_HOURS = Number.parseInt(process.env.SESSION_HOURS || '168', 10);

const config = {
  isProduction,

  // --- sessions ---------------------------------------------------------
  session: {
    name: 'csp.sid', // do not advertise the default 'connect.sid'
    secret: resolveSessionSecret(),
    maxAgeMs: (Number.isFinite(SESSION_HOURS) && SESSION_HOURS > 0 ? SESSION_HOURS : 168) * 60 * 60 * 1000,
    cookie: {
      httpOnly: true, // not readable by JavaScript, so XSS cannot steal the session
      sameSite: 'lax', // blocks cross-site POST CSRF while keeping normal links working
      secure: isProduction, // HTTPS-only in production
      path: '/'
    }
  },

  // --- rate limits (requests per window) --------------------------------
  rateLimits: {
    // Broad protection against scraping and dumb floods.
    global: { windowMs: 15 * 60 * 1000, limit: 600 },
    // Login and registration: the credential-guessing surface.
    auth: { windowMs: 15 * 60 * 1000, limit: 20 },
    // File uploads are expensive; keep them tight.
    upload: { windowMs: 15 * 60 * 1000, limit: 40 },
    // CSV export and other reports.
    export: { windowMs: 15 * 60 * 1000, limit: 30 }
  },

  // --- passwords --------------------------------------------------------
  password: {
    minLength: 8,
    maxLength: 128, // bcrypt silently truncates beyond 72 bytes; cap the input
    // Common choices that satisfy a length rule but offer no real protection.
    banned: new Set([
      'password', 'password1', 'password123', '12345678', '123456789', 'qwertyui',
      'qwerty123', 'iloveyou', 'admin123', 'letmein1', 'welcome1', 'abcd1234',
      'student1', 'teacher1', 'college1', 'portal123', 'passw0rd', 'changeme'
    ])
  },

  // --- uploads ----------------------------------------------------------
  upload: {
    maxFileSizeBytes: 25 * 1024 * 1024, // 25 MB
    // Only document types the portal actually needs. Executable and
    // script-bearing types (.html, .svg, .js, .exe ...) are deliberately absent:
    // they would be served back from our own origin and could run in the browser.
    allowedExtensions: new Set([
      '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
      '.txt', '.csv', '.md', '.rtf', '.odt', '.ods', '.odp',
      '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.zip'
    ]),
    allowedMimeTypes: new Set([
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.oasis.opendocument.text',
      'application/vnd.oasis.opendocument.spreadsheet',
      'application/vnd.oasis.opendocument.presentation',
      'application/rtf',
      'text/plain',
      'text/csv',
      'text/markdown',
      'application/zip',
      'application/x-zip-compressed',
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'image/bmp',
      // Browsers are inconsistent about these two; the extension check still applies.
      'application/octet-stream',
      'application/x-cfb'
    ]),
    // Only http/https links may be stored as "external resource" links, so a
    // javascript: or data: URL never ends up in an href.
    allowedLinkProtocols: new Set(['http:', 'https:'])
  },

  // --- request bodies ---------------------------------------------------
  bodyLimits: {
    json: '256kb',
    urlencoded: '256kb'
  }
};

module.exports = config;
