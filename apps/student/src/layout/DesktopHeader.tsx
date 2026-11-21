import { useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../icons/Icon';
import { useTheme } from '../lib/theme';
import { useHeader } from './HeaderContext';
import { useSidebar } from './SidebarContext';
import { Brand } from '../components/Brand';
import { IconButton } from '../components/IconButton';

const ROUTE_TITLES: Record<string, string> = {
  '/': 'داشبورد دانشجو',
  '/library': 'کتابخانه آموزشی',
  '/exam': 'بانک سؤال و آزمون',
  '/me/notes': 'دفترچه یادداشت من',
  '/schedule': 'برنامه مطالعه',
  '/me': 'پروفایل و حساب کاربری',
  '/search': 'جستجوی سراسری',
  '/notifications': 'مرکز اعلان‌ها',
  '/system': 'سیستم دیزاین هامزیار',
  '/states': 'وضعیت‌های سیستمی',
};

export function DesktopHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const { resolved, setMode } = useTheme();
  const { header } = useHeader();
  const { collapsed, toggleSidebar } = useSidebar();

  const isHomeScreen = location.pathname === '/' || location.pathname === '/login';

  const defaultTitle =
    ROUTE_TITLES[location.pathname] ||
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
          <div className="desktop-header__title">{title}</div>
          {sub && <div className="desktop-header__sub">{sub}</div>}
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
          <span>جستجوی منابع، آزمون...</span>
          <kbd
            style={{
              marginInlineStart: 'auto',
              fontSize: '10px',
              padding: '2px 6px',
              borderRadius: '4px',
              background: 'var(--paper-3)',
              border: '1px solid var(--line)',
              fontFamily: 'var(--hym-font-mono)',
              color: 'var(--ink-3)',
            }}
          >
            ⌘K
          </kbd>
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
