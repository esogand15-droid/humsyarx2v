import { useCallback, useEffect, useMemo, useState } from 'react';

import './account.css';
import { SkeletonStack } from '../components';
import { AppBar } from '../components/AppBar';
import { DsBadge, DsButton, DsCard } from '../design/components';
import { Icon } from '../icons';
import { apiCall, errorText } from '../lib/api';
import { faDate, faDigits, faNum } from '../lib/fa';

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
  'بانک سؤال و آزمون‌های زمان‌دار با کارنامهٔ تحلیلی',
  'دستیار هوشیار برای پرسش و تحلیل تصویر بالینی',
  'یادداشت‌برداری با قلم دیجیتال و همگام‌سازی روی همهٔ دستگاه‌ها',
];

function newIdem(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

/** اشتراک و تمدید — چیدمان دوتایی دسکتاپ، نوار پرداخت چسبان بالای تب‌بار موبایل، و جداکنندهٔ فارسی `٬`. */
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
      const list = Array.isArray(s?.plans) ? s.plans : [];
      setSelectedPlan((cur) => cur || list[0]?.id || '');
    } catch (err) {
      setLoadError(errorText(err, 'دریافت وضعیت اشتراک ممکن نشد.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const plans = useMemo(() => (Array.isArray(status?.plans) ? status!.plans : []), [status]);
  const plan = plans.find((p) => p.id === selectedPlan) || null;
  const finalPrice =
    discount && plan && discount.price === plan.price ? discount.final_price : (plan?.price ?? 0);
  const onlinePay = Boolean(gateway?.online_pay_enabled);
  const botLink = `https://t.me/${gateway?.bot_username || 'HumsYarBot'}`;

  // نرخ پایهٔ روزانه از کوتاه‌ترین پلن پولی برای محاسبهٔ درصد صرفه‌جویی پلن‌های بلندمدت
  const baseDailyRate = useMemo(() => {
    const paid = plans.filter((p) => p.days > 0 && p.price > 0);
    if (paid.length === 0) return 0;
    const shortest = paid.reduce((a, b) => (a.days <= b.days ? a : b));
    return shortest.price / shortest.days;
  }, [plans]);

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

  const expiresLabel = status?.expires_fa
    ? faDigits(status.expires_fa)
    : status?.expires
      ? faDate(status.expires)
      : '';

  return (
    <>
      <AppBar title="طرح‌های اشتراک" sub="دسترسی جامع به منابع و هوش پزشکی" back />

      <div className="page page-enter acct-page acct-sub-page">
        {loadError && (
          <DsCard>
            <div className="acct-notice acct-notice--danger" role="alert">
              <div className="acct-notice__lead">
                <Icon name="i-alert-circle" size={18} />
                <span>{loadError}</span>
              </div>
              <DsButton variant="secondary" size="md" onClick={() => void load()}>
                تلاش دوباره
              </DsButton>
            </div>
          </DsCard>
        )}

        {!status && !loadError ? (
          <SkeletonStack rows={4} />
        ) : status ? (
          <div className="acct-two-col">
            <div className="acct-col-main">
              <DsCard
                className={`acct-card-stack acct-sub-status${status.active ? ' is-active' : ''}`}
              >
                <div className="acct-sec-head">
                  <div>
                    <h2 className="ds-card__title">
                      {status.active
                        ? status.stacked || !status.plan_name
                          ? 'اشتراک فعال'
                          : status.plan_name
                        : 'اشتراک فعالی ندارید'}
                    </h2>
                    {status.active && (
                      <p className="ds-card__sub">
                        {faNum(status.days_left)} روز باقی‌مانده
                        {expiresLabel ? ` · تا ${expiresLabel}` : ''}
                      </p>
                    )}
                  </div>
                  <DsBadge tone={status.active ? 'success' : 'neutral'}>
                    {status.active && <Icon name="i-check" size={12} />}
                    <span>{status.active ? 'فعال' : 'غیرفعال'}</span>
                  </DsBadge>
                </div>

                {status.has_pending_payment && (
                  <div className="acct-notice acct-notice--warn" role="status">
                    <span>
                      یک رسید پرداخت شما در انتظار بررسی است؛ پس از تأیید، روزها به اشتراک اضافه
                      می‌شود.
                    </span>
                  </div>
                )}
              </DsCard>

              {plans.length === 0 ? (
                <DsCard>
                  <p className="ds-card__sub">در حال حاضر پلن فعالی برای خرید تعریف نشده است.</p>
                </DsCard>
              ) : (
                <>
                  <div className="acct-sec-head">
                    <h2 className="acct-sec-head__title">
                      {status.active ? 'تمدید اشتراک' : 'انتخاب پلن'}
                    </h2>
                    <span className="acct-sec-head__sub">{faNum(plans.length)} طرح</span>
                  </div>

                  <div className="acct-plans-grid" role="radiogroup" aria-label="پلن‌های اشتراک">
                    {plans.map((p) => {
                      const isSelected = selectedPlan === p.id;
                      const monthlyEq =
                        p.days > 31 && p.price > 0 ? Math.round((p.price / p.days) * 30) : null;
                      const savingsPct =
                        p.days > 31 && p.price > 0 && baseDailyRate > 0
                          ? Math.round((1 - p.price / p.days / baseDailyRate) * 100)
                          : 0;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          onClick={() => choosePlan(p.id)}
                          className={`acct-plan-card${isSelected ? ' is-selected' : ''}`}
                        >
                          <div className="acct-plan-card__top">
                            <span className="acct-plan-card__lead">
                              <span className="acct-plan-radio" aria-hidden="true">
                                {isSelected && <span className="acct-plan-radio__dot" />}
                              </span>
                              <span>
                                <span className="acct-plan-card__title">{p.name}</span>
                                {p.days > 0 && (
                                  <span className="acct-plan-card__days">
                                    {faNum(p.days)} روز دسترسی
                                  </span>
                                )}
                              </span>
                            </span>

                            <span className="acct-plan-card__price">
                              <span>{p.price > 0 ? faNum(p.price) : 'رایگان'}</span>
                              {p.price > 0 && <span className="acct-plan-card__unit">تومان</span>}
                            </span>
                          </div>

                          {(monthlyEq !== null || savingsPct >= 5) && (
                            <div className="acct-plan-card__foot">
                              {monthlyEq !== null && (
                                <span className="acct-sec-head__sub">
                                  معادل ماهانه {faNum(monthlyEq)} تومان
                                </span>
                              )}
                              {savingsPct >= 5 && (
                                <DsBadge tone="success">{faNum(savingsPct)}٪ صرفه‌جویی</DsBadge>
                              )}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              <DsCard className="acct-card-stack">
                <h2 className="ds-card__title">امکانات اشتراک کامل</h2>
                <ul className="acct-feature-list">
                  {FEATURES.map((feat) => (
                    <li key={feat} className="acct-feature-item">
                      <Icon name="i-check" size={16} className="acct-feature-item__icon" />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </DsCard>
            </div>

            {plans.length > 0 && (
              <aside className="acct-col-side">
                <DsCard className="acct-card-stack">
                  <div className="ds-field">
                    <label className="ds-field__label" htmlFor="sub-discount-code">
                      کد تخفیف
                    </label>
                    <div className="acct-discount-row">
                      <div className="acct-discount-row__field">
                        <input
                          id="sub-discount-code"
                          type="text"
                          className={`ds-input acct-code-input${
                            discountCode.trim() ? ' acct-code-input--filled' : ''
                          }`}
                          placeholder="کد را اینجا وارد کنید"
                          value={discountCode}
                          onChange={(e) => {
                            setDiscountCode(e.target.value);
                            setDiscount(null);
                            setDiscountError('');
                          }}
                          autoCapitalize="characters"
                          autoComplete="off"
                        />
                      </div>
                      <DsButton
                        variant="secondary"
                        size="md"
                        className="acct-btn-tall"
                        onClick={() => void applyDiscount()}
                        disabled={!discountCode.trim() || !plan || checkingCode}
                        loading={checkingCode}
                      >
                        {checkingCode ? 'بررسی…' : 'اعمال کد'}
                      </DsButton>
                    </div>
                  </div>

                  {discount && (
                    <p className="acct-discount-ok" role="status">
                      {faNum(discount.percent)}٪ تخفیف اعمال شد؛ مبلغ نهایی{' '}
                      {faNum(discount.final_price)} تومان
                    </p>
                  )}
                  {discountError && (
                    <p className="acct-discount-err" role="alert">
                      {discountError}
                    </p>
                  )}

                  <p className="acct-pay-hint">
                    {onlinePay
                      ? 'انتقال به درگاه امن زرین‌پال · فعال‌سازی خودکار بلافاصله پس از پرداخت'
                      : 'پرداخت آنلاین فعلاً غیرفعال است؛ خرید از طریق ربات تلگرام انجام می‌شود.'}
                  </p>
                </DsCard>

                <div className="acct-pay-bar">
                  {payError && (
                    <div className="acct-notice acct-notice--danger" role="alert">
                      <span>{payError}</span>
                    </div>
                  )}

                  {plan && (
                    <div className="acct-pay-summary">
                      <span>{plan.name}</span>
                      <span className="acct-pay-summary__price">
                        {finalPrice > 0 ? `${faNum(finalPrice)} تومان` : 'رایگان'}
                      </span>
                    </div>
                  )}

                  {onlinePay ? (
                    <DsButton
                      variant="primary"
                      size="lg"
                      block
                      loading={paying}
                      disabled={!plan || status.has_pending_payment}
                      onClick={() => void pay()}
                    >
                      {plan ? `پرداخت ${faNum(finalPrice)} تومان` : 'یک پلن انتخاب کنید'}
                    </DsButton>
                  ) : (
                    <a
                      className="ds-btn ds-btn--lg ds-btn--block"
                      href={botLink}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      خرید اشتراک در ربات تلگرام
                    </a>
                  )}
                </div>
              </aside>
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}
