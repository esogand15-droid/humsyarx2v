import { useEffect, useState } from 'react';

import { api } from '../lib/api';
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

  // Only matters while signed in; on the login screen itself it adds nothing
  if (!expired || status !== 'active') return null;

  return (
    <>
      <div className="session-banner" role="alert" aria-live="assertive">
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
            ✕
          </button>
        </div>
      </div>

      {loginOpen && (
        <div className="session-relogin" role="dialog" aria-modal="true" aria-label="ورود دوباره">
          <div className="session-relogin__scrim" onClick={() => setLoginOpen(false)} aria-hidden="true" />
          <div className="session-relogin__panel">
            <button
              type="button"
              className="session-relogin__close"
              onClick={() => setLoginOpen(false)}
              aria-label="بستن"
            >
              ✕
            </button>
            <LoginScreen />
          </div>
        </div>
      )}
    </>
  );
}
