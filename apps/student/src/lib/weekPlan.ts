/* ═══════════════════════════════════════════════════════════════════════
   برنامهٔ هفتگی واقعی (شنبه تا جمعه) — نسخهٔ تایپ‌اسکریپت (DS v2 · Audit S1/S3)
   • زمان همیشه با ساعت تهران (Asia/Tehran) محاسبه می‌شود.
   • هر جلسه روی تاریخ واقعی خودش در هفتهٔ انتخاب‌شده قرار می‌گیرد.
   • تمام ارقام و تاریخ‌ها از fa.ts به فارسی و تقویم جلالی قالب‌بندی می‌شوند.
   ═══════════════════════════════════════════════════════════════════════ */

import { enDigits, faDate, faDigits, faMonthDay, faNum, faWeekday } from './fa';

const TEHRAN_TZ = 'Asia/Tehran';
const MS_PER_DAY = 86_400_000;

export interface WeekDayMeta {
  readonly key: 'sat' | 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri';
  readonly d: number;
  readonly short: string;
  readonly name: string;
}

/** ترتیب هفتهٔ ایرانی: شنبه اول (۶ در getUTCDay)، جمعه آخر (۵). */
export const WEEK: ReadonlyArray<WeekDayMeta> = [
  { key: 'sat', d: 6, short: 'ش', name: 'شنبه' },
  { key: 'sun', d: 0, short: 'ی', name: 'یک‌شنبه' },
  { key: 'mon', d: 1, short: 'د', name: 'دوشنبه' },
  { key: 'tue', d: 2, short: 'س', name: 'سه‌شنبه' },
  { key: 'wed', d: 3, short: 'چ', name: 'چهارشنبه' },
  { key: 'thu', d: 4, short: 'پ', name: 'پنج‌شنبه' },
  { key: 'fri', d: 5, short: 'ج', name: 'جمعه' },
];

const WEEK_BY_JS_DAY: Record<number, WeekDayMeta> = Object.fromEntries(
  WEEK.map((w) => [w.d, w]),
);

export type GroupFilter = 'all' | '1' | '2';
export type NormalizedGroup = '1' | '2' | 'both';

export interface TehranNow {
  iso: string;
  minutes: number;
}

export interface SessionFlag {
  key: 'makeup' | 'flex' | 'changed';
  label: string;
  note?: string;
}

export interface WeekScheduleInput {
  id: string;
  type: 'class' | 'exam' | 'makeup' | string;
  lesson: string;
  teacher?: string;
  date: string;
  time?: string;
  end_time?: string;
  location?: string;
  note?: string;
  group?: string;
  educational_group?: string;
  course_code?: string;
  term?: unknown;
  flex_type?: string;
  flex_note?: string;
  days_left?: number | null;
}

export interface PlannedSession extends WeekScheduleInput {
  iso: string;
  start: number | null;
  end: number | null;
  flags: SessionFlag[];
  isNow: boolean;
  isNext: boolean;
  isOver: boolean;
  timeLabel: string;
  jalaliDate: string;
  jalaliMonthDay: string;
  jalaliWeekday: string;
  daysLeft: number | null;
  daysLeftLabel: string;
}

export interface DayPlan extends WeekDayMeta {
  iso: string;
  isToday: boolean;
  isPast: boolean;
  jalaliDate: string;
  jalaliMonthDay: string;
  jalaliDayNum: string;
  sessions: PlannedSession[];
  exams: PlannedSession[];
}

export interface WeekPlan {
  start: string;
  end: string;
  days: DayPlan[];
  total: number;
  remaining: number;
  examCount: number;
  current: PlannedSession | null;
  next: PlannedSession | null;
}

export interface WeekPlanOptions {
  group?: GroupFilter | string;
  now?: TehranNow;
}

const TEHRAN_NOW_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: TEHRAN_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const JALALI_PARTS_FMT = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

/** اکنونِ تهران: تاریخ میلادی ISO و دقیقهٔ روز. */
export function tehranNow(date: Date = new Date()): TehranNow {
  const parts = Object.fromEntries(
    TEHRAN_NOW_FMT.formatToParts(date).map((p) => [p.type, p.value]),
  );
  const hour = Number(enDigits(parts.hour)) % 24;
  const minute = Number(enDigits(parts.minute));
  return {
    iso: `${enDigits(parts.year)}-${enDigits(parts.month)}-${enDigits(parts.day)}`,
    minutes: hour * 60 + minute,
  };
}

