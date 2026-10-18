/**
 * server.js
 * Main Express server for College Study Portal.
 * Handles security headers, sessions, static file serving, API routes, and page routing.
 *
 * Security layers, in the order a request meets them:
 *   1. helmet      - response hardening (CSP, nosniff, frame denial, referrer policy)
 *   2. global rate limit
 *   3. body size limits
 *   4. session (SQLite-backed, httpOnly + sameSite cookie)
 *   5. CSRF token issue, then CSRF verification on every state-changing request
 *   6. per-route rate limits (auth / upload / export)
 *   7. session-based role gates on both API routes and HTML pages
 */

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');

const security = require('./middleware/security-config');
const { getDb, initializeDatabase } = require('./database');
const { SqliteSessionStore } = require('./middleware/session-store');
const { csrfTokenMiddleware, csrfProtection } = require('./middleware/csrf');
const { createLimiters } = require('./middleware/rate-limiters');
const { logSecurityEvent } = require('./middleware/security-events');

const authRoutes = require('./routes/auth');
const teacherRoutes = require('./routes/teacher');
const studentRoutes = require('./routes/student');

const app = express();
const PORT = process.env.PORT || 3000;

// Behind a reverse proxy the client IP arrives in X-Forwarded-For. Without this,
// rate limiting would bucket every user under the proxy's address.
if (process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}

// Do not advertise the framework.
app.disable('x-powered-by');

// Initialize Database on startup
const db = initializeDatabase();

// Ensure required directories exist
// UPLOADS_DIR mirrors the override in routes/teacher.js so both agree on one path.
const uploadsDir = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(__dirname, 'uploads');
const publicDir = path.join(__dirname, 'public');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

/* ------------------------------------------------------------------ *
 * 1. Security headers
 * ------------------------------------------------------------------ */
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        // 'unsafe-eval' is required by the Tailwind Play CDN (compiles CSS at runtime).
        // 'unsafe-inline' is required by every HTML page's inline <script> blocks and
        //  onclick="" handlers. All pages use inline JS — this must stay enabled while
        //  the app serves pre-built HTML files. Move JS to external files to remove it.
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://cdn.tailwindcss.com'],
        // 'unsafe-inline' is required by the pages' inline <style> blocks.
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"], // clickjacking protection
        baseUri: ["'self'"],
        formAction: ["'self'"],
        // Allow localhost over plain HTTP during development.
        upgradeInsecureRequests: security.isProduction ? [] : null
      }
    },
    crossOriginEmbedderPolicy: false, // would block the Google Fonts / CDN assets
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: security.isProduction
      ? { maxAge: 15552000, includeSubDomains: true } // 180 days
      : false, // never pin HSTS on a developer's http://localhost
    frameguard: { action: 'deny' },
    noSniff: true,
    xssFilter: true
  })
);

// Tell browsers to re-check the CSP for anything served from this origin.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

/* ------------------------------------------------------------------ *
 * 2. Global rate limit (coarse backstop for every request)
 * ------------------------------------------------------------------ */
const limiters = createLimiters(security.rateLimits);
app.use(limiters.global);

/* ------------------------------------------------------------------ *
 * 3. Body parsing with hard size limits
 * ------------------------------------------------------------------ */
app.use(express.json({ limit: security.bodyLimits.json }));
app.use(express.urlencoded({ extended: true, limit: security.bodyLimits.urlencoded }));

/* ------------------------------------------------------------------ *
 * 4. Sessions
 * ------------------------------------------------------------------ */
app.use(
  session({
    name: security.session.name,
    secret: security.session.secret,
    store: new SqliteSessionStore({ db, ttlMs: security.session.maxAgeMs }),
    resave: false,
    saveUninitialized: false,
    rolling: true, // refresh expiry on activity
    cookie: {
      ...security.session.cookie,
      maxAge: security.session.maxAgeMs
    }
  })
);

/* ------------------------------------------------------------------ *
 * 5. CSRF
 * ------------------------------------------------------------------ */
