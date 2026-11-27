/** 🖋 لایهٔ دادهٔ حاشیه‌نویسی دیجیتال و همگام‌سازی آفلاین (Wave 5).
 *
 *  قواعد:
 *  - مدل وکتوری کانونی با مختصات نرمال‌شده [0.0, 1.0].
 *  - پایگاه دادهٔ محلی IndexedDB (hy_ink_db, v1) با دو Object Store:
 *      * ink_pages: کش وضعیت صفحات
 *      * ink_mutations: صف افزایشی تراکنش‌ها برای همگام‌سازی
 *  - fallback امن در صورت قفل/عدم دسترسی به IndexedDB (حالت خصوصی مرورگر).
 *  - همگام‌سازی دسته‌ای (تا ۵۰ جهش در هر درخواست) با حل تعارض LWW.
 *  - گوش‌به‌زنگ خودکار اتصال مجدد شبکه (online listener).
 */
import { apiCall } from './api';

export type Scope = 'res' | 'ref';
export type InkTool = 'pen' | 'pencil' | 'highlighter' | 'ballpoint' | 'fountain';

export interface Point {
  x: number;
  y: number;
  pressure: number;
  time: number;
  tiltX?: number;
  tiltY?: number;
}

export interface Stroke {
  stroke_id: string;
  tool: InkTool | 'eraser';
  color: string;
  width: number;
  opacity: number;
  blend_mode: 'source-over' | 'multiply';
  points: Point[];
  created_at: string;
  updated_at?: string;
  is_deleted?: boolean;
  timestamp?: number;
  nibAngle?: number;
}

export interface InkSummaryPage {
  page: number;
  count: number;
}

export interface NoteItem {
  scope: Scope;
  id: string;
  name: string;
  kind: string;
  pages: number;
  strokes: number;
  last_page: number;
  updated_at: string;
  available: boolean;
}

export interface StickyNote {
  note_id: string;
  page: number;
  x: number;
  y: number;
  text: string;
  color: 'yellow' | 'cyan' | 'green' | 'coral' | string;
  collapsed: boolean;
  created_at: string;
  updated_at?: string;
}

export interface PageRecord {
  page_key: string;
  scope: Scope;
  file_id: string;
  page: number;
  page_revision: number;
  strokes: Stroke[];
  notes?: StickyNote[];
  count: number;
  updated_at: string;
}

export interface InkMutation {
  mutation_id: string;
  scope: Scope;
  file_id: string;
  page: number;
  action: 'upsert_stroke' | 'delete_stroke' | 'clear_page' | 'upsert_note' | 'delete_note';
  stroke?: Stroke;
  note?: StickyNote;
  client_revision: number;
  timestamp: number;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
}

export function isValidPoint(p: Point): boolean {
  return (
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    Number.isFinite(p.pressure) &&
    p.x >= 0.0 &&
    p.x <= 1.0 &&
    p.y >= 0.0 &&
    p.y <= 1.0 &&
    p.pressure >= 0.0 &&
    p.pressure <= 1.0
  );
}

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getClientId(): string {
  try {
    let cid = localStorage.getItem('hy_client_id');
    if (!cid) {
      cid = generateUUID();
      localStorage.setItem('hy_client_id', cid);
    }
    return cid;
  } catch {
    return 'fallback_client';
  }
}

// ─────────────────────────────────────────────────────────────
//  📦 مخزن دادهٔ IndexedDB و Fallback
// ─────────────────────────────────────────────────────────────
const DB_NAME = 'hy_ink_db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase | null> | null = null;
let idbAvailable = true;

const memPages: Map<string, PageRecord> = new Map();
const memMutations: Map<string, InkMutation> = new Map();
let pendingCount = 0;

export async function openInkDB(): Promise<IDBDatabase | null> {
  if (!idbAvailable || typeof indexedDB === 'undefined') return null;
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('ink_pages')) {
          const pageStore = db.createObjectStore('ink_pages', { keyPath: 'page_key' });
          pageStore.createIndex('scope_file', ['scope', 'file_id'], { unique: false });
          pageStore.createIndex('updated_at', 'updated_at', { unique: false });
        }
        if (!db.objectStoreNames.contains('ink_mutations')) {
          const mutStore = db.createObjectStore('ink_mutations', { keyPath: 'mutation_id' });
          mutStore.createIndex('status_timestamp', ['status', 'timestamp'], { unique: false });
          mutStore.createIndex('page_key', ['scope', 'file_id', 'page'], { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        idbAvailable = false;
        resolve(null);
      };
      req.onblocked = () => {
        resolve(null);
      };
    } catch {
      idbAvailable = false;
      resolve(null);
    }
  });

  return dbPromise;
}

