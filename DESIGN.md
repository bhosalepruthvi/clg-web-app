# Design Guide — College Study Portal

This document describes the design system, every page, how each page flows, and
every animation, **as the code actually implements it today**. It records what
exists rather than proposing something new. Where a behaviour is a known weakness
it is called out rather than presented as a feature.

Every statement below was taken from the page sources in `public/`. Line references
point at the file where the real value lives.

---

## 1. Summary

| | |
|---|---|
| Pages | **11** (1 landing, 2 login, 5 teacher, 3 student) |
| Styling | Tailwind CSS via the Play CDN, configured per page |
| Font | Inter (Google Fonts), weights 300–900 |
| Formally defined animations | **5** |
| Micro-interactions | 7 patterns |
| Pages with demo-data fallbacks | **6** |

---

## 2. Design principles the code follows

1. **Role separation is visual, not just logical.** Teacher pages use a slate/white
   content surface; student pages keep the same sidebar but use a blue accent for the
   active item and softer slate backgrounds. A user can tell which portal they are in.
2. **Glass over gradient.** Public pages use frosted glass cards floating on a navy
   gradient with blurred colour blobs. Authenticated pages drop the glass for solid
   white cards on `#f1f5f9`, because dense data needs contrast.
3. **The toast is the single feedback channel.** Every page defines `showToast()` and
   every async action ends in one. There is no other global notification mechanism.
4. **Modals are always scale-in.** All 5 modals on 4 pages use the identical
   `animate-modal` keyframe, so the interaction feels the same everywhere.
5. **Loading is a spinner, never a skeleton.** 18 `animate-spin` instances and no
   skeleton screens. Each async button hides a `*-spinner` element until needed.

---

## 3. Visual language

### 3.1 Colour tokens

