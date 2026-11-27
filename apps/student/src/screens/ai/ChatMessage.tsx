/* یک پیام در گفتوگوی هوشیار: کاربر = حباب در سمت انتهای خط؛
   هوشیار = تمامعرض با آواتار، مارکداون، نوار کنش (کپی، پاسخ دوباره) و خطای درجا. */
import { memo, useState } from 'react';
import { Icon } from '../../icons';
import { Markdown, copyText, textDir } from './markdown';
import { fullLabel, parseDate } from './dates';
import type { ChatMsg } from './useAiChat';

const ZW = '\u200c';
const timeFmt = new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hour12: false });

function Time({ at }: { at?: string | null }) {
  const d = parseDate(at);
  if (!d) return null;
  return (
    <time className="aic-msg__time" dateTime={d.toISOString()} title={fullLabel(d)}>
      {timeFmt.format(d)}
    </time>
  );
}

export interface ChatMessageProps {
  msg: ChatMsg;
  /** آخرین پاسخ دستیار ⇒ «پاسخ دوباره» فعال */
  isLast: boolean;
  busy: boolean;
  onRegenerate: (key: string) => void;
  onReport?: (key: string, answerText: string) => Promise<void>;
}

export const ChatMessage = memo(function ChatMessage({ msg, isLast, busy, onRegenerate, onReport }: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const [reported, setReported] = useState(false);

  if (msg.role === 'user') {
    return (
      <div className="aic-msg aic-msg--user">
        <div className="aic-bubble" dir={textDir(msg.text)}>
          {msg.image && <img className="aic-bubble__img" src={msg.image} alt="تصویر پیوستشده" />}
          {msg.text}
        </div>
        <Time at={msg.at} />
      </div>
    );
  }

  const streaming = msg.status === 'streaming';
  const empty = !msg.text;
  const canRegen = isLast && !busy && !msg.image;

  const copy = async () => {
    if (await copyText(msg.text)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  return (
    <article className={`aic-msg aic-msg--ai${streaming ? ' is-streaming' : ''}`} aria-busy={streaming || undefined}>
      <div className="aic-msg__head">
        <span className="aic-avatar" aria-hidden="true">
          <Icon name="logo-mark" size={16} />
        </span>
        <span className="aic-msg__name">هوشیار</span>
        {!streaming && <Time at={msg.at} />}
      </div>

      <div className="aic-msg__body">
        {streaming && empty ? (
          <div className="aic-typing" role="status" aria-label={`هوشیار در حال نوشتن است`}>
            <span />
            <span />
            <span />
          </div>
        ) : (
          !empty && <Markdown text={msg.text} />
        )}

        {msg.chips && msg.chips.length > 0 && (
          <div className="aic-chips" aria-label={`ساختارهای شناسایی${ZW}شده`}>
            {msg.chips.map((c, i) => (
              <span key={i} className="ds-badge ds-badge--accent">
                <bdi>{c}</bdi>
              </span>
            ))}
          </div>
        )}

        {msg.status === 'stopped' && (
          <p className="aic-note">
            <Icon name="i-stop" size={14} />
            {empty ? `پاسخ پیش از شروع متوقف شد.` : `پاسخ متوقف شد.`}
          </p>
        )}

        {msg.status === 'error' && msg.error && (
          <div className="aic-error" role="alert">
            <Icon name="i-alert-circle" size={18} />
            <div className="aic-error__body">
              <p className="aic-error__title">{msg.error.message}</p>
              {msg.error.partial && !empty && <p className="aic-error__sub">بخشی از پاسخ بالا آمده است.</p>}
              {msg.error.retryAfter ? (
                <p className="aic-error__sub">
                  {new Intl.NumberFormat('fa-IR').format(msg.error.retryAfter)} ثانیهٔ دیگر دوباره امتحان کن.
                </p>
              ) : null}
            </div>
            {isLast && msg.error.code !== 'quota' && msg.error.code !== 'banned' && msg.error.code !== 'no_access' && (
              <button type="button" className="ds-btn ds-btn--secondary ds-btn--sm" onClick={() => onRegenerate(msg.key)} disabled={busy}>
                <Icon name="i-refresh" size={16} />
                تلاش دوباره
              </button>
            )}
          </div>
        )}
      </div>

      {!streaming && !empty && (
        <div className="aic-actions">
          <button type="button" className="aic-act" onClick={copy} aria-label={copied ? 'کپی شد' : 'کپی پاسخ'} title="کپی پاسخ">
            <Icon name={copied ? 'i-check' : 'i-copy'} size={16} />
            <span className="aic-act__label">{copied ? 'کپی شد' : 'کپی'}</span>
          </button>
          {canRegen && msg.status !== 'error' && (
            <button type="button" className="aic-act" onClick={() => onRegenerate(msg.key)} aria-label="پاسخ دوباره" title="پاسخ دوباره">
              <Icon name="i-refresh" size={16} />
              <span className="aic-act__label">پاسخ دوباره</span>
            </button>
          )}
          {onReport && msg.status !== 'error' && (
            <button
              type="button"
              className="aic-act"
              disabled={reported}
              onClick={() => {
                void onReport(msg.key, msg.text).then(() => setReported(true));
              }}
              aria-label="گزارش پاسخ نادرست"
              title="گزارش پاسخ نادرست"
            >
              <Icon name={reported ? 'i-check' : 'i-alert-circle'} size={15} />
              <span className="aic-act__label">{reported ? 'گزارش شد' : 'گزارش خطا'}</span>
            </button>
          )}
        </div>
      )}
    </article>
  );
});