async function getPageFromDB(key: string): Promise<PageRecord | null> {
  try {
    const db = await openInkDB();
    if (!db) return memPages.get(key) ?? null;
    return new Promise((resolve) => {
      const tx = db.transaction('ink_pages', 'readonly');
      const store = tx.objectStore('ink_pages');
      const req = store.get(key);
      req.onsuccess = () => resolve((req.result as PageRecord) ?? null);
      req.onerror = () => resolve(memPages.get(key) ?? null);
    });
  } catch {
    return memPages.get(key) ?? null;
  }
}

async function savePageToDB(record: PageRecord): Promise<void> {
  memPages.set(record.page_key, record);
  try {
    const db = await openInkDB();
    if (!db) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('ink_pages', 'readwrite');
      const store = tx.objectStore('ink_pages');
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Fallback in memory is already updated
  }
}

async function addMutationToDB(mut: InkMutation): Promise<void> {
  memMutations.set(mut.mutation_id, mut);
  pendingCount = Array.from(memMutations.values()).filter((m) => m.status === 'pending').length;
  try {
    const db = await openInkDB();
    if (!db) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('ink_mutations', 'readwrite');
      const store = tx.objectStore('ink_mutations');
      const req = store.put(mut);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Fallback in memory
  }
}

async function getPendingMutationsFromDB(limit = 50): Promise<InkMutation[]> {
  try {
    const db = await openInkDB();
    if (!db) {
      return Array.from(memMutations.values())
        .filter((m) => m.status === 'pending')
        .slice(0, limit);
    }
    return new Promise((resolve) => {
      const tx = db.transaction('ink_mutations', 'readonly');
      const store = tx.objectStore('ink_mutations');
      const req = store.getAll();
      req.onsuccess = () => {
        const all = (req.result as InkMutation[]) || [];
        const pending = all.filter((m) => m.status === 'pending').slice(0, limit);
        resolve(pending);
      };
      req.onerror = () => {
        resolve(
          Array.from(memMutations.values())
            .filter((m) => m.status === 'pending')
            .slice(0, limit),
        );
      };
    });
  } catch {
    return Array.from(memMutations.values())
      .filter((m) => m.status === 'pending')
      .slice(0, limit);
  }
}

async function markMutationsSynced(mutationIds: string[]): Promise<void> {
  const set = new Set(mutationIds);
  for (const id of set) {
    const m = memMutations.get(id);
    if (m) m.status = 'synced';
  }
  pendingCount = Array.from(memMutations.values()).filter((m) => m.status === 'pending').length;

  try {
    const db = await openInkDB();
    if (!db) return;
    const tx = db.transaction('ink_mutations', 'readwrite');
    const store = tx.objectStore('ink_mutations');
    for (const id of set) {
      store.delete(id);
    }
  } catch {
    // Memory state is maintained
  }
}

// ─────────────────────────────────────────────────────────────
//  🌐 API & صف همگام‌سازی آفلاین
// ─────────────────────────────────────────────────────────────
let isFlushing = false;

export const inkPending = () => pendingCount;

