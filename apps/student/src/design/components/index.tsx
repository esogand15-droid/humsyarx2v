/* DS v2 — thin React wrappers over design/components.css (.ds-*).
   They only assemble class names and ARIA; all visuals live in CSS and read --hym-accent-*.
   v1 wrappers in src/components/* stay untouched until Wave 3/4 migrates screens. */
import { useCallback, useEffect, useLayoutEffect, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

export type DsSection = 'brand' | 'resources' | 'qbank' | 'schedule' | 'ai' | 'grades' | 'money' | 'notes' | 'danger';

export interface DsButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  loading?: boolean;
}
export function DsButton({ variant = 'primary', size = 'md', block, loading, disabled, className, children, type = 'button', ...rest }: DsButtonProps) {
  return (
    <button
      type={type}
      className={cx('ds-btn', variant !== 'primary' && `ds-btn--${variant}`, size !== 'md' && `ds-btn--${size}`, block && 'ds-btn--block', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="ds-btn__spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

export interface DsChipProps extends ButtonHTMLAttributes<HTMLButtonElement> { selected?: boolean }
export function DsChip({ selected = false, className, type = 'button', ...rest }: DsChipProps) {
  return <button type={type} className={cx('ds-chip', className)} aria-pressed={selected} {...rest} />;
}

export interface DsSegmentedProps<T extends string> {
  value: T;
  options: ReadonlyArray<{ value: T; label: ReactNode }>;
  onChange: (v: T) => void;
  block?: boolean;
  label: string;
}
export function DsSegmented<T extends string>({ value, options, onChange, block, label }: DsSegmentedProps<T>) {
  const segRef = useRef<HTMLDivElement>(null);
  const readyRef = useRef(false);
  const activeIdx = options.findIndex((o) => o.value === value);

  const measure = useCallback(() => {
    const seg = segRef.current;
    if (!seg) return;
    if (activeIdx < 0) {
      seg.dataset.segReady = 'true';
      return;
    }
    const items = seg.querySelectorAll<HTMLElement>('.ds-seg__item');
    const el = items[activeIdx];
    if (!el || el.offsetWidth <= 0) return;
    const isRtl = getComputedStyle(seg).direction === 'rtl';
    const x = isRtl ? -(seg.clientWidth - (el.offsetLeft + el.offsetWidth)) : el.offsetLeft;
    seg.style.setProperty('--lg-seg-x', `${Math.round(x)}px`);
    seg.style.setProperty('--lg-seg-w', `${Math.round(el.offsetWidth)}px`);
    seg.dataset.segReady = 'true';
    if (!readyRef.current) {
      readyRef.current = true;
      requestAnimationFrame(() => {
        if (segRef.current) segRef.current.dataset.segAnim = 'true';
      });
    }
  }, [activeIdx]);

  useLayoutEffect(() => {
    measure();
  }, [measure, options.length]);

  useEffect(() => {
    const seg = segRef.current;
    if (!seg) return;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : null;
    ro?.observe(seg);
    window.addEventListener('resize', measure);
    document.fonts?.ready.then(() => measure()).catch(() => {});
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  return (
    <div ref={segRef} className={cx('ds-seg', block && 'ds-seg--block')} role="tablist" aria-label={label}>
      <span className="lg-seg__lens" aria-hidden="true" data-hidden={activeIdx < 0 ? '' : undefined} />
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" className="ds-seg__item" aria-selected={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export interface DsCardProps extends HTMLAttributes<HTMLDivElement> {
  level?: 'flat' | 'default' | 'raised' | 'float' | 'sunken' | 'accent';
  flush?: boolean;
}
export function DsCard({ level = 'default', flush, className, ...rest }: DsCardProps) {
  return <div className={cx('ds-card', level !== 'default' && `ds-card--${level}`, flush && 'ds-card--flush', className)} {...rest} />;
}

export interface DsBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'neutral' | 'accent' | 'solid' | 'danger' | 'success' | 'warning' | 'count';
}
export function DsBadge({ tone = 'neutral', className, ...rest }: DsBadgeProps) {
  return <span className={cx('ds-badge', tone !== 'neutral' && `ds-badge--${tone}`, className)} {...rest} />;
}

export interface DsInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  ltr?: boolean;
}
export function DsInput({ label, hint, error, ltr, id, className, ...rest }: DsInputProps) {
  const fid = id ?? `ds-${String(rest.name ?? 'field')}`;
  return (
    <div className="ds-field">
      <label className="ds-field__label" htmlFor={fid}>{label}</label>
      <input
        id={fid}
        className={cx('ds-input', ltr && 'ds-input--ltr', className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${fid}-msg` : undefined}
        {...rest}
      />
      {(error || hint) && <div id={`${fid}-msg`} className={error ? 'ds-field__error' : 'ds-field__hint'}>{error || hint}</div>}
    </div>
  );
}

export interface DsEmptyProps { icon?: ReactNode; title: ReactNode; body?: ReactNode; action?: ReactNode }
export function DsEmpty({ icon, title, body, action }: DsEmptyProps) {
  return (
    <div className="ds-empty">
      {icon && <div className="ds-empty__icon" aria-hidden="true">{icon}</div>}
      <h3 className="ds-empty__title">{title}</h3>
      {body && <p className="ds-empty__body">{body}</p>}
      {action && <div className="ds-empty__action">{action}</div>}
    </div>
  );
}

export function DsSkeleton({ shape = 'text', className }: { shape?: 'text' | 'title' | 'row' | 'card' | 'circle'; className?: string }) {
  return <span className={cx('ds-skel', `ds-skel--${shape}`, className)} aria-hidden="true" />;
}
