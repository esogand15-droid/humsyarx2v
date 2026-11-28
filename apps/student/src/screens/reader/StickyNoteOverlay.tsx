import { useRef, useState } from 'react';
import { Icon } from '../../icons';
import type { StickyNote } from '../../lib/ink';

interface StickyNoteOverlayProps {
  page: number;
  width: number;
  height: number;
  notes: StickyNote[];
  onUpdateNotes: (notes: StickyNote[]) => void;
  /** ابزار جوهر فعال است؟ در آن حالت یادداشت رویدادها را به بوم جوهر عبور می‌دهد. */
  interactive?: boolean;
}

export const STICKY_NOTE_COLORS: Array<{ id: 'yellow' | 'cyan' | 'green' | 'coral'; label: string }> = [
  { id: 'yellow', label: 'زرد' },
  { id: 'cyan', label: 'آبی' },
  { id: 'green', label: 'سبز' },
  { id: 'coral', label: 'مرجانی' },
];

export function StickyNoteOverlay({
  width,
  height,
  notes,
  onUpdateNotes,
  interactive = true,
}: StickyNoteOverlayProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragStart = useRef<{ startX: number; startY: number; noteX: number; noteY: number } | null>(null);
  const dragPosRef = useRef<{ x: number; y: number } | null>(null);
  const didMove = useRef(false);
  /** بعد از یک درگ واقعی، click بعدی که از همان pointer می‌آید باید نادیده گرفته شود */
  const suppressClick = useRef(false);

  const commitDrag = () => {
    if (draggingId) {
      const finalPos = dragPosRef.current;
      if (didMove.current && finalPos) {
        const nextNotes = notes.map((n) =>
          n.note_id === draggingId
            ? { ...n, x: finalPos.x, y: finalPos.y, updated_at: new Date().toISOString() }
            : n,
        );
        onUpdateNotes(nextNotes);
      }
      suppressClick.current = didMove.current;
      setDraggingId(null);
      setDragPos(null);
      dragPosRef.current = null;
      dragStart.current = null;
      didMove.current = false;
    }
  };

  const handlePointerDown = (e: React.PointerEvent, note: StickyNote) => {
    // دکمه‌های داخل سربرگ نباید درگ را شروع کنند
    if ((e.target as HTMLElement).closest('button')) return;
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // safe fallback
    }
    setDraggingId(note.note_id);
    const initialPos = { x: note.x, y: note.y };
    setDragPos(initialPos);
    dragPosRef.current = initialPos;
    didMove.current = false;
    dragStart.current = {
      startX: e.clientX,
      startY: e.clientY,
      noteX: note.x,
      noteY: note.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingId || !dragStart.current) return;
    e.stopPropagation();

    const dx = (e.clientX - dragStart.current.startX) / Math.max(1, width);
    const dy = (e.clientY - dragStart.current.startY) / Math.max(1, height);

    // clamp وابسته به اندازهٔ واقعی یادداشت تا هیچ‌وقت از صفحه بیرون نزند
    const noteEl = (e.currentTarget as HTMLElement).closest('.sticky-note') as HTMLElement | null;
    const noteW = noteEl?.offsetWidth || 170;
    const noteH = noteEl?.offsetHeight || 120;
    const maxX = Math.max(0.02, (width - noteW) / Math.max(1, width) - 0.02);
    const maxY = Math.max(0.02, (height - noteH) / Math.max(1, height) - 0.02);

    const nextX = Math.min(maxX, Math.max(0.02, dragStart.current.noteX + dx));
    const nextY = Math.min(maxY, Math.max(0.02, dragStart.current.noteY + dy));

    didMove.current = true;
    const pos = { x: nextX, y: nextY };
    dragPosRef.current = pos;
    setDragPos(pos);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!draggingId) return;
    e.stopPropagation();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    commitDrag();
  };

  const handlePointerCancel = () => {
    // وسط درگ (اسکرول سیستم، تماس دوم…) — وضعیت همان‌جا ثبت شود، نه گیر کردن
    commitDrag();
  };

  const updateText = (id: string, text: string) => {
    const next = notes.map((n) =>
      n.note_id === id ? { ...n, text, updated_at: new Date().toISOString() } : n,
    );
    onUpdateNotes(next);
  };

  const toggleCollapse = (id: string) => {
    const next = notes.map((n) =>
      n.note_id === id ? { ...n, collapsed: !n.collapsed, updated_at: new Date().toISOString() } : n,
    );
    onUpdateNotes(next);
  };

  const cycleColor = (id: string) => {
    const colorOrder: Array<'yellow' | 'cyan' | 'green' | 'coral'> = ['yellow', 'cyan', 'green', 'coral'];
    const next = notes.map((n) => {
      if (n.note_id === id) {
        const curIdx = colorOrder.indexOf((n.color as 'yellow' | 'cyan' | 'green' | 'coral') || 'yellow');
        const nextColor = colorOrder[(curIdx + 1) % colorOrder.length];
        return { ...n, color: nextColor, updated_at: new Date().toISOString() };
      }
      return n;
    });
    onUpdateNotes(next);
  };

  const deleteNote = (id: string) => {
    const next = notes.filter((n) => n.note_id !== id);
    onUpdateNotes(next);
  };

  if (!notes || notes.length === 0) return null;

  return (
    <div
      className={`sticky-note-layer${interactive ? '' : ' is-ink-mode'}`}
      aria-label="یادداشت‌های چسبان"
    >
      {notes.map((note) => {
        const isDragging = note.note_id === draggingId && dragPos !== null;
        const noteX = isDragging ? dragPos.x : note.x;
        const noteY = isDragging ? dragPos.y : note.y;
        const posX = Math.round(noteX * width);
        const posY = Math.round(noteY * height);
        const colorClass = `sticky-note--${note.color || 'yellow'}`;

        if (note.collapsed) {
          return (
            <button
              key={note.note_id}
              type="button"
              ref={(el) => {
                el?.style.setProperty('--note-x', `${posX}px`);
                el?.style.setProperty('--note-y', `${posY}px`);
              }}
              className={`sticky-note ${colorClass} sticky-note--collapsed`}
              onClick={() => {
                // بعد از درگ سنجاق، click نباید آن را باز کند
                if (suppressClick.current) {
                  suppressClick.current = false;
                  return;
                }
                toggleCollapse(note.note_id);
              }}
              onPointerDown={(e) => handlePointerDown(e, note)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              onLostPointerCapture={handlePointerCancel}
              title={note.page < 0 ? 'یادداشت حاشیه (صفحهٔ افزوده) — برای باز کردن کلیک کنید' : `یادداشت حاشیه (صفحه ${note.page}) — برای باز کردن کلیک کنید`}
              aria-label="باز کردن یادداشت چسبان"
            >
              <Icon name="i-pin" size={16} />
            </button>
          );
        }

        return (
          <div
            key={note.note_id}
            ref={(el) => {
              el?.style.setProperty('--note-x', `${posX}px`);
              el?.style.setProperty('--note-y', `${posY}px`);
            }}
            className={`sticky-note ${colorClass}`}
          >
            <div
              className="sticky-note__header"
              onPointerDown={(e) => handlePointerDown(e, note)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              onLostPointerCapture={handlePointerCancel}
              title="برای جابه‌جایی بکشید"
            >
              <span>یادداشت</span>
              <div className="sticky-note__actions">
                <button
                  type="button"
                  className="sticky-note__btn"
                  onClick={() => cycleColor(note.note_id)}
                  title="تغییر رنگ"
                  aria-label="تغییر رنگ یادداشت"
                >
                  <Icon name="i-palette" size={14} />
                </button>
                <button
                  type="button"
                  className="sticky-note__btn"
                  onClick={() => toggleCollapse(note.note_id)}
                  title="سنجاق کردن / جمع‌کردن"
                  aria-label="سنجاق کردن یادداشت"
                >
                  <Icon name="i-pin" size={14} />
                </button>
                <button
                  type="button"
                  className="sticky-note__btn"
                  onClick={() => deleteNote(note.note_id)}
                  title="حذف یادداشت"
                  aria-label="حذف یادداشت"
                >
                  <Icon name="i-x" size={14} />
                </button>
              </div>
            </div>
            <div className="sticky-note__body">
              <textarea
                className="sticky-note__textarea"
                placeholder="نکته بالینی یا یادداشت..."
                value={note.text}
                onChange={(e) => updateText(note.note_id, e.target.value)}
                dir="auto"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
