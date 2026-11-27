import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { DsEmpty } from '../../design/components';
import { Icon } from '../../icons';
import { fa } from '../../lib/library';
import { ink, type Scope } from '../../lib/ink';
import type { DocumentManifest, PageDimension } from './ProtectedReaderView';
import { CachedThumbImg } from './ThumbnailDrawer';
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
}

const ZOOM_MS = 300;
const CLOSE_MS = 180;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Accept Persian and Arabic-Indic digits in the jump field. */
const toLatinDigits = (s: string) =>
  s
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660));

/** Fetches a thumbnail only once its card scrolls near view; a 150-page deck must not fire 150 requests. */
function LazyThumb({
  root,
  scope,
  id,
  dim,
}: {
  root: HTMLElement | null;
  scope: Scope;
  id: string;
  dim: PageDimension;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [seen, setSeen] = useState(false);

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
      { root, rootMargin: '480px 0px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [root, seen]);

  return (
    <div ref={ref} className="page-ov__thumb" style={{ aspectRatio: String(dim.aspect_ratio || 0.7071) }}>
      {seen && (
        <CachedThumbImg
          scope={scope}
          id={id}
          page={dim.page}
          remoteUrl={dim.thumbnail_url || dim.url}
          fallbackUrl={dim.url}
          alt={`صفحهٔ ${fa(dim.page)}`}
        />
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
    ink
      .summary(scope, id)
      .then((res) => {
        if (!cancelled) setInked(new Set((res.pages ?? []).filter((p) => p.count > 0).map((p) => p.page)));
      })
      .catch(() => {
        // the overview still works without ink badges
      });
    return () => {
      cancelled = true;
    };
  }, [open, scope, id]);

  // Open centred on the page being read. Runs once per opening, not on every page change.
  useLayoutEffect(() => {
    if (!open || !scroller) return;
    const el = scroller.querySelector<HTMLElement>(`[data-ov-page="${currentPage}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center' });
      el.focus({ preventScroll: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scroller]);

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
    if (prefersReducedMotion() || !img || !src || !img.complete) {
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

  const dims = manifest.page_dimensions;
  const shown = dims.filter((d) =>
    filter === 'all' ? true : filter === 'bookmarked' ? bookmarkedPages.includes(d.page) : inked.has(d.page),
  );

  const filters: Array<{ key: Filter; label: string; count: number }> = [
    { key: 'all', label: 'همه', count: dims.length },
    { key: 'bookmarked', label: 'نشانشده', count: bookmarkedPages.length },
    { key: 'inked', label: 'دستنوشته', count: inked.size },
  ];

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
                title={filter === 'bookmarked' ? 'هنوز صفحهای نشان نشده' : 'هنوز روی صفحهای ننوشتهای'}
                body={
                  filter === 'bookmarked'
                    ? 'روی ستارهٔ گوشهٔ هر صفحه بزن تا اینجا بیاید.'
                    : 'صفحههایی که با قلم یا هایلایتر رویشان کار کنی اینجا جمع میشوند.'
                }
              />
            </div>
          ) : (
            shown.map((d) => {
              const isCurrent = d.page === currentPage;
              const isBm = bookmarkedPages.includes(d.page);
              return (
                <div
                  key={d.page}
                  data-ov-page={d.page}
                  className={`page-ov__card${isCurrent ? ' is-current' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`صفحهٔ ${fa(d.page)}`}
                  aria-current={isCurrent ? 'page' : undefined}
                  style={{ '--i': Math.min(24, Math.abs(d.page - currentPage)) } as CSSProperties}
                  onClick={(e) => choose(d.page, e.currentTarget)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      choose(d.page, e.currentTarget);
                    }
                  }}
                >
                  <div className="page-ov__frame">
                    <LazyThumb root={scroller} scope={scope} id={id} dim={d} />
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
                      <span className="page-ov__ink" title="دارای دستنوشته">
                        <Icon name="i-pen" size={11} />
                      </span>
                    )}
                  </div>
                  <span className="page-ov__num num">{fa(d.page)}</span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {zoom && <img className="page-ov__zoom" src={zoom.src} alt="" aria-hidden="true" style={zoomStyle} />}
    </>
  );
}
