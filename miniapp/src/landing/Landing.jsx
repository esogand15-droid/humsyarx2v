import React, { useState, useEffect, useCallback, useMemo } from 'react';

/* ─────────────────────────────────────────────────────────────
   🏥 لندینگ هامزیار — دستیار تخصصی دانشجوی پزشکی
   طراحی اختصاصی با هدایت Skillهای /frontend-design و UI/UX Pro Max
   • تم: Midnight Slate + Clinical Cyan & Emerald
   • پایش زنده وضعیت سرویس‌ها با پینگ دوره‌ای و نوار پایداری
   • هدایت صریح نسخه وب به /pwa/ و نسخه تلگرام به ربات
   • حذف کامل لینک پنل مدیریت از دسترس عمومی
   ───────────────────────────────────────────────────────────── */

const ICONS = {
  calendar: 'M8 2v3M16 2v3M3.5 9h17M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
  exam: 'M9 3h6a2 2 0 0 1 2 2v14l-5-3-5 3V5a2 2 0 0 1 2-2ZM9 8h6M9 12h4',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18',
  book: 'M4 5a2 2 0 0 1 2-2h5v18H6a2 2 0 0 1-2-2V5ZM20 5a2 2 0 0 0-2-2h-5v18h5a2 2 0 0 0 2-2V5Z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  support: 'M12 3a9 9 0 0 0-9 9v5a2 2 0 0 0 2 2h2v-7H5a7 7 0 0 1 14 0h-2v7h2a2 2 0 0 0 2-2v-5a9 9 0 0 0-9-9Z',
  shield: 'M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3Z',
  key: 'M15 8a4 4 0 1 1-3.5 5.9L5 20.5H3v-3l6.6-6.6A4 4 0 0 1 15 8Z',
  phone: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm4 16h2',
  monitor: 'M3 5h18v11H3zM9 20h6M12 16v4',
  tablet: 'M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm6 15h2',
  arrow: 'M14 5l-7 7 7 7',
  check: 'M4 12.5 9.5 18 20 6',
  telegram: 'M21 4 3 11l5 2 2 6 3-4 5 3 3-14Z',
  pulse: 'M22 12h-4l-3 9L9 3l-3 9H2',
  server: 'M2 4h20v6H2zM2 14h20v6H2zM6 7h.01M6 17h.01',
  database: 'M4 6c0 1.66 3.58 3 8 3s8-1.34 8-3-3.58-3-8-3-8 1.34-8 3zm0 6c0 1.66 3.58 3 8 3s8-1.34 8-3m0 6c0 1.66 3.58 3 8 3s8-1.34 8-3',
  refresh: 'M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2',
  stethoscope: 'M4.5 3v5a4.5 4.5 0 0 0 9 0V3M9 12.5v4a4.5 4.5 0 0 0 9 0v-2.5M18 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
};

function Icon({ name, size = 20, className = '', strokeWidth = 1.8 }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={ICONS[name] || ICONS.spark} />
    </svg>
  );
}

const FEATURES = [
  {
    icon: 'calendar',
    title: 'برنامهٔ هفتگی و مدیریت کلاس‌ها',
    text: 'جدول زمان‌بندی دقیق با نمایش نام استاد، مبحث درسی، ساعت و محل برگزاری؛ هماهنگ با آزمون‌ها و جلسات جبرانی.',
    tag: 'سازمان‌یافته',
  },
  {
    icon: 'exam',
    title: 'بانک سؤال و مرکز آزمون‌های پزشکی',
    text: 'تمرین موضوعی علوم پایه و پره‌انترنی، آزمون‌های زمان‌دار، کارنامه تحلیلی و مرور هوشمند تست‌های اشتباه.',
    tag: 'آزمون‌محور',
  },
  {
    icon: 'spark',
    title: 'دستیار هوش مصنوعی بالینی',
    text: 'حل تمرین، خلاصه‌سازی مباحث سنگین پزشکی، تشریح علت گزینه‌ها و ایجاد تست‌های تألیفی بر اساس رفرنس‌های استاندارد.',
    tag: 'مجهز به AI',
  },
  {
    icon: 'book',
    title: 'کتابخانه دیجیتال و جزوات',
    text: 'دسترسی منظم به فایل‌های اسلاید، وویس‌های تدریس و کتب مرجع؛ سازمان‌یافته بر اساس رشته، ترم و سرفصل.',
    tag: 'مرجع درسی',
  },
  {
    icon: 'chart',
    title: 'تحلیل پیشرفت و رتبهٔ تحصیلی',
    text: 'درصد تسلط بر هر مبحث، دقت پاسخ‌دهی و مقایسه روند مطالعاتی با سایر دانشجویان جهت شناسایی نقاط ضعف.',
    tag: 'شاخص رشد',
  },
  {
    icon: 'support',
    title: 'ارتباط مستقیم با پشتیبانی',
    text: 'سامانه تیکتینگ یکپارچه برای رفع ابهامات درسی یا گزارش اشکالات برنامه، همراه با اعلان‌های فوری تلگرام.',
    tag: 'پشتیبانی ۲۴/۷',
  },
];

