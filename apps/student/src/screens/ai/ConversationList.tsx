/* فهرست گفتوگوهای هوش‌یار — ستون کناری (≥۷۶۸px) یا کشوی کناری (موبایل).
   جستوجو (سمت سرور با q، با تأخیر)، گروهبندی تاریخ شمسی، سنجاق، تغییر نام درجا،
   حذف با تأیید. رشتهٔ legacy (حافظهٔ مشترک با ربات تلگرام) برچسب میگیرد و
   تغییر نام/سنجاق ندارد (سرور ۴۰۰ میدهد). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../icons';
import { Sheet } from '../../components/Sheet';
import type { AiConversation } from '../../lib/ai';
import { GROUP_PINNED, fullLabel, groupLabel, parseDate, relativeLabel } from './dates';

const ZW = '\u200c';
const NEW_TITLE = `گفت${ZW}وگوی جدید`;

export interface ConversationListProps {
  items: AiConversation[];
  loading: boolean;
  error: string | null;
  activeId: string | null;
  query: string;
  onQuery: (q: string) => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => Promise<boolean>;
  onPin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => Promise<boolean>;
  onRetry: () => void;
  onClose?: () => void;
}

interface Group {
  label: string;
  items: AiConversation[];
}

function groupItems(items: AiConversation[]): Group[] {
  const out: Group[] = [];
  const now = new Date();
  for (const c of items) {
    const label = c.pinned ? GROUP_PINNED : groupLabel(parseDate(c.updated_at || c.created_at), now);
    const last = out[out.length - 1];
    if (last && last.label === label) last.items.push(c);
    else out.push({ label, items: [c] });
  }
  return out;
}

function Row({
  c,
  active,
  renaming,
  onOpen,
  onMenu,
  onRenameDone,
}: {
  c: AiConversation;
  active: boolean;
  renaming: boolean;
  onOpen: () => void;
  onMenu: () => void;
  onRenameDone: (title: string | null) => void;
}) {
  const [draft, setDraft] = useState(c.title);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming) {
      setDraft(c.title === NEW_TITLE ? '' : c.title);
      requestAnimationFrame(() => input.current?.select());
    }
  }, [renaming, c.title]);

  const d = parseDate(c.updated_at || c.created_at);

  if (renaming) {
    return (
      <li className="aic-conv is-renaming">
        <form
          className="aic-conv__rename"
          onSubmit={(e) => {
            e.preventDefault();
            onRenameDone(draft.trim() || null);
          }}
        >
          <input
            ref={input}
            className="ds-input"
            value={draft}
            maxLength={80}
            dir="auto"
            aria-label={`عنوان تازهٔ گفت${ZW}وگو`}
            placeholder={NEW_TITLE}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onRenameDone(null)}
            onBlur={() => onRenameDone(draft.trim() || null)}
          />
        </form>
      </li>
    );
  }

  return (
    <li className={`aic-conv${active ? ' is-active' : ''}`}>
      <button
        type="button"
        className="aic-conv__main"
        onClick={onOpen}
        aria-current={active ? 'page' : undefined}
        title={fullLabel(d)}
      >
        <span className="aic-conv__title" dir="auto">
          {c.pinned && <Icon name="i-pin" size={13} />}
          {c.title || NEW_TITLE}
        </span>
        <span className="aic-conv__meta">
          {c.legacy && <span className="ds-badge">تلگرام</span>}
          <span className="aic-conv__date">{relativeLabel(d)}</span>
        </span>
      </button>
      <button type="button" className="aic-conv__more" onClick={onMenu} aria-label={`گزینه${ZW}های «${c.title || NEW_TITLE}»`}>
        <Icon name="i-more" size={18} />
      </button>
    </li>
  );
}

export function ConversationList(p: ConversationListProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const groups = useMemo(() => groupItems(p.items), [p.items]);
  const menuConv = p.items.find((c) => c.id === menuId) || null;

  const closeMenu = () => {
    setMenuId(null);
    setConfirmDelete(false);
  };

  return (
    <div className="aic-hist">
      <div className="aic-hist__head">
        <button type="button" className="ds-btn ds-btn--block aic-hist__new" onClick={p.onNew}>
          <Icon name="i-plus" size={18} />
          {NEW_TITLE}
        </button>
        {p.onClose && (
          <button type="button" className="aic-iconbtn" onClick={p.onClose} aria-label="بستن تاریخچه">
            <Icon name="i-x" size={20} />
          </button>
        )}
      </div>

      <div className="ds-search aic-hist__search" role="search">
        <span className="ds-search__icon">
          <Icon name="i-search" size={18} />
        </span>
        <input
          className="ds-input"
          type="search"
          dir="auto"
          value={p.query}
          onChange={(e) => p.onQuery(e.target.value)}
          placeholder={`جست${ZW}وجو در گفت${ZW}وگوها`}
          aria-label={`جست${ZW}وجو در گفت${ZW}وگوها`}
        />
        {p.query && (
          <button type="button" className="ds-search__clear" onClick={() => p.onQuery('')} aria-label={`پاک${ZW}کردن جست${ZW}وجو`}>
            <Icon name="i-x" size={16} />
          </button>
        )}
      </div>

      <nav className="aic-hist__list" aria-label={`تاریخچهٔ گفت${ZW}وگوها`}>
        {p.loading && p.items.length === 0 ? (
          <div className="aic-hist__skel" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className="ds-skel ds-skel--row" />
            ))}
          </div>
        ) : p.error && p.items.length === 0 ? (
          <div className="aic-hist__empty" role="alert">
            <p>{p.error}</p>
            <button type="button" className="ds-btn ds-btn--secondary ds-btn--sm" onClick={p.onRetry}>
              <Icon name="i-refresh" size={16} />
              تلاش دوباره
            </button>
          </div>
        ) : p.items.length === 0 ? (
          <div className="aic-hist__empty">
            <p>{p.query ? `گفت${ZW}وگویی با «${p.query}» پیدا نشد.` : `هنوز گفت${ZW}وگویی نداری. اولین پرسشت را بنویس.`}</p>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.label} className="aic-hist__group" aria-label={g.label}>
              <h3 className="aic-hist__label">{g.label}</h3>
              <ul className="aic-hist__items">
                {g.items.map((c) => (
                  <Row
                    key={c.id}
                    c={c}
                    active={c.id === p.activeId}
                    renaming={renamingId === c.id}
                    onOpen={() => p.onOpen(c.id)}
                    onMenu={() => setMenuId(c.id)}
                    onRenameDone={async (title) => {
                      setRenamingId(null);
                      if (title && title !== c.title) await p.onRename(c.id, title);
                    }}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </nav>

      <Sheet open={Boolean(menuConv)} onClose={closeMenu} title={menuConv?.title || NEW_TITLE}>
        {menuConv &&
          (confirmDelete ? (
            <div className="aic-sheet">
              <p className="aic-sheet__text">
                {menuConv.legacy
                  ? `حافظهٔ گفت${ZW}وگوی مشترک با ربات تلگرام پاک می${ZW}شود. این کار برگشت${ZW}پذیر نیست.`
                  : `این گفت${ZW}وگو و همهٔ پیام${ZW}هایش حذف می${ZW}شود. این کار برگشت${ZW}پذیر نیست.`}
              </p>
              <div className="aic-sheet__row">
                <button type="button" className="ds-btn ds-btn--ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                  انصراف
                </button>
                <button
                  type="button"
                  className="ds-btn ds-btn--danger"
                  disabled={deleting}
                  aria-busy={deleting || undefined}
                  onClick={async () => {
                    setDeleting(true);
                    const ok = await p.onDelete(menuConv.id);
                    setDeleting(false);
                    if (ok) closeMenu();
                  }}
                >
                  <Icon name="i-trash" size={18} />
                  حذف
                </button>
              </div>
            </div>
          ) : (
            <ul className="ds-list aic-sheet__list">
              {!menuConv.legacy && (
                <li>
                  <button
                    type="button"
                    className="ds-row"
                    onClick={() => {
                      const id = menuConv.id;
                      closeMenu();
                      setRenamingId(id);
                    }}
                  >
                    <span className="ds-row__icon">
                      <Icon name="i-pen" size={20} />
                    </span>
                    <span className="ds-row__body">
                      <span className="ds-row__title">تغییر نام</span>
                    </span>
                  </button>
                </li>
              )}
              {!menuConv.legacy && (
                <li>
                  <button
                    type="button"
                    className="ds-row"
                    onClick={() => {
                      p.onPin(menuConv.id, !menuConv.pinned);
                      closeMenu();
                    }}
                  >
                    <span className="ds-row__icon">
                      <Icon name="i-pin" size={20} />
                    </span>
                    <span className="ds-row__body">
                      <span className="ds-row__title">{menuConv.pinned ? `برداشتن سنجاق` : 'سنجاق به بالا'}</span>
                    </span>
                  </button>
                </li>
              )}
              <li>
                <button type="button" className="ds-row aic-sheet__danger" onClick={() => setConfirmDelete(true)}>
                  <span className="ds-row__icon">
                    <Icon name="i-trash" size={20} />
                  </span>
                  <span className="ds-row__body">
                    <span className="ds-row__title">{menuConv.legacy ? `پاک${ZW}کردن حافظهٔ تلگرام` : `حذف گفت${ZW}وگو`}</span>
                  </span>
                </button>
              </li>
            </ul>
          ))}
      </Sheet>
    </div>
  );
}
