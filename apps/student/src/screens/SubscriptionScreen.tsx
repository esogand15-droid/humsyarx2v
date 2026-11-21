import { useState } from 'react';
import { AppBar } from '../components/AppBar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { Input } from '../components/Input';
import { Icon } from '../icons';
import { fa } from '../lib/library';

interface Plan {
  id: string;
  name: string;
  period: string;
  price: number;
  originalPrice?: number;
  badge?: string;
  popular?: boolean;
}

const PLANS: Plan[] = [
  {
    id: 'month_1',
    name: 'اشتراک یک‌ماهه',
    period: '۳۰ روز دسترسی',
    price: 290000,
  },
  {
    id: 'month_3',
    name: 'اشتراک سه‌ماهه (فصلی)',
    period: '۹۰ روز دسترسی',
    price: 690000,
    originalPrice: 870000,
    badge: '۲۰٪ تخفیف',
    popular: true,
  },
  {
    id: 'year_1',
    name: 'اشتراک سالانه',
    period: '۳۶۵ روز دسترسی',
    price: 1990000,
    originalPrice: 3480000,
    badge: '۴۰٪ تخفیف ویژه',
  },
];

const FEATURES = [
  'دسترسی کامل به جزوات محافظت‌شده با کتابخوان WebP DRM',
  'آزمون‌های زمان‌دار و بانک سؤالات جامع پزشکی (QBank)',
  'تحلیل بالینی تصاویر رادیولوژی و دیاگرام‌ها با هوش‌یار Vision',
  'استریم هوشمند پاسخ‌های تشریحی با توکن‌های اختصاصی',
  'یادداشت‌برداری با قلم دیجیتال و همگام‌سازی ابری امن',
];

export function SubscriptionScreen() {
  const [selectedPlan, setSelectedPlan] = useState<string>('month_3');
  const [discountCode, setDiscountCode] = useState('');
  const [discountApplied, setDiscountApplied] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleApplyDiscount = () => {
    if (discountCode.trim()) {
      setDiscountApplied(true);
    }
  };

  const handlePayment = () => {
    setLoading(true);
    // زرین‌پال / درگاه پرداخت
    setTimeout(() => {
      setLoading(false);
      alert('اتصال به درگاه امن پرداخت بانکی (شاپرک / زرین‌پال)…');
    }, 800);
  };

  return (
    <>
      <AppBar title="طرح‌های اشتراک" sub="دسترسی جامع به منابع و هوش پزشکی" />

      <div className="page">
        {/* وضعیت اشتراک فعلی */}
        <Card
          className="mt-8 card--glass"
          style={{
            borderInlineStart: '4px solid var(--hym-neon-cyan)',
            padding: '16px 20px',
          }}
        >
          <div className="row row--between" style={{ alignItems: 'center' }}>
            <div>
              <div className="h3">طرح فعال شما: اشتراک پلاس دانشجویی</div>
              <p className="tiny color-muted mt-4">اعتبار تا پایان ترم تحصیلی جاری فعال است</p>
            </div>
            <Chip variant="cyan" icon="i-check">فعال</Chip>
          </div>
        </Card>

        {/* لیست طرح‌ها */}
        <div className="h3 mt-20 mb-12">انتخاب دورهٔ اشتراک</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {PLANS.map((plan) => {
            const isSelected = selectedPlan === plan.id;
            return (
              <div
                key={plan.id}
                onClick={() => setSelectedPlan(plan.id)}
                className={`card card--glass ${isSelected ? 'selected' : ''}`}
                style={{
                  cursor: 'pointer',
                  padding: '16px 20px',
                  border: isSelected ? '2px solid var(--hym-neon-cyan)' : '1px solid var(--line)',
                  boxShadow: isSelected ? '0 0 20px -4px rgba(0, 242, 254, 0.25)' : undefined,
                  transition: 'all var(--t-fast) ease',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div className="row row--between" style={{ alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        border: `2px solid ${isSelected ? 'var(--hym-neon-cyan)' : 'var(--line-2)'}`,
                        display: 'grid',
                        placeItems: 'center',
                      }}
                    >
                      {isSelected && (
                        <div
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: '50%',
                            background: 'var(--hym-neon-cyan)',
                          }}
                        />
                      )}
                    </div>
                    <div>
                      <div className="h3" style={{ fontSize: 15 }}>{plan.name}</div>
                      <div className="tiny color-muted mt-2">{plan.period}</div>
                    </div>
                  </div>

                  <div style={{ textAlign: 'left' }}>
                    <div className="h2 num" style={{ fontSize: 18, color: 'var(--brand)' }}>
                      {fa(plan.price)}
                      <span style={{ fontSize: 11, fontWeight: 500, marginInlineStart: 4 }}>تومان</span>
                    </div>
                    {plan.originalPrice && (
                      <div className="tiny color-muted" style={{ textDecoration: 'line-through' }}>
                        {fa(plan.originalPrice)} تومان
                      </div>
                    )}
                  </div>
                </div>

                {plan.badge && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      background: 'linear-gradient(135deg, var(--hym-brand-600), var(--hym-neon-cyan))',
                      color: '#0B0F19',
                      fontSize: 10,
                      fontWeight: 800,
                      padding: '2px 10px',
                      borderRadius: '0 0 10px 0',
                    }}
                  >
                    {plan.badge}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* کد تخفیف */}
        <Card className="mt-16 card--glass">
          <div className="row gap-8" style={{ alignItems: 'flex-end' }}>
            <div className="grow">
              <Input
                label="کد تخفیف یا کارت هدیه"
                placeholder="کد را اینجا وارد کنید"
                value={discountCode}
                onChange={(e) => setDiscountCode(e.target.value)}
                code
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleApplyDiscount}
              disabled={!discountCode.trim()}
            >
              اعمال کد
            </Button>
          </div>
          {discountApplied && (
            <p className="tiny mt-6" style={{ color: 'var(--ok, #10B981)' }}>
              کد تخفیف با موفقیت اعمال شد.
            </p>
          )}
        </Card>

        {/* امکانات بسته */}
        <Card className="mt-16 card--glass">
          <div className="h3 mb-12">امکانات دسترسی پلاس</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {FEATURES.map((feat, idx) => (
              <div key={idx} className="row gap-8" style={{ alignItems: 'flex-start' }}>
                <div style={{ color: 'var(--hym-neon-cyan)', marginTop: 2 }}>
                  <Icon name="i-check" size={16} />
                </div>
                <span className="small">{feat}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* دکمه پرداخت */}
        <div className="mt-20 mb-24">
          <Button
            variant="primary"
            block
            loading={loading}
            onClick={handlePayment}
          >
            پرداخت و تمدید اشتراک
          </Button>
          <p className="tiny color-muted mt-8 text-center">
            پرداخت امن از طریق شبکه شاپرک و تضمین بازگشت وجه در صورت بروز مشکل
          </p>
        </div>
      </div>
    </>
  );
}
