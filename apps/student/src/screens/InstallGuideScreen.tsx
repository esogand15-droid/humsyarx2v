import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Brand } from '../components/Brand';

export type PlatformType = 'ios' | 'android' | 'desktop';

/**
 * تشخیص خودکار سیستم‌عامل کاربر (iOS, Android, Desktop)
 */
export function detectPlatform(): PlatformType {
  if (typeof window === 'undefined') return 'desktop';
  const ua = navigator.userAgent || '';
  const platform = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || '';

  if (/iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    return 'ios';
  }
  if (/Android/i.test(ua)) {
    return 'android';
  }
  return 'desktop';
}

/**
 * بررسی اینکه آیا کاربر در حالت Standalone (نصب‌شده) است یا خیر
 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mm = window.matchMedia('(display-mode: standalone)').matches;
  const standalone = (window.navigator as unknown as { standalone?: boolean }).standalone;
  return mm || standalone === true;
}

interface InstallGuideScreenProps {
  onClose?: () => void;
  isModal?: boolean;
}

export function InstallGuideScreen({ onClose, isModal = false }: InstallGuideScreenProps) {
  const navigate = useNavigate();
  const [detected] = useState<PlatformType>(() => detectPlatform());
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformType>(detected);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [installed, setInstalled] = useState<boolean>(() => isStandalone());
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
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
      // Ignored
    } finally {
      setDeferredPrompt(null);
    }
  };

  const handleShareLink = () => {
    const url = window.location.origin + '/student/';
    if (navigator.share) {
      navigator.share({
        title: 'هامزیار — دستیار دانشجوی پزشکی',
        text: 'وب‌اپلیکیشن تخصصی آموزش و یادگیری پزشکی هامزیار',
        url,
      }).catch(() => {});
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
    <div className={`pwa-guide-container ${isModal ? 'pwa-guide-container--modal' : ''}`}>
      {/* هاله‌های نوری شناور تم تیره‌بالینی */}
      <div className="login-ambient-glow login-ambient-glow--cyan" aria-hidden="true" />
      <div className="login-ambient-glow login-ambient-glow--blue" aria-hidden="true" />
      <div className="login-grid-overlay" aria-hidden="true" />

      <div className="pwa-guide-card">
        {/* هدر مشابه روبیکا با نماد اختصاصی هامزیار */}
        <div className="pwa-guide-hero">
          <div className="pwa-brand-wrapper">
            <Brand size="xl" />
          </div>

          <h1 className="pwa-guide-title">
            جهت نصب وب‌اپلیکیشن هامزیار مراحل زیر را انجام دهید
          </h1>
          <p className="pwa-guide-subtitle">
            نسخهٔ وب پیش‌رونده (PWA) بدون نیاز به استور، با سرعت بالا و دسترسی به تمام امکانات روی گوشی و کامپیوتر شما نصب می‌شود.
          </p>

          {/* تب‌های انتخاب پلتفرم با نشان‌گر سیستم کاربر */}
          <div className="pwa-tabs-wrapper" role="tablist" aria-label="انتخاب سیستم‌عامل">
            <button
              type="button"
              role="tab"
              aria-selected={selectedPlatform === 'ios'}
              className={`pwa-tab-item ${selectedPlatform === 'ios' ? 'pwa-tab-item--active' : ''}`}
              onClick={() => setSelectedPlatform('ios')}
            >
              <span className="pwa-tab-icon">🍏</span>
              <span>آیفون (iOS)</span>
              {detected === 'ios' && <span className="pwa-detected-badge">دستگاه شما</span>}
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={selectedPlatform === 'android'}
              className={`pwa-tab-item ${selectedPlatform === 'android' ? 'pwa-tab-item--active' : ''}`}
              onClick={() => setSelectedPlatform('android')}
            >
              <span className="pwa-tab-icon">🤖</span>
              <span>اندروید</span>
              {detected === 'android' && <span className="pwa-detected-badge">دستگاه شما</span>}
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={selectedPlatform === 'desktop'}
              className={`pwa-tab-item ${selectedPlatform === 'desktop' ? 'pwa-tab-item--active' : ''}`}
              onClick={() => setSelectedPlatform('desktop')}
            >
              <span className="pwa-tab-icon">💻</span>
              <span>ویندوز و مک</span>
              {detected === 'desktop' && <span className="pwa-detected-badge">دستگاه شما</span>}
            </button>
          </div>
        </div>

        {/* مراحل گام‌به‌گام بر اساس پلتفرم انتخاب شده */}
        <div className="pwa-steps-content">
          {selectedPlatform === 'ios' && (
            <div className="pwa-steps-list">
              <div className="pwa-step-row">
                <div className="pwa-step-num">۱</div>
                <div className="pwa-step-desc">
                  در نوار پایین مرورگر Safari روی دکمه <strong>Share</strong> (اشتراک‌گذاری) بزنید
                </div>
                <div className="pwa-step-visual pwa-step-visual--ios-share" title="دکمه Share">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#007AFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                    <polyline points="16 6 12 2 8 6" />
                    <line x1="12" y1="2" x2="12" y2="15" />
                  </svg>
                </div>
              </div>

              <div className="pwa-step-row">
                <div className="pwa-step-num">۲</div>
                <div className="pwa-step-desc">
                  در منوی بازشده، به سمت پایین بیایید و گزینهٔ <strong>Add to Home Screen</strong> را انتخاب کنید
                </div>
                <div className="pwa-step-visual pwa-step-visual--ios-add" title="Add to Home Screen">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2.2">
                    <rect x="3" y="3" width="18" height="18" rx="4" />
                    <line x1="12" y1="8" x2="12" y2="16" />
                    <line x1="8" y1="12" x2="16" y2="12" />
                  </svg>
                </div>
              </div>

              <div className="pwa-step-row">
                <div className="pwa-step-num">۳</div>
                <div className="pwa-step-desc">
                  در مرحله بعد در بالای صفحه سمت راست، روی <strong>Add</strong> بزنید
                </div>
                <div className="pwa-step-visual pwa-step-visual--text-badge">
                  <span>Add</span>
                </div>
              </div>

              <div className="pwa-tip-box">
                <span className="pwa-tip-icon">ℹ️</span>
                <span><strong>توجه مهم:</strong> برای نصب روی آیفون، حتماً صفحه را در مرورگر اصلی <strong>Safari</strong> باز کرده باشید.</span>
              </div>
            </div>
          )}

          {selectedPlatform === 'android' && (
            <div className="pwa-steps-list">
              {deferredPrompt && (
                <div className="pwa-direct-install-box">
                  <button
                    type="button"
                    className="pwa-direct-btn"
                    onClick={handleDirectInstall}
                  >
                    <span className="pwa-direct-btn__icon">📲</span>
                    <span>نصب فوری اپلیکیشن با یک کلیک</span>
                  </button>
                  <span className="pwa-direct-hint">یا از مراحل سه‌گانه زیر استفاده نمایید:</span>
                </div>
              )}

              <div className="pwa-step-row">
                <div className="pwa-step-num">۱</div>
                <div className="pwa-step-desc">
                  در بالای مرورگر کروم، روی دکمه منوی <strong>سه‌نقطه (⋮)</strong> بزنید
                </div>
                <div className="pwa-step-visual" title="منوی مرورگر">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="#38BDF8">
                    <circle cx="12" cy="5" r="2.2" />
                    <circle cx="12" cy="12" r="2.2" />
                    <circle cx="12" cy="19" r="2.2" />
                  </svg>
                </div>
              </div>

              <div className="pwa-step-row">
                <div className="pwa-step-num">۲</div>
                <div className="pwa-step-desc">
                  در منوی بازشده گزینه <strong>«نصب برنامه» (Install app)</strong> یا <strong>«افزودن به صفحه اصلی»</strong> را انتخاب کنید
                </div>
                <div className="pwa-step-visual" title="نصب یا افزودن">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22D3EE" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </div>
              </div>

              <div className="pwa-step-row">
                <div className="pwa-step-num">۳</div>
                <div className="pwa-step-desc">
                  در پنجره کوچک بازشده روی دکمه <strong>«نصب» (Install)</strong> بزنید تا آیکون هامزیار به برنامه‌های گوشی اضافه شود
                </div>
                <div className="pwa-step-visual pwa-step-visual--text-badge pwa-step-visual--cyan">
                  <span>نصب</span>
                </div>
              </div>

              <div className="pwa-tip-box">
                <span className="pwa-tip-icon">💡</span>
                <span>پس از نصب، هامزیار بدون باز کردن مرورگر و با آیکون اختصاصی مستقل مثل یک برنامه اندرویدی باز می‌شود.</span>
              </div>
            </div>
          )}

          {selectedPlatform === 'desktop' && (
            <div className="pwa-steps-list">
              {deferredPrompt && (
                <div className="pwa-direct-install-box">
                  <button
                    type="button"
                    className="pwa-direct-btn"
                    onClick={handleDirectInstall}
                  >
                    <span className="pwa-direct-btn__icon">💻</span>
                    <span>نصب فوری روی ویندوز / مک با ۱ کلیک</span>
                  </button>
                  <span className="pwa-direct-hint">یا از روش نوار آدرس مرورگر اقدام کنید:</span>
                </div>
              )}

              <div className="pwa-step-row">
                <div className="pwa-step-num">۱</div>
                <div className="pwa-step-desc">
                  در انتهای سمت راست نوار آدرس مرورگر (کنار ستاره بوک‌مارک)، روی <strong>آیکون نصب (کامپیوتر کوچک با علامت دانلود)</strong> کلیک کنید
                </div>
                <div className="pwa-step-visual" title="آیکون نصب دسکتاپ">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#38BDF8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                    <polyline points="9 10 12 13 15 10" />
                    <line x1="12" y1="6" x2="12" y2="13" />
                  </svg>
                </div>
              </div>

              <div className="pwa-step-row">
                <div className="pwa-step-num">۲</div>
                <div className="pwa-step-desc">
                  یا از منوی سه‌نقطه (⋮) مرورگر، گزینه <strong>«Install Humsyar»</strong> یا <strong>«نصب هامزیار»</strong> را انتخاب کنید
                </div>
                <div className="pwa-step-visual" title="گزینه نصب">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22D3EE" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </div>
              </div>

              <div className="pwa-step-row">
                <div className="pwa-step-num">۳</div>
                <div className="pwa-step-desc">
                  در پنجره تایید، دکمه <strong>Install</strong> را بزنید تا برنامه با پنجره اختصاصی و آیکون روی دسکتاپ نصب شود
                </div>
                <div className="pwa-step-visual pwa-step-visual--text-badge pwa-step-visual--cyan">
                  <span>Install</span>
                </div>
              </div>

              <div className="pwa-tip-box">
                <span className="pwa-tip-icon">✨</span>
                <span>در ویندوز، نسخه وب با کلید میانبر و بدون منوهای اضافه مرورگر، فوق‌العاده سبک و پرسرعت اجرا می‌شود.</span>
              </div>
            </div>
          )}
        </div>

        {/* دکمه‌های اقدام و بستن/ورود */}
        <div className="pwa-actions-footer">
          <button
            type="button"
            className="pwa-footer-btn pwa-footer-btn--primary"
            onClick={handleCloseOrContinue}
          >
            {installed ? 'باز کردن وب‌اپلیکیشن' : 'متوجه شدم / ورود به وب‌اپ'}
          </button>

          <button
            type="button"
            className="pwa-footer-btn pwa-footer-btn--ghost"
            onClick={handleShareLink}
          >
            {copied ? '✅ لینک کپی شد' : '🔗 اشتراک‌گذاری آدرس با دوستان'}
          </button>
        </div>
      </div>
    </div>
  );
}
