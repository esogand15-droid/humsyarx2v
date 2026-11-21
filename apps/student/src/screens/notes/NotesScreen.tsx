import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AppBar, Card, EmptyState, ListRow, Pagination } from '../../components';
import type { IconName } from '../../icons';
import { ErrorBlock, LoadingBlock } from '../../components/AccessStates';
import { fa } from '../../lib/library';
import { ink, type NoteItem } from '../../lib/ink';
import { readerPath } from '../../lib/reader';

const ICON: Record<string, IconName> = {
  pdf: 'i-doc',
  video: 'i-video',
  audio: 'i-headphones',
  image: 'i-doc',
};

/** دفتر من — فایل‌هایی که روی آن‌ها نوشته‌ام (`/me/notes`، SC-061).
 *
 *  عددها از خودِ استروک‌ها می‌آید (تعداد صفحه و خط)، نه تخمین درصد.
 *  اگر فایلی از دسترس خارج شده باشد، ردیف با برچسب «در دسترس نیست»
 *  می‌ماند تا یادداشت‌ها به‌کلی ناپدید نشوند.
 */
export function NotesScreen() {
  const navigate = useNavigate();
  const [items, setItems] = useState<NoteItem[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 10;

  const load = useCallback(async () => {
    setState('loading');
    try {
      const res = await ink.notes();
      setItems(res.items ?? []);
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const displayedItems = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return items.slice(start, start + PAGE_SIZE);
  }, [items, currentPage]);

  return (
    <>
      <AppBar title="دفتر من" sub="هر چیزی که روی آن نوشته‌ای" back onBack={() => navigate(-1)} />
      <div className="page page-enter">
        {state === 'loading' && <LoadingBlock rows={3} />}

        {state === 'error' && <ErrorBlock error={null} onRetry={() => void load()} />}

        {state === 'ready' && items.length === 0 && (
          <EmptyState
            icon="i-doc"
            title="هنوز یادداشتی نداری"
            text="داخل یک جزوه، قلم را از نوار پایین انتخاب کن؛ هر خطی که بکشی همین‌جا فهرست می‌شود و روی هر دستگاهی دوباره دیده می‌شود."
          />
        )}

        {state === 'ready' && items.length > 0 && (
          <>
            <Card variant="flush" className="mt-16">
              {displayedItems.map((n) => (
                <ListRow
                  key={`${n.scope}:${n.id}`}
                  icon={ICON[n.kind] ?? 'i-doc'}
                  title={n.name}
                  sub={
                    n.available
                      ? `${fa(n.pages)} صفحه · ${fa(n.strokes)} خط · آخرین صفحه ${fa(n.last_page)}`
                      : 'این فایل دیگر در دسترس نیست — یادداشت‌ها محفوظ‌اند'
                  }
                  to={n.available ? `${readerPath(n.scope, n.id)}?p=${n.last_page}` : undefined}
                  chevron={n.available}
                />
              ))}
            </Card>

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
                className="mt-16"
              />
            )}
          </>
        )}
      </div>
    </>
  );
}
