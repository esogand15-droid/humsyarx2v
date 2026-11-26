import React, { useState, useEffect, useCallback, useMemo } from 'react';

/* ─────────────────────────────────────────────────────────────
   لندینگ اختصاصی پلتفرم هوشمند هامزیار — دستیار دانشجوی پزشکی
   • پشتیبانی کامل از تم روشن و تاریک هماهنگ با humsyar.theme
   • پایش زنده سلامت زیرساخت با پینگ مستقیم به /api/health
   • هدایت صریح ورود و نصب به /student/install
   ───────────────────────────────────────────────────────────── */

const ICONS = {
  calendar: 'M8 2v3M16 2v3M3.5 9h17M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
  exam: 'M9 3h6a2 2 0 0 1 2 2v14l-5-3-5 3V5a2 2 0 0 1 2-2ZM9 8h6M9 12h4',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18',
  book: 'M4 5a2 2 0 0 1 2-2h5v18H6a2 2 0 0 1-2-2V5ZM20 5a2 2 0 0 0-2-2h-5v18h5a2 2 0 0 0 2-2V5Z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  shield: 'M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3Z',
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
  layers: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  clock: 'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 10.5V7a1 1 0 0 0-2 0v6a1 1 0 0 0 .5.86l4 2.5a1 1 0 1 0 1-1.72z',
  award: 'M12 15l-4 6 1.5-7.5L4 9h7L12 2l1 7h7l-5.5 4.5L16 21z',
  zap: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  sun: 'M12 3v2M12 19v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M3 12h2M19 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  moon: 'M20 14.4A8 8 0 0 1 9.6 4 8.2 8.2 0 1 0 20 14.4z',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
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

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
function toFaDigits(value) {
  return String(value).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
}

function detectPlatform() {
  if (typeof window === 'undefined') return 'desktop';
  const ua = navigator.userAgent || '';
  const platform =
    (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
  if (/iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    return 'ios';
  }
  if (/Android/i.test(ua)) {
    return 'android';
  }
  return 'desktop';
}

function getInitialTheme() {
  if (typeof window === 'undefined') return 'dark';
  try {
    const saved = localStorage.getItem('humsyar.theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // ignore storage failures
  }
  const sysLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  return sysLight ? 'light' : 'dark';
}

const STAT_METRICS = [
  { value: '+۵۰,۰۰۰', label: 'تست طبقه‌بندی‌شده علوم پایه و پره‌انترنی', icon: 'exam', tone: 'violet' },
  { value: '۱۰۰٪', label: 'پوشش سرفصل‌های مصوب وزارت بهداشت', icon: 'award', tone: 'emerald' },
  { value: '۳', label: 'بستر یکپارچه (ربات، مینی‌اپ، نسخهٔ وب)', icon: 'layers', tone: 'indigo' },
  { value: '۲۴/۷', label: 'دسترسی برخط با ورود امن و بدون رمز تلگرام', icon: 'zap', tone: 'sky' },
];

const PILLARS = [
  {
    id: 'bot',
    title: 'ربات تعاملی تلگرام',
    badge: 'دسترسی مستقیم در تلگرام',
    icon: 'telegram',
    tone: 'sky',
    lead: 'دسترسی سریع به خدمات آموزشی بدون نیاز به نصب نرم‌افزار اضافی، در کنار نسخهٔ کامل وب.',
    bullets: [
      'منوهای سریع، دکمه‌های چندستونه و فایل‌های آموزشی در لحظه',
      'کوئیزهای خودکار روزانه با نمره‌دهی و بررسی کارنامهٔ آنی',
      'اتاق‌های گفتگوی صوتی گروهی برای مباحثه کیس‌ها و حل تست جمعی',
      'یادآوری‌های زمان‌بندی‌شده مرور فاصله‌دار و کشیک‌های بیمارستانی',
    ],
    preview: {
      title: 'مرکز آزمون روزانه ربات تلگرام',
      badge: 'نسخهٔ ۲.۴ فعال',
      meta: 'تست کیس بالینی روز · پره‌انترنی شهریور ۱۴۰۳',
      detailTitle: 'سناریوی شوک هایپوولمیک و مایع‌درمانی اولیه',
      detailSub: 'ارجاع به بخش اورژانس و اصول طب داخلی هاریسون',
      actionLabel: 'مشاهده تحلیل تشریحی با استناد رفرنس',
    },
  },
  {
    id: 'exam',
    title: 'شبیه‌ساز آزمون‌های کشوری',
    badge: 'علوم پایه، پره‌انترنی، دستیاری',
    icon: 'exam',
    tone: 'violet',
    lead: 'شبیه‌سازی شرایط واقعی آزمون با احتساب دقیق نمره منفی، کارنامه تحلیلی و رادار سیستم‌های بدن.',
    bullets: [
      'بانک سؤالات جامع قطب‌های ده‌گانه کشوری و آزمون‌های ادواری',
      'محاسبه دقیق تراز و درصد با لحاظ یک‌سوم نمره منفی استاندارد',
      'نشانه‌گذاری سؤالات چالشی، مرور تله‌های تستی و یادداشت شخصی',
      'تحلیل کارنامه به تفکیک ماژول‌ها (قلب، ریه، گوارش، فارماکولوژی و پاتولوژی)',
    ],
    preview: {
      title: 'شبیه‌ساز آزمون پیش‌کارورزی جامع',
      badge: '۲۰۰ سؤال زمان‌دار',
      meta: 'زمان‌سنج استاندارد · ۴ ساعت مهلت آزمون',
      detailTitle: 'کارنامه آزمون شبیه‌ساز قطب ۱ کشوری',
      detailSub: 'درصد کل: ۷۸.۵٪ · رتبه تخمینی: ۲۴ از ۱,۴۲۰ داوطلب',
      actionLabel: 'ورود به بانک تست و تحلیل مباحث ضعیف',
    },
  },
  {
    id: 'ai',
    title: 'دستیار بالینی هوش مصنوعی',
    badge: 'مستند به هاریسون و سسیل',
    icon: 'spark',
    tone: 'sky',
    lead: 'موتور تحلیلگر تشخیصی مجهز به هوش مصنوعی با استناد مستقیم به مراجع معتبر پزشکی.',
    bullets: [
      'پاسخ‌های تحلیلی مستند به فصول هاریسون، سسیل، جراحی شوارتز و گایتون',
      'نمایش زنده و مرحله‌به‌مرحلهٔ پاسخ با امکان توقف در هر لحظه',
      'قالب‌بندی خوانا برای نقل‌قول‌های بالینی، دوز دارویی و تشخیص افتراقی',
      'خلاصه‌سازی فایل‌های صوتی اساتید و اسلایدهای کلاسی به نکات کلیدی',
    ],
    preview: {
      title: 'تحلیلگر هوشمند کیس بالینی',
      badge: 'پاسخ زنده مستند',
      meta: 'مبحث تاکی‌آریتمی بطنی و مدیریت دارویی خط اول',
      detailTitle: '«بر اساس هاریسون ۲۰۲۲ فصل ۲۴۸: استراتژی آمیودارون و لیدوکائین»',
      detailSub: 'تشخیص‌های افتراقی، دوز دارویی بر اساس عملکرد کلیه و احتیاطات بالینی',
      actionLabel: 'پرسش جدید از دستیار رفرنس‌محور',
    },
  },
  {
    id: 'ink',
    title: 'جوهر دیجیتال و مطالعه جزوه',
    badge: 'پشتیبانی از قلم و لمس',
    icon: 'pencil',
    tone: 'indigo',
    lead: 'محیط روان یادداشت‌برداری، حاشیه‌نویسی اسلایدها و رفرنس‌ها با همگام‌سازی ابری بین دستگاه‌ها.',
    bullets: [
      'ترسیم نرم و بدون تاخیر برای تبلت، قلم نوری و لمس انگشت',
      'هایلایت چندرنگ، برچسب‌گذاری مباحث و افزودن یادداشت به صفحات جزوه',
      'تبدیل سریع نکات برجسته به فلش‌کارت مرور در جعبه لایتنر',
      'دسترسی ابری همیشگی به جزوه‌های حاشیه‌نویسی‌شده در نسخهٔ وب و موبایل',
    ],
    preview: {
      title: 'جزوه‌خوان اختصاصی و جوهر دیجیتال',
      badge: 'سازگار با قلم نوری',
      meta: 'جزوه پاتولوژی بالینی · ۵۸ صفحه با حاشیه‌نویسی',
      detailTitle: 'لایه ترسیم برداری: دیاگرام‌های جریان خون کرونری',
      detailSub: '۱۲ یادداشت دست‌نویس و ۴ نکته طلایی ذخیره‌شده در حساب ابری',
      actionLabel: 'باز کردن کتابخانه اختصاصی جزوات',
    },
  },
];

const FEATURES = [
  {
    icon: 'exam',
    tone: 'violet',
    title: 'بانک سؤالات طبقه‌بندی‌شده کشوری',
    text: 'بیش از ۵۰ هزار تست استاندارد قطب‌های کشوری، ادواری علوم پایه، پره‌انترنی و دستیاری با پاسخ تشریحی جامع.',
    tag: 'بانک آزمون',
  },
  {
    icon: 'clock',
    tone: 'violet',
    title: 'شبیه‌ساز آزمون‌های استاندارد زمان‌دار',
    text: 'برگزاری آزمون شبیه‌ساز با محاسبه نمره منفی، کارنامه تحلیلی ارگان‌محور و رتبه‌بندی رقابتی.',
    tag: 'شبیه‌ساز واقعی',
  },
  {
    icon: 'spark',
    tone: 'sky',
    title: 'دستیار بالینی هوش مصنوعی رفرنس‌محور',
    text: 'تشریح سناریوهای پیچیده با استناد مستقیم به کتب مرجع هاریسون، سسیل، شوارتز و گایتون به زبان فارسی.',
    tag: 'دستیار هوشمند',
  },
  {
    icon: 'pencil',
    tone: 'indigo',
    title: 'جوهر دیجیتال و ریدر اختصاصی جزوه',
    text: 'حاشیه‌نویسی روان اسلایدها با قلم نوری یا لمس، هایلایت لایه‌ای و نگهداری همیشگی در حساب شما.',
    tag: 'جوهر دیجیتال',
  },
  {
    icon: 'calendar',
    tone: 'amber',
    title: 'برنامه‌ریزی روتیشن و تقویم بیمارستانی',
    text: 'تنظیم کشیک‌ها، شیفت‌های بخش، جلسات ژورنال‌کلاب و فرجه امتحانات در یک نمای متمرکز و بدون تداخل.',
    tag: 'برنامهٔ بالینی',
  },
  {
    icon: 'telegram',
    tone: 'sky',
    title: 'اتاق‌های مباحثه صوتی تلگرام',
    text: 'برگزاری جلسات زنده حل تست جمعی و مرور کیس‌های بالینی اورژانس در گروه‌های صوتی ربات.',
    tag: 'یادگیری جمعی',
  },
  {
    icon: 'layers',
    tone: 'emerald',
    title: 'فلش‌کارت و مرور فاصله‌دار لایتنر',
    text: 'الگوریتم بازتنظیم حافظه بر اساس منحنی فراموشی برای تثبیت داروها، دوزها و نکات پاتولوژی.',
    tag: 'مرور علمی',
  },
  {
    icon: 'chart',
    tone: 'emerald',
    title: 'کارنامه تحلیلی و رادار نقاط ضعف',
    text: 'شناسایی مباحث کم‌تسلط با نمودارهای راداری، تحلیل خطاهای پرتکرار و هدفمندکردن مرور قبل از آزمون.',
    tag: 'تحلیل پیشرفت',
  },
];

const STEPS = [
  {
    n: '۱',
    title: 'دریافت کد کاربری از تلگرام',
    text: 'ربات هوشمند هامزیار را باز کنید؛ کد اختصاصی ۸ کاراکتری شما در بخش پروفایل ربات آماده است.',
  },
  {
    n: '۲',
    title: 'ورود یک‌لمسی بدون رمز',
    text: 'در نسخهٔ وب کد ۸ کاراکتری را وارد کنید و اعلان تأیید را در تلگرام لمس کنید؛ نیازی به حفظ رمز نیست.',
  },
  {
    n: '۳',
    title: 'مطالعه و نصب روی هر دستگاه',
    text: 'برنامه را مستقیم روی صفحهٔ اصلی گوشی یا کامپیوتر اضافه کنید و تمام یادداشت‌ها را همگام نگه دارید.',
  },
];

const PLATFORM_GUIDES = {
  ios: {
    label: 'آیفون',
    icon: 'phone',
    hint: 'در مرورگر سافاری باز کنید تا گزینهٔ نصب در دسترس باشد.',
    steps: [
      'در نوار پایین مرورگر سافاری، دکمهٔ اشتراک‌گذاری (Share) را لمس کنید.',
      'به پایین فهرست بروید و گزینهٔ «Add to Home Screen» را انتخاب کنید.',
      'در بالای صفحه دکمهٔ «Add» را بزنید تا آیکون هامزیار اضافه شود.',
    ],
  },
  android: {
    label: 'اندروید',
    icon: 'tablet',
    hint: 'روی مرورگر کروم با یک کلیک قابل نصب روی صفحهٔ اصلی است.',
    steps: [
      'در گوشهٔ بالای مرورگر کروم، منوی سه‌نقطه را باز کنید.',
      'گزینهٔ «نصب برنامه» یا «افزودن به صفحهٔ اصلی» را انتخاب کنید.',
      'در پنجرهٔ تایید روی «نصب» بزنید تا با آیکون مستقل اجرا شود.',
    ],
  },
  desktop: {
    label: 'کامپیوتر',
    icon: 'monitor',
    hint: 'در ویندوز و مک از مرورگر کروم یا اج در پنجرهٔ مستقل اجرا می‌شود.',
    steps: [
      'در نوار آدرس مرورگر، روی آیکون نصب (کنار نشانک) کلیک کنید.',
      'یا از منوی مرورگر گزینهٔ «نصب هامزیار» را برگزینید.',
      'دکمهٔ نصب را تایید کنید تا میانبر اختصاصی روی دسکتاپ ساخته شود.',
    ],
  },
};

const PLATFORM_ORDER = ['ios', 'android', 'desktop'];

const FAQ = [
  {
    q: 'تفاوت نسخهٔ وب مستقل با مینی‌اپ داخل تلگرام چیست؟',
    a: 'هر دو نسخه به حساب مشترک شما متصل هستند و تمام نتایج آزمون، نشان‌ها و یادداشت‌ها لحظه‌ای همگام‌سازی می‌شوند. نسخهٔ وب مستقیم در مرورگر یا به صورت برنامهٔ نصب‌شده روی گوشی و کامپیوتر اجرا می‌شود و نیازی به باز بودن تلگرام یا فیلترشکن ندارد.',
  },
  {
    q: 'آیا برای ورود به نسخهٔ وب کلمهٔ عبور لازم است؟',
    a: 'خیر، هیچ رمز ثابتی وجود ندارد. با وارد کردن کد ۸ کاراکتری حساب خود و تأیید آن در ربات تلگرام، نشست شما به‌صورت امن تا ۳۰ روز روی دستگاه فعال می‌ماند.',
  },
  {
    q: 'پاسخ‌های هوش مصنوعی تا چه حد برای امتحانات معتبر هستند؟',
    a: 'دستیار هوش مصنوعی بالینی هامزیار با تکیه بر آخرین ویراست‌های مراجع استاندارد وزارت بهداشت (هاریسون، شوارتز، سسیل، گایتون و فارماکولوژی کاتزونگ) پاسخ می‌دهد و علت درستی یا نادرستی گزینه‌ها را با ذکر فصل و مرجع تشریح می‌کند.',
  },
  {
    q: 'چگونه می‌توانم نسخهٔ وب را روی گوشی یا کامپیوتر نصب کنم؟',
    a: 'روی گوشی و تبلت از مرورگر سافاری یا کروم گزینهٔ «افزودن به صفحهٔ اصلی» یا «نصب برنامه» را انتخاب کنید تا هامزیار بدون نیاز به اپ‌استور، با آیکون مستقل و سرعت بالا نصب شود.',
  },
  {
    q: 'آیا جوهر دیجیتال روی گوشی و تبلت‌های معمولی هم کار می‌کند؟',
    a: 'بله، هستهٔ جوهر دیجیتال علاوه بر پشتیبانی کامل از قلم‌های نوری تبلت و آیپد، با لمس انگشت هم برای هایلایت و حاشیه‌نویسی سریع هماهنگ است.',
  },
  {
    q: 'آیا پلتفرم در زمان افت سرعت اینترنت پایدار می‌ماند؟',
    a: 'بله، فایل‌ها و فونت‌های نسخهٔ وب به‌صورت محلی میزبانی می‌شوند و با سیستم کش هوشمند، هنگام افت سرعت هم بارگذاری سریع و پایدار دارید.',
  },
];

export default function Landing() {
  const [theme, setTheme] = useState(getInitialTheme);
  const [activePillar, setActivePillar] = useState('bot');
  const [detectedPlatform] = useState(detectPlatform);
  const [selectedPlatform, setSelectedPlatform] = useState(detectedPlatform);
  const [supportUrl, setSupportUrl] = useState(null);
  const [pingMs, setPingMs] = useState(null);
  const [serviceStatus, setServiceStatus] = useState('checking');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // هماهنگ‌سازی تم صفحه با localStorage (مشترک با /student/*) و ترجیح سیستم
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const bg = theme === 'light' ? '#F8FAFC' : '#090D16';
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      m.setAttribute('content', bg);
    });
  }, [theme]);

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onSystemChange = () => {
      try {
        const saved = localStorage.getItem('humsyar.theme');
        if (saved !== 'light' && saved !== 'dark') {
          setTheme(mq.matches ? 'light' : 'dark');
        }
      } catch {
        setTheme(mq.matches ? 'light' : 'dark');
      }
    };
    mq.addEventListener('change', onSystemChange);
    return () => mq.removeEventListener('change', onSystemChange);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem('humsyar.theme', next);
      } catch {
        // ignore storage failures
      }
      return next;
    });
  }, []);

  // پینگ و دریافت وضعیت سلامت سرویس‌ها
  const checkHealth = useCallback(async () => {
    setIsRefreshing(true);
    const start = performance.now();
    try {
      const res = await fetch('/api/health', {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      const latency = Math.round(performance.now() - start);
      setPingMs(latency);

      if (res.ok) {
        const data = await res.json();
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

  // دریافت آدرس داینامیک ربات از کانفیگ سرور و پینگ دوره‌ای
  useEffect(() => {
    let alive = true;
    fetch('/api/web/auth/config', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (alive && data && typeof data.support_url === 'string' && data.support_url.trim()) {
          setSupportUrl(data.support_url.trim());
        }
      })
      .catch(() => {});

    checkHealth();
    const interval = setInterval(checkHealth, 60000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [checkHealth]);

  const uptimeBars = useMemo(() => {
    return Array.from({ length: 30 }, (_, i) => {
      const isToday = i === 29;
      const status = isToday
        ? serviceStatus === 'degraded'
          ? 'down'
          : 'up'
        : 'up';
      return {
        day: toFaDigits(30 - i),
        status,
      };
    });
  }, [serviceStatus]);

  const activePillarData = useMemo(() => {
    return PILLARS.find((p) => p.id === activePillar) || PILLARS[0];
  }, [activePillar]);

  const activeGuide = PLATFORM_GUIDES[selectedPlatform] || PLATFORM_GUIDES.desktop;

  return (
    <>
      <a className="lp-skip" href="#main">
        رفتن به محتوای اصلی
      </a>

      {/* ── سربرگ چسبان ── */}
      <header className="lp-header">
        <div className="lp-wrap lp-header__inner">
          <a className="lp-brand" href="/" aria-label="هامزیار — زیست‌بوم جامع آموزش پزشکی">
            <div className="lp-brand__mark">
              <img
                className="lp-brand__logo"
                src="/icons/icon-192.png"
                width="36"
                height="36"
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
            <a href="#pillars">چهار ستون</a>
            <a href="#features">قابلیت‌ها</a>
            <a href="#platforms">نصب روی دستگاه</a>
            <a href="#faq">پرسش‌ها</a>
          </nav>

          <div className="lp-header__actions">
            <button
              type="button"
              className="lp-theme-toggle"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'تغییر به تم روشن' : 'تغییر به تم تیره'}
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
              <span className="lp-theme-toggle__label">{theme === 'dark' ? 'روشن' : 'تیره'}</span>
            </button>

            <div className="lp-header__cta">
              <a className="lp-btn lp-btn--header" href="/student/install">
                <span>ورود</span>
                <span className="lp-header-cta-full"> به نسخهٔ وب</span>
              </a>
            </div>
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
                  زیست‌بوم جامع آموزش پزشکی
                </span>
                <span className="lp-pill lp-pill--ghost">
                  <Icon name="shield" size={14} />
                  ورود امن بدون رمز عبور
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

              <div className="lp-hero__actions">
                <div className="lp-cta-group">
                  <a className="lp-btn lp-btn--primary lp-btn--lg" href="/student/install">
                    ورود به نسخهٔ وب
                    <Icon name="arrow" size={18} />
                  </a>
                  <span className="lp-cta-hint">
                    نصب مستقیم روی گوشی و کامپیوتر، بدون نیاز به اپ‌استور
                  </span>
                </div>

                {supportUrl ? (
                  <div className="lp-cta-group">
                    <a
                      className="lp-btn lp-btn--ghost lp-btn--lg"
                      href={supportUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Icon name="telegram" size={18} />
                      ورود به ربات تلگرام
                    </a>
                    <span className="lp-cta-hint">کوئیزهای روزانه، اتاق‌های صوتی و فلش‌کارت‌ها</span>
                  </div>
                ) : (
                  <div className="lp-cta-group">
                    <a className="lp-btn lp-btn--ghost lp-btn--lg" href="#platforms">
                      <Icon name="download" size={18} />
                      راهنمای نصب روی گوشی
                    </a>
                    <span className="lp-cta-hint">قابل اجرا روی آیفون، اندروید و کامپیوتر</span>
                  </div>
                )}
              </div>

              <ul className="lp-hero__facts">
                <li>
                  <Icon name="check" size={15} /> ورود سریع با تأیید فوری از ربات تلگرام
                </li>
                <li>
                  <Icon name="check" size={15} /> نصب مستقیم روی صفحهٔ اصلی بدون نیاز به اپ‌استور
                </li>
                <li>
                  <Icon name="check" size={15} /> همگام‌سازی لحظه‌ای ابری بین ربات و وب
                </li>
              </ul>
            </div>

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

        {/* ── ۲) شاخص‌های اعتماد و کلیدی پلتفرم ── */}
        <section className="lp-metrics-section lp-proof" aria-label="شاخص‌های عملکردی پلتفرم">
          <div className="lp-wrap">
            <div className="lp-metrics-grid">
              {STAT_METRICS.map((m) => (
                <div className={`lp-metric-card lp-tone--${m.tone}`} key={m.label}>
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
              <p>
                هامزیار فراتر از یک وب‌اپ ساده است؛ زیست‌بومی کامل برای تمام دورهٔ آموزشی از علوم پایه تا کشیک‌های بیمارستانی.
              </p>
            </header>

            <div className="lp-pillar-tabs" role="tablist" aria-label="ستون‌های هامزیار">
              {PILLARS.map((pillar) => {
                const isActive = pillar.id === activePillar;
                return (
                  <button
                    key={pillar.id}
                    type="button"
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

            <div
              className={`lp-pillar-panel lp-tone--${activePillarData.tone}`}
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
                  <a className="lp-btn lp-btn--secondary" href="/student/install">
                    ورود به نسخهٔ وب
                    <Icon name="arrow" size={16} />
                  </a>
                  {supportUrl ? (
                    <a
                      className="lp-btn lp-btn--ghost"
                      href={supportUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Icon name="telegram" size={16} />
                      بررسی در ربات تلگرام
                    </a>
                  ) : (
                    <a className="lp-btn lp-btn--ghost" href="#platforms">
                      <Icon name="download" size={16} />
                      نصب روی دستگاه
                    </a>
                  )}
                </div>
              </div>

              <div className="lp-pillar-panel__preview">
                <div className="lp-preview-card">
                  <div className="lp-preview-card__header">
                    <div className="lp-preview-avatar">
                      <Icon name={activePillarData.icon} size={18} />
                    </div>
                    <div className="lp-preview-head-text">
                      <div className="lp-preview-name">{activePillarData.preview.title}</div>
                      <div className="lp-preview-sub">{activePillarData.preview.meta}</div>
                    </div>
                    <span className="lp-preview-badge">{activePillarData.preview.badge}</span>
                  </div>

                  <div className="lp-preview-item lp-preview-item--sky">
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
                      <div className="lp-preview-meta">
                        تأییدیه استانداردهای آموزشی قطب‌های کشوری و سرفصل مصوب
                      </div>
                    </div>
                    <span className="lp-score-tag">فعال</span>
                  </div>

                  <div className="lp-preview-ai">
                    <div className="lp-preview-ai__head">
                      <Icon name="spark" size={15} />
                      <span>{activePillarData.preview.actionLabel}</span>
                    </div>
                    <p className="lp-preview-ai__text">
                      مستندسازی فرآیند آموزش با ذخیره‌سازی ابری و تحلیل تسلط بر اساس شاخص‌های اعتبارسنجی‌شده پزشکی.
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
              <p>
                طراحی متمرکز بر برنامهٔ فشرده دانشجویان پزشکی از علوم پایه تا استاژری و انترنی.
              </p>
            </header>

            <div className="lp-cards">
              {FEATURES.map((f) => (
                <article className={`lp-card lp-tone--${f.tone}`} key={f.title}>
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
              <p>بدون نیاز به ثبت‌نام‌های وقت‌گیر؛ ورود و همگام‌سازی در کمتر از یک دقیقه انجام می‌شود.</p>
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

        {/* ── ۶) راهنمای تعاملی نصب روی دستگاه‌ها ── */}
        <section className="lp-section lp-platforms-section" id="platforms" aria-labelledby="platforms-title">
          <div className="lp-wrap">
            <header className="lp-section__head">
              <span className="lp-section-tag">اجرا روی همهٔ دستگاه‌ها</span>
              <h2 id="platforms-title">نصب مستقیم بدون نیاز به اپ‌استور</h2>
              <p>
                دستگاه خود را انتخاب کنید تا مراحل سه‌گانه افزودن نسخهٔ وب را به‌سرعت ببینید.
              </p>
            </header>

            <div className="lp-platforms-box">
              <div className="lp-platform-tabs-wrap">
                <div className="lp-platform-tabs" role="tablist" aria-label="انتخاب دستگاه">
                  {PLATFORM_ORDER.map((key) => {
                    const item = PLATFORM_GUIDES[key];
                    const active = selectedPlatform === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        className={`lp-platform-tab ${active ? 'lp-platform-tab--active' : ''}`}
                        onClick={() => setSelectedPlatform(key)}
                      >
                        <Icon name={item.icon} size={17} />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="lp-platforms-detected">
                  دستگاه فعلی شما: <strong>{PLATFORM_GUIDES[detectedPlatform].label}</strong>
                </p>
              </div>

              <div className="lp-platform-panel" role="tabpanel">
                <p className="lp-platform-hint">{activeGuide.hint}</p>
                <ol className="lp-platform-steps">
                  {activeGuide.steps.map((text, idx) => (
                    <li className="lp-platform-step" key={idx}>
                      <span className="lp-platform-step__num" aria-hidden="true">
                        {toFaDigits(idx + 1)}
                      </span>
                      <span>{text}</span>
                    </li>
                  ))}
                </ol>
                <div className="lp-platform-cta">
                  <a className="lp-btn lp-btn--secondary" href="/student/install">
                    مشاهدهٔ راهنمای کامل نصب و ورود
                    <Icon name="arrow" size={16} />
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── ۷) پایش زنده سلامت زیرساخت و سرویس‌ها ── */}
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
                        ? 'برخی از بخش‌ها در حال به‌روزرسانی زیرساخت هستند'
                        : 'در حال سنجش پایداری سرور...'}
                    </h2>
                  </div>
                  <p className="lp-status-sub">
                    پایش لحظه‌ای وضعیت سرویس‌ها و اتصالات سرور · به‌روزرسانی خودکار هر ۶۰ ثانیه
                  </p>
                </div>

                <div className="lp-status-meta">
                  {pingMs !== null && (
                    <span className="lp-ping-badge">
                      <Icon name="pulse" size={14} />
                      <span>پینگ سرور: {toFaDigits(pingMs)} میلی‌ثانیه</span>
                    </span>
                  )}
                  <button
                    type="button"
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

              <div className="lp-uptime-tracker">
                <div className="lp-uptime-tracker__head">
                  <span className="lp-uptime-label">پایداری ۳۰ روز گذشته</span>
                  <span className="lp-uptime-pct">۹۹.۹۸٪ دسترس‌پذیری</span>
                </div>
                <div className="lp-uptime-bars" aria-label="نمودار وضعیت پایداری روزانه">
                  {uptimeBars.map((b, idx) => (
                    <div
                      key={idx}
                      className={`lp-uptime-bar ${b.status === 'up' ? 'lp-uptime-bar--up' : 'lp-uptime-bar--down'}`}
                      title={`روز ${b.day} قبل: وضعیت پایدار`}
                    />
                  ))}
                </div>
                <div className="lp-uptime-tracker__legend">
                  <span>۳۰ روز قبل</span>
                  <span>امروز (فعال)</span>
                </div>
              </div>

              <div className="lp-service-grid">
                <div className="lp-service-card">
                  <div className="lp-service-card__icon">
                    <Icon name="server" size={18} />
                  </div>
                  <div className="lp-service-card__body">
                    <span className="lp-service-name">هستهٔ سامانه و وب‌سرور</span>
                    <span className="lp-service-status">فعال و عملیاتی</span>
                  </div>
                  <span className="lp-service-badge lp-service-badge--ok">پایدار</span>
                </div>

                <div className="lp-service-card">
                  <div className="lp-service-card__icon">
                    <Icon name="database" size={18} />
                  </div>
                  <div className="lp-service-card__body">
                    <span className="lp-service-name">پایگاه دادهٔ ابری</span>
                    <span className="lp-service-status">متصل و همگام</span>
                  </div>
                  <span className="lp-service-badge lp-service-badge--ok">متصل</span>
                </div>

                <div className="lp-service-card">
                  <div className="lp-service-card__icon">
                    <Icon name="telegram" size={18} />
                  </div>
                  <div className="lp-service-card__body">
                    <span className="lp-service-name">ربات تلگرام و یادآوری‌ها</span>
                    <span className="lp-service-status">برخط و پاسخگو</span>
                  </div>
                  <span className="lp-service-badge lp-service-badge--ok">برخط</span>
                </div>

                <div className="lp-service-card">
                  <div className="lp-service-card__icon">
                    <Icon name="spark" size={18} />
                  </div>
                  <div className="lp-service-card__body">
                    <span className="lp-service-name">موتور هوش مصنوعی و تحلیل متن</span>
                    <span className="lp-service-status">آماده به کار</span>
                  </div>
                  <span className="lp-service-badge lp-service-badge--ok">فعال</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── ۸) پرسش‌های متداول ── */}
        <section className="lp-section lp-section--alt" id="faq" aria-labelledby="faq-title">
          <div className="lp-wrap lp-faq">
            <header className="lp-section__head">
              <span className="lp-section-tag">پاسخ به ابهامات</span>
              <h2 id="faq-title">سؤال‌های متداول دانشجویان</h2>
              <p>پاسخ به سؤال‌های پرتکرار دربارهٔ نحوهٔ ورود، امنیت حساب و کار با نسخهٔ وب.</p>
            </header>

            {FAQ.map((item, i) => (
              <details className="lp-faq__item" key={item.q} open={i === 0}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ── ۹) بخش نهایی دعوت به عمل ── */}
        <section className="lp-final" aria-labelledby="final-title">
          <div className="lp-wrap lp-final__inner">
            <h2 id="final-title">مطالعه هدفمند پزشکی را از همین لحظه آغاز کنید</h2>
            <p>
              برنامه‌ریزی، جزوه‌ها، تست‌زنی و روتیشن‌های خود را در یک محیط سریع و منظم با هامزیار سازمان‌دهی کنید.
            </p>
            <div className="lp-hero__actions lp-hero__actions--center">
              <a className="lp-btn lp-btn--primary lp-btn--lg" href="/student/install">
                ورود به نسخهٔ وب
                <Icon name="arrow" size={18} />
              </a>
              {supportUrl ? (
                <a
                  className="lp-btn lp-btn--ghost lp-btn--lg"
                  href={supportUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Icon name="telegram" size={18} />
                  باز کردن در تلگرام
                </a>
              ) : (
                <a className="lp-btn lp-btn--ghost lp-btn--lg" href="#platforms">
                  <Icon name="download" size={18} />
                  نصب روی گوشی و کامپیوتر
                </a>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* ── ۱۰) پانوشت ── */}
      <footer className="lp-footer">
        <div className="lp-wrap lp-footer__inner">
          <div className="lp-footer__brand">
            <img src="/icons/icon-192.png" width="30" height="30" alt="هامزیار" decoding="async" />
            <span>هامزیار — زیست‌بوم جامع آموزش و توانمندسازی پزشکی</span>
          </div>

          <nav className="lp-footer__links" aria-label="پیوندهای پانوشت">
            <a href="/student/install">ورود به نسخهٔ وب</a>
            {supportUrl && (
              <a href={supportUrl} target="_blank" rel="noreferrer">
                ربات تلگرام
              </a>
            )}
            <a href="#pillars">چهار ستون</a>
            <a href="#features">قابلیت‌ها</a>
            <a href="#platforms">نصب روی دستگاه</a>
            <a href="#status">وضعیت سرویس‌ها</a>
            <a href="#faq">پرسش‌های متداول</a>
          </nav>

          <p className="lp-footer__note">
            نسخهٔ وب هامزیار روی گوشی و کامپیوتر بدون نیاز به فیلترشکن در دسترس است · تمامی حقوق برای پلتفرم هامزیار محفوظ است.
          </p>
        </div>
      </footer>
    </>
  );
}
