import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { DsEmpty } from '../../design/components';
import { Icon } from '../../icons';
import { fa } from '../../lib/library';
import { ink, type Scope } from '../../lib/ink';
import type { DocumentManifest, PageDimension } from './ProtectedReaderView';
import { CachedThumbImg } from './ThumbnailDrawer';
import { hasCachedThumbUrl } from './readerPageCache';
import './page-overview.css';

type Filter = 'all' | 'bookmarked' | 'inked';

interface PageOverviewProps {
  open: boolean;
  onClose: () => void;
  manifest: DocumentManifest | null;
  currentPage: number;
  /** Should jump without smooth scrolling: the zoom animation already covers the move. */
  onJump: (page: number) => void;
  scope: Scope;
  id: string;
  bookmarkedPages: number[];
  onToggleBookmark: (page: number) => void;
  /** The reader viewport, so the chosen page zooms into the spot where it will appear. */
  targetRect?: () => DOMRect | null;
  /** Insert a blank page after the current one (opens the template picker). */
  onInsertPage?: () => void;
  onUrlRejected?: (page: number) => Promise<string | null>;
}

const ZOOM_MS = 300;
const CLOSE_MS = 180;
const VIRTUALIZE_THRESHOLD = 60;

/** کش کوتاه‌عمر خلاصهٔ دست‌نوشته‌ها — باز کردن مکرر اورویو درخواست شبکه نمی‌زند */
const inkSummaryCache = new Map<string, { at: number; set: Set<number> }>();

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Accept Persian and Arabic-Indic digits in the jump field. */
const toLatinDigits = (s: string) =>
  s
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660));

function setCssVar(name: string, value: string) {
  return (el: HTMLElement | null) => {
    if (el) el.style.setProperty(name, value);
  };
}

