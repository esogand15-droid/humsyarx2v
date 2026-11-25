import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CSSProperties,
  KeyboardEvent as RKeyboardEvent,
  PointerEvent as RPointerEvent,
  SyntheticEvent,
} from 'react';

import '../../design/media.css';
import { Icon } from '../../icons';
import { fa, humanSize } from '../../lib/library';

interface Props {
  url: string;
  kind: 'video' | 'audio' | 'image';
  name: string;
  size: number;
  /** ثانیهٔ ذخیرهشده برای ادامهٔ پخش */
  startAt: number;
  onPosition: (seconds: number) => void;
  /** لینک امضاشدهٔ تازه (همان مسیر refresh ریدر PDF) */
  onExpired?: () => Promise<string | null>;
  /** زمان انقضای لینک فعلی (ms، ساعت همین مرورگر)؛ والد کمی قبل از آن لینک تازه میدهد */
  expiresAt?: number;
}

type PlayerProps = Omit<Props, 'kind'>;

/** پخش ویدیو/ویس و نمایش تصویر از همان آدرس رلهشده.
    Range پشتیبانی میشود، پس seek روی فایل بزرگ هم کار میکند. */
export function MediaView(props: Props) {
  if (props.kind === 'image') return <ImageView {...props} />;
  return (
    <div className="reader reader--media">
      {props.kind === 'video' ? <VideoPlayer {...props} /> : <AudioPlayer {...props} />}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* خطاها — علت واقعی را میگوییم، نه همیشه «لینک منقضی شد»          */
/* ---------------------------------------------------------------- */

type Fail = 'expired' | 'auth' | 'rate' | 'upstream' | 'format' | 'network';

const FAIL: Record<Fail, { title: string; text: string }> = {
  expired: {
    title: 'نشست پخش تمام شد',
    text: 'لینک این فایل دیگر معتبر نیست. «تلاش دوباره» را بزن تا از همانجا ادامه دهیم.',
  },
  auth: {
    title: 'به این فایل دسترسی نداری',
    text: 'اشتراک یا دسترسی این درس فعال نیست. اگر تازه تمدید کردهای، یک بار از حساب خارج و دوباره وارد شو.',
  },
  rate: {
    title: 'درخواستها زیاد شد',
    text: 'چند لحظه صبر کن و دوباره امتحان کن.',
  },
  upstream: {
    title: 'فایل از سرور نرسید',
    text: 'ارتباط سرور هامزیار با محل نگهداری فایل موقتاً برقرار نشد. چند ثانیه بعد دوباره امتحان کن.',
  },
  format: {
    title: 'مرورگر این فرمت را پخش نمیکند',
    text: 'این فایل با مرورگر فعلی سازگار نیست؛ Chrome یا Safari بهروز را امتحان کن یا فایل را از ربات دریافت کن.',
  },
  network: {
    title: 'اینترنت قطع است',
    text: 'اتصال اینترنت را بررسی کن؛ وقتی وصل شدی پخش از همانجا ادامه پیدا میکند.',
  },
};

/** <video>/<audio> کد HTTP را نمیگوید؛ با یک درخواست یکبایتی علت را میفهمیم. */
async function probe(url: string): Promise<Fail> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'network';
  try {
    const res = await fetch(url, {
      headers: { Range: 'bytes=0-0' },
      credentials: 'same-origin',
      cache: 'no-store',
    });
    try {
      await res.body?.cancel();
    } catch {
      /* بدنه مهم نیست */
    }
    if (res.status === 401) return 'expired';
    if (res.status === 402 || res.status === 403) return 'auth';
    if (res.status === 429) return 'rate';
    if (res.ok) return 'format';
    return 'upstream';
  } catch {
    return 'network';
  }
}

/* ---------------------------------------------------------------- */
/* کمکیها                                                            */
/* ---------------------------------------------------------------- */

const clock = (sec: number) => {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  const pad = (n: number) => `${n < 10 ? '۰' : ''}${fa(n)}`;
  return h > 0 ? `${fa(h)}:${pad(m)}:${pad(s)}` : `${fa(m)}:${pad(s)}`;
};

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
const RATE_KEY = 'hym.media.rate';
const rateLabel = (r: number) => `${fa(r)}×`;

function loadRate(): number {
  try {
    const v = Number(window.localStorage.getItem(RATE_KEY));
    return RATES.includes(v) ? v : 1;
  } catch {
    return 1;
  }
}

function bufferedEnd(el: HTMLMediaElement): number {
  const b = el.buffered;
  const t = el.currentTime;
  for (let i = 0; i < b.length; i += 1) {
    if (b.start(i) <= t + 0.5 && b.end(i) >= t) return b.end(i);
  }
  return t;
}

const ICON = {
  play: ['M8 5.5v13a1 1 0 0 0 1.53.85l10.4-6.5a1 1 0 0 0 0-1.7L9.53 4.65A1 1 0 0 0 8 5.5z'],
  pause: ['M7 5h3a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm7 0h3a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z'],
  back: ['M2.5 4v5.5H8', 'M4 15a8.5 8.5 0 1 0 1.9-8.8L2.5 9.5'],
  fwd: ['M21.5 4v5.5H16', 'M20 15a8.5 8.5 0 1 1-1.9-8.8l3.4 3.3'],
  max: ['M8 3H5a2 2 0 0 0-2 2v3', 'M21 8V5a2 2 0 0 0-2-2h-3', 'M16 21h3a2 2 0 0 0 2-2v-3', 'M3 16v3a2 2 0 0 0 2 2h3'],
  min: ['M8 3v3a2 2 0 0 1-2 2H3', 'M21 8h-3a2 2 0 0 1-2-2V3', 'M16 21v-3a2 2 0 0 1 2-2h3', 'M3 16h3a2 2 0 0 1 2 2v3'],
  vol: ['M11 5 6 9H2v6h4l5 4V5z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M19 5a10 10 0 0 1 0 14'],
  mute: ['M11 5 6 9H2v6h4l5 4V5z', 'm22 9-6 6', 'm16 9 6 6'],
  pip: ['M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'M13 12h6v4.5h-6z'],
  moon: ['M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z'],
  retry: ['M21 3v6h-6', 'M3 12a9 9 0 0 1 15.4-6.4L21 9', 'M3 21v-6h6', 'M21 12a9 9 0 0 1-15.4 6.4L3 15'],
  alert: ['M12 9v4', 'M12 17h.01', 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'],
};

function MI({
  d,
  size = 22,
  stroke = false,
  className,
}: {
  d: string[];
  size?: number;
  stroke?: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={className}
      fill={stroke ? 'none' : 'currentColor'}
      stroke={stroke ? 'currentColor' : 'none'}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {d.map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}

function SkipBtn({ sec, dir, onClick, size = 26 }: { sec: number; dir: -1 | 1; onClick: () => void; size?: number }) {
  const label = dir < 0 ? `${fa(sec)} ثانیه عقب` : `${fa(sec)} ثانیه جلو`;
  return (
    <button type="button" className="mbtn mbtn--skip" onClick={onClick} aria-label={label} title={label}>
      <MI d={dir < 0 ? ICON.back : ICON.fwd} stroke size={size} className="mbtn__arc" />
      <span className="mbtn__n num" aria-hidden="true">
        {fa(sec)}
      </span>
    </button>
  );
}

function FailBox({ fail, onRetry, overlay }: { fail: Fail; onRetry: () => void; overlay?: boolean }) {
  const f = FAIL[fail];
  const canRetry = fail !== 'auth' && fail !== 'format';
  return (
    <div className={`mfail${overlay ? ' mfail--overlay' : ''}`} role="alert">
      <span className="mfail__ic">
        <MI d={ICON.alert} stroke size={22} />
      </span>
      <div className="mfail__body">
        <p className="mfail__t">{f.title}</p>
        <p className="mfail__x">{f.text}</p>
      </div>
      {canRetry && (
        <button type="button" className="mfail__btn" onClick={onRetry}>
          <MI d={ICON.retry} stroke size={16} /> تلاش دوباره
        </button>
      )}
    </div>
  );
}

function Hints({ video }: { video: boolean }) {
  return (
    <p className="mhint">
      <kbd>Space</kbd> پخش/توقف · <kbd>←</kbd>
      <kbd>→</kbd> ۵ ثانیه · <kbd>J</kbd>
      <kbd>L</kbd> ۱۰ ثانیه · <kbd>M</kbd> بیصدا{video ? <> · <kbd>F</kbd> تمامصفحه</> : null} ·{' '}
      <kbd>&lt;</kbd>
      <kbd>&gt;</kbd> سرعت
    </p>
  );
}

/* ---------------------------------------------------------------- */
/* نوار زمان — RTL، نمایش بافر، کشیدن با لمس/ماوس، صفحهکلید          */
/* ---------------------------------------------------------------- */

function Timeline({
  time,
  dur,
  buffered,
  onSeek,
}: {
  time: number;
  dur: number;
  buffered: number;
  onSeek: (t: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const at = (clientX: number) => {
    const el = ref.current;
    if (!el || dur <= 0) return 0;
    const r = el.getBoundingClientRect();
    const rtl = getComputedStyle(el).direction === 'rtl';
    const x = rtl ? r.right - clientX : clientX - r.left;
    return Math.max(0, Math.min(1, x / Math.max(1, r.width))) * dur;
  };

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (dur <= 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(at(e.clientX));
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (drag !== null) setDrag(at(e.clientX));
    else if (e.pointerType === 'mouse') setHover(at(e.clientX));
  };
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (drag === null) return;
    const v = at(e.clientX);
    setDrag(null);
    onSeek(v);
  };
  const onKey = (e: RKeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = time + 5;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = time - 5;
    else if (e.key === 'PageUp') next = time + 60;
    else if (e.key === 'PageDown') next = time - 60;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = dur;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    onSeek(next);
  };

  const shown = drag ?? time;
  const pct = dur > 0 ? Math.min(100, (shown / dur) * 100) : 0;
  const bpct = dur > 0 ? Math.min(100, (buffered / dur) * 100) : 0;
  const tip = drag ?? hover;

  return (
    <div
      ref={ref}
      className={`mtl${drag !== null ? ' is-drag' : ''}${dur <= 0 ? ' is-empty' : ''}`}
      role="slider"
      tabIndex={0}
      aria-label="جای پخش"
      aria-valuemin={0}
      aria-valuemax={Math.floor(dur)}
      aria-valuenow={Math.floor(shown)}
      aria-valuetext={`${clock(shown)} از ${clock(dur)}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => setDrag(null)}
      onPointerLeave={() => setHover(null)}
      onKeyDown={onKey}
    >
      <div className="mtl__track">
        <div className="mtl__buf" style={{ width: `${bpct}%` }} />
        <div className="mtl__played" style={{ width: `${pct}%` }} />
        <div className="mtl__thumb" style={{ insetInlineStart: `${pct}%` }} />
      </div>
      {tip !== null && dur > 0 && (
        <span className="mtl__tip num" style={{ insetInlineStart: `${(tip / dur) * 100}%` }}>
          {clock(tip)}
        </span>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* موتور مشترک پخش: ادامه از همانجا، بازیابی خودکار، ذخیرهٔ موقعیت،  */
/* Media Session (لاکاسکرین) و میانبرهای صفحهکلید                    */
/* ---------------------------------------------------------------- */

interface EngineOpts extends PlayerProps {
  kind: 'video' | 'audio';
  onFullscreen?: () => void;
}

function useMediaEngine(opts: EngineOpts) {
  const ref = useRef<HTMLMediaElement | null>(null);
  const [src, setSrc] = useState(opts.url);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [slow, setSlow] = useState(false);
  const [rate, setRateState] = useState(loadRate);
  const [muted, setMuted] = useState(false);
  const [fail, setFail] = useState<Fail | null>(null);
  const [resumed, setResumed] = useState(0);

  const resumeAt = useRef(opts.startAt >= 3 ? opts.startAt : 0);
  const firstLoad = useRef(true);
  const wantPlay = useRef(false);
  const swapping = useRef(false);
  const lastSaved = useRef(0);
  const autoTries = useRef(0);
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const failRef = useRef(fail);
  failRef.current = fail;
  const posCb = useRef(opts.onPosition);
  posCb.current = opts.onPosition;
  const expCb = useRef(opts.onExpired);
  expCb.current = opts.onExpired;
  const fsCb = useRef(opts.onFullscreen);
  fsCb.current = opts.onFullscreen;
  /** لینک تازهای که هنوز سوار نشده (پخش روان است و نمیخواهیم قطعش کنیم) */
  const pendingSrc = useRef<string | null>(null);
  /** reload پس از خطا: لینک تازهٔ والد باید فوراً سوار شود، نه معلق بماند */
  const forceSwap = useRef(false);

  /** سوار کردن لینک تازه با حفظ ثانیهٔ پخش و وضعیت پخش/توقف. */
  const applySwap = useCallback((next: string, at?: number) => {
    const el = ref.current;
    if (el) {
      const t = at ?? el.currentTime;
      if (t > 1) resumeAt.current = t;
      wantPlay.current = wantPlay.current || !el.paused;
    }
    pendingSrc.current = null;
    forceSwap.current = false;
    swapping.current = true;
    setFail(null);
    setSrc(next);
  }, []);

  const save = useCallback((t: number) => {
    lastSaved.current = t;
    posCb.current(t);
  }, []);

  // موقعیت ذخیرهشده ممکن است کمی بعد از mount برسد
  useEffect(() => {
    const el = ref.current;
    if (opts.startAt >= 3 && (!el || el.readyState < 1)) resumeAt.current = opts.startAt;
  }, [opts.startAt]);

  // لینک تازه از والد ⇒ جابهجایی src بدون از دست رفتن جای پخش
  // تازهسازی پیشدستانه وسط پخش روان: اتصال باز را نمیبُریم؛ لینک تازه
  // معلق میماند و در اولین seek/خطا/گیر بدون درخواست شبکهٔ اضافه سوار میشود.
  useEffect(() => {
    if (opts.url === src) {
      pendingSrc.current = null;
      return;
    }
    const el = ref.current;
    if (!forceSwap.current && el && !el.error && !failRef.current && el.readyState >= 1) {
      pendingSrc.current = opts.url;
      return;
    }
    applySwap(opts.url);
    // src عمداً در وابستگیها نیست: فقط تغییر لینک والد مهم است
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.url]);

  // اگر بافر اول طول کشید، توضیح بده (اولین پخش فایل بزرگ از تلگرام)
  useEffect(() => {
    if (!waiting || fail) {
      setSlow(false);
      return;
    }
    const t = window.setTimeout(() => setSlow(true), 4000);
    return () => window.clearTimeout(t);
  }, [waiting, fail]);

  // چیپ «از … ادامه دادیم» چند ثانیه بعد خودش میرود
  useEffect(() => {
    if (!resumed) return;
    const t = window.setTimeout(() => setResumed(0), 9000);
    return () => window.clearTimeout(t);
  }, [resumed]);

  const reload = useCallback(
    async (auto: boolean) => {
      const el = ref.current;
      if (el) {
        if (el.currentTime > 1) resumeAt.current = el.currentTime;
        wantPlay.current = wantPlay.current || !el.paused || !auto;
      }
      if (!auto) autoTries.current = 0;
      setFail(null);
      setWaiting(true);
      if (pendingSrc.current) {
        applySwap(pendingSrc.current);
        return;
      }
      swapping.current = true;
      forceSwap.current = true;
      const fresh = expCb.current ? await expCb.current() : null;
      if (fresh && fresh !== src) return; // اثر بالا src را عوض میکند
      forceSwap.current = false;
      ref.current?.load();
    },
    [src, applySwap],
  );

  const onError = useCallback(async () => {
    const el = ref.current;
    if (!el || !el.error) return;
    // لینک تازه از قبل آماده است ⇒ بیصدا سوار کن، بدون probe و بدون پیام
    if (pendingSrc.current) {
      applySwap(pendingSrc.current);
      return;
    }
    if (el.currentTime > 1) resumeAt.current = el.currentTime;
    const why = await probe(el.currentSrc || src);
    if (autoTries.current < 2 && (why === 'expired' || why === 'upstream' || why === 'network')) {
      autoTries.current += 1;
      const delay = why === 'expired' ? 0 : 1500 * autoTries.current;
      window.setTimeout(() => void reload(true), delay);
      return;
    }
    swapping.current = false;
    setWaiting(false);
    setPlaying(false);
    setFail(why);
  }, [src, reload, applySwap]);

  // اینترنت برگشت ⇒ خودکار ادامه
  useEffect(() => {
    const on = () => {
      if (failRef.current === 'network' || failRef.current === 'upstream') void reload(false);
    };
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, [reload]);

  const toggle = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (failRef.current) {
      void reload(false);
      return;
    }
    if (el.paused) {
      wantPlay.current = true;
      // A fresh link is waiting (refreshed while paused): mount it now, before play makes a new request
      if (pendingSrc.current) {
        setWaiting(true);
        applySwap(pendingSrc.current);
        return;
      }
      if (el.readyState < 3) setWaiting(true);
      void el.play().catch(() => setWaiting(false));
    } else {
      el.pause();
    }
  }, [reload, applySwap]);

  const seek = useCallback((t: number) => {
    const el = ref.current;
    if (!el) return;
    const d = Number.isFinite(el.duration) ? el.duration : 0;
    const v = Math.max(0, d > 0 ? Math.min(d - 0.25, t) : t);
    setTime(v);
    // seek درخواست Range تازه میسازد؛ اگر لینک تازه آماده است همینجا سوارش کن
    if (pendingSrc.current) {
      applySwap(pendingSrc.current, v);
      return;
    }
    el.currentTime = v;
  }, [applySwap]);

  const skip = useCallback(
    (delta: number) => {
      const el = ref.current;
      if (el) seek(el.currentTime + delta);
    },
    [seek],
  );

  const setRate = useCallback((r: number) => {
    const el = ref.current;
    if (el) {
      el.defaultPlaybackRate = r;
      el.playbackRate = r;
    }
    setRateState(r);
    try {
      window.localStorage.setItem(RATE_KEY, String(r));
    } catch {
      /* حالت خصوصی */
    }
  }, []);

  const rateStep = useCallback(
    (step: 1 | -1) => {
      const i = RATES.indexOf(rateRef.current);
      setRate(RATES[Math.max(0, Math.min(RATES.length - 1, (i < 0 ? 1 : i) + step))]);
    },
    [setRate],
  );
  const cycleRate = useCallback(() => {
    const i = RATES.indexOf(rateRef.current);
    setRate(RATES[(i + 1) % RATES.length]);
  }, [setRate]);

  const toggleMute = useCallback(() => {
    const el = ref.current;
    if (el) el.muted = !el.muted;
  }, []);

  const restart = useCallback(() => {
    seek(0);
    save(0);
    setResumed(0);
  }, [seek, save]);

  // ذخیرهٔ موقعیت وقتی تب پنهان/بسته میشود یا صفحه را ترک میکنیم
  useEffect(() => {
    const flush = () => {
      const el = ref.current;
      if (el && !swapping.current && el.currentTime > 0 && Math.abs(el.currentTime - lastSaved.current) >= 1) {
        save(el.currentTime);
      }
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      flush();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [save]);

  // Media Session: عنوان و کنترل روی لاکاسکرین / کلیدهای مدیا
  const ctl = useRef({ toggle, skip, seek });
  ctl.current = { toggle, skip, seek };
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const base = import.meta.env.BASE_URL || '/';
    try {
      ms.metadata = new MediaMetadata({
        title: opts.name,
        artist: 'هامزیار',
        album: opts.kind === 'video' ? 'ویدیو کلاس' : 'ویس جلسه',
        artwork: [
          { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
          { src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
        ],
      });
    } catch {
      /* مرورگر قدیمی */
    }
    const set = (a: MediaSessionAction, h: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(a, h);
      } catch {
        /* اکشن پشتیبانی نمیشود */
      }
    };
    set('play', () => void ref.current?.play().catch(() => undefined));
    set('pause', () => ref.current?.pause());
    set('seekbackward', (d) => ctl.current.skip(-(d.seekOffset || 10)));
    set('seekforward', (d) => ctl.current.skip(d.seekOffset || 10));
    set('seekto', (d) => {
      if (d.seekTime != null) ctl.current.seek(d.seekTime);
    });
    return () => {
      (['play', 'pause', 'seekbackward', 'seekforward', 'seekto'] as MediaSessionAction[]).forEach((a) => set(a, null));
      try {
        ms.metadata = null;
      } catch {
        /* — */
      }
    };
  }, [opts.name, opts.kind]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    } catch {
      /* — */
    }
  }, [playing]);

  const bucket = Math.floor(time / 5);
  useEffect(() => {
    if (!('mediaSession' in navigator) || !(dur > 0)) return;
    try {
      navigator.mediaSession.setPositionState({ duration: dur, playbackRate: rate, position: Math.min(time, dur) });
    } catch {
      /* — */
    }
    // فقط هر ۵ ثانیه؛ time عمداً وابستگی نیست
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket, dur, rate]);

  // میانبرهای صفحهکلید (با e.code تا روی کیبورد فارسی هم کار کند)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      switch (e.code) {
        case 'Space':
        case 'KeyK':
          if (tag === 'BUTTON' && e.code === 'Space') return;
          toggle();
          break;
        case 'ArrowRight':
          skip(5);
          break;
        case 'ArrowLeft':
          skip(-5);
          break;
        case 'KeyL':
          skip(10);
          break;
        case 'KeyJ':
          skip(-10);
          break;
        case 'KeyM':
          toggleMute();
          break;
        case 'KeyF':
          if (!fsCb.current) return;
          fsCb.current();
          break;
        case 'Period':
          if (!e.shiftKey) return;
          rateStep(1);
          break;
        case 'Comma':
          if (!e.shiftKey) return;
          rateStep(-1);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, skip, toggleMute, rateStep]);

  const handlers = {
    onLoadedMetadata: (e: SyntheticEvent<HTMLMediaElement>) => {
      const el = e.currentTarget;
      const d = Number.isFinite(el.duration) ? el.duration : 0;
      setDur(d);
      el.defaultPlaybackRate = rateRef.current;
      el.playbackRate = rateRef.current;
      const at = resumeAt.current;
      if (at >= 1 && (!d || at < d - 3)) {
        try {
          el.currentTime = at;
          lastSaved.current = at;
        } catch {
          /* فرمتهایی که seek اولیه را نمیپذیرند از ابتدا پخش میشوند */
        }
        if (firstLoad.current && at >= 3) setResumed(at);
      }
      firstLoad.current = false;
      resumeAt.current = 0;
      swapping.current = false;
      if (wantPlay.current) void el.play().catch(() => setWaiting(false));
    },
    onDurationChange: (e: SyntheticEvent<HTMLMediaElement>) => {
      const d = e.currentTarget.duration;
      if (Number.isFinite(d)) setDur(d);
    },
    onCanPlay: () => {
      autoTries.current = 0;
      if (!wantPlay.current) setWaiting(false);
    },
    onWaiting: () => setWaiting(true),
    // گیر در بافر نزدیک انقضا: لینک تازهٔ آماده را سوار کن
    onStalled: () => {
      if (pendingSrc.current) applySwap(pendingSrc.current);
    },
    onPlaying: () => {
      setWaiting(false);
      setPlaying(true);
      autoTries.current = 0;
    },
    onPlay: () => {
      wantPlay.current = true;
      setPlaying(true);
    },
    onPause: (e: SyntheticEvent<HTMLMediaElement>) => {
      setPlaying(false);
      if (swapping.current) return;
      wantPlay.current = false;
      setWaiting(false);
      save(e.currentTarget.currentTime);
    },
    onEnded: (e: SyntheticEvent<HTMLMediaElement>) => {
      setPlaying(false);
      wantPlay.current = false;
      save(e.currentTarget.duration || 0);
    },
    onTimeUpdate: (e: SyntheticEvent<HTMLMediaElement>) => {
      const el = e.currentTarget;
      const t = el.currentTime;
      setTime(t);
      setBuffered(bufferedEnd(el));
      // Math.abs: بعد از seek به عقب هم ذخیره میشود (قبلاً گیر میکرد)
      if (!swapping.current && Math.abs(t - lastSaved.current) >= 5) save(t);
    },
    onProgress: (e: SyntheticEvent<HTMLMediaElement>) => setBuffered(bufferedEnd(e.currentTarget)),
    onVolumeChange: (e: SyntheticEvent<HTMLMediaElement>) => setMuted(e.currentTarget.muted),
    onError: () => void onError(),
  };

  return {
    ref,
    src,
    playing,
    time,
    dur,
    buffered,
    waiting,
    slow,
    rate,
    muted,
    fail,
    resumed,
    handlers,
    toggle,
    seek,
    skip,
    cycleRate,
    toggleMute,
    restart,
    reload,
  };
}

type Engine = ReturnType<typeof useMediaEngine>;

function ResumeChip({ m }: { m: Engine }) {
  if (!m.resumed) return null;
  return (
    <button type="button" className="mchip" onClick={m.restart}>
      از <span className="num">{clock(m.resumed)}</span> ادامه دادیم · شروع از اول
    </button>
  );
}

/* ---------------------------------------------------------------- */
/* ویدیو                                                             */
/* ---------------------------------------------------------------- */

type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type FsEl = HTMLDivElement & { webkitRequestFullscreen?: () => void };
type IosVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

function VideoPlayer(p: PlayerProps) {
  const stage = useRef<HTMLDivElement>(null);
  const [fs, setFs] = useState(false);
  const [idle, setIdle] = useState(false);
  const [flash, setFlash] = useState<{ left: boolean; back: boolean; key: number } | null>(null);
  const idleTimer = useRef<number | null>(null);
  const tapTimer = useRef<number | null>(null);
  const lastTap = useRef(0);
  const idleRef = useRef(idle);
  idleRef.current = idle;

  const toggleFs = useCallback(() => {
    const d = document as FsDoc;
    const st = stage.current as FsEl | null;
    const v = st?.querySelector('video') as IosVideo | null;
    if (d.fullscreenElement || d.webkitFullscreenElement) {
      if (d.exitFullscreen) void d.exitFullscreen().catch(() => undefined);
      else d.webkitExitFullscreen?.();
      return;
    }
    if (st?.requestFullscreen) {
      st
        .requestFullscreen()
        .then(() => {
          const o = screen.orientation as unknown as { lock?: (x: string) => Promise<void> } | undefined;
          o?.lock?.('landscape').catch(() => undefined);
        })
        .catch(() => v?.webkitEnterFullscreen?.());
      return;
    }
    if (st?.webkitRequestFullscreen) {
      st.webkitRequestFullscreen();
      return;
    }
    // آیفون: فقط پخش تمامصفحهٔ بومی
    v?.webkitEnterFullscreen?.();
  }, []);

  const m = useMediaEngine({ ...p, kind: 'video', onFullscreen: toggleFs });
  const playingRef = useRef(m.playing);
  playingRef.current = m.playing;

  useEffect(() => {
    const on = () => {
      const d = document as FsDoc;
      setFs(Boolean(d.fullscreenElement || d.webkitFullscreenElement));
    };
    document.addEventListener('fullscreenchange', on);
    document.addEventListener('webkitfullscreenchange', on);
    return () => {
      document.removeEventListener('fullscreenchange', on);
      document.removeEventListener('webkitfullscreenchange', on);
    };
  }, []);

  const wake = useCallback(() => {
    setIdle(false);
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      if (playingRef.current) setIdle(true);
    }, 2800);
  }, []);

  useEffect(() => {
    if (m.playing) wake();
    else setIdle(false);
  }, [m.playing, wake]);

  useEffect(
    () => () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      if (tapTimer.current) window.clearTimeout(tapTimer.current);
    },
    [],
  );

  const pipOk =
    typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled;
  const togglePip = async () => {
    const v = stage.current?.querySelector('video');
    if (!v) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
    } catch {
      /* — */
    }
  };

  // ماوس: کلیک = پخش/توقف. لمس: یک ضربه = نمایش کنترلها، دو ضربه کنارهها = ±۱۰ ثانیه
  const onStageUp = (e: RPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.vctl, .vbig, .mfail, .mchip')) return;
    if (e.pointerType === 'mouse') {
      if (e.button === 0) m.toggle();
      wake();
      return;
    }
    const now = Date.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (now - lastTap.current < 300) {
      lastTap.current = 0;
      if (tapTimer.current) {
        window.clearTimeout(tapTimer.current);
        tapTimer.current = null;
      }
      const third = rect.width / 3;
      if (x < third || x > 2 * third) {
        const left = x < third;
        const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
        // در RTL ابتدای زمان سمت راست است
        const back = rtl ? !left : left;
        m.skip(back ? -10 : 10);
        const key = now;
        setFlash({ left, back, key });
        window.setTimeout(() => setFlash((f) => (f && f.key === key ? null : f)), 650);
      } else {
        m.toggle();
      }
      return;
    }
    lastTap.current = now;
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = null;
      if (idleRef.current || !playingRef.current) wake();
      else setIdle(true);
    }, 260);
  };

  return (
    <div className="mplayer mplayer--video">
      <div
        ref={stage}
        className={`vstage${idle ? ' is-idle' : ''}${fs ? ' is-fs' : ''}${m.playing ? ' is-playing' : ''}`}
        onPointerMove={(e) => {
          if (e.pointerType === 'mouse') wake();
        }}
        onPointerUp={onStageUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        <video
          ref={(el) => {
            m.ref.current = el;
          }}
          src={m.src}
          preload="metadata"
          playsInline
          controlsList="nodownload"
          disablePictureInPicture={!pipOk}
          {...m.handlers}
        >
          مرورگر تو پخش ویدیو را پشتیبانی نمیکند.
        </video>

        <div className="vstage__shade" aria-hidden="true" />
        {fs && <p className="vstage__title">{p.name}</p>}

        {flash && (
          <div key={flash.key} className={`vflash ${flash.left ? 'vflash--left' : 'vflash--right'}`} aria-hidden="true">
            <MI d={flash.back ? ICON.back : ICON.fwd} stroke size={26} className="mbtn__arc" />
            <span className="num">{flash.back ? '−' : '+'}۱۰</span>
          </div>
        )}

        {m.waiting && !m.fail && (
          <div className="vspin" aria-live="polite">
            <span className="mspinner" aria-hidden="true" />
            <span className="vspin__t">{m.slow ? 'اولین پخش این فایل کمی طول میکشد…' : 'در حال بارگذاری…'}</span>
          </div>
        )}

        {!m.playing && !m.waiting && !m.fail && (
          <button type="button" className="vbig" onClick={m.toggle} aria-label="پخش">
            <MI d={ICON.play} size={34} />
          </button>
        )}

        {m.fail && <FailBox fail={m.fail} onRetry={() => void m.reload(false)} overlay />}

        <div className="vctl">
          <Timeline time={m.time} dur={m.dur} buffered={m.buffered} onSeek={m.seek} />
          <div className="vctl__row">
            <button type="button" className="mbtn" onClick={m.toggle} aria-label={m.playing ? 'توقف' : 'پخش'}>
              <MI d={m.playing ? ICON.pause : ICON.play} />
            </button>
            <SkipBtn sec={10} dir={-1} onClick={() => m.skip(-10)} />
            <SkipBtn sec={10} dir={1} onClick={() => m.skip(10)} />
            <span className="vtime">
              <span className="num" dir="ltr">
                {clock(m.time)}
              </span>
              <span className="vtime__sep"> / </span>
              <span className="num" dir="ltr">
                {clock(m.dur)}
              </span>
            </span>
            <span className="vctl__spacer" />
            <button
              type="button"
              className="mbtn mbtn--txt num"
              onClick={m.cycleRate}
              aria-label={`سرعت پخش ${fa(m.rate)} برابر؛ برای تغییر بزن`}
            >
              {rateLabel(m.rate)}
            </button>
            <button
              type="button"
              className="mbtn vctl__opt"
              onClick={m.toggleMute}
              aria-label={m.muted ? 'روشن کردن صدا' : 'بیصدا'}
            >
              <MI d={m.muted ? ICON.mute : ICON.vol} stroke />
            </button>
            {pipOk && (
              <button type="button" className="mbtn vctl__opt" onClick={() => void togglePip()} aria-label="تصویر در تصویر">
                <MI d={ICON.pip} stroke />
              </button>
            )}
            <button type="button" className="mbtn" onClick={toggleFs} aria-label={fs ? 'خروج از تمامصفحه' : 'تمامصفحه'}>
              <MI d={fs ? ICON.min : ICON.max} stroke />
            </button>
          </div>
        </div>
      </div>

      <section className="minfo">
        <span className="minfo__ic" aria-hidden="true">
          <Icon name="i-video" size={22} />
        </span>
        <div className="minfo__body">
          <h2 className="minfo__t">{p.name}</h2>
          <p className="minfo__s">
            {['ویدیو کلاس', m.dur > 0 ? clock(m.dur) : '', humanSize(p.size)].filter(Boolean).join(' · ')}
          </p>
        </div>
        <ResumeChip m={m} />
      </section>
      <Hints video />
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* ویس                                                               */
/* ---------------------------------------------------------------- */

const WAVE = Array.from({ length: 36 }, (_, i) => 0.3 + 0.7 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.55)));
const SLEEPS = [0, 15, 30, 60];

function AudioPlayer(p: PlayerProps) {
  const m = useMediaEngine({ ...p, kind: 'audio' });
  const [sleep, setSleep] = useState(0);

  // تایمر خواب: بعد از چند دقیقه خودکار متوقف
  useEffect(() => {
    if (!sleep) return;
    const t = window.setTimeout(() => {
      m.ref.current?.pause();
      setSleep(0);
    }, sleep * 60_000);
    return () => window.clearTimeout(t);
  }, [sleep, m.ref]);

  const remaining = m.dur > 0 ? Math.max(0, m.dur - m.time) : 0;

  return (
    <div className="mplayer mplayer--audio">
      <audio
        ref={(el) => {
          m.ref.current = el;
        }}
        src={m.src}
        preload="metadata"
        {...m.handlers}
      >
        مرورگر تو پخش صدا را پشتیبانی نمیکند.
      </audio>

      <div className={`aplayer${m.playing ? ' is-playing' : ''}`}>
        <div className="aplayer__art" aria-hidden="true">
          <span className="aplayer__ring" />
          <span className="aplayer__ring aplayer__ring--2" />
          <span className="aplayer__disc" />
        </div>

        <div className="aplayer__wave" aria-hidden="true">
          {WAVE.map((h, i) => (
            <i key={i} style={{ '--h': h.toFixed(2), '--d': `${((i * 7) % 11) * 0.09}s` } as CSSProperties} />
          ))}
        </div>

        <div className="aplayer__meta">
          <h2 className="aplayer__title">{p.name}</h2>
          <p className="aplayer__sub">
            {['ویس جلسه', m.dur > 0 ? clock(m.dur) : '', humanSize(p.size)].filter(Boolean).join(' · ')}
          </p>
        </div>

        <Timeline time={m.time} dur={m.dur} buffered={m.buffered} onSeek={m.seek} />
        <div className="aplayer__times">
          <span className="num" dir="ltr">
            {clock(m.time)}
          </span>
          <span className="num" dir="ltr">
            −{clock(remaining)}
          </span>
        </div>

        <div className="aplayer__ctl">
          <button
            type="button"
            className="mbtn mbtn--txt aplayer__side num"
            onClick={m.cycleRate}
            aria-label={`سرعت پخش ${fa(m.rate)} برابر؛ برای تغییر بزن`}
          >
            {rateLabel(m.rate)}
          </button>
          <SkipBtn sec={15} dir={-1} onClick={() => m.skip(-15)} size={30} />
          <button type="button" className="aplayer__play" onClick={m.toggle} aria-label={m.playing ? 'توقف' : 'پخش'}>
            {m.waiting && !m.fail ? (
              <span className="mspinner mspinner--on-brand" aria-hidden="true" />
            ) : (
              <MI d={m.playing ? ICON.pause : ICON.play} size={30} />
            )}
          </button>
          <SkipBtn sec={15} dir={1} onClick={() => m.skip(15)} size={30} />
          <button
            type="button"
            className={`mbtn mbtn--txt aplayer__side${sleep ? ' is-on' : ''}`}
            onClick={() => setSleep(SLEEPS[(SLEEPS.indexOf(sleep) + 1) % SLEEPS.length])}
            aria-label={sleep ? `تایمر خواب: ${fa(sleep)} دقیقه` : 'تایمر خواب خاموش'}
            title="تایمر خواب"
          >
            <MI d={ICON.moon} stroke size={17} />
            {sleep ? <span className="num">{fa(sleep)}′</span> : null}
          </button>
        </div>

        {m.fail && <FailBox fail={m.fail} onRetry={() => void m.reload(false)} />}
        {m.slow && m.waiting && !m.fail && (
          <p className="aplayer__note">اولین پخش این فایل کمی طول میکشد؛ دفعههای بعد فوری است.</p>
        )}
        <ResumeChip m={m} />
      </div>
      <Hints video={false} />
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* تصویر                                                             */
/* ---------------------------------------------------------------- */

function ImageView({ url, name, size, onExpired }: Props) {
  const [failed, setFailed] = useState(false);
  const tried = useRef(false);
  return (
    <div className="reader reader--image">
      <img
        src={url}
        alt={name}
        className="reader__img"
        decoding="async"
        onLoad={() => setFailed(false)}
        onError={() => {
          if (!tried.current && onExpired) {
            tried.current = true;
            void onExpired();
            return;
          }
          setFailed(true);
        }}
      />
      {failed && (
        <FailBox
          fail="upstream"
          onRetry={() => {
            tried.current = false;
            setFailed(false);
            void onExpired?.();
          }}
        />
      )}
      <p className="tiny mt-8">{humanSize(size)}</p>
    </div>
  );
}
