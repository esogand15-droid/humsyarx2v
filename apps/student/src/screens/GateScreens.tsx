import { useState } from 'react';
import { Link } from 'react-router-dom';
import './auth.css';
import { Brand } from '../components';
import { DsBadge, DsButton, DsCard } from '../design/components';
import { Icon } from '../icons';
import type { IconName } from '../icons/sprite';
import { useSession } from '../lib/session';
import { useTheme } from '../lib/theme';

/* سه صفحهٔ «قبل از اپ» — منطبق با واژگان وضعیت در design/16:
   loading / pending_approval / suspended.
   هیچ‌کدام بن‌بست نیستند: هر کدام حداقل یک اقدام واقعی دارند. */

function StopPage({
  icon,
  eyebrow,
  title,
  body,
  steps,
  tone,
}: {
  icon: IconName;
  eyebrow: string;
  title: string;
  body: string;
  steps?: string[];
  tone: 'warn' | 'danger';
}) {
  const { refresh, signOut, config } = useSession();
  const { resolved, setMode } = useTheme();
  const [checking, setChecking] = useState(false);
  const support = config?.support_url?.trim() || '';

  const handleRecheck = async () => {
    if (checking) return;
    setChecking(true);
    try {
      await refresh();
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-topbar">
        <Link to="/welcome" className="auth-topbar-btn">
          <Icon name="i-chevron-r" size={16} />
          <span>صفحهٔ اصلی</span>
        </Link>
        <button
          type="button"
          className="auth-topbar-btn auth-theme-btn"
          onClick={() => setMode(resolved === 'dark' ? 'light' : 'dark')}
          aria-label={resolved === 'dark' ? 'تغییر به حالت روشن' : 'تغییر به حالت تیره'}
        >
          <Icon name={resolved === 'dark' ? 'i-sun' : 'i-moon'} size={16} />
          <span>{resolved === 'dark' ? 'حالت روشن' : 'حالت تیره'}</span>
        </button>
      </div>

      <div className="auth-card">
        <div className="auth-hero">
          <div className="auth-logo-frame">
            <Brand size="lg" />
          </div>
          <div className="auth-wordmark">
            <span className="auth-wordmark__hums">هامز</span>
            <span className="auth-wordmark__yar">یار</span>
          </div>
          <div className="gate-badge-wrap">
            <DsBadge tone={tone === 'danger' ? 'danger' : 'warning'}>
              <Icon name={icon} size={14} />
              <span>{eyebrow}</span>
            </DsBadge>
          </div>
          <h1 className="auth-title">{title}</h1>
          <p className="auth-subtitle">{body}</p>
        </div>

        {steps && steps.length > 0 && (
          <DsCard level="sunken" className="gate-steps-card">
            <ol className="gate-steps">
              {steps.map((s, idx) => (
                <li key={s}>
                  <span className="gate-step-num" aria-hidden="true">
                    {['۱', '۲', '۳', '۴'][idx] || idx + 1}
                  </span>
                  <span className="gate-step-text">{s}</span>
                </li>
              ))}
            </ol>
          </DsCard>
        )}

        <div className="gate-actions">
          <DsButton block size="lg" loading={checking} onClick={() => void handleRecheck()}>
            <Icon name="i-refresh" size={18} />
            <span>بررسی دوبارهٔ وضعیت</span>
          </DsButton>

          {support ? (
            <a className="ds-btn ds-btn--ghost ds-btn--block" href={support} target="_blank" rel="noreferrer">
              <Icon name="i-chat" size={18} />
              <span>گفتگو با پشتیبانی آنلاین</span>
            </a>
          ) : (
            <p className="auth-support-note">
              برای پیگیری سریع، پس از تأیید از بخش تیکت‌های وب‌اپ با پشتیبانی در ارتباط باشید.
            </p>
          )}

          <DsButton variant="ghost" block onClick={() => void signOut()}>
            <Icon name="i-logout" size={18} />
            <span>خروج از حساب</span>
          </DsButton>
        </div>
      </div>
    </div>
  );
}

export function PendingScreen() {
  return (
    <StopPage
      icon="i-clock"
      eyebrow="در انتظار تأیید"
      title="حساب شما هنوز تأیید نشده است"
      body="ثبت‌نام انجام شده، ولی دسترسی به محتوا پس از تأیید نهایی حساب توسط پشتیبانی باز می‌شود."
      steps={[
        'اطلاعات دانشجویی و نام کامل خود را تکمیل کنید.',
        'در صورت نیاز به شمارهٔ دانشجویی، آن را ثبت کرده باشید.',
        'پس از تأیید حساب، روی دکمهٔ بررسی دوباره بزنید تا وارد پورتال شوید.',
      ]}
      tone="warn"
    />
  );
}

export function BlockedScreen() {
  return (
    <StopPage
      icon="i-lock"
      eyebrow="دسترسی محدود"
      title="دسترسی این حساب به طور موقت متوقف شده است"
      body="ورود شما معتبر بود، اما دسترسی به محتوا برای این حساب بسته است. در صورت نیاز می‌توانید از مسیر پشتیبانی پیگیری کنید."
      steps={[
        'اگر اشتراک شما تازه به پایان رسیده، پس از تمدید دسترسی خودکار بازمی‌گردد.',
        'برای بررسی وضعیت حساب، کد کاربری خود را به پشتیبانی اعلام کنید.',
      ]}
      tone="danger"
    />
  );
}

export function CircularSpinner({ size = 48 }: { size?: number }) {
  return (
    <div className="auth-spinner-wrap" aria-hidden="true">
      <svg
        className="auth-spinner"
        width={size}
        height={size}
        viewBox="0 0 50 50"
      >
        <circle
          className="auth-spinner__track"
          cx="25"
          cy="25"
          r="20"
          fill="none"
          strokeWidth="3.5"
        />
        <circle
          className="auth-spinner__arc"
          cx="25"
          cy="25"
          r="20"
          fill="none"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

export function SplashScreen() {
  return (
    <div className="auth-screen" aria-busy="true">
      <div className="auth-card auth-card--compact">
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
        </div>

        <div className="auth-spinner-wrap">
          <CircularSpinner size={52} />
        </div>

        <p className="auth-splash-status">در حال بررسی و اتصال به سامانه…</p>
      </div>
    </div>
  );
}
