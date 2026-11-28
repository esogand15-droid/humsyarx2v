import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../../icons';
import { faDigits } from '../../lib/fa';

export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface HsvaColor {
  h: number;
  s: number;
  v: number;
  a: number;
}

export interface HslaColor {
  h: number;
  s: number;
  l: number;
  a: number;
}

type InputFormat = 'hex' | 'rgb' | 'hsl';

const RECENT_KEY = 'hz.reader.recentColors';
const SAVED_KEY = 'hz.reader.savedColors';
const MAX_RECENT = 8;
/** یک «انتخاب رنگ» = یک ثبت: فاصلهٔ کمتر از این با آخرین ثبتِ قبلی، ثبت نمی‌شود */
const COMMIT_MIN_DISTANCE = 14;
/** ژست‌های پشت‌سرهم (SV→hue→alpha) داخل همین پنجره یک جلسه‌اند */
const COMMIT_DEBOUNCE_MS = 380;

/** فاصلهٔ تقریبی دو رنگ (مجموع اختلاف کانال‌ها + آلفا) — برای آستانهٔ ثبت */
function colorDistance(a: string, b: string): number {
  const pa = parseColorToRgba(a);
  const pb = parseColorToRgba(b);
  if (!pa || !pb) return Number.POSITIVE_INFINITY;
  return (
    Math.abs(pa.r - pb.r) + Math.abs(pa.g - pb.g) + Math.abs(pa.b - pb.b) + Math.abs(pa.a - pb.a) * 128
  );
}
const MAX_SAVED = 12;

const clamp = (val: number, min: number, max: number) => Math.min(max, Math.max(min, val));

export function parseColorToRgba(input: string): RgbaColor | null {
  const s = input.trim();
  if (!s) return null;

  // #RGB, #RGBA, #RRGGBB, #RRGGBBAA
  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
  if (hexMatch) {
    const h = hexMatch[1];
    if (h.length === 3 || h.length === 4) {
      const r = parseInt(h[0] + h[0], 16);
      const g = parseInt(h[1] + h[1], 16);
      const b = parseInt(h[2] + h[2], 16);
      const a = h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1;
      return { r, g, b, a };
    }
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }

  // rgb(r, g, b) / rgba(r, g, b, a)
  const rgbMatch = /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(s);
  if (rgbMatch) {
    const r = clamp(Math.round(Number(rgbMatch[1])), 0, 255);
    const g = clamp(Math.round(Number(rgbMatch[2])), 0, 255);
    const b = clamp(Math.round(Number(rgbMatch[3])), 0, 255);
    let a = 1;
    if (rgbMatch[4] !== undefined) {
      a = rgbMatch[4].endsWith('%') ? parseFloat(rgbMatch[4]) / 100 : parseFloat(rgbMatch[4]);
    }
    return { r, g, b, a: clamp(Number.isFinite(a) ? a : 1, 0, 1) };
  }

  return null;
}

export function rgbaToHex({ r, g, b, a }: RgbaColor, includeAlpha = true): string {
  const toHex = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0').toUpperCase();
  const base = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  if (!includeAlpha || a >= 0.995) return base;
  return `${base}${toHex(a * 255)}`;
}

export function hsvaToRgba({ h, s, v, a }: HsvaColor): RgbaColor {
  const hn = ((h % 360) + 360) % 360;
  const sn = clamp(s, 0, 100) / 100;
  const vn = clamp(v, 0, 100) / 100;
  const c = vn * sn;
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
  const m = vn - c;

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hn < 60) [r1, g1, b1] = [c, x, 0];
  else if (hn < 120) [r1, g1, b1] = [x, c, 0];
  else if (hn < 180) [r1, g1, b1] = [0, c, x];
  else if (hn < 240) [r1, g1, b1] = [0, x, c];
  else if (hn < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];

  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
    a: clamp(a, 0, 1),
  };
}

export function rgbaToHsva({ r, g, b, a }: RgbaColor): HsvaColor {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : (d / max) * 100;
  const v = max * 100;
  return { h, s, v, a: clamp(a, 0, 1) };
}

