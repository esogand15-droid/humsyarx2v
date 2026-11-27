import type { ReactNode } from 'react';
import { TabBar } from './TabBar';
import { Sidebar } from './Sidebar';
import { DesktopHeader } from './DesktopHeader';
import { HeaderProvider } from './HeaderContext';
import { SidebarProvider } from './SidebarContext';
import type { DsSection } from '../design/components';

export type ShellVariant = 'default' | 'bare' | 'reader';

/**
 * پوستهٔ تطبیقی ۳ سطحی:
 * - موبایل (<768px): نوار تب پایین (TabBar)
 * - تبلت (768-1023px): ریل ناوبری فشرده + هدر بالا
 * - دسکتاپ (>=1024px): سایدبار راست (با قابلیت جمعشدن به ریل شناور) + هدر دسکتاپ + بوم محتوای عریض
 * - حالت خواندن (reader): بوم تمامعرض بدون کرومهای مزاحم
 *
 * `section` is the DS v2 role of the current route; it lands on the screen root
 * (`data-section`), so each screen re-themes without touching its own markup.
 */
export function Shell({
  children,
  tabs,
  variant = 'default',
  section = 'brand',
}: {
  children: ReactNode;
  tabs?: boolean;
  variant?: ShellVariant;
  section?: DsSection;
}) {
  const showNav = tabs ?? true;

  if (variant === 'reader') {
    return (
      <HeaderProvider>
        <SidebarProvider>
          <div className="app-shell app-shell--reader" data-section={section}>
            {children}
          </div>
        </SidebarProvider>
      </HeaderProvider>
    );
  }

  if (variant === 'bare') {
    return (
      <HeaderProvider>
        <SidebarProvider>
          <div className="app-shell app-shell--bare">{children}</div>
        </SidebarProvider>
      </HeaderProvider>
    );
  }

  return (
    <HeaderProvider>
      <SidebarProvider>
        <div className={`app-shell${showNav ? ' app-shell--nav' : ''}`}>
          {showNav && (
            <a className="skip-link" href="#main-content">
              پرش به محتوای اصلی
            </a>
          )}
          {showNav && <Sidebar />}
          <div className="main-stage">
            {showNav && <DesktopHeader />}
            <main id="main-content" tabIndex={-1} className="stage-content" data-section={section}>
              {children}
            </main>
            {showNav && <TabBar />}
          </div>
        </div>
      </SidebarProvider>
    </HeaderProvider>
  );
}
