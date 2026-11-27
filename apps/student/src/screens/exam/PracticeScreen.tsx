import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import './exam.css';
import { AppBar } from '../../components';
import { ErrorBlock, LoadingBlock } from '../../components/AccessStates';
import { DsBadge, DsButton, DsCard, DsChip, DsEmpty } from '../../design/components';
import { Icon } from '../../icons';
import {
  OPTION_LETTERS,
  diffTone,
  exam,
  type AnswerPayload,
  type NextPayload,
  type PracticeMode,
  type Question,
} from '../../lib/exam';
import { faDigits, faNum } from '../../lib/fa';

const DIFF_CHOICES: Array<{ code: string; label: string }> = [
  { code: '', label: 'همه سطوح' },
  { code: 'easy', label: 'آسان' },
  { code: 'medium', label: 'متوسط' },
  { code: 'hard', label: 'سخت' },
];

const MODE_TITLES: Record<PracticeMode, string> = {
  free: 'تمرین آزاد',
  weak: 'نقاط ضعف',
  hard: 'سؤالات سخت',
  wrong: 'مرور اشتباهات',
  flagged: 'سؤالات نشان‌شده',
};

/** تمرین یک‌سؤالی با پشتیبانی از فیلتر منبع، سال، نوبت، سختی و صف‌های مرور. */
export function PracticeScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const lesson = params.get('lesson') ?? undefined;
  const topic = params.get('topic') ?? undefined;
  const lessonId = params.get('lessonId') ?? undefined;
  const topicId = params.get('topicId') ?? undefined;
  const rawMode = params.get('mode') ?? 'free';
  const mode: PracticeMode =
    rawMode === 'weak' || rawMode === 'hard' || rawMode === 'wrong' || rawMode === 'flagged'
      ? rawMode
      : 'free';
  const examYearFrom = params.get('examYearFrom') ?? undefined;
  const examYearTo = params.get('examYearTo') ?? undefined;
  const examSession = params.get('examSession') ?? undefined;
  const source = params.get('source') ?? undefined;
  const initialDiff = params.get('difficulty') ?? '';
  const initialIncludeSolved =
    params.get('includeSolved') === '1' || params.get('includeSolved') === 'true';

  const [diffFilter, setDiffFilter] = useState(initialDiff);
  const [includeSolved, setIncludeSolved] = useState(initialIncludeSolved);
  const [data, setData] = useState<NextPayload | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<unknown>(null);

  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<AnswerPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [answered, setAnswered] = useState(0);
  const [flaggedIds, setFlaggedIds] = useState<Set<string>>(new Set());
  const [flagging, setFlagging] = useState(false);
  const inFlight = useRef(false);
  const seenIdsRef = useRef<string[]>([]);

  useEffect(() => {
    void exam
      .flagged()
      .then((res) => {
        if (Array.isArray(res.flagged_ids)) setFlaggedIds(new Set(res.flagged_ids));
      })
      .catch(() => {});
  }, []);

  const toggleFlag = async () => {
    const q: Question | null = data?.question ?? null;
    if (!q || flagging) return;
    setFlagging(true);
    try {
      const res = await exam.flag(q.id);
      setFlaggedIds((prev) => {
        const nextSet = new Set(prev);
        if (res.flagged) nextSet.add(q.id);
        else nextSet.delete(q.id);
        return nextSet;
      });
    } catch {
      // ignore
    } finally {
      setFlagging(false);
    }
  };

  const load = useCallback(
    async (opts?: { resetSeen?: boolean; solvedOverride?: boolean; diffOverride?: string }) => {
      if (opts?.resetSeen) {
        seenIdsRef.current = [];
      }
      setState('loading');
      setError(null);
      setSelected(null);
      setResult(null);
      try {
        const res = await exam.next({
          lesson,
          topic,
          lesson_id: lessonId,
          topic_id: topicId,
          mode,
          difficulty: opts?.diffOverride !== undefined ? opts.diffOverride || undefined : diffFilter || undefined,
          exam_year_from: examYearFrom,
          exam_year_to: examYearTo,
          exam_session: examSession,
          content_source: source ? [source] : undefined,
          include_solved: opts?.solvedOverride ?? includeSolved,
          exclude: seenIdsRef.current,
        });
        setData(res);
        setState('ready');
      } catch (err) {
        setError(err);
        setState('error');
      }
    },
    [
      lesson,
      topic,
      lessonId,
      topicId,
      mode,
      diffFilter,
      examYearFrom,
      examYearTo,
      examSession,
      source,
      includeSolved,
    ],
  );

  useEffect(() => {
    seenIdsRef.current = [];
    void load();
  }, [load]);

  const submit = async () => {
    const q: Question | null = data?.question ?? null;
    if (!q || selected === null || result || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const res = await exam.answer(q.id, selected);
      setResult(res);
      setAnswered((n) => n + 1);
    } catch (err) {
      setError(err);
      setState('error');
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  };

  const next = () => {
    const qid = data?.question?.id;
    if (qid && !seenIdsRef.current.includes(qid)) {
      seenIdsRef.current = [...seenIdsRef.current.slice(-49), qid];
    }
    void load();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!data?.question) return;
      const n = ['1', '2', '3', '4'].indexOf(e.key);
      if (n >= 0 && !result) {
        e.preventDefault();
        setSelected(n);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (result) next();
        else void submit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const q = data?.question ?? null;
  const progress = data?.progress;

  let title = MODE_TITLES[mode];
  if (mode === 'free') {
    if (topic && lesson) title = `${topic} · ${lesson}`;
    else if (lesson) title = lesson;
    else if (examYearFrom) title = `دورهٔ ${faDigits(examYearFrom)}`;
  } else if (mode === 'weak' && data?.weak_topic) {
    title = `${data.weak_topic.lesson} · ${data.weak_topic.topic || 'نقاط ضعف'}`;
  } else if (lesson) {
    title = `${MODE_TITLES[mode]} · ${lesson}`;
  }

  const metaParts = q
    ? Array.from(
        new Set(
          [
            q.difficulty_label || 'متوسط',
            q.lesson,
            q.topic && q.topic !== q.lesson ? q.topic : '',
            q.exam_session_label || (q.exam_year ? `سال ${faDigits(q.exam_year)}` : ''),
            q.content_source_label_fa,
          ].filter(Boolean),
        ),
      )
    : [];
  const isFlagged = q ? flaggedIds.has(q.id) : false;

  const activeFilterTags = [
    examYearFrom ? `سال ${faDigits(examYearFrom)}` : '',
    source ? q?.content_source_label_fa || source : '',
    includeSolved ? 'شامل حل‌شده‌ها' : '',
  ].filter(Boolean);

  return (
    <>
      <AppBar
        title={title}
        sub={
          progress && progress.total > 0
            ? mode === 'flagged' || mode === 'wrong' || includeSolved
              ? `${faNum(progress.total)} سؤال در این صف`
              : `${faNum(progress.solved_unique)} از ${faNum(progress.total)} سؤال حل شده`
            : 'در حال آماده‌سازی'
        }
        back
        onBack={() => navigate(-1)}
      />

      <div className="page page-enter exam-page">
        {mode !== 'hard' && mode !== 'weak' && (
          <div className="exam-active-filters" aria-label="فیلتر سطح تمرین">
            <span className="exam-filter-label">سطح:</span>
            {DIFF_CHOICES.map((d) => (
              <DsChip
                key={d.code || 'all'}
                selected={diffFilter === d.code}
                onClick={() => {
                  seenIdsRef.current = [];
                  setDiffFilter(d.code);
                }}
              >
                {diffTone(d.code) && (
                  <span className={`exam-diff-dot exam-diff-dot--${diffTone(d.code)}`} aria-hidden="true" />
                )}
                {d.label}
              </DsChip>
            ))}
            {activeFilterTags.map((tag) => (
              <DsBadge key={tag} tone="accent">
                {tag}
              </DsBadge>
            ))}
          </div>
        )}

        {state === 'loading' && <LoadingBlock rows={3} />}
        {state === 'error' && <ErrorBlock error={error} onRetry={() => void load()} />}

        {state === 'ready' && !q && (
          <DsCard>
            <DsEmpty
              icon={<Icon name="i-check" size={28} />}
              title={
                data?.cycle_completed
                  ? 'یک دور مرور کامل شد'
                  : mode === 'wrong'
                    ? 'اشتباه مرورنشده‌ای باقی نمانده'
                    : mode === 'flagged'
                      ? 'سؤال نشان‌شده‌ای در این محدوده نیست'
                      : 'این بخش را تمام کردید'
              }
              body={
                data?.cycle_completed
                  ? `همهٔ ${faNum(progress?.total ?? 0)} سؤال این صف را مرور کردید. می‌توانید دور جدید را از ابتدا شروع کنید.`
                  : data?.message
                    ? data.message
                    : progress && progress.total > 0
                      ? `همهٔ ${faNum(progress.total)} سؤال این محدوده را پاسخ داده‌اید.`
                      : 'در این محدوده و فیلتر فعلی سؤالی موجود نیست.'
              }
              action={
                <div className="exam-drawer-actions">
                  {data?.cycle_completed ? (
                    <DsButton
                      variant="primary"
                      onClick={() => void load({ resetSeen: true })}
                    >
                      شروع دور جدید مرور
                    </DsButton>
                  ) : (
                    progress &&
                    progress.total > 0 &&
                    !includeSolved &&
                    mode === 'free' && (
                      <DsButton
                        variant="secondary"
                        onClick={() => {
                          seenIdsRef.current = [];
                          setIncludeSolved(true);
                        }}
                      >
                        مرور دوبارهٔ سؤالات حل‌شده
                      </DsButton>
                    )
                  )}
                  <DsButton variant="primary" onClick={() => navigate('/exam')}>
                    بازگشت به بانک سؤال
                  </DsButton>
                </div>
              }
            />
          </DsCard>
        )}

        {state === 'ready' && q && (
          <div className="exam-focus">
            {progress &&
              progress.total > 0 &&
              (() => {
                const pct = Math.min(
                  100,
                  Math.max(0, Math.round((progress.solved_unique / progress.total) * 100)),
                );
                return (
                  <div
                    className="exam-progress"
                    role="progressbar"
                    aria-valuenow={progress.solved_unique}
                    aria-valuemin={0}
                    aria-valuemax={progress.total}
                    aria-label="پیشرفت در این محدوده"
                  >
                    <svg
                      className="exam-progress__svg"
                      viewBox="0 0 100 8"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      <rect
                        className="exam-progress__fill"
                        x={100 - pct}
                        y={0}
                        width={pct}
                        height={8}
                        rx={4}
                      />
                    </svg>
                  </div>
                );
              })()}

            <article className="exam-q-card">
              <div className="exam-q-header">
                <span className="exam-q-meta">{metaParts.join(' · ')}</span>
                <div className="exam-run-meta">
                  {answered > 0 && (
                    <span className="exam-q-meta">این نشست: {faNum(answered)} پاسخ</span>
                  )}
                  <button
                    type="button"
                    onClick={() => void toggleFlag()}
                    disabled={flagging}
                    className={`exam-flag-btn${isFlagged ? ' is-flagged' : ''}`}
                    title={isFlagged ? 'حذف از نشان‌شده‌ها' : 'نشان‌کردن سؤال'}
                    aria-label={isFlagged ? 'حذف از نشان‌شده‌ها' : 'نشان‌کردن سؤال'}
                    aria-pressed={isFlagged}
                  >
                    <Icon name="i-bookmark" size={16} />
                    <span>{isFlagged ? 'نشان‌شده' : 'نشان‌کردن'}</span>
                  </button>
                </div>
              </div>

              {q.image_url && (
                <img
                  className="exam-q-img"
                  src={q.image_url}
                  alt={q.image.alt_text || 'تصویر سؤال'}
                  loading="lazy"
                />
              )}

              <p className="exam-q-stem">{q.question}</p>

              <ul className="exam-options" role="radiogroup" aria-label="گزینه‌ها">
                {q.options.map((opt, i) => {
                  const isPicked = selected === i;
                  const isRight = result && result.correct_answer === i;
                  const isWrongPick = result && isPicked && !result.is_correct;
                  return (
                    <li key={i}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={isPicked}
                        className={`exam-opt${isPicked ? ' is-picked' : ''}${
                          isRight ? ' is-right' : ''
                        }${isWrongPick ? ' is-wrong' : ''}`}
                        onClick={() => !result && setSelected(i)}
                        disabled={!!result}
                      >
                        <span className="exam-opt__letter" aria-hidden="true">
                          {OPTION_LETTERS[i] ?? faNum(i + 1)}
                        </span>
                        <span className="exam-opt__text">{opt}</span>
                        {isRight && <Icon name="i-check" size={18} className="exam-opt__status" />}
                      </button>
                    </li>
                  );
                })}
              </ul>

              {result && (
                <div
                  className={`exam-feedback ${result.is_correct ? 'is-ok' : 'is-no'}`}
                  role="status"
                >
                  <p className="exam-feedback__title">
                    {result.is_correct
                      ? 'پاسخ درست بود'
                      : `پاسخ درست: گزینهٔ ${OPTION_LETTERS[result.correct_answer] ?? ''}`}
                  </p>
                  <p className="exam-feedback__body">
                    {result.explanation || 'برای این سؤال توضیحی ثبت نشده است.'}
                  </p>
                </div>
              )}

              <div className="exam-actions">
                {!result ? (
                  <DsButton
                    size="lg"
                    onClick={() => void submit()}
                    disabled={selected === null}
                    loading={busy}
                  >
                    {busy ? 'در حال ثبت…' : 'ثبت پاسخ'}
                  </DsButton>
                ) : (
                  <DsButton size="lg" onClick={next}>
                    سؤال بعدی
                  </DsButton>
                )}
                {!result && selected === null && !busy && (
                  <span className="exam-actions__hint">یک گزینه را انتخاب کنید</span>
                )}
                <span className="exam-actions__hint kbd-hint">
                  با کلیدهای ۱ تا ۴ انتخاب، Enter ثبت
                </span>
              </div>
            </article>
          </div>
        )}
      </div>
    </>
  );
}
