/* Floating/PiP video player for background playback (see lib/bgVideo).
   Mounted once at the app root, outside the routes, so a lecture clip keeps
   playing — draggable, edge-snapping, resizable, minimizable to a bubble —
   while the student navigates elsewhere (e.g. opens the PDF reader to take
   notes). Native requestPictureInPicture is unavailable in iOS home-screen
   PWAs and WKWebView in-app browsers (WebKit bug 303885), so this in-page
   widget is the dependable cross-context mechanism.

   Interaction spec (iOS PiP / YouTube / Telegram conventions):
   - drag anywhere on the widget surface (except buttons), rubber-band at the
     viewport edges, snap to the nearest horizontal edge on release;
   - fixed 16:9 aspect — the corner handle scales the box, never distorts it;
   - minimize to a bubble docked at the edge; the single <video> element keeps
     playing (only the widget's box changes), so audio never restarts;
   - tap = play/pause, double-tap = reopen the full player;
   - transform/opacity animations only; no backdrop-filter on this moving
     surface (Safari repaint cost over playing video).

   Seamless handoff: the <video> is the app-wide singleton (lib/mediaHost)
   adopted into the stage by reparenting — leaving or reopening the video
   screen never re-buffers or flashes black.

   No drag/resize library is installed in this project (see package.json), so
   both gestures use plain pointer events with setPointerCapture — the same
   manual pattern as the reader's side-panel divider. */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';

import './floating-video-player.css';
import { bgVideo } from '../lib/bgVideo';
import { adoptMedia, mediaHasSrc, sharedMedia } from '../lib/mediaHost';
import {
  clampFloatPos,
  loadFloatState,
  rubberClampPos,
  saveFloatState,
  snapEdgeX,
  type FloatPos,
} from '../lib/floatWidget';
import { reader } from '../lib/reader';
import { Icon } from '../icons';

const POS_KEY = 'hz.floatingVideo.pos';
const W_KEY = 'hz.floatingVideo.w';
const HINT_KEY = 'hz.floatingVideo.hinted';
const MIN_W = 180;
const DEFAULT_W = 312; // 16:9 → 312×176
const BUBBLE = 56;

/** ثابت ۱۶:۹ — ارتفاع از عرض پیروی می‌کند تا ویدیو هیچ‌وقت کشیده نشود. */
const heightFor = (w: number) => Math.round((w * 9) / 16);

