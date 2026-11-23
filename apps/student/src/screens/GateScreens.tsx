import { Brand, Button, Card, Chip } from '../components';
import { Icon } from '../icons';
import type { IconName } from '../icons/sprite';
import { useSession } from '../lib/session';

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
  const support = config?.support_url;

  return (
    <div className="auth">
      <div className="auth__head">
        <Brand size="lg" />
        <div className="mt-16">
          <Chip variant={tone === 'danger' ? 'danger' : 'amber'} icon={icon}>
            {eyebrow}
          </Chip>
        </div>
        <h1 className="h1 mt-12">{title}</h1>
        <p className="body mt-8">{body}</p>
      </div>

      {steps && steps.length > 0 && (
        <Card variant="quiet" className="mt-16">
          <ol className="steps">
            {steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </Card>
      )}

      <div className="auth__form">
        <Button block onClick={() => void refresh()}>
          بررسی دوبارهٔ وضعیت
        </Button>
        {support ? (
          <a className="btn btn--ghost btn--block" href={support} target="_blank" rel="noreferrer">
            <Icon name="i-chat" size={18} />
            گفتگو با پشتیبانی در تلگرام
          </a>
        ) : (
          <p className="tiny" style={{ textAlign: 'center' }}>
            برای پیگیری، از همان ربات هامزیار در تلگرام پیام بده.
          </p>
        )}
        <button type="button" className="linkbtn" onClick={() => void signOut()}>
          خروج از حساب
        </button>
      </div>
    </div>
  );
}

export function PendingScreen() {
  return (
    <StopPage
      icon="i-clock"
      eyebrow="در انتظار تأیید"
      title="حسابت هنوز تأیید نشده"
      body="ثبت‌نام تو انجام شده، ولی دسترسی به محتوا بعد از تأیید باز می‌شود. این کار از ربات هامزیار انجام می‌شود و معمولاً چند ساعت طول می‌کشد."
      steps={[
        'در ربات هامزیار، مشخصات خودت را کامل کن.',
        'اگر شمارهٔ دانشجویی خواسته شده، واردش کن.',
        'بعد از تأیید، همین صفحه را دوباره بررسی کن.',
      ]}
      tone="warn"
    />
  );
}

export function BlockedScreen() {
  return (
    <StopPage
      icon="i-lock"
      eyebrow="دسترسی بسته"
      title="دسترسی این حساب موقتاً متوقف شده"
      body="ورود تو درست بود، اما دسترسی به محتوا برای این حساب بسته است. اگر فکر می‌کنی اشتباهی رخ داده، از مسیر پشتیبانی پیگیری کن."
      steps={[
        'اگر اشتراکت تازه تمام شده، بعد از تمدید دسترسی خودکار برمی‌گردد.',
        'برای بررسی، کد حساب خودت را به پشتیبانی بده.',
      ]}
      tone="danger"
    />
  );
}

export function CircularSpinner({ size = 48 }: { size?: number }) {
  return (
    <div className="hym-circular-spinner-wrap" aria-hidden="true">
      <svg
        className="hym-circular-spinner"
        viewBox="0 0 50 50"
        style={{ width: size, height: size }}
      >
        <circle
          className="hym-circular-track"
          cx="25"
          cy="25"
          r="20"
          fill="none"
          strokeWidth="3.5"
        />
        <circle
          className="hym-circular-arc"
          cx="25"
          cy="25"
          r="20"
          fill="none"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
      </svg>
      <div className="hym-circular-core-glow" />
    </div>
  );
}

export function SplashScreen() {
  return (
    <div className="login-universe-wrap" aria-busy="true">
      <div className="login-ambient-glow login-ambient-glow--cyan" aria-hidden="true" />
      <div className="login-ambient-glow login-ambient-glow--blue" aria-hidden="true" />
      <div className="login-grid-overlay" aria-hidden="true" />

      <div className="login-stellar-card text-center" style={{ maxWidth: 420, padding: '44px 28px' }}>
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
        </div>

        <div className="mt-28 mb-16" style={{ display: 'flex', justifyContent: 'center' }}>
          <CircularSpinner size={52} />
        </div>

        <p className="body mt-12" style={{ color: 'var(--ink-2, #94a3b8)', fontSize: '14px', fontWeight: 600 }}>
          در حال بررسی و اتصال به سامانه…
        </p>
      </div>
    </div>
  );
}
