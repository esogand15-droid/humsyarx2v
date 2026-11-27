import { useCallback, type ReactNode } from 'react';
import { useLocation, useParams } from 'react-router-dom';

import '../core.css';
import { AppBar, ListRow } from '../../components';
import { ErrorBlock, LoadingBlock } from '../../components/AccessStates';
import { DsBadge, DsCard, DsEmpty } from '../../design/components';
import { Icon } from '../../icons';
import { faNum } from '../../lib/fa';
import { fileLabel, humanSize, library } from '../../lib/library';
import type {
  BookItem,
  ContentFile,
  LessonItem,
  ReferenceFile,
  SessionItem,
} from '../../lib/library';
import { readerPath } from '../../lib/reader';
import { useAsync } from '../../lib/useAsync';

/* سه سطح کتابخانه (ترم → درس → جلسه → فایل) و دو سطح مرجع (موضوع → کتاب → فایل). */

function LibraryShell({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: ReactNode;
}) {
  return (
    <>
      <AppBar title={title} sub={sub} back />
      <div className="page page-enter core-page">{children}</div>
    </>
  );
}

/* ─────────────── ۱) درس‌های یک ترم ─────────────── */
export function TermScreen() {
  const { term = '' } = useParams();
  const run = useCallback(() => library.lessons(term), [term]);
  const { data, error, loading, reload } = useAsync(run, [term]);

  return (
    <LibraryShell title={faNum(term) || 'ترم'} sub="درس‌های این ترم">
      {loading && <LoadingBlock />}
      {!loading && error != null && <ErrorBlock error={error} onRetry={reload} />}
      {!loading && !error && data && data.lessons.length === 0 && (
        <DsCard>
          <DsEmpty
            icon={<Icon name="i-book" size={28} />}
            title="درسی در این ترم ثبت نشده"
            body="محتوای این ترم به‌زودی منتشر می‌شود."
          />
        </DsCard>
      )}
      {!loading && !error && data && data.lessons.length > 0 && (
        <div className="core-stack">
          <div className="core-sec-head">
            <h2 className="core-sec-head__title">فهرست درس‌ها</h2>
            <DsBadge tone="accent">{faNum(data.lessons.length)} درس</DsBadge>
          </div>
          <DsCard flush>
            <div className="ds-list">
              {data.lessons.map((l: LessonItem) => (
                <ListRow
                  key={l._id}
                  icon="i-book"
                  title={l.name}
                  sub={l.teacher || 'منبع درسی'}
                  meta={`${faNum(l.session_count)} جلسه`}
                  to={`/library/lesson/${l._id}`}
                  state={{ title: l.name }}
                  chevron
                />
              ))}
            </div>
          </DsCard>
        </div>
      )}
    </LibraryShell>
  );
}

/* ─────────────── ۲) جلسه‌های یک درس ─────────────── */
export function LessonScreen() {
  const { id = '' } = useParams();
  const locState = useLocation().state as { title?: string } | null;
  const lessonTitle = locState?.title || 'جلسه‌ها';
  const run = useCallback(() => library.sessions(id), [id]);
  const { data, error, loading, reload } = useAsync(run, [id]);

  return (
    <LibraryShell title={lessonTitle} sub="ویدیو، جزوه و صوت هر جلسه">
      {loading && <LoadingBlock />}
      {!loading && error != null && <ErrorBlock error={error} onRetry={reload} />}
      {!loading && !error && data && data.sessions.length === 0 && (
        <DsCard>
          <DsEmpty
            icon={<Icon name="i-video" size={28} />}
            title="جلسه‌ای ثبت نشده"
            body="برای این درس هنوز جلسه‌ای منتشر نشده است."
          />
        </DsCard>
      )}
      {!loading && !error && data && data.sessions.length > 0 && (
        <div className="core-stack">
          <div className="core-sec-head">
            <h2 className="core-sec-head__title">فهرست جلسه‌ها</h2>
            <DsBadge tone="accent">{faNum(data.sessions.length)} جلسه</DsBadge>
          </div>
          <DsCard flush>
            <div className="ds-list">
              {data.sessions.map((s: SessionItem) => (
                <ListRow
                  key={s._id}
                  icon="i-play"
                  title={`جلسهٔ ${faNum(s.number)}: ${s.topic}`}
                  sub={s.teacher || 'جلسهٔ آموزشی'}
                  meta={`${faNum(s.file_count)} فایل`}
                  to={`/library/session/${s._id}`}
                  state={{ title: `جلسهٔ ${faNum(s.number)}`, lessonTitle: s.topic || lessonTitle }}
                  chevron
                />
              ))}
            </div>
          </DsCard>
        </div>
      )}
    </LibraryShell>
  );
}