app.use(csrfTokenMiddleware);
// The token endpoint lets a page obtain a fresh token before its first POST.
app.get('/api/auth/csrf', (req, res) => {
  return res.json({ success: true, csrfToken: req.session.csrfToken });
});
// Applied to the API surface only: page routes are GET and cannot change state.
app.use('/api', csrfProtection());

/* ------------------------------------------------------------------ *
 * Static assets
 * ------------------------------------------------------------------ */

/**
 * Serves an uploaded file as a download rather than something the browser renders.
 * Combined with the upload allow-list this closes the "upload an .html file and get
 * script execution on our origin" path.
 */
function serveUpload(req, res, next) {
  res.setHeader('Content-Disposition', 'attachment');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
  return next();
}
app.use('/uploads', serveUpload, express.static(uploadsDir, { index: false, dotfiles: 'deny' }));

// Frontend assets. HTML is not served from here (the page routes below handle it)
// so that no page bypasses the session gate.
app.use(
  express.static(publicDir, {
    index: false,
    dotfiles: 'deny',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-store');
      }
    }
  })
);

/* ------------------------------------------------------------------ *
 * API routes
 * ------------------------------------------------------------------ */
app.use('/api/auth', limiters.auth, authRoutes);
app.use('/api/teacher', teacherRoutes);
app.use('/api/student', studentRoutes);

/* ------------------------------------------------------------------ *
 * 6. HTML page routes with server-side session gates
 *
 * The APIs were always protected, but the page files themselves were served to
 * anyone. These gates mean an anonymous visitor never receives a dashboard
 * document at all.
 * ------------------------------------------------------------------ */
const PAGE_ROUTES = [
  { path: '/', file: 'index.html', access: 'public' },

  // Unified login portal — both teachers and students sign in here
  { path: '/login', file: 'login.html', access: 'public' },

  { path: '/teacher/dashboard', file: 'teacher-dashboard.html', access: 'teacher' },
  { path: '/teacher/students', file: 'teacher-students.html', access: 'teacher' },
  { path: '/teacher/materials', file: 'teacher-materials.html', access: 'teacher' },
  { path: '/teacher/attendance', file: 'teacher-attendance.html', access: 'teacher' },
  { path: '/teacher/notices', file: 'teacher-notices.html', access: 'teacher' },

  { path: '/student/dashboard', file: 'student-dashboard.html', access: 'student' },
  { path: '/student/materials', file: 'student-materials.html', access: 'student' },
  { path: '/student/profile', file: 'student-profile.html', access: 'student' }
];

/** Reads the current session user, if any. */
function currentUser(req) {
  return req.session && req.session.user ? req.session.user : null;
}

/**
 * Cache of page HTML with the security helper injected, keyed by absolute path.
 * Reading and rewriting a file on every request would be wasteful, so the
 * transformed copy is kept in memory. Cleared on restart, which is fine for a
 * development workflow.
 */
const pageCache = new Map();
const SECURITY_HELPER_TAG = '<script src="/app-security.js"></script>';

/**
 * Sends an HTML page with the CSRF helper script injected before </head>.
 *
 * Doing this on the server means the protection applies to every page, including
 * any page added later, with no chance of a page being forgotten.
 */
function sendPageWithSecurityHelper(res, filePath, next) {
  let html = pageCache.get(filePath);

  if (html === undefined) {
    let raw;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      return next(err);
    }

    if (raw.includes(SECURITY_HELPER_TAG)) {
      html = raw; // already wired up by hand
    } else if (raw.includes('</head>')) {
      html = raw.replace('</head>', `  ${SECURITY_HELPER_TAG}\n</head>`);
    } else {
      // No <head>: prepend so the guard installs before any page script runs.
      html = SECURITY_HELPER_TAG + '\n' + raw;
    }

    pageCache.set(filePath, html);
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(html);
}

