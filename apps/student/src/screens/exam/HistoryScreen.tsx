import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AppBar, Card, Chip, EmptyState, Pagination } from '../../components';
import { ErrorBlock, LoadingBlock } from '../../components/AccessStates';
import { fa } from '../../lib/library';
import { OPTION_LETTERS, exam, type HistoryPayload } from '../../lib/exam';

const when = (iso: string): string => {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('fa-IR', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return '';
  }
};

/** تاریخچهٔ پاسخ‌ها — همان `/api/questions/history` با ورود وب.
    هر ردیف: صورت کوتاه سؤال، انتخاب تو، پاسخ درست، و زمان. */
export function HistoryScreen() {
  const navigate = useNavigate();
  const [data, setData] = useState<HistoryPayload | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [more, setMore] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 8;

  const load = useCallback(async (append = false, cursor?: string | null) => {
    if (!append) setState('loading');
    else setMore(true);
    try {
      const res = await exam.history(50);
      void cursor;
      if (append && data) {
        setData({ ...res, answers: [...data.answers, ...res.answers] });
      } else {
        setData(res);
      }
      setState('ready');
    } catch {
      setState('error');
    } finally {
      setMore(false);
    }
  }, [data]);

  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalAnswers = data?.answers?.length || 0;
  const totalPages = Math.max(1, Math.ceil(totalAnswers / PAGE_SIZE));
  const displayedAnswers = useMemo(() => {
    if (!data?.answers) return [];
    const start = (currentPage - 1) * PAGE_SIZE;
    return data.answers.slice(start, start + PAGE_SIZE);
  }, [data?.answers, currentPage]);

  return (
    <>
      <AppBar title="تاریخچهٔ پاسخ‌ها" sub="هر چه پاسخ داده‌ای" back onBack={() => navigate(-1)} />
      <div className="page page-enter">
        {state === 'loading' && <LoadingBlock rows={4} />}
        {state === 'error' && <ErrorBlock error={null} onRetry={() => void load(false)} />}

        {state === 'ready' && data && data.answers.length === 0 && (
          <EmptyState
            icon="i-clock"
            title="هنوز پاسخی ثبت نشده"
            text="بعد از اولین تمرین، همهٔ پاسخ‌ها با پاسخ صحیح همین‌جا می‌آیند."
          />
        )}

        {state === 'ready' && data && data.answers.length > 0 && (
          <>
            <div className="row gap-8" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <p className="tiny mt-12">{fa(data.total ?? totalAnswers)} پاسخ ثبت‌شده در کارنامه</p>
              {totalPages > 1 && (
                <span className="tiny num text-muted">صفحه {fa(currentPage)} از {fa(totalPages)}</span>
              )}
            </div>

            <Card variant="flush" className="mt-8">
              {displayedAnswers.map((a) => (
                <div key={a.id} className="hist list__item--interactive">
                  <div className="row gap-8" style={{ alignItems: 'center' }}>
                    <Chip variant={a.is_correct ? 'cyan' : 'quiet'} icon={a.is_correct ? 'i-check' : undefined}>
                      {a.is_correct ? 'درست' : 'غلط'}
                    </Chip>
                    <span className="tiny grow">{a.topic || a.lesson}</span>
                    <span className="tiny num">{when(a.answered_at)}</span>
                  </div>
                  <p className="small mt-8 hist__q">{a.question}</p>
                  <p className="tiny mt-8">
                    پاسخ تو: {OPTION_LETTERS[a.selected] ?? a.selected} · پاسخ درست:{' '}
                    {OPTION_LETTERS[a.correct_answer] ?? a.correct_answer}
                  </p>
                </div>
              ))}
            </Card>

            {totalPages > 1 && (
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                totalItems={totalAnswers}
                pageSize={PAGE_SIZE}
                onPageChange={(p) => {
                  setCurrentPage(p);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="mt-16"
              />
            )}

            {data.has_more && (
              <button
                type="button"
                className="btn btn--ghost mt-16"
                onClick={() => void load(true, data.next_cursor)}
                disabled={more}
              >
                {more ? 'در حال دریافت موارد قدیمی‌تر…' : 'بارگذاری سؤالات قدیمی‌تر'}
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
}
