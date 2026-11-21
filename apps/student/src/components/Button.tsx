import type { ButtonHTMLAttributes } from 'react';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/sprite';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'ink' | 'cyan' | 'outline';
  size?: 'md' | 'sm' | 'lg';
  block?: boolean;
  loading?: boolean;
  icon?: IconName;
  iconPosition?: 'start' | 'end';
}

/** دکمه استاندارد و پیشرفته با استایل و بازخورد لمسی بالینی */
export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  loading = false,
  icon,
  iconPosition = 'start',
  children,
  className = '',
  disabled,
  ...rest
}: ButtonProps) {
  const cls = [
    'btn',
    variant === 'ghost' && 'btn--ghost',
    variant === 'ink' && 'btn--ink',
    variant === 'cyan' && 'btn--cyan',
    variant === 'outline' && 'btn--outline',
    size === 'sm' && 'btn--sm',
    size === 'lg' && 'btn--lg',
    block && 'btn--block',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const iconElement = loading ? (
    <span className="btn__spin" aria-hidden="true" />
  ) : icon ? (
    <Icon name={icon} size={size === 'sm' ? 15 : size === 'lg' ? 20 : 18} />
  ) : null;

  return (
    <button className={cls} aria-busy={loading || undefined} disabled={disabled || loading} {...rest}>
      {iconPosition === 'start' && iconElement}
      <span className="btn__text">{children}</span>
      {iconPosition === 'end' && iconElement}
    </button>
  );
}
