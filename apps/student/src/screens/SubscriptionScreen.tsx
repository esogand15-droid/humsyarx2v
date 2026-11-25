import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppBar } from '../components/AppBar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { Input } from '../components/Input';
import { SkeletonStack } from '../components';
import { Icon } from '../icons';
import { apiCall, errorText } from '../lib/api';
import { fa } from '../lib/library';

/* اشتراک — تماماً از سرور: پلن‌ها، وضعیت، کد تخفیف و درگاه زرین‌پال.
   قبلاً پلن‌ها و قیمت‌ها در کد ثابت بودند و دکمهٔ پرداخت فقط یک alert
   نشان می‌داد؛ دانشجو قیمتی می‌دید که واقعی نبود و پرداختی انجام نمی‌شد. */

interface Plan {
  id: string;
  name: string;
  days: number;
  price: number;
  max_members?: number;
}

interface StatusPayload {
  active: boolean;
  days_left: number;
  plan_name: string;
  expires: string;
  expires_fa?: string;
  stacked?: boolean;
  has_pending_payment?: boolean;
  plans: Plan[];
}

interface GatewayStatus {
  online_pay_enabled: boolean;
  bot_username?: string;
}

interface DiscountResult {
  ok: boolean;
  code: string;
  percent: number;
  price: number;
  final_price: number;
}

const FEATURES = [
  'دسترسی کامل به جزوه‌ها و منابع محافظت‌شده در کتابخوان',
  'بانک سؤال و آزمون‌های زمان‌دار',
  'دستیار هوشیار برای پرسش و تحلیل تصویر',
  'یادداشت‌برداری با قلم دیجیتال روی جزوه‌ها',
];

