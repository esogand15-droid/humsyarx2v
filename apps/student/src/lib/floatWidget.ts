/* Shared helpers for small floating widgets (mini audio player, floating video
   player) that must drag/resize without any UI library — the project has none
   installed (see package.json). Mirrors the manual pointer-event pattern already
   used for the reader's side-panel divider (ReaderScreen.handleDividerPointerDown):
   plain pointermove/pointerup listeners on window, no external dependency. */

export interface FloatPos {
  x: number;
  y: number;
}

export interface FloatSize {
  w: number;
  h: number;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Keeps a floating box fully inside the viewport, with a small margin from the edges. */
export function clampFloatPos(pos: FloatPos, size: FloatSize, margin = 8): FloatPos {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? (window.visualViewport?.height ?? window.innerHeight) : 768;
  const maxX = Math.max(margin, vw - size.w - margin);
  const maxY = Math.max(margin, vh - size.h - margin);
  return { x: clamp(pos.x, margin, maxX), y: clamp(pos.y, margin, maxY) };
}

/** Rubber-band while dragging: positions past the viewport edge continue at 0.4×
    resistance and spring back on release (iOS PiP physics). */
export function rubberClampPos(pos: FloatPos, size: FloatSize, margin = 8): FloatPos {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? (window.visualViewport?.height ?? window.innerHeight) : 768;
  const maxX = Math.max(margin, vw - size.w - margin);
  const maxY = Math.max(margin, vh - size.h - margin);
  const soft = (v: number, min: number, max: number) => {
    if (v < min) return min + (v - min) * 0.4;
    if (v > max) return max + (v - max) * 0.4;
    return v;
  };
  return { x: soft(pos.x, margin, maxX), y: soft(pos.y, margin, maxY) };
}

/** Release snap: dock the box to the nearest horizontal edge (YouTube/Telegram PiP
    convention); vertical stays where the user left it, clamped into the viewport. */
export function snapEdgeX(pos: FloatPos, size: FloatSize, margin = 12): FloatPos {
  if (typeof window === 'undefined') return pos;
  const vw = window.innerWidth;
  const vh = window.visualViewport?.height ?? window.innerHeight;
  const maxX = Math.max(margin, vw - size.w - margin);
  const x = pos.x + size.w / 2 <= vw / 2 ? margin : maxX;
  const y = clamp(pos.y, margin, Math.max(margin, vh - size.h - margin));
  return { x, y };
}

export function loadFloatState<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return fallback;
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

export function saveFloatState<T>(key: string, state: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // private mode / quota exceeded: position just isn't remembered
  }
}
