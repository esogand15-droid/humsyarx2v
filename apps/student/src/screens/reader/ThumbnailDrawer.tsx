import { useEffect, useState } from 'react';
import { Icon } from '../../icons';
import { fa } from '../../lib/library';
import { ink, type InkSummaryPage, type Scope } from '../../lib/ink';
import type { DocumentManifest } from './ProtectedReaderView';

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
            ✕
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
            {pageDimensions.map((dim) => {
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
                  role="button"
                  tabIndex={0}
                  aria-label={`پرش به صفحه ${dim.page}`}
                >
                  <img
                    src={dim.url}
                    alt={`صفحه ${dim.page}`}
                    className="thumb-card__img"
                    loading="lazy"
                  />
                  <div className="thumb-card__footer">
                    <span className="thumb-card__num num">صفحه {fa(dim.page)}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {hasInk && <span title="دارای حاشیه‌نویسی">🖋️</span>}
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
                        {isBm ? '★' : '☆'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'bookmarks' && (
          <div className="thumb-drawer__grid">
            {bookmarkedPages.length === 0 ? (
              <div style={{ gridColumn: '1 / -1', padding: '32px 16px', textAlign: 'center', color: 'var(--ink-3)' }}>
                <Icon name="i-bookmark" size={32} />
                <p className="small mt-8">هنوز صفحه‌ای را نشان نکرده‌ای.</p>
                <p className="tiny mt-4">روی ستارهٔ هر صفحه بزن تا در این فهرست ذخیره شود.</p>
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
                      role="button"
                      tabIndex={0}
                    >
                      <img
                        src={dim.url}
                        alt={`صفحه ${dim.page}`}
                        className="thumb-card__img"
                        loading="lazy"
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
                        >
                          ★
                        </button>
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        )}

        {activeTab === 'notes' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
            {annotatedPages.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--ink-3)' }}>
                <Icon name="i-pen" size={32} />
                <p className="small mt-8">هنوز روی این جزوه چیزی ننوشته‌ای.</p>
                <p className="tiny mt-4">با قلم یا هایلایتر خط بکش؛ یادداشت‌هایت خودکار ذخیره می‌شوند.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p className="tiny" style={{ color: 'var(--ink-3)' }}>
                  {fa(annotatedPages.length)} صفحه دارای حاشیه‌نویسی · مجموع {fa(totalInk)} خط
                </p>
                {annotatedPages.map((item) => (
                  <button
                    key={item.page}
                    type="button"
                    className="notebook__item"
                    onClick={() => {
                      onJump(item.page);
                      onClose();
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: 10,
                      border: '1px solid var(--line)',
                      background: 'var(--paper)',
                      cursor: 'pointer',
                    }}
                  >
                    <span className="num" style={{ fontWeight: 700 }}>صفحهٔ {fa(item.page)}</span>
                    <span className="tiny" style={{ color: 'var(--ink-3)' }}>{fa(item.count)} خط دیجیتال</span>
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
