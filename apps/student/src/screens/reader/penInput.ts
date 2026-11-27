/**
 * Pen activity shared by every page's ink layer, so reader-level gestures (pinch-zoom) can stand
 * down while the student is writing: the writing hand resting on the glass must never zoom.
 */
const state = { down: false, lastAt: 0 };

/** A finger that lands this soon after the pen lifted is still the writing hand. */
export const PEN_GUARD_MS = 220;

/** Contact wider than this (CSS px) is the side of the hand, not a fingertip. */
export const PALM_CONTACT_PX = 70;

/** Record pen contact; pass `down` on pen down/up so the guard holds for the whole stroke. */
export function notePen(down?: boolean): void {
  state.lastAt = performance.now();
  if (down !== undefined) state.down = down;
}

export function isPenBusy(guardMs = PEN_GUARD_MS): boolean {
  return state.down || performance.now() - state.lastAt < guardMs;
}
