import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Icon } from '../../icons';
import { fa } from '../../lib/fa';
import { generateUUID, type Scope } from '../../lib/ink';
import {
  fmtDuration,
  loadMindNodes,
  saveMindNodes,
  useNotebookIndex,
  type MindNodeRec,
  type NotebookItem,
} from './notebookData';
import './mindmap.css';

interface Props {
  scope: Scope;
  id: string;
  /** عنوان فایل — گرهٔ ریشهٔ نقشه */
  title: string;
  page: number;
  open: boolean;
  onClose: () => void;
  /** پرش به صفحهٔ منبع از روی یک برگ/شاخه */
  onJump: (page: number, at?: { x: number; y: number }) => void;
  refreshKey: number;
  hideHeader?: boolean;
}

type NodeKind = 'root' | 'page' | 'highlight' | 'note' | 'voice' | 'bookmark' | 'manual';

interface MindNode {
  id: string;
  parent: string;
  text: string;
  kind: NodeKind;
  page?: number;
  inserted?: boolean;
  at?: { x: number; y: number };
  color?: string;
  manual: boolean;
}

const leafLabel = (it: NotebookItem): string => {
  if (it.kind === 'highlight') return 'هایلایت';
  if (it.kind === 'voice') return `ویس ${fmtDuration(it.durationMs ?? 0)}`;
  if (it.kind === 'bookmark') return 'نشان‌شده';
  return (it.text ?? '').trim() || 'یادداشت';
};

// ── هندسهٔ درخت (RTL: ریشه راست، شاخه‌ها به چپ) ──────────────
const COL_W = 246;
const NODE_W = 192;
const ROOT_W = 210;
const NODE_H = 40;
const GAP_Y = 10;

interface PlacedNode {
  id: string;
  x: number;
  y: number;
  w: number;
  node: MindNode;
  childCount: number;
  collapsed: boolean;
  depth: number;
}

interface Edge {
  d: string;
}

interface TreeLayout {
  nodes: PlacedNode[];
  edges: Edge[];
  width: number;
  height: number;
}

/** نقشهٔ ذهنی XMind-مانند — به‌طور خودکار از هایلایت‌ها/یادداشت‌ها/ویس‌ها/نشان‌ها ساخته می‌شود
 *  و گره‌های دستی دانشجو روی همان شاخه‌ها می‌روید. کلیک روی برگ = پرش به منبع. */
