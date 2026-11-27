import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import './account.css';
import { SkeletonStack, Toast } from '../components';
import { AppBar } from '../components/AppBar';
import { DsBadge, DsButton, DsCard, DsChip, DsSegmented } from '../design/components';
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

interface TrialStatus {
  eligible: boolean;
  reason?: string;
  days?: number;
  used?: boolean;
}

interface PaymentRecord {
  id: string;
  plan_name: string;
  final_price: number;
  status: string;
  submitted_at?: string;
  discount_code?: string;
  zarinpal_ref_id?: string;
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
  trial?: TrialStatus;
  payments?: PaymentRecord[];
  payment?: { card_number?: string; card_owner?: string };
}

interface GatewayStatus {
  online_pay_enabled: boolean;
}

interface DiscountResult {
  ok: boolean;
  code: string;
  percent: number;
  price: number;
  final_price: number;
}

interface WalletPayload {
  balance: number;
  tx_count?: number;
  transactions: Array<{
    id: string;
    type?: string;
    direction?: string;
    amount: number;
    label?: string;
    at?: string;
    balance_after?: number;
  }>;
}

interface FamilyPayload {
  role: 'owner' | 'member';
  owner_name?: string;
  plan_name?: string;
  end_date?: string;
  seats_total?: number;
  seats_used?: number;
  seats_left?: number;
  members?: Array<{ user_id: number; name: string; status?: string; end_date?: string }>;
}

interface GiftItem {
  id: string;
  plan_name: string;
  final_price: number;
  status: string;
  submitted_at?: string;
  to?: number;
  from?: number;
  message?: string;
  activated_at?: string | null;
}

interface RecipientItem {
  user_id: number;
  name: string;
  username?: string;
}

type SubTab = 'plans' | 'wallet' | 'family' | 'history';
type PayMethod = 'zarinpal' | 'wallet' | 'card' | 'free';

const FEATURES = [
  'دسترسی کامل به جزوه‌ها، اسلایدها و منابع محافظت‌شده در کتابخوان',
  'بانک سؤال، طراحی سؤال و آزمون‌های زمان‌دار با کارنامهٔ تحلیلی',
  'دستیار هوشیار برای پرسش صوتی/تصویری، جزوه‌نویس و تماس زنده',
  'یادداشت‌برداری با قلم دیجیتال و نگهداری امن در دفتر من',
];

const PAYMENT_STATUS_FA: Record<string, { label: string; tone: 'success' | 'neutral' | 'danger' }> = {
  approved: { label: 'تأییدشده', tone: 'success' },
  pending: { label: 'در انتظار بررسی', tone: 'neutral' },
  zarinpal_pending: { label: 'در انتظار پرداخت آنلاین', tone: 'neutral' },
  rejected: { label: 'ردشده', tone: 'danger' },
  expired: { label: 'منقضی', tone: 'danger' },
};

