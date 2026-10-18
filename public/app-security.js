/**
 * app-security.js
 * Shared browser-side security helper for every portal page.
 *
 * The server requires a CSRF token on every state-changing request (POST/PUT/PATCH/
 * DELETE). The token lives in the session and is mirrored into a readable
 * "csrf_token" cookie, so this file simply copies that cookie value into the
 * X-CSRF-Token request header.
 *
 * Usage from a page script:
 *
 *   fetch('/api/teacher/notices', {
 *     method: 'POST',
 *     credentials: 'same-origin',
 *     headers: window.PortalSecurity.jsonHeaders(),
 *     body: JSON.stringify(payload)
 *   });
 *
 * For FormData uploads do NOT set Content-Type (the browser must add the multipart
 * boundary), pass only the CSRF header:
 *
 *   fetch('/api/teacher/materials/upload', {
 *     method: 'POST',
 *     credentials: 'same-origin',
 *     headers: window.PortalSecurity.csrfHeaders(),
 *     body: formData
 *   });
 */
(function () {
  'use strict';

  var COOKIE_NAME = 'csrf_token';
  var HEADER_NAME = 'X-CSRF-Token';

  /**
   * Reads a cookie value by name. Returns null when absent.
   */
  function readCookie(name) {
    var prefix = name + '=';
    var parts = String(document.cookie || '').split(';');
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      if (part.indexOf(prefix) === 0) {
        return decodeURIComponent(part.substring(prefix.length));
      }
    }
    return null;
  }

  /**
   * Returns the current CSRF token, or null when the server has not issued one yet.
   */
  function getToken() {
    return readCookie(COOKIE_NAME);
  }

  /**
   * Just the CSRF header - use this for FormData/multipart requests.
   */
  function csrfHeaders() {
    var token = getToken();
    return token ? { 'X-CSRF-Token': token } : {};
  }

  /**
   * CSRF header plus JSON content type - use this for JSON bodies.
   */
  function jsonHeaders() {
    var headers = csrfHeaders();
    headers['Content-Type'] = 'application/json';
    return headers;
  }

  /**
   * Fetches a fresh token from the server.
   * The token is normally already present as a cookie; this is the recovery path
   * for the rare case where the cookie was cleared but the session is still alive.
   */
  function refreshToken() {
    return fetch('/api/auth/csrf', { credentials: 'same-origin' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) { return data && data.csrfToken ? data.csrfToken : null; })
      .catch(function () { return null; });
  }

  /**
   * Wraps fetch so any same-origin mutating request automatically carries the CSRF
   * header. Existing page code that already sets the header is unaffected.
   */
  function installFetchGuard() {
    if (typeof window.fetch !== 'function') return;
    var originalFetch = window.fetch;
    var MUTATING = { POST: true, PUT: true, PATCH: true, DELETE: true };

    window.fetch = function (input, init) {
      init = init || {};
      var method = String(init.method || 'GET').toUpperCase();
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var sameOrigin = url.indexOf('http') !== 0 || url.indexOf(window.location.origin) === 0;

      if (MUTATING[method] && sameOrigin) {
        var token = getToken();
        if (token) {
          var headers = init.headers || {};
          // Normalise Headers instances and plain objects to a plain object.
          if (typeof Headers !== 'undefined' && headers instanceof Headers) {
            var copy = {};
            headers.forEach(function (value, key) { copy[key] = value; });
            headers = copy;
          }
          var alreadySet = Object.keys(headers).some(function (k) {
            return k.toLowerCase() === HEADER_NAME.toLowerCase();
          });
          if (!alreadySet) headers[HEADER_NAME] = token;
          init.headers = headers;
        }
      }
      return originalFetch.call(window, input, init);
    };
  }

  installFetchGuard();

  window.PortalSecurity = {
    getToken: getToken,
    csrfHeaders: csrfHeaders,
    jsonHeaders: jsonHeaders,
    refreshToken: refreshToken,
    headerName: HEADER_NAME
  };
})();
