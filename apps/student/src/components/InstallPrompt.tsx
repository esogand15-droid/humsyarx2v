/* InstallPrompt — دکمهٔ نصب PWA + راهنمای افزودن به صفحهٔ اصلی (iOS)
   - Android/Chrome: BeforeInstallPromptEvent -> prompt().prompt()
   - iOS Safari: prompt وجود ندارد؛ یک کارت راهنمای «افزودن به صفحهٔ اصلی»
     که یک بار در هر نشست (sessionStorage) نمایش داده می‌شود.
   - حالت standalone: هیچ چیزی نمایش داده نمی‌شود (کاربر برنامهٔ نصب‌شده را باز کرده). */

import { useCallback, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  readonly prompt: () => Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const IOS_PROMO_KEY = 'humsyar-ios-add-to-home-dismissed';

/** آیا کاربر در حالت «استندالون» (برنامهٔ نصب‌شده) است؟ */
function isStandalone(): boolean {
  const mm = window.matchMedia('(display-mode: standalone)').matches;
  const standalone = (window.navigator as unknown as { standalone?: boolean }).standalone;
  return mm || standalone === true;
}

/** آیا کاربر iOS است؟ (Safari: beforeinstallprompt هرگز نمی‌آید) */
function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'Macintosh' && navigator.maxTouchPoints > 1);
}

/**
 * ShowAddToHome — راهنمای iOS: یک بار در هر نشست، در پایین صفحه با انیمیشن.
 */
export function ShowAddToHome() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!isIOS() || isStandalone()) return;
    if (sessionStorage.getItem(IOS_PROMO_KEY)) return;
    setIsVisible(true);

    const t = setTimeout(() => setIsVisible(false), 8000);
    return () => clearTimeout(t);
  }, []);

  const dismiss = () => {
    sessionStorage.setItem(IOS_PROMO_KEY, '1');
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div className="install-prompt install-prompt--ios" role="banner" aria-label="راهنمای افزودن به صفحهٔ اصلی">
      <div className="install-prompt__body">
        <p>
          <strong>هامزیار</strong> را به صفحهٔ اصلی دستگاه خود اضافه کنید تا مانند یک برنامهٔ مستقل
          باز شود.
        </p>
        <ol className="install-prompt__steps">
          <li>روی دکمهٔ <strong>اشتراک‌گذاری</strong> (Share — مربع با فلش رو به بالا) بزنید.</li>
          <li>گزینهٔ <strong>Add to Home Screen</strong> را انتخاب کنید.</li>
        </ol>
        <button type="button" className="install-prompt__close" onClick={dismiss} aria-label="بستن راهنما">
          فهمیدم
        </button>
      </div>
    </div>
  );
}

/**
 * InstallPrompt — دکمهٔ «نصب» برای دسکتاپ و اندروید.
 * اگر مرورگر `beforeinstallprompt` پشتیبانی نمی‌کند، رندر نمی‌شود.
 */
export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showButton, setShowButton] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;

    const onBeforeInstallPrompt = (e: Event) => {
      // جلوگیری از نمایش خودکار prompt؛ ما خودمان CTA را نشان می‌دهیم
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowButton(true);
    };

    const onAppInstalled = () => {
      setDeferredPrompt(null);
      setShowButton(false);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;

    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        /* کاربر نصب کرد */
      }
    } catch {
      /* کاربر prompt را لغو کرد */
    } finally {
      setDeferredPrompt(null);
      setShowButton(false);
    }
  }, [deferredPrompt]);

  if (!showButton) return null;

  return (
    <button
      type="button"
      className="install-prompt__cta"
      onClick={handleInstall}
      aria-label="نصب هامزیار روی دستگاه"
      title="نصب هامزیار"
    >
      نصب برنامه
    </button>
  );
}
