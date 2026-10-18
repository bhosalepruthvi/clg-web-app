# College Study Portal

A web application for colleges that connects **teachers** and **students** in one
place: teachers publish study material, mark attendance and post notices; students
browse material, see their attendance and stay up to date with notices.

Built with **Node.js + Express** on the backend and **Tailwind CSS** on the frontend,
using **SQLite** for storage — a single-file database, so it runs anywhere with no
separate database server.

---

## Table of contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Running the tests](#running-the-tests)
- [Environment variables](#environment-variables)
- [How sign-in works](#how-sign-in-works)
- [Project structure](#project-structure)
- [Security](#security)
- [Design](#design)

---

## Features

**Teachers**

- Register an account and sign in with email + password
- Add students individually or in bulk; each gets an auto-generated login code
- Publish study material as a file upload or an external link, organised by
  year / semester / subject
- Mark attendance per class, review it, and export it to CSV
- Post notices targeted to a year and division (with pinning)

**Students**

- First-time setup: enter the code your teacher gave you, then set your password
- Dashboard with attendance summary, recent material and unread-notice count
- Browse material by subject, unit and free-text search
- Profile with an overall attendance gauge, subject-wise breakdown and history

**Platform**

- Role-based access: every page and API is scoped to the signed-in user
- Uploads validated by type and served as downloads (never rendered inline)
- Offline-capable via a service worker; installable as a PWA

---

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ (tested on Node 24) |
| Server | Express 4 |
| Database | SQLite via `better-sqlite3` |
| Sessions | `express-session` with a SQLite store |
| Styling | Tailwind CSS (see [Design](DESIGN.md)) |
| Security | Helmet, CSRF protection, rate limiting, bcrypt |
| Tests | Node's built-in test-free runner over HTTP (`test_backend.js`, `test_security.js`) |

---

## Getting started

### Prerequisites

- **Node.js 18+** — download from <https://nodejs.org>
- A terminal (PowerShell on Windows)

### Install

```bash
cd "D:\clg project web app"
npm install
```

### Run

```bash
npm start
```

Then open **http://localhost:3000** in your browser.

- Leave the terminal open — closing it stops the server.
- The server prints `Local URL: http://localhost:3000` when it is ready.
- On first run it creates the `portal.db` database file and the `uploads/` folder
  automatically.

To stop, press **Ctrl + C**.

### Other scripts

| Command | What it does |
|---|---|
| `npm start` | Start the server |
| `npm run dev` | Alias for `npm start` |
| `npm test` | Run the backend API test suite |
| `npm run test:security` | Run the security verification suite |
| `node seed_data.js` | Wipe the database and load demo data (**destructive** — see below) |

---

## Running the tests

```bash
npm test                 # backend API suite (39 assertions)
npm run test:security    # CSRF, headers, cookie flags, page gates (38 assertions)
```

Both suites start the app in-process and exercise it over HTTP.

> **To run tests without touching your real data**, point them at a scratch database
> first:
>
> ```powershell
> $env:DB_PATH = ".\test.db"
> $env:UPLOADS_DIR = ".\test-uploads"
> npm test
> ```
>
> The security suite can also check the authenticated pages if you give it a real
> account:
>
> ```powershell
> $env:SECURITY_TEST_EMAIL = "you@college.edu"
> $env:SECURITY_TEST_PASSWORD = "Your#Password"
> npm run test:security
> ```

---

## Environment variables

All are optional in development. **`SESSION_SECRET` is required in production** — the
server refuses to start without it. A ready-to-copy template is in
[`.env.example`](.env.example).

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `NODE_ENV` | — | `production` enables secure cookies, HSTS and stricter secret handling |
| `SESSION_SECRET` | random per boot | Signs session cookies (min 32 chars in production) |
| `SESSION_HOURS` | `168` | Session lifetime in hours (7 days) |
| `TRUST_PROXY` | — | `1` behind a reverse proxy so rate limiting sees real client IPs |
| `DB_PATH` | `./portal.db` | Location of the SQLite database |
| `UPLOADS_DIR` | `./uploads` | Where uploaded material is stored |
| `SECURITY_LOG_FILE` | — | `1` also writes security events to `logs/security.log` |
| `AUTH_RATE_LIMIT_OVERRIDE` | — | Raise the auth rate limit (for automated test runs only) |
| `SECURITY_TEST_EMAIL` | — | Teacher account for the security suite's page checks |
| `SECURITY_TEST_PASSWORD` | — | Password for the above account |

Generate a session secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## How sign-in works

There is one sign-in page: **`/login`**. It accepts both roles.

**Teacher** — enter the email and password set during registration.

**Student** — students never choose an initial password. The flow is:

1. Enter the **login code** your teacher generated (format like `SE-A-R101`).
2. If it is your first sign-in, you are asked to **set your own password**.
3. From then on, sign in with that code + password.

The student password policy requires at least 8 characters mixing two of: lowercase,
uppercase, numbers, symbols — and rejects common passwords. See
[SECURITY.md](SECURITY.md) for the full policy.

---

## Project structure

```
├── server.js                 Express app, page routes, security headers
├── database.js               SQLite connection + schema
├── seed_data.js              Demo-data seeder (DESTRUCTIVE — wipes all tables)
├── test_backend.js           Backend API test suite
├── test_security.js          Security verification suite
├── middleware/
│   ├── auth.js               Role guards (requireTeacher / requireStudent)
│   ├── csrf.js               Double-submit CSRF protection
│   ├── session-store.js      SQLite session persistence
│   ├── rate-limiters.js      IP limiters + per-account login lockout
│   ├── security-config.js    All security tunables in one place
│   └── security-events.js    Security logging + validation helpers
├── routes/
│   ├── auth.js               Registration, login, logout
│   ├── teacher.js            Teacher endpoints
│   └── student.js            Student endpoints
├── public/
│   ├── index.html            Landing page
│   ├── login.html            Unified sign-in
│   ├── teacher-*.html        Teacher pages
│   ├── student-*.html        Student pages
│   ├── app-security.js       Browser-side CSRF helper (injected into every page)
│   ├── manifest.json         PWA manifest
│   ├── service-worker.js     Offline caching
│   └── icons/                PWA icons
├── uploads/                  Uploaded study material (git-ignored)
├── SECURITY.md               Security guide
└── DESIGN.md                 Design system & page-by-page reference
```

---

## Security

The application ships with a hardening layer documented in
[**SECURITY.md**](SECURITY.md): helmet/CSP, CSRF protection, SQLite session store
with session rotation on login, rate limiting and account lockout, password
strength rules, upload validation and safe download headers, server-side page
gates, and security event logging.

The two test suites verify these controls:

- `npm run test:security` — discovers every state-changing endpoint and proves each
  requires a CSRF token, plus headers, cookie flags and page gates.
- `npm test` — the full teacher/student API flow.

---

## Design

The visual system — colours, typography, components, page flows and animations —
is documented in [**DESIGN.md**](DESIGN.md).

---

## Important notes

- **`seed_data.js` deletes every row** in the database before inserting demo data.
  It is for demos only. Do not run it against a database you care about.
- `portal.db`, `uploads/` and logs are **git-ignored** — they contain user data and
  must never be committed.
- The app fails loudly on startup if it cannot write to the database, rather than
  silently losing sessions. If you see `SQLITE_READONLY` at startup, check the file
  permissions on `portal.db`, `portal.db-wal` and `portal.db-shm`.
