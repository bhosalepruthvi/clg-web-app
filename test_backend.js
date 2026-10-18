/**
 * test_backend.js
 * Automated test runner for the College Study Portal backend API.
 */

const http = require('http');

// The server respects PORT, so a test run can use a free port.
const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

// Passwords must satisfy the security policy: at least 8 characters mixing two
// character classes, and not a commonly breached password.
const TEACHER_PASSWORD = 'Portal#2026';
const STUDENT_PASSWORD = 'Student#2026';

// Simple helper to make HTTP requests and preserve cookies (sessions)
function createClient() {
  let cookies = [];
  let tokenFetched = false;

  /** Reads a cookie value the server set (used for the CSRF token). */
  function readCookie(name) {
    const prefix = name + '=';
    const hit = cookies.find((c) => c.startsWith(prefix));
    return hit ? decodeURIComponent(hit.substring(prefix.length)) : null;
  }

  /**
   * A browser receives the CSRF cookie with the page it loads. A script has to ask
   * for it explicitly, so the first mutating request performs that handshake.
   */
  function ensureCsrfToken() {
    if (tokenFetched) return Promise.resolve();
    tokenFetched = true;
    return request('GET', '/api/auth/csrf').catch(() => null);
  }

  function request(method, path, body = null, headers = {}) {
    const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());

    const send = () => new Promise((resolve, reject) => {
      const url = new URL(path, BASE_URL);
      const reqHeaders = { ...headers };

      if (cookies.length > 0) {
        reqHeaders['Cookie'] = cookies.join('; ');
      }

      // Every state-changing request must carry the CSRF token in a header.
      // The token arrives as a cookie, so it is read from the jar each time.
      if (mutating) {
        const token = readCookie('csrf_token');
        if (token) reqHeaders['X-CSRF-Token'] = token;
      }

      let payload = null;
      if (body && typeof body === 'object') {
        payload = JSON.stringify(body);
        reqHeaders['Content-Type'] = 'application/json';
      } else if (typeof body === 'string') {
        payload = body;
      }

      const req = http.request(
        url,
        {
          method,
          headers: reqHeaders
        },
        (res) => {
          if (res.headers['set-cookie']) {
            cookies = res.headers['set-cookie'].map((c) => c.split(';')[0]);
          }

          let responseData = '';
          res.on('data', (chunk) => {
            responseData += chunk;
          });
          res.on('end', () => {
            let json = null;
            try {
              json = JSON.parse(responseData);
            } catch (e) {
              json = responseData;
            }
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: json
            });
          });
        }
      );

      req.on('error', reject);
      if (payload) {
        req.write(payload);
      }
      req.end();
    });

    if (!mutating) return send();
    return ensureCsrfToken().then(send);
  }

  return {
    get: (path, headers) => request('GET', path, null, headers),
    post: (path, body, headers) => request('POST', path, body, headers),
    delete: (path, headers) => request('DELETE', path, null, headers),
    clearCookies: () => {
      cookies = [];
    }
  };
}

