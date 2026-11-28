/* Background/floating video playback: a video keeps playing in a small floating
   window after the student leaves its screen (e.g. navigates to the PDF reader
   to take notes while a lecture clip keeps running). One track at a time.
   Mirrors lib/bgAudio.ts exactly, so the same handoff pattern works for video:
   VideoPlayer hands the track here on unmount while playing; FloatingVideoPlayer
   (mounted once at app root, outside the routes) plays it; reopening the same
   video takes it back at the same second. */

import type { Scope } from './ink';

export interface BgVideoTrack {
  scope: Scope;
  id: string;
  name: string;
  src: string;
  /** second to resume at */
  at: number;
  rate: number;
  muted: boolean;
  /** router path of the full player */
  returnTo: string;
}

let track: BgVideoTrack | null = null;
/** live position, written by FloatingVideoPlayer, read on takeover */
let liveAt = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

let lastTaken: { scope: Scope; id: string; at: number } | null = null;

export const bgVideo = {
  subscribe(f: () => void) {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
  get: () => track,
  start(t: BgVideoTrack) {
    track = t;
    liveAt = t.at;
    lastTaken = null;
    emit();
  },
  report(at: number) {
    liveAt = at;
  },
  stop() {
    if (!track) return;
    track = null;
    emit();
  },
  /** A player for this file is opening: stop floating playback and return its second.
      Repeat calls for the same file return the same second (StrictMode runs initializers twice). */
  takeOver(scope: Scope, id: string): number | null {
    const t = track;
    if (!t) return lastTaken && lastTaken.scope === scope && lastTaken.id === id ? lastTaken.at : null;
    const at = liveAt;
    track = null;
    emit();
    if (t.scope !== scope || t.id !== id) return null;
    lastTaken = { scope, id, at };
    return at;
  },
};
