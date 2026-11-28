import { useMemo, useState } from 'react';

import { Icon } from '../../icons';
import { enDigits, fa, faNum } from '../../lib/fa';
import type { Scope } from '../../lib/ink';
import { fmtDuration, useNotebookIndex, type NotebookItem } from './notebookData';

interface Props {
  scope: Scope;
  id: string;
  page: number;
  open: boolean;
  onClose: () => void;
  /** پرش به صفحه — اگر مکان نرمال‌شده همراه باشد، همان نقطه روی صفحه فلش می‌زند */
  onJump: (page: number, at?: { x: number; y: number }) => void;
  /** هر بار که خطی ذخیره می‌شود، پنل تازه شود */
  refreshKey: number;
  hideHeader?: boolean;
}

type Filter = 'all' | NotebookItem['kind'];

interface PageGroup {
  page: number;
  inserted: boolean;
  items: NotebookItem[];
  strokes: number;
}

const NOTE_COLORS: Record<string, string> = {
  yellow: '#FBBF24',
  cyan: '#22D3EE',
  green: '#4ADE80',
  coral: '#FB7185',
};

const FILTER_LABELS: Record<Filter, string> = {
  all: 'همه',
  highlight: 'هایلایت',
  note: 'یادداشت',
  voice: 'ویس',
  bookmark: 'نشان',
};

/** دفتر این فایل — فهرستِ خودِ یادداشت‌ها: هایلایت، یادداشت چسبان، ویس و نشان.
 *
 *  مهمِ این‌جا «چی نوشته شده» است نه «چند خط»؛ هر آیتم که کلیک شود دقیقاً
 *  به همان نقطهٔ صفحه پرش می‌شود و فلش می‌زند.
 *  روی دسکتاپ/تبلت کنار صفحه می‌نشیند و روی گوشی از پایین باز می‌شود.
 */
