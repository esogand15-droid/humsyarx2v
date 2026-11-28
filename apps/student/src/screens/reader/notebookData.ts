import { useEffect, useState } from 'react';

import { faNum } from '../../lib/fa';
import { bookmarks, ink, insertedInkId, type InkSummaryPage, type Scope } from '../../lib/ink';
import { voiceNotes } from '../../lib/voiceNotes';

/** انواع آیتم‌های کلیک‌پذیر دفتر — «خودِ یادداشت»، نه شمار خطوط */
export type NotebookItemKind = 'highlight' | 'note' | 'voice' | 'bookmark';

export interface NotebookItem {
  key: string;
  kind: NotebookItemKind;
  page: number;
  /** صفحهٔ افزوده (ذایلِ جوهریِ «~p») */
  inserted: boolean;
  at?: { x: number; y: number };
  color?: string;
  text?: string;
  durationMs?: number;
}

export interface NotebookIndexState {
  state: 'loading' | 'ready' | 'error';
  items: NotebookItem[];
  pages: InkSummaryPage[];
}

/** مدت ویس به شکل «۰:۴۲» با ارقام فارسی — مشترک میان دفتر و نقشهٔ ذهنی */
export function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return faNum(`${m}:${String(s).padStart(2, '0')}`);
}

// ── گره‌های دستی نقشهٔ ذهنی ─────────────────────────────────
// بدون page/x/y → فقط درخت پنل کناری؛ با page+x/y → سنجاق‌شده روی خود صفحهٔ PDF
export interface MindNodeRec {
  id: string;
  parent: string; // 'root' | 'auto:<key>' | 'man:<uuid>'
  text: string;
  page?: number;
  x?: number;
  y?: number;
}

const mindKey = (scope: Scope, id: string) => `hz.mindmap_${scope}_${id}`;

export function loadMindNodes(scope: Scope, id: string): MindNodeRec[] {
  try {
    const raw = localStorage.getItem(mindKey(scope, id));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { nodes?: unknown };
    if (!Array.isArray(parsed.nodes)) return [];
    const out: MindNodeRec[] = [];
    const seen = new Set<string>();
    for (const n of parsed.nodes as Partial<MindNodeRec>[]) {
      if (!n || typeof n.id !== 'string' || typeof n.parent !== 'string' || seen.has(n.id)) continue;
      seen.add(n.id);
      const rec: MindNodeRec = { id: n.id, parent: n.parent, text: typeof n.text === 'string' ? n.text : '' };
      const page = Number(n.page);
      if (Number.isInteger(page) && page > 0) rec.page = page;
      const x = Number(n.x);
      const y = Number(n.y);
      if (Number.isFinite(x) && x >= 0 && x <= 1) rec.x = x;
      if (Number.isFinite(y) && y >= 0 && y <= 1) rec.y = y;
      out.push(rec);
    }
    return out;
  } catch {
    return [];
  }
}

export function saveMindNodes(scope: Scope, id: string, nodes: MindNodeRec[]): void {
  try {
    localStorage.setItem(mindKey(scope, id), JSON.stringify({ v: 1, nodes }));
  } catch {
    // حافظهٔ مرورگر پر است — گره‌ها فقط همین دستگاه می‌مانند
  }
}

/** دادهٔ دفترِ یک فایل: هایلایت‌ها با جا، یادداشت‌ها با متن، ویس‌ها با پین، نشان‌ها.
 *
 *  منبع: «/ink/notebook» برای صفحهٔ اصلی و صفحات افزوده + «/ink/voice» + نشان‌های محلی.
 *  شکستِ هر منبع بقیه را نمی‌اندازد (Promise.allSettled) تا دفتر آفلاین هم هرچه دارد نشان بدهد.
 */
export function useNotebookIndex(scope: Scope, id: string, enabled: boolean, refreshKey: number): NotebookIndexState {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [items, setItems] = useState<NotebookItem[]>([]);
  const [pages, setPages] = useState<InkSummaryPage[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState('loading');
    (async () => {
      try {
        const [mainRes, insRes, voiceRes, voiceInsRes] = await Promise.allSettled([
          ink.notebook(scope, id),
          ink.notebook(scope, insertedInkId(id)),
          voiceNotes.list(scope, id),
          voiceNotes.list(scope, insertedInkId(id)),
        ]);
        if (cancelled) return;

        const next: NotebookItem[] = [];
        const main = mainRes.status === 'fulfilled' ? mainRes.value : null;
        const ins = insRes.status === 'fulfilled' ? insRes.value : null;
        const voiceLists = [
          voiceRes.status === 'fulfilled' ? voiceRes.value : [],
          voiceInsRes.status === 'fulfilled' ? voiceInsRes.value : [],
        ];
        const seenVoices = new Set<string>();
        for (const list of voiceLists) {
          for (const v of list) {
            if (seenVoices.has(v.voice_id)) continue;
            seenVoices.add(v.voice_id);
            next.push({
              key: `voice:${v.voice_id}`,
              kind: 'voice',
              page: v.page,
              inserted: v.file_id.endsWith('~p'),
              at: { x: v.x, y: v.y },
              durationMs: v.duration_ms,
            });
          }
        }

        for (const h of main?.highlights ?? []) {
          next.push({
            key: `hl:${h.stroke_id}`,
            kind: 'highlight',
            page: h.page,
            inserted: false,
            at: { x: (h.bbox[0] + h.bbox[2]) / 2, y: (h.bbox[1] + h.bbox[3]) / 2 },
            color: h.color,
          });
        }
        for (const h of ins?.highlights ?? []) {
          next.push({
            key: `hl:${h.stroke_id}`,
            kind: 'highlight',
            page: h.page,
            inserted: true,
            at: { x: (h.bbox[0] + h.bbox[2]) / 2, y: (h.bbox[1] + h.bbox[3]) / 2 },
            color: h.color,
          });
        }
        for (const n of main?.notes ?? []) {
          next.push({
            key: `note:${n.note_id}`,
            kind: 'note',
            page: n.page,
            inserted: false,
            at: { x: n.x, y: n.y },
            color: n.color,
            text: n.text,
          });
        }
        for (const n of ins?.notes ?? []) {
          next.push({
            key: `note:${n.note_id}`,
            kind: 'note',
            page: n.page,
            inserted: true,
            at: { x: n.x, y: n.y },
            color: n.color,
            text: n.text,
          });
        }
        // نشان‌ها فعلاً محلی (localStorage) هستند — آگاه از سمت سرور همگام نمی‌شوند
        for (const p of bookmarks.get(scope, id)) {
          next.push({ key: `bm:${p}`, kind: 'bookmark', page: p, inserted: false });
        }

        setItems(next);
        setPages(main?.pages ?? []);
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope, id, enabled, refreshKey]);

  return { state, items, pages };
}
