/* ══════════════════════════════════════════════════════════════════════
   HumsYarX Student PWA Service Worker (v2 — Build-Hash Versioned)
   Strict DRM Zero-Storage & Cache Isolation Policy
   ══════════════════════════════════════════════════════════════════════ */

const SW_BUILD_ID = '__SW_BUILD_ID__';
const SHELL_CACHE = `shell-humsyar-student-${SW_BUILD_ID}`;
const STATIC_CACHE = `static-humsyar-student-${SW_BUILD_ID}`;
const API_CACHE = `${STATIC_CACHE}-api-temp`;
const LEGACY_CACHE_PREFIX = 'static-humsyar-student-v4';

/**
 * 🔒 STRICT DRM & SENSITIVE PATH REGEX
 * ZERO CACHE PERMITTED — Under no circumstances may requests matching
 * these patterns enter Cache Storage or IndexedDB.
 */
const DRM_AND_SECURE_REGEX = /^\/api\/(web\/reader\/|web\/library\/view-url\/|web-auth\/|web\/sessions|web\/ink\/|ai\/|web\/exam\/|web\/wallet\/|subscription\/)/;

/**
 * Offline DRM fallback response payload
 */
const DRM_OFFLINE_RESPONSE = JSON.stringify({
  error: "DRM_OFFLINE_PROTECTED",
  detail: "مشاهده جزوات محافظت‌شده نیازمند اتصال فعال به اینترنت است",
  offline: true
});

