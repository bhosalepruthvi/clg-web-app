# Security Guide — College Study Portal

This document describes every security control in the application, how to configure
it, what was verified, and the known limitations that remain.

---

## 1. Quick start

```bash
npm install
npm start
```

For local development that is all you need. Before deploying anywhere, read
section 3 (Configuration) — the application will refuse to start in production
without a session secret.

To check the security controls on your own machine:

```bash
npm run test:security   # CSRF, headers, cookie flags, page gates
npm test                # the project's API test suite
```

Both are described in section 7.

---

## 2. What is protected, and how

| Threat | Control | Where |
|---|---|---|
| Cross-site scripting (XSS) | Strict CSP, `nosniff`, input length caps | `server.js`, `helmet` |
| Clickjacking | `frame-ancestors 'none'`, `X-Frame-Options: DENY` | `server.js` |
| Cross-site request forgery | Session-bound double-submit CSRF token on every mutating request | `middleware/csrf.js` |
| Session hijacking via XSS | Session cookie is `HttpOnly` | `middleware/security-config.js` |
| Session fixation | Session ID regenerated on every login | `routes/auth.js` |
| Password cracking | bcrypt with cost 12 | `routes/auth.js` |
| Weak passwords | Length, character-class and blocklist policy | `middleware/security-events.js` |
| Credential brute force | Per-IP limiter + per-account lockout | `middleware/rate-limiters.js` |
| Account enumeration | Identical "invalid credentials" response for unknown vs wrong | `routes/auth.js` |
| Malicious file upload | Extension + MIME allow-list, generated filenames | `routes/teacher.js` |
| Stored XSS via uploads | Uploads served as `attachment` with a sandbox CSP | `server.js` |
| `javascript:` / `data:` links | Link protocol allow-list (http/https only) | `routes/teacher.js` |
| Path traversal | Path segments sanitised; delete resolves inside `uploads/` | `routes/teacher.js` |
| Insecure direct object reference | Every query scoped to the session's own id | `routes/*.js` |
| Data exposure via page URLs | Server-side session gate on all dashboard pages | `server.js` |
| Data exposure via source files | Only `public/` is served; DB and server code unreachable | `server.js` |
| Session loss on restart | SQLite-backed session store | `middleware/session-store.js` |
| Unbounded request bodies | JSON/urlencoded limits, 25 MB upload cap | `server.js` |
| Information leakage in errors | Generic messages to clients, detail to the log only | `server.js` |

---

## 3. Configuration

All settings live in `middleware/security-config.js`. Environment variables:

| Variable | Required | Purpose |
|---|---|---|
| `SESSION_SECRET` | **In production** | Signing key for session cookies. Minimum 32 characters. |
| `NODE_ENV` | Recommended | `production` enables `Secure` cookies and HSTS, and makes a missing `SESSION_SECRET` fatal. |
| `TRUST_PROXY` | Behind a proxy | Set to `1` so rate limiting sees real client IPs, not the proxy. |
| `SESSION_HOURS` | No | Session lifetime in hours. Default `168` (7 days). |
| `PORT` | No | HTTP port. Default `3000`. |
| `DB_PATH` | No | Path to the SQLite file. Default `./portal.db`. |
| `UPLOADS_DIR` | No | Upload directory. Default `./uploads`. |
| `SECURITY_LOG_FILE` | No | `1` also writes security events to `logs/security.log`. |

Generate a session secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Deployment checklist

1. Set `NODE_ENV=production`.
2. Set `SESSION_SECRET` to a freshly generated 48-byte value.
3. Serve over HTTPS and set `TRUST_PROXY=1` if a reverse proxy terminates TLS.
4. Ensure the database file **and its folder** are writable by the server account.
   The session store creates its table at startup and the server **fails fast**
   with an explanatory error if it cannot, rather than silently losing sessions.
5. Keep `portal.db`, `uploads/` and `.env` out of version control (see `.gitignore`).

---

## 4. CSRF: how it works here

The token uses the **signed double-submit cookie** pattern:

1. On any request, if the session has no token, one is generated with
   `crypto.randomBytes(32)` and stored in the session.
2. The same value is mirrored into a **readable** `csrf_token` cookie.
3. Every `POST`/`PUT`/`PATCH`/`DELETE` must send it back in the `X-CSRF-Token`
   header. The header and session values are compared with
   `crypto.timingSafeEqual`.
4. Mismatch or absence returns `403` with code `CSRF_INVALID` / `CSRF_NO_SESSION`.

An attacker on another origin can cause the browser to send the cookie, but cannot
read it to fill in the header, and cannot read the session-stored value.

### For frontend pages

Instead of adding a `<script>` tag to each of the eleven pages, `server.js` injects
the helper before `</head>` as each page is served (`sendPageWithSecurityHelper`).
That means a page added later is protected automatically, and no page can be
forgotten. The transformed HTML is cached in memory, so **editing a page requires a
server restart** to be picked up. A page that already contains the tag is left
untouched, so you can also add it by hand if you prefer.

`public/app-security.js` is injected into every page by `server.js`. It:

- exposes `window.PortalSecurity.jsonHeaders()` for JSON `fetch` calls;
- exposes `window.PortalSecurity.csrfHeaders()` for `FormData` uploads
  (do **not** set `Content-Type` yourself — the browser must add the boundary);
- additionally wraps `fetch` so any same-origin mutating request carries the
  header automatically, which means existing page code keeps working unchanged.

### For scripts and API clients

A browser gets the cookie from the page it loads. A script must ask for it first:

```js
// 1. Handshake - sets the csrf_token cookie
await fetch('http://localhost:3000/api/auth/csrf', { credentials: 'same-origin' });

// 2. Read the cookie and send it back on state-changing requests
```