PAGE_ROUTES.forEach(({ path: routePath, file, access }) => {
  app.get(routePath, (req, res, next) => {
    const user = currentUser(req);

    if (access !== 'public') {
      if (!user) {
        logSecurityEvent('page_access_denied', req, { route: routePath, reason: 'unauthenticated' });
        // There is one unified sign-in page; send the visitor straight to it rather
        // than to a role-specific login route that no longer exists.
        return res.redirect(302, '/login');
      }
      if (user.role !== access) {
        // A logged-in user asking for the other role's page is sent to their own.
        logSecurityEvent('page_access_denied', req, {
          route: routePath,
          reason: 'wrong_role',
          actualRole: user.role
        });
        return res.redirect(302, `/${user.role}/dashboard`);
      }
    } else if (user) {
      // Already signed in: skip the marketing/login pages.
      if (routePath === '/' || routePath === '/login') {
        return res.redirect(302, `/${user.role}/dashboard`);
      }
    }

    // Authenticated pages must never be cached by a shared or browser cache.
    if (access !== 'public') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
    }

    const filePath = path.join(publicDir, file);
    if (fs.existsSync(filePath)) {
      // Inject the CSRF helper so every page gets it without editing each file.
      return sendPageWithSecurityHelper(res, filePath, next);
    }
    return res.status(200).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>College Study Portal</title>
      </head>
      <body>
        <h1>College Study Portal</h1>
        <p>Route: <code>${routePath}</code></p>
        <p>File <code>${file}</code> will be served when created.</p>
      </body>
      </html>
    `);
  });
});

/* Backward-compatibility redirects: old login URLs → unified portal */
app.get('/teacher/login', (req, res) => res.redirect(302, '/login'));
app.get('/student/login', (req, res) => res.redirect(302, '/login'));

/* ------------------------------------------------------------------ *
 * 404 and error handling
 * ------------------------------------------------------------------ */

// Unknown paths: JSON for the API, a short message for pages.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: 'Not found.' });
  }
  return res.status(404).type('txt').send('Not found');
});

// Centralized error handling. Internal details are logged, never returned.
app.use((err, req, res, next) => {
  console.error('Unhandled application error:', err);

  // Multer reports oversized uploads and unexpected fields as known error types.
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      error: 'That file is too large. The maximum upload size is 25 MB.'
    });
  }
  if (err && (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT')) {
    return res.status(400).json({ success: false, error: 'Unexpected file upload.' });
  }
  // Body-parser rejects malformed or oversized JSON.
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({ success: false, error: 'Request body is too large.' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: 'Malformed JSON in request body.' });
  }

  if (res.headersSent) {
    return next(err);
  }

  logSecurityEvent('unhandled_error', req, { message: String(err && err.message).slice(0, 200) });

  if (req.path.startsWith('/api/')) {
    return res.status(500).json({
      success: false,
      error: 'An unexpected internal server error occurred.'
    });
  }
  return res.status(500).type('txt').send('Internal server error');
});

/* ------------------------------------------------------------------ *
 * Start
 * ------------------------------------------------------------------ */
const server = app.listen(PORT, () => {
  console.log('===============================================');
  console.log(` College Study Portal Server Running on port ${PORT}`);
  console.log(` Local URL: http://localhost:${PORT}`);
  console.log(` Mode: ${security.isProduction ? 'production' : 'development'}`);
  console.log(' Security: helmet/CSP, CSRF, rate limiting, session store active');
  console.log('===============================================');
  if (!security.isProduction) {
    console.log(
      '[security] Development mode: cookies are not HTTPS-only and HSTS is off.\n' +
        '           Set NODE_ENV=production with a real SESSION_SECRET before deploying.'
    );
  }
});

// Close the DB and session store cleanly so WAL data is checkpointed.
function shutdown(signal) {
  console.log(`\nReceived ${signal}, shutting down...`);
  server.close(() => {
    try {
      app.locals.sessionStoreCleanup && app.locals.sessionStoreCleanup();
      db.close();
    } catch (err) {
      console.error('Error during shutdown:', err.message);
    }
    process.exit(0);
  });
}
['SIGINT', 'SIGTERM'].forEach((sig) => process.on(sig, () => shutdown(sig)));

module.exports = { app, server };
