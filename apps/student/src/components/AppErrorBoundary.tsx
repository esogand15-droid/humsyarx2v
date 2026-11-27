import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

import { DsButton } from '../design/components';
import { Icon } from '../icons/Icon';
import { isChunkLoadError, recoverFromStaleBuild } from '../lib/swUpdate';

interface BoundaryProps {
  resetKey: string;
  children: ReactNode;
}

interface BoundaryState {
  error: Error | null;
  /** null = هنوز تصمیم نگرفتهایم؛ true = ریلود بازیابی در جریان است؛ false = بازیابی ممکن نیست. */
  recovering: boolean | null;
}

class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, recovering: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error, recovering: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // چانک نسخهٔ قبلی بعد از دیپلوی حذف شده: صفحهٔ بهروزرسانی + یک ریلود تمیز.
    if (isChunkLoadError(error) && recoverFromStaleBuild()) {
      this.setState({ recovering: true });
      return;
    }
    this.setState({ recovering: false });
    console.error('[app] render error', error, info.componentStack);
  }

  componentDidUpdate(prev: BoundaryProps) {
    if (prev.resetKey !== this.props.resetKey && this.state.error && this.state.recovering === false) {
      this.setState({ error: null, recovering: null });
    }
  }

  render() {
    const { error, recovering } = this.state;
    if (!error) return this.props.children;
    // صفحهٔ بهروزرسانی (در پورتال) روی همه چیز است؛ زیرش چیزی نمیکشیم.
    if (recovering !== false) return null;

    const chunk = isChunkLoadError(error);
    const home = (import.meta.env.BASE_URL || '/student/').replace(/\/?$/, '/');

    return (
      <div className="page ds-crash" role="alert">
        <div className="ds-card ds-crash__card">
          <span className="ds-crash__icon" aria-hidden="true">
            <Icon name={chunk ? 'i-refresh' : 'i-alert-circle'} size={28} />
          </span>
          <h2 className="ds-crash__title">
            {chunk ? 'این بخش بارگذاری نشد' : 'مشکلی در نمایش این صفحه پیش آمد'}
          </h2>
          <p className="ds-crash__text">
            {chunk
              ? 'اتصال اینترنت را بررسی کنید و دوباره تلاش کنید. اگر برنامه تازه به‌روز شده، بارگذاری دوباره مشکل را حل می‌کند.'
              : 'اطلاعات شما سالم است. صفحه را دوباره بارگذاری کنید یا به صفحهٔ اصلی برگردید.'}
          </p>
          <div className="ds-crash__actions">
            <DsButton onClick={() => window.location.reload()}>
              <Icon name="i-refresh" size={18} />
              بارگذاری دوباره
            </DsButton>
            <DsButton variant="ghost" onClick={() => window.location.assign(home)}>
              صفحهٔ اصلی
            </DsButton>
          </div>
        </div>
      </div>
    );
  }
}

/**
 * مرز خطای سراسری: خطای بارگذاری چانک (پس از دیپلوی) را بیصدا با ریلود بازیابی میکند
 * و برای خطاهای واقعی به جای صفحهٔ سفید یک کارت قابل بازیابی نشان میدهد.
 * با تغییر مسیر ریست میشود تا کاربر با یک ناوبری از خطا بیرون بیاید.
 */
export function AppErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <Boundary resetKey={pathname}>{children}</Boundary>;
}
