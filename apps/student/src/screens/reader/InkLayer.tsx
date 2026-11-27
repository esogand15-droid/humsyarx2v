import { notePen, PALM_CONTACT_PX, PEN_GUARD_MS } from './penInput';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

import {
  generateUUID,
  ink,
  type InkTool,
  type Point,
  type Scope,
  type StickyNote,
  type Stroke,
} from '../../lib/ink';
import { getCachedInkPage, setCachedInkPage } from './readerPageCache';

export interface InkApi {
  undo: () => void;
  redo: () => void;
  clear: () => void;
  count: () => number;
}

export type InkStatus = 'idle' | 'saving' | 'saved' | 'pending';

interface Props {
  scope: Scope;
  id: string;
  page: number;
  /** اندازهٔ نمایشی صفحه (CSS px) — خطوط نسبت به همین کادر رسم می‌شوند */
  width: number;
  height: number;
  /** ابزار فعال؛ `null` یعنی فقط خواندن (لمس روی صفحه نقاشی نمی‌کند) */
  tool: InkTool | 'eraser' | 'lasso' | null;
  color: string;
  /** ضخامت پایه به‌صورت کسری از عرض صفحه */
  strokeWidth: number;
  onCount: (n: number) => void;
  /** برای فعال/غیرفعال کردن دکمه‌های بازگردانی — عدد واقعی، نه حدس */
  onHistory: (s: { undo: number; redo: number }) => void;
  onStatus: (s: InkStatus) => void;
  /** یک بار پس از تغییر، پنل دفتر را به‌روز کن */
  onChanged?: () => void;
  // Tablet features:
  eraserMode?: 'stroke' | 'partial';
  eraseHighlighterOnly?: boolean;
  shapeSnap?: boolean;
  stylusOnly?: boolean;
  /** Fired the first time a stylus touches this page, so the reader can switch to pen mode. */
  onPenDetected?: () => void;
  onPinchZoom?: (factor: number) => void;
  onNotesLoaded?: (page: number, notes: StickyNote[]) => void;
  isGesturing?: boolean;
}

const SAVE_DELAY = 900;
const MAX_HISTORY = 50;
const MAX_INK_CANVAS_PIXELS = 5_242_880;
const STYLUS_DECAY_MS = 750;
// Fingertip contact on iPad/Android is commonly 30-50px, so the old 25px bound rejected
// every finger stroke ("can't write with my finger"). A resting palm reports well above 70.
const PALM_TOUCH_BOUND_PX = PALM_CONTACT_PX;
/** Finger travel before a touch turns into a pan, so a resting fingertip does not nudge the page. */
const PAN_SLOP_PX = 6;
/** Per-millisecond velocity decay of a finger fling (close to iOS scroll deceleration). */
const FLING_FRICTION = 0.996;
const MAX_FLING_PX_MS = 6;
/**
 * Highlighter strokes are painted opaque onto their own canvas and this alpha is applied to that
 * canvas as a whole, so a stroke that crosses itself or a neighbour keeps one even tint.
 */
const HIGHLIGHTER_ALPHA = 0.38;

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const { overflowX, overflowY } = window.getComputedStyle(node);
    const scrollable = /(auto|scroll)/.test(overflowY) || /(auto|scroll)/.test(overflowX);
    if (scrollable && (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth)) {
      return node;
    }
  }
  return (document.scrollingElement as HTMLElement | null) ?? null;
}

function isPointInPolygon(point: { x: number; y: number }, polygon: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > point.y) !== (yj > point.y))
        && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function distToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

/** الگوریتم پاک‌کن برشی / جزئی: برش نقاط در شعاع R و تقسیم خط به زیرخط‌ها */
function slicePointsAtCircle(
  points: Point[],
  eraserX: number,
  eraserY: number,
  radius: number,
): Point[][] {
  const subStrokes: Point[][] = [];
  let currentChain: Point[] = [];

  for (const pt of points) {
    const dist = Math.hypot(pt.x - eraserX, pt.y - eraserY);
    if (dist > radius) {
      currentChain.push(pt);
    } else {
      if (currentChain.length >= 2) {
        subStrokes.push(currentChain);
      }
      currentChain = [];
    }
  }
  if (currentChain.length >= 2) {
    subStrokes.push(currentChain);
  }
  return subStrokes;
}

/** الگوریتم تشخیص و صاف‌سازی هوشمند اشکال هندسی (Dwell-to-Snap) */
function snapToCleanShape(points: Point[]): Point[] {
  if (points.length < 5) return points;
  const p0 = points[0];
  const pn = points[points.length - 1];
  const dx = pn.x - p0.x;
  const dy = pn.y - p0.y;
  const length = Math.hypot(dx, dy);

  // ۱. تست خط مستقیم: نسبت انحراف وتر d_max / L < 0.08
  if (length > 0.03) {
    let maxDev = 0;
    for (const pt of points) {
      const dev = Math.abs(dy * pt.x - dx * pt.y + pn.x * p0.y - pn.y * p0.x) / length;
      if (dev > maxDev) maxDev = dev;
    }
    if (maxDev / length < 0.08) {
      const steps = Math.max(6, Math.min(20, points.length));
      const snapped: Point[] = [];
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        snapped.push({
          x: p0.x + t * dx,
          y: p0.y + t * dy,
          pressure: (p0.pressure + pn.pressure) / 2,
          time: Math.round(p0.time + t * (pn.time - p0.time)),
        });
      }
      return snapped;
    }
  }

  // ۲. تست دایره / بیضی: نسبت انحراف معیار شعاعی sigma / mu < 0.15
  const closeDist = Math.hypot(pn.x - p0.x, pn.y - p0.y);
  if (points.length >= 10 && closeDist < length * 0.45 + 0.05) {
    let sumX = 0, sumY = 0;
    for (const pt of points) {
      sumX += pt.x;
      sumY += pt.y;
    }
    const cx = sumX / points.length;
    const cy = sumY / points.length;
    const radii = points.map((p) => Math.hypot(p.x - cx, p.y - cy));
    const mu = radii.reduce((a, b) => a + b, 0) / radii.length;
    if (mu > 0.02) {
      const variance = radii.reduce((acc, r) => acc + (r - mu) ** 2, 0) / radii.length;
      const sigma = Math.sqrt(variance);
      if (sigma / mu < 0.15) {
        const circleSteps = 24;
        const snapped: Point[] = [];
        const avgP = points.reduce((acc, p) => acc + p.pressure, 0) / points.length;
        for (let i = 0; i <= circleSteps; i++) {
          const angle = (i / circleSteps) * Math.PI * 2;
          snapped.push({
            x: cx + mu * Math.cos(angle),
            y: cy + mu * Math.sin(angle),
            pressure: avgP,
            time: Math.round(p0.time + (i / circleSteps) * (pn.time - p0.time)),
          });
        }
        return snapped;
      }
    }
  }

  return points;
}

