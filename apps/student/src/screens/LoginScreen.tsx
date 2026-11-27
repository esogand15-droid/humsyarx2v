import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import './auth.css';
import { Brand, Sheet } from '../components';
import { DsButton, DsCard, DsInput } from '../design/components';
import { Icon } from '../icons';
import { api, errorText } from '../lib/api';
import type { LoginChallengeResponse } from '../lib/api-types';
import { useSession } from '../lib/session';
import { useTheme } from '../lib/theme';

/* Demo code / local demo mode: DEV only (lib/demo, via a dynamic import inside
   import.meta.env.DEV). Not one byte of it reaches the production build. */

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

function toFaDigits(value: number | string): string {
  return String(value).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
}

function normalizeLatinDigits(raw: string): string {
  let s = raw;
  for (let i = 0; i < 10; i++) {
    s = s.split(FA_DIGITS[i]).join(String(i)).split(AR_DIGITS[i]).join(String(i));
  }
  return s;
}

/**
 * قالب‌بندی خودکار کد ۸ کاراکتری ورود
 * حروف گیج‌کننده حذف یا جایگزین می‌شوند (I,L -> 1, O -> 0, U -> V)
 * خروجی: HY-XXXX-XXXX
 */
function formatCrockfordCode(raw: string): string {
  let s = normalizeLatinDigits(raw.trim()).toUpperCase().replace(/\s+/g, '');

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
  const { refresh, offline, config } = useSession();
  const { resolved, setMode } = useTheme();

  const [step, setStep] = useState<AuthStep>('entry');
  const [userCode, setUserCode] = useState('');
  const [challenge, setChallenge] = useState<LoginChallengeResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [challengeTerminal, setChallengeTerminal] = useState(false);

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
    if (step !== 'waiting' || !challenge || challengeTerminal) return;

    let cancelled = false;
    let intervalId: number | undefined;
    const stopPolling = () => {
      cancelled = true;
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };

    const poll = async () => {
      try {
        const res = await api.pollChallenge(challenge.challenge_id);
        if (cancelled) return;

        if (res.status === 'approved') {
          stopPolling();
          setBusy(true);
          await refresh();
        } else if (res.status === 'rejected') {
          stopPolling();
          setChallengeTerminal(true);
          setError('درخواست ورود توسط شما در ربات تلگرام رد شد.');
        } else if (res.status === 'expired') {
          stopPolling();
          setChallengeTerminal(true);
          setSecondsLeft(0);
          setError('مهلت تأیید به پایان رسید. لطفا کد جدید دریافت کنید.');
        }
      } catch (err) {
        if (!cancelled && !(err instanceof Error && 'offline' in err)) {
          // خطاهای گذرا در polling کاربر را خارج نمی‌کنند
        }
      }
    };

    void poll();
    intervalId = window.setInterval(() => {
      void poll();
    }, 1500);

    return stopPolling;
  }, [step, challenge, challengeTerminal, refresh]);

  const cleanCode = userCode.replace(/[^0-9A-Z]/g, '').replace(/^HY/, '');
  const canRequest = cleanCode.length === 8;

  async function handleCreateChallenge() {
    if (!canRequest || busy) return;
    setError('');
    setChallengeTerminal(false);
    setBusy(true);

    if (import.meta.env.DEV) {
      const demo = await import('../lib/demo');
      if (demo.isDemoCode(userCode)) {
        demo.setDemoMode(true);
        await refresh();
        navigate('/', { replace: true });
        setBusy(false);
        return;
      }
    }

    try {
      const res = await api.createChallenge(userCode);
      setChallenge(res);
      setSecondsLeft(res.expires_in_seconds || 180);
      setStep('waiting');
    } catch (err) {
      setError(errorText(err, 'شناسه یا کد کاربری معتبر نیست. لطفا بررسی کنید.'));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyFallback() {
    const cleanOtp = normalizeLatinDigits(fallbackOtp).replace(/\D/g, '');
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
    return toFaDigits(`${m}:${rem < 10 ? '0' : ''}${rem}`);
  };

  const toggleTheme = () => {
    setMode(resolved === 'dark' ? 'light' : 'dark');
  };

  const topbar = (
    <div className="auth-topbar">
      <Link to="/welcome" className="auth-topbar-btn">
        <Icon name="i-chevron-r" size={16} />
        <span>صفحهٔ اصلی</span>
      </Link>
      <button
        type="button"
        className="auth-topbar-btn auth-theme-btn"
        onClick={toggleTheme}
        aria-label={resolved === 'dark' ? 'تغییر به حالت روشن' : 'تغییر به حالت تیره'}
      >
        <Icon name={resolved === 'dark' ? 'i-sun' : 'i-moon'} size={16} />
        <span>{resolved === 'dark' ? 'حالت روشن' : 'حالت تیره'}</span>
      </button>
    </div>
  );

  // ── ۲. مرحلهٔ انتظار برای تأیید ربات تلگرام با کد تطبیق ۴ کاراکتری ──
  if (step === 'waiting' && challenge) {
    return (
      <div className="auth-screen">
        {topbar}

        <div className="auth-card">
          <div className="auth-hero">
            <div className="auth-logo-frame">
              <Brand size="lg" />
            </div>
            <div className="auth-wordmark">
              <span className="auth-wordmark__hums">هامز</span>
              <span className="auth-wordmark__yar">یار</span>
            </div>
            <h1 className="auth-title">تأیید ورود در تلگرام</h1>
            <p className="auth-subtitle">
              اعلان ورود به ربات تلگرام هامزیار ارسال شد. کد زیر را با پیام ربات مطابقت دهید و تأیید را لمس کنید:
            </p>
          </div>

          <DsCard level="sunken" className="auth-challenge-card">
            <div className="auth-challenge-label">کد تطبیق در ربات تلگرام</div>
            <div className="auth-challenge-code">{challenge.display_code}</div>
            <div className="auth-challenge-timer">
              <span
                className={`auth-challenge-dot ${secondsLeft <= 0 ? 'auth-challenge-dot--expired' : ''}`}
                aria-hidden="true"
              />
              {secondsLeft > 0 ? (
                <span>
                  مهلت تأیید: <strong>{formatTimer(secondsLeft)}</strong>
                </span>
              ) : (
                <span className="auth-challenge-expired">مهلت تأیید به پایان رسید</span>
              )}
            </div>
          </DsCard>

          {error && (
            <p className="auth-alert auth-alert--warn" role="alert">
              <Icon name="i-alert-circle" size={18} />
              <span>{error}</span>
            </p>
          )}

          <div className="auth-form">
            <p className="auth-waiting-hint">
              در ربات تلگرام دکمهٔ <strong>«تأیید ورود»</strong> را بزنید. این صفحه به‌طور خودکار وارد حساب می‌شود.
            </p>

            <div className="auth-waiting-actions">
              {(challengeTerminal || secondsLeft <= 0) && (
                <DsButton
                  type="button"
                  block
                  loading={busy}
                  onClick={() => void handleCreateChallenge()}
                >
                  دریافت کد تازه
                </DsButton>
              )}

              <DsButton
                type="button"
                variant="ghost"
                block
                onClick={() => {
                  setStep('entry');
                  setChallengeTerminal(false);
                  setError('');
                }}
              >
                تغییر کد یا انصراف
              </DsButton>

              <DsButton
                type="button"
                variant="ghost"
                block
                onClick={() => {
                  setFallbackError('');
                  setShowFallback(true);
                }}
              >
                تلگرام در دسترس نیست؟ ورود با کد اضطراری
              </DsButton>
            </div>
          </div>

          <Sheet
            open={showFallback}
            onClose={() => setShowFallback(false)}
            title="ورود با کد یک‌بارمصرف اضطراری"
          >
            <div className="auth-sheet-body">
              <p className="auth-sheet-lead">
                اگر به تلگرام دسترسی ندارید، کد ۶ رقمی اضطراری صادرشده توسط سیستم را وارد کنید:
              </p>

              <form
                className="auth-sheet-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleVerifyFallback();
                }}
              >
                <DsInput
                  label="کد ۶ رقمی اضطراری"
                  name="fallback-otp"
                  ltr
                  value={fallbackOtp}
                  onChange={(e) => setFallbackOtp(normalizeLatinDigits(e.target.value).replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  placeholder="123456"
                  error={fallbackError || undefined}
                  disabled={fallbackBusy}
                />

                <DsButton
                  type="submit"
                  block
                  loading={fallbackBusy}
                  disabled={normalizeLatinDigits(fallbackOtp).replace(/\D/g, '').length < 4}
                >
                  تأیید و ورود به سامانه
                </DsButton>
              </form>
            </div>
          </Sheet>
        </div>
      </div>
    );
  }

  // ── ۱. مرحلهٔ اول: ورود کد کاربری ۸ کاراکتری ──
  const rawClean = userCode.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^HY/, '').slice(0, 8);
  const slots = Array.from({ length: 8 }, (_, i) => rawClean[i] || '');
  const supportUrl = config?.support_url?.trim() || '';

  return (
    <div className="auth-screen">
      {topbar}

      <div className="auth-card">
        <div className="auth-hero">
          <div className="auth-logo-frame">
            <Brand size="lg" />
          </div>
          <div className="auth-wordmark">
            <span className="auth-wordmark__hums">هامز</span>
            <span className="auth-wordmark__yar">یار</span>
          </div>
          <div className="auth-pill">
            <span className="auth-pill__dot" aria-hidden="true" />
            <span>دستیار هوشمند دانشجوی پزشکی</span>
          </div>
          <h1 className="auth-title">ورود به وب‌اپ دانشجویی</h1>
          <p className="auth-subtitle">کد ۸ کاراکتری حساب خود را وارد کنید.</p>
        </div>

        <form
          className="auth-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (canRequest && !busy) void handleCreateChallenge();
          }}
        >
          <div className="auth-code-field">
            <div className="auth-code-header">
              <label className="auth-code-label" htmlFor="crockford-input">
                کد ۸ کاراکتری ورود
              </label>
              <span className="auth-prefix-tag">
                <span>پیشوند خودکار</span>
                <bdi dir="ltr" className="auth-prefix-kbd">HY-</bdi>
              </span>
            </div>

            <div className="auth-slots-wrap">
              <div
                className="auth-slots-container"
                onClick={() => inputRef.current?.focus()}
                role="presentation"
              >
                {slots.slice(0, 4).map((char, idx) => (
                  <div
                    key={`slot_${idx}`}
                    className={`auth-slot-box ${char ? 'is-filled' : ''} ${
                      rawClean.length === idx ? 'is-active' : ''
                    }`}
                  >
                    {char || (rawClean.length === idx ? <span className="auth-slot-cursor" /> : '')}
                  </div>
                ))}

                <div className="auth-slots-sep" aria-hidden="true">
                  —
                </div>

                {slots.slice(4, 8).map((char, idx) => (
                  <div
                    key={`slot_${idx + 4}`}
                    className={`auth-slot-box ${char ? 'is-filled' : ''} ${
                      rawClean.length === idx + 4 ? 'is-active' : ''
                    }`}
                  >
                    {char || (rawClean.length === idx + 4 ? <span className="auth-slot-cursor" /> : '')}
                  </div>
                ))}
              </div>

              <input
                id="crockford-input"
                ref={inputRef}
                className="auth-hidden-input"
                type="text"
                value={userCode}
                onChange={(e) => setUserCode(formatCrockfordCode(e.target.value))}
                autoComplete="username"
                autoCapitalize="characters"
                spellCheck={false}
                dir="ltr"
                placeholder="HY-0000-0000"
                disabled={busy}
                aria-label="کد ۸ کاراکتری ورود"
              />
            </div>

            <div className={`auth-code-hint ${canRequest ? 'auth-code-hint--ready' : ''}`}>
              <Icon name={canRequest ? 'i-check' : 'i-info'} size={15} />
              <span>
                {canRequest
                    ? 'کد کامل است. برای تأیید ورود دکمه زیر را بزنید.'
                  : rawClean.length > 0
                  ? `برای فعال شدن دکمه ورود، هر ۸ کاراکتر را کامل وارد کنید (${toFaDigits(rawClean.length)} از ۸).`
                  : 'کد در بخش «پروفایل» ربات تلگرام یا کارت دانشجویی شما درج شده است.'}
              </span>
            </div>
          </div>

          {error && (
            <p className="auth-alert auth-alert--warn" role="alert">
              <Icon name="i-alert-circle" size={18} />
              <span>{error}</span>
            </p>
          )}

          {offline && (
            <p className="auth-alert auth-alert--warn" role="status">
              <Icon name="i-alert-circle" size={18} />
              <span>اتصال به سرور برقرار نشد. لطفا اینترنت خود را بررسی کنید.</span>
            </p>
          )}

          <DsButton
            type="submit"
            block
            size="lg"
            loading={busy}
            disabled={!canRequest || busy}
          >
            <Icon name="i-shield" size={18} />
            <span>درخواست تأیید ورود از ربات تلگرام</span>
          </DsButton>
        </form>

        <div className="auth-foot">
          {supportUrl ? (
            <a
              href={supportUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="auth-support-link"
            >
              <Icon name="i-message-circle" size={17} />
              <span>هنوز کد ندارید؟ عضویت رایگان در ربات تلگرام هامزیار</span>
            </a>
          ) : (
            <p className="auth-support-note">
              هنوز کد ندارید؟ کد ۸ کاراکتری خود را از بخش پروفایل در ربات تلگرام هامزیار دریافت کنید.
            </p>
          )}

          <Link to="/install" className="auth-install-cta">
            <Icon name="i-download" size={18} />
            <span className="auth-install-cta__text">
              راهنمای نصب نسخهٔ وب روی گوشی و کامپیوتر
            </span>
            <Icon name="i-chevron" size={16} />
          </Link>
        </div>
      </div>
    </div>
  );
}
