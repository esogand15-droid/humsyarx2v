import { isPenBusy, PALM_CONTACT_PX } from './penInput';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { DsButton, DsEmpty, DsSkeleton } from '../../design/components';
import { Icon } from '../../icons';
import { apiCall } from '../../lib/api';
import { fa } from '../../lib/library';
import {
  bookmarks,
  generateUUID,
  ink,
  insertedInkId,
  insertedPages,
  type InsertedPage,
  type PageTemplate,
  type Scope,
  type StickyNote,
} from '../../lib/ink';
import { InkLayer, type InkApi, type InkStatus } from './InkLayer';
import { INK_COLORS, InkToolbar, type ReaderTool } from './InkToolbar';
import { NotebookPanel } from './NotebookPanel';
import { StickyNoteOverlay } from './StickyNoteOverlay';
import { ThumbnailDrawer } from './ThumbnailDrawer';
import { PageOverview } from './PageOverview';
import { InsertedPageView, PageInserter, PageTemplatePicker } from './InsertedPage';
import { TextLayer } from './components/TextLayer';
import {
  acquirePageUrl,
  getCachedInkPage,
  getCachedPageUrl,
  invalidatePageCache,
  prefetchPageUrl,
  setCachedInkPage,
} from './readerPageCache';

import './components/TextLayer.css';
import './reader.css';

export interface PageDimension {
  page: number;
  width: number;
  height: number;
  aspect_ratio: number;
  url: string;
  thumbnail_url?: string;
}

export interface DocumentManifest {
  file_id: string;
  scope: Scope;
  title: string;
  total_pages: number;
  page_dimensions: PageDimension[];
  encryption_mode?: string;
  watermark_user_id?: number;
  /** ثانیهٔ اعتبار آدرسهای امضاشدهٔ صفحات (سرورهای جدید) */
  expires_in?: number;
  /** epoch ثانیهٔ انقضا در ساعت سرور (سرورهای جدید) */
  expires_at?: number;
}

/** چند ثانیه قبل از انقضا مانیفست بیصدا تازه شود. */
const MANIFEST_REFRESH_LEAD_SEC = 120;

const PEN_MODE_KEY = 'hz.reader.penMode';

/** Stored pen-mode choice for this device; `null` until the student (or a detected pen) sets it. */
function readPenMode(): boolean | null {
  try {
    const v = window.localStorage.getItem(PEN_MODE_KEY);
    return v === null ? null : v === '1';
  } catch {
    return null;
  }
}

function writePenMode(on: boolean): void {
  try {
    window.localStorage.setItem(PEN_MODE_KEY, on ? '1' : '0');
  } catch {
    // private mode / full storage: the toggle still works for this session
  }
}

/** One zoom range for wheel, pinch, keys and buttons; before this, '+' above 2.0 zoomed out. */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));

/** زمان تازهسازی (ms در ساعت همین مرورگر) از روی مانیفست.
    از expires_in نسبی استفاده میکنیم تا اختلاف ساعت دستگاه با سرور مهم نباشد؛
    سرور قدیمی که expires_in نمیفرستد، از پارامتر expires آدرس صفحه خوانده میشود. */
export function manifestRefreshAt(m: DocumentManifest, receivedAt = Date.now()): number {
  let ttl = typeof m.expires_in === 'number' && m.expires_in > 0 ? m.expires_in : 0;
  if (!ttl) {
    const first = m.page_dimensions?.[0]?.url || '';
    const match = /[?&]expires=(\d+)/.exec(first);
    if (match) ttl = Math.max(0, Number(match[1]) - Math.floor(receivedAt / 1000));
  }
  if (!ttl) return 0; // آدرس بدون انقضا (مثلاً دمو) — تازهسازی لازم نیست
  return receivedAt + Math.max(30, ttl - MANIFEST_REFRESH_LEAD_SEC) * 1000;
}

export interface ProtectedReaderViewProps {
  scope: Scope;
  id: string;
  url?: string;
  startPage?: number;
  jumpRequest?: { page: number; seq: number } | null;
  onProgress: (page: number, total: number) => void;
  onExpired?: () => Promise<string | null>;
  onToggleSplitWorkspace?: () => void;
  onInkChanged?: () => void;
  isAiOpen?: boolean;
}

export async function fetchDocumentManifest(scope: Scope, id: string): Promise<DocumentManifest> {
  try {
    return await apiCall<DocumentManifest>(`/reader/manifest/${scope}/${encodeURIComponent(id)}`);
  } catch {
    return await apiCall<DocumentManifest>(`/manifest/${scope}/${encodeURIComponent(id)}`);
  }
}

/**
 * نمایشگر پرچم‌دار جزوات و اسناد هامزیار (GoodNotes-Grade Protected Reader).
 */
