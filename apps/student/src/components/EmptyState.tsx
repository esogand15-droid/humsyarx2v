import type { ReactNode } from 'react';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/sprite';

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  text?: string;
  action?: ReactNode;
}

/** حالت خالی DS v2 — یک جملهٔ راهنما و حداکثر یک کنش. */
export function EmptyState({ icon = 'i-arch', title, text, action }: EmptyStateProps) {
  return (
    <div className="ds-empty">
      <span className="ds-empty__icon" aria-hidden="true">
        <Icon name={icon} size={28} />
      </span>
      <div className="ds-empty__title">{title}</div>
      {text && <p className="ds-empty__body">{text}</p>}
      {action && <div className="ds-empty__action">{action}</div>}
    </div>
  );
}
