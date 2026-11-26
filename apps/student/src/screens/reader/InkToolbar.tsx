import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../../icons';
import { faDigits } from '../../lib/fa';
import { type InkTool } from '../../lib/ink';
import type { InkStatus } from './InkLayer';
import './reader.css';

export const INK_COLORS = [
  '#0F172A', // Carbon Black
  '#2563EB', // Royal Blue
  '#DC2626', // Clinical Red
  '#059669', // Emerald Green
  '#00F2FE', // Neon Turquoise
  '#FEF08A', // Neon Yellow
  '#34D399', // Clinical Green
  '#FB7185', // Coral
  '#C084FC', // Pastel Lilac
];
export const INK_WIDTHS = [0.0015, 0.0035, 0.007] as const;

export type ReaderTool = InkTool | 'eraser' | 'lasso' | null;
export type EraserMode = 'stroke' | 'partial';

function setCssVar(name: string, value: string) {
  return (el: HTMLElement | null) => {
    if (el) el.style.setProperty(name, value);
  };
}

interface Props {
  tool: ReaderTool;
  setTool: (t: ReaderTool) => void;
  color: string;
  setColor: (c: string) => void;
  strokeWidth: number;
  setStrokeWidth: (w: number) => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
  count: number;
  status: InkStatus;
  canUndo: boolean;
  canRedo: boolean;
  onOpenNotebook: () => void;
  onAddStickyNote?: () => void;
  onToggleFocus?: () => void;
  onOpenThumbnails?: () => void;
  onToggleInvert?: () => void;
  inverted?: boolean;
  eraserMode?: EraserMode;
  setEraserMode?: (m: EraserMode) => void;
  eraseHighlighterOnly?: boolean;
  setEraseHighlighterOnly?: (v: boolean) => void;
  shapeSnap?: boolean;
  setShapeSnap?: (v: boolean) => void;
  stylusOnly?: boolean;
  setStylusOnly?: (v: boolean) => void;
  currentPage?: number;
  totalPages?: number;
  onPrevPage?: () => void;
  onNextPage?: () => void;
  onToggleAi?: () => void;
  isAiOpen?: boolean;
}

