/* ══════════════════════════════════════════════════════════════════════
   HumsYarX Student PWA Service Worker (v4)
   Strict DRM Zero-Storage & Cache Isolation Policy
   ══════════════════════════════════════════════════════════════════════ */

const SW_VERSION = 'humsyar-student-v4';
const STATIC_CACHE = `static-${SW_VERSION}`;

/**
 * 🔒 STRICT DRM & SENSITIVE PATH REGEX
 * ZERO CACHE PERMITTED — Under no circumstances may requests matching
 * these patterns enter Cache Storage or IndexedDB.
 */
const DRM_AND_SECURE_REGEX = /^\/api\/(web\/reader\/|web-auth\/|web\/sessions|web\/ink\/sync|ai\/|web\/exam\/|web\/wallet\/|subscription\/)/;

/**
 * Offline DRM fallback response payload
 */
const DRM_OFFLINE_RESPONSE = JSON.stringify({
  error: "DRM_OFFLINE_PROTECTED",
  detail: "مشاهده جزوات محافظت‌شده نیازمند اتصال فعال به اینترنت است",
  offline: true
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll([
        './index.html',
        './manifest.webmanifest',
        './favicon-64.png',
        './icons/icon-192.png',
        './icons/icon-512.png',
        './icons/maskable-512.png',
        './icons/apple-touch-icon.png'
      ]).catch((err) => console.warn('[SW] Pre-caching partial skip:', err));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const pathname = url.pathname;
  const path = pathname;

  // 1️⃣ STRICT DRM ZERO-STORAGE RULE (Network-Only)
  if (DRM_AND_SECURE_REGEX.test(pathname)) {
    event.respondWith(
      fetch(req).catch(() => {
        // If offline and accessing protected reader page or manifest
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

  // 3️⃣ Hashed Static Assets (Cache-First)
  if (pathname.includes('/assets/') || pathname.endsWith('.woff2') || pathname.endsWith('.png') || pathname.endsWith('.js') || pathname.endsWith('.css')) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((resp) => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(req, clone));
        }
        return resp;
      }))
    );
    return;
  }

  // 4️⃣ SPA Navigation Fallback
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
  }
});

/**
 * Network-first helper for non-DRM API routes, ensuring no-store and private headers are honored.
 */
async function networkFirstWithTTL(request, ttlMs) {
  try {
    const response = await fetch(request);
    if (!response.ok || response.status >= 400) {
      return response;
    }
    const cacheControl = (response.headers.get('cache-control') || '').toLowerCase();
    if (cacheControl.includes('no-store') || cacheControl.includes('private')) {
      return response;
    }
    const cache = await caches.open(`${STATIC_CACHE}-api-temp`);
    cache.put(request, response.clone()).catch(() => undefined);
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'network_unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}