export function rgbaToHsla({ r, g, b, a }: RgbaColor): HslaColor {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100), a };
}

export function hslaToRgba({ h, s, l, a }: HslaColor): RgbaColor {
  const hn = ((h % 360) + 360) % 360;
  const sn = clamp(s, 0, 100) / 100;
  const ln = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
  const m = ln - c / 2;
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hn < 60) [r1, g1, b1] = [c, x, 0];
  else if (hn < 120) [r1, g1, b1] = [x, c, 0];
  else if (hn < 180) [r1, g1, b1] = [0, c, x];
  else if (hn < 240) [r1, g1, b1] = [0, x, c];
  else if (hn < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
    a: clamp(a, 0, 1),
  };
}

function readColorList(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((c): c is string => typeof c === 'string' && Boolean(parseColorToRgba(c)));
  } catch {
    return [];
  }
}

function writeColorList(key: string, list: string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // private mode / quota exceeded
  }
}

export function readRecentColors(): string[] {
  return readColorList(RECENT_KEY).slice(0, MAX_RECENT);
}

export function pushRecentColor(hex: string): string[] {
  const rgba = parseColorToRgba(hex);
  if (!rgba) return readRecentColors();
  const normalized = rgbaToHex(rgba);
  const existing = readRecentColors();
  // ضد flood: اگر تقریباً همان رنگ سرِ لیست است، ثبت نشود (قبلاً هر درگِ جدا
  // یک ورودی تقریباً یکسان می‌ساخت و لیست اخیرها پر از تکرارهای نزدیک می‌شد)
  if (existing.length > 0 && colorDistance(normalized, existing[0]) < 8) return existing;
  const next = [normalized, ...existing.filter((c) => c.toUpperCase() !== normalized.toUpperCase())].slice(0, MAX_RECENT);
  writeColorList(RECENT_KEY, next);
  return next;
}

export function readSavedColors(): string[] {
  return readColorList(SAVED_KEY).slice(0, MAX_SAVED);
}

export function saveUserColor(hex: string): string[] {
  const rgba = parseColorToRgba(hex);
  if (!rgba) return readSavedColors();
  const normalized = rgbaToHex(rgba);
  const existing = readSavedColors();
  if (existing.some((c) => c.toUpperCase() === normalized.toUpperCase())) return existing;
  const next = [normalized, ...existing].slice(0, MAX_SAVED);
  writeColorList(SAVED_KEY, next);
  return next;
}

export function removeUserColor(hex: string): string[] {
  const norm = hex.toUpperCase();
  const next = readSavedColors().filter((c) => c.toUpperCase() !== norm);
  writeColorList(SAVED_KEY, next);
  return next;
}

function setCssVar(name: string, value: string) {
  return (el: HTMLElement | null) => {
    if (el) el.style.setProperty(name, value);
  };
}

interface CustomColorPickerProps {
  color: string;
  onChange: (nextHex: string) => void;
  onCommit?: (committedHex: string) => void;
  strokeWidth: number;
  toolLabel: string;
  isHighlighter?: boolean;
  onStartPageEyedropper?: () => void;
  isEyedropperActive?: boolean;
  onBack?: () => void;
}

/**
 * انتخابگر رنگ حرفه‌ای (HSVA + HEX/RGB/HSL + قطره‌چکان + رنگ‌های اخیر و شخصی + پیش‌نمایش زنده).
 * طراحی صفر-وابستگی همسو با توکن‌های DS v2 و اهداف لمسی ۴۴px بدون هیچگونه رنگ هاردکد در CSS.
 */
