import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import './account.css';
import { SkeletonStack } from '../components';
import { AppBar } from '../components/AppBar';
import { DsButton, DsCard } from '../design/components';
import { Icon } from '../icons';
import { apiCall, errorText } from '../lib/api';
import { faDate, faNum } from '../lib/fa';

interface VerifyResult {
  ok: boolean;
  already?: boolean;
  ref_id?: string;
  end_date?: string;
  days?: number;
}

export function PaymentVerifyScreen() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const authority = (params.get('Authority') || params.get('authority') || '').trim();
  const zpStatus = (params.get('Status') || params.get('status') || '').trim().toUpperCase();

  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [err, setErr] = useState('');

  const verify = useCallback(async () => {
    if (!authority) {
      setLoading(false);
      setErr('شناسهٔ تراکنش در آدرس بازگشت یافت نشد.');
      return;
    }
    if (zpStatus && zpStatus !== 'OK') {
      setLoading(false);
      setErr('پرداخت توسط شما لغو شد یا در درگاه بانکی تکمیل نگردید.');
      return;
    }
    setLoading(true);
    setErr('');
    try {
      const res = await apiCall<VerifyResult>('/subscription/zarinpal/verify', {
        method: 'POST',
        body: JSON.stringify({ authority }),
      });
      setResult(res);
    } catch (e) {
      setErr(errorText(e, 'تأیید تراکنش با خطا مواجه شد.'));
    } finally {
      setLoading(false);
    }
  }, [authority, zpStatus]);

  useEffect(() => {
    void verify();
  }, [verify]);

  return (
    <>
      <AppBar title="نتیجهٔ پرداخت" sub="تایید خودکار درگاه پرداخت" back />
      <div className="page page-enter acct-page">
        {loading && <SkeletonStack rows={2} />}

        {!loading && result?.ok && (
          <DsCard className="acct-card-stack">
            <div className="acct-sec-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="ds-badge ds-badge--success">
                  <Icon name="i-check" size={14} />
                  پرداخت موفق
                </span>
                <h2 className="ds-card__title" style={{ margin: 0 }}>
                  {result.already ? 'اشتراک شما از پیش فعال شده است' : 'اشتراک با موفقیت فعال شد'}
                </h2>
              </div>
            </div>
            <p className="ds-card__sub" style={{ margin: 0 }}>
              {result.ref_id && <>کد پیگیری: <strong dir="ltr">{result.ref_id}</strong> · </>}
              {result.days ? <>مدت افزوده‌شده: <strong>{faNum(result.days)} روز</strong> · </> : null}
              {result.end_date ? <>اعتبار تا: <strong>{faDate(result.end_date)}</strong></> : null}
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
              <DsButton variant="primary" onClick={() => navigate('/subscription')}>
                مشاهدهٔ وضعیت اشتراک
              </DsButton>
              <DsButton variant="secondary" onClick={() => navigate('/')}>
                بازگشت به خانه
              </DsButton>
            </div>
          </DsCard>
        )}

        {!loading && err && (
          <DsCard className="acct-card-stack">
            <div className="acct-notice acct-notice--danger" role="alert">
              <div className="acct-notice__lead">
                <Icon name="i-alert-circle" size={18} />
                <span>{err}</span>
              </div>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              در صورتی که مبلغ از حساب شما کسر شده، تا ۷۲ ساعت به صورت خودکار برمی‌گردد یا از بخش پشتیبانی
              پیگیری می‌شود.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {authority && (zpStatus === '' || zpStatus === 'OK') && (
                <DsButton variant="primary" onClick={() => void verify()}>
                  بررسی مجدد تراکنش
                </DsButton>
              )}
              <DsButton variant="secondary" onClick={() => navigate('/subscription')}>
                بازگشت به صفحه اشتراک
              </DsButton>
            </div>
          </DsCard>
        )}
      </div>
    </>
  );
}
