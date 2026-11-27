import { useCallback, useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { IconButton } from './IconButton';
import { prefersReducedMotion, usePresence } from '../lib/motion';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** «compact»: حداکثر حدود نصف صفحه؛ محتوای بیشتر داخل شیت اسکرول میشود. */
  size?: 'auto' | 'compact';
  /** دکمهٔ بازگشت اختیاری در هدر (برای برگشت بین نماهای داخل یک شیت). */
  onBack?: () => void;
  backLabel?: string;
  className?: string;
}

/** شیت پایین‌کشیدنی — ورود/خروج انیمیشنی، کشیدن برای بستن، Esc/Back و قفل اسکرول. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  size = 'auto',
  onBack,
  backLabel = 'بازگشت',
  className,
}: SheetProps) {
  const { mounted, state } = usePresence(open, 260);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ active: boolean; pointerId: number; startY: number; startTime: number; dy: number }>({
    active: false,
    pointerId: -1,
    startY: 0,
    startTime: 0,
    dy: 0,
  });
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const sheetToken = useId();
  const [lastTitle, setLastTitle] = useState(title);
  if (open && title !== lastTitle) setLastTitle(title);

  useEffect(() => {
    if (!open) return;
    prevFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Android / browser hardware Back dismisses the open sheet instead of leaving the route.
  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    let popped = false;
    try {
      const curr = window.history.state && typeof window.history.state === 'object' ? window.history.state : {};
      window.history.pushState({ ...curr, _hySheet: sheetToken }, '');
    } catch {
      return;
    }
    const onPop = () => {
      const st = window.history.state as { _hySheet?: string } | null;
      if (st?._hySheet !== sheetToken) {
        popped = true;
        onCloseRef.current();
      }
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      const st = window.history.state as { _hySheet?: string } | null;
      if (!popped && st?._hySheet === sheetToken) {
        try {
          window.history.back();
        } catch {
          // ignore
        }
      }
    };
  }, [open, sheetToken]);

  useScrollLock(mounted);

  useEffect(() => {
    const panel = panelRef.current;
    if (open && panel) {
      panel.style.removeProperty('--sheet-drag-y');
      panel.style.transform = '';
      panel.style.transition = '';
    }
    if (state === 'open') {
      panel?.focus({ preventScroll: true });
    }
  }, [open, state]);

  useEffect(() => {
    if (!mounted && prevFocusRef.current && prevFocusRef.current.isConnected) {
      prevFocusRef.current.focus({ preventScroll: true });
      prevFocusRef.current = null;
    }
  }, [mounted]);

  const onDragStart = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (prefersReducedMotion()) return;
    if ((e.target as HTMLElement)?.closest('button, a, input, textarea, select')) return;
    const panel = panelRef.current;
    if (!panel) return;
    dragRef.current = {
      active: true,
      pointerId: e.pointerId,
      startY: e.clientY,
      startTime: performance.now(),
      dy: 0,
    };
    panel.style.transition = 'none';
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }, []);

  const onDragMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d.active || e.pointerId !== d.pointerId) return;
    const panel = panelRef.current;
    if (!panel) return;
    const raw = e.clientY - d.startY;
    const dy = raw >= 0 ? raw : -Math.min(18, Math.abs(raw) * 0.18);
    d.dy = dy;
    panel.style.transform = `translate3d(0, ${dy}px, 0)`;
    if (scrimRef.current && dy > 0) {
      const h = panel.offsetHeight || 360;
      scrimRef.current.style.opacity = String(Math.max(0.25, 1 - dy / Math.max(240, h)));
    }
  }, []);

  const onDragEnd = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d.active || e.pointerId !== d.pointerId) return;
    d.active = false;
    const panel = panelRef.current;
    const scrim = scrimRef.current;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }
    if (!panel) return;
    const h = panel.offsetHeight || 360;
    const elapsed = Math.max(16, performance.now() - d.startTime);
    const velocity = d.dy / elapsed;
    const shouldClose = d.dy > Math.min(140, h * 0.35) || velocity > 0.55;
    if (scrim) scrim.style.opacity = '';

    if (shouldClose) {
      panel.style.setProperty('--sheet-drag-y', `${Math.max(0, Math.round(d.dy))}px`);
      panel.style.transform = '';
      panel.style.transition = '';
      onCloseRef.current();
    } else {
      panel.style.transition = 'transform 240ms var(--mo-ease-spring)';
      panel.style.transform = 'translate3d(0, 0, 0)';
      window.setTimeout(() => {
        if (panelRef.current) {
          panelRef.current.style.transition = '';
          panelRef.current.style.transform = '';
        }
      }, 250);
    }
  }, []);

  if (!mounted) return null;
  const displayTitle = open ? title : lastTitle;
  return (
    <>
      <div ref={scrimRef} className="sheet-scrim" data-state={state} onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className={`sheet${size === 'compact' ? ' sheet--compact' : ''}${className ? ` ${className}` : ''}`}
        data-state={state}
        role="dialog"
        aria-modal="true"
        aria-label={displayTitle}
        tabIndex={-1}
      >
        <div
          className="sheet__grip"
          aria-hidden="true"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        />
        <div
          className="sheet__head"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          <div className="sheet__title-wrap">
            {onBack && <IconButton icon="i-chevron-r" label={backLabel} onClick={onBack} />}
            <span className="h2">{displayTitle}</span>
          </div>
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