export function ProtectedReaderView({
  scope,
  id,
  startPage = 1,
  jumpRequest = null,
  onProgress,
  onExpired,
  onToggleSplitWorkspace,
  onInkChanged,
  isAiOpen = false,
}: ProtectedReaderViewProps) {
  const [manifest, setManifest] = useState<DocumentManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentPage, setCurrentPage] = useState(startPage || 1);
  const [zoom, setZoom] = useState(1.0); // ZOOM_MIN..ZOOM_MAX
  const [gestureBadgeZoom, setGestureBadgeZoom] = useState<number | null>(null);
  const [baseWidth, setBaseWidth] = useState(720);
  const [nearPages, setNearPages] = useState<Set<number>>(() => {
    const p = Math.max(1, startPage || 1);
    return new Set([Math.max(1, p - 1), p, p + 1, p + 2]);
  });

  // لایه ابزارهای نوت‌برداری
  const [tool, setTool] = useState<ReaderTool>(null);
  // Page the pen last touched (inserted pages use -slot), so undo/redo reach the page being written on.
  const [inkFocus, setInkFocus] = useState<number | null>(null);
  const inkFocusRef = useRef<number | null>(null);
  inkFocusRef.current = inkFocus;
  const toolActiveRef = useRef(false);
  toolActiveRef.current = tool !== null;
  const [color, setColor] = useState(INK_COLORS[1]);
  const [strokeWidth, setStrokeWidth] = useState(0.0035);
  const [status, setStatus] = useState<InkStatus>('idle');
  const [inkCount, setInkCount] = useState(0);
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const [eraserMode, setEraserMode] = useState<'stroke' | 'partial'>('stroke');
  const [eraseHighlighterOnly, setEraseHighlighterOnly] = useState(false);
  const [shapeSnap, setShapeSnap] = useState(false);
  // Pen mode (stylus writes, finger scrolls/zooms) is remembered per device and turns itself on
  // the first time a stylus touches a page, unless the student already chose.
  const [stylusOnly, setStylusOnlyState] = useState(() => readPenMode() === true);
  const setStylusOnly = useCallback((on: boolean) => {
    setStylusOnlyState(on);
    writePenMode(on);
  }, []);
  const handlePenDetected = useCallback(() => {
    if (readPenMode() === null) setStylusOnly(true);
  }, [setStylusOnly]);

  // While any ink tool is active, nothing on the page (headers, toolbar labels,
  // PDF text layer) may be picked up as a text selection by the pen.
  useEffect(() => {
    if (!tool) return;
    const root = document.documentElement;
    root.classList.add('is-inking');
    window.getSelection()?.removeAllRanges();
    return () => root.classList.remove('is-inking');
  }, [tool]);

  // یادداشت‌های چسبان و نشان‌ها
  const [pageNotes, setPageNotes] = useState<Map<number, StickyNote[]>>(new Map());
  const [bookmarkedPages, setBookmarkedPages] = useState<number[]>(() => bookmarks.get(scope, id));

  // حالت‌های نمایشی
  const [focusMode, setFocusMode] = useState(false);
  const [invertContrast, setInvertContrast] = useState(false);
  const [thumbnailDrawerOpen, setThumbnailDrawerOpen] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [notebookKey, setNotebookKey] = useState(0);

  // Text layer state
  const [textContents] = useState<Map<number, any>>(new Map());
  const [searchQuery] = useState('');
  const [searchMatches] = useState<number[]>([]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const inkApis = useRef<Map<number, InkApi>>(new Map());
  const progressRef = useRef(onProgress);
  progressRef.current = onProgress;
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const totalPagesRef = useRef(0);
  totalPagesRef.current = manifest?.total_pages ?? 0;

  // ── لنگرگاه هوشمند زوم + ژست ۶۰ فریم بدون رندر مکرر (pdf.js pattern) ──
  const zoomAnchorRef = useRef<{ page: number; rx: number; ry: number; px: number; py: number } | null>(null);
  const isZoomingRef = useRef(false);
  const zoomResetTimerRef = useRef<number | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const gestureRef = useRef<{
    active: boolean;
    baseZoom: number;
    targetZoom: number;
    originX: number;
    originY: number;
    rafId: number | null;
    commitTimer: number | null;
  }>({
    active: false,
    baseZoom: 1,
    targetZoom: 1,
    originX: 0,
    originY: 0,
    rafId: null,
    commitTimer: null,
  });

  const captureZoomAnchor = useCallback(
    (clientX?: number, clientY?: number) => {
      const scroller = scrollRef.current;
      if (!scroller) return;
      const sr = scroller.getBoundingClientRect();
      const px = (clientX ?? sr.left + sr.width / 2) - sr.left;
      const py = (clientY ?? sr.top + sr.height / 2) - sr.top;
      const hit = Array.from(pageRefs.current.entries()).find(([, el]) => {
        const r = el.getBoundingClientRect();
        return r.top - sr.top <= py && r.bottom - sr.top >= py;
      });
      const page = hit ? hit[0] : currentPage;
      const pageEl = pageRefs.current.get(page);
      if (pageEl) {
        const r = pageEl.getBoundingClientRect();
        zoomAnchorRef.current = {
          page,
          rx: (px - (r.left - sr.left)) / Math.max(1, r.width),
          ry: (py - (r.top - sr.top)) / Math.max(1, r.height),
          px,
          py,
        };
      }
      isZoomingRef.current = true;
      if (zoomResetTimerRef.current) window.clearTimeout(zoomResetTimerRef.current);
      zoomResetTimerRef.current = window.setTimeout(() => {
        isZoomingRef.current = false;
      }, 280);
    },
    [currentPage],
  );

  const applyGestureTransform = useCallback(
    (nextTargetZoom: number, clientX?: number, clientY?: number) => {
      const track = trackRef.current;
      const scroller = scrollRef.current;
      if (!track || !scroller) return;

      const g = gestureRef.current;
      const clamped = clampZoom(nextTargetZoom);

      if (!g.active) {
        const sr = scroller.getBoundingClientRect();
        const cx = clientX ?? sr.left + sr.width / 2;
        const cy = clientY ?? sr.top + sr.height / 2;
        const tr = track.getBoundingClientRect();
        g.active = true;
        g.baseZoom = zoomRef.current;
        g.originX = Math.max(0, Math.min(tr.width, cx - tr.left));
        g.originY = Math.max(0, Math.min(tr.height, cy - tr.top));
        track.classList.add('is-gesturing');
        captureZoomAnchor(cx, cy);
      }

      g.targetZoom = clamped;
      setGestureBadgeZoom(clamped);

      if (g.rafId == null) {
        g.rafId = window.requestAnimationFrame(() => {
          g.rafId = null;
          const t = trackRef.current;
          if (!t || !gestureRef.current.active) return;
          const rel = gestureRef.current.targetZoom / Math.max(0.1, gestureRef.current.baseZoom);
          t.style.transformOrigin = `${gestureRef.current.originX}px ${gestureRef.current.originY}px`;
          t.style.transform = `scale(${rel})`;
        });
      }
    },
    [captureZoomAnchor],
  );

  const commitGestureZoom = useCallback(() => {
    const g = gestureRef.current;
    if (g.commitTimer) {
      window.clearTimeout(g.commitTimer);
      g.commitTimer = null;
    }
    if (g.rafId != null) {
      window.cancelAnimationFrame(g.rafId);
      g.rafId = null;
    }
    if (!g.active) return;
    g.active = false;
    setGestureBadgeZoom(null);

    const next = clampZoom(g.targetZoom);
    if (next !== zoomRef.current) {
      setZoom(next);
    } else {
      const t = trackRef.current;
      if (t) {
        t.style.transform = '';
        t.style.transformOrigin = '';
        t.classList.remove('is-gesturing');
      }
      isZoomingRef.current = false;
    }
  }, []);

  const scheduleCommitZoom = useCallback(
    (delayMs = 150) => {
      const g = gestureRef.current;
      if (g.commitTimer) window.clearTimeout(g.commitTimer);
      g.commitTimer = window.setTimeout(() => {
        commitGestureZoom();
      }, delayMs);
    },
    [commitGestureZoom],
  );

  // Clear CSS preview transform and apply exact scroll anchor in the same layout commit frame.
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (track) {
      track.style.setProperty('--zoom-w', `${Math.floor(baseWidth * zoom)}px`);
      track.style.transform = '';
      track.style.transformOrigin = '';
      track.classList.remove('is-gesturing');
    }

    const a = zoomAnchorRef.current;
    zoomAnchorRef.current = null;
    const scroller = scrollRef.current;
    const pageEl = a ? pageRefs.current.get(a.page) : undefined;
    if (!a || !scroller || !pageEl) return;
    const sr = scroller.getBoundingClientRect();
    const r = pageEl.getBoundingClientRect();
    scroller.scrollTop += r.top - sr.top + a.ry * r.height - a.py;
    scroller.scrollLeft += r.left - sr.left + a.rx * r.width - a.px;
  }, [zoom, baseWidth]);

  useEffect(() => {
    const g = gestureRef.current;
    return () => {
      if (g.rafId != null) window.cancelAnimationFrame(g.rafId);
      if (g.commitTimer) window.clearTimeout(g.commitTimer);
      if (zoomResetTimerRef.current) window.clearTimeout(zoomResetTimerRef.current);
    };
  }, []);

  // ── کنترل بزرگ‌نمایی چندلمسی + ترک‌پد ویندوز + ژست Safari (بدون فریز رندر) ──
  const touchDistRef = useRef<number | null>(null);
  const touchStartZoomRef = useRef<number>(1.0);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const current = gestureRef.current.active ? gestureRef.current.targetZoom : zoomRef.current;
      const delta = -e.deltaY * 0.0055;
      const clampedDelta = Math.max(-0.22, Math.min(0.22, delta));
      applyGestureTransform(current + clampedDelta, e.clientX, e.clientY);
      scheduleCommitZoom(140);
    };

    // While inking only real fingers may pinch: a pencil touch or a resting palm must never zoom.
    const pinchTouches = (e: TouchEvent): Touch[] => {
      const list = Array.from(e.touches);
      if (!toolActiveRef.current) return list;
      if (isPenBusy()) return [];
      return list.filter((t) => {
        const kind = (t as Touch & { touchType?: string }).touchType;
        return (
          kind !== 'stylus' &&
          (t.radiusX || 0) * 2 <= PALM_CONTACT_PX &&
          (t.radiusY || 0) * 2 <= PALM_CONTACT_PX
        );
      });
    };

    const onTouchStart = (e: TouchEvent) => {
      const t = pinchTouches(e);
      if (t.length === 2) {
        const p1 = t[0];
        const p2 = t[1];
        touchDistRef.current = Math.hypot(p2.clientX - p1.clientX, p2.clientY - p1.clientY);
        touchStartZoomRef.current = gestureRef.current.active
          ? gestureRef.current.targetZoom
          : zoomRef.current;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      const t = pinchTouches(e);
      if (t.length === 2 && touchDistRef.current !== null && touchDistRef.current > 10) {
        e.preventDefault();
        const p1 = t[0];
        const p2 = t[1];
        const curDist = Math.hypot(p2.clientX - p1.clientX, p2.clientY - p1.clientY);
        const factor = curDist / touchDistRef.current;
        applyGestureTransform(
          touchStartZoomRef.current * factor,
          (p1.clientX + p2.clientX) / 2,
          (p1.clientY + p2.clientY) / 2,
        );
      } else if (touchDistRef.current !== null && t.length < 2) {
        // The pen or a palm interrupted the pinch: settle the zoom where it is.
        touchDistRef.current = null;
        commitGestureZoom();
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (pinchTouches(e).length < 2 && touchDistRef.current !== null) {
        touchDistRef.current = null;
        commitGestureZoom();
      }
    };

    let safariStartZoom = 1.0;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      // Safari's gesture events can't tell a palm from a finger; while inking the filtered
      // touch path above owns pinch-zoom.
      if (toolActiveRef.current) return;
      safariStartZoom = gestureRef.current.active ? gestureRef.current.targetZoom : zoomRef.current;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      if (toolActiveRef.current) return;
      const ge = e as Event & { scale?: number; clientX?: number; clientY?: number };
      if (typeof ge.scale === 'number') {
        applyGestureTransform(safariStartZoom * ge.scale, ge.clientX, ge.clientY);
      }
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      commitGestureZoom();
    };

    scroller.addEventListener('wheel', onWheel, { passive: false });
    scroller.addEventListener('touchstart', onTouchStart, { passive: true });
    scroller.addEventListener('touchmove', onTouchMove, { passive: false });
    scroller.addEventListener('touchend', onTouchEnd, { passive: true });
    scroller.addEventListener('touchcancel', onTouchEnd, { passive: true });
    scroller.addEventListener('gesturestart', onGestureStart, { passive: false });
    scroller.addEventListener('gesturechange', onGestureChange, { passive: false });
    scroller.addEventListener('gestureend', onGestureEnd, { passive: false });

    return () => {
      scroller.removeEventListener('wheel', onWheel);
      scroller.removeEventListener('touchstart', onTouchStart);
      scroller.removeEventListener('touchmove', onTouchMove);
      scroller.removeEventListener('touchend', onTouchEnd);
      scroller.removeEventListener('touchcancel', onTouchEnd);
      scroller.removeEventListener('gesturestart', onGestureStart);
      scroller.removeEventListener('gesturechange', onGestureChange);
      scroller.removeEventListener('gestureend', onGestureEnd);
    };
  }, [manifest, applyGestureTransform, commitGestureZoom, scheduleCommitZoom]);

  // ── تازهسازی بیصدای آدرسهای امضاشده (T1) ──
  const refreshAtRef = useRef(0);
  const inflightRef = useRef<Promise<DocumentManifest | null> | null>(null);
  const [prefetchTick, setPrefetchTick] = useState(0);

  const acceptManifest = useCallback((data: DocumentManifest) => {
    refreshAtRef.current = manifestRefreshAt(data);
    setManifest(data);
  }, []);

  const handlePageLoaded = useCallback(() => {
    setPrefetchTick((n) => n + 1);
  }, []);

  const silentRefresh = useCallback((): Promise<DocumentManifest | null> => {
    if (inflightRef.current) return inflightRef.current;
    const job = (async () => {
      try {
        const data = await fetchDocumentManifest(scope, id);
        acceptManifest(data);
        return data;
      } catch {
        refreshAtRef.current = Date.now() + 60_000;
        return null;
      } finally {
        inflightRef.current = null;
      }
    })();
    inflightRef.current = job;
    return job;
  }, [scope, id, acceptManifest]);

  /** یک صفحه 401/403 گرفت: یکبار مانیفست تازه بگیر و آدرس جدید همان صفحه را بده. */
  const freshPageUrl = useCallback(
    async (page: number): Promise<string | null> => {
      const data = await silentRefresh();
      return data?.page_dimensions.find((d) => d.page === page)?.url ?? null;
    },
    [silentRefresh],
  );

  // پیش‌بارگذاری آرام صفحات همسایه (+1، +2، +3، -1) داخل کش RAM
  const prefetchedUrlsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    prefetchedUrlsRef.current.clear();
  }, [scope, id]);

  useEffect(() => {
    if (!manifest || !manifest.page_dimensions?.length) return;
    const conn =
      typeof navigator !== 'undefined'
        ? (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
        : undefined;
    if (conn?.saveData) return;

    const timer = window.setTimeout(() => {
      const targets = [currentPage + 1, currentPage + 2, currentPage + 3, currentPage - 1];
      for (const p of targets) {
        if (p < 1 || p > manifest.total_pages) continue;
        const dim = manifest.page_dimensions.find((d) => d.page === p);
        if (!dim?.url || prefetchedUrlsRef.current.has(dim.url)) continue;
        prefetchedUrlsRef.current.add(dim.url);
        prefetchPageUrl(scope, id, p, dim.url, () => freshPageUrl(p));
      }
    }, 90);

    return () => window.clearTimeout(timer);
  }, [manifest, currentPage, prefetchTick, scope, id, freshPageUrl]);

  // زمانبندی تازهسازی ~۲ دقیقه قبل از انقضا
  useEffect(() => {
    if (!manifest) return;
    const at = refreshAtRef.current;
    if (!at) return;
    const timer = window.setTimeout(() => void silentRefresh(), Math.max(0, at - Date.now()));
    const check = () => {
      if (document.visibilityState === 'visible' && refreshAtRef.current && Date.now() >= refreshAtRef.current) {
        void silentRefresh();
      }
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('online', check);
    window.addEventListener('focus', check);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('online', check);
      window.removeEventListener('focus', check);
    };
  }, [manifest, silentRefresh]);

  // دریافت مانیفست
  const initialJumpedRef = useRef(false);
  const loadManifest = useCallback(async () => {
    setLoading(true);
    setError('');
    initialJumpedRef.current = false;
    try {
      const data = await fetchDocumentManifest(scope, id);
      acceptManifest(data);
      if (data.total_pages > 0) {
        const initialPage = Math.min(Math.max(1, startPage || 1), data.total_pages);
        setCurrentPage(initialPage);
      }
      setLoading(false);
    } catch {
      if (onExpired) {
        try {
          const fresh = await onExpired();
          if (fresh) {
            const data = await fetchDocumentManifest(scope, id);
            acceptManifest(data);
            setLoading(false);
            return;
          }
        } catch {
          /* خطا در پایین نمایش داده می‌شود */
        }
      }
      setLoading(false);
      setError('بارگذاری اطلاعات سند با خطا مواجه شد. لطفاً دوباره تلاش کنید.');
    }
  }, [scope, id, startPage, onExpired, acceptManifest]);

  useEffect(() => {
    void loadManifest();
  }, [loadManifest]);

  // اندازه‌گیری پیوسته عرض محفظه با ResizeObserver (همگام با سایدبار و تقسیم پنل)
  useEffect(() => {
    const el = scrollRef.current || containerRef.current;
    if (!el) return;
    let raf = 0;
    const updateWidth = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const target = scrollRef.current || containerRef.current;
        if (!target) return;
        const available = Math.max(300, target.clientWidth - 32);
        const clamped = Math.min(available, 1400);
        setBaseWidth((prev) => (Math.abs(prev - clamped) >= 2 ? clamped : prev));
      });
    };
    updateWidth();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(updateWidth);
      ro.observe(el);
      return () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
      };
    }
    window.addEventListener('resize', updateWidth);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', updateWidth);
    };
  }, [manifest, notebookOpen]);

  // ناظر متمرکز پنجره‌بندی (۱ ناظر برای کل سند) + تشخیص دقیق صفحهٔ فعال بر مبنای مرکز دید
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !manifest) return;

    const obs = new IntersectionObserver(
      (entries) => {
        setNearPages((prev) => {
          let changed = false;
          const next = new Set(prev);
          for (const entry of entries) {
            const pageNum = Number((entry.target as HTMLElement).dataset.page || 0);
            if (!pageNum) continue;
            if (entry.isIntersecting) {
              if (!next.has(pageNum)) {
                next.add(pageNum);
                changed = true;
              }
            } else if (next.has(pageNum)) {
              next.delete(pageNum);
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      },
      { root: scroller, rootMargin: '1200px 0px 1200px 0px' },
    );

    for (const el of pageRefs.current.values()) {
      obs.observe(el);
    }

    let scrollRaf = 0;
    const pickActivePage = () => {
      scrollRaf = 0;
      if (isZoomingRef.current) return;
      const sr = scroller.getBoundingClientRect();
      const midY = sr.top + sr.height * 0.45;
      let bestPage = currentPage;
      let bestDist = Infinity;
      for (const [p, el] of pageRefs.current.entries()) {
        const r = el.getBoundingClientRect();
        if (r.bottom < sr.top || r.top > sr.bottom) continue;
        const pageCenter = (r.top + r.bottom) / 2;
        const dist = Math.abs(pageCenter - midY);
        if (dist < bestDist) {
          bestDist = dist;
          bestPage = p;
        }
      }
      if (bestPage !== currentPage) {
        setCurrentPage(bestPage);
        progressRef.current(bestPage, totalPagesRef.current);
      }
    };

    const onScroll = () => {
      if (!scrollRaf) {
        scrollRaf = window.requestAnimationFrame(pickActivePage);
      }
    };

    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      obs.disconnect();
      scroller.removeEventListener('scroll', onScroll);
      if (scrollRaf) window.cancelAnimationFrame(scrollRaf);
    };
  }, [manifest, currentPage]);

  // پرش به صفحه با اسکرول نرم
  const scrollToPage = useCallback(
    (p: number, instant = false) => {
      const clamped = Math.max(1, Math.min(manifest?.total_pages || p, p));
      setNearPages((prev) => {
        const next = new Set(prev);
        next.add(clamped);
        if (clamped > 1) next.add(clamped - 1);
        if (clamped < (manifest?.total_pages || clamped)) next.add(clamped + 1);
        return next;
      });
      const el = pageRefs.current.get(clamped);
      if (el) {
        el.scrollIntoView({ behavior: instant ? 'auto' : 'smooth', block: 'start' });
      }
      setCurrentPage(clamped);
      if (manifest) {
        progressRef.current(clamped, manifest.total_pages);
      }
    },
    [manifest],
  );

  // پرش اولیه به startPage پس از رندر مانیفست
  useEffect(() => {
    if (!manifest || initialJumpedRef.current) return;
    initialJumpedRef.current = true;
    const p = Math.min(Math.max(1, startPage || 1), manifest.total_pages || 1);
    if (p > 1) {
      window.requestAnimationFrame(() => scrollToPage(p, true));
    }
  }, [manifest, startPage, scrollToPage]);

  // پرش بدون رفرش صفحه از پنل دفترچه یا والد
  useEffect(() => {
    if (!jumpRequest || !manifest) return;
    scrollToPage(jumpRequest.page);
  }, [jumpRequest, manifest, scrollToPage]);

  // کلیدهای میانبر صفحه‌کلید
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;

      const total = manifest?.total_pages || 1;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        const api = inkApis.current.get(inkFocusRef.current ?? currentPage);
        if (e.shiftKey) api?.redo();
        else api?.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        captureZoomAnchor();
        setZoom((z) => clampZoom(z + 0.15));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        captureZoomAnchor();
        setZoom((z) => clampZoom(z - 0.15));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        captureZoomAnchor();
        setZoom(1.0);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'ArrowLeft' || e.key === 'PageDown') {
        scrollToPage(Math.min(total, currentPage + 1));
      }
      if (e.key === 'ArrowRight' || e.key === 'PageUp') {
        scrollToPage(Math.max(1, currentPage - 1));
      }
      if (e.key === '+' || e.key === '=') {
        captureZoomAnchor();
        setZoom((z) => clampZoom(z + 0.1));
      }
      if (e.key === '-') {
        captureZoomAnchor();
        setZoom((z) => clampZoom(z - 0.1));
      }
      if (e.key === 'f' || e.key === 'F') {
        setFocusMode((v) => !v);
      }
      if (e.key === 't' || e.key === 'T') {
        setThumbnailDrawerOpen((v) => !v);
      }
      if (e.key === '\\') {
        onToggleSplitWorkspace?.();
      }
      if (e.key === 'p' || e.key === 'P') setTool((t) => (t === 'pen' ? null : 'pen'));
      if (e.key === 'b' || e.key === 'B') setTool((t) => (t === 'ballpoint' ? null : 'ballpoint'));
      if (e.key === 'o' || e.key === 'O') setTool((t) => (t === 'fountain' ? null : 'fountain'));
      if (e.key === 's' || e.key === 'S') setShapeSnap((v) => !v);
      if (e.key === 'x' || e.key === 'X') setEraserMode((m) => (m === 'stroke' ? 'partial' : 'stroke'));
      if (e.key === 'h' || e.key === 'H') setTool((t) => (t === 'highlighter' ? null : 'highlighter'));
      if (e.key === 'e' || e.key === 'E') setTool((t) => (t === 'eraser' ? null : 'eraser'));
      if (e.key === 'l' || e.key === 'L') setTool((t) => (t === 'lasso' ? null : 'lasso'));
      if (e.key === 'Escape') {
        if (focusMode) setFocusMode(false);
        else if (thumbnailDrawerOpen) setThumbnailDrawerOpen(false);
        else setTool(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentPage, manifest, scrollToPage, focusMode, thumbnailDrawerOpen, onToggleSplitWorkspace, captureZoomAnchor]);

  const handleNotesLoaded = useCallback((page: number, loadedNotes: StickyNote[]) => {
    setPageNotes((prev) => {
      const m = new Map(prev);
      m.set(page, loadedNotes);
      return m;
    });
  }, []);

  // افزودن یادداشت چسبان به صفحهٔ جاری
  const handleAddStickyNote = () => {
    const currentList = pageNotes.get(currentPage) || [];
    const newNote: StickyNote = {
      note_id: generateUUID(),
      page: currentPage,
      x: 0.82,
      y: 0.15,
      text: '',
      color: 'yellow',
      collapsed: false,
      created_at: new Date().toISOString(),
    };
    const nextList = [...currentList, newNote];
    const nextMap = new Map(pageNotes);
    nextMap.set(currentPage, nextList);
    setPageNotes(nextMap);
    const cachedInk = getCachedInkPage(scope, id, currentPage);
    if (cachedInk) setCachedInkPage(scope, id, currentPage, { ...cachedInk, notes: nextList });
    void ink.save(scope, id, currentPage, undefined, nextList);
  };

  const handleUpdatePageNotes = useCallback(
    (page: number, updatedNotes: StickyNote[]) => {
      setPageNotes((prev) => {
        const nextMap = new Map(prev);
        nextMap.set(page, updatedNotes);
        return nextMap;
      });
      const cachedInk = getCachedInkPage(scope, id, page);
      if (cachedInk) setCachedInkPage(scope, id, page, { ...cachedInk, notes: updatedNotes });
      void ink.save(scope, id, page, undefined, updatedNotes);
    },
    [scope, id],
  );

  const handleToggleBookmark = (p: number) => {
    bookmarks.toggle(scope, id, p);
    setBookmarkedPages(bookmarks.get(scope, id));
  };

  const handleInkChanged = useCallback(() => {
    setNotebookKey((k) => k + 1);
    onInkChanged?.();
  }, [onInkChanged]);

  const handleTextSelection = useCallback((_text: string, _rects: DOMRect[]) => {
    // hook preserved for future selection toolbar
  }, []);

  const handleAnchorAnnotation = useCallback((_pageX: number, _pageY: number, _text: string) => {
    // hook preserved for anchored annotations
  }, []);

  // ── Pages inserted between handout pages (Noteful-style) ──
  const [inserts, setInserts] = useState<InsertedPage[]>(() => insertedPages.get(scope, id));
  const [insertPicker, setInsertPicker] = useState<{
    after: number;
    afterId?: string;
    editId?: string;
    current?: PageTemplate;
  } | null>(null);
  const [newInsertId, setNewInsertId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setInserts(insertedPages.get(scope, id));
    void insertedPages.load(scope, id).then((list) => {
      if (!cancelled) setInserts(list);
    });
    return () => {
      cancelled = true;
    };
  }, [scope, id]);

  useEffect(() => {
    setInkFocus(null);
  }, [currentPage]);

  const insertsByAfter = useMemo(() => {
    const m = new Map<number, InsertedPage[]>();
    for (const p of inserts) {
      const g = m.get(p.after);
      if (g) g.push(p);
      else m.set(p.after, [p]);
    }
    return m;
  }, [inserts]);

  const saveInserts = useCallback(
    (next: InsertedPage[]) => {
      setInserts(next);
      void insertedPages.save(scope, id, next);
    },
    [scope, id],
  );

  const handlePickTemplate = (template: PageTemplate) => {
    const req = insertPicker;
    setInsertPicker(null);
    if (!req) return;
    if (req.editId) {
      saveInserts(inserts.map((p) => (p.id === req.editId ? { ...p, template } : p)));
      return;
    }
    const entry: InsertedPage = {
      id: generateUUID(),
      slot: inserts.reduce((m, p) => Math.max(m, p.slot), 0) + 1,
      after: req.after,
      template,
      created_at: new Date().toISOString(),
    };
    const next = [...inserts];
    let at: number;
    if (req.afterId) {
      const i = next.findIndex((p) => p.id === req.afterId);
      at = i < 0 ? next.length : i + 1;
    } else {
      // Right after the handout page, ahead of pages inserted there earlier.
      const i = next.findIndex((p) => p.after === req.after);
      at = i < 0 ? next.length : i;
    }
    next.splice(at, 0, entry);
    saveInserts(next);
    setNewInsertId(entry.id);
  };

  const handleDeleteInsert = (entry: InsertedPage) => {
    if (!window.confirm('این صفحه و هر چه رویش نوشتهای حذف شود؟')) return;
    saveInserts(inserts.filter((p) => p.id !== entry.id));
    inkApis.current.delete(-entry.slot);
    if (inkFocusRef.current === -entry.slot) setInkFocus(null);
    void ink.clearPage(scope, insertedInkId(id), entry.slot);
  };

  // Bring a freshly inserted page into view while its entrance animation plays.
  useEffect(() => {
    if (!newInsertId) return;
    const raf = window.requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector<HTMLElement>(`[data-insert-id="${newInsertId}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    const t = window.setTimeout(() => setNewInsertId(null), 900);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
  }, [newInsertId]);

  const activeInkApi = inkApis.current.get(inkFocus ?? currentPage);
  const shownZoomPct = Math.round((gestureBadgeZoom ?? zoom) * 100);

  return (
    <div
      className={`reader reader--ink ${focusMode ? 'reader-focus-mode' : ''}`}
      ref={containerRef}
      onContextMenu={(e) => e.preventDefault()}
    >
      {loading && (
        <div className="reader__center" aria-busy="true">
          <DsSkeleton shape="title" />
          <span className="small">در حال آماده‌سازی سند امن…</span>
        </div>
      )}

      {error && !loading && (
        <div className="reader__center">
          <DsEmpty
            icon={<Icon name="i-arch" size={30} />}
            title="بارگذاری سند انجام نشد"
            body={<span className="reader__error-msg">{error}</span>}
            action={
              <DsButton variant="secondary" size="sm" onClick={() => void loadManifest()}>
                تلاش مجدد
              </DsButton>
            }
          />
        </div>
      )}

      {!loading && !error && manifest && (
        <div className="reader__stage">
          {(gestureBadgeZoom !== null || Math.abs(zoom - 1) > 0.02) && (
            <button
              type="button"
              className="reader-zoom-pill num"
              onClick={() => {
                captureZoomAnchor();
                setZoom(1.0);
              }}
              aria-label="بازگشت زوم به ۱۰۰ درصد"
              title="بازنشانی بزرگ‌نمایی به ۱۰۰٪"
            >
              <span>{fa(shownZoomPct)}٪</span>
            </button>
          )}

          <div className="reader__canvas" ref={scrollRef}>
            <div className="reader__scroll-track" ref={trackRef}>
              {manifest.page_dimensions.map((dim) => {
                const targetW = Math.floor(baseWidth * zoom);
                const targetH = Math.floor(targetW / (dim.aspect_ratio || 0.7071));
                const group = insertsByAfter.get(dim.page) ?? [];

                return (
                  <Fragment key={dim.page}>
                  <VirtualPageContainer
                    onActivate={() => setInkFocus(dim.page)}
                    page={dim.page}
                    width={targetW}
                    height={targetH}
                    url={dim.url}
                    isNearViewport={nearPages.has(dim.page)}
                    onUrlRejected={freshPageUrl}
                    scope={scope}
                    id={id}
                    tool={tool}
                    color={color}
                    strokeWidth={strokeWidth}
                    invertContrast={invertContrast}
                    notes={pageNotes.get(dim.page) || []}
                    onUpdateNotes={handleUpdatePageNotes}
                    onNotesLoaded={handleNotesLoaded}
                    isCurrent={dim.page === currentPage}
                    onRegisterRef={(el) => {
                      if (el) pageRefs.current.set(dim.page, el);
                      else pageRefs.current.delete(dim.page);
                    }}
                    onRegisterInkApi={(api) => {
                      if (api) inkApis.current.set(dim.page, api);
                      else inkApis.current.delete(dim.page);
                    }}
                    onInkStatus={setStatus}
                    onInkCount={setInkCount}
                    onInkHistory={setHistory}
                    onInkChanged={handleInkChanged}
                    eraserMode={eraserMode}
                    eraseHighlighterOnly={eraseHighlighterOnly}
                    shapeSnap={shapeSnap}
                    stylusOnly={stylusOnly}
                    onPenDetected={handlePenDetected}
                    textContent={textContents.get(dim.page) || null}
                    viewport={dim}
                    searchQuery={searchQuery}
                    searchMatches={searchMatches}
                    onTextSelection={handleTextSelection}
                    onAnchorAnnotation={handleAnchorAnnotation}
                    enableTextSelection={true}
                    onPageLoaded={handlePageLoaded}
                  />
                  <PageInserter
                    label={`افزودن صفحه بعد از صفحهٔ ${fa(dim.page)}`}
                    onInsert={() => setInsertPicker({ after: dim.page })}
                  />
                  {group.map((entry) => (
                    <Fragment key={entry.id}>
                      <InsertedPageView
                        scope={scope}
                        id={id}
                        entry={entry}
                        afterLabel={`صفحهٔ افزوده · پس از ${fa(dim.page)}`}
                        width={targetW}
                        height={targetH}
                        tool={tool}
                        color={color}
                        strokeWidth={strokeWidth}
                        eraserMode={eraserMode}
                        eraseHighlighterOnly={eraseHighlighterOnly}
                        shapeSnap={shapeSnap}
                        stylusOnly={stylusOnly}
                        onPenDetected={handlePenDetected}
                        invertContrast={invertContrast}
                        isNew={entry.id === newInsertId}
                        onRegisterInkApi={(api) => {
                          if (api) inkApis.current.set(-entry.slot, api);
                          else inkApis.current.delete(-entry.slot);
                        }}
                        onInkStatus={setStatus}
                        onInkCount={setInkCount}
                        onInkHistory={setHistory}
                        onInkChanged={handleInkChanged}
                        onActivate={() => setInkFocus(-entry.slot)}
                        onChangeTemplate={() =>
                          setInsertPicker({ after: entry.after, editId: entry.id, current: entry.template })
                        }
                        onDelete={() => handleDeleteInsert(entry)}
                      />
                      <PageInserter
                        label="افزودن صفحه بعد از این صفحه"
                        onInsert={() => setInsertPicker({ after: entry.after, afterId: entry.id })}
                      />
                    </Fragment>
                  ))}
                  </Fragment>
                );
              })}
            </div>
          </div>

          <NotebookPanel
            scope={scope}
            id={id}
            page={currentPage}
            open={notebookOpen}
            onClose={() => setNotebookOpen(false)}
            onJump={(p) => {
              scrollToPage(p);
              if (window.innerWidth < 900) setNotebookOpen(false);
            }}
            refreshKey={notebookKey}
          />
        </div>
      )}

      {!loading && !error && manifest && !focusMode && (
        <InkToolbar
          tool={tool}
          setTool={setTool}
          color={color}
          setColor={setColor}
          strokeWidth={strokeWidth}
          setStrokeWidth={setStrokeWidth}
          undo={() => activeInkApi?.undo()}
          redo={() => activeInkApi?.redo()}
          clear={() => activeInkApi?.clear()}
          count={inkCount}
          status={status}
          canUndo={history.undo > 0}
          canRedo={history.redo > 0}
          onOpenNotebook={() => setNotebookOpen((v) => !v)}
          onAddStickyNote={handleAddStickyNote}
          onToggleFocus={() => setFocusMode(true)}
          onOpenThumbnails={() => setOverviewOpen(true)}
          onToggleInvert={() => setInvertContrast((v) => !v)}
          inverted={invertContrast}
          eraserMode={eraserMode}
          setEraserMode={setEraserMode}
          eraseHighlighterOnly={eraseHighlighterOnly}
          setEraseHighlighterOnly={setEraseHighlighterOnly}
          shapeSnap={shapeSnap}
          setShapeSnap={setShapeSnap}
          stylusOnly={stylusOnly}
          setStylusOnly={setStylusOnly}
          currentPage={currentPage}
          totalPages={manifest.total_pages}
          onPrevPage={() => scrollToPage(Math.max(1, currentPage - 1))}
          onNextPage={() => scrollToPage(Math.min(manifest.total_pages, currentPage + 1))}
          onToggleAi={onToggleSplitWorkspace}
          isAiOpen={isAiOpen}
        />
      )}

      {focusMode && manifest && (
        <>
          <div className="focus-counter-badge num">
            صفحه {fa(currentPage)} از {fa(manifest.total_pages)}
          </div>
          <button
            type="button"
            className="focus-restore-trigger"
            onClick={() => setFocusMode(false)}
            aria-label="خروج از حالت تمرکز"
            title="خروج از حالت تمرکز (Esc)"
          >
            <Icon name="i-x" size={16} />
          </button>
        </>
      )}

      <PageOverview
        open={overviewOpen}
        onClose={() => setOverviewOpen(false)}
        manifest={manifest}
        currentPage={currentPage}
        onJump={(p) => scrollToPage(p, true)}
        scope={scope}
        id={id}
        bookmarkedPages={bookmarkedPages}
        onToggleBookmark={handleToggleBookmark}
        targetRect={() => scrollRef.current?.getBoundingClientRect() ?? null}
        onInsertPage={() => {
          setOverviewOpen(false);
          setInsertPicker({ after: currentPage });
        }}
      />

      <PageTemplatePicker
        open={insertPicker !== null}
        title={
          insertPicker?.editId
            ? 'قالب این صفحه'
            : `صفحهٔ تازه بعد از صفحهٔ ${fa(insertPicker?.after ?? currentPage)}`
        }
        current={insertPicker?.current}
        onPick={handlePickTemplate}
        onClose={() => setInsertPicker(null)}
      />

      <ThumbnailDrawer
        open={thumbnailDrawerOpen}
        onClose={() => setThumbnailDrawerOpen(false)}
        manifest={manifest}
        currentPage={currentPage}
        onJump={(p) => scrollToPage(p)}
        scope={scope}
        id={id}
        bookmarkedPages={bookmarkedPages}
        onToggleBookmark={handleToggleBookmark}
      />
    </div>
  );
}

interface VirtualPageContainerProps {
  page: number;
  width: number;
  height: number;
  url: string;
  isNearViewport: boolean;
  onUrlRejected?: (page: number) => Promise<string | null>;
  scope: Scope;
  id: string;
  tool: ReaderTool;
  color: string;
  strokeWidth: number;
  invertContrast: boolean;
  notes: StickyNote[];
  onUpdateNotes: (page: number, notes: StickyNote[]) => void;
  onNotesLoaded: (page: number, notes: StickyNote[]) => void;
  isCurrent: boolean;
  onRegisterRef: (el: HTMLDivElement | null) => void;
  onRegisterInkApi: (api: InkApi | null) => void;
  onInkStatus: (status: InkStatus) => void;
  onInkCount: (n: number) => void;
  onInkHistory: (h: { undo: number; redo: number }) => void;
  onInkChanged: () => void;
  eraserMode?: 'stroke' | 'partial';
  eraseHighlighterOnly?: boolean;
  shapeSnap?: boolean;
  stylusOnly?: boolean;
  onPenDetected?: () => void;
  textContent?: any;
  viewport?: any;
  searchQuery?: string;
  searchMatches?: number[];
  onTextSelection?: (text: string, rects: DOMRect[]) => void;
  onAnchorAnnotation?: (pageX: number, pageY: number, text: string) => void;
  enableTextSelection?: boolean;
  textLayerRef?: React.RefObject<any>;
  onPageLoaded?: () => void;
  /** Pen/finger touched this page: undo/redo should act on it. */
  onActivate?: () => void;
}

function VirtualPageContainer({
  page,
  width,
  height,
  url,
  isNearViewport,
  onUrlRejected,
  scope,
  id,
  tool,
  color,
  strokeWidth,
  invertContrast,
  notes,
  onUpdateNotes,
  onNotesLoaded,
  isCurrent,
  onRegisterRef,
  onRegisterInkApi,
  onInkStatus,
  onInkCount,
  onInkHistory,
  onInkChanged,
  eraserMode = 'stroke',
  eraseHighlighterOnly = false,
  shapeSnap = false,
  stylusOnly = false,
  onPenDetected,
  textContent,
  viewport,
  searchQuery,
  searchMatches,
  onTextSelection,
  onAnchorAnnotation,
  enableTextSelection = true,
  textLayerRef,
  onPageLoaded,
  onActivate,
}: VirtualPageContainerProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const textLayerRefInternal = useRef<any>(null);

  const initialCached = getCachedPageUrl(scope, id, page);
  const [src, setSrc] = useState<string>(initialCached || '');
  const [imgLoaded, setImgLoaded] = useState<boolean>(Boolean(initialCached));
  const [failed, setFailed] = useState(false);

  const latestUrlRef = useRef(url);
  latestUrlRef.current = url;
  const onUrlRejectedRef = useRef(onUrlRejected);
  onUrlRejectedRef.current = onUrlRejected;
  const onPageLoadedRef = useRef(onPageLoaded);
  onPageLoadedRef.current = onPageLoaded;

  // هر بار صفحه نزدیک ویوپورت است، از کش RAM می‌خوانیم؛ در صورت نبود، فقط یکبار دانلود می‌شود
  useEffect(() => {
    if (!isNearViewport) return;

    const cached = getCachedPageUrl(scope, id, page);
    if (cached) {
      setSrc(cached);
      setImgLoaded(true);
      setFailed(false);
      return;
    }

    let cancelled = false;
    setFailed(false);

    void acquirePageUrl(
      scope,
      id,
      page,
      latestUrlRef.current,
      onUrlRejectedRef.current ? () => onUrlRejectedRef.current!(page) : undefined,
    )
      .then((objUrl) => {
        if (cancelled) return;
        setSrc(objUrl);
        setImgLoaded(true);
        setFailed(false);
        onPageLoadedRef.current?.();
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [isNearViewport, scope, id, page]);

  const retryLoad = useCallback(() => {
    invalidatePageCache(scope, id, page);
    setFailed(false);
    setImgLoaded(false);
    void acquirePageUrl(
      scope,
      id,
      page,
      latestUrlRef.current,
      onUrlRejectedRef.current ? () => onUrlRejectedRef.current!(page) : undefined,
    )
      .then((objUrl) => {
        setSrc(objUrl);
        setImgLoaded(true);
        onPageLoadedRef.current?.();
      })
      .catch(() => {
        setFailed(true);
      });
  }, [scope, id, page]);

  // اینترنت برگشت ⇒ صفحهٔ ناموفق خودکار دوباره
  useEffect(() => {
    if (!failed) return;
    const on = () => retryLoad();
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, [failed, retryLoad]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    onRegisterRef(el);
    return () => {
      onRegisterRef(null);
    };
  }, [onRegisterRef]);

  useEffect(() => {
    if (textLayerRef && textLayerRefInternal.current) {
      (textLayerRef as any).current = textLayerRefInternal.current;
    }
  }, [textLayerRef]);

  const handleNotesChange = useCallback(
    (updated: StickyNote[]) => onUpdateNotes(page, updated),
    [onUpdateNotes, page],
  );

  return (
    <div
      ref={(el) => {
        ref.current = el;
        if (el) {
          el.style.setProperty('--page-w', `${width}px`);
          el.style.setProperty('--page-h', `${height}px`);
        }
      }}
      data-page={page}
      onPointerDownCapture={onActivate}
      className={`pdf-page${isCurrent ? ' is-active' : ''}${invertContrast ? ' is-inverted' : ''}`}
    >
      {isNearViewport ? (
        <>
          {failed ? (
            <div className="page-placeholder">
              <span>صفحهٔ {fa(page)} بارگذاری نشد</span>
              <DsButton variant="secondary" size="sm" onClick={retryLoad}>
                تلاش دوباره
              </DsButton>
            </div>
          ) : src ? (
            <img
              src={src}
              alt={`صفحهٔ ${fa(page)}`}
              className={`pdf-page__img reader__page${imgLoaded ? ' is-loaded' : ''}${invertContrast ? ' reader__page--inverted' : ''}`}
              decoding="async"
              draggable={false}
              onLoad={() => {
                setImgLoaded(true);
                onPageLoadedRef.current?.();
              }}
              onError={retryLoad}
            />
          ) : (
            <div className="page-placeholder" aria-busy="true">
              <DsSkeleton className="page-placeholder__skel" />
              <span className="num">صفحهٔ {fa(page)}</span>
            </div>
          )}

          {textContent && viewport && (
            <TextLayer
              ref={textLayerRefInternal}
              pageNumber={page}
              viewport={viewport}
              textContent={textContent}
              searchQuery={searchQuery}
              searchMatches={searchMatches}
              onSelectionChange={onTextSelection}
              onAnchorAnnotation={onAnchorAnnotation}
              // While an ink tool is active the text layer (z-index 10) sits above
              // the ink canvas; leaving it selectable lets Apple Pencil strokes
              // start a native text selection instead of drawing.
              enableSelection={enableTextSelection && !tool}
              className="virtual-page__text-layer"
              renderScale={1}
            />
          )}

          <StickyNoteOverlay
            page={page}
            width={width}
            height={height}
            notes={notes}
            onUpdateNotes={handleNotesChange}
          />

          <InkLayer
            ref={onRegisterInkApi}
            scope={scope}
            id={id}
            page={page}
            width={width}
            height={height}
            tool={tool}
            color={color}
            strokeWidth={strokeWidth}
            onCount={onInkCount}
            onHistory={onInkHistory}
            onStatus={onInkStatus}
            onChanged={onInkChanged}
            onNotesLoaded={onNotesLoaded}
            eraserMode={eraserMode}
            eraseHighlighterOnly={eraseHighlighterOnly}
            shapeSnap={shapeSnap}
            stylusOnly={stylusOnly}
            onPenDetected={onPenDetected}
          />
        </>
      ) : (
        <div className="page-placeholder" aria-busy="true">
          <DsSkeleton className="page-placeholder__skel" />
          <span className="num">صفحهٔ {fa(page)}</span>
        </div>
      )}
    </div>
  );
}
