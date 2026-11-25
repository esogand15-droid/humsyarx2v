import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../icons';
import { type InkTool } from '../../lib/ink';
import type { InkStatus } from './InkLayer';

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
        // در تلفن همراه برای جلوگیری از مسدود شدن مطالعه، لنگرگاه به لبه پایین هدایت می‌شود
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

  const isVertical = dockEdge === 'left' || dockEdge === 'right';

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragStateRef.current) return;
    const dx = e.clientX - dragStateRef.current.startX;
    const dy = e.clientY - dragStateRef.current.startY;
    if (Math.hypot(dx, dy) > 5) {
      dragStateRef.current.hasMoved = true;
    }
    if (dragStateRef.current.hasMoved) {
      const nav = navRef.current;
      const w = nav?.offsetWidth || (toolbarTier === 'dot' ? 48 : toolbarTier === 'primary' ? 260 : 500);
      const h = nav?.offsetHeight || 42;
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
      const estimatedWidth = 260;
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
    if (toolbarTier === 'primary') {
      if (!isMobile && dockEdge === 'free' && freePos) {
        const W = window.innerWidth;
        const fullW = 500;
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
      const w = nav?.offsetWidth || (toolbarTier === 'dot' ? 48 : toolbarTier === 'primary' ? 260 : 500);
      const h = nav?.offsetHeight || 42;
      const W = window.innerWidth;
      const H = window.innerHeight;
      const curLeft = freePos?.x ?? dragStateRef.current.origLeft;
      const curTop = freePos?.y ?? dragStateRef.current.origTop;
      const pointerX = e.clientX;
      const pointerY = e.clientY;

      if (isMobile) {
        // در تلفن همراه: دات جمع‌شده آزادانه جابه‌جا می‌شود، اما نوار بازشده در پایین قفل است
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
        // ── جذب آهن‌ربایی دقیق به لبه‌ها و جداسازی بی‌نهایت آسان (Easy Detach Magnetic Docking) ──
        // برای جلوگیری از گیر کردن و چسبندگی، فقط اگر کرسر مستقیماً در ۳۶ پیکسلی لبهٔ واقعی باشد جذب می‌شود
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
          // جداسازی نرم و رها شدن در هر کجای صفحه به عنوان شناور آزاد
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

  const getNavStyle = (): React.CSSProperties => {
    if (isMobile && !isCollapsed) {
      return {
        bottom: '0px',
        left: '0px',
        right: '0px',
        top: 'auto',
        width: '100vw',
        transform: 'none',
      } as React.CSSProperties;
    }

    const posX = freePos ? `${freePos.x}px` : (isMobile ? '16px' : '20px');
    const posY = freePos ? `${freePos.y}px` : (isMobile ? 'calc(100vh - 68px)' : `${dockY}px`);
    const cssVars: Record<string, string> = {
      '--ink-pos-x': posX,
      '--ink-pos-y': posY,
    };

    if (dockEdge === 'bottom') {
      return {
        ...cssVars,
        bottom: isMobile ? '0px' : '20px',
        top: 'auto',
        left: isMobile ? '0px' : '50%',
        right: isMobile ? '0px' : 'auto',
        width: isMobile ? '100vw' : 'auto',
        transform: isMobile ? 'none' : 'translateX(-50%)',
      } as React.CSSProperties;
    }
    if (dockEdge === 'top') {
      return {
        ...cssVars,
        top: '68px',
        bottom: 'auto',
        left: '50%',
        right: 'auto',
        transform: 'translateX(-50%)',
      } as React.CSSProperties;
    }
    if (dockEdge === 'right') {
      return {
        ...cssVars,
        right: isCollapsed ? '10px' : '12px',
        left: 'auto',
        top: `${dockY}px`,
        bottom: 'auto',
        transform: 'none',
      } as React.CSSProperties;
    }
    if (dockEdge === 'left') {
      return {
        ...cssVars,
        left: isCollapsed ? '10px' : '12px',
        right: 'auto',
        top: `${dockY}px`,
        bottom: 'auto',
        transform: 'none',
      } as React.CSSProperties;
    }
    if (dockEdge === 'free' && freePos) {
      return {
        ...cssVars,
        left: `${freePos.x}px`,
        top: `${freePos.y}px`,
        right: 'auto',
        bottom: 'auto',
        transform: 'none',
      } as React.CSSProperties;
    }
    return cssVars as React.CSSProperties;
  };

  // ۳ اسلات دسترسی سریع رنگ به سبک GoodNotes / iPadOS
  const [quickSlots, setQuickSlots] = useState<string[]>([
    '#2563EB', // Blue
    '#DC2626', // Red
    '#0F172A', // Black
  ]);

  const isPenActive = tool === 'pen' || tool === 'ballpoint' || tool === 'fountain';
  const drawing =
    isPenActive ||
    tool === 'pencil' ||
    tool === 'highlighter';

  const selectColor = (c: string) => {
    setColor(c);
    if (!quickSlots.includes(c)) {
      setQuickSlots((prev) => [c, prev[0], prev[1]]);
    }
  };

  return (
    <nav
      ref={navRef}
      className={`ink-floating-island ink-bar dock-${dockEdge} ${isVertical ? 'is-vertical' : 'is-horizontal'} ${dockEdge === 'free' ? 'is-dragged' : ''} ${isCollapsed ? 'is-collapsed' : ''} ${isMobile ? 'is-mobile-dock' : ''} tier-${toolbarTier}`}
      role="toolbar"
      aria-label="ابزار حاشیه‌نویسی و مطالعه"
      style={getNavStyle()}
    >
      {/* ── حالت فشرده: دات شناور به سبک آیپد (Floating Stylus Dot) ── */}
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
          title="برای بازکردن کشویی ضربه بزنید یا برای چسباندن به لبه‌ها بکشید"
          style={{
            borderColor: color || 'var(--cyan, #00f2fe)',
            boxShadow: `0 0 22px ${color}55, 0 8px 28px rgba(0, 0, 0, 0.6), inset 0 0 10px ${color}22`,
          }}
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
                <span>✏️</span>
              ) : tool === 'lasso' ? (
                <span>➰</span>
              ) : (
                <Icon name="i-pen" size={20} />
              )}
            </div>
            {/* کپسول شیشه‌ای یکپارچه رنگ قلم */}
            <span
              className="ink-dot-color-capsule"
              style={{
                backgroundColor: color,
                boxShadow: `0 0 8px ${color}`,
              }}
            />
          </div>

          {/* نشانگر جهت بازشدن کشویی مطابق با لبهٔ متصل */}
          <span className="ink-dot-dock-glyph" aria-hidden="true">
            {dockEdge === 'right' ? '‹' : dockEdge === 'left' ? '›' : dockEdge === 'top' ? '▾' : '▴'}
          </span>
        </div>
      ) : (
        <>
          {/* ── پالت اصلی ابزارهای شناور (Floating Apple Pencil Palette) ── */}
          <div className="ink-floating-capsule">
            {/* دستگیره جابه‌جایی آزاد نوار در صفحه */}
            <div
              className="ink-drag-handle"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              title="بکشید و در هر کجای صفحه رها کنید یا به لبه‌ها بچسبانید (Drag to Dock)"
              aria-label="جابه‌جایی نوار ابزار"
            >
              <span className="ink-drag-grip">⋮⋮</span>
            </div>

            {/* قلم‌های سه‌گانه */}
            <div className="ink-tool-wrap">
              <button
                type="button"
                className={`ink-pill-btn${isPenActive ? ' is-on' : ''}`}
                aria-pressed={isPenActive}
            onClick={() => {
              if (isPenActive) {
                setShowPenMenu((v) => !v);
              } else {
                setTool('pen');
              }
            }}
            title="قلم خودکار و روان‌نویس (برای تغییر نوع قلم کلیک کنید)"
          >
            <Icon name="i-pen" size={17} />
            <span className="ink-pill-title">
              {tool === 'fountain' ? 'روان‌نویس' : tool === 'ballpoint' ? 'خودکار' : 'قلم'}
            </span>
            <span className="ink-arrow-glyph">▾</span>
          </button>

          {/* منوی شناور انتخاب نوع قلم */}
          {showPenMenu && (
            <div className="ink-popover-menu" role="menu">
              <button
                type="button"
                className={`ink-popover-item${tool === 'pen' ? ' is-active' : ''}`}
                onClick={() => {
                  setTool('pen');
                  setShowPenMenu(false);
                }}
              >
                <span>✒️</span> قلم ژله‌ای دقیق
              </button>
              <button
                type="button"
                className={`ink-popover-item${tool === 'ballpoint' ? ' is-active' : ''}`}
                onClick={() => {
                  setTool('ballpoint');
                  setShowPenMenu(false);
                }}
              >
                <span>🖊️</span> قلم خودکار روزمره
              </button>
              <button
                type="button"
                className={`ink-popover-item${tool === 'fountain' ? ' is-active' : ''}`}
                onClick={() => {
                  setTool('fountain');
                  setShowPenMenu(false);
                }}
              >
                <span>🖋️</span> روان‌نویس خطاطی
              </button>
            </div>
          )}
        </div>

        {/* مداد گرافیتی */}
        <button
          type="button"
          className={`ink-pill-btn${tool === 'pencil' ? ' is-on' : ''}`}
          aria-pressed={tool === 'pencil'}
          onClick={() => setTool(tool === 'pencil' ? null : 'pencil')}
          title="مداد گرافیتی (P)"
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>✏️</span>
          <span className="ink-pill-title">مداد</span>
        </button>

        {/* هایلایتر هوشمند بالینی */}
        <button
          type="button"
          className={`ink-pill-btn${tool === 'highlighter' ? ' is-on' : ''}`}
          aria-pressed={tool === 'highlighter'}
          onClick={() => setTool(tool === 'highlighter' ? null : 'highlighter')}
          title="هایلایتر بالینی با حفظ خوانایی متن (H)"
        >
          <Icon name="i-highlighter" size={17} />
          <span className="ink-pill-title">هایلایت</span>
        </button>

        {/* پاک‌کن وکتوری دوگانه */}
        <div className="ink-tool-wrap">
          <button
            type="button"
            className={`ink-pill-btn${tool === 'eraser' ? ' is-on' : ''}`}
            aria-pressed={tool === 'eraser'}
            onClick={() => {
              if (tool === 'eraser') {
                setShowEraserMenu((v) => !v);
              } else {
                setTool('eraser');
              }
            }}
            title="پاک‌کن وکتور (E)"
          >
            <Icon name="i-eraser" size={17} />
            <span className="ink-pill-title">
              {eraserMode === 'partial' ? 'پاک‌کن برشی' : 'پاک‌کن'}
            </span>
            <span className="ink-arrow-glyph">▾</span>
          </button>

          {/* منوی شناور تنظیمات پاک‌کن */}
          {showEraserMenu && setEraserMode && (
            <div className="ink-popover-menu" role="menu">
              <button
                type="button"
                className={`ink-popover-item${eraserMode === 'stroke' ? ' is-active' : ''}`}
                onClick={() => {
                  setEraserMode('stroke');
                  setShowEraserMenu(false);
                }}
              >
                <span>🧹</span> پاک‌کن کل خط
              </button>
              <button
                type="button"
                className={`ink-popover-item${eraserMode === 'partial' ? ' is-active' : ''}`}
                onClick={() => {
                  setEraserMode('partial');
                  setShowEraserMenu(false);
                }}
              >
                <span>✂️</span> پاک‌کن برشی و دقیق
              </button>
              {setEraseHighlighterOnly && (
                <label className="ink-popover-check">
                  <input
                    type="checkbox"
                    checked={eraseHighlighterOnly}
                    onChange={(e) => setEraseHighlighterOnly(e.target.checked)}
                  />
                  <span>فقط هایلایتر</span>
                </label>
              )}
              <div className="ink-popover-divider" />
              <div className="ink-popover-slider-row">
                <span className="ink-popover-slider-label">سایز پاک‌کن:</span>
                <input
                  type="range"
                  min="0.001"
                  max="0.015"
                  step="0.0005"
                  value={strokeWidth}
                  onChange={(e) => setStrokeWidth(parseFloat(e.target.value))}
                  className="ink-slider"
                  aria-label="سایز پاک‌کن"
                  title={`قطر پاک‌کن: ${Math.round(strokeWidth * 10000) / 10}`}
                />
              </div>
            </div>
          )}
        </div>

        <div className="ink-capsule-divider" />

        {/* ۳ اسلات دسترسی سریع رنگ GoodNotes */}
        <div className="ink-quick-color-slots" aria-label="رنگ‌های دسترسی سریع">
          {quickSlots.map((c) => (
            <button
              key={`quick_${c}`}
              type="button"
              className={`ink-quick-swatch${color === c ? ' is-active' : ''}`}
              style={{ backgroundColor: c }}
              aria-label={`انتخاب سریع رنگ ${c}`}
              onClick={() => setColor(c)}
            />
          ))}
        </div>

        <div className="ink-capsule-divider" />

        {/* دکمه‌های بازگردانی و انجام مجدد */}
        <button
          type="button"
          className="ink-mini-action"
          onClick={undo}
          disabled={!canUndo}
          title="بازگردانی (Ctrl+Z)"
          aria-label="بازگردانی"
        >
          <Icon name="i-chevron-r" size={15} />
        </button>
        <button
          type="button"
          className="ink-mini-action"
          onClick={redo}
          disabled={!canRedo}
          title="انجام مجدد (Ctrl+Y)"
          aria-label="دوباره"
        >
          <Icon name="i-chevron" size={15} />
        </button>

        <div className="ink-capsule-divider" />

        {/* نشانگر سینک دایره‌ای ابری (Circular Sync Indicator) */}
        <div className="ink-sync-wrap" title={
          status === 'saved'
            ? 'همگام‌سازی ابری هامزیار: تمامی یادداشت‌ها ذخیره شد'
            : status === 'saving'
            ? 'در حال همگام‌سازی ابری…'
            : status === 'pending'
            ? 'در انتظار اتصال اینترنت'
            : 'آماده'
        }>
          <div className={`ink-sync-circle is-${status}`} aria-label={status} />
        </div>

        {/* ── دکمه توسعه پله‌ای کشویی (Stepped Telescopic Toggle) ── */}
        <button
          type="button"
          className="ink-stepper-btn"
          onClick={handleToggleTier}
          title={
            toolbarTier === 'primary'
              ? 'بازکردن جعبه ابزار پیشرفته (اشکال، کمند، صفحات، یادداشت و هوش‌مصنوعی)'
              : 'جمع‌کردن به قلم‌های اصلی (پله ۱)'
          }
          aria-label={toolbarTier === 'primary' ? 'ابزارهای بیشتر' : 'حالت فشرده'}
        >
          <span className="ink-stepper-label">{toolbarTier === 'primary' ? 'ابزارها' : 'فشرده'}</span>
          <span className="ink-stepper-glyph">
            {toolbarTier === 'primary' ? (isVertical ? '▾' : '▶') : (isVertical ? '▴' : '◀')}
          </span>
        </button>

        {/* ── پله ۲: کشو متحرک ابزارهای تکمیلی (Tier 2 Stepped Drawer) ── */}
        {toolbarTier === 'full' && (
          <div className="ink-stepped-drawer">
            {/* کمند انتخاب و جابه‌جایی */}
            <button
              type="button"
              className={`ink-pill-btn${tool === 'lasso' ? ' is-on' : ''}`}
              aria-pressed={tool === 'lasso'}
              onClick={() => setTool(tool === 'lasso' ? null : 'lasso')}
              title="کمند انتخاب (L)"
            >
              <span style={{ fontSize: 16, lineHeight: 1 }}>➰</span>
              <span className="ink-pill-title">کمند</span>
            </button>

            {/* صاف‌کننده اشکال هندسی و خط‌کش */}
            {setShapeSnap && (
              <button
                type="button"
                className={`ink-pill-btn${shapeSnap ? ' is-on' : ''}`}
                aria-pressed={shapeSnap}
                onClick={() => setShapeSnap(!shapeSnap)}
                title="صاف‌کننده اشکال هندسی (S)"
              >
                <span style={{ fontSize: 16, lineHeight: 1 }}>📐</span>
                <span className="ink-pill-title">اشکال</span>
              </button>
            )}

            {/* حالت اختصاصی قلم (Palm Rejection) */}
            {setStylusOnly && (
              <button
                type="button"
                className={`ink-pill-btn${stylusOnly ? ' is-on' : ''}`}
                aria-pressed={stylusOnly}
                onClick={() => setStylusOnly(!stylusOnly)}
                title={
                  stylusOnly
                    ? 'فقط با قلم بنویس (لمس دست فقط برای اسکرول است)'
                    : 'نوشتن با لمس و قلم هر دو فعال است'
                }
              >
                <span style={{ fontSize: 16, lineHeight: 1 }}>✍️</span>
                <span className="ink-pill-title">فقط قلم</span>
              </button>
            )}

            {/* یادداشت چسبان */}
            {onAddStickyNote && (
              <button
                type="button"
                className="ink-pill-btn"
                onClick={onAddStickyNote}
                title="افزودن یادداشت چسبان به حاشیه"
              >
                <span style={{ fontSize: 16, lineHeight: 1 }}>📌</span>
                <span className="ink-pill-title">یادداشت</span>
              </button>
            )}

            {/* بازکردن پالت کامل رنگ */}
            <button
              type="button"
              className={`ink-swatch-expand${showColorPalette ? ' is-open' : ''}`}
              onClick={() => setShowColorPalette((v) => !v)}
              title="پالت کامل رنگ‌های پزشکی"
              aria-label="پالت کامل رنگ‌ها"
            >
              🎨
            </button>

            <div className="ink-capsule-divider" />

            {/* پیمایش صفحات به سبک آیپد در داخل جزیره شناور */}
            {totalPages != null && totalPages > 0 && onPrevPage && onNextPage && (
              <>
                <div className="ink-page-nav-pill" role="navigation" aria-label="پیمایش صفحات سند">
                  <button
                    type="button"
                    className="ink-page-nav-btn"
                    onClick={onPrevPage}
                    title="صفحهٔ قبل"
                    aria-label="صفحهٔ قبل"
                  >
                    <Icon name="i-chevron-r" size={13} />
                  </button>
                  <span className="ink-page-nav-counter num" dir="ltr">
                    {currentPage ?? 1} / {totalPages}
                  </span>
                  <button
                    type="button"
                    className="ink-page-nav-btn"
                    onClick={onNextPage}
                    title="صفحهٔ بعد"
                    aria-label="صفحهٔ بعد"
                  >
                    <Icon name="i-chevron" size={13} />
                  </button>
                </div>
              </>
            )}

            {/* ابزارهای ثانویه: شب، پیش‌نمایش و تمرکز */}
            {onToggleInvert && (
              <button
                type="button"
                className={`ink-mini-action${inverted ? ' is-active' : ''}`}
                onClick={onToggleInvert}
                title={inverted ? 'تصویر اصلی' : 'کنتراست شبانه (Obsidian)'}
                aria-label="وارون‌ساز شب"
              >
                <Icon name={inverted ? 'i-sun' : 'i-moon'} size={15} />
              </button>
            )}

            {onOpenThumbnails && (
              <button
                type="button"
                className="ink-mini-action"
                onClick={onOpenThumbnails}
                title="پیش‌نمایش صفحات و نشان‌شده‌ها (T)"
                aria-label="پیش‌نمایش صفحات"
              >
                <Icon name="i-grid" size={15} />
              </button>
            )}

            {onToggleFocus && (
              <button
                type="button"
                className="ink-mini-action"
                onClick={onToggleFocus}
                title="حالت تمرکز تمام‌صفحه (F)"
                aria-label="تمرکز"
              >
                <span style={{ fontSize: 14 }}>⛶</span>
              </button>
            )}

            <button
              type="button"
              className="ink-mini-action"
              onClick={onOpenNotebook}
              title="دفتر یادداشت‌های این جزوه"
              aria-label="دفتر"
            >
              <Icon name="i-layers" size={15} />
            </button>

            {onToggleAi && (
              <button
                type="button"
                className={`ink-mini-action${isAiOpen ? ' is-on' : ''}`}
                onClick={onToggleAi}
                title="دستیار هوش‌یار (\)"
                aria-label="هوش‌یار"
                style={isAiOpen ? { color: '#00F2FE', background: 'rgba(0, 242, 254, 0.15)' } : undefined}
              >
                <Icon name="i-chat" size={15} />
              </button>
            )}

            <div className="ink-capsule-divider" />

            {/* منوی اتصال هوشمند به لبه‌های صفحه (Edge Snapping & Dock Control) */}
            <div className="ink-tool-wrap">
              <button
                type="button"
                className="ink-mini-action"
                onClick={() => setShowDockMenu((v) => !v)}
                title="چسباندن نوار ابزار به لبه‌های صفحه (راست، چپ، پایین، بالا)"
                aria-label="چسباندن نوار ابزار به لبه‌ها"
              >
                <span style={{ fontSize: 13, lineHeight: 1 }}>📌</span>
              </button>

              {showDockMenu && (
                <div className="ink-popover-menu ink-dock-menu" role="menu">
                  <button
                    type="button"
                    className={`ink-popover-item${dockEdge === 'bottom' ? ' is-active' : ''}`}
                    onClick={() => {
                      setDockEdge('bottom');
                      setShowDockMenu(false);
                    }}
                  >
                    <span>⬇️</span> پایین (افقی)
                  </button>
                  <button
                    type="button"
                    className={`ink-popover-item${dockEdge === 'right' ? ' is-active' : ''}`}
                    onClick={() => {
                      setDockEdge('right');
                      setDockY(Math.round(window.innerHeight / 2 - 120));
                      setShowDockMenu(false);
                    }}
                  >
                    <span>➡️</span> سمت راست (عمودی)
                  </button>
                  <button
                    type="button"
                    className={`ink-popover-item${dockEdge === 'left' ? ' is-active' : ''}`}
                    onClick={() => {
                      setDockEdge('left');
                      setDockY(Math.round(window.innerHeight / 2 - 120));
                      setShowDockMenu(false);
                    }}
                  >
                    <span>⬅️</span> سمت چپ (عمودی)
                  </button>
                  <button
                    type="button"
                    className={`ink-popover-item${dockEdge === 'top' ? ' is-active' : ''}`}
                    onClick={() => {
                      setDockEdge('top');
                      setShowDockMenu(false);
                    }}
                  >
                    <span>⬆️</span> بالا (افقی)
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* دکمه جمع‌شدن به دات شناور */}
        <button
          type="button"
          className="ink-collapse-btn ink-mini-action"
          onClick={() => setToolbarTier('dot')}
          title="جمع کردن به دات شناور کشویی"
          aria-label="جمع کردن نوار ابزار"
        >
          <Icon name="i-chevron" size={14} />
        </button>
      </div>

      {/* ── پالت تکمیلی پاک‌کن شناور (Floating Eraser Subdock) ── */}
      {tool === 'eraser' && (
        <div
          className={`ink-floating-subdock ink-subdock--eraser ${
            dockEdge === 'top' || (dockEdge === 'free' && freePos && freePos.y < 120) || (dockEdge !== 'bottom' && dockY < 120)
              ? 'is-flipped-below'
              : ''
          }`}
        >
          {setEraserMode && (
            <div className="ink-eraser-modes" role="group" aria-label="حالت پاک‌کن">
              <button
                type="button"
                className={`ink-mode-chip${eraserMode === 'stroke' ? ' is-active' : ''}`}
                onClick={() => setEraserMode('stroke')}
                title="پاک‌کردن کل خط با یک لمس"
              >
                <span>🧹</span> کل خط
              </button>
              <button
                type="button"
                className={`ink-mode-chip${eraserMode === 'partial' ? ' is-active' : ''}`}
                onClick={() => setEraserMode('partial')}
                title="پاک‌کردن برشی و دقیق بخشی از خط"
              >
                <span>✂️</span> برشی دقیق
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

          <div className="ink-capsule-divider" />

          {/* پیش‌تنظیم‌های اندازه پاک‌کن */}
          <div className="ink-width-presets" aria-label="اندازه‌های پاک‌کن">
            <button
              type="button"
              className={`ink-width-preset-btn${Math.abs(strokeWidth - 0.002) < 0.001 ? ' is-on' : ''}`}
              onClick={() => setStrokeWidth(0.002)}
              title="پاک‌کن ریز"
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#38BDF8', display: 'inline-block' }} />
            </button>
            <button
              type="button"
              className={`ink-width-preset-btn${Math.abs(strokeWidth - 0.005) < 0.0015 ? ' is-on' : ''}`}
              onClick={() => setStrokeWidth(0.005)}
              title="پاک‌کن متوسط"
            >
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#38BDF8', display: 'inline-block' }} />
            </button>
            <button
              type="button"
              className={`ink-width-preset-btn${Math.abs(strokeWidth - 0.010) < 0.0025 ? ' is-on' : ''}`}
              onClick={() => setStrokeWidth(0.010)}
              title="پاک‌کن درشت"
            >
              <span style={{ width: 14, height: 14, borderRadius: '50%', background: '#38BDF8', display: 'inline-block' }} />
            </button>
          </div>

          {/* اسلایدر پیوسته اندازه پاک‌کن */}
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
              title={`قطر پاک‌کن: ${Math.round(strokeWidth * 10000) / 10}`}
            />
            <span
              className="ink-width-preview-dot ink-eraser-preview-dot"
              style={{
                width: `${Math.max(6, Math.min(26, Math.round(strokeWidth * 1800)))}px`,
                height: `${Math.max(6, Math.min(26, Math.round(strokeWidth * 1800)))}px`,
                borderColor: 'var(--cyan, #00f2fe)',
                backgroundColor: 'rgba(0, 242, 254, 0.25)',
              }}
              title="پیش‌نمایش اندازه پاک‌کن"
            />
          </div>

          {count > 0 && (
            <>
              <div className="ink-capsule-divider" />
              <button
                type="button"
                className="ink-clear-btn"
                onClick={clear}
                title="پاک‌کردن تمامی حاشیه‌نویسی‌های این صفحه"
              >
                پاک‌کردن صفحه
              </button>
            </>
          )}
        </div>
      )}

      {/* ── پالت تکمیلی رنگ‌ها و اسلایدر ضخامت (Floating Secondary Dock) ── */}
      {(drawing || showColorPalette) && tool !== 'eraser' && (
        <div
          className={`ink-floating-subdock ${
            dockEdge === 'top' || (dockEdge === 'free' && freePos && freePos.y < 120) || (dockEdge !== 'bottom' && dockY < 120)
              ? 'is-flipped-below'
              : ''
          }`}
        >
          {/* پالت کامل رنگ‌های ۹ گانه پزشکی */}
          <div className="ink-palette-row">
            {INK_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`ink-dot${color === c ? ' is-on' : ''}`}
                style={{ background: c }}
                aria-label={`رنگ ${c}`}
                aria-pressed={color === c}
                onClick={() => selectColor(c)}
              />
            ))}
          </div>

          <div className="ink-capsule-divider" />

          {/* پیش‌تنظیم‌های ضخامت و اسلایدر */}
          <div className="ink-width-presets" aria-label="ضخامت‌های پیش‌فرض">
            {INK_WIDTHS.map((w, idx) => (
              <button
                key={`w_${w}`}
                type="button"
                className={`ink-width-preset-btn${Math.abs(strokeWidth - w) < 0.0005 ? ' is-on' : ''}`}
                onClick={() => setStrokeWidth(w)}
                title={idx === 0 ? 'نازک' : idx === 1 ? 'متوسط' : 'ضخیم'}
              >
                <span
                  style={{
                    width: idx === 0 ? 4 : idx === 1 ? 8 : 12,
                    height: idx === 0 ? 4 : idx === 1 ? 8 : 12,
                    borderRadius: '50%',
                    background: color,
                    display: 'inline-block',
                  }}
                />
              </button>
            ))}
          </div>

          {/* Continuous Width Slider & Dynamic Preview Dot */}
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
              title={`ضخامت: ${Math.round(strokeWidth * 10000) / 10}`}
            />
            <span
              className="ink-width-preview-dot"
              style={{
                width: `${Math.max(4, Math.min(22, Math.round(strokeWidth * 1600)))}px`,
                height: `${Math.max(4, Math.min(22, Math.round(strokeWidth * 1600)))}px`,
                backgroundColor: color,
              }}
              title="پیش‌نمایش ضخامت"
            />
          </div>

          {count > 0 && (
            <>
              <div className="ink-capsule-divider" />
              <button
                type="button"
                className="ink-clear-btn"
                onClick={clear}
                title="پاک‌کردن تمامی حاشیه‌نویسی‌های این صفحه"
              >
                پاک‌کردن صفحه
              </button>
            </>
          )}
        </div>
      )}
    </>
  )}
</nav>
  );
}
