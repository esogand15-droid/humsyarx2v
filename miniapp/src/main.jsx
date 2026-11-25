import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { ROUTER_BASENAME, APP_BASE } from './lib/base';
import { IS_PWA } from './lib/appMode';
import { registerServiceWorker } from './lib/swUpdate';
import './styles/tokens.css';
import './styles/globals.css';
import './styles/v3-home.css';
import './styles/v3-schedule.css';
import './styles/pwa.css';

// 📲 نشانهٔ حالت نصب‌شدنی روی <html> — استایل‌های مخصوص دسکتاپِ PWA
// فقط با `.is-pwa` فعال می‌شوند تا ظاهر مینی‌اپ تلگرام دست‌نخورده بماند.
if (typeof document !== 'undefined' && IS_PWA) {
  document.documentElement.classList.add('is-pwa');
}

// 🧭 سرویس‌ورکر واحد — نسخهٔ تازه فقط با تأیید کاربر فعال می‌شود
if (import.meta.env.PROD && typeof window !== 'undefined') {
  window.addEventListener('load', registerServiceWorker);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/* 🚂 Railway: باندل زیر /app/ سرو می‌شود، پس router هم باید همان
   base را بداند. مقدار از تک‌منبع حقیقت src/lib/base.js خوانده
   می‌شود و در حالت ریشه undefined است (رفتار قبلی دست‌نخورده). */
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter basename={ROUTER_BASENAME}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>
);
