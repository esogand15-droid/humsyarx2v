import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import './exam.css';
import { AppBar } from '../../components';
import { ErrorBlock, LoadingBlock } from '../../components/AccessStates';
import { DsBadge, DsButton } from '../../design/components';
import { Icon } from '../../icons';
import { ApiError } from '../../lib/api';
import {
  OPTION_LETTERS,
  clockFa,
  exam,
  mockExam,
  type MockNext,
  type MockSummary,
} from '../../lib/exam';
import { faNum } from '../../lib/fa';

/** اجرای آزمون زمان‌دار.
 *
 *  ۱) مهلت از سرور می‌آید (`seconds_left`)؛ شمارش محلی فقط نمایشی است.
 *  ۲) در میانهٔ آزمون پاسخ صحیح نمایش داده نمی‌شود.
 *  ۳) رفرش صفحه آزمون را از بین نمی‌برد؛ وضعیت از `/mock/{id}` می‌آید.
 */
export function MockRun() {
  const { sid = '' } = useParams();
  const navigate = useNavigate();

  const [summary, setSummary] = useState<MockSummary | null>(null);
  const [current, setCurrent] = useState<MockNext | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<unknown>(null);

  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [flaggedIds, setFlaggedIds] = useState<Set<string>>(new Set());
  const [flagging, setFlagging] = useState(false);
  const sending = useRef(false);

  useEffect(() => {
    void exam
      .flagged()
      .then((res) => {
        if (Array.isArray(res.flagged_ids)) setFlaggedIds(new Set(res.flagged_ids));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!confirmLeave) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirmLeave(false);
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [confirmLeave]);

  const toggleFlag = async () => {
    const qid = current?.question?.id;
    if (!qid || flagging) return;
    setFlagging(true);
    try {
      const res = await exam.flag(qid);
      setFlaggedIds((prev) => {
        const nextSet = new Set(prev);
        if (res.flagged) nextSet.add(qid);
        else nextSet.delete(qid);
        return nextSet;
      });
    } catch {
      // ignore
    } finally {
      setFlagging(false);
    }
  };

  const goResult = useCallback(
    () => navigate(`/exam/result/${sid}`, { replace: true }),
    [navigate, sid],
  );

  const boot = useCallback(async () => {
    setState('loading');
    try {
      const [s, n] = await Promise.all([mockExam.session(sid), mockExam.next(sid)]);
      setSummary(s);
      if (n.finished) {
        goResult();
        return;
      }
      setCurrent(n);
      setLeft(typeof n.seconds_left === 'number' ? n.seconds_left : null);
      setState('ready');
    } catch (err) {
      setError(err);
      setState('error');
    }
  }, [sid, goResult]);

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    if (left === null) return;
    if (left <= 0) {
      void (async () => {
        try {
          const n = await mockExam.next(sid);
          if (n.finished) goResult();
        } catch {
          goResult();
        }
      })();
      return;
    }
    const t = window.setTimeout(() => setLeft((v) => (v === null ? null : v - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [left, sid, goResult]);

  const pick = (i: number) => {
    if (busy) return;
    setSelected(i);
  };

  const submit = async () => {
    if (selected === null || busy || sending.current || !current?.question) return;
    sending.current = true;
    setBusy(true);
    try {
      const res = await mockExam.answer(sid, selected);
      setSelected(null);
      if (res.finished) {
        goResult();
        return;
      }
      const n = await mockExam.next(sid);
      if (n.finished) {
        goResult();
        return;
      }
      setCurrent(n);
      setLeft(typeof n.seconds_left === 'number' ? n.seconds_left : null);
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.code === 'exam_not_active' || err.code === 'exam_still_active')
      ) {
        goResult();
        return;
      }
      setError(err);
      setState('error');
    } finally {
      setBusy(false);
      sending.current = false;
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (busy || confirmLeave || !current?.question) return;
      const n = ['1', '2', '3', '4'].indexOf(e.key);
      if (n >= 0) {
        e.preventDefault();
        setSelected(n);
      }
      if (e.key === 'Enter' && selected !== null) {
        e.preventDefault();
        void submit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const q = current?.question;
  const progress = current?.progress ?? 0;
  const total = current?.total ?? summary?.total ?? 0;
  const urgent = left !== null && left <= 60;
  const isFlagged = q ? flaggedIds.has(q.id) : false;
  const metaParts = q
    ? [q.difficulty_label || 'متوسط', q.topic || q.lesson, q.exam_session_label].filter(Boolean)
    : [];

  return (
    <>
      <AppBar
        title={summary?.lesson || 'آزمون'}
        sub={summary?.topic || 'آزمون زمان‌دار'}
        back
        onBack={() => setConfirmLeave(true)}
        actions={
          left !== null ? (
            <span className={`exam-timer${urgent ? ' is-urgent' : ''}`} aria-live="off">
              <Icon name="i-clock" size={16} />
              <bdi dir="ltr">{clockFa(left)}</bdi>
            </span>
          ) : undefined
        }
      />

      <div className="page page-enter exam-page">
        {state === 'loading' && <LoadingBlock rows={3} />}
        {state === 'error' && <ErrorBlock error={error} onRetry={() => void boot()} />}

        {state === 'ready' && q && (
          <div className="exam-focus">
            <div className="exam-run-meta">
              <DsBadge tone="accent">
                سؤال {faNum(progress)} از {faNum(total)}
              </DsBadge>
              {summary?.exam_code && (
                <span className="exam-code-pill">
                  <span>کد آزمون:</span>
                  <bdi dir="ltr">{summary.exam_code}</bdi>
                </span>
              )}
              <span className="exam-run-meta__spacer" />
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

            {(() => {
              const denom = Math.max(1, total);
              const val = Math.max(0, progress - 1);
              const pct = Math.min(100, Math.max(0, Math.round((val / denom) * 100)));
              return (
                <div
                  className="exam-progress"
                  role="progressbar"
                  aria-valuenow={val}
                  aria-valuemin={0}
                  aria-valuemax={denom}
                  aria-label="پیشرفت آزمون"
                >
                  <svg className="exam-progress__svg" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
                    <rect className="exam-progress__fill" x={100 - pct} y={0} width={pct} height={8} rx={4} />
                  </svg>
                </div>
              );
            })()}

            <article className="exam-q-card">
              <div className="exam-q-header">
                <span className="exam-q-meta">
                  {metaParts.length > 0
                    ? metaParts.join(' · ')
                    : 'پاسخ صحیح پس از پایان آزمون نمایش داده می‌شود'}
                </span>
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
                {q.options.map((opt, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected === i}
                      className={`exam-opt${selected === i ? ' is-picked' : ''}`}
                      onClick={() => pick(i)}
                    >
                      <span className="exam-opt__letter" aria-hidden="true">
                        {OPTION_LETTERS[i] ?? faNum(i + 1)}
                      </span>
                      <span className="exam-opt__text">{opt}</span>
                    </button>
                  </li>
                ))}
              </ul>

              <div className="exam-actions">
                <DsButton
                  size="lg"
                  onClick={() => void submit()}
                  disabled={selected === null}
                  loading={busy}
                >
                  {busy
                    ? 'در حال ثبت…'
                    : progress >= total
                      ? 'ثبت و پایان آزمون'
                      : 'ثبت و سؤال بعدی'}
                </DsButton>
                {selected === null && !busy && (
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

      {confirmLeave && (
        <div
          className="exam-dialog-scrim"
          role="dialog"
          aria-modal="true"
          aria-label="خروج از آزمون"
          onClick={() => setConfirmLeave(false)}
        >
          <div className="exam-dialog" onClick={(e) => e.stopPropagation()}>
            <h2 className="exam-dialog__title">از آزمون بیرون می‌روید؟</h2>
            <p className="exam-dialog__body">
              پاسخ‌های ثبت‌شدهٔ شما ذخیره شده‌اند و از بخش «آزمون» می‌توانید ادامه دهید؛ زمان آزمون
              همچنان در حال گذشتن است.
            </p>
            <div className="exam-dialog__actions">
              <DsButton variant="primary" size="md" onClick={() => setConfirmLeave(false)}>
                ادامهٔ آزمون
              </DsButton>
              <DsButton
                variant="ghost"
                size="md"
                onClick={() => navigate('/exam', { replace: true })}
              >
                خروج موقت
              </DsButton>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
