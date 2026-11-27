/* هوشیار داخل ریدر — همان قطعه‌های صفحهٔ هوشیار منو (پیام، ورودی، پیوست، پاسخ دوباره، گزارش، سهمیه)
   تا ظاهر و امکانات هر دو یکی بماند؛ فقط زمینهٔ جزوه و صفحهٔ فعلی خودکار ضمیمهٔ هر پرسش می‌شود. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../icons';
import type { IconName } from '../../icons/sprite';
import { ai, type AiStatus } from '../../lib/ai';
import { faNum } from '../../lib/fa';
import { ChatMessage } from '../ai/ChatMessage';
import { Composer, type ComposerHandle } from '../ai/Composer';
import { useAiChat } from '../ai/useAiChat';
import '../ai/ai-chat.css';
import './embedded-ai.css';

interface Props {
  fileId: string;
  bookletName?: string;
  page?: number;
  onClose?: () => void;
}

const ZW = '\u200c';
const STICK_PX = 96;

const PAGE_STARTERS: ReadonlyArray<{ icon: IconName; tag: string; text: string }> = [
  { icon: 'i-file-text', tag: 'خلاصه', text: `این صفحه را در چند نکتهٔ کلیدی برای امتحان خلاصه کن.` },
  { icon: 'i-zap', tag: 'نکات طلایی', text: `نکات طلایی و پرتکرار آزمونی این مبحث چیست؟` },
  { icon: 'i-award', tag: 'خودآزمایی', text: `۳ تست چهارگزینه${ZW}ای از این بخش با پاسخ تشریحی طراحی کن.` },
  { icon: 'i-stethoscope', tag: 'بالینی', text: `کاربرد بالینی و تشخیص${ZW}های افتراقی این مبحث را توضیح بده.` },
];

/** گفت‌وگوی هر جزوه ادامه پیدا می‌کند؛ با بستن و باز کردن پنل از نو شروع نمی‌شود. */
const cidKey = (fileId: string) => `hz.reader.aiCid.${fileId}`;

function readCid(fileId: string): string | null {
  try {
    return window.localStorage.getItem(cidKey(fileId));
  } catch {
    return null;
  }
}

function writeCid(fileId: string, cid: string | null): void {
  try {
    if (cid) window.localStorage.setItem(cidKey(fileId), cid);
    else window.localStorage.removeItem(cidKey(fileId));
  } catch {
    // private mode: the conversation simply starts fresh next time
  }
}