function newIdem(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function zarinpalCallbackUrl(): string {
  const base = (import.meta.env.BASE_URL || '/student').replace(/\/+$/, '');
  return `${window.location.origin}${base}/payment/verify`;
}

/** اشتراک، کیف پول، طرح خانواده، هدیه و پرداخت مستقیم (کارت‌به‌کارت + زرین‌پال) — ۱۰۰٪ مستقل در وب. */
export function SubscriptionScreen() {
  const [tab, setTab] = useState<SubTab>('plans');
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [gateway, setGateway] = useState<GatewayStatus | null>(null);
  const [wallet, setWallet] = useState<WalletPayload | null>(null);
  const [family, setFamily] = useState<FamilyPayload | null>(null);
  const [gifts, setGifts] = useState<{ as_payer: GiftItem[]; as_recipient: GiftItem[] } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  // خرید و پلن‌ها
  const [selectedPlan, setSelectedPlan] = useState('');
  const [discountCode, setDiscountCode] = useState('');
  const [discount, setDiscount] = useState<DiscountResult | null>(null);
  const [discountError, setDiscountError] = useState('');
  const [checkingCode, setCheckingCode] = useState(false);
  const [payMethod, setPayMethod] = useState<PayMethod>('card');
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState('');
  const [idem, setIdem] = useState(newIdem);
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // هدیه به دوست
  const [isGift, setIsGift] = useState(false);
  const [giftQuery, setGiftQuery] = useState('');
  const [giftCandidates, setGiftCandidates] = useState<RecipientItem[]>([]);
  const [giftRecipient, setGiftRecipient] = useState<RecipientItem | null>(null);
  const [giftMessage, setGiftMessage] = useState('');

  // کیف پول
  const [topupAmount, setTopupAmount] = useState('100000');
  const [topupMethod, setTopupMethod] = useState<'zarinpal' | 'card'>('card');
  const [topupReceipt, setTopupReceipt] = useState<File | null>(null);
  const [topupBusy, setTopupBusy] = useState(false);

  // خانواده
  const [familyInviteCode, setFamilyInviteCode] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');
  const [familyBusy, setFamilyBusy] = useState(false);

  // دوره آزمایشی
  const [trialBusy, setTrialBusy] = useState(false);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  };

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const [s, g, w, f, gf] = await Promise.all([
        apiCall<StatusPayload>('/subscription/status'),
        apiCall<GatewayStatus>('/subscription/gateway-status').catch(() => null),
        apiCall<WalletPayload>('/subscription/wallet').catch(() => null),
        apiCall<FamilyPayload>('/subscription/family').catch(() => null),
        apiCall<{ as_payer: GiftItem[]; as_recipient: GiftItem[] }>('/subscription/gifts').catch(() => null),
      ]);
      setStatus(s);
      setGateway(g);
      if (w) setWallet(w);
      if (f) setFamily(f);
      if (gf) setGifts(gf);
      const list = Array.isArray(s?.plans) ? s.plans : [];
      setSelectedPlan((cur) => cur || list[0]?.id || '');
      if (g?.online_pay_enabled) {
        setPayMethod((cur) => (cur === 'card' ? 'zarinpal' : cur));
        setTopupMethod('zarinpal');
      }
    } catch (err) {
      setLoadError(errorText(err, 'دریافت وضعیت اشتراک ممکن نشد.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // جستجوی گیرنده هدیه با تأخیر کوتاه
  useEffect(() => {
    if (!isGift || giftQuery.trim().length < 2) {
      setGiftCandidates([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void apiCall<{ items: RecipientItem[] }>(
        `/subscription/gift/recipients?q=${encodeURIComponent(giftQuery.trim())}`,
      )
        .then((res) => setGiftCandidates(res.items || []))
        .catch(() => setGiftCandidates([]));
    }, 280);
    return () => window.clearTimeout(timer);
  }, [isGift, giftQuery]);

  // پیش‌نمایش رسید انتخاب‌شده
  useEffect(() => {
    if (!receiptFile) {
      setReceiptPreview('');
      return;
    }
    const url = URL.createObjectURL(receiptFile);
    setReceiptPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [receiptFile]);

  const plans = useMemo(() => (Array.isArray(status?.plans) ? status!.plans : []), [status]);
  const plan = plans.find((p) => p.id === selectedPlan) || null;
  const finalPrice =
    discount && plan && discount.price === plan.price ? discount.final_price : (plan?.price ?? 0);
  const onlinePay = Boolean(gateway?.online_pay_enabled);
  const effectiveMethod: PayMethod = finalPrice <= 0 && plan ? 'free' : payMethod;

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

  const claimTrial = async () => {
    if (trialBusy) return;
    setTrialBusy(true);
    try {
      const res = await apiCall<{ ok: boolean; days?: number }>('/subscription/trial', { method: 'POST' });
      flash(`دورهٔ آزمایشی ${res.days ? `${faNum(res.days)} روزه ` : ''}با موفقیت فعال شد!`);
      await load();
    } catch (err) {
      flash(errorText(err, 'فعال‌سازی دوره آزمایشی ممکن نشد.'));
    } finally {
      setTrialBusy(false);
    }
  };

  const submitCheckout = async () => {
    if (!plan || paying) return;
    if (isGift && !giftRecipient) {
      setPayError('لطفاً ابتدا گیرندهٔ هدیه را از نتایج جستجو انتخاب کنید.');
      return;
    }
    setPaying(true);
    setPayError('');
    try {
      if (effectiveMethod === 'free') {
        const fd = new FormData();
        fd.append('plan_id', plan.id);
        fd.append('discount_code', discount?.code || discountCode.trim());
        fd.append('idem', idem);
        if (isGift && giftRecipient) {
          fd.append('gift_to', String(giftRecipient.user_id));
          fd.append('gift_message', giftMessage.trim());
        }
        const res = await apiCall<{ ok: boolean; message?: string }>('/subscription/buy', {
          method: 'POST',
          body: fd,
        });
        flash(res.message || 'اشتراک رایگان فعال شد.');
        setDiscount(null);
        setDiscountCode('');
        await load();
        return;
      }

      if (effectiveMethod === 'zarinpal') {
        const res = await apiCall<{ ok: boolean; url: string }>('/subscription/zarinpal/request', {
          method: 'POST',
          body: JSON.stringify({
            plan_id: plan.id,
            discount_code: discount?.code || '',
            gift_to: isGift && giftRecipient ? giftRecipient.user_id : 0,
            gift_message: isGift ? giftMessage.trim() : '',
            callback_url: zarinpalCallbackUrl(),
            idem,
          }),
        });
        if (res?.url) {
          window.location.assign(res.url);
          return;
        }
        setPayError('آدرس درگاه دریافت نشد. دوباره تلاش کنید.');
        return;
      }

      if (effectiveMethod === 'wallet') {
        const res = await apiCall<{ ok: boolean; balance?: number }>('/subscription/buy-wallet', {
          method: 'POST',
          body: JSON.stringify({
            plan_id: plan.id,
            discount_code: discount?.code || '',
            idem,
          }),
        });
        flash('اشتراک شما از اعتبار کیف پول فعال شد!');
        if (typeof res.balance === 'number') {
          setWallet((w) => (w ? { ...w, balance: res.balance! } : w));
        }
        await load();
        return;
      }

      // کارت‌به‌کارت با رسید بانکی
      if (!rulesAccepted) {
        setPayError('لطفاً قوانین اشتراک را تأیید کنید.');
        return;
      }
      if (!receiptFile) {
        setPayError('تصویر رسید واریز را انتخاب کنید.');
        return;
      }
      const fd = new FormData();
      fd.append('plan_id', plan.id);
      fd.append('discount_code', discount?.code || '');
      fd.append('receipt', receiptFile);
      fd.append('idem', idem);
      if (isGift && giftRecipient) {
        fd.append('gift_to', String(giftRecipient.user_id));
        fd.append('gift_message', giftMessage.trim());
      }
      await apiCall<{ ok: boolean; payment_id: string }>('/subscription/buy', {
        method: 'POST',
        body: fd,
      });
      setReceiptFile(null);
      setIdem(newIdem());
      flash('رسید واریز با موفقیت ثبت شد و پس از بررسی تأیید می‌شود.');
      await load();
    } catch (err) {
      setPayError(errorText(err, 'ثبت یا انجام پرداخت ممکن نشد.'));
      setIdem(newIdem());
    } finally {
      setPaying(false);
    }
  };

  const handleWalletTopup = async () => {
    const amount = Number(topupAmount.replace(/[,٬\s]/g, ''));
    if (!Number.isFinite(amount) || amount < 1000 || topupBusy) {
      flash('مبلغ معتبر وارد کنید.');
      return;
    }
    setTopupBusy(true);
    try {
      if (topupMethod === 'zarinpal') {
        const res = await apiCall<{ ok: boolean; url?: string }>('/subscription/zarinpal/topup', {
          method: 'POST',
          body: JSON.stringify({ amount, callback_url: zarinpalCallbackUrl(), idem: newIdem() }),
        });
        if (res.url) {
          window.location.assign(res.url);
          return;
        }
      } else {
        if (!topupReceipt) {
          flash('تصویر رسید شارژ کیف پول را انتخاب کنید.');
          return;
        }
        const fd = new FormData();
        fd.append('amount', String(Math.round(amount)));
        fd.append('receipt', topupReceipt);
        fd.append('idem', newIdem());
        const res = await apiCall<{ ok: boolean; message?: string }>('/subscription/topup', {
          method: 'POST',
          body: fd,
        });
        setTopupReceipt(null);
        flash(res.message || 'رسید شارژ کیف پول ثبت شد.');
        await load();
      }
    } catch (err) {
      flash(errorText(err, 'ثبت شارژ کیف پول ناموفق بود.'));
    } finally {
      setTopupBusy(false);
    }
  };

  const copyCard = async () => {
    const card = status?.payment?.card_number?.replace(/[-\s]/g, '') || '';
    if (!card || card === '—') return;
    try {
      await navigator.clipboard.writeText(card);
      flash('شماره کارت کپی شد.');
    } catch {
      flash('امکان کپی خودکار نبود.');
    }
  };

  const createFamilyCode = async () => {
    if (familyBusy) return;
    setFamilyBusy(true);
    try {
      const res = await apiCall<{ ok: boolean; code: string }>('/subscription/family/code', { method: 'POST' });
      setGeneratedCode(res.code);
      flash('کد دعوت جدید ساخته شد.');
    } catch (err) {
      flash(errorText(err));
    } finally {
      setFamilyBusy(false);
    }
  };

  const redeemFamilyCode = async () => {
    if (!familyInviteCode.trim() || familyBusy) return;
    setFamilyBusy(true);
    try {
      await apiCall<{ ok: boolean }>('/subscription/family/redeem', {
        method: 'POST',
        body: JSON.stringify({ code: familyInviteCode.trim() }),
      });
      setFamilyInviteCode('');
      flash('عضویت در پلن خانواده با موفقیت انجام شد!');
      await load();
    } catch (err) {
      flash(errorText(err));
    } finally {
      setFamilyBusy(false);
    }
  };

  const removeFamilyMember = async (memberId: number) => {
    if (familyBusy) return;
    setFamilyBusy(true);
    try {
      await apiCall<{ ok: boolean }>(`/subscription/family/members/${memberId}`, { method: 'DELETE' });
      flash('عضو از گروه خانواده حذف شد.');
      await load();
    } catch (err) {
      flash(errorText(err));
    } finally {
      setFamilyBusy(false);
    }
  };

  const expiresLabel = status?.expires_fa
    ? faDigits(status.expires_fa)
    : status?.expires
      ? faDate(status.expires)
      : '';

  const cardNumber = status?.payment?.card_number && status.payment.card_number !== '—' ? status.payment.card_number : '';
  const cardOwner = status?.payment?.card_owner && status.payment.card_owner !== '—' ? status.payment.card_owner : '';

  const paymentOptions: Array<{ value: PayMethod; label: string }> = [
    ...(onlinePay ? [{ value: 'zarinpal' as const, label: 'درگاه آنلاین' }] : []),
    ...(!isGift && wallet ? [{ value: 'wallet' as const, label: `کیف پول (${faNum(wallet.balance)})` }] : []),
    { value: 'card', label: 'کارت‌به‌کارت' },
  ];

  return (
    <>
      <AppBar title="اشتراک و امور مالی" sub="طرح‌ها، کیف پول، خانواده، هدیه و سوابق پرداخت" back />

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
          <div className="acct-stack">
            <DsSegmented
              value={tab}
              onChange={(v) => setTab(v)}
              label="بخش‌های اشتراک"
              block
              options={[
                { value: 'plans', label: 'طرح‌ها و خرید' },
                { value: 'wallet', label: 'کیف پول' },
                { value: 'family', label: 'خانواده' },
                { value: 'history', label: 'هدیه و سوابق' },
              ]}
            />

            {tab === 'plans' && (
              <div className="acct-two-col">
                <div className="acct-col-main">
                  <DsCard className={`acct-card-stack acct-sub-status${status.active ? ' is-active' : ''}`}>
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
                            {faNum(status.days_left ?? 0)} روز باقی‌مانده
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
                          یک رسید پرداخت شما در انتظار بررسی است؛ پس از تأیید، اشتراک فوراً فعال می‌شود.
                        </span>
                      </div>
                    )}

                    {!status.active && status.trial?.eligible && (
                      <div className="acct-notice acct-notice--warn" style={{ alignItems: 'center' }}>
                        <span>
                          دورهٔ آزمایشی {faNum(status.trial.days || 3)} روزهٔ رایگان برای تست کامل همهٔ
                          امکانات فعال است!
                        </span>
                        <DsButton variant="primary" size="sm" loading={trialBusy} onClick={() => void claimTrial()}>
                          فعال‌سازی رایگان
                        </DsButton>
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
                          {status.active ? 'تمدید یا ارتقای اشتراک' : 'انتخاب پلن'}
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
                                    <span className="acct-plan-card__title">
                                      {p.name}
                                      {p.max_members && p.max_members > 1
                                        ? ` · تا ${faNum(p.max_members)} نفر`
                                        : ''}
                                    </span>
                                    {p.days > 0 && (
                                      <span className="acct-plan-card__days">{faNum(p.days)} روز دسترسی</span>
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
                    {/* خرید برای خودم یا هدیه به دوست */}
                    <DsCard className="acct-card-stack">
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <DsChip selected={!isGift} onClick={() => setIsGift(false)}>
                          خرید برای خودم
                        </DsChip>
                        <DsChip
                          selected={isGift}
                          onClick={() => {
                            setIsGift(true);
                            if (payMethod === 'wallet') setPayMethod(onlinePay ? 'zarinpal' : 'card');
                          }}
                        >
                          هدیه به هم‌کلاسی
                        </DsChip>
                      </div>

                      {isGift && (
                        <div className="core-stack" style={{ marginTop: 6 }}>
                          {giftRecipient ? (
                            <div
                              className="acct-notice acct-notice--warn"
                              style={{ alignItems: 'center', justifyContent: 'space-between' }}
                            >
                              <span>
                                گیرنده: <strong>{giftRecipient.name}</strong>{' '}
                                {giftRecipient.username ? `(@${giftRecipient.username})` : ''}
                              </span>
                              <DsButton size="sm" variant="ghost" onClick={() => setGiftRecipient(null)}>
                                تغییر
                              </DsButton>
                            </div>
                          ) : (
                            <>
                              <input
                                type="search"
                                className="ds-input"
                                placeholder="نام یا یوزرنیم گیرنده را جستجو کنید…"
                                value={giftQuery}
                                onChange={(e) => setGiftQuery(e.target.value)}
                              />
                              {giftCandidates.length > 0 && (
                                <div className="ds-list">
                                  {giftCandidates.map((u) => (
                                    <button
                                      key={u.user_id}
                                      type="button"
                                      className="ds-list__row"
                                      style={{
                                        width: '100%',
                                        textAlign: 'start',
                                        padding: '8px 10px',
                                        background: 'transparent',
                                        border: 'none',
                                        color: 'inherit',
                                        cursor: 'pointer',
                                      }}
                                      onClick={() => {
                                        setGiftRecipient(u);
                                        setGiftCandidates([]);
                                      }}
                                    >
                                      {u.name} {u.username ? `(@${u.username})` : ''}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                          <input
                            type="text"
                            className="ds-input"
                            placeholder="پیام تبریک یا یادداشت همراه هدیه (اختیاری)"
                            value={giftMessage}
                            onChange={(e) => setGiftMessage(e.target.value)}
                            maxLength={250}
                          />
                        </div>
                      )}

                      {/* کد تخفیف */}
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

                      {finalPrice > 0 && (
                        <DsSegmented
                          value={payMethod === 'free' ? 'card' : payMethod}
                          onChange={(v) => setPayMethod(v)}
                          label="روش پرداخت"
                          block
                          options={paymentOptions}
                        />
                      )}

                      {effectiveMethod === 'card' && (
                        <div className="core-stack">
                          {cardNumber ? (
                            <DsCard level="sunken" className="acct-card-stack">
                              <div className="acct-sec-head">
                                <span className="small muted">شماره کارت مقصد</span>
                                <DsButton size="sm" variant="ghost" onClick={() => void copyCard()}>
                                  <Icon name="i-copy" size={14} />
                                  کپی شماره
                                </DsButton>
                              </div>
                              <strong dir="ltr" style={{ fontSize: 16, letterSpacing: 1 }}>
                                {cardNumber}
                              </strong>
                              {cardOwner && <span className="small muted">به نام: {cardOwner}</span>}
                            </DsCard>
                          ) : (
                            <p className="small muted" style={{ margin: 0 }}>
                              مبلغ را به شماره کارت اعلام‌شده واریز کرده و تصویر رسید را بارگذاری کنید.
                            </p>
                          )}

                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            hidden
                            onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
                          />
                          <DsButton
                            variant="secondary"
                            onClick={() => fileInputRef.current?.click()}
                            block
                          >
                            <Icon name="i-upload" size={16} />
                            {receiptFile ? `رسید انتخاب‌شده: ${receiptFile.name}` : 'انتخاب تصویر رسید واریز'}
                          </DsButton>

                          {receiptPreview && (
                            <img
                              src={receiptPreview}
                              alt="پیش‌نمایش رسید"
                              style={{
                                width: '100%',
                                maxHeight: 180,
                                objectFit: 'contain',
                                borderRadius: 10,
                                border: '1px solid var(--line)',
                              }}
                            />
                          )}

                          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                            <input
                              type="checkbox"
                              checked={rulesAccepted}
                              onChange={(e) => setRulesAccepted(e.target.checked)}
                            />
                            <span>اشتراک صرفاً برای استفادهٔ شخصی من است و قوانین را می‌پذیرم.</span>
                          </label>
                        </div>
                      )}

                      <p className="acct-pay-hint">
                        {effectiveMethod === 'zarinpal'
                          ? 'انتقال به درگاه امن زرین‌پال · فعال‌سازی خودکار بلافاصله پس از پرداخت'
                          : effectiveMethod === 'wallet'
                            ? 'کسر آنی از اعتبار کیف پول و فعال‌سازی بلافاصله بدون نیاز به انتظار'
                            : effectiveMethod === 'free'
                              ? 'تخفیف ۱۰۰٪ تایید شد؛ اشتراک همین لحظه به صورت رایگان فعال می‌شود.'
                              : 'پس از بارگذاری تصویر رسید، درخواست شما به‌صورت خودکار برای تأیید ارسال می‌شود.'}
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
                          <span>
                            {plan.name}
                            {isGift && giftRecipient ? ` (هدیه به ${giftRecipient.name})` : ''}
                          </span>
                          <span className="acct-pay-summary__price">
                            {finalPrice > 0 ? `${faNum(finalPrice)} تومان` : 'رایگان'}
                          </span>
                        </div>
                      )}

                      <DsButton
                        variant="primary"
                        size="lg"
                        block
                        loading={paying}
                        disabled={!plan || (effectiveMethod !== 'free' && Boolean(status.has_pending_payment))}
                        onClick={() => void submitCheckout()}
                      >
                        {effectiveMethod === 'free'
                          ? 'فعال‌سازی رایگان اشتراک'
                          : effectiveMethod === 'card'
                            ? 'ثبت رسید واریز'
                            : effectiveMethod === 'wallet'
                              ? `پرداخت ${faNum(finalPrice)} تومان از کیف پول`
                              : `پرداخت آنلاین ${faNum(finalPrice)} تومان`}
                      </DsButton>
                    </div>
                  </aside>
                )}
              </div>
            )}

            {/* ── تب کیف پول ── */}
            {tab === 'wallet' && (
              <div className="acct-two-col">
                <div className="acct-col-main">
                  <DsCard className="acct-card-stack">
                    <div className="acct-sec-head">
                      <div>
                        <p className="small muted" style={{ margin: 0 }}>اعتبار فعلی کیف پول</p>
                        <h2 className="h2" style={{ margin: '4px 0 0' }}>
                          {faNum(wallet?.balance ?? 0)} تومان
                        </h2>
                      </div>
                      <DsBadge tone="accent">{faNum(wallet?.tx_count ?? wallet?.transactions?.length ?? 0)} تراکنش</DsBadge>
                    </div>
                  </DsCard>

                  <DsCard className="acct-card-stack">
                    <h3 className="h3" style={{ margin: 0 }}>تراکنش‌های اخیر</h3>
                    {!wallet?.transactions?.length ? (
                      <p className="small muted" style={{ margin: 0 }}>هنوز تراکنشی ثبت نشده است.</p>
                    ) : (
                      <div className="ds-list">
                        {wallet.transactions.map((t) => (
                          <div
                            key={t.id}
                            className="ds-list__row"
                            style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 4px', gap: 10 }}
                          >
                            <div>
                              <div className="small" style={{ fontWeight: 600 }}>{t.label || 'تراکنش کیف پول'}</div>
                              {t.at && <div className="tiny muted">{faDate(t.at)}</div>}
                            </div>
                            <strong
                              style={{
                                color: t.direction === 'credit' ? 'var(--hym-role-grades-text)' : 'var(--hym-role-danger-text)',
                              }}
                            >
                              {t.direction === 'credit' ? '+' : '−'}
                              {faNum(t.amount)} تومان
                            </strong>
                          </div>
                        ))}
                      </div>
                    )}
                  </DsCard>
                </div>

                <aside className="acct-col-side">
                  <DsCard className="acct-card-stack">
                    <h3 className="h3" style={{ margin: 0 }}>افزایش موجودی</h3>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {['50000', '100000', '250000', '500000'].map((preset) => (
                        <DsChip
                          key={preset}
                          selected={topupAmount === preset}
                          onClick={() => setTopupAmount(preset)}
                        >
                          {faNum(Number(preset))} تومان
                        </DsChip>
                      ))}
                    </div>
                    <input
                      type="number"
                      className="ds-input"
                      value={topupAmount}
                      onChange={(e) => setTopupAmount(e.target.value)}
                      placeholder="مبلغ دلخواه (تومان)"
                    />
                    {onlinePay && (
                      <DsSegmented
                        value={topupMethod}
                        onChange={(v) => setTopupMethod(v)}
                        label="روش شارژ"
                        block
                        options={[
                          { value: 'zarinpal', label: 'درگاه آنلاین' },
                          { value: 'card', label: 'آپلود رسید' },
                        ]}
                      />
                    )}
                    {topupMethod === 'card' && (
                      <div className="core-stack">
                        {cardNumber && (
                          <p className="small muted" style={{ margin: 0 }}>
                            کارت مقصد: <strong dir="ltr">{cardNumber}</strong> {cardOwner ? `(${cardOwner})` : ''}
                          </p>
                        )}
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => setTopupReceipt(e.target.files?.[0] || null)}
                        />
                      </div>
                    )}
                    <DsButton variant="primary" block loading={topupBusy} onClick={() => void handleWalletTopup()}>
                      {topupMethod === 'zarinpal' ? 'پرداخت آنلاین و شارژ آنی' : 'ثبت رسید شارژ کیف پول'}
                    </DsButton>
                  </DsCard>
                </aside>
              </div>
            )}

            {/* ── تب طرح خانواده ── */}
            {tab === 'family' && (
              <div className="acct-stack">
                {family?.role === 'member' ? (
                  <DsCard className="acct-card-stack">
                    <h2 className="h3" style={{ margin: 0 }}>عضویت در گروه خانواده فعال است</h2>
                    <p className="small muted" style={{ margin: 0 }}>
                      مالک گروه: <strong>{family.owner_name || 'سرپرست گروه'}</strong>
                      {family.plan_name ? ` · پلن: ${family.plan_name}` : ''}
                      {family.end_date ? ` · اعتبار تا ${faDate(family.end_date)}` : ''}
                    </p>
                  </DsCard>
                ) : (
                  <>
                    {(family?.seats_total || 0) > 1 && (
                      <DsCard className="acct-card-stack">
                        <div className="acct-sec-head">
                          <div>
                            <h2 className="h3" style={{ margin: 0 }}>مدیریت گروه خانواده</h2>
                            <p className="small muted" style={{ margin: '4px 0 0' }}>
                              ظرفیت استفاده‌شده: {faNum(family?.seats_used || 1)} از {faNum(family?.seats_total || 1)} نفر
                            </p>
                          </div>
                          <DsButton
                            variant="primary"
                            size="sm"
                            loading={familyBusy}
                            disabled={(family?.seats_left || 0) <= 0}
                            onClick={() => void createFamilyCode()}
                          >
                            ساخت کد دعوت یک‌بارمصرف
                          </DsButton>
                        </div>

                        {generatedCode && (
                          <div className="acct-notice acct-notice--warn" style={{ alignItems: 'center' }}>
                            <span>
                              کد دعوت جدید: <strong dir="ltr">{generatedCode}</strong>
                            </span>
                            <DsButton
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                void navigator.clipboard.writeText(generatedCode);
                                flash('کد دعوت کپی شد.');
                              }}
                            >
                              کپی کد
                            </DsButton>
                          </div>
                        )}

                        <div className="ds-list">
                          {(family?.members || []).map((m) => (
                            <div
                              key={m.user_id}
                              className="ds-list__row"
                              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 4px' }}
                            >
                              <div>
                                <div className="small" style={{ fontWeight: 600 }}>{m.name || `کاربر #${m.user_id}`}</div>
                                {m.end_date && <div className="tiny muted">تا {faDate(m.end_date)}</div>}
                              </div>
                              <DsButton variant="danger" size="sm" onClick={() => void removeFamilyMember(m.user_id)}>
                                حذف
                              </DsButton>
                            </div>
                          ))}
                        </div>
                      </DsCard>
                    )}

                    <DsCard className="acct-card-stack">
                      <h2 className="h3" style={{ margin: 0 }}>کد دعوت خانواده دارید؟</h2>
                      <p className="small muted" style={{ margin: 0 }}>
                        اگر هم‌کلاسی شما پلن گروهی/خانوادگی خریده، کد دعوت یک‌بارمصرف را اینجا ثبت کنید.
                      </p>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <input
                          type="text"
                          className="ds-input"
                          dir="ltr"
                          value={familyInviteCode}
                          onChange={(e) => setFamilyInviteCode(e.target.value.toUpperCase())}
                          placeholder="مثلاً FAM-123456"
                          style={{ flex: 1, minWidth: 180 }}
                        />
                        <DsButton
                          variant="primary"
                          loading={familyBusy}
                          disabled={!familyInviteCode.trim()}
                          onClick={() => void redeemFamilyCode()}
                        >
                          عضویت با کد
                        </DsButton>
                      </div>
                    </DsCard>
                  </>
                )}
              </div>
            )}

            {/* ── تب هدیه و سوابق پرداخت ── */}
            {tab === 'history' && (
              <div className="acct-stack">
                <DsCard className="acct-card-stack">
                  <h2 className="h3" style={{ margin: 0 }}>سوابق پرداخت‌ها و رسیدها</h2>
                  {!status.payments?.length ? (
                    <p className="small muted" style={{ margin: 0 }}>تاکنون پرداختی ثبت نشده است.</p>
                  ) : (
                    <div className="ds-list">
                      {status.payments.map((pm) => {
                        const st = PAYMENT_STATUS_FA[pm.status] || { label: pm.status, tone: 'neutral' as const };
                        return (
                          <div
                            key={pm.id}
                            className="ds-list__row"
                            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 4px', gap: 10 }}
                          >
                            <div>
                              <div className="small" style={{ fontWeight: 600 }}>{pm.plan_name || 'اشتراک'}</div>
                              <div className="tiny muted">
                                {faNum(pm.final_price)} تومان
                                {pm.submitted_at ? ` · ${faDate(pm.submitted_at)}` : ''}
                                {pm.zarinpal_ref_id ? ` · رهگیری: ${pm.zarinpal_ref_id}` : ''}
                              </div>
                            </div>
                            <DsBadge tone={st.tone}>{st.label}</DsBadge>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </DsCard>

                {gifts && (gifts.as_payer.length > 0 || gifts.as_recipient.length > 0) && (
                  <DsCard className="acct-card-stack">
                    <h2 className="h3" style={{ margin: 0 }}>هدیه‌های ارسالی و دریافتی</h2>
                    <div className="ds-list">
                      {gifts.as_recipient.map((g) => (
                        <div key={g.id} className="ds-list__row" style={{ padding: '10px 4px' }}>
                          <div className="small" style={{ fontWeight: 600 }}>
                            هدیهٔ دریافتی: {g.plan_name}
                          </div>
                          {g.message && <div className="tiny muted">پیام: {g.message}</div>}
                        </div>
                      ))}
                      {gifts.as_payer.map((g) => (
                        <div key={g.id} className="ds-list__row" style={{ padding: '10px 4px' }}>
                          <div className="small" style={{ fontWeight: 600 }}>
                            هدیهٔ ارسالی: {g.plan_name} ({faNum(g.final_price)} تومان)
                          </div>
                          {g.message && <div className="tiny muted">پیام: {g.message}</div>}
                        </div>
                      ))}
                    </div>
                  </DsCard>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>
      <Toast message={toast} />
    </>
  );
}
