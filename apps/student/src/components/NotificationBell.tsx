import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Icon } from '../icons';
import { apiCall } from '../lib/api';
import { faNum } from '../lib/fa';
import { MOTION, usePresence } from '../lib/motion';

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  read: boolean;
  created_at?: string;
}

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

/** زنگ اعلانها: لمس، یک پاپاور جمعوجور با آخرین اعلانها باز میکند؛
    «همهٔ اعلانها» به صفحهٔ کامل میرود. نقطهٔ قرمز فقط وقتی اعلان خواندهنشده هست. */
export function NotificationBell() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const pop = usePresence(open, MOTION.popover);

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await apiCall<{ items: NotificationItem[] }>('/api/notifications/inbox');
      setItems(Array.isArray(res?.items) ? res.items : []);
    } catch {
      setError(true);
      setItems((prev) => prev ?? []);
    }
  }, []);

  // شمار خواندهنشدهها برای نقطهٔ زنگ؛ با هر بار باز شدن تازه میشود.
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // تغییر مسیر پاپاور را میبندد.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
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
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const list = items ?? [];
  const unread = list.filter((i) => !i.read).length;
  const preview = list.slice(0, PREVIEW);

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
        aria-label={unread > 0 ? `اعلانها، ${faNum(unread)} خواندهنشده` : 'اعلانها'}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="اعلانها"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="i-bell" size={18} />
        {unread > 0 && <span className="badge-dot badge-dot--cyan" aria-hidden="true" />}
      </button>

      {pop.mounted && (
        <div ref={popRef} className="notif-pop mo-popover" data-state={pop.state} role="dialog" aria-label="آخرین اعلانها">
          <div className="notif-pop__head">
            <span className="notif-pop__title">اعلانها</span>
            {unread > 0 && <span className="notif-pop__count">{`${faNum(unread)} تازه`}</span>}
          </div>

          {items === null ? (
            <div className="notif-pop__state" aria-busy="true">
              <span className="notif-pop__skel" />
              <span className="notif-pop__skel" />
            </div>
          ) : error && list.length === 0 ? (
            <div className="notif-pop__state">
              <p>دریافت اعلانها ممکن نشد.</p>
              <button type="button" className="notif-pop__retry" onClick={() => void load()}>
                تلاش دوباره
              </button>
            </div>
          ) : preview.length === 0 ? (
            <div className="notif-pop__state">
              <Icon name="i-bell" size={20} />
              <p>اعلان تازهای نداری.</p>
            </div>
          ) : (
            <ul className="notif-pop__list mo-stagger">
              {preview.map((n, i) => (
                <li key={n.id} style={{ '--i': i } as React.CSSProperties}>
                  <button type="button" className={`notif-pop__item${n.read ? '' : ' is-unread'}`} onClick={goAll}>
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
            <span>همهٔ اعلانها</span>
            <Icon name="i-chevron-r" size={16} className="notif-pop__all-chev" />
          </button>
        </div>
      )}
    </div>
  );
}
