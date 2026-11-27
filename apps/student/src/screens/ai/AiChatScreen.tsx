/* هوش‌یار — گفتوگوی چندگانه در سطح ChatGPT.
   مسیرها: /ai (گفتوگوی تازه، ساخت تنبل با اولین ارسال) و /ai/:id.
   چیدمان: ≥۷۶۸px دو ستون (تاریخچه + گفتوگو)؛ موبایل: کشوی تاریخچه.
   اسکرول: فقط وقتی کاربر پایین است دنبال استریم میرود؛ بالا رفتن ⇒ دکمهٔ «پایین».
   iOS: ارتفاع با 100dvh و --aic-kb (از visualViewport) تا نوار نوشتن بالای کیبورد بماند. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppBar } from '../../components/AppBar';
import { Icon } from '../../icons';
import {
  ai,
  aiErrorFrom,
  diagnoseClinicalImage,
  type AiConversation,
  type AiStatus,
  type VisionDiagnosisResult,
} from '../../lib/ai';
import { AiVisionModal } from './AiVisionModal';
import { ChatMessage } from './ChatMessage';
import { Composer, type ComposerHandle } from './Composer';
import { ConversationList } from './ConversationList';
import { faNum } from './dates';
import { pickStarters } from './starters';
import { useAiChat } from './useAiChat';
import './ai-chat.css';

const ZW = '\u200c';
const NEW_TITLE = `گفت${ZW}وگوی جدید`;
const STICK_PX = 96;

/** ارتفاع در دسترس برای گفتوگو: فاصلهٔ ریشه از بالای صفحه (هدر دسکتاپ) و
    از پایین (تببار موبایل یا کیبورد مجازی، هر کدام بزرگتر) ⇒ --aic-top / --aic-bottom. */
function useChatViewport(root: React.RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const vv = window.visualViewport;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const top = Math.max(0, el.getBoundingClientRect().top + window.scrollY);
        const tab = document.querySelector<HTMLElement>('.app-tabbar, .tabbar');
        const tabH = tab && getComputedStyle(tab).display !== 'none' ? tab.getBoundingClientRect().height : 0;
        const kb = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
        const hasKb = kb > 80;
        el.style.setProperty('--aic-top', `${Math.round(top)}px`);
        el.style.setProperty('--aic-bottom', `${Math.round(hasKb ? kb : tabH)}px`);
        el.classList.toggle('has-kb', hasKb);
      });
    };
    update();
    window.addEventListener('resize', update);
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', update);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
    };
  }, [root]);
}

