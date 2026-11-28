/* Floating voice (lecture audio) pill — see lib/bgAudio.
   Draggable, edge-snapping pill following the same interaction spec as the
   floating video player (floatWidget): drag anywhere except the buttons,
   rubber-band at viewport edges, snap to the nearest horizontal edge on
   release, position persisted. The title reopens the full player at the same
   second; × stops and saves the position. A 2px progress line runs along the
   pill's bottom edge (podcast mini-player convention).

   Seamless handoff: the <audio> element is the app-wide singleton
   (lib/mediaHost) adopted into this pill by reparenting — playback never
   stops or re-buffers when the student leaves or reopens the voice screen. */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';

import './miniplayer.css';
import { bgAudio } from '../lib/bgAudio';
import type { BgTrack } from '../lib/bgAudio';
import {
  adoptMedia,
  mediaHasSrc,
  sharedMedia,
} from '../lib/mediaHost';
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

const POS_KEY = 'hz.miniAudio.pos';
const PILL_W = 336;

const clock = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${new Intl.NumberFormat('fa-IR').format(m)}:${new Intl.NumberFormat('fa-IR', { minimumIntegerDigits: 2 }).format(ss)}`;
};

function defaultPos(): FloatPos {
  if (typeof window === 'undefined') return { x: 20, y: 20 };
  const vw = window.innerWidth;
  const vh = window.visualViewport?.height ?? window.innerHeight;
  const tabbar = vw < 768 ? 76 : 0;
  return clampFloatPos(
    { x: (vw - PILL_W) / 2, y: vh - tabbar - 84 },
    { w: Math.min(PILL_W, vw - 16), h: 60 },
  );
}

export function MiniPlayer() {
  const track = useSyncExternalStore(bgAudio.subscribe, bgAudio.get);
  const navigate = useNavigate();
  const elRef = useRef<HTMLMediaElement | null>(null);
  if (elRef.current === null) elRef.current = sharedMedia('audio');
  const trackRef = useRef<BgTrack | null>(track);
  trackRef.current = track;
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const lastSaved = useRef(0);
  const refreshed = useRef(false);

  // floating pill state
  const [pos, setPos] = useState<FloatPos>(() => loadFloatState(POS_KEY, defaultPos()));
  const [dragging, setDragging] = useState(false);
  const [settling, setSettling] = useState(false);
  const dragStart = useRef<{ x: number; y: number; pos: FloatPos; moved: boolean } | null>(null);
  const settleTimer = useRef<number | null>(null);
  const posRef = useRef(pos);
  posRef.current = pos;
  const boxRef = useRef<HTMLDivElement | null>(null);

  const save = useCallback((t: number) => {
    const t2 = trackRef.current;
    if (!t2 || !(t > 0)) return;
    lastSaved.current = t;
    void reader
      .save(t2.scope, t2.id, { page: 1, total: 0, position: t, kind: 'audio' })
      .catch(() => undefined);
  }, []);

  // المنت مشترک را در پیل سوار می‌کنیم و شنونده‌ها را imperative وصل می‌کنیم؛
  // src هرگز از نو ست نمی‌شود مگر واقعاً فایل عوض شده باشد (بافر حفظ می‌شود).
  const mountRef = useCallback((node: HTMLElement | null) => {
    if (node) adoptMedia('audio', node);
  }, []);

  useEffect(() => {
    const a = elRef.current;
    if (!a) return;

    const sync = () => {
      setTime(a.currentTime);
      const d = Number.isFinite(a.duration) ? a.duration : 0;
      if (d > 0) setDur(d);
      setPlaying(!a.paused);
    };

    const onTime = () => {
      const t = a.currentTime;
      setTime(t);
      bgAudio.report(t);
      if (Math.abs(t - lastSaved.current) >= 15) save(t);
    };
    const onMeta = () => {
      const t = trackRef.current;
      if (Number.isFinite(a.duration)) setDur(a.duration);
      a.playbackRate = t?.rate || 1;
      if (t && t.at > 1 && a.currentTime < 1) a.currentTime = t.at;
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => {
      setPlaying(false);
      save(a.currentTime);
    };
    const onEnded = () => {
      setPlaying(false);
      bgAudio.stop();
    };
    const onError = () => {
      // لینک امضاشده وسط پخش منقضی شد: یک‌بار لینک تازه بگیر و همین‌جا ادامه بده
      const t = trackRef.current;
      if (refreshed.current || !t) return;
      refreshed.current = true;
      const at = a.currentTime;
      void reader
        .viewUrl(t.scope, t.id)
        .then((v) => {
          if (v.available && v.url) {
            a.src = v.url;
            if (at > 1) a.currentTime = at;
            void a.play().catch(() => undefined);
          }
        })
        .catch(() => undefined);
    };

    const map: Array<[string, EventListener]> = [
      ['timeupdate', onTime],
      ['loadedmetadata', onMeta],
      ['durationchange', onMeta],
      ['play', onPlay],
      ['pause', onPause],
      ['ended', onEnded],
      ['error', onError],
    ];
    map.forEach(([name, fn]) => a.addEventListener(name, fn));

    // حالت اولیه را از خود المنت بگیر (adopt زنده: بدون seek و بدون re-buffer)
    sync();
    if (trackRef.current) {
      const t = trackRef.current;
      if (!mediaHasSrc('audio', t.src)) {
        a.src = t.src;
        a.playbackRate = t.rate || 1;
        if (t.at > 1 && a.currentTime < 1) a.currentTime = t.at;
      }
      a.playbackRate = t.rate || 1;
      if (a.paused && a.readyState >= 2) void a.play().catch(() => undefined);
    }

    return () => {
      map.forEach(([name, fn]) => a.removeEventListener(name, fn));
    };
  }, [save]);

  // track تازه ممکن است بعد از mount برسد (سوییچ فایل داخل همان singleton)
  useEffect(() => {
    const a = elRef.current;
    if (!a || !track) return;
    refreshed.current = false;
    lastSaved.current = track.at;
    if (!mediaHasSrc('audio', track.src)) {
      a.src = track.src;
      a.playbackRate = track.rate || 1;
      if (track.at > 1 && a.currentTime < 1) a.currentTime = track.at;
      void a.play().catch(() => undefined);
    } else {
      a.playbackRate = track.rate || 1;
      setPlaying(!a.paused);
    }
  }, [track]);

  // lock screen / headset keys
  useEffect(() => {
    if (!track || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    try {
      ms.metadata = new MediaMetadata({ title: track.name, artist: 'هامزیار', album: 'ویس جلسه' });
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

  // keep the pill inside the viewport when the window is resized/rotated
  useEffect(() => {
    const onResize = () =>
      setPos((p) =>
        clampFloatPos(p, { w: boxRef.current?.offsetWidth || PILL_W, h: boxRef.current?.offsetHeight || 60 }),
      );
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
    };
  }, []);

  useEffect(
    () => () => {
      if (settleTimer.current) window.clearTimeout(settleTimer.current);
    },
    [],
  );

  if (!track) return null;

  const el = () => elRef.current;
  const toggle = () => {
    const a = el();
    if (!a) return;
    if (a.paused) void a.play().catch(() => undefined);
    else a.pause();
  };
  const skip = (d: number) => {
    const a = el();
    if (a) a.currentTime = Math.max(0, Math.min((a.duration || Infinity) - 0.25, a.currentTime + d));
  };
  const close = () => {
    const a = el();
    if (a) {
      save(a.currentTime);
      a.pause();
    }
    bgAudio.stop();
  };
  const open = () => {
    // the reader's player takes the track over (and the same live element) on mount
    navigate(track.returnTo);
  };

  const settle = (next: FloatPos) => {
    const box = { w: boxRef.current?.offsetWidth || PILL_W, h: boxRef.current?.offsetHeight || 60 };
    const snapped = snapEdgeX(next, box);
    setSettling(true);
    if (settleTimer.current) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => setSettling(false), 300);
    setPos(snapped);
    saveFloatState(POS_KEY, snapped);
  };

  /** درگ روی پیل (به‌جز دکمه‌ها): تپ = پخش/توقف، حرکت = جابه‌جایی */
  const onPillPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input')) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    dragStart.current = { x: e.clientX, y: e.clientY, pos: posRef.current, moved: false };
  }, []);

  const onPillPointerMove = useCallback((e: React.PointerEvent) => {
    const st = dragStart.current;
    if (!st) return;
    const dx = e.clientX - st.x;
    const dy = e.clientY - st.y;
    if (!st.moved && Math.hypot(dx, dy) < 6) return;
    if (!st.moved) {
      st.moved = true;
      setDragging(true);
    }
    setPos(rubberClampPos({ x: st.pos.x + dx, y: st.pos.y + dy }, { w: PILL_W, h: 60 }));
  }, []);

  const onPillPointerUp = useCallback(
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
      toggle();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [track],
  );

  const onPillPointerCancel = useCallback(() => {
    const st = dragStart.current;
    dragStart.current = null;
    if (st?.moved) {
      setDragging(false);
      settle(posRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pct = dur > 0 ? Math.min(100, (time / dur) * 100) : 0;

  return (
    <div
      ref={boxRef}
      className={`miniplayer${dragging ? ' is-dragging' : ''}${settling ? ' is-settling' : ''}`}
      style={
        {
          '--mp-x': `${pos.x}px`,
          '--mp-y': `${pos.y}px`,
        } as React.CSSProperties
      }
      role="region"
      aria-label="پخشکنندهٔ شناور ویس"
      onPointerDown={onPillPointerDown}
      onPointerMove={onPillPointerMove}
      onPointerUp={onPillPointerUp}
      onPointerCancel={onPillPointerCancel}
    >
      {/* المنت مشترک صدا اینجا سوار می‌شود (audio خودش layout ندارد) */}
      <span ref={mountRef} className="miniplayer__media-host" />

      <span className="miniplayer__art" aria-hidden="true">
        <Icon name="i-waveform" size={20} />
      </span>

      <div className="miniplayer__body">
        <button type="button" className="miniplayer__title" onClick={open} title="بازکردن پخشکننده">
          <bdi>{track.name}</bdi>
        </button>
        <span className="miniplayer__time num" dir="ltr">
          {clock(time)} / {clock(dur)}
        </span>
      </div>

      <button type="button" className="miniplayer__btn" onClick={() => skip(-15)} aria-label="۱۵ ثانیه عقب" title="۱۵ ثانیه عقب">
        <span className="miniplayer__skip num" aria-hidden="true">۱۵−</span>
      </button>

      <button type="button" className="miniplayer__btn miniplayer__play" onClick={toggle} aria-label={playing ? 'توقف' : 'پخش'} title={playing ? 'توقف' : 'پخش'}>
        {playing ? (
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" />
            <rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" />
          </svg>
        ) : (
          <Icon name="i-play" size={20} />
        )}
      </button>

      <button type="button" className="miniplayer__btn" onClick={close} aria-label="بستن پخشکننده" title="بستن">
        <Icon name="i-x" size={18} />
      </button>

      {/* خط پیشرفت ۲px لبهٔ پایین پیل (قرارداد پخش‌کننده‌های پادکست) */}
      <span
        className="miniplayer__prog"
        aria-hidden="true"
        ref={(el) => {
          el?.style.setProperty('--mp-pct', `${pct}%`);
        }}
      />
    </div>
  );
}
