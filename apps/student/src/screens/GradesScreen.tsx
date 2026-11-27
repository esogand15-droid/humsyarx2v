import { useCallback, useEffect, useState } from 'react';

import './account.css';
import { AppBar } from '../components/AppBar';
import { SkeletonStack } from '../components/Skeleton';
import { DsBadge, DsButton, DsCard, DsEmpty } from '../design/components';
import { Icon } from '../icons';
import { errorText } from '../lib/api';
import { faDigits, faNum } from '../lib/fa';
import { grades, type GradesSummaryPayload } from '../lib/grades';
import { peek, put } from '../lib/swr';

function gpaTone(gpa: number | null): 'excellent' | 'normal' | 'warn' | 'danger' {
  if (gpa === null) return 'normal';
  if (gpa >= 17) return 'excellent';
  if (gpa >= 14) return 'normal';
  if (gpa >= 12) return 'warn';
  return 'danger';
}

function gpaLabel(gpa: number | null): string {
  if (gpa === null) return 'در حال محاسبه';
  if (gpa >= 17) return 'رتبه الف (ممتاز)';
  if (gpa >= 14) return 'وضعیت عادی';
  if (gpa >= 12) return 'نزدیک به مشروطی';
  return 'مشروط';
}

function gpaBadgeTone(
  tone: 'excellent' | 'normal' | 'warn' | 'danger',
): 'success' | 'accent' | 'warning' | 'danger' {
  if (tone === 'excellent') return 'success';
  if (tone === 'normal') return 'accent';
  if (tone === 'warn') return 'warning';
  return 'danger';
}

