// Offline support: network first, fall back to the last cached copy.
// Requests bypass the browser's HTTP cache (GitHub Pages allows 10 minutes of
// reuse), so a new release is picked up on the next load, not some time later.
// Bump CACHE when the list of files changes.
const CACHE = 'hs11-v10';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'src/ui/app.js',
  'src/version.js',
  'src/ui/chartGeometry.js',
  'src/ui/storage.js',
  'src/ui/color.js',
  'src/ui/motion.js',
  'src/domain/protocol.js',
  'src/domain/bodyComposition.js',
  'src/domain/history.js',
  'src/domain/metrics.js',
  'src/domain/settings.js',
  'src/domain/insights.js',
  'src/domain/profiles.js',
  'src/domain/merge.js',
  'src/domain/sheetSync.js',
  'src/sync/sheetSyncController.js',
  'src/sync/appsScriptStore.js',
  'google-apps-script/Code.gs',
  'src/bluetooth/scaleSync.js',
  'src/bluetooth/webBluetoothTransport.js',
  'src/bluetooth/demoTransport.js',
];

self.addEventListener('install', (event) => {
  const fresh = SHELL.map((url) => new Request(url, { cache: 'reload' }));
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(fresh)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  event.respondWith(
    fetch(request, { cache: 'no-cache' })
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true })),
  );
});
