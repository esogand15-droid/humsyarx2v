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
      <div style={{ padding: '8px 16px 24px' }}>
        <p className="small color-muted mb-16">
          فهرست تمام دستگاه‌هایی که با این حساب کاربری وارد شده‌اند. می‌توانی دسترسی دستگاه‌های ناشناس را لغو کنی.
        </p>

        {error && (
          <p className="notice notice--warn mb-12" role="alert">
            {error}
          </p>
        )}

        {loading ? (
          <SkeletonStack rows={3} />
        ) : sessions.length === 0 ? (
          <div className="text-center py-20 small color-muted">هیچ نشست فعالی یافت نشد.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {sessions.map((sess) => (
              <div
                key={sess.session_id}
                className="card card--glass"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  padding: '12px 14px',
                  border: sess.is_current ? '1px solid rgba(0, 242, 254, 0.4)' : undefined,
                  boxShadow: sess.is_current ? '0 0 16px -4px rgba(0, 242, 254, 0.25)' : undefined,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      background: sess.is_current ? 'var(--brand-soft)' : 'var(--paper-3)',
                      color: sess.is_current ? 'var(--brand)' : 'var(--ink-2)',
                      display: 'grid',
                      placeItems: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Icon name="i-smartphone" size={20} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="h3" style={{ fontSize: '14px' }}>
                        {sess.device_name || 'مرورگر وب'}
                      </span>
                      {sess.is_current && <Chip variant="cyan">این دستگاه</Chip>}
                    </div>
                    <div className="tiny color-muted mt-4" style={{ direction: 'ltr', textAlign: 'right' }}>
                      IP: {sess.ip_address || '—'}
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
