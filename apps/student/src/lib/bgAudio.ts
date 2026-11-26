/* Background voice playback: a voice keeps playing after the student leaves its screen.
   One track at a time. The reader's AudioPlayer hands the track here when it unmounts
   while playing; MiniPlayer (mounted once at app root, outside the routes) plays it;
   reopening the same voice takes it back at the same second. */

import type { Scope } from './ink';

export interface BgTrack {
  scope: Scope;
  id: string;
  name: string;
  src: string;
  /** second to resume at */
  at: number;
  rate: number;
  /** router path of the full player */
  returnTo: string;
}

let track: BgTrack | null = null;
/** live position, written by MiniPlayer, read on takeover */
let liveAt = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const bgAudio = {
  subscribe(f: () => void) {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
  get: () => track,
  start(t: BgTrack) {
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
  /** A player for this file is opening: stop background playback and return its second.
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

let lastTaken: { scope: Scope; id: string; at: number } | null = null;
