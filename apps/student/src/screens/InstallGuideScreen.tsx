import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import './auth.css';
import { Brand } from '../components/Brand';
import { DsButton, DsSegmented } from '../design/components';
import { Icon } from '../icons';
import { useTheme } from '../lib/theme';

export type PlatformType = 'ios' | 'android' | 'desktop';

const PLATFORM_LABELS: Record<PlatformType, string> = {
  ios: 'آیفون',
  android: 'اندروید',
  desktop: 'کامپیوتر',
};

const PLATFORM_OPTIONS: ReadonlyArray<{ value: PlatformType; label: string }> = [
  { value: 'ios', label: 'آیفون' },
  { value: 'android', label: 'اندروید' },
  { value: 'desktop', label: 'کامپیوتر' },
];

/**
 * تشخیص خودکار سیستم‌عامل کاربر (آیفون، اندروید، کامپیوتر)
 */
export function detectPlatform(): PlatformType {
  if (typeof window === 'undefined') return 'desktop';
  const ua = navigator.userAgent || '';
  const platform =
    (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    navigator.platform ||
    '';

  if (/iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    return 'ios';
  }
  if (/Android/i.test(ua)) {
    return 'android';
  }
  return 'desktop';
}

/**
 * بررسی اینکه آیا کاربر در حالت نصب‌شده (Standalone) است یا خیر
 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mm = window.matchMedia('(display-mode: standalone)').matches;
  const standalone = (window.navigator as unknown as { standalone?: boolean }).standalone;
  return mm || standalone === true;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface InstallGuideScreenProps {
  onClose?: () => void;
  isModal?: boolean;
}

export function InstallGuideScreen({ onClose, isModal = false }: InstallGuideScreenProps) {
  const navigate = useNavigate();
  const { resolved, setMode } = useTheme();
  const [detected] = useState<PlatformType>(() => detectPlatform());
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformType>(detected);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState<boolean>(() => isStandalone());
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const handleDirectInstall = async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setInstalled(true);
      }
    } catch {
      // نادیده گرفته می‌شود
    } finally {
      setDeferredPrompt(null);
    }
  };

  const handleShareLink = () => {
    const url = window.location.origin + '/student/';
    if (navigator.share) {
      navigator
        .share({
          title: 'هامزیار: دستیار دانشجوی پزشکی',
          text: 'نسخهٔ وب تخصصی آموزش و یادگیری پزشکی هامزیار',
          url,
        })
        .catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleCloseOrContinue = () => {
    if (onClose) {
      onClose();
    } else {
      navigate('/login');
    }
  };

  return (
    <div className={`auth-screen ${isModal ? 'auth-screen--modal' : ''}`}>
      <div className="auth-topbar">
        <button
          type="button"
          className="auth-topbar-btn"
          onClick={handleCloseOrContinue}
        >
          <Icon name="i-chevron-r" size={16} />
          <span>{onClose ? 'بستن' : 'ورود به حساب'}</span>
        </button>

        <button
          type="button"
          className="auth-topbar-btn auth-theme-btn"
          onClick={() => setMode(resolved === 'dark' ? 'light' : 'dark')}
          aria-label={resolved === 'dark' ? 'تغییر به حالت روشن' : 'تغییر به حالت تیره'}
        >
          <Icon name={resolved === 'dark' ? 'i-sun' : 'i-moon'} size={16} />
          <span>{resolved === 'dark' ? 'حالت روشن' : 'حالت تیره'}</span>
        </button>
      </div>

      <div className="auth-card">
        <div className="auth-hero">
          <div className="auth-logo-frame">
            <Brand size="lg" />
          </div>
          <div className="auth-wordmark">
            <span className="auth-wordmark__hums">هامز</span>
            <span className="auth-wordmark__yar">یار</span>
          </div>
          <h1 className="auth-title">نصب نسخهٔ وب هامزیار روی دستگاه</h1>
          <p className="auth-subtitle">
            بدون نیاز به فروشگاه برنامه، هامزیار را با آیکون مستقل روی گوشی، آیپد یا کامپیوتر خود نصب کنید.
          </p>
        </div>

        <div className="pwa-seg">
          <DsSegmented
            value={selectedPlatform}
            options={PLATFORM_OPTIONS}
            onChange={setSelectedPlatform}
            block
            label="انتخاب دستگاه"
          />
          <p className="pwa-detected-caption">
            دستگاه فعلی شما: <strong>{PLATFORM_LABELS[detected]}</strong>
          </p>
        </div>

        <div className="pwa-steps-content">
          {selectedPlatform === 'ios' && (
            <div className="pwa-steps-list" role="tabpanel">
              <div className="pwa-step-row">
                <div className="pwa-step-num">۱</div>
                <div className="pwa-step-desc">
                  در مرورگر Safari (نوار پایین در آیفون یا نوار بالا کنار نشانی در آیپد) روی دکمهٔ <strong>Share</strong> (اشتراک‌گذاری) بزنید
                </div>
                <div className="pwa-step-visual" title="دکمه Share">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                    <polyline points="16 6 12 2 8 6" />
                    <line x1="12" y1="2" x2="12" y2="15" />
                  </svg>
                </div>
              </div>

              <div className="pwa-step-row">
                <div className="pwa-step-num">۲</div>
                <div className="pwa-step-desc">
                  در منوی بازشده به پایین بروید و گزینهٔ <strong>Add to Home Screen</strong> را انتخاب کنید
                </div>
                <div className="pwa-step-visual" title="Add to Home Screen">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="3" width="18" height="18" rx="4" />
                    <line x1="12" y1="8" x2="12" y2="16" />
                    <line x1="8" y1="12" x2="16" y2="12" />
                  </svg>
                </div>
              </div>

              <div className="pwa-step-row">
                <div className="pwa-step-num">۳</div>
                <div className="pwa-step-desc">
                  در بالای صفحه روی دکمهٔ <strong>Add</strong> بزنید تا آیکون هامزیار روی صفحهٔ اصلی قرار گیرد
                </div>
                <div className="pwa-step-visual pwa-step-visual--badge">
                  <span>Add</span>
                </div>
              </div>

              <div className="pwa-tip-box">
                <Icon name="i-info" size={18} />
                <span>
                  این صفحه را حتما با مرورگر Safari باز کنید تا گزینهٔ افزودن به صفحهٔ اصلی نمایش داده شود.
                </span>
              </div>
            </div>
          )}

          {selectedPlatform === 'android' && (
            <div className="pwa-steps-list" role="tabpanel">
              {deferredPrompt && (
                <div className="pwa-direct-install-box">
                  <DsButton block size="lg" onClick={handleDirectInstall}>
                    <Icon name="i-download" size={18} />
                    <span>نصب فوری اپلیکیشن با یک کلیک</span>
                  </DsButton>
                  <span className="pwa-direct-hint">یا از مراحل سه‌گانهٔ زیر استفاده کنید:</span>
                </div>
              )}

              <div className="pwa-step-row">
                <div className="pwa-step-num">۱</div>
                <div className="pwa-step-desc">
                  در بالای مرورگر کروم، روی دکمهٔ منوی <strong>سه‌نقطه (⋮)</strong> بزنید
                </div>
                <div className="pwa-step-visual" title="منوی مرورگر">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
                    <circle cx="12" cy="5" r="2.2" />
                    <circle cx="12" cy="12" r="2.2" />
                    <circle cx="12" cy="19" r="2.2" />
                  </svg>
                </div>
              </div>

              <div className="pwa-step-row">
                <div className="pwa-step-num">۲</div>
                <div className="pwa-step-desc">
                  گزینهٔ <strong>«نصب برنامه» (Install app)</strong> یا <strong>«افزودن به صفحهٔ اصلی»</strong> را انتخاب کنید
                </div>
                <div className="pwa-step-visual" title="نصب برنامه">
                  <Icon name="i-download" size={22} />
                </div>
              </div>

              <div className="pwa-step-row">
                <div className="pwa-step-num">۳</div>
                <div className="pwa-step-desc">
                  در پنجرهٔ تایید روی <strong>«نصب» (Install)</strong> بزنید تا آیکون هامزیار به گوشی اضافه شود
                </div>
                <div className="pwa-step-visual pwa-step-visual--badge">
                  <span>نصب</span>
                </div>
              </div>

              <div className="pwa-tip-box">
                <Icon name="i-info" size={18} />
                <span>
                  پس از نصب، هامزیار با آیکون مستقل و بدون نوارهای مرورگر مثل یک برنامهٔ بومی اجرا می‌شود.
                </span>
              </div>
            </div>
          )}

          {selectedPlatform === 'desktop' && (
            <div className="pwa-steps-list" role="tabpanel">
              {deferredPrompt && (
                <div className="pwa-direct-install-box">
                  <DsButton block size="lg" onClick={handleDirectInstall}>
                    <Icon name="i-download" size={18} />
                    <span>نصب فوری روی ویندوز و مک با یک کلیک</span>
                  </DsButton>
                  <span className="pwa-direct-hint">یا از نوار آدرس مرورگر اقدام کنید:</span>
                </div>
              )}

              <div className="pwa-step-row">
                <div className="pwa-step-num">۱</div>
                <div className="pwa-step-desc">
                  در انتهای نوار آدرس مرورگر، روی <strong>آیکون نصب</strong> (نمایشگر همراه با فلش دانلود) کلیک کنید
                </div>
                <div className="pwa-step-visual" title="آیکون نصب دسکتاپ">
                  <Icon name="i-download" size={22} />
                </div>
              </div>

              <div className="pwa-step-row">
                <div className="pwa-step-num">۲</div>
                <div className="pwa-step-desc">
                  یا از منوی سه‌نقطهٔ مرورگر، گزینهٔ <strong>«Install Humsyar»</strong> یا <strong>«نصب هامزیار»</strong> را برگزینید
                </div>
                <div className="pwa-step-visual" title="منوی نصب">
                  <Icon name="i-plus" size={22} />
                </div>
              </div>

              <div className="pwa-step-row">
                <div className="pwa-step-num">۳</div>
                <div className="pwa-step-desc">
                  در پنجرهٔ تایید روی <strong>Install</strong> بزنید تا برنامه با پنجرهٔ اختصاصی روی دسکتاپ نصب شود
                </div>
                <div className="pwa-step-visual pwa-step-visual--badge">
                  <span>Install</span>
                </div>
              </div>

              <div className="pwa-tip-box">
                <Icon name="i-info" size={18} />
                <span>
                  در ویندوز و مک، نسخهٔ وب با پنجرهٔ مجزا و بدون نوارهای اضافی مرورگر اجرا می‌شود.
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="pwa-actions-footer">
          <DsButton
            type="button"
            block
            size="lg"
            onClick={handleCloseOrContinue}
          >
            <span>{installed ? 'باز کردن وب‌اپلیکیشن' : 'متوجه شدم / ورود به وب‌اپ'}</span>
            <Icon name="i-chevron" size={18} />
          </DsButton>

          <DsButton
            type="button"
            variant="ghost"
            block
            onClick={handleShareLink}
          >
            <Icon name={copied ? 'i-check' : 'i-copy'} size={18} />
            <span>{copied ? 'نشانی کپی شد' : 'اشتراک‌گذاری نشانی با دوستان'}</span>
          </DsButton>
        </div>
      </div>
    </div>
  );
}
