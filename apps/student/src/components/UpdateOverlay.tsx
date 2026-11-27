import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { Icon } from '../icons/Icon';
import { usePresence } from '../lib/motion';
import { consumeJustUpdated, subscribeSwPhase, type SwPhase } from '../lib/swUpdate';
import { Brand } from './Brand';

type StepState = 'done' | 'active' | 'todo';

const STEPS: ReadonlyArray<{ label: string; at: (p: SwPhase) => StepState }> = [
  { label: 'دریافت نسخهٔ جدید', at: () => 'done' },
  { label: 'فعال‌سازی نسخهٔ جدید', at: (p) => (p === 'reloading' ? 'done' : 'active') },
  { label: 'بارگذاری دوبارهٔ برنامه', at: (p) => (p === 'reloading' ? 'active' : 'todo') },
];

/* Read once per page load, outside React, so StrictMode's double render can't consume it twice. */
const JUST_UPDATED = typeof window !== 'undefined' && consumeJustUpdated();

/**
 * صفحهٔ تمامصفحهٔ بهروزرسانی: از لحظهٔ زدن «بهروزرسانی» تا ریلود نمایش داده میشود
 * و بعد از ریلود، اسپلش index.html همان حلقه و لوگو را ادامه میدهد.
 */
export function UpdateOverlay() {
  const [phase, setPhase] = useState<SwPhase>('idle');
  useEffect(() => subscribeSwPhase(setPhase), []);

  const active = phase === 'applying' || phase === 'reloading';

  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    root.dataset.updating = 'true';
    (document.activeElement as HTMLElement | null)?.blur?.();
    return () => {
      delete root.dataset.updating;
    };
  }, [active]);

  if (!active) return null;

  return createPortal(
    <div
      className="ds-update"
      data-phase={phase}
      role="alertdialog"
      aria-modal="true"
      aria-busy="true"
      aria-labelledby="ds-update-title"
      aria-describedby="ds-update-step"
    >
      <div className="ds-update__glow" aria-hidden="true" />
      <div className="ds-update__card">
        <div className="ds-update__mark" aria-hidden="true">
          <svg className="ds-update__ring" viewBox="0 0 120 120">
            <circle className="ds-update__ring-track" cx="60" cy="60" r="52" fill="none" strokeWidth="3" />
            <circle className="ds-update__ring-arc" cx="60" cy="60" r="52" fill="none" strokeWidth="3.5" />
          </svg>
          <span className="ds-update__logo">
            <Brand size="lg" />
          </span>
        </div>

        <h2 id="ds-update-title" className="ds-update__title">در حال به‌روزرسانی هامزیار</h2>
        <p id="ds-update-step" key={phase} className="ds-update__step" aria-live="polite">
          {phase === 'reloading' ? 'تقریباً تمام است؛ برنامه دوباره باز می‌شود…' : 'نسخهٔ جدید در حال فعال شدن است…'}
        </p>

        <div className="ds-update__bar" aria-hidden="true">
          <span />
        </div>

        <ol className="ds-update__steps">
          {STEPS.map((s) => {
            const st = s.at(phase);
            return (
              <li key={s.label} data-s={st}>
                <span className="ds-update__dot">{st === 'done' && <Icon name="i-check" size={12} />}</span>
                {s.label}
              </li>
            );
          })}
        </ol>

        <p className="ds-update__hint">چند ثانیه صبر کنید؛ پیشرفت و یادداشت‌های شما حفظ می‌شود.</p>
      </div>
    </div>,
    document.body,
  );
}

/** تأیید کوتاه پس از ریلود: «هامزیار بهروز شد». */
export function UpdatedToast() {
  const [visible, setVisible] = useState(JUST_UPDATED);

  useEffect(() => {
    if (!visible) return;
    const t = window.setTimeout(() => setVisible(false), 3200);
    return () => window.clearTimeout(t);
  }, [visible]);

  const { mounted, state } = usePresence(visible, 180);
  if (!mounted) return null;

  return createPortal(
    <div className="ds-updated-toast-wrap" role="status" aria-live="polite">
      <div className="ds-updated-toast mo-toast" data-state={state}>
        <span className="ds-updated-toast__icon" aria-hidden="true">
          <Icon name="i-check" size={16} />
        </span>
        هامزیار به آخرین نسخه به‌روز شد
      </div>
    </div>,
    document.body,
  );
}
