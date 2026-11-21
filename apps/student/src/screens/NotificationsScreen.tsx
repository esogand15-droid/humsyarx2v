import { useState } from 'react';
import { AppBar } from '../components/AppBar';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../icons';

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  category: 'system' | 'exam' | 'edu';
  date: string;
  unread: boolean;
}

const INITIAL_NOTIFICATIONS: NotificationItem[] = [
  {
    id: 'n1',
    title: 'به‌روزرسانی بزرگ نسخه Wave 6',
    body: 'سیستم آزمون جامع (QBank)، دفترچه PDF با چیدمان استاندارد و دستیار هوشمند هوش‌یار به اپلیکیشن اضافه شدند.',
    category: 'system',
    date: 'امروز · ۱۰:۳۰',
    unread: true,
  },
  {
    id: 'n2',
    title: 'امتحان میان‌ترم فیزیولوژی اعصاب',
    body: 'طبق برنامه آموزشی دانشگاه، امتحان این درس در تاریخ پنج‌شنبه ۲۲ آبان‌ماه برگزار می‌شود.',
    category: 'exam',
    date: 'دیروز · ۱۶:۰۰',
    unread: true,
  },
  {
    id: 'n3',
    title: 'تحلیل بالینی تصاویر با هوش‌یار',
    body: 'از بخش گفت‌وگوی هوش‌یار می‌توانید تصاویر رادیولوژی و ECG را بارگذاری کرده و نکات آموزشی آن را دریافت کنید.',
    category: 'edu',
    date: '۲ روز پیش',
    unread: false,
  },
];

export function NotificationsScreen() {
  const [items, setItems] = useState<NotificationItem[]>(INITIAL_NOTIFICATIONS);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const filtered = filter === 'unread' ? items.filter((i) => i.unread) : items;

  const markAllRead = () => {
    setItems((prev) => prev.map((i) => ({ ...i, unread: false })));
  };

  const toggleItem = (id: string) => {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, unread: !i.unread } : i)),
    );
  };

  return (
    <>
      <AppBar
        title="مرکز اعلان‌ها"
        sub="پیام‌ها و اطلاعیه‌های سامانه"
        actions={
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={markAllRead}
            style={{ fontSize: 12 }}
          >
            خواندن همه
          </button>
        }
      />

      <div className="page">
        {/* فیلترها */}
        <div className="seg mt-8" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'all'}
            className={`seg__btn ${filter === 'all' ? 'is-on' : ''}`.trim()}
            onClick={() => setFilter('all')}
          >
            همه پیام‌ها ({items.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'unread'}
            className={`seg__btn ${filter === 'unread' ? 'is-on' : ''}`.trim()}
            onClick={() => setFilter('unread')}
          >
            خوانده‌نشده ({items.filter((i) => i.unread).length})
          </button>
        </div>

        {filtered.length === 0 ? (
          <div className="mt-20">
            <EmptyState
              icon="i-bell"
              title="اعلانی وجود ندارد"
              text="تمام اطلاعیه‌ها را خوانده‌اید."
            />
          </div>
        ) : (
          <div className="mt-16" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map((item) => (
              <Card
                key={item.id}
                onClick={() => toggleItem(item.id)}
                className="card--glass"
                style={{
                  cursor: 'pointer',
                  padding: '14px 16px',
                  borderInlineStart: item.unread ? '3px solid var(--hym-neon-cyan)' : undefined,
                  background: item.unread ? 'var(--paper-2)' : 'var(--paper-3)',
                }}
              >
                <div className="row row--between" style={{ alignItems: 'center' }}>
                  <div className="row gap-8" style={{ alignItems: 'center' }}>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: item.category === 'exam' ? 'var(--danger-soft)' : 'var(--cyan-soft)',
                        color: item.category === 'exam' ? 'var(--danger)' : 'var(--cyan)',
                        display: 'grid',
                        placeItems: 'center',
                      }}
                    >
                      <Icon name={item.category === 'exam' ? 'i-award' : 'i-bell'} size={18} />
                    </div>
                    <span className="h3" style={{ fontSize: 14.5 }}>{item.title}</span>
                  </div>
                  {item.unread && <Chip variant="cyan">جدید</Chip>}
                </div>
                <p className="body small mt-8" style={{ color: 'var(--ink)' }}>
                  {item.body}
                </p>
                <div className="tiny color-muted mt-8" style={{ direction: 'ltr', textAlign: 'right' }}>
                  {item.date}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