const PRECACHE_STATIC_URLS = [
  './manifest.webmanifest',
  './favicon-64.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

const HASHED_ASSET_RE = /\/assets\/.*-[A-Za-z0-9_-]{6,}\./;
const NAV_TIMEOUT_MS = 6000;

function scopePathname() {
  try {
    const scopeUrl = self.registration && self.registration.scope
      ? self.registration.scope
      : new URL('./', self.location.href).href;
    return new URL(scopeUrl).pathname;
  } catch {
    return '/student/';
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(STATIC_CACHE);
      await Promise.all(
        PRECACHE_STATIC_URLS.map(async (url) => {
          try {
            const req = new Request(url, { cache: 'reload' });
            const res = await fetch(req);
            if (res && res.ok && res.status === 200) {
              await cache.put(url, res);
            }
          } catch (err) {
            console.warn('[SW] Pre-caching partial skip:', url, err);
          }
        })
      );
    } catch (err) {
      console.warn('[SW] Install precache skipped:', err);
    }

    try {
      const keys = await caches.keys();
      const hasLegacy = keys.some((k) => k === LEGACY_CACHE_PREFIX || k.startsWith(LEGACY_CACHE_PREFIX));
      const isFirstInstall = !self.registration || !self.registration.active;
      if (isFirstInstall || hasLegacy) {
        await self.skipWaiting();
      }
    } catch {
      /* waiting for explicit SKIP_WAITING from app banner */
    }
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (data === 'SKIP_WAITING' || (data && data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k !== SHELL_CACHE && k !== STATIC_CACHE)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const pathname = url.pathname;
  const path = pathname;

  // Never intercept or cache SW script, asset manifest, or byte-range media requests
  if (
    pathname.endsWith('/sw.js') ||
    pathname.endsWith('/sw-assets.json') ||
    req.headers.has('range')
  ) {
    return;
  }

  // 1️⃣ STRICT DRM ZERO-STORAGE RULE (Network-Only)
  if (DRM_AND_SECURE_REGEX.test(pathname)) {
    event.respondWith(
      fetch(req).catch(() => {
        if (pathname.includes('/web/reader/')) {
          return new Response(DRM_OFFLINE_RESPONSE, {
            status: 503,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store, no-cache, must-revalidate',
            }
          });
        }
        return new Response(JSON.stringify({ error: "network_unavailable" }), {
          status: 503,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      })
    );
    return;
  }

  // 2️⃣ Non-sensitive API requests: network-first with TTL & strict no-store check
  if (path.startsWith('/api/')) {
    event.respondWith(networkFirstWithTTL(req, 30000));
    return;
  }

  const baseScope = scopePathname();
  if (!pathname.startsWith(baseScope)) {
    return;
  }

  // 3️⃣ SPA Navigation: Network-First (6s race timeout) -> SHELL_CACHE('./index.html')
  if (req.mode === 'navigate') {
    event.respondWith(networkFirstNavigate(req));
    return;
  }

  // 4️⃣ Hashed Static Assets under /assets/ (Cache-First)
  if (HASHED_ASSET_RE.test(pathname)) {
    event.respondWith(cacheFirstAsset(req));
    return;
  }

  // 5️⃣ Non-hashed static assets in scope (Stale-While-Revalidate)
  if (!pathname.endsWith('/index.html')) {
    event.respondWith(staleWhileRevalidate(req, event));
  }
});

async function networkFirstNavigate(request) {
  let timer = null;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Navigation timeout')), NAV_TIMEOUT_MS);
    });
    const res = await Promise.race([fetch(request), timeoutPromise]);
    if (res && res.ok && res.status === 200) {
      const cc = (res.headers.get('cache-control') || '').toLowerCase();
      if (!cc.includes('no-store') && !cc.includes('private')) {
        const cache = await caches.open(SHELL_CACHE);
        await cache.put('./index.html', res.clone()).catch(() => undefined);
      }
    }
    return res;
  } catch {
    const shell = await caches.open(SHELL_CACHE);
    const cached = (await shell.match('./index.html')) || (await caches.match('./index.html'));
    if (cached) return cached;
    return new Response(
      '<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><title>هامزیار — آفلاین</title><body style="font-family:sans-serif;padding:24px;text-align:center"><h2>اتصال اینترنت برقرار نیست</h2><p>لطفاً اتصال خود را بررسی کرده و صفحه را تازه کنید.</p></body></html>',
      {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      }
    );
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

async function cacheFirstAsset(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const resp = await fetch(request);
  if (resp && resp.ok && resp.status === 200) {
    const cc = (resp.headers.get('cache-control') || '').toLowerCase();
    if (!cc.includes('no-store') && !cc.includes('private')) {
      cache.put(request, resp.clone()).catch(() => undefined);
    }
  }
  return resp;
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const netPromise = fetch(request)
    .then((resp) => {
      if (resp && resp.ok && resp.status === 200) {
        const cc = (resp.headers.get('cache-control') || '').toLowerCase();
        if (!cc.includes('no-store') && !cc.includes('private')) {
          cache.put(request, resp.clone()).catch(() => undefined);
        }
      }
      return resp;
    })
    .catch(() => cached || new Response('', { status: 503 }));

  if (cached) {
    if (event && typeof event.waitUntil === 'function') {
      event.waitUntil(netPromise.catch(() => undefined));
    }
    return cached;
  }
  return netPromise;
}

/**
 * Network-first helper for non-DRM API routes, ensuring no-store and private headers are honored.
 */
async function networkFirstWithTTL(request, ttlMs) {
  try {
    const response = await fetch(request);
    if (!response.ok || response.status >= 400 || response.status !== 200) {
      return response;
    }
    const cacheControl = (response.headers.get('cache-control') || '').toLowerCase();
    if (cacheControl.includes('no-store') || cacheControl.includes('private')) {
      return response;
    }
    const cache = await caches.open(API_CACHE);
    cache.put(request, response.clone()).catch(() => undefined);
    return response;
  } catch {
    const cache = await caches.open(API_CACHE);
    const cached = (await cache.match(request)) || (await caches.match(request));
    if (cached) {
      const dateHdr = cached.headers.get('date');
      if (!ttlMs || !dateHdr || (Date.now() - Date.parse(dateHdr)) <= ttlMs * 20) {
        return cached;
      }
    }
    return new Response(JSON.stringify({ error: 'network_unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}
