import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import './exam.css';
import { AppBar, ReportSheet } from '../../components';
import { ErrorBlock, LoadingBlock } from '../../components/AccessStates';
import { DsBadge, DsButton, DsCard } from '../../design/components';
import { Icon } from '../../icons';
import { OPTION_LETTERS, accuracyTone, mockExam, type MockReview } from '../../lib/exam';
import { faNum, faPercent } from '../../lib/fa';

function verdictLabel(tone: 'good' | 'mid' | 'low'): string {
  if (tone === 'good') return 'عملکرد عالی';
  if (tone === 'mid') return 'عملکرد قابل قبول';
  return 'نیاز به مرور بیشتر';
}

/** کارنامه و بازبینی آزمون زمان‌دار.
 *
 *  Audit ER1: یک CTA اصلی واضح (`دریافت دفترچه PDF`) + دکمه‌های ثانویهٔ متوازن + حلقهٔ نمره با برچسب معنایی.
 *  Audit ER2: تراز صحیح آیکون و عنوان «بازبینی» + متادیتای خوانا (>= ۱۳px) با تفکیک رنگی درست/غلط.
 */
export function ExamResult() {
  const { sid = '' } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<MockReview | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'active'>('loading');
  const [downloading, setDownloading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<{ id: string; label: string } | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const res = await mockExam.review(sid);
      setData(res);
      setState('ready');
    } catch (err) {
      const code = (err as { code?: string })?.code ?? '';
      if (code === 'exam_still_active') setState('active');
      else setState('error');
    }
  }, [sid]);

  const handleDownloadPdf = async (mode: 'exam' | 'practice' = 'exam') => {
    if (!sid || downloading) return;
    setDownloading(true);
    setPdfError(null);
    try {
      await mockExam.downloadPdf(sid, mode, `daftarche-azmoon-${data?.exam_code || sid}.pdf`);
    } catch {
      setPdfError('دانلود دفترچهٔ آزمون با خطا مواجه شد. لطفاً دوباره تلاش کنید.');
    } finally {
      setDownloading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (state === 'active') navigate(`/exam/run/${sid}`, { replace: true });
  }, [state, sid, navigate]);

  const pct = data ? Math.round(data.percentage) : 0;
  const tone = accuracyTone(pct);

  return (
    <>
      <AppBar
        title="کارنامه"
        sub={data ? `${data.lesson || 'آزمون جامع'}${data.topic ? ` · ${data.topic}` : ''}` : 'نتیجهٔ آزمون'}
        back
        onBack={() => navigate('/exam')}
      />
      <div className="page page-enter exam-page">
        {state === 'loading' && <LoadingBlock rows={3} />}
        {state === 'error' && <ErrorBlock error={null} onRetry={() => void load()} />}

        {state === 'ready' && data && (
          <div className="exam-stack">
            <DsCard className="exam-result-hero">
              <div className={`exam-score-ring exam-score-ring--${tone}`}>
                <span className="exam-score-ring__val">{faPercent(pct)}</span>
              </div>

              <DsBadge tone={tone === 'good' ? 'success' : tone === 'mid' ? 'warning' : 'danger'}>
                {verdictLabel(tone)}
              </DsBadge>

              <p className="exam-hint-text">
                {faNum(data.correct)} پاسخ درست از {faNum(data.answered)} پاسخ
                {data.total > data.answered
                  ? ` · ${faNum(data.total - data.answered)} سؤال بی‌پاسخ`
                  : ''}
              </p>

              <div className="exam-result-badges">
                <DsBadge tone="accent">
                  {data.lesson || 'آزمون جامع'}
                  {data.topic ? ` · ${data.topic}` : ''}
                </DsBadge>
                <DsBadge tone="neutral">{faNum(data.total)} سؤال</DsBadge>
                {data.minutes > 0 && <DsBadge tone="neutral">{faNum(data.minutes)} دقیقه</DsBadge>}
                {data.exam_code && (
                  <DsBadge tone="neutral">
                    کد <bdi dir="ltr">{data.exam_code}</bdi>
                  </DsBadge>
                )}
              </div>
            </DsCard>

            <div className="exam-result-ctas">
              <DsButton
                variant="primary"
                size="lg"
                loading={downloading}
                onClick={() => void handleDownloadPdf('exam')}
              >
                <Icon name="i-download" size={18} />
                <span>دریافت دفترچه PDF</span>
              </DsButton>
              <div className="exam-result-secondary-ctas">
                <DsButton
                  variant="secondary"
                  size="md"
                  className="exam-btn-tall"
                  onClick={() => navigate('/exam/setup', { replace: true })}
                >
                  آزمون تازه
                </DsButton>
                <DsButton
                  variant="ghost"
                  size="md"
                  className="exam-btn-tall"
                  onClick={() => navigate('/exam/mock/history')}
                >
                  آزمون‌های قبلی
                </DsButton>
              </div>
            </div>

            {pdfError && (
              <p className="exam-error-note" role="alert">
                {pdfError}
              </p>
            )}

            <div className="exam-review-head">
              <Icon name="i-file-text" size={18} className="exam-review-head__icon" />
              <h2 className="exam-sec-head__title">بازبینی پاسخ‌ها</h2>
            </div>

            {data.review.length === 0 ? (
              <DsCard level="sunken">
                <p className="exam-hint-text">پاسخی برای بازبینی ثبت نشده است.</p>
              </DsCard>
            ) : (
              <div className="exam-review-grid">
                {data.review.map((r, idx) => (
                  <DsCard key={`${r.question_id}-${idx}`} className="exam-review-card">
                    <div className="exam-review-card__top">
                      <span className="exam-sec-head__sub">سؤال {faNum(idx + 1)}</span>
                      <DsBadge tone={r.is_correct ? 'success' : 'danger'}>
                        {r.is_correct ? 'درست' : 'غلط'}
                      </DsBadge>
                    </div>

                    {r.image_url && (
                      <img
                        className="exam-q-img"
                        src={r.image_url}
                        alt="تصویر سؤال"
                        loading="lazy"
                      />
                    )}

                    <p className="exam-review-card__stem">
                      {r.question ?? 'متن سؤال در دسترس نیست.'}
                    </p>

                    <div className="exam-review-answers">
                      <span className={r.is_correct ? 'exam-review-ans--ok' : 'exam-review-ans--no'}>
                        پاسخ شما: {OPTION_LETTERS[r.selected] ?? faNum(r.selected)}
                        {r.options?.[r.selected] ? ` — ${r.options[r.selected]}` : ''}
                      </span>
                      {!r.is_correct && (
                        <span className="exam-review-ans--ok">
                          پاسخ درست: {OPTION_LETTERS[r.correct_answer] ?? faNum(r.correct_answer)}
                          {r.options?.[r.correct_answer] ? ` — ${r.options[r.correct_answer]}` : ''}
                        </span>
                      )}
                    </div>

                    {r.explanation && <p className="exam-review-expl">{r.explanation}</p>}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                      <DsButton
                        variant="ghost"
                        size="sm"
                        onClick={() => setReportTarget({ id: r.question_id, label: `سؤال ${faNum(idx + 1)}` })}
                      >
                        <Icon name="i-alert-circle" size={14} />
                        <span>گزارش ایراد</span>
                      </DsButton>
                    </div>
                  </DsCard>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {reportTarget && (
        <ReportSheet
          open={Boolean(reportTarget)}
          onClose={() => setReportTarget(null)}
          targetType="question"
          targetId={reportTarget.id}
          targetLabel={reportTarget.label}
        />
      )}
    </>
  );
}
