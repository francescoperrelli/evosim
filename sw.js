// EvoSim service worker — installable, offline-capable PWA.
// Bump CACHE whenever the shell changes to roll clients onto the new version.
const CACHE = 'evosim-v1';
const SHELL = [
  './', './index.html', './about.html', './manifest.webmanifest',
  './css/style.css',
  './js/main.js', './js/state.js', './js/utils.js', './js/world.js', './js/genome.js',
  './js/nn.js', './js/render.js', './js/ui.js', './js/challenges.js', './js/audio.js',
  './js/saves.js', './js/i18n.js',
  './assets/icon-192.png', './assets/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Navigations: network-first (so updates show) with cache fallback (so offline works).
  if(req.mode === 'navigate'){
    e.respondWith(fetch(req).then(r => { cachePut(req, r.clone()); return r; }).catch(() => caches.match(req).then(m => m || caches.match('./index.html'))));
    return;
  }
  // Everything else: stale-while-revalidate — instant from cache, refreshed in the background.
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(r => { cachePut(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});

function cachePut(req, res){ if(res && res.ok) caches.open(CACHE).then(c => c.put(req, res)); }