export function EmbeddedAiStudyPanel({ fileId, bookletName, page }: Props) {
  const navigate = useNavigate();
  const composerRef = useRef<ComposerHandle>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<AiStatus | null>(null);

  const refreshStatus = useCallback(() => {
    ai.status()
      .then(setStatus)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const chat = useAiChat({
    onCreated: (cid) => writeCid(fileId, cid),
    onSettled: refreshStatus,
  });

  // ادامهٔ گفت‌وگوی قبلی همین جزوه
  useEffect(() => {
    const cid = readCid(fileId);
    if ((cid || null) === chat.cid()) return;
    void chat.load(cid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  // اگر گفت‌وگوی ذخیره‌شده حذف شده باشد، گفت‌وگوی تازه شروع می‌شود.
  useEffect(() => {
    if (chat.loadError?.status === 404) {
      writeCid(fileId, null);
      void chat.load(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.loadError]);

  const contextHeader = useMemo(
    () =>
      `[زمینه مطالعه در کتابخوان — فایل: ${fileId}${bookletName ? ` | جزوه: «${bookletName}»` : ''}${
        page ? ` | صفحه: ${page}` : ''
      }]\n`,
    [fileId, bookletName, page],
  );

  /* ── اسکرول هوشمند (مثل صفحهٔ هوشیار) ── */
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const olderAnchor = useRef<number | null>(null);

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

  const send = useCallback(
    async (text: string) => {
      stickRef.current = true;
      return chat.send(text, `${contextHeader}${text}`);
    },
    [chat, contextHeader],
  );

  const newChat = () => {
    writeCid(fileId, null);
    stickRef.current = true;
    void chat.load(null);
    composerRef.current?.focus();
  };

  const openFull = () => {
    const cid = chat.cid();
    navigate(cid ? `/ai/${encodeURIComponent(cid)}` : '/ai');
  };

  const onSendMedia = async (file: File, kind: 'image' | 'pdf' | 'audio', prompt: string) => {
    let cid = chat.cid();
    if (!cid) {
      const created = await ai.createConversation(prompt.trim().slice(0, 36) || file.name.slice(0, 36));
      cid = created.id;
      writeCid(fileId, cid);
      await chat.load(cid);
    }
    const res = await ai.askMedia(file, `${contextHeader}${prompt}`, cid);
    stickRef.current = true;
    const now = new Date().toISOString();
    const tag = kind === 'pdf' ? `[PDF مرجع: ${file.name}]` : kind === 'audio' ? `[فایل صوتی: ${file.name}]` : `[تصویر: ${file.name}]`;
    chat.append([
      {
        role: 'user',
        text: prompt.trim() ? `${tag}\n${prompt.trim()}` : tag,
        image: kind === 'image' ? URL.createObjectURL(file) : undefined,
        at: now,
        status: 'done',
      },
      { role: 'assistant', text: res.answer, at: now, status: 'done' },
    ]);
    refreshStatus();
  };

  const onReportMessage = useCallback(
    async (msgKey: string, answerText: string) => {
      const list = chat.msgs;
      const idx = list.findIndex((m) => m.key === msgKey);
      const userMsg = idx > 0 ? [...list.slice(0, idx)].reverse().find((m) => m.role === 'user') : undefined;
      await ai.report(userMsg?.text || 'سؤال کاربر', answerText);
    },
    [chat.msgs],
  );

  const loadOlder = () => {
    const el = scrollRef.current;
    if (el) olderAnchor.current = el.scrollHeight - el.scrollTop;
    void chat.loadOlder();
  };

  const blocked = status && (!status.enabled || status.banned);
  const quotaOut = status && !status.unlimited && status.remaining !== null && status.remaining <= 0;
  const lowQuota = status && !status.unlimited && status.remaining !== null && status.remaining > 0 && status.remaining <= 3;
  const canAttach = status?.capabilities?.image !== false;
  const maxChars = status?.max_input_chars || 2000;

  const lastAssistant = useMemo(() => {
    for (let i = chat.msgs.length - 1; i >= 0; i--) if (chat.msgs[i].role === 'assistant') return chat.msgs[i].key;
    return '';
  }, [chat.msgs]);

  const empty = chat.msgs.length === 0 && !chat.loading && !chat.loadError;

  return (
    <div className="aic aic--embedded" data-section="ai">
      <div className="aic-embed-bar">
        <span className="aic-embed-ctx" title={bookletName}>
          <Icon name="i-book-open" size={14} />
          <span className="aic-embed-ctx__text">
            {bookletName ? `«${bookletName}»` : 'این جزوه'} · صفحهٔ {faNum(page || 1)}
          </span>
        </span>
        <div className="aic-embed-actions">
          <button type="button" className="iconbtn" onClick={newChat} aria-label={`گفت${ZW}وگوی جدید`} title={`گفت${ZW}وگوی جدید`}>
            <Icon name="i-pen" size={16} />
          </button>
          <button type="button" className="iconbtn" onClick={() => navigate('/ai/live')} aria-label="تماس صوتی زنده" title="تماس صوتی زنده">
            <Icon name="i-headphones" size={16} />
          </button>
          <button type="button" className="iconbtn" onClick={() => navigate('/ai/scribe')} aria-label="جزوه‌نویس PDF" title="جزوه‌نویس PDF">
            <Icon name="i-file-text" size={16} />
          </button>
          <button type="button" className="iconbtn" onClick={openFull} aria-label="باز کردن در هوشیار با تاریخچه" title="باز کردن در هوشیار (تاریخچهٔ گفت‌وگوها)">
            <Icon name="i-chat" size={16} />
          </button>
        </div>
      </div>

      <section className="aic-pane" aria-label={`گفت${ZW}وگو با هوشیار دربارهٔ این جزوه`}>
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
              </div>
            )}

            {chat.loadError && chat.loadError.status !== 404 && (
              <div className="ds-empty" role="alert">
                <div className="ds-empty__icon">
                  <Icon name="i-alert-circle" size={28} />
                </div>
                <p className="ds-empty__title">{`گفت${ZW}وگو بارگذاری نشد`}</p>
                <p className="ds-empty__body">{chat.loadError.message}</p>
                <div className="ds-empty__action aic-row">
                  <button type="button" className="ds-btn ds-btn--secondary" onClick={() => void chat.load(readCid(fileId))}>
                    <Icon name="i-refresh" size={18} />
                    تلاش دوباره
                  </button>
                  <button type="button" className="ds-btn" onClick={newChat}>
                    <Icon name="i-plus" size={18} />
                    {`گفت${ZW}وگوی جدید`}
                  </button>
                </div>
              </div>
            )}

            {empty && (
              <div className="aic-hero">
                <span className="aic-hero__mark" aria-hidden="true">
                  <Icon name="logo-mark" size={26} />
                </span>
                <h2 className="aic-hero__title">دربارهٔ این صفحه بپرس</h2>
                <p className="aic-hero__sub">
                  {`هوشیار می${ZW}داند کدام جزوه و کدام صفحه را می${ZW}خوانی؛ خلاصه، تست، نکتهٔ بالینی یا توضیح هر بخش را بخواه.`}
                </p>
                {!blocked && !quotaOut && (
                  <div className="aic-starters" role="list" aria-label="پیشنهادهای شروع">
                    {PAGE_STARTERS.map((s) => (
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
              <ChatMessage
                key={m.key}
                msg={m}
                isLast={m.key === lastAssistant}
                busy={chat.streaming}
                onRegenerate={(k) => void chat.regenerate(k)}
                onReport={onReportMessage}
              />
            ))}
          </div>
        </div>

        {showJump && (
          <button
            type="button"
            className="aic-jump"
            onClick={() => {
              stickRef.current = true;
              scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
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
              <span>{status?.disabled_message || (status?.banned ? `دسترسی تو به هوشیار مسدود شده است.` : `هوشیار موقتاً غیرفعال است.`)}</span>
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
                draftId={`reader-${fileId}`}
                onSend={send}
                onStop={chat.stop}
                onSendMedia={onSendMedia}
              />
            </>
          )}
          <p className="aic-disclaimer">{`هوشیار ممکن است اشتباه کند؛ برای تصمیم بالینی به منابع معتبر مراجعه کن.`}</p>
        </div>
      </section>
    </div>
  );
}
