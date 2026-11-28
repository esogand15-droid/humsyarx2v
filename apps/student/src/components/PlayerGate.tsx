/* مرز خطای سطح پخش‌کننده شناور — از کلاس (boundaryها hooks ندارند).
   اگر هر رندرِ پیل/ویجت شناور خطا بدهد، فقط خودش مخفی می‌شود؛ هرگز نباید
   یک خطای گذرای پیل، کل صفحه را به مرز خطای سراسری بفرستد (همان کرشی که
   هنگام برگشت از صفحهٔ ویس/ویدیو دیده می‌شد). خطا در کنسول هم لاگ می‌شود. */

import { Component, type ReactNode } from 'react';

interface GateProps {
  children: ReactNode;
}

interface GateState {
  failed: boolean;
}

export class PlayerGate extends Component<GateProps, GateState> {
  state: GateState = { failed: false };

  static getDerivedStateFromError(): GateState {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    // هیچ‌وقت سطح برنامه را نمی‌اندازد؛ فقط گزارش می‌کند
    console.error('[player] floating player hid itself after a render error', error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
