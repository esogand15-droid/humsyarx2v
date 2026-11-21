import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';

export interface HeaderState {
  title?: string;
  sub?: string;
  back?: boolean;
  onBack?: () => void;
  actions?: ReactNode;
}

export interface HeaderContextValue {
  header: HeaderState;
  setHeader: (header: HeaderState) => void;
  resetHeader: () => void;
}

const defaultContextValue: HeaderContextValue = {
  header: {},
  setHeader: () => {},
  resetHeader: () => {},
};

export const HeaderContext = createContext<HeaderContextValue>(defaultContextValue);

export function HeaderProvider({ children }: { children: ReactNode }) {
  const [header, setHeaderState] = useState<HeaderState>({});

  const setHeader = useCallback((next: HeaderState) => {
    setHeaderState((prev) => {
      if (
        prev.title === next.title &&
        prev.sub === next.sub &&
        prev.back === next.back &&
        prev.onBack === next.onBack &&
        prev.actions === next.actions
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  const resetHeader = useCallback(() => {
    setHeaderState({});
  }, []);

  const value = useMemo(
    () => ({ header, setHeader, resetHeader }),
    [header, setHeader, resetHeader]
  );

  return <HeaderContext.Provider value={value}>{children}</HeaderContext.Provider>;
}

export function useHeader(): HeaderContextValue {
  const context = useContext(HeaderContext);
  return context || defaultContextValue;
}
