import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Brand, Button, Input, Sheet } from '../components';
import { api, errorText, setDemoMode } from '../lib/api';
import type { LoginChallengeResponse } from '../lib/api-types';
import { useSession } from '../lib/session';

/**
 * بررسی هوشمند و نرمال‌سازی کدهای حالت آزمایشی (Demo)
 * پشتیبانی از ارقام فارسی/عربی، خط تیره، حروف کوچک/بزرگ، و عبارات DEMO
 */
export function isDemoCode(input: string): boolean {
  if (!input) return false;
  const faDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  const arDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  let s = input.trim();
  for (let i = 0; i < 10; i++) {
    s = s.split(faDigits[i]).join(String(i)).split(arDigits[i]).join(String(i));
  }
  const clean = s.toUpperCase().replace(/[^0-9A-Z]/g, '');
  return (
    clean === '7K9M2P4X' ||
    clean === 'HY7K9M2P4X' ||
    clean.includes('7K9M2P4X') ||
    clean === 'DEMO' ||
    clean === 'HYDEMO' ||
    clean.startsWith('DEMO')
  );
}

/**
 * قالب‌بندی خودکار کد ۸ کاراکتری Crockford Base32
 * حروف گیج‌کننده حذف یا جایگزین می‌شوند (I,L -> 1, O -> 0, U -> V)
 * خروجی: HY-XXXX-XXXX
 */
function formatCrockfordCode(raw: string): string {
  const faDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  const arDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  let s = raw.trim();
  for (let i = 0; i < 10; i++) {
    s = s.split(faDigits[i]).join(String(i)).split(arDigits[i]).join(String(i));
  }
  s = s.toUpperCase().replace(/\s+/g, '');

  let clean: string;
  if (s.startsWith('HY-')) {
    clean = s.slice(3).replace(/[^0-9A-Z]/g, '');
  } else {
    const unhyphenated = s.replace(/[^0-9A-Z]/g, '');
    if (unhyphenated.startsWith('HY') && unhyphenated.length > 8) {
      clean = unhyphenated.slice(2);
    } else {
      clean = unhyphenated;
    }
  }

  clean = clean.replace(/[IL]/g, '1').replace(/O/g, '0').replace(/U/g, 'V');
  clean = clean.slice(0, 8);
  if (clean.length === 0) return '';
  if (clean.length <= 4) return `HY-${clean}`;
  return `HY-${clean.slice(0, 4)}-${clean.slice(4)}`;
}

type AuthStep = 'entry' | 'waiting';