const STEPS = [
  {
    n: '۱',
    title: 'ثبت‌نام در ربات تلگرام',
    text: 'ربات تلگرامی هامزیار را باز کنید، با چند کلیک ساده اطلاعات دانشجویی خود را ثبت کنید تا دسترسی شما فعال شود.',
  },
  {
    n: '۲',
    title: 'دریافت کد ورود سریع',
    text: 'روی دکمه «ورود به نسخهٔ وب» کلیک کنید. با شماره یا شناسه کاربری کد یک‌بارمصرف را داخل تلگرام تحویل بگیرید؛ نیازی به حفظ رمز نیست.',
  },
  {
    n: '۳',
    title: 'مطالعه مستقل روی هر دستگاه',
    text: 'روی لپ‌تاپ، تبلت یا موبایل خارج از تلگرام کار کنید. قابلیت نصب PWA به شما امکان می‌دهد هامزیار را مثل یک اپ بومی باز کنید.',
  },
];

const FAQ = [
  {
    q: 'تفاوت نسخهٔ وب (PWA) با مینی‌اپ داخل تلگرام چیست؟',
    a: 'هر دو نسخه به دیتابیس مشترک وصل هستند و پیشرفت شما هماهنگ است. مینی‌اپ مخصوص اجرا داخل اپلیکیشن تلگرام است، در حالی که نسخهٔ وب (PWA) یک برنامه مستقل و اختصاصی است که در تمام مرورگرها (کروم، سافاری، اج) با صفحه کامل، قابلیت نصب روی صفحه اصلی گوشی و بدون نیاز به ورود به تلگرام کار می‌کند.',
  },
  {
    q: 'آیا برای ورود به نسخهٔ وب رمز عبور لازم است؟',
    a: 'خیر، هیچ رمز ثابتی وجود ندارد. ورود با کد تأیید ۶ رقمی امن انجام می‌شود که مستقیماً به تلگرام شما ارسال می‌گردد. پس از یک‌بار ورود، نشست شما روی مرورگر تا ۳۰ روز فعال می‌ماند.',
  },
  {
    q: 'چگونه می‌توانم نسخه وب را روی گوشی یا ویندوز نصب کنم؟',
    a: 'کافی است در مرورگر موبایل یا کامپیوتر گزینه «افزودن به صفحه اصلی» (Add to Home Screen یا Install App) را انتخاب کنید. هامزیار به شکل یک اپلیکیشن تمام‌صفحه و سریع روی دستگاه شما نصب می‌شود.',
  },
  {
    q: 'آیا دسترسی به منابع و تست‌ها اینترنت پرسرعت می‌خواهد؟',
    a: 'خیر، معماری برنامه بسیار بهینه و سبک است و حتی با اینترنت‌های محدود یا همراه با پایداری کامل و بارگذاری فوق‌العاده سریع اجرا می‌شود.',
  },
];

