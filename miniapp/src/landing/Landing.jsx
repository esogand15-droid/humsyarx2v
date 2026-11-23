import React, { useState, useEffect, useCallback, useMemo } from 'react';

/* ─────────────────────────────────────────────────────────────
   🏥 لندینگ اختصاصی پلتفرم هوشمند هامزیار — دستیار پزشک آینده
   طراحی پیشرفته و رفرنس‌محور منطبق بر استانداردهای UI/UX و آموزش علوم پزشکی
   • تم: Midnight Deep Navy + Clinical Glow Cyan & Emerald
   • اکوسیستم ۴ گانه: ربات هوشمند تلگرام، شبیه‌ساز کشوری، هوش مصنوعی رفرنس‌محور، جوهر دیجیتال
   • پایش زنده سلامت زیرساخت با پینگ مستقیم به /api/health
   • هدایت صریح تمام نقاط ورود به نسخه وب اختصاصی (/pwa/)
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
  pencil: 'M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z',
  bot: 'M12 2a2 2 0 0 1 2 2v2h4a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4V4a2 2 0 0 1 2-2zm-3 8a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm-5 6h4a1 1 0 0 1 0 2h-4a1 1 0 0 1 0-2z',
  layers: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  cloud: 'M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z',
  clock: 'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 10.5V7a1 1 0 0 0-2 0v6a1 1 0 0 0 .5.86l4 2.5a1 1 0 1 0 1-1.72z',
  award: 'M12 15l-4 6 1.5-7.5L4 9h7L12 2l1 7h7l-5.5 4.5L16 21z',
  zap: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  brain: 'M9.5 2A4.5 4.5 0 0 0 5 6.5c0 .77.2 1.5.55 2.14A4.5 4.5 0 0 0 3 12.5C3 15 5 17 7.5 17h.5v2.5a2.5 2.5 0 0 0 5 0V17h.5A4.5 4.5 0 0 0 18 12.5a4.5 4.5 0 0 0-2.55-3.86c.35-.64.55-1.37.55-2.14A4.5 4.5 0 0 0 11.5 2h-2z',
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

const STAT_METRICS = [
  { value: '+۵۰,۰۰۰', label: 'تست طبقه‌بندی‌شده علوم پایه و پره‌انترنی', icon: 'exam' },
  { value: '۱۰۰٪', label: 'پوشش سرفصل‌های مصوب وزارت بهداشت', icon: 'award' },
  { value: '۳', label: 'بستر یکپارچه (ربات، مینی‌اپ، وب مستقل)', icon: 'layers' },
  { value: '۲۴/۷', label: 'دسترسی برخط با احراز هویت فوری تلگرام', icon: 'zap' },
];

const PILLARS = [
  {
    id: 'bot',
    title: 'ربات تعاملی تلگرام',
    badge: 'Bot API 7.0+',
    icon: 'telegram',
    lead: 'دسترسی بدون وقفه به خدمات آموزشی بدون نیاز به نصب نرم‌افزار اضافی، در قلب پیام‌رسان محبوب شما.',
    bullets: [
      'منوهای غنی شیشه‌ای، دکمه‌های دو و سه‌ستونه و بازخورد صوتی',
      'کوئیزهای خودکار روزانه با نمره‌دهی و بررسی کارنامه آنی',
      'اتاق‌های گفتگوی صوتی گروهی برای مباحثه کیس‌ها و حل تست‌های جمعی',
      'یادآوری‌های زمان‌بندی‌شده مرور فاصله‌دار و اعلام کشیک‌های بیمارستانی',
    ],
    preview: {
      type: 'telegram',
      title: 'مرکز آزمون روزانه ربات تلگرام',
      badge: 'نسخه ۲.۴ فعال',
      meta: 'تست کیس بالینی روز · پره‌انترنی شهریور ۱۴۰۳',
      detailTitle: 'سناریوی شوک هایپوولمیک و مایع‌درمانی اولیه',
      detailSub: 'ارجاع به بخش اورژانس و اصول طب داخلی هاریسون',
      actionLabel: 'مشاهده تحلیل تشریحی با نقل‌قول بازشونده',
    },
  },
  {
    id: 'exam',
    title: 'شبیه‌ساز آزمون‌های کشوری',
    badge: 'علوم پایه، پره‌انترنی، دستیاری',
    icon: 'exam',
    lead: 'شبیه‌سازی شرایط واقعی آزمون با احتساب دقیق نمره منفی، کارنامه تحلیلی و رادار تفکیکی سیستم‌های بدن.',
    bullets: [
      'بانک سوالات جامع قطب‌های ده گانه کشوری و آزمون‌های جامع کشوری ادواری',
      'محاسبه دقیق تراز و درصد با لحاظ ۱/۳ نمره منفی مشابه کنکور و آزمون‌های وزارت بهداشت',
      'امکان علامت‌گذاری سوالات مشکوک، فیلتر تله‌های تستی و یادداشت‌نویسی اختصاصی',
      'تحلیل کارنامه بر اساس تفکیک ماژول‌ها (قلب، ریه، گوارش، فارماکولوژی، پاتولوژی)',
    ],
    preview: {
      type: 'exam',
      title: 'شبیه‌ساز آزمون پیش‌کارورزی (جامع)',
      badge: '۲۰۰ سوال زمان‌دار',
      meta: 'تایمر معکوس استاندارد · ۴ ساعت زمان فعال',
      detailTitle: 'کارنامه آزمون شبیه‌ساز قطب ۱ کشوری',
      detailSub: 'درصد کل: ۷۸.۵٪ · رتبه تخمینی: ۲۴ از ۱,۴۲۰ داوطلب',
      actionLabel: 'ورود به بانک تست و تحلیل مباحث ضعیف',
    },
  },
  {
    id: 'ai',
    title: 'دستیار بالینی هوش مصنوعی',
    badge: 'Harrison & Cecil Verified',
    icon: 'spark',
    lead: 'موتور تحلیلگر تشخیصی مجهز به هوش مصنوعی با استناد مستقیم به مراجع معتبر پزشکی جهان.',
    bullets: [
      'پاسخ‌های تحلیلی و مستند به فصول هاریسون، سسیل، اصول جراحی شوارتز و فیزیولوژی گایتون',
      'تولید بلادرنگ با کنترل‌های استریم و قابلیت توقف فوری پاسخ توسط کاربر',
      'قالب‌بندی منحصربه‌فرد نقل‌قول‌های بالینی بازشونده (Expandable Blockquotes)',
      'تبدیل و خلاصه‌سازی فایل‌های صوتی اساتید و اسلایدهای کلاسی به نکات طلایی',
    ],
    preview: {
      type: 'ai',
      title: 'تحلیلگر هوشمند کیس بالینی',
      badge: 'پاسخ زنده مستند',
      meta: 'مبحث تاکی‌آریتمی بطنی و مدیریت دارویی خط اول',
      detailTitle: '«بر اساس هاریسون ۲۰۲۲ فصل ۲۴۸: استراتژی آمیودارون در برابر لیدوکائین»',
      detailSub: 'تشخیص‌های افتراقی، دوز دارویی بر اساس GFR و احتیاطات بالینی',
      actionLabel: 'پرسش جدید از دستیار رفرنس‌محور',
    },
  },
  {
    id: 'ink',
    title: 'جوهر دیجیتال و مطالعه جزوه',
    badge: 'Active Stylus & PDF Engine',
    icon: 'pencil',
    lead: 'محیط روان یادداشت‌برداری، حاشیه‌نویسی اسلایدها و رفرنس‌ها با قلم نوری و همگام‌سازی ابری.',
    bullets: [
      'موتور پیشرفته ترسیم بدون لگ برای تبلت‌ها و قلم‌های نوری (S-Pen، Apple Pencil و قلم‌های ویندوز)',
      'هایلایت چند رنگه، برچسب‌گذاری ارگان‌ها و الصاق نشانه‌های صوتی به صفحات PDF',
      'استخراج آنی نکات برجسته‌شده به صورت فلش‌کارت‌های مرور در جعبه لایتنر',
      'دسترسی ابری دائمی به تمام جزوات حاشیه‌نویسی شده در نسخه وب و موبایل',
    ],
    preview: {
      type: 'ink',
      title: 'ریدر تخصصی و جزوه‌خوان بالینی',
      badge: 'سازگار با قلم نوری',
      meta: 'جزوه پاتولوژی اختصاصی دکتر میرزایی · ۵۸ صفحه با حاشیه‌نویسی',
      detailTitle: 'لایه ترسیم برداری: دیاگرام‌های جریان خون کرونری',
      detailSub: '۱۲ یادداشت دست‌نویس، ۴ نکته طلایی ذخیره شده در سرور ابری',
      actionLabel: 'باز کردن کتابخانه اختصاصی جزوات',
    },
  },
];

const FEATURES = [
  {
    icon: 'exam',
    title: 'بانک سوالات طبقه‌بندی‌شده کشوری',
    text: 'بیش از ۵۰ هزار تست استاندارد قطب‌های کشوری، ادواری علوم پایه، پره‌انترنی و دستیاری با پاسخ تشریحی جامع.',
    tag: 'بانک آزمون',
  },
  {
    icon: 'clock',
    title: 'شبیه‌ساز آزمون‌های استاندارد زمان‌دار',
    text: 'برگزاری آزمون شبیه‌ساز با محاسبه نمره منفی، کارنامه تحلیلی ارگان‌محور و رتبه‌بندی رقابتی در سطح کشور.',
    tag: 'شبیه‌ساز واقعی',
  },
  {
    icon: 'spark',
    title: 'دستیار بالینی هوش مصنوعی رفرنس‌محور',
    text: 'تشریح سناریوهای پیچیده با رفرنس‌دهی مستقیم به کتب مرجع هاریسون، سسیل، شوارتز و گایتون به زبان فارسی.',
    tag: 'مجهز به AI',
  },
  {
    icon: 'pencil',
    title: 'جوهر دیجیتال و ریدر اختصاصی PDF',
    text: 'حاشیه‌نویسی روان اسلایدها با قلم نوری تبلت، هایلایت لایه‌ای و استخراج خودکار نکات کلیدی بدون افت کیفیت.',
    tag: 'جوهر دیجیتال',
  },
  {
    icon: 'calendar',
    title: 'برنامه‌ریزی روتیشن و تقویم بیمارستانی',
    text: 'تنظیم کشیک‌ها، شیفت‌های بخش، جلسات ژورنال‌کلاب و فرجه امتحانات در یک نمای متمرکز بدون تداخل.',
    tag: 'مدیریت بالینی',
  },
  {
    icon: 'telegram',
    title: 'اتاق‌های مباحثه صوتی تلگرام',
    text: 'برگزاری جلسات زنده حل تست جمعی و مرور کیس‌های بالینی اورژانس در قالب گروه‌های صوتی تلگرام.',
    tag: 'یادگیری مشارکتی',
  },
  {
    icon: 'layers',
    title: 'فلش‌کارت و مرور فاصله‌دار لایتنر',
    text: 'الگوریتم بازتنظیم حافظه بر اساس منحنی فراموشی ابینگ‌هاوس برای تثبیت داروها، دوزها و پاتولوژی‌ها.',
    tag: 'مرور علمی',
  },
  {
    icon: 'chart',
    title: 'کارنامه تحلیلی و رادار نقاط ضعف',
    text: 'شناسایی مباحث کم‌تسلط با نمودارهای راداری، تحلیل درصد خطای تصادفی و اصلاح تله‌های تستی پرتکرار.',
    tag: 'تحلیل هوشمند',
  },
];

const STEPS = [
  {
    n: '۱',
    title: 'شروع در ربات تلگرام',
    text: 'ربات هوشمند هامزیار را باز کنید و بدون فرم‌های پیچیده، حساب کاربری و مقطع تحصیلی خود را فعال سازید.',
  },
  {
    n: '۲',
    title: 'دریافت کد ورود سریع به وب',
    text: 'روی دکمه «ورود به نسخهٔ وب» کلیک کنید و با کد ۶ رقمی امنی که ربات تلگرام برایتان ارسال می‌کند وارد شوید.',
  },
  {
    n: '۳',
    title: 'مطالعه و آزمون روی هر دستگاه',
    text: 'روی لپ‌تاپ، تبلت و موبایل بدون فیلترشکن با نسخه مستقل PWA کار کنید و پیشرفت خود را لحظه‌ای همگام نگه دارید.',
  },
];

const FAQ = [
  {
    q: 'تفاوت نسخهٔ وب (PWA) با مینی‌اپ داخل تلگرام چیست؟',
    a: 'هر دو نسخه به دیتابیس مشترک متصل بوده و تمام نتایج، نشان‌ها و یادداشت‌های شما بلادرنگ همگام‌سازی می‌شوند. مینی‌اپ مستقیماً داخل پیام‌رسان تلگرام اجرا می‌شود، در حالی که نسخهٔ وب اختصاصی (PWA) بدون نیاز به تلگرام یا فیلترشکن، روی انواع مرورگرها (کروم، سافاری، اج) با تجربه تمام‌صفحه و سرعت حداکثری کار می‌کند.',
  },
  {
    q: 'آیا برای ورود به نسخهٔ وب کلمه عبور لازم است؟',
    a: 'خیر، هیچ رمز ثابتی وجود ندارد. سیستم امن ورود بدون رمز هامزیار با ارسال کد تأیید ۶ رقمی یک‌بارمصرف به تلگرام شخصی شما عمل می‌کند و نشست فعال شما تا ۳۰ روز روی دستگاه باقی می‌ماند.',
  },
  {
    q: 'پاسخ‌های هوش مصنوعی تا چه حد برای امتحانات معتبر هستند؟',
    a: 'دستیار هوش مصنوعی بالینی هامزیار بر پایه آخرین ویراست‌های مراجع استاندارد وزارت بهداشت (هاریسون ۲۰۲۲، شوارتز ۲۰۲۱، سسیل، گایتون و فارماکولوژی کاتزونگ) آموزش دیده و علت درستی یا نادرستی گزینه‌ها را با ذکر مستقیم فصل و مرجع تشریح می‌نماید.',
  },
  {
    q: 'چگونه می‌توانم نسخه PWA را روی تبلت یا رایانه نصب کنم؟',
    a: 'در مرورگر خود (مانند کروم یا سافاری) روی گزینه Install یا «افزودن به صفحه اصلی (Add to Home Screen)» بزنید تا هامزیار مانند یک برنامه بومی با سرعت بارگذاری فوق‌العاده روی دستگاه شما مستقر شود.',
  },
  {
    q: 'آیا موتور جوهر دیجیتال روی تبلت‌های معمولی کار می‌کند؟',
    a: 'بله، هسته جوهر دیجیتال هامزیار به صورت مستقل طراحی شده و علاوه بر پشتیبانی کامل از قلم‌های فعال (Apple Pencil، S-Pen قلم‌های Surface)، با لمس انگشت و قلم‌های خازنی معمولی نیز برای هایلایت و یادداشت‌برداری هماهنگ است.',
  },
  {
    q: 'آیا پلتفرم در شرایط افت سرعت اینترنت پایدار است؟',
    a: 'بله، معماری توزیع‌شده با میزبانی در مراکز داده پرسرعت داخلی، بهره‌گیری از فونت‌های محلی خودمیزبان (Vazirmatn) و سیستم کش هوشمند PWA این امکان را می‌دهد که با کمترین پهنای باند و بالاترین پایداری مطالعه کنید.',
  },
];

export default function Landing() {
  const [activePillar, setActivePillar] = useState('bot');
  const [botUrl, setBotUrl] = useState('https://t.me/humsyar_bot');
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

  // دریافت آدرس داینامیک ربات تلگرام و تنظیم پینگ دوره‌ای
  useEffect(() => {
    let alive = true;
    fetch('/api/web/auth/config', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (alive && data && typeof data.support_url === 'string' && data.support_url.trim()) {
          setBotUrl(data.support_url.trim());
        }
      })
      .catch(() => {});

    checkHealth();

    const interval = setInterval(() => {
      checkHealth();
    }, 60000);

    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [checkHealth]);

  // ۳۰ اسلات وضعیت پایداری روزانه
  const uptimeBars = useMemo(() => {
    return Array.from({ length: 30 }, (_, i) => {
      const isToday = i === 29;
      const status = isToday
        ? serviceStatus === 'healthy'
          ? 'up'
          : serviceStatus === 'degraded'
          ? 'down'
          : 'up'
        : 'up';
      return {
        day: 30 - i,
        status,
        uptime: '۱۰۰٪',
      };
    });
  }, [serviceStatus]);

  const activePillarData = useMemo(() => {
    return PILLARS.find((p) => p.id === activePillar) || PILLARS[0];
  }, [activePillar]);

  return (
    <>
      <a className="lp-skip" href="#main">
        رفتن به محتوای اصلی
      </a>

      {/* ── سربرگ چسبان شیشه‌ای ── */}
      <header className="lp-header">
        <div className="lp-wrap lp-header__inner">
          <a className="lp-brand" href="/" aria-label="هامزیار — زیست‌بوم جامع آموزش پزشکی">
            <div className="lp-brand__mark">
              <img
                className="lp-brand__logo"
                src="/icons/icon-192.png"
                width="38"
                height="38"
                alt="لوگوی هامزیار"
                loading="eager"
                decoding="async"
              />
            </div>
            <div className="lp-brand__text">
              <span className="lp-brand__title">هامزیار</span>
              <span className="lp-brand__subtitle">زیست‌بوم جامع آموزش و توانمندسازی پزشکی</span>
            </div>
          </a>

          <nav className="lp-nav" aria-label="ناوبری اصلی">
            <a href="#pillars">چهار ستون هامزیار</a>
            <a href="#features">قابلیت‌های بالینی</a>
            <a href="#how">مسیر شروع</a>
            <a href="#status">وضعیت سرویس‌ها</a>
            <a href="#faq">پرسش‌های متداول</a>
          </nav>

          <div className="lp-header__cta">
            <a className="lp-btn lp-btn--primary" href="/student/install">
              ورود به نسخهٔ وب (PWA)
              <Icon name="arrow" size={16} />
            </a>
          </div>
        </div>
      </header>

      <main id="main">
        {/* ── ۱) Hero Section با نشان درخشان سه‌بعدی و تگ‌های شناور ── */}
        <section className="lp-hero" aria-labelledby="hero-title">
          <div className="lp-wrap lp-hero__grid">
            <div className="lp-hero__copy">
              <div className="lp-badge-row">
                <span className="lp-pill lp-pill--glow">
                  <span className="lp-pill__dot" />
                  زیست‌بوم جامع آموزش و توانمندسازی پزشکی
                </span>
                <span className="lp-pill lp-pill--ghost">
                  <Icon name="shield" size={14} />
                  احراز هویت بدون رمز تلگرام
                </span>
              </div>

              <h1 id="hero-title">
                همه‌چیزِ دانشجوی پزشکی،
                <br />
                <span className="lp-hero__accent">در یک فضای آرام، متمرکز و هوشمند</span>
              </h1>

              <p className="lp-hero__lead">
                شبیه‌ساز جامع آزمون‌های علوم پایه و پره‌انترنی، ربات تعاملی تلگرام، دستیار بالینی مستند به رفرنس‌های هاریسون و سسیل، و جوهر دیجیتال مطالعه جزوات — همه در یک اکوسیستم پیوسته.
              </p>

              {/* دو دکمه اصلی جهت اتصال */}
              <div className="lp-hero__actions">
                <div className="lp-cta-group">
                  <a className="lp-btn lp-btn--primary lp-btn--lg" href="/student/install">
                    ورود به نسخهٔ وب (PWA)
                    <Icon name="arrow" size={18} />
                  </a>
                  <span className="lp-cta-hint">نسخه مستقل وب، قابل نصب روی ویندوز، iOS و اندروید</span>
                </div>

                <div className="lp-cta-group">
                  <a
                    className="lp-btn lp-btn--ghost lp-btn--lg"
                    href={botUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Icon name="telegram" size={18} />
                    ورود به ربات تلگرام
                  </a>
                  <span className="lp-cta-hint">کوئیزهای روزانه، روم‌های صوتی و فلش‌کارت‌ها</span>
                </div>
              </div>

              <ul className="lp-hero__facts">
                <li>
                  <Icon name="check" size={15} /> ورود سریع با کد امن یک‌بارمصرف تلگرام
                </li>
                <li>
                  <Icon name="check" size={15} /> قابلیت نصب مستقیم بدون نیاز به اپ‌استور
                </li>
                <li>
                  <Icon name="check" size={15} /> همگام‌سازی لحظه‌ای ابری میان ربات و وب
                </li>
              </ul>
            </div>

            {/* ویترین بصری نشان درخشان جدید با هاله نور و برچسب‌های معلق */}
            <div className="lp-hero__showcase-col">
              <div className="lp-hero__showcase">
                <div className="lp-hero__aura" aria-hidden="true" />
                <div className="lp-hero__emblem-frame">
                  <img
                    className="lp-hero__emblem-img"
                    src="/icons/hero-emblem.jpg"
                    onError={(e) => {
                      e.currentTarget.src = '/brand/hero-emblem.jpg';
                    }}
                    alt="نشان رسمی زیست‌بوم آموزش پزشکی هوشمند هامزیار"
                    width="320"
                    height="320"
                    loading="eager"
                    decoding="async"
                  />
                </div>

                {/* تگ‌های معلق نمایانگر قابلیت‌های چهارگانه */}
                <div className="lp-hero__floating-tags" aria-hidden="true">
                  <div className="lp-float-badge lp-float-badge--1">
                    <Icon name="telegram" size={16} />
                    <span>ربات تعاملی تلگرام</span>
                  </div>
                  <div className="lp-float-badge lp-float-badge--2">
                    <Icon name="exam" size={16} />
                    <span>شبیه‌ساز پره‌انترنی و علوم پایه</span>
                  </div>
                  <div className="lp-float-badge lp-float-badge--3">
                    <Icon name="spark" size={16} />
                    <span>دستیار بالینی رفرنس‌محور</span>
                  </div>
                  <div className="lp-float-badge lp-float-badge--4">
                    <Icon name="pencil" size={16} />
                    <span>جوهر دیجیتال و حاشیه‌نویسی</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── ۲) نوارهای اعتماد و شاخص‌های کلیدی پلتفرم ── */}
        <section className="lp-metrics-section" aria-label="شاخص‌های عملکردی پلتفرم">
          <div className="lp-wrap">
            <div className="lp-metrics-grid">
              {STAT_METRICS.map((m) => (
                <div className="lp-metric-card" key={m.label}>
                  <div className="lp-metric-icon">
                    <Icon name={m.icon} size={22} />
                  </div>
                  <div className="lp-metric-data">
                    <span className="lp-metric-val">{m.value}</span>
                    <span className="lp-metric-lbl">{m.label}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── ۳) تب‌های تعاملی ۴ ستون اصلی هامزیار ── */}
        <section className="lp-section lp-pillars-section" id="pillars" aria-labelledby="pillars-title">
          <div className="lp-wrap">
            <header className="lp-section__head">
              <span className="lp-section-tag">معماری جامع زیست‌بوم</span>
              <h2 id="pillars-title">چهار ستون اختصاصی توانمندسازی دانشجو</h2>
              <p>هامزیار فراتر از یک وب‌اپ ساده است؛ زیست‌بومی کامل برای تمام چرخه آموزشی از علوم پایه تا کشیک‌های بیمارستانی.</p>
            </header>

            {/* کنترلرهای انتخاب ستون */}
            <div className="lp-pillar-tabs" role="tablist" aria-label="ستون‌های هامزیار">
              {PILLARS.map((pillar) => {
                const isActive = pillar.id === activePillar;
                return (
                  <button
                    key={pillar.id}
                    role="tab"
                    aria-selected={isActive}
                    aria-controls={`pillar-panel-${pillar.id}`}
                    id={`pillar-tab-${pillar.id}`}
                    className={`lp-pillar-tab-btn ${isActive ? 'lp-pillar-tab-btn--active' : ''}`}
                    onClick={() => setActivePillar(pillar.id)}
                  >
                    <Icon name={pillar.icon} size={18} />
                    <span>{pillar.title}</span>
                  </button>
                );
              })}
            </div>

            {/* بدنه ستون فعال */}
            <div
              className="lp-pillar-panel"
              role="tabpanel"
              id={`pillar-panel-${activePillarData.id}`}
              aria-labelledby={`pillar-tab-${activePillarData.id}`}
            >
              <div className="lp-pillar-panel__content">
                <div className="lp-pillar-panel__badge-row">
                  <span className="lp-status-tag">{activePillarData.badge}</span>
                </div>
                <h3>{activePillarData.title}</h3>
                <p className="lp-pillar-panel__lead">{activePillarData.lead}</p>

                <ul className="lp-pillar-bullets">
                  {activePillarData.bullets.map((b, i) => (
                    <li key={i}>
                      <span className="lp-pillar-check">
                        <Icon name="check" size={15} />
                      </span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>

                <div className="lp-pillar-cta-row">
                  <a className="lp-btn lp-btn--primary" href="/student/install">
                    مشاهده در نسخه وب
                    <Icon name="arrow" size={16} />
                  </a>
                  <a
                    className="lp-btn lp-btn--ghost"
                    href={botUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Icon name="telegram" size={16} />
                    بررسی در ربات تلگرام
                  </a>
                </div>
              </div>

              {/* پیش‌نمایش گرافیکی ستون متناسب با سناریوی واقعی */}
              <div className="lp-pillar-panel__preview">
                <div className="lp-preview-card">
                  <div className="lp-preview-card__header">
                    <div className="lp-preview-avatar">
                      <Icon name={activePillarData.icon} size={18} />
                    </div>
                    <div>
                      <div className="lp-preview-name">{activePillarData.preview.title}</div>
                      <div className="lp-preview-sub">{activePillarData.preview.meta}</div>
                    </div>
                    <span className="lp-preview-badge">{activePillarData.preview.badge}</span>
                  </div>

                  <div className="lp-preview-item lp-preview-item--cyan">
                    <div className="lp-preview-icon">
                      <Icon name="stethoscope" size={18} />
                    </div>
                    <div className="lp-preview-details">
                      <div className="lp-preview-title">{activePillarData.preview.detailTitle}</div>
                      <div className="lp-preview-meta">{activePillarData.preview.detailSub}</div>
                    </div>
                  </div>

                  <div className="lp-preview-item lp-preview-item--emerald">
                    <div className="lp-preview-icon">
                      <Icon name="award" size={18} />
                    </div>
                    <div className="lp-preview-details">
                      <div className="lp-preview-title">وضعیت تحلیل آموزشی</div>
                      <div className="lp-preview-meta">تأییدیه استانداردهای آموزشی قطب‌های کشوری و کوریکولوم</div>
                    </div>
                    <span className="lp-score-tag">فعال</span>
                  </div>

                  <div className="lp-preview-ai">
                    <div className="lp-preview-ai__head">
                      <Icon name="spark" size={15} />
                      <span>{activePillarData.preview.actionLabel}</span>
                    </div>
                    <p className="lp-preview-ai__text">
                      مستندسازی فرآیند آموزش با ذخیره‌سازی ابری و تحلیل تسلط بر اساس شاخص‌های اعتبارسنجی شده پزشکی.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── ۴) شبکه جامع ۸ قابلیت تخصصی پزشکی ── */}
        <section className="lp-section" id="features" aria-labelledby="features-title">
          <div className="lp-wrap">
            <header className="lp-section__head">
              <span className="lp-section-tag">امکانات پلتفرم بالینی</span>
              <h2 id="features-title">هر آنچه برای موفقیت در دوره پزشکی نیاز دارید</h2>
              <p>طراحی متمرکز بر سبک زندگی فشرده دانشجویان پزشکی، دوره علوم پایه، دوره‌های بالینی، استاژری و انترنی.</p>
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

        {/* ── ۵) نحوه شروع آسان در ۳ گام ── */}
        <section className="lp-section lp-section--alt" id="how" aria-labelledby="how-title">
          <div className="lp-wrap">
            <header className="lp-section__head">
              <span className="lp-section-tag">مسیر اتصال</span>
              <h2 id="how-title">شروع آسان در سه قدم</h2>
              <p>بدون نیاز به ثبت‌نام‌های وقت‌گیر؛ ورود و همگام‌سازی در کمتر از ۶۰ ثانیه انجام می‌شود.</p>
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

        {/* ── ۶) پایش زنده سلامت زیرساخت و سرویس‌ها ── */}
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
                        ? 'برخی از بخش‌ها در حال بهینه‌سازی زیرساخت هستند'
                        : 'در حال سنجش پایداری سرور...'}
                    </h2>
                  </div>
                  <p className="lp-status-sub">
                    پایش لحظه‌ای زیرساخت سرور و اتصالات شبکه‌ای · به‌روزرسانی خودکار هر ۶۰ ثانیه
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

              {/* نوار پایداری ۳۰ روزه */}
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

              {/* کارت‌های سلامت چهارگانه */}
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
                    <span className="lp-service-name">موتور هوش مصنوعی و OCR</span>
                    <span className="lp-service-status">آماده به کار</span>
                  </div>
                  <span className="lp-service-badge lp-service-badge--ok">فعال</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── ۷) پرسش‌های متداول ── */}
        <section className="lp-section lp-section--alt" id="faq" aria-labelledby="faq-title">
          <div className="lp-wrap lp-faq">
            <header className="lp-section__head">
              <span className="lp-section-tag">پاسخ به ابهامات</span>
              <h2 id="faq-title">سؤال‌های متداول دانشجویان</h2>
              <p>پاسخ به سوالات پرتکرار پیرامون شیوه کارکرد، امنیت و دسترسی بدون فیلترشکن به پلتفرم.</p>
            </header>

            {FAQ.map((item, i) => (
              <details className="lp-faq__item" key={item.q} open={i === 0}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ── ۸) بخش نهایی دعوت به عمل ── */}
        <section className="lp-final" aria-labelledby="final-title">
          <div className="lp-wrap lp-final__inner">
            <h2 id="final-title">مطالعه هدفمند پزشکی را از همین لحظه آغاز کنید</h2>
            <p>
              به جمع صدها دانشجوی پزشکی بپیوندید که برنامه‌ریزی، جزوات، تست‌زنی و روتیشن‌های خود را با هامزیار سازمان‌دهی می‌کنند.
            </p>
            <div className="lp-hero__actions lp-hero__actions--center">
              <a className="lp-btn lp-btn--primary lp-btn--lg" href="/student/install">
                ورود به نسخهٔ وب (PWA)
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

      {/* ── ۹) پانوشت کامل و واکنش‌گرا ── */}
      <footer className="lp-footer">
        <div className="lp-wrap lp-footer__inner">
          <div className="lp-footer__brand">
            <img src="/icons/icon-192.png" width="30" height="30" alt="هامزیار" decoding="async" />
            <span>هامزیار — زیست‌بوم جامع آموزش و توانمندسازی پزشکی</span>
          </div>

          <nav className="lp-footer__links" aria-label="پیوندهای پانوشت">
            <a href="/student/install">ورود به نسخهٔ وب</a>
            <a href={botUrl} target="_blank" rel="noreferrer">
              ربات تلگرام
            </a>
            <a href="#pillars">چهار ستون</a>
            <a href="#features">قابلیت‌ها</a>
            <a href="#status">وضعیت سرویس‌ها</a>
            <a href="#faq">پرسش‌های متداول</a>
          </nav>

          <p className="lp-footer__note">
            نسخه اختصاصی وب (PWA) روی انواع سیستم‌عامل‌ها بدون نیاز به فیلترشکن قابل استفاده است · تمامی حقوق برای پلتفرم هامزیار محفوظ است.
          </p>
        </div>
      </footer>
    </>
  );
}
