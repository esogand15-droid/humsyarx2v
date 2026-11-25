import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import './design/tokens.css';
import './design/base.css';
import './design/brand.css';
import './design/ui.css';
import './design/components.css';

import { App } from './App';
import { IconSprite } from './icons';
import { SessionProvider } from './lib/session';
import { ThemeProvider } from './lib/theme';

const rawBase = import.meta.env.BASE_URL || '/student';
const basename = rawBase.endsWith('/') && rawBase !== '/' ? rawBase.slice(0, -1) : rawBase;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <IconSprite />
      <BrowserRouter basename={basename}>
        <SessionProvider>
          <App />
        </SessionProvider>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);

/** ثبت Service Worker — PWA install experience
 *  - در production فقط (dev و test: SW را نمی‌بندیم تا بیلد پیشین shadow نشود).
 *  - مسیریابی: base از VITE_BASE یا /student/ خوانده می‌شود؛ SW در ریشهٔ base قرار دارد.
 *  - skipWaiting + clients.claim توسط خود SW انجام می‌شود.
 *  - اگر مرورگر SW را پشتیبانی نمی‌کند (مثلاً Safari قدیمی)، خطا را log می‌کنیم
 *    و ادامه می‌دهیم (app باید بدون SW هم کار کند). */
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && import.meta.env.PROD) {
  const swUrl = new URL('sw.js', window.location.origin + (import.meta.env.BASE_URL || '/student/')).toString();
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(swUrl, { scope: import.meta.env.BASE_URL || '/student/' })
      .then((registration) => {
        // به‌روزرسانی خودکار: وقتی نسخهٔ جدید SW در دسترس شد، prompt برای فعال‌سازی
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.info('[SW] New version available. Will update on reload.');
            }
          });
        });
      })
      .catch((err) => {
        console.warn('[SW] Registration failed:', err);
      });
  });
}

