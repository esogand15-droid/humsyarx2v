/* پیشنهادهای شروع گفت‌وگو برای دانشجوی پزشکی — بر اساس نیت (R2 §A9).
   هر روز چهار مورد متفاوت؛ در یک روز ثابت (برای اسکرین‌شات و حافظهٔ کاربر). */
import type { IconName } from '../../icons/sprite';

const ZW = '\u200c';

export interface Starter {
  tag: string;
  icon: IconName;
  text: string;
}

export const STARTERS: Starter[] = [
  { tag: 'توضیح', icon: 'i-book-open', text: `پاتوفیزیولوژی نارسایی قلبی با EF کاهش${ZW}یافته را ساده توضیح بده` },
  { tag: 'مقایسه', icon: 'i-layers', text: `جدول مقایسهٔ مهارکننده${ZW}های ACE و ARB: مکانیسم، عوارض و منع مصرف` },
  { tag: 'کیس بالینی', icon: 'i-target', text: 'یک کیس بالینی درد قفسهٔ سینه برای تمرین تشخیص افتراقی بساز' },
  { tag: 'خودآزمایی', icon: 'i-award', text: `۵ سؤال چهارگزینه${ZW}ای پره${ZW}انترنی از اختلالات اسید و باز با پاسخ تشریحی` },
  { tag: 'تفسیر', icon: 'i-flask', text: 'این ABG را تفسیر کن: pH 7.31، PaCO2 30، HCO3 15' },
  { tag: 'یادسپاری', icon: 'i-bookmark', text: 'یک روش یادسپاری برای اعصاب مغزی و عملکردشان بگو' },
  { tag: 'نوار قلب', icon: 'i-trend', text: 'تغییرات قطعهٔ ST و موج T در ECG را با مثال توضیح بده' },
  { tag: 'درمان', icon: 'i-shield', text: `درمان مرحله${ZW}ای پرفشاری خون را طبق گایدلاین${ZW}های اخیر مرور کن` },
  { tag: 'تشخیص افتراقی', icon: 'i-search', text: `تشخیص${ZW}های افتراقی درد حاد ربع تحتانی راست شکم چیست؟` },
  { tag: 'خلاصه', icon: 'i-file-text', text: 'چرخهٔ کربس و نقاط تنظیم آن را برای امتحان خلاصه کن' },
  { tag: 'آزمایشگاه', icon: 'i-flask', text: `هیپوناترمی را گام${ZW}به${ZW}گام چطور بررسی کنم؟` },
  { tag: 'آناتومی', icon: 'i-grid', text: `شبکهٔ بازویی و آسیب${ZW}های شایع آن را در یک جدول توضیح بده` },
];

/** n پیشنهاد متمایز؛ گام ۵ نسبت به ۱۲ اول است، پس تکرار ندارد. */
export function pickStarters(n = 4, seed = Math.floor(Date.now() / 86_400_000)): Starter[] {
  const len = STARTERS.length;
  const out: Starter[] = [];
  for (let i = 0; i < Math.min(n, len); i++) out.push(STARTERS[(seed * 3 + i * 5) % len]);
  return out;
}
