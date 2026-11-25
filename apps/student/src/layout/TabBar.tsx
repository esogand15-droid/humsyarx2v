import { NavLink } from 'react-router-dom';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/sprite';
import { tabSectionFor } from './section';

const TABS: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'خانه', icon: 'i-home' },
  { to: '/library', label: 'کتابخانه', icon: 'i-book' },
  { to: '/exam', label: 'بانک سؤال', icon: 'i-flask' },
  { to: '/schedule', label: 'برنامه', icon: 'i-calendar' },
  { to: '/me', label: 'من', icon: 'i-user' },
];

/** تببار پایین (DS v2 `.ds-tabbar`, audit G3): opaque bar with a blur where supported,
    safe-area insets, 48px targets. Each item carries its own `data-section`, so the active
    pill and label take that section's accent (library = resources, exam = qbank, …).
    NavLink sets aria-current="page" on the active item, which is what .ds-tabbar styles. */
export function TabBar() {
  return (
    <nav className="ds-tabbar ds-tabbar--blur app-tabbar" aria-label="ناوبری اصلی">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.to === '/'}
          className="ds-tabbar__item"
          data-section={tabSectionFor(t.to)}
        >
          <span className="ds-tabbar__icon" aria-hidden="true">
            <Icon name={t.icon} size={24} />
          </span>
          <span className="ds-tabbar__label">{t.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
