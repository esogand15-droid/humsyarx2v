/* ═══════════════════════════════════════════════════════════════════════
   فرمت‌بندی یکپارچهٔ اعداد، تاریخ جلالی و مقادیر فارسی (DS v2 · Audit S1/S5/G8)
   همهٔ رقم‌ها، جداکنندهٔ هزارگان (٬)، ممیز (٫) و تقویم شمسی از Intl می‌آیند.
   ═══════════════════════════════════════════════════════════════════════ */

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const TEHRAN_TZ = 'Asia/Tehran';

const JALALI_MONTHS = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
] as const;

const NUM_FMT = new Intl.NumberFormat('fa-IR');
const PCT_FMT = new Intl.NumberFormat('fa-IR', {
  style: 'percent',
  maximumFractionDigits: 1,
});

const DATE_LONG_UTC = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});
const DATE_LONG_TEHRAN = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  timeZone: TEHRAN_TZ,
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

const DATE_SHORT_UTC = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  timeZone: 'UTC',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const DATE_SHORT_TEHRAN = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  timeZone: TEHRAN_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const WEEKDAY_UTC = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  timeZone: 'UTC',
  weekday: 'long',
});
const WEEKDAY_TEHRAN = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  timeZone: TEHRAN_TZ,
  weekday: 'long',
});

const MONTH_DAY_UTC = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  timeZone: 'UTC',
  month: 'long',
  day: 'numeric',
});
const MONTH_DAY_TEHRAN = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  timeZone: TEHRAN_TZ,
  month: 'long',
  day: 'numeric',
});

/** تبدیل ارقام فارسی و عربی به ارقام لاتین (برای پارس یا ارسال به سرور). */
export function enDigits(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660));
}

/** تبدیل ارقام لاتین (0-9) و عربی (٠-٩) به فارسی در رشته‌ها (ساعت، کد، ترم). */
export function faDigits(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[0-9]/g, (c) => PERSIAN_DIGITS[Number(c)])
    .replace(/[٠-٩]/g, (c) => PERSIAN_DIGITS[c.charCodeAt(0) - 0x0660]);
}

/** قالب‌بندی عدد با Intl('fa-IR')؛ برای مقادیر غیرمتناهی یا خالی رشتهٔ امن برمی‌گرداند. */
export function faNum(
  value: number | string | null | undefined,
  options?: Intl.NumberFormatOptions,
  fallback = '',
): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return fallback;
    try {
      return options ? new Intl.NumberFormat('fa-IR', options).format(value) : NUM_FMT.format(value);
    } catch {
      return faDigits(String(value));
    }
  }
  const trimmed = String(value).trim();
  if (!trimmed || trimmed === 'NaN' || trimmed === 'Infinity' || trimmed === '-Infinity') {
    return fallback;
  }
  if (options) {
    const parsed = Number(enDigits(trimmed));
    if (Number.isFinite(parsed)) {
      try {
        return new Intl.NumberFormat('fa-IR', options).format(parsed);
      } catch {
        return faDigits(trimmed);
      }
    }
  }
  return faDigits(trimmed);
}

/** نام کوتاه هم‌ارز با faNum برای سازگاری با صفحهٔ کتابخانه و بقیهٔ ماژول‌ها. */
export const fa = faNum;

interface ParsedIso {
  date: Date;
  dateOnly: boolean;
}

function parseIsoDate(iso: string | null | undefined): ParsedIso | null {
  const raw = enDigits(String(iso ?? '')).trim();
  if (!raw) return null;
  const dateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const y = Number(dateOnlyMatch[1]);
    const m = Number(dateOnlyMatch[2]);
    const d = Number(dateOnlyMatch[3]);
    // اگر سال جلالی (۱۳۰۰..۱۵۰۰) اشتباهاً پاس داده شده باشد، به میلادی تفسیر نکن
    if (y >= 1300 && y <= 1500) return null;
    const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    if (
      Number.isNaN(dt.getTime()) ||
      dt.getUTCFullYear() !== y ||
      dt.getUTCMonth() !== m - 1 ||
      dt.getUTCDate() !== d
    ) {
      return null;
    }
    return { date: dt, dateOnly: true };
  }
  const dt = new Date(raw);
  if (!Number.isFinite(dt.getTime())) return null;
  return { date: dt, dateOnly: false };
}

/** تاریخ کامل شمسی از تاریخ میلادی ISO (مثلاً «۴ آذر ۱۴۰۵»). */
export function faDate(iso: string | null | undefined, fallback = ''): string {
  const parsed = parseIsoDate(iso);
  if (!parsed) return fallback;
  try {
    return (parsed.dateOnly ? DATE_LONG_UTC : DATE_LONG_TEHRAN).format(parsed.date);
  } catch {
    return fallback;
  }
}

