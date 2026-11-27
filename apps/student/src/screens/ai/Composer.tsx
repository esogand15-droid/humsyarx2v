/* نوار نوشتن هوشیار: textarea خودرشد (۱ تا ~۸ خط)، فونت ≥۱۶px (بدون زوم iOS)،
   Enter = ارسال فقط با نشانگر دقیق (دسکتاپ)؛ در لمسی Enter خط تازه است.
   هنگام استریم قابل نوشتن میماند (کیبورد بسته نشود) و دکمه به «توقف» تبدیل میشود.
   چیدمان RTL: ارسال در راست فیزیکی (اولین فرزند)، «+» در چپ فیزیکی (آخرین فرزند).
   «+» یک پاپاور جمعوجور باز میکند (دوربین، تصاویر، فایل)؛
   هر گزینه بیدرنگ انتخابگر بومی را باز میکند و تصویر انتخابشده بالای فیلد
   بهصورت چیپ میماند تا همراه پیام فرستاده شود.
   پرده و پاپاور در body پورتال میشوند: backdrop-filter نوار نوشتن یک containing block
   برای position:fixed میسازد و پرده را فقط روی خود نوار (خاکستری) میکشید. */
import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../icons';
import type { IconName } from '../../icons';
import { MOTION, usePresence } from '../../lib/motion';
import { faNum } from './dates';

const DRAFT_KEY = 'hy.ai.draft';
const MAX_H = 200;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const IMAGE_ACCEPT = IMAGE_TYPES.join(',');
const ALL_MEDIA_ACCEPT = `${IMAGE_ACCEPT},application/pdf,.pdf,audio/*,.mp3,.wav,.ogg,.m4a,.webm`;
const DEFAULT_IMAGE_PROMPT = 'لطفاً این تصویر پزشکی را تحلیل و نکات آموزشی آن را توضیح دهید.';

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
  /** ارسال تصویر پیوستشده همراه متن؛ خطا را throw میکند تا روی چیپ نمایش داده شود. */
  onSendImage?: (file: File, prompt: string) => Promise<void>;
  /** ارسال PDF یا فایل صوتی از طریق /api/ai/ask-media */
  onSendMedia?: (file: File, kind: 'image' | 'pdf' | 'audio', prompt: string) => Promise<void>;
  /** دکمهٔ گفت‌وگوی صوتی زنده کنار «ارسال» */
  onVoice?: () => void;
  voiceActive?: boolean;
}

interface Attachment {
  file: File;
  kind: 'image' | 'pdf' | 'audio';
  url: string;
}

function classifyMediaFile(file: File): { kind?: 'image' | 'pdf' | 'audio'; error?: string } {
  const mime = (file.type || '').toLowerCase();
  const lower = (file.name || '').toLowerCase();
  if (IMAGE_TYPES.includes(mime) || /\.(jpe?g|png|webp)$/.test(lower)) {
    if (file.size > MAX_IMAGE_BYTES) return { error: 'حجم تصویر نباید بیشتر از ۱۰ مگابایت باشد.' };
    return { kind: 'image' };
  }
  if (mime === 'application/pdf' || lower.endsWith('.pdf')) {
    if (file.size > MAX_MEDIA_BYTES) return { error: 'حجم فایل PDF نباید بیشتر از ۲۰ مگابایت باشد.' };
    return { kind: 'pdf' };
  }
  if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|oga|m4a|flac|aac|webm|opus)$/.test(lower)) {
    if (file.size > MAX_MEDIA_BYTES) return { error: 'حجم فایل صوتی نباید بیشتر از ۲۰ مگابایت باشد.' };
    return { kind: 'audio' };
  }
  return { error: 'فرمت مجاز: تصویر (JPG/PNG/WebP)، سند PDF یا فایل صوتی (MP3/WAV/M4A/OGG).' };
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

type MenuKey = 'camera' | 'gallery' | 'file';
const MENU: { key: MenuKey; icon: IconName; label: string }[] = [
  { key: 'camera', icon: 'i-video', label: 'دوربین' },
  { key: 'gallery', icon: 'i-layers', label: 'تصاویر' },
  { key: 'file', icon: 'i-file-text', label: 'پیوست فایل' },
];

