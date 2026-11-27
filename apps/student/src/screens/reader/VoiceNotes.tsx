import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../icons';
import { fa } from '../../lib/library';
import { voiceNotes, type VoiceNote } from '../../lib/voiceNotes';
import './voice-notes.css';

/** Longest single recording; the recorder stops and saves on its own at this point. */
export const MAX_RECORD_MS = 10 * 60 * 1000;

export type VoiceNoteView = VoiceNote & { local?: { blob: Blob; status: 'uploading' | 'failed' } };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function voiceRecordingSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder !== 'undefined'
  );
}

/** Opus in WebM where supported (Chrome/Android/Firefox), AAC in MP4 on Safari/iPad. */
function pickMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
  for (const m of candidates) {
    try {
      if (MediaRecorder.isTypeSupported?.(m)) return m;
    } catch {
      // older Safari throws on unknown types
    }
  }
  return '';
}

export const formatClock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return fa(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
};

// ── Audio cache: one blob URL per note, shared by every pin and kept for the session ──
const audioUrls = new Map<string, Promise<string>>();
let currentAudio: HTMLAudioElement | null = null;

export function seedVoiceAudio(voiceId: string, blob: Blob): void {
  audioUrls.set(voiceId, Promise.resolve(URL.createObjectURL(blob)));
}

/** A local recording that reached the server keeps playing from the blob already in memory. */
export function shareVoiceAudio(fromId: string, toId: string): void {
  const p = audioUrls.get(fromId);
  if (p) audioUrls.set(toId, p);
}

function loadVoiceAudio(voiceId: string): Promise<string> {
  let p = audioUrls.get(voiceId);
  if (!p) {
    p = fetch(voiceNotes.audioUrl(voiceId), { credentials: 'same-origin' })
      .then((r) => {
        if (!r.ok) throw new Error(`audio_${r.status}`);
        return r.blob();
      })
      .then((b) => URL.createObjectURL(b));
    audioUrls.set(voiceId, p);
    p.catch(() => audioUrls.delete(voiceId));
  }
  return p;
}

// ── Recorder ─────────────────────────────────────────────────
interface RecordResult {
  blob: Blob;
  durationMs: number;
}

interface ActiveRec {
  mr: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  t0: number;
  ctx: AudioContext | null;
  analyser: AnalyserNode | null;
}

interface RecorderApi {
  start: () => Promise<void>;
  stop: () => Promise<RecordResult | null>;
  cancel: () => void;
  analyser: () => AnalyserNode | null;
}

export function useVoiceRecorder() {
  const [phase, setPhase] = useState<'idle' | 'starting' | 'recording'>('idle');
  const [startedAt, setStartedAt] = useState(0);
  const rec = useRef<ActiveRec | null>(null);
  const stopping = useRef<Promise<RecordResult | null> | null>(null);
  const api = useRef<RecorderApi | null>(null);

  if (!api.current) {
    let token = 0;
    const release = (r: ActiveRec) => {
      r.stream.getTracks().forEach((t) => t.stop());
      r.ctx?.close().catch(() => undefined);
      if (rec.current === r) rec.current = null;
      setPhase('idle');
    };
    api.current = {
      start: async () => {
        if (rec.current || stopping.current) return;
        const my = ++token;
        setPhase('starting');
        // Created inside the tap so iOS lets it run; the level meter is best effort.
        let ctx: AudioContext | null = null;
        try {
          const AC =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          ctx = AC ? new AC() : null;
        } catch {
          ctx = null;
        }
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
        } catch (err) {
          ctx?.close().catch(() => undefined);
          if (my === token) setPhase('idle');
          throw err;
        }
        if (my !== token) {
          // Cancelled while the permission prompt was up.
          stream.getTracks().forEach((t) => t.stop());
          ctx?.close().catch(() => undefined);
          return;
        }
        const mime = pickMime();
        let mr: MediaRecorder;
        try {
          mr = mime ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64000 }) : new MediaRecorder(stream);
        } catch {
          mr = new MediaRecorder(stream);
        }
        let analyser: AnalyserNode | null = null;
        if (ctx) {
          try {
            analyser = ctx.createAnalyser();
            analyser.fftSize = 512;
            ctx.createMediaStreamSource(stream).connect(analyser);
            void ctx.resume().catch(() => undefined);
          } catch {
            analyser = null;
          }
        }
        const r: ActiveRec = { mr, stream, chunks: [], t0: performance.now(), ctx, analyser };
        mr.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) r.chunks.push(ev.data);
        };
        rec.current = r;
        mr.start(1000);
        setStartedAt(r.t0);
        setPhase('recording');
      },
      stop: () => {
        if (stopping.current) return stopping.current;
        const r = rec.current;
        if (!r) return Promise.resolve(null);
        const p = new Promise<RecordResult | null>((resolve) => {
          const durationMs = Math.round(performance.now() - r.t0);
          const finish = () => {
            const type = r.mr.mimeType || r.chunks[0]?.type || 'audio/webm';
            const blob = new Blob(r.chunks, { type });
            release(r);
            stopping.current = null;
            resolve(blob.size > 0 ? { blob, durationMs } : null);
          };
          r.mr.onstop = finish;
          try {
            if (r.mr.state === 'inactive') finish();
            else r.mr.stop();
          } catch {
            finish();
          }
        });
        stopping.current = p;
        return p;
      },
      cancel: () => {
        token++;
        const r = rec.current;
        if (!r) {
          setPhase('idle');
          return;
        }
        r.mr.onstop = null;
        try {
          if (r.mr.state !== 'inactive') r.mr.stop();
        } catch {
          // already stopped
        }
        release(r);
        stopping.current = null;
      },
      analyser: () => rec.current?.analyser ?? null,
    };
  }

  useEffect(() => () => api.current?.cancel(), []);

  return { phase, startedAt, ...api.current };
}

