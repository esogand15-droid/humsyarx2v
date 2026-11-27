import { useCallback, useEffect, useRef, useState } from 'react';
import './exam.css';
import { AppBar, Toast } from '../../components';
import { ErrorBlock, LoadingBlock } from '../../components/AccessStates';
import { DsBadge, DsButton, DsCard, DsChip, DsEmpty } from '../../design/components';
import { Icon } from '../../icons';
import { errorText } from '../../lib/api';
import {
  OPTION_LETTERS,
  pdfQuizApi,
  type PdfQuizQuestion,
  type PdfQuizSession,
  type QuizDocItem,
} from '../../lib/exam';
import { faNum, faPercent } from '../../lib/fa';

export function PdfQuizScreen() {
  const [config, setConfig] = useState<{
    enabled: boolean;
    max_pdf_mb: number;
    max_pages: number;
    max_questions_per_session: number;
    daily_limit: number;
    used_today: number;
    remaining_today: number;
  } | null>(null);
  const [docs, setDocs] = useState<QuizDocItem[]>([]);
  const [sessions, setSessions] = useState<PdfQuizSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // سازنده آزمون برای یک سند آماده
  const [pickedDoc, setPickedDoc] = useState<QuizDocItem | null>(null);
  const [scopeMode, setScopeMode] = useState<'all' | 'topic' | 'range'>('all');
  const [topicId, setTopicId] = useState<number | null>(null);
  const [pageFrom, setPageFrom] = useState('1');
  const [pageTo, setPageTo] = useState('10');
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard' | 'mixed'>('mixed');
  const [starting, setStarting] = useState(false);

  // اجرای کوییز تعاملی
  const [activeSession, setActiveSession] = useState<PdfQuizSession | null>(null);
  const [questions, setQuestions] = useState<PdfQuizQuestion[]>([]);
  const [qIdx, setQIdx] = useState(0);
  const [answering, setAnswering] = useState(false);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cfg, dRes, sRes] = await Promise.all([
        pdfQuizApi.config(),
        pdfQuizApi.docs(),
        pdfQuizApi.sessions().catch(() => ({ sessions: [] })),
      ]);
      setConfig(cfg);
      setDocs(dRes.docs || []);
      setSessions(sRes.sessions || []);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // اگر سندی در حال پردازش است، وضعیت را هر ۲ ثانیه بررسی کن
  useEffect(() => {
    const processing = docs.filter((d) => d.status === 'processing');
    if (processing.length === 0) return;
    const timer = window.setTimeout(() => {
      void pdfQuizApi
        .docs()
        .then((res) => setDocs(res.docs || []))
        .catch(() => {});
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [docs]);

  const handleUpload = async (file: File | undefined) => {
    if (!file || uploading) return;
    setUploading(true);
    try {
      await pdfQuizApi.upload(file);
      flash('فایل PDF دریافت شد و در حال استخراج مباحث است…');
      await load();
    } catch (e) {
      flash(errorText(e, 'آپلود PDF انجام نشد.'));
    } finally {
      setUploading(false);
    }
  };

  const deleteDoc = async (docId: string) => {
    try {
      await pdfQuizApi.deleteDoc(docId);
      if (pickedDoc?.id === docId) setPickedDoc(null);
      flash('فایل PDF حذف شد.');
      await load();
    } catch (e) {
      flash(errorText(e));
    }
  };

  const openQuizSession = async (sid: string) => {
    try {
      const res = await pdfQuizApi.session(sid);
      setActiveSession(res.session);
      setQuestions(res.questions || []);
      const firstUnanswered = (res.questions || []).findIndex((q) => q.status !== 'answered');
      setQIdx(firstUnanswered >= 0 ? firstUnanswered : 0);
    } catch (e) {
      flash(errorText(e));
    }
  };

  const startQuiz = async () => {
    if (!pickedDoc || starting) return;
    setStarting(true);
    try {
      const body: {
        doc_id: string;
        topic_id?: number;
        page_from?: number;
        page_to?: number;
        count: number;
        difficulty: 'easy' | 'medium' | 'hard' | 'mixed';
      } = {
        doc_id: pickedDoc.id,
        count,
        difficulty,
      };
      if (scopeMode === 'topic' && topicId !== null) body.topic_id = topicId;
      if (scopeMode === 'range') {
        body.page_from = Math.max(1, Number(pageFrom) || 1);
        body.page_to = Math.max(body.page_from, Number(pageTo) || body.page_from);
      }
      const res = await pdfQuizApi.startSession(body);
      setPickedDoc(null);
      await openQuizSession(res.session_id);
      await load();
    } catch (e) {
      flash(errorText(e, 'ساخت آزمون ناموفق بود.'));
    } finally {
      setStarting(false);
    }
  };

  const submitAnswer = async (selectedIdx: number) => {
    if (!activeSession || answering) return;
    const currentQ = questions[qIdx];
    if (!currentQ || currentQ.status === 'answered') return;
    setAnswering(true);
    try {
      const res = await pdfQuizApi.answer(activeSession.id, currentQ.id, selectedIdx);
      setQuestions((prev) => prev.map((q) => (q.id === currentQ.id ? res.question : q)));
      setActiveSession(res.session);
    } catch (e) {
      flash(errorText(e));
    } finally {
      setAnswering(false);
    }
  };

  return (
    <>
      <AppBar
        title="آزمون‌ساز هوشمند از روی PDF"
        sub="آپلود جزوه و طراحی آزمون تستی با پاسخ تشریحی و شماره صفحه"
        back
        onBack={() => {
          if (activeSession) {
            setActiveSession(null);
            setQuestions([]);
          } else {
            window.history.back();
          }
        }}
      />

      <div className="page page-enter exam-page">
        {loading && <LoadingBlock rows={3} />}
        {!loading && error != null && <ErrorBlock error={error} onRetry={load} />}

        {/* ── حالت اجرای کوییز تعاملی ── */}
        {!loading && activeSession && questions.length > 0 && (() => {
          const q = questions[Math.min(qIdx, questions.length - 1)];
          const isAnswered = q.status === 'answered';
          const pct = activeSession.answered > 0
            ? Math.round((activeSession.correct / activeSession.answered) * 100)
            : 0;

          return (
            <div className="exam-stack">
              <DsCard level="accent">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <strong className="small">{activeSession.doc_name}</strong>
                    <div className="tiny muted">
                      سؤال {faNum(qIdx + 1)} از {faNum(questions.length)} · پاسخ‌داده‌شده: {faNum(activeSession.answered)}
                    </div>
                  </div>
                  <DsBadge tone="success">
                    درست: {faNum(activeSession.correct)} ({faPercent(pct)})
                  </DsBadge>
                </div>
              </DsCard>

              <DsCard className="exam-stack">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  {q.topic_title && <DsBadge tone="accent">{q.topic_title}</DsBadge>}
                  {q.page_refs?.length ? (
                    <DsBadge tone="neutral">صفحهٔ مرجع: {q.page_refs.map((p) => faNum(p)).join('، ')}</DsBadge>
                  ) : null}
                </div>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 700, lineHeight: 1.8 }}>{q.stem}</p>

                <ul className="exam-options">
                  {q.options.map((opt, idx) => {
                    const isPicked = isAnswered && q.answered_option === idx;
                    const isRight = isAnswered && q.correct_index === idx;
                    const isWrong = isAnswered && isPicked && !q.is_correct;
                    return (
                      <li key={idx}>
                        <button
                          type="button"
                          className={`exam-opt${isPicked ? ' is-picked' : ''}${isRight ? ' is-right' : ''}${isWrong ? ' is-wrong' : ''}`}
                          disabled={isAnswered || answering}
                          onClick={() => void submitAnswer(idx)}
                        >
                          <span className="exam-opt__letter">{OPTION_LETTERS[idx] || faNum(idx + 1)}</span>
                          <span className="exam-opt__text">{opt}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>

                {isAnswered && (
                  <div className={`exam-feedback ${q.is_correct ? 'is-ok' : 'is-no'}`}>
                    <p className="exam-feedback__title">
                      {q.is_correct
                        ? 'پاسخ درست است'
                        : `پاسخ صحیح: گزینهٔ ${OPTION_LETTERS[q.correct_index ?? 0]}`}
                    </p>
                    <p className="exam-feedback__body">
                      {q.explanation_long || q.explanation_short}
                    </p>
                    {q.source_evidence && (
                      <p className="tiny muted" style={{ margin: '6px 0 0' }}>
                        مستند متن جزوه: «{q.source_evidence}»
                      </p>
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <DsButton
                    variant="secondary"
                    disabled={qIdx <= 0}
                    onClick={() => setQIdx((i) => Math.max(0, i - 1))}
                  >
                    سؤال قبلی
                  </DsButton>
                  {qIdx < questions.length - 1 ? (
                    <DsButton variant="primary" onClick={() => setQIdx((i) => i + 1)}>
                      سؤال بعدی
                    </DsButton>
                  ) : (
                    <DsButton
                      variant="primary"
                      onClick={() => {
                        setActiveSession(null);
                        setQuestions([]);
                      }}
                    >
                      بازگشت به جزوه‌ها
                    </DsButton>
                  )}
                </div>
              </DsCard>
            </div>
          );
        })()}

        {/* ── نمای اصلی: آپلود PDF، انتخاب مبحث و شروع کوییز ── */}
        {!loading && error == null && !activeSession && (
          <div className="exam-stack">
            <DsCard className="exam-stack">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div>
                  <h2 className="h3" style={{ margin: 0 }}>بارگذاری جزوه PDF جدید</h2>
                  <p className="small muted" style={{ margin: '4px 0 0' }}>
                    حداکثر {faNum(config?.max_pdf_mb ?? 20)} مگابایت · {faNum(config?.max_pages ?? 400)} صفحه · سهمیهٔ
                    باقیماندهٔ امروز: {faNum(config?.remaining_today ?? 0)} سؤال
                  </p>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    void handleUpload(f);
                  }}
                />
                <DsButton variant="primary" loading={uploading} onClick={() => fileRef.current?.click()}>
                  <Icon name="i-upload" size={16} />
                  انتخاب و تحلیل PDF
                </DsButton>
              </div>
            </DsCard>

            {pickedDoc && (
              <DsCard level="accent" className="exam-stack">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <h3 className="h3" style={{ margin: 0 }}>ساخت آزمون از: {pickedDoc.name}</h3>
                  <DsButton size="sm" variant="ghost" onClick={() => setPickedDoc(null)}>
                    بستن
                  </DsButton>
                </div>

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <DsChip selected={scopeMode === 'all'} onClick={() => setScopeMode('all')}>
                    کل جزوه ({faNum(pickedDoc.page_count)} صفحه)
                  </DsChip>
                  {pickedDoc.topics.length > 0 && (
                    <DsChip selected={scopeMode === 'topic'} onClick={() => {
                      setScopeMode('topic');
                      if (topicId === null && pickedDoc.topics[0]) setTopicId(pickedDoc.topics[0].id);
                    }}>
                      مبحث مشخص
                    </DsChip>
                  )}
                  <DsChip selected={scopeMode === 'range'} onClick={() => setScopeMode('range')}>
                    بازهٔ صفحات
                  </DsChip>
                </div>

                {scopeMode === 'topic' && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {pickedDoc.topics.map((t) => (
                      <DsChip key={t.id} selected={topicId === t.id} onClick={() => setTopicId(t.id)}>
                        {t.title} ({faNum(t.page_start)}–{faNum(t.page_end)})
                      </DsChip>
                    ))}
                  </div>
                )}

                {scopeMode === 'range' && (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <input
                      type="number"
                      className="ds-input"
                      min={1}
                      max={pickedDoc.page_count || 400}
                      value={pageFrom}
                      onChange={(e) => setPageFrom(e.target.value)}
                      placeholder="از صفحه"
                      style={{ width: 110 }}
                    />
                    <span>تا</span>
                    <input
                      type="number"
                      className="ds-input"
                      min={1}
                      max={pickedDoc.page_count || 400}
                      value={pageTo}
                      onChange={(e) => setPageTo(e.target.value)}
                      placeholder="تا صفحه"
                      style={{ width: 110 }}
                    />
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className="small muted">تعداد سؤال:</span>
                  {[5, 10, 15, 20].map((c) => (
                    <DsChip key={c} selected={count === c} onClick={() => setCount(c)}>
                      {faNum(c)} سؤال
                    </DsChip>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className="small muted">سطح دشواری:</span>
                  {([
                    { v: 'mixed', l: 'ترکیبی' },
                    { v: 'easy', l: 'آسان' },
                    { v: 'medium', l: 'متوسط' },
                    { v: 'hard', l: 'سخت' },
                  ] as const).map((d) => (
                    <DsChip key={d.v} selected={difficulty === d.v} onClick={() => setDifficulty(d.v)}>
                      {d.l}
                    </DsChip>
                  ))}
                </div>

                <DsButton variant="primary" block loading={starting} onClick={() => void startQuiz()}>
                  <Icon name="i-zap" size={16} />
                  تولید سؤال‌ها و شروع آزمون
                </DsButton>
              </DsCard>
            )}

            {docs.length === 0 ? (
              <DsCard>
                <DsEmpty
                  icon={<Icon name="i-file-text" size={28} />}
                  title="هنوز PDF بارگذاری نکرده‌اید"
                  body="جزوهٔ متنی خود را انتخاب کنید تا هوشیار فصل‌ها را تشخیص دهد و از همان بخش آزمون چهارگزینه‌ای بسازد."
                />
              </DsCard>
            ) : (
              <div className="exam-stack">
                <h3 className="h3" style={{ margin: 0 }}>جزوه‌های من</h3>
                {docs.map((d) => (
                  <DsCard key={d.id} className="exam-stack">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <div>
                        <strong className="small">{d.name}</strong>
                        <div className="tiny muted">
                          {d.status === 'ready'
                            ? `${faNum(d.page_count)} صفحه · ${faNum(d.topics.length)} مبحث`
                            : d.status === 'processing'
                              ? 'در حال استخراج متن و تحلیل مباحث…'
                              : `خطا: ${d.error || 'نامشخص'}`}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <DsBadge tone={d.status === 'ready' ? 'success' : d.status === 'failed' ? 'danger' : 'neutral'}>
                          {d.status === 'ready' ? 'آماده' : d.status === 'failed' ? 'ناموفق' : 'در حال پردازش'}
                        </DsBadge>
                        {d.status === 'ready' && (
                          <DsButton
                            size="sm"
                            variant="primary"
                            onClick={() => {
                              setPickedDoc(d);
                              setPageTo(String(Math.min(10, d.page_count || 10)));
                            }}
                          >
                            طراحی آزمون
                          </DsButton>
                        )}
                        <DsButton size="sm" variant="ghost" onClick={() => void deleteDoc(d.id)}>
                          حذف
                        </DsButton>
                      </div>
                    </div>
                  </DsCard>
                ))}
              </div>
            )}

            {sessions.length > 0 && (
              <div className="exam-stack">
                <h3 className="h3" style={{ margin: 0 }}>آزمون‌های ساخته‌شده از PDF</h3>
                {sessions.map((s) => (
                  <DsCard key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                    <div>
                      <strong className="small">{s.doc_name}</strong>
                      <div className="tiny muted">
                        {faNum(s.answered)} از {faNum(s.total_planned)} پاسخ · درست: {faNum(s.correct)}
                      </div>
                    </div>
                    <DsButton size="sm" variant="secondary" onClick={() => void openQuizSession(s.id)}>
                      {s.status === 'finished' ? 'بازبینی' : 'ادامه'}
                    </DsButton>
                  </DsCard>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <Toast message={toast} />
    </>
  );
}
