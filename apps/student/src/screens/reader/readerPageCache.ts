/**
 * RAM-only LRU caches for Protected Reader WebP pages, thumbnails, and decoded ink.
 *
 * Security (DRM zero-storage):
 * - Never writes page pixels to localStorage, sessionStorage, IndexedDB, or CacheStorage.
 * - Holds Blob object URLs strictly in volatile memory for the active tab session.
 * - Revokes evicted/cleared object URLs via URL.revokeObjectURL only after active DOM pins release.
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

function getThumbBudgetBytes(): number {
  if (typeof navigator === 'undefined') return 20 * MB;
  if (isIosDevice()) return 20 * MB;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 2;
  return mem >= 4 ? 36 * MB : 20 * MB;
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** Downscales oversized fallback images (e.g. full-res page WebP) to ~220px thumbnail in RAM. */
async function compactThumbBlob(blob: Blob): Promise<Blob> {
  if (blob.size <= 96 * 1024 || typeof document === 'undefined') return blob;
  try {
    let bmp: ImageBitmap | null = null;
    if (typeof createImageBitmap === 'function') {
      bmp = await createImageBitmap(blob);
    }
    const srcW = bmp ? bmp.width : 0;
    const srcH = bmp ? bmp.height : 0;
    if (!bmp || srcW <= 260) {
      bmp?.close?.();
      return blob;
    }
    const targetW = 220;
    const targetH = Math.max(1, Math.round((srcH / srcW) * targetW));
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bmp.close();
      return blob;
    }
    ctx.drawImage(bmp, 0, 0, targetW, targetH);
    bmp.close();
    const out = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/webp', 0.78);
    });
    canvas.width = 0;
    canvas.height = 0;
    if (out && out.size > 0 && out.size < blob.size) return out;
    return blob;
  } catch {
    return blob;
  }
}

