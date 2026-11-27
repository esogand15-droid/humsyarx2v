import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import '../account.css';
import { AppBar, Pagination } from '../../components';
import { ErrorBlock, LoadingBlock } from '../../components/AccessStates';
import { DsBadge, DsButton, DsCard, DsEmpty } from '../../design/components';
import { Icon } from '../../icons';
import type { IconName } from '../../icons';
import { faNum } from '../../lib/fa';
import { ink, type NoteItem } from '../../lib/ink';
import { readerPath } from '../../lib/reader';
import { peek, put } from '../../lib/swr';

const ICON: Record<string, IconName> = {
  pdf: 'i-doc',
  video: 'i-video',
  audio: 'i-headphones',
  image: 'i-doc',
};

const PAGE_SIZE = 10;

/** دفتر من — فایل‌هایی که روی آن‌ها یادداشت نوشته‌اید (`/me/notes`).
 *
 *  Audit N1: حالت خالی با دکمهٔ اقدام اصلی «رفتن به کتابخانه».
 */
export function NotesScreen() {
  const navigate = useNavigate();
  const [items, setItems] = useState<NoteItem[]>(() => peek<NoteItem[]>('notes') ?? []);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(() => (peek('notes') ? 'ready' : 'loading'));
  const [loadErr, setLoadErr] = useState<unknown>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const load = useCallback(async () => {
    if (!peek('notes')) setState('loading');
    setLoadErr(null);
    try {
      const res = await ink.notes();
      setItems(put('notes', res.items ?? []));
      setState('ready');
    } catch (err) {
      setLoadErr(err);
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totalAnnotatedPages = useMemo(
    () => items.reduce((acc, item) => acc + (item.pages || 0), 0),
    [items],
  );
  const totalStrokes = useMemo(
    () => items.reduce((acc, item) => acc + (item.strokes || 0), 0),
    [items],
  );
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const displayedItems = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return items.slice(start, start + PAGE_SIZE);
  }, [items, currentPage]);

  return (
    <>
      <AppBar title="دفتر من" sub="هر چیزی که روی آن نوشته‌ای" back />
      <div className="page page-enter">
        {state === 'loading' && <LoadingBlock rows={4} />}
        {state === 'error' && <ErrorBlock error={loadErr} onRetry={() => void load()} />}

        {state === 'ready' && items.length === 0 && (
          <DsCard>
            <DsEmpty
              icon={<Icon name="i-pen" size={28} />}
              title="هنوز یادداشتی ندارید"
              body="داخل هر جزوه، قلم را از نوار ابزار انتخاب کنید؛ هر خط و علامتی که بکشید اینجا فهرست می‌شود و روی همهٔ دستگاه‌ها همگام می‌ماند."
              action={
                <DsButton variant="primary" size="lg" onClick={() => navigate('/library')}>
                  رفتن به کتابخانه
                </DsButton>
              }
            />
          </DsCard>
        )}

        {state === 'ready' && items.length > 0 && (
          <div className="acct-stack">
            <div className="acct-kpi-strip" aria-label="خلاصهٔ یادداشت‌ها">
              <div className="acct-kpi-tile">
                <span className="acct-kpi-tile__val">{faNum(items.length)}</span>
                <span className="acct-kpi-tile__lbl">جزوه و فایل</span>
              </div>
              <div className="acct-kpi-tile">
                <span className="acct-kpi-tile__val">{faNum(totalAnnotatedPages)}</span>
                <span className="acct-kpi-tile__lbl">صفحهٔ یادداشت‌دار</span>
              </div>
              <div className="acct-kpi-tile">
                <span className="acct-kpi-tile__val">{faNum(totalStrokes)}</span>
                <span className="acct-kpi-tile__lbl">کل خطوط</span>
              </div>
            </div>

            <div className="acct-notes-grid">
              {displayedItems.map((n) => {
                const iconName = ICON[n.kind] ?? 'i-doc';
                const inner = (
                  <>
                    <span className="ds-row__icon" aria-hidden="true">
                      <Icon name={iconName} size={20} />
                    </span>
                    <span className="ds-row__body">
                      <span className="ds-row__title">
                        <bdi dir="auto">{n.name}</bdi>
                      </span>
                      <span className="ds-row__sub">
                        {n.available
                          ? `${faNum(n.pages)} صفحه · ${faNum(n.strokes)} خط · آخرین صفحه ${faNum(n.last_page)}`
                          : 'این فایل دیگر در دسترس نیست، اما یادداشت‌ها محفوظ‌اند'}
                      </span>
                    </span>
                    {n.available ? (
                      <Icon name="i-chevron-r" size={18} className="ds-row__chev" />
                    ) : (
                      <DsBadge tone="warning">آرشیو</DsBadge>
                    )}
                  </>
                );

                return (
                  <DsCard key={`${n.scope}:${n.id}`} flush className="acct-note-card">
                    {n.available ? (
                      <Link
                        className="ds-row acct-note-row"
                        to={`${readerPath(n.scope, n.id)}?p=${n.last_page}`}
                      >
                        {inner}
                      </Link>
                    ) : (
                      <div className="ds-row acct-note-row">{inner}</div>
                    )}
                  </DsCard>
                );
              })}
            </div>

            {totalPages > 1 && (
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                totalItems={items.length}
                pageSize={PAGE_SIZE}
                onPageChange={(p) => {
                  setCurrentPage(p);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />
            )}
          </div>
        )}
      </div>
    </>
  );
}
