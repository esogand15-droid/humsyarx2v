import { useEffect, useState } from 'react';
import { Sheet } from './Sheet';
import { Chip } from './Chip';
import { SkeletonStack } from './Skeleton';
import { DsButton } from '../design/components';
import { Icon } from '../icons';
import type { IconName } from '../icons';
import { api, errorText } from '../lib/api';
import type { UserSessionItem } from '../lib/api-types';
import { faDigits } from '../lib/fa';
import { prefersReducedMotion } from '../lib/motion';

/** «۵ دقیقه پیش» / «۳ روز پیش» از زمان ISO؛ ورودی نامعتبر → «نامشخص». */
function lastActiveLabel(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return 'نامشخص';
  const min = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (min < 2) return 'همین حالا';
  if (min < 60) return `${faDigits(String(min))} دقیقه پیش`;
  const h = Math.round(min / 60);
  if (h < 24) return `${faDigits(String(h))} ساعت پیش`;
  return `${faDigits(String(Math.round(h / 24)))} روز پیش`;
}

function deviceIconFor(sess: UserSessionItem): IconName {
  if (sess.device_type === 'tablet') return 'i-tablet';
  if (sess.device_type === 'desktop') return 'i-monitor';
  if (sess.device_type === 'mobile' || sess.device_type === 'telegram') return 'i-smartphone';
  const lower = (sess.device_name || '').toLowerCase();
  if (lower.includes('ipad') || lower.includes('tablet')) return 'i-tablet';
  if (lower.includes('windows') || lower.includes('mac') || lower.includes('linux') || lower.includes('chromebook')) {
    return 'i-monitor';
  }
  return 'i-smartphone';
}

export function DeviceListPanel({ active }: { active: boolean }) {
  const [sessions, setSessions] = useState<UserSessionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const loadSessions = async () => {
    setLoading(true);
    setError('');
    setConfirmId(null);
    try {
      const res = await api.getSessions();
      setSessions(res.sessions || []);
    } catch (err) {
      setError(errorText(err, 'دریافت فهرست دستگاه‌ها با خطا مواجه شد.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (active) {
      void loadSessions();
    }
  }, [active]);

  const handleRevoke = async (sessionId: string) => {
    setRevokingId(sessionId);
    setError('');
    try {
      await api.revokeSession(sessionId);
      setConfirmId(null);
      if (prefersReducedMotion()) {
        setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
      } else {
        setRemovingId(sessionId);
        window.setTimeout(() => {
          setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
          setRemovingId((curr) => (curr === sessionId ? null : curr));
        }, 220);
      }
    } catch (err) {
      setError(errorText(err, 'لغو دسترسی دستگاه انجام نشد.'));
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className="device-modal">
      <p className="device-modal__intro">
        فهرست تمام دستگاه‌هایی که با این حساب وارد شده‌اند. می‌توانید دسترسی دستگاه‌های دیگر را لغو کنید.
      </p>

      {error && (
        <div className="notice notice--warn device-modal__error" role="alert">
          <span>{error}</span>
          <DsButton variant="ghost" size="sm" onClick={() => void loadSessions()}>
            تلاش دوباره
          </DsButton>
        </div>
      )}

      {loading ? (
        <SkeletonStack rows={3} />
      ) : sessions.length === 0 ? (
        <div className="device-modal__empty">هیچ نشست فعالی یافت نشد.</div>
      ) : (
        <div className="device-modal__list">
          {sessions.map((sess) => {
            const isRemoving = removingId === sess.session_id;
            const isConfirming = confirmId === sess.session_id;
            return (
              <div
                key={sess.session_id}
                className={`card device-modal__row${sess.is_current ? ' is-current' : ''}${isRemoving ? ' is-removing' : ''}`}
              >
                <div className="device-modal__lead">
                  <div className="device-modal__icon" aria-hidden="true">
                    <Icon name={deviceIconFor(sess)} size={20} />
                  </div>
                  <div className="device-modal__meta">
                    <div className="device-modal__title-row">
                      <span className="device-modal__name">
                        <bdi dir="auto">{sess.device_name || 'مرورگر وب'}</bdi>
                      </span>
                      {sess.is_current && <Chip variant="cyan">این دستگاه</Chip>}
                    </div>
                    {!sess.is_current && (
                      <div className="device-modal__ip">آخرین فعالیت: {lastActiveLabel(sess.last_active)}</div>
                    )}
                  </div>
                </div>

                {!sess.is_current && (
                  <div className="device-modal__actions">
                    {isConfirming ? (
                      <div className="device-modal__confirm">
                        <DsButton
                          variant="danger"
                          size="sm"
                          disabled={revokingId === sess.session_id}
                          onClick={() => void handleRevoke(sess.session_id)}
                        >
                          {revokingId === sess.session_id ? 'در حال لغو…' : 'تأیید لغو'}
                        </DsButton>
                        <DsButton
                          variant="ghost"
                          size="sm"
                          disabled={revokingId === sess.session_id}
                          onClick={() => setConfirmId(null)}
                        >
                          انصراف
                        </DsButton>
                      </div>
                    ) : (
                      <DsButton
                        variant="ghost"
                        size="sm"
                        disabled={revokingId !== null || isRemoving}
                        onClick={() => setConfirmId(sess.session_id)}
                      >
                        لغو دسترسی
                      </DsButton>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function DeviceListModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="دستگاه‌های متصل" size="compact">
      <DeviceListPanel active={open} />
    </Sheet>
  );
}