async function warmDecodeObjectUrl(objectUrl: string): Promise<void> {
  if (typeof Image === 'undefined') return;
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

class MemoryUrlLru {
  private entries = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<string>>();
  private pins = new Map<string, number>();
  private urlRefCounts = new Map<string, number>();
  private pendingRevoke = new Set<string>();
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

  pin(key: string): void {
    const hit = this.entries.get(key);
    if (!hit || !hit.isBlob) return;
    this.pins.set(key, (this.pins.get(key) ?? 0) + 1);
    this.urlRefCounts.set(hit.url, (this.urlRefCounts.get(hit.url) ?? 0) + 1);
    this.pendingRevoke.delete(hit.url);
  }

  unpin(key: string): void {
    const count = this.pins.get(key) ?? 0;
    if (count <= 0) return;
    if (count === 1) this.pins.delete(key);
    else this.pins.set(key, count - 1);

    const hit = this.entries.get(key);
    if (hit && hit.isBlob) {
      const uc = this.urlRefCounts.get(hit.url) ?? 0;
      if (uc <= 1) {
        this.urlRefCounts.delete(hit.url);
        if (this.pendingRevoke.has(hit.url)) {
          this.pendingRevoke.delete(hit.url);
          URL.revokeObjectURL(hit.url);
        }
      } else {
        this.urlRefCounts.set(hit.url, uc - 1);
      }
    }
  }

  private scheduleRevoke(url: string) {
    if ((this.urlRefCounts.get(url) ?? 0) > 0) {
      this.pendingRevoke.add(url);
    } else {
      URL.revokeObjectURL(url);
    }
  }

  private put(key: string, entry: CacheEntry) {
    const existing = this.entries.get(key);
    if (existing) {
      this.totalBytes -= existing.bytes;
      if (existing.isBlob && existing.url !== entry.url) {
        this.scheduleRevoke(existing.url);
      }
      this.entries.delete(key);
    }

    this.entries.set(key, entry);
    this.totalBytes += entry.bytes;

    if (this.totalBytes > this.maxBytes && this.entries.size > 1) {
      // Evict unpinned entries first so visible <img> tags never break mid-render.
      for (const [candidateKey, candidate] of Array.from(this.entries.entries())) {
        if (this.totalBytes <= this.maxBytes || this.entries.size <= 1) break;
        if (candidateKey === key) continue;
        if ((this.pins.get(candidateKey) ?? 0) > 0) continue;
        this.entries.delete(candidateKey);
        this.totalBytes -= candidate.bytes;
        if (candidate.isBlob) this.scheduleRevoke(candidate.url);
      }
    }
  }

  async acquire(
    key: string,
    remoteUrl: string,
    onAuthRejected?: () => Promise<string | null>,
    opts?: { compact?: boolean; retries?: number },
  ): Promise<string> {
    const cached = this.get(key);
    if (cached) return cached;

    if (remoteUrl.startsWith('data:')) {
      this.put(key, { url: remoteUrl, bytes: remoteUrl.length, isBlob: false });
      return remoteUrl;
    }

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const maxRetries = opts?.retries ?? 0;

    const job = (async () => {
      let lastErr: unknown = null;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
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

          let blob = await res.blob();
          if (opts?.compact) {
            blob = await compactThumbBlob(blob);
          }
          const objectUrl = URL.createObjectURL(blob);
          await warmDecodeObjectUrl(objectUrl);

          this.put(key, { url: objectUrl, bytes: Math.max(1, blob.size), isBlob: true });
          return objectUrl;
        } catch (err) {
          lastErr = err;
          if (attempt < maxRetries) {
            await sleep(attempt === 0 ? 320 : 850);
          }
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error('FETCH_FAILED');
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
    if (hit.isBlob) this.scheduleRevoke(hit.url);
  }

  clear() {
    for (const entry of this.entries.values()) {
      if (entry.isBlob) URL.revokeObjectURL(entry.url);
    }
    for (const url of this.pendingRevoke) {
      URL.revokeObjectURL(url);
    }
    this.entries.clear();
    this.inflight.clear();
    this.pins.clear();
    this.urlRefCounts.clear();
    this.pendingRevoke.clear();
    this.totalBytes = 0;
  }
}

const pageLru = new MemoryUrlLru(getPageBudgetBytes());
const thumbLru = new MemoryUrlLru(getThumbBudgetBytes());

// ── Priority Concurrency Queue for Thumbnails ──
interface ThumbJob {
  priority: 'high' | 'low';
  run: () => Promise<void>;
  signal?: AbortSignal;
}

const MAX_HIGH_CONCURRENCY = 4;
const MAX_LOW_CONCURRENCY = 2;
const highQueue: ThumbJob[] = [];
const lowQueue: ThumbJob[] = [];
let activeHigh = 0;
let activeLow = 0;

function pumpThumbQueue() {
  while (activeHigh < MAX_HIGH_CONCURRENCY && highQueue.length > 0) {
    // Take newest high-priority jobs first (LIFO) so fast scrolling renders visible cards first
    const job = highQueue.pop()!;
    if (job.signal?.aborted) continue;
    activeHigh++;
    void job.run().finally(() => {
      activeHigh--;
      pumpThumbQueue();
    });
  }

  // Only run low-priority background preloading when no high-priority user requests are waiting
  while (activeLow < MAX_LOW_CONCURRENCY && highQueue.length === 0 && activeHigh <= 1 && lowQueue.length > 0) {
    const job = lowQueue.shift()!;
    if (job.signal?.aborted) continue;
    activeLow++;
    void job.run().finally(() => {
      activeLow--;
      pumpThumbQueue();
    });
  }
}

function enqueueThumbJob(job: ThumbJob) {
  if (job.priority === 'high') highQueue.push(job);
  else lowQueue.push(job);
  pumpThumbQueue();
}

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
  return pageLru.acquire(makePageCacheKey(scope, fileId, page), remoteUrl, onAuthRejected, { retries: 1 });
}

export function invalidatePageCache(scope: string, fileId: string, page: number): void {
  pageLru.invalidate(makePageCacheKey(scope, fileId, page));
}

function makeThumbKey(scope: string, fileId: string, page: number): string {
  return `thumb:${makePageCacheKey(scope, fileId, page)}`;
}

export function getCachedThumbUrl(scope: string, fileId: string, page: number): string | null {
  return thumbLru.get(makeThumbKey(scope, fileId, page));
}

export function hasCachedThumbUrl(scope: string, fileId: string, page: number): boolean {
  return thumbLru.has(makeThumbKey(scope, fileId, page));
}

export function pinThumbUrl(scope: string, fileId: string, page: number): void {
  thumbLru.pin(makeThumbKey(scope, fileId, page));
}

export function unpinThumbUrl(scope: string, fileId: string, page: number): void {
  thumbLru.unpin(makeThumbKey(scope, fileId, page));
}

export function invalidateThumbCache(scope: string, fileId: string, page: number): void {
  thumbLru.invalidate(makeThumbKey(scope, fileId, page));
}

export function acquireThumbUrl(
  scope: string,
  fileId: string,
  page: number,
  remoteUrl: string,
  onAuthRejected?: () => Promise<string | null>,
  opts?: { priority?: 'high' | 'low'; fallbackUrl?: string; signal?: AbortSignal },
): Promise<string> {
  const key = makeThumbKey(scope, fileId, page);
  const cached = thumbLru.get(key);
  if (cached) return Promise.resolve(cached);

  if (remoteUrl.startsWith('data:')) {
    return thumbLru.acquire(key, remoteUrl);
  }

  return new Promise<string>((resolve, reject) => {
    if (opts?.signal?.aborted) {
      reject(new Error('ABORTED'));
      return;
    }
    enqueueThumbJob({
      priority: opts?.priority ?? 'high',
      signal: opts?.signal,
      run: async () => {
        if (opts?.signal?.aborted) {
          reject(new Error('ABORTED'));
          return;
        }
        try {
          const url = await thumbLru.acquire(key, remoteUrl, onAuthRejected, {
            compact: true,
            retries: opts?.priority === 'low' ? 1 : 2,
          });
          resolve(url);
        } catch (err) {
          const fb = opts?.fallbackUrl;
          if (fb && fb !== remoteUrl && !opts?.signal?.aborted) {
            try {
              const fbUrl = await thumbLru.acquire(key, fb, onAuthRejected, {
                compact: true,
                retries: 1,
              });
              resolve(fbUrl);
              return;
            } catch (err2) {
              reject(err2);
              return;
            }
          }
          reject(err);
        }
      },
    });
  });
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

export function prefetchThumbUrl(
  scope: string,
  fileId: string,
  page: number,
  remoteUrl: string,
  onAuthRejected?: () => Promise<string | null>,
  fallbackUrl?: string,
): void {
  const key = makeThumbKey(scope, fileId, page);
  if (thumbLru.has(key)) return;
  void acquireThumbUrl(scope, fileId, page, remoteUrl, onAuthRejected, {
    priority: 'low',
    fallbackUrl,
  }).catch(() => undefined);
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
  highQueue.length = 0;
  lowQueue.length = 0;
  pageLru.clear();
  thumbLru.clear();
  inkMemCache.clear();
}