const MENU_GAP = 10;
const VIEW_MARGIN = 16;

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { streaming, disabled, maxChars, canAttach, draftId, onSend, onStop, onSendImage, onSendMedia, onVoice, voiceActive },
  ref,
) {
  const [value, setValue] = useState(() => readDraft(draftId));
  const [menuOpen, setMenuOpen] = useState(false);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [attachError, setAttachError] = useState('');
  const [uploading, setUploading] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const menuToken = useId();
  const menu = usePresence(menuOpen, MOTION.popover);

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

  /* بستن پاپاور با لمس بیرون، Esc یا دکمهٔ Back؛ فوکوس به «+» برمی‌گردد. */
  useEffect(() => {
    if (!menuOpen) return;
    let popped = false;
    try {
      const curr = window.history.state && typeof window.history.state === 'object' ? window.history.state : {};
      window.history.pushState({ ...curr, _hyAttach: menuToken }, '');
    } catch {
      /* ignore */
    }
    const onPop = () => {
      const st = window.history.state as { _hyAttach?: string } | null;
      if (st?._hyAttach !== menuToken) {
        popped = true;
        setMenuOpen(false);
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || plusRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMenuOpen(false);
      plusRef.current?.focus();
    };
    window.addEventListener('popstate', onPop);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus());
    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      const st = window.history.state as { _hyAttach?: string } | null;
      if (!popped && st?._hyAttach === menuToken) {
        try {
          window.history.back();
        } catch {
          /* ignore */
        }
      }
    };
  }, [menuOpen, menuToken]);

  useEffect(() => () => {
    if (attachment) URL.revokeObjectURL(attachment.url);
  }, [attachment]);

  /* پاپاور پورتالشده با position:fixed بالای «+» لنگر میشود؛ با چرخش، تغییر اندازه و کیبورد بهروز میماند. */
  useLayoutEffect(() => {
    if (!menu.mounted) return;
    const place = () => {
      const btn = plusRef.current;
      const el = menuRef.current;
      if (!btn || !el) return;
      const r = btn.getBoundingClientRect();
      const rtl = getComputedStyle(btn).direction === 'rtl';
      const vw = document.documentElement.clientWidth;
      // RTL: inline-end is the physical start edge of the button.
      const end = rtl ? r.x : vw - (r.x + r.width);
      const maxEnd = Math.max(VIEW_MARGIN, vw - el.offsetWidth - VIEW_MARGIN);
      el.style.setProperty('--aic-menu-bottom', `${Math.round(window.innerHeight - r.top + MENU_GAP)}px`);
      el.style.setProperty('--aic-menu-end', `${Math.round(Math.min(Math.max(VIEW_MARGIN, end), maxEnd))}px`);
    };
    place();
    const vv = window.visualViewport;
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    vv?.addEventListener('resize', place);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      vv?.removeEventListener('resize', place);
    };
  }, [menu.mounted]);

  const pick = (key: MenuKey) => {
    setMenuOpen(false);
    const input = key === 'camera' ? cameraInput : key === 'gallery' ? galleryInput : fileInput;
    // باید در همان رویداد لمس صدا زده شود تا iOS انتخابگر را مسدود نکند.
    input.current?.click();
  };

  const onPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const classified = classifyMediaFile(file);
    if (classified.error || !classified.kind) {
      setAttachError(classified.error || 'فایل نامعتبر است.');
      return;
    }
    setAttachError('');
    setAttachment({ file, kind: classified.kind, url: URL.createObjectURL(file) });
    ta.current?.focus();
  };

  const removeAttachment = () => {
    setAttachment(null);
    setAttachError('');
  };

  const len = value.length;
  const over = len > maxChars;
  const showCount = len >= maxChars * 0.8;
  const hasText = value.trim().length > 0;
  const canSend = !disabled && !streaming && !uploading && !over && (hasText || !!attachment);

  const submit = async () => {
    if (!canSend) return;
    const text = value;
    if (attachment && (onSendMedia || (attachment.kind === 'image' && onSendImage))) {
      setUploading(true);
      setAttachError('');
      try {
        const { file, kind } = attachment;
        if (onSendMedia) {
          await onSendMedia(file, kind, text.trim());
        } else if (kind === 'image' && onSendImage) {
          await onSendImage(file, text.trim() || DEFAULT_IMAGE_PROMPT);
        }
        setAttachment(null);
        setValue('');
      } catch (err) {
        setAttachError(err instanceof Error && err.message ? err.message : 'ارسال پیوست انجام نشد. دوباره تلاش کن.');
      } finally {
        setUploading(false);
      }
      return;
    }
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
      {(attachment || attachError) && (
        <div className="aic-attach-tray">
          {attachment && (
            <div className={`aic-attach-chip${uploading ? ' is-uploading' : ''}`}>
              {attachment.kind === 'image' ? (
                <img className="aic-attach-chip__thumb" src={attachment.url} alt="" />
              ) : (
                <span className="aic-attach-chip__thumb" style={{ display: 'grid', placeItems: 'center' }}>
                  <Icon name={attachment.kind === 'pdf' ? 'i-file-text' : 'i-headphones'} size={18} />
                </span>
              )}
              <span className="aic-attach-chip__name">
                <bdi dir="auto">{attachment.file.name}</bdi>
                <span className="aic-attach-chip__meta">
                  {uploading
                    ? 'در حال ارسال و تحلیل…'
                    : `${attachment.kind === 'pdf' ? 'PDF مرجع' : attachment.kind === 'audio' ? 'فایل صوتی' : 'تصویر'} · ${faNum(Math.max(1, Math.round(attachment.file.size / 1024)))} کیلوبایت`}
                </span>
              </span>
              {!uploading && (
                <button type="button" className="aic-attach-chip__remove" onClick={removeAttachment} aria-label="حذف پیوست">
                  <Icon name="i-x" size={14} />
                </button>
              )}
              {uploading && <span className="aic-attach-chip__bar" role="progressbar" aria-label="در حال ارسال پیوست" />}
            </div>
          )}
          {attachError && (
            <p className="aic-attach-error" role="alert">
              <Icon name="i-alert-circle" size={14} />
              <span>{attachError}</span>
            </p>
          )}
        </div>
      )}

      <div className="aic-composer__box">
        {streaming ? (
          <button type="button" className="aic-composer__send is-stop" onClick={onStop} aria-label="توقف پاسخ" title="توقف">
            <Icon name="i-stop" size={20} />
          </button>
        ) : (
          <button
            type="submit"
            className={`aic-composer__send${canSend ? ' is-ready' : ''}`}
            disabled={!canSend}
            aria-label="ارسال"
            title="ارسال"
          >
            <Icon name="i-arrow-up" size={20} />
          </button>
        )}
        {onVoice && !streaming && (
          <button
            type="button"
            className={'aic-composer__icon aic-composer__voice' + (voiceActive ? ' is-active' : '')}
            onClick={onVoice}
            disabled={disabled}
            aria-pressed={voiceActive}
            aria-label="گفت‌وگوی صوتی زنده"
            title="گفت‌وگوی صوتی زنده"
          >
            <Icon name="i-waveform" size={20} />
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
          placeholder={
            attachment
              ? attachment.kind === 'pdf'
                ? 'دربارهٔ این فایل PDF بپرس یا بدون متن ارسال کن…'
                : attachment.kind === 'audio'
                  ? 'پرسش دربارهٔ این فایل صوتی (اختیاری)…'
                  : 'دربارهٔ این تصویر بپرس…'
              : 'از هوشیار بپرس…'
          }
          aria-label="پیام به هوشیار"
          enterKeyHint="enter"
          aria-invalid={over || undefined}
          aria-describedby={showCount ? 'aic-count' : undefined}
        />
        {canAttach && (
          <div className="aic-attach">
            <button
              ref={plusRef}
              type="button"
              className={`aic-composer__icon aic-attach__plus${menuOpen ? ' is-open' : ''}`}
              onClick={() => setMenuOpen((v) => !v)}
              disabled={disabled || uploading}
              aria-label="افزودن"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title="افزودن"
            >
              <Icon name="i-plus" size={22} />
            </button>
            {menu.mounted &&
              createPortal(
              <>
                <div
                  className="aic-attach-scrim"
                  data-state={menu.state}
                  onClick={() => setMenuOpen(false)}
                  aria-hidden="true"
                />
                <div ref={menuRef} className="aic-attach__menu mo-popover" data-state={menu.state} role="menu" aria-label="افزودن">
                  <div className="mo-stagger">
                    {MENU.map((m) => (
                      <button
                        key={m.key}
                        type="button"
                        role="menuitem"
                        className="aic-attach__item"
                        onClick={() => pick(m.key)}
                      >
                        <span className="aic-attach__item-icon" aria-hidden="true">
                          <Icon name={m.icon} size={18} />
                        </span>
                        <span>{m.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </>,
              document.body,
            )}
          </div>
        )}
      </div>

      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={onPicked} />
      <input ref={galleryInput} type="file" accept={IMAGE_ACCEPT} hidden onChange={onPicked} />
      <input ref={fileInput} type="file" accept={ALL_MEDIA_ACCEPT} hidden onChange={onPicked} />

      {showCount && (
        <div id="aic-count" className="aic-composer__count" aria-live="polite">
          {faNum(len)}/{faNum(maxChars)}
        </div>
      )}
    </form>
  );
});