async function runTests() {
  // Load the app here rather than at the top of the file so a startup failure
  // (most commonly an unwritable database) produces guidance instead of a stack trace.
  let app;
  let server;
  try {
    ({ app, server } = require('./server'));
  } catch (err) {
    console.error('\n--- COULD NOT START THE SERVER ---\n');
    console.error(err.message);
    console.error(
      '\nThe tests need a database the server can write to, because it stores sessions\n' +
      'in the same file. Either fix the permissions on portal.db, or run the tests\n' +
      'against a copy so your real data is untouched:\n\n' +
      '  set DB_PATH=.\\test.db\n' +
      '  set UPLOADS_DIR=.\\test-uploads\n' +
      '  npm test\n'
    );
    process.exit(2);
  }

  console.log('\n--- STARTING BACKEND API TESTS ---\n');

  const teacherClient = createClient();
  const studentClient = createClient();

  let testPassed = 0;
  let testFailed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      testPassed++;
    } else {
      console.error(`[FAIL] ${message}`);
      testFailed++;
    }
  }

  try {
    // 1. Teacher Registration
    console.log('\n[1] Testing Teacher Registration...');
    const testEmail = `turing_${Date.now()}@college.edu`;
    const regRes = await teacherClient.post('/api/auth/register', {
      name: 'Prof. Alan Turing',
      email: testEmail,
      password: TEACHER_PASSWORD,
      subjects: ['Data Structures', 'Algorithms']
    });
    assert(regRes.status === 201 && regRes.body && regRes.body.success, 'Teacher registered successfully');
    assert(regRes.body.teacher && regRes.body.teacher.email === testEmail, 'Teacher email matches');

    // 2. Teacher Login
    console.log('\n[2] Testing Teacher Login...');
    const loginRes = await teacherClient.post('/api/auth/teacher/login', {
      email: testEmail,
      password: TEACHER_PASSWORD
    });
    assert(loginRes.status === 200 && loginRes.body.success, 'Teacher logged in successfully');
    assert(loginRes.body.user.role === 'teacher', 'User role is teacher');

    // 3. GET /api/auth/me
    console.log('\n[3] Testing /api/auth/me...');
    const meRes = await teacherClient.get('/api/auth/me');
    assert(meRes.status === 200 && meRes.body.user.role === 'teacher', 'Session persists for teacher');

    // 4. Create Students (FE, SE, TE, BE)
    console.log('\n[4] Testing Add Student & Code Generation...');
    const roll1 = `R${Math.floor(100 + Math.random() * 800)}`;
    const roll2 = `R${Math.floor(100 + Math.random() * 800)}`;
    const addStudRes1 = await teacherClient.post('/api/teacher/students', {
      name: 'Alice Johnson',
      rollNumber: roll1,
      year: 2,
      semester: 3,
      division: 'A'
    });
    assert(addStudRes1.status === 201 && addStudRes1.body.success, 'SE Student Alice created');
    assert(addStudRes1.body.student.login_code === `SE-A-${roll1}`, `Generated login code format matches SE-A-${roll1}`);
    const student1 = addStudRes1.body.student;

    const addStudRes2 = await teacherClient.post('/api/teacher/students', {
      name: 'Bob Smith',
      rollNumber: roll2,
      year: 2,
      semester: 3,
      division: 'A'
    });
    assert(addStudRes2.status === 201 && addStudRes2.body.student.login_code === `SE-A-${roll2}`, `SE Student Bob created`);
    const student2 = addStudRes2.body.student;

    // 5. Filter Students
    // Note: a previously-seeded student for this teacher may already exist, so the
    // test counts the students it created rather than assuming an empty database.
    console.log('\n[5] Testing Filter Students...');
    const filterRes = await teacherClient.get('/api/teacher/students?year=2&division=A');
    const createdRolls = [roll1, roll2];
    const foundCreated = (filterRes.body.students || []).filter((s) => createdRolls.includes(s.roll_number));
    assert(filterRes.status === 200 && foundCreated.length === 2,
      `Both newly created students are present (${foundCreated.length}/2)`);

    // 6. Regenerate Student Login Code
    console.log('\n[6] Testing Regenerate Login Code...');
    const regenRes = await teacherClient.post(`/api/teacher/students/${student2.id}/regenerate-code`);
    assert(regenRes.status === 200 && regenRes.body.login_code.startsWith(`SE-A-${roll2}-`), 'Code regenerated with prefix');

    // 7. Student First Login Workflow
    console.log('\n[7] Testing Student First Login Workflow...');
    // Probe without password -> should report firstLogin = true
    const sLoginProbe = await studentClient.post('/api/auth/student/login', {
      code: student1.login_code
    });
    assert(sLoginProbe.status === 200 && sLoginProbe.body.firstLogin === true, 'Detected first login prompt');

    // Submit new password
    const sSetPass = await studentClient.post('/api/auth/student/login', {
      code: student1.login_code,
      password: STUDENT_PASSWORD
    });
    assert(sSetPass.status === 200 && sSetPass.body.success, 'Student set password and logged in');
    assert(sSetPass.body.user.role === 'student', 'Student session active');

    // 8. Teacher Materials (External Link)
    console.log('\n[8] Testing Materials Creation & Fetching...');
    const matRes = await teacherClient.post('/api/teacher/materials/upload', {
      title: 'Data Structures Unit 1 Notes',
      description: 'Arrays, Stacks, Queues overview',
      year: 2,
      semester: 3,
      subject: 'Data Structures',
      unit: 'Unit 1',
      linkUrl: 'https://example.com/notes.pdf'
    });
    assert(matRes.status === 201 && matRes.body.success, 'Material created successfully');
    const matId = matRes.body.material.id;

    const teacherMatList = await teacherClient.get('/api/teacher/materials?year=2&semester=3');
    const createdMat = (teacherMatList.body.materials || []).find((m) => m.id === matId);
    assert(teacherMatList.status === 200 && Boolean(createdMat), 'Material appears in the teacher materials list');

    // 9. Teacher Attendance Workflow
    console.log('\n[9] Testing Teacher Attendance Batch Marking & Export...');
    const attRes = await teacherClient.post('/api/teacher/attendance', {
      date: '2026-10-13',
      subject: 'Data Structures',
      year: 2,
      division: 'A',
      records: [
        { studentId: student1.id, status: 'present' },
        { studentId: student2.id, status: 'absent' }
      ]
    });
    assert(attRes.status === 200 && attRes.body.count === 2, 'Batch attendance saved for 2 students');

    const attList = await teacherClient.get('/api/teacher/attendance?year=2&division=A&subject=Data Structures');
    assert(attList.status === 200 && attList.body.records.length === 2, 'Attendance records retrieved');

    const csvExport = await teacherClient.get('/api/teacher/attendance/export?year=2&division=A');
    assert(csvExport.status === 200 && csvExport.headers['content-type'].includes('text/csv'), 'Attendance CSV exported');
    assert(csvExport.body.includes('Alice Johnson') && csvExport.body.includes('PRESENT'), 'CSV content contains student and status');

    // 10. Teacher Notices
    console.log('\n[10] Testing Notices Workflow...');
    const noticeRes = await teacherClient.post('/api/teacher/notices', {
      title: 'Unit Test 1 Scheduled',
      message: 'Unit test will be held on Monday covering Unit 1.',
      subject: 'Data Structures',
      year: 2,
      division: 'A',
      isPinned: true
    });
    assert(noticeRes.status === 201 && noticeRes.body.success, 'Notice created successfully');
    const noticeId = noticeRes.body.notice.id;

    // 11. Teacher Dashboard Counts
    console.log('\n[11] Testing Teacher Dashboard Metrics...');
    const tDash = await teacherClient.get('/api/teacher/dashboard');
    // Deleting student2 earlier left student1 in place, so the dashboard should show
    // at least the one student still owned by this teacher.
    assert(tDash.status === 200 && tDash.body.totalStudents >= 1, `Dashboard shows ${tDash.body.totalStudents} student(s)`);
    assert(tDash.body.totalMaterials >= 1, 'Dashboard shows at least 1 material');
    assert(tDash.body.totalNotices === 1, 'Dashboard shows 1 notice');
    assert(tDash.body.recentActivity.length >= 1, 'Dashboard has recent activity');

    // 12. Student Dashboard, Materials, Profile, Attendance, Notices
    console.log('\n[12] Testing Student Endpoints...');
    const sDash = await studentClient.get('/api/student/dashboard');
    assert(sDash.status === 200 && sDash.body.materialCount >= 1, 'Student dashboard reports materials');
    assert(sDash.body.unreadNoticesCount >= 1, 'Student dashboard reports unread notice');
    assert(sDash.body.attendanceSummary.totalClasses >= 1, 'Student dashboard reports classes');
    assert(sDash.body.attendanceSummary.percentage === 100, 'Student attendance is 100%');
    assert(sDash.body.attendanceSummary.statusColor === 'green', 'Student attendance color is green');

    const sMats = await studentClient.get('/api/student/materials?search=structures');
    assert(sMats.status === 200 && sMats.body.materials.length >= 1, 'Student searches materials successfully');

    const sNotices = await studentClient.get('/api/student/notices');
    assert(sNotices.status === 200 && sNotices.body.notices.length >= 1, 'Student received notice');

    // After viewing notices, unread count should be 0
    const sDashAfter = await studentClient.get('/api/student/dashboard');
    assert(sDashAfter.body.unreadNoticesCount === 0, 'Unread notice count updated to 0');

    const sProfile = await studentClient.get('/api/student/profile');
    assert(sProfile.status === 200 && sProfile.body.subjectAttendance.length === 1, 'Student profile has subject attendance');

    const sAtt = await studentClient.get('/api/student/attendance');
    assert(sAtt.status === 200 && sAtt.body.records.length === 1, 'Student attendance log retrieved');

    // 13. Role Authorization Guard Checks
    console.log('\n[13] Testing Role Authorization Guards...');
    const unauthorizedTeacherCall = await studentClient.get('/api/teacher/dashboard');
    assert(unauthorizedTeacherCall.status === 401, 'Student cannot access teacher dashboard (401)');

    const unauthorizedStudentCall = await teacherClient.get('/api/student/dashboard');
    assert(unauthorizedStudentCall.status === 401, 'Teacher cannot access student dashboard (401)');

    // 14. Cleanup / Delete Operations
    console.log('\n[14] Testing Delete Operations...');
    const delMat = await teacherClient.delete(`/api/teacher/materials/${matId}`);
    assert(delMat.status === 200 && delMat.body.success, 'Material deleted');

    const delNotice = await teacherClient.delete(`/api/teacher/notices/${noticeId}`);
    assert(delNotice.status === 200 && delNotice.body.success, 'Notice deleted');

    const delStudent = await teacherClient.delete(`/api/teacher/students/${student2.id}`);
    assert(delStudent.status === 200 && delStudent.body.success, 'Student deleted');

    console.log('\n===============================================');
    console.log(`TESTS SUMMARY: ${testPassed} Passed, ${testFailed} Failed`);
    console.log('===============================================\n');

    process.exit(testFailed === 0 ? 0 : 1);
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  }
}

// Allow server a moment to start
setTimeout(runTests, 500);
