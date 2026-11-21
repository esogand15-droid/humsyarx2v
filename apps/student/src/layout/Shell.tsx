import type { ReactNode } from 'react';
import { TabBar } from './TabBar';
import { Sidebar } from './Sidebar';
import { DesktopHeader } from './DesktopHeader';
import { HeaderProvider } from './HeaderContext';
import { SidebarProvider } from './SidebarContext';

export type ShellVariant = 'default' | 'bare' | 'reader';

/**
 * پوستهٔ تطبیقی ۳ سطحی:
 * - موبایل (<768px): نوار تب پایین (TabBar)
 * - تبلت (768-1023px): ریل ناوبری فشرده + محتوای تطبیقی
 * - دسکتاپ (>=1024px): سایدبار راست (با قابلیت جمع‌شدن به ریل شناور) + هدر دسکتاپ + بوم محتوای عریض
 * - حالت خواندن (reader): بوم تمام‌عرض بدون کروم‌های مزاحم
 */
export function Shell({
  children,
  tabs,
  variant = 'default',
}: {
  children: ReactNode;
  tabs?: boolean;
  variant?: ShellVariant;
}) {
  const showNav = tabs ?? true;

  if (variant === 'reader') {
    return (
      <HeaderProvider>
        <SidebarProvider>
          <div className="app-shell app-shell--reader">{children}</div>
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
        <div className="app-shell">
          {showNav && <Sidebar />}
          <div className="main-stage">
            {showNav && <DesktopHeader />}
            <main className="stage-content">{children}</main>
            {showNav && <TabBar />}
          </div>
        </div>
      </SidebarProvider>
    </HeaderProvider>
  );
}

