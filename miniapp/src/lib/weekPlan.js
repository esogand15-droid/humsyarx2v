/* ─────────────────────────────────────────────────────────────
   📅 برنامهٔ هفتگی واقعی (شنبه تا جمعه) — منطق بدون JSX

   صفحهٔ قبلی «۲۰۱ جلسه در ترم» نشان میداد که دانشجو را میترساند و
   به سؤال اصلی («این هفته چه کلاسی دارم؟») جواب نمیداد. اینجا هر
   جلسه به تاریخ واقعیاش در هفتهٔ انتخابشده میرود.

   • زمان همیشه با ساعت تهران حساب میشود، نه ساعت دستگاه.
   • دادهٔ ساختگی ساخته نمیشود؛ روز بدون کلاس خالی میماند.
   ───────────────────────────────────────────────────────────── */
import { WEEK, toMinutes, weekdayOf } from './scheduleEngine.js';

const TEHRAN = 'Asia/Tehran';

/** اکنونِ تهران: تاریخ میلادی ISO و دقیقهٔ روز. */
export function tehranNow(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TEHRAN,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return {
    iso: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function addDays(iso, n) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** شنبهٔ همان هفته (هفتهٔ ایرانی از شنبه شروع میشود). */
export function weekStart(iso) {
  const day = weekdayOf(iso);
  if (!day) return iso;
  const index = WEEK.findIndex((w) => w.key === day.key);
  return addDays(iso, -index);
}

/** ۷ روز هفته با تاریخ واقعی. */
export function weekDays(startIso) {
  return WEEK.map((w, i) => ({ ...w, iso: addDays(startIso, i) }));
}

/** «گروه ۱» / «1» / «۱» → '1'؛ «هر دو» یا خالی → 'both'. */
export function normalizeGroup(value) {
  const text = String(value ?? '')
    .replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)))
    .trim();
  if (/(^|\D)1(\D|$)/.test(text)) return '1';
  if (/(^|\D)2(\D|$)/.test(text)) return '2';
  return 'both';
}

export function matchesGroup(item, filter) {
  if (!filter || filter === 'all') return true;
  const g = normalizeGroup(item?.group);
  return g === 'both' || g === filter;
}

/** نشانهای کنار یک جلسه: جبرانی، شناور، تغییر یافته. */
export function sessionFlags(item) {
  const flags = [];
  if (item?.type === 'makeup') flags.push({ key: 'makeup', label: 'جبرانی' });
  if (item?.flex_type === 'flexible') {
    flags.push({ key: 'flex', label: 'زمان شناور', note: item.flex_note || '' });
  }
  const note = String(item?.note || '');
  if (/تغییر|جابه|جابجا|لغو|کنسل/.test(note)) flags.push({ key: 'changed', label: 'تغییر کرده', note });
  return flags;
}

/**
 * جلسههای یک هفته، به تفکیک روز و مرتب بر اساس ساعت.
 *
 * @param {Array} items همهٔ جلسههای سرور (کلاس، جبرانی، آزمون)
 * @param {string} startIso شنبهٔ هفته
 * @param {{group?: string, now?: {iso: string, minutes: number}}} opts
 */
export function buildWeekPlan(items = [], startIso, opts = {}) {
  const now = opts.now || tehranNow();
  const days = weekDays(startIso).map((d) => ({
    ...d,
    isToday: d.iso === now.iso,
    isPast: d.iso < now.iso,
    sessions: [],
    exams: [],
  }));
  const byIso = Object.fromEntries(days.map((d) => [d.iso, d]));

  for (const item of items) {
    const iso = String(item?.date || '').slice(0, 10);
    const day = byIso[iso];
    if (!day || !matchesGroup(item, opts.group)) continue;

    const start = toMinutes(item.time);
    const end = toMinutes(item.end_time) ?? (start === null ? null : start + 90);
    const entry = {
      ...item,
      iso,
      start,
      end,
      flags: sessionFlags(item),
      isNow: day.isToday && start !== null && start <= now.minutes && now.minutes < end,
      isOver: day.isPast || (day.isToday && end !== null && end <= now.minutes),
    };
    if (item.type === 'exam') day.exams.push(entry);
    else day.sessions.push(entry);
  }

  const byTime = (a, b) => (a.start ?? 9999) - (b.start ?? 9999)
    || String(a.lesson || '').localeCompare(String(b.lesson || ''), 'fa');
  for (const d of days) {
    d.sessions.sort(byTime);
    d.exams.sort(byTime);
  }

  const all = days.flatMap((d) => d.sessions);
  const current = all.find((s) => s.isNow) || null;
  const next = all.find((s) => !s.isOver && !s.isNow && s.start !== null
    && (s.iso > now.iso || s.start > now.minutes)) || null;

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

/** آیا جلسهها هر دو گروه را دارند؟ (فقط آنوقت فیلتر گروه معنا دارد) */
export function hasBothGroups(items = []) {
  const seen = new Set(items.map((i) => normalizeGroup(i?.group)));
  return seen.has('1') && seen.has('2');
}

/** تاریخ شمسی کوتاه: «۵ آذر» */
export function jalaliDayMonth(iso) {
  try {
    return new Date(`${iso}T12:00:00Z`).toLocaleDateString('fa-IR-u-ca-persian', {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'long',
    });
  } catch {
    return '';
  }
}

/** بازهٔ هفته به شمسی: «۱ تا ۷ آذر» یا «۲۹ آبان تا ۵ آذر» */
export function jalaliRange(startIso, endIso) {
  const a = jalaliDayMonth(startIso);
  const b = jalaliDayMonth(endIso);
  const [aDay, ...aMonth] = a.split(' ');
  const [, ...bMonth] = b.split(' ');
  return aMonth.join(' ') === bMonth.join(' ') ? `${aDay} تا ${b}` : `${a} تا ${b}`;
}
