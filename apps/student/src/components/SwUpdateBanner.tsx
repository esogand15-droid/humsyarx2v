import { useEffect, useState } from 'react';

import { DsButton, DsCard } from '../design/components';
import { Icon } from '../icons/Icon';
import { usePresence } from '../lib/motion';
import { applySwUpdate, subscribeSwUpdate } from '../lib/swUpdate';

/**
 * بنر غیرمسدودکنندهٔ اطلاعرسانی نسخهٔ جدید PWA با توکنهای DS v2 و خروج انیمیشنی.
 * زدن «بهروزرسانی» بلافاصله صفحهٔ بهروزرسانی (UpdateOverlay) را باز میکند.
 */
export function SwUpdateBanner() {
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    return subscribeSwUpdate((isReady) => {
      setReady(isReady);
      if (isReady) setDismissed(false);
    });
  }, []);

  const visible = ready && !dismissed;
  const { mounted, state } = usePresence(visible, 160);

  if (!mounted) return null;

  return (
    <div
      className="ds-sw-banner-wrap mo-banner"
      data-section="brand"
      data-state={state}
      role="status"
      aria-live="polite"
    >
      <DsCard level="float" className="ds-sw-banner">
        <span className="ds-sw-banner__icon" aria-hidden="true">
          <Icon name="i-zap" size={18} />
        </span>
        <span className="ds-sw-banner__body">
          <span className="ds-sw-banner__text">نسخهٔ جدید هامزیار آماده است</span>
          <span className="ds-sw-banner__sub">چند ثانیه طول می‌کشد و اطلاعات شما حفظ می‌شود.</span>
        </span>
        <div className="ds-sw-banner__actions">
          <DsButton onClick={() => applySwUpdate()}>
            <Icon name="i-refresh" size={16} />
            به‌روزرسانی
          </DsButton>
          <DsButton
            variant="ghost"
            className="ds-btn--icon"
            onClick={() => setDismissed(true)}
            aria-label="بستن اعلان به‌روزرسانی"
            title="بعداً"
          >
            <Icon name="i-x" size={18} />
          </DsButton>
        </div>
      </DsCard>
    </div>
  );
}
