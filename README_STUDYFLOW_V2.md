# StudyFlow — campus notebook release

StudyFlow gives each student a class/batch-specific reading shelf, attendance view,
notice board and planner. Faculty manage classes, students, attendance and materials
from a daily workspace. The active app is React + Express + Oracle; server.js and
public/ belong to the older SQLite application.

## Run locally

- `npm run preview` builds and serves the complete app at http://localhost:3000.
  This is the best way to test installation and offline behavior on localhost.
- For editing: `npm start` runs the backend; in another terminal run
  `npm run dev:frontend`, then visit http://localhost:5173.
- Without Oracle credentials/wallet, development uses `.local-data/studyflow.json`.
  It seeds a demo once and persists changes across restarts. Keep one server process
  per local store. This is a development adapter, not a production database.
- Demo faculty: `teacher@studyflow.dev` / `Teach#2026`.
- Demo student: `FE-E-E1-36` / `student123`.
- Local demo data and uploaded files are ignored by Git. Back them up if needed.
- Set LOCAL_DEV_MODE=0 to disallow fallback in development.

## What changed

- Ivory, forest green and apricot visual system; notebook-style landing page.
- Mobile bottom navigation, compact student overview, faculty daily workspace,
  responsive roster cards, touch-size buttons, focus styles and reduced motion.
- Password-based student login. Single/bulk enrollment returns random temporary
  passwords once. First login requires a new password. Teachers assigned to a
  student's division can reset credentials. Resets invalidate existing JWTs;
  protected student requests also refresh academic claims from the current record.
- PDF bytes require authentication and class/batch authorization, not just the
  material listing. The viewer loads authenticated blobs and provides download
  and open-in-new-tab fallbacks for mobile browsers.
- Explicitly saved PDFs in per-user device storage, recently opened materials,
  read/unread notices, visible connection errors and expired-session handling.
  Signing out clears saved files, recent items and read state on this device.
- Weekly timetable, room/batch targeting, assignments with deadlines, text/link
  submissions (late work marked), teacher submission review, attendance correction
  requests with approve/reject audit history. Approval records present status.
- Timetable and assignments can be archived/restored. Each item records the
  configured academic term. Existing classes/attendance are not automatically
  migrated into historical semesters.
- Configurable attendance target and term. Faculty registration in production
  requires the deployment's faculty invitation code.
- Optional notice notifications check every minute while the app is open and
  online. They do not provide server-push notifications after the app closes.
- PWA manifest, public-shell service worker, update prompt and saved-PDF offline
  support. APIs and automatic file downloads are never cached by the service worker.
- Lazy-loaded routes/workspaces and system fonts avoid the remote font dependency.

## Production upgrade (Oracle)

1. Back up your database and uploads.
2. For a fresh installation run `schema_studyflow_v2.sql`. For both new and existing
   v2 installations run `migrations/2026_campus.sql` once to add campus_items.
   Existing student password_hash/is_first_login columns must exist (included in
   the v2 schema). No existing academic rows are deleted by the migration.
3. Configure ORACLE_USER, ORACLE_PASSWORD, ORACLE_CONNECT_STRING and, if required,
   TNS_ADMIN. Configure a random JWT_SECRET of at least 32 characters. Set a private
   FACULTY_INVITE_CODE to permit new faculty registrations; leaving it unset closes
   public faculty registration. Existing faculty can still sign in.
4. Optionally set ATTENDANCE_TARGET (1–99, default 75), ACADEMIC_TERM,
   CAMPUS_TIMEZONE (default Asia/Kolkata), CORS_ORIGINS and PORT.
5. Existing students with no password must receive a faculty-issued reset from
   Student Directory → Reset login. Share invitations privately. Old student JWTs
   must sign in again after the security upgrade.
6. Run `npm run start:prod` behind HTTPS. This command enforces production mode;
   startup fails without a strong secret or working Oracle connection, and never
   falls back to demo data. Protect and back up the Oracle database and uploads.

The live Oracle migration/integration has not been executed by this change.

## Verification

- `npm run test:v2`: original backend regression suite plus campus/security tests.
- `npm run test:e2e`: builds the production frontend, starts an isolated temporary
  local store on port 4173, and runs desktop Chrome and Pixel 5 browser emulation.
  Checks login, navigation, timetable, assignment submission, responsive directory,
  and saved authenticated PDFs reopening after an offline reload.
- Screenshots: artifacts/ui/. Browser traces/report: test-results/, playwright-report/.
- No test seeds or deletes the real Oracle database. Live integration remains an
  explicit separate command and requires its own test Oracle instance.

## Android release checklist

Browser emulation is not a physical Android device test. Before rollout, test a
lower-end Android phone over a slow network: login and password setup, Back button,
keyboard, long rosters, large PDFs, install/update, saved-PDF offline access and
sign-out clearing local files. Installation/service workers need HTTPS except on
localhost; an HTTP LAN IP alone does not provide the full PWA experience.

