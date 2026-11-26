import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import './core.css';
import { AppBar, SkeletonStack } from '../components';
import { DsBadge, DsButton, DsCard, DsChip, DsEmpty } from '../design/components';
import type { DsSection } from '../design/components';
import { Icon } from '../icons';
import type { IconName } from '../icons/sprite';
import { errorText } from '../lib/api';
import { faNum } from '../lib/fa';
import { searchApi } from '../lib/search';
import type { SearchResultItem } from '../lib/search';

const TYPE_ICONS: Record<SearchResultItem['type'], IconName> = {
  resource: 'i-file-text',
  question: 'i-help-circle',
  faq: 'i-message-circle',
  schedule: 'i-calendar',
  subject: 'i-book',
  book: 'i-book-open',
};

const TYPE_LABELS: Record<SearchResultItem['type'], string> = {
  resource: 'منبع',
  question: 'سؤال',
  faq: 'پرسش',
  schedule: 'برنامه',
  subject: 'مرجع',
  book: 'کتاب',
};

const TYPE_SECTIONS: Record<SearchResultItem['type'], DsSection> = {
  resource: 'resources',
  subject: 'resources',
  book: 'resources',
  question: 'qbank',
  schedule: 'schedule',
  faq: 'brand',
};

function routeForResult(item: SearchResultItem): string {
  switch (item.type) {
    case 'resource':
      return `/read/res/${encodeURIComponent(item.id)}`;
    case 'subject':
      return `/library/subject/${encodeURIComponent(item.id)}`;
    case 'book':
      return `/library/book/${encodeURIComponent(item.id)}`;
    case 'schedule':
      return '/schedule';
    case 'question':
      return '/exam';
    case 'faq':
      return '/me';
    default:
      return '/library';
  }
}

const FILTERS: Array<{ key: 'all' | SearchResultItem['type']; label: string }> = [
  { key: 'all', label: 'همه' },
  { key: 'resource', label: 'منابع' },
  { key: 'question', label: 'سؤالات' },
  { key: 'book', label: 'کتاب‌ها' },
  { key: 'schedule', label: 'برنامه' },
];

/** جستجوی سراسری — DS v2، فیلتر دسته‌بندی، لینک مستقیم و فونت ورودی ≥ ۱۶px. */
export function SearchScreen() {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | SearchResultItem['type']>('all');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const search = useCallback(async (q: string) => {
    if (!q.trim() || q.trim().length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    setError('');
    setSearched(true);
    try {
      const res = await searchApi.global(q.trim());
      const all: SearchResultItem[] = [];
      const map = res.results || {};
      Object.entries(map).forEach(([type, items]) => {
        if (Array.isArray(items)) {
          items.forEach((it: any) => {
            all.push({
              id: it.id || it._id || String(Math.random()),
              title: it.title || it.name || it.question || it.lesson || '—',
              type: type.replace(/s$/, '') as SearchResultItem['type'],
              subtitle:
                it.subtitle ||
                it.topic ||
                it.teacher ||
                (it.answer ? String(it.answer).slice(0, 80) : undefined),
            });
          });
        }
      });
      setResults(all);
    } catch (err) {
      setError(errorText(err, 'جستجو با خطا مواجه شد.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => {
      if (query.trim().length >= 2) {
        void search(query);
      }
    }, 350);
    return () => clearTimeout(id);
  }, [query, search]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(
    () => (filter === 'all' ? results : results.filter((r) => r.type === filter)),
    [results, filter],
  );

  return (
    <>
      <AppBar title="جستجو" sub="جستجوی سراسری در منابع، سؤالات و برنامه" back />

      <div className="page page-enter core-page">
        <div className="search-stage">
          <div className="search-sticky">
            <div className="ds-search">
              <Icon name="i-search" size={18} className="ds-search__icon" />
              <input
                ref={inputRef}
                type="search"
                className="ds-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="جستجو در منابع، سؤالات، برنامه…"
                aria-label="عبارت جستجو"
              />
              {query && (
                <button
                  type="button"
                  className="ds-search__clear search-clear-btn"
                  aria-label="پاک کردن جستجو"
                  onClick={() => {
                    setQuery('');
                    setResults([]);
                    setSearched(false);
                    inputRef.current?.focus();
                  }}
                >
                  <Icon name="i-x" size={18} />
                </button>
              )}
            </div>

            {results.length > 0 && (
              <div className="search-filters" role="group" aria-label="فیلتر نوع نتیجه">
                {FILTERS.map((f) => (
                  <DsChip
                    key={f.key}
                    selected={filter === f.key}
                    className="search-filter-chip"
                    onClick={() => setFilter(f.key)}
                  >
                    {f.label}
                  </DsChip>
                ))}
              </div>
            )}
          </div>

          {loading && <SkeletonStack rows={4} />}

          {error && !loading && (
            <DsCard>
              <DsEmpty
                icon={<Icon name="i-alert-circle" size={28} />}
                title="خطا در جستجو"
                body={error}
                action={
                  <DsButton variant="secondary" onClick={() => void search(query)}>
                    تلاش دوباره
                  </DsButton>
                }
              />
            </DsCard>
          )}

          {!loading && !error && searched && filtered.length === 0 && (
            <DsCard>
              <DsEmpty
                icon={<Icon name="i-search" size={28} />}
                title="نتیجه‌ای پیدا نشد"
                body={`برای «${query}» موردی ثبت نشده است؛ واژهٔ دیگری امتحان کنید.`}
              />
            </DsCard>
          )}

          {!loading && !error && filtered.length > 0 && (
            <div className="core-stack">
              <div className="core-sec-head">
                <h2 className="core-sec-head__title">نتایج جستجو</h2>
                <span className="core-sec-head__sub">{faNum(filtered.length)} نتیجه</span>
              </div>

              <DsCard flush>
                <div className="ds-list">
                  {filtered.map((item) => {
                    const sec = TYPE_SECTIONS[item.type] || 'brand';
                    return (
                      <Link
                        key={`${item.type}-${item.id}`}
                        to={routeForResult(item)}
                        className="ds-row"
                        data-section={sec}
                      >
                        <span className="ds-row__icon" aria-hidden="true">
                          <Icon name={TYPE_ICONS[item.type] || 'i-file-text'} size={20} />
                        </span>
                        <span className="ds-row__body">
                          <span className="ds-row__title">
                            <bdi dir="auto">{item.title}</bdi>
                          </span>
                          {item.subtitle && (
                            <span className="ds-row__sub">
                              <bdi dir="auto">{item.subtitle}</bdi>
                            </span>
                          )}
                        </span>
                        <DsBadge tone="accent">{TYPE_LABELS[item.type] || item.type}</DsBadge>
                        <Icon name="i-chevron-r" size={18} className="ds-row__chev" />
                      </Link>
                    );
                  })}
                </div>
              </DsCard>
            </div>
          )}

          {!searched && !loading && (
            <DsCard level="sunken">
              <DsEmpty
                icon={<Icon name="i-search" size={28} />}
                title="جستجو در کل هامزیار"
                body="نام درس، جزوه، کتاب مرجع یا واژهٔ کلیدی سؤال را تایپ کنید (حداقل ۲ حرف)."
              />
            </DsCard>
          )}
        </div>
      </div>
    </>
  );
}
