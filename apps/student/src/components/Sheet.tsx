import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconButton } from './IconButton';
import { usePresence } from '../lib/motion';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** «compact»: حداکثر حدود نصف صفحه؛ محتوای بیشتر داخل شیت اسکرول میشود. */
  size?: 'auto' | 'compact';
}

/** شیت پایینکشیدنی — ورود و خروج انیمیشنی، بستن با Esc و لمس پرده، قفل اسکرول پسزمینه. */
export function Sheet({ open, onClose, title, children, size = 'auto' }: SheetProps) {
  const { mounted, state } = usePresence(open, 260);
  const panelRef = useRef<HTMLDivElement>(null);
  const [lastTitle, setLastTitle] = useState(title);
  if (open && title !== lastTitle) setLastTitle(title);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useScrollLock(mounted);

  useEffect(() => {
    if (state === 'open') panelRef.current?.focus({ preventScroll: true });
  }, [state]);

  if (!mounted) return null;
  return (
    <>
      <div className="sheet-scrim" data-state={state} onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className={`sheet${size === 'compact' ? ' sheet--compact' : ''}`}
        data-state={state}
        role="dialog"
        aria-modal="true"
        aria-label={open ? title : lastTitle}
        tabIndex={-1}
      >
        <div className="sheet__grip" aria-hidden="true" />
        <div className="sheet__head">
          <span className="h2">{open ? title : lastTitle}</span>
          <IconButton icon="i-x" label="بستن" onClick={onClose} />
        </div>
        <div className="sheet__body">{children}</div>
      </div>
    </>
  );
}

/** قفل اسکرول body بدون پرش (iOS): موقعیت فعلی حفظ و هنگام آزادسازی برگردانده میشود. */
function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const { body, documentElement } = document;
    const y = window.scrollY;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: documentElement.style.overflow,
    };
    body.style.position = 'fixed';
    body.style.top = `-${y}px`;
    body.style.width = '100%';
    documentElement.style.overflow = 'hidden';
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      documentElement.style.overflow = prev.overflow;
      window.scrollTo(0, y);
    };
  }, [active]);
}
