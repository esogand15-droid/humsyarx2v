import { NavLink } from 'react-router-dom';
import { Icon } from '../icons/Icon';
import { Brand } from '../components/Brand';
import { faDigits } from '../lib/fa';
import { useSession } from '../lib/session';
import { SIDEBAR_ITEMS } from './nav';
import { useSidebar } from './SidebarContext';

export function Sidebar() {
  const { user } = useSession();
  const { collapsed, toggleSidebar } = useSidebar();

  const initial = (user?.name || user?.username || 'د').trim().charAt(0) || 'هـ';

  return (
    <aside
      className={`sidebar ${collapsed ? 'sidebar--collapsed is-collapsed' : ''}`}
      aria-label="ناوبری اصلی دسکتاپ"
    >
      <div className="sidebar__header">
        {collapsed ? (
          <button
            type="button"
            className="sidebar__brand-rail-btn"
            onClick={toggleSidebar}
            title="گسترش منوی کناری (Ctrl+B)"
            aria-label="گسترش منوی کناری"
          >
            <Brand size="sm" />
            <span className="sidebar__rail-expand-badge" aria-hidden="true">
              <Icon name="i-chevron" size={12} />
            </span>
          </button>
        ) : (
          <>
            <div className="sidebar__brand-row">
              <Brand size="sm" />
              <div className="sidebar__brand-text">
                <div className="brand-wordmark">
                  <span className="hums">هامز</span>
                  <span className="yar">یار</span>
                </div>
                <span className="sidebar__sub">دستیار هوشمند پزشکی</span>
              </div>
            </div>

            <button
              type="button"
              className="sidebar__collapse-toggle"
              onClick={toggleSidebar}
              title="جمع کردن منو به ریل شناور (Ctrl+B)"
              aria-label="جمع کردن منوی کناری"
            >
              <Icon name="i-chevron-r" size={16} />
            </button>
          </>
        )}
      </div>

      <nav className="sidebar__nav">
        {SIDEBAR_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            // '/me' must not match '/me/notes', or «دفترچه من» and «پروفایل» light up together
            end={item.to === '/' || item.to === '/me'}
            data-section={item.section}
            className={({ isActive }) => `sidebar__link ${isActive ? 'active' : ''}`}
            title={item.label}
            aria-label={item.label}
          >
            <Icon name={item.icon} size={20} />
            <span className="sidebar__label">{item.label}</span>
            <span className="sidebar__rail-label" aria-hidden="true">{item.shortLabel}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar__footer">
        <NavLink
          to="/me"
          end
          className="sidebar__user"
          title={collapsed ? `${user?.name || 'دانشجو'} · حساب کاربری` : undefined}
        >
          <div className="sidebar__avatar">{initial}</div>
          <div className="sidebar__user-details">
            <span className="sidebar__user-name">
              <bdi dir="auto">{user?.name || 'دانشجو'}</bdi>
            </span>
            <span className="sidebar__user-role num">
              {user?.student_id ? faDigits(user.student_id) : 'حساب کاربری'}
            </span>
          </div>
        </NavLink>
      </div>
    </aside>
  );
}
