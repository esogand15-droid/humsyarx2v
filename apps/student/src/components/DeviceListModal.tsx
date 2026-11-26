import { useEffect, useState } from 'react';
import { Sheet } from './Sheet';
import { Button } from './Button';
import { Chip } from './Chip';
import { SkeletonStack } from './Skeleton';
import { Icon } from '../icons';
import { api, errorText } from '../lib/api';
import type { UserSessionItem } from '../lib/api-types';

export function DeviceListModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [sessions, setSessions] = useState<UserSessionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const loadSessions = async () => {
    setLoading(true);
    setError('');
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
    if (open) {
      void loadSessions();
    }
  }, [open]);

  const handleRevoke = async (sessionId: string) => {
    setRevokingId(sessionId);
    try {
      await api.revokeSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
    } catch (err) {
      setError(errorText(err, 'لغو دسترسی دستگاه انجام نشد.'));
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="دستگاه‌های متصل">
      <div className="device-modal">
        <p className="device-modal__intro">
          فهرست تمام دستگاه‌هایی که با این حساب کاربری وارد شده‌اند. می‌توانی دسترسی دستگاه‌های ناشناس را لغو کنی.
        </p>

        {error && (
          <p className="notice notice--warn device-modal__error" role="alert">
            {error}
          </p>
        )}

        {loading ? (
          <SkeletonStack rows={3} />
        ) : sessions.length === 0 ? (
          <div className="device-modal__empty">هیچ نشست فعالی یافت نشد.</div>
        ) : (
          <div className="device-modal__list">
            {sessions.map((sess) => (
              <div
                key={sess.session_id}
                className={`card device-modal__row ${sess.is_current ? 'is-current' : ''}`}
              >
                <div className="device-modal__lead">
                  <div className="device-modal__icon" aria-hidden="true">
                    <Icon name="i-smartphone" size={20} />
                  </div>
                  <div className="device-modal__meta">
                    <div className="device-modal__title-row">
                      <span className="device-modal__name">
                        <bdi dir="auto">{sess.device_name || 'مرورگر وب'}</bdi>
                      </span>
                      {sess.is_current && <Chip variant="cyan">این دستگاه</Chip>}
                    </div>
                    <div className="device-modal__ip">
                      <span>نشانی IP: </span>
                      <bdi dir="ltr" className="num">
                        {sess.ip_address || '—'}
                      </bdi>
                    </div>
                  </div>
                </div>

                {!sess.is_current && (
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={revokingId === sess.session_id}
                    onClick={() => void handleRevoke(sess.session_id)}
                  >
                    لغو دسترسی
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}
