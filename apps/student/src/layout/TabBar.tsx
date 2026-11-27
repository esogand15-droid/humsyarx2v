import type { CSSProperties } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Icon } from '../icons/Icon';
import { activeTabIndex, type NavEntry } from './nav';
import { tabSectionFor } from './section';

const TAB_DESTINATIONS: ReadonlyArray<NavEntry> = [
  { to: '/', label: 'خانه', shortLabel: 'خانه', icon: 'i-home', section: tabSectionFor('/') },
  { to: '/library', label: 'کتابخانه', shortLabel: 'کتابخانه', icon: 'i-book', section: tabSectionFor('/library') },
  { to: '/exam', label: 'بانک سؤال', shortLabel: 'آزمون', icon: 'i-flask', section: tabSectionFor('/exam') },
  { to: '/schedule', label: 'برنامه', shortLabel: 'برنامه', icon: 'i-calendar', section: tabSectionFor('/schedule') },
  { to: '/me', label: 'من', shortLabel: 'من', icon: 'i-user', section: tabSectionFor('/me') },
];

/** تببار پایین (DS v2 `.ds-tabbar`, audit G3; Liquid Glass layer in design/glass.css):
    a floating glass capsule on phones, safe-area insets, 44px+ targets. The lens slides
    under the active tab; each item keeps its own `data-section` for the icon and label accent.
    NavLink sets aria-current="page" on the active item, which is what .ds-tabbar styles. */
export function TabBar() {
  const { pathname } = useLocation();
  const active = activeTabIndex(pathname);
  const style = { '--lg-i': Math.max(active, 0), '--lg-count': TAB_DESTINATIONS.length } as CSSProperties;

  return (
    <nav className="ds-tabbar ds-tabbar--blur app-tabbar" aria-label="ناوبری اصلی" style={style}>
      <span className="lg-tabbar__lens" aria-hidden="true" data-hidden={active < 0 ? '' : undefined} />
      {TAB_DESTINATIONS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.to === '/'}
          className="ds-tabbar__item"
          data-section={t.section}
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
