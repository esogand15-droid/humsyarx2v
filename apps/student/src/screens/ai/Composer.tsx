/* نوار نوشتن هوش‌یار: textarea خودرشد (۱ تا ~۸ خط)، فونت ≥۱۶px (بدون زوم iOS)،
   Enter = ارسال فقط با نشانگر دقیق (دسکتاپ)؛ در لمسی Enter خط تازه است.
   هنگام استریم قابل نوشتن میماند (کیبورد بسته نشود) و دکمه به «توقف» تبدیل میشود. */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../../icons';
import { faNum } from './dates';

const DRAFT_KEY = 'hy.ai.draft';
const MAX_H = 200;

export interface ComposerHandle {
  focus: () => void;
  set: (text: string) => void;
}

export interface ComposerProps {
  streaming: boolean;
  disabled?: boolean;
  maxChars: number;
  canAttach: boolean;
  /** کلید پیشنویس (هر گفتوگو جدا) */
  draftId: string;
  onSend: (text: string) => Promise<boolean> | boolean;
  onStop: () => void;
  onAttach: () => void;
}

function readDraft(id: string): string {
  try {
    return sessionStorage.getItem(`${DRAFT_KEY}.${id}`) || '';
  } catch {
    return '';
  }
}
function writeDraft(id: string, v: string) {
  try {
    if (v) sessionStorage.setItem(`${DRAFT_KEY}.${id}`, v);
    else sessionStorage.removeItem(`${DRAFT_KEY}.${id}`);
  } catch {
    /* حالت خصوصی */
  }
}

const finePointer = () => typeof window !== 'undefined' && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { streaming, disabled, maxChars, canAttach, draftId, onSend, onStop, onAttach },
  ref,
) {
  const [value, setValue] = useState(() => readDraft(draftId));
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setValue(readDraft(draftId)), [draftId]);
  useEffect(() => writeDraft(draftId, value), [draftId, value]);

  const resize = useCallback(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    const h = Math.min(el.scrollHeight, MAX_H);
    el.style.height = `${h}px`;
    el.classList.toggle('is-scroll', el.scrollHeight > MAX_H);
  }, []);
  useLayoutEffect(resize, [value, resize]);

  useImperativeHandle(ref, () => ({
    focus: () => ta.current?.focus(),
    set: (t: string) => {
      setValue(t);
      requestAnimationFrame(() => {
        const el = ta.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(t.length, t.length);
      });
    },
  }));

  const len = value.length;
  const over = len > maxChars;
  const showCount = len >= maxChars * 0.8;
  const canSend = !disabled && !streaming && value.trim().length > 0 && !over;

  const submit = async () => {
    if (!canSend) return;
    const text = value;
    setValue('');
    const ok = await onSend(text);
    if (!ok) setValue(text);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    if (!finePointer()) return;
    e.preventDefault();
    void submit();
  };

  return (
    <form
      className={`aic-composer${over ? ' is-over' : ''}`}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="aic-composer__box">
        {canAttach && (
          <button
            type="button"
            className="aic-composer__icon"
            onClick={onAttach}
            disabled={disabled}
            aria-label="پیوست تصویر بالینی"
            title="پیوست تصویر بالینی"
          >
            <Icon name="i-plus" size={22} />
          </button>
        )}
        <textarea
          ref={ta}
          className="aic-composer__input"
          rows={1}
          dir="auto"
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="از هوش‌یار بپرس…"
          aria-label="پیام به هوش‌یار"
          enterKeyHint="enter"
          aria-invalid={over || undefined}
          aria-describedby={showCount ? 'aic-count' : undefined}
        />
        {streaming ? (
          <button type="button" className="aic-composer__send is-stop" onClick={onStop} aria-label="توقف پاسخ" title="توقف">
            <Icon name="i-stop" size={20} />
          </button>
        ) : (
          <button type="submit" className="aic-composer__send" disabled={!canSend} aria-label="ارسال" title="ارسال">
            <Icon name="i-send" size={20} />
          </button>
        )}
      </div>
      {showCount && (
        <div id="aic-count" className="aic-composer__count" aria-live="polite">
          {faNum(len)}/{faNum(maxChars)}
        </div>
      )}
    </form>
  );
});
