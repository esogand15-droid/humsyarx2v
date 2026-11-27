import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeCtx {
  mode: ThemeMode;
  resolved: 'light' | 'dark';
  setMode: (m: ThemeMode) => void;
}

const Ctx = createContext<ThemeCtx | null>(null);
const KEY = 'humsyar.theme';

function systemPrefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

/** تم: روشن / تاریک / سیستم — انتخاب کاربر حفظ می‌شود. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(KEY);
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'dark';
  });
  const [sysDark, setSysDark] = useState(systemPrefersDark);
  const transitionTimerRef = useRef<number>(0);

  const setMode = useCallback((next: ThemeMode) => {
    if (
      typeof document !== 'undefined' &&
      !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      const root = document.documentElement;
      root.classList.add('theme-transition');
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = window.setTimeout(() => {
        root.classList.remove('theme-transition');
      }, 240);
    }
    setModeState(next);
  }, []);

  useEffect(() => () => {
    window.clearTimeout(transitionTimerRef.current);
    document.documentElement?.classList.remove('theme-transition');
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSysDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved: 'light' | 'dark' = mode === 'system' ? (sysDark ? 'dark' : 'light') : mode;

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    if (resolved === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem(KEY, mode);
    // index.html ships a light/dark pair of theme-color metas; a manual theme overrides the OS, so set both.
    const pageBg = resolved === 'dark' ? '#0B0F19' : '#F8FAFC';
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', pageBg));
  }, [mode, resolved]);

  const value = useMemo(() => ({ mode, resolved, setMode }), [mode, resolved, setMode]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTheme must be used inside ThemeProvider');
  return v;
}
