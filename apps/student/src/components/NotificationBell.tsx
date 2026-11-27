import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Icon } from '../icons';
import { faNum } from '../lib/fa';
import { MOTION, usePresence } from '../lib/motion';
import {
  markNotificationsRead,
  useNotificationsState,
  type InboxNotification,
} from '../lib/notifications';

const PREVIEW = 4;

function ago(iso?: string): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return '';
  const min = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (min < 2) return 'همین حالا';
  if (min < 60) return `${faNum(min)} دقیقه پیش`;
  const h = Math.round(min / 60);
  if (h < 24) return `${faNum(h)} ساعت پیش`;
  return `${faNum(Math.round(h / 24))} روز پیش`;
}

/** زنگ اعلان‌ها: لمس، یک پاپاور جمع‌وجور با آخرین اعلان‌ها باز می‌کند؛
    شمارشگر از فروشگاه مشترک تغذیه می‌شود تا هدر دسکتاپ و موبایل درخواست تکراری نزنند. */
export function NotificationBell() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const popToken = useId();
  const pop = usePresence(open, MOTION.popover);
  const { items, unread, reloadInbox } = useNotificationsState();

  const load = useCallback(async () => {
    setError(false);
    try {
      await reloadInbox();
    } catch {
      setError(true);
    }
  }, [reloadInbox]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // تغییر مسیر پاپاور را می‌بندد.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    let popped = false;
    try {
      const curr = window.history.state && typeof window.history.state === 'object' ? window.history.state : {};
      window.history.pushState({ ...curr, _hyNotif: popToken }, '');
    } catch {
      /* ignore history unavailable */
    }
    const onPop = () => {
      const st = window.history.state as { _hyNotif?: string } | null;
      if (st?._hyNotif !== popToken) {
        popped = true;
        setOpen(false);
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      btnRef.current?.focus();
    };
    window.addEventListener('popstate', onPop);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      const st = window.history.state as { _hyNotif?: string } | null;
      if (!popped && st?._hyNotif === popToken) {
        try {
          window.history.back();
        } catch {
          /* ignore */
        }
      }
    };
  }, [open, popToken]);

  const list = items ?? [];
  const preview = list.slice(0, PREVIEW);

  const openItem = (n: InboxNotification) => {
    if (!n.read) {
      void markNotificationsRead([n.id]).catch(() => undefined);
    }
    setOpen(false);
    navigate('/notifications');
  };

  const goAll = () => {
    setOpen(false);
    navigate('/notifications');
  };

  return (
    <div className="notif-bell">
      <button
        ref={btnRef}
        type="button"
        className={`iconbtn iconbtn--relative${open ? ' is-active' : ''}`}
        aria-label={unread > 0 ? `اعلان‌ها، ${faNum(unread)} خوانده‌نشده` : 'اعلان‌ها'}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="اعلان‌ها"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="i-bell" size={18} />
        {unread > 0 && (
          <span key={unread} className="notif-bell__badge notif-badge-bump" aria-hidden="true">
            {unread > 99 ? `${faNum(99)}+` : faNum(unread)}
          </span>
        )}
      </button>

      {pop.mounted && (
        <>
          <div
            className="notif-pop-scrim"
            data-state={pop.state}
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div ref={popRef} className="notif-pop mo-popover" data-state={pop.state} role="dialog" aria-label="آخرین اعلان‌ها">
            <div className="notif-pop__head">
              <div className="notif-pop__head-lead">
                <span className="notif-pop__title">اعلان‌ها</span>
                {unread > 0 && <span className="notif-pop__count num">{`${faNum(unread)} تازه`}</span>}
              </div>
              {unread > 0 && (
                <button
                  type="button"
                  className="notif-pop__mark"
                  onClick={() => void markNotificationsRead(null).catch(() => undefined)}
                >
                  خواندن همه
                </button>
              )}
            </div>

            {items === null && !error ? (
              <div className="notif-pop__state" aria-busy="true">
                <span className="notif-pop__skel" />
                <span className="notif-pop__skel" />
              </div>
            ) : error && list.length === 0 ? (
              <div className="notif-pop__state">
                <p>دریافت اعلان‌ها ممکن نشد.</p>
                <button type="button" className="notif-pop__retry" onClick={() => void load()}>
                  تلاش دوباره
                </button>
              </div>
            ) : preview.length === 0 ? (
              <div className="notif-pop__state">
                <Icon name="i-bell" size={20} />
                <p>اعلان تازه‌ای ندارید.</p>
              </div>
            ) : (
              <ul className="notif-pop__list mo-stagger">
                {preview.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      className={`notif-pop__item${n.read ? '' : ' is-unread'}`}
                      onClick={() => openItem(n)}
                    >
                      <span className="notif-pop__dot" aria-hidden="true" />
                      <span className="notif-pop__body">
                        <span className="notif-pop__item-title">{n.title}</span>
                        {n.body && <span className="notif-pop__item-text">{n.body}</span>}
                        {n.created_at && <span className="notif-pop__time">{ago(n.created_at)}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <button type="button" className="notif-pop__all" onClick={goAll}>
              <span>همهٔ اعلان‌ها</span>
              <Icon name="i-chevron-r" size={16} className="notif-pop__all-chev" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
