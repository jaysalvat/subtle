/* Subtle's service worker (production build only; written into dist/sw.js by the `subtleServiceWorker`
 * plugin in vite.config.ts, which fills in the build's files and version).
 * - Install: keeps the app's files (the page, scripts, styles, workers, icons) in a cache named after
 *   this build: Subtle opens without a network afterwards. ONNX Runtime's WebAssembly (tens of MB)
 *   is kept the first time it's used instead.
 * - Hashed files (assets/…) never change: from the cache first. The page itself: from the network
 *   first (a new version shows), the cache when offline. Fonts (assets/…woff2): kept when first used.
 * - A new version waits until the app says so (Reload in its message): the open page keeps working
 *   with the files it started with. Older caches go when it takes over.
 * Models (Whisper, Silero, OCR) are in their own caches, kept by the code that loads them.
 */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE = `subtle-app-${VERSION}`;
// Where the app is served ('/', or '/subtle/' on GitHub Pages): this file sits at its root.
const BASE = new URL('./', self.location).pathname;
const SHELL = [
  '',
  'manifest.webmanifest',
  'favicon.svg',
  'favicon.ico',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
].map((f) => BASE + f);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll([...SHELL, ...PRECACHE.map((f) => BASE + f)])));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('subtle-app-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

const fromCacheFirst = async (request) => {
  // ignoreVary: module scripts are asked with an Origin header the install's requests didn't have.
  const hit = await caches.match(request, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok || res.type === 'opaque') (await caches.open(CACHE)).put(request, res.clone());
  return res;
};

const fromNetworkFirst = async (request) => {
  try {
    const res = await fetch(request);
    if (res.ok) (await caches.open(CACHE)).put(BASE, res.clone());
    return res;
  } catch {
    return (await caches.match(BASE, { ignoreVary: true })) ?? Response.error();
  }
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (request.mode === 'navigate' && url.origin === location.origin) return event.respondWith(fromNetworkFirst(request));
  if (url.origin === location.origin && (url.pathname.startsWith(`${BASE}assets/`) || SHELL.includes(url.pathname)))
    return event.respondWith(fromCacheFirst(request));
});
