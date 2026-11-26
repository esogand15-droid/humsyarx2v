import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/sprite';

export interface ListRowProps {
  title: string;
  sub?: string;
  meta?: string;
  icon?: IconName;
  trailing?: ReactNode;
  chevron?: boolean;
  danger?: boolean;
  /** مسیر مقصد. اگر داده شود، ردیف خودش یک لینک است. */
  to?: string;
  onClick?: () => void;
}

/** ردیف لیست DS v2 — یک کنش در هر ردیف با ایزولاسیون BiDi. */
export function ListRow({
  title,
  sub,
  meta,
  icon,
  trailing,
  chevron = false,
  danger = false,
  to,
  onClick,
}: ListRowProps) {
  const inner = (
    <>
      {icon && (
        <span className="ds-row__icon" aria-hidden="true">
          <Icon name={icon} size={20} />
        </span>
      )}
      <span className="ds-row__body">
        <span className="ds-row__title">
          <bdi dir="auto">{title}</bdi>
        </span>
        {sub && (
          <span className="ds-row__sub">
            <bdi dir="auto">{sub}</bdi>
          </span>
        )}
      </span>
      {meta && <span className="ds-row__meta num">{meta}</span>}
      {trailing}
      {chevron && <Icon name="i-chevron-r" size={18} className="ds-row__chev" />}
    </>
  );

  const cls = `ds-row${danger ? ' acct-row-danger' : ''}`;

  if (to) {
    return (
      <Link className={cls} to={to}>
        {inner}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button className={cls} onClick={onClick} type="button">
        {inner}
      </button>
    );
  }

  return <div className={cls}>{inner}</div>;
}