export function AiChatScreen() {
  const { id: routeId } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ComposerHandle>(null);
  useChatViewport(rootRef);

  /* ── وضعیت سرویس ─────────────────────────────── */
  const [status, setStatus] = useState<AiStatus | null>(null);
  useEffect(() => {
    let alive = true;
    ai.status()
      .then((s) => alive && setStatus(s))
      .catch(() => {
        /* بدون وضعیت هم گفتوگو کار میکند؛ خطا سر ارسال نشان داده میشود */
      });
    return () => {
      alive = false;
    };
  }, []);

  /* ── فهرست گفتوگوها ──────────────────────────── */
  const [convs, setConvs] = useState<AiConversation[]>([]);
  const [convLoading, setConvLoading] = useState(true);
  const [convError, setConvError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const queryRef = useRef('');
  queryRef.current = query;

  const fetchConvs = useCallback(async (q: string) => {
    setConvLoading(true);
    try {
      const r = await ai.conversations({ q, limit: 100 });
      if (queryRef.current.trim() !== q.trim()) return;
      setConvs((r.conversations || []).filter((c) => !c.archived));
      setConvError(null);
    } catch (e) {
      setConvError(aiErrorFrom(e).message);
    } finally {
      setConvLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void fetchConvs(query), query ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [query, fetchConvs]);

  /* ── گفتوگوی فعال ────────────────────────────── */
  const chat = useAiChat({
    onCreated: (cid) => {
      setConvs((prev) => {
        const pinned = prev.filter((c) => c.pinned).length;
        const now = new Date().toISOString();
        const next = [...prev];
        next.splice(pinned, 0, { id: cid, title: NEW_TITLE, created_at: now, updated_at: now, count: 0 });
        return next;
      });
      navigate(`/ai/${encodeURIComponent(cid)}`, { replace: true });
    },
    onStart: (meta) => {
      if (meta.title) setConvs((prev) => prev.map((c) => (c.id === meta.conversation_id ? { ...c, title: meta.title! } : c)));
    },
    onSettled: () => {
      void fetchConvs(queryRef.current);
      ai.status()
        .then(setStatus)
        .catch(() => undefined);
    },
  });

  const activeId = routeId ? decodeURIComponent(routeId) : null;
  useEffect(() => {
    if ((activeId || null) === chat.cid()) return;
    void chat.load(activeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const active = convs.find((c) => c.id === activeId) || null;

  /* ── اسکرول هوشمند ───────────────────────────── */
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const olderAnchor = useRef<number | null>(null);

  const toBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickRef.current = gap < STICK_PX;
    setShowJump(gap > STICK_PX * 2);
  };

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (olderAnchor.current !== null) {
      el.scrollTop = el.scrollHeight - olderAnchor.current;
      olderAnchor.current = null;
      return;
    }
    if (stickRef.current) el.scrollTop = el.scrollHeight;
  }, [chat.msgs]);

  useEffect(() => {
    stickRef.current = true;
    setShowJump(false);
  }, [activeId]);

  /* ── کنشها ───────────────────────────────────── */
  const [drawer, setDrawer] = useState(false);
  const [vision, setVision] = useState(false);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawer]);

  const send = useCallback(
    async (text: string) => {
      stickRef.current = true;
      return chat.send(text);
    },
    [chat],
  );

  const newChat = useCallback(() => {
    setDrawer(false);
    if (!activeId && chat.msgs.length === 0) {
      composerRef.current?.focus();
      return;
    }
    navigate('/ai');
  }, [activeId, chat.msgs.length, navigate]);

  const openConv = useCallback(
    (id: string) => {
      setDrawer(false);
      if (id !== activeId) navigate(`/ai/${encodeURIComponent(id)}`);
    },
    [activeId, navigate],
  );

  const rename = useCallback(async (id: string, title: string) => {
    try {
      await ai.rename(id, title);
      setConvs((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
      return true;
    } catch {
      return false;
    }
  }, []);

  const pin = useCallback(
    async (id: string, pinned: boolean) => {
      try {
        await ai.setPinned(id, pinned);
        void fetchConvs(queryRef.current);
      } catch {
        /* بیصدا */
      }
    },
    [fetchConvs],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await ai.remove(id);
        setConvs((prev) => prev.filter((c) => c.id !== id));
        if (id === activeId) navigate('/ai', { replace: true });
        return true;
      } catch {
        return false;
      }
    },
    [activeId, navigate],
  );

  const onVision = (result: VisionDiagnosisResult, imageUrl: string, prompt: string) => {
    stickRef.current = true;
    const now = new Date().toISOString();
    chat.append([
      { role: 'user', text: prompt || `تحلیل این تصویر بالینی`, image: imageUrl, at: now, status: 'done' },
      { role: 'assistant', text: result.analysis, chips: result.detected_structures, image: imageUrl, at: now, status: 'done' },
    ]);
  };

  /* تصویر پیوستشده از منوی «+»: همان سرویس تحلیل تصویر، بدون شیت میانی.
     خطا به Composer برمیگردد تا زیر چیپ نمایش داده شود. */
  const onSendImage = async (file: File, prompt: string) => {
    const result = await diagnoseClinicalImage(file, prompt);
    onVision(result, URL.createObjectURL(file), prompt);
  };

  const loadOlder = () => {
    const el = scrollRef.current;
    if (el) olderAnchor.current = el.scrollHeight - el.scrollTop;
    void chat.loadOlder();
  };

  /* ── وضعیت سهمیه/دسترسی ──────────────────────── */
  const blocked = status && (!status.enabled || status.banned);
  const quotaOut = status && !status.unlimited && status.remaining !== null && status.remaining <= 0;
  const lowQuota = status && !status.unlimited && status.remaining !== null && status.remaining > 0 && status.remaining <= 3;
  const canAttach = status?.capabilities?.image !== false;
  const maxChars = status?.max_input_chars || 2000;

  const lastAssistant = useMemo(() => {
    for (let i = chat.msgs.length - 1; i >= 0; i--) if (chat.msgs[i].role === 'assistant') return chat.msgs[i].key;
    return '';
  }, [chat.msgs]);

  const starters = useMemo(() => pickStarters(4), []);

  const headerActions = useMemo(
    () => (
      <div className="aic-head-actions">
        <button type="button" className="iconbtn aic-hist-toggle" onClick={() => setDrawer(true)} aria-label={`تاریخچهٔ گفت${ZW}وگوها`} title={`تاریخچهٔ گفت${ZW}وگوها`}>
          <Icon name="i-menu" size={20} />
        </button>
        <button type="button" className="iconbtn" onClick={newChat} aria-label={NEW_TITLE} title={NEW_TITLE}>
          <Icon name="i-pen" size={18} />
        </button>
      </div>
    ),
    [newChat],
  );

  const empty = chat.msgs.length === 0 && !chat.loading && !chat.loadError;

  return (
    <div ref={rootRef} className="aic" data-section="ai">
      <AppBar title="هوش‌یار" sub={active?.title && active.title !== NEW_TITLE ? active.title : `دستیار آموزشی پزشکی`} actions={headerActions} />

      <div className="aic-layout">
        <div className={`aic-scrim${drawer ? ' is-open' : ''}`} onClick={() => setDrawer(false)} aria-hidden="true" />
        <aside className={`aic-side${drawer ? ' is-open' : ''}`} aria-label={`گفت${ZW}وگوها`}>
          <ConversationList
            items={convs}
            loading={convLoading}
            error={convError}
            activeId={activeId}
            query={query}
            onQuery={setQuery}
            onOpen={openConv}
            onNew={newChat}
            onRename={rename}
            onPin={pin}
            onDelete={remove}
            onRetry={() => void fetchConvs(query)}
            onClose={() => setDrawer(false)}
          />
        </aside>

        <section className="aic-pane" aria-label={`گفت${ZW}وگو با هوش‌یار`}>
          <div ref={scrollRef} className="aic-scroll" onScroll={onScroll}>
            <div className="aic-thread">
              {chat.hasMore && (
                <button type="button" className="ds-btn ds-btn--ghost ds-btn--sm aic-older" onClick={loadOlder} disabled={chat.loadingOlder} aria-busy={chat.loadingOlder || undefined}>
                  {chat.loadingOlder && <span className="ds-btn__spin" aria-hidden="true" />}
                  {`پیام${ZW}های قدیمی${ZW}تر`}
                </button>
              )}

              {chat.loading && (
                <div className="aic-loading" aria-label={`در حال بارگذاری گفت${ZW}وگو`}>
                  <span className="ds-skel ds-skel--text aic-loading__u" />
                  <span className="ds-skel ds-skel--card" />
                  <span className="ds-skel ds-skel--text aic-loading__u" />
                  <span className="ds-skel ds-skel--card" />
                </div>
              )}

              {chat.loadError && (
                <div className="ds-empty" role="alert">
                  <div className="ds-empty__icon">
                    <Icon name="i-alert-circle" size={28} />
                  </div>
                  <p className="ds-empty__title">{chat.loadError.status === 404 ? `این گفت${ZW}وگو پیدا نشد` : `گفت${ZW}وگو بارگذاری نشد`}</p>
                  <p className="ds-empty__body">{chat.loadError.status === 404 ? `شاید حذف شده باشد.` : chat.loadError.message}</p>
                  <div className="ds-empty__action aic-row">
                    {chat.loadError.status !== 404 && (
                      <button type="button" className="ds-btn ds-btn--secondary" onClick={() => void chat.load(activeId)}>
                        <Icon name="i-refresh" size={18} />
                        تلاش دوباره
                      </button>
                    )}
                    <button type="button" className="ds-btn" onClick={() => navigate('/ai', { replace: true })}>
                      <Icon name="i-plus" size={18} />
                      {NEW_TITLE}
                    </button>
                  </div>
                </div>
              )}

              {empty && (
                <div className="aic-hero">
                  <span className="aic-hero__mark" aria-hidden="true">
                    <Icon name="logo-mark" size={30} />
                  </span>
                  <h2 className="aic-hero__title">امروز چی بخونیم؟</h2>
                  <p className="aic-hero__sub">
                    {`دستیار آموزشی تو برای علوم پایه و بالینی، فارماکولوژی، تفسیر آزمایش${ZW}ها و مرور پیش از امتحان.`}
                  </p>
                  {!blocked && !quotaOut && (
                    <div className="aic-starters" role="list" aria-label={`پیشنهادهای شروع`}>
                      {starters.map((s) => (
                        <button key={s.text} type="button" role="listitem" className="aic-starter" onClick={() => void send(s.text)}>
                          <span className="aic-starter__tag">
                            <Icon name={s.icon} size={15} />
                            {s.tag}
                          </span>
                          <span className="aic-starter__text">{s.text}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {chat.msgs.map((m) => (
                <ChatMessage key={m.key} msg={m} isLast={m.key === lastAssistant} busy={chat.streaming} onRegenerate={(k) => void chat.regenerate(k)} />
              ))}
            </div>
          </div>

          {showJump && (
            <button
              type="button"
              className="aic-jump"
              onClick={() => {
                stickRef.current = true;
                toBottom(true);
              }}
              aria-label="رفتن به آخرین پیام"
            >
              <Icon name="i-arrow-down" size={20} />
            </button>
          )}

          <div className="aic-dock">
            {blocked ? (
              <div className="aic-banner aic-banner--danger" role="status">
                <Icon name="i-lock" size={18} />
                <span>{status?.disabled_message || (status?.banned ? `دسترسی تو به هوش‌یار مسدود شده است.` : `هوش‌یار موقتاً غیرفعال است.`)}</span>
              </div>
            ) : quotaOut ? (
              <div className="aic-banner" role="status">
                <Icon name="i-clock" size={18} />
                <span>
                  {`سهمیهٔ امروز تمام شد (${faNum(status!.used_today)} از ${faNum(status!.daily_limit)}). از نیمه${ZW}شب دوباره می${ZW}توانی بپرسی.`}
                </span>
              </div>
            ) : (
              <>
                {lowQuota && (
                  <div className="aic-quota" role="status">
                    <span className="ds-badge ds-badge--warning">{`${faNum(status!.remaining!)} پرسش باقی${ZW}مانده امروز`}</span>
                  </div>
                )}
                <Composer
                  ref={composerRef}
                  streaming={chat.streaming}
                  maxChars={maxChars}
                  canAttach={canAttach}
                  draftId={activeId || 'new'}
                  onSend={send}
                  onStop={chat.stop}
                  onAttach={() => setVision(true)}
                  onSendImage={onSendImage}
                />
              </>
            )}
            <p className="aic-disclaimer">{`هوش‌یار ممکن است اشتباه کند؛ برای تصمیم بالینی به منابع معتبر مراجعه کن.`}</p>
          </div>
        </section>
      </div>

      <AiVisionModal open={vision} onClose={() => setVision(false)} onApplyToChat={onVision} />
    </div>
  );
}