export const ink = {
  page: async (scope: Scope, id: string, page: number) => {
    const key = `${scope}:${id}:${page}`;
    try {
      const res = await apiCall<{
        strokes: Stroke[];
        notes?: StickyNote[];
        page_revision?: number;
        count?: number;
        updated_at: string | null;
      }>(`/ink/${scope}/${encodeURIComponent(id)}/${page}`);

      const serverStrokes = res.strokes ?? [];
      const serverNotes = res.notes ?? [];
      const record: PageRecord = {
        page_key: key,
        scope,
        file_id: id,
        page,
        page_revision: res.page_revision ?? 1,
        strokes: serverStrokes,
        notes: serverNotes,
        count: res.count ?? serverStrokes.length,
        updated_at: res.updated_at ?? new Date().toISOString(),
      };
      await savePageToDB(record);
      return {
        strokes: serverStrokes,
        notes: serverNotes,
        page_revision: res.page_revision ?? 1,
        updated_at: res.updated_at,
      };
    } catch {
      // حالت آفلاین: بازیابی از IndexedDB یا حافظه
      const cached = await getPageFromDB(key);
      if (cached) {
        return {
          strokes: cached.strokes,
          notes: cached.notes ?? [],
          page_revision: cached.page_revision,
          updated_at: cached.updated_at,
        };
      }
      return { strokes: [], notes: [], page_revision: 0, updated_at: null };
    }
  },

  summary: (scope: Scope, id: string) =>
    apiCall<{ pages: InkSummaryPage[]; total: number }>(
      `/ink/summary/${scope}/${encodeURIComponent(id)}`,
    ),

  notes: () => apiCall<{ items: NoteItem[] }>('/ink/notes'),

  /** ذخیره با IndexedDB و همگام‌سازی دسته‌ای */
  save: async (scope: Scope, id: string, page: number, strokes?: Stroke[] | null, notes?: StickyNote[]) => {
    const key = `${scope}:${id}:${page}`;
    const prev = await getPageFromDB(key);
    const rev = (prev?.page_revision ?? 0) + 1;
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const prevStrokes = prev?.strokes ?? [];
    const prevNotes = prev?.notes ?? [];
    const actualStrokes = strokes !== undefined && strokes !== null ? strokes : prevStrokes;
    const actualNotes = notes !== undefined ? notes : prevNotes;

    const record: PageRecord = {
      page_key: key,
      scope,
      file_id: id,
      page,
      page_revision: rev,
      strokes: actualStrokes,
      notes: actualNotes,
      count: actualStrokes.length,
      updated_at: nowIso,
    };
    await savePageToDB(record);

    // ساخت جهش‌ها برای صف آفلاین
    if (actualStrokes.length === 0 && actualNotes.length === 0) {
      if (prevStrokes.length > 0 || prevNotes.length > 0) {
        const mut: InkMutation = {
          mutation_id: generateUUID(),
          scope,
          file_id: id,
          page,
          action: 'clear_page',
          client_revision: rev,
          timestamp: nowMs,
          status: 'pending',
        };
        await addMutationToDB(mut);
      }
    } else {
      if (strokes !== undefined && strokes !== null) {
        const prevStrokeMap = new Map<string, Stroke>();
        for (const s of prevStrokes) prevStrokeMap.set(s.stroke_id, s);
        const currentStrokeMap = new Map<string, Stroke>();
        for (const s of actualStrokes) currentStrokeMap.set(s.stroke_id, s);

        // 1. New or modified strokes -> upsert_stroke
        for (const s of actualStrokes) {
          const prevS = prevStrokeMap.get(s.stroke_id);
          const isNew = !prevS;
          const isModified = prevS && (
            s.updated_at !== prevS.updated_at ||
            s.points.length !== prevS.points.length ||
            (s.points.length > 0 && prevS.points.length > 0 &&
              (s.points[0].x !== prevS.points[0].x || s.points[0].y !== prevS.points[0].y))
          );
          if (isNew || isModified) {
            const mut: InkMutation = {
              mutation_id: generateUUID(),
              scope,
              file_id: id,
              page,
              action: 'upsert_stroke',
              stroke: s,
              client_revision: rev,
              timestamp: nowMs,
              status: 'pending',
            };
            await addMutationToDB(mut);
          }
        }

        // 2. Erased/removed strokes -> delete_stroke
        for (const prevS of prevStrokes) {
          if (!currentStrokeMap.has(prevS.stroke_id)) {
            const mut: InkMutation = {
              mutation_id: generateUUID(),
              scope,
              file_id: id,
              page,
              action: 'delete_stroke',
              stroke: prevS,
              client_revision: rev,
              timestamp: nowMs,
              status: 'pending',
            };
            await addMutationToDB(mut);
          }
        }
      }

      if (notes !== undefined) {
        const prevNoteMap = new Map<string, StickyNote>();
        for (const n of prevNotes) prevNoteMap.set(n.note_id, n);
        const currentNoteMap = new Map<string, StickyNote>();
        for (const n of actualNotes) currentNoteMap.set(n.note_id, n);

        for (const n of actualNotes) {
          const prevN = prevNoteMap.get(n.note_id);
          const isNew = !prevN;
          const isModified = prevN && (
            n.text !== prevN.text ||
            n.x !== prevN.x ||
            n.y !== prevN.y ||
            n.color !== prevN.color ||
            n.collapsed !== prevN.collapsed ||
            n.updated_at !== prevN.updated_at
          );
          if (isNew || isModified) {
            const mut: InkMutation = {
              mutation_id: generateUUID(),
              scope,
              file_id: id,
              page,
              action: 'upsert_note',
              note: n,
              client_revision: rev,
              timestamp: nowMs,
              status: 'pending',
            };
            await addMutationToDB(mut);
          }
        }

        for (const prevN of prevNotes) {
          if (!currentNoteMap.has(prevN.note_id)) {
            const mut: InkMutation = {
              mutation_id: generateUUID(),
              scope,
              file_id: id,
              page,
              action: 'delete_note',
              note: prevN,
              client_revision: rev,
              timestamp: nowMs,
              status: 'pending',
            };
            await addMutationToDB(mut);
          }
        }
      }
    }

    // ارسال به شبکه
    try {
      const synced = await ink.flush();
      if (synced > 0) {
        return { ok: true, queued: false };
      }
      // اگر از طریق batch خالی ماند، fallback مستقیم PUT را بیازما
      await apiCall<{ ok: boolean }>(`/ink/${scope}/${encodeURIComponent(id)}/${page}`, {
        method: 'PUT',
        body: JSON.stringify({ strokes: actualStrokes, notes: actualNotes }),
      });
      return { ok: true, queued: false };
    } catch {
      return { ok: false, queued: true };
    }
  },

  clearPage: async (scope: Scope, id: string, page: number) => {
    const key = `${scope}:${id}:${page}`;
    const nowMs = Date.now();
    const mut: InkMutation = {
      mutation_id: generateUUID(),
      scope,
      file_id: id,
      page,
      action: 'clear_page',
      client_revision: 0,
      timestamp: nowMs,
      status: 'pending',
    };
    await addMutationToDB(mut);

    const record: PageRecord = {
      page_key: key,
      scope,
      file_id: id,
      page,
      page_revision: 0,
      strokes: [],
      notes: [],
      count: 0,
      updated_at: new Date().toISOString(),
    };
    await savePageToDB(record);

    try {
      await apiCall<{ ok: boolean }>(`/ink/${scope}/${encodeURIComponent(id)}/${page}`, {
        method: 'DELETE',
      });
    } catch {
      // آفلاین: جهش در صف باقی می‌ماند
    }
  },

  /** ارسال جهش‌های صف‌بندی‌شده به سرور در بسته‌های تا ۵۰تایی */
  flush: async () => {
    if (isFlushing) return 0;
    isFlushing = true;
    let totalSynced = 0;
    try {
      while (true) {
        const mutations = await getPendingMutationsFromDB(50);
        if (mutations.length === 0) break;

        const payload = {
          client_id: getClientId(),
          mutations: mutations.map((m) => ({
            mutation_id: m.mutation_id,
            scope: m.scope,
            file_id: m.file_id,
            page: m.page,
            action: m.action,
            stroke: m.stroke,
            note: m.note,
            client_revision: m.client_revision,
            timestamp: m.timestamp,
          })),
        };

        const res = await apiCall<{
          processed: number;
          successful_ids: string[];
          conflicts: Array<{ mutation_id: string; reason: string }>;
          server_timestamp: string;
        }>('/ink/sync', {
          method: 'POST',
          body: JSON.stringify(payload),
        });

        if (res && Array.isArray(res.successful_ids) && res.successful_ids.length > 0) {
          await markMutationsSynced(res.successful_ids);
          totalSynced += res.successful_ids.length;
          // If fewer mutations were processed than requested or less than 50 in batch, stop
          if (res.successful_ids.length < mutations.length || mutations.length < 50) {
            break;
          }
        } else {
          break;
        }
      }
      return totalSynced;
    } catch {
      return totalSynced;
    } finally {
      isFlushing = false;
    }
  },
};

