/* Shared media element host — the fix for the "leaving the voice/video page
   lags and flickers" bug. Previously every player mounted its own
   <audio>/<video>; the unmount→handoff→mount cycle destroyed the buffered
   element and a brand-new element re-fetched the signed URL from scratch
   (seconds of silence / black frame before the seek landed).

   Now one element per kind exists for the whole app. Players *adopt* it by
   reparenting it into their own stage container — moving a media element in
   the DOM does NOT interrupt playback or drop the buffer, so
   full-player → floating-widget → full-player transitions are seamless. */

type Kind = 'audio' | 'video';

const els = new Map<Kind, HTMLMediaElement>();

export function sharedMedia(kind: Kind): HTMLMediaElement {
  let el = els.get(kind);
  if (!el) {
    el = document.createElement(kind) as HTMLMediaElement;
    el.preload = 'auto';
    if (kind === 'video') {
      const v = el as HTMLVideoElement;
      v.playsInline = true;
      v.setAttribute('controlslist', 'nodownload');
      v.setAttribute('contextmenu', '');
    }
    els.set(kind, el);
  }
  return el;
}

/** Moves the shared element into this player's container. Reparenting keeps
    playback running; calling twice (StrictMode double-mount) is a no-op. */
export function adoptMedia(kind: Kind, container: HTMLElement): HTMLMediaElement {
  const el = sharedMedia(kind);
  if (el.parentElement !== container) {
    container.appendChild(el);
  }
  return el;
}

/** True when the element already carries this exact source and has metadata —
    the caller can skip re-assigning src (which would drop the buffer). */
export function mediaHasSrc(kind: Kind, src: string): boolean {
  const el = els.get(kind);
  if (!el || !src) return false;
  return el.getAttribute('src') === src && el.readyState >= 1;
}
