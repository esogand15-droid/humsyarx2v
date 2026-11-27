import { useEffect, useState } from 'react';
import { DsButton, DsEmpty } from '../../design/components';
import { Icon } from '../../icons';
import { fa } from '../../lib/library';
import { ink, type InkSummaryPage, type Scope } from '../../lib/ink';
import type { DocumentManifest } from './ProtectedReaderView';
import { acquireThumbUrl, getCachedThumbUrl } from './readerPageCache';

export function CachedThumbImg({
  scope,
  id,
  page,
  remoteUrl,
  fallbackUrl,
  alt,
}: {
  scope: Scope;
  id: string;
  page: number;
  remoteUrl: string;
  fallbackUrl: string;
  alt: string;
}) {
  const [src, setSrc] = useState<string>(() => {
    const cached = getCachedThumbUrl(scope, id, page);
    if (cached) return cached;
    return remoteUrl.startsWith('data:') ? remoteUrl : '';
  });

  useEffect(() => {
    let cancelled = false;
    const cached = getCachedThumbUrl(scope, id, page);
    if (cached) {
      setSrc(cached);
      return;
    }
    if (remoteUrl.startsWith('data:')) {
      setSrc(remoteUrl);
      return;
    }
    void acquireThumbUrl(scope, id, page, remoteUrl)
      .then((objUrl) => {
        if (!cancelled) setSrc(objUrl);
      })
      .catch(() => {
        if (!cancelled && fallbackUrl && fallbackUrl !== remoteUrl) {
          void acquireThumbUrl(scope, id, page, fallbackUrl)
            .then((objUrl) => {
              if (!cancelled) setSrc(objUrl);
            })
            .catch(() => {
              if (!cancelled) setSrc(fallbackUrl);
            });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [scope, id, page, remoteUrl, fallbackUrl]);

  return (
    <img
      src={src || undefined}
      alt={alt}
      className="thumb-card__img"
      loading="lazy"
      decoding="async"
      draggable={false}
    />
  );
}

interface ThumbnailDrawerProps {
  open: boolean;
  onClose: () => void;
  manifest: DocumentManifest | null;
  currentPage: number;
  onJump: (page: number) => void;
  scope: Scope;
  id: string;
  bookmarkedPages: number[];
  onToggleBookmark: (page: number) => void;
}

type DrawerTab = 'thumbnails' | 'bookmarks' | 'notes';

export function ThumbnailDrawer({
  open,
  onClose,
  manifest,
  currentPage,
  onJump,
  scope,
  id,
  bookmarkedPages,
  onToggleBookmark,
}: ThumbnailDrawerProps) {
  const [activeTab, setActiveTab] = useState<DrawerTab>('thumbnails');
  const [annotatedPages, setAnnotatedPages] = useState<InkSummaryPage[]>([]);
  const [totalInk, setTotalInk] = useState(0);
  const [showAllThumbs, setShowAllThumbs] = useState(false);

  useEffect(() => {
    if (!open) setShowAllThumbs(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await ink.summary(scope, id);
        if (!cancelled) {
          setAnnotatedPages(res.pages ?? []);
          setTotalInk(res.total ?? 0);
        }
      } catch {
        // silent fallback
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, scope, id]);

  if (!open) return null;

  const totalPages = manifest?.total_pages || 0;
  const pageDimensions = manifest?.page_dimensions || [];
  const thumbLimit = showAllThumbs ? pageDimensions.length : Math.max(36, currentPage + 16);
  const visibleDimensions = pageDimensions.slice(0, thumbLimit);
  const hasMoreThumbs = pageDimensions.length > visibleDimensions.length;

  const activateOnKey = (e: React.KeyboardEvent, page: number) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onJump(page);
      onClose();
    }
  };

  return (
    <div className="thumb-drawer-backdrop" onClick={onClose}>
      <aside
        className="thumb-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="پیش‌نمایش صفحات و نشان‌شده‌ها"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="thumb-drawer__header">
          <span className="h3">فهرست و یادداشت‌ها</span>
          <button
            type="button"
            className="iconbtn"
            onClick={onClose}
            aria-label="بستن کشو"
            title="بستن"
          >
            <Icon name="i-x" size={16} />
          </button>
        </div>

        <nav className="thumb-drawer__tabs" aria-label="تب‌های راهنما">
          <button
            type="button"
            className={`thumb-drawer__tab ${activeTab === 'thumbnails' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('thumbnails')}
          >
            صفحات ({fa(totalPages)})
          </button>
          <button
            type="button"
            className={`thumb-drawer__tab ${activeTab === 'bookmarks' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('bookmarks')}
          >
            نشان‌شده‌ها ({fa(bookmarkedPages.length)})
          </button>
          <button
            type="button"
            className={`thumb-drawer__tab ${activeTab === 'notes' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('notes')}
          >
            دست‌نوشته‌ها ({fa(annotatedPages.length)})
          </button>
        </nav>

        {activeTab === 'thumbnails' && (
          <div className="thumb-drawer__grid">
            {visibleDimensions.map((dim) => {
              const isCurrent = dim.page === currentPage;
              const isBm = bookmarkedPages.includes(dim.page);
              const hasInk = annotatedPages.some((a) => a.page === dim.page);

              return (
                <div
                  key={dim.page}
                  className={`thumb-card ${isCurrent ? 'is-current' : ''}`}
                  onClick={() => {
                    onJump(dim.page);
                    onClose();
                  }}
                  onKeyDown={(e) => activateOnKey(e, dim.page)}
                  role="button"
                  tabIndex={0}
                  aria-label={`پرش به صفحه ${dim.page}`}
                >
                  <CachedThumbImg
                    scope={scope}
                    id={id}
                    page={dim.page}
                    remoteUrl={dim.thumbnail_url || dim.url}
                    fallbackUrl={dim.url}
                    alt={`صفحه ${dim.page}`}
                  />
                  <div className="thumb-card__footer">
                    <span className="thumb-card__num num">صفحه {fa(dim.page)}</span>
                    <div className="thumb-card__actions">
                      {hasInk && (
                        <span className="thumb-card__ink-badge" title="دارای حاشیه‌نویسی">
                          <Icon name="i-pen" size={14} />
                        </span>
                      )}
                      <button
                        type="button"
                        className={`thumb-card__bm-btn ${isBm ? 'is-active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleBookmark(dim.page);
                        }}
                        title={isBm ? 'حذف از نشان‌شده‌ها' : 'نشان کردن'}
                        aria-label={`نشان کردن صفحه ${dim.page}`}
                      >
                        <Icon name={isBm ? 'i-star-filled' : 'i-star'} size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {hasMoreThumbs && (
              <div className="thumb-drawer__more">
                <DsButton variant="secondary" size="sm" block onClick={() => setShowAllThumbs(true)}>
                  نمایش همهٔ صفحات ({fa(pageDimensions.length)})
                </DsButton>
              </div>
            )}
          </div>
        )}

        {activeTab === 'bookmarks' && (
          <div className="thumb-drawer__grid">
            {bookmarkedPages.length === 0 ? (
              <div className="thumb-drawer__empty">
                <DsEmpty
                  icon={<Icon name="i-bookmark" size={28} />}
                  title="هنوز صفحه‌ای را نشان نکرده‌ای"
                  body="روی ستارهٔ هر صفحه بزن تا در این فهرست ذخیره شود."
                />
              </div>
            ) : (
              pageDimensions
                .filter((dim) => bookmarkedPages.includes(dim.page))
                .map((dim) => {
                  const isCurrent = dim.page === currentPage;
                  return (
                    <div
                      key={dim.page}
                      className={`thumb-card ${isCurrent ? 'is-current' : ''}`}
                      onClick={() => {
                        onJump(dim.page);
                        onClose();
                      }}
                      onKeyDown={(e) => activateOnKey(e, dim.page)}
                      role="button"
                      tabIndex={0}
                      aria-label={`پرش به صفحه ${dim.page}`}
                    >
                      <CachedThumbImg
                        scope={scope}
                        id={id}
                        page={dim.page}
                        remoteUrl={dim.thumbnail_url || dim.url}
                        fallbackUrl={dim.url}
                        alt={`صفحه ${dim.page}`}
                      />
                      <div className="thumb-card__footer">
                        <span className="thumb-card__num num">صفحه {fa(dim.page)}</span>
                        <button
                          type="button"
                          className="thumb-card__bm-btn is-active"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleBookmark(dim.page);
                          }}
                          title="حذف از نشان‌شده‌ها"
                          aria-label={`حذف نشان صفحه ${dim.page}`}
                        >
                          <Icon name="i-star-filled" size={15} />
                        </button>
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        )}

        {activeTab === 'notes' && (
          <div className="thumb-drawer__notes-body">
            {annotatedPages.length === 0 ? (
              <DsEmpty
                icon={<Icon name="i-pen" size={28} />}
                title="هنوز روی این جزوه چیزی ننوشته‌ای"
                body="با قلم یا هایلایتر خط بکش؛ یادداشت‌هایت خودکار ذخیره می‌شوند."
              />
            ) : (
              <div className="thumb-drawer__list">
                <p className="tiny thumb-drawer__meta">
                  {fa(annotatedPages.length)} صفحه دارای حاشیه‌نویسی · مجموع {fa(totalInk)} خط
                </p>
                {annotatedPages.map((item) => (
                  <button
                    key={item.page}
                    type="button"
                    className="thumb-drawer__note-btn"
                    onClick={() => {
                      onJump(item.page);
                      onClose();
                    }}
                  >
                    <span className="num thumb-drawer__page-num">صفحهٔ {fa(item.page)}</span>
                    <span className="tiny thumb-drawer__meta">{fa(item.count)} خط دیجیتال</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
