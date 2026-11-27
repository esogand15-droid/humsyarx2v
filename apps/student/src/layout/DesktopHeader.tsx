import { useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../icons/Icon';
import { useTheme } from '../lib/theme';
import { useHeader } from './HeaderContext';
import { useSidebar } from './SidebarContext';
import { Brand } from '../components/Brand';
import { IconButton } from '../components/IconButton';
import { fallbackTitleFor } from './nav';

const PRIMARY_ROUTE_TITLES: Record<string, string> = {
  '/': 'داشبورد دانشجو',
  '/library': 'کتابخانه آموزشی',
};

export function DesktopHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const { resolved, setMode } = useTheme();
  const { header } = useHeader();
  const { collapsed, toggleSidebar } = useSidebar();

  const isHomeScreen = location.pathname === '/' || location.pathname === '/login';

  const defaultTitle =
    PRIMARY_ROUTE_TITLES[location.pathname] ||
    fallbackTitleFor(location.pathname) ||
    (location.pathname.startsWith('/library/')
      ? 'کتابخانه آموزشی'
      : location.pathname.startsWith('/read/')
        ? 'مطالعه جزوه'
        : 'هامزیار');

  const title = header.title || defaultTitle;
  const sub = header.sub;
  const showBack = Boolean(header.back);
  const handleBack = header.onBack ?? (() => navigate(-1));

  const toggleTheme = () => {
    setMode(resolved === 'dark' ? 'light' : 'dark');
  };

  // فیلتر کردن دکمه‌های تکراری در صفحهٔ خانه چون جستجو و اعلان در خود هدر وجود دارند
  const contextualActions = !isHomeScreen && header.actions ? header.actions : null;

  return (
    <header className="desktop-header" aria-label="سربرگ دسکتاپ">
      <div className="desktop-header__lead">
        <button
          type="button"
          className={`iconbtn desktop-header__sidebar-toggle ${collapsed ? 'is-active' : ''}`}
          onClick={toggleSidebar}
          title={collapsed ? 'گسترش منوی کناری (Ctrl+B)' : 'جمع کردن منو به ریل شناور (Ctrl+B)'}
          aria-label={collapsed ? 'گسترش منوی کناری' : 'جمع کردن منوی کناری'}
        >
          <Icon name="i-layers" size={17} />
        </button>
        {showBack && (
          <IconButton
            icon="i-chevron-r"
            label="بازگشت"
            onClick={handleBack}
            className="desktop-header__back"
          />
        )}
        <Brand size="sm" />
        <div className="desktop-header__titles">
          <h1 className="desktop-header__title">
            <bdi dir="auto">{title}</bdi>
          </h1>
          {sub && (
            <div className="desktop-header__sub">
              <bdi dir="auto">{sub}</bdi>
            </div>
          )}
        </div>
      </div>

      <div className="desktop-header__actions">
        {contextualActions && (
          <>
            <div className="desktop-header__context-actions">
              {contextualActions}
            </div>
            <div className="desktop-header__divider" aria-hidden="true" />
          </>
        )}

        <button
          type="button"
          className="desktop-header__search"
          onClick={() => navigate('/search')}
          aria-label="جستجو در محتوا و منابع"
        >
          <Icon name="i-search" size={16} />
          <span className="desktop-header__search-label">جستجوی منابع و آزمون…</span>
        </button>

        <button
          type="button"
          onClick={toggleTheme}
          className="iconbtn"
          aria-label={resolved === 'dark' ? 'تغییر به حالت روشن' : 'تغییر به حالت تاریک'}
          title={resolved === 'dark' ? 'حالت روشن' : 'حالت تاریک'}
        >
          <Icon name={resolved === 'dark' ? 'i-sun' : 'i-moon'} size={18} />
        </button>

        <button
          type="button"
          className="iconbtn iconbtn--relative"
          aria-label="اعلان‌ها"
          title="مرکز اعلان‌ها"
          onClick={() => navigate('/notifications')}
        >
          <Icon name="i-bell" size={18} />
          <span className="badge-dot badge-dot--cyan" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
