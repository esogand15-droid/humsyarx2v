/* تاریخهای نسبیِ شمسی برای فهرست گفتوگوها — همه در منطقهٔ زمانی تهران.
   گروهبندی: سنجاقشده، امروز، دیروز، ۷ روز گذشته، ۳۰ روز گذشته، سپس ماه شمسی. */

const TZ = 'Asia/Tehran';
const ZW = '\u200c';

const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const faTime = new Intl.DateTimeFormat('fa-IR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const faWeekday = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: TZ, weekday: 'long' });
const faDayMonth = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: TZ, day: 'numeric', month: 'long' });
const faDayMonthYear = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' });
const faMonthYear = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: TZ, month: 'long', year: 'numeric' });
const faYear = new Intl.DateTimeFormat('fa-IR-u-ca-persian-nu-latn', { timeZone: TZ, year: 'numeric' });

export function parseDate(v?: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** شمارهٔ روزِ تقویمیِ تهران (برای اختلاف روز، مستقل از ساعت). */
function dayNumber(d: Date): number {
  const [y, m, day] = ymd.format(d).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, day) / 86_400_000);
}

/** چند روزِ تقویمی (تهران) از d گذشته است؛ ۰ = امروز. */
export function daysAgo(d: Date, now: Date = new Date()): number {
  return dayNumber(now) - dayNumber(d);
}

export const GROUP_PINNED = `سنجاق${ZW}شده`;

/** برچسب گروه در فهرست تاریخچه. */
export function groupLabel(d: Date | null, now: Date = new Date()): string {
  if (!d) return `قدیمی${ZW}تر`;
  const n = daysAgo(d, now);
  if (n <= 0) return 'امروز';
  if (n === 1) return 'دیروز';
  if (n <= 7) return '۷ روز گذشته';
  if (n <= 30) return '۳۰ روز گذشته';
  return faMonthYear.format(d);
}

/** برچسب کوتاه کنار هر ردیف: ساعت امروز، «دیروز»، نام روز هفته، یا تاریخ شمسی. */
export function relativeLabel(d: Date | null, now: Date = new Date()): string {
  if (!d) return '';
  const n = daysAgo(d, now);
  if (n <= 0) return faTime.format(d);
  if (n === 1) return 'دیروز';
  if (n < 7) return faWeekday.format(d);
  return faYear.format(d) === faYear.format(now) ? faDayMonth.format(d) : faDayMonthYear.format(d);
}

/** تاریخ و ساعت کامل (برای title/tooltip). */
export function fullLabel(d: Date | null): string {
  if (!d) return '';
  return `${faDayMonthYear.format(d)}، ساعت ${faTime.format(d)}`;
}

/** رقمهای فارسی برای اعداد رابط کاربری. */
export function faNum(n: number): string {
  return new Intl.NumberFormat('fa-IR', { useGrouping: false }).format(n);
}
