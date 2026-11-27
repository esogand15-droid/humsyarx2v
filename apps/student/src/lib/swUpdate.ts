/**
 * چرخهٔ بهروزرسانی PWA دانشجو.
 *
 * فازها:
 *   idle      → نسخهٔ جدیدی در صف نیست
 *   ready     → نسخهٔ جدید نصب شده و منتظر تأیید کاربر است (بنر)
 *   applying  → کاربر «بهروزرسانی» را زده؛ SKIP_WAITING ارسال شده (صفحهٔ بهروزرسانی)
 *   reloading → نسخهٔ جدید کنترل را گرفته و صفحه در حال بارگذاری دوباره است
 *
 * باگ قبلی: ریلود پس از controllerchange فقط وقتی انجام میشد که صفحه از ابتدا
 * کنترلر داشت (hadController). در اولین بازدید SW وسط جلسه کنترل را میگرفت و
 * دکمهٔ بهروزرسانی بیصدا هیچ کاری نمیکرد؛ هیچ بازخوردی هم بین کلیک و ریلود نبود.
 */
export type SwPhase = 'idle' | 'ready' | 'applying' | 'reloading';

type PhaseListener = (phase: SwPhase) => void;
type SwListener = (ready: boolean) => void;

const UPDATED_FLAG = 'humsyar.sw.updated';
const RECOVER_FLAG = 'humsyar.sw.recovered';
/** اگر controllerchange هرگز نرسید (worker از کار افتاد یا مرورگر رویداد را نداد)، باز هم ریلود میکنیم. */
const APPLY_TIMEOUT_MS = 8000;
/** صفحهٔ بهروزرسانی حداقل این مدت دیده میشود تا کاربر بفهمد چه اتفاقی افتاد. */
const MIN_OVERLAY_MS = 1100;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const VISIBLE_CHECK_THROTTLE_MS = 10 * 60 * 1000;

const listeners = new Set<PhaseListener>();
let phase: SwPhase = 'idle';
let registrationRef: ServiceWorkerRegistration | null = null;
let waitingWorker: ServiceWorker | null = null;
let shouldReloadOnControl = false;
let applyStartedAt = 0;
let reloading = false;
let registered = false;

function setPhase(next: SwPhase) {
  if (phase === next) return;
  phase = next;
  listeners.forEach((cb) => cb(next));
}

function readFlag(key: string): number {
  try {
    return Number(sessionStorage.getItem(key) || 0);
  } catch {
    return 0;
  }
}

function writeFlag(key: string) {
  try {
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    /* private mode: the flag is cosmetic only */
  }
}

/** ریلود نهایی؛ یک بار، پس از حداقل زمان نمایش صفحهٔ بهروزرسانی. */
function finishReload() {
  if (reloading) return;
  reloading = true;
  setPhase('reloading');
  writeFlag(UPDATED_FLAG);
  const wait = Math.max(0, MIN_OVERLAY_MS - (Date.now() - applyStartedAt));
  window.setTimeout(() => window.location.reload(), wait);
}

function startApplying() {
  shouldReloadOnControl = true;
  applyStartedAt = Date.now();
  setPhase('applying');
  window.setTimeout(finishReload, APPLY_TIMEOUT_MS);
}

function trackWaiting(worker: ServiceWorker | null) {
  if (!worker || !navigator.serviceWorker.controller) return;
  waitingWorker = worker;
  if (phase === 'idle') setPhase('ready');
}

function watchInstalling(worker: ServiceWorker | null) {
  if (!worker) return;
  worker.addEventListener('statechange', () => {
    if (worker.state === 'installed') trackWaiting(registrationRef?.waiting || worker);
  });
}

/**
 * ثبت Service Worker نسخهٔ دانشجو و پایش نسخههای جدید در production.
 * در حالت waiting بدون ریلود خودکار میماند تا با انتخاب کاربر فعال شود.
 */