/* ─────────────── ۳) فایل‌های یک جلسه ─────────────── */
export function SessionScreen() {
  const { id = '' } = useParams();
  const locState = useLocation().state as { title?: string; lessonTitle?: string } | null;
  const run = useCallback(() => library.files(id), [id]);
  const { data, error, loading, reload } = useAsync(run, [id]);

  const iconFor = (kind: string) => {
    if (kind === 'video') return 'i-video' as const;
    if (kind === 'voice') return 'i-headphones' as const;
    if (kind === 'pdf' || kind === 'ppt') return 'i-doc' as const;
    if (kind === 'test') return 'i-flask' as const;
    return 'i-doc' as const;
  };

  return (
    <LibraryShell
      title={locState?.title || 'فایل‌های جلسه'}
      sub={locState?.lessonTitle || 'جزوه، ویدیو و فایل‌های ضمیمه'}
    >
      {loading && <LoadingBlock />}
      {!loading && error != null && <ErrorBlock error={error} onRetry={reload} />}
      {!loading && !error && data && data.files.length === 0 && (
        <DsCard>
          <DsEmpty
            icon={<Icon name="i-doc" size={28} />}
            title="فایلی برای این جلسه نیست"
            body="هنوز فایلی در این جلسه ثبت نشده است."
          />
        </DsCard>
      )}
      {!loading && !error && data && data.files.length > 0 && (
        <div className="core-stack">
          <DsCard flush>
            <div className="ds-list">
              {data.files.map((f: ContentFile) => (
                <ListRow
                  key={f.id}
                  icon={iconFor(f.type)}
                  title={f.name}
                  sub={[fileLabel(f.type, f.mime, f.name), humanSize(f.size)]
                    .filter(Boolean)
                    .join(' · ')}
                  to={readerPath('res', f.id)}
                  chevron
                />
              ))}
            </div>
          </DsCard>
          <DsCard level="sunken" className="lib-note-card">
            تمامی فایل‌های جلسه — از جمله جزوه‌های PDF، اسلایدهای پاورپوینت، ویدیو، صوت، فایل‌های متنی،
            اکسل و ضمایم — مستقیماً داخل برنامه باز و نمایش داده می‌شوند.
          </DsCard>
        </div>
      )}
    </LibraryShell>
  );
}

/* ─────────────── ۴) کتاب‌های یک موضوع مرجع ─────────────── */
export function SubjectScreen() {
  const { id = '' } = useParams();
  const run = useCallback(() => library.books(id), [id]);
  const { data, error, loading, reload } = useAsync(run, [id]);

  return (
    <LibraryShell title={data?.subject.name ?? 'موضوع'} sub="کتاب‌های مرجع این موضوع">
      {loading && <LoadingBlock />}
      {!loading && error != null && <ErrorBlock error={error} onRetry={reload} />}
      {!loading && !error && data && data.books.length === 0 && (
        <DsCard>
          <DsEmpty
            icon={<Icon name="i-layers" size={28} />}
            title="کتابی ثبت نشده"
            body="برای این موضوع هنوز کتابی منتشر نشده است."
          />
        </DsCard>
      )}
      {!loading && !error && data && data.books.length > 0 && (
        <DsCard flush>
          <div className="ds-list">
            {data.books.map((b: BookItem) => (
              <ListRow
                key={b.id}
                icon="i-book"
                title={b.name}
                sub={[
                  b.fa_count ? `${faNum(b.fa_count)} جلد فارسی` : '',
                  b.en_count ? `${faNum(b.en_count)} جلد انگلیسی` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
                to={`/library/book/${b.id}`}
                chevron
              />
            ))}
          </div>
        </DsCard>
      )}
    </LibraryShell>
  );
}

/* ─────────────── ۵) فایل‌های یک کتاب مرجع ─────────────── */
function RefRow({ f }: { f: ReferenceFile }) {
  return (
    <ListRow
      icon="i-doc"
      title={f.description || `جلد ${faNum(f.volume)}`}
      sub={[f.lang === 'fa' ? 'فارسی' : 'انگلیسی', `جلد ${faNum(f.volume)}`, humanSize(f.size)]
        .filter(Boolean)
        .join(' · ')}
      to={readerPath('ref', f.id)}
      chevron
    />
  );
}

export function BookScreen() {
  const { id = '' } = useParams();
  const run = useCallback(() => library.bookFiles(id), [id]);
  const { data, error, loading, reload } = useAsync(run, [id]);

  return (
    <LibraryShell title={data?.book.name ?? 'کتاب'} sub="جلدهای فارسی و انگلیسی">
      {loading && <LoadingBlock />}
      {!loading && error != null && <ErrorBlock error={error} onRetry={reload} />}
      {!loading && !error && data && data.fa_files.length + data.en_files.length === 0 && (
        <DsCard>
          <DsEmpty
            icon={<Icon name="i-doc" size={28} />}
            title="فایلی برای این کتاب ثبت نشده"
            body="جلدهای این کتاب هنوز بارگذاری نشده‌اند."
          />
        </DsCard>
      )}

      {!loading && !error && data && data.fa_files.length > 0 && (
        <section className="core-stack" aria-label="جلدهای فارسی">
          <div className="core-sec-head">
            <div className="core-sec-head__lead">
              <Icon name="i-doc" size={16} className="core-sec-head__icon" />
              <h2 className="core-sec-head__title">جلدهای فارسی</h2>
            </div>
            <DsBadge tone="accent">{faNum(data.fa_files.length)} جلد</DsBadge>
          </div>
          <DsCard flush>
            <div className="ds-list">
              {data.fa_files.map((f) => (
                <RefRow key={f.id} f={f} />
              ))}
            </div>
          </DsCard>
        </section>
      )}

      {!loading && !error && data && data.en_files.length > 0 && (
        <section className="core-stack" aria-label="جلدهای انگلیسی">
          <div className="core-sec-head">
            <div className="core-sec-head__lead">
              <Icon name="i-doc" size={16} className="core-sec-head__icon" />
              <h2 className="core-sec-head__title">جلدهای انگلیسی</h2>
            </div>
            <DsBadge tone="accent">{faNum(data.en_files.length)} جلد</DsBadge>
          </div>
          <DsCard flush>
            <div className="ds-list">
              {data.en_files.map((f) => (
                <RefRow key={f.id} f={f} />
              ))}
            </div>
          </DsCard>
        </section>
      )}

      {!loading && !error && (
        <DsCard level="sunken" className="lib-note-card">
          جلدها داخل همین برنامه باز می‌شوند و آخرین صفحهٔ مطالعهٔ شما ذخیره می‌ماند.
        </DsCard>
      )}
    </LibraryShell>
  );
}
