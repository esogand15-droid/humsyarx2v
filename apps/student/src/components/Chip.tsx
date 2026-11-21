import type { ReactNode } from 'react';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/sprite';

export interface ChipProps {
  children: ReactNode;
  variant?: 'cyan' | 'brand' | 'success' | 'quiet' | 'danger' | 'amber';
  icon?: IconName;
}

/** چیپ — وضعیت با متن، نه فقط رنگ (دسترس‌پذیری). */
export function Chip({ children, variant = 'cyan', icon }: ChipProps) {
  const cls = ['chip', variant !== 'cyan' && `chip--${variant}`].filter(Boolean).join(' ');
  return (
    <span className={cls}>
      {icon && <Icon name={icon} size={13} />}
      {children}
    </span>
  );
}