export function InkToolbar({
  tool,
  setTool,
  color,
  setColor,
  strokeWidth,
  setStrokeWidth,
  undo,
  redo,
  clear,
  count,
  status,
  canUndo,
  canRedo,
  onOpenNotebook,
  onAddStickyNote,
  onToggleFocus,
  onOpenThumbnails,
  onToggleInvert,
  inverted = false,
  eraserMode = 'stroke',
  setEraserMode,
  eraseHighlighterOnly = false,
  setEraseHighlighterOnly,
  shapeSnap = false,
  setShapeSnap,
  stylusOnly = false,
  setStylusOnly,
  currentPage,
  totalPages,
  onPrevPage,
  onNextPage,
  onToggleAi,
  isAiOpen = false,
}: Props) {
  const [showPenMenu, setShowPenMenu] = useState(false);
  const [showEraserMenu, setShowEraserMenu] = useState(false);
  const [showColorPalette, setShowColorPalette] = useState(false);
  const [showDockMenu, setShowDockMenu] = useState(false);

  // سیستم کشویی پله‌ای و دات شناور (Stepped Telescopic Drawer & Floating Stylus Dot)
  const [toolbarTier, setToolbarTier] = useState<'dot' | 'primary' | 'full'>('primary');
  const isCollapsed = toolbarTier === 'dot';

  const [dockEdge, setDockEdge] = useState<'bottom' | 'top' | 'left' | 'right' | 'free'>('bottom');
  const [dockY, setDockY] = useState<number>(220);
  const [freePos, setFreePos] = useState<{ x: number; y: number } | null>(null);

  // تشخیص هوشمند دستگاه‌های موبایل (آیفون و اندروید <= 640px)
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= 640;
  });

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 640;
      setIsMobile(mobile);
      if (mobile) {
        setDockEdge((prev) => (prev === 'left' || prev === 'right' ? 'bottom' : prev));
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const navRef = useRef<HTMLElement | null>(null);
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    origLeft: number;
    origTop: number;
    hasMoved: boolean;
  } | null>(null);

  const isVertical = !isMobile && (dockEdge === 'left' || dockEdge === 'right');

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const W = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const isRtl = typeof document !== 'undefined' && getComputedStyle(document.documentElement).direction === 'rtl';
    const w = nav.offsetWidth || (isCollapsed ? 48 : 300);
    const posX = freePos ? freePos.x : isMobile ? 16 : 20;
    const posY = freePos ? freePos.y : isMobile ? Math.max(80, window.innerHeight - 68) : dockY;
    const inlineStart = isRtl ? Math.max(8, W - posX - w) : posX;

    nav.style.setProperty('--ink-pos-x', `${posX}px`);
    nav.style.setProperty('--ink-pos-y', `${posY}px`);
    nav.style.setProperty('--ink-inline', `${inlineStart}px`);
    nav.style.setProperty('--ink-dock-y', `${dockY}px`);
    nav.style.setProperty('--ink-color', color || INK_COLORS[1]);
  }, [color, dockEdge, dockY, freePos, isCollapsed, isMobile, toolbarTier]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!isCollapsed && (e.target as HTMLElement).closest('button, input, select, label')) {
      return;
    }
    const nav = navRef.current;
    if (!nav) return;
    const rect = nav.getBoundingClientRect();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    dragStateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origLeft: rect.left,
      origTop: rect.top,
      hasMoved: false,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragStateRef.current) return;
    const dx = e.clientX - dragStateRef.current.startX;
    const dy = e.clientY - dragStateRef.current.startY;
    if (Math.hypot(dx, dy) > 5) {
      dragStateRef.current.hasMoved = true;
    }
    if (dragStateRef.current.hasMoved) {
      const nav = navRef.current;
      const w = nav?.offsetWidth || (toolbarTier === 'dot' ? 48 : toolbarTier === 'primary' ? 280 : 520);
      const h = nav?.offsetHeight || 44;
      const W = window.innerWidth;
      const H = window.innerHeight;

      const rawLeft = dragStateRef.current.origLeft + dx;
      const rawTop = dragStateRef.current.origTop + dy;

      const nextX = Math.max(8, Math.min(W - w - 8, rawLeft));
      const nextY = Math.max(56, Math.min(H - h - 8, rawTop));

      setDockEdge('free');
      setFreePos({ x: nextX, y: nextY });
    }
  };

  const handleExpand = () => {
    if (isMobile) {
      setDockEdge('bottom');
      setToolbarTier('primary');
      return;
    }
    if (dockEdge === 'free' && freePos) {
      const W = window.innerWidth;
      const estimatedWidth = 280;
      if (freePos.x + estimatedWidth > W - 12) {
        setFreePos({
          x: Math.max(12, W - estimatedWidth - 12),
          y: freePos.y,
        });
      }
    }
    setToolbarTier('primary');
  };

  const handleToggleTier = () => {
    setShowColorPalette(false);
    setShowPenMenu(false);
    setShowEraserMenu(false);
    setShowDockMenu(false);
    if (toolbarTier === 'primary') {
      if (!isMobile && dockEdge === 'free' && freePos) {
        const W = window.innerWidth;
        const fullW = 520;
        if (freePos.x + fullW > W - 12) {
          setFreePos({
            x: Math.max(12, W - fullW - 12),
            y: freePos.y,
          });
        }
      }
      setToolbarTier('full');
    } else {
      setToolbarTier('primary');
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragStateRef.current) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    if (dragStateRef.current.hasMoved) {
      const nav = navRef.current;
      const w = nav?.offsetWidth || (toolbarTier === 'dot' ? 48 : toolbarTier === 'primary' ? 280 : 520);
      const h = nav?.offsetHeight || 44;
      const W = window.innerWidth;
      const H = window.innerHeight;
      const curLeft = freePos?.x ?? dragStateRef.current.origLeft;
      const curTop = freePos?.y ?? dragStateRef.current.origTop;
      const pointerX = e.clientX;
      const pointerY = e.clientY;

      if (isMobile) {
        if (isCollapsed) {
          setDockEdge('free');
          setFreePos({
            x: Math.max(8, Math.min(W - 48 - 8, curLeft)),
            y: Math.max(56, Math.min(H - 48 - 8, curTop)),
          });
        } else {
          setDockEdge('bottom');
        }
      } else {
        const EDGE_SNAP = 36;
        if (pointerX >= W - EDGE_SNAP) {
          setDockEdge('right');
          setDockY(Math.max(70, Math.min(H - h - 20, pointerY - h / 2)));
        } else if (pointerX <= EDGE_SNAP) {
          setDockEdge('left');
          setDockY(Math.max(70, Math.min(H - h - 20, pointerY - h / 2)));
        } else if (pointerY <= 60) {
          setDockEdge('top');
        } else if (pointerY >= H - EDGE_SNAP) {
          setDockEdge('bottom');
        } else {
          setDockEdge('free');
          setFreePos({
            x: Math.max(12, Math.min(W - w - 12, curLeft)),
            y: Math.max(64, Math.min(H - h - 12, curTop)),
          });
        }
      }
    } else if (isCollapsed) {
      handleExpand();
    }
    dragStateRef.current = null;
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    dragStateRef.current = null;
  };

  const [quickSlots, setQuickSlots] = useState<string[]>([
    INK_COLORS[1], // Blue
    INK_COLORS[2], // Red
    INK_COLORS[0], // Black
  ]);

  const isPenActive = tool === 'pen' || tool === 'ballpoint' || tool === 'fountain';
  const drawing = isPenActive || tool === 'pencil' || tool === 'highlighter';
  const previewPx = Math.max(6, Math.min(24, Math.round(strokeWidth * 1600)));

  const selectColor = (c: string) => {
    setColor(c);
    if (!quickSlots.includes(c)) {
      setQuickSlots((prev) => [c, prev[0], prev[1]]);
    }
  };

  const closeMenus = () => {
    setShowPenMenu(false);
    setShowEraserMenu(false);
    setShowDockMenu(false);
  };

  const navClass = [
    'ink-bar',
    'ink-dock',
    `dock-${dockEdge}`,
    isVertical ? 'is-vertical' : 'is-horizontal',
    dockEdge === 'free' ? 'is-dragged' : '',
    isCollapsed ? 'is-collapsed' : '',
    isMobile ? 'is-mobile-dock' : '',
    `tier-${toolbarTier}`,
  ]
    .filter(Boolean)
    .join(' ');

  const renderPaletteSubdock = (flipped: boolean) => (
    <div className={`ink-dock__subdock${flipped ? ' is-flipped-below' : ''}`}>
      <div className="ink-dock__palette" aria-label="پالت رنگ">
        {INK_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            ref={setCssVar('--swatch', c)}
            className={`ink-dot${color === c ? ' is-on' : ''}`}
            aria-label={`رنگ ${c}`}
            aria-pressed={color === c}
            onClick={() => selectColor(c)}
          />
        ))}
      </div>

      <span className="ink-dock__sep" aria-hidden="true" />

      <div className="ink-dock__widths" aria-label="ضخامت‌های پیش‌فرض">
        {INK_WIDTHS.map((w, idx) => (
          <button
            key={`w_${w}`}
            type="button"
            className={`ink-dock__wbtn${Math.abs(strokeWidth - w) < 0.0005 ? ' is-on' : ''}`}
            onClick={() => setStrokeWidth(w)}
            title={idx === 0 ? 'نازک' : idx === 1 ? 'متوسط' : 'ضخیم'}
            aria-label={idx === 0 ? 'ضخامت نازک' : idx === 1 ? 'ضخامت متوسط' : 'ضخامت ضخیم'}
          >
            <span
              className="ink-dock__wdot"
              ref={setCssVar('--dot-px', `${idx === 0 ? 4 : idx === 1 ? 8 : 12}px`)}
            />
          </button>
        ))}
      </div>

      <div className="ink-slider-wrap">
        <input
          type="range"
          min="0.001"
          max="0.015"
          step="0.0005"
          value={strokeWidth}
          onChange={(e) => setStrokeWidth(parseFloat(e.target.value))}
          className="ink-slider"
          aria-label="ضخامت قلم"
        />
        <span
          className="ink-width-preview-dot"
          ref={setCssVar('--preview-px', `${previewPx}px`)}
          title="پیش‌نمایش ضخامت"
        />
      </div>

      {count > 0 && (
        <button
          type="button"
          className="ink-dock__clear"
          onClick={clear}
          title="پاک‌کردن تمامی حاشیه‌نویسی‌های این صفحه"
        >
          پاک‌کردن صفحه
        </button>
      )}
    </div>
  );

  const renderEraserSubdock = (flipped: boolean) => (
    <div className={`ink-dock__subdock ink-subdock--eraser${flipped ? ' is-flipped-below' : ''}`}>
      {setEraserMode && (
        <div className="ink-eraser-modes" role="group" aria-label="حالت پاک‌کن">
          <button
            type="button"
            className={`ink-mode-chip${eraserMode === 'stroke' ? ' is-active' : ''}`}
            onClick={() => setEraserMode('stroke')}
            title="🧹 پاک‌کردن کل خط با یک لمس"
          >
            <Icon name="i-eraser" size={14} />
            <span>کل خط</span>
          </button>
          <button
            type="button"
            className={`ink-mode-chip${eraserMode === 'partial' ? ' is-active' : ''}`}
            onClick={() => setEraserMode('partial')}
            title="✂️ پاک‌کردن برشی و دقیق بخشی از خط"
          >
            <Icon name="i-scissors" size={14} />
            <span>برشی دقیق</span>
          </button>
        </div>
      )}

      {setEraseHighlighterOnly && (
        <label className="ink-highlighter-chip" title="فقط ماژیک‌های هایلایت پاک شوند و جوهر خودکار حفظ شود">
          <input
            type="checkbox"
            checked={eraseHighlighterOnly}
            onChange={(e) => setEraseHighlighterOnly(e.target.checked)}
          />
          <span>فقط هایلایت</span>
        </label>
      )}

      <span className="ink-dock__sep" aria-hidden="true" />

      <div className="ink-dock__widths" aria-label="اندازه‌های پاک‌کن">
        {[
          { val: 0.002, px: 6, label: 'پاک‌کن ریز' },
          { val: 0.005, px: 10, label: 'پاک‌کن متوسط' },
          { val: 0.01, px: 14, label: 'پاک‌کن درشت' },
        ].map((preset) => (
          <button
            key={preset.val}
            type="button"
            className={`ink-dock__wbtn${Math.abs(strokeWidth - preset.val) < 0.0012 ? ' is-on' : ''}`}
            onClick={() => setStrokeWidth(preset.val)}
            title={preset.label}
            aria-label={preset.label}
          >
            <span
              className="ink-dock__wdot ink-dock__wdot--eraser"
              ref={setCssVar('--dot-px', `${preset.px}px`)}
            />
          </button>
        ))}
      </div>

      <div className="ink-slider-wrap">
        <input
          type="range"
          min="0.001"
          max="0.015"
          step="0.0005"
          value={strokeWidth}
          onChange={(e) => setStrokeWidth(parseFloat(e.target.value))}
          className="ink-slider ink-slider--eraser"
          aria-label="سایز پاک‌کن"
        />
        <span
          className="ink-width-preview-dot ink-eraser-preview-dot"
          ref={setCssVar('--preview-px', `${previewPx}px`)}
          title="پیش‌نمایش اندازه پاک‌کن"
        />
      </div>

      {count > 0 && (
        <button type="button" className="ink-dock__clear" onClick={clear}>
          پاک‌کردن صفحه
        </button>
      )}
    </div>
  );

  const isFlippedBelow =
    dockEdge === 'top' ||
    (dockEdge === 'free' && freePos && freePos.y < 120) ||
    (dockEdge !== 'bottom' && dockY < 120);

  return (
    <nav
      ref={navRef}
      className={navClass}
      role="toolbar"
      aria-label="ابزار حاشیه‌نویسی و مطالعه"
    >
      {isCollapsed ? (
        <div
          className={`ink-stylus-dot dock-${dockEdge}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          role="button"
          tabIndex={0}
          aria-label="بازکردن نوار ابزار قلم و حاشیه‌نویسی"
          title="برای بازکردن ضربه بزنید"
          onClick={() => {
            if (!dragStateRef.current?.hasMoved) {
              handleExpand();
            }
          }}
        >
          <div className="ink-dot-main">
            <div className="ink-dot-icon">
              {tool === 'highlighter' ? (
                <Icon name="i-highlighter" size={20} />
              ) : tool === 'eraser' ? (
                <Icon name="i-eraser" size={20} />
              ) : tool === 'pencil' ? (
                <Icon name="i-pencil" size={20} />
              ) : tool === 'lasso' ? (
                <Icon name="i-lasso" size={20} />
              ) : (
                <Icon name="i-pen" size={20} />
              )}
            </div>
            <span className="ink-dot-color-capsule" />
          </div>
        </div>
      ) : isMobile ? (
        <>
          {/* نوار فشرده موبایل: دقیقاً ۶ دکمهٔ ۴۴×۴۴ بدون هیچ‌گونه بیرون‌زدگی */}
          <div className="ink-dock__capsule">
            <button
              type="button"
              className="ink-dock__mini"
              onClick={undo}
              disabled={!canUndo}
              aria-label="بازگردانی"
              title="بازگردانی"
            >
              <Icon name="i-arrow-right" size={18} />
            </button>

            <button
              type="button"
              className={`ink-dock__btn${isPenActive ? ' is-on' : ''}`}
              aria-pressed={isPenActive}
              aria-label="قلم"
              onClick={() => {
                setShowColorPalette(false);
                setShowEraserMenu(false);
                if (isPenActive) setTool(null);
                else setTool('pen');
              }}
            >
              <Icon name="i-pen" size={18} />
            </button>

            <button
              type="button"
              className={`ink-dock__btn${tool === 'highlighter' ? ' is-on' : ''}`}
              aria-pressed={tool === 'highlighter'}
              aria-label="هایلایت"
              onClick={() => {
                setShowColorPalette(false);
                setShowEraserMenu(false);
                setTool(tool === 'highlighter' ? null : 'highlighter');
              }}
            >
              <Icon name="i-highlighter" size={18} />
            </button>

            <button
              type="button"
              className={`ink-dock__btn${tool === 'eraser' ? ' is-on' : ''}`}
              aria-pressed={tool === 'eraser'}
              aria-label="پاک‌کن"
              onClick={() => {
                setShowColorPalette(false);
                if (tool === 'eraser') {
                  setShowEraserMenu((v) => !v);
                } else {
                  setTool('eraser');
                  setShowEraserMenu(true);
                }
              }}
            >
              <Icon name="i-eraser" size={18} />
            </button>

            <button
              type="button"
              className={`ink-dock__color-btn${showColorPalette ? ' is-open' : ''}`}
              aria-label="انتخاب رنگ و ضخامت"
              aria-expanded={showColorPalette}
              onClick={() => {
                setShowEraserMenu(false);
                setToolbarTier('primary');
                setShowColorPalette((v) => !v);
              }}
            >
              <span className="ink-dock__color-ring" />
            </button>

            <button
              type="button"
              className={`ink-dock__mini ink-stepper-btn${toolbarTier === 'full' ? ' is-on' : ''}`}
              aria-label="ابزارهای بیشتر"
              aria-expanded={toolbarTier === 'full'}
              onClick={handleToggleTier}
            >
              <Icon name={toolbarTier === 'full' ? 'i-x' : 'i-more'} size={18} />
            </button>
          </div>

          {showColorPalette && tool !== 'eraser' && renderPaletteSubdock(false)}
          {showEraserMenu && tool === 'eraser' && renderEraserSubdock(false)}

          {toolbarTier === 'full' && (
            <div className="ink-dock__sheet ink-stepped-drawer" role="dialog" aria-label="جعبه ابزار کامل مطالعه">
              {totalPages != null && totalPages > 0 && onPrevPage && onNextPage && (
                <div className="ink-dock__sheet-row">
                  <div className="ink-dock__page-pill">
                    <button type="button" className="ink-dock__page-btn" onClick={onPrevPage} aria-label="صفحه قبل">
                      <Icon name="i-chevron-r" size={15} />
                    </button>
                    <span className="ink-dock__page-num num">
                      صفحهٔ {faDigits(currentPage ?? 1)} از {faDigits(totalPages)}
                    </span>
                    <button type="button" className="ink-dock__page-btn" onClick={onNextPage} aria-label="صفحه بعد">
                      <Icon name="i-chevron" size={15} />
                    </button>
                  </div>

                  <div className="ink-dock__swatches">
                    <button
                      type="button"
                      className="ink-dock__mini"
                      onClick={redo}
                      disabled={!canRedo}
                      aria-label="انجام مجدد"
                    >
                      <Icon name="i-arrow-left" size={16} />
                    </button>
                    <button
                      type="button"
                      className="ink-dock__mini"
                      onClick={() => setToolbarTier('dot')}
                      aria-label="جمع‌کردن نوار"
                    >
                      <Icon name="i-arrow-down" size={16} />
                    </button>
                  </div>
                </div>
              )}

              <div className="ink-dock__sheet-grid">
                <button
                  type="button"
                  className={`ink-dock__sheet-item${tool === 'pencil' ? ' is-on' : ''}`}
                  onClick={() => {
                    setTool(tool === 'pencil' ? null : 'pencil');
                    setToolbarTier('primary');
                  }}
                >
                  <Icon name="i-pencil" size={18} />
                  <span>مداد</span>
                </button>
                <button
                  type="button"
                  className={`ink-dock__sheet-item${tool === 'lasso' ? ' is-on' : ''}`}
                  onClick={() => {
                    setTool(tool === 'lasso' ? null : 'lasso');
                    setToolbarTier('primary');
                  }}
                >
                  <Icon name="i-lasso" size={18} />
                  <span>کمند</span>
                </button>
                {setShapeSnap && (
                  <button
                    type="button"
                    className={`ink-dock__sheet-item${shapeSnap ? ' is-on' : ''}`}
                    onClick={() => setShapeSnap(!shapeSnap)}
                  >
                    <Icon name="i-shapes" size={18} />
                    <span>اشکال</span>
                  </button>
                )}
                {setStylusOnly && (
                  <button
                    type="button"
                    className={`ink-dock__sheet-item${stylusOnly ? ' is-on' : ''}`}
                    onClick={() => setStylusOnly(!stylusOnly)}
                  >
                    <Icon name="i-fountain" size={18} />
                    <span>فقط قلم</span>
                  </button>
                )}
                {onAddStickyNote && (
                  <button
                    type="button"
                    className="ink-dock__sheet-item"
                    onClick={() => {
                      onAddStickyNote();
                      setToolbarTier('primary');
                    }}
                  >
                    <Icon name="i-pin" size={18} />
                    <span>یادداشت</span>
                  </button>
                )}
                {onToggleInvert && (
                  <button
                    type="button"
                    className={`ink-dock__sheet-item${inverted ? ' is-on' : ''}`}
                    onClick={onToggleInvert}
                  >
                    <Icon name={inverted ? 'i-sun' : 'i-moon'} size={18} />
                    <span>کنتراست شب</span>
                  </button>
                )}
                {onOpenThumbnails && (
                  <button
                    type="button"
                    className="ink-dock__sheet-item"
                    onClick={() => {
                      setToolbarTier('primary');
                      onOpenThumbnails();
                    }}
                  >
                    <Icon name="i-grid" size={18} />
                    <span>فهرست</span>
                  </button>
                )}
                {onToggleFocus && (
                  <button
                    type="button"
                    className="ink-dock__sheet-item"
                    onClick={() => {
                      setToolbarTier('primary');
                      onToggleFocus();
                    }}
                  >
                    <Icon name="i-expand" size={18} />
                    <span>تمرکز</span>
                  </button>
                )}
                <button
                  type="button"
                  className="ink-dock__sheet-item"
                  onClick={() => {
                    setToolbarTier('primary');
                    onOpenNotebook();
                  }}
                >
                  <Icon name="i-layers" size={18} />
                  <span>دفترچه</span>
                </button>
                {onToggleAi && (
                  <button
                    type="button"
                    className={`ink-dock__sheet-item${isAiOpen ? ' is-on' : ''}`}
                    onClick={() => {
                      setToolbarTier('primary');
                      onToggleAi();
                    }}
                  >
                    <Icon name="i-chat" size={18} />
                    <span>هوشیار</span>
                  </button>
                )}
                {count > 0 && (
                  <button
                    type="button"
                    className="ink-dock__sheet-item"
                    onClick={() => {
                      clear();
                      setToolbarTier('primary');
                    }}
                  >
                    <Icon name="i-trash" size={18} />
                    <span>پاک‌کردن</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="ink-dock__capsule">
            <div
              className="ink-dock__drag"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              title="جابه‌جایی نوار ابزار"
              aria-label="جابه‌جایی نوار ابزار"
            >
              <Icon name="i-more" size={14} />
            </div>

            {/* قلم */}
            <div className="ink-dock__wrap">
              <button
                type="button"
                className={`ink-dock__btn${isPenActive ? ' is-on' : ''}`}
                aria-pressed={isPenActive}
                onClick={() => {
                  if (isPenActive) setShowPenMenu((v) => !v);
                  else {
                    closeMenus();
                    setTool('pen');
                  }
                }}
                title="قلم خودکار و روان‌نویس"
              >
                <Icon name="i-pen" size={16} />
                <span className="ink-dock__btn-dot" />
                <span className="ink-dock__btn-label">
                  {tool === 'fountain' ? 'روان‌نویس' : tool === 'ballpoint' ? 'خودکار' : 'قلم'}
                </span>
              </button>

              {showPenMenu && (
                <div className="ink-dock__popover" role="menu">
                  <button
                    type="button"
                    className={`ink-dock__pop-item${tool === 'pen' ? ' is-active' : ''}`}
                    onClick={() => {
                      setTool('pen');
                      setShowPenMenu(false);
                    }}
                  >
                    <Icon name="i-pen" size={15} /> قلم ژله‌ای دقیق
                  </button>
                  <button
                    type="button"
                    className={`ink-dock__pop-item${tool === 'ballpoint' ? ' is-active' : ''}`}
                    onClick={() => {
                      setTool('ballpoint');
                      setShowPenMenu(false);
                    }}
                  >
                    <Icon name="i-pencil" size={15} /> قلم خودکار روزمره
                  </button>
                  <button
                    type="button"
                    className={`ink-dock__pop-item${tool === 'fountain' ? ' is-active' : ''}`}
                    onClick={() => {
                      setTool('fountain');
                      setShowPenMenu(false);
                    }}
                  >
                    <Icon name="i-fountain" size={15} /> روان‌نویس خطاطی
                  </button>
                </div>
              )}
            </div>

            {/* مداد */}
            <button
              type="button"
              className={`ink-dock__btn${tool === 'pencil' ? ' is-on' : ''}`}
              aria-pressed={tool === 'pencil'}
              onClick={() => {
                closeMenus();
                setTool(tool === 'pencil' ? null : 'pencil');
              }}
              title="مداد گرافیتی"
            >
              <Icon name="i-pencil" size={16} />
              <span className="ink-dock__btn-label">مداد</span>
            </button>

            {/* هایلایت */}
            <button
              type="button"
              className={`ink-dock__btn${tool === 'highlighter' ? ' is-on' : ''}`}
              aria-pressed={tool === 'highlighter'}
              onClick={() => {
                closeMenus();
                setTool(tool === 'highlighter' ? null : 'highlighter');
              }}
              title="هایلایتر بالینی"
            >
              <Icon name="i-highlighter" size={16} />
              <span className="ink-dock__btn-label">هایلایت</span>
            </button>

            {/* پاک‌کن */}
            <div className="ink-dock__wrap">
              <button
                type="button"
                className={`ink-dock__btn${tool === 'eraser' ? ' is-on' : ''}`}
                aria-pressed={tool === 'eraser'}
                onClick={() => {
                  if (tool === 'eraser') setShowEraserMenu((v) => !v);
                  else {
                    closeMenus();
                    setTool('eraser');
                  }
                }}
                title="پاک‌کن وکتوری"
              >
                <Icon name="i-eraser" size={16} />
                <span className="ink-dock__btn-label">پاک‌کن</span>
              </button>

              {showEraserMenu && setEraserMode && (
                <div className="ink-dock__popover" role="menu">
                  <button
                    type="button"
                    className={`ink-dock__pop-item${eraserMode === 'stroke' ? ' is-active' : ''}`}
                    onClick={() => {
                      setEraserMode('stroke');
                      setShowEraserMenu(false);
                    }}
                  >
                    <Icon name="i-eraser" size={15} /> پاک‌کن کل خط
                  </button>
                  <button
                    type="button"
                    className={`ink-dock__pop-item${eraserMode === 'partial' ? ' is-active' : ''}`}
                    onClick={() => {
                      setEraserMode('partial');
                      setShowEraserMenu(false);
                    }}
                  >
                    <Icon name="i-scissors" size={15} /> پاک‌کن برشی و دقیق
                  </button>
                  {setEraseHighlighterOnly && (
                    <label className="ink-highlighter-chip">
                      <input
                        type="checkbox"
                        checked={eraseHighlighterOnly}
                        onChange={(e) => setEraseHighlighterOnly(e.target.checked)}
                      />
                      <span>فقط هایلایتر</span>
                    </label>
                  )}
                </div>
              )}
            </div>

            <span className="ink-dock__sep" aria-hidden="true" />

            {/* ۳ رنگ دسترسی سریع */}
            <div className="ink-dock__swatches" aria-label="رنگ‌های سریع">
              {quickSlots.map((c) => (
                <button
                  key={`quick_${c}`}
                  type="button"
                  ref={setCssVar('--swatch', c)}
                  className={`ink-dock__swatch${color === c ? ' is-active' : ''}`}
                  aria-label={`انتخاب رنگ ${c}`}
                  onClick={() => setColor(c)}
                />
              ))}
              <button
                type="button"
                className={`ink-dock__mini${showColorPalette ? ' is-on' : ''}`}
                onClick={() => setShowColorPalette((v) => !v)}
                title="پالت رنگ‌ها و ضخامت"
                aria-label="پالت کامل رنگ‌ها"
              >
                <Icon name="i-palette" size={16} />
              </button>
            </div>

            <span className="ink-dock__sep" aria-hidden="true" />

            <button
              type="button"
              className="ink-dock__mini"
              onClick={undo}
              disabled={!canUndo}
              title="بازگردانی"
              aria-label="بازگردانی"
            >
              <Icon name="i-arrow-right" size={15} />
            </button>
            <button
              type="button"
              className="ink-dock__mini"
              onClick={redo}
              disabled={!canRedo}
              title="انجام مجدد"
              aria-label="انجام مجدد"
            >
              <Icon name="i-arrow-left" size={15} />
            </button>

            <div className={`ink-sync-circle is-${status}`} aria-label={status} title="وضعیت ذخیرهٔ ابری" />

            <button
              type="button"
              className="ink-stepper-btn"
              onClick={handleToggleTier}
              aria-label={toolbarTier === 'primary' ? 'ابزارهای بیشتر' : 'حالت فشرده'}
            >
              <span>{toolbarTier === 'primary' ? 'ابزارها' : 'فشرده'}</span>
              <Icon name={toolbarTier === 'primary' ? 'i-chevron' : 'i-chevron-r'} size={13} />
            </button>

            {toolbarTier === 'full' && (
              <div className="ink-stepped-drawer">
                <button
                  type="button"
                  className={`ink-dock__btn${tool === 'lasso' ? ' is-on' : ''}`}
                  aria-pressed={tool === 'lasso'}
                  onClick={() => setTool(tool === 'lasso' ? null : 'lasso')}
                  title="کمند انتخاب"
                >
                  <Icon name="i-lasso" size={16} />
                  <span className="ink-dock__btn-label">کمند</span>
                </button>

                {setShapeSnap && (
                  <button
                    type="button"
                    className={`ink-dock__mini${shapeSnap ? ' is-on' : ''}`}
                    aria-pressed={shapeSnap}
                    onClick={() => setShapeSnap(!shapeSnap)}
                    title="صاف‌کننده اشکال هندسی"
                  >
                    <Icon name="i-shapes" size={16} />
                  </button>
                )}

                {setStylusOnly && (
                  <button
                    type="button"
                    className={`ink-dock__mini${stylusOnly ? ' is-on' : ''}`}
                    aria-pressed={stylusOnly}
                    onClick={() => setStylusOnly(!stylusOnly)}
                    title="فقط قلم"
                  >
                    <Icon name="i-fountain" size={16} />
                  </button>
                )}

                {onAddStickyNote && (
                  <button
                    type="button"
                    className="ink-dock__mini"
                    onClick={onAddStickyNote}
                    title="افزودن یادداشت چسبان"
                    aria-label="یادداشت چسبان"
                  >
                    <Icon name="i-pin" size={16} />
                  </button>
                )}

                {totalPages != null && totalPages > 0 && onPrevPage && onNextPage && (
                  <div className="ink-dock__page-pill" role="navigation" aria-label="پیمایش صفحات سند">
                    <button type="button" className="ink-dock__page-btn" onClick={onPrevPage} aria-label="صفحه قبل">
                      <Icon name="i-chevron-r" size={14} />
                    </button>
                    <span className="ink-dock__page-num num" dir="ltr">
                      {faDigits(currentPage ?? 1)} / {faDigits(totalPages)}
                    </span>
                    <button type="button" className="ink-dock__page-btn" onClick={onNextPage} aria-label="صفحه بعد">
                      <Icon name="i-chevron" size={14} />
                    </button>
                  </div>
                )}

                {onToggleInvert && (
                  <button
                    type="button"
                    className={`ink-dock__mini${inverted ? ' is-on' : ''}`}
                    onClick={onToggleInvert}
                    title="وارون‌ساز شب"
                    aria-label="وارون‌ساز شب"
                  >
                    <Icon name={inverted ? 'i-sun' : 'i-moon'} size={15} />
                  </button>
                )}

                {onOpenThumbnails && (
                  <button
                    type="button"
                    className="ink-dock__mini"
                    onClick={onOpenThumbnails}
                    title="پیش‌نمایش صفحات و نشان‌شده‌ها"
                    aria-label="پیش‌نمایش صفحات"
                  >
                    <Icon name="i-grid" size={15} />
                  </button>
                )}

                {onToggleFocus && (
                  <button
                    type="button"
                    className="ink-dock__mini"
                    onClick={onToggleFocus}
                    title="حالت تمرکز تمام‌صفحه"
                    aria-label="تمرکز"
                  >
                    <Icon name="i-expand" size={15} />
                  </button>
                )}

                <button
                  type="button"
                  className="ink-dock__mini"
                  onClick={onOpenNotebook}
                  title="دفتر یادداشت‌های این جزوه"
                  aria-label="دفتر"
                >
                  <Icon name="i-layers" size={15} />
                </button>

                {onToggleAi && (
                  <button
                    type="button"
                    className={`ink-dock__mini${isAiOpen ? ' is-on' : ''}`}
                    onClick={onToggleAi}
                    title="دستیار هوشیار"
                    aria-label="هوشیار"
                  >
                    <Icon name="i-chat" size={15} />
                  </button>
                )}

                <div className="ink-dock__wrap">
                  <button
                    type="button"
                    className="ink-dock__mini"
                    onClick={() => setShowDockMenu((v) => !v)}
                    title="موقعیت نوار ابزار"
                    aria-label="موقعیت نوار ابزار"
                  >
                    <Icon name="i-pin" size={15} />
                  </button>

                  {showDockMenu && (
                    <div className="ink-dock__popover" role="menu">
                      <button
                        type="button"
                        className={`ink-dock__pop-item${dockEdge === 'bottom' ? ' is-active' : ''}`}
                        onClick={() => {
                          setDockEdge('bottom');
                          setShowDockMenu(false);
                        }}
                      >
                        <Icon name="i-arrow-down" size={14} /> پایین (افقی)
                      </button>
                      <button
                        type="button"
                        className={`ink-dock__pop-item${dockEdge === 'right' ? ' is-active' : ''}`}
                        onClick={() => {
                          setDockEdge('right');
                          setDockY(Math.round(window.innerHeight / 2 - 120));
                          setShowDockMenu(false);
                        }}
                      >
                        <Icon name="i-arrow-right" size={14} /> سمت راست (عمودی)
                      </button>
                      <button
                        type="button"
                        className={`ink-dock__pop-item${dockEdge === 'left' ? ' is-active' : ''}`}
                        onClick={() => {
                          setDockEdge('left');
                          setDockY(Math.round(window.innerHeight / 2 - 120));
                          setShowDockMenu(false);
                        }}
                      >
                        <Icon name="i-arrow-left" size={14} /> سمت چپ (عمودی)
                      </button>
                      <button
                        type="button"
                        className={`ink-dock__pop-item${dockEdge === 'top' ? ' is-active' : ''}`}
                        onClick={() => {
                          setDockEdge('top');
                          setShowDockMenu(false);
                        }}
                      >
                        <Icon name="i-arrow-up" size={14} /> بالا (افقی)
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            <button
              type="button"
              className="ink-dock__mini"
              onClick={() => setToolbarTier('dot')}
              title="جمع‌کردن به دات شناور"
              aria-label="جمع‌کردن نوار ابزار"
            >
              <Icon name="i-chevron" size={14} />
            </button>
          </div>

          {tool === 'eraser' && renderEraserSubdock(Boolean(isFlippedBelow))}
          {(showColorPalette || (drawing && toolbarTier === 'full')) &&
            tool !== 'eraser' &&
            renderPaletteSubdock(Boolean(isFlippedBelow))}
        </>
      )}
    </nav>
  );
}
