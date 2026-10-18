# StudyFlow v2 — Oracle + JWT + React

The current build of StudyFlow. Replaces the legacy SQLite/session stack
(`server.js` + `public/`, see the main [README](README.md)) with:

| Layer | Technology |
|---|---|
| Backend | Node.js + Express (`server_studyflow_v2.js`) |
| Database | Oracle Autonomous DB via `oracledb` connection pool |
| Auth | JWT (teachers: email + password, bcrypt; students: access code only) |
| Frontend | React 19 + Vite + Tailwind 4 (`react-frontend/`) |

## Data model

Academic hierarchy: `academic_year` (FE/SE/TE/BE) → `branch` (`Common` for FE,
CE/IT/etc. for the rest) → `division` (A–E) → `batch` (lab sub-group, e.g. E1) →
`roll_number`. Student access codes encode the whole path:

- `FE-E-E1-36` (FE students have no branch — it is implied `Common`)
- `FE-Common-E-E1-36` (explicit variant, parses identically)
- `SE-CE-A-A1-12`

A **Class** is a `Lecture` or a `Lab/Practical`; labs carry named batches in
`class_batches`. A **study material** upload targets a whole division
(`batch_target_id IS NULL`) or one specific lab batch. Students only ever see
materials matching their own JWT claims.

## Setup

1. **Create the schema.** Run [`schema_studyflow_v2.sql`](schema_studyflow_v2.sql)
   once against your Oracle database (SQL Worksheet in the OCI console, or SQLcl).

2. **Configure environment.** Copy `.env.example` to `.env` and set at minimum:

   ```bash
   ORACLE_USER=ADMIN
   ORACLE_PASSWORD=...
   ORACLE_CONNECT_STRING=studyflow_high
   TNS_ADMIN=./wallet        # folder containing the Autonomous DB wallet
   JWT_SECRET=...            # required in production; random in dev if unset
   ```

3. **Seed demo data** (idempotent — safe to re-run, nothing is deleted):

   ```bash
   npm run seed:oracle
   ```

   This creates a demo teacher, FE/SE demo students with access codes, and
   demo classes, and prints all credentials.

4. **Start the backend:**

   ```bash
   npm run start:v2          # http://localhost:3000
   ```

5. **Start the frontend** (new terminal):

   ```bash
   cd react-frontend
   npm install
   npm run dev               # http://localhost:5173, proxies /api and /uploads to :3000
   ```

## Demo credentials (from the seed script)

| Role | Credentials |
|---|---|
| Teacher | `teacher@studyflow.dev` / `Teach#2026` |
| Student (FE) | access code `FE-E-E1-01` … (see seed output) |
| Student (SE) | access code `SE-CE-A-A1-01` … (see seed output) |

## API overview

All endpoints except `/api/auth/*` require `Authorization: Bearer <JWT>`.

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| POST | `/api/auth/teacher/register` | public | Teacher self-registration |
| POST | `/api/auth/teacher/login` | public (rate-limited) | Teacher login → JWT |
| POST | `/api/auth/student/login` | public (rate-limited) | Student code login → JWT |
| GET | `/api/students` | teacher | Roster with optional year/branch/division/batch filters |
| POST | `/api/students` | teacher | Create one student (access code generated, returned once) |
| POST | `/api/students/bulk` | teacher | Create up to 200 students; per-row success/failure report |
| POST | `/api/classes` | teacher | Create Lecture or Lab/Practical with batches |
| GET | `/api/classes` | teacher | List own classes + batches |
| GET | `/api/classes/:id/students` | teacher | Roster for a class, optional `?batch=` filter |
| POST | `/api/attendance` | teacher (own classes) | Mark attendance — upserts on re-submission |
| GET | `/api/attendance/student` | student | Own attendance totals; `percentage` is `null` until records exist |
| POST | `/api/materials/upload` | teacher (own classes) | PDF upload (30 MB max, magic-byte verified) |
| GET | `/api/materials/teacher` | teacher | Own uploads |
| DELETE | `/api/materials/:id` | teacher (own) | Delete an upload and its file |
| GET | `/api/materials/student` | student | Materials scoped to own year/branch/division/batch |

## Testing

```bash
npm run test:v2                # full suite — no Oracle needed (DB is mocked)
npm run test:v2:integration    # also runs an end-to-end flow against your live
                               # Oracle DB (needs ORACLE_* env vars; mutates data)
```

The suite (`test_studyflow_v2.js`) boots the real Express app on an ephemeral
port and injects a mock query executor through the `setQueryExecutor()` seam,
so no database is required. It covers: helmet/rate-limit/upload headers, auth
validation, 401/403 gates, cross-teacher authorization, PDF magic-byte
rejection, file cleanup, attendance upsert semantics, and the fake-percentage
regression (student stats must return `percentage: null` until records exist).

## Production

```bash
npm run start:prod     # builds the SPA, then serves it from Express on $PORT
```

`start:prod` runs `build:frontend` (Vite build into `react-frontend/dist`)
and starts `start_prod.js`, which sets `SERVE_FRONTEND=1`:
`server_studyflow_v2.js` then serves the built SPA with an SPA fallback, so
one process serves API, uploads, and frontend.

Production env vars:

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | **Required.** Signs JWTs (min 32 chars recommended) |
| `NODE_ENV=production` | Standard signal for production mode |
| `SERVE_FRONTEND` | `1` = serve `react-frontend/dist` (set automatically by `start:prod`) |
| `CORS_ORIGINS` | Comma-separated allowed origins (defaults to the two localhost dev origins) |
| `UPLOADS_DIR` | Upload storage location (defaults to `./uploads`) |
| `PORT` | HTTP port (default 3000) |

Deploy steps: provision Oracle Autonomous DB, run `schema_studyflow_v2.sql`,
set the env vars above, then `npm ci && npm run start:prod`.

## Security notes

- `JWT_SECRET` is required in production; development uses an ephemeral random
  secret (tokens invalidate on restart).
- `/api/auth/*` is rate-limited (30 attempts / 15 min / IP by default;
  `AUTH_RATE_LIMIT_OVERRIDE` for test runs only).
- Uploads must be real PDFs (client MIME is not trusted — file header is
  verified) and are served with `Content-Type: application/pdf` +
  `X-Content-Type-Options: nosniff`.
- Teachers can only act on their own classes/materials (`teacher_id` is checked
  server-side on every mutation).

## Troubleshooting

- **Attendance submit fails with `ORA-00904: "ATTENDANCE_DATE"`** — your table
  was created with a different column name than
  [`schema_studyflow_v2.sql`](schema_studyflow_v2.sql). Rebuild the table from
  that file (or rename the column to `attendance_date`). Status values must be
  lowercase `present`/`absent`/`late` per the schema CHECK constraint.
- **`ORA-28000: account is locked`** — reset the database user password in the
  OCI console and update `ORACLE_PASSWORD`.
- **Wallet errors (`ORA-28759` etc.)** — check `TNS_ADMIN` points at the
  unzipped wallet folder and the wallet is for the right database.

## Legacy files

The superseded intermediate Oracle prototype and dead duplicates live in
[`_legacy/`](_legacy/) — safe to delete once v2 is verified working.
