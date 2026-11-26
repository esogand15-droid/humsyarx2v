import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import './exam.css';
import { AppBar } from '../../components';
import { ErrorBlock, LoadingBlock } from '../../components/AccessStates';
import { DsBadge, DsButton, DsCard, DsChip, DsEmpty } from '../../design/components';
import { Icon } from '../../icons';
import { accuracyTone, exam, type LessonItem, type StatsPayload, type TopicItem } from '../../lib/exam';
import { faNum, faPercent, formatTerm } from '../../lib/fa';
import { peek, put } from '../../lib/swr';

/** تمرین — انتخاب درس و مبحث، سپس شروع تمرین یا آزمون زمان‌دار.
 *
 *  اعداد همه از سرور می‌آیند (`/exam/stats`, شمار سؤال هر درس).
 */
export function ExamHome() {
  const navigate = useNavigate();
  const [cached] = useState(() => peek<{ lessons: LessonItem[]; stats: StatsPayload | null }>('exam-home'));
  const [lessons, setLessons] = useState<LessonItem[]>(cached?.lessons ?? []);
  const [stats, setStats] = useState<StatsPayload | null>(cached?.stats ?? null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(cached ? 'ready' : 'loading');
  const [error, setError] = useState<unknown>(null);

  const [picked, setPicked] = useState<LessonItem | null>(null);
  const [topics, setTopics] = useState<TopicItem[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(false);

  const load = useCallback(async () => {
    if (!peek('exam-home')) setState('loading');
    setError(null);
    try {
      const [less, st] = await Promise.all([
        exam.lessons(),
        exam.stats().catch(() => null),
      ]);
      put('exam-home', { lessons: less.lessons ?? [], stats: st });
      setLessons(less.lessons ?? []);
      setStats(st);
      setState('ready');
    } catch (err) {
      setError(err);
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pick = async (lesson: LessonItem) => {
    if (picked?.id === lesson.id) {
      setPicked(null);
      setTopics([]);
      return;
    }
    setPicked(lesson);
    setTopics([]);
    setTopicsLoading(true);
    try {
      const res = await exam.topics(lesson.id);
      setTopics(res.topics ?? []);
    } catch {
      setTopics([]);
    } finally {
      setTopicsLoading(false);
    }
  };

  const start = (topic?: TopicItem) => {
    if (!picked) {
      navigate('/exam/practice');
      return;
    }
    const params = new URLSearchParams({ lesson: picked.name, lessonId: picked.id });
    if (topic) {
      params.set('topic', topic.name);
      params.set('topicId', topic.id);
    }
    navigate(`/exam/practice?${params.toString()}`);
  };

  const accuracy = Math.round(stats?.accuracy ?? 0);
  const tone = accuracyTone(accuracy);

  return (
    <>
      <AppBar title="تمرین" sub="بانک سؤال" back onBack={() => navigate(-1)} />
      <div className="page page-enter exam-page">
        {state === 'loading' && <LoadingBlock rows={4} />}
        {state === 'error' && <ErrorBlock error={error} onRetry={() => void load()} />}

        {state === 'ready' && (
          <div className="exam-home-grid">
            <aside className="exam-home-side">
              {stats && stats.attempts > 0 ? (
                <DsCard className="exam-stack">
                  <div className="exam-stat-head">
                    <div className="exam-stat-big">
                      <span className="exam-stat-big__num">{faPercent(accuracy)}</span>
                      <span className="exam-stat-big__sub">
                        درست از {faNum(stats.attempts)} پاسخ
                      </span>
                    </div>
                    <DsBadge tone={tone === 'good' ? 'success' : tone === 'mid' ? 'warning' : 'danger'}>
                      {faNum(stats.solved_unique)} سؤال یکتا
                    </DsBadge>
                  </div>

                  <div
                    className="exam-progress"
                    role="progressbar"
                    aria-valuenow={accuracy}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="درصد پاسخ‌های درست"
                  >
                    <svg className="exam-progress__svg" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
                      <rect
                        className={`exam-progress__fill exam-progress__fill--${tone}`}
                        x={100 - Math.min(100, Math.max(0, accuracy))}
                        y={0}
                        width={Math.min(100, Math.max(0, accuracy))}
                        height={8}
                        rx={4}
                      />
                    </svg>
                  </div>

                  <div className="exam-stat-meta">
                    <span className="exam-stat-meta__good">درست: {faNum(stats.correct)}</span>
                    <span className="exam-stat-meta__bad">غلط: {faNum(stats.wrong)}</span>
                  </div>

                  {stats.weak_topics.length > 0 && (
                    <p className="exam-weak-note">
                      نقطهٔ نیاز به مرور:{' '}
                      {stats.weak_topics
                        .slice(0, 2)
                        .map((t) => t.topic || t.lesson)
                        .join(' · ')}
                    </p>
                  )}
                </DsCard>
              ) : (
                <DsCard level="accent" className="exam-stack">
                  <h2 className="ds-card__title">شروع ارزیابی بالینی</h2>
                  <p className="ds-card__sub">
                    هنوز سؤالی پاسخ نداده‌اید. با اولین تمرین، آمار دقت و نقاط ضعف شما همین‌جا ثبت می‌شود.
                  </p>
                </DsCard>
              )}

              <DsCard className="exam-stack">
                <DsButton variant="primary" size="lg" block onClick={() => start()}>
                  <Icon name="i-play" size={18} />
                  <span>شروع تمرین آزاد</span>
                </DsButton>
                <DsButton variant="secondary" size="md" block onClick={() => navigate('/exam/setup')}>
                  <Icon name="i-clock" size={18} />
                  <span>ساخت آزمون زمان‌دار</span>
                </DsButton>
                {!picked && (
                  <p className="ds-card__sub">
                    تمرین آزاد از همهٔ درس‌های مجاز سؤال می‌آورد؛ برای تمرکز بیشتر یک درس را انتخاب کنید.
                  </p>
                )}
              </DsCard>

              <div className="exam-quick-links">
                <DsButton
                  variant="ghost"
                  size="md"
                  className="exam-btn-tall"
                  onClick={() => navigate('/exam/history')}
                >
                  <Icon name="i-clock" size={16} />
                  <span>تاریخچهٔ پاسخ‌ها</span>
                </DsButton>
                <DsButton
                  variant="ghost"
                  size="md"
                  className="exam-btn-tall"
                  onClick={() => navigate('/exam/mock/history')}
                >
                  <Icon name="i-file-text" size={16} />
                  <span>آزمون‌های قبلی</span>
                </DsButton>
              </div>
            </aside>

            <section className="exam-home-main" aria-label="فهرست درس‌های بانک سؤال">
              <div className="exam-sec-head">
                <div className="exam-sec-head__lead">
                  <Icon name="i-grid" size={18} />
                  <h2 className="exam-sec-head__title">درس‌ها</h2>
                </div>
                <DsBadge tone="accent">{faNum(lessons.length)} درس</DsBadge>
              </div>

              {lessons.length === 0 ? (
                <DsCard>
                  <DsEmpty
                    icon={<Icon name="i-book" size={28} />}
                    title="سؤالی برای ورودی شما ثبت نشده"
                    body="بانک سؤال بر پایهٔ ورودی تحصیلی و اشتراک فعال ارائه می‌شود. پس از تأیید ورودی، درس‌ها اینجا نمایش داده می‌شوند."
                    action={
                      <DsButton variant="secondary" onClick={() => navigate('/library')}>
                        مشاهدهٔ کتابخانه
                      </DsButton>
                    }
                  />
                </DsCard>
              ) : (
                <div className="exam-lesson-list">
                  {lessons.map((l) => {
                    const isOpen = picked?.id === l.id;
                    const termText = formatTerm(l.term);
                    return (
                      <DsCard
                        key={l.id}
                        level={isOpen ? 'accent' : 'default'}
                        className="exam-lesson-card"
                      >
                        <button
                          type="button"
                          className="exam-lesson-trigger"
                          aria-expanded={isOpen}
                          onClick={() => void pick(l)}
                        >
                          <span className="exam-lesson-icon" aria-hidden="true">
                            <Icon name="i-flask" size={20} />
                          </span>
                          <span className="exam-lesson-body">
                            <span className="exam-lesson-title">{l.name}</span>
                            <span className="exam-lesson-sub">
                              {faNum(l.count)} سؤال{termText ? ` · ${termText}` : ''}
                            </span>
                          </span>
                          <Icon
                            name="i-chevron"
                            size={18}
                            className={`exam-lesson-chev${isOpen ? ' is-open' : ''}`}
                          />
                        </button>

                        {isOpen && (
                          <div className="exam-lesson-drawer">
                            {topicsLoading && <p className="ds-card__sub">در حال دریافت مبحث‌ها…</p>}
                            {!topicsLoading && topics.length === 0 && (
                              <p className="ds-card__sub">
                                این درس مبحث‌بندی جداگانه ندارد؛ تمام سؤالات درس تمرین می‌شود.
                              </p>
                            )}
                            {!topicsLoading && topics.length > 0 && (
                              <div className="exam-topics-wrap">
                                {topics.map((t) => (
                                  <DsChip
                                    key={t.id}
                                    className="exam-choice-chip"
                                    onClick={() => start(t)}
                                  >
                                    <span>{t.name}</span>
                                    <span className="exam-choice-chip__count">
                                      · {faNum(t.count)}
                                    </span>
                                  </DsChip>
                                ))}
                              </div>
                            )}
                            <div>
                              <DsButton variant="primary" size="md" onClick={() => start()}>
                                <Icon name="i-play" size={16} />
                                <span>تمرین کل {l.name}</span>
                              </DsButton>
                            </div>
                          </div>
                        )}
                      </DsCard>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </>
  );
}
