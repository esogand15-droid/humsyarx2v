import { useEffect, useState } from 'react';

import { Icon } from '../icons/Icon';
import { api } from '../lib/api';
import { usePresence } from '../lib/motion';
import { useSession } from '../lib/session';
import { LoginScreen } from '../screens/LoginScreen';

/**
 * T3: non-blocking banner shown when an API call returns 401 mid-use.
 *
 * - The current screen (reader, player, exam) stays mounted; there is no redirect.
 * - "Log in again" opens the login form in an overlay *on top of* the screen;
 *   after approval in Telegram, SessionProvider.refresh() clears the flag and the
 *   user carries on exactly where they were.
 * - First a quiet session check: if the 401 was transient (or the cookie was
 *   already renewed in another tab), the banner closes on its own.
 */
export function SessionExpiredBanner() {
  const { expired, status, dismissExpired } = useSession();
  const [loginOpen, setLoginOpen] = useState(false);
  const showBanner = Boolean(expired && status === 'active');
  const banner = usePresence(showBanner, 160);
  const relogin = usePresence(loginOpen && status === 'active', 180);

  useEffect(() => {
    if (!expired) {
      setLoginOpen(false);
      return;
    }
    let alive = true;
    // Quiet check: deliberately not refresh(), because a failed refresh would set
    // status to anonymous and Gate would unmount the current screen.
    api
      .session()
      .then((res) => {
        if (alive && res.authenticated && res.state === 'active') dismissExpired();
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [expired, dismissExpired]);

  useEffect(() => {
    if (!loginOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLoginOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [loginOpen]);

  if (!banner.mounted && !relogin.mounted) return null;

  return (
    <>
      {banner.mounted && (
        <div className="session-banner mo-banner" data-state={banner.state} role="alert" aria-live="assertive">
          <span className="session-banner__text">نشست شما منقضی شده است؛ دوباره وارد شوید.</span>
          <div className="session-banner__actions">
            <button type="button" className="btn btn--sm session-banner__cta" onClick={() => setLoginOpen(true)}>
              ورود دوباره
            </button>
            <button
              type="button"
              className="session-banner__close"
              onClick={dismissExpired}
              aria-label="بستن"
              title="بستن"
            >
              <Icon name="i-x" size={18} />
            </button>
          </div>
        </div>
      )}

      {relogin.mounted && (
        <div className="session-relogin" data-state={relogin.state} role="dialog" aria-modal="true" aria-label="ورود دوباره">
          <div className="session-relogin__scrim" onClick={() => setLoginOpen(false)} aria-hidden="true" />
          <div className="session-relogin__panel mo-sheet-swap">
            <button
              type="button"
              className="session-relogin__close"
              onClick={() => setLoginOpen(false)}
              aria-label="بستن"
            >
              <Icon name="i-x" size={18} />
            </button>
            <LoginScreen />
          </div>
        </div>
      )}
    </>
  );
}