/** Fetches a thumbnail only once its card scrolls near view; cached items render immediately without waiting for observer. */
function LazyThumb({
  root,
  scope,
  id,
  dim,
  onUrlRejected,
}: {
  root: HTMLElement | null;
  scope: Scope;
  id: string;
  dim: PageDimension;
  onUrlRejected?: (page: number) => Promise<string | null>;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [seen, setSeen] = useState(() => hasCachedThumbUrl(scope, id, dim.page));

  useEffect(() => {
    if (seen) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          obs.disconnect();
        }
      },
      { root, rootMargin: '640px 0px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [root, seen]);

  return (
    <div
      ref={(el) => {
        ref.current = el;
        if (el) el.style.setProperty('--thumb-ar', String(dim.aspect_ratio || 0.7071));
      }}
      className="page-ov__thumb"
    >
      {seen ? (
        <CachedThumbImg
          scope={scope}
          id={id}
          page={dim.page}
          remoteUrl={dim.thumbnail_url || dim.url}
          fallbackUrl={dim.url}
          alt={`صفحهٔ ${fa(dim.page)}`}
          onUrlRejected={onUrlRejected}
        />
      ) : (
        <div className="thumb-skel" aria-hidden="true">
          <span className="thumb-skel__shimmer" />
          <span className="thumb-skel__num num">{fa(dim.page)}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Noteful-style page overview: every page of the handout as a thumbnail with its number, opened
 * on the current page. Tapping a page zooms it into the reader.
 */
export function PageOverview({
  open,
  onClose,
  manifest,
  currentPage,
  onJump,
  scope,
  id,
  bookmarkedPages,
  onToggleBookmark,
  targetRect,
  onInsertPage,
  onUrlRejected,
}: PageOverviewProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [inked, setInked] = useState<Set<number>>(() => new Set());
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [closing, setClosing] = useState(false);
  const [zoom, setZoom] = useState<{
    src: string;
    from: DOMRect;
    to: DOMRect;
    go: boolean;
  } | null>(null);
  const [jumpText, setJumpText] = useState('');
  const [gridMetrics, setGridMetrics] = useState({ cols: 4, rowH: 220, startRow: 0, endRow: 12 });

  const timers = useRef<number[]>([]);
  const busy = useRef(false);

  useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t));
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    setFilter('all');
    setClosing(false);
    setZoom(null);
    setJumpText('');
    busy.current = false;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // کش ۶۰ ثانیه‌ای: هر بار باز کردن اورویو نباید درخواست شبکه بزند
    const cacheKey = `${scope}:${id}`;
    const hit = inkSummaryCache.get(cacheKey);
    if (hit && Date.now() - hit.at < 60_000) {
      setInked(hit.set);
      return;
    }
    ink
      .summary(scope, id)
      .then((res) => {
        if (cancelled) return;
        const set = new Set((res.pages ?? []).filter((p) => p.count > 0).map((p) => p.page));
        inkSummaryCache.set(cacheKey, { at: Date.now(), set });
        setInked(set);
      })
      .catch(() => {
        // the overview still works without ink badges
      });
    return () => {
      cancelled = true;
    };
  }, [open, scope, id]);

  const dims = manifest?.page_dimensions ?? [];
  const shown = dims.filter((d) =>
    filter === 'all' ? true : filter === 'bookmarked' ? bookmarkedPages.includes(d.page) : inked.has(d.page),
  );
  const virtualized = shown.length > VIRTUALIZE_THRESHOLD;

  // Measure grid columns + row height and compute visible row window for 200+ page docs
  const recomputeWindow = useCallback(() => {
    if (!scroller) return;
    const cs = getComputedStyle(scroller);
    const tplCols = cs.gridTemplateColumns ? cs.gridTemplateColumns.split(' ').filter(Boolean).length : 0;
    const cols = Math.max(1, tplCols || 3);
    const gapRow = parseFloat(cs.rowGap || '18') || 18;
    const sampleCard = scroller.querySelector<HTMLElement>('.page-ov__card');
    const measuredRowH = sampleCard ? sampleCard.offsetHeight + gapRow : gridMetrics.rowH;
    const rowH = Math.max(120, Math.round(measuredRowH));
    const viewH = scroller.clientHeight || 600;
    const scrollTop = scroller.scrollTop;
    const totalRows = Math.ceil(shown.length / cols);
    const startRow = Math.max(0, Math.floor(scrollTop / rowH) - 2);
    const endRow = Math.min(totalRows - 1, Math.ceil((scrollTop + viewH) / rowH) + 3);
    setGridMetrics((prev) =>
      prev.cols === cols && prev.rowH === rowH && prev.startRow === startRow && prev.endRow === endRow
        ? prev
        : { cols, rowH, startRow, endRow },
    );
  }, [scroller, shown.length, gridMetrics.rowH]);

  // Open centred on the page being read. Runs once per opening, not on every page change.
  useLayoutEffect(() => {
    if (!open || !scroller) return;
    if (virtualized) {
      const cs = getComputedStyle(scroller);
      const cols = Math.max(1, (cs.gridTemplateColumns || '').split(' ').filter(Boolean).length || 3);
      const gapRow = parseFloat(cs.rowGap || '18') || 18;
      const padLeft = parseFloat(cs.paddingLeft || '16') || 16;
      const padRight = parseFloat(cs.paddingRight || '16') || 16;
      const gapCol = parseFloat(cs.columnGap || '14') || 14;
      const colW = Math.max(96, (scroller.clientWidth - padLeft - padRight - gapCol * (cols - 1)) / cols);
      const avgAr = dims[0]?.aspect_ratio || 0.7071;
      const estRowH = Math.round(colW / avgAr + 34 + gapRow);
      const idx = Math.max(0, shown.findIndex((d) => d.page === currentPage));
      const targetRow = Math.floor(idx / cols);
      scroller.scrollTop = Math.max(0, targetRow * estRowH - scroller.clientHeight / 2 + estRowH / 2);
      recomputeWindow();
    } else {
      const el = scroller.querySelector<HTMLElement>(`[data-ov-page="${currentPage}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center' });
        el.focus({ preventScroll: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scroller]);

  useEffect(() => {
    if (!open || !scroller || !virtualized) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        recomputeWindow();
      });
    };
    recomputeWindow();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(recomputeWindow) : null;
    ro?.observe(scroller);
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      ro?.disconnect();
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [open, scroller, virtualized, recomputeWindow]);

  const dismiss = useCallback(() => {
    if (busy.current) return;
    if (prefersReducedMotion()) {
      onClose();
      return;
    }
    busy.current = true;
    setClosing(true);
    timers.current.push(window.setTimeout(onClose, CLOSE_MS));
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      dismiss();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, dismiss]);

  const choose = (page: number, card: Element | null) => {
    if (busy.current) return;
    const img = card?.querySelector('img');
    const src = img ? img.currentSrc || img.src : '';
    if (prefersReducedMotion() || !img || !src || !img.complete || img.naturalWidth === 0) {
      onJump(page);
      onClose();
      return;
    }
    busy.current = true;
    const from = img.getBoundingClientRect();
    const area = targetRect?.() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    const ar = from.width / Math.max(1, from.height);
    const w = Math.min(area.width * 0.96, area.height * 0.96 * ar);
    const h = w / ar;
    // The reader scrolls the chosen page to the top of its viewport, so land there.
    const to = new DOMRect(area.left + (area.width - w) / 2, area.top + 8, w, h);
    setZoom({ src, from, to, go: false });
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => setZoom((z) => (z ? { ...z, go: true } : z))),
    );
    timers.current.push(window.setTimeout(() => onJump(page), ZOOM_MS - 80));
    timers.current.push(window.setTimeout(onClose, ZOOM_MS + 60));
  };

  const submitJump = () => {
    const total = manifest?.total_pages || 0;
    const n = parseInt(toLatinDigits(jumpText).trim(), 10);
    if (!total || !Number.isFinite(n)) return;
    const page = Math.max(1, Math.min(total, n));
    choose(page, scroller?.querySelector(`[data-ov-page="${page}"]`) ?? null);
  };

  if (!open || !manifest) return null;

  const filters: Array<{ key: Filter; label: string; count: number }> = [
    { key: 'all', label: 'همه', count: dims.length },
    { key: 'bookmarked', label: 'نشان‌شده', count: bookmarkedPages.length },
    { key: 'inked', label: 'دست‌نوشته', count: inked.size },
  ];

  const totalRows = Math.ceil(shown.length / gridMetrics.cols);
  const startIdx = virtualized ? Math.max(0, gridMetrics.startRow * gridMetrics.cols) : 0;
  const endIdx = virtualized ? Math.min(shown.length, (gridMetrics.endRow + 1) * gridMetrics.cols) : shown.length;
  const visibleCards = shown.slice(startIdx, endIdx);
  const topSpace = virtualized ? gridMetrics.startRow * gridMetrics.rowH : 0;
  const botSpace = virtualized ? Math.max(0, (totalRows - 1 - gridMetrics.endRow) * gridMetrics.rowH) : 0;

  let zoomStyle: CSSProperties | undefined;
  if (zoom) {
    const { from, to } = zoom;
    zoomStyle = {
      left: to.left,
      top: to.top,
      width: to.width,
      height: to.height,
      transform: zoom.go
        ? 'none'
        : `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${
            from.height / to.height
          })`,
    };
  }

  return (
    <>
      <div
        className={`page-ov${closing ? ' is-closing' : ''}${zoom ? ' is-zooming' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="همهٔ صفحات جزوه"
        onKeyDown={(e) => e.stopPropagation()}
      >
        <header className="page-ov__bar">
          <div className="page-ov__heading">
            <span className="page-ov__title">همهٔ صفحات</span>
            <span className="page-ov__count num">
              صفحهٔ {fa(currentPage)} از {fa(manifest.total_pages)}
            </span>
          </div>

          <div className="page-ov__chips" role="tablist" aria-label="فیلتر صفحات">
            {filters.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={filter === f.key}
                className={`page-ov__chip${filter === f.key ? ' is-active' : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                <span className="page-ov__chip-n num">{fa(f.count)}</span>
              </button>
            ))}
          </div>

          <form
            className="page-ov__jump"
            onSubmit={(e) => {
              e.preventDefault();
              submitJump();
            }}
          >
            <input
              className="page-ov__jump-input num"
              inputMode="numeric"
              enterKeyHint="go"
              placeholder="شمارهٔ صفحه"
              aria-label="پرش به صفحه"
              value={jumpText}
              onChange={(e) => setJumpText(e.target.value)}
            />
            <button type="submit" className="page-ov__jump-go" aria-label="برو" disabled={!jumpText.trim()}>
              <Icon name="i-search" size={15} />
            </button>
          </form>

          {onInsertPage && (
            <button type="button" className="page-ov__add" onClick={onInsertPage}>
              <Icon name="i-plus" size={15} />
              <span>صفحهٔ تازه</span>
            </button>
          )}

          <button type="button" className="iconbtn page-ov__close" onClick={dismiss} aria-label="بستن" title="بستن (Esc)">
            <Icon name="i-x" size={18} />
          </button>
        </header>

        <div className="page-ov__grid" ref={setScroller}>
          {shown.length === 0 ? (
            <div className="page-ov__empty">
              <DsEmpty
                icon={<Icon name={filter === 'bookmarked' ? 'i-star' : 'i-pen'} size={28} />}
                title={filter === 'bookmarked' ? 'هنوز صفحه‌ای نشان نشده' : 'هنوز روی صفحه‌ای ننوشته‌ای'}
                body={
                  filter === 'bookmarked'
                    ? 'روی ستارهٔ گوشهٔ هر صفحه بزن تا اینجا بیاید.'
                    : 'صفحه‌هایی که با قلم یا هایلایتر رویشان کار کنی اینجا جمع می‌شوند.'
                }
              />
            </div>
          ) : (
            <>
              {topSpace > 0 && (
                <div
                  className="page-ov__spacer"
                  ref={setCssVar('--ov-spacer-h', `${topSpace}px`)}
                  aria-hidden="true"
                />
              )}
              {visibleCards.map((d) => {
                const isCurrent = d.page === currentPage;
                const isBm = bookmarkedPages.includes(d.page);
                return (
                  <div
                    key={d.page}
                    data-ov-page={d.page}
                    className={`page-ov__card${isCurrent ? ' is-current' : ''}${virtualized ? ' is-virtual' : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`صفحهٔ ${fa(d.page)}`}
                    aria-current={isCurrent ? 'page' : undefined}
                    ref={setCssVar('--i', String(Math.min(24, Math.abs(d.page - currentPage))))}
                    onClick={(e) => choose(d.page, e.currentTarget)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        choose(d.page, e.currentTarget);
                      }
                    }}
                  >
                    <div className="page-ov__frame">
                      <LazyThumb
                        root={scroller}
                        scope={scope}
                        id={id}
                        dim={d}
                        onUrlRejected={onUrlRejected}
                      />
                      <button
                        type="button"
                        className={`page-ov__bm${isBm ? ' is-on' : ''}`}
                        aria-label={isBm ? `حذف نشان صفحهٔ ${fa(d.page)}` : `نشان کردن صفحهٔ ${fa(d.page)}`}
                        aria-pressed={isBm}
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleBookmark(d.page);
                        }}
                      >
                        <Icon name={isBm ? 'i-star-filled' : 'i-star'} size={14} />
                      </button>
                      {inked.has(d.page) && (
                        <span className="page-ov__ink" title="دارای دست‌نوشته">
                          <Icon name="i-pen" size={11} />
                        </span>
                      )}
                    </div>
                    <span className="page-ov__num num">{fa(d.page)}</span>
                  </div>
                );
              })}
              {botSpace > 0 && (
                <div
                  className="page-ov__spacer"
                  ref={setCssVar('--ov-spacer-h', `${botSpace}px`)}
                  aria-hidden="true"
                />
              )}
            </>
          )}
        </div>
      </div>

      {zoom && <img className="page-ov__zoom" src={zoom.src} alt="" aria-hidden="true" style={zoomStyle} />}
    </>
  );
}