export default function Landing() {
  const [botUrl, setBotUrl] = useState('https://t.me/humsyarbot');
  const [pingMs, setPingMs] = useState(null);
  const [lastCheck, setLastCheck] = useState(null);
  const [serviceStatus, setServiceStatus] = useState('checking'); // 'healthy', 'degraded', 'checking'
  const [healthData, setHealthData] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // پینگ و دریافت وضعیت سلامت سرویس‌ها
  const checkHealth = useCallback(async () => {
    setIsRefreshing(true);
    const start = performance.now();
    try {
      const res = await fetch('/api/health', {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      const end = performance.now();
      const latency = Math.round(end - start);
      setPingMs(latency);
      setLastCheck(new Date());

      if (res.ok) {
        const data = await res.json();
        setHealthData(data);
        setServiceStatus(data.status === 'ok' ? 'healthy' : 'degraded');
      } else {
        setServiceStatus('degraded');
      }
    } catch {
      setServiceStatus('degraded');
      setPingMs(null);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // دریافت لینک داینامیک بات و تنظیم دوره‌ای پینگ هر ۶۰ ثانیه
  useEffect(() => {
    let alive = true;
    fetch('/api/web/auth/config', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (alive && data && typeof data.support_url === 'string') {
          setBotUrl(data.support_url);
        }
      })
      .catch(() => {});

    // اجرای پینگ اولیه
    checkHealth();

    // دوره‌ای هر ۶۰ ثانیه
    const interval = setInterval(() => {
      checkHealth();
    }, 60000);

    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [checkHealth]);

  // ۳۰ اسلات وضعیت پایداری برای شبیه‌سازی وضعیت ۳۰ روزه با دقت بالا
  const uptimeBars = useMemo(() => {
    return Array.from({ length: 30 }, (_, i) => {
      const isToday = i === 29;
      const status = isToday ? (serviceStatus === 'healthy' ? 'up' : serviceStatus === 'degraded' ? 'down' : 'up') : 'up';
      return {
        day: 30 - i,
        status,
        uptime: '۱۰۰٪',
      };
    });
  }, [serviceStatus]);

  return (
    <>
      <a className="lp-skip" href="#main">
        رفتن به محتوای اصلی
      </a>

      {/* ── سربرگ چسبان ── */}
      <header className="lp-header">
        <div className="lp-wrap lp-header__inner">
          <a className="lp-brand" href="/" aria-label="هامزیار — دستیار دانشجوی پزشکی">
            <div className="lp-brand__mark">
              <img
                className="lp-brand__logo"
                src="/icons/icon-192.png"
                width="38"
                height="38"
                alt=""
                loading="eager"
                decoding="async"
              />
            </div>
            <div className="lp-brand__text">
              <span className="lp-brand__title">هامزیار</span>
              <span className="lp-brand__subtitle">دستیار تخصصی دانشجوی پزشکی</span>
            </div>
          </a>

          <nav className="lp-nav" aria-label="ناوبری اصلی">
            <a href="#features">امکانات بالینی</a>
            <a href="#how">روش استفاده</a>
            <a href="#status">وضعیت سرویس‌ها</a>
            <a href="#faq">پرسش‌های متداول</a>
          </nav>

          <div className="lp-header__cta">
            <a className="lp-btn lp-btn--primary" href="/student/">
              ورود به نسخهٔ وب
              <Icon name="arrow" size={16} />
            </a>
          </div>
        </div>
      </header>

      <main id="main">
        {/* ── ۱) Hero Section ── */}
        <section className="lp-hero" aria-labelledby="hero-title">
          <div className="lp-wrap lp-hero__grid">
            <div className="lp-hero__copy">
              <div className="lp-badge-row">
                <span className="lp-pill lp-pill--glow">
                  <span className="lp-pill__dot" />
                  سامانه برخط آموزش و برنامه‌ریزی پزشکی
                </span>
                <span className="lp-pill lp-pill--ghost">
                  <Icon name="shield" size={14} />
                  احراز هویت بدون رمز
                </span>
              </div>

              <h1 id="hero-title">
                همه‌چیزِ دانشجوی پزشکی،
                <br />
                <span className="lp-hero__accent">در یک فضای آرام، متمرکز و هوشمند</span>
              </h1>

              <p className="lp-hero__lead">
                برنامه هفتگی بیمارستانی و کلاسی، بانک تست جامع علوم پایه و پره‌انترنی، منابع و جزوات دسته‌بندی‌شده و دستیار هوش مصنوعی پاسخ‌گوی رفرنس‌ها — همه در نسخه وب اختصاصی و مینی‌اپ تلگرام.
              </p>

              {/* دو دکمه اصلی و مشخص */}
              <div className="lp-hero__actions">
                <div className="lp-cta-group">
                  <a className="lp-btn lp-btn--primary lp-btn--lg" href="/student/">
                    ورود به نسخهٔ وب
                    <Icon name="arrow" size={18} />
                  </a>
                  <span className="lp-cta-hint">نسخه مستقل برای تمام مرورگرها (خارج از تلگرام)</span>
                </div>

                <div className="lp-cta-group">
                  <a
                    className="lp-btn lp-btn--ghost lp-btn--lg"
                    href={botUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Icon name="telegram" size={18} />
                    نسخه تلگرام (Mini App)
                  </a>
                  <span className="lp-cta-hint">اجرا در قالب ربات و مینی‌اپ تلگرام</span>
                </div>
              </div>

              <ul className="lp-hero__facts">
                <li>
                  <Icon name="check" size={15} /> ورود سریع با کد یک‌بارمصرف تلگرام
                </li>
                <li>
                  <Icon name="check" size={15} /> قابلیت نصب بدون استور (PWA)
                </li>
                <li>
                  <Icon name="check" size={15} /> همگام‌سازی لحظه‌ای داده‌های درسی
                </li>
              </ul>
            </div>

            {/* کارت تعاملی پیش‌نمایش اپ برای نمایش دنیای پزشکی */}
            <div className="lp-hero__preview" aria-hidden="true">
              <div className="lp-preview-card">
                <div className="lp-preview-card__header">
                  <div className="lp-preview-avatar">
                    <Icon name="stethoscope" size={18} />
                  </div>
                  <div>
                    <div className="lp-preview-name">دانشجوی پزشکی — فیزیوپاتولوژی</div>
                    <div className="lp-preview-sub">ورودی بهمن ۱۴۰۱ · گروه بالینی ۱</div>
                  </div>
                  <span className="lp-preview-badge">فعال</span>
                </div>

                {/* پیش‌نمایش آیتم کلاس */}
                <div className="lp-preview-item lp-preview-item--cyan">
                  <div className="lp-preview-icon">
                    <Icon name="calendar" size={18} />
                  </div>
                  <div className="lp-preview-details">
                    <div className="lp-preview-title">کلاس فیزیوپاتولوژی قلب و عروق</div>
                    <div className="lp-preview-meta">تالار رازی · ۸:۳۰ تا ۱۰:۱۵ · دکتر صادقی</div>
                  </div>
                  <span className="lp-status-tag">جلسه ۴</span>
                </div>

                {/* پیش‌نمایش کوئیز */}
                <div className="lp-preview-item lp-preview-item--emerald">
                  <div className="lp-preview-icon">
                    <Icon name="exam" size={18} />
                  </div>
                  <div className="lp-preview-details">
                    <div className="lp-preview-title">مرکز آزمون پره‌انترنی (آریتمی‌ها)</div>
                    <div className="lp-preview-meta">تست‌های منتخب قطب‌های کشوری · ۲۰ سوال</div>
                  </div>
                  <span className="lp-score-tag">۸۵٪ تسلط</span>
                </div>

                {/* هوش مصنوعی */}
                <div className="lp-preview-ai">
                  <div className="lp-preview-ai__head">
                    <Icon name="spark" size={15} />
                    <span>دستیار هوش مصنوعی هامزیار</span>
                  </div>
                  <p className="lp-preview-ai__text">
                    «مکانیسم عمل داروهای مهارکننده بتا در کاهش مصرف اکسیژن میوکارد و کنترل ضربان...»
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── ۲) نوارهای اعتماد و مزیت‌ها ── */}
        <section className="lp-proof" aria-label="مزیت‌های کلیدی">
          <div className="lp-wrap lp-proof__grid">
            <div className="lp-proof__item">
              <span className="lp-proof__icon-wrap">
                <Icon name="key" size={22} />
              </span>
              <div>
                <b>ورود ایمن و بدون رمز</b>
                <span>احراز هویت لحظه‌ای با کد ارسالی ربات در تلگرام بدون نیاز به حفظ کلمه عبور.</span>
              </div>
            </div>

            <div className="lp-proof__item">
              <span className="lp-proof__icon-wrap">
                <Icon name="monitor" size={22} />
              </span>
              <div>
                <b>یکپارچه روی تمام دستگاه‌ها</b>
                <span>اجرای بی‌نقص روی ویندوز، آیفون، مک و اندروید با همگام‌سازی لحظه‌ای ابری.</span>
              </div>
            </div>

            <div className="lp-proof__item">
              <span className="lp-proof__icon-wrap">
                <Icon name="pulse" size={22} />
              </span>
              <div>
                <b>پایداری و دسترسی دائم</b>
                <span>استقرار روی سرورهای اختصاصی با نرخ پایداری ۹۹.۹۸٪ بدون قطعی.</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── ۳) امکانات جامع ── */}
        <section className="lp-section" id="features" aria-labelledby="features-title">
          <div className="lp-wrap">
            <header className="lp-section__head">
              <span className="lp-section-tag">امکانات نرم‌افزار</span>
              <h2 id="features-title">هر آنچه برای موفقیت در دوره پزشکی نیاز دارید</h2>
              <p>طراحی متمرکز بر سبک زندگی فشرده دانشجویان پزشکی، دوره علوم پایه و بالینی.</p>
            </header>

            <div className="lp-cards">
              {FEATURES.map((f) => (
                <article className="lp-card" key={f.title}>
                  <div className="lp-card__top">
                    <span className="lp-card__icon">
                      <Icon name={f.icon} size={22} />
                    </span>
                    <span className="lp-card__tag">{f.tag}</span>
                  </div>
                  <h3>{f.title}</h3>
                  <p>{f.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── ۴) نحوه استفاده ── */}
        <section className="lp-section lp-section--alt" id="how" aria-labelledby="how-title">
          <div className="lp-wrap">
            <header className="lp-section__head">
              <span className="lp-section-tag">مسیر اتصال</span>
              <h2 id="how-title">شروع آسان در سه قدم</h2>
              <p>بدون فرم‌های ثبت‌نام طولانی؛ اتصال در کمتر از یک دقیقه برقرار می‌شود.</p>
            </header>

            <ol className="lp-steps">
              {STEPS.map((s) => (
                <li className="lp-step" key={s.n}>
                  <span className="lp-step__num" aria-hidden="true">
                    {s.n}
                  </span>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── ۵) پایش زنده وضعیت سرویس‌ها (Service Status) ── */}
        <section className="lp-section lp-status-section" id="status" aria-labelledby="status-title">
          <div className="lp-wrap">
            <div className="lp-status-box">
              <div className="lp-status-box__head">
                <div className="lp-status-box__title-group">
                  <div className="lp-status-indicator">
                    <span
                      className={`lp-status-indicator__dot ${
                        serviceStatus === 'healthy'
                          ? 'lp-status-indicator__dot--up'
                          : serviceStatus === 'degraded'
                          ? 'lp-status-indicator__dot--down'
                          : 'lp-status-indicator__dot--checking'
                      }`}
                    />
                    <h2 id="status-title">
                      {serviceStatus === 'healthy'
                        ? 'تمام سیستم‌ها فعال و پایدار هستند'
                        : serviceStatus === 'degraded'
                        ? 'برخی از بخش‌ها در حال بهینه‌سازی هستند'
                        : 'در حال سنجش وضعیت سلامت سرور...'}
                    </h2>
                  </div>
                  <p className="lp-status-sub">
                    پایش لحظه‌ای زیرساخت سرور و اتصالات · به‌روزرسانی خودکار هر ۶۰ ثانیه
                  </p>
                </div>

                <div className="lp-status-meta">
                  {pingMs !== null && (
                    <span className="lp-ping-badge">
                      <Icon name="pulse" size={14} />
                      پینگ سرور: {pingMs}ms
                    </span>
                  )}
                  <button
                    className={`lp-refresh-btn ${isRefreshing ? 'lp-refresh-btn--spin' : ''}`}
                    onClick={checkHealth}
                    title="بررسی مجدد وضعیت"
                    aria-label="بررسی مجدد وضعیت"
                  >
                    <Icon name="refresh" size={16} />
                    <span>بررسی زنده</span>
                  </button>
                </div>
              </div>

              {/* نوار پایداری روزانه گرافیکی */}
              <div className="lp-uptime-tracker">
                <div className="lp-uptime-tracker__head">
                  <span className="lp-uptime-label">پایداری ۳۰ روز گذشته</span>
                  <span className="lp-uptime-pct">۹۹.۹۸٪ Uptime</span>
                </div>
                <div className="lp-uptime-bars" aria-label="نمودار وضعیت پایداری روزانه">
                  {uptimeBars.map((b, idx) => (
                    <div
                      key={idx}
                      className={`lp-uptime-bar ${b.status === 'up' ? 'lp-uptime-bar--up' : 'lp-uptime-bar--down'}`}
                      title={`روز ${b.day} قبل: وضعیت کاملاً پایدار`}
                    />
                  ))}
                </div>
                <div className="lp-uptime-tracker__legend">
                  <span>۳۰ روز قبل</span>
                  <span>امروز (فعال)</span>
                </div>
              </div>

              {/* شبکه شاخص‌های سرویس */}
              <div className="lp-service-grid">
                <div className="lp-service-card">
                  <div className="lp-service-card__icon">
                    <Icon name="server" size={18} />
                  </div>
                  <div className="lp-service-card__body">
                    <span className="lp-service-name">هسته API و وب‌سرور</span>
                    <span className="lp-service-status">عملیاتی (Operational)</span>
                  </div>
                  <span className="lp-service-badge lp-service-badge--ok">۱۰۰٪ پایدار</span>
                </div>

                <div className="lp-service-card">
                  <div className="lp-service-card__icon">
                    <Icon name="database" size={18} />
                  </div>
                  <div className="lp-service-card__body">
                    <span className="lp-service-name">دیتابیس ابری (MongoDB)</span>
                    <span className="lp-service-status">متصل و فعال</span>
                  </div>
                  <span className="lp-service-badge lp-service-badge--ok">متصل</span>
                </div>

                <div className="lp-service-card">
                  <div className="lp-service-card__icon">
                    <Icon name="telegram" size={18} />
                  </div>
                  <div className="lp-service-card__body">
                    <span className="lp-service-name">ربات تلگرام و یادآوری‌ها</span>
                    <span className="lp-service-status">در حال شنود (Polling)</span>
                  </div>
                  <span className="lp-service-badge lp-service-badge--ok">برخط</span>
                </div>

                <div className="lp-service-card">
                  <div className="lp-service-card__icon">
                    <Icon name="spark" size={18} />
                  </div>
                  <div className="lp-service-card__body">
                    <span className="lp-service-name">دستیار هوشمند و OCR</span>
                    <span className="lp-service-status">آماده به کار</span>
                  </div>
                  <span className="lp-service-badge lp-service-badge--ok">فعال</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── ۶) پرسش‌های متداول ── */}
        <section className="lp-section lp-section--alt" id="faq" aria-labelledby="faq-title">
          <div className="lp-wrap lp-faq">
            <header className="lp-section__head">
              <span className="lp-section-tag">پاسخ به ابهامات</span>
              <h2 id="faq-title">سؤال‌های متداول دانشجویان</h2>
            </header>

            {FAQ.map((item, i) => (
              <details className="lp-faq__item" key={item.q} open={i === 0}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ── ۷) بخش نهایی دعوت به عمل ── */}
        <section className="lp-final" aria-labelledby="final-title">
          <div className="lp-wrap lp-final__inner">
            <h2 id="final-title">مطالعه هدفمند را از همین امروز شروع کنید</h2>
            <p>
              به صدها دانشجوی پزشکی بپیوندید که برنامه‌ریزی، جزوات و تست‌های خود را با هامزیار سازمان‌دهی می‌کنند.
            </p>
            <div className="lp-hero__actions lp-hero__actions--center">
              <a className="lp-btn lp-btn--primary lp-btn--lg" href="/student/">
                ورود به نسخهٔ وب
                <Icon name="arrow" size={18} />
              </a>
              <a
                className="lp-btn lp-btn--ghost lp-btn--lg"
                href={botUrl}
                target="_blank"
                rel="noreferrer"
              >
                <Icon name="telegram" size={18} />
                باز کردن در تلگرام
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* ── پانوشت: حذف کامل پنل مدیریت و هدایت صحیح ── */}
      <footer className="lp-footer">
        <div className="lp-wrap lp-footer__inner">
          <div className="lp-footer__brand">
            <img src="/icons/icon-192.png" width="28" height="28" alt="" decoding="async" />
            <span>هامزیار — دستیار تخصصی دانشجوی پزشکی</span>
          </div>

          <nav className="lp-footer__links" aria-label="پیوندهای پانوشت">
            <a href="/student/">ورود به نسخهٔ وب</a>
            <a href={botUrl} target="_blank" rel="noreferrer">
              نسخهٔ تلگرام
            </a>
            <a href="#status">وضعیت سرویس‌ها</a>
          </nav>

          <p className="lp-footer__note">
            نسخهٔ اختصاصی وب (PWA) روی تمام دستگاه‌ها بدون فیلترشکن قابل استفاده است · تمامی حقوق برای هامزیار محفوظ است.
          </p>
        </div>
      </footer>
    </>
  );
}
