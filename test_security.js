/**
 * test_security.js
 * Automated security verification for the College Study Portal.
 *
 * The test discovers every state-changing endpoint straight from the route files
 * (so a new endpoint is covered automatically) and then proves, against a live
 * server, that each one is rejected without a valid CSRF token.
 *
 * Run it with:  npm run test:security
 *
 * By default it starts its own server on PORT + 1 and uses the normal database.
 * To keep real data untouched, point it at a copy first:
 *
 *   set DB_PATH=.\test.db
 *   set UPLOADS_DIR=.\test-uploads
 *   npm run test:security
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const APP_PORT = Number.parseInt(process.env.PORT || '3000', 10);
const TEST_PORT = APP_PORT + 1;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

// server.js reads PORT at require time, so point it at the test port first.
// This keeps the test off the port a developer may already be using.
process.env.PORT = String(TEST_PORT);

const RUN = String(Date.now()).slice(-9);

let passed = 0;
let failed = 0;

function check(ok, label, extra) {
  if (ok) {
    passed++;
    console.log('ok   ' + label);
  } else {
    failed++;
    console.log('FAIL ' + label + (extra !== undefined ? '  | ' + extra : ''));
  }
}

/* ------------------------------------------------------------------ *
 * Route discovery
 * ------------------------------------------------------------------ */

/**
 * Finds every mutating route in a router file and returns its full API path.
 * @param {string} file      Absolute path to a routes/*.js file
 * @param {string} mountPath Prefix the router is mounted at
 */
function discoverMutatingRoutes(file, mountPath) {
  const source = fs.readFileSync(file, 'utf8');
  const pattern = /router\.(post|put|patch|delete)\(\s*'([^']+)'/g;
  const found = [];
  let match;
  while ((match = pattern.exec(source)) !== null) {
    found.push({
      method: match[1].toUpperCase(),
      path: mountPath + match[2],
      source: path.basename(file) + ' -> router.' + match[1] + "('" + match[2] + "')"
    });
  }
  return found;
}

function allMutatingRoutes() {
  const routesDir = path.join(__dirname, 'routes');
  return [
    ...discoverMutatingRoutes(path.join(routesDir, 'auth.js'), '/api/auth'),
    ...discoverMutatingRoutes(path.join(routesDir, 'teacher.js'), '/api/teacher'),
    ...discoverMutatingRoutes(path.join(routesDir, 'student.js'), '/api/student')
  ];
}

/* ------------------------------------------------------------------ *
 * HTTP client
 * ------------------------------------------------------------------ */

/**
 * A deliberately bare request: no cookies and no CSRF header.
 *
 * This is what an attacker's cross-site form post looks like from the server's
 * point of view - the browser attaches the session cookie, but the attacker cannot
 * read the token to set the header. Used to prove the CSRF layer actually rejects.
 */
function bareRequest(method, urlPath, body, cookieHeader, csrfHeader) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const reqHeaders = {};
    if (cookieHeader) reqHeaders['Cookie'] = cookieHeader;
    if (csrfHeader) reqHeaders['X-CSRF-Token'] = csrfHeader;

    let payload = null;
    if (body && typeof body === 'object') {
      payload = JSON.stringify(body);
      reqHeaders['Content-Type'] = 'application/json';
    }

    const req = http.request(url, { method, headers: reqHeaders }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { json = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: json, text: data });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function createClient() {
  let cookies = [];
  let tokenFetched = false;

  function readCookie(name) {
    const prefix = name + '=';
    const hit = cookies.find((c) => c.startsWith(prefix));
    return hit ? decodeURIComponent(hit.substring(prefix.length)) : null;
  }

  /** A script must request the CSRF cookie; a browser gets it with the page. */
  function ensureCsrfToken() {
    if (tokenFetched) return Promise.resolve();
    tokenFetched = true;
    return request('GET', '/api/auth/csrf').catch(() => null);
  }

  function request(method, urlPath, body = null, headers = {}) {
    const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());

    const send = () => new Promise((resolve, reject) => {
      const url = new URL(urlPath, BASE_URL);
      const reqHeaders = { ...headers };
      if (cookies.length > 0) reqHeaders['Cookie'] = cookies.join('; ');

      if (mutating && !reqHeaders['X-CSRF-Token']) {
        const token = readCookie('csrf_token');
        if (token) reqHeaders['X-CSRF-Token'] = token;
      }

      let payload = null;
      if (body && typeof body === 'object') {
        payload = JSON.stringify(body);
        reqHeaders['Content-Type'] = 'application/json';
      }

      const req = http.request(url, { method, headers: reqHeaders }, (res) => {
        if (res.headers['set-cookie']) {
          cookies = res.headers['set-cookie'].map((c) => c.split(';')[0]);
        }
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch (e) { json = data; }
          resolve({ status: res.statusCode, headers: res.headers, body: json, text: data });
        });
      });

      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });

    if (!mutating) return send();
    return ensureCsrfToken().then(send);
  }

  return {
    get: (p, h) => request('GET', p, null, h),
    post: (p, b, h) => request('POST', p, b, h),
    delete: (p, h) => request('DELETE', p, null, h),
    cookies: () => cookies.slice()
  };
}

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

