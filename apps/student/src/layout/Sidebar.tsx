import { NavLink } from 'react-router-dom';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/sprite';
import { Brand } from '../components/Brand';
import { useSession } from '../lib/session';
import { useTheme } from '../lib/theme';
import { useSidebar } from './SidebarContext';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'خانه', icon: 'i-home' },
  { to: '/library', label: 'کتابخانه', icon: 'i-book' },
  { to: '/exam', label: 'بانک سؤال', icon: 'i-flask' },
  { to: '/ai', label: 'هوش‌یار پزشکی', icon: 'i-chat' },
  { to: '/grades', label: 'کارنامه و معدل', icon: 'i-award' },
  { to: '/schedule', label: 'برنامه مطالعه', icon: 'i-calendar' },
  { to: '/me/notes', label: 'دفترچه من', icon: 'i-pen' },
  { to: '/me', label: 'پروفایل و حساب', icon: 'i-user' },
];

export function Sidebar() {
  const { user } = useSession();
  const { resolved, setMode } = useTheme();
  const { collapsed, toggleSidebar } = useSidebar();

  const toggleTheme = () => {
    setMode(resolved === 'dark' ? 'light' : 'dark');
  };

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
                <span className="sidebar__sub">HUMSYARX · هوش پزشکی</span>
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
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => `sidebar__link ${isActive ? 'active' : ''}`}
            title={item.label}
            aria-label={item.label}
          >
            <Icon name={item.icon} size={20} />
            <span className="sidebar__label">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar__footer">
        <NavLink
          to="/me"
          className="sidebar__user"
          title={collapsed ? `${user?.name || 'دانشجو'} · حساب کاربری` : undefined}
        >
          <div className="sidebar__avatar">{initial}</div>
          <div className="sidebar__user-details">
            <span className="sidebar__user-name">{user?.name || 'دانشجو'}</span>
            <span className="sidebar__user-role">{user?.student_id || 'حساب کاربری'}</span>
          </div>
        </NavLink>

        <button
          type="button"
          onClick={toggleTheme}
          className="iconbtn sidebar__theme-btn"
          aria-label={resolved === 'dark' ? 'حالت روشن' : 'حالت تاریک'}
          title={resolved === 'dark' ? 'حالت روشن' : 'حالت تاریک'}
        >
          <Icon name={resolved === 'dark' ? 'i-sun' : 'i-moon'} size={18} />
        </button>
      </div>
    </aside>
  );
}
