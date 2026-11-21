import { NavLink } from 'react-router-dom';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/sprite';

const TABS: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'خانه', icon: 'i-home' },
  { to: '/library', label: 'کتابخانه', icon: 'i-book' },
  { to: '/exam', label: 'بانک سؤال', icon: 'i-flask' },
  { to: '/schedule', label: 'برنامه', icon: 'i-calendar' },
  { to: '/me', label: 'من', icon: 'i-user' },
];

/** تب‌بار پایین — پنج ناحیهٔ سطح اول با شاخص فعال و safe-area insets */
export function TabBar() {
  return (
    <nav className="tabbar" aria-label="ناوبری اصلی">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.to === '/'}
          className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}
        >
          <div className="tab__icon-wrap">
            <Icon name={t.icon} size={22} />
            <span className="tab__indicator" aria-hidden="true" />
          </div>
          <span className="tab__label">{t.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
