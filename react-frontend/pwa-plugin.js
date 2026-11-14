import { createHash } from 'node:crypto';
// Cache only the public application shell. Authenticated responses and PDF
// content are never placed in the service worker cache.
export default function pwaPlugin() {
  return {
    name: 'studyflow-offline-shell',
    apply: 'build',
    generateBundle(_, bundle) {
      const assets = Object.keys(bundle).filter(name => !name.endsWith('.map')).map(name => '/' + name);
      const revision = createHash('sha256').update(JSON.stringify(assets)).digest('hex').slice(0, 12);
      const shell = [...new Set(['/index.html', '/icon.svg', '/manifest.webmanifest', ...assets])];
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: `
const CACHE = 'studyflow-shell-${revision}';
const SHELL = ${JSON.stringify(shell)};
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('studyflow-shell-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('message', event => { if(event.data === 'ACTIVATE_UPDATE') self.skipWaiting(); });
self.addEventListener('push', event => { event.waitUntil(self.registration.showNotification('StudyFlow update', {body:'You have new class activity or an upcoming deadline. Open StudyFlow to view it.',icon:'/icon.svg',tag:'studyflow-activity'})); });
self.addEventListener('notificationclick', event => { event.notification.close(); event.waitUntil(self.clients.matchAll({type:'window'}).then(async clients => { if(clients.length){await clients[0].navigate('/student-dashboard?view=notices');return clients[0].focus();}return self.clients.openWindow('/student-dashboard?view=notices'); })); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api') || url.pathname.startsWith('/uploads')) return;
  if(event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then(cache => cache.match('/index.html'))));
  } else if (SHELL.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(url.pathname)).then(hit => hit || fetch(event.request)));
  }
});
` });
    },
  };
}
