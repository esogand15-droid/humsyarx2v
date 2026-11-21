import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AppBar, Card, Chip, EmptyState, ListRow } from '../../components';
import { Icon } from '../../icons';
import { ErrorBlock, LoadingBlock, LockedBlock } from '../../components/AccessStates';
import { library } from '../../lib/library';
import { reader, readerPath } from '../../lib/reader';
import type { ContinueItem } from '../../lib/reader';
import { ProgressBar } from '../../components';
import type { LibraryState, SubjectItem, TermItem } from '../../lib/library';
import { fa } from '../../lib/library';

type Tab = 'lessons' | 'references';

/** کتابخانه — ریشهٔ دو شاخه: «درس‌ها» (منابع علوم پایه) و «مرجع».
    دو شاخه گیت مستقل دارند، پس وضعیت هر تب جدا خوانده می‌شود. */
const clock = (sec: number) => {
  const m = Math.floor(Math.max(0, sec) / 60);
  const s = Math.floor(Math.max(0, sec) % 60);
  return `${fa(m)}:${s < 10 ? '۰' : ''}${fa(s)}`;
};

export function LibraryScreen() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('lessons');
  const [state, setState] = useState<LibraryState | null>(null);
  const [terms, setTerms] = useState<TermItem[] | null>(null);
  const [subjects, setSubjects] = useState<SubjectItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [recent, setRecent] = useState<ContinueItem[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const st = await library.state();
      setState(st);

      if (st.resources.allowed) {
        const t = await library.terms();
        setTerms(t.terms);
      } else {
        setTerms([]);
      }
      reader
        .recent()
        .then((r) => setRecent(r.items))
        .catch(() => setRecent([]));

      if (st.references.allowed) {
        const s = await library.subjects();
        setSubjects(s.subjects);
      } else {
        setSubjects([]);
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const gate = state ? (tab === 'lessons' ? state.resources : state.references) : null;
  const rows = tab === 'lessons' ? terms : subjects;

  return (
    <>
      <AppBar title="کتابخانه" sub={state?.intake ? `ورودی ${state.intake}` : 'جزوه‌ها و منابع'} />
      <div className="page page-enter">
        {recent.length > 0 && (
          <Card variant="flush" className="mt-16">
            <div className="row gap-8" style={{ padding: '12px 16px 6px', alignItems: 'center' }}>
              <Icon name="i-bookmark" size={16} />
              <span className="h3">ادامهٔ مطالعه</span>
            </div>
            {recent.map((r) => (
              <div key={`${r.scope}:${r.id}`} style={{ padding: '4px 16px 10px' }}>
                <ListRow
                  icon={r.kind === 'audio' ? 'i-headphones' : r.kind === 'video' ? 'i-video' : 'i-doc'}
                  title={r.name}
                  sub={
                    r.total > 0
                      ? `صفحهٔ ${fa(r.page)} از ${fa(r.total)} · ${fa(r.percent)}٪`
                      : r.kind === 'pdf'
                        ? 'در حال خواندن'
                        : `ادامه از ${clock(r.position)}`
                  }
                  to={readerPath(r.scope, r.id)}
                  chevron
                />
                {r.total > 0 && <div role="progressbar" aria-valuenow={r.percent} aria-valuemin={0} aria-valuemax={100} aria-label={`پیشرفت ${r.name}`}>
                  <ProgressBar value={r.percent} thin />
                </div>}
              </div>
            ))}
          </Card>
        )}

        <div className="seg mt-16" role="tablist" aria-label="بخش کتابخانه">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'lessons'}
            className={`seg__btn ${tab === 'lessons' ? 'is-on' : ''}`.trim()}
            onClick={() => setTab('lessons')}
          >
            درس‌ها
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'references'}
            className={`seg__btn ${tab === 'references' ? 'is-on' : ''}`.trim()}
            onClick={() => setTab('references')}
          >
            مرجع
          </button>
        </div>

        {loading && <LoadingBlock rows={4} />}

        {!loading && error != null && <ErrorBlock error={error} onRetry={() => void load()} />}

        {!loading && !error && gate && !gate.allowed && (
          <LockedBlock
            title={
              gate.code === 'policy_unavailable'
                ? 'سیستم دسترسی در دسترس نیست'
                : tab === 'lessons'
                  ? 'کتابخانهٔ درس‌ها برای مشترکین است'
                  : 'کتاب مرجع برای مشترکین است'
            }
            text={
              gate.code === 'policy_unavailable'
                ? 'چند لحظه بعد دوباره تلاش کن؛ این وضعیت موقتی است.'
                : 'با اشتراک فعال، همهٔ جزوه‌ها، ویدیوها و ویس‌های ترم خودت باز می‌شوند.'
            }
            code={gate.code ?? undefined}
          />
        )}

        {!loading && !error && gate?.allowed && rows && rows.length === 0 && (
          <EmptyState
            icon={tab === 'lessons' ? 'i-book' : 'i-layers'}
            title={tab === 'lessons' ? 'هنوز ترمی برای تو ثبت نشده' : 'هنوز موضوعی ثبت نشده'}
            text={
              tab === 'lessons'
                ? 'محتوا بر اساس ورودی تحصیلی دسته‌بندی می‌شود. اگر ورودی‌ات تازه ثبت شده، ممکن است محتوای آن هنوز منتشر نشده باشد.'
                : 'کتاب‌های مرجع هنوز برای ورودی تو منتشر نشده‌اند.'
            }
          />
        )}

        {!loading && !error && gate?.allowed && rows && rows.length > 0 && (
          <div
            className="mt-16"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: '16px',
            }}
          >
            {tab === 'lessons'
              ? (rows as TermItem[]).map((t) => (
                  <Card
                    key={t.name}
                    variant="interactive"
                    className="card--glass"
                    style={{
                      padding: '20px',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      minHeight: '110px',
                    }}
                    onClick={() => navigate(`/library/term/${encodeURIComponent(t.name)}`)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div
                          style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '10px',
                            background: 'rgba(37, 99, 235, 0.12)',
                            color: 'var(--brand)',
                            display: 'grid',
                            placeItems: 'center',
                          }}
                        >
                          <Icon name="i-calendar" size={20} />
                        </div>
                        <span className="h3">{t.name}</span>
                      </div>
                      <Chip variant="cyan">{`${fa(t.lesson_count)} درس`}</Chip>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginTop: '14px',
                        paddingTop: '10px',
                        borderTop: '1px solid var(--line)',
                      }}
                    >
                      <span className="tiny color-muted">ورود به دوره‌های ترم</span>
                      <Icon name="i-chevron-r" size={16} />
                    </div>
                  </Card>
                ))
              : (rows as SubjectItem[]).map((s) => (
                  <Card
                    key={s.id}
                    variant="interactive"
                    className="card--glass"
                    style={{
                      padding: '20px',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      minHeight: '110px',
                    }}
                    onClick={() => navigate(`/library/subject/${s.id}`)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div
                          style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '10px',
                            background: 'rgba(6, 182, 212, 0.12)',
                            color: 'var(--cyan)',
                            display: 'grid',
                            placeItems: 'center',
                          }}
                        >
                          <Icon name="i-layers" size={20} />
                        </div>
                        <span className="h3">{s.name}</span>
                      </div>
                      <Chip variant="quiet">{`${fa(s.book_count)} کتاب`}</Chip>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginTop: '14px',
                        paddingTop: '10px',
                        borderTop: '1px solid var(--line)',
                      }}
                    >
                      <span className="tiny color-muted">مشاهده منابع مرجع</span>
                      <Icon name="i-chevron-r" size={16} />
                    </div>
                  </Card>
                ))}
          </div>
        )}

        {!loading && !error && (
          <p className="tiny mt-16" style={{ textAlign: 'center' }}>
            <Chip variant="quiet" icon="i-lock">
              محتوا فقط داخل هامزیار خوانده می‌شود
            </Chip>
          </p>
        )}
      </div>
    </>
  );
}
