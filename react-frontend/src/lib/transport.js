import { Capacitor } from '@capacitor/core';

export const nativeApp = Capacitor.isNativePlatform();
export const backendOrigin = 'https://studyflowrmd.duckdns.org';

// Only data requests leave the APK. Routes and frontend assets stay bundled.
export function requestUrl(url, native = nativeApp) {
  return native && typeof url === 'string' && /^\/(api|uploads)\//.test(url)
    ? backendOrigin + url : url;
}

export function appFetch(url, options) {
  // CapacitorHttp patches fetch on Android, preserving FormData and Blob support.
  return fetch(requestUrl(url), options);
}
