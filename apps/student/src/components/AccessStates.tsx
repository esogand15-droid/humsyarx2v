import type { ReactNode } from 'react';

import { SkeletonStack } from './Skeleton';
import { DsButton, DsCard, DsEmpty } from '../design/components';
import { Icon } from '../icons';
import type { IconName } from '../icons/sprite';
import { ApiError, errorText } from '../lib/api';

/* حالت‌های مشترک DS v2 — یک نگاشت، بدون inline style. */

export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div className="access-loading">
      <SkeletonStack rows={rows} />
    </div>
  );
}

interface ErrorBlockProps {
  error: unknown;
  onRetry?: () => void;
}

/** خطای بارگذاری: پیام بر اساس کد واقعی سرور، نه متن عمومی. */
export function ErrorBlock({ error, onRetry }: ErrorBlockProps) {
  const offline = error instanceof ApiError && error.offline;
  const icon: IconName = offline ? 'i-arch' : 'i-clock';

  return (
    <DsCard>
      <DsEmpty
        icon={<Icon name={icon} size={28} />}
        title={offline ? 'اتصال به سرور برقرار نشد' : 'بارگذاری ممکن نشد'}
        body={errorText(error, 'مشکلی پیش آمد. دوباره تلاش کنید.')}
        action={
          onRetry ? (
            <DsButton variant="secondary" size="md" onClick={onRetry}>
              تلاش دوباره
            </DsButton>
          ) : undefined
        }
      />
    </DsCard>
  );
}

/** بن‌بست دسترسی: وقتی گیت اشتراک/دامنه جلوی بخش را گرفته است. */
export function LockedBlock({
  title,
  text,
  action,
  code,
}: {
  title: string;
  text: string;
  action?: ReactNode;
  code?: string;
}) {
  return (
    <DsCard level="sunken" className="access-locked">
      <span className="access-locked__icon" aria-hidden="true">
        <Icon name="i-lock" size={24} />
      </span>
      <h2 className="access-locked__title">{title}</h2>
      <p className="access-locked__text">{text}</p>
      {code && (
        <p className="access-locked__code" dir="ltr">
          {code}
        </p>
      )}
      {action && <div className="access-locked__action">{action}</div>}
    </DsCard>
  );
}