async function run() {
  // Start the real application in-process so the test can never drift from it.
  const { server } = require('./server');
  await new Promise((resolve) => {
    if (server.listening) return resolve();
    server.once('listening', resolve);
  });

  console.log('\n=== 1. Route discovery ===');
  const routes = allMutatingRoutes();
  console.log(`   discovered ${routes.length} state-changing endpoints:`);
  routes.forEach((r) => console.log(`     ${r.method.padEnd(6)} ${r.path}`));
  check(routes.length >= 10, `discovered a plausible number of endpoints (${routes.length})`);

  const anon = createClient();

  console.log('\n=== 2. Every mutating endpoint rejects a request with no CSRF token ===');
  /**
   * Establishes a brand-new session and returns its cookie header plus the CSRF
   * token that belongs to it.
   *
   * A fresh session per endpoint matters: endpoints such as /api/auth/logout destroy
   * the session, so reusing one jar would compare a stale token against a new session
   * and produce a misleading 403.
   */
  async function freshSession() {
    const boot = await bareRequest('GET', '/api/auth/csrf', null, null, null);
    const jar = {};
    for (const c of boot.headers['set-cookie'] || []) {
      const pair = c.split(';')[0];
      const i = pair.indexOf('=');
      if (i > 0) jar[pair.slice(0, i)] = pair.slice(i + 1);
    }
    return {
      cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '),
      token: jar.csrf_token || null
    };
  }

  const unprotected = [];
  for (const route of routes) {
    // Path parameters get a plausible value so the request reaches the real handler
    // instead of stopping at the 404 for an unmatched literal route.
    const concretePath = route.path.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '1');

    // (a) Valid session, no token header -> the CSRF layer must refuse it.
    const withoutToken = await freshSession();
    const noToken = await bareRequest(route.method, concretePath, null, withoutToken.cookie, null);

    // (b) Same request WITH the matching token -> CSRF must let it through, proving
    //     the layer is selective rather than rejecting everything.
    const withTokenSession = await freshSession();
    const withToken = await bareRequest(route.method, concretePath, null,
      withTokenSession.cookie, withTokenSession.token);

    const blocked = noToken.status === 403 && noToken.body && noToken.body.code === 'CSRF_INVALID';
    const selective = withToken.status !== 403;
    check(blocked && selective, `${route.method} ${route.path} requires a CSRF token`,
      `no-token=${noToken.status}${noToken.body && noToken.body.code ? '/' + noToken.body.code : ''} ` +
      `with-token=${withToken.status}`);
    if (!blocked) unprotected.push(`${route.method} ${route.path}`);
  }
  check(unprotected.length === 0, 'no mutating endpoint is reachable without a CSRF token',
    unprotected.join(', '));

  console.log('\n=== 3. Scanner self-test (proves section 2 measures CSRF, not 404s) ===');
  const bogusSession = await freshSession();
  const bogus = await bareRequest('POST', '/api/definitely-not-a-real-route', null, bogusSession.cookie, null);
  check(bogus.status === 403, 'unknown POST /api/... is also stopped by the CSRF layer (403)',
    `got ${bogus.status}`);
  const bogusWithToken = await bareRequest('POST', '/api/definitely-not-a-real-route', null,
    bogusSession.cookie, bogusSession.token);
  check(bogusWithToken.status === 404,
    'with a valid token the same path falls through to 404 (layer is real, not blanket)',
    `got ${bogusWithToken.status}`);

  console.log('\n=== 4. Wrong token is rejected, correct token is accepted ===');
  const tokenSession = await freshSession();
  check(Boolean(tokenSession.token) && tokenSession.token.length >= 32,
    'CSRF token issued and long enough', tokenSession.token && tokenSession.token.length);

  const wrong = await bareRequest('POST', '/api/auth/logout', null, tokenSession.cookie, 'a'.repeat(64));
  check(wrong.status === 403, 'wrong token -> 403', wrong.status);

  const right = await bareRequest('POST', '/api/auth/logout', null, tokenSession.cookie, tokenSession.token);
  check(right.status === 200, 'correct token -> request proceeds', right.status);

  console.log('\n=== 5. Security headers ===');
  const page = await anon.get('/login');
  const h = {};
  Object.entries(page.headers).forEach(([k, v]) => { h[k.toLowerCase()] = v; });
  check(page.status === 200, 'login page is public', page.status);
  check(h['x-content-type-options'] === 'nosniff', 'nosniff present', h['x-content-type-options']);
  check(String(h['x-frame-options'] || '').toUpperCase() === 'DENY', 'frame denial present', h['x-frame-options']);
  check(String(h['content-security-policy'] || '').includes("frame-ancestors 'none'"), 'CSP frame-ancestors none');
  check(String(h['content-security-policy'] || '').includes("object-src 'none'"), 'CSP object-src none');
  check(h['x-powered-by'] === undefined, 'X-Powered-By removed', h['x-powered-by']);
  check(String(h['referrer-policy'] || '').length > 0, 'referrer policy present', h['referrer-policy']);

  console.log('\n=== 6. Session cookie flags ===');
  const setCookies = page.headers['set-cookie'] || [];
  const sidCookie = setCookies.find((c) => c.startsWith('csp.sid=')) || '';
  check(sidCookie.length > 0, 'session cookie is named csp.sid');
  check(/HttpOnly/i.test(sidCookie), 'session cookie HttpOnly');
  check(/SameSite=Lax/i.test(sidCookie), 'session cookie SameSite=Lax');
  check(!setCookies.some((c) => c.startsWith('connect.sid=')), 'no default connect.sid cookie');

  console.log('\n=== 7. CSRF helper is injected into every page ===');
  // The app uses one unified sign-in page at /login. The old /teacher/login and
  // /student/login paths now redirect there, so they are checked as redirects below.
  const pages = ['/', '/login', '/teacher/dashboard', '/teacher/students',
    '/teacher/materials', '/teacher/attendance', '/teacher/notices',
    '/student/dashboard', '/student/materials', '/student/profile'];

  // Protected pages need a session. Supply SECURITY_TEST_EMAIL / SECURITY_TEST_PASSWORD
  // for a teacher that already exists so a test run creates no data. Without them the
  // authenticated page checks are skipped rather than writing a throwaway account.
  const testEmail = process.env.SECURITY_TEST_EMAIL;
  const testPassword = process.env.SECURITY_TEST_PASSWORD;

  const session = createClient();
  let authenticated = false;
  if (testEmail && testPassword) {
    const loginRes = await session.post('/api/auth/teacher/login',
      { email: testEmail, password: testPassword });
    authenticated = loginRes.status === 200;
    check(authenticated, 'signed in with SECURITY_TEST_EMAIL', loginRes.status);
  } else {
    console.log('   note: SECURITY_TEST_EMAIL / SECURITY_TEST_PASSWORD not set.');
    console.log('         Skipping authenticated page checks (no test account created).');
  }

  // The public pages are always checkable.
  const publicPages = ['/', '/login'];
  let injected = 0;
  const missing = [];
  for (const p of publicPages) {
    const res = await anon.get(p);
    const bodyText = typeof res.body === 'string' ? res.body : res.text;
    if (String(bodyText).includes('/app-security.js')) injected++;
    else missing.push(`${p} (status ${res.status})`);
  }
  check(injected === publicPages.length,
    `helper present on all ${publicPages.length} public pages`, missing.join(', '));

  // The retired role-specific login paths must still lead somewhere useful.
  for (const legacy of ['/teacher/login', '/student/login']) {
    const res = await anon.get(legacy);
    const loc = res.headers.location || '';
    check(res.status === 302 && loc === '/login',
      `legacy ${legacy} redirects to the unified /login`, `${res.status} -> ${loc}`);
  }

  if (authenticated) {
    let authedInjected = 0;
    const authedMissing = [];
    for (const p of pages) {
      let res = await session.get(p);
      // Student pages redirect a teacher to /student/login; follow to the real document.
      if (res.status >= 300 && res.status < 400 && res.headers.location) {
        res = await session.get(res.headers.location);
      }
      const bodyText = typeof res.body === 'string' ? res.body : res.text;
      if (String(bodyText).includes('/app-security.js')) authedInjected++;
      else authedMissing.push(`${p} (status ${res.status})`);
    }
    check(authedInjected === pages.length, `helper present on all ${pages.length} pages (${authedInjected})`,
      authedMissing.join(', '));
  }

  const helper = await anon.get('/app-security.js');
  check(helper.status === 200 && String(helper.text).includes('PortalSecurity'), 'helper asset is served');

  console.log('\n=== 8. Severity sanity: an unusable login code is not enumerable ===');
  const probe = createClient();
  const unknownCode = await probe.post('/api/auth/student/login', { code: 'ZZ-Z-000000' });
  check(unknownCode.status === 401 && unknownCode.body && unknownCode.body.error === 'Invalid login code.',
    'unknown student code is rejected without revealing anything', unknownCode.body);

  console.log('\n===============================================');
  console.log(`SECURITY TESTS: ${passed} passed, ${failed} failed`);
  console.log('===============================================\n');

  server.close();
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('Security test runner error:', err);
  process.exit(2);
});
