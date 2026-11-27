import { useCallback, useEffect, useState } from 'react';

import './account.css';
import { SkeletonStack } from '../components';
import { AppBar } from '../components/AppBar';
import { DsButton, DsCard, DsEmpty, DsSegmented } from '../design/components';
import { Icon } from '../icons';
import { errorText } from '../lib/api';
import { faDate, faNum } from '../lib/fa';
import {
  markNotificationsRead,
  useNotificationsState,
  type InboxNotification,
} from '../lib/notifications';

type NotificationItem = InboxNotification;

const DATE_TIME_FA = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  timeZone: 'Asia/Tehran',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formatNotifTime(iso?: string): string {
  if (!iso) return '';
  const dt = new Date(iso);
  if (!Number.isFinite(dt.getTime())) return faDate(iso);
  try {
    return DATE_TIME_FA.format(dt);
  } catch {
    return faDate(iso);
  }
}

function notifKind(item: NotificationItem): 'exam' | 'content' | 'general' {
  const cat = (item.category || '').toLowerCase();
  if (cat.includes('exam') || item.title.includes('آزمون')) return 'exam';
  if (cat.includes('content') || cat.includes('library') || item.title.includes('جزوه')) {
    return 'content';
  }
  return 'general';
}

/** مرکز اعلان‌ها — همگام با نشانگر زنگ هدر و جلوگیری از نمایش همزمان خطا و وضعیت خالی. */
export function NotificationsScreen() {
  const { items, unread: unreadCount, reloadInbox } = useNotificationsState({ loadInbox: true });
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      await reloadInbox();
    } catch (err) {
      setError(errorText(err, 'دریافت اعلان‌ها ممکن نشد.'));
    }
  }, [reloadInbox]);

  useEffect(() => {
    void load();
  }, [load]);

  const markRead = async (ids: string[] | null) => {
    try {
      await markNotificationsRead(ids);
    } catch {
      void load();
    }
  };

  const list = items ?? [];
  const filtered = filter === 'unread' ? list.filter((i) => !i.read) : list;

  return (
    <>
      <AppBar
        title="مرکز اعلان‌ها"
        sub="پیام‌ها و اطلاعیه‌های سامانه"
        back
        actions={
          unreadCount > 0 ? (
            <DsButton
              variant="ghost"
              size="sm"
              className="acct-btn-tall"
              onClick={() => void markRead(null)}
            >
              خواندن همه
            </DsButton>
          ) : undefined
        }
      />

      <div className="page page-enter acct-page">
        <DsSegmented
          block
          label="فیلتر اعلان‌ها"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `همه پیام‌ها (${faNum(list.length)})` },
            { value: 'unread', label: `خوانده‌نشده (${faNum(unreadCount)})` },
          ]}
        />

        {error && (
          <DsCard>
            <div className="acct-notice acct-notice--danger" role="alert">
              <div className="acct-notice__lead">
                <Icon name="i-alert-circle" size={18} />
                <span>{error}</span>
              </div>
              <DsButton variant="secondary" size="md" onClick={() => void load()}>
                تلاش دوباره
              </DsButton>
            </div>
          </DsCard>
        )}

        {items === null && !error ? (
          <SkeletonStack rows={4} />
        ) : error && list.length === 0 ? null : filtered.length === 0 ? (
          <DsCard>
            <DsEmpty
              icon={<Icon name="i-bell" size={28} />}
              title="اعلانی وجود ندارد"
              body={
                filter === 'unread'
                  ? 'همهٔ اعلان‌ها را خوانده‌اید.'
                  : 'هنوز اعلانی برای شما ثبت نشده است.'
              }
              action={
                filter === 'unread' && list.length > 0 ? (
                  <DsButton variant="secondary" onClick={() => setFilter('all')}>
                    نمایش همهٔ پیام‌ها
                  </DsButton>
                ) : undefined
              }
            />
          </DsCard>
        ) : (
          <div className="acct-notif-list">
            {filtered.map((item) => {
              const kind = notifKind(item);
              const iconName =
                kind === 'exam' ? 'i-award' : kind === 'content' ? 'i-book' : 'i-bell';
              const iconCls =
                kind === 'exam'
                  ? 'acct-notif-icon acct-notif-icon--exam'
                  : kind === 'content'
                    ? 'acct-notif-icon acct-notif-icon--content'
                    : 'acct-notif-icon';

              const cardInner = (
                <>
                  <div className="acct-notif-head">
                    <span className={iconCls} aria-hidden="true">
                      <Icon name={iconName} size={18} />
                    </span>
                    <div className="acct-notif-title-wrap">
                      {!item.read && (
                        <span className="acct-unread-dot" aria-label="خوانده‌نشده" />
                      )}
                      <h2 className="acct-notif-title">{item.title}</h2>
                    </div>
                  </div>

                  {item.body && <p className="acct-notif-body">{item.body}</p>}

                  {item.created_at && (
                    <span className="acct-notif-time">{formatNotifTime(item.created_at)}</span>
                  )}
                </>
              );

              if (!item.read) {
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="ds-card acct-notif-card is-unread"
                    onClick={() => void markRead([item.id])}
                  >
                    {cardInner}
                  </button>
                );
              }

              return (
                <DsCard key={item.id} className="acct-notif-card">
                  {cardInner}
                </DsCard>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
