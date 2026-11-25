/* ─────────────────────────────────────────────────────────────
   🧭 سرویس‌ورکر واحد هامزیار — مینی‌اپ (/app/) و نسخهٔ نصب‌شدنی (/pwa/)

   این فایل تنها منبع است؛ vite.config.js هنگام بیلد آن را با شناسهٔ
   بیلد و فهرست پیش‌کش پر می‌کند و در خروجی همان بیلد می‌نویسد.
   (قبلاً دو نسخهٔ جدا در public/ و public-pwa/ بود که از هم جدا شده
   بودند و نام کش دستی بود.)

   قوانین:
   • ناوبری (HTML): اول شبکه، بعد کش، در آخر صفحهٔ آفلاین ⇒ بعد از
     هر deploy نسخهٔ تازه دیده می‌شود.
   • فایل‌های hashدار /assets/: اول کش (نامشان با هر بیلد عوض می‌شود).
   • /api/*، درخواست‌های Range، پاسخ‌های 206، no-store و private هرگز
     کش نمی‌شوند (دادهٔ شخصی و رسانه روی دستگاه مشترک نمی‌ماند).
   • نسخهٔ تازه خودش جای نسخهٔ فعلی را وسط کار نمی‌گیرد؛ صفحه پیام
     «نسخهٔ جدید آماده است» نشان می‌دهد و فقط با تأیید کاربر
     SKIP_WAITING فرستاده می‌شود.
   ───────────────────────────────────────────────────────────── */

const BUILD_ID = '__BUILD_ID__';
const PRECACHE = __PRECACHE__;
const OFFLINE_URL = './offline.html';
const HAS_OFFLINE = PRECACHE.includes(OFFLINE_URL);

/* /app/ و /pwa/ روی یک مبدأ‌اند و CacheStorage مشترک دارند؛ نام کش
   باید دامنهٔ (scope) خودش را داشته باشد تا یکی کش دیگری را پاک نکند. */
const SCOPE_PATH = new URL(self.registration.scope).pathname;
const SCOPE_KEY = SCOPE_PATH.replace(/[^a-z0-9]+/gi, '') || 'root';
const PREFIX = `humsyar-${SCOPE_KEY}-`;
const SHELL = `${PREFIX}${BUILD_ID}-shell`;
const ASSETS = `${PREFIX}${BUILD_ID}-assets`;

/* کش‌های نسخهٔ قدیمی (نام دستی). اگر وجود دارند یعنی صفحهٔ باز هنوز
   کد قدیمی است که پیام به‌روزرسانی ندارد؛ فقط در همین مهاجرتِ یک‌باره
   بلافاصله فعال می‌شویم (همان رفتار قبلی). */
const LEGACY = SCOPE_KEY === 'pwa'
  ? /^humsyar-pwa-v\d/
  : /^humsyar-v\d+-\d{8}$/;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.all(PRECACHE.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => null)));
    const keys = await caches.keys();
    if (keys.some((k) => LEGACY.test(k))) await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => (k.startsWith(PREFIX) && !k.startsWith(`${PREFIX}${BUILD_ID}-`)) || LEGACY.test(k))
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const type = typeof event.data === 'string' ? event.data : event.data?.type;
  if (type === 'SKIP_WAITING' || type === 'skip-waiting') self.skipWaiting();
});

/** فقط پاسخ کامل، عمومی و قابل‌ذخیره کش می‌شود. */
function cacheable(response) {
  if (!response || response.status !== 200 || response.type === 'opaque') return false;
  const cc = (response.headers.get('Cache-Control') || '').toLowerCase();
  if (cc.includes('no-store') || cc.includes('private')) return false;
  if (response.headers.get('Content-Range')) return false;
  return true;
}

const isHashedAsset = (url) =>
  url.pathname.startsWith(`${SCOPE_PATH}assets/`) && /-[A-Za-z0-9_-]{6,}\.(?:js|mjs|css|woff2?)$/.test(url.pathname);

const isStatic = (url) => /\.(?:js|mjs|css|woff2?|ttf|otf|png|jpe?g|svg|webp|ico|webmanifest)$/i.test(url.pathname);

async function handleNavigate(request) {
  const cache = await caches.open(SHELL);
  try {
    const fresh = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 6000)),
    ]);
    if (cacheable(fresh)) cache.put('./', fresh.clone()).catch(() => {});
    return fresh;
  } catch (_) {
    const cached = await cache.match('./', { ignoreSearch: true });
    if (cached) return cached;
    if (HAS_OFFLINE) {
      const offline = await cache.match(OFFLINE_URL);
      if (offline) return offline;
    }
    return new Response('اتصال اینترنت برقرار نیست. لطفاً دوباره تلاش کنید.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function handleHashedAsset(request) {
  const cache = await caches.open(ASSETS);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (cacheable(response)) cache.put(request, response.clone()).catch(() => {});
  return response;
}

async function handleStatic(request) {
  const cache = await caches.open(ASSETS);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (cacheable(response)) cache.put(request, response.clone()).catch(() => {});
      return response;
    })
    .catch(() => null);
  return cached || (await network) || new Response('', { status: 504 });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (_) {
    return;
  }

  if (url.origin !== self.location.origin) return;

  // دادهٔ کاربر و رسانه: هرگز از کش، هرگز در کش
  if (url.pathname.startsWith('/api/')) return;
  if (request.headers.has('range')) return;

  if (request.mode === 'navigate') {
    if (url.pathname.startsWith(SCOPE_PATH)) event.respondWith(handleNavigate(request));
    return;
  }

  if (isHashedAsset(url)) {
    event.respondWith(handleHashedAsset(request));
  } else if (url.pathname.startsWith(SCOPE_PATH) && isStatic(url)) {
    event.respondWith(handleStatic(request));
  }
});
