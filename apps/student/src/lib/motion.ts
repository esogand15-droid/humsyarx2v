/* سیستم مشترک حرکت — یک منبع برای مدتزمان و easing.
   CSS همین مقادیر را از design/motion.css (متغیرهای --mo-*) میخواند؛ اینجا فقط
   برای زمانبندی unmount پس از انیمیشن خروج به کار میآید. کتابخانهٔ انیمیشن
   اضافه نشده: همهچیز با transform/opacity در CSS اجرا میشود و تنها کار JS
   نگهداشتن عنصر در DOM تا پایان خروج است. */

import { useEffect, useState } from 'react';

export const MOTION = {
  /** پاپاور و منوهای کوچک */
  popover: 200,
  /** شیت پایینی (منحنی شبهفنری در CSS) */
  sheet: 260,
} as const;

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export type PresenceState = 'open' | 'closing';

/**
 * عنصر را بعد از `open=false` به اندازهٔ `exitMs` در DOM نگه میدارد تا انیمیشن
 * خروج (data-state="closing") اجرا شود. با reduced-motion بیدرنگ حذف میشود.
 */
export function usePresence(open: boolean, exitMs: number): { mounted: boolean; state: PresenceState } {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    const ms = prefersReducedMotion() ? 0 : exitMs;
    const t = window.setTimeout(() => setMounted(false), ms);
    return () => window.clearTimeout(t);
  }, [open, mounted, exitMs]);

  return { mounted: mounted || open, state: open ? 'open' : 'closing' };
}
