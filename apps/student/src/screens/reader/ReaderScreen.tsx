import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { AppBar, ReportSheet } from '../../components';
import { ErrorBlock, LoadingBlock } from '../../components/AccessStates';
import { DsButton, DsEmpty } from '../../design/components';
import { Icon } from '../../icons';
import { faNum } from '../../lib/fa';
import { ink } from '../../lib/ink';
import { reader } from '../../lib/reader';
import type { Kind, Scope, ViewInfo } from '../../lib/reader';
import './reader-shell.css';
import './reader.css';

// pdf.js و پنل‌های جانبی ریدر سنگین‌اند؛ فقط در زمان باز شدن بارگذاری می‌شوند
const PdfView = lazy(() => import('./PdfView').then((m) => ({ default: m.PdfView })));
const MediaView = lazy(() => import('./MediaView').then((m) => ({ default: m.MediaView })));
const SlidesView = lazy(() => import('./SlidesView').then((m) => ({ default: m.SlidesView })));
const DocumentView = lazy(() => import('./DocumentView').then((m) => ({ default: m.DocumentView })));
const EmbeddedAiStudyPanel = lazy(() =>
  import('./EmbeddedAiStudyPanel').then((m) => ({ default: m.EmbeddedAiStudyPanel })),
);
const NotebookPanel = lazy(() =>
  import('./NotebookPanel').then((m) => ({ default: m.NotebookPanel })),
);

type StudySidePanel = 'none' | 'ai_chat' | 'notes';

const MEDIA_REFRESH_LEAD_MS = 120_000;

/** انقضای لینک مدیا در ساعت مرورگر؛ از expires_in نسبی (مستقل از اختلاف ساعت دستگاه). */
function expiryFromView(view: ViewInfo): number {
  const ttl = typeof view.expires_in === 'number' && view.expires_in > 0 ? view.expires_in : 0;
  return ttl ? Date.now() + ttl * 1000 : 0;
}

/** ریدر — یک صفحه برای هر سه نوع محتوا (PDF / ویدیو-ویس / تصویر)
 *  همراه با محیط مطالعه چندپنله و دستیار هوشیار همزمان در دسکتاپ. */
