import { useEffect, type CSSProperties } from 'react';
import { Icon } from '../../icons';
import {
  insertedInkId,
  type InsertedPage,
  type PageTemplate,
  type Scope,
  type StickyNote,
} from '../../lib/ink';
import { InkLayer, type InkApi, type InkStatus } from './InkLayer';
import { StickyNoteOverlay } from './StickyNoteOverlay';
import type { ReaderTool } from './InkToolbar';
import './inserted-pages.css';

export const PAGE_TEMPLATES: Array<{ id: PageTemplate; label: string; hint: string }> = [
  { id: 'blank', label: 'سفید', hint: 'طرح، شکل و نمودار' },
  { id: 'ruled', label: 'خطدار', hint: 'نوشتن و خلاصه' },
  { id: 'grid', label: 'شطرنجی', hint: 'جدول و محاسبه' },
  { id: 'dotted', label: 'نقطهای', hint: 'چیدمان آزاد' },
];

/** Page-relative unit for the paper pattern, so lines keep their spacing at every zoom. */
const paperUnit = (width: number) => `${Math.max(6, width / 36)}px`;

/** The "+" that sits in the gap after a page and inserts a new page there. */
export function PageInserter({ onInsert, label }: { onInsert: () => void; label: string }) {
  return (
    <div className="page-inserter">
      <button type="button" className="page-inserter__btn" onClick={onInsert} aria-label={label} title={label}>
        <Icon name="i-plus" size={14} />
      </button>
    </div>
  );
}

interface InsertedPageViewProps {
  scope: Scope;
  /** The handout's id; the page's ink lives under {@link insertedInkId}. */
  id: string;
  entry: InsertedPage;
  afterLabel: string;
  width: number;
  height: number;
  tool: ReaderTool;
  color: string;
  strokeWidth: number;
  eraserMode: 'stroke' | 'partial';
  eraseHighlighterOnly: boolean;
  shapeSnap: boolean;
  stylusOnly: boolean;
  onPenDetected?: () => void;
  invertContrast: boolean;
  isNew: boolean;
  onRegisterInkApi: (api: InkApi | null) => void;
  onInkStatus: (s: InkStatus) => void;
  onInkCount: (n: number) => void;
  onInkHistory: (h: { undo: number; redo: number }) => void;
  onInkChanged: () => void;
  onNotesLoaded: (loaded: StickyNote[]) => void;
  notes: StickyNote[];
  onUpdateNotes: (notes: StickyNote[]) => void;
  onActivate: () => void;
  onChangeTemplate: () => void;
  onDelete: () => void;
  /** Extra layer over the page (voice notes). */
  overlay?: React.ReactNode;
}

/** A blank/ruled/grid/dotted page the student inserted between two handout pages. */
export function InsertedPageView({
  scope,
  id,
  entry,
  afterLabel,
  width,
  height,
  tool,
  color,
  strokeWidth,
  eraserMode,
  eraseHighlighterOnly,
  shapeSnap,
  stylusOnly,
  onPenDetected,
  invertContrast,
  isNew,
  onRegisterInkApi,
  onInkStatus,
  onInkCount,
  onInkHistory,
  onInkChanged,
  onNotesLoaded,
  notes,
  onUpdateNotes,
  onActivate,
  onChangeTemplate,
  onDelete,
  overlay,
}: InsertedPageViewProps) {
  return (
    <div
      className={`pdf-page inserted-page${isNew ? ' is-new' : ''}${invertContrast ? ' is-inverted' : ''}${
        tool ? ' is-inking' : ''
      }`}
      data-insert-id={entry.id}
      style={{ width, height, '--u': paperUnit(width) } as CSSProperties}
      onPointerDownCapture={onActivate}
    >
      <div className={`inserted-page__paper tpl-${entry.template}`} aria-hidden="true" />

      <div className="inserted-page__chip">
        <span className="inserted-page__label">{afterLabel}</span>
        <button
          type="button"
          className="inserted-page__act"
          onClick={onChangeTemplate}
          aria-label="تغییر قالب صفحه"
          title="تغییر قالب"
        >
          <Icon name="i-layers" size={13} />
        </button>
        <button
          type="button"
          className="inserted-page__act inserted-page__act--danger"
          onClick={onDelete}
          aria-label="حذف این صفحه"
          title="حذف صفحه"
        >
          <Icon name="i-x" size={13} />
        </button>
      </div>

      <InkLayer
        ref={onRegisterInkApi}
        scope={scope}
        id={insertedInkId(id)}
        page={entry.slot}
        width={width}
        height={height}
        tool={tool}
        color={color}
        strokeWidth={strokeWidth}
        notes={notes}
        onCount={onInkCount}
        onHistory={onInkHistory}
        onStatus={onInkStatus}
        onChanged={onInkChanged}
        onNotesLoaded={(_inkPage, loaded) => onNotesLoaded(loaded)}
        eraserMode={eraserMode}
        eraseHighlighterOnly={eraseHighlighterOnly}
        shapeSnap={shapeSnap}
        stylusOnly={stylusOnly}
        onPenDetected={onPenDetected}
      />
      {/* یادداشت چسبان روی صفحات افزوده — کلید والد: -slot (بدون تصادم با صفحات عادی) */}
      <StickyNoteOverlay
        page={-entry.slot}
        width={width}
        height={height}
        notes={notes}
        onUpdateNotes={onUpdateNotes}
        interactive={!tool}
      />
      {overlay}
    </div>
  );
}

interface PageTemplatePickerProps {
  open: boolean;
  title: string;
  current?: PageTemplate;
  onPick: (t: PageTemplate) => void;
  onClose: () => void;
}

export function PageTemplatePicker({ open, title, current, onPick, onClose }: PageTemplatePickerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="tpl-picker-backdrop" onClick={onClose}>
      <div
        className="tpl-picker"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tpl-picker__grabber" aria-hidden="true" />
        <div className="tpl-picker__head">
          <span className="tpl-picker__title">{title}</span>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="بستن">
            <Icon name="i-x" size={16} />
          </button>
        </div>
        <div className="tpl-picker__grid">
          {PAGE_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tpl-picker__opt${current === t.id ? ' is-current' : ''}`}
              aria-pressed={current === t.id}
              onClick={() => onPick(t.id)}
            >
              <span className={`tpl-picker__swatch tpl-${t.id}`} aria-hidden="true" />
              <span className="tpl-picker__name">{t.label}</span>
              <span className="tpl-picker__hint">{t.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