export function NotebookPanel({ scope, id, page, open, onClose, onJump, refreshKey, hideHeader = false }: Props) {
  const { state, items, pages } = useNotebookIndex(scope, id, open, refreshKey);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const groups = useMemo<PageGroup[]>(() => {
    const map = new Map<string, PageGroup>();
    const ensure = (pageNum: number, inserted: boolean): PageGroup => {
      const gk = `${inserted ? 'ins' : 'pdf'}:${pageNum}`;
      let g = map.get(gk);
      if (!g) {
        g = { page: pageNum, inserted, items: [], strokes: 0 };
        map.set(gk, g);
      }
      return g;
    };
    for (const it of items) ensure(it.page, it.inserted).items.push(it);
    // شمار خطوط قلم هر صفحه — فقط چیپ کوچکِ سرگروه؛ خودِ خطوط مقصد پرش نیستند
    for (const p of pages) {
      if (p.count > 0) ensure(p.page, false).strokes = p.count;
    }
    for (const g of map.values()) {
      g.items.sort((a, b) => (a.at?.y ?? 0) - (b.at?.y ?? 0));
    }
    return [...map.values()].sort((a, b) =>
      a.inserted === b.inserted ? a.page - b.page : a.inserted ? 1 : -1,
    );
  }, [items, pages]);

  const counts = useMemo(
    () => ({
      highlight: items.filter((i) => i.kind === 'highlight').length,
      note: items.filter((i) => i.kind === 'note').length,
      voice: items.filter((i) => i.kind === 'voice').length,
      bookmark: items.filter((i) => i.kind === 'bookmark').length,
    }),
    [items],
  );

  const visible = useMemo(() => {
    const q = enDigits(query).trim().toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter((it) => {
          if (filter !== 'all' && it.kind !== filter) return false;
          if (!q) return true;
          const pageStr = faNum(g.page);
          const haystack = `${it.text ?? ''} ${pageStr} ${g.page} ${FILTER_LABELS[it.kind]}`.toLowerCase();
          return haystack.includes(q);
        }),
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, filter, query]);

  if (!open) return null;

  const isEmpty = state === 'ready' && items.length === 0 && pages.length === 0;

  return (
    <aside className="notebook" aria-label="دفتر این فایل">
      {!hideHeader && (
        <div className="notebook__head">
          <span className="h3">دفتر</span>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="بستن دفتر">
            <Icon name="i-x" size={16} />
          </button>
        </div>
      )}

      {state === 'loading' && <p className="small">در حال خواندن دفتر…</p>}

      {state === 'error' && (
        <p className="small" role="alert">
          دفتر باز نشد. اتصال را بررسی کن؛ یادداشت‌ها از بین نرفته‌اند.
        </p>
      )}

      {state === 'ready' && (
        <>
          {/* نوار جستجو — روی متن یادداشت‌ها و شمارهٔ صفحه */}
          <div className="nb-search">
            <Icon name="i-search" size={14} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="جستجو در یادداشت‌ها…"
              aria-label="جستجو در دفتر"
            />
            {query && (
              <button type="button" className="iconbtn" onClick={() => setQuery('')} aria-label="پاک کردن جستجو">
                <Icon name="i-x" size={13} />
              </button>
            )}
          </div>

          {/* فیلتر بر اساس نوع — با شمار واقعی هر نوع */}
          <div className="nb-chips" role="group" aria-label="فیلتر دفتر">
            {(['all', 'highlight', 'note', 'voice', 'bookmark'] as Filter[]).map((f) => {
              const n = f === 'all' ? items.length : counts[f];
              if (f !== 'all' && n === 0) return null;
              return (
                <button
                  key={f}
                  type="button"
                  className={`nb-chip${filter === f ? ' is-on' : ''}`}
                  onClick={() => setFilter(f)}
                  aria-pressed={filter === f}
                >
                  {FILTER_LABELS[f]}
                  <span className="num nb-chip__n">{fa(n)}</span>
                </button>
              );
            })}
          </div>

          {isEmpty && (
            <div className="notebook__empty">
              <p className="small">هنوز چیزی ثبت نکرده‌ای.</p>
              <p className="tiny mt-8">
                با ماژیکی هایلایت کن، از «…» یادداشت چسبان یا ویس بگذار — همه‌شان همین‌جا فهرست
                و کلیک‌پذیر می‌شوند.
              </p>
            </div>
          )}

          {!isEmpty && visible.length === 0 && (
            <p className="small notebook__nomatch">چیزی با این فیلتر یا جستجو پیدا نشد.</p>
          )}

          <ul className="nb-groups">
            {visible.map((g) => (
              <li key={`${g.inserted ? 'ins' : 'pdf'}:${g.page}`} className="nb-group">
                <button
                  type="button"
                  className={`nb-group__head${!g.inserted && g.page === page ? ' is-on' : ''}`}
                  onClick={() => onJump(g.page)}
                  title={`رفتن به صفحهٔ ${fa(g.page)}`}
                >
                  <span className="nb-group__page num">صفحهٔ {fa(g.page)}</span>
                  {g.inserted && <span className="nb-group__tag">افزوده</span>}
                  {g.strokes > 0 && <span className="nb-group__strokes num">{fa(g.strokes)} خط دست‌نویس</span>}
                  <Icon name="i-arrow-left" size={13} />
                </button>

                <ul className="nb-items">
                  {g.items.map((it) => (
                    <li key={it.key}>
                      <button
                        type="button"
                        className={`nb-item nb-item--${it.kind}`}
                        onClick={() => onJump(it.page, it.at)}
                      >
                        {it.kind === 'highlight' && (
                          <>
                            <span
                              className="nb-item__swatch"
                              style={{ background: it.color || '#F59E0B' }}
                              aria-hidden="true"
                            />
                            <span className="nb-item__label">هایلایت</span>
                          </>
                        )}
                        {it.kind === 'note' && (
                          <>
                            <span
                              className="nb-item__swatch"
                              style={{ background: NOTE_COLORS[it.color ?? 'yellow'] || '#FBBF24' }}
                              aria-hidden="true"
                            />
                            <span className="nb-item__text">{it.text || 'یادداشت خالی'}</span>
                          </>
                        )}
                        {it.kind === 'voice' && (
                          <>
                            <span className="nb-item__ico">
                              <Icon name="i-mic" size={14} />
                            </span>
                            <span className="nb-item__label">ویس</span>
                            <span className="num nb-item__dur">{fmtDuration(it.durationMs ?? 0)}</span>
                          </>
                        )}
                        {it.kind === 'bookmark' && (
                          <>
                            <span className="nb-item__ico nb-item__ico--star">
                              <Icon name="i-star" size={14} />
                            </span>
                            <span className="nb-item__label">نشان‌شده</span>
                          </>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