const clock = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${new Intl.NumberFormat('fa-IR').format(m)}:${new Intl.NumberFormat('fa-IR', { minimumIntegerDigits: 2 }).format(ss)}`;
};

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
const RATE_KEY = 'hym.media.rate';
const faRate = (r: number) => `${new Intl.NumberFormat('fa-IR').format(r)}×`;

function loadRate(): number {
  try {
    const v = Number(window.localStorage.getItem(RATE_KEY));
    return RATES.includes(v) ? v : 1;
  } catch {
    return 1;
  }
}

function maxW(): number {
  if (typeof window === 'undefined') return 560;
  return Math.max(MIN_W, Math.min(620, window.innerWidth - 24));
}

function defaultPos(w: number): FloatPos {
  if (typeof window === 'undefined') return { x: 20, y: 20 };
  return clampFloatPos({ x: window.innerWidth - w - 20, y: 96 }, { w, h: heightFor(w) });
}

export function FloatingVideoPlayer() {
  const track = useSyncExternalStore(bgVideo.subscribe, bgVideo.get);
  const navigate = useNavigate();
  const elRef = useRef<HTMLVideoElement | null>(null);
  if (elRef.current === null) elRef.current = sharedMedia('video') as HTMLVideoElement;
  const trackRef = useRef(track);
  trackRef.current = track;

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [mode, setMode] = useState<'full' | 'bubble'>('full');
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [settling, setSettling] = useState(false);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(loadRate);
  const [hint, setHint] = useState(false);

  const [w, setW] = useState<number>(() => {
    const s = loadFloatState(W_KEY, { w: DEFAULT_W });
    return Math.max(MIN_W, Math.min(maxW(), s.w || DEFAULT_W));
  });
  const [pos, setPos] = useState<FloatPos>(() =>
    loadFloatState(POS_KEY, defaultPos(loadFloatState(W_KEY, { w: DEFAULT_W }).w || DEFAULT_W)),
  );

  const lastSaved = useRef(0);
  const refreshed = useRef(false);
  const lastTap = useRef(0);
  const dragStart = useRef<{ x: number; y: number; pos: FloatPos; moved: boolean } | null>(null);
  const resizeStart = useRef<{ x: number; w: number } | null>(null);
  const settleTimer = useRef<number | null>(null);
  const posRef = useRef(pos);
  posRef.current = pos;
  const size = { w, h: heightFor(w) };
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const save = useCallback((t: number) => {
    const t2 = trackRef.current;
    if (!t2 || !(t > 0)) return;
    lastSaved.current = t;
    void reader
      .save(t2.scope, t2.id, { page: 1, total: 0, position: t, kind: 'video' })
      .catch(() => undefined);
  }, []);

  // new track: adopt the live element — no src reset when it already carries
  // this exact signed URL (handoff), otherwise mount the fresh file
  useEffect(() => {
    if (!track) return;
    const v = elRef.current;
    if (!v) return;
    refreshed.current = false;
    lastSaved.current = track.at;
    setTime(v.currentTime);
    setDur(Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0);
    setMode('full');
    setMuted(track.muted);
    setRate(track.rate || 1);
    v.muted = track.muted;
    v.playbackRate = track.rate || 1;
    if (!mediaHasSrc('video', track.src)) {
      v.src = track.src;
      if (track.at > 1) {
        const seek = () => {
          if (v.currentTime < 1) v.currentTime = track.at;
          v.removeEventListener('loadedmetadata', seek);
        };
        v.addEventListener('loadedmetadata', seek);
      }
      void v.play().catch(() => undefined);
    } else {
      setPlaying(!v.paused);
    }
    // keep the box on-screen even if the window was resized since it was last placed
    setPos((p) => clampFloatPos(p, sizeRef.current));
    // Telegram-style continuity is unexpected on the web: explain it once
    try {
      if (!window.localStorage.getItem(HINT_KEY)) {
        window.localStorage.setItem(HINT_KEY, '1');
        setHint(true);
        window.setTimeout(() => setHint(false), 4600);
      }
    } catch {
      /* private mode */
    }
  }, [track]);

  // bind the shared element's listeners once; state flows from the element itself
  const mountRef = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    const v = adoptMedia('video', node) as HTMLVideoElement;
    elRef.current = v;
    const onTime = () => {
      const t = v.currentTime;
      setTime(t);
      bgVideo.report(t);
      if (Math.abs(t - lastSaved.current) >= 15) save(t);
    };
    const onMeta = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) setDur(v.duration);
      const t = trackRef.current;
      if (t) v.playbackRate = t.rate || 1;
    };
    const map: Array<[string, EventListener]> = [
      ['timeupdate', onTime],
      ['loadedmetadata', onMeta],
      ['durationchange', onMeta],
      ['play', () => setPlaying(true)],
      ['pause', () => {
        setPlaying(false);
        save(v.currentTime);
      }],
      ['ended', () => {
        setPlaying(false);
        bgVideo.stop();
      }],
      ['error', () => {
        // signed link expired mid-play: fetch a fresh one once and keep the second
        const t = trackRef.current;
        if (refreshed.current || !t) return;
        refreshed.current = true;
        const at = v.currentTime;
        void reader
          .viewUrl(t.scope, t.id)
          .then((nv) => {
            if (nv.available && nv.url) {
              v.src = nv.url;
              if (at > 1) v.currentTime = at;
              void v.play().catch(() => undefined);
            }
          })
          .catch(() => undefined);
      }],
    ];
    map.forEach(([name, fn]) => v.addEventListener(name, fn));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // morph full ↔ bubble: keep the box reachable for its new size
  useEffect(() => {
    const box = mode === 'bubble' ? { w: BUBBLE, h: BUBBLE } : { w: sizeRef.current.w, h: heightFor(sizeRef.current.w) };
    setPos((p) => {
      const next = clampFloatPos(p, box);
      saveFloatState(POS_KEY, next);
      return next;
    });
  }, [mode]);

  useEffect(
    () => () => {
      if (settleTimer.current) window.clearTimeout(settleTimer.current);
    },
    [],
  );

  // keep the box inside the viewport if the window itself is resized/rotated
  useEffect(() => {
    const onResize = () => {
      setW((cw) => Math.max(MIN_W, Math.min(maxW(), cw)));
      setPos((p) => clampFloatPos(p, { w: sizeRef.current.w, h: heightFor(sizeRef.current.w) }));
    };
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
    };
  }, []);

  // MediaSession: lock-screen / headset controls while the lecture floats
  useEffect(() => {
    if (!track || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    try {
      ms.metadata = new MediaMetadata({ title: track.name, artist: 'هامزیار', album: 'ویدیو کلاس' });
      ms.setActionHandler('play', () => void elRef.current?.play().catch(() => undefined));
      ms.setActionHandler('pause', () => elRef.current?.pause());
    } catch {
      /* older browser */
    }
    return () => {
      try {
        ms.setActionHandler('play', null);
        ms.setActionHandler('pause', null);
      } catch {
        /* — */
      }
    };
  }, [track]);

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

  if (!track) return null;

  const el = () => elRef.current;
  const toggle = () => {
    const v = el();
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  };
  const skip = (d: number) => {
    const v = el();
    if (v) v.currentTime = Math.max(0, Math.min((v.duration || Infinity) - 0.25, v.currentTime + d));
  };
  const cycleRate = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(next);
    const v = el();
    if (v) v.playbackRate = next;
    try {
      window.localStorage.setItem(RATE_KEY, String(next));
    } catch {
      /* private mode */
    }
  };
  const toggleMute = () => {
    const v = el();
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };
  const close = () => {
    const v = el();
    if (v) {
      save(v.currentTime);
      v.pause();
    }
    bgVideo.stop();
  };
  const open = () => {
    // بازگشت به پخش‌کنندهٔ کامل — همان المنت زنده با adoption ادامه می‌یابد
    navigate(track.returnTo);
  };

  const settle = (next: FloatPos) => {
    const snapped = snapEdgeX(next, sizeRef.current);
    // transform-only settle animation: brief transition class, then back to raw tracking
    setSettling(true);
    if (settleTimer.current) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => setSettling(false), 300);
    setPos(snapped);
    saveFloatState(POS_KEY, snapped);
  };

  /** درگ روی کل سطح ویجت (به‌جز دکمه‌ها): تپ = پخش/توقف، حرکت = جابه‌جایی، دوتپ = بازکردن کامل */
  const onSurfacePointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input, .fvp__resize')) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    dragStart.current = { x: e.clientX, y: e.clientY, pos: posRef.current, moved: false };
  }, []);

  const onSurfacePointerMove = useCallback((e: React.PointerEvent) => {
    const st = dragStart.current;
    if (!st) return;
    const dx = e.clientX - st.x;
    const dy = e.clientY - st.y;
    if (!st.moved && Math.hypot(dx, dy) < 6) return;
    if (!st.moved) {
      st.moved = true;
      setDragging(true);
    }
    setPos(rubberClampPos({ x: st.pos.x + dx, y: st.pos.y + dy }, sizeRef.current));
  }, []);

  const onSurfacePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const st = dragStart.current;
      dragStart.current = null;
      if (!st) return;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (st.moved) {
        setDragging(false);
        settle(posRef.current);
        return;
      }
      // tap (no movement)
      const now = Date.now();
      if (now - lastTap.current < 300) {
        lastTap.current = 0;
        open();
        return;
      }
      lastTap.current = now;
      toggle();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [track],
  );

  const onSurfacePointerCancel = useCallback(() => {
    const st = dragStart.current;
    dragStart.current = null;
    if (st?.moved) {
      setDragging(false);
      settle(posRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    resizeStart.current = { x: e.clientX, w: sizeRef.current.w };
    setResizing(true);
  }, []);

  const onResizePointerMove = useCallback((e: React.PointerEvent) => {
    const st = resizeStart.current;
    if (!st) return;
    const isRtl = getComputedStyle(document.documentElement).direction === 'rtl';
    // Handle sits at the box's inline-start corner: dragging toward content shrinks it.
    const dirX = isRtl ? -1 : 1;
    const dw = (e.clientX - st.x) * dirX;
    setW(Math.max(MIN_W, Math.min(maxW(), st.w + dw)));
  }, []);

  const onResizePointerUp = useCallback((e: React.PointerEvent) => {
    if (!resizeStart.current) return;
    resizeStart.current = null;
    setResizing(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    setW((cw) => {
      const clamped = Math.max(MIN_W, Math.min(maxW(), cw));
      saveFloatState(W_KEY, { w: clamped });
      return clamped;
    });
    setPos((p) => {
      const clamped = clampFloatPos(p, { w: sizeRef.current.w, h: heightFor(sizeRef.current.w) });
      saveFloatState(POS_KEY, clamped);
      return clamped;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dragCls = `${dragging ? ' is-dragging' : ''}${resizing ? ' is-resizing' : ''}${settling ? ' is-settling' : ''}`;
  const isBubble = mode === 'bubble';

  return (
    <div
      className={`fvp${isBubble ? ' is-bubble' : ''}${dragCls}`}
      style={
        {
          '--fvp-x': `${pos.x}px`,
          '--fvp-y': `${pos.y}px`,
          '--fvp-w': isBubble ? `${BUBBLE}px` : `${size.w}px`,
          '--fvp-h': isBubble ? `${BUBBLE}px` : `${size.h}px`,
        } as React.CSSProperties
      }
      role="region"
      aria-label="پخشکنندهٔ شناور ویدیو"
      onPointerDown={onSurfacePointerDown}
      onPointerMove={onSurfacePointerMove}
      onPointerUp={onSurfacePointerUp}
      onPointerCancel={onSurfacePointerCancel}
    >
      {hint && !isBubble && (
        <div className="fvp__hint" role="status">
          <Icon name="i-video" size={14} />
          <span>ویدیو کنارت می‌ماند؛ هر صفحه‌ای بروی پخش ادامه پیدا می‌کند</span>
        </div>
      )}

      <div className="fvp__head">
        <button type="button" className="fvp__title" onClick={open} title="بازکردن پخشکننده کامل">
          <Icon name="i-video" size={14} />
          <bdi>{track.name}</bdi>
        </button>
        <div className="fvp__head-actions">
          <button
            type="button"
            className="fvp__btn"
            onClick={() => setMode('bubble')}
            aria-label="جمعکردن به حباب"
            title="جمعکردن به حباب"
          >
            <Icon name="i-collapse" size={14} />
          </button>
          <button type="button" className="fvp__btn" onClick={close} aria-label="بستن پخشکننده" title="بستن">
            <Icon name="i-x" size={14} />
          </button>
        </div>
      </div>

      <div className="fvp__stage">
        {/* المنت مشترک ویدیو — adoption به این استیج */}
        <div ref={mountRef} className="fvp__media-host" />
        {!playing && !isBubble && (
          <button type="button" className="fvp__play-ov" onClick={toggle} aria-label="پخش">
            <Icon name="i-play" size={22} />
          </button>
        )}
        <div
          className="fvp__resize"
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onPointerCancel={onResizePointerUp}
          role="separator"
          aria-label="تغییر اندازه"
          title="تغییر اندازه"
        />
      </div>

      <div className="fvp__bar">
        <button type="button" className="fvp__btn fvp__play" onClick={toggle} aria-label={playing ? 'توقف' : 'پخش'}>
          {playing ? (
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" />
              <rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" />
            </svg>
          ) : (
            <Icon name="i-play" size={16} />
          )}
        </button>
        <button type="button" className="fvp__btn" onClick={() => skip(-15)} aria-label="۱۵ ثانیه عقب">
          <span className="fvp__skip num" aria-hidden="true">۱۵−</span>
        </button>
        <input
          type="range"
          className="fvp__range"
          min={0}
          max={dur || 0}
          step={1}
          value={Math.min(time, dur || 0)}
          onChange={(e) => {
            const v = el();
            if (v) v.currentTime = Number(e.target.value);
          }}
          aria-label="موقعیت پخش"
          aria-valuetext={`${clock(time)} از ${clock(dur)}`}
          disabled={!dur}
        />
        <button
          type="button"
          className="fvp__btn fvp__rate num"
          onClick={cycleRate}
          aria-label={`سرعت پخش ${faRate(rate)}`}
          title="سرعت پخش"
        >
          {faRate(rate)}
        </button>
        <button
          type="button"
          className="fvp__btn"
          onClick={toggleMute}
          aria-label={muted ? 'روشن کردن صدا' : 'بی‌صدا'}
          title={muted ? 'روشن کردن صدا' : 'بی‌صدا'}
        >
          <Icon name={muted ? 'i-volume-x' : 'i-volume'} size={15} />
        </button>
        <span className="fvp__time num" dir="ltr">
          {clock(time)}
        </span>
      </div>

      {/* حباب: همان <video> زیرش پخش می‌شود؛ فقط جعبه عوض می‌شود */}
      {isBubble && (
        <div className="fvp__bubble-ui" aria-hidden={false}>
          <button
            type="button"
            className="fvp__bubble-btn"
            onClick={toggle}
            aria-label={playing ? 'توقف' : 'پخش'}
            title={playing ? 'توقف' : 'پخش'}
          >
            {playing ? (
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <rect x="7" y="5.5" width="3.6" height="13" rx="1.1" fill="currentColor" />
                <rect x="13.4" y="5.5" width="3.6" height="13" rx="1.1" fill="currentColor" />
              </svg>
            ) : (
              <Icon name="i-play" size={18} />
            )}
          </button>
          <button
            type="button"
            className="fvp__bubble-expand"
            onClick={() => setMode('full')}
            aria-label="بازکردن ویدیوی شناور"
            title="بازکردن"
          >
            <Icon name="i-expand" size={12} />
          </button>
          <button type="button" className="fvp__bubble-close" onClick={close} aria-label="بستن" title="بستن">
            <Icon name="i-x" size={11} />
          </button>
        </div>
      )}
    </div>
  );
}