`test_backend.js` and `test_security.js` both demonstrate this handshake.

### Important: re-read the token after any request that changes the session

`POST /api/auth/logout` destroys the session, and login regenerates it. In both
cases the next request receives a **new** session and therefore a **new** CSRF
token. A browser handles this automatically because `app-security.js` reads
`document.cookie` on every call, but a scripted client that caches the token will
get a `403 CSRF_INVALID` after logging out or logging in.

The correct pattern for a script is to re-read the `csrf_token` cookie from every
response and use that value for the next request. `test_security.js` does this in
its `freshSession()` helper.

---

## 5. Password policy

Enforced server-side for teacher registration and student first-time setup
(`validatePassword` in `middleware/security-events.js`):

- at least 8 characters, at most 128;
- at least two of: lowercase, uppercase, digits, symbols;
- rejected if on the common-password blocklist.

### A note on student login codes

Student login codes are deliberately derived from year, division and roll number
(`SE-A-R101`) so a teacher can hand them out. That makes them **guessable**. The
password the student sets on first login is what actually protects the account, and
the login endpoint is rate limited and locks out after repeated failures. If you
need stronger protection, generate random codes instead of derived ones.

---

## 6. Rate limits and lockout

| Scope | Default | Window |
|---|---|---|
| Global (all requests) | 600 | 15 min |
| `/api/auth/*` | 20 | 15 min |
| Uploads | 40 | 15 min |
| CSV export | 30 | 15 min |
| Per-account login failures | 8, then 15 min lockout | 15 min |

Responses use `RateLimit-*` headers (draft-7). A tripped limiter returns `429`
with `code: RATE_LIMITED`.

`AUTH_RATE_LIMIT_OVERRIDE` raises the auth limit. It exists so an automated test
run can exercise login behaviour; leave it unset in normal use.

---

## 7. What was verified

Two suites ship with the project.

### `npm run test:security` — CSRF and hardening, 35 assertions

This one discovers every state-changing endpoint directly from `routes/*.js`, so a
new endpoint is covered automatically, and then proves against a live server that
each one refuses a request without a valid token:

```bash
npm run test:security
```

To keep real data untouched, point it at a copy and supply a teacher to check the
authenticated pages:

```bash
set DB_PATH=.\test.db
set UPLOADS_DIR=.\test-uploads
set SECURITY_TEST_EMAIL=you@college.edu
set SECURITY_TEST_PASSWORD=your-password
npm run test:security
```

Without `SECURITY_TEST_EMAIL`, the authenticated page checks are skipped rather
than creating a throwaway account.

It covers: route discovery, a valid session with no token rejected on all 12
mutating endpoints, the same request accepted once the matching token is supplied,
a scanner self-test proving the rejection is the CSRF layer and not a 404, wrong
vs. correct tokens, helmet headers and CSP, session cookie flags, CSRF-helper
injection on public and authenticated pages, and non-enumerable login failures.

### `npm test` — the project's own API suite, 39 assertions

```bash
npm test
```

Both suites pass. The full interactive security suite (107 assertions) was also run
against a live server, covering upload rejection for `.html`/`.svg`, acceptance of
`.pdf`, `javascript:` link rejection, uploads served as attachments, path traversal,
source-file exposure, cross-teacher IDOR, attendance ownership, first-login password
setup, read/unread notice accounting and account lockout.

Notes on the verification environment:

- Runs used a seeded copy of the database (`DB_PATH`) and a separate upload
  directory (`UPLOADS_DIR`) so real data was never touched.
- Four test-harness bugs and one real application bug were found and fixed during
  verification. The application bug: **after login the CSRF cookie was not
  re-issued**, which would have made every POST fail until the user reloaded the
  page. `establishSession` now re-issues the cookie in the login response.

---

## 8. Known limitations

These are real and worth stating plainly, especially for an academic project.

1. **`'unsafe-eval'` is required in the CSP** because the pages load the Tailwind
   Play CDN, which compiles CSS in the browser. Replacing it with a build step
   (`npx tailwindcss -o public/app.css`) would let you drop `unsafe-eval`.
2. **`'unsafe-inline'` is required for styles** because the pages use inline
   `<style>` blocks. Moving them to a stylesheet would remove it.
3. **The CSRF token is not bound to the session ID** beyond both living in the same
   session; this is the standard double-submit trade-off.
4. **API clients must re-read the token after login and logout**, because both
   operations change the session. See the note in section 4. Browser pages handle
   this automatically.
5. **Lockout counters are in memory**, so a restart grants an attacker a fresh
   budget. The counters are short-lived by design; a shared store would be needed
   for multi-process deployments.
6. **Rate limits use the in-memory store**, which is per-process. Behind multiple
   instances you would need a shared store.
7. **No email verification or password reset flow.** Students set their own password
   on first login; a teacher regenerates a code if it is lost.
8. **No audit table.** Security events go to stdout (and optionally a file). For a
   durable audit trail, write them to a database table.
9. **No 2FA.**
10. **The application itself does not terminate TLS.** `Secure` cookies and HSTS
    assume you deploy behind HTTPS.
11. **Upload contents are not virus-scanned.** Files are type-restricted and served
    as attachments, which limits the impact, but a document can still be malicious;
    scanning would need an external service.
12. **`'unsafe-eval'` and CDN assets mean the CSP is not as tight as it could be** —
    see items 1 and 2 for the fix.
13. **Page HTML is cached in memory** after security-helper injection. Editing a
    page requires a server restart; the cache is never invalidated at runtime.

---

## 9. Reporting a problem

This is a college project, not a production service. If you find a vulnerability,
open an issue describing the steps to reproduce it.
