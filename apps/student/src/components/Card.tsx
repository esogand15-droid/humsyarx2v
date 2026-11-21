import type { HTMLAttributes } from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'plain' | 'rule' | 'quiet' | 'flush' | 'interactive' | 'glass';
}

/** کارت — جداکنندهٔ ۱px، سایهٔ حداقلی، حالت‌های تعاملی و متریال شیشه‌ای */
export function Card({ variant = 'plain', className = '', children, ...rest }: CardProps) {
  const cls = [
    'card',
    variant === 'rule' && 'card--rule',
    variant === 'quiet' && 'card--quiet',
    variant === 'flush' && 'card--flush',
    variant === 'interactive' && 'card--interactive',
    variant === 'glass' && 'card--glass',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  );
}
