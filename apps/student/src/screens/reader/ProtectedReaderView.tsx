import { isPenBusy, PALM_CONTACT_PX } from './penInput';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { DsButton, DsEmpty, DsSkeleton } from '../../design/components';
import { Icon } from '../../icons';
import { apiCall } from '../../lib/api';
import { enDigits } from '../../lib/fa';
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
import { pushRecentColor } from './CustomColorPicker';
import { NotebookPanel } from './NotebookPanel';
import { MindMapPanel } from './MindMapPanel';
import { MindMapPageLayer, newMindNode } from './MindMapPageLayer';
import {
  loadMindNodes,
  saveMindNodes,
  useNotebookIndex,
  type MindNodeRec,
} from './notebookData';
import { StickyNoteOverlay } from './StickyNoteOverlay';
import { ThumbnailDrawer } from './ThumbnailDrawer';
import { PageOverview } from './PageOverview';
import { InsertedPageView, PageInserter, PageTemplatePicker } from './InsertedPage';
import { voiceNotes, type VoiceNote } from '../../lib/voiceNotes';
import {
  VoicePageLayer,
  seedVoiceAudio,
  shareVoiceAudio,
  useVoiceRecorder,
  voiceRecordingSupported,
  type VoiceNoteView,
} from './VoiceNotes';
import { TextLayer } from './components/TextLayer';
import {
  acquirePageUrl,
  getCachedInkPage,
  getCachedPageUrl,
  invalidatePageCache,
  prefetchPageUrl,
  prefetchThumbUrl,
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
  jumpRequest?: { page: number; seq: number; x?: number; y?: number } | null;
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
  /** تایمرهای debounce ذخیرهٔ یادداشت‌ها per page */
  const noteSaveTimersRef = useRef<Map<number, number>>(new Map());
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
  const [mindMapOpen, setMindMapOpen] = useState(false);
  const [notebookKey, setNotebookKey] = useState(0);
  /** فلش نقطهٔ مقصد — از دفتر/ویس که روی آیتمی کلیک می‌شود، مکان دقیقش روی صفحه می‌درخشد */
  const [flashSpot, setFlashSpot] = useState<{ page: number; x: number; y: number; seq: number } | null>(null);

  // نقشهٔ ذهنی روی خود صفحه — XMind روی جزوه
  const [mindOnPage, setMindOnPage] = useState(false);
  const [mindNodes, setMindNodes] = useState<MindNodeRec[]>([]);
  const [mindSelected, setMindSelected] = useState<string | null>(null);
  const [mindEditing, setMindEditing] = useState<string | null>(null);
  const notebookIndex = useNotebookIndex(scope, id, mindOnPage, notebookKey);

  const persistMindNodes = useCallback(
    (next: MindNodeRec[]) => {
      setMindNodes(next);
      saveMindNodes(scope, id, next);
    },
    [scope, id],
  );

  const handleToggleMindOverlay = useCallback(() => {
    setMindOnPage((v) => {
      const next = !v;
      if (next) {
        // حالت نقشه جای قلم را می‌گیرد: ضربه به صفحه = ساخت شاخه، نه خط کشیدن
        setTool(null);
        setMindNodes(loadMindNodes(scope, id));
      } else {
        setMindSelected(null);
        setMindEditing(null);
      }
      return next;
    });
  }, [scope, id]);

  const handleAddMindChild = useCallback(
    (parentId: string, parentX: number, parentY: number, page: number) => {
      const rec = newMindNode(parentId, page, parentX + 0.02, parentY + 0.08);
      setMindNodes((prev) => {
        const next = [...prev, rec];
        saveMindNodes(scope, id, next);
        return next;
      });
      setMindSelected(`man:${rec.id}`);
      setMindEditing(`man:${rec.id}`);
    },
    [scope, id],
  );

  const handleAddMindFree = useCallback(
    (page: number, x: number, y: number) => {
      handleAddMindChild('root', x - 0.02, y - 0.08, page);
    },
    [handleAddMindChild],
  );

  const handleMoveMindNode = useCallback(
    (manId: string, x: number, y: number) => {
      persistMindNodes(mindNodes.map((n) => (n.id === manId ? { ...n, x, y } : n)));
    },
    [mindNodes, persistMindNodes],
  );

  const handleCommitMindEdit = useCallback(
    (manId: string, text: string) => {
      persistMindNodes(mindNodes.map((n) => (n.id === manId ? { ...n, text: text.trim() } : n)));
      setMindEditing(null);
    },
    [mindNodes, persistMindNodes],
  );

  const handleDeleteMindNode = useCallback(
    (manId: string) => {
      const doomed = new Set<string>([manId]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const m of mindNodes) {
          if (doomed.has(m.id)) continue;
          if (doomed.has(m.parent) || doomed.has(m.parent.replace(/^man:/, ''))) {
            doomed.add(m.id);
            grew = true;
          }
        }
      }
      persistMindNodes(mindNodes.filter((m) => !doomed.has(m.id)));
      setMindSelected(null);
      setMindEditing(null);
    },
    [mindNodes, persistMindNodes],
  );

  /** لایهٔ نقشهٔ روی صفحه — فقط برای صفحات اصلی جزوه (صفحات افزوده فعلاً بدون نقشه) */
  const renderMind = (page: number, w: number, h: number) => {
    if (!mindOnPage) return null;
    const items = notebookIndex.items.filter((it) => !it.inserted && it.page === page);
    const nodes = mindNodes.filter((n) => n.page === page);
    return (
      <MindMapPageLayer
        width={w}
        height={h}
        active={mindOnPage}
        items={items}
        nodes={nodes}
        selectedId={mindSelected}
        editingId={mindEditing}
        onSelect={setMindSelected}
        onStartEdit={(id) => {
          setMindSelected(id);
          setMindEditing(id);
        }}
        onCommitEdit={(manChipId, text) => handleCommitMindEdit(manChipId.slice(4), text)}
        onAddChild={(parentId, px, py) => handleAddMindChild(parentId, px, py, page)}
        onAddFree={(x, y) => handleAddMindFree(page, x, y)}
        onMove={(manChipId, x, y) => handleMoveMindNode(manChipId.slice(4), x, y)}
        onDelete={(manChipId) => handleDeleteMindNode(manChipId.slice(4))}
        onJumpItem={(it) => {
          scrollToPage(it.page);
          if (it.at) setFlashSpot({ page: it.page, x: it.at.x, y: it.at.y, seq: Date.now() });
        }}
      />
    );
  };

  // شمارندهٔ شناور صفحه (پایین-چپ) + پرش سریع + رفع تداخل با نوار ابزار و کیبورد
  const [pagePillActive, setPagePillActive] = useState(true);
  const [pageJumpOpen, setPageJumpOpen] = useState(false);
  const [pageJumpText, setPageJumpText] = useState('');
  const [toolbarBottomClearance, setToolbarBottomClearance] = useState(0);
  const [toolbarSideClearance, setToolbarSideClearance] = useState(0);
  const [keyboardLift, setKeyboardLift] = useState(0);
  const [eyedropperActive, setEyedropperActive] = useState(false);
  const pagePillWrapRef = useRef<HTMLDivElement | null>(null);
  const pageJumpInputRef = useRef<HTMLInputElement | null>(null);
  const pagePillTimerRef = useRef<number | null>(null);
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;

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

  const wakePagePill = useCallback(() => {
    setPagePillActive(true);
    if (pagePillTimerRef.current) window.clearTimeout(pagePillTimerRef.current);
    pagePillTimerRef.current = window.setTimeout(() => {
      setPagePillActive(false);
    }, 2200);
  }, []);

  useEffect(() => {
    wakePagePill();
    return () => {
      if (pagePillTimerRef.current) window.clearTimeout(pagePillTimerRef.current);
    };
  }, [currentPage, wakePagePill]);

  // Keep page pill clear of on-screen soft keyboard on mobile/iPad
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    const syncVv = () => {
      const lift = Math.max(0, Math.round(window.innerHeight - (vv.offsetTop + vv.height)));
      setKeyboardLift(lift > 60 ? lift : 0);
    };
    syncVv();
    vv.addEventListener('resize', syncVv);
    vv.addEventListener('scroll', syncVv);
    return () => {
      vv.removeEventListener('resize', syncVv);
      vv.removeEventListener('scroll', syncVv);
    };
  }, []);

  // Close jump popover when clicking outside or pressing Escape
  useEffect(() => {
    if (!pageJumpOpen) return;
    const raf = window.requestAnimationFrame(() => pageJumpInputRef.current?.focus());
    const onDocDown = (e: PointerEvent) => {
      if (pagePillWrapRef.current && !pagePillWrapRef.current.contains(e.target as Node)) {
        setPageJumpOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setPageJumpOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDocDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.cancelAnimationFrame(raf);
      document.removeEventListener('pointerdown', onDocDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [pageJumpOpen]);

  // Cancel eyedropper overlay on Escape
  useEffect(() => {
    if (!eyedropperActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setEyedropperActive(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [eyedropperActive]);

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

  /** آدرس تازهٔ پیش‌نمایش برای بندانگشتی‌ها هنگام انقضای توکن. */
  const freshThumbUrl = useCallback(
    async (page: number): Promise<string | null> => {
      const data = await silentRefresh();
      const dim = data?.page_dimensions.find((d) => d.page === page);
      return dim?.thumbnail_url || dim?.url || null;
    },
    [silentRefresh],
  );

  // پیش‌بارگذاری آرام صفحات همسایه (+1، +2، +3، -1) داخل کش RAM
  const prefetchedUrlsRef = useRef<Set<string>>(new Set());
  const prefetchedThumbsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    prefetchedUrlsRef.current.clear();
    prefetchedThumbsRef.current.clear();
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

  // پیش‌ساخت و کش هوشمند پیش‌نمایش صفحات در زمان بیکاری مرورگر (requestIdleCallback)
  useEffect(() => {
    if (!manifest || !manifest.page_dimensions?.length) return;
    const conn =
      typeof navigator !== 'undefined'
        ? (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
        : undefined;
    if (conn?.saveData || /(^|-)(2g)$/.test(conn?.effectiveType ?? '')) return;

    let cancelled = false;
    const total = manifest.total_pages;
    const dimsByPage = new Map(manifest.page_dimensions.map((d) => [d.page, d]));
    const center = Math.max(1, Math.min(total, currentPageRef.current));
    const order: number[] = [center];
    for (let offset = 1; offset < total; offset++) {
      if (center + offset <= total) order.push(center + offset);
      if (center - offset >= 1) order.push(center - offset);
    }

    const warmBatchLimit = Math.min(order.length, 36);
    let cursor = 0;
    let idleId = 0;
    let timerId = 0;

    const ric = (window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    }).requestIdleCallback;
    const cancelRic = (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;

    const step = () => {
      if (cancelled || cursor >= warmBatchLimit) return;
      const batchEnd = Math.min(warmBatchLimit, cursor + 4);
      while (cursor < batchEnd) {
        const p = order[cursor++];
        const dim = dimsByPage.get(p);
        const thumbUrl = dim?.thumbnail_url || dim?.url;
        if (dim && thumbUrl && !prefetchedThumbsRef.current.has(thumbUrl)) {
          prefetchedThumbsRef.current.add(thumbUrl);
          prefetchThumbUrl(scope, id, p, thumbUrl, () => freshThumbUrl(p), dim.url);
        }
      }
      if (cursor < warmBatchLimit) {
        if (ric) idleId = ric(step, { timeout: 1500 });
        else timerId = window.setTimeout(step, 260);
      }
    };

    timerId = window.setTimeout(() => {
      if (ric) idleId = ric(step, { timeout: 1500 });
      else step();
    }, 550);

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
      if (idleId && cancelRic) cancelRic(idleId);
    };
  }, [manifest, scope, id, freshThumbUrl]);

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

  // ناظر متمرکز پنجره‌بندی (۱ ناظر برای کل سند) + تشخیص دقیق صفحهٔ فعلی با IntersectionObserver
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !manifest) return;

    const nearObs = new IntersectionObserver(
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

    const visibleArea = new Map<number, number>();
    const activeObs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const pageNum = Number((entry.target as HTMLElement).dataset.page || 0);
          if (!pageNum) continue;
          if (entry.isIntersecting && entry.intersectionRect.height > 0) {
            visibleArea.set(pageNum, entry.intersectionRect.height * entry.intersectionRect.width);
          } else {
            visibleArea.delete(pageNum);
          }
        }
        if (isZoomingRef.current || visibleArea.size === 0) return;
        let bestPage = currentPageRef.current;
        let bestArea = -1;
        for (const [p, area] of visibleArea.entries()) {
          if (area > bestArea) {
            bestArea = area;
            bestPage = p;
          }
        }
        if (bestPage !== currentPageRef.current) {
          currentPageRef.current = bestPage;
          setCurrentPage(bestPage);
          progressRef.current(bestPage, totalPagesRef.current);
        }
      },
      { root: scroller, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1.0] },
    );

    for (const el of pageRefs.current.values()) {
      nearObs.observe(el);
      activeObs.observe(el);
    }

    const onScroll = () => {
      wakePagePill();
    };

    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      nearObs.disconnect();
      activeObs.disconnect();
      scroller.removeEventListener('scroll', onScroll);
    };
  }, [manifest, wakePagePill]);

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

  // پرش بدون رفرش صفحه از پنل دفترچه یا والد — با مکان دقیق اگر همراهش باشد
  useEffect(() => {
    if (!jumpRequest || !manifest) return;
    scrollToPage(jumpRequest.page);
    if (typeof jumpRequest.x === 'number' && typeof jumpRequest.y === 'number') {
      setFlashSpot({ page: jumpRequest.page, x: jumpRequest.x, y: jumpRequest.y, seq: jumpRequest.seq });
    }
  }, [jumpRequest, manifest, scrollToPage]);

  // فلش بعد از چند ثانیه خودش خاموش می‌شود
  useEffect(() => {
    if (!flashSpot) return;
    const t = window.setTimeout(() => setFlashSpot(null), 2600);
    return () => window.clearTimeout(t);
  }, [flashSpot]);

  /** حلقهٔ پالس روی نقطهٔ مقصد پرش (هایلایت/ویس/یادداشت) */
  const renderFlash = (page: number) => {
    if (!flashSpot || flashSpot.page !== page) return null;
    return (
      <div
        key={flashSpot.seq}
        className="reader-spot-flash"
        style={{ left: `${flashSpot.x * 100}%`, top: `${flashSpot.y * 100}%` }}
        aria-hidden="true"
      />
    );
  };

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

  // افزودن یادداشت چسبان به صفحهٔ جاری — جای spawn داخل محدودهٔ clamp تا
  // هیچ‌وقت لبهٔ صفحه کلیپ نشود (clamp درگ وابسته به عرض واقعی یادداشت است)
  const handleAddStickyNote = useCallback(() => {
    // صفحهٔ هدف: برای صفحات عادی «صفحهٔ دیدنی فعلی»؛ فقط برای صفحات افزوده
    // (کلید منفی) فوکوسِ تپ‌شده ملاک است تا inkFocus کهنه یادداشت را جابه‌جا نکند
    const focus = inkFocusRef.current;
    const target = focus != null && focus < 0 ? focus : currentPage;
    const isInsert = target < 0;
    const docId = isInsert ? insertedInkId(id) : id;
    const inkPage = isInsert ? -target : target;
    const currentList = pageNotes.get(target) || [];
    const newNote: StickyNote = {
      note_id: generateUUID(),
      page: target,
      x: 0.5,
      y: 0.12,
      text: '',
      color: 'yellow',
      collapsed: false,
      created_at: new Date().toISOString(),
    };
    const nextList = [...currentList, newNote];
    const nextMap = new Map(pageNotes);
    nextMap.set(target, nextList);
    setPageNotes(nextMap);
    const cachedInk = getCachedInkPage(scope, docId, inkPage);
    if (cachedInk) setCachedInkPage(scope, docId, inkPage, { ...cachedInk, notes: nextList });
    void ink.save(scope, docId, inkPage, undefined, nextList);
  }, [pageNotes, currentPage, scope, id]);

  const handleUpdatePageNotes = useCallback(
    (page: number, updatedNotes: StickyNote[]) => {
      setPageNotes((prev) => {
        const nextMap = new Map(prev);
        nextMap.set(page, updatedNotes);
        return nextMap;
      });
      // کلید منفی = صفحهٔ افزوده: جوهرش زیر سند insertedInkId با slot مثبت ذخیره می‌شود
      const isInsert = page < 0;
      const docId = isInsert ? insertedInkId(id) : id;
      const inkPage = isInsert ? -page : page;
      const cachedInk = getCachedInkPage(scope, docId, inkPage);
      if (cachedInk) setCachedInkPage(scope, docId, inkPage, { ...cachedInk, notes: updatedNotes });
      // ذخیرهٔ debounce‌شده: هر ضربهٔ کلید نباید IndexedDB + POST بسازد
      const timers = noteSaveTimersRef.current;
      const prevTimer = timers.get(page);
      if (prevTimer !== undefined) window.clearTimeout(prevTimer);
      timers.set(
        page,
        window.setTimeout(() => {
          timers.delete(page);
          void ink.save(scope, docId, inkPage, undefined, updatedNotes);
        }, 600),
      );
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

  // ── Voice notes pinned to a spot on a page (Noteful-style) ──
  const recorder = useVoiceRecorder();
  const [voiceList, setVoiceList] = useState<VoiceNoteView[]>([]);
  const voiceListRef = useRef(voiceList);
  voiceListRef.current = voiceList;
  const [voiceArmed, setVoiceArmed] = useState(false);
  const [recordingAt, setRecordingAt] = useState<{ fileId: string; page: number; x: number; y: number } | null>(
    null,
  );
  const recordingAtRef = useRef(recordingAt);
  recordingAtRef.current = recordingAt;
  const [voiceMsg, setVoiceMsg] = useState<string | null>(null);
  const voiceMsgTimer = useRef<number | undefined>(undefined);

  const flashVoice = useCallback((msg: string) => {
    setVoiceMsg(msg);
    if (voiceMsgTimer.current) window.clearTimeout(voiceMsgTimer.current);
    voiceMsgTimer.current = window.setTimeout(() => setVoiceMsg(null), 3600);
  }, []);

  useEffect(() => () => window.clearTimeout(voiceMsgTimer.current), []);

  useEffect(() => {
    let cancelled = false;
    setVoiceList([]);
    void Promise.all([
      voiceNotes.list(scope, id).catch(() => [] as VoiceNote[]),
      voiceNotes.list(scope, insertedInkId(id)).catch(() => [] as VoiceNote[]),
    ]).then(([a, b]) => {
      if (!cancelled) setVoiceList([...a, ...b]);
    });
    return () => {
      cancelled = true;
    };
  }, [scope, id]);

  useEffect(() => {
    if (!voiceArmed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setVoiceArmed(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [voiceArmed]);

  const voiceByPage = useMemo(() => {
    const m = new Map<string, VoiceNoteView[]>();
    for (const n of voiceList) {
      const k = `${n.file_id}|${n.page}`;
      const g = m.get(k);
      if (g) g.push(n);
      else m.set(k, [n]);
    }
    return m;
  }, [voiceList]);

  const toggleVoiceArm = useCallback(() => {
    if (recordingAtRef.current) return;
    if (!voiceRecordingSupported()) {
      flashVoice(
        window.isSecureContext
          ? 'این مرورگر ضبط صدا را پشتیبانی نمی‌کند.'
          : 'ضبط صدا فقط روی اتصال امن (https) کار می‌کند.',
      );
      return;
    }
    setVoiceArmed((v) => !v);
  }, []);

  const handlePlaceVoice = (fileId: string, page: number, x: number, y: number) => {
    setVoiceArmed(false);
    setRecordingAt({ fileId, page, x, y });
    recorder.start().catch((err: unknown) => {
      setRecordingAt(null);
      const name = (err as { name?: string } | null)?.name;
      flashVoice(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'اجازهٔ میکروفون داده نشد؛ از تنظیمات مرورگر اجازه بده.'
          : 'میکروفون در دسترس نیست.',
      );
    });
  };

  const uploadVoice = (localId: string, note: VoiceNoteView, blob: Blob) => {
    setVoiceList((l) => l.map((n) => (n.voice_id === localId ? { ...n, local: { blob, status: 'uploading' } } : n)));
    voiceNotes
      .upload(scope, note.file_id, note.page, note.x, note.y, note.duration_ms, blob)
      .then((item) => {
        shareVoiceAudio(localId, item.voice_id);
        const cur = voiceListRef.current.find((n) => n.voice_id === localId);
        const x = cur?.x ?? item.x;
        const y = cur?.y ?? item.y;
        // Moved while it was uploading: send the new spot now that it has a server id.
        if (x !== item.x || y !== item.y) void voiceNotes.move(item.voice_id, x, y).catch(() => undefined);
        setVoiceList((l) => l.map((n) => (n.voice_id === localId ? { ...item, x, y } : n)));
      })
      .catch(() => {
        setVoiceList((l) => l.map((n) => (n.voice_id === localId ? { ...n, local: { blob, status: 'failed' } } : n)));
        flashVoice('صدا ذخیره نشد؛ روی نشانش بزن تا دوباره ارسال شود.');
      });
  };

  const handleStopVoice = () => {
    const at = recordingAtRef.current;
    void recorder.stop().then((res) => {
      setRecordingAt(null);
      if (!res || !at) return;
      if (res.durationMs < 700) {
        flashVoice('ضبط خیلی کوتاه بود.');
        return;
      }
      const localId = `local${generateUUID().replace(/-/g, '')}`;
      seedVoiceAudio(localId, res.blob);
      const entry: VoiceNoteView = {
        voice_id: localId,
        file_id: at.fileId,
        page: at.page,
        x: at.x,
        y: at.y,
        duration_ms: res.durationMs,
        mime: res.blob.type || 'audio/webm',
        created_at: new Date().toISOString(),
        local: { blob: res.blob, status: 'uploading' },
      };
      setVoiceList((l) => [...l, entry]);
      uploadVoice(localId, entry, res.blob);
    });
  };

  const handleCancelVoice = () => {
    recorder.cancel();
    setRecordingAt(null);
  };

  const handleMoveVoice = (note: VoiceNoteView, x: number, y: number) => {
    setVoiceList((l) => l.map((n) => (n.voice_id === note.voice_id ? { ...n, x, y } : n)));
    if (!note.local) voiceNotes.move(note.voice_id, x, y).catch(() => flashVoice('جای تازهٔ صدا ذخیره نشد.'));
  };

  const handleDeleteVoice = (note: VoiceNoteView) => {
    if (!window.confirm('این یادداشت صوتی حذف شود؟')) return;
    setVoiceList((l) => l.filter((n) => n.voice_id !== note.voice_id));
    if (note.local) return;
    voiceNotes.remove(note.voice_id).catch(() => {
      setVoiceList((l) => [...l, note]);
      flashVoice('حذف انجام نشد.');
    });
  };

  const handleRetryVoice = (note: VoiceNoteView) => {
    if (note.local) uploadVoice(note.voice_id, note, note.local.blob);
  };

  const renderVoice = (fileId: string, page: number, w: number, h: number) => {
    const notes = voiceByPage.get(`${fileId}|${page}`) ?? [];
    const rec = recordingAt && recordingAt.fileId === fileId && recordingAt.page === page ? recordingAt : null;
    if (!voiceArmed && !rec && notes.length === 0) return null;
    return (
      <VoicePageLayer
        width={w}
        height={h}
        notes={notes}
        armed={voiceArmed}
        onPlace={(x, y) => handlePlaceVoice(fileId, page, x, y)}
        recording={
          rec
            ? {
                x: rec.x,
                y: rec.y,
                startedAt: recorder.startedAt,
                live: recorder.phase === 'recording',
                analyser: recorder.analyser,
                onStop: handleStopVoice,
                onCancel: handleCancelVoice,
              }
            : null
        }
        onMove={handleMoveVoice}
        onDelete={handleDeleteVoice}
        onRetry={handleRetryVoice}
      />
    );
  };

  const submitPageJump = useCallback(() => {
    const total = manifest?.total_pages || 0;
    const n = parseInt(enDigits(pageJumpText).trim(), 10);
    if (!total || !Number.isFinite(n)) return;
    const target = Math.max(1, Math.min(total, n));
    scrollToPage(target, false);
    setPageJumpOpen(false);
    setPageJumpText('');
  }, [manifest, pageJumpText, scrollToPage]);

  const handleSamplePagePixel = useCallback(
    (clientX: number, clientY: number) => {
      for (const [, pageEl] of pageRefs.current.entries()) {
        const r = pageEl.getBoundingClientRect();
        if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) continue;
        const rx = Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width)));
        const ry = Math.max(0, Math.min(1, (clientY - r.top) / Math.max(1, r.height)));
        const probe = document.createElement('canvas');
        probe.width = 1;
        probe.height = 1;
        const ctx = probe.getContext('2d');
        if (!ctx) break;
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, 1, 1);
        const img = pageEl.querySelector<HTMLImageElement>('img.pdf-page__img');
        if (img && img.complete && img.naturalWidth > 0) {
          try {
            if (invertContrast) ctx.filter = 'invert(0.92) hue-rotate(180deg) contrast(1.05)';
            ctx.drawImage(
              img,
              Math.min(img.naturalWidth - 1, Math.floor(rx * img.naturalWidth)),
              Math.min(img.naturalHeight - 1, Math.floor(ry * img.naturalHeight)),
              1,
              1,
              0,
              0,
              1,
              1,
            );
            ctx.filter = 'none';
          } catch {
            // cross-origin fallback: sample ink canvases only
          }
        }
        const hlCanvas = pageEl.querySelector<HTMLCanvasElement>('canvas.ink-canvas--highlighter');
        if (hlCanvas && hlCanvas.width > 0) {
          ctx.save();
          ctx.globalAlpha = 0.38;
          ctx.globalCompositeOperation = 'multiply';
          ctx.drawImage(
            hlCanvas,
            Math.min(hlCanvas.width - 1, Math.floor(rx * hlCanvas.width)),
            Math.min(hlCanvas.height - 1, Math.floor(ry * hlCanvas.height)),
            1,
            1,
            0,
            0,
            1,
            1,
          );
          ctx.restore();
        }
        const inkCanvas = pageEl.querySelector<HTMLCanvasElement>('canvas.ink-canvas:not(.ink-canvas--highlighter):not(.ink-canvas--scratch)');
        if (inkCanvas && inkCanvas.width > 0) {
          ctx.drawImage(
            inkCanvas,
            Math.min(inkCanvas.width - 1, Math.floor(rx * inkCanvas.width)),
            Math.min(inkCanvas.height - 1, Math.floor(ry * inkCanvas.height)),
            1,
            1,
            0,
            0,
            1,
            1,
          );
        }
        try {
          const [pr, pg, pb] = ctx.getImageData(0, 0, 1, 1).data;
          const hex = `#${[pr, pg, pb].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
          setColor(hex);
          pushRecentColor(hex);
        } catch {
          // ignore readback errors
        }
        probe.width = 0;
        probe.height = 0;
        setEyedropperActive(false);
        return;
      }
      setEyedropperActive(false);
    },
    [invertContrast],
  );

  const activeInkApi = inkApis.current.get(inkFocus ?? currentPage);
  const shownZoomPct = Math.round((gestureBadgeZoom ?? zoom) * 100);

  // Stable toolbar callbacks: InkToolbar is memoized, so undo/redo/clear (which depend on
  // the current page's ink api) read through a ref instead of being re-created each render.
  const activeInkApiRef = useRef<InkApi | null>(null);
  activeInkApiRef.current = activeInkApi ?? null;
  const handleToolbarUndo = useCallback(() => activeInkApiRef.current?.undo(), []);
  const handleToolbarRedo = useCallback(() => activeInkApiRef.current?.redo(), []);
  const handleToolbarClear = useCallback(() => activeInkApiRef.current?.clear(), []);
  const handleToolbarNotebook = useCallback(() => setNotebookOpen((v) => !v), []);
  const handleToolbarFocus = useCallback(() => setFocusMode(true), []);
  const handleToolbarThumbnails = useCallback(() => setOverviewOpen(true), []);
  const handleToolbarInvert = useCallback(() => setInvertContrast((v) => !v), []);
  const handleToolbarEyedropper = useCallback(() => setEyedropperActive((v) => !v), []);
  const handleToolbarClearance = useCallback((bottomPx: number, leftInsetPx = 0) => {
    setToolbarBottomClearance(bottomPx);
    setToolbarSideClearance(leftInsetPx);
  }, []);
  const pagePillLift = (focusMode ? 0 : toolbarBottomClearance) + keyboardLift;
  const pagePillInset = focusMode ? 0 : toolbarSideClearance;

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

          {/* شمارندهٔ شناور صفحه (پایین-چپ) هم‌خانواده با نشانگر زوم — در حالت عادی و تمام‌صفحه */}
          <div
            ref={(el) => {
              pagePillWrapRef.current = el;
              if (el) {
                el.style.setProperty('--page-pill-lift', `${pagePillLift}px`);
                el.style.setProperty('--page-pill-inset', `${pagePillInset}px`);
              }
            }}
            className={`reader-page-pill-wrap${pagePillActive || pageJumpOpen ? ' is-active' : ' is-dimmed'}`}
            onMouseEnter={() => setPagePillActive(true)}
            onMouseLeave={() => wakePagePill()}
          >
            {pageJumpOpen && (
              <form
                className="reader-page-jump"
                role="dialog"
                aria-label="پرش به صفحه"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitPageJump();
                }}
              >
                <button
                  type="button"
                  className="reader-page-jump__step"
                  disabled={currentPage <= 1}
                  aria-label="صفحهٔ قبل"
                  title="صفحهٔ قبل"
                  onClick={() => scrollToPage(Math.max(1, currentPage - 1))}
                >
                  <Icon name="i-chevron-r" size={15} />
                </button>
                <input
                  ref={pageJumpInputRef}
                  type="text"
                  inputMode="numeric"
                  enterKeyHint="go"
                  dir="ltr"
                  className="reader-page-jump__input num"
                  placeholder={fa(currentPage)}
                  aria-label="شماره صفحه"
                  value={pageJumpText}
                  onChange={(e) => setPageJumpText(e.target.value)}
                />
                <button
                  type="submit"
                  className="reader-page-jump__go"
                  disabled={!pageJumpText.trim()}
                >
                  برو
                </button>
                <button
                  type="button"
                  className="reader-page-jump__step"
                  disabled={currentPage >= manifest.total_pages}
                  aria-label="صفحهٔ بعد"
                  title="صفحهٔ بعد"
                  onClick={() => scrollToPage(Math.min(manifest.total_pages, currentPage + 1))}
                >
                  <Icon name="i-chevron" size={15} />
                </button>
              </form>
            )}

            <button
              type="button"
              className="reader-page-pill focus-counter-badge num"
              aria-label={`صفحهٔ ${fa(currentPage)} از ${fa(manifest.total_pages)} — برای پرش به صفحه بزنید`}
              aria-expanded={pageJumpOpen}
              title="پرش به صفحه"
              onClick={() => {
                setPagePillActive(true);
                setPageJumpOpen((v) => !v);
              }}
            >
              <span dir="ltr">
                {fa(currentPage)} / {fa(manifest.total_pages)}
              </span>
              <span className="sr-only" aria-live="polite">
                صفحهٔ {fa(currentPage)} از {fa(manifest.total_pages)}
              </span>
            </button>
          </div>

          {eyedropperActive && (
            <div
              className="reader-eyedropper-overlay"
              role="application"
              aria-label="نمونه‌برداری رنگ از صفحه"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleSamplePagePixel(e.clientX, e.clientY);
              }}
            />
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
                    overlay={
                      <>
                        {renderVoice(id, dim.page, targetW, targetH)}
                        {renderMind(dim.page, targetW, targetH)}
                        {renderFlash(dim.page)}
                      </>
                    }
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
                        onNotesLoaded={(loaded) => handleNotesLoaded(-entry.slot, loaded)}
                        notes={pageNotes.get(-entry.slot) || []}
                        onUpdateNotes={(next) => handleUpdatePageNotes(-entry.slot, next)}
                        onActivate={() => setInkFocus(-entry.slot)}
                        overlay={
                          <>
                            {renderVoice(insertedInkId(id), entry.slot, targetW, targetH)}
                            {renderFlash(entry.slot)}
                          </>
                        }
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
            onJump={(p, at) => {
              scrollToPage(p);
              if (at) setFlashSpot({ page: p, x: at.x, y: at.y, seq: Date.now() });
              if (window.innerWidth < 900) setNotebookOpen(false);
            }}
            refreshKey={notebookKey}
          />

          <MindMapPanel
            scope={scope}
            id={id}
            title={manifest?.title || id}
            page={currentPage}
            open={mindMapOpen}
            onClose={() => setMindMapOpen(false)}
            onJump={(p, at) => {
              scrollToPage(p);
              if (at) setFlashSpot({ page: p, x: at.x, y: at.y, seq: Date.now() });
              if (window.innerWidth < 900) setMindMapOpen(false);
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
          undo={handleToolbarUndo}
          redo={handleToolbarRedo}
          clear={handleToolbarClear}
          count={inkCount}
          status={status}
          canUndo={history.undo > 0}
          canRedo={history.redo > 0}
          onOpenNotebook={handleToolbarNotebook}
          mindOnPage={mindOnPage}
          onToggleMindOverlay={handleToggleMindOverlay}
          onAddStickyNote={handleAddStickyNote}
          onToggleFocus={handleToolbarFocus}
          onOpenThumbnails={handleToolbarThumbnails}
          onToggleInvert={handleToolbarInvert}
          inverted={invertContrast}
          eraserMode={eraserMode}
          setEraserMode={setEraserMode}
          eraseHighlighterOnly={eraseHighlighterOnly}
          setEraseHighlighterOnly={setEraseHighlighterOnly}
          shapeSnap={shapeSnap}
          setShapeSnap={setShapeSnap}
          stylusOnly={stylusOnly}
          setStylusOnly={setStylusOnly}
          onToggleAi={onToggleSplitWorkspace}
          isAiOpen={isAiOpen}
          onVoiceNote={toggleVoiceArm}
          voiceArmed={voiceArmed}
          onStartPageEyedropper={handleToolbarEyedropper}
          isEyedropperActive={eyedropperActive}
          onBottomClearanceChange={handleToolbarClearance}
        />
      )}

      {focusMode && manifest && (
        <button
          type="button"
          className="focus-restore-trigger"
          onClick={() => setFocusMode(false)}
          aria-label="خروج از حالت تمرکز"
          title="خروج از حالت تمرکز (Esc)"
        >
          <Icon name="i-x" size={16} />
        </button>
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
        onUrlRejected={freshThumbUrl}
        targetRect={() => scrollRef.current?.getBoundingClientRect() ?? null}
        onInsertPage={() => {
          setOverviewOpen(false);
          setInsertPicker({ after: currentPage });
        }}
      />

      {eyedropperActive && (
        <div className="voice-banner" role="status" aria-live="polite">
          <span className="voice-banner__dot" aria-hidden="true" />
          <span>روی هر نقطه‌ای از صفحه بزن تا رنگ آن برداشته شود</span>
          <button type="button" className="voice-banner__btn" onClick={() => setEyedropperActive(false)}>
            لغو
          </button>
        </div>
      )}

      {(voiceArmed || recordingAt || voiceMsg) && (
        <div className={`voice-banner${recordingAt ? ' is-recording' : ''}`} role="status" aria-live="polite">
          {recordingAt ? (
            <>
              <span className="voice-banner__dot" aria-hidden="true" />
              <span>{recorder.phase === 'recording' ? 'در حال ضبط صدا' : 'در حال آماده‌سازی میکروفون…'}</span>
              <button
                type="button"
                className="voice-banner__btn is-primary"
                onClick={handleStopVoice}
                disabled={recorder.phase !== 'recording'}
              >
                ذخیره
              </button>
              <button type="button" className="voice-banner__btn" onClick={handleCancelVoice}>
                لغو
              </button>
            </>
          ) : voiceArmed ? (
            <>
              <span className="voice-banner__dot" aria-hidden="true" />
              <span>روی هر جای صفحه بزن تا ضبط صدا همان‌جا شروع شود</span>
              <button type="button" className="voice-banner__btn" onClick={() => setVoiceArmed(false)}>
                لغو
              </button>
            </>
          ) : (
            <span>{voiceMsg}</span>
          )}
        </div>
      )}

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
        // پرش instant: انیمیشن zoom خودش جابه‌جایی را پوشش می‌دهد؛ smooth پس از آن
        // باعث پرش مرئی دوم می‌شد
        onJump={(p) => scrollToPage(p, true)}
        scope={scope}
        id={id}
        bookmarkedPages={bookmarkedPages}
        onToggleBookmark={handleToggleBookmark}
        onUrlRejected={freshThumbUrl}
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
  /** Extra layer over the page (voice notes). */
  overlay?: React.ReactNode;
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
  overlay,
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
            // با ابزار فعال، جوهر اولویت دارد: یادداشت رویدادها را عبور می‌دهد
            interactive={!tool}
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
            notes={notes}
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
          {overlay}
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
