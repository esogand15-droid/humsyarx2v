import { useCallback, useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
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

/** تببار پایین (DS v2 `.ds-tabbar`, Liquid Glass layer in design/glass.css):
    کپسول شناور شیشه‌ای در موبایل که عدسی فعال آن در چیدمان RTL روی آیتم انتخاب‌شده
    می‌لغزد و در مسیرهای خارج از تب‌های اصلی (مثل هوش مصنوعی) مخفی می‌شود. */
export function TabBar() {
  const { pathname } = useLocation();
  const active = activeTabIndex(pathname);
  const navRef = useRef<HTMLElement>(null);
  const readyRef = useRef(false);

  const measureLens = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    if (active < 0) {
      nav.dataset.lensReady = 'true';
      return;
    }
    const items = nav.querySelectorAll<HTMLElement>('.ds-tabbar__item');
    const el = items[active];
    if (!el || el.offsetWidth <= 0) return;
    const isRtl = getComputedStyle(nav).direction === 'rtl';
    const x = isRtl ? -(nav.clientWidth - (el.offsetLeft + el.offsetWidth)) : el.offsetLeft;
    nav.style.setProperty('--lg-lens-x', `${Math.round(x)}px`);
    nav.style.setProperty('--lg-lens-w', `${Math.round(el.offsetWidth)}px`);
    nav.dataset.lensReady = 'true';
    if (!readyRef.current) {
      readyRef.current = true;
      requestAnimationFrame(() => {
        if (navRef.current) navRef.current.dataset.lensAnim = 'true';
      });
    }
  }, [active]);

  useLayoutEffect(() => {
    measureLens();
  }, [measureLens]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measureLens()) : null;
    ro?.observe(nav);
    window.addEventListener('resize', measureLens);
    document.fonts?.ready.then(() => measureLens()).catch(() => {});
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measureLens);
    };
  }, [measureLens]);

  const style = { '--lg-i': Math.max(active, 0), '--lg-count': TAB_DESTINATIONS.length } as CSSProperties;

  return (
    <nav ref={navRef} className="ds-tabbar ds-tabbar--blur app-tabbar" aria-label="ناوبری اصلی" style={style}>
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