/** مدیریت نشان‌شده‌ها (Bookmarks) با ماندگاری در فضای محلی */
export const bookmarks = {
  get: (scope: Scope, id: string): number[] => {
    try {
      const raw = localStorage.getItem(`hy_bm_${scope}_${id}`);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },
  toggle: (scope: Scope, id: string, page: number): boolean => {
    try {
      const current = bookmarks.get(scope, id);
      const exists = current.includes(page);
      const next = exists ? current.filter((p) => p !== page) : [...current, page].sort((a, b) => a - b);
      localStorage.setItem(`hy_bm_${scope}_${id}`, JSON.stringify(next));
      return !exists;
    } catch {
      return false;
    }
  },
  isBookmarked: (scope: Scope, id: string, page: number): boolean => {
    return bookmarks.get(scope, id).includes(page);
  },
};

// ── Pages the student inserted between handout pages ─────────
export type PageTemplate = 'blank' | 'ruled' | 'grid' | 'dotted';

export interface InsertedPage {
  id: string;
  /** Ink of this page is stored as page `slot` of {@link insertedInkId}. */
  slot: number;
  /** Handout page it follows; entries with the same `after` keep their array order. */
  after: number;
  template: PageTemplate;
  created_at: string;
}

const PAGE_TEMPLATE_IDS: PageTemplate[] = ['blank', 'ruled', 'grid', 'dotted'];

/** Ink of inserted pages lives under its own file id, so page numbers never collide with the PDF's. */
export const insertedInkId = (id: string) => `${id}~p`;

interface InsertsRecord {
  pages: InsertedPage[];
  /** A local change the server has not confirmed yet (offline edit). */
  dirty: boolean;
}

const insertsKey = (scope: Scope, id: string) => `hy_ins_${scope}_${id}`;

function cleanInserts(raw: unknown): InsertedPage[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: InsertedPage[] = [];
  for (const p of raw as Partial<InsertedPage>[]) {
    if (!p || typeof p.id !== 'string' || seen.has(p.id)) continue;
    const slot = Number(p.slot);
    const after = Number(p.after);
    if (!Number.isInteger(slot) || slot < 1 || !Number.isInteger(after) || after < 0) continue;
    seen.add(p.id);
    out.push({
      id: p.id,
      slot,
      after,
      template: PAGE_TEMPLATE_IDS.includes(p.template as PageTemplate) ? (p.template as PageTemplate) : 'blank',
      created_at: typeof p.created_at === 'string' ? p.created_at : new Date().toISOString(),
    });
  }
  return out;
}

function readInserts(scope: Scope, id: string): InsertsRecord {
  try {
    const raw = localStorage.getItem(insertsKey(scope, id));
    if (!raw) return { pages: [], dirty: false };
    const parsed = JSON.parse(raw) as { pages?: unknown; dirty?: unknown };
    return { pages: cleanInserts(parsed.pages), dirty: parsed.dirty === true };
  } catch {
    return { pages: [], dirty: false };
  }
}

function writeInserts(scope: Scope, id: string, rec: InsertsRecord): void {
  try {
    localStorage.setItem(insertsKey(scope, id), JSON.stringify(rec));
  } catch {
    // storage full / private mode: the server copy still holds it
  }
}

export const insertedPages = {
  /** Instant local copy, for the first render. */
  get: (scope: Scope, id: string): InsertedPage[] => readInserts(scope, id).pages,

  /** Server copy wins, unless this device holds an unsynced edit, which is pushed up instead. */
  load: async (scope: Scope, id: string): Promise<InsertedPage[]> => {
    const local = readInserts(scope, id);
    if (local.dirty) {
      await insertedPages.save(scope, id, local.pages);
      return local.pages;
    }
    try {
      const res = await apiCall<{ pages?: unknown }>(`/ink/inserts/${scope}/${encodeURIComponent(id)}`);
      const pages = cleanInserts(res?.pages);
      writeInserts(scope, id, { pages, dirty: false });
      return pages;
    } catch {
      return local.pages;
    }
  },

  save: async (scope: Scope, id: string, pages: InsertedPage[]): Promise<boolean> => {
    writeInserts(scope, id, { pages, dirty: true });
    try {
      await apiCall<{ ok: boolean }>(`/ink/inserts/${scope}/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify({ pages }),
      });
      writeInserts(scope, id, { pages, dirty: false });
      return true;
    } catch {
      return false;
    }
  },
};

// ── گوش‌به‌زنگ اتصال مجدد اینترنت ──────────────────────────────
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void ink.flush();
  });
}