// ── Glyphs ───────────────────────────────────────────────────
export function MicGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v2.5" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1.2" />
      <rect x="14" y="5" width="4" height="14" rx="1.2" />
    </svg>
  );
}

function PlayGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.2v13.6a1 1 0 0 0 1.5.86l11-6.8a1 1 0 0 0 0-1.72l-11-6.8A1 1 0 0 0 8 5.2z" />
    </svg>
  );
}

function StopGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="2.5" />
    </svg>
  );
}

function RetryGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M4.5 4.5v4h4" />
    </svg>
  );
}

// ── Pin ──────────────────────────────────────────────────────
interface PinProps {
  note: VoiceNoteView;
  width: number;
  height: number;
  onMove: (note: VoiceNoteView, x: number, y: number) => void;
  onDelete: (note: VoiceNoteView) => void;
  onRetry: (note: VoiceNoteView) => void;
}

const RING_R = 19;
const RING_C = 2 * Math.PI * RING_R;

/** Tap: play / pause. Drag: move. Long-press or right-click: menu with delete. */
function VoicePin({ note, width, height, onMove, onDelete, onRetry }: PinProps) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'paused'>('idle');
  const [progress, setProgress] = useState(0);
  const [menu, setMenu] = useState(false);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const press = useRef<{ id: number; sx: number; sy: number; moved: boolean; long: boolean; timer: number } | null>(
    null,
  );
  const status = note.local?.status;

  // Pre-load while the page is on screen, so a tap can start playback inside the gesture (iOS).
  useEffect(() => {
    if (status === 'failed') return;
    let alive = true;
    loadVoiceAudio(note.voice_id)
      .then((u) => {
        if (alive) urlRef.current = u;
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [note.voice_id, status]);

  useEffect(
    () => () => {
      const a = audioRef.current;
      if (a) {
        a.pause();
        if (currentAudio === a) currentAudio = null;
      }
    },
    [],
  );

  const ensureAudio = (url: string) => {
    if (audioRef.current) return audioRef.current;
    const a = new Audio(url);
    a.preload = 'auto';
    const fallback = Math.max(0.5, note.duration_ms / 1000);
    a.addEventListener('timeupdate', () => {
      // MediaRecorder WebM often reports duration=Infinity; the recorded length is reliable.
      const d = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : fallback;
      setProgress(Math.min(1, a.currentTime / d));
    });
    a.addEventListener('play', () => setState('playing'));
    a.addEventListener('pause', () => setState((s) => (s === 'playing' ? 'paused' : s)));
    a.addEventListener('ended', () => {
      setState('idle');
      setProgress(0);
    });
    audioRef.current = a;
    return a;
  };

  const play = (a: HTMLAudioElement) => {
    if (currentAudio && currentAudio !== a) currentAudio.pause();
    currentAudio = a;
    a.play().catch(() => setState('idle'));
  };

  const toggle = () => {
    if (status === 'failed') {
      onRetry(note);
      return;
    }
    const existing = audioRef.current;
    if (existing && !existing.paused) {
      existing.pause();
      return;
    }
    if (urlRef.current) {
      play(ensureAudio(urlRef.current));
      return;
    }
    setState('loading');
    loadVoiceAudio(note.voice_id)
      .then((u) => {
        urlRef.current = u;
        play(ensureAudio(u));
      })
      .catch(() => setState('idle'));
  };

  const endPress = () => {
    const p = press.current;
    if (p) window.clearTimeout(p.timer);
    press.current = null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // best effort
    }
    endPress();
    const timer = window.setTimeout(() => {
      if (press.current && !press.current.moved) {
        press.current.long = true;
        setMenu(true);
      }
    }, 550);
    press.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false, long: false, timer };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    if (!p.moved && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 6) return;
    if (!p.moved) {
      p.moved = true;
      window.clearTimeout(p.timer);
      setMenu(false);
    }
    const layer = e.currentTarget.closest('.voice-layer') as HTMLElement | null;
    const r = layer?.getBoundingClientRect();
    if (!r) return;
    setDrag({
      x: clamp01((e.clientX - r.left) / Math.max(1, r.width)),
      y: clamp01((e.clientY - r.top) / Math.max(1, r.height)),
    });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    endPress();
    if (p.moved) {
      if (drag) onMove(note, drag.x, drag.y);
      setDrag(null);
      return;
    }
    if (!p.long) toggle();
  };

  const onPointerCancel = () => {
    endPress();
    setDrag(null);
  };

  const pos = drag ?? { x: note.x, y: note.y };
  const shownMs = state === 'idle' ? note.duration_ms : progress * note.duration_ms;
  const label =
    status === 'failed'
      ? 'یادداشت صوتی ارسال نشد؛ برای تلاش دوباره بزن'
      : state === 'playing'
        ? 'توقف یادداشت صوتی'
        : `پخش یادداشت صوتی ${formatClock(note.duration_ms)}`;

  return (
    <div
      className={`voice-pin is-${state}${status ? ` is-${status}` : ''}${drag ? ' is-dragging' : ''}${
        menu ? ' has-menu' : ''
      }`}
      style={{ left: pos.x * width, top: pos.y * height }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="voice-pin__btn"
        aria-label={label}
        title={label}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClick={(e) => {
          e.stopPropagation();
          if (e.detail === 0) toggle(); // keyboard activation
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          endPress();
          setMenu(true);
        }}
      >
        <svg className="voice-pin__ring" viewBox="0 0 44 44" aria-hidden="true">
          <circle cx="22" cy="22" r={RING_R} className="voice-pin__track" />
          <circle
            cx="22"
            cy="22"
            r={RING_R}
            className="voice-pin__bar"
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C * (1 - progress)}
          />
        </svg>
        {status === 'failed' ? (
          <RetryGlyph />
        ) : state === 'loading' ? (
          <span className="voice-pin__spin" aria-hidden="true" />
        ) : state === 'playing' ? (
          <PauseGlyph />
        ) : state === 'paused' ? (
          <PlayGlyph />
        ) : (
          <MicGlyph size={16} />
        )}
      </button>
      <span className="voice-pin__time num">{status === 'failed' ? 'ارسال نشد' : formatClock(shownMs)}</span>

      {menu && (
        <div className="voice-pin__menu" role="menu" onPointerDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(false);
              toggle();
            }}
          >
            {status === 'failed' ? 'ارسال دوباره' : state === 'playing' ? 'توقف' : 'پخش'}
          </button>
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            onClick={() => {
              setMenu(false);
              audioRef.current?.pause();
              onDelete(note);
            }}
          >
            حذف
          </button>
          <button type="button" role="menuitem" aria-label="بستن" onClick={() => setMenu(false)}>
            <Icon name="i-x" size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Recording indicator at the pin's spot ────────────────────
const BARS = 14;

interface RecordingProps {
  x: number;
  y: number;
  startedAt: number;
  live: boolean;
  analyser: () => AnalyserNode | null;
  onStop: () => void;
  onCancel: () => void;
}

function RecordingPill({
  x,
  y,
  width,
  height,
  startedAt,
  live,
  analyser,
  onStop,
  onCancel,
}: RecordingProps & { width: number; height: number }) {
  const [elapsed, setElapsed] = useState(0);
  const barRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const onStopRef = useRef(onStop);
  onStopRef.current = onStop;

  useEffect(() => {
    if (!live) return;
    setElapsed(performance.now() - startedAt);
    const t = window.setInterval(() => {
      const e = performance.now() - startedAt;
      setElapsed(e);
      if (e >= MAX_RECORD_MS) onStopRef.current();
    }, 250);
    return () => window.clearInterval(t);
  }, [live, startedAt]);

  // Level meter drawn straight to the DOM: no React render per frame.
  useEffect(() => {
    if (!live) return;
    const an = analyser();
    if (!an) return;
    const buf = new Uint8Array(an.fftSize);
    const levels = new Array<number>(BARS).fill(0.12);
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      if (t - last > 80) {
        last = t;
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = Math.abs(buf[i] - 128) / 128;
          if (v > peak) peak = v;
        }
        levels.shift();
        levels.push(Math.min(1, 0.12 + peak * 2.2));
        for (let i = 0; i < BARS; i++) {
          const el = barRefs.current[i];
          if (el) el.style.transform = `scaleY(${levels[i].toFixed(3)})`;
        }
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [live, analyser]);

  const half = Math.min(130, width / 2);
  const left = Math.min(Math.max(x * width, half), width - half);
  let top = y * height + 26;
  if (top > height - 56) top = y * height - 72;

  return (
    <>
      <span className="voice-rec__marker" style={{ left: x * width, top: y * height }} aria-hidden="true" />
      <div
        className="voice-rec"
        style={{ left, top: Math.max(4, top) }}
        role="status"
        aria-live="polite"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="voice-rec__dot" aria-hidden="true" />
        <span className="voice-rec__time num">{live ? formatClock(elapsed) : 'آماده‌سازی…'}</span>
        <span className="voice-rec__bars" aria-hidden="true">
          {Array.from({ length: BARS }, (_, i) => (
            <span
              key={i}
              ref={(el) => {
                barRefs.current[i] = el;
              }}
            />
          ))}
        </span>
        <button type="button" className="voice-rec__stop" onClick={onStop} disabled={!live}>
          <StopGlyph />
          ذخیره
        </button>
        <button type="button" className="voice-rec__cancel" onClick={onCancel} aria-label="لغو ضبط">
          <Icon name="i-x" size={14} />
        </button>
      </div>
    </>
  );
}

// ── Page layer ───────────────────────────────────────────────
export interface VoicePageLayerProps {
  width: number;
  height: number;
  notes: VoiceNoteView[];
  /** Waiting for the tap that places a new recording. */
  armed: boolean;
  onPlace: (x: number, y: number) => void;
  recording: RecordingProps | null;
  onMove: (note: VoiceNoteView, x: number, y: number) => void;
  onDelete: (note: VoiceNoteView) => void;
  onRetry: (note: VoiceNoteView) => void;
}

export function VoicePageLayer({
  width,
  height,
  notes,
  armed,
  onPlace,
  recording,
  onMove,
  onDelete,
  onRetry,
}: VoicePageLayerProps) {
  return (
    <div
      className={`voice-layer${armed ? ' is-armed' : ''}`}
      onClick={
        armed
          ? (e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onPlace(
                clamp01((e.clientX - r.left) / Math.max(1, r.width)),
                clamp01((e.clientY - r.top) / Math.max(1, r.height)),
              );
            }
          : undefined
      }
    >
      {notes.map((n) => (
        <VoicePin
          key={n.voice_id}
          note={n}
          width={width}
          height={height}
          onMove={onMove}
          onDelete={onDelete}
          onRetry={onRetry}
        />
      ))}
      {recording && <RecordingPill {...recording} width={width} height={height} />}
    </div>
  );
}
