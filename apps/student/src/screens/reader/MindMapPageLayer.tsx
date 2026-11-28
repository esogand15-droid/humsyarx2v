import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Icon } from '../../icons';
import { generateUUID } from '../../lib/ink';
import { fmtDuration, type MindNodeRec, type NotebookItem } from './notebookData';

interface Props {
  width: number;
  height: number;
  /** حالت نقشه روی صفحه فعال است؟ خاموش = لایه رندر نمی‌شود */
  active: boolean;
  /** لنگرهای خودکار همین صفحه: هایلایت/یادداشت/ویس/نشان */
  items: NotebookItem[];
  /** گره‌های دستی سنجاق‌شده به همین صفحه */
  nodes: MindNodeRec[];
  selectedId: string | null;
  editingId: string | null;
  onSelect(id: string | null): void;
  onStartEdit(id: string): void;
  onCommitEdit(id: string, text: string): void;
  /** فرزند تازه زیر گره/لنگر — x/y لنگر والد را می‌گیرد و بیرون clamp می‌شود */
  onAddChild(parentId: string, parentX: number, parentY: number): void;
  /** ضربه به فضای خالی صفحه = شاخهٔ آزاد تازه */
  onAddFree(x: number, y: number): void;
  onMove(id: string, x: number, y: number): void;
  onDelete(id: string): void;
  /** پرش به منبعِ لنگر خودکار */
  onJumpItem(item: NotebookItem): void;
}

const clamp01 = (v: number) => Math.min(0.985, Math.max(0.015, v));

const itemLabel = (it: NotebookItem): string => {
  if (it.kind === 'highlight') return 'هایلایت';
  if (it.kind === 'voice') return `ویس ${fmtDuration(it.durationMs ?? 0)}`;
  if (it.kind === 'bookmark') return 'نشان‌شده';
  const t = (it.text ?? '').trim();
  return t.length > 22 ? `${t.slice(0, 22)}…` : t || 'یادداشت';
};

interface Chip {
  id: string;
  kind: 'highlight' | 'note' | 'voice' | 'bookmark' | 'manual';
  label: string;
  color?: string;
  x: number; // نرمال، مرکز چیپ
  y: number;
  manual: boolean;
  page?: number;
}

/** لایهٔ نقشهٔ ذهنی روی خود صفحهٔ PDF — XMind روی جزوه.
 *  گره‌ها و لنگرهای هایلایت/ویس با یال به هم وصل‌اند؛ ضربه به فضای خالی
 *  شاخهٔ تازه می‌سازد و کشیدن گره جای آن را عوض می‌کند. */