function normalizeStroke(s: any): Stroke {
  const pts: Point[] = (s.points || []).map((p: any) => {
    if (Array.isArray(p)) {
      return { x: p[0], y: p[1], pressure: 0.5, time: 0 };
    }
    return {
      x: Number.isFinite(p.x) ? p.x : 0,
      y: Number.isFinite(p.y) ? p.y : 0,
      pressure: Number.isFinite(p.pressure) ? p.pressure : 0.5,
      time: Number.isFinite(p.time) ? p.time : 0,
      tiltX: p.tiltX,
      tiltY: p.tiltY,
    };
  });
  return {
    stroke_id: s.stroke_id || generateUUID(),
    tool: s.tool || 'pen',
    color: s.color || '#1740B8',
    width: Number.isFinite(s.width) ? s.width : 0.0035,
    opacity: s.opacity ?? (s.tool === 'highlighter' ? 0.35 : s.tool === 'pencil' ? 0.65 : 1.0),
    blend_mode: s.blend_mode ?? (s.tool === 'highlighter' ? 'multiply' : 'source-over'),
    points: pts,
    created_at: s.created_at || new Date().toISOString(),
    updated_at: s.updated_at,
    is_deleted: s.is_deleted,
    nibAngle: s.nibAngle,
  };
}

/** لایهٔ وکتور دیجیتال اینک (Wave 5) — بوم پویا روی صفحهٔ PDF با خطوط نرمال‌شده و PointerEvents */
export const InkLayer = forwardRef<InkApi, Props>(function InkLayer(
  {
    scope,
    id,
    page,
    width,
    height,
    tool,
    color,
    strokeWidth,
    onCount,
    onHistory,
    onStatus,
    onChanged,
    eraserMode = 'stroke',
    eraseHighlighterOnly = false,
    shapeSnap = false,
    stylusOnly = false,
    onPenDetected,
    onNotesLoaded,
    isGesturing = false,
  },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const highlighterCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  const cbs = useRef({ onCount, onHistory, onStatus, onChanged, onNotesLoaded, onPenDetected });
  cbs.current = { onCount, onHistory, onStatus, onChanged, onNotesLoaded, onPenDetected };
  const notesRef = useRef<StickyNote[]>([]);
  const gesturingRef = useRef(isGesturing);
  gesturingRef.current = isGesturing;

  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const strokesRef = useRef<Stroke[]>([]);
  const past = useRef<Stroke[][]>([]);
  const future = useRef<Stroke[][]>([]);
  const drawing = useRef<Stroke | null>(null);
  const strokeStartTime = useRef<number>(0);
  const saveTimer = useRef<number | undefined>(undefined);
  const dirty = useRef(false);
  const [ready, setReady] = useState(false);

  // ── Dwell-to-Snap Timer ─────────────────────────────────────
  const dwellTimer = useRef<number | undefined>(undefined);
  const lastDwellPoint = useRef<{ x: number; y: number } | null>(null);

  // ── Lasso Selection Engine ──────────────────────────────────
  const lassoPoints = useRef<Point[]>([]);
  const selectedIds = useRef<Set<string>>(new Set());
  const selectionBBox = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);
  const isDraggingSelection = useRef(false);
  const dragStartPt = useRef<{ x: number; y: number } | null>(null);

  // ── Software Palm Rejection Engine & Touch Gestures ─────────
  const lastStylusTime = useRef<number>(0);
  const isStylusActive = useRef<boolean>(false);
  const stylusDecayTimer = useRef<number | undefined>(undefined);
  const touchPointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  /** Touches classified as palm stay ignored for their whole life, even after the pen lifts. */
  const ignoredTouches = useRef<Set<number>>(new Set());
  const penDown = useRef(false);
  const penSeen = useRef(false);
  /** The one pointer allowed to draw/erase/lasso; a second hand on the glass can't end its stroke. */
  const activePointer = useRef<number | null>(null);
  const activeIsTouch = useRef(false);
  const panRef = useRef<{
    id: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    lastT: number;
    vx: number;
    vy: number;
    active: boolean;
    scroller: HTMLElement | null;
  } | null>(null);
  const momentumRaf = useRef<number | null>(null);
  const paintRaf = useRef<number | null>(null);
  /** Bitmap of committed strokes, kept only while a stroke is live so per-frame cost stays flat. */
  const committedCache = useRef<{
    ink: HTMLCanvasElement;
    hl: HTMLCanvasElement | null;
    source: Stroke[];
  } | null>(null);

  useEffect(
    () => () => {
      if (momentumRaf.current != null) window.cancelAnimationFrame(momentumRaf.current);
      if (paintRaf.current != null) window.cancelAnimationFrame(paintRaf.current);
      const c = committedCache.current;
      if (c) {
        c.ink.width = 0;
        if (c.hl) c.hl.width = 0;
      }
    },
    [],
  );

  const commit = useCallback(
    (next: Stroke[], opts: { history?: boolean } = { history: true }) => {
      if (opts.history !== false) {
        past.current.push(strokesRef.current);
        if (past.current.length > MAX_HISTORY) past.current.shift();
        future.current = [];
      }
      strokesRef.current = next;
      setStrokes(next);
      cbs.current.onCount(next.length);
      cbs.current.onHistory({ undo: past.current.length, redo: future.current.length });
      dirty.current = true;
    },
    [],
  );

  // ── بارگذاری خطوط صفحه (با کش RAM برای بازگشت فوری هنگام اسکرول) ──
  useEffect(() => {
    let cancelled = false;
    past.current = [];
    future.current = [];

    const cached = getCachedInkPage(scope, id, page);
    if (cached) {
      const list = cached.strokes.map(normalizeStroke);
      strokesRef.current = list;
      notesRef.current = cached.notes;
      setStrokes(list);
      cbs.current.onCount(list.length);
      cbs.current.onHistory({ undo: 0, redo: 0 });
      if (cached.notes.length > 0) cbs.current.onNotesLoaded?.(page, cached.notes);
      setReady(true);
      cbs.current.onStatus('idle');
      return () => {
        cancelled = true;
      };
    }

    setReady(false);
    (async () => {
      let list: Stroke[] = [];
      let loadedNotes: StickyNote[] = [];
      try {
        const res = await ink.page(scope, id, page);
        list = (res.strokes ?? []).map(normalizeStroke);
        loadedNotes = res.notes ?? [];
      } catch {
        list = [];
      }
      if (cancelled) return;
      notesRef.current = loadedNotes;
      setCachedInkPage(scope, id, page, { strokes: list, notes: loadedNotes });
      strokesRef.current = list;
      setStrokes(list);
      cbs.current.onCount(list.length);
      cbs.current.onHistory({ undo: 0, redo: 0 });
      if (loadedNotes.length > 0) cbs.current.onNotesLoaded?.(page, loadedNotes);
      setReady(true);
      cbs.current.onStatus('idle');
    })();
    return () => {
      cancelled = true;
    };
  }, [scope, id, page]);

  // ── ذخیرهٔ دسته‌ای (debounce) ────────────────────────────────
  const flushSave = useCallback(async () => {
    if (!dirty.current) return;
    dirty.current = false;
    setCachedInkPage(scope, id, page, {
      strokes: strokesRef.current,
      notes: notesRef.current,
    });
    cbs.current.onStatus('saving');
    const res = await ink.save(scope, id, page, strokesRef.current);
    cbs.current.onStatus(res.ok ? 'saved' : 'pending');
    if (res.ok) cbs.current.onChanged?.();
  }, [scope, id, page]);

  useEffect(() => {
    if (!dirty.current) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void flushSave(), SAVE_DELAY);
    return () => window.clearTimeout(saveTimer.current);
  }, [strokes, flushSave]);

  useEffect(() => {
    return () => {
      window.clearTimeout(saveTimer.current);
      window.clearTimeout(dwellTimer.current);
      window.clearTimeout(stylusDecayTimer.current);
      if (dirty.current) {
        dirty.current = false;
        setCachedInkPage(scope, id, page, {
          strokes: strokesRef.current,
          notes: notesRef.current,
        });
        void ink.save(scope, id, page, strokesRef.current);
      }
    };
  }, [scope, id, page]);

  // ── رسم خطوط با منحنی بیر و ضخامت متغیر بر مبنای فشار و سرعت ──────────
  const drawStrokeOnCtx = useCallback(
    (ctx: CanvasRenderingContext2D, s: Stroke) => {
      const pts = s.points;
      if (!pts || pts.length === 0) return;

      ctx.save();
      if (s.tool === 'pencil') {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = s.color;
        ctx.fillStyle = s.color;
        ctx.globalAlpha = s.opacity ?? 0.65;
        ctx.globalCompositeOperation = 'source-over';
      } else if (s.tool === 'ballpoint') {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = s.color;
        ctx.fillStyle = s.color;
        ctx.globalAlpha = s.opacity ?? 0.95;
        ctx.globalCompositeOperation = 'source-over';
      } else if (s.tool === 'fountain') {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = s.color;
        ctx.fillStyle = s.color;
        ctx.globalAlpha = s.opacity ?? 1.0;
        ctx.globalCompositeOperation = 'source-over';
      } else if (s.tool === 'highlighter') {
        // Rounded, marker-like ends; the translucency comes from the canvas (HIGHLIGHTER_ALPHA).
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = s.color;
        ctx.fillStyle = s.color;
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      } else {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = s.color;
        ctx.fillStyle = s.color;
        ctx.globalAlpha = s.opacity ?? 1.0;
        ctx.globalCompositeOperation = s.blend_mode ?? 'source-over';
      }

      const isPencil = s.tool === 'pencil';
      const isFountain = s.tool === 'fountain';
      const isBallpoint = s.tool === 'ballpoint';

      const computeWidth = (p0: Point, p1?: Point) => {
        const segP = p1 ? (p0.pressure + p1.pressure) / 2 : p0.pressure;
        if (isPencil) {
          return Math.max(0.75, s.width * width * (0.35 + 0.85 * segP));
        }
        if (isBallpoint) {
          const ballpointP = 0.6 + 0.6 * segP;
          return Math.max(0.75, s.width * width * ballpointP);
        }
        if (isFountain && p1) {
          const dx = p1.x - p0.x;
          const dy = p1.y - p0.y;
          const dt = Math.max(1.0, Math.abs(p1.time - p0.time));
          const dist = Math.hypot(dx, dy);
          const v = dist / dt;
          const vFactor = Math.max(0.45, 1.0 - Math.min(0.55, v * 12.0));
          const strokeAngle = Math.atan2(dy, dx);
          const nibAngle = s.nibAngle ?? (Math.PI / 4); // 45 deg chisel nib
          const angleDiff = Math.abs(strokeAngle - nibAngle);
          const chiselFactor = 0.65 + 0.70 * Math.sin(angleDiff);
          const pressureFactor = 0.4 + 1.2 * Math.max(0.0, Math.min(1.0, segP));
          return Math.max(0.75, s.width * width * pressureFactor * vFactor * chiselFactor);
        }
        return Math.max(1, s.width * width * (0.4 + 1.2 * segP));
      };

      if (pts.length === 1) {
        const p = pts[0];
        const w = computeWidth(p);
        ctx.beginPath();
        ctx.arc(p.x * width, p.y * height, w / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
      }

      // رسم پیوسته و یکپارچهٔ خط (Single Continuous Path)
      // این ساختار مانع از تولید آرتیفکت‌های مهره‌ای (تسبیحی) و لکه‌های تیره در هایلایتر می‌شود
      if (s.tool === 'highlighter') {
        ctx.lineWidth = Math.max(16, s.width * width * 3.8);
      } else {
        ctx.lineWidth = computeWidth(pts[0], pts[pts.length - 1]);
      }

      ctx.beginPath();
      ctx.moveTo(pts[0].x * width, pts[0].y * height);

      if (pts.length === 2) {
        ctx.lineTo(pts[1].x * width, pts[1].y * height);
      } else {
        for (let i = 1; i < pts.length - 1; i++) {
          const midX = ((pts[i].x + pts[i + 1].x) / 2) * width;
          const midY = ((pts[i].y + pts[i + 1].y) / 2) * height;
          ctx.quadraticCurveTo(pts[i].x * width, pts[i].y * height, midX, midY);
        }
        const last = pts[pts.length - 1];
        ctx.lineTo(last.x * width, last.y * height);
      }
      ctx.stroke();

      ctx.restore();
    },
    [width, height],
  );

  const paint = useCallback(() => {
    if (gesturingRef.current) return;
    const canvas = canvasRef.current;
    const hlCanvas = highlighterCanvasRef.current;
    if (!canvas || !width || !height) return;
    const dpr = Math.min(
      window.devicePixelRatio || 1,
      2,
      Math.sqrt(MAX_INK_CANVAS_PIXELS / Math.max(1, width * height)),
    );
    const pxW = Math.max(1, Math.floor(width * dpr));
    const pxH = Math.max(1, Math.floor(height * dpr));

    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const hasHighlighter =
      drawing.current?.tool === 'highlighter' ||
      strokesRef.current.some((s) => s.tool === 'highlighter');
    let hlCtx: CanvasRenderingContext2D | null = null;
    if (hlCanvas && hasHighlighter) {
      if (hlCanvas.width !== pxW || hlCanvas.height !== pxH) {
        hlCanvas.width = pxW;
        hlCanvas.height = pxH;
      }
      hlCanvas.style.width = `${width}px`;
      hlCanvas.style.height = `${height}px`;
      hlCtx = hlCanvas.getContext('2d');
      if (hlCtx) {
        hlCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        hlCtx.clearRect(0, 0, width, height);
      }
    } else if (hlCanvas && hlCanvas.width > 0) {
      const clearHl = hlCanvas.getContext('2d');
      clearHl?.setTransform(1, 0, 0, 1, 0, 0);
      clearHl?.clearRect(0, 0, hlCanvas.width, hlCanvas.height);
    }

    const scratch = scratchRef.current;
    if (scratch && tool === 'eraser') {
      if (scratch.width !== pxW || scratch.height !== pxH) {
        scratch.width = pxW;
        scratch.height = pxH;
      }
      scratch.style.width = `${width}px`;
      scratch.style.height = `${height}px`;
      const sCtx = scratch.getContext('2d');
      if (sCtx) {
        sCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    } else if (scratch && scratch.width > 0) {
      const sCtx = scratch.getContext('2d');
      sCtx?.setTransform(1, 0, 0, 1, 0, 0);
      sCtx?.clearRect(0, 0, scratch.width, scratch.height);
    }

    const live = drawing.current !== null || lassoPoints.current.length > 1;
    if (live) {
      // While a stroke is under way the committed strokes come from one cached bitmap instead of
      // being re-stroked every frame; that per-frame re-stroking is what made busy pages stutter.
      let cache = committedCache.current;
      const stale =
        !cache ||
        cache.source !== strokesRef.current ||
        cache.ink.width !== pxW ||
        cache.ink.height !== pxH ||
        (hlCtx !== null) !== (cache.hl !== null);
      if (!cache || stale) {
        const inkLayer = cache?.ink ?? document.createElement('canvas');
        let hlLayer = cache?.hl ?? null;
        if (hlCtx && !hlLayer) hlLayer = document.createElement('canvas');
        if (!hlCtx && hlLayer) {
          hlLayer.width = 0;
          hlLayer = null;
        }
        const prep = (c: HTMLCanvasElement) => {
          if (c.width !== pxW || c.height !== pxH) {
            c.width = pxW;
            c.height = pxH;
          }
          const cx = c.getContext('2d');
          if (cx) {
            cx.setTransform(1, 0, 0, 1, 0, 0);
            cx.clearRect(0, 0, pxW, pxH);
            cx.setTransform(dpr, 0, 0, dpr, 0, 0);
          }
          return cx;
        };
        const inkCtx = prep(inkLayer);
        const hlCacheCtx = hlLayer ? prep(hlLayer) : null;
        for (const s of strokesRef.current) {
          const target = s.tool === 'highlighter' && hlCacheCtx ? hlCacheCtx : inkCtx;
          if (target) drawStrokeOnCtx(target, s);
        }
        cache = { ink: inkLayer, hl: hlLayer, source: strokesRef.current };
        committedCache.current = cache;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(cache.ink, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (hlCtx && cache.hl) {
        hlCtx.setTransform(1, 0, 0, 1, 0, 0);
        hlCtx.drawImage(cache.hl, 0, 0);
        hlCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    } else {
      // Idle pages hold no extra bitmaps: several full-page canvases per page would blow
      // iPad Safari's canvas memory budget.
      const c = committedCache.current;
      if (c) {
        c.ink.width = 0;
        if (c.hl) c.hl.width = 0;
        committedCache.current = null;
      }
      for (const s of strokesRef.current) {
        if (s.tool === 'highlighter' && hlCtx) {
          drawStrokeOnCtx(hlCtx, s);
        } else {
          drawStrokeOnCtx(ctx, s);
        }
      }
    }

    if (drawing.current) {
      if (drawing.current.tool === 'highlighter' && hlCtx) {
        drawStrokeOnCtx(hlCtx, drawing.current);
      } else {
        drawStrokeOnCtx(ctx, drawing.current);
      }
    }

    // Render active lasso path
    if (lassoPoints.current.length > 1) {
      ctx.save();
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = '#2563EB';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(lassoPoints.current[0].x * width, lassoPoints.current[0].y * height);
      for (let i = 1; i < lassoPoints.current.length; i++) {
        ctx.lineTo(lassoPoints.current[i].x * width, lassoPoints.current[i].y * height);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Render selection bounding box
    if (selectionBBox.current && selectedIds.current.size > 0) {
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#2563EB';
      ctx.lineWidth = 2;
      ctx.fillStyle = 'rgba(37, 99, 235, 0.08)';
      const bx = (selectionBBox.current.minX - 0.01) * width;
      const by = (selectionBBox.current.minY - 0.01) * height;
      const bw = (selectionBBox.current.maxX - selectionBBox.current.minX + 0.02) * width;
      const bh = (selectionBBox.current.maxY - selectionBBox.current.minY + 0.02) * height;
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeRect(bx, by, bw, bh);
      ctx.restore();
    }
  }, [width, height, tool, drawStrokeOnCtx]);

  useEffect(() => {
    if (!isGesturing) paint();
  }, [paint, strokes, ready, width, height, isGesturing]);

  // ── Eraser Collision: فاصلهٔ نقطه تا پاره‌خط وکتور ──────────
  const hitStroke = useCallback(
    (ex: number, ey: number): number => {
      const r = Math.max(0.01, Math.min(0.065, (strokeWidth || 0.0035) * 3.5));
      const list = strokesRef.current;
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const pts = list[i].points;
        if (!pts || pts.length === 0) continue;
        if (pts.length === 1) {
          if (Math.hypot(ex - pts[0].x, ey - pts[0].y) < r) return i;
          continue;
        }
        for (let j = 0; j < pts.length - 1; j += 1) {
          if (distToSegment(ex, ey, pts[j].x, pts[j].y, pts[j + 1].x, pts[j + 1].y) < r) {
            return i;
          }
        }
      }
      return -1;
    },
    [strokeWidth],
  );

  // ── اجرای پاک‌کن بر اساس حالت (کل خط یا برشی) ──────────────
  const applyEraser = useCallback(
    (pt: { x: number; y: number }) => {
      if (eraserMode === 'partial') {
        const r = Math.max(0.006, Math.min(0.065, (strokeWidth || 0.0035) * 4.0));
        let modified = false;
        const nextList: Stroke[] = [];

        for (const s of strokesRef.current) {
          if (eraseHighlighterOnly && s.tool !== 'highlighter') {
            nextList.push(s);
            continue;
          }
          const subChains = slicePointsAtCircle(s.points, pt.x, pt.y, r);
          if (subChains.length === 1 && subChains[0].length === s.points.length) {
            nextList.push(s);
          } else {
            modified = true;
            for (const chain of subChains) {
              nextList.push({
                ...s,
                stroke_id: generateUUID(),
                points: chain,
              });
            }
          }
        }
        if (modified) {
          commit(nextList);
        }
      } else {
        const i = hitStroke(pt.x, pt.y);
        if (i >= 0) {
          if (!eraseHighlighterOnly || strokesRef.current[i].tool === 'highlighter') {
            commit(strokesRef.current.filter((_, k) => k !== i));
          }
        }
      }
    },
    [eraserMode, eraseHighlighterOnly, strokeWidth, hitStroke, commit],
  );

  // ── استخراج نقطه و اعتبارسنجی ───────────────────────────────
  const extractPoint = useCallback(
    (
      e: React.PointerEvent<HTMLCanvasElement> | PointerEvent,
      rect: DOMRect,
      t0: number,
    ): Point => {
      const rawX = (e.clientX - rect.left) / Math.max(1, rect.width);
      const rawY = (e.clientY - rect.top) / Math.max(1, rect.height);
      const p = e.pressure > 0 ? e.pressure : 0.5;
      return {
        x: Math.min(1.0, Math.max(0.0, rawX)),
        y: Math.min(1.0, Math.max(0.0, rawY)),
        pressure: Math.min(1.0, Math.max(0.0, p)),
        time: Math.max(0, Math.round(performance.now() - t0)),
        tiltX: e.tiltX || 0,
        tiltY: e.tiltY || 0,
      };
    },
    [],
  );

  // ── Pen / finger routing (Noteful-style) ─────────────────────
  // Pen mode: the stylus writes, one finger pans the reader with momentum, two fingers are left to
  // the reader's pinch-zoom, and any contact that lands while the pen is down (or is wider than a
  // fingertip) is the palm. Without pen mode a finger draws, as on a phone with no stylus.
  const markPen = () => {
    notePen();
    lastStylusTime.current = performance.now();
    isStylusActive.current = true;
    if (stylusDecayTimer.current) window.clearTimeout(stylusDecayTimer.current);
    stylusDecayTimer.current = window.setTimeout(() => {
      isStylusActive.current = false;
    }, STYLUS_DECAY_MS);
    if (!penSeen.current) {
      penSeen.current = true;
      cbs.current.onPenDetected?.();
    }
  };

  const classifyPointer = (e: React.PointerEvent<HTMLCanvasElement>): 'draw' | 'pan' | 'ignore' => {
    if (e.pointerType === 'pen') {
      markPen();
      return 'draw';
    }
    if (e.pointerType !== 'touch') return 'draw';
    if (penDown.current) return 'ignore';
    if (e.width > PALM_TOUCH_BOUND_PX || e.height > PALM_TOUCH_BOUND_PX) return 'ignore';
    const sincePen = performance.now() - lastStylusTime.current;
    if (stylusOnly) return sincePen < PEN_GUARD_MS ? 'ignore' : 'pan';
    return isStylusActive.current || sincePen < STYLUS_DECAY_MS ? 'ignore' : 'draw';
  };

  const stopMomentum = () => {
    if (momentumRaf.current != null) {
      window.cancelAnimationFrame(momentumRaf.current);
      momentumRaf.current = null;
    }
  };

  const beginPan = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const now = performance.now();
    panRef.current = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      lastT: now,
      vx: 0,
      vy: 0,
      active: false,
      scroller: findScrollParent(e.currentTarget),
    };
  };

  const movePan = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = panRef.current;
    if (!p || !p.scroller) return;
    const now = performance.now();
    if (!p.active) {
      if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) < PAN_SLOP_PX) return;
      p.active = true;
      p.lastX = e.clientX;
      p.lastY = e.clientY;
      p.lastT = now;
      return;
    }
    const dx = e.clientX - p.lastX;
    const dy = e.clientY - p.lastY;
    const dt = Math.max(1, now - p.lastT);
    p.scroller.scrollLeft -= dx;
    p.scroller.scrollTop -= dy;
    // Smoothed px/ms velocity, used for the fling on release.
    p.vx = 0.75 * (dx / dt) + 0.25 * p.vx;
    p.vy = 0.75 * (dy / dt) + 0.25 * p.vy;
    p.lastX = e.clientX;
    p.lastY = e.clientY;
    p.lastT = now;
  };

  const endPan = (fling: boolean) => {
    const p = panRef.current;
    panRef.current = null;
    if (!fling || !p || !p.active || !p.scroller) return;
    // A finger that came to rest before lifting should not fling.
    if (performance.now() - p.lastT > 60) return;
    const el = p.scroller;
    const cap = (v: number) => Math.max(-MAX_FLING_PX_MS, Math.min(MAX_FLING_PX_MS, v));
    let vx = cap(p.vx);
    let vy = cap(p.vy);
    let last = performance.now();
    const step = (t: number) => {
      const dt = Math.min(32, Math.max(1, t - last));
      last = t;
      const decay = Math.pow(FLING_FRICTION, dt);
      vx *= decay;
      vy *= decay;
      if (Math.hypot(vx, vy) < 0.02) {
        momentumRaf.current = null;
        return;
      }
      el.scrollLeft -= vx * dt;
      el.scrollTop -= vy * dt;
      momentumRaf.current = window.requestAnimationFrame(step);
    };
    stopMomentum();
    momentumRaf.current = window.requestAnimationFrame(step);
  };

  /** Drop whatever the active pointer had started (palm takeover, cancel, pinch). */
  const abandonActive = () => {
    activePointer.current = null;
    if (dwellTimer.current) window.clearTimeout(dwellTimer.current);
    drawing.current = null;
    lassoPoints.current = [];
    if (isDraggingSelection.current) {
      isDraggingSelection.current = false;
      dragStartPt.current = null;
      commit([...strokesRef.current]);
    }
    scratchRef.current?.getContext('2d')?.clearRect(0, 0, width, height);
    paint();
  };

  /** Coalesce live-stroke repaints to one per frame; 240Hz pens otherwise repaint 4× a frame. */
  const schedulePaint = () => {
    if (paintRaf.current != null) return;
    paintRaf.current = window.requestAnimationFrame(() => {
      paintRaf.current = null;
      paint();
    });
  };

  // ── پاک‌سازی انتخاب در صورت تغییر ابزار ───────────────
  useEffect(() => {
    if (tool !== 'lasso') {
      selectedIds.current.clear();
      selectionBBox.current = null;
      lassoPoints.current = [];
      paint();
    }
  }, [tool, paint]);

  // ── رویدادهای اشاره‌گر (PointerEvents) ────────────────────────
  // iPadOS also fires a touchstart with touchType 'stylus' for Apple Pencil.
  // Only cancelling that (non-passive) touchstart stops WebKit from starting a
  // native text selection / loupe / Copy-Look Up callout under the pen;
  // preventDefault on pointerdown alone does not.
  const toolRef = useRef(tool);
  toolRef.current = tool;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onTouchStart = (ev: TouchEvent) => {
      if (!toolRef.current) return;
      for (let i = 0; i < ev.touches.length; i++) {
        if ((ev.touches[i] as Touch & { touchType?: string }).touchType === 'stylus') {
          ev.preventDefault();
          return;
        }
      }
    };
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    return () => canvas.removeEventListener('touchstart', onTouchStart);
  }, []);

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!tool) return;
    const route = classifyPointer(e);
    if (e.pointerType === 'touch') {
      if (route === 'ignore') {
        ignoredTouches.current.add(e.pointerId);
        return;
      }
      touchPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      stopMomentum();
      if (touchPointers.current.size >= 2) {
        // A second finger means pinch-zoom, which the reader handles; drop what the first began.
        endPan(false);
        if (activePointer.current !== null && activeIsTouch.current) abandonActive();
        return;
      }
    } else if (route === 'ignore') {
      return;
    }
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      e.preventDefault();
      // Drop a selection made before the pen came down so the iOS callout menu does not linger.
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) sel.removeAllRanges();
    }
    try {
      // Keep the pointer on this page even when it crosses into the next page's canvas.
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // best effort; touch pointers are implicitly captured anyway
    }
    if (route === 'pan') {
      beginPan(e);
      return;
    }
    if (activePointer.current !== null && activePointer.current !== e.pointerId) {
      // Only the pen may take over a stroke already under way (a palm that touched down first).
      if (e.pointerType !== 'pen' || !activeIsTouch.current) return;
      abandonActive();
    }
    if (e.pointerType === 'pen') {
      penDown.current = true;
      notePen(true);
      endPan(false);
      stopMomentum();
    }
    activePointer.current = e.pointerId;
    activeIsTouch.current = e.pointerType === 'touch';

    const rect = e.currentTarget.getBoundingClientRect();
    strokeStartTime.current = performance.now();
    const pt = extractPoint(e, rect, strokeStartTime.current);

    if (tool === 'eraser') {
      applyEraser(pt);
      const sCtx = scratchRef.current?.getContext('2d');
      if (sCtx) {
        sCtx.clearRect(0, 0, width, height);
        const rPx = Math.max(0.006, Math.min(0.065, (strokeWidth || 0.0035) * 4.0)) * width;
        sCtx.save();
        sCtx.beginPath();
        sCtx.arc(pt.x * width, pt.y * height, rPx, 0, Math.PI * 2);
        sCtx.strokeStyle = 'rgba(0, 242, 254, 0.85)';
        sCtx.lineWidth = 1.5;
        sCtx.setLineDash([3, 3]);
        sCtx.fillStyle = 'rgba(0, 242, 254, 0.12)';
        sCtx.fill();
        sCtx.stroke();
        sCtx.restore();
      }
      return;
    }

    if (tool === 'lasso') {
      const bbox = selectionBBox.current;
      if (
        bbox &&
        selectedIds.current.size > 0 &&
        pt.x >= bbox.minX - 0.02 &&
        pt.x <= bbox.maxX + 0.02 &&
        pt.y >= bbox.minY - 0.02 &&
        pt.y <= bbox.maxY + 0.02
      ) {
        // شروع جابه‌جایی استروک‌های انتخاب‌شده
        isDraggingSelection.current = true;
        dragStartPt.current = { x: pt.x, y: pt.y };
        return;
      }
      // شروع منحنی جدید کمند
      selectedIds.current.clear();
      selectionBBox.current = null;
      isDraggingSelection.current = false;
      dragStartPt.current = null;
      lassoPoints.current = [pt];
      paint();
      return;
    }

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // safe fallback
    }

    const newStroke: Stroke = {
      stroke_id: generateUUID(),
      tool,
      color,
      width: strokeWidth,
      opacity: tool === 'highlighter' ? 0.35 : 1.0,
      blend_mode: tool === 'highlighter' ? 'multiply' : 'source-over',
      points: [pt],
      created_at: new Date().toISOString(),
    };
    drawing.current = newStroke;
    paint();

    // شروع تایمر صاف‌سازی درجا (Dwell to Snap: 450ms)
    lastDwellPoint.current = { x: pt.x, y: pt.y };
    if (dwellTimer.current) window.clearTimeout(dwellTimer.current);
    dwellTimer.current = window.setTimeout(() => {
      if (shapeSnap && drawing.current && drawing.current.points.length >= 6) {
        drawing.current.points = snapToCleanShape(drawing.current.points);
        paint();
      }
    }, 450);
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!tool) return;
    if (panRef.current && panRef.current.id === e.pointerId) {
      movePan(e);
      return;
    }
    if (e.pointerType === 'pen' && e.buttons === 0 && e.pressure === 0) {
      // A hovering pencil means the writing hand is near: feed finger-mode palm rejection.
      if (!stylusOnly) lastStylusTime.current = performance.now();
      return;
    }
    if (e.pointerId !== activePointer.current) return;

    const rect = e.currentTarget.getBoundingClientRect();

    if (tool === 'eraser') {
      if (e.buttons !== 1) return;
      const pt = extractPoint(e, rect, strokeStartTime.current);
      applyEraser(pt);
      const sCtx = scratchRef.current?.getContext('2d');
      if (sCtx) {
        sCtx.clearRect(0, 0, width, height);
        const rPx = Math.max(0.006, Math.min(0.065, (strokeWidth || 0.0035) * 4.0)) * width;
        sCtx.save();
        sCtx.beginPath();
        sCtx.arc(pt.x * width, pt.y * height, rPx, 0, Math.PI * 2);
        sCtx.strokeStyle = 'rgba(0, 242, 254, 0.85)';
        sCtx.lineWidth = 1.5;
        sCtx.setLineDash([3, 3]);
        sCtx.fillStyle = 'rgba(0, 242, 254, 0.12)';
        sCtx.fill();
        sCtx.stroke();
        sCtx.restore();
      }
      return;
    }

    if (tool === 'lasso') {
      const pt = extractPoint(e, rect, strokeStartTime.current);
      if (isDraggingSelection.current && dragStartPt.current && selectionBBox.current) {
        const dx = pt.x - dragStartPt.current.x;
        const dy = pt.y - dragStartPt.current.y;
        dragStartPt.current = { x: pt.x, y: pt.y };

        for (const s of strokesRef.current) {
          if (selectedIds.current.has(s.stroke_id)) {
            for (const p of s.points) {
              p.x = Math.min(1.0, Math.max(0.0, p.x + dx));
              p.y = Math.min(1.0, Math.max(0.0, p.y + dy));
            }
          }
        }
        selectionBBox.current.minX += dx;
        selectionBBox.current.maxX += dx;
        selectionBBox.current.minY += dy;
        selectionBBox.current.maxY += dy;
        paint();
        return;
      }
      if (lassoPoints.current.length > 0) {
        lassoPoints.current.push(pt);
        paint();
      }
      return;
    }

    const live = drawing.current;
    if (!live) return;

    // پردازش رویدادهای منسجم (120Hz/240Hz Coalesced Events)
    const nativeEvt = e.nativeEvent;
    const events =
      typeof nativeEvt.getCoalescedEvents === 'function'
        ? nativeEvt.getCoalescedEvents()
        : [nativeEvt];

    for (const subEvt of events) {
      const pt = extractPoint(subEvt, rect, strokeStartTime.current);
      const last = live.points[live.points.length - 1];
      if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) >= 0.0004) {
        live.points.push(pt);
      }
    }
    schedulePaint();

    // مدیریت مکث برای صاف‌سازی (Dwell Detection)
    const curPt = live.points[live.points.length - 1];
    if (curPt && lastDwellPoint.current) {
      const moveDist = Math.hypot(curPt.x - lastDwellPoint.current.x, curPt.y - lastDwellPoint.current.y);
      if (moveDist > 0.008) {
        lastDwellPoint.current = { x: curPt.x, y: curPt.y };
        if (dwellTimer.current) window.clearTimeout(dwellTimer.current);
        dwellTimer.current = window.setTimeout(() => {
          if (shapeSnap && drawing.current && drawing.current.points.length >= 6) {
            drawing.current.points = snapToCleanShape(drawing.current.points);
            paint();
          }
        }, 450);
      }
    }
  };

  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    touchPointers.current.delete(e.pointerId);
    ignoredTouches.current.delete(e.pointerId);
    if (panRef.current && panRef.current.id === e.pointerId) {
      endPan(e.type === 'pointerup');
      return;
    }
    if (e.pointerType === 'pen' && penDown.current) {
      penDown.current = false;
      notePen(false);
      markPen();
    }
    // Lifting a palm (or any other pointer) must never end the pen's stroke.
    if (e.pointerId !== activePointer.current) return;
    activePointer.current = null;
    if (tool === 'eraser') {
      scratchRef.current?.getContext('2d')?.clearRect(0, 0, width, height);
    }
    if (dwellTimer.current) window.clearTimeout(dwellTimer.current);

    if (tool === 'lasso') {
      if (isDraggingSelection.current) {
        isDraggingSelection.current = false;
        dragStartPt.current = null;
        commit([...strokesRef.current]);
        paint();
        return;
      }
      const poly = lassoPoints.current;
      lassoPoints.current = [];
      if (poly.length > 2) {
        const matched = new Set<string>();
        let bMinX = 1.0, bMaxX = 0.0, bMinY = 1.0, bMaxY = 0.0;
        for (const s of strokesRef.current) {
          if (!s.points || s.points.length === 0) continue;
          let insideCount = 0;
          for (const p of s.points) {
            if (isPointInPolygon(p, poly)) insideCount++;
          }
          if (insideCount >= Math.ceil(s.points.length * 0.45) || (s.points.length === 1 && insideCount === 1)) {
            matched.add(s.stroke_id);
            for (const p of s.points) {
              bMinX = Math.min(bMinX, p.x);
              bMaxX = Math.max(bMaxX, p.x);
              bMinY = Math.min(bMinY, p.y);
              bMaxY = Math.max(bMaxY, p.y);
            }
          }
        }
        if (matched.size > 0) {
          selectedIds.current = matched;
          selectionBBox.current = { minX: bMinX, minY: bMinY, maxX: bMaxX, maxY: bMaxY };
        } else {
          selectedIds.current.clear();
          selectionBBox.current = null;
        }
      } else {
        selectedIds.current.clear();
        selectionBBox.current = null;
      }
      paint();
      return;
    }

    const live = drawing.current;
    if (!live) return;
    drawing.current = null;

    if (live.points.length < 2) {
      // ایجاد نقطهٔ کوچک برای کلیک تکی
      const p0 = live.points[0];
      live.points.push({
        x: p0.x + 0.0004,
        y: p0.y,
        pressure: p0.pressure,
        time: p0.time + 10,
      });
    } else if (shapeSnap && live.tool !== 'highlighter') {
      // Highlighter keeps the hand-drawn path; it only straightens on a deliberate hold (dwell).
      live.points = snapToCleanShape(live.points);
    }

    commit([...strokesRef.current, live]);
    paint();
  };

  const onCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    touchPointers.current.delete(e.pointerId);
    ignoredTouches.current.delete(e.pointerId);
    if (panRef.current && panRef.current.id === e.pointerId) {
      endPan(false);
      return;
    }
    if (e.pointerType === 'pen' && penDown.current) {
      penDown.current = false;
      notePen(false);
    }
    if (e.pointerId === activePointer.current) abandonActive();
  };

  useImperativeHandle(ref, () => ({
    undo: () => {
      const prev = past.current.pop();
      if (!prev) return;
      future.current.push(strokesRef.current);
      strokesRef.current = prev;
      setStrokes(prev);
      cbs.current.onCount(prev.length);
      cbs.current.onHistory({ undo: past.current.length, redo: future.current.length });
      dirty.current = true;
      paint();
    },
    redo: () => {
      const next = future.current.pop();
      if (!next) return;
      past.current.push(strokesRef.current);
      strokesRef.current = next;
      setStrokes(next);
      cbs.current.onCount(next.length);
      cbs.current.onHistory({ undo: past.current.length, redo: future.current.length });
      dirty.current = true;
      paint();
    },
    clear: () => {
      if (strokesRef.current.length === 0) return;
      past.current.push(strokesRef.current);
      future.current = [];
      strokesRef.current = [];
      setStrokes([]);
      cbs.current.onCount(0);
      cbs.current.onHistory({ undo: past.current.length, redo: future.current.length });
      dirty.current = true;
      paint();
    },
    count: () => strokesRef.current.length,
  }));

  return (
    <>
      <canvas
        ref={highlighterCanvasRef}
        className="ink-canvas ink-canvas--highlighter"
        style={{
          width,
          height,
          position: 'absolute',
          inset: 0,
          zIndex: 2,
          mixBlendMode: 'multiply',
          opacity: HIGHLIGHTER_ALPHA,
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      />
      <canvas
        ref={canvasRef}
        className={`ink-canvas${tool ? ' ink-canvas--active' : ''}`}
        style={{ width, height, position: 'absolute', inset: 0, zIndex: 3, touchAction: tool ? 'none' : 'auto' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        onLostPointerCapture={onUp}
        aria-label={
          tool
            ? 'سطح حاشیه‌نویسی دیجیتال؛ با قلم یا ماوس خط بکشید'
            : 'حاشیه‌نویسی‌های این صفحه'
        }
        role="img"
      />
      <canvas
        ref={scratchRef}
        className="ink-canvas ink-canvas--scratch"
        style={{ width, height, position: 'absolute', inset: 0, zIndex: 4, pointerEvents: 'none' }}
        aria-hidden="true"
      />
    </>
  );
});
