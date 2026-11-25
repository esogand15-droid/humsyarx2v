import { useCallback, useEffect, useState } from 'react';
import { AppBar } from '../components/AppBar';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import { SkeletonStack } from '../components';
import { Icon } from '../icons';
import { apiCall, errorText } from '../lib/api';

/* صندوق اعلان واقعی — همان /api/notifications/inbox که مینی‌اپ و ربات
   می‌نویسند (کوکی نشست وب را هم می‌پذیرد). قبلاً سه اعلان ساختگی با
   تاریخ امتحان جعلی به همهٔ دانشجوها نشان داده می‌شد. */
interface InboxItem {
  id: string;
  type: string;
  title: string;
  body: string;
  link?: string | null;
  read: boolean;
  created_at: string;
  category?: string;
  tone?: string;
  pinned?: boolean;
}

interface InboxPayload {
  items: InboxItem[];
  unread: number;
}

function when(iso: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('fa-IR', {
    timeZone: 'Asia/Tehran', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

const isExam = (i: InboxItem) => i.category === 'exam' || i.type.includes('exam');

export function NotificationsScreen() {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

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
    setItems((prev) => (prev ?? []).map((i) => (ids === null || ids.includes(i.id) ? { ...i, read: true } : i)));
    try {
      await apiCall('/api/notifications/inbox/read', { method: 'POST', body: JSON.stringify({ ids }) });
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
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => void markRead(null)}
              style={{ fontSize: 12 }}
            >
              خواندن همه
            </button>
          ) : undefined
        }
      />

      <div className="page">
        <div className="seg mt-8" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'all'}
            className={`seg__btn ${filter === 'all' ? 'is-on' : ''}`.trim()}
            onClick={() => setFilter('all')}
          >
            همه پیام‌ها ({list.length.toLocaleString('fa-IR')})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'unread'}
            className={`seg__btn ${filter === 'unread' ? 'is-on' : ''}`.trim()}
            onClick={() => setFilter('unread')}
          >
            خوانده‌نشده ({unreadCount.toLocaleString('fa-IR')})
          </button>
        </div>

        {error && (
          <p className="notice notice--warn mt-12" role="alert">
            {error}{' '}
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => void load()}>
              تلاش دوباره
            </button>
          </p>
        )}

        {items === null ? (
          <div className="mt-16">
            <SkeletonStack />
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-20">
            <EmptyState
              icon="i-bell"
              title="اعلانی وجود ندارد"
              text={filter === 'unread' ? 'همهٔ اعلان‌ها را خوانده‌اید.' : 'هنوز اعلانی برای شما ثبت نشده است.'}
            />
          </div>
        ) : (
          <div className="mt-16" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map((item) => (
              <Card
                key={item.id}
                onClick={() => (item.read ? undefined : void markRead([item.id]))}
                className="card--glass"
                style={{
                  cursor: item.read ? 'default' : 'pointer',
                  padding: '14px 16px',
                  borderInlineStart: item.read ? undefined : '3px solid var(--hym-neon-cyan)',
                  background: item.read ? 'var(--paper-3)' : 'var(--paper-2)',
                }}
              >
                <div className="row row--between" style={{ alignItems: 'center' }}>
                  <div className="row gap-8" style={{ alignItems: 'center' }}>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: isExam(item) ? 'var(--danger-soft)' : 'var(--cyan-soft)',
                        color: isExam(item) ? 'var(--danger)' : 'var(--cyan)',
                        display: 'grid',
                        placeItems: 'center',
                      }}
                    >
                      <Icon name={isExam(item) ? 'i-award' : 'i-bell'} size={18} />
                    </div>
                    <span className="h3" style={{ fontSize: 14.5 }}>{item.title}</span>
                  </div>
                  {!item.read && <Chip variant="cyan">جدید</Chip>}
                </div>
                {item.body && (
                  <p className="body small mt-8" style={{ color: 'var(--ink)', whiteSpace: 'pre-line' }}>
                    {item.body}
                  </p>
                )}
                <div className="tiny color-muted mt-8">{when(item.created_at)}</div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