export function registerStudentSW(): void {
  if (registered) return;
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  registered = true;

  const base = (import.meta.env.BASE_URL || '/student/').replace(/\/?$/, '/');
  const swUrl = new URL('sw.js', window.location.origin + base).toString();
  let hadController = Boolean(navigator.serviceWorker.controller);

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (shouldReloadOnControl) {
      finishReload();
      return;
    }
    // اولین کنترلشدن (نصب اول) بیخطر است و ریلود نمیخواهد. اما اگر تب دیگری
    // بهروزرسانی کرد، این تب هنوز JS قدیمی دارد؛ ریلود اجباری ممکن است آزمون
    // در جریان را از بین ببرد، پس فقط بنر را نشان میدهیم تا کاربر خودش انتخاب کند.
    if (hadController) {
      waitingWorker = null;
      if (phase === 'idle') setPhase('ready');
    }
    hadController = true;
  });

  const doRegister = () => {
    navigator.serviceWorker
      .register(swUrl, { scope: base, updateViaCache: 'none' })
      .then((reg) => {
        registrationRef = reg;
        if (reg.waiting) trackWaiting(reg.waiting);
        watchInstalling(reg.installing);
        reg.addEventListener('updatefound', () => watchInstalling(reg.installing));

        let lastCheck = Date.now();
        const check = (throttle: number) => {
          if (phase !== 'idle' || Date.now() - lastCheck < throttle) return;
          lastCheck = Date.now();
          reg.update().catch(() => undefined);
        };
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') check(VISIBLE_CHECK_THROTTLE_MS);
        });
        window.addEventListener('online', () => check(0));
        // تبهای همیشهباز (دسکتاپ، PWA نصبشده) هم بدون تعویض تب نسخهٔ جدید را میبینند.
        window.setInterval(() => {
          if (document.visibilityState === 'visible') check(CHECK_INTERVAL_MS);
        }, CHECK_INTERVAL_MS);
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

/** اشتراک در فاز چرخهٔ بهروزرسانی. */
export function subscribeSwPhase(listener: PhaseListener): () => void {
  listeners.add(listener);
  listener(phase);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * اشتراک در وضعیت آماده بودن نسخهٔ جدید Service Worker.
 */
export function subscribeSwUpdate(listener: SwListener): () => void {
  return subscribeSwPhase((p) => listener(p === 'ready'));
}

/**
 * ارسال SKIP_WAITING به Service Worker منتظر و بارگذاری مجدد پس از کنترل.
 * صفحهٔ بهروزرسانی بلافاصله نمایش داده میشود و در هر حالت (حتی خطا) به ریلود ختم میشود.
 */
export function applySwUpdate(): void {
  if (phase === 'applying' || phase === 'reloading') return;
  startApplying();

  const target = waitingWorker || registrationRef?.waiting || null;
  if (!target || target.state === 'redundant') {
    finishReload();
    return;
  }
  target.addEventListener('statechange', () => {
    // activated: controllerchange معمولاً زودتر رسیده؛ redundant: نصب شکست خورد و
    // ریلود معمولی نسخهٔ تازه را از شبکه میگیرد. گارد reloading هر دو را یکبار میکند.
    if (target.state === 'activated' || target.state === 'redundant') finishReload();
  });
  target.postMessage({ type: 'SKIP_WAITING' });
}

/**
 * پس از دیپلوی، چانکهای قدیمی از سرور حذف میشوند و تبی که هنوز نسخهٔ قبلی را اجرا میکند
 * با باز کردن یک صفحهٔ lazy خطا میگیرد. با صفحهٔ بهروزرسانی یک ریلود تمیز میزنیم.
 * false یعنی در ۳۰ ثانیهٔ اخیر یکبار تلاش شده و خطا واقعی است (ErrorBoundary نشانش میدهد).
 */
export function recoverFromStaleBuild(): boolean {
  if (reloading || phase === 'applying') return true;
  if (Date.now() - readFlag(RECOVER_FLAG) < 30_000) return false;
  writeFlag(RECOVER_FLAG);
  startApplying();
  const waiting = waitingWorker || registrationRef?.waiting;
  if (waiting) {
    waiting.postMessage({ type: 'SKIP_WAITING' });
  } else {
    finishReload();
  }
  return true;
}

/** آیا این بارگذاری بلافاصله پس از بهروزرسانی است؟ (یکبار مصرف) */
export function consumeJustUpdated(): boolean {
  const at = readFlag(UPDATED_FLAG);
  if (!at) return false;
  try {
    sessionStorage.removeItem(UPDATED_FLAG);
  } catch {
    /* ignore */
  }
  return Date.now() - at < 60_000;
}

/** پیامهای خطای بارگذاری ماژول پویا در Chrome / Safari / Firefox. */
export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err ?? '');
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|ChunkLoadError|Unable to preload CSS|Failed to fetch module/i.test(
    msg,
  );
}