Defined in the `tailwind.config` script block that every one of the 11 pages
repeats ([index.html:13–35](public/index.html#L13-L35)):

| Token | Hex | Used for |
|---|---|---|
| `primary` | `#1e3a5f` | Sidebar background, primary buttons, headings |
| `primary-dark` | `#14273e` | Primary button hover |
| `primary-light` | `#2d5485` | Occasional secondary emphasis |
| `accent` | `#3b82f6` | Active states, links, focus rings |
| `success` | `#10b981` | Present attendance, positive stats |
| `warning` | `#f59e0b` | 65–74% attendance band |
| `danger` | `#ef4444` | Absent, delete actions, <65% band |
| `background` | `#f1f5f9` | Authenticated page canvas |

Note: the hex values are also hard-coded directly in classes (`bg-[#1e3a5f]`,
`text-[#14273e]`) throughout the pages, so **the tokens and the markup can drift**.
Changing the brand colour means editing the config *and* the bracketed classes.

### 3.2 Attendance colour bands

A single helper decides every attendance colour on all three student pages
(`getAttendanceStatusColor`, [routes/student.js:19](routes/student.js#L19)):

| Percentage | Colour | Meaning |
|---|---|---|
| ≥ 75% | green (`success`) | Safe |
| 65–74% | amber (`warning`) | At risk |
| < 65% | red (`danger`) | Detention risk |

The threshold lives on the server, so the colour and the number can never disagree.

### 3.3 Typography

- Family: `Inter, sans-serif` on `<body>` of every page.
- Loaded from Google Fonts, weights 300/400/500/600/700/800/900.
- Scale in practice: page title `text-2xl`, section heading `text-lg`, card title
  `text-sm font-bold`, body `text-sm`, meta `text-xs`, stat number `text-3xl`.
- Numerals that must align (roll numbers, percentages) use `font-mono`.
- The student login code input is `text-xl font-mono uppercase tracking-widest`
  ([student-login.html:118](public/student-login.html#L118)) so it reads as a code.

### 3.4 Surfaces and depth

| Class | Effect | Pages |
|---|---|---|
| `.glass-nav` | `rgba(30,58,95,0.85)` + `blur(12px)` | `index.html` |
| `.glass-card` | `rgba(255,255,255,0.96–0.98)` + `blur(16px)` | landing, both logins |
| `.glass-sidebar` | Solid `#1e3a5f` (name is historical — **not** translucent) | 5 teacher pages |
| `.glow-effect` | `box-shadow: 0 0 50px -10px rgba(59,130,246,0.35)` | `index.html` portal cards |
| `.custom-scrollbar` | 6px thumb `#cbd5e1` on `#f1f5f9` | teacher pages |

The two login/landing pages also render ambient decoration: fixed blurred circles
(`blur-3xl`, opacity 25–30%) and a radial dot grid
([teacher-login.html:54–60](public/teacher-login.html#L54-L60)).

### 3.5 Shape and spacing

- Radii: cards `rounded-2xl`, modals `rounded-3xl`, inputs and buttons `rounded-xl`,
  pills and badges `rounded-lg` or `rounded-full`.
- Page container: `max-w-7xl mx-auto`, content padding `p-4 sm:p-6 lg:p-8`.
- Vertical rhythm between sections: `space-y-6`.
- Cards: `bg-white border border-slate-200 shadow-sm hover:shadow-md`.
- Every interactive element carries `cursor-pointer`.

---

## 4. Component inventory

| Component | Specification | Where |
|---|---|---|
| **Sidebar** | Fixed `lg:sticky`, `w-64` (student pages `w-72`), `#1e3a5f`; `-translate-x-full` below `lg`, slides in with a `bg-slate-900/60` backdrop | 8 dashboard pages |
| **Nav item** | Active: `bg-blue-600 text-white shadow-md`; inactive: `text-blue-100/80 hover:bg-white/10` | all sidebars |
| **Sticky header** | White, `animate-pulse` green dot + date/greeting | all dashboards |
| **Stat card** | `rounded-2xl p-6`, label `text-xs`, value `text-3xl font-bold`, coloured icon tile | teacher dashboard, student dashboard |
| **Data table** | Header `bg-slate-50`, rows `hover:bg-slate-50`, dividers `border-slate-100` | students, attendance, profile history |
| **Card grid** | `grid sm:grid-cols-2 lg:grid-cols-3 gap-5` | materials (both roles) |
| **Modal** | Overlay `bg-slate-900/60 backdrop-blur-sm`; panel `rounded-3xl animate-modal`, max-w `sm`/`md`/`lg` | 5 modals, 4 pages |
| **Toast** | Top-right stack, `rounded-xl shadow-xl`, enters from `translate-y-2 opacity-0` | all 11 pages |
| **Accordion** | Subject-grouped, arrow rotates `rotate-180` | student materials |
| **Progress bar** | Track `bg-slate-100`, fill animates width over 500ms | student profile |
| **Circular gauge** | SVG ring, `stroke-dashoffset` animated over 0.8s | student profile |
| **PDF preview** | Full-screen `bg-slate-900/80`, title bar + download + iframe | student dashboard, student materials |
| **Empty state** | Centred icon, heading, one-line hint, optional CTA | all list pages |
| **Upload dropzone** | `border-2 border-dashed`, `hover:border-blue-500` | teacher materials |

---

## 5. Page map

```
/                                index.html            public
├── /teacher/login               teacher-login.html    public
│   └── /teacher/dashboard       teacher-dashboard.html   (teacher)
│       ├── /teacher/students    teacher-students.html    (teacher)
│       ├── /teacher/materials   teacher-materials.html   (teacher)
│       ├── /teacher/attendance  teacher-attendance.html  (teacher)
│       └── /teacher/notices     teacher-notices.html     (teacher)
└── /student/login               student-login.html     public
    └── /student/dashboard       student-dashboard.html   (student)
        ├── /student/materials   student-materials.html   (student)
        └── /student/profile     student-profile.html     (student)
```

All 8 non-public pages are gated **server-side** in `server.js`: an anonymous
request is redirected to the matching login page, and a user with the wrong role is
redirected to their own dashboard.

---

## 6. Page-by-page design and flow

### 6.1 `index.html` — Landing (public)

**Purpose:** explain the portal and route each visitor to the correct login.

**Layout:** fixed glass nav → hero with a pulsing badge and headline → `#portal-access`
two role cards → `#features` four feature cards → `#benefits` four benefit cards →
footer. Anchors `#portal-access`, `#features`, `#benefits` are the nav targets.

**Flow:** `handleTeacherLink()` / `handleStudentLink()` →
`/teacher/login` or `/student/login`. If already signed in, `server.js` redirects
straight to the right dashboard.

**Motion:** portal cards lift (`hover:-translate-y-1.5`), icon tiles scale to 110%
(`group-hover:scale-110`), CTA arrow nudges right (`group-hover:gap-3`), hero badge
uses `animate-pulse`.

---

### 6.2 `teacher-login.html` — Teacher sign-in (public)

**Purpose:** one page, two modes: Log in and Register, via `switchTab()`.

**Layout:** glass card on the gradient, tab strip, then the login form (email,
password with show/hide) or the register form (name, email, password, subject
chips via `updateSelectedSubjects()` / `getSelectedSubjects()`).

**Flow:**
1. `handleLoginSubmit()` → `POST /api/auth/teacher/login` → toast → redirect via
   `getDashboardUrl()`.
2. `handleRegisterSubmit()` → `POST /api/auth/register` → auto-login → dashboard.
3. A link switches to the student portal (`handleStudentLink()`).

**Motion:** the active tab has a white pill with shadow; the inactive tab is
`text-slate-500`; form panels use `animate-fade-in`; spinners appear inside the
submit buttons.

---

### 6.3 `student-login.html` — Student sign-in (public)

**Purpose:** a **three-step** wizard, because students have no password until first
login.

**Layout:** glass card with three mutually exclusive panels:
`step-code-form` → `step-password-form` → `step-setup-form`.

**Flow:**
1. **Code.** `handleCodeSubmit()` → `POST /api/auth/student/login` with `{ code }`.
2. Branch on the response:
   - `firstLogin: true` → show `step-setup-form`; the code is echoed into
     `display-setup-code`.
   - otherwise → show `step-password-form`; code echoed into
     `display-verified-code`.
3. **Set password** `handlePasswordSetup()`, or **sign in**
   `handlePasswordLogin()`. Each step has a "back" link calling `resetToCodeStep()`.
4. Helpers: `togglePasswordVisibility()`, `showAlert()` / `hideAlert()`
   (step-scoped inline error), `showToast()`.

**Why three steps:** it matches the backend exactly — the same endpoint answers with
`firstLogin: true` when no password is set, so the UI never guesses.

**Motion:** each step change plays `animate-fade-in`; the Continue button's arrow
translates on hover while a spinner takes over during the request.

---

### 6.4 `teacher-dashboard.html` — Teacher overview (teacher)

**Purpose:** at-a-glance counts plus recent activity.

**Layout:** sidebar + sticky header with greeting/date → 3 stat cards (students,
materials, notices) → quick-action tiles → recent-activity list.

**Flow:** `DOMContentLoaded` → `loadDashboard()` → `GET /api/teacher/dashboard` →
`updateTeacherUI()` + `renderDashboardData()` → `renderActivities()`.
If the request fails, `renderFallbackDashboard()` shows demo figures rather than an
empty page (see §8).

**Motion:** stat cards raise their shadow on hover; quick-action icon tiles scale to
105% and their headings change colour; spinners during load.

---

### 6.5 `teacher-students.html` — Student management (teacher)

**Purpose:** create students and manage their login codes.

**Layout:** filter bar (year, division, search) → students table → three modals:
`modal-add-student`, `modal-bulk-students`, `modal-delete-confirm`.

**Flow:**
1. `loadStudents()` → `GET /api/teacher/students` → `renderStudentsTable()`.
2. Add one: `openAddModal()` → `handleCreateStudent()` →
   `POST /api/teacher/students`.
3. Add many: `openBulkModal()` → `handleBulkCreate()` (paste a list).
4. Copy a code: `copyCode(code, btn)` — the button confirms.
5. Regenerate: `promptRegenerateCode()` →
   `POST /api/teacher/students/:id/regenerate-code` — resets the student to
   first-login state.
6. Delete: `confirmDeleteStudent()` → `executeDeleteStudent()` →
   `DELETE /api/teacher/students/:id`.
7. Filters are client-side via `applyFilters()` / `resetFilters()`.

**Motion:** modals scale in; the copy button swaps to a tick; table rows highlight on
hover; spinners inside both save buttons.

---

### 6.6 `teacher-materials.html` — Study material (teacher)

**Purpose:** publish a file **or** an external link, organised by year/subject.

**Layout:** filter bar → responsive card grid → `modal-upload`.

**Flow:**
1. `loadMaterials()` → `GET /api/teacher/materials` → `renderMaterialsGrid()`.
2. `openUploadModal()` → `toggleUploadMode('file'|'link')` switches the panel.
3. File mode: `handleFileSelect()` fills the dropzone; `handleUploadYearChange()`
   hints at the destination folder.
4. Submit: `handleUploadSubmit()` → `FormData` → `POST /api/teacher/materials/upload`
   → `GET`-style refresh.
5. Delete: `handleDeleteMaterial()` → `DELETE /api/teacher/materials/:id`.

**Design note:** the file/link toggle exists because the backend accepts either — a
`file_path` or a `link_url`. The card shows a type badge and icon from
`getFileTypeDetails()`.

**Motion:** modal scale-in; dropzone border turns blue on hover; card icon tiles
scale on hover; delete button turns red on hover.

---

### 6.7 `teacher-attendance.html` — Attendance (teacher)

**Purpose:** mark a class, then review and export the register. Two tabs in one page.

**Layout:** tab strip → `section-take` (year/division/subject/date, load roster,
mark all present/absent, per-student present/absent toggles, summary, submit) →
`section-view` (filters, records table, CSV export).

**Flow:**
1. `initDates()` sets today's date.
2. `switchAttendanceTab()` toggles `section-take` / `section-view`.
3. `loadStudentsForAttendance()` → `GET /api/teacher/attendance/students` →
   `renderRoster()`.
4. `setStudentStatus()` / `toggleAllAttendance()` → `updateRosterSummary()`.
5. `submitAttendance()` → `POST /api/teacher/attendance` (batch upsert).
6. Review: `loadAttendanceRecords()` → `renderAttendanceRecords()`.
7. `exportAttendanceCSV()` → `GET /api/teacher/attendance/export` (CSV download).

**Design note:** the per-student control is a two-button segmented toggle where the
active side is filled green (Present) or red (Absent) — faster to scan than a
checkbox and it makes the state unmistakable.

**Motion:** `section-take` and `section-view` both carry `animate-tab` (scale 0.98 →
1 over 200ms), so switching tabs re-plays a subtle entrance; the active tab is a
white pill; spinners on load and submit.

---

### 6.8 `teacher-notices.html` — Notices (teacher)

**Purpose:** post notices, optionally pinned and targeted to a year/division.

**Layout:** filter bar → notice card list (pinned first) → `modal-post-notice`.

**Flow:** `loadNotices()` → `renderNoticesList()`; `openNoticeModal()` →
`handlePostNotice()` → `POST /api/teacher/notices`; `handleDeleteNotice()` →
`DELETE /api/teacher/notices/:id`; `applyFilters()` / `resetFilters()`.

**Design note:** pinned notices are visually distinguished by an amber treatment
rather than only by ordering, so the pin is legible at a glance.

**Motion:** modal scale-in; card hover; spinners.

---

### 6.9 `student-dashboard.html` — Student overview (student)

**Purpose:** attendance at a glance, newest material, unread notices.

**Layout:** `w-72` sidebar → header → attendance banner → stat cards → recent
materials → `#notices-section` → `pdf-modal`.

**Flow:** `initDashboard()` → `GET /api/student/dashboard` → `updateAttendanceCard()`
(colour from the server band), `renderRecentMaterials()`, `renderNotices()`.
Helpers: `getInitials()`, `getFileTypeInfo()`, `formatDate()`.
Notices: `scrollToNotices()`, `toggleAllNoticesModal()`.
Preview: `openPdfPreview()` / `closePdfModal()`.

**Design note:** the unread-notice badge is a red `animate-ping` dot — the only
`animate-ping` in the app, reserved for "you have something new".

---

### 6.10 `student-materials.html` — Study material (student)

**Purpose:** find material by subject, unit or free text.

**Layout:** search bar → subject/unit/year filters → accordion grouped by subject →
`pdf-modal`.

**Flow:** `initMaterialsPage()` → `GET /api/student/materials` →
`renderFilteredMaterials()` / `renderMaterialCard()`. Filtering is **hybrid**:
`handleSearchDebounced()` (debounced) and `triggerFilterFetch()` ask the server,
while `filterClientSide()` narrows the loaded set. Accordion:
`toggleSubjectSection()`, `toggleExpandAll()`.
Helpers: `clearSearchInput()`, `resetAllFilters()`, `populateSubjectsDropdown()`.

**Design note:** the accordion is the organising idea — one subject open at a time,
with Expand All for power users.

**Motion:** the accordion arrow rotates 180°; the panel reveals; cards hover; the PDF
modal fades in via `animate-fade-in`.

---

### 6.11 `student-profile.html` — Profile and attendance history (student)

**Purpose:** identity, login code, and a full attendance breakdown.

**Layout:** profile card → circular gauge → `attendance-status-banner` → subject
breakdown with bars → history table with filters. Has `window.print()` for a
printable record.

**Flow:** `initProfilePage()` → `GET /api/student/profile` +
`GET /api/student/attendance` → `updateCircularGauge()`,
`renderSubjectBreakdown()`, `renderHistoryTable()`, `populateHistorySubjects()`.
Login code: `toggleLoginCodeVisibility()`, `copyLoginCode()`.
Table filter: `filterHistoryTable()`. Colour from `getAttendanceColorMeta()`.

**Motion:** the gauge and the subject bars animate width over 500ms — the most
substantial motion in the app, and the one that communicates the number.

---

## 7. Animations

### 7.1 Formally defined (5)

| # | Name | Definition | Duration / easing | Used by |
|---|---|---|---|---|
| 1 | `fadeIn` (rise) | `opacity 0→1`, `translateY(6px)→0` | 0.3s `cubic-bezier(.16,1,.3,1)` | `.animate-fade-in` — 7 uses, login step changes and PDF modal |
| 2 | `fadeIn` (modal) | `opacity 0→1`, `scale(.97)→1` | 0.2s `cubic-bezier(.16,1,.3,1)` | `.animate-modal` — 8 uses, all dialogs |
| 3 | `fadeIn` (tab) | `opacity 0→1`, `scale(.98)→1` | 0.2s `cubic-bezier(.16,1,.3,1)` | `.animate-tab` — 3 uses, attendance tabs |
| 4 | Sidebar slide | `-translate-x-full → translate-x-0` | 300ms `ease-in-out` | all 8 dashboards, below `lg` |
| 5 | Toast enter | `translate-y-2 opacity-0 → translate-y-0 opacity-100` | 300ms | `showToast()` on all 11 pages |

Names 1–3 are the same keyframe name (`fadeIn`) redefined with different transforms
in different pages, which is why they read as three behaviours rather than one.

The attendance gauge on the student profile animates on its own terms, declared as a
plain CSS transition rather than a keyframe
([student-profile.html:43](public/student-profile.html#L43)):

```css
transition: stroke-dashoffset 0.8s ease-in-out, stroke 0.4s ease-in-out;
```

At 0.8s it is the **slowest animation in the app** — deliberately, because it is
counting up to a number the student needs to read. The subject breakdown bars use a
separate 500ms width transition.

Definitions live in each page's `<style>` block — for example
[teacher-login.html:43–49](public/teacher-login.html#L43-L49) and
[teacher-materials.html:42–43](public/teacher-materials.html#L42-L43). They are
**duplicated per page rather than shared**, which is the main maintenance cost in the
current design.

Tailwind's own `animate-spin` (18 uses), `animate-pulse` (3) and `animate-ping` (1)
cover the remaining cases.

### 7.2 Micro-interactions (7 patterns)

| Pattern | Class | Where |
|---|---|---|
| Card lift on hover | `hover:-translate-y-1.5` | landing portal cards |
| Icon scale | `group-hover:scale-105` / `110` | sidebars, cards, quick actions |
| Arrow nudge | `group-hover:translate-x-1`, `group-hover:gap-3` | CTAs, Continue buttons |
| Row highlight | `hover:bg-slate-50` | every table |
| Button press | `active:scale-95` / `active:scale-[0.99]` | primary CTAs |
| Progress fill | `transition-all duration-500` | profile gauge and bars |
| Accordion arrow | `rotate-180 transition-transform duration-200` | student materials |

### 7.3 Animation conventions

1. **Two easings only.** Motion is either `cubic-bezier(.16,1,.3,1)` (entrances) or
   `ease-in-out` (the sidebar).
2. **Nothing exceeds 500ms** except the deliberately slow progress fill.
3. **Entrances are 200–300ms** — short enough to feel immediate.
4. **No page-transition animation.** Navigation is a full document load, so every
   dashboard simply appears. There is no fade between pages.
5. **Loading is always a spinner**, never a skeleton.
6. **No `prefers-reduced-motion` handling.** See §9.

---

## 8. Behaviour worth knowing: demo-data fallbacks

**6 of the 11 pages render demo content when an API call fails**:
`renderFallbackDashboard()`, `renderFallbackStudents()`,
`renderFallbackMaterials()`, `fallbackNotices()`, `fallbackRoster()`,
`fallbackAttendanceRecords()`.

Both login pages go further and simulate a session:
[student-login.html:481](public/student-login.html#L481) switches to "interactive
demo mode" and toasts `Demo Mode: Login successful!`; teacher login does the same at
[teacher-login.html:512](public/teacher-login.html#L512).

**Why this matters for a demonstration, and what it does *not* do:**

- It is genuinely useful for demoing the UI without a working server — the pages
  look populated instead of empty.
- It **cannot create a real session.** Every dashboard API is protected, so after a
  simulated login the next request still returns `401` and the page redirects to the
  login screen. The fallback affects appearance, not access.
- The `fallback*` renderers show **invented data**, which can be mistaken for real
  records in a screenshot.

If you present this project, either run the server with real data, or say plainly
that the numbers on screen are demo values. The two login pages' simulated-login
toasts are the most misleading part and are worth removing before a graded demo.

---

## 9. Known design limitations

1. **The Tailwind config and all custom CSS are duplicated in all 11 pages.** The
   only shared asset is the security helper. A design-token change is an 11-file edit
   — this is the single highest-value refactor available.
2. **Tailwind is loaded from the Play CDN**, which compiles in the browser. This
   forces `'unsafe-eval'` into the Content-Security-Policy
   (see `SECURITY.md` §8) and adds a runtime cost. A build step fixes both.
3. **No `prefers-reduced-motion` support.** Users who ask their OS for reduced motion
   still get every animation. Adding a media query that zeroes durations would be a
   small, high-value accessibility win.
4. **No dark mode.** The palette is light-only apart from the dark navy sidebar.
5. **Colour contrast is thin in places:** `text-blue-100/80` on `#1e3a5f` for
   inactive sidebar items and `text-slate-400` meta text are both borderline for
   WCAG AA. Worth checking with a contrast tool.
6. **Icons are inline SVG throughout**, with sizes repeated per use. There is no icon
   component, so a size change is a find-and-replace.
7. **No page-transition animation.** Every navigation is a full reload, so the app
   feels like separate documents rather than one product.
8. **Attendance colour bands are server-driven**, which is correct, but the client
   `getAttendanceColorMeta()` duplicates the thresholds — the two could drift.
9. **Spinners replace content rather than overlaying it**, so lists briefly collapse
   and reflow while loading.
10. **The landing page's ambient blobs are `blur-3xl` fixed layers**, which are
    GPU-expensive on low-end laptops and mobile.

---

## 10. Where the design lives

| Concern | File |
|---|---|
| Colour tokens, font | `public/index.html` lines 13–35 (repeated per page) |
| Glass and glow classes | `public/index.html` lines 36–51 |
| Sidebar + scrollbar styling | `public/teacher-dashboard.html` lines 36–60 |
| Animation keyframes | `public/teacher-login.html`, `teacher-materials.html`, `teacher-attendance.html` |
| Toast styling | `showToast()` in every page |
| Attendance colour rule | `routes/student.js` line 19 |
| Page routing and access gates | `server.js` `PAGE_ROUTES` |
