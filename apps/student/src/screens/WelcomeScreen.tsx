import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Brand, IconButton } from '../components';
import { DsSegmented } from '../design/components';
import { Icon } from '../icons';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useTheme } from '../lib/theme';
import type { AuthConfig } from '../lib/api-types';
import './auth.css';

type PreviewTab = 'reader' | 'exam' | 'ai';

const PREVIEW_TABS: { value: PreviewTab; label: string }[] = [
  { value: 'reader', label: 'کتابخوان جزوه' },
  { value: 'exam', label: 'آزمون موضوعی' },
  { value: 'ai', label: 'دستیار درسی' },
];

export function WelcomeScreen() {
  const { status } = useSession();
  const { resolved, setMode } = useTheme();
  const [tab, setTab] = useState<PreviewTab>('reader');
  const [config, setConfig] = useState<AuthConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.config().then((c) => {
      if (!cancelled) setConfig(c);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const primaryTo = status === 'active' ? '/' : '/login';
  const primaryLabel = status === 'active' ? 'رفتن به داشبورد' : 'ورود با کد کاربری';
  const toggleTheme = () => setMode(resolved === 'dark' ? 'light' : 'dark');

  return (
    <div className="welcome-wrap" dir="rtl">
      <div className="auth-ambient" aria-hidden="true" />

      <header className="welcome-nav" role="banner">
        <div className="welcome-nav__brand">
          <Brand size="sm" />
          <span className="welcome-nav__name">هامزیار</span>
        </div>

        <nav className="welcome-nav__actions" aria-label="ناوبری صفحهٔ اصلی">
          <Link to="/install" className="welcome-nav__link">
            نصب اپ
          </Link>
          <IconButton
            icon={resolved === 'dark' ? 'i-sun' : 'i-moon'}
            label={resolved === 'dark' ? 'تغییر به حالت روشن' : 'تغییر به حالت تیره'}
            onClick={toggleTheme}
          />
          <Link to={primaryTo} className="welcome-nav__cta">
            {primaryLabel}
          </Link>
        </nav>
      </header>

      <main className="welcome-main">
        <section className="welcome-hero">
          <div className="welcome-hero__copy">
            <div className="welcome-eyebrow">پورتال وب دانشجویان پزشکی</div>
            <h1 className="welcome-title">
              جزوه‌ها، برنامهٔ مطالعه، آزمون و دستیار درسی پزشکی در یک فضای یک‌پارچه
            </h1>
            <p className="welcome-lead">
              جزوه‌های دوره را روی گوشی، تبلت یا دسکتاپ با قلم و یادداشت شخصی بخوانید،
              آزمون موضوعی بدهید و پاسخ‌های درسی را متصل به صفحهٔ جزوه مرور کنید.
            </p>
            <div className="welcome-cta-row">
              <Link to={primaryTo} className="ds-btn ds-btn--lg welcome-cta-primary">
                <span>{primaryLabel}</span>
                <Icon name="i-chevron" size={18} />
              </Link>
              <Link to="/install" className="ds-btn ds-btn--ghost ds-btn--lg">
                <Icon name="i-download" size={18} />
                <span>راهنمای نصب نسخهٔ وب</span>
              </Link>
            </div>
          </div>

          <div className="welcome-preview-card" aria-label="پیش‌نمایش بخش‌های برنامه">
            <div className="welcome-preview-head">
              <DsSegmented
                value={tab}
                options={PREVIEW_TABS}
                onChange={setTab}
                block
                label="انتخاب پیش‌نمایش"
              />
            </div>

            {tab === 'reader' && (
              <div className="welcome-preview-body" role="tabpanel">
                <div className="welcome-preview-bar">
                  <span className="welcome-preview-pill">فیزیولوژی قلب</span>
                  <span className="welcome-preview-meta">صفحه ۴ از ۲۸</span>
                </div>
                <div className="welcome-preview-sheet">
                  <div className="welcome-preview-heading">چرخه‌ قلبی و حجم ضربه‌ای</div>
                  <p className="welcome-preview-text">
                    در فاز سیستول بطنی، پس از بسته شدن دریچهٔ میترال و پیش از باز شدن دریچهٔ آئورت،
                    انقباض هم‌حجم فشار داخل بطن چپ را به‌سرعت افزایش می‌دهد.
                  </p>
                  <div className="welcome-preview-note">
                    <Icon name="i-pen" size={15} />
                    <span>یادداشت شخصی صفحهٔ ۴: تفاوت پیش‌بار و پس‌بار در نارسایی حاد</span>
                  </div>
                </div>
              </div>
            )}

            {tab === 'exam' && (
              <div className="welcome-preview-body" role="tabpanel">
                <div className="welcome-preview-bar">
                  <span className="welcome-preview-pill">آزمون موضوعی قلب</span>
                  <span className="welcome-preview-meta">سؤال ۳ از ۲۰</span>
                </div>
                <div className="welcome-preview-sheet">
                  <div className="welcome-preview-heading">کدام یافته با تنگی شدید دریچهٔ آئورت هم‌خوانی دارد؟</div>
                  <div className="welcome-preview-options">
                    <div className="welcome-preview-opt">نبض با دامنهٔ بالا و افت سریع</div>
                    <div className="welcome-preview-opt welcome-preview-opt--selected">
                      نبض با اوج تاخیری و دامنهٔ ضعیف (parvus et tardus)
                    </div>
                  </div>
                </div>
              </div>
            )}

            {tab === 'ai' && (
              <div className="welcome-preview-body" role="tabpanel">
                <div className="welcome-preview-bar">
                  <span className="welcome-preview-pill">پاسخ متصل به جزوه</span>
                  <span className="welcome-preview-meta">اسلاید ۷ قلب</span>
                </div>
                <div className="welcome-preview-sheet">
                  <div className="welcome-preview-heading">جمع‌بندی مکانیسم فرانک استارلینگ</div>
                  <p className="welcome-preview-text">
                    افزایش کشش اولیهٔ فیبرهای میوکارد در پایان دیاستول، هم‌پوشانی رشته‌های اکتین و میوزین
                    را بهینه می‌کند و برون‌ده را متناسب با بازگشت وریدی بالا می‌برد.
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="welcome-steps" aria-labelledby="welcome-steps-title">
          <h2 id="welcome-steps-title" className="welcome-section-title">
            چطور وارد پورتال شویم؟
          </h2>
          <div className="welcome-steps-grid">
            <article className="welcome-step-card">
              <div className="gate-step-num" aria-hidden="true">۱</div>
              <h3 className="welcome-step-title">دریافت کد در ربات تلگرام</h3>
              <p className="welcome-step-desc">
                ربات هامزیار را باز کنید تا کد یکتای دانشجویی با قالب <span className="ltr-num">HY-XXXX-XXXX</span> برایتان ارسال شود.
              </p>
            </article>
            <article className="welcome-step-card">
              <div className="gate-step-num" aria-hidden="true">۲</div>
              <h3 className="welcome-step-title">تأیید دودقیقه‌ای ورود</h3>
              <p className="welcome-step-desc">
                کد دانشجویی را در صفحهٔ ورود بزنید و با کد عددی نمایش‌داده‌شده در تلگرام یا کد جایگزین ۶ رقمی وارد شوید.
              </p>
            </article>
            <article className="welcome-step-card">
              <div className="gate-step-num" aria-hidden="true">۳</div>
              <h3 className="welcome-step-title">نصب روی گوشی و تبلت</h3>
              <p className="welcome-step-desc">
                نسخهٔ وب را از راهنمای نصب روی صفحهٔ اصلی گوشی یا آیپد قرار دهید تا تمام‌صفحه اجرا شود.
              </p>
            </article>
          </div>
        </section>
      </main>

      <footer className="welcome-footer">
        <div className="welcome-footer__inner">
          <span className="welcome-footer__brand">پورتال دانشجویی هامزیار</span>
          <div className="welcome-footer__links">
            <Link to={primaryTo}>ورود با کد</Link>
            <Link to="/install">راهنمای نصب</Link>
            {config?.support_url && (
              <a href={config.support_url} target="_blank" rel="noopener noreferrer">
                پشتیبانی در تلگرام
              </a>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
export default WelcomeScreen;