export function MindMapPageLayer({
  width,
  height,
  active,
  items,
  nodes,
  selectedId,
  editingId,
  onSelect,
  onStartEdit,
  onCommitEdit,
  onAddChild,
  onAddFree,
  onMove,
  onDelete,
  onJumpItem,
}: Props) {
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const dragStart = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const tapStart = useRef<{ x: number; y: number } | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingId) editInputRef.current?.focus();
  }, [editingId]);

  const chips = useMemo<Chip[]>(() => {
    const list: Chip[] = items.map((it) => ({
      id: `auto:${it.key}`,
      kind: it.kind,
      label: itemLabel(it),
      color: it.color,
      x: it.at?.x ?? 0.5,
      y: it.at?.y ?? 0.5,
      manual: false,
      page: it.page,
    }));
    for (const n of nodes) {
      list.push({
        id: `man:${n.id}`,
        kind: 'manual',
        label: n.text || 'متن…',
        x: n.x ?? 0.5,
        y: n.y ?? 0.5,
        manual: true,
        page: n.page,
      });
    }
    return list;
  }, [items, nodes]);

  const chipById = useMemo(() => new Map(chips.map((c) => [c.id, c])), [chips]);

  /** یال‌ها: فقط میان چیپ‌های همین صفحه */
  const edges = useMemo(() => {
    const out: { d: string }[] = [];
    for (const n of nodes) {
      const child = chipById.get(`man:${n.id}`);
      const parent = chipById.get(n.parent);
      if (!child || !parent) continue;
      const x1 = parent.x * width;
      const y1 = parent.y * height;
      const x2 = child.x * width;
      const y2 = child.y * height;
      const mx = (x1 + x2) / 2;
      out.push({ d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}` });
    }
    return out;
  }, [nodes, chipById, width, height]);

  const onTapEmpty = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!tapStart.current) return;
      const dx = e.clientX - tapStart.current.x;
      const dy = e.clientY - tapStart.current.y;
      tapStart.current = null;
      if (Math.hypot(dx, dy) > 7) return; // درگ بود، نه ضربه
      const rect = e.currentTarget.getBoundingClientRect();
      const x = clamp01((e.clientX - rect.left) / Math.max(1, rect.width));
      const y = clamp01((e.clientY - rect.top) / Math.max(1, rect.height));
      onAddFree(x, y);
    },
    [onAddFree],
  );

  const chipPointerDown = (c: Chip) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!c.manual) {
      // لنگر خودکار: فقط انتخاب/پرش
      return;
    }
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragStart.current = { px: e.clientX, py: e.clientY, x: c.x, y: c.y };
    setDrag({ id: c.id, x: c.x, y: c.y, moved: false });
  };

  const chipPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || !dragStart.current) return;
    const dx = (e.clientX - dragStart.current.px) / Math.max(1, width);
    const dy = (e.clientY - dragStart.current.py) / Math.max(1, height);
    setDrag({
      id: drag.id,
      x: clamp01(dragStart.current.x + dx),
      y: clamp01(dragStart.current.y + dy),
      moved: drag.moved || Math.hypot(dx * width, dy * height) > 5,
    });
  };

  const chipPointerUp = () => {
    if (drag && drag.moved) {
      onMove(drag.id, drag.x, drag.y);
    } else if (drag && !drag.moved) {
      onSelect(drag.id);
    }
    dragStart.current = null;
    setDrag(null);
  };

  if (!active) return null;

  const posOf = (c: Chip): { x: number; y: number } =>
    drag && drag.id === c.id ? { x: drag.x, y: drag.y } : { x: c.x, y: c.y };

  return (
    <div
      className={`mind-layer${active ? ' is-active' : ''}`}
      onPointerDown={(e) => {
        // شروع لمسِ فضای خالی — اگر تا pointerUp حرکت نکرده باشد، شاخهٔ آزاد می‌سازد
        tapStart.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={onTapEmpty}
      onPointerCancel={() => {
        tapStart.current = null;
      }}
      aria-label="لایهٔ نقشهٔ ذهنی روی صفحه"
    >
      <svg className="mind-layer__edges" width={width} height={height} aria-hidden="true">
        {edges.map((e, i) => (
          <path key={i} d={e.d} />
        ))}
      </svg>

      {chips.map((c) => {
        const p = posOf(c);
        const isSel = c.id === selectedId;
        const isEditing = c.id === editingId;
        return (
          <div
            key={c.id}
            className={`mind-chip mind-chip--${c.kind}${isSel ? ' is-sel' : ''}`}
            style={{ left: p.x * width, top: p.y * height }}
            onPointerDown={chipPointerDown(c)}
            onPointerMove={chipPointerMove}
            onPointerUp={chipPointerUp}
            onPointerCancel={chipPointerUp}
          >
            {isEditing ? (
              <input
                ref={editInputRef}
                className="mind-chip__input"
                defaultValue={c.manual ? nodes.find((n) => `man:${n.id}` === c.id)?.text ?? '' : ''}
                placeholder="متن شاخه…"
                dir="auto"
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onCommitEdit(c.id, (e.target as HTMLInputElement).value);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    onSelect(null);
                  }
                }}
                onBlur={(e) => onCommitEdit(c.id, e.target.value)}
              />
            ) : (
              <button
                type="button"
                className="mind-chip__body"
                onPointerDown={(e) => {
                  // انتخاب لنگر خودکار — درگ ندارد
                  if (!c.manual) {
                    e.stopPropagation();
                    onSelect(c.id);
                  }
                }}
                onDoubleClick={() => {
                  if (c.manual) onStartEdit(c.id);
                }}
                title={c.manual ? 'برای ویرایش دوبار بزن' : 'لنگر محتوا — با دکمه‌های کنارش کار کن'}
              >
                {c.kind === 'highlight' && (
                  <span className="mind-chip__dot" style={{ background: c.color || '#F59E0B' }} aria-hidden="true" />
                )}
                {c.kind === 'note' && <span className="mind-chip__dot mind-chip__dot--note" aria-hidden="true" />}
                {c.kind === 'voice' && <Icon name="i-mic" size={11} />}
                {c.kind === 'bookmark' && <Icon name="i-star" size={11} />}
                <span className="mind-chip__text">{c.label}</span>
              </button>
            )}

            {isSel && !isEditing && (
              <div className="mind-chip__actions" onPointerDown={(e) => e.stopPropagation()}>
                {c.manual ? (
                  <>
                    <button
                      type="button"
                      className="mind-chip__act"
                      onClick={() => onAddChild(c.id, p.x, p.y)}
                      aria-label="افزودن فرزند"
                      title="فرزند"
                    >
                      <Icon name="i-plus" size={12} />
                    </button>
                    <button
                      type="button"
                      className="mind-chip__act"
                      onClick={() => onStartEdit(c.id)}
                      aria-label="ویرایش متن"
                      title="ویرایش"
                    >
                      <Icon name="i-pencil" size={12} />
                    </button>
                    <button
                      type="button"
                      className="mind-chip__act mind-chip__act--danger"
                      onClick={() => onDelete(c.id)}
                      aria-label="حذف گره"
                      title="حذف"
                    >
                      <Icon name="i-trash" size={12} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="mind-chip__act"
                      onClick={() => onAddChild(c.id, p.x, p.y)}
                      aria-label="افزودن فرزند به این محتوا"
                      title="فرزند"
                    >
                      <Icon name="i-plus" size={12} />
                    </button>
                    {c.page != null && c.page > 0 && (
                      <button
                        type="button"
                        className="mind-chip__act"
                        onClick={() => {
                          const it = items.find((i) => `auto:${i.key}` === c.id);
                          if (it) onJumpItem(it);
                        }}
                        aria-label="پرش به منبع"
                        title="پرش"
                      >
                        <Icon name="i-arrow-left" size={12} />
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      {chips.length === 0 && (
        <div className="mind-layer__hint">
          <span>جای خالی صفحه را بزن تا اولین شاخه ساخته شود</span>
        </div>
      )}
    </div>
  );
}

/** ساخت رکورد گرهٔ تازه — بیرونِ لایه، برای persistence مشترک با پنل */
export function newMindNode(parentId: string, page: number, x: number, y: number): MindNodeRec {
  return { id: generateUUID(), parent: parentId, text: '', page, x: clamp01(x), y: clamp01(y) };
}
