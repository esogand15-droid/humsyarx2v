/* InstallCard: the one place the app suggests "install to home screen".
   - Inline, opaque card rendered only by HomeScreen. It never floats over another screen
     (audit G1/LG1/AI1/SB2/ES2: the old fixed bottom sheet covered the pay button, the chat
     composer and exam submit on every route).
   - iOS Safari has no install prompt: the card shows the two Share-sheet steps and links to
     the full guide (/install).
   - Android / desktop Chrome: `beforeinstallprompt` is captured at module load (it can fire
     before Home mounts) and the card offers a real "install" button.
   - Never shown in standalone mode. Dismissal is permanent (localStorage). */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DsButton } from '../design/components';
import { Icon } from '../icons/Icon';

interface BeforeInstallPromptEvent extends Event {
  readonly prompt: () => Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'humsyar.install-card.dismissed';

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach((fn) => fn());

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDismissed() {
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    /* private mode: the card simply comes back next launch */
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    writeDismissed();
    notify();
  });
}

/** Running as the installed app (home-screen icon / installed PWA)? */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mm = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return mm || iosStandalone;
}

/** iOS / iPadOS Safari, where beforeinstallprompt never fires. */
function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

export function InstallCard() {
  const [dismissed, setDismissed] = useState(readDismissed);
  const [canPrompt, setCanPrompt] = useState(() => deferredPrompt !== null);
  const [ios] = useState(isIOS);
  const [standalone] = useState(isStandalone);

  useEffect(() => {
    const sync = () => {
      setCanPrompt(deferredPrompt !== null);
      setDismissed(readDismissed());
    };
    subscribers.add(sync);
    return () => {
      subscribers.delete(sync);
    };
  }, []);

  const dismiss = useCallback(() => {
    writeDismissed();
    setDismissed(true);
  }, []);

  const install = useCallback(async () => {
    const ev = deferredPrompt;
    if (!ev) return;
    try {
      await ev.prompt();
      const { outcome } = await ev.userChoice;
      if (outcome === 'accepted') writeDismissed();
    } catch {
      /* the user closed the browser prompt */
    } finally {
      deferredPrompt = null;
      notify();
    }
  }, []);

  if (standalone || dismissed || (!ios && !canPrompt)) return null;

  return (
    <section className="ds-card install-card" aria-labelledby="install-card-title">
      <div className="install-card__head">
        <span className="install-card__icon" aria-hidden="true">
          <Icon name="i-smartphone" size={22} />
        </span>
        <div className="install-card__titles">
          <h2 id="install-card-title" className="install-card__title">
            هامزیار را روی صفحهٔ اصلی نصب کن
          </h2>
          <p className="install-card__sub">تمام‌صفحه و سریع‌تر باز می‌شود، مثل یک برنامهٔ واقعی.</p>
        </div>
      </div>

      {ios && !canPrompt && (
        <ol className="install-card__steps">
          <li>
            در <bdi dir="ltr">Safari</bdi> دکمهٔ <b>اشتراک‌گذاری</b> را بزن (مربع با فلش رو به بالا).
          </li>
          <li>
            گزینهٔ <b>افزودن به صفحهٔ اصلی</b> (<bdi dir="ltr">Add to Home Screen</bdi>) را انتخاب کن.
          </li>
        </ol>
      )}

      <div className="install-card__actions">
        {canPrompt ? (
          <DsButton onClick={() => void install()}>
            <Icon name="i-download" size={18} />
            نصب برنامه
          </DsButton>
        ) : (
          <Link to="/install" className="ds-btn ds-btn--secondary">
            راهنمای تصویری
          </Link>
        )}
        <DsButton variant="ghost" onClick={dismiss}>
          فهمیدم، نشان نده
        </DsButton>
      </div>
    </section>
  );
}
