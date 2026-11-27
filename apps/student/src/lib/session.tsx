import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api, ApiError, onSessionExpired } from './api';
import { clearCache } from './swr';
import { bgAudio } from './bgAudio';
import { clearAllReaderCaches } from '../screens/reader/readerPageCache';
import type { AccountState, AuthConfig, PublicUser } from './api-types';

/** وضعیت نشست در کل اپ — تنها منبع حقیقت برای گارد مسیرها. */
export type SessionStatus = AccountState | 'loading';

interface SessionValue {
  status: SessionStatus;
  user: PublicUser | null;
  /** true وقتی سرور جواب نداده؛ ورود هنوز قابل تلاش است، فقط هشدار نشان میدهیم. */
  offline: boolean;
  config: AuthConfig | null;
  /** T3: an API call got 401 mid-use. The current screen stays; only a banner shows. */
  expired: boolean;
  dismissExpired: () => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUser] = useState<PublicUser | null>(null);
  const [offline, setOffline] = useState(false);
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [expired, setExpired] = useState(false);

  const refresh = useCallback(async () => {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await api.session({ signal: ctrl.signal });
      setOffline(false);
      setUser(res.user);
      setStatus(res.authenticated ? res.state : 'anonymous');
      if (res.authenticated) setExpired(false);
    } catch (err) {
      // سرور در دسترس نیست → کاربر را پشت صفحهی خطای بنبست حبس نمیکنیم؛
      // فرم ورود میماند و هشدار «اتصال برقرار نشد» کنارش میآید.
      setOffline(ctrl.signal.aborted || (err instanceof ApiError ? err.offline : false));
      setUser(null);
      setStatus('anonymous');
    } finally {
      window.clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    void refresh();
    let alive = true;
    api
      .config()
      .then((c) => {
        if (alive) setConfig(c);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [refresh]);

  // T3: a 401 from any API call does NOT change status (that would unmount the
  // screen via Gate and throw the user out of the reader/player). We only flag
  // it; SessionExpiredBanner offers re-login in an overlay above the screen.
  useEffect(
    () =>
      onSessionExpired(() => {
        setExpired(true);
      }),
    [],
  );

  const dismissExpired = useCallback(() => setExpired(false), []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // حتی اگر شبکه خطا داد، سمت کلاینت خارج میشویم؛ کوکی منقضی میماند
    }
    clearCache(); // next account must never paint the previous one's data
    clearAllReaderCaches(); // release in-memory WebP & ink caches on sign-out
    bgAudio.stop();
    setExpired(false);
    setUser(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ status, user, offline, config, expired, dismissExpired, refresh, signOut }),
    [status, user, offline, config, expired, dismissExpired, refresh, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession باید داخل SessionProvider استفاده شود');
  return ctx;
}