function newIdem(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export function SubscriptionScreen() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [gateway, setGateway] = useState<GatewayStatus | null>(null);
  const [loadError, setLoadError] = useState('');
  const [selectedPlan, setSelectedPlan] = useState('');
  const [discountCode, setDiscountCode] = useState('');
  const [discount, setDiscount] = useState<DiscountResult | null>(null);
  const [discountError, setDiscountError] = useState('');
  const [checkingCode, setCheckingCode] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState('');
  // یک کلید ثابت برای هر تلاش پرداخت تا دوبار زدن دکمه دو تراکنش نسازد
  const [idem, setIdem] = useState(newIdem);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const [s, g] = await Promise.all([
        apiCall<StatusPayload>('/subscription/status'),
        apiCall<GatewayStatus>('/subscription/gateway-status').catch(() => null),
      ]);
      setStatus(s);
      setGateway(g);
      const plans = Array.isArray(s?.plans) ? s.plans : [];
      setSelectedPlan((cur) => cur || plans[0]?.id || '');
    } catch (err) {
      setLoadError(errorText(err, 'دریافت وضعیت اشتراک ممکن نشد.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const plans = useMemo(() => (Array.isArray(status?.plans) ? status!.plans : []), [status]);
  const plan = plans.find((p) => p.id === selectedPlan) || null;
  const finalPrice = discount && plan && discount.price === plan.price ? discount.final_price : plan?.price ?? 0;
  const onlinePay = Boolean(gateway?.online_pay_enabled);
  const botLink = `https://t.me/${gateway?.bot_username || 'HumsYarBot'}`;

  const choosePlan = (id: string) => {
    setSelectedPlan(id);
    setDiscount(null);
    setDiscountError('');
    setPayError('');
  };

  const applyDiscount = async () => {
    const code = discountCode.trim();
    if (!code || !plan || checkingCode) return;
    setCheckingCode(true);
    setDiscountError('');
    try {
      const res = await apiCall<DiscountResult>('/subscription/discount', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: plan.id, code }),
      });
      setDiscount(res);
    } catch (err) {
      setDiscount(null);
      setDiscountError(errorText(err, 'کد تخفیف معتبر نیست.'));
    } finally {
      setCheckingCode(false);
    }
  };

  const pay = async () => {
    if (!plan || paying) return;
    setPaying(true);
    setPayError('');
    try {
      const res = await apiCall<{ ok: boolean; url: string }>('/subscription/zarinpal/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: plan.id, discount_code: discount?.code || '', idem }),
      });
      if (res?.url) {
        window.location.assign(res.url);
        return;
      }
      setPayError('آدرس درگاه دریافت نشد. دوباره تلاش کنید.');
    } catch (err) {
      setPayError(errorText(err, 'اتصال به درگاه پرداخت ممکن نشد.'));
      setIdem(newIdem());
    } finally {
      setPaying(false);
    }
  };

  return (
    <>
      <AppBar title="اشتراک" sub="وضعیت و تمدید اشتراک" />

      <div className="page">
        {loadError && (
          <p className="notice notice--warn mt-8" role="alert">
            {loadError}{' '}
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => void load()}>
              تلاش دوباره
            </button>
          </p>
        )}

        {!status && !loadError ? (
          <div className="mt-12">
            <SkeletonStack rows={4} />
          </div>
        ) : status ? (
          <>
            {/* وضعیت فعلی — از سرور */}
            <Card
              className="mt-8 card--glass"
              style={{
                borderInlineStart: `4px solid ${status.active ? 'var(--hym-neon-cyan)' : 'var(--line-2)'}`,
                padding: '16px 20px',
              }}
            >
              <div className="row row--between" style={{ alignItems: 'center', gap: 12 }}>
                <div>
                  <div className="h3">
                    {status.active
                      ? status.stacked || !status.plan_name
                        ? 'اشتراک فعال'
                        : status.plan_name
                      : 'اشتراک فعالی ندارید'}
                  </div>
                  {status.active && (
                    <p className="tiny color-muted mt-4">
                      {fa(status.days_left)} روز باقی‌مانده
                      {status.expires_fa ? ` · تا ${status.expires_fa}` : ''}
                    </p>
                  )}
                </div>
                <Chip variant={status.active ? 'cyan' : 'quiet'} icon={status.active ? 'i-check' : undefined}>
                  {status.active ? 'فعال' : 'غیرفعال'}
                </Chip>
              </div>
              {status.has_pending_payment && (
                <p className="notice notice--warn mt-12">
                  یک رسید پرداخت شما در انتظار بررسی است؛ پس از تأیید، روزها به اشتراک اضافه می‌شود.
                </p>
              )}
            </Card>

            {plans.length === 0 ? (
              <Card className="mt-16 card--glass">
                <p className="small">در حال حاضر پلن فعالی برای خرید تعریف نشده است.</p>
              </Card>
            ) : (
              <>
                <div className="h3 mt-20 mb-12">{status.active ? 'تمدید اشتراک' : 'انتخاب پلن'}</div>
                <div role="radiogroup" aria-label="پلن‌های اشتراک" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {plans.map((p) => {
                    const isSelected = selectedPlan === p.id;
                    return (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        key={p.id}
                        onClick={() => choosePlan(p.id)}
                        className="card card--glass"
                        style={{
                          cursor: 'pointer',
                          padding: '16px 20px',
                          textAlign: 'start',
                          font: 'inherit',
                          color: 'inherit',
                          width: '100%',
                          border: isSelected ? '2px solid var(--hym-neon-cyan)' : '1px solid var(--line)',
                          boxShadow: isSelected ? '0 0 20px -4px rgba(0, 242, 254, 0.25)' : undefined,
                          transition: 'border-color var(--t-fast) ease, box-shadow var(--t-fast) ease',
                        }}
                      >
                        <div className="row row--between" style={{ alignItems: 'center', gap: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <span
                              aria-hidden="true"
                              style={{
                                width: 22,
                                height: 22,
                                flex: '0 0 22px',
                                borderRadius: '50%',
                                border: `2px solid ${isSelected ? 'var(--hym-neon-cyan)' : 'var(--line-2)'}`,
                                display: 'grid',
                                placeItems: 'center',
                              }}
                            >
                              {isSelected && (
                                <span style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--hym-neon-cyan)' }} />
                              )}
                            </span>
                            <span>
                              <span className="h3" style={{ fontSize: 15, display: 'block' }}>{p.name}</span>
                              {p.days > 0 && <span className="tiny color-muted mt-2" style={{ display: 'block' }}>{fa(p.days)} روز دسترسی</span>}
                            </span>
                          </div>
                          <span className="h2 num" style={{ fontSize: 18, color: 'var(--brand)', whiteSpace: 'nowrap' }}>
                            {p.price > 0 ? fa(p.price) : 'رایگان'}
                            {p.price > 0 && <span style={{ fontSize: 11, fontWeight: 500, marginInlineStart: 4 }}>تومان</span>}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* کد تخفیف — اعتبارسنجی واقعی روی سرور */}
                <Card className="mt-16 card--glass">
                  <div className="row gap-8" style={{ alignItems: 'flex-end' }}>
                    <div className="grow">
                      <Input
                        label="کد تخفیف"
                        placeholder="کد را اینجا وارد کنید"
                        value={discountCode}
                        onChange={(e) => {
                          setDiscountCode(e.target.value);
                          setDiscount(null);
                          setDiscountError('');
                        }}
                        code
                      />
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => void applyDiscount()} disabled={!discountCode.trim() || !plan || checkingCode}>
                      {checkingCode ? 'در حال بررسی…' : 'اعمال کد'}
                    </Button>
                  </div>
                  {discount && (
                    <p className="tiny mt-6" style={{ color: 'var(--ok, #10B981)' }}>
                      {fa(discount.percent)}٪ تخفیف اعمال شد — مبلغ نهایی {fa(discount.final_price)} تومان
                    </p>
                  )}
                  {discountError && (
                    <p className="tiny mt-6 color-danger" role="alert">{discountError}</p>
                  )}
                </Card>

                <Card className="mt-16 card--glass">
                  <div className="h3 mb-12">با اشتراک به این امکانات دسترسی دارید</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {FEATURES.map((feat) => (
                      <div key={feat} className="row gap-8" style={{ alignItems: 'flex-start' }}>
                        <div style={{ color: 'var(--hym-neon-cyan)', marginTop: 2 }}>
                          <Icon name="i-check" size={16} />
                        </div>
                        <span className="small">{feat}</span>
                      </div>
                    ))}
                  </div>
                </Card>

                <div className="mt-20 mb-24">
                  {payError && (
                    <p className="notice notice--warn mb-12" role="alert">{payError}</p>
                  )}
                  {onlinePay ? (
                    <>
                      <Button variant="primary" block loading={paying} disabled={!plan || status.has_pending_payment} onClick={() => void pay()}>
                        {plan ? `پرداخت ${fa(finalPrice)} تومان` : 'یک پلن انتخاب کنید'}
                      </Button>
                      <p className="tiny color-muted mt-8 text-center">
                        به درگاه امن زرین‌پال منتقل می‌شوید و پس از پرداخت، اشتراک خودکار فعال می‌شود.
                      </p>
                    </>
                  ) : (
                    <>
                      <a className="btn btn--primary btn--block" href={botLink} target="_blank" rel="noopener noreferrer">
                        خرید اشتراک در ربات تلگرام
                      </a>
                      <p className="tiny color-muted mt-8 text-center">
                        پرداخت آنلاین فعلاً فعال نیست؛ خرید با کارت‌به‌کارت از طریق ربات انجام می‌شود.
                      </p>
                    </>
                  )}
                </div>
              </>
            )}
          </>
        ) : null}
      </div>
    </>
  );
}
