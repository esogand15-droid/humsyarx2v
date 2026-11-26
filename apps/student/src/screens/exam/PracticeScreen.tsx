import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import './exam.css';
import { AppBar } from '../../components';
import { ErrorBlock, LoadingBlock } from '../../components/AccessStates';
import { DsButton, DsCard, DsEmpty } from '../../design/components';
import { Icon } from '../../icons';
import {
  OPTION_LETTERS,
  exam,
  type AnswerPayload,
  type NextPayload,
  type Question,
} from '../../lib/exam';
import { faNum } from '../../lib/fa';

/** تمرین یک‌سؤالی — پاسخ صحیح فقط پس از ثبت از سرور می‌آید. */
export function PracticeScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const lesson = params.get('lesson') ?? undefined;
  const topic = params.get('topic') ?? undefined;

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

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    setSelected(null);
    setResult(null);
    try {
      const res = await exam.next(lesson, topic);
      setData(res);
      setState('ready');
    } catch (err) {
      setError(err);
      setState('error');
    }
  }, [lesson, topic]);

  useEffect(() => {
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

  const next = () => void load();

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
  const title = topic ? `${topic} · ${lesson}` : lesson || 'تمرین آزاد';
  const metaParts = q
    ? [q.difficulty_label || 'متوسط', q.topic || q.lesson, q.exam_session_label].filter(Boolean)
    : [];
  const isFlagged = q ? flaggedIds.has(q.id) : false;

  return (
    <>
      <AppBar
        title={title}
        sub={
          progress && progress.total > 0
            ? `${faNum(progress.solved_unique)} از ${faNum(progress.total)} سؤال حل شده`
            : 'در حال آماده‌سازی'
        }
        back
        onBack={() => navigate(-1)}
      />

      <div className="page page-enter exam-page">
        {state === 'loading' && <LoadingBlock rows={3} />}
        {state === 'error' && <ErrorBlock error={error} onRetry={() => void load()} />}

        {state === 'ready' && !q && (
          <DsCard>
            <DsEmpty
              icon={<Icon name="i-check" size={28} />}
              title="این بخش را تمام کردید"
              body={
                progress && progress.total > 0
                  ? `همهٔ ${faNum(progress.total)} سؤال این محدوده را پاسخ داده‌اید. برای ادامه، درس یا مبحث دیگری انتخاب کنید.`
                  : 'در این محدوده سؤالی برای ورودی و اشتراک فعلی شما ثبت نشده است.'
              }
              action={
                <DsButton variant="primary" onClick={() => navigate('/exam')}>
                  انتخاب درس دیگر
                </DsButton>
              }
            />
          </DsCard>
        )}

        {state === 'ready' && q && (
          <div className="exam-focus">
            {progress && progress.total > 0 && (() => {
              const pct = Math.min(100, Math.max(0, Math.round((progress.solved_unique / progress.total) * 100)));
              return (
                <div
                  className="exam-progress"
                  role="progressbar"
                  aria-valuenow={progress.solved_unique}
                  aria-valuemin={0}
                  aria-valuemax={progress.total}
                  aria-label="پیشرفت در این محدوده"
                >
                  <svg className="exam-progress__svg" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
                    <rect className="exam-progress__fill" x={100 - pct} y={0} width={pct} height={8} rx={4} />
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
                        {isRight && (
                          <Icon name="i-check" size={18} className="exam-opt__status" />
                        )}
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
