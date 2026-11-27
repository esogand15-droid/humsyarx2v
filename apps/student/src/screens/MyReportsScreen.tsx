import { useCallback, useEffect, useState } from 'react';
import { AppBar, ReportSheet, SkeletonStack } from '../components';
import { DsBadge, DsButton, DsCard, DsEmpty } from '../design/components';
import { Icon } from '../icons';
import { errorText } from '../lib/api';
import { faDate, faNum } from '../lib/fa';
import { reportsApi, type MyReportItem } from '../lib/reader';

export function MyReportsScreen() {
  const [items, setItems] = useState<MyReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await reportsApi.mine();
      setItems(res.reports || []);
    } catch (e) {
      setErr(errorText(e, 'دریافت فهرست گزارش‌ها ممکن نشد.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <AppBar
        title="گزارش‌های ایراد محتوا"
        sub="پیگیری وضعیت گزارش‌های ارسالی سؤال‌ها و فایل‌ها"
        back
        actions={
          <DsButton variant="secondary" size="sm" onClick={() => setSheetOpen(true)}>
            ثبت گزارش جدید
          </DsButton>
        }
      />

      <div className="page page-enter" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {err && (
          <DsCard>
            <p style={{ color: 'var(--danger)', margin: 0 }}>{err}</p>
            <div style={{ marginTop: 8 }}>
              <DsButton variant="secondary" size="sm" onClick={() => void load()}>
                تلاش دوباره
              </DsButton>
            </div>
          </DsCard>
        )}

        {loading ? (
          <SkeletonStack rows={4} />
        ) : items.length === 0 ? (
          <DsCard>
            <DsEmpty
              icon={<Icon name="i-alert-circle" size={28} />}
              title="گزارشی ثبت نکرده‌اید"
              body="هر زمان در سؤال‌های آزمون یا فایل‌های کتابخانه خطایی دیدید، از دکمه گزارش همان صفحه یا اینجا اعلام کنید."
              action={
                <DsButton variant="primary" onClick={() => setSheetOpen(true)}>
                  ثبت گزارش ایراد
                </DsButton>
              }
            />
          </DsCard>
        ) : (
          items.map((r) => {
            const tone =
              r.status === 'resolved' || r.status === 'fixed'
                ? 'success'
                : r.status === 'rejected'
                  ? 'danger'
                  : 'warning';
            const typeLbl = r.target_type === 'question' ? 'بانک سؤال' : 'منبع / جزوه';
            return (
              <DsCard key={String(r.id)} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <DsBadge tone="neutral">{typeLbl}</DsBadge>
                    <strong>#{faNum(String(r.id))}</strong>
                  </div>
                  <DsBadge tone={tone}>{r.status_label || r.status || 'در انتظار بررسی'}</DsBadge>
                </div>
                <div style={{ fontSize: '0.88rem' }}>{r.reason}</div>
                {r.note && (
                  <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--ink-2)', lineHeight: 1.65 }}>{r.note}</p>
                )}
                {r.created_at && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--ink-2)' }}>{faDate(r.created_at)}</div>
                )}
              </DsCard>
            );
          })
        )}
      </div>

      <ReportSheet
        open={sheetOpen}
        onClose={() => {
          setSheetOpen(false);
          void load();
        }}
        targetType="resource"
        targetId="web_general"
        targetLabel="ثبت گزارش خطای عمومی محتوا"
      />
    </>
  );
}
