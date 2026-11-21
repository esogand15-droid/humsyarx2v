import { useMemo } from 'react';
import { Icon } from '../icons/Icon';
import { fa } from '../lib/library';

export interface PaginationProps {
  /** شماره صفحه فعلی (شروع از ۱) */
  currentPage: number;
  /** تعداد کل صفحات */
  totalPages: number;
  /** فراخوانی هنگام تغییر صفحه */
  onPageChange: (page: number) => void;
  /** تعداد کل آیتم‌ها (اختیاری جهت نمایش خلاصه) */
  totalItems?: number;
  /** تعداد آیتم در هر صفحه (اختیاری) */
  pageSize?: number;
  /** حالت فشرده مخصوص موبایل */
  compact?: boolean;
  /** کلاس سفارشی */
  className?: string;
}

/**
 * دکمه‌ها و نشانگرهای صفحه‌بندی با طراحی دقیق و متریال بالینی هامزیار:
 * - کلیدهای لمسی با بازخورد فنری (Haptic spring)
 * - پرش سریع به صفحات و سه‌نقطه هوشمند
 * - نمایش خلاصه آیتم‌ها با اعداد فارسی
 * - فوق‌العاده سبک و بهینه‌سازی‌شده برای عملکرد ۶۰fps
 */
export function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  totalItems,
  pageSize,
  compact = false,
  className = '',
}: PaginationProps) {
  if (totalPages <= 1) return null;

  // محاسبه بازه صفحات نمایشی
  const pageNumbers = useMemo(() => {
    const pages: (number | 'ellipsis-start' | 'ellipsis-end')[] = [];
    const delta = 1; // تعداد صفحات اطراف صفحه فعلی

    const left = Math.max(2, currentPage - delta);
    const right = Math.min(totalPages - 1, currentPage + delta);

    pages.push(1);

    if (left > 2) {
      pages.push('ellipsis-start');
    }

    for (let i = left; i <= right; i++) {
      pages.push(i);
    }

    if (right < totalPages - 1) {
      pages.push('ellipsis-end');
    }

    if (totalPages > 1) {
      pages.push(totalPages);
    }

    return pages;
  }, [currentPage, totalPages]);

  const hasPrev = currentPage > 1;
  const hasNext = currentPage < totalPages;

  const startItem = pageSize ? (currentPage - 1) * pageSize + 1 : undefined;
  const endItem = pageSize && totalItems ? Math.min(currentPage * pageSize, totalItems) : undefined;

  return (
    <nav
      className={`pagination ${compact ? 'pagination--compact' : ''} ${className}`.trim()}
      aria-label="صفحه‌بندی مطالب"
      dir="rtl"
    >
      {/* خلاصه تعداد آیتم‌ها در دسکتاپ */}
      {totalItems != null && startItem != null && endItem != null && (
        <span className="pagination__summary tiny num">
          نمایش <b>{fa(startItem)}</b> تا <b>{fa(endItem)}</b> از <b>{fa(totalItems)}</b> مورد
        </span>
      )}

      <div className="pagination__controls">
        {/* دکمه صفحه قبل */}
        <button
          type="button"
          className="pagination__btn pagination__btn--nav"
          disabled={!hasPrev}
          onClick={() => onPageChange(currentPage - 1)}
          aria-label="صفحه قبلی"
          title="صفحه قبلی"
        >
          <Icon name="i-chevron-r" size={16} />
          <span className="pagination__nav-label">قبلی</span>
        </button>

        {/* لیست شماره صفحات (در موبایل فشرده می‌شود) */}
        <div className="pagination__pages" role="list">
          {pageNumbers.map((p, idx) => {
            if (p === 'ellipsis-start' || p === 'ellipsis-end') {
              return (
                <span key={`${p}-${idx}`} className="pagination__ellipsis" aria-hidden="true">
                  •••
                </span>
              );
            }

            const isCurrent = p === currentPage;
            return (
              <button
                key={p}
                type="button"
                className={`pagination__btn pagination__btn--num ${isCurrent ? 'active' : ''}`}
                aria-current={isCurrent ? 'page' : undefined}
                aria-label={`رفتن به صفحه ${fa(p)}`}
                onClick={() => onPageChange(p)}
              >
                <span className="num">{fa(p)}</span>
                {isCurrent && <span className="pagination__active-glow" aria-hidden="true" />}
              </button>
            );
          })}
        </div>

        {/* نشانگر فشرده برای صفحه نمایش‌های کوچک */}
        <div className="pagination__compact-indicator num tiny">
          صفحه <b>{fa(currentPage)}</b> از <b>{fa(totalPages)}</b>
        </div>

        {/* دکمه صفحه بعد */}
        <button
          type="button"
          className="pagination__btn pagination__btn--nav"
          disabled={!hasNext}
          onClick={() => onPageChange(currentPage + 1)}
          aria-label="صفحه بعدی"
          title="صفحه بعدی"
        >
          <span className="pagination__nav-label">بعدی</span>
          <Icon name="i-chevron" size={16} />
        </button>
      </div>
    </nav>
  );
}

/**
 * هوک کمکی برای صفحه‌بندی آرایه‌ها در فرانت‌اند بدون بار اضافی سرور
 */
export function usePagination<T>(items: T[], pageSize = 10, initialPage = 1) {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(1, initialPage), totalPages);

  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, currentPage, pageSize]);

  return {
    currentPage,
    totalPages,
    totalItems,
    pageSize,
    paginatedItems,
  };
}