/** تاریخ عددی کوتاه شمسی (مثلاً «۱۴۰۵/۰۹/۰۴»). */
export function faShortDate(iso: string | null | undefined, fallback = ''): string {
  const parsed = parseIsoDate(iso);
  if (!parsed) return fallback;
  try {
    return (parsed.dateOnly ? DATE_SHORT_UTC : DATE_SHORT_TEHRAN).format(parsed.date);
  } catch {
    return fallback;
  }
}

/** نام روز هفته به فارسی از تاریخ میلادی ISO (مثلاً «چهارشنبه»). */
export function faWeekday(iso: string | null | undefined, fallback = ''): string {
  const parsed = parseIsoDate(iso);
  if (!parsed) return fallback;
  try {
    return (parsed.dateOnly ? WEEKDAY_UTC : WEEKDAY_TEHRAN).format(parsed.date);
  } catch {
    return fallback;
  }
}

/** روز و ماه شمسی از تاریخ میلادی ISO (مثلاً «۴ آذر»). */
export function faMonthDay(iso: string | null | undefined, fallback = ''): string {
  const parsed = parseIsoDate(iso);
  if (!parsed) return fallback;
  try {
    return (parsed.dateOnly ? MONTH_DAY_UTC : MONTH_DAY_TEHRAN).format(parsed.date);
  } catch {
    return fallback;
  }
}

/** نمایش خوانای تاریخ جلالی ذخیره‌شده به صورت YYYY-MM-DD یا YYYY/MM/DD (مثلاً «۴ آذر ۱۴۰۵»). */
export function formatJalaliDate(jalali: string | null | undefined, fallback = ''): string {
  const raw = enDigits(String(jalali ?? '')).trim();
  if (!raw) return fallback;
  const m = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!m) return faDigits(raw);
  const year = m[1];
  const monthIdx = Number(m[2]) - 1;
  const day = Number(m[3]);
  const monthName = JALALI_MONTHS[monthIdx];
  if (!monthName || day < 1 || day > 31) return faDigits(raw);
  return `${faNum(day)} ${monthName} ${faDigits(year)}`;
}

/** قالب‌بندی درصد (ورودی ۰ تا ۱۰۰، مثلاً ۷۵ → «۷۵٪» یا ۷۵٫۳ → «۷۵٫۳٪»). */
export function faPercent(value: number | string | null | undefined, fallback = ''): string {
  if (value === null || value === undefined || value === '') return fallback;
  const num = typeof value === 'number'
    ? value
    : Number(enDigits(String(value)).replace(/[%٪,\s]/g, ''));
  if (!Number.isFinite(num)) return fallback;
  try {
    return PCT_FMT.format(num / 100);
  } catch {
    return `${faNum(num)}٪`;
  }
}

const TERM_KEYS = ['term', 'name', 'label', 'title'] as const;

function extractTermValue(raw: unknown, depth = 0): string {
  if (depth > 4 || raw === null || raw === undefined || typeof raw === 'boolean') return '';

  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? String(raw) : '';
  }

  if (Array.isArray(raw)) {
    for (const item of raw) {
      const inner = extractTermValue(item, depth + 1);
      if (inner) return inner;
    }
    return '';
  }

  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    for (const k of TERM_KEYS) {
      if (k in obj) {
        const inner = extractTermValue(obj[k], depth + 1);
        if (inner) return inner;
      }
    }
    return '';
  }

  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s || s === '[object Object]' || s === 'None' || s === 'null' || s === 'undefined') {
      return '';
    }
    if (s.startsWith('{') && s.endsWith('}')) {
      // ۱) JSON استاندارد
      try {
        const parsed: unknown = JSON.parse(s);
        if (parsed && typeof parsed === 'object') {
          return extractTermValue(parsed, depth + 1);
        }
      } catch {
        // ۲) رشتهٔ شبه‌دیکشنری پایتون مثل {'term': '1404-2', 'exams_end_date': ''}
      }
      for (const k of TERM_KEYS) {
        const re = new RegExp(
          `(?:['"]?${k}['"]?\\s*:\\s*)(?:'([^']*)'|"([^"]*)"|(-?\\d+(?:\\.\\d+)?))`,
        );
        const match = s.match(re);
        if (match) {
          const val = (match[1] ?? match[2] ?? match[3] ?? '').trim();
          if (val && val !== 'None' && val !== 'null') return val;
        }
      }
      return '';
    }
    if (s.includes('[object Object]')) return '';
    return s;
  }

  return '';
}

/**
 * Audit S5: استخراج امن نام/کد ترم از رشته، عدد، آبجکت یا رشتهٔ شبه‌دیکشنری پایتون
 * و تبدیل ارقام به فارسی («۱۴۰۴-۲»). هرگز «[object Object]» یا «{...}» برنمی‌گرداند.
 */
export function formatTerm(raw: unknown): string {
  const extracted = extractTermValue(raw);
  if (!extracted) return '';
  return faDigits(extracted);
}