export function CustomColorPicker({
  color,
  onChange,
  onCommit,
  strokeWidth,
  toolLabel,
  isHighlighter = false,
  onStartPageEyedropper,
  isEyedropperActive = false,
  onBack,
}: CustomColorPickerProps) {
  const [hsva, setHsva] = useState<HsvaColor>(() => {
    const parsed = parseColorToRgba(color);
    return parsed ? rgbaToHsva(parsed) : { h: 221, s: 84, v: 92, a: 1 };
  });
  const [format, setFormat] = useState<InputFormat>('hex');
  const [hexDraft, setHexDraft] = useState(() => {
    const parsed = parseColorToRgba(color);
    return parsed ? rgbaToHex(parsed) : rgbaToHex(hsvaToRgba({ h: 221, s: 84, v: 92, a: 1 }));
  });
  const [recentColors, setRecentColors] = useState<string[]>(() => readRecentColors());
  const [savedColors, setSavedColors] = useState<string[]>(() => readSavedColors());

  const rootRef = useRef<HTMLDivElement | null>(null);
  const svBoxRef = useRef<HTMLDivElement | null>(null);
  const hueBarRef = useRef<HTMLDivElement | null>(null);
  const alphaBarRef = useRef<HTMLDivElement | null>(null);
  const nativeInputRef = useRef<HTMLInputElement | null>(null);
  const latestHexRef = useRef<string>(hexDraft);
  const lastEmittedRef = useRef<string>(color.toUpperCase());
  /** آخرین رنگی که واقعاً ثبت شده — آستانهٔ فاصله با این مقایسه می‌شود */
  const lastCommittedRef = useRef<string>(color.toUpperCase());

  // Sync external color updates (e.g. clicking a preset swatch or eyedropper finish)
  useEffect(() => {
    const norm = color.trim().toUpperCase();
    if (norm === lastEmittedRef.current) return;
    const parsed = parseColorToRgba(color);
    if (!parsed) return;
    const nextHsva = rgbaToHsva(parsed);
    setHsva((prev) => ({
      // Preserve hue/saturation when moving to pure black/white externally if color matches gray
      h: nextHsva.s > 0.5 ? nextHsva.h : prev.h,
      s: nextHsva.v > 0.5 ? nextHsva.s : prev.s,
      v: nextHsva.v,
      a: nextHsva.a,
    }));
    const hex = rgbaToHex(parsed);
    setHexDraft(hex);
    latestHexRef.current = hex;
    lastEmittedRef.current = hex.toUpperCase();
    // تغییر از بیرون (سواچ پیش‌فرض، قطره‌چکان…) همین‌جا ثبت‌شده حساب می‌شود
    lastCommittedRef.current = hex.toUpperCase();
  }, [color]);

  const rgba = hsvaToRgba(hsva);
  const hsla = rgbaToHsla(rgba);
  const solidHex = rgbaToHex({ ...rgba, a: 1 }, false);
  const currentHex = rgbaToHex(rgba, true);
  latestHexRef.current = currentHex;

  // Apply CSS variables to picker root without inline style={{}}
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    el.style.setProperty('--cp-hue', String(Math.round(hsva.h)));
    el.style.setProperty('--cp-solid', solidHex);
    el.style.setProperty('--cp-color', currentHex);
    el.style.setProperty('--cp-x', `${clamp(hsva.s, 0, 100)}%`);
    el.style.setProperty('--cp-y', `${clamp(100 - hsva.v, 0, 100)}%`);
    el.style.setProperty('--cp-alpha-pct', `${clamp(hsva.a * 100, 0, 100)}%`);
  }, [hsva, solidHex, currentHex]);

  const emitHsva = useCallback(
    (next: HsvaColor) => {
      setHsva(next);
      const nextRgba = hsvaToRgba(next);
      const nextHex = rgbaToHex(nextRgba, true);
      latestHexRef.current = nextHex;
      lastEmittedRef.current = nextHex.toUpperCase();
      setHexDraft(nextHex);
      onChange(nextHex);
    },
    [onChange],
  );

  // ── ثبت «رنگ‌های اخیر»: یک انتخاب = حداکثر یک ثبت ──
  // قبلاً هر ژست درگ (SV، hue، alpha) و هر pointercancel جداگانه کامیت می‌کرد و
  // لیست اخیرها با رنگ‌های تقریباً یکسان پر می‌شد. حالا کامیت session-based است:
  // trailing-debounce ۳۸۰ms + آستانهٔ فاصلهٔ رنگ؛ ژست‌های پشت‌سرهم در یک جلسه
  // ادغام می‌شوند و فقط رنگ نهایی ثبت می‌شود.
  const commitSessionRef = useRef<number | null>(null);
  const sessionDirtyRef = useRef(false);

  const doCommit = useCallback(() => {
    const cur = latestHexRef.current;
    const norm = cur.toUpperCase();
    if (norm === lastCommittedRef.current) return;
    const dist = colorDistance(cur, lastCommittedRef.current);
    if (dist < COMMIT_MIN_DISTANCE) return;
    lastCommittedRef.current = norm;
    setRecentColors(pushRecentColor(cur));
    onCommit?.(cur);
  }, [onCommit]);

  const scheduleCommit = useCallback(() => {
    sessionDirtyRef.current = true;
    if (commitSessionRef.current !== null) window.clearTimeout(commitSessionRef.current);
    commitSessionRef.current = window.setTimeout(() => {
      commitSessionRef.current = null;
      if (!sessionDirtyRef.current) return;
      sessionDirtyRef.current = false;
      doCommit();
    }, COMMIT_DEBOUNCE_MS);
  }, [doCommit]);

  // خروج از پیکر (بستن پالت) در میانهٔ جلسه: رنگ نهایی فلش شود
  useEffect(() => {
    return () => {
      if (commitSessionRef.current !== null) {
        window.clearTimeout(commitSessionRef.current);
        commitSessionRef.current = null;
        if (sessionDirtyRef.current) doCommit();
      }
    };
  }, [doCommit]);

  const commitCurrent = scheduleCommit;

  // Pointer-drag helper for SV box, Hue, and Alpha
  const useDragSurface = (
    ref: React.RefObject<HTMLDivElement | null>,
    onPoint: (rx: number, ry: number) => void,
  ) => {
    const draggingId = useRef<number | null>(null);

    const updateFromClient = (clientX: number, clientY: number) => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const rx = clamp((clientX - r.left) / Math.max(1, r.width), 0, 1);
      const ry = clamp((clientY - r.top) / Math.max(1, r.height), 0, 1);
      onPoint(rx, ry);
    };

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      draggingId.current = e.pointerId;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // fallback if capture unsupported
      }
      updateFromClient(e.clientX, e.clientY);
    };

    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      if (draggingId.current !== e.pointerId) return;
      e.preventDefault();
      updateFromClient(e.clientX, e.clientY);
    };

    const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
      if (draggingId.current !== e.pointerId) return;
      draggingId.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      // نقطه‌گذاری/درگ تمام شد — کامیت تأخیری؛ ژست بعدی داخل همان جلسه ادغام می‌شود
      scheduleCommit();
    };

    return {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    };
  };

  const svBind = useDragSurface(svBoxRef, (rx, ry) => {
    emitHsva({ ...hsva, s: rx * 100, v: (1 - ry) * 100 });
  });

  const hueBind = useDragSurface(hueBarRef, (rx) => {
    emitHsva({ ...hsva, h: rx * 360 });
  });

  const alphaBind = useDragSurface(alphaBarRef, (rx) => {
    emitHsva({ ...hsva, a: Math.round(rx * 100) / 100 });
  });

  const handleHexInput = (val: string) => {
    setHexDraft(val);
    const trimmed = val.trim();
    const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
    const parsed = parseColorToRgba(withHash);
    if (parsed && (withHash.length === 7 || withHash.length === 9)) {
      const next = rgbaToHsva(parsed);
      setHsva(next);
      const hex = rgbaToHex(parsed, true);
      lastEmittedRef.current = hex.toUpperCase();
      onChange(hex);
    }
  };

  const handleHexCommit = () => {
    const trimmed = hexDraft.trim();
    const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
    const parsed = parseColorToRgba(withHash);
    if (parsed) {
      const next = rgbaToHsva(parsed);
      emitHsva(next);
      scheduleCommit();
    } else {
      setHexDraft(currentHex);
    }
  };

  const handleRgbChannel = (ch: 'r' | 'g' | 'b', raw: string) => {
    const n = clamp(parseInt(raw || '0', 10) || 0, 0, 255);
    const nextRgba = { ...rgba, [ch]: n };
    emitHsva(rgbaToHsva(nextRgba));
  };

  const handleHslChannel = (ch: 'h' | 's' | 'l', raw: string) => {
    const max = ch === 'h' ? 360 : 100;
    const n = clamp(parseInt(raw || '0', 10) || 0, 0, max);
    const nextHsla = { ...hsla, [ch]: n };
    emitHsva(rgbaToHsva(hslaToRgba(nextHsla)));
  };

  const handleEyedropper = async () => {
    const win = window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } };
    if (typeof win.EyeDropper === 'function') {
      try {
        const res = await new win.EyeDropper().open();
        const parsed = parseColorToRgba(res.sRGBHex);
        if (parsed) {
          emitHsva(rgbaToHsva({ ...parsed, a: hsva.a }));
        scheduleCommit();
        }
        return;
      } catch {
        // user canceled EyeDropper
        return;
      }
    }
    if (onStartPageEyedropper) {
      onStartPageEyedropper();
      return;
    }
    nativeInputRef.current?.click();
  };

  const isSaved = savedColors.some((c) => c.toUpperCase() === currentHex.toUpperCase());
  const previewStrokePx = isHighlighter
    ? Math.max(8, Math.min(18, Math.round(strokeWidth * 1800)))
    : Math.max(2, Math.min(12, Math.round(strokeWidth * 900)));
  const previewAlpha = isHighlighter ? Math.max(0.15, hsva.a * 0.42) : hsva.a;

  return (
    <div ref={rootRef} className="ink-cp" role="region" aria-label="انتخابگر پیشرفته رنگ">
      {/* Header + Live stroke preview */}
      <div className="ink-cp__head">
        {onBack && (
          <button
            type="button"
            className="ink-cp__back"
            onClick={onBack}
            aria-label="بازگشت به پالت سریع"
            title="پالت سریع"
          >
            <Icon name="i-chevron-r" size={14} />
          </button>
        )}
        <div className="ink-cp__preview-strip" title={`پیش‌نمایش ${toolLabel}`}>
          <span className="ink-cp__preview-chip" aria-hidden="true" />
          <svg viewBox="0 0 128 24" className="ink-cp__preview-svg" aria-hidden="true">
            <path
              d="M 10 15 C 34 4, 54 21, 78 11 C 94 4, 108 17, 118 11"
              fill="none"
              stroke={solidHex}
              strokeOpacity={previewAlpha}
              strokeWidth={previewStrokePx}
              strokeLinecap="round"
            />
          </svg>
          <span className="ink-cp__preview-meta">{toolLabel}</span>
        </div>

        <button
          type="button"
          className={`ink-cp__icon-btn${isEyedropperActive ? ' is-on' : ''}`}
          onClick={() => void handleEyedropper()}
          title="قطره‌چکان (برداشت رنگ از صفحه)"
          aria-label="قطره‌چکان"
          aria-pressed={isEyedropperActive}
        >
          <Icon name="i-eyedropper" size={15} />
        </button>

        <input
          ref={nativeInputRef}
          type="color"
          className="ink-cp__native-hidden"
          value={solidHex}
          aria-label="انتخابگر رنگ سیستم"
          onChange={(e) => {
            const parsed = parseColorToRgba(e.target.value);
            if (parsed) emitHsva(rgbaToHsva({ ...parsed, a: hsva.a }));
        scheduleCommit();
          }}
        />
      </div>

      {/* 2D Saturation / Value square */}
      <div
        ref={svBoxRef}
        className="ink-cp__sv"
        dir="ltr"
        role="slider"
        tabIndex={0}
        aria-label="اشباع و روشنایی رنگ"
        aria-valuetext={`اشباع ${Math.round(hsva.s)} درصد، روشنایی ${Math.round(hsva.v)} درصد`}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 10 : 3;
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            emitHsva({ ...hsva, s: clamp(hsva.s + step, 0, 100) });
            scheduleCommit();
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            emitHsva({ ...hsva, s: clamp(hsva.s - step, 0, 100) });
            scheduleCommit();
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            emitHsva({ ...hsva, v: clamp(hsva.v + step, 0, 100) });
            scheduleCommit();
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            emitHsva({ ...hsva, v: clamp(hsva.v - step, 0, 100) });
            scheduleCommit();
          }
        }}
        {...svBind}
      >
        <span className="ink-cp__sv-thumb" aria-hidden="true" />
      </div>

      {/* Hue Slider */}
      <div className="ink-cp__slider-row" dir="ltr">
        <div
          ref={hueBarRef}
          className="ink-cp__track ink-cp__track--hue"
          role="slider"
          tabIndex={0}
          aria-label="طیف رنگ"
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuenow={Math.round(hsva.h)}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 15 : 5;
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
              e.preventDefault();
              emitHsva({ ...hsva, h: (hsva.h + step) % 360 });
            scheduleCommit();
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
              e.preventDefault();
              emitHsva({ ...hsva, h: (hsva.h - step + 360) % 360 });
            scheduleCommit();
            }
          }}
          {...hueBind}
        >
          <span className="ink-cp__bar-thumb ink-cp__bar-thumb--hue" aria-hidden="true" />
        </div>
      </div>

      {/* Alpha Slider */}
      <div className="ink-cp__slider-row" dir="ltr">
        <div
          ref={alphaBarRef}
          className="ink-cp__track ink-cp__track--alpha"
          role="slider"
          tabIndex={0}
          aria-label="شفافیت رنگ"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(hsva.a * 100)}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 0.1 : 0.03;
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
              e.preventDefault();
              emitHsva({ ...hsva, a: clamp(Math.round((hsva.a + step) * 100) / 100, 0.05, 1) });
            scheduleCommit();
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
              e.preventDefault();
              emitHsva({ ...hsva, a: clamp(Math.round((hsva.a - step) * 100) / 100, 0.05, 1) });
            scheduleCommit();
            }
          }}
          {...alphaBind}
        >
          <span className="ink-cp__bar-thumb ink-cp__bar-thumb--alpha" aria-hidden="true" />
        </div>
        <span className="ink-cp__alpha-val num">{faDigits(Math.round(hsva.a * 100))}٪</span>
      </div>

      {/* Format Tabs + Editable Inputs */}
      <div className="ink-cp__inputs">
        <div className="ink-cp__fmt-tabs" role="tablist" aria-label="فرمت کد رنگ">
          {(['hex', 'rgb', 'hsl'] as InputFormat[]).map((fmt) => (
            <button
              key={fmt}
              type="button"
              role="tab"
              aria-selected={format === fmt}
              className={`ink-cp__fmt-tab${format === fmt ? ' is-on' : ''}`}
              onClick={() => setFormat(fmt)}
            >
              {fmt.toUpperCase()}
            </button>
          ))}
        </div>

        {format === 'hex' && (
          <input
            type="text"
            dir="ltr"
            className="ink-cp__hex-input"
            value={hexDraft}
            aria-label="کد رنگ HEX"
            maxLength={9}
            spellCheck={false}
            onChange={(e) => handleHexInput(e.target.value)}
            onBlur={handleHexCommit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleHexCommit();
              }
            }}
          />
        )}

        {format === 'rgb' && (
          <div className="ink-cp__triplet" dir="ltr">
            <label className="ink-cp__chan">
              <span>R</span>
              <input
                type="number"
                min={0}
                max={255}
                value={rgba.r}
                aria-label="قرمز RGB"
                onChange={(e) => handleRgbChannel('r', e.target.value)}
                onBlur={commitCurrent}
              />
            </label>
            <label className="ink-cp__chan">
              <span>G</span>
              <input
                type="number"
                min={0}
                max={255}
                value={rgba.g}
                aria-label="سبز RGB"
                onChange={(e) => handleRgbChannel('g', e.target.value)}
                onBlur={commitCurrent}
              />
            </label>
            <label className="ink-cp__chan">
              <span>B</span>
              <input
                type="number"
                min={0}
                max={255}
                value={rgba.b}
                aria-label="آبی RGB"
                onChange={(e) => handleRgbChannel('b', e.target.value)}
                onBlur={commitCurrent}
              />
            </label>
          </div>
        )}

        {format === 'hsl' && (
          <div className="ink-cp__triplet" dir="ltr">
            <label className="ink-cp__chan">
              <span>H</span>
              <input
                type="number"
                min={0}
                max={360}
                value={hsla.h}
                aria-label="طیف HSL"
                onChange={(e) => handleHslChannel('h', e.target.value)}
                onBlur={commitCurrent}
              />
            </label>
            <label className="ink-cp__chan">
              <span>S</span>
              <input
                type="number"
                min={0}
                max={100}
                value={hsla.s}
                aria-label="اشباع HSL"
                onChange={(e) => handleHslChannel('s', e.target.value)}
                onBlur={commitCurrent}
              />
            </label>
            <label className="ink-cp__chan">
              <span>L</span>
              <input
                type="number"
                min={0}
                max={100}
                value={hsla.l}
                aria-label="روشنایی HSL"
                onChange={(e) => handleHslChannel('l', e.target.value)}
                onBlur={commitCurrent}
              />
            </label>
          </div>
        )}
      </div>

      {/* Recent colors (up to 8) */}
      {recentColors.length > 0 && (
        <div className="ink-cp__group">
          <span className="ink-cp__group-label">رنگ‌های اخیر</span>
          <div className="ink-cp__swatches">
            {recentColors.map((rc) => (
              <button
                key={rc}
                type="button"
                ref={setCssVar('--swatch', rc)}
                className={`ink-cp__chip${rc.toUpperCase() === currentHex.toUpperCase() ? ' is-on' : ''}`}
                aria-label={`رنگ اخیر ${rc}`}
                onClick={() => {
                  const p = parseColorToRgba(rc);
                  if (p) {
                    emitHsva(rgbaToHsva(p));
                    scheduleCommit();
                  }
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* My saved colors */}
      <div className="ink-cp__group">
        <div className="ink-cp__group-head">
          <span className="ink-cp__group-label">رنگ‌های من</span>
          <button
            type="button"
            className="ink-cp__save-btn"
            onClick={() => {
              if (isSaved) {
                setSavedColors(removeUserColor(currentHex));
              } else {
                setSavedColors(saveUserColor(currentHex));
              }
            }}
          >
            {isSaved ? 'حذف از منتخب' : '+ ذخیره رنگ'}
          </button>
        </div>
        {savedColors.length > 0 ? (
          <div className="ink-cp__swatches">
            {savedColors.map((sc) => (
              <span key={sc} className="ink-cp__saved-wrap">
                <button
                  type="button"
                  ref={setCssVar('--swatch', sc)}
                  className={`ink-cp__chip${sc.toUpperCase() === currentHex.toUpperCase() ? ' is-on' : ''}`}
                  aria-label={`رنگ ذخیره شده ${sc}`}
                  onClick={() => {
                    const p = parseColorToRgba(sc);
                    if (p) {
                      emitHsva(rgbaToHsva(p));
                      scheduleCommit();
                    }
                  }}
                />
                <button
                  type="button"
                  className="ink-cp__saved-del"
                  aria-label={`حذف ${sc}`}
                  onClick={() => setSavedColors(removeUserColor(sc))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : (
          <span className="ink-cp__empty">برای دسترسی سریع، رنگ فعلی را ذخیره کن.</span>
        )}
      </div>
    </div>
  );
}
