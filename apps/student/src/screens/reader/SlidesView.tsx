import { useCallback, useEffect, useRef, useState, type TouchEvent } from 'react';
import { ErrorBlock, LoadingBlock } from '../../components/AccessStates';
import { DsBadge, DsButton, DsCard, DsEmpty } from '../../design/components';
import { Icon } from '../../icons';
import { faNum } from '../../lib/fa';
import {
  reader,
  type OfficePayload,
  type Scope,
  type SlideElement,
  type SlideItem,
  type SlideParagraph,
} from '../../lib/reader';
import './office-viewer.css';

export interface SlidesViewProps {
  scope: Scope;
  id: string;
  startSlide?: number;
  initialData?: OfficePayload | null;
  onProgress?: (slide: number, total: number) => void;
  onSwitchToPdf?: (manifestUrl: string) => void;
}

function renderParagraph(p: SlideParagraph, idx: number, baseScale: number) {
  const dir = p.rtl ? 'rtl' : 'ltr';
  const indentPx = Math.min(48, (p.lvl || 0) * 18);
  return (
    <div
      key={idx}
      dir={dir}
      className="slide-para"
      style={{
        textAlign: (p.align as 'left' | 'right' | 'center' | 'justify') || (p.rtl ? 'right' : 'left'),
        paddingInlineStart: indentPx,
      }}
    >
      {p.bullet && (
        <span className="slide-para__bullet" aria-hidden="true">
          {p.bullet}
        </span>
      )}
      <span>
        {p.runs.map((r, rIdx) => (
          <span
            key={rIdx}
            style={{
              fontWeight: r.bold ? 700 : undefined,
              fontStyle: r.italic ? 'italic' : undefined,
              textDecoration: r.underline ? 'underline' : undefined,
              color: r.color || undefined,
              fontSize: r.size_pt ? `${Math.max(10, Math.min(40, Math.round(r.size_pt * baseScale)))}px` : undefined,
            }}
          >
            {r.text}
          </span>
        ))}
      </span>
    </div>
  );
}

