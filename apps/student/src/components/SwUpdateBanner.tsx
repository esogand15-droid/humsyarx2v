import { useEffect, useState } from 'react';

import { DsButton, DsCard } from '../design/components';
import { applySwUpdate, subscribeSwUpdate } from '../lib/swUpdate';

/**
 * بنر غیرمسدودکنندهٔ اطلاع‌رسانی نسخهٔ جدید PWA با توکن‌های DS v2.
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

  if (!ready || dismissed) return null;

  return (
    <div className="ds-sw-banner-wrap" data-section="brand" role="status" aria-live="polite">
      <DsCard level="float" className="ds-sw-banner">
        <span className="ds-sw-banner__text">نسخهٔ جدید هامزیار آماده است</span>
        <div className="ds-sw-banner__actions">
          <DsButton onClick={() => applySwUpdate()}>به‌روزرسانی</DsButton>
          <DsButton
            variant="ghost"
            className="ds-btn--icon"
            onClick={() => setDismissed(true)}
            aria-label="بستن اعلان به‌روزرسانی"
            title="بستن"
          >
            ✕
          </DsButton>
        </div>
      </DsCard>
    </div>
  );
}
