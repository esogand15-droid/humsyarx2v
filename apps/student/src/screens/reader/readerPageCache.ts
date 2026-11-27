/**
 * RAM-only LRU caches for Protected Reader WebP pages, thumbnails, and decoded ink.
 *
 * Security (DRM zero-storage):
 * - Never writes page pixels to localStorage, sessionStorage, IndexedDB, or CacheStorage.
 * - Holds Blob object URLs strictly in volatile memory for the active tab session.
 * - Revokes evicted/cleared object URLs via URL.revokeObjectURL to keep mobile memory bounded.
 */

import type { StickyNote, Stroke } from '../../lib/ink';

interface CacheEntry {
  url: string;
  bytes: number;
  isBlob: boolean;
}

const MB = 1024 * 1024;

function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function getPageBudgetBytes(): number {
  if (typeof navigator === 'undefined') return 48 * MB;
  if (isIosDevice()) return 48 * MB;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 2;
  return mem >= 4 ? 96 * MB : 48 * MB;
}

class MemoryUrlLru {
  private entries = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<string>>();
  private totalBytes = 0;
  private maxBytes: number;

  constructor(maxBytes: number) {
    this.maxBytes = maxBytes;
  }

  get(key: string): string | null {
    const hit = this.entries.get(key);
    if (!hit) return null;
    // Refresh recency in Map insertion order
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.url;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  private put(key: string, entry: CacheEntry) {
    const existing = this.entries.get(key);
    if (existing) {
      this.totalBytes -= existing.bytes;
      if (existing.isBlob && existing.url !== entry.url) {
        URL.revokeObjectURL(existing.url);
      }
      this.entries.delete(key);
    }

    this.entries.set(key, entry);
    this.totalBytes += entry.bytes;

    while (this.totalBytes > this.maxBytes && this.entries.size > 1) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) break;
      const oldest = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      if (oldest) {
        this.totalBytes -= oldest.bytes;
        if (oldest.isBlob) URL.revokeObjectURL(oldest.url);
      }
    }
  }

  async acquire(
    key: string,
    remoteUrl: string,
    onAuthRejected?: () => Promise<string | null>,
  ): Promise<string> {
    const cached = this.get(key);
    if (cached) return cached;

    if (remoteUrl.startsWith('data:')) {
      this.put(key, { url: remoteUrl, bytes: remoteUrl.length, isBlob: false });
      return remoteUrl;
    }

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const job = (async () => {
      let target = remoteUrl;
      let res = await fetch(target, { credentials: 'include', cache: 'no-store' });

      if ((res.status === 401 || res.status === 403) && onAuthRejected) {
        const fresh = await onAuthRejected();
        if (fresh) {
          target = fresh;
          res = await fetch(target, { credentials: 'include', cache: 'no-store' });
        }
      }

      if (!res.ok) {
        throw new Error(`HTTP_${res.status}`);
      }

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);

      // Warm decode off the render path so mounting <img> is instantaneous without blank flash.
      if (typeof Image !== 'undefined') {
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.decoding = 'async';
          img.onload = () => {
            if (typeof img.decode === 'function') {
              void img.decode().catch(() => undefined).finally(resolve);
            } else {
              resolve();
            }
          };
          img.onerror = () => resolve();
          img.src = objectUrl;
        });
      }

      this.put(key, { url: objectUrl, bytes: Math.max(1, blob.size), isBlob: true });
      return objectUrl;
    })();

    this.inflight.set(key, job);
    try {
      return await job;
    } finally {
      this.inflight.delete(key);
    }
  }

  invalidate(key: string) {
    const hit = this.entries.get(key);
    if (!hit) return;
    this.entries.delete(key);
    this.totalBytes -= hit.bytes;
    if (hit.isBlob) URL.revokeObjectURL(hit.url);
  }

  clear() {
    for (const entry of this.entries.values()) {
      if (entry.isBlob) URL.revokeObjectURL(entry.url);
    }
    this.entries.clear();
    this.inflight.clear();
    this.totalBytes = 0;
  }
}

const pageLru = new MemoryUrlLru(getPageBudgetBytes());
const thumbLru = new MemoryUrlLru(12 * MB);

export interface CachedInkPage {
  strokes: Stroke[];
  notes: StickyNote[];
}

const inkMemCache = new Map<string, CachedInkPage>();
const MAX_INK_MEM_PAGES = 240;

export function makePageCacheKey(scope: string, fileId: string, page: number): string {
  return `${scope}:${fileId}:p${page}`;
}

export function getCachedPageUrl(scope: string, fileId: string, page: number): string | null {
  return pageLru.get(makePageCacheKey(scope, fileId, page));
}

export function acquirePageUrl(
  scope: string,
  fileId: string,
  page: number,
  remoteUrl: string,
  onAuthRejected?: () => Promise<string | null>,
): Promise<string> {
  return pageLru.acquire(makePageCacheKey(scope, fileId, page), remoteUrl, onAuthRejected);
}

export function invalidatePageCache(scope: string, fileId: string, page: number): void {
  pageLru.invalidate(makePageCacheKey(scope, fileId, page));
}

export function getCachedThumbUrl(scope: string, fileId: string, page: number): string | null {
  return thumbLru.get(`thumb:${makePageCacheKey(scope, fileId, page)}`);
}

export function acquireThumbUrl(
  scope: string,
  fileId: string,
  page: number,
  remoteUrl: string,
  onAuthRejected?: () => Promise<string | null>,
): Promise<string> {
  return thumbLru.acquire(`thumb:${makePageCacheKey(scope, fileId, page)}`, remoteUrl, onAuthRejected);
}

export function prefetchPageUrl(
  scope: string,
  fileId: string,
  page: number,
  remoteUrl: string,
  onAuthRejected?: () => Promise<string | null>,
): void {
  const key = makePageCacheKey(scope, fileId, page);
  if (pageLru.has(key)) return;
  void pageLru.acquire(key, remoteUrl, onAuthRejected).catch(() => undefined);
}

export function getCachedInkPage(scope: string, fileId: string, page: number): CachedInkPage | null {
  const key = makePageCacheKey(scope, fileId, page);
  const hit = inkMemCache.get(key);
  if (!hit) return null;
  inkMemCache.delete(key);
  inkMemCache.set(key, hit);
  return hit;
}

export function setCachedInkPage(
  scope: string,
  fileId: string,
  page: number,
  data: CachedInkPage,
): void {
  const key = makePageCacheKey(scope, fileId, page);
  if (inkMemCache.has(key)) inkMemCache.delete(key);
  inkMemCache.set(key, data);
  while (inkMemCache.size > MAX_INK_MEM_PAGES) {
    const oldest = inkMemCache.keys().next().value;
    if (!oldest) break;
    inkMemCache.delete(oldest);
  }
}

export function clearAllReaderCaches(): void {
  pageLru.clear();
  thumbLru.clear();
  inkMemCache.clear();
}
