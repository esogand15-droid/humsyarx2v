/* ─────────────────────────────────────────────────────────────
   🧭 ثبت سرویسورکر و پیام «نسخهٔ جدید آماده است»

   نسخهٔ تازه خودش جای نسخهٔ فعلی را نمیگیرد (ممکن است کاربر وسط
   ویدیو، آزمون یا نوشتن پیام باشد). وقتی آماده شد، فقط یک پیام کوچک
   نشان داده میشود و با زدن «بهروزرسانی» صفحه یک بار تازه میشود.
   ───────────────────────────────────────────────────────────── */
import { APP_BASE } from './base';

const listeners = new Set();
let waitingWorker = null;
let userAccepted = false;

function emit() {
  listeners.forEach((fn) => {
    try {
      fn(Boolean(waitingWorker));
    } catch (_) {
      /* یک شنونده نباید بقیه را از کار بیندازد */
    }
  });
}

function setWaiting(worker) {
  if (!worker || !navigator.serviceWorker.controller) return;
  waitingWorker = worker;
  emit();
}

export function onUpdateReady(fn) {
  listeners.add(fn);
  fn(Boolean(waitingWorker));
  return () => listeners.delete(fn);
}

export function applyUpdate() {
  if (!waitingWorker) {
    window.location.reload();
    return;
  }
  userAccepted = true;
  waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  /* اگر controllerchange نیامد (مرورگر قدیمی)، بعد از چند ثانیه
     خودمان تازه میکنیم */
  setTimeout(() => window.location.reload(), 4000);
}

export function registerServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  const base = APP_BASE || '/app/';
  const swUrl = `${base.replace(/\/$/, '')}/sw.js`;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!userAccepted || window.__swReloaded) return;
    window.__swReloaded = true;
    window.location.reload();
  });

  navigator.serviceWorker
    .register(swUrl, { scope: base })
    .then((reg) => {
      if (reg.waiting) setWaiting(reg.waiting);

      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed') setWaiting(reg.waiting || worker);
        });
      });

      /* اپ ممکن است روزها باز بماند (iOS standalone، تلگرام)؛
         هر بار که برمیگردد و هر ۳۰ دقیقه نسخهٔ تازه را چک کن. */
      const check = () => reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      setInterval(check, 30 * 60 * 1000);
    })
    .catch(() => {});
}