The PDF preview uses the browser's PDF renderer; open/download is the fallback.
Assignments support text/links, with PDF/PNG/JPEG attachments added after saving a submission.
The new learning release below adds push support, administrator controls, and semester
history. Live deployment verification remains separate.

## Division discussions

Students have a Discussions tab with text posts, categories, threaded replies,
editing/deletion of their own messages, and reporting. Access is enforced using
current academic year, branch and division, across batches. Faculty assigned to
any class in that division can view reports and delete messages from their
Division discussions workspace. Deleted messages leave an empty placeholder.
Unread activity is stored per account on the device and cleared on sign-out;
the open discussion screen refreshes every 30 seconds. Attachments and push support are included in the learning release below.

Before starting against Oracle, run `migrations/2026_discussions.sql` once,
including for fresh installs. Local development creates its discussion storage
automatically. This migration has not been executed against a live Oracle instance.


## Learning release: assignments, exams, quizzes, administration and history

- Student Planner now includes a Learning centre: calendar, exams, results,
  practice quizzes, and semester history. Faculty have a Learning centre sidebar entry.
- Assignment and discussion attachments accept PDF, PNG and JPEG, validated by
  MIME type and file signature, up to 10 MB each and three per message/submission.
  Downloads require current authorization. Students first save an answer or link,
  then attach files to that submission. Files are forced downloads, not embedded HTML.
- Faculty can grade submissions, leave feedback and request resubmission.
  Changes to answers or files clear the previous grade. Stale grading requests fail.
- Exams have dates, rooms, maximum marks and private per-student results.
- Practice quizzes use four choices per question (up to 20 questions), server-side
  scoring and explanations after submission. Publishing locks the answer set.
- Calendar combines weekly classes, assignment deadlines, exams and faculty events.
- Administrator controls manage departments, faculty access and class ownership.
  Grant this capability to an EXISTING verified faculty account by setting
  ADMIN_TEACHER_IDS to its numeric ID (comma-separated for multiple admins).
  No faculty account is an administrator by default. Disabled faculty are rejected
  on protected requests, including sessions issued before disabling their access.
- Closing a term snapshots individual student attendance, submitted answer text,
  marks and quiz scores. Available materials and submission attachments are copied
  to private storage. It then archives planner/learning entries and starts the next
  term. Original academic records are retained. Current student attendance uses the
  new term's start date. Use the rollover during a quiet period; it is resumable
  per student/source record but is not a single Oracle transaction.
- Promote students separately after checking destination year/branch/division/batch.
  The new login code is returned. Existing sessions refresh their academic membership
  on the next request. Previous history stays tied to the student's stable ID.
- Student Notices includes an activity feed with discussion replies, upcoming
  assignment deadlines, exam results and assignment feedback.

### Database and file setup

Apply migrations/2026_learning.sql once, after 2026_campus.sql and
2026_discussions.sql. Fresh Oracle installations also need schema_studyflow_v2.sql.
Do not run seed_oracle.js against a database containing real data.
Private attachments and archived copies live in .local-data/private-files by default;
set PRIVATE_UPLOADS_DIR to persistent private storage in production. Back up both
this directory and UPLOADS_DIR alongside the database. Local development and tests
support these records without Oracle. Live Oracle migration has not been run.

### Optional closed-app Web Push

Run `node setup_push.js mailto:YOUR_REAL_CONTACT_EMAIL` once to generate VAPID keys
into the ignored .env file without printing them. Keep that key pair across restarts.
Restart the server, serve the production app via HTTPS (localhost works for testing),
and enable push from Notices → Activity & reminders. The running backend checks
once per minute; the browser need not remain open. Browser/OS permission, internet
access and a continuously running backend are required. Push payloads are generic;
students sign in to see details. Signing out unsubscribes the device. Delivery is
best-effort, with retry on later ticks and expired subscriptions removed. Run one
notification worker/server instance to avoid duplicate delivery. Live browser push
has not been verified in this local session; transport behavior is unit-tested with
a stub and no external messages are sent by the tests.

Verification: npm run test:v2 includes test_learning.js for access, grading,
files, exams, quizzes, admin controls, history and push validation. npm run test:e2e
covers desktop and Android-emulated upload/grading and quiz flows.

### Oracle setup verification — 1 November 2026

The configured StudyFlow Oracle database is connected. Its initially empty schema
now contains all 10 application tables, including the campus, discussion and
learning migrations. The production-mode backend startup and a database-backed
login query passed. No faculty/student accounts or demo data were inserted.
This supersedes the earlier notes that live migration had not been run; full
live feature testing and browser push delivery remain separate checks.

`node setup_oracle.js` creates missing objects from the four schema files while
preserving existing objects and data. It recognizes equivalent constraint indexes.
`node setup_oracle.js --check` checks their availability without applying DDL.
These commands do not upgrade the columns of an existing table.

The ignored `.env` supplies `ORACLE_PASSWORD`, `ORACLE_WALLET_PASSWORD`,
`ORACLE_CONNECT_STRING` and `TNS_ADMIN`. The wallet and `.env` must remain private.