/** تبدیل «۱۴:۳۰» یا «14:30» به دقیقهٔ روز. */
export function toMinutes(value?: string | null): number | null {
  const match = enDigits(value).match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** دقیقه به «HH:MM» لاتین (برای محاسبات و فرمت). */
export function fromMinutes(total: number | null | undefined): string {
  if (total === null || total === undefined || !Number.isFinite(total)) return '';
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** قالب‌بندی بازهٔ ساعت جلسه با ارقام فارسی (مثلاً «۰۸:۰۰ تا ۰۹:۳۰»). */
export function formatSessionTime(time?: string | null, endTime?: string | null): string {
  const start = toMinutes(time);
  if (start === null) return 'ساعت اعلام نشده';
  const startStr = faDigits(fromMinutes(start));
  const end = toMinutes(endTime);
  if (end !== null) {
    return `${startStr} تا ${faDigits(fromMinutes(end))}`;
  }
  return startStr;
}

/** جمع/تفریق روز روی تاریخ میلادی YYYY-MM-DD (مستقل از timezone). */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = enDigits(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** اختلاف روز بین دو تاریخ ISO (مثبت = آینده). */
export function diffDays(fromIso: string, toIso: string): number | null {
  const a = enDigits(fromIso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const b = enDigits(toIso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!a || !b) return null;
  const tA = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  const tB = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]));
  return Math.round((tB - tA) / MS_PER_DAY);
}

/** روز هفتهٔ یک تاریخ ISO (YYYY-MM-DD). */
export function weekdayOf(iso?: string | null): WeekDayMeta | null {
  const raw = enDigits(iso).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) return null;
  return WEEK_BY_JS_DAY[date.getUTCDay()] || null;
}

/** شنبهٔ همان هفته (هفتهٔ ایرانی از شنبه شروع می‌شود). */
export function weekStart(iso: string): string {
  const day = weekdayOf(iso);
  if (!day) return iso;
  const index = WEEK.findIndex((w) => w.key === day.key);
  return addDays(iso, -index);
}

/** ۷ روز هفته با تاریخ واقعی و برچسب جلالی. */
export function weekDays(startIso: string): Array<WeekDayMeta & { iso: string }> {
  return WEEK.map((w, i) => ({ ...w, iso: addDays(startIso, i) }));
}

/** «گروه ۱» / «1» / «۱» / «١» → '1'؛ «هر دو» یا خالی → 'both'. */
export function normalizeGroup(value: unknown): NormalizedGroup {
  const text = enDigits(value === null || value === undefined ? '' : String(value)).trim();
  if (/(^|\D)1(\D|$)/.test(text)) return '1';
  if (/(^|\D)2(\D|$)/.test(text)) return '2';
  return 'both';
}

export function matchesGroup(item: { group?: unknown } | null | undefined, filter?: string): boolean {
  if (!filter || filter === 'all') return true;
  const g = normalizeGroup(item?.group);
  return g === 'both' || g === filter;
}

/** نشان‌های کنار یک جلسه: جبرانی، شناور، تغییر یافته. */
export function sessionFlags(item: WeekScheduleInput | null | undefined): SessionFlag[] {
  const flags: SessionFlag[] = [];
  if (item?.type === 'makeup') flags.push({ key: 'makeup', label: 'جبرانی' });
  if (item?.flex_type === 'flexible') {
    flags.push({ key: 'flex', label: 'انعطاف‌پذیر', note: item.flex_note || '' });
  }
  const note = String(item?.note || '');
  if (/تغییر|جابه|جابجا|لغو|کنسل/.test(note)) {
    flags.push({ key: 'changed', label: 'تغییر ساعت', note });
  }
  return flags;
}

function formatDaysLeft(daysLeft: number | null): string {
  if (daysLeft === null || !Number.isFinite(daysLeft)) return '';
  if (daysLeft === 0) return 'امروز';
  if (daysLeft > 0) return `${faNum(daysLeft)} روز دیگر`;
  return `${faNum(Math.abs(daysLeft))} روز پیش`;
}

function jalaliParts(iso: string): { year: string; month: string; day: string } | null {
  const raw = enDigits(iso).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  try {
    const dt = new Date(`${raw}T12:00:00Z`);
    if (Number.isNaN(dt.getTime())) return null;
    const map = Object.fromEntries(
      JALALI_PARTS_FMT.formatToParts(dt).map((p) => [p.type, p.value]),
    );
    if (!map.year || !map.month || !map.day) return null;
    return { year: map.year, month: map.month, day: map.day };
  } catch {
    return null;
  }
}

