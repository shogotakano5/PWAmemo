/* Service worker for the memo PWA.
 *
 * Strategy
 *   - navigations       : network-first, falling back to the cached app shell
 *   - build assets      : cache-first (Next.js fingerprints them, so they are immutable)
 *   - other static GETs : stale-while-revalidate
 *   - /api/*            : never cached — memo sync must always hit the network
 */

const VERSION = 'v1';
const SHELL_CACHE = `memo-shell-${VERSION}`;
const ASSET_CACHE = `memo-assets-${VERSION}`;
const SHELL_URL = '/';
const PRECACHE = [SHELL_URL, '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // Individually, so one missing file cannot fail the whole install.
      Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined),
        ),
      ),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('memo-') && key !== SHELL_CACHE && key !== ASSET_CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isBuildAsset(url) {
  return url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/');
}

async function networkFirstShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    // Cache under the actual URL, not a fixed key — otherwise visiting a
    // second page (e.g. /admin) would overwrite the cached "/" app shell.
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    // Offline: prefer this exact page if it was ever cached, otherwise fall
    // back to the app shell — all memo data is read from IndexedDB anyway.
    const cached = (await cache.match(request)) || (await cache.match(SHELL_URL));
    if (cached) return cached;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>オフライン</title>' +
        '<body style="font-family:system-ui;padding:2rem;line-height:1.7">' +
        '<h1>オフラインです</h1><p>接続が戻ったら再読み込みしてください。</p></body>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached || (await network) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstShell(request));
    return;
  }
  if (isBuildAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});
