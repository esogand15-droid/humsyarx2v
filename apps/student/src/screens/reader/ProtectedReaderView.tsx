import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Icon } from '../../icons';
import { apiCall } from '../../lib/api';
import { fa } from '../../lib/library';
import { bookmarks, generateUUID, ink, type Scope, type StickyNote } from '../../lib/ink';
import { InkLayer, type InkApi, type InkStatus } from './InkLayer';
import { INK_COLORS, InkToolbar, type ReaderTool } from './InkToolbar';
import { NotebookPanel } from './NotebookPanel';
import { StickyNoteOverlay } from './StickyNoteOverlay';
import { ThumbnailDrawer } from './ThumbnailDrawer';
import { TextLayer } from './components/TextLayer';

import './components/TextLayer.css';

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
  onProgress: (page: number, total: number) => void;
  onExpired?: () => Promise<string | null>;
  onToggleSplitWorkspace?: () => void;
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
 *
 * قابلیت‌ها:
 * ۱) رندر سمت سرور صفحات WebP با واترمارک پویا و بدون نشت بایت‌های خام.
 * ۲) بدون محدودیت عرض مصنوعی (آنلاک تا ۱۴۰۰ پیکسل برای بوم عریض تبلت و دسکتاپ).
 * ۳) پالت غنی شامل قلم، مداد گرافیتی، هایلایترهای پاستلی/نئون و ابزار کمند (Lasso).
 * ۴) اسلایدر پیوسته ضخامت با دایره پیش‌نمایش پویا.
 * ۵) یادداشت‌های چسبان متصل به حاشیه با قابلیت سنجاق شدن و کشیدن.
 * ۶) حالت تمرکز و بدون حواس‌پرتی (Focus Fullscreen Mode) با کلید F.
 * ۷) کشوی پیش‌نمایش صفحات و نشان‌شده‌ها (Thumbnail & Bookmark Drawer) با کلید T.
 * ۸) وارون‌ساز هوشمند کنتراست شب (Obsidian Navy Night Contrast Inverter).
 */