/** بازهٔ هفته به شمسی: «۳ تا ۹ آذر ۱۴۰۵» یا «۳۰ آبان تا ۶ آذر ۱۴۰۵». */
export function jalaliRange(startIso: string, endIso: string): string {
  const a = jalaliParts(startIso);
  const b = jalaliParts(endIso);
  if (!a || !b) return '';
  if (a.year === b.year && a.month === b.month) {
    return `${a.day} تا ${b.day} ${b.month} ${b.year}`;
  }
  if (a.year === b.year) {
    return `${a.day} ${a.month} تا ${b.day} ${b.month} ${b.year}`;
  }
  return `${a.day} ${a.month} ${a.year} تا ${b.day} ${b.month} ${b.year}`;
}

/** آیا جلسه‌ها هر دو گروه را دارند؟ (فقط آن‌وقت فیلتر گروه معنا دارد) */
export function hasBothGroups(items: ReadonlyArray<{ group?: unknown }> = []): boolean {
  const seen = new Set(items.map((i) => normalizeGroup(i?.group)));
  return seen.has('1') && seen.has('2');
}

/**
 * جلسه‌های یک هفته (شنبه تا جمعه)، به تفکیک روز و مرتب بر اساس ساعت.
 */
export function buildWeekPlan(
  items: ReadonlyArray<WeekScheduleInput> = [],
  startIso: string,
  opts: WeekPlanOptions = {},
): WeekPlan {
  const now = opts.now || tehranNow();
  const days: DayPlan[] = weekDays(startIso).map((d) => {
    const monthDay = faMonthDay(d.iso);
    const dayNum = monthDay.split(' ')[0] || '';
    return {
      ...d,
      isToday: d.iso === now.iso,
      isPast: d.iso < now.iso,
      jalaliDate: faDate(d.iso),
      jalaliMonthDay: monthDay,
      jalaliDayNum: dayNum,
      sessions: [],
      exams: [],
    };
  });

  const byIso: Record<string, DayPlan> = Object.fromEntries(days.map((d) => [d.iso, d]));

  for (const item of items) {
    const iso = enDigits(item?.date).slice(0, 10);
    const day = byIso[iso];
    if (!day || !matchesGroup(item, opts.group)) continue;

    const start = toMinutes(item.time);
    const end = toMinutes(item.end_time) ?? (start === null ? null : start + 90);
    const computedDaysLeft =
      typeof item.days_left === 'number' && Number.isFinite(item.days_left)
        ? item.days_left
        : diffDays(now.iso, iso);

    const entry: PlannedSession = {
      ...item,
      iso,
      start,
      end,
      flags: sessionFlags(item),
      isNow: day.isToday && start !== null && end !== null && start <= now.minutes && now.minutes < end,
      isNext: false,
      isOver: day.isPast || (day.isToday && end !== null && end <= now.minutes),
      timeLabel: formatSessionTime(item.time, item.end_time),
      jalaliDate: day.jalaliDate,
      jalaliMonthDay: day.jalaliMonthDay,
      jalaliWeekday: faWeekday(iso) || day.name,
      daysLeft: computedDaysLeft,
      daysLeftLabel: formatDaysLeft(computedDaysLeft),
    };

    if (item.type === 'exam') day.exams.push(entry);
    else day.sessions.push(entry);
  }

  const byTime = (a: PlannedSession, b: PlannedSession): number =>
    (a.start ?? 9999) - (b.start ?? 9999) ||
    String(a.lesson || '').localeCompare(String(b.lesson || ''), 'fa');

  for (const d of days) {
    d.sessions.sort(byTime);
    d.exams.sort(byTime);
  }

  const all = days.flatMap((d) => d.sessions);
  const current = all.find((s) => s.isNow) || null;
  const next =
    all.find(
      (s) =>
        !s.isOver &&
        !s.isNow &&
        s.start !== null &&
        (s.iso > now.iso || s.start > now.minutes),
    ) || null;

  if (next) next.isNext = true;

  return {
    start: startIso,
    end: addDays(startIso, 6),
    days,
    total: all.length,
    remaining: all.filter((s) => !s.isOver).length,
    examCount: days.reduce((n, d) => n + d.exams.length, 0),
    current,
    next,
  };
}
