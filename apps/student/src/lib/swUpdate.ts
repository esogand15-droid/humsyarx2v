type SwListener = (ready: boolean) => void;

const listeners = new Set<SwListener>();
let registrationRef: ServiceWorkerRegistration | null = null;
let waitingWorker: ServiceWorker | null = null;
let updateReady = false;
let shouldReloadOnControl = false;
let reloading = false;
let registered = false;

function notify(ready: boolean) {
  updateReady = ready;
  listeners.forEach((cb) => cb(ready));
}

function trackWaiting(worker: ServiceWorker | null) {
  if (!worker) return;
  waitingWorker = worker;
  notify(true);
}

/**
 * ثبت Service Worker نسخهٔ دانشجو و پایش نسخه‌های جدید در production.
 * در حالت waiting بدون ریلود خودکار می‌ماند تا با انتخاب کاربر فعال شود.
 */
export function registerStudentSW(): void {
  if (registered) return;
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  registered = true;

  const base = (import.meta.env.BASE_URL || '/student/').replace(/\/?$/, '/');
  const swUrl = new URL('sw.js', window.location.origin + base).toString();
  const hadController = Boolean(navigator.serviceWorker.controller);

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!shouldReloadOnControl || !hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  const doRegister = () => {
    navigator.serviceWorker
      .register(swUrl, { scope: base, updateViaCache: 'none' })
      .then((reg) => {
        registrationRef = reg;
        if (reg.waiting && navigator.serviceWorker.controller) {
          trackWaiting(reg.waiting);
        }

        reg.addEventListener('updatefound', () => {
          const next = reg.installing;
          if (!next) return;
          next.addEventListener('statechange', () => {
            if (next.state === 'installed' && navigator.serviceWorker.controller) {
              trackWaiting(reg.waiting || next);
            }
          });
        });

        let lastCheck = Date.now();
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState !== 'visible') return;
          const now = Date.now();
          if (now - lastCheck < 30 * 60 * 1000) return;
          lastCheck = now;
          reg.update().catch(() => undefined);
        });
      })
      .catch((err) => {
        console.warn('[SW] Registration failed:', err);
      });
  };

  if (document.readyState === 'complete') {
    doRegister();
  } else {
    window.addEventListener('load', doRegister, { once: true });
  }
}

/**
 * اشتراک در وضعیت آماده بودن نسخهٔ جدید Service Worker.
 */
export function subscribeSwUpdate(listener: SwListener): () => void {
  listeners.add(listener);
  listener(updateReady);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * ارسال SKIP_WAITING به Service Worker منتظر و بارگذاری مجدد پس از کنترل.
 */
export function applySwUpdate(): void {
  const target = waitingWorker || registrationRef?.waiting || null;
  shouldReloadOnControl = true;
  if (target) {
    target.postMessage({ type: 'SKIP_WAITING' });
    return;
  }
  window.location.reload();
}
