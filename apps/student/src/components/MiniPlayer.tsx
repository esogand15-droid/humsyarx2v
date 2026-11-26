/* Mini player for background voice playback (see lib/bgAudio).
   Sits above the tab bar on phones and in the free bottom corner on wider screens.
   The title reopens the full player at the same second; × stops and saves the position. */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';

import './miniplayer.css';
import { bgAudio } from '../lib/bgAudio';
import { reader } from '../lib/reader';
import { Icon } from '../icons';

const clock = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${new Intl.NumberFormat('fa-IR').format(m)}:${new Intl.NumberFormat('fa-IR', { minimumIntegerDigits: 2 }).format(ss)}`;
};

export function MiniPlayer() {
  const track = useSyncExternalStore(bgAudio.subscribe, bgAudio.get);
  const navigate = useNavigate();
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [src, setSrc] = useState('');
  const lastSaved = useRef(0);
  const refreshed = useRef(false);

  // new track: mount its source and continue from the handed-over second
  useEffect(() => {
    if (!track) return;
    refreshed.current = false;
    lastSaved.current = track.at;
    setTime(track.at);
    setDur(0);
    setSrc(track.src);
  }, [track]);

  const save = (t: number) => {
    if (!track || !(t > 0)) return;
    lastSaved.current = t;
    void reader
      .save(track.scope, track.id, { page: 1, total: 0, position: t, kind: 'audio' })
      .catch(() => undefined);
  };

  // lock screen / headset keys
  useEffect(() => {
    if (!track || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    try {
      ms.metadata = new MediaMetadata({ title: track.name, artist: 'هامزیار', album: 'ویس جلسه' });
      ms.setActionHandler('play', () => void ref.current?.play().catch(() => undefined));
      ms.setActionHandler('pause', () => ref.current?.pause());
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

  if (!track) return null;

  const el = () => ref.current;
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
    const to = track.returnTo;
    // the reader's player takes the track over (and the second) on mount
    navigate(to);
  };

  return (
    <div className="miniplayer" role="region" aria-label="پخشکنندهٔ ویس">
      <audio
        ref={ref}
        src={src}
        autoPlay
        preload="auto"
        onLoadedMetadata={(e) => {
          const a = e.currentTarget;
          setDur(Number.isFinite(a.duration) ? a.duration : 0);
          a.playbackRate = track.rate || 1;
          if (track.at > 1 && a.currentTime < 1) a.currentTime = track.at;
        }}
        onPlay={() => setPlaying(true)}
        onPause={(e) => {
          setPlaying(false);
          save(e.currentTarget.currentTime);
        }}
        onEnded={() => {
          setPlaying(false);
          bgAudio.stop();
        }}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          setTime(t);
          bgAudio.report(t);
          if (Math.abs(t - lastSaved.current) >= 15) save(t);
        }}
        onError={() => {
          // signed link expired mid-play: fetch a fresh one once and keep the second
          if (refreshed.current) return;
          refreshed.current = true;
          const at = el()?.currentTime || time;
          void reader
            .viewUrl(track.scope, track.id)
            .then((v) => {
              if (v.available && v.url) {
                track.at = at;
                setSrc(v.url);
              }
            })
            .catch(() => undefined);
        }}
      />

      <button type="button" className="miniplayer__btn miniplayer__play" onClick={toggle} aria-label={playing ? 'توقف' : 'پخش'}>
        {playing ? (
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" />
            <rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" />
          </svg>
        ) : (
          <Icon name="i-play" size={20} />
        )}
      </button>

      <button type="button" className="miniplayer__btn" onClick={() => skip(-15)} aria-label="۱۵ ثانیه عقب">
        <span className="miniplayer__skip num" aria-hidden="true">۱۵−</span>
      </button>

      <div className="miniplayer__body">
        <button type="button" className="miniplayer__title" onClick={open} title="بازکردن پخشکننده">
          <bdi>{track.name}</bdi>
        </button>
        <div className="miniplayer__track">
          <input
            type="range"
            className="miniplayer__range"
            min={0}
            max={dur || 0}
            step={1}
            value={Math.min(time, dur || 0)}
            onChange={(e) => {
              const a = el();
              if (a) a.currentTime = Number(e.target.value);
            }}
            aria-label="موقعیت پخش"
            aria-valuetext={`${clock(time)} از ${clock(dur)}`}
            disabled={!dur}
          />
          <span className="miniplayer__time num" dir="ltr">
            {clock(time)}
          </span>
        </div>
      </div>

      <button type="button" className="miniplayer__btn" onClick={close} aria-label="بستن پخشکننده">
        <Icon name="i-x" size={18} />
      </button>
    </div>
  );
}
