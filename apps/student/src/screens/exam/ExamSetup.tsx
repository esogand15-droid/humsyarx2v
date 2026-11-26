import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import './exam.css';
import { AppBar } from '../../components';
import { ErrorBlock, LoadingBlock } from '../../components/AccessStates';
import { DsBadge, DsButton, DsCard, DsChip, DsEmpty } from '../../design/components';
import { Icon } from '../../icons';
import { ApiError } from '../../lib/api';
import {
  exam,
  mockExam,
  type LessonItem,
  type MockPreview,
  type MockSummary,
  type TopicItem,
} from '../../lib/exam';
import { faDate, faNum, faPercent } from '../../lib/fa';

const COUNTS = [10, 20, 30, 50];
const MINUTES = [10, 20, 30, 45, 0];

const STATUS_LABEL: Record<string, string> = {
  active: 'در جریان',
  finished: 'تمام‌شده',
  expired: 'زمان تمام',
  abandoned: 'رها‌شده',
};

function statusBadgeTone(status: string): 'accent' | 'success' | 'warning' | 'danger' {
  if (status === 'finished') return 'success';
  if (status === 'expired') return 'warning';
  if (status === 'abandoned') return 'danger';
  return 'accent';
}

/** ساخت آزمون زمان‌دار.
 *
 *  Audit ES1: شماره‌گذاری مراحل پویا است (وقتی مبحثی نیست ۱، ۲، ۳؛ وقتی هست ۱، ۲، ۳، ۴).
 *  Audit ES2: دکمهٔ شروع وقتی درس انتخاب نشده غیرفعال با ظاهر sunken dashed + راهنمای واضح است.
 *  Audit ES3: چیدمان دوستونی در تبلت و دسکتاپ با پنل پیش‌نمایش و چیپ‌های ۴۴px.
 */
