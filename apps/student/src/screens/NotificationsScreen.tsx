import { useCallback, useEffect, useState } from 'react';

import './account.css';
import { SkeletonStack } from '../components';
import { AppBar } from '../components/AppBar';
import { DsButton, DsCard, DsEmpty, DsSegmented } from '../design/components';
import { Icon } from '../icons';
import { apiCall, errorText } from '../lib/api';
import { faDate, faNum } from '../lib/fa';

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  category?: string;
  read: boolean;
  created_at?: string;
}

interface InboxPayload {
  items: NotificationItem[];
}

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

/** مرکز اعلان‌ها — سطح خنثی یکسان برای خوانده و خوانده‌نشده + نقطهٔ خوانده‌نشده و عنوان پررنگ (NT1). */
export function NotificationsScreen() {
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await apiCall<InboxPayload>('/api/notifications/inbox');
      setItems(Array.isArray(res?.items) ? res.items : []);
    } catch (err) {
      setError(errorText(err, 'دریافت اعلان‌ها ممکن نشد.'));
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const markRead = async (ids: string[] | null) => {
    setItems((prev) =>
      (prev ?? []).map((i) => (ids === null || ids.includes(i.id) ? { ...i, read: true } : i)),
    );
    try {
      await apiCall('/api/notifications/inbox/read', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });
    } catch {
      void load();
    }
  };

  const list = items ?? [];
  const unreadCount = list.filter((i) => !i.read).length;
  const filtered = filter === 'unread' ? list.filter((i) => !i.read) : list;

  return (
    <>
      <AppBar
        title="مرکز اعلان‌ها"
        sub="پیام‌ها و اطلاعیه‌های سامانه"
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

        {items === null ? (
          <SkeletonStack rows={4} />
        ) : filtered.length === 0 ? (
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
