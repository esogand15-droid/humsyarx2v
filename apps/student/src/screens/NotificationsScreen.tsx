import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import './account.css';
import { AppBar, SkeletonStack, Switch, Toast } from '../components';
import { DsBadge, DsButton, DsCard, DsEmpty, DsSegmented } from '../design/components';
import { Icon } from '../icons';
import { errorText } from '../lib/api';
import { faDate, faNum } from '../lib/fa';
import {
  deleteInboxNotification,
  markNotificationsRead,
  notifSettingsApi,
  pinInboxNotification,
  useNotificationsState,
  type InboxNotification,
  type NotificationSettingItem,
} from '../lib/notifications';

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

function notifKind(item: InboxNotification): 'exam' | 'content' | 'general' {
  const cat = (item.category || '').toLowerCase();
  if (cat.includes('exam') || item.title.includes('آزمون')) return 'exam';
  if (cat.includes('content') || cat.includes('library') || item.title.includes('جزوه')) {
    return 'content';
  }
  return 'general';
}

/** مرکز اعلان‌ها و تنظیمات دسته‌های اعلان سامانه */
export function NotificationsScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') === 'settings' ? 'settings' : 'inbox';
  const [section, setSection] = useState<'inbox' | 'settings'>(initialTab);

  const { items, unread: unreadCount, reloadInbox } = useNotificationsState({ loadInbox: true });
  const [filter, setFilter] = useState<'all' | 'unread' | 'pinned'>('all');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const [settings, setSettings] = useState<NotificationSettingItem[] | null>(null);
  const [settingsErr, setSettingsErr] = useState('');
  const [busyAll, setBusyAll] = useState(false);

  useEffect(() => {
    if (!toast) return undefined;
    const t = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(t);
  }, [toast]);

  const loadInbox = useCallback(async () => {
    setError('');
    try {
      await reloadInbox();
    } catch (err) {
      setError(errorText(err, 'دریافت اعلان‌ها ممکن نشد.'));
    }
  }, [reloadInbox]);

  const loadSettings = useCallback(async () => {
    setSettingsErr('');
    try {
      const res = await notifSettingsApi.get();
      setSettings(res.settings || []);
    } catch (err) {
      setSettingsErr(errorText(err, 'دریافت تنظیمات اعلان‌ها ناموفق بود.'));
    }
  }, []);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  useEffect(() => {
    if (section === 'settings' && settings === null) {
      void loadSettings();
    }
  }, [section, settings, loadSettings]);

  const switchSection = (next: 'inbox' | 'settings') => {
    setSection(next);
    setSearchParams(next === 'settings' ? { tab: 'settings' } : {}, { replace: true });
  };

  const markRead = async (ids: string[] | null) => {
    try {
      await markNotificationsRead(ids);
    } catch (err) {
      setToast(errorText(err, 'بروزرسانی وضعیت خوانده‌شده ناموفق بود.'));
      void loadInbox();
    }
  };

  const togglePin = async (item: InboxNotification) => {
    try {
      await pinInboxNotification(item.id, !item.pinned);
      setToast(!item.pinned ? 'اعلان سنجاق شد.' : 'سنجاق اعلان برداشته شد.');
    } catch (err) {
      setToast(errorText(err, 'تغییر سنجاق ناموفق بود.'));
    }
  };

  const removeNotif = async (item: InboxNotification) => {
    try {
      await deleteInboxNotification(item.id);
      setToast('اعلان حذف شد.');
    } catch (err) {
      setToast(errorText(err, 'حذف اعلان ناموفق بود.'));
    }
  };

  const togglePref = async (key: string, nextVal: boolean) => {
    setSettings((prev) =>
      prev ? prev.map((s) => (s.key === key ? { ...s, enabled: nextVal } : s)) : prev,
    );
    try {
      await notifSettingsApi.update({ [key]: nextVal });
    } catch (err) {
      setToast(errorText(err, 'ذخیره تنظیمات ناموفق بود.'));
      void loadSettings();
    }
  };

  const toggleAllPrefs = async (enabled: boolean) => {
    setBusyAll(true);
    try {
      await notifSettingsApi.toggleAll(enabled);
      setSettings((prev) => (prev ? prev.map((s) => ({ ...s, enabled })) : prev));
      setToast(enabled ? 'همه دسته‌های اعلان روشن شدند.' : 'همه دسته‌های اعلان خاموش شدند.');
    } catch (err) {
      setToast(errorText(err, 'تغییر گروهی اعلان‌ها ناموفق بود.'));
    } finally {
      setBusyAll(false);
    }
  };

  const list = items ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = list.filter((i) => {
      if (filter === 'unread' && i.read) return false;
      if (filter === 'pinned' && !i.pinned) return false;
      if (q && !`${i.title} ${i.body}`.toLowerCase().includes(q)) return false;
      return true;
    });
    return [...base].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
  }, [list, filter, query]);

  return (
    <>
      <AppBar
        title="اعلان‌ها و تنظیمات"
        sub="صندوق پیام‌های سامانه و کنترل دسته‌های اطلاع‌رسانی"
        back
        actions={
          section === 'inbox' && unreadCount > 0 ? (
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
          label="بخش‌های اعلان"
          value={section}
          onChange={switchSection}
          options={[
            { value: 'inbox', label: `صندوق پیام (${faNum(list.length)})` },
            { value: 'settings', label: 'تنظیمات اطلاع‌رسانی' },
          ]}
        />

        {section === 'inbox' ? (
          <>
            <DsSegmented
              block
              label="فیلتر اعلان‌ها"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: `همه (${faNum(list.length)})` },
                { value: 'unread', label: `خوانده‌نشده (${faNum(unreadCount)})` },
                { value: 'pinned', label: `سنجاق‌شده (${faNum(list.filter((i) => i.pinned).length)})` },
              ]}
            />

            <input
              type="search"
              className="ds-input"
              placeholder="جست‌وجو در عنوان یا متن اعلان‌ها…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />

            {error && (
              <DsCard>
                <div className="acct-notice acct-notice--danger" role="alert">
                  <div className="acct-notice__lead">
                    <Icon name="i-alert-circle" size={18} />
                    <span>{error}</span>
                  </div>
                  <DsButton variant="secondary" size="md" onClick={() => void loadInbox()}>
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
                  title="اعلانی در این فیلتر نیست"
                  body={
                    filter === 'unread'
                      ? 'همه اعلان‌ها را خوانده‌اید.'
                      : 'موردی مطابق فیلتر فعلی پیدا نشد.'
                  }
                  action={
                    (filter !== 'all' || query) && list.length > 0 ? (
                      <DsButton
                        variant="secondary"
                        onClick={() => {
                          setFilter('all');
                          setQuery('');
                        }}
                      >
                        نمایش همه پیام‌ها
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

                  return (
                    <DsCard
                      key={item.id}
                      className={`acct-notif-card${!item.read ? ' is-unread' : ''}`}
                    >
                      <div className="acct-notif-head" style={{ justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
                        {item.pinned && <DsBadge tone="accent">سنجاق</DsBadge>}
                      </div>

                      {item.body && <p className="acct-notif-body">{item.body}</p>}

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                          flexWrap: 'wrap',
                          marginTop: 6,
                        }}
                      >
                        <span className="acct-notif-time">
                          {item.created_at ? formatNotifTime(item.created_at) : ''}
                        </span>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {!item.read && (
                            <DsButton variant="ghost" size="sm" onClick={() => void markRead([item.id])}>
                              خوانده شد
                            </DsButton>
                          )}
                          <DsButton variant="ghost" size="sm" onClick={() => void togglePin(item)}>
                            <Icon name="i-pin" size={14} />
                            <span>{item.pinned ? 'برداشتن سنجاق' : 'سنجاق'}</span>
                          </DsButton>
                          <DsButton variant="ghost" size="sm" onClick={() => void removeNotif(item)}>
                            <Icon name="i-trash" size={14} />
                          </DsButton>
                        </div>
                      </div>
                    </DsCard>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <DsCard level="sunken" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div>
                <h3 className="ds-card__title" style={{ margin: 0 }}>تنظیم سریع همه دسته‌ها</h3>
                <p className="ds-card__sub" style={{ margin: '4px 0 0' }}>
                  همه ۱۶ دسته اعلان بین وب‌اپ و سامانه یکپارچه اعمال می‌شوند.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <DsButton variant="secondary" size="sm" disabled={busyAll} onClick={() => void toggleAllPrefs(true)}>
                  روشن کردن همه
                </DsButton>
                <DsButton variant="ghost" size="sm" disabled={busyAll} onClick={() => void toggleAllPrefs(false)}>
                  خاموش کردن همه
                </DsButton>
              </div>
            </DsCard>

            {settingsErr && (
              <DsCard>
                <p style={{ color: 'var(--danger)', margin: 0 }}>{settingsErr}</p>
                <div style={{ marginTop: 8 }}>
                  <DsButton variant="secondary" size="sm" onClick={() => void loadSettings()}>
                    تلاش دوباره
                  </DsButton>
                </div>
              </DsCard>
            )}

            {settings === null && !settingsErr ? (
              <SkeletonStack rows={5} />
            ) : (
              <DsCard flush>
                <div className="ds-list">
                  {(settings || []).map((s) => (
                    <div key={s.key} className="ds-row">
                      <div className="ds-row__body">
                        <span className="ds-row__title">{s.label}</span>
                        {s.desc && <span className="ds-row__sub">{s.desc}</span>}
                      </div>
                      <Switch
                        checked={s.enabled}
                        label={s.label}
                        onChange={(v) => void togglePref(s.key, v)}
                      />
                    </div>
                  ))}
                </div>
              </DsCard>
            )}
          </div>
        )}
      </div>

      <Toast message={toast} />
    </>
  );
}