function formatGpa(val: number): string {
  return faNum(val, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCourseScore(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined || raw === '') return '—';
  return faNum(raw, { minimumFractionDigits: 0, maximumFractionDigits: 2 }, '—');
}

/** کارنامه و معدل کل — ممیز فارسی (٫)، نمودار روند معدل بین ترم‌ها و چیدمان دوستونی. */
export function GradesScreen() {
  const [data, setData] = useState<GradesSummaryPayload | null>(() => peek<GradesSummaryPayload>('grades') ?? null);
  const [loading, setLoading] = useState(() => !peek('grades'));
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!peek('grades')) setLoading(true);
    setError('');
    try {
      const res = await grades.summary();
      setData(put('grades', res));
    } catch (err) {
      setError(errorText(err, 'دریافت کارنامه تحصیلی با خطا مواجه شد.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cumGpa = data?.cumulative_gpa ?? null;
  const tone = gpaTone(cumGpa);
  const semestersWithGpa = (data?.semesters ?? []).filter(
    (s): s is typeof s & { term_gpa: number } => s.term_gpa !== null && Number.isFinite(s.term_gpa),
  );

  return (
    <>
      <AppBar title="کارنامه و معدل کل" sub="سوابق تحصیلی و معدل وزنی (GPA)" />

      <div className="page page-enter acct-page">
        {loading && <SkeletonStack rows={5} />}

        {error && !loading && (
          <DsCard className="acct-card-stack">
            <div className="acct-notice acct-notice--danger" role="alert">
              <div className="acct-notice__lead">
                <Icon name="i-alert-circle" size={18} />
                <span>{error}</span>
              </div>
              <DsButton variant="secondary" size="md" onClick={() => void load()}>
                تلاش دوباره
              </DsButton>
            </div>
          </DsCard>
        )}

        {!loading && !error && data && (
          <div className="acct-two-col">
            <aside className="acct-col-side">
              <DsCard
                className={`acct-gpa-hero${
                  tone === 'excellent' ? ' acct-gpa-hero--excellent' : ''
                }`}
              >
                <span className="acct-gpa-hero__label">معدل کل تحصیلی (وزنی)</span>

                <div className="acct-gpa-hero__score">
                  <span
                    className={`acct-gpa-hero__num${
                      tone === 'warn'
                        ? ' acct-gpa-hero__num--warn'
                        : tone === 'danger'
                          ? ' acct-gpa-hero__num--danger'
                          : ''
                    }`}
                  >
                    {cumGpa !== null ? formatGpa(cumGpa) : '—'}
                  </span>
                  <span className="acct-gpa-hero__unit">از {faNum(20)}</span>
                </div>

                <DsBadge tone={gpaBadgeTone(tone)}>
                  {tone === 'excellent' && <Icon name="i-award" size={12} />}
                  <span>{gpaLabel(cumGpa)}</span>
                </DsBadge>

                <div className="acct-gpa-credits">
                  <div className="acct-gpa-credits__item">
                    <span className="acct-gpa-credits__val">{faNum(data.total_credits)}</span>
                    <span className="acct-gpa-credits__lbl">کل واحدها</span>
                  </div>
                  <div className="acct-gpa-credits__item">
                    <span className="acct-gpa-credits__val acct-gpa-credits__val--good">
                      {faNum(data.passed_credits)}
                    </span>
                    <span className="acct-gpa-credits__lbl">گذرانده</span>
                  </div>
                  <div className="acct-gpa-credits__item">
                    <span className="acct-gpa-credits__val acct-gpa-credits__val--bad">
                      {faNum(data.failed_credits)}
                    </span>
                    <span className="acct-gpa-credits__lbl">افتاده</span>
                  </div>
                </div>
              </DsCard>

              {semestersWithGpa.length > 0 && (
                <DsCard className="acct-card-stack">
                  <div className="acct-sec-head">
                    <h2 className="acct-sec-head__title">روند معدل ترم‌ها</h2>
                    <Icon name="i-trend" size={18} />
                  </div>
                  <div className="acct-trend-list">
                    {semestersWithGpa.map((sem, idx) => {
                      const pct = Math.min(100, Math.max(0, Math.round((sem.term_gpa / 20) * 100)));
                      return (
                        <div key={idx} className="acct-trend-row">
                          <div className="acct-trend-row__head">
                            <span className="acct-trend-row__term">{faDigits(sem.term_label)}</span>
                            <span className="acct-trend-row__val">{formatGpa(sem.term_gpa)}</span>
                          </div>
                          <div
                            className="acct-trend-bar"
                            role="progressbar"
                            aria-valuenow={Math.min(20, Math.max(0, sem.term_gpa))}
                            aria-valuemin={0}
                            aria-valuemax={20}
                            aria-label={`معدل ${sem.term_label}`}
                          >
                            <svg className="acct-trend-bar__svg" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
                              <rect className="acct-trend-bar__fill" x={100 - pct} y={0} width={pct} height={8} rx={0} />
                            </svg>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </DsCard>
              )}
            </aside>

            <section className="acct-col-main" aria-label="ریز نمرات به تفکیک ترم">
              {data.semesters.length === 0 ? (
                <DsCard>
                  <DsEmpty
                    icon={<Icon name="i-book" size={28} />}
                    title="نمره‌ای ثبت نشده است"
                    body="هنوز هیچ نمره رسمی در پرونده تحصیلی شما ثبت نشده است."
                  />
                </DsCard>
              ) : (
                <>
                  <div className="acct-sec-head">
                    <h2 className="acct-sec-head__title">ریز نمرات به تفکیک ترم</h2>
                    <span className="acct-sec-head__sub">{faNum(data.semesters.length)} ترم</span>
                  </div>

                  <div className="acct-card-stack">
                    {data.semesters.map((sem, sIdx) => (
                      <DsCard key={sIdx} className="acct-semester-card">
                        <div className="acct-semester-head">
                          <div>
                            <h3 className="ds-card__title">{faDigits(sem.term_label)}</h3>
                            <span className="acct-sec-head__sub">{faNum(sem.credits)} واحد</span>
                          </div>
                          {sem.term_gpa !== null && (
                            <div className="acct-semester-gpa">
                              <span>معدل ترم:</span>
                              <span className="acct-semester-gpa__num">
                                {formatGpa(sem.term_gpa)}
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="acct-course-list">
                          {sem.courses.map((course, cIdx) => (
                            <div key={cIdx} className="acct-course-row">
                              <div className="acct-course-row__info">
                                <span className="acct-course-row__name">{course.name}</span>
                                <span className="acct-course-row__meta">
                                  {faNum(course.credits)} واحد
                                </span>
                              </div>

                              <div className="acct-course-row__score-wrap">
                                <span className="acct-course-row__score">
                                  {formatCourseScore(course.score)}
                                </span>
                                <DsBadge tone={course.passed ? 'success' : 'danger'}>
                                  {course.passed ? 'قبول' : 'افتاده'}
                                </DsBadge>
                              </div>
                            </div>
                          ))}
                        </div>
                      </DsCard>
                    ))}
                  </div>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </>
  );
}
