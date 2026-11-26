/* Stale-while-revalidate cache for screen data.
   A revisited screen paints its last data at once and refreshes in the background,
   so the skeleton shows only on the very first visit of a tab session.
   Memory first, sessionStorage second (survives a reload, dies with the tab).
   Cleared on sign-out so the next account never sees the previous one's data. */

const PREFIX = 'hy-swr:';
const mem = new Map<string, unknown>();

export function peek<T>(key: string): T | undefined {
  if (mem.has(key)) return mem.get(key) as T;
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (raw) {
      const value = JSON.parse(raw) as T;
      mem.set(key, value);
      return value;
    }
  } catch {
    /* storage blocked or corrupt entry: behave as a cold cache */
  }
  return undefined;
}

export function put<T>(key: string, value: T): T {
  mem.set(key, value);
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* quota or private mode: memory cache still works */
  }
  return value;
}

export function clearCache(): void {
  mem.clear();
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(PREFIX)) sessionStorage.removeItem(k);
    }
  } catch {
    /* nothing to clear */
  }
}