export function ExamSetup() {
  const navigate = useNavigate();

  const [lessons, setLessons] = useState<LessonItem[]>([]);
  const [topics, setTopics] = useState<TopicItem[]>([]);
  const [active, setActive] = useState<MockSummary | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<unknown>(null);

  const [pickedLesson, setPickedLesson] = useState<LessonItem | null>(null);
  const [pickedTopic, setPickedTopic] = useState<TopicItem | null>(null);
  const [count, setCount] = useState<number>(20);
  const [minutes, setMinutes] = useState<number>(20);
  const [preview, setPreview] = useState<MockPreview | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const [less, act] = await Promise.all([
        exam.lessons(),
        mockExam.active().catch(() => ({ exam: null })),
      ]);
      setLessons(less.lessons ?? []);
      setActive(act.exam ?? null);
      setState('ready');
    } catch (err) {
      setError(err);
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!pickedLesson) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await mockExam.preview({
          lesson: pickedLesson.name,
          topic: pickedTopic?.name ?? null,
          lesson_id: pickedLesson.id,
          topic_id: pickedTopic?.id ?? null,
          count,
          minutes,
          allow_smaller: true,
        });
        if (!cancelled) setPreview(res);
      } catch {
        if (!cancelled) setPreview(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pickedLesson, pickedTopic, count, minutes]);

  const pick = async (l: LessonItem) => {
    setPickedLesson(l);
    setPickedTopic(null);
    setTopics([]);
    try {
      const res = await exam.topics(l.id);
      setTopics(res.topics ?? []);
    } catch {
      setTopics([]);
    }
  };

  const start = async () => {
    if (!pickedLesson || busy) return;
    setBusy(true);
    try {
      const s = await mockExam.start({
        lesson: pickedLesson.name,
        topic: pickedTopic?.name ?? null,
        lesson_id: pickedLesson.id,
        topic_id: pickedTopic?.id ?? null,
        count,
        minutes,
        allow_smaller: true,
      });
      navigate(`/exam/run/${s.session_id}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'active_exam_exists') {
        const existing = (err.detail?.exam ?? null) as MockSummary | null;
        if (existing) {
          setActive(existing);
          setBusy(false);
          return;
        }
      }
      setError(err);
      setState('error');
    } finally {
      setBusy(false);
    }
  };

  // شمارهٔ مراحل بدون پرش بین ۱ و ۳ (ES1)
  let stepCursor = 1;
  const stepLesson = stepCursor++;
  const stepTopic = topics.length > 0 ? stepCursor++ : null;
  const stepCount = stepCursor++;
  const stepMinutes = stepCursor++;

  const canStart = Boolean(pickedLesson && (preview?.available_count ?? 0) > 0);
  const actualCount = preview ? Math.min(count, preview.available_count) : count;

  return (
    <>
      <AppBar title="آزمون" sub="زمان‌دار، بدون پاسخ در میانه" back onBack={() => navigate(-1)} />
      <div className="page page-enter exam-page">
        {state === 'loading' && <LoadingBlock rows={4} />}
        {state === 'error' && <ErrorBlock error={error} onRetry={() => void load()} />}

        {state === 'ready' && (
          <>
            {active && (
              <DsCard className="exam-banner-card">
                <div className="exam-sec-head">
                  <h2 className="exam-sec-head__title">یک آزمون نیمه‌کاره دارید</h2>
                  <DsBadge tone="warning">در جریان</DsBadge>
                </div>
                <p className="exam-hint-text">
                  {active.lesson}
                  {active.topic ? ` · ${active.topic}` : ''} — {faNum(active.answered)} از{' '}
                  {faNum(active.total)} پاسخ
                </p>
                <div className="exam-banner-actions">
                  <DsButton
                    variant="primary"
                    size="md"
                    onClick={() => navigate(`/exam/run/${active.session_id}`)}
                  >
                    ادامهٔ آزمون
                  </DsButton>
                  <DsButton
                    variant="ghost"
                    size="md"
                    onClick={async () => {
                      await mockExam.abandon(active.session_id).catch(() => undefined);
                      setActive(null);
                    }}
                  >
                    رها کردن
                  </DsButton>
                </div>
              </DsCard>
            )}

            {lessons.length === 0 ? (
              <DsCard>
                <DsEmpty
                  icon={<Icon name="i-file-text" size={28} />}
                  title="سؤالی برای ورودی شما ثبت نشده"
                  body="آزمون از همان بانک سؤال تمرین ساخته می‌شود؛ پس از ثبت سؤالات برای ورودی شما، اینجا فعال می‌شود."
                  action={
                    <DsButton variant="secondary" onClick={() => navigate('/exam')}>
                      بازگشت به تمرین
                    </DsButton>
                  }
                />
              </DsCard>
            ) : (
              <div className="exam-setup-grid">
                <div className="exam-setup-main">
                  <DsCard className="exam-step-card">
                    <div className="exam-step-head">
                      <span className="exam-step-num">{faNum(stepLesson)}</span>
                      <h2 className="exam-sec-head__title">انتخاب درس</h2>
                    </div>
                    <div className="exam-topics-wrap">
                      {lessons.map((l) => (
                        <DsChip
                          key={l.id}
                          selected={pickedLesson?.id === l.id}
                          className="exam-choice-chip"
                          onClick={() => void pick(l)}
                        >
                          <span>{l.name}</span>
                          <span className="exam-choice-chip__count">· {faNum(l.count)}</span>
                        </DsChip>
                      ))}
                    </div>
                  </DsCard>

                  {stepTopic !== null && (
                    <DsCard className="exam-step-card">
                      <div className="exam-sec-head">
                        <div className="exam-step-head">
                          <span className="exam-step-num">{faNum(stepTopic)}</span>
                          <h2 className="exam-sec-head__title">مبحث</h2>
                        </div>
                        <span className="exam-sec-head__sub">اختیاری</span>
                      </div>
                      <div className="exam-topics-wrap">
                        <DsChip
                          selected={!pickedTopic}
                          className="exam-choice-chip"
                          onClick={() => setPickedTopic(null)}
                        >
                          همهٔ درس
                        </DsChip>
                        {topics.map((t) => (
                          <DsChip
                            key={t.id}
                            selected={pickedTopic?.id === t.id}
                            className="exam-choice-chip"
                            onClick={() => setPickedTopic(t)}
                          >
                            <span>{t.name}</span>
                            <span className="exam-choice-chip__count">· {faNum(t.count)}</span>
                          </DsChip>
                        ))}
                      </div>
                    </DsCard>
                  )}

                  <DsCard className="exam-step-card">
                    <div className="exam-step-head">
                      <span className="exam-step-num">{faNum(stepCount)}</span>
                      <h2 className="exam-sec-head__title">تعداد سؤال</h2>
                    </div>
                    <div className="exam-topics-wrap">
                      {COUNTS.map((c) => (
                        <DsChip
                          key={c}
                          selected={count === c}
                          className="exam-choice-chip"
                          onClick={() => setCount(c)}
                        >
                          {faNum(c)} سؤال
                        </DsChip>
                      ))}
                    </div>
                  </DsCard>

                  <DsCard className="exam-step-card">
                    <div className="exam-step-head">
                      <span className="exam-step-num">{faNum(stepMinutes)}</span>
                      <h2 className="exam-sec-head__title">مدت زمان</h2>
                    </div>
                    <div className="exam-topics-wrap">
                      {MINUTES.map((m) => (
                        <DsChip
                          key={m}
                          selected={minutes === m}
                          className="exam-choice-chip"
                          onClick={() => setMinutes(m)}
                        >
                          {m === 0 ? 'بدون زمان' : `${faNum(m)} دقیقه`}
                        </DsChip>
                      ))}
                    </div>
                  </DsCard>
                </div>

                <aside className="exam-setup-side">
                  <DsCard level="raised" className="exam-stack">
                    <div className="exam-sec-head">
                      <h2 className="exam-sec-head__title">خلاصهٔ آزمون</h2>
                      {pickedLesson && preview && (
                        <DsBadge
                          tone={
                            preview.available_count === 0
                              ? 'danger'
                              : preview.can_start
                                ? 'success'
                                : 'warning'
                          }
                        >
                          {faNum(preview.available_count)} سؤال موجود
                        </DsBadge>
                      )}
                    </div>

                    <ul className="exam-summary-list">
                      <li className="exam-summary-row">
                        <span className="exam-summary-row__k">درس</span>
                        <span className="exam-summary-row__v">
                          {pickedLesson ? pickedLesson.name : 'انتخاب نشده'}
                        </span>
                      </li>
                      {topics.length > 0 && (
                        <li className="exam-summary-row">
                          <span className="exam-summary-row__k">مبحث</span>
                          <span className="exam-summary-row__v">
                            {pickedTopic ? pickedTopic.name : 'همهٔ مباحث درس'}
                          </span>
                        </li>
                      )}
                      <li className="exam-summary-row">
                        <span className="exam-summary-row__k">تعداد سؤال</span>
                        <span className="exam-summary-row__v">{faNum(actualCount)} سؤال</span>
                      </li>
                      <li className="exam-summary-row">
                        <span className="exam-summary-row__k">زمان</span>
                        <span className="exam-summary-row__v">
                          {minutes === 0 ? 'بدون محدودیت' : `${faNum(minutes)} دقیقه`}
                        </span>
                      </li>
                    </ul>

                    {pickedLesson && (
                      <p className="exam-hint-text">
                        {preview
                          ? preview.available_count === 0
                            ? 'برای این مبحث هنوز سؤالی ثبت نشده است؛ مبحث یا درس دیگری را انتخاب کنید.'
                            : preview.can_start
                              ? `آزمون با ${faNum(actualCount)} سؤال از ${faNum(preview.available_count)} سؤال موجود ساخته می‌شود.`
                              : `ظرفیت کمتر از ${faNum(count)} است؛ آزمون با ${faNum(preview.available_count)} سؤال ساخته می‌شود.`
                          : 'در حال بررسی ظرفیت بانک سؤال…'}
                      </p>
                    )}

                    <div className="exam-actions">
                      <DsButton
                        size="lg"
                        block
                        onClick={() => void start()}
                        disabled={!canStart}
                        loading={busy}
                      >
                        {busy ? 'در حال ساخت آزمون…' : 'شروع آزمون'}
                      </DsButton>
                      {!pickedLesson && (
                        <span className="exam-actions__hint">
                          ابتدا یک درس انتخاب کنید تا شروع آزمون فعال شود
                        </span>
                      )}
                    </div>

                    <p className="ds-card__sub">
                      در جریان آزمون پاسخ صحیح نمایش داده نمی‌شود؛ کارنامه و بازبینی پس از پایان در دسترس است.
                    </p>
                  </DsCard>

                  <DsButton
                    variant="ghost"
                    size="md"
                    block
                    className="exam-btn-tall"
                    onClick={() => navigate('/exam/mock/history')}
                  >
                    <Icon name="i-clock" size={16} />
                    <span>مشاهدهٔ آزمون‌های قبلی</span>
                  </DsButton>
                </aside>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

/** فهرست آزمون‌های قبلی — خلاصهٔ آماری و برچسب‌های وضعیت معنایی (Audit E4). */
export function MockExamHistory() {
  const navigate = useNavigate();
  const [items, setItems] = useState<MockSummary[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    (async () => {
      try {
        const res = await mockExam.history();
        setItems(res.exams ?? []);
        setState('ready');
      } catch {
        setState('error');
      }
    })();
  }, []);

  const completed = items.filter((e) => e.status === 'finished' || e.status === 'expired');
  const finishedCount = items.filter((e) => e.status === 'finished').length;
  const avgPct =
    completed.length > 0
      ? Math.round(completed.reduce((acc, e) => acc + (e.percentage || 0), 0) / completed.length)
      : null;

  return (
    <>
      <AppBar title="آزمون‌های قبلی" sub="کارنامه و بازبینی" back onBack={() => navigate(-1)} />
      <div className="page page-enter exam-page">
        {state === 'loading' && <LoadingBlock rows={3} />}
        {state === 'error' && <ErrorBlock error={null} onRetry={() => navigate(0)} />}
        {state === 'ready' && items.length === 0 && (
          <DsCard>
            <DsEmpty
              icon={<Icon name="i-clock" size={28} />}
              title="هنوز آزمونی نداده‌اید"
              body="اولین آزمون زمان‌دار خود را بسازید تا کارنامه و روند پیشرفتتان اینجا ثبت شود."
              action={
                <DsButton variant="primary" onClick={() => navigate('/exam/setup')}>
                  ساخت آزمون تازه
                </DsButton>
              }
            />
          </DsCard>
        )}
        {state === 'ready' && items.length > 0 && (
          <div className="exam-stack">
            <div className="exam-kpi-strip" aria-label="خلاصهٔ آزمون‌ها">
              <div className="exam-kpi-tile">
                <span className="exam-kpi-tile__val">{faNum(items.length)}</span>
                <span className="exam-kpi-tile__lbl">کل آزمون‌ها</span>
              </div>
              <div className="exam-kpi-tile">
                <span className="exam-kpi-tile__val exam-kpi-tile__val--good">
                  {faNum(finishedCount)}
                </span>
                <span className="exam-kpi-tile__lbl">تمام‌شده</span>
              </div>
              <div className="exam-kpi-tile">
                <span className="exam-kpi-tile__val exam-kpi-tile__val--accent">
                  {avgPct !== null ? faPercent(avgPct) : '—'}
                </span>
                <span className="exam-kpi-tile__lbl">میانگین نمره</span>
              </div>
            </div>

            <DsCard flush>
              <div className="ds-list">
                {items.map((e) => {
                  const dateLabel = faDate(e.finished_at || e.started_at);
                  return (
                    <button
                      key={e.session_id}
                      type="button"
                      className="exam-mock-row"
                      onClick={() =>
                        navigate(
                          e.status === 'active'
                            ? `/exam/run/${e.session_id}`
                            : `/exam/result/${e.session_id}`,
                        )
                      }
                    >
                      <span className="exam-mock-row__body">
                        <span className="exam-mock-row__title">
                          {e.lesson}
                          {e.topic ? ` · ${e.topic}` : ''}
                        </span>
                        <span className="exam-mock-row__meta">
                          {faNum(e.answered)} از {faNum(e.total)} پاسخ
                          {e.status !== 'active' ? ` · ${faPercent(Math.round(e.percentage))}` : ''}
                          {dateLabel ? ` · ${dateLabel}` : ''}
                        </span>
                      </span>
                      <DsBadge tone={statusBadgeTone(e.status)}>
                        {STATUS_LABEL[e.status] ?? e.status}
                      </DsBadge>
                    </button>
                  );
                })}
              </div>
            </DsCard>
          </div>
        )}
      </div>
    </>
  );
}