function SlideCanvas({
  slide,
  aspectRatio,
  assetUrls,
  darkStage,
  fontScale,
  compact = false,
}: {
  slide: SlideItem;
  aspectRatio: number;
  assetUrls: Record<string, string>;
  darkStage: boolean;
  fontScale: number;
  compact?: boolean;
}) {
  const bgUrl = slide.bg_asset ? assetUrls[slide.bg_asset] : undefined;
  const bgColor = slide.bg_color || '#FFFFFF';
  const stageBackground = slide.bg_gradient || bgColor;

  return (
    <div
      className={`slide-canvas ${darkStage ? 'is-inverted' : ''} ${compact ? 'is-thumb' : ''}`}
      style={{
        aspectRatio: String(aspectRatio || 1.7778),
        background: stageBackground,
        backgroundImage: bgUrl ? `url(${bgUrl})` : slide.bg_gradient || undefined,
        backgroundSize: bgUrl ? 'cover' : undefined,
        backgroundPosition: bgUrl ? 'center' : undefined,
      }}
    >
      {slide.elements.map((el: SlideElement, idx: number) => {
        const boxStyle = {
          left: `${el.x}%`,
          top: `${el.y}%`,
          width: `${el.w}%`,
          height: `${el.h}%`,
        };

        if (el.type === 'image' && el.asset) {
          const imgSrc = assetUrls[el.asset];
          if (!el.supported || !imgSrc) {
            return (
              <div key={idx} className="slide-el slide-el--placeholder" style={boxStyle}>
                {!compact && <span className="tiny muted">تصویر ({el.ext?.toUpperCase() || 'IMG'})</span>}
              </div>
            );
          }
          return (
            <img
              key={idx}
              src={imgSrc}
              alt=""
              loading="lazy"
              className="slide-el slide-el--img"
              style={boxStyle}
              draggable={false}
            />
          );
        }

        if (el.type === 'table' && el.rows) {
          return (
            <div key={idx} className="slide-el slide-el--table" style={boxStyle}>
              <table>
                <tbody>
                  {el.rows.map((row, rIdx) => (
                    <tr key={rIdx}>
                      {row.map((cell, cIdx) => (
                        <td
                          key={cIdx}
                          dir={cell.rtl ? 'rtl' : 'ltr'}
                          style={{ background: cell.fill || undefined }}
                        >
                          {cell.text}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        const isRound = el.shape === 'roundRect' || el.shape === 'ellipse';
        return (
          <div
            key={idx}
            className={`slide-el slide-el--shape ${el.is_title ? 'is-title' : ''}`}
            style={{
              ...boxStyle,
              background: el.fill || undefined,
              border: el.stroke ? `1px solid ${el.stroke}` : undefined,
              borderRadius: el.shape === 'ellipse' ? '50%' : isRound ? '10px' : undefined,
            }}
          >
            {(el.paragraphs || []).map((p, pIdx) => renderParagraph(p, pIdx, fontScale))}
          </div>
        );
      })}
    </div>
  );
}

export function SlidesView({
  scope,
  id,
  startSlide = 1,
  initialData = null,
  onProgress,
  onSwitchToPdf,
}: SlidesViewProps) {
  const [data, setData] = useState<OfficePayload | null>(initialData);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<unknown>(null);
  const [slideIdx, setSlideIdx] = useState(Math.max(0, startSlide - 1));
  const [zoom, setZoom] = useState(1);
  const [showThumbs, setShowThumbs] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [darkStage, setDarkStage] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await reader.office(scope, id);
      if (res.redirect_manifest && onSwitchToPdf) {
        onSwitchToPdf(res.redirect_manifest);
        return;
      }
      setData(res);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [scope, id, onSwitchToPdf]);

  useEffect(() => {
    if (!initialData) void load();
  }, [initialData, load]);

  const slides = data?.slides || [];
  const total = slides.length;

  useEffect(() => {
    if (total > 0) {
      const safe = Math.max(0, Math.min(total - 1, startSlide - 1));
      setSlideIdx(safe);
    }
  }, [startSlide, total]);

  const goTo = useCallback(
    (next: number) => {
      if (!total) return;
      const clamped = Math.max(0, Math.min(total - 1, next));
      setSlideIdx(clamped);
      onProgress?.(clamped + 1, total);
    },
    [total, onProgress],
  );

  useEffect(() => {
    if (!total) return;
    onProgress?.(slideIdx + 1, total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === 'ArrowRight' || e.key === 'PageUp') {
        // در UI راست‌به‌چپ فارسی، فلش چپ = بعدی، فلش راست = قبلی؛ اما بسیاری کاربران ArrowRight را هم انتظار دارند.
        goTo(slideIdx - 1);
      } else if (e.key === 'ArrowLeft' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault();
        goTo(slideIdx + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goTo, slideIdx]);

  const handleTouchStart = (e: TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };
  const handleTouchEnd = (e: TouchEvent) => {
    if (touchStartX.current == null) return;
    const endX = e.changedTouches[0]?.clientX ?? touchStartX.current;
    const dx = endX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < 42) return;
    if (dx > 0) goTo(slideIdx + 1);
    else goTo(slideIdx - 1);
  };

  const toggleFullscreen = () => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void el.requestFullscreen?.().catch(() => {});
    }
  };

  if (loading) return <LoadingBlock rows={3} />;
  if (error != null) return <ErrorBlock error={error} onRetry={load} />;

  if (!slides.length) {
    return (
      <div className="page page-enter">
        <DsCard>
          <DsEmpty
            icon={<Icon name="i-layers" size={28} />}
            title="محتوای قابل نمایشی در این فایل اسلاید یافت نشد"
            body="برای مشاهدهٔ نسخهٔ کامل با تمام افکت‌ها، می‌توانید فایل اصلی را مستقیماً دریافت کنید."
            action={
              data?.allow_download && data?.download_url ? (
                <a className="ds-btn ds-btn--primary" href={data.download_url} download>
                  <Icon name="i-download" size={16} />
                  دانلود فایل اسلاید
                </a>
              ) : undefined
            }
          />
        </DsCard>
      </div>
    );
  }

  const current = slides[Math.min(slideIdx, total - 1)];
  const assetUrls = data?.asset_urls || {};
  const aspect = data?.aspect_ratio || 1.7778;

  return (
    <div ref={stageRef} className="slides-viewer">
      {/* نوار کنترل بالای اسلاید */}
      <div className="slides-toolbar">
        <div className="slides-toolbar__group">
          <DsButton
            variant="secondary"
            size="sm"
            disabled={slideIdx <= 0}
            onClick={() => goTo(slideIdx - 1)}
            aria-label="اسلاید قبلی"
          >
            <Icon name="i-chevron-r" size={15} />
            قبلی
          </DsButton>
          <DsBadge tone="accent">
            اسلاید {faNum(slideIdx + 1)} از {faNum(total)}
          </DsBadge>
          <DsButton
            variant="secondary"
            size="sm"
            disabled={slideIdx >= total - 1}
            onClick={() => goTo(slideIdx + 1)}
            aria-label="اسلاید بعدی"
          >
            بعدی
            <Icon name="i-chevron" size={15} />
          </DsButton>
        </div>

        <div className="slides-toolbar__group">
          <button
            type="button"
            className={`iconbtn ${showThumbs ? 'is-active' : ''}`}
            onClick={() => setShowThumbs((v) => !v)}
            title="فهرست بندانگشتی اسلایدها"
            aria-label="فهرست اسلایدها"
          >
            <Icon name="i-grid" size={17} />
          </button>
          <button
            type="button"
            className={`iconbtn ${showNotes ? 'is-active' : ''}`}
            onClick={() => setShowNotes((v) => !v)}
            title="یادداشت ارائه‌دهنده"
            aria-label="یادداشت اسلاید"
          >
            <Icon name="i-file-text" size={17} />
          </button>
          <button
            type="button"
            className={`iconbtn ${darkStage ? 'is-active' : ''}`}
            onClick={() => setDarkStage((v) => !v)}
            title="حالت مطالعه شب"
            aria-label="حالت مطالعه شب"
          >
            <Icon name="i-moon" size={17} />
          </button>
          <button
            type="button"
            className="iconbtn"
            onClick={() => setZoom((z) => Math.max(0.75, +(z - 0.15).toFixed(2)))}
            title="کوچک‌نمایی"
            aria-label="کوچک‌نمایی"
          >
            −
          </button>
          <span className="tiny muted">{faNum(Math.round(zoom * 100))}٪</span>
          <button
            type="button"
            className="iconbtn"
            onClick={() => setZoom((z) => Math.min(1.8, +(z + 0.15).toFixed(2)))}
            title="بزرگ‌نمایی"
            aria-label="بزرگ‌نمایی"
          >
            +
          </button>
          <button
            type="button"
            className="iconbtn"
            onClick={toggleFullscreen}
            title="تمام‌صفحه"
            aria-label="تمام‌صفحه"
          >
            <Icon name="i-expand" size={17} />
          </button>
          {data?.allow_download && data?.download_url && (
            <a className="ds-btn ds-btn--ghost ds-btn--sm" href={data.download_url} download>
              <Icon name="i-download" size={15} />
              دانلود
            </a>
          )}
        </div>
      </div>

      {data?.is_legacy_binary && (
        <div className="slides-banner small">
          <span>
            این فایل با فرمت قدیمی PPT ذخیره شده است؛ متن استخراج‌شده در ادامه نمایش داده می‌شود.
          </span>
          {data.download_url && (
            <a className="ds-btn ds-btn--primary ds-btn--sm" href={data.download_url} download>
              <Icon name="i-download" size={14} />
              دانلود نسخهٔ اصلی
            </a>
          )}
        </div>
      )}

      <div className="slides-body">
        {showThumbs && (
          <aside className="slides-filmstrip" aria-label="نمای بندانگشتی اسلایدها">
            {slides.map((s, idx) => (
              <button
                key={s.index}
                type="button"
                className={`slides-thumb ${idx === slideIdx ? 'is-active' : ''}`}
                onClick={() => goTo(idx)}
              >
                <div className="slides-thumb__num">{faNum(idx + 1)}</div>
                <SlideCanvas
                  slide={s}
                  aspectRatio={aspect}
                  assetUrls={assetUrls}
                  darkStage={darkStage}
                  fontScale={0.42}
                  compact
                />
                <span className="slides-thumb__title">{s.title}</span>
              </button>
            ))}
          </aside>
        )}

        <div
          className="slides-stage-scroll"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <div className="slides-stage-frame" style={{ width: `${Math.round(zoom * 100)}%`, maxWidth: `${Math.round(980 * zoom)}px` }}>
            <SlideCanvas
              slide={current}
              aspectRatio={aspect}
              assetUrls={assetUrls}
              darkStage={darkStage}
              fontScale={0.85 * zoom}
            />
          </div>

          {showNotes && (
            <DsCard className="slides-notes-card">
              <div className="core-sec-head" style={{ marginBottom: 6 }}>
                <strong className="small">یادداشت اسلاید {faNum(slideIdx + 1)}</strong>
              </div>
              <p className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                {current.notes || 'یادداشتی برای این اسلاید ثبت نشده است.'}
              </p>
            </DsCard>
          )}
        </div>
      </div>
    </div>
  );
}