export function ProtectedReaderView({
  scope,
  id,
  startPage = 1,
  onProgress,
  onExpired,
  onToggleSplitWorkspace,
  isAiOpen = false,
}: ProtectedReaderViewProps) {
  const [manifest, setManifest] = useState<DocumentManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentPage, setCurrentPage] = useState(startPage || 1);
  const [zoom, setZoom] = useState(1.0); // 0.6 to 2.0
  const [baseWidth, setBaseWidth] = useState(720);

  // لایه ابزارهای نوت‌برداری
  const [tool, setTool] = useState<ReaderTool>(null);
  const [color, setColor] = useState(INK_COLORS[1]);
  const [strokeWidth, setStrokeWidth] = useState(0.0035);
  const [status, setStatus] = useState<InkStatus>('idle');
  const [inkCount, setInkCount] = useState(0);
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const [eraserMode, setEraserMode] = useState<'stroke' | 'partial'>('stroke');
  const [eraseHighlighterOnly, setEraseHighlighterOnly] = useState(false);
  const [shapeSnap, setShapeSnap] = useState(false);
  const [stylusOnly, setStylusOnly] = useState(false);

  // یادداشت‌های چسبان و نشان‌ها
  const [pageNotes, setPageNotes] = useState<Map<number, StickyNote[]>>(new Map());
  const [bookmarkedPages, setBookmarkedPages] = useState<number[]>(() => bookmarks.get(scope, id));

  // حالت‌های نمایشی
  const [focusMode, setFocusMode] = useState(false);
  const [invertContrast, setInvertContrast] = useState(false);
  const [thumbnailDrawerOpen, setThumbnailDrawerOpen] = useState(false);
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [notebookKey, setNotebookKey] = useState(0);

  // Text layer state
  const [textContents] = useState<Map<number, any>>(new Map());
  const [searchQuery] = useState('');
  const [searchMatches] = useState<number[]>([]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inkApis = useRef<Map<number, InkApi>>(new Map());
  const progressRef = useRef(onProgress);
  progressRef.current = onProgress;
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // ── لنگرگاه هوشمند زوم (Zoom Anchor Preservation) ──
  // جلوگیری از جهش صفحه به اول جزوه هنگام بزرگ‌نمایی
  const zoomAnchorRef = useRef<{ page: number; ratio: number } | null>(null);
  const isZoomingRef = useRef(false);
  const zoomResetTimerRef = useRef<number | null>(null);

  const captureZoomAnchor = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const targetPage = currentPage;
    const pageEl = pageRefs.current.get(targetPage);
    if (pageEl) {
      const scrollerRect = scroller.getBoundingClientRect();
      const pageRect = pageEl.getBoundingClientRect();
      const relativeTop = scrollerRect.top - pageRect.top;
      const ratio = Math.max(0, Math.min(1, relativeTop / Math.max(1, pageEl.offsetHeight)));
      zoomAnchorRef.current = { page: targetPage, ratio };
    } else {
      zoomAnchorRef.current = { page: targetPage, ratio: 0 };
    }
    isZoomingRef.current = true;
    if (zoomResetTimerRef.current) window.clearTimeout(zoomResetTimerRef.current);
    zoomResetTimerRef.current = window.setTimeout(() => {
      isZoomingRef.current = false;
    }, 350);
  }, [currentPage]);

  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    if (!anchor) return;
    const scroller = scrollRef.current;
    if (!scroller) return;

    const frame = requestAnimationFrame(() => {
      const pageEl = pageRefs.current.get(anchor.page);
      if (pageEl && scroller) {
        const newPageTop = pageEl.offsetTop;
        const newScrollTop = Math.max(0, newPageTop + anchor.ratio * pageEl.offsetHeight);
        scroller.scrollTop = newScrollTop;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [zoom]);

  // ── کنترل بزرگ‌نمایی چندلمسی طبیعی با دو انگشت (2-Finger Multi-Touch Pinch to Zoom) ──
  const touchDistRef = useRef<number | null>(null);
  const touchStartZoomRef = useRef<number>(1.0);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const p1 = e.touches[0];
      const p2 = e.touches[1];
      touchDistRef.current = Math.hypot(p2.clientX - p1.clientX, p2.clientY - p1.clientY);
      touchStartZoomRef.current = zoom;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && touchDistRef.current !== null) {
      const p1 = e.touches[0];
      const p2 = e.touches[1];
      const curDist = Math.hypot(p2.clientX - p1.clientX, p2.clientY - p1.clientY);
      if (touchDistRef.current > 10) {
        captureZoomAnchor();
        const factor = curDist / touchDistRef.current;
        const nextZoom = Math.min(2.5, Math.max(0.6, Math.round(touchStartZoomRef.current * factor * 100) / 100));
        setZoom(nextZoom);
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      touchDistRef.current = null;
    }
  };

  // پشتیبانی از ترک‌پد Precision ویندوز و ماوس (Windows Touchpad Pinch-to-Zoom & Ctrl+Wheel)
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        captureZoomAnchor();
        // ضریب حساسیت نرم و بهینه برای تاچ‌پد ویندوز و موس با محدودسازی شیب
        const delta = -e.deltaY * 0.006;
        const clampedDelta = Math.max(-0.25, Math.min(0.25, delta));
        setZoom((z) => Math.min(2.5, Math.max(0.6, Math.round((z + clampedDelta) * 100) / 100)));
      }
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [captureZoomAnchor]);

  // کنترل پیوسته بزرگ‌نمایی چندلمسی مستقیم روی بوم (2-Finger Multi-Touch Canvas Pinch)
  const handlePinchZoom = useCallback((factor: number) => {
    captureZoomAnchor();
    setZoom((z) => Math.min(2.5, Math.max(0.6, Math.round(z * factor * 100) / 100)));
  }, [captureZoomAnchor]);

  // ── تازهسازی بیصدای آدرسهای امضاشده (T1) ──
  // مانیفست جدید فقط آدرس صفحات را عوض میکند؛ صفحهٔ جاری، زوم و اسکرول
  // دست نمیخورند و صفحاتی که قبلاً نمایش داده شدهاند دوباره دانلود نمیشوند.
  const refreshAtRef = useRef(0);
  const inflightRef = useRef<Promise<DocumentManifest | null> | null>(null);
  const prefetchedUrlsRef = useRef<Set<string>>(new Set());
  const [prefetchTick, setPrefetchTick] = useState(0);

  const acceptManifest = useCallback((data: DocumentManifest) => {
    refreshAtRef.current = manifestRefreshAt(data);
    prefetchedUrlsRef.current.clear();
    setManifest(data);
  }, []);

  const handlePageLoaded = useCallback(() => {
    setPrefetchTick((n) => n + 1);
  }, []);

  useEffect(() => {
    prefetchedUrlsRef.current.clear();
  }, [scope, id]);

  // پیش‌بارگذاری آرام صفحات همسایه (+1، +2، -1) با احترام به Save-Data
  useEffect(() => {
    if (!manifest || !manifest.page_dimensions?.length) return;
    const conn =
      typeof navigator !== 'undefined'
        ? (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
        : undefined;
    if (conn?.saveData) return;

    const timer = window.setTimeout(() => {
      const targets = [currentPage + 1, currentPage + 2, currentPage - 1];
      for (const p of targets) {
        if (p < 1 || p > manifest.total_pages) continue;
        const dim = manifest.page_dimensions.find((d) => d.page === p);
        const pageUrl = dim?.url;
        if (!pageUrl || prefetchedUrlsRef.current.has(pageUrl)) continue;
        prefetchedUrlsRef.current.add(pageUrl);
        const img = new Image();
        img.decoding = 'async';
        img.src = pageUrl;
      }
    }, 120);

    return () => window.clearTimeout(timer);
  }, [manifest, currentPage, prefetchTick]);

  const silentRefresh = useCallback((): Promise<DocumentManifest | null> => {
    if (inflightRef.current) return inflightRef.current;
    const job = (async () => {
      try {
        const data = await fetchDocumentManifest(scope, id);
        acceptManifest(data);
        return data;
      } catch {
        // شبکه/نشست: صفحات فعلی تا انقضای واقعی کار میکنند؛ تلاش بعدی یک دقیقه دیگر
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

  // زمانبندی تازهسازی ~۲ دقیقه قبل از انقضا؛ تایمر در تب پسزمینه کند میشود،
  // پس هنگام برگشت به تب و آنلاین شدن هم بررسی میکنیم.
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
  const loadManifest = useCallback(async () => {
    setLoading(true);
    setError('');
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

  // دریافت یادداشت‌های چسبان برای صفحه فعال
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await ink.page(scope, id, currentPage);
        if (!cancelled && res.notes && res.notes.length > 0) {
          setPageNotes((prev) => {
            const m = new Map(prev);
            m.set(currentPage, res.notes);
            return m;
          });
        }
      } catch {
        // silent fallback
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope, id, currentPage]);

  // اندازه‌گیری عرض محفظه بدون کلمپ مصنوعی (پشتیبانی تا ۱۴۰۰ پیکسل در نمایشگرهای عریض و آیپد)
  useEffect(() => {
    const updateWidth = () => {
      const el = scrollRef.current || containerRef.current;
      if (el) {
        const available = Math.max(300, el.clientWidth - 32);
        setBaseWidth(Math.min(available, 1400));
      }
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, [notebookOpen]);

  // پرش به صفحه با اسکرول نرم
  const scrollToPage = useCallback((p: number) => {
    const el = pageRefs.current.get(p);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setCurrentPage(p);
    if (manifest) {
      progressRef.current(p, manifest.total_pages);
    }
  }, [manifest]);

  // کلیدهای میانبر صفحه‌کلید
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;

      const total = manifest?.total_pages || 1;
      if (e.key === 'ArrowLeft' || e.key === 'PageDown') {
        scrollToPage(Math.min(total, currentPage + 1));
      }
      if (e.key === 'ArrowRight' || e.key === 'PageUp') {
        scrollToPage(Math.max(1, currentPage - 1));
      }
      if (e.key === '+' || e.key === '=') {
        captureZoomAnchor();
        setZoom((z) => Math.min(2.0, Math.round((z + 0.1) * 10) / 10));
      }
      if (e.key === '-') {
        captureZoomAnchor();
        setZoom((z) => Math.max(0.6, Math.round((z - 0.1) * 10) / 10));
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
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        const api = inkApis.current.get(currentPage);
        if (e.shiftKey) api?.redo();
        else api?.undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentPage, manifest, scrollToPage, focusMode, thumbnailDrawerOpen, onToggleSplitWorkspace]);

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
    void ink.save(scope, id, currentPage, undefined, nextList);
  };

  const handleUpdatePageNotes = (page: number, updatedNotes: StickyNote[]) => {
    const nextMap = new Map(pageNotes);
    nextMap.set(page, updatedNotes);
    setPageNotes(nextMap);
    void ink.save(scope, id, page, undefined, updatedNotes);
  };

  const handleToggleBookmark = (p: number) => {
    bookmarks.toggle(scope, id, p);
    setBookmarkedPages(bookmarks.get(scope, id));
  };

  // Text layer handlers
  const handleTextSelection = useCallback((text: string, _rects: DOMRect[]) => {
    if (text.trim()) {
      // Could show floating toolbar for copy, highlight, etc.
      console.log('Text selected:', text);
    }
  }, []);

  const handleAnchorAnnotation = useCallback((pageX: number, pageY: number, text: string) => {
    // Called when user wants to anchor an annotation to specific text
    console.log('Anchor annotation at:', pageX, pageY, text);
  }, []);

  const activeInkApi = inkApis.current.get(currentPage);

  return (
    <div
      className={`reader reader--ink ${focusMode ? 'reader-focus-mode' : ''}`}
      ref={containerRef}
      onContextMenu={(e) => e.preventDefault()}
      style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
    >
      {loading && (
        <div className="reader__center" aria-busy="true">
          <span className="small">در حال آماده‌سازی سند امن…</span>
        </div>
      )}

      {error && !loading && (
        <div className="reader__center">
          <Icon name="i-arch" size={30} />
          <p className="small mt-8" style={{ maxWidth: 320 }}>
            {error}
          </p>
          <button type="button" className="btn btn--quiet mt-12" onClick={() => void loadManifest()}>
            تلاش مجدد
          </button>
        </div>
      )}

      {!loading && !error && manifest && (
        <div className="reader__stage">
          <div
            className="reader__canvas"
            ref={scrollRef}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
          >
            <div
              className="reader__scroll-track"
              style={{
                width: `${Math.floor(baseWidth * zoom)}px`,
                margin: '0 auto',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
              }}
            >
              {manifest.page_dimensions.map((dim) => {
                const targetW = Math.floor(baseWidth * zoom);
                const targetH = Math.floor(targetW / (dim.aspect_ratio || 0.7071));

                return (
                  <VirtualPageContainer
                    key={dim.page}
                    page={dim.page}
                    width={targetW}
                    height={targetH}
                    url={dim.url}
                    onUrlRejected={freshPageUrl}
                    scope={scope}
                    id={id}
                    tool={tool}
                    color={color}
                    strokeWidth={strokeWidth}
                    invertContrast={invertContrast}
                    notes={pageNotes.get(dim.page) || []}
                    onUpdateNotes={(n) => handleUpdatePageNotes(dim.page, n)}
                    isCurrent={dim.page === currentPage}
                    onVisible={(p) => {
                      if (isZoomingRef.current) return;
                      setCurrentPage(p);
                      progressRef.current(p, manifest.total_pages);
                    }}
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
                    onInkChanged={() => setNotebookKey((k) => k + 1)}
                    eraserMode={eraserMode}
                    eraseHighlighterOnly={eraseHighlighterOnly}
                    shapeSnap={shapeSnap}
                    stylusOnly={stylusOnly}
                    onPinchZoom={handlePinchZoom}
                    // Text layer props
                    textContent={textContents.get(dim.page) || null}
                    viewport={manifest.page_dimensions.find(d => d.page === dim.page) || null}
                    searchQuery={searchQuery}
                    searchMatches={searchMatches}
                    onTextSelection={handleTextSelection}
                    onAnchorAnnotation={handleAnchorAnnotation}
                    enableTextSelection={true}
                    onPageLoaded={handlePageLoaded}
                  />
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

      {/* نوار ابزار حاشیه‌نویسی شناور به سبک GoodNotes / آیپد */}
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
          onOpenThumbnails={() => setThumbnailDrawerOpen(true)}
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

      {/* المان‌های حالت تمرکز تمام‌صفحه */}
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
            ✕
          </button>
        </>
      )}

      {/* کشوی پیش‌نمایش صفحات و نشان‌شده‌ها */}
      <ThumbnailDrawer
        open={thumbnailDrawerOpen}
        onClose={() => setThumbnailDrawerOpen(false)}
        manifest={manifest}
        currentPage={currentPage}
        onJump={scrollToPage}
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
  /** آدرس صفحه رد شد (۴۰۱/۴۰۳ یا انقضا): آدرس تازهٔ همین صفحه */
  onUrlRejected?: (page: number) => Promise<string | null>;
  scope: Scope;
  id: string;
  tool: ReaderTool;
  color: string;
  strokeWidth: number;
  invertContrast: boolean;
  notes: StickyNote[];
  onUpdateNotes: (notes: StickyNote[]) => void;
  isCurrent: boolean;
  onVisible: (page: number) => void;
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
  onPinchZoom?: (factor: number) => void;
  // Text layer props
  textContent?: any;
  viewport?: any;
  searchQuery?: string;
  searchMatches?: number[];
  onTextSelection?: (text: string, rects: DOMRect[]) => void;
  onAnchorAnnotation?: (pageX: number, pageY: number, text: string) => void;
  enableTextSelection?: boolean;
  textLayerRef?: React.RefObject<any>;
  onPageLoaded?: () => void;
}

function VirtualPageContainer({
  page,
  width,
  height,
  url,
  onUrlRejected,
  scope,
  id,
  tool,
  color,
  strokeWidth,
  invertContrast,
  notes,
  onUpdateNotes,
  isCurrent,
  onVisible,
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
  onPinchZoom,
  // Text layer props
  textContent,
  viewport,
  searchQuery,
  searchMatches,
  onTextSelection,
  onAnchorAnnotation,
  enableTextSelection = true,
  textLayerRef,
  onPageLoaded,
}: VirtualPageContainerProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [isNearViewport, setIsNearViewport] = useState(page <= 2);
  const [imgLoaded, setImgLoaded] = useState(false);
  const textLayerRefInternal = useRef<any>(null);

  // آدرس نمایشی جدا از آدرس مانیفست: تازهسازی مانیفست صفحهای را که
  // نمایش داده شده دوباره دانلود نمیکند؛ فقط صفحهٔ بارگذارینشده یا ردشده
  // آدرس تازه میگیرد. صفحهٔ ردشده یکبار بیصدا با آدرس نو تلاش میشود.
  const [src, setSrc] = useState(url);
  const [failed, setFailed] = useState(false);
  const latestUrl = useRef(url);
  latestUrl.current = url;
  const loadedRef = useRef(false);
  const retriedRef = useRef(false);

  useEffect(() => {
    if (!loadedRef.current) setSrc(url);
  }, [url]);

  useEffect(() => {
    if (!isNearViewport) {
      // img برداشته شد؛ دفعهٔ بعد با تازهترین آدرس ساخته شود
      loadedRef.current = false;
      retriedRef.current = false;
      setImgLoaded(false);
      setFailed(false);
      setSrc(latestUrl.current);
    }
  }, [isNearViewport]);

  const recover = useCallback(async () => {
    if (!onUrlRejected) {
      setFailed(true);
      return;
    }
    const fresh = await onUrlRejected(page);
    const next = fresh || latestUrl.current;
    setFailed(false);
    loadedRef.current = false;
    setImgLoaded(false);
    // همان آدرس هم باشد (مثلاً خطای گذرای شبکه)، با پارامتر کوچک دوباره میخوانیم
    setSrc(next === src ? `${next}${next.includes('?') ? '&' : '?'}r=${Date.now()}` : next);
  }, [onUrlRejected, page, src]);

  const handleImgError = useCallback(() => {
    if (retriedRef.current) {
      setFailed(true);
      return;
    }
    retriedRef.current = true;
    void recover();
  }, [recover]);

  // اینترنت برگشت ⇒ صفحهٔ ناموفق خودکار دوباره
  useEffect(() => {
    if (!failed) return;
    const on = () => {
      retriedRef.current = false;
      void recover();
    };
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, [failed, recover]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    onRegisterRef(el);

    // ناظر پنجره‌بندی (Windowing): بارگذاری با فاصله ۶۰۰ پیکسل قبل از دید
    const windowingObs = new IntersectionObserver(
      ([entry]) => {
        setIsNearViewport(entry.isIntersecting);
      },
      { rootMargin: '600px 0px 600px 0px' },
    );

    // ناظر صفحه فعال: כאשר که صفحه از خط دید مرکزی عبور می‌کند
    const activeObs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          onVisible(page);
        }
      },
      { threshold: 0.15 },
    );

    windowingObs.observe(el);
    activeObs.observe(el);

    return () => {
      windowingObs.disconnect();
      activeObs.disconnect();
      onRegisterRef(null);
    };
  }, [page, onVisible, onRegisterRef]);

  // Expose text layer ref methods
  useEffect(() => {
    if (textLayerRef && textLayerRefInternal.current) {
      (textLayerRef as any).current = textLayerRefInternal.current;
    }
  }, [textLayerRef]);

  return (
    <div
      ref={ref}
      className={`pdf-page${isCurrent ? ' is-active' : ''}`}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        position: 'relative',
        margin: '0 auto 16px',
        backgroundColor: invertContrast ? '#121620' : '#ffffff',
        borderRadius: '6px',
        boxShadow: 'var(--sh-1, 0 1px 3px rgba(0,0,0,0.12))',
        border: '1px solid var(--line, #e2e8f0)',
        overflow: 'hidden',
      }}
    >
      {isNearViewport ? (
        <>
          {failed ? (
            <div
              className="page-placeholder"
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                color: 'var(--ink-3, #94a3b8)',
                fontSize: '12px',
                backgroundColor: 'var(--paper-2, #f8fafc)',
              }}
            >
              <span>صفحهٔ {fa(page)} بارگذاری نشد</span>
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => {
                  retriedRef.current = false;
                  void recover();
                }}
              >
                تلاش دوباره
              </button>
            </div>
          ) : (
          <img
            src={src}
            alt={`صفحهٔ ${fa(page)}`}
            className={`reader__page ${invertContrast ? 'reader__page--inverted' : ''}`}
            style={{
              width: `${width}px`,
              height: `${height}px`,
              display: 'block',
              objectFit: 'contain',
              userSelect: 'none',
              pointerEvents: 'none',
              opacity: imgLoaded ? 1 : 0.85,
              transition: 'opacity 0.15s ease-in',
            }}
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={() => {
              loadedRef.current = true;
              retriedRef.current = false;
              setImgLoaded(true);
              onPageLoaded?.();
            }}
            onError={handleImgError}
          />
          )}

          {/* Text Layer - Semantic text overlay for selection, search, copy */}
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
              enableSelection={enableTextSelection}
              className="virtual-page__text-layer"
              renderScale={1}
            />
          )}

          {/* لایه یادداشت‌های چسبان */}
          <StickyNoteOverlay
            page={page}
            width={width}
            height={height}
            notes={notes}
            onUpdateNotes={onUpdateNotes}
          />

          {/* لایه حاشیه‌نویسی دیجیتال */}
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
            eraserMode={eraserMode}
            eraseHighlighterOnly={eraseHighlighterOnly}
            shapeSnap={shapeSnap}
            stylusOnly={stylusOnly}
            onPinchZoom={onPinchZoom}
          />
        </>
      ) : (
        <div
          className="page-placeholder"
          style={{
            width: '100%',
            height: '100%',
            backgroundColor: 'var(--paper-2, #f8fafc)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--ink-3, #94a3b8)',
            fontSize: '12px',
          }}
        >
          صفحهٔ {fa(page)}
        </div>
      )}
    </div>
  );
}