export function ReaderScreen() {
  const { scope = 'res', id = '' } = useParams();
  const navigate = useNavigate();

  const [info, setInfo] = useState<ViewInfo | null>(null);
  const [url, setUrl] = useState('');
  /** زمان انقضای لینک مدیا در ساعت همین مرورگر (ms)؛ ۰ = نامعلوم */
  const [urlExpiresAt, setUrlExpiresAt] = useState(0);
  const [startPage, setStartPage] = useState(1);
  const [startAt, setStartAt] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  // progress saves silently; only a failed save is worth showing
  const [saveFailed, setSaveFailed] = useState(false);

  // محیط مطالعه چندپنله (Desktop Multi-Panel Workspace)
  const [sidePanel, setSidePanel] = useState<StudySidePanel>('none');
  const [sideWidth, setSideWidth] = useState(380);
  const [isDraggingDivider, setIsDraggingDivider] = useState(false);
  const [notebookKey, setNotebookKey] = useState(0);
  const [activePage, setActivePage] = useState(1);
  const [jumpRequest, setJumpRequest] = useState<{ page: number; seq: number } | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const dividerCleanupRef = useRef<(() => void) | null>(null);

  const scopeTyped = (scope === 'ref' ? 'ref' : 'res') as Scope;
  const saveTimer = useRef<number | null>(null);
  const pendingKind = useRef<Kind | null>(null);
  const latest = useRef({ page: 1, total: 0, position: 0 });

  const persist = useCallback(
    (kind: Kind, patch: Partial<{ page: number; total: number; position: number }>) => {
      latest.current = { ...latest.current, ...patch };
      pendingKind.current = kind;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      // ذخیرهٔ تأخیری: پیمایش سریع نباید ده‌ها درخواست بسازد
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        pendingKind.current = null;
        void reader
          .save(scopeTyped, id, {
            page: latest.current.page,
            total: latest.current.total,
            position: latest.current.position,
            kind,
          })
          .then(() => setSaveFailed(false))
          .catch(() => setSaveFailed(true));
      }, 700);
    },
    [scopeTyped, id],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [view, prog] = await Promise.all([
        reader.viewUrl(scopeTyped, id),
        reader.progress(scopeTyped, id).catch(() => null),
      ]);
      setInfo(view);
      if (view.available && view.url) {
        setUrl(view.url);
        setUrlExpiresAt(expiryFromView(view));
      }
      if (prog) {
        latest.current = { page: prog.page || 1, total: prog.total || 0, position: prog.position || 0 };
        setStartPage(prog.page > 0 ? prog.page : 1);
        setActivePage(prog.page > 0 ? prog.page : 1);
        setStartAt(prog.position > 0 ? prog.position : 0);
      }
      // ?p=۴ از دفتر یادداشت‌ها → همان صفحه، حتی اگر پیشرفت جای دیگری باشد
      const jump = Number(new URLSearchParams(window.location.search).get('p'));
      if (jump > 0) {
        setStartPage(jump);
        setActivePage(jump);
        latest.current = { ...latest.current, page: jump };
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [scopeTyped, id]);

  useEffect(() => {
    void load();
    // هر خطی که آفلاین مانده بود، همین‌جا فرستاده می‌شود
    void ink.flush();
    return () => {
      // leaving the reader: flush the pending save instead of dropping it
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
        const kind = pendingKind.current;
        pendingKind.current = null;
        if (kind) void reader.save(scopeTyped, id, { ...latest.current, kind }).catch(() => undefined);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  useEffect(() => {
    const onOnline = () => void ink.flush();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  // کلید میانبر صفحه‌کلید Ctrl+\ یا \ برای تغییر وضعیت پنل دسکتاپ
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === '\\') {
        e.preventDefault();
        setSidePanel((p) => (p === 'ai_chat' ? 'none' : 'ai_chat'));
      }
      if (e.key === 'Escape' && sidePanel === 'ai_chat') {
        e.preventDefault();
        setSidePanel('none');
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [sidePanel]);

  useEffect(() => {
    return () => {
      dividerCleanupRef.current?.();
    };
  }, []);

  // جابه‌جایی مقیاس جداکننده پنل‌ها در دسکتاپ
  const handleDividerPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    dividerCleanupRef.current?.();
    setIsDraggingDivider(true);
    const startX = e.clientX;
    const initialWidth = sideWidth;

    const onPointerMove = (ev: PointerEvent) => {
      const delta = startX - ev.clientX;
      const newWidth = Math.max(280, Math.min(window.innerWidth * 0.52, initialWidth + delta));
      setSideWidth(newWidth);
    };

    const onPointerUp = () => {
      setIsDraggingDivider(false);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      dividerCleanupRef.current = null;
    };

    dividerCleanupRef.current = onPointerUp;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  /** لینک ۱۰ دقیقه‌ای تمام شده: آدرس تازه بگیر، همان‌جا بمان. */
  const refreshUrl = useCallback(async (): Promise<string | null> => {
    try {
      const view = await reader.viewUrl(scopeTyped, id);
      if (view.available && view.url) {
        setUrl(view.url);
        setUrlExpiresAt(expiryFromView(view));
        return view.url;
      }
    } catch {
      /* پایین‌تر پیام می‌دهد */
    }
    return null;
  }, [scopeTyped, id]);

  const kind: Kind = info?.kind ?? 'other';

  // T2: refresh the video/voice link ~2 min before it expires.
  // MediaView swaps the new link in without interrupting playback. PDF has its own path.
  useEffect(() => {
    if (kind === 'pdf' || !urlExpiresAt) return;
    const due = urlExpiresAt - MEDIA_REFRESH_LEAD_MS;
    const timer = window.setTimeout(() => void refreshUrl(), Math.max(1000, due - Date.now()));
    const check = () => {
      if (document.visibilityState === 'visible' && Date.now() >= due) void refreshUrl();
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('online', check);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('online', check);
    };
  }, [kind, urlExpiresAt, refreshUrl]);

  return (
    <>
      <AppBar
        title={info?.name ?? 'در حال باز کردن…'}
        sub={saveFailed ? 'پیشرفت ذخیره نشد' : undefined}
        back
        onBack={() => navigate(-1)}
        actions={
          info ? (
            <div className="reader-shell__actions">
              {kind === 'pdf' && (
                <>
                  <button
                    type="button"
                    className={`iconbtn ${sidePanel === 'ai_chat' ? 'is-active' : ''}`}
                    onClick={() => setSidePanel((p) => (p === 'ai_chat' ? 'none' : 'ai_chat'))}
                    title="دستیار هوشیار همزمان (\)"
                    aria-label="دستیار هوشیار"
                  >
                    <Icon name="i-chat" size={18} />
                  </button>
                  <button
                    type="button"
                    className={`iconbtn ${sidePanel === 'notes' ? 'is-active' : ''}`}
                    onClick={() => setSidePanel((p) => (p === 'notes' ? 'none' : 'notes'))}
                    title="دفترچه یادداشت"
                    aria-label="دفترچه یادداشت"
                  >
                    <Icon name="i-pen" size={18} />
                  </button>
                </>
              )}
              {info.allow_download && info.download_url && (
                <a
                  href={info.download_url}
                  download
                  className="iconbtn"
                  title="دانلود فایل"
                  aria-label="دانلود فایل"
                >
                  <Icon name="i-download" size={18} />
                </a>
              )}
              {scopeTyped === 'res' && (
                <button
                  type="button"
                  className="iconbtn"
                  onClick={() => setReportOpen(true)}
                  title="گزارش ایراد فایل"
                  aria-label="گزارش ایراد"
                >
                  <Icon name="i-alert-circle" size={18} />
                </button>
              )}
            </div>
          ) : undefined
        }
      />

      {loading && (
        <div className="page page-enter">
          <LoadingBlock rows={2} />
        </div>
      )}

      {!loading && error != null && (
        <div className="page page-enter">
          <ErrorBlock error={error} onRetry={() => void load()} />
        </div>
      )}

      {!loading && !error && info && !info.available && (
        <div className="page page-enter">
          <DsEmpty
            icon={<Icon name="i-lock" size={28} />}
            title="این فایل در حال حاضر آماده نیست"
            body="در صورت تداوم مشکل می‌توانید ایراد فایل را گزارش دهید یا کمی بعد دوباره امتحان کنید."
            action={
              info.download_url ? (
                <a className="ds-btn ds-btn--primary ds-btn--sm" href={info.download_url} download>
                  <Icon name="i-download" size={15} />
                  دانلود فایل
                </a>
              ) : (
                <DsButton variant="ghost" size="sm" onClick={() => navigate(-1)}>
                  بازگشت به فهرست
                </DsButton>
              )
            }
          />
        </div>
      )}

      {!loading && !error && info && info.available && (url || kind === 'pdf' || kind === 'slides' || kind === 'document' || kind === 'sheet' || kind === 'archive' || kind === 'attachment') && (
        <div className={`study-workspace reader-workspace ${sidePanel === 'notes' ? 'is-split' : ''}`}>
          <div className="study-workspace__primary">
            <div className="reader-shell">
              <Suspense
                fallback={
                  <div className="reader__center" aria-busy="true">
                    <span className="small">در حال آماده‌سازی نمایشگر…</span>
                  </div>
                }
              >
                {kind === 'pdf' ? (
                  <PdfView
                    scope={scopeTyped}
                    id={id}
                    url={url}
                    startPage={startPage}
                    jumpRequest={jumpRequest}
                    onProgress={(page, total) => {
                      latest.current = { ...latest.current, page, total };
                      setActivePage(page);
                      persist('pdf', { page, total });
                    }}
                    onExpired={refreshUrl}
                    onToggleSplitWorkspace={() =>
                      setSidePanel((p) => (p === 'ai_chat' ? 'none' : 'ai_chat'))
                    }
                    onInkChanged={() => setNotebookKey((k) => k + 1)}
                    isAiOpen={sidePanel === 'ai_chat'}
                  />
                ) : kind === 'slides' ? (
                  <SlidesView
                    scope={scopeTyped}
                    id={id}
                    startSlide={startPage}
                    onProgress={(slide, total) => {
                      latest.current = { ...latest.current, page: slide, total };
                      setActivePage(slide);
                      persist('slides', { page: slide, total });
                    }}
                    onSwitchToPdf={(manifestUrl) => {
                      setUrl(manifestUrl);
                      setInfo((prev) => (prev ? { ...prev, kind: 'pdf', url: manifestUrl } : prev));
                    }}
                  />
                ) : kind === 'document' || kind === 'sheet' || kind === 'archive' || kind === 'attachment' ? (
                  <DocumentView
                    scope={scopeTyped}
                    id={id}
                    onSwitchToPdf={(manifestUrl) => {
                      setUrl(manifestUrl);
                      setInfo((prev) => (prev ? { ...prev, kind: 'pdf', url: manifestUrl } : prev));
                    }}
                  />
                ) : kind === 'video' || kind === 'audio' || kind === 'image' ? (
                  <MediaView
                    url={url}
                    kind={kind}
                    name={info.name}
                    size={info.size}
                    startAt={startAt}
                    onPosition={(seconds) => persist(kind, { position: seconds })}
                    onExpired={refreshUrl}
                    expiresAt={urlExpiresAt}
                    bg={kind === 'audio' || kind === 'video' ? { scope: scopeTyped, id } : undefined}
                  />
                ) : (
                  <DocumentView
                    scope={scopeTyped}
                    id={id}
                    onSwitchToPdf={(manifestUrl) => {
                      setUrl(manifestUrl);
                      setInfo((prev) => (prev ? { ...prev, kind: 'pdf', url: manifestUrl } : prev));
                    }}
                  />
                )}
              </Suspense>
            </div>
          </div>

          {/* پنل ثانویه مطالعه دسکتاپ (دفترچه یادداشت) */}
          {sidePanel === 'notes' && (
            <>
              <div
                className={`study-workspace__divider ${isDraggingDivider ? 'is-dragging' : ''}`}
                onPointerDown={handleDividerPointerDown}
                title="برای تغییر عرض بکشید"
              >
                <div className="study-workspace__divider-handle" />
              </div>

              <aside
                className="study-workspace__secondary"
                ref={(el) => {
                  el?.style.setProperty('--side-w', `${sideWidth}px`);
                }}
              >
                <div className="study-workspace__secondary-header">
                  <span className="h3">دفترچه یادداشت</span>
                  <button
                    type="button"
                    className="iconbtn"
                    onClick={() => setSidePanel('none')}
                    aria-label="بستن پنل"
                    title="بستن"
                  >
                    <Icon name="i-x" size={16} />
                  </button>
                </div>
                <div className="study-workspace__secondary-body">
                  <Suspense fallback={<LoadingBlock rows={3} />}>
                    <NotebookPanel
                      scope={scopeTyped}
                      id={id}
                      page={activePage}
                      open={true}
                      hideHeader
                      onClose={() => setSidePanel('none')}
                      onJump={(p) => {
                        setJumpRequest((prev) => ({ page: p, seq: (prev?.seq ?? 0) + 1 }));
                        navigate(`?p=${p}`, { replace: true });
                        if (window.innerWidth < 768) setSidePanel('none');
                      }}
                      refreshKey={notebookKey}
                    />
                  </Suspense>
                </div>
              </aside>
            </>
          )}

          {/* جریان شناور بالا به پایین هوشیار بالینی (فقط در ریدر PDF) */}
          {kind === 'pdf' && (
            <div
              className={`ai-top-flow-backdrop ${sidePanel === 'ai_chat' ? 'is-open' : ''}`}
              onClick={() => setSidePanel('none')}
              aria-hidden={sidePanel !== 'ai_chat'}
            >
              <div
                className={`ai-top-flow-card ${sidePanel === 'ai_chat' ? 'is-open' : ''}`}
                data-section="ai"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-label="دستیار هوشیار بالینی"
              >
                <div className="ai-top-flow-handle-bar">
                  <div className="ai-top-flow-handle" />
                </div>
                <div className="ai-top-flow-header">
                  <div className="ai-top-flow-title-wrap">
                    <div className="ai-top-flow-avatar">
                      <span className="ai-top-flow-avatar-glow" />
                      <Icon name="i-chat" size={18} />
                    </div>
                    <div className="ai-top-flow-titles">
                      <div className="ai-top-flow-main-title">
                        <span>هوشیار بالینی</span>
                        <span className="ai-top-flow-badge">دستیار هوشمند مطالعه</span>
                      </div>
                      <div className="ai-top-flow-subtitle">
                        {info?.name ? `جزوهٔ «${info.name}»` : 'مطالعهٔ جزوه'} · صفحهٔ {faNum(activePage || 1)}
                      </div>
                    </div>
                  </div>
                  <div className="ai-top-flow-actions">
                    <button
                      type="button"
                      className="ai-top-flow-close-btn"
                      onClick={() => setSidePanel('none')}
                      aria-label="بستن دستیار هوشمند"
                      title="بستن (Esc یا \)"
                    >
                      <Icon name="i-x" size={16} />
                    </button>
                  </div>
                </div>

                <div className="ai-top-flow-body">
                  {sidePanel === 'ai_chat' && (
                    <Suspense fallback={<LoadingBlock rows={3} />}>
                      <EmbeddedAiStudyPanel
                        fileId={id}
                        bookletName={info?.name}
                        page={activePage}
                        onClose={() => setSidePanel('none')}
                      />
                    </Suspense>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      <ReportSheet
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        targetType="resource"
        targetId={id}
        targetLabel={info?.name}
      />
    </>
  );
}
