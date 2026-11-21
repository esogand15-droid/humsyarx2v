import { useCallback, useEffect, useState } from 'react';
import { AppBar } from '../components/AppBar';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import { SkeletonStack } from '../components/Skeleton';
import { Button } from '../components/Button';
import { Icon } from '../icons';
import { grades, type GradesSummaryPayload } from '../lib/grades';
import { errorText } from '../lib/api';
import { fa } from '../lib/library';

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

export function GradesScreen() {
  const [data, setData] = useState<GradesSummaryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await grades.summary();
      setData(res);
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

  return (
    <>
      <AppBar
        title="کارنامه و معدل کل"
        sub="سوابق تحصیلی و معدل وزنی (GPA)"
      />

      <div className="page page-enter">
        {loading && (
          <div className="mt-16">
            <SkeletonStack rows={5} />
          </div>
        )}

        {error && !loading && (
          <div className="mt-16 text-center">
            <div className="notice notice--warn mb-16" role="alert" style={{ color: 'var(--danger)' }}>
              <Icon name="i-alert-circle" size={16} />
              <span className="small">{error}</span>
            </div>
            <Button variant="primary" size="sm" onClick={() => void load()}>
              تلاش دوباره
            </Button>
          </div>
        )}

        {!loading && !error && data && (
          <>
            {/* کارت معدل کل و شاخص‌های تحصیلی */}
            <Card
              className="mt-8 card--glass"
              style={{
                textAlign: 'center',
                padding: '24px 16px',
                border: tone === 'excellent' ? '1px solid rgba(0, 242, 254, 0.4)' : undefined,
                boxShadow: tone === 'excellent' ? '0 0 20px -4px rgba(0, 242, 254, 0.25)' : undefined,
              }}
            >
              <span className="tiny color-muted" style={{ letterSpacing: '0.05em' }}>
                معدل کل تحصیلی (وزنی)
              </span>

              <div
                style={{
                  fontSize: 44,
                  fontWeight: 900,
                  lineHeight: 1.2,
                  marginTop: 6,
                  color:
                    tone === 'excellent'
                      ? 'var(--hym-neon-cyan)'
                      : tone === 'danger'
                      ? 'var(--danger)'
                      : 'var(--brand)',
                  direction: 'ltr',
                }}
              >
                {cumGpa !== null ? fa(cumGpa.toFixed(2)) : '—'}
                <span style={{ fontSize: 18, fontWeight: 500, marginInlineStart: 4, color: 'var(--ink-3)' }}>
                  از ۲۰
                </span>
              </div>

              <div className="mt-8">
                <Chip
                  variant={tone === 'excellent' ? 'cyan' : tone === 'danger' ? 'danger' : 'quiet'}
                  icon={tone === 'excellent' ? 'i-award' : undefined}
                >
                  {gpaLabel(cumGpa)}
                </Chip>
              </div>

              {/* خلاصه واحدهای انتخابی */}
              <div
                className="row row--between mt-20 pt-16"
                style={{
                  borderTop: '1px solid var(--line)',
                  justifyContent: 'space-around',
                }}
              >
                <div>
                  <div className="h3 num">{fa(data.total_credits)}</div>
                  <div className="tiny color-muted mt-2">کل واحدها</div>
                </div>
                <div style={{ width: 1, height: 28, background: 'var(--line)' }} />
                <div>
                  <div className="h3 num" style={{ color: 'var(--ok, #10B981)' }}>
                    {fa(data.passed_credits)}
                  </div>
                  <div className="tiny color-muted mt-2">گذرانده</div>
                </div>
                <div style={{ width: 1, height: 28, background: 'var(--line)' }} />
                <div>
                  <div className="h3 num" style={{ color: 'var(--danger, #F43F5E)' }}>
                    {fa(data.failed_credits)}
                  </div>
                  <div className="tiny color-muted mt-2">افتاده</div>
                </div>
              </div>
            </Card>

            {/* تفکیک ترم‌ها */}
            {data.semesters.length === 0 ? (
              <div className="mt-16">
                <EmptyState
                  icon="i-book"
                  title="نمره‌ای ثبت نشده است"
                  text="هنوز هیچ نمره رسمی در پرونده تحصیلی ثبت نشده است."
                />
              </div>
            ) : (
              <div className="mt-20">
                <div className="h3 mb-12">ریز نمرات به تفکیک ترم</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {data.semesters.map((sem, sIdx) => (
                    <Card key={sIdx} className="card--glass" style={{ padding: '16px' }}>
                      <div className="row row--between" style={{ alignItems: 'center', marginBottom: 12 }}>
                        <div>
                          <span className="h3" style={{ fontSize: 16 }}>{sem.term_label}</span>
                          <span className="tiny color-muted" style={{ marginInlineStart: 8 }}>
                            ({fa(sem.credits)} واحد)
                          </span>
                        </div>
                        {sem.term_gpa !== null && (
                          <div className="row gap-4" style={{ alignItems: 'center' }}>
                            <span className="tiny color-muted">معدل ترم:</span>
                            <span className="h3 num" style={{ color: 'var(--brand)' }}>
                              {fa(sem.term_gpa.toFixed(2))}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* جدول دروس ترم */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {sem.courses.map((course, cIdx) => (
                          <div
                            key={cIdx}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '8px 12px',
                              borderRadius: 'var(--r-md)',
                              background: 'var(--paper-2)',
                              border: '1px solid var(--line)',
                            }}
                          >
                            <div className="grow">
                              <span className="body" style={{ fontSize: 13.5, fontWeight: 600 }}>
                                {course.name}
                              </span>
                              <div className="tiny color-muted mt-2">
                                {fa(course.credits)} واحد
                              </div>
                            </div>

                            <div className="row gap-8" style={{ alignItems: 'center' }}>
                              <span className="h3 num" style={{ fontSize: 15 }}>
                                {course.score !== null && course.score !== undefined
                                  ? fa(String(course.score))
                                  : '—'}
                              </span>
                              <Chip
                                variant={course.passed ? 'cyan' : 'danger'}
                                icon={course.passed ? 'i-check' : 'i-alert-circle'}
                              >
                                {course.passed ? 'قبول' : 'افتاده'}
                              </Chip>
                            </div>
                          </div>
                        ))}
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