export function MindMapPanel({ scope, id, title, page, open, onClose, onJump, refreshKey, hideHeader = false }: Props) {
  const { state, items } = useNotebookIndex(scope, id, open, refreshKey);
  const [manual, setManual] = useState<MindNodeRec[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [tf, setTf] = useState({ x: 0, y: 0, k: 1 });
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  /** تا وقتی false است، هر تغییر چیدمان بوم را دوباره وسط‌چین می‌کند؛ با اولین پن/زوم قفل می‌شود */
  const userMovedRef = useRef(false);
  const [recenterSeq, setRecenterSeq] = useState(0);

  // گره‌های دستی فقط برای فایلِ بازِ همین پنل خوانده می‌شوند
  useEffect(() => {
    if (open) setManual(loadMindNodes(scope, id));
  }, [open, scope, id]);

  // ── ساخت گره‌ها: ریشه ← صفحات ← آیتم‌ها + گره‌های دستی ─────────
  const nodes = useMemo<MindNode[]>(() => {
    const list: MindNode[] = [{ id: 'root', parent: '', text: title, kind: 'root', manual: false }];
    const byPage = new Map<string, { page: number; inserted: boolean; items: NotebookItem[] }>();
    for (const it of items) {
      const gk = `${it.inserted ? 'i' : 'p'}:${it.page}`;
      let g = byPage.get(gk);
      if (!g) {
        g = { page: it.page, inserted: it.inserted, items: [] };
        byPage.set(gk, g);
      }
      g.items.push(it);
    }
    const groups = [...byPage.values()].sort((a, b) =>
      a.inserted === b.inserted ? a.page - b.page : a.inserted ? 1 : -1,
    );
    for (const g of groups) {
      const pid = `auto:page:${g.inserted ? 'i' : 'p'}:${g.page}`;
      list.push({
        id: pid,
        parent: 'root',
        text: `صفحهٔ ${fa(g.page)}`,
        kind: 'page',
        page: g.page,
        inserted: g.inserted,
        manual: false,
      });
      for (const it of g.items) {
        list.push({
          id: `auto:${it.key}`,
          parent: pid,
          text: leafLabel(it),
          kind: it.kind,
          page: it.page,
          inserted: it.inserted,
          at: it.at,
          color: it.color,
          manual: false,
        });
      }
    }
    const known = new Set(list.map((n) => n.id));
    for (const m of manual) {
      // والدِ از بین رفته (مثلاً هایلایتی که پاک شده) به ریشه برمی‌گردد — گره دستی هرگز گم نمی‌شود
      const parent = m.parent === 'root' || known.has(m.parent) ? m.parent : 'root';
      list.push({ id: `man:${m.id}`, parent, text: m.text, kind: 'manual', manual: true });
    }
    return list;
  }, [items, title, manual]);

  // ── چیدمان عمودی فشردهٔ درخت ────────────────────────────────
  const layout = useMemo<TreeLayout>(() => {
    const children = new Map<string, MindNode[]>();
    const byId = new Map<string, MindNode>();
    for (const n of nodes) {
      byId.set(n.id, n);
      if (n.parent) {
        const arr = children.get(n.parent) ?? [];
        arr.push(n);
        children.set(n.parent, arr);
      }
    }
    const placed = new Map<string, { x: number; y: number; w: number }>();
    const ordered: PlacedNode[] = [];
    let maxDepth = 0;
    let totalH = NODE_H;

    const walk = (nodeId: string, depth: number, top: number, seen: Set<string>): number => {
      const node = byId.get(nodeId);
      if (!node || seen.has(nodeId)) return NODE_H + GAP_Y;
      seen.add(nodeId);
      maxDepth = Math.max(maxDepth, depth);
      const kids = collapsed.has(nodeId) ? [] : children.get(nodeId) ?? [];
      const w = node.kind === 'root' ? ROOT_W : NODE_W;
      let h = NODE_H + GAP_Y;
      if (kids.length > 0) {
        let cursor = top;
        for (const k of kids) cursor += walk(k.id, depth + 1, cursor, seen);
        h = Math.max(h, cursor - top);
      }
      placed.set(nodeId, { x: -(depth * COL_W), y: top + h / 2 - NODE_H / 2, w });
      ordered.push({
        id: nodeId,
        x: 0,
        y: top + h / 2 - NODE_H / 2,
        w,
        node,
        childCount: children.get(nodeId)?.length ?? 0,
        collapsed: collapsed.has(nodeId),
        depth,
      });
      return h;
    };
    totalH = walk('root', 0, 0, new Set());

    // جابه‌جایی به مختصات مثبت بوم — عمیق‌ترین شاخه سمت چپ می‌نشیند
    const offX = maxDepth * COL_W + 32;
    for (const pos of placed.values()) pos.x += offX;
    for (const p of ordered) {
      const raw = placed.get(p.id)!;
      p.x = raw.x;
    }

    const edges: Edge[] = [];
    for (const n of nodes) {
      if (!n.parent) continue;
      const p = placed.get(n.parent);
      const c = placed.get(n.id);
      if (!p || !c) continue;
      const x1 = p.x;
      const y1 = p.y + NODE_H / 2;
      const x2 = c.x + c.w;
      const y2 = c.y + NODE_H / 2;
      const mx = (x1 + x2) / 2;
      edges.push({ d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}` });
    }

    return {
      nodes: ordered,
      edges,
      width: offX + ROOT_W + 32,
      height: Math.max(totalH, NODE_H + GAP_Y),
    };
  }, [nodes, collapsed]);

  // ── سنجاق خودکار: تا وقتی کاربر بوم را تکون نداده، ریشه سمت راست و کل درخت در قاب ──
  useEffect(() => {
    if (!open || userMovedRef.current) return;
    const vp = viewportRef.current;
    if (!vp || vp.clientWidth === 0) return;
    const w = vp.clientWidth;
    const h = vp.clientHeight;
    // فیت دو-محوره ولی با کفِ خوانایی: در بوم باریک، به‌جای ریزشدن متن، پن دست کاربره
    const k = Math.max(
      0.75,
      Math.min(1, (w - 56) / Math.max(1, layout.width), (h - 48) / Math.max(1, layout.height)),
    );
    setTf({
      x: w - 20 - (layout.width - 32) * k,
      y: Math.max(14, (h - layout.height * k) / 2),
      k,
    });
  }, [open, layout, recenterSeq]);

  // ── پن با کشیدن + زوم با دو انگشت و Ctrl+چرخ ماوس ────────────
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchBase = useRef<{ dist: number; k: number } | null>(null);
  const panBase = useRef<{ px: number; py: number; tx: number; ty: number } | null>(null);

  const onBackgroundPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // روی گره/دکمه پن شروع نشود — setPointerCapture کلیک آن المان را می‌دزدد
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, input, .mm-node')) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchBase.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), k: tf.k };
      panBase.current = null;
    } else if (pointers.current.size === 1) {
      panBase.current = { px: e.clientX, py: e.clientY, tx: tf.x, ty: tf.y };
    }
  }, [tf]);

  const onBackgroundPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const vp = viewportRef.current;
      if (pointers.current.size === 2 && pinchBase.current && vp) {
        userMovedRef.current = true;
        const [a, b] = [...pointers.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const k = Math.max(0.3, Math.min(2.4, pinchBase.current.k * (dist / Math.max(1, pinchBase.current.dist))));
        const rect = vp.getBoundingClientRect();
        const cx = ((a.x + b.x) / 2 - rect.left);
        const cy = ((a.y + b.y) / 2 - rect.top);
        setTf((prev) => {
          const ratio = k / prev.k;
          return { k, x: cx - (cx - prev.x) * ratio, y: cy - (cy - prev.y) * ratio };
        });
        return;
      }
      if (panBase.current) {
        userMovedRef.current = true;
        setTf((prev) => ({
          ...prev,
          x: panBase.current!.tx + (e.clientX - panBase.current!.px),
          y: panBase.current!.ty + (e.clientY - panBase.current!.py),
        }));
      }
    },
    [],
  );

  const onBackgroundPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchBase.current = null;
    if (pointers.current.size === 0) panBase.current = null;
  }, []);

  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const vp = viewportRef.current;
    if (!vp) return;
    userMovedRef.current = true;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setTf((prev) => {
        const k = Math.max(0.3, Math.min(2.4, prev.k * (e.deltaY < 0 ? 1.08 : 0.93)));
        const ratio = k / prev.k;
        return { k, x: cx - (cx - prev.x) * ratio, y: cy - (cy - prev.y) * ratio };
      });
      return;
    }
    setTf((prev) => ({ ...prev, x: prev.x - e.deltaX, y: prev.y - e.deltaY }));
  }, []);

  const zoomBy = (factor: number) => {
    const vp = viewportRef.current;
    if (!vp) return;
    userMovedRef.current = true;
    const rect = vp.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    setTf((prev) => {
      const k = Math.max(0.3, Math.min(2.4, prev.k * factor));
      const ratio = k / prev.k;
      return { k, x: cx - (cx - prev.x) * ratio, y: cy - (cy - prev.y) * ratio };
    });
  };

  // ── عملیات گره‌های دستی ──────────────────────────────────────
  const selected = nodes.find((n) => n.id === selectedId) ?? null;

  const persistManual = (next: MindNodeRec[]) => {
    setManual(next);
    saveMindNodes(scope, id, next);
  };

  const addChild = () => {
    const parentId = selectedId ?? 'root';
    const rec: MindNodeRec = { id: generateUUID(), parent: parentId, text: '' };
    persistManual([...manual, rec]);
    setSelectedId(`man:${rec.id}`);
    setEditing({ id: `man:${rec.id}`, value: '' });
  };

  const startEdit = () => {
    if (!selected?.manual) return;
    setEditing({ id: selected.id, value: selected.text });
  };

  const commitEdit = () => {
    if (!editing) return;
    const rawId = editing.id.slice(4); // «man:» را می‌برد
    persistManual(manual.map((m) => (m.id === rawId ? { ...m, text: editing.value.trim() } : m)));
    setEditing(null);
  };

  const deleteNode = () => {
    if (!selected?.manual) return;
    const doomed = new Set<string>([selected.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const m of manual) {
        if (doomed.has(`man:${m.id}`)) continue;
        if (doomed.has(m.parent) || doomed.has(`man:${m.parent}`)) {
          doomed.add(`man:${m.id}`);
          grew = true;
        }
      }
    }
    persistManual(manual.filter((m) => !doomed.has(`man:${m.id}`)));
    setSelectedId(null);
  };

  const toggleCollapse = (nodeId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const jumpFrom = (node: MindNode) => {
    if (typeof node.page === 'number' && node.page > 0) onJump(node.page, node.at);
  };

  // فوکوس خودکار ورودی ویرایش
  useEffect(() => {
    if (editing) editInputRef.current?.focus();
  }, [editing]);

  if (!open) return null;

  const canJump = (n: MindNode | null): boolean =>
    !!n && typeof n.page === 'number' && n.page > 0;

  return (
    <aside className="notebook mindmap" aria-label="نقشهٔ ذهنی این فایل">
      {!hideHeader && (
        <div className="notebook__head">
          <span className="h3">نقشهٔ ذهنی</span>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="بستن نقشهٔ ذهنی">
            <Icon name="i-x" size={16} />
          </button>
        </div>
      )}

      {state === 'loading' && <p className="small">در حال ساخت نقشه…</p>}

      {state === 'error' && (
        <p className="small" role="alert">
          نقشه ساخته نشد. اتصال را بررسی کن.
        </p>
      )}

      {state === 'ready' && (
        <>
          <div
            className="mm-viewport"
            ref={viewportRef}
            onPointerDown={onBackgroundPointerDown}
            onPointerMove={onBackgroundPointerMove}
            onPointerUp={onBackgroundPointerUp}
            onPointerCancel={onBackgroundPointerUp}
            onWheel={onWheel}
            role="application"
            aria-label="بوم نقشهٔ ذهنی — برای جابه‌جایی بکش"
          >
            <div
              className="mm-canvas"
              style={{ width: layout.width, height: layout.height, transform: `translate(${tf.x}px, ${tf.y}px) scale(${tf.k})` }}
            >
              <svg className="mm-edges" width={layout.width} height={layout.height} aria-hidden="true">
                {layout.edges.map((e, i) => (
                  <path key={i} d={e.d} />
                ))}
              </svg>
              {layout.nodes.map((pl) => {
                const n = pl.node;
                const isSel = n.id === selectedId;
                const isNow = n.kind === 'page' && !n.inserted && n.page === page;
                return (
                  <div
                    key={n.id}
                    className={[
                      'mm-node',
                      `mm-node--${n.kind}`,
                      isSel ? 'is-sel' : '',
                      isNow ? 'is-now' : '',
                    ].join(' ')}
                    style={{ left: pl.x, top: pl.y, width: pl.w }}
                    data-node={n.id}
                  >
                    {pl.childCount > 0 && (
                      <button
                        type="button"
                        className="mm-node__fold num"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCollapse(n.id);
                        }}
                        aria-label={pl.collapsed ? 'باز کردن شاخه' : 'بستن شاخه'}
                      >
                        {pl.collapsed ? '…' : fa(pl.childCount)}
                      </button>
                    )}
                    <button
                      type="button"
                      className="mm-node__body"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedId(isSel ? null : n.id);
                      }}
                      title={n.text}
                    >
                      {n.kind === 'highlight' && (
                        <span className="mm-dot" style={{ background: n.color || '#F59E0B' }} aria-hidden="true" />
                      )}
                      {n.kind === 'note' && <span className="mm-dot mm-dot--note" aria-hidden="true" />}
                      {n.kind === 'voice' && <Icon name="i-mic" size={12} />}
                      {n.kind === 'bookmark' && <Icon name="i-star" size={12} />}
                      <span className="mm-node__text">{n.text}</span>
                    </button>
                  </div>
                );
              })}
            </div>

            {/* کنترل زوم — گوشهٔ بوم */}
            <div className="mm-zoom" aria-label="زوم نقشه" onPointerDown={(e) => e.stopPropagation()}>
              <button type="button" className="iconbtn" onClick={() => zoomBy(0.85)} aria-label="کوچک‌نمایی">
                −
              </button>
              <button
                type="button"
                className="iconbtn"
                onClick={() => {
                  userMovedRef.current = false;
                  setRecenterSeq((s) => s + 1);
                }}
                aria-label="وسط‌چین نقشه"
              >
                <Icon name="i-target" size={14} />
              </button>
              <button type="button" className="iconbtn" onClick={() => zoomBy(1.18)} aria-label="بزرگ‌نمایی">
                +
              </button>
            </div>
          </div>

          {nodes.length === 1 && (
            <div className="notebook__empty">
              <p className="small">نقشه خالی است.</p>
              <p className="tiny mt-8">هایلایت و یادداشت که بنویسی، شاخه‌ها خودکار می‌روند — یا اولین شاخهٔ دستی را بساز.</p>
              <button type="button" className="ds-btn ds-btn--secondary ds-btn--sm mt-8" onClick={addChild}>
                <Icon name="i-plus" size={14} />
                شاخهٔ دستی
              </button>
            </div>
          )}

          {/* نوار عمل گره انتخاب‌شده */}
          <div className="mm-actions" aria-label="کارهای گرهٔ انتخاب‌شده">
            {editing ? (
              <>
                <input
                  ref={editInputRef}
                  className="mm-actions__input"
                  value={editing.value}
                  onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEdit();
                    if (e.key === 'Escape') setEditing(null);
                  }}
                  placeholder="متن شاخه…"
                  aria-label="متن شاخه"
                />
                <button type="button" className="ds-btn ds-btn--primary ds-btn--sm" onClick={commitEdit}>
                  ذخیره
                </button>
                <button type="button" className="ds-btn ds-btn--ghost ds-btn--sm" onClick={() => setEditing(null)}>
                  لغو
                </button>
              </>
            ) : (
              <>
                {selected && <span className="mm-actions__hint">{selected.manual ? 'شاخهٔ دستی' : selected.text}</span>}
                {canJump(selected) && (
                  <button
                    type="button"
                    className="ds-btn ds-btn--secondary ds-btn--sm"
                    onClick={() => selected && jumpFrom(selected)}
                  >
                    <Icon name="i-arrow-left" size={13} />
                    پرش به منبع
                  </button>
                )}
                <button type="button" className="ds-btn ds-btn--secondary ds-btn--sm" onClick={addChild} disabled={!selected}>
                  <Icon name="i-plus" size={13} />
                  زیرشاخه
                </button>
                {selected?.manual && (
                  <>
                    <button type="button" className="ds-btn ds-btn--secondary ds-btn--sm" onClick={startEdit}>
                      <Icon name="i-pencil" size={13} />
                      ویرایش
                    </button>
                    <button type="button" className="ds-btn ds-btn--ghost ds-btn--sm mm-actions__danger" onClick={deleteNode}>
                      <Icon name="i-trash" size={13} />
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
