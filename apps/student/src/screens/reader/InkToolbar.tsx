import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MicGlyph } from './VoiceNotes';
import { Icon } from '../../icons';
import { CustomColorPicker, parseColorToRgba, pushRecentColor, rgbaToHex } from './CustomColorPicker';
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

type DockEdge = 'bottom' | 'top' | 'left' | 'right' | 'free';

const DOCK_KEY = 'hz.reader.dock';

interface DockPrefs {
  edge: DockEdge;
  y?: number;
  free?: { x: number; y: number } | null;
}

/** iPad: top (like Noteful); Android and phones: bottom, within thumb reach; desktop: top. */
function defaultDockEdge(): DockEdge {
  if (typeof window === 'undefined') return 'bottom';
  const ua = navigator.userAgent || '';
  const isIPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
  if (isIPad) return 'top';
  if (/Android|iPhone|iPod|Mobile/i.test(ua) || window.innerWidth <= 640) return 'bottom';
  return 'top';
}

function readDockPrefs(): DockPrefs | null {
  try {
    const raw = window.localStorage.getItem(DOCK_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<DockPrefs>;
    const edges: DockEdge[] = ['bottom', 'top', 'left', 'right', 'free'];
    if (!p || !edges.includes(p.edge as DockEdge)) return null;
    let free: DockPrefs['free'] = null;
    if (p.free && Number.isFinite(p.free.x) && Number.isFinite(p.free.y)) {
      free = {
        x: Math.max(8, Math.min(window.innerWidth - 56, p.free.x)),
        y: Math.max(56, Math.min(window.innerHeight - 56, p.free.y)),
      };
    }
    return {
      edge: p.edge === 'free' && !free ? defaultDockEdge() : (p.edge as DockEdge),
      y: Number.isFinite(p.y) ? Math.max(70, Math.min(window.innerHeight - 120, p.y as number)) : undefined,
      free,
    };
  } catch {
    return null;
  }
}

function writeDockPrefs(p: DockPrefs): void {
  try {
    window.localStorage.setItem(DOCK_KEY, JSON.stringify(p));
  } catch {
    // private mode: position just isn't remembered
  }
}

export type EraserMode = 'stroke' | 'partial';

function setCssVar(name: string, value: string) {
  return (el: HTMLElement | null) => {
    if (el) el.style.setProperty(name, value);
  };
}

function isColorMatch(a: string, b: string): boolean {
  const pa = parseColorToRgba(a);
  const pb = parseColorToRgba(b);
  if (pa && pb) {
    return rgbaToHex(pa).toUpperCase() === rgbaToHex(pb).toUpperCase();
  }
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

function measureAppbarBottom(): number {
  const appbar = document.querySelector<HTMLElement>('.appbar, [role="banner"], header');
  if (appbar && appbar.offsetHeight > 0) {
    return appbar.getBoundingClientRect().bottom;
  }
  return 0;
}

/**
 * Computes collision-safe viewport coordinates (`--float-inline`, `--float-y`, `--float-max-h`)
 * for floating flyouts across top, bottom, left, right, free, and mobile docks.
 * PencilKit rule: the dock is an overlay; flyouts are overlays on the overlay —
 * nothing in the document ever reflows because of them.
 */
function placeFloatingPanel(
  panel: HTMLElement,
  anchor: HTMLElement,
  trigger: HTMLElement | null,
  isVertical: boolean,
  dockEdge: DockEdge,
  isMobile: boolean,
): void {
  const W = window.innerWidth;
  const H = window.visualViewport?.height ?? window.innerHeight;
  const isRtl = getComputedStyle(document.documentElement).direction === 'rtl';

  const headerBottom = measureAppbarBottom();
  const safeTop = Math.max(12, Math.round(headerBottom) + 8);
  const safeBottom = Math.max(safeTop + 120, Math.round(H) - 12);
  const safeLeft = 12;
  const safeRight = Math.max(safeLeft + 120, W - 12);

  const anchorRect = anchor.getBoundingClientRect();
  const trigRect = trigger ? trigger.getBoundingClientRect() : anchorRect;
  const panelW = panel.offsetWidth || 220;
  const panelH = panel.offsetHeight || 160;
  const GAP = 10;

  let x = safeLeft;
  let y = safeTop;
  let maxH = safeBottom - safeTop;

  if (isVertical && !isMobile) {
    const onLeftHalf = anchorRect.left + anchorRect.width / 2 < W / 2;
    const rightSpace = safeRight - (anchorRect.right + GAP);
    const leftSpace = anchorRect.left - GAP - safeLeft;

    if (onLeftHalf) {
      if (rightSpace >= Math.min(panelW, 180) || rightSpace >= leftSpace) {
        x = anchorRect.right + GAP;
      } else {
        x = anchorRect.left - panelW - GAP;
      }
    } else {
      if (leftSpace >= Math.min(panelW, 180) || leftSpace >= rightSpace) {
        x = anchorRect.left - panelW - GAP;
      } else {
        x = anchorRect.right + GAP;
      }
    }

    x = Math.max(safeLeft, Math.min(safeRight - panelW, x));

    // Clamp trigger center to the visible capsule bounds so scrolled triggers never pull panels over the appbar
    const rawCenterY = trigRect.top + trigRect.height / 2;
    const centerY = Math.max(anchorRect.top + 20, Math.min(anchorRect.bottom - 20, rawCenterY));
    const clampedH = Math.min(panelH, safeBottom - safeTop);
    y = Math.max(safeTop, Math.min(safeBottom - clampedH, centerY - clampedH / 2));
    maxH = safeBottom - safeTop;
  } else {
    const spaceBelow = safeBottom - (anchorRect.bottom + GAP);
    const spaceAbove = anchorRect.top - GAP - safeTop;
    const preferBelow =
      dockEdge === 'top' ||
      (dockEdge === 'free' && anchorRect.top + anchorRect.height / 2 < H * 0.42);

    const openBelow = preferBelow
      ? spaceBelow >= Math.min(panelH, 160) || spaceBelow >= spaceAbove
      : spaceAbove < Math.min(panelH, 160) && spaceBelow > spaceAbove;

    if (openBelow) {
      maxH = Math.max(140, spaceBelow);
      y = anchorRect.bottom + GAP;
      const usedH = Math.min(panelH, maxH);
      if (y + usedH > safeBottom) y = Math.max(safeTop, safeBottom - usedH);
    } else {
      maxH = Math.max(140, spaceAbove);
      const usedH = Math.min(panelH, maxH);
      y = Math.max(safeTop, anchorRect.top - usedH - GAP);
    }

    const centerX = (trigger ? trigRect.left + trigRect.width / 2 : anchorRect.left + anchorRect.width / 2);
    x = Math.max(safeLeft, Math.min(safeRight - panelW, centerX - panelW / 2));
  }

  const inlineStart = isRtl ? Math.max(safeLeft, W - x - panelW) : Math.max(safeLeft, x);
  panel.style.setProperty('--float-inline', `${Math.round(inlineStart)}px`);
  panel.style.setProperty('--float-y', `${Math.round(y)}px`);
  panel.style.setProperty('--float-max-h', `${Math.round(maxH)}px`);
}

/** Exactly one flyout open at a time (Excalidraw rule). */
type Flyout = 'pen' | 'eraser' | 'palette' | 'dock' | 'tray' | null;

/** Tool button — icon-only (Noteful convention); active state is fill+border+dot,
    never a size change. Module level on purpose: an inline component type would
    remount every button on each render of the toolbar. */
function ToolBtn(props: {
  on: boolean;
  label: string;
  icon: React.ReactNode;
  dot?: boolean;
  onClick: () => void;
  btnRef?: React.Ref<HTMLButtonElement>;
  tip?: Record<string, unknown>;
}) {
  const { on, label, icon, dot, onClick, btnRef, tip } = props;
  return (
    <button
      ref={btnRef}
      type="button"
      className={`ink-dock__btn${on ? ' is-on' : ''}`}
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      title={label}
      {...tip}
    >
      {icon}
      {dot && <span className="ink-dock__btn-dot" />}
    </button>
  );
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
  onToggleAi?: () => void;
  isAiOpen?: boolean;
  /** Arm voice recording: the next tap on a page records a note pinned there. */
  onVoiceNote?: () => void;
  voiceArmed?: boolean;
  /** Activates page-pixel eyedropper fallback when browser lacks native EyeDropper API. */
  onStartPageEyedropper?: () => void;
  isEyedropperActive?: boolean;
  /** Reports viewport clearance when the dock occupies bottom or bottom-left corner so page pill never overlaps. */
  onBottomClearanceChange?: (bottomPx: number, leftInsetPx?: number) => void;
}

export const InkToolbar = memo(function InkToolbar({
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
  onToggleAi,
  isAiOpen = false,
  onVoiceNote,
  voiceArmed = false,
  onStartPageEyedropper,
  isEyedropperActive = false,
  onBottomClearanceChange,
}: Props) {
  const [flyout, setFlyout] = useState<Flyout>(null);
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  /** Ghost mode: the bar fades away while the student is mid-stroke with a drawing tool. */
  const [ghost, setGhost] = useState(false);
  const [eraserSubdockOpen, setEraserSubdockOpen] = useState(true);

  const [initialDock] = useState(() => (typeof window === 'undefined' ? null : readDockPrefs()));
  const [dockEdge, setDockEdge] = useState<DockEdge>(() => initialDock?.edge ?? defaultDockEdge());
  const [dockY, setDockY] = useState<number>(() => initialDock?.y ?? 220);
  const [freePos, setFreePos] = useState<{ x: number; y: number } | null>(() => initialDock?.free ?? null);

  useEffect(() => {
    writeDockPrefs({ edge: dockEdge, y: dockY, free: freePos });
  }, [dockEdge, dockY, freePos]);

  const floatDock = () => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    setFreePos({ x: Math.max(12, Math.round(W / 2 - 160)), y: Math.max(80, H - 150) });
    setDockEdge('free');
  };

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
      } else {
        setDockY((y) => Math.max(72, Math.min(Math.max(72, window.innerHeight - 280), y)));
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const navRef = useRef<HTMLElement | null>(null);
  const capsuleRef = useRef<HTMLDivElement | null>(null);
  const subdockRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const trayRef = useRef<HTMLDivElement | null>(null);

  const penBtnRef = useRef<HTMLButtonElement | null>(null);
  const eraserBtnRef = useRef<HTMLButtonElement | null>(null);
  const paletteBtnRef = useRef<HTMLButtonElement | null>(null);
  const mobileColorBtnRef = useRef<HTMLButtonElement | null>(null);
  const dockBtnRef = useRef<HTMLButtonElement | null>(null);
  const trayBtnRef = useRef<HTMLButtonElement | null>(null);

  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    origLeft: number;
    origTop: number;
    hasMoved: boolean;
  } | null>(null);

  const isVertical = !isMobile && (dockEdge === 'left' || dockEdge === 'right');

  const openFlyout = useCallback((kind: Flyout) => {
    setFlyout((prev) => (prev === kind ? null : kind));
    setShowCustomPicker(false);
  }, []);

  const closeFlyouts = useCallback(() => {
    setFlyout(null);
  }, []);

  // Vertical-rail inward tooltip (hover + long-press)
  const [hoveredTip, setHoveredTip] = useState<{ text: string; y: number } | null>(null);
  const tipElRef = useRef<HTMLDivElement | null>(null);
  const longPressRef = useRef<number | null>(null);

  const showTip = useCallback(
    (text: string, target: HTMLElement) => {
      if (!isVertical || flyout) return;
      const r = target.getBoundingClientRect();
      setHoveredTip({ text, y: Math.round(r.top + r.height / 2) });
    },
    [isVertical, flyout],
  );

  const hideTip = useCallback(() => {
    if (longPressRef.current) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
    setHoveredTip(null);
  }, []);

  const tipBind = (label: string) => ({
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'touch') showTip(label, e.currentTarget);
    },
    onPointerLeave: () => hideTip(),
    onFocus: (e: React.FocusEvent<HTMLElement>) => showTip(label, e.currentTarget),
    onBlur: () => hideTip(),
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (!isVertical || e.pointerType !== 'touch') return;
      const el = e.currentTarget;
      if (longPressRef.current) window.clearTimeout(longPressRef.current);
      longPressRef.current = window.setTimeout(() => showTip(label, el), 380);
    },
    onPointerUp: () => {
      if (longPressRef.current) {
        window.clearTimeout(longPressRef.current);
        longPressRef.current = null;
      }
    },
    onPointerCancel: () => hideTip(),
  });

  useEffect(() => () => hideTip(), [hideTip]);

  useLayoutEffect(() => {
    const tip = tipElRef.current;
    const nav = navRef.current;
    if (!tip || !nav || !hoveredTip || !isVertical) return;
    const W = window.innerWidth;
    const isRtl = getComputedStyle(document.documentElement).direction === 'rtl';
    const nr = nav.getBoundingClientRect();
    const tw = tip.offsetWidth || 80;
    const th = tip.offsetHeight || 28;
    const onLeftHalf = nr.left + nr.width / 2 < W / 2;
    const x = onLeftHalf ? nr.right + 10 : nr.left - tw - 10;
    const inlineStart = isRtl ? Math.max(8, W - x - tw) : Math.max(8, x);
    const y = Math.max(12, Math.min(window.innerHeight - th - 12, hoveredTip.y - th / 2));
    tip.style.setProperty('--tip-inline', `${Math.round(inlineStart)}px`);
    tip.style.setProperty('--tip-y', `${Math.round(y)}px`);
  }, [hoveredTip, isVertical]);

  // Reset custom picker when the palette closes or eraser selected
  useEffect(() => {
    if (tool === 'eraser') {
      if (flyout === 'palette') setFlyout(null);
      setShowCustomPicker(false);
      setEraserSubdockOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  useEffect(() => {
    if (flyout !== 'palette') {
      setShowCustomPicker(false);
    }
  }, [flyout]);

  // Dismiss flyouts on Escape or clicking outside (PencilKit: palette never steals clicks)
  useEffect(() => {
    const anyOpen = flyout !== null;
    if (!anyOpen) return;

    const onDocPointerDown = (e: PointerEvent) => {
      if (isEyedropperActive) return;
      const target = e.target as Node | null;
      if (navRef.current && target && !navRef.current.contains(target)) {
        setFlyout(null);
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showCustomPicker) {
          setShowCustomPicker(false);
          e.stopPropagation();
        } else if (flyout) {
          setFlyout(null);
          e.stopPropagation();
        }
      }
    };

    document.addEventListener('pointerdown', onDocPointerDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [flyout, showCustomPicker, isEyedropperActive]);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const syncDockPos = () => {
      const W = typeof window !== 'undefined' ? window.innerWidth : 1024;
      const H = typeof window !== 'undefined' ? (window.visualViewport?.height ?? window.innerHeight) : 800;
      const isRtl = typeof document !== 'undefined' && getComputedStyle(document.documentElement).direction === 'rtl';
      const w = nav.offsetWidth || (collapsed ? 48 : 300);
      const posX = freePos ? freePos.x : isMobile ? 16 : 20;
      const posY = freePos ? freePos.y : isMobile ? Math.max(80, H - 68) : dockY;
      const inlineStart = isRtl ? Math.max(8, W - posX - w) : posX;

      const headerBottom = measureAppbarBottom() || 58;
      const safeTop = Math.max(68, Math.round(headerBottom) + 8);
      const cap = capsuleRef.current;
      const naturalH = cap ? Math.min(cap.scrollHeight + 4, H - safeTop - 12) : Math.min(480, H - safeTop - 12);
      const clampedY = isVertical
        ? Math.max(safeTop, Math.min(dockY, H - naturalH - 12))
        : dockY;
      const maxH = Math.max(180, H - clampedY - 12);

      nav.style.setProperty('--ink-pos-x', `${posX}px`);
      nav.style.setProperty('--ink-pos-y', `${posY}px`);
      nav.style.setProperty('--ink-inline', `${inlineStart}px`);
      nav.style.setProperty('--ink-dock-y', `${clampedY}px`);
      nav.style.setProperty('--ink-dock-max-h', `${maxH}px`);
      nav.style.setProperty('--ink-color', color || INK_COLORS[1]);
    };

    syncDockPos();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncDockPos) : null;
    if (ro && capsuleRef.current) ro.observe(capsuleRef.current);
    window.addEventListener('resize', syncDockPos);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', syncDockPos);
    };
  }, [color, dockEdge, dockY, freePos, collapsed, isMobile, isVertical]);

  const isPenActive = tool === 'pen' || tool === 'ballpoint' || tool === 'fountain';
  const drawing = isPenActive || tool === 'pencil' || tool === 'highlighter';
  const paletteOpen = flyout === 'palette' && tool !== 'eraser';
  const eraserOpen = tool === 'eraser' && eraserSubdockOpen && flyout === 'eraser';

  // Report clearance so the floating bottom-left page indicator lifts above bottom dock or nudges clear of left rail
  useLayoutEffect(() => {
    if (!onBottomClearanceChange) return;
    const measure = () => {
      const nav = navRef.current;
      if (!nav || collapsed) {
        onBottomClearanceChange(0, 0);
        return;
      }
      const H = window.innerHeight;
      const r = nav.getBoundingClientRect();
      if (isMobile || dockEdge === 'bottom') {
        onBottomClearanceChange(Math.max(0, Math.round(H - r.top + 10)), 0);
        return;
      }
      // Vertical rail on physical left or narrow free rail touching bottom-left: nudge horizontally inward
      if (dockEdge === 'left' || (dockEdge === 'free' && r.width <= 120 && r.left < 160 && r.bottom > H - 84)) {
        onBottomClearanceChange(0, Math.max(0, Math.round(r.right - 4)));
        return;
      }
      // Wide free floating bar sitting at bottom-left: lift page pill vertically above it
      if (dockEdge === 'free' && r.left < 220 && r.bottom > H - 84) {
        onBottomClearanceChange(Math.max(0, Math.round(H - r.top + 10)), 0);
      } else {
        onBottomClearanceChange(0, 0);
      }
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' && navRef.current ? new ResizeObserver(measure) : null;
    if (ro && navRef.current) ro.observe(navRef.current);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [dockEdge, dockY, freePos, collapsed, isMobile, onBottomClearanceChange]);

  // Collision-safe positioning for flyouts
  const activePopoverKind = flyout === 'pen' || flyout === 'eraser' || flyout === 'dock' ? flyout : null;
  useLayoutEffect(() => {
    const anchor = capsuleRef.current || navRef.current;
    if (!anchor) return;

    const updateAll = () => {
      if (subdockRef.current) {
        const trig =
          paletteOpen
            ? (isMobile ? mobileColorBtnRef.current : paletteBtnRef.current)
            : eraserBtnRef.current;
        placeFloatingPanel(subdockRef.current, anchor, trig, isVertical, dockEdge, isMobile);
      }
      if (popoverRef.current && activePopoverKind) {
        const trig =
          activePopoverKind === 'pen'
            ? penBtnRef.current
            : activePopoverKind === 'eraser'
              ? eraserBtnRef.current
              : dockBtnRef.current;
        placeFloatingPanel(popoverRef.current, anchor, trig, isVertical, dockEdge, isMobile);
      }
      if (trayRef.current) {
        placeFloatingPanel(trayRef.current, anchor, trayBtnRef.current, isVertical, dockEdge, isMobile);
      }
    };

    updateAll();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateAll) : null;
    if (ro) {
      ro.observe(anchor);
      if (subdockRef.current) ro.observe(subdockRef.current);
      if (popoverRef.current) ro.observe(popoverRef.current);
      if (trayRef.current) ro.observe(trayRef.current);
    }
    anchor.addEventListener('scroll', updateAll, { passive: true });
    window.addEventListener('resize', updateAll);
    window.visualViewport?.addEventListener('resize', updateAll);
    return () => {
      ro?.disconnect();
      anchor.removeEventListener('scroll', updateAll);
      window.removeEventListener('resize', updateAll);
      window.visualViewport?.removeEventListener('resize', updateAll);
    };
  }, [
    paletteOpen,
    eraserOpen,
    activePopoverKind,
    flyout,
    showCustomPicker,
    isVertical,
    dockEdge,
    dockY,
    freePos,
    isMobile,
    count,
  ]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!collapsed && (e.target as HTMLElement).closest('button, input, select, label')) {
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
      const w = nav?.offsetWidth || (collapsed ? 48 : 300);
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
    }
    if (dockEdge === 'free' && freePos) {
      const W = window.innerWidth;
      const estimatedWidth = 300;
      if (freePos.x + estimatedWidth > W - 12) {
        setFreePos({
          x: Math.max(12, W - estimatedWidth - 12),
          y: freePos.y,
        });
      }
    }
    setCollapsed(false);
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
      const w = nav?.offsetWidth || (collapsed ? 48 : 300);
      const h = nav?.offsetHeight || 44;
      const W = window.innerWidth;
      const H = window.innerHeight;
      const curLeft = freePos?.x ?? dragStateRef.current.origLeft;
      const curTop = freePos?.y ?? dragStateRef.current.origTop;
      const pointerX = e.clientX;
      const pointerY = e.clientY;

      if (isMobile) {
        if (collapsed) {
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
    } else if (collapsed) {
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

  // Ghost mode: after ~2.6s of continuous pen/finger contact with a drawing tool active,
  // the bar fades to a whisper. First release restores it. Layout never changes —
  // opacity only, so nothing jumps (the anti-pattern that caused the old resize bug).
  useEffect(() => {
    if (!drawing || collapsed) {
      setGhost(false);
      return;
    }
    let timer: number | null = null;
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'pen' && e.pointerType !== 'touch') return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => setGhost(true), 2600);
    };
    const up = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      setGhost(false);
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [drawing, collapsed]);

  const [quickSlots, setQuickSlots] = useState<string[]>([
    INK_COLORS[1], // Blue
    INK_COLORS[2], // Red
    INK_COLORS[0], // Black
  ]);

  const previewPx = Math.max(6, Math.min(24, Math.round(strokeWidth * 1600)));

  const lastInkToolRef = useRef<InkTool>('pen');
  if (tool === 'pen' || tool === 'ballpoint' || tool === 'fountain' || tool === 'pencil' || tool === 'highlighter') {
    lastInkToolRef.current = tool;
  }

  const openColorPaletteFromAnyTool = () => {
    if (tool === 'eraser' || tool === null || tool === 'lasso') {
      setTool(lastInkToolRef.current);
      openFlyout('palette');
    } else {
      openFlyout('palette');
    }
  };

  const selectColor = (c: string, recordRecent = true) => {
    setColor(c);
    if (recordRecent) {
      pushRecentColor(c);
    }
    if (tool === 'eraser' || tool === null || tool === 'lasso') {
      setTool(lastInkToolRef.current);
    }
    if (!quickSlots.some((s) => isColorMatch(s, c))) {
      setQuickSlots((prev) => [c, prev[0], prev[1]]);
    }
  };

  const activeToolLabel =
    tool === 'highlighter'
      ? 'هایلایتر'
      : tool === 'pencil'
        ? 'مداد'
        : tool === 'fountain'
          ? 'روان‌نویس'
          : tool === 'ballpoint'
            ? 'خودکار'
            : 'قلم';

  const navClass = [
    'ink-bar',
    'ink-dock',
    `dock-${dockEdge}`,
    isVertical ? 'is-vertical' : 'is-horizontal',
    dockEdge === 'free' ? 'is-dragged' : '',
    collapsed ? 'is-collapsed' : '',
    isMobile ? 'is-mobile-dock' : '',
    ghost && !collapsed ? 'is-ghost' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const isCustomColorActive = !INK_COLORS.some((c) => isColorMatch(c, color));

  const renderPaletteSubdock = () => (
    <div
      ref={subdockRef}
      className={`ink-dock__subdock ink-dock__subdock--floating${isVertical ? ' is-vertical-subdock' : ''}${
        showCustomPicker ? ' is-custom-open' : ''
      }`}
      role="dialog"
      aria-label="تنظیمات رنگ و ضخامت"
    >
      {showCustomPicker ? (
        <>
          <CustomColorPicker
            color={color}
            onChange={(nextHex) => selectColor(nextHex, false)}
            onCommit={(committedHex) => selectColor(committedHex, true)}
            strokeWidth={strokeWidth}
            toolLabel={activeToolLabel}
            isHighlighter={tool === 'highlighter'}
            onStartPageEyedropper={onStartPageEyedropper}
            isEyedropperActive={isEyedropperActive}
            onBack={() => setShowCustomPicker(false)}
          />
          <div className="ink-dock__subdock-foot">
            <div className="ink-dock__widths" aria-label="ضخامت‌های پیش‌فرض">
              {INK_WIDTHS.map((w, idx) => (
                <button
                  key={`wc_${w}`}
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
            </div>
          </div>
        </>
      ) : (
        <>
          <div
            className={`ink-dock__palette${isVertical ? ' ink-dock__palette--grid' : ''}`}
            aria-label="پالت رنگ"
          >
            {INK_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                ref={setCssVar('--swatch', c)}
                className={`ink-dot${isColorMatch(color, c) ? ' is-on' : ''}`}
                aria-label={`رنگ ${c}`}
                aria-pressed={isColorMatch(color, c)}
                onClick={() => selectColor(c, true)}
              />
            ))}
            <button
              type="button"
              className={`ink-dot ink-dot--custom${isCustomColorActive ? ' is-on' : ''}`}
              onClick={() => setShowCustomPicker(true)}
              title="رنگ دلخواه و طیف دقیق"
              aria-label="رنگ دلخواه"
              aria-expanded={showCustomPicker}
            >
              <Icon name="i-plus" size={13} />
            </button>
          </div>

          <span className="ink-dock__sep" aria-hidden="true" />

          <div className="ink-dock__subdock-controls">
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
                aria-label="پاک‌کردن صفحه"
              >
                <Icon name="i-trash" size={14} />
                <span>{isVertical ? 'پاک‌کردن' : 'پاک‌کردن صفحه'}</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );

  const renderEraserSubdock = () => (
    <div
      ref={subdockRef}
      className={`ink-dock__subdock ink-dock__subdock--floating ink-subdock--eraser${
        isVertical ? ' is-vertical-subdock' : ''
      }`}
      role="dialog"
      aria-label="تنظیمات پاک‌کن"
    >
      {setEraserMode && (
        <div className="ink-eraser-modes" role="group" aria-label="حالت پاک‌کن">
          <button
            type="button"
            className={`ink-mode-chip${eraserMode === 'stroke' ? ' is-active' : ''}`}
            onClick={() => setEraserMode('stroke')}
            title="پاک‌کردن کل خط با یک لمس"
          >
            <Icon name="i-eraser" size={14} />
            <span>کل خط</span>
          </button>
          <button
            type="button"
            className={`ink-mode-chip${eraserMode === 'partial' ? ' is-active' : ''}`}
            onClick={() => setEraserMode('partial')}
            title="پاک‌کردن برشی و دقیق بخشی از خط"
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

      <div className="ink-dock__subdock-controls">
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
          <button
            type="button"
            className="ink-dock__clear"
            onClick={clear}
            title="پاک‌کردن تمامی حاشیه‌نویسی‌های این صفحه"
            aria-label="پاک‌کردن صفحه"
          >
            <Icon name="i-trash" size={14} />
            <span>{isVertical ? 'پاک‌کردن' : 'پاک‌کردن صفحه'}</span>
          </button>
        )}
      </div>
    </div>
  );

  const renderPenPopover = () => (
    <div ref={popoverRef} className="ink-dock__popover ink-dock__popover--floating" role="menu">
      {(
        [
          { id: 'pen', label: 'قلم ژله‌ای دقیق', icon: 'i-pen' },
          { id: 'ballpoint', label: 'قلم خودکار روزمره', icon: 'i-pencil' },
          { id: 'fountain', label: 'روان‌نویس خطاطی', icon: 'i-fountain' },
        ] as const
      ).map((p) => (
        <button
          key={p.id}
          type="button"
          className={`ink-dock__pop-item${tool === p.id ? ' is-active' : ''}`}
          onClick={() => {
            setTool(p.id);
            closeFlyouts();
          }}
        >
          <Icon name={p.icon} size={15} /> {p.label}
        </button>
      ))}
    </div>
  );

  const renderEraserPopover = () =>
    setEraserMode ? (
      <div ref={popoverRef} className="ink-dock__popover ink-dock__popover--floating" role="menu">
        <button
          type="button"
          className={`ink-dock__pop-item${eraserMode === 'stroke' ? ' is-active' : ''}`}
          onClick={() => {
            setEraserMode('stroke');
            closeFlyouts();
          }}
        >
          <Icon name="i-eraser" size={15} /> پاک‌کن کل خط
        </button>
        <button
          type="button"
          className={`ink-dock__pop-item${eraserMode === 'partial' ? ' is-active' : ''}`}
          onClick={() => {
            setEraserMode('partial');
            closeFlyouts();
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
    ) : null;

  const renderDockPopover = () => (
    <div ref={popoverRef} className="ink-dock__popover ink-dock__popover--floating" role="menu">
      {(
        [
          { edge: 'bottom' as DockEdge, label: 'پایین (افقی)', icon: 'i-arrow-down' },
          { edge: 'right' as DockEdge, label: 'سمت راست (عمودی)', icon: 'i-arrow-right' },
          { edge: 'left' as DockEdge, label: 'سمت چپ (عمودی)', icon: 'i-arrow-left' },
          { edge: 'top' as DockEdge, label: 'بالا (افقی)', icon: 'i-arrow-up' },
        ] as const
      ).map((p) => (
        <button
          key={p.edge}
          type="button"
          className={`ink-dock__pop-item${dockEdge === p.edge ? ' is-active' : ''}`}
          onClick={() => {
            setDockEdge(p.edge);
            if (p.edge === 'right' || p.edge === 'left') {
              setDockY(Math.round(window.innerHeight / 2 - 120));
            }
            closeFlyouts();
          }}
        >
          <Icon name={p.icon} size={14} /> {p.label}
        </button>
      ))}
      <button
        type="button"
        className={`ink-dock__pop-item${dockEdge === 'free' ? ' is-active' : ''}`}
        onClick={() => {
          floatDock();
          closeFlyouts();
        }}
      >
        <Icon name="i-pin" size={14} /> شناور (با دستگیره جابه‌جا کن)
      </button>
    </div>
  );

  /** Secondary tools live in one floating tray — the bar itself never resizes. */
  const trayItems: Array<{
    key: string;
    label: string;
    icon: React.ReactNode;
    on?: boolean;
    hidden?: boolean;
    onClick: () => void;
  }> = [
    {
      key: 'lasso',
      label: 'کمند',
      icon: <Icon name="i-lasso" size={18} />,
      on: tool === 'lasso',
      onClick: () => setTool(tool === 'lasso' ? null : 'lasso'),
    },
    {
      key: 'pencil',
      label: 'مداد',
      icon: <Icon name="i-pencil" size={18} />,
      on: tool === 'pencil',
      hidden: !isMobile, // desktop keeps the pencil in the main bar
      onClick: () => setTool(tool === 'pencil' ? null : 'pencil'),
    },
    {
      key: 'voice',
      label: 'ضبط صدا',
      icon: <MicGlyph size={18} />,
      on: voiceArmed,
      hidden: !onVoiceNote,
      onClick: () => {
        onVoiceNote?.();
      },
    },
    {
      key: 'shapes',
      label: 'اشکال هندسی',
      icon: <Icon name="i-shapes" size={18} />,
      on: shapeSnap,
      hidden: !setShapeSnap,
      onClick: () => setShapeSnap?.(!shapeSnap),
    },
    {
      key: 'stylus',
      label: 'فقط قلم',
      icon: <Icon name="i-tablet" size={18} />,
      on: stylusOnly,
      hidden: !setStylusOnly,
      onClick: () => setStylusOnly?.(!stylusOnly),
    },
    {
      key: 'sticky',
      label: 'یادداشت چسبان',
      icon: <Icon name="i-note" size={18} />,
      hidden: !onAddStickyNote,
      onClick: () => {
        onAddStickyNote?.();
        closeFlyouts();
      },
    },
    {
      key: 'invert',
      label: 'کنتراست شب',
      icon: <Icon name={inverted ? 'i-sun' : 'i-moon'} size={18} />,
      on: inverted,
      hidden: !onToggleInvert,
      onClick: () => onToggleInvert?.(),
    },
    {
      key: 'thumbs',
      label: 'همهٔ صفحات',
      icon: <Icon name="i-grid" size={18} />,
      hidden: !onOpenThumbnails,
      onClick: () => {
        closeFlyouts();
        onOpenThumbnails?.();
      },
    },
    {
      key: 'focus',
      label: 'تمامصفحه',
      icon: <Icon name="i-expand" size={18} />,
      hidden: !onToggleFocus,
      onClick: () => {
        closeFlyouts();
        onToggleFocus?.();
      },
    },
    {
      key: 'notebook',
      label: 'دفترچه',
      icon: <Icon name="i-notebook" size={18} />,
      onClick: () => {
        closeFlyouts();
        onOpenNotebook();
      },
    },
    {
      key: 'ai',
      label: 'هوشیار',
      icon: <Icon name="i-chat" size={18} />,
      on: isAiOpen,
      hidden: !onToggleAi,
      onClick: () => {
        closeFlyouts();
        onToggleAi?.();
      },
    },
    {
      key: 'dock',
      label: 'موقعیت نوار',
      icon: <Icon name="i-dock" size={18} />,
      on: flyout === 'dock',
      onClick: () => openFlyout('dock'),
    },
    {
      key: 'clear',
      label: 'پاک‌کردن صفحه',
      icon: <Icon name="i-trash" size={18} />,
      hidden: count === 0,
      onClick: () => {
        clear();
        closeFlyouts();
      },
    },
    {
      key: 'collapse',
      label: 'دات شناور',
      icon: <Icon name="i-collapse" size={18} />,
      onClick: () => {
        closeFlyouts();
        setCollapsed(true);
      },
    },
  ];

  const renderTray = () => (
    <div ref={trayRef} className="ink-dock__tray ink-dock__tray--floating" role="dialog" aria-label="ابزارهای بیشتر">
      <div className="ink-dock__tray-row">
        <span className="ink-dock__tray-title">ابزارهای مطالعه</span>
        <button
          type="button"
          className="ink-dock__mini"
          onClick={closeFlyouts}
          aria-label="بستن"
          title="بستن"
        >
          <Icon name="i-x" size={15} />
        </button>
      </div>
      <div className="ink-dock__tray-grid">
        {trayItems
          .filter((it) => !it.hidden)
          .map((it) => (
            <button
              key={it.key}
              type="button"
              className={`ink-dock__tray-item${it.on ? ' is-on' : ''}`}
              aria-pressed={it.on}
              onClick={it.onClick}
            >
              {it.icon}
              <span>{it.label}</span>
            </button>
          ))}
      </div>
      {isMobile && (
        <div className="ink-dock__tray-foot">
          <button
            type="button"
            className="ink-dock__tray-chip"
            aria-pressed={dockEdge === 'top'}
            onClick={() => {
              setDockEdge('top');
              closeFlyouts();
            }}
          >
            <Icon name="i-arrow-up" size={14} />
            <span>نوار بالا</span>
          </button>
          <button
            type="button"
            className="ink-dock__tray-chip"
            aria-pressed={dockEdge === 'bottom'}
            onClick={() => {
              setDockEdge('bottom');
              closeFlyouts();
            }}
          >
            <Icon name="i-arrow-down" size={14} />
            <span>نوار پایین</span>
          </button>
          <button
            type="button"
            className="ink-dock__tray-chip"
            onClick={() => {
              setFreePos({
                x: Math.max(8, window.innerWidth - 68),
                y: Math.round(window.innerHeight * 0.42),
              });
              setDockEdge('free');
              setCollapsed(true);
              closeFlyouts();
            }}
          >
            <Icon name="i-collapse" size={14} />
            <span>دات شناور</span>
          </button>
        </div>
      )}
    </div>
  );

  const renderActivePopover = () => {
    if (flyout === 'pen') return renderPenPopover();
    if (flyout === 'eraser' && !eraserOpen) return renderEraserPopover();
    if (flyout === 'dock') return renderDockPopover();
    return null;
  };

  return (
    <nav
      ref={navRef}
      className={navClass}
      role="toolbar"
      aria-label="ابزار حاشیه‌نویسی و مطالعه"
      onPointerDown={() => setGhost(false)}
    >
      {collapsed ? (
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
          {/* نوار فشرده موبایل: فقط آیکون، بدون شمارندهٔ صفحه */}
          <div ref={capsuleRef} className="ink-dock__capsule">
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

            <ToolBtn
              on={isPenActive}
              label="قلم"
              tip={tipBind('قلم')}
              icon={<Icon name={tool === 'fountain' ? 'i-fountain' : tool === 'ballpoint' ? 'i-pencil' : 'i-pen'} size={18} />}
              dot={isPenActive}
              onClick={() => {
                if (isPenActive) openFlyout('pen');
                else {
                  closeFlyouts();
                  setTool('pen');
                }
              }}
            />

            <ToolBtn
              on={tool === 'highlighter'}
              label="هایلایت"
              tip={tipBind('هایلایت')}
              icon={<Icon name="i-highlighter" size={18} />}
              dot={tool === 'highlighter'}
              onClick={() => {
                if (tool === 'highlighter') openFlyout('palette');
                else {
                  closeFlyouts();
                  setTool('highlighter');
                }
              }}
            />

            <ToolBtn
              on={tool === 'eraser'}
              label="پاک‌کن"
              tip={tipBind('پاک‌کن')}
              icon={<Icon name="i-eraser" size={18} />}
              btnRef={eraserBtnRef}
              onClick={() => {
                if (tool === 'eraser') {
                  setEraserSubdockOpen((v) => !v);
                  openFlyout('eraser');
                } else {
                  closeFlyouts();
                  setTool('eraser');
                  setEraserSubdockOpen(true);
                  setFlyout('eraser');
                }
              }}
            />

            <button
              type="button"
              ref={mobileColorBtnRef}
              className={`ink-dock__color-btn${flyout === 'palette' ? ' is-open' : ''}`}
              aria-label="انتخاب رنگ و ضخامت"
              aria-expanded={flyout === 'palette'}
              title="رنگ و ضخامت"
              onClick={openColorPaletteFromAnyTool}
            >
              <span className="ink-dock__color-ring" />
            </button>

            <button
              type="button"
              ref={trayBtnRef}
              className={`ink-dock__mini ink-stepper-btn${flyout === 'tray' ? ' is-on' : ''}`}
              aria-label="ابزارهای بیشتر"
              aria-expanded={flyout === 'tray'}
              title="ابزارهای بیشتر"
              onClick={() => openFlyout('tray')}
            >
              <Icon name={flyout === 'tray' ? 'i-x' : 'i-more'} size={18} />
            </button>
          </div>

          {paletteOpen && renderPaletteSubdock()}
          {eraserOpen && renderEraserSubdock()}
          {renderActivePopover()}
          {flyout === 'tray' && renderTray()}
        </>
      ) : (
        <>
          <div ref={capsuleRef} className="ink-dock__capsule">
            <div
              className="ink-dock__drag"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              onPointerEnter={(e) => {
                if (e.pointerType !== 'touch') showTip('جابه‌جایی', e.currentTarget);
              }}
              onPointerLeave={hideTip}
              title="جابه‌جایی نوار ابزار"
              aria-label="جابه‌جایی نوار ابزار"
            >
              <Icon name="i-more" size={14} />
            </div>

            {/* دست: the way out of pen mode; Esc does the same */}
            <ToolBtn
              on={tool === null}
              label="دست"
              tip={tipBind('دست')}
              icon={<Icon name="i-hand" size={17} />}
              onClick={() => {
                closeFlyouts();
                setTool(null);
              }}
            />

            {/* قلم — لمس دوباره روی ابزار فعال، گزینه‌هایش را باز می‌کند */}
            <ToolBtn
              on={isPenActive}
              label={activeToolLabel}
              tip={tipBind(activeToolLabel)}
              icon={<Icon name={tool === 'fountain' ? 'i-fountain' : tool === 'ballpoint' ? 'i-pencil' : 'i-pen'} size={17} />}
              dot={isPenActive}
              btnRef={penBtnRef}
              onClick={() => {
                if (isPenActive) {
                  openFlyout('pen');
                } else {
                  closeFlyouts();
                  setTool('pen');
                }
              }}
            />

            {/* مداد */}
            <ToolBtn
              on={tool === 'pencil'}
              label="مداد"
              tip={tipBind('مداد')}
              icon={<Icon name="i-pencil" size={17} />}
              dot={tool === 'pencil'}
              onClick={() => {
                if (tool === 'pencil') openFlyout('palette');
                else {
                  closeFlyouts();
                  setTool('pencil');
                }
              }}
            />

            {/* هایلایت */}
            <ToolBtn
              on={tool === 'highlighter'}
              label="هایلایت"
              tip={tipBind('هایلایت')}
              icon={<Icon name="i-highlighter" size={17} />}
              dot={tool === 'highlighter'}
              onClick={() => {
                if (tool === 'highlighter') openFlyout('palette');
                else {
                  closeFlyouts();
                  setTool('highlighter');
                }
              }}
            />

            {/* پاک‌کن */}
            <ToolBtn
              on={tool === 'eraser'}
              label="پاک‌کن"
              tip={tipBind('پاک‌کن')}
              icon={<Icon name="i-eraser" size={17} />}
              btnRef={eraserBtnRef}
              onClick={() => {
                if (tool === 'eraser') {
                  setEraserSubdockOpen((v) => !v);
                  openFlyout('eraser');
                } else {
                  closeFlyouts();
                  setTool('eraser');
                  setEraserSubdockOpen(true);
                  setFlyout('eraser');
                }
              }}
            />

            <span className="ink-dock__sep" aria-hidden="true" />

            {/* ۳ رنگ دسترسی سریع + پالت و رنگ دلخواه */}
            <div className="ink-dock__swatches" aria-label="رنگ‌های سریع">
              {quickSlots.map((c) => (
                <button
                  key={`quick_${c}`}
                  type="button"
                  ref={setCssVar('--swatch', c)}
                  className={`ink-dock__swatch${isColorMatch(color, c) ? ' is-active' : ''}`}
                  aria-label={`انتخاب رنگ ${c}`}
                  onClick={() => selectColor(c, true)}
                  {...tipBind('رنگ سریع')}
                >
                  <span className="ink-dock__swatch-dot" aria-hidden="true" />
                </button>
              ))}
              <button
                ref={paletteBtnRef}
                type="button"
                className={`ink-dock__mini ink-dock__palette-trigger${flyout === 'palette' ? ' is-on' : ''}`}
                onClick={openColorPaletteFromAnyTool}
                title="پالت رنگ‌ها و ضخامت"
                aria-label="پالت کامل رنگ‌ها"
                aria-expanded={flyout === 'palette'}
                {...tipBind('رنگ و ضخامت')}
              >
                <Icon name="i-palette" size={17} />
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
              {...tipBind('بازگردانی')}
            >
              <Icon name="i-arrow-right" size={16} />
            </button>
            <button
              type="button"
              className="ink-dock__mini"
              onClick={redo}
              disabled={!canRedo}
              title="انجام مجدد"
              aria-label="انجام مجدد"
              {...tipBind('انجام مجدد')}
            >
              <Icon name="i-arrow-left" size={16} />
            </button>

            <div className={`ink-sync-circle is-${status}`} aria-label={status} title="وضعیت ذخیرهٔ ابری" />

            <button
              ref={trayBtnRef}
              type="button"
              className={`ink-stepper-btn${flyout === 'tray' ? ' is-on' : ''}`}
              onClick={() => openFlyout('tray')}
              aria-label="ابزارهای بیشتر"
              aria-expanded={flyout === 'tray'}
              title="ابزارهای بیشتر"
              {...tipBind('ابزارهای بیشتر')}
            >
              <Icon name={flyout === 'tray' ? 'i-x' : 'i-more'} size={16} />
            </button>

            <button
              type="button"
              className="ink-dock__mini"
              onClick={() => {
                closeFlyouts();
                setCollapsed(true);
              }}
              title="جمعکردن به دات شناور"
              aria-label="جمعکردن نوار ابزار"
              {...tipBind('جمعکردن')}
            >
              <Icon name="i-collapse" size={15} />
            </button>
          </div>

          {renderActivePopover()}
          {eraserOpen && renderEraserSubdock()}
          {paletteOpen && renderPaletteSubdock()}
          {flyout === 'tray' && renderTray()}

          {isVertical && hoveredTip && !flyout && (
            <div ref={tipElRef} className="ink-dock__tooltip" role="tooltip">
              {hoveredTip.text}
            </div>
          )}
        </>
      )}
    </nav>
  );
});
