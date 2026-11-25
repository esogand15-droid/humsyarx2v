/* برچسب فارسیِ ورودی و گروه — همان قاعدهٔ `_intake_label` در
   backend/api/routers/profile.py: کد `bahman_1404` → «بهمن ۱۴۰۴».
   کد ناشناخته با زیرخط هرگز خام نشان داده نمی‌شود. */
import { fa } from './library';

const JALALI_MONTHS: Record<string, string> = {
  farvardin: 'فروردین', ordibehesht: 'اردیبهشت', khordad: 'خرداد', tir: 'تیر',
  mordad: 'مرداد', shahrivar: 'شهریور', mehr: 'مهر', aban: 'آبان', azar: 'آذر',
  dey: 'دی', bahman: 'بهمن', esfand: 'اسفند',
};

export function intakeLabel(code: string | null | undefined): string {
  const raw = String(code ?? '').trim();
  if (!raw) return '';
  const [month, year] = raw.split('_');
  const name = JALALI_MONTHS[(month || '').toLowerCase()];
  if (name && year && /^\d+$/.test(year)) return `ورودی ${name} ${fa(year)}`;
  if (raw.includes('_')) return '';
  return /^\d+$/.test(raw) ? `ورودی ${fa(raw)}` : raw;
}

export function groupLabel(group: string | null | undefined): string {
  const raw = String(group ?? '').trim();
  if (!raw) return '';
  return /^\d+$/.test(raw) ? `گروه ${fa(raw)}` : raw;
}