export function LoginScreen() {
  const navigate = useNavigate();
  const { refresh, offline } = useSession();

  const [step, setStep] = useState<AuthStep>('entry');
  const [userCode, setUserCode] = useState('');
  const [challenge, setChallenge] = useState<LoginChallengeResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  // حالت کد اضطراری (Fallback OTP Modal)
  const [showFallback, setShowFallback] = useState(false);
  const [fallbackOtp, setFallbackOtp] = useState('');
  const [fallbackBusy, setFallbackBusy] = useState(false);
  const [fallbackError, setFallbackError] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === 'entry') inputRef.current?.focus();
  }, [step]);

  // شمارش معکوس زمان انقضای چالش
  useEffect(() => {
    if (step !== 'waiting' || secondsLeft <= 0) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [step, secondsLeft]);

  // نظرسنجی (Polling) هر ۱.۵ ثانیه برای وضعیت تأیید چالش در تلگرام
  // جداسازی کامل از شمارش معکوس secondsLeft برای جلوگیری از starvation
  useEffect(() => {
    if (step !== 'waiting' || !challenge) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await api.pollChallenge(challenge.challenge_id);
        if (cancelled) return;

        if (res.status === 'approved') {
          setBusy(true);
          await refresh();
        } else if (res.status === 'rejected') {
          setError('درخواست ورود توسط شما در ربات تلگرام رد شد.');
        } else if (res.status === 'expired') {
          setError('مهلت تأیید به پایان رسید. لطفاً کد جدید دریافت کنید.');
        }
      } catch (err) {
        if (!cancelled && !(err instanceof Error && 'offline' in err)) {
          // خطاهای گذرا در polling کاربر را خارج نمی‌کنند
        }
      }
    };

    void poll();
    const interval = window.setInterval(poll, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [step, challenge, refresh]);

  const cleanCode = userCode.replace(/[^0-9A-Z]/g, '').replace(/^HY/, '');
  const canRequest = cleanCode.length === 8;

  async function handleCreateChallenge() {
    if (!canRequest || busy) return;
    setError('');
    setBusy(true);

    // اگر کد دمو است، حالت دمو لوکال را فعال کن و مستقیم وارد شو
    if (isDemoCode(userCode)) {
      setDemoMode(true);
      await refresh();
      navigate('/', { replace: true });
      setBusy(false);
      return;
    }

    try {
      const res = await api.createChallenge(userCode);
      setChallenge(res);
      setSecondsLeft(res.expires_in_seconds || 180);
      setStep('waiting');
    } catch (err) {
      setError(errorText(err, 'شناسه یا کد کاربری معتبر نیست. لطفاً بررسی کنید.'));
    } finally {
      setBusy(false);
    }
  }

  async function handleFillDemoCode() {
    setUserCode('HY-7K9M-2P4X');
  }

  async function handleVerifyFallback() {
    const cleanOtp = fallbackOtp.replace(/\D/g, '');
    if (cleanOtp.length < 4 || fallbackBusy) return;
    setFallbackError('');
    setFallbackBusy(true);
    try {
      await api.verifyFallback(userCode, cleanOtp);
      setShowFallback(false);
      await refresh();
    } catch (err) {
      setFallbackError(errorText(err, 'کد اضطراری نامعتبر یا منقضی شده است.'));
    } finally {
      setFallbackBusy(false);
    }
  }

  const formatTimer = (s: number) => {
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem < 10 ? '0' : ''}${rem}`;
  };

  // ── ۲. مرحلهٔ انتظار برای تأیید ربات تلگرام با کد تطبیق ۴ کاراکتری ──
  if (step === 'waiting' && challenge) {
    return (
      <div className="auth">
        <div className="auth__head text-center">
          <Brand size="xl" />
          <div className="brand-wordmark mt-12">
            <span className="hums">هامز</span>
            <span className="yar">یار</span>
          </div>
          <div className="ecg-line my-12" style={{ maxWidth: '200px', marginInline: 'auto' }} />
          <h1 className="h1 mt-8">تأیید ورود در تلگرام</h1>
          <p className="body mt-8">
            اعلان ورود به ربات تلگرام هامزیار ارسال شد. برای امنیت حساب، کد زیر را با پیام ربات مطابقت دهید:
          </p>
        </div>

        <div className="card card--glass text-center my-16" style={{ padding: '24px' }}>
          <div className="tiny color-muted mb-8" style={{ letterSpacing: '0.06em' }}>کد تأیید تطبیق در ربات</div>
          <div
            className="tabular-nums"
            style={{
              fontSize: '40px',
              fontWeight: 800,
              letterSpacing: '8px',
              color: 'var(--cyan, #00F2FE)',
              textShadow: '0 0 20px rgba(0, 242, 254, 0.45)',
              direction: 'ltr',
              fontFamily: 'var(--hym-font-mono, monospace)',
              display: 'inline-block',
              padding: '8px 24px',
              borderRadius: '16px',
              background: 'rgba(0, 242, 254, 0.08)',
              border: '1px solid rgba(0, 242, 254, 0.3)',
            }}
          >
            {challenge.display_code}
          </div>
          <div className="small color-muted mt-12" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: secondsLeft > 0 ? 'var(--cyan, #00F2FE)' : 'var(--danger)',
                boxShadow: secondsLeft > 0 ? '0 0 10px var(--cyan)' : 'none',
                display: 'inline-block',
                animation: secondsLeft > 0 ? 'ecg-scan 1.5s ease-in-out infinite' : 'none',
              }}
            />
            {secondsLeft > 0 ? (
              <span>مهلت تأیید: <strong>{formatTimer(secondsLeft)}</strong></span>
            ) : (
              <span className="color-danger">مهلت تأیید به پایان رسید</span>
            )}
          </div>
        </div>

        {error && (
          <p className="notice notice--warn mb-16" role="alert">
            {error}
          </p>
        )}

        <div className="auth__form">
          <div className="text-center small color-muted mb-8">
            لطفاً در ربات تلگرام دکمهٔ <strong>«تأیید ورود»</strong> را لمس کنید. این صفحه خودکار به‌روزرسانی می‌شود.
          </div>

          <div className="auth__row">
            <Button
              type="button"
              variant="ghost"
              block
              onClick={() => {
                setStep('entry');
                setError('');
              }}
            >
              تغییر کد یا انصراف
            </Button>

            <Button
              type="button"
              variant="ghost"
              block
              onClick={() => {
                setFallbackError('');
                setShowFallback(true);
              }}
            >
              تلگرام در دسترس نیست؟ کد اضطراری
            </Button>
          </div>

          <div className="mt-8">
            <Button
              type="button"
              variant="cyan"
              block
              onClick={() => void handleFillDemoCode()}
            >
              🚀 پر کردن کد نمونه در کادر (HY-7K9M-2P4X)
            </Button>
          </div>
        </div>

        {/* مودال ورود با کد اضطراری */}
        <Sheet
          open={showFallback}
          onClose={() => setShowFallback(false)}
          title="ورود با کد یک‌بارمصرف اضطراری"
        >
          <div style={{ padding: '8px 16px 24px' }}>
            <p className="body mb-16">
              اگر به تلگرام دسترسی نداری، کد ۶ رقمی اضطراری صادرشده توسط سیستم را وارد کن:
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleVerifyFallback();
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
            >
              <Input
                label="کد ۶ رقمی اضطراری"
                code
                value={fallbackOtp}
                onChange={(e) => setFallbackOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                dir="ltr"
                placeholder="— — — — — —"
                error={fallbackError || undefined}
                disabled={fallbackBusy}
              />

              <Button
                type="submit"
                block
                loading={fallbackBusy}
                disabled={fallbackOtp.replace(/\D/g, '').length < 4}
              >
                تأیید و ورود به سامانه
              </Button>
            </form>
          </div>
        </Sheet>
      </div>
    );
  }

  // ── ۱. مرحلهٔ اول: ورود کد کاربری ۸ کاراکتری Crockford Base32 ──
  // استخراج ۸ کاراکتر تمیز برای نمایش در اسلات‌های مجزا
  const rawClean = userCode.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^HY/, '').slice(0, 8);
  const slots = Array.from({ length: 8 }, (_, i) => rawClean[i] || '');

  return (
    <div className="login-universe-wrap">
      {/* هاله‌های نوری شناور در پس‌زمینه */}
      <div className="login-ambient-glow login-ambient-glow--cyan" aria-hidden="true" />
      <div className="login-ambient-glow login-ambient-glow--blue" aria-hidden="true" />
      <div className="login-grid-overlay" aria-hidden="true" />

      <div className="login-stellar-card">
        {/* نشان برند و نماد بالینی هامزیار */}
        <div className="login-brand-hero text-center">
          <div className="login-logo-glow-halo">
            <Brand size="xl" />
          </div>
          <div className="brand-wordmark mt-12">
            <span className="hums">هامز</span>
            <span className="yar">یار</span>
          </div>
          <div className="login-medical-badge mt-8">
            <span className="login-badge-dot" />
            <span>سامانهٔ یکپارچه آموزش بالینی و یادگیری پزشکی</span>
          </div>
          <div className="ecg-line my-12" style={{ maxWidth: '220px', marginInline: 'auto' }} />
          <h1 className="h1 mt-8" style={{ fontSize: '22px', fontWeight: 900 }}>ورود به وب‌اپ دانشجویی</h1>
          <p className="body mt-6" style={{ color: 'var(--ink-2, #94a3b8)', fontSize: '13.5px' }}>
            کد اختصاصی ۸ کاراکتری خود را وارد نمایید.
          </p>
        </div>

        <form
          className="auth__form mt-16"
          onSubmit={(e) => {
            e.preventDefault();
            if (canRequest && !busy) void handleCreateChallenge();
          }}
        >
          {/* کادر اسلات‌های لمسی کاراکترهای کد اختصاصی */}
          <div className="login-crockford-wrap">
            <label className="login-crockford-label" htmlFor="crockford-input">
              <span>کد اختصاصی کاربری (Crockford Base32)</span>
              <span className="login-prefix-tag">پیش‌وند خودکار HY-</span>
            </label>

            <div
              className="login-slots-container"
              onClick={() => inputRef.current?.focus()}
              role="presentation"
            >
              {/* نیمه اول (۴ کاراکتر) */}
              <div className="login-slots-group">
                {slots.slice(0, 4).map((char, idx) => (
                  <div
                    key={`slot_${idx}`}
                    className={`login-slot-box ${char ? 'is-filled' : ''} ${
                      rawClean.length === idx ? 'is-active' : ''
                    }`}
                  >
                    {char || (rawClean.length === idx ? <span className="login-slot-cursor" /> : '')}
                  </div>
                ))}
              </div>

              <div className="login-slots-separator">—</div>

              {/* نیمه دوم (۴ کاراکتر) */}
              <div className="login-slots-group">
                {slots.slice(4, 8).map((char, idx) => (
                  <div
                    key={`slot_${idx + 4}`}
                    className={`login-slot-box ${char ? 'is-filled' : ''} ${
                      rawClean.length === idx + 4 ? 'is-active' : ''
                    }`}
                  >
                    {char || (rawClean.length === idx + 4 ? <span className="login-slot-cursor" /> : '')}
                  </div>
                ))}
              </div>
            </div>

            {/* ورودی پنهان با حفظ سازگاری کامل کیبورد و خواننده‌های صفحه */}
            <input
              id="crockford-input"
              ref={inputRef}
              className="login-hidden-input"
              type="text"
              value={userCode}
              onChange={(e) => setUserCode(formatCrockfordCode(e.target.value))}
              autoComplete="username"
              autoCapitalize="characters"
              spellCheck={false}
              dir="ltr"
              placeholder="HY-7K9M-2P4X"
              disabled={busy}
              aria-label="کد کاربری اختصاصی (۸ کاراکتر)"
            />

            <div className="login-slots-hint">
              <span>💡 کد در بخش «پروفایل» ربات تلگرام یا کارت دانشجویی شما درج شده است.</span>
            </div>
          </div>

          {error && (
            <p className="notice notice--warn mt-12" role="alert">
              {error}
            </p>
          )}

          {offline && (
            <p className="notice notice--warn mt-12" role="status">
              اتصال به سرور برقرار نشد. لطفاً اینترنت خود را بررسی کنید.
            </p>
          )}

          {/* دکمه ارسال به تلگرام با گرادیان پرتو نوری */}
          <button
            type="submit"
            className="login-action-btn login-action-btn--primary mt-16"
            disabled={!canRequest || busy}
          >
            {busy ? (
              <span className="login-btn-spinner" />
            ) : (
              <>
                <span className="login-btn-icon">⚡</span>
                <span>درخواست تأیید ورود از ربات تلگرام</span>
              </>
            )}
          </button>

          {/* خط تفکیک کننده با برچسب وسط */}
          <div className="login-divider-row my-16">
            <span className="login-divider-line" />
            <span className="login-divider-label">یا دسترسی سریع به پنل دانشجویی</span>
            <span className="login-divider-line" />
          </div>

          {/* کلید پرکردن خودکار کد نمونه */}
          <div className="mt-12 text-center">
            <button
              type="button"
              className="login-text-link"
              onClick={() => void handleFillDemoCode()}
            >
              پر کردن کد نمونه در کادر (HY-7K9M-2P4X)
            </button>
          </div>
        </form>

        {/* پانویس کارت ورود */}
        <div className="login-card-foot mt-16 text-center">
          <a
            href="https://t.me/HumsYarBot"
            target="_blank"
            rel="noopener noreferrer"
            className="login-telegram-link"
          >
            <span>✈️</span>
            <span>هنوز کد دانشجویی ندارید؟ عضویت رایگان در ربات تلگرام هامزیار</span>
          </a>
        </div>
      </div>
    </div>
  );
}
