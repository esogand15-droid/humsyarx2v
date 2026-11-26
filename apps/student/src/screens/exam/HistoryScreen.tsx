import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import './exam.css';
import { AppBar, Pagination } from '../../components';
import { ErrorBlock, LoadingBlock } from '../../components/AccessStates';
import { DsBadge, DsButton, DsCard, DsEmpty } from '../../design/components';
import { Icon } from '../../icons';
import { OPTION_LETTERS, exam, type HistoryPayload } from '../../lib/exam';
import { faDate, faNum, faPercent } from '../../lib/fa';

const PAGE_SIZE = 10;

/** تاریخچهٔ پاسخ‌ها — با نوار خلاصهٔ آماری، نشانگر معنایی درست/غلط و CTA حالت خالی (EH1, E4). */
export function HistoryScreen() {
  const navigate = useNavigate();
  const [data, setData] = useState<HistoryPayload | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [more, setMore] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const load = useCallback(
    async (append: boolean, cursor?: string | null) => {
      if (append) setMore(true);
      else {
        setState('loading');
        setCurrentPage(1);
      }
      try {
        const res = await exam.history(20);
        if (append && data && cursor) {
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
    },
    [data],
  );

  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalAnswers = data?.answers?.length || 0;
  const correctCount = useMemo(
    () => (data?.answers ?? []).filter((a) => a.is_correct).length,
    [data?.answers],
  );
  const accuracyPct = totalAnswers > 0 ? Math.round((correctCount / totalAnswers) * 100) : 0;
  const totalPages = Math.max(1, Math.ceil(totalAnswers / PAGE_SIZE));
  const displayedAnswers = useMemo(() => {
    if (!data?.answers) return [];
    const start = (currentPage - 1) * PAGE_SIZE;
    return data.answers.slice(start, start + PAGE_SIZE);
  }, [data?.answers, currentPage]);

  return (
    <>
      <AppBar title="تاریخچهٔ پاسخ‌ها" sub="هر چه پاسخ داده‌ای" back onBack={() => navigate(-1)} />
      <div className="page page-enter exam-page">
        {state === 'loading' && <LoadingBlock rows={4} />}
        {state === 'error' && <ErrorBlock error={null} onRetry={() => void load(false)} />}

        {state === 'ready' && data && data.answers.length === 0 && (
          <DsCard>
            <DsEmpty
              icon={<Icon name="i-clock" size={28} />}
              title="هنوز پاسخی ثبت نشده"
              body="بعد از اولین تمرین، همهٔ پاسخ‌ها همراه با گزینهٔ صحیح و توضیحات همین‌جا فهرست می‌شوند."
              action={
                <DsButton variant="primary" onClick={() => navigate('/exam')}>
                  شروع تمرین
                </DsButton>
              }
            />
          </DsCard>
        )}

        {state === 'ready' && data && data.answers.length > 0 && (
          <div className="exam-stack">
            <div className="exam-kpi-strip" aria-label="خلاصهٔ پاسخ‌ها">
              <div className="exam-kpi-tile">
                <span className="exam-kpi-tile__val">{faNum(data.total ?? totalAnswers)}</span>
                <span className="exam-kpi-tile__lbl">کل پاسخ‌ها</span>
              </div>
              <div className="exam-kpi-tile">
                <span className="exam-kpi-tile__val exam-kpi-tile__val--good">
                  {faNum(correctCount)}
                </span>
                <span className="exam-kpi-tile__lbl">پاسخ درست</span>
              </div>
              <div className="exam-kpi-tile">
                <span className="exam-kpi-tile__val exam-kpi-tile__val--accent">
                  {faPercent(accuracyPct)}
                </span>
                <span className="exam-kpi-tile__lbl">نرخ دقت</span>
              </div>
            </div>

            <div className="exam-sec-head">
              <span className="exam-sec-head__sub">
                {faNum(data.total ?? totalAnswers)} پاسخ ثبت‌شده در کارنامه
              </span>
              {totalPages > 1 && (
                <span className="exam-sec-head__sub">
                  صفحه {faNum(currentPage)} از {faNum(totalPages)}
                </span>
              )}
            </div>

            <div className="exam-history-grid">
              {displayedAnswers.map((a) => (
                <DsCard key={a.id} className="exam-history-card">
                  <div className="exam-review-card__top">
                    <DsBadge tone={a.is_correct ? 'success' : 'danger'}>
                      {a.is_correct ? 'درست' : 'غلط'}
                    </DsBadge>
                    <span className="exam-sec-head__sub">{faDate(a.answered_at)}</span>
                  </div>

                  <div className="exam-q-meta">{a.topic || a.lesson}</div>
                  <p className="exam-history-q">{a.question}</p>

                  <div className="exam-review-answers">
                    <span className={a.is_correct ? 'exam-review-ans--ok' : 'exam-review-ans--no'}>
                      پاسخ شما: {OPTION_LETTERS[a.selected] ?? faNum(a.selected)}
                    </span>
                    {!a.is_correct && (
                      <span className="exam-review-ans--ok">
                        پاسخ درست: {OPTION_LETTERS[a.correct_answer] ?? faNum(a.correct_answer)}
                      </span>
                    )}
                  </div>
                </DsCard>
              ))}
            </div>

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
              />
            )}

            {data.has_more && (
              <div>
                <DsButton
                  variant="ghost"
                  size="md"
                  loading={more}
                  onClick={() => void load(true, data.next_cursor)}
                >
                  {more ? 'در حال دریافت موارد قدیمی‌تر…' : 'بارگذاری سؤالات قدیمی‌تر'}
                </DsButton>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
