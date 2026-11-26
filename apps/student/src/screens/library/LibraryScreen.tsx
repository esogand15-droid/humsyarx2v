import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import '../core.css';
import { AppBar, ListRow, ProgressBar } from '../../components';
import { ErrorBlock, LoadingBlock, LockedBlock } from '../../components/AccessStates';
import { DsBadge, DsButton, DsCard, DsEmpty, DsSegmented } from '../../design/components';
import { Icon } from '../../icons';
import { faNum, faPercent } from '../../lib/fa';
import { intakeLabel } from '../../lib/intake';
import { library } from '../../lib/library';
import type { LibraryState, SubjectItem, TermItem } from '../../lib/library';
import { reader, readerPath } from '../../lib/reader';
import type { ContinueItem } from '../../lib/reader';

type Tab = 'lessons' | 'references';

function clockFa(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${faNum(m)}:${rem < 10 ? '۰' : ''}${faNum(rem)}`;
}

/** کتابخانه — ریشهٔ دو شاخه: «درس‌ها» (منابع علوم پایه) و «مرجع».
 *  رنگ بخش: Indigo (`resources`)، ورودی فرمت‌شده (`LB1`)، درصد فارسی (`H2`).
 */
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
  const intakeText = intakeLabel(state?.intake);

  return (
    <>
      <AppBar title="کتابخانه" sub={intakeText || 'جزوه‌ها و منابع آموزشی'} />

      <div className="page page-enter core-page">
        {recent.length > 0 && (
          <DsCard flush>
            <div className="ds-row">
              <span className="ds-row__icon" aria-hidden="true">
                <Icon name="i-bookmark" size={18} />
              </span>
              <span className="ds-row__body">
                <span className="ds-row__title">ادامهٔ مطالعه</span>
                <span className="ds-row__sub">آخرین فایل‌های بازشده</span>
              </span>
            </div>
            <div className="ds-list">
              {recent.map((r) => {
                const isMedia = r.kind === 'video' || r.kind === 'audio';
                const sub = isMedia
                  ? r.position > 0
                    ? `ادامه از ${clockFa(r.position)}`
                    : 'آمادهٔ پخش'
                  : r.total > 0
                    ? `صفحهٔ ${faNum(Math.max(1, r.page))} از ${faNum(r.total)} · ${faPercent(r.percent)}`
                    : 'در حال مطالعه';
                const href =
                  r.kind === 'pdf' && r.page > 0
                    ? `${readerPath(r.scope, r.id)}?p=${r.page}`
                    : readerPath(r.scope, r.id);

                return (
                  <div key={`${r.scope}:${r.id}`}>
                    <ListRow
                      icon={
                        r.kind === 'audio'
                          ? 'i-headphones'
                          : r.kind === 'video'
                            ? 'i-video'
                            : 'i-doc'
                      }
                      title={r.name}
                      sub={sub}
                      to={href}
                      chevron
                    />
                    {r.total > 0 && !isMedia && <ProgressBar value={r.percent} thin />}
                  </div>
                );
              })}
            </div>
          </DsCard>
        )}

        <DsSegmented
          block
          label="بخش کتابخانه"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'lessons', label: 'درس‌ها' },
            { value: 'references', label: 'مرجع' },
          ]}
        />

        {loading && <LoadingBlock rows={4} />}
        {!loading && error != null && <ErrorBlock error={error} onRetry={load} />}

        {!loading && !error && gate && !gate.allowed && (
          <LockedBlock
            title="این بخش باز نیست"
            text={gate.message}
            code={gate.code ?? undefined}
            action={
              gate.code === 'subscription_required' ? (
                <DsButton variant="primary" onClick={() => navigate('/subscription')}>
                  دیدن پلن‌های اشتراک
                </DsButton>
              ) : undefined
            }
          />
        )}

        {!loading && !error && gate?.allowed && rows && rows.length === 0 && (
          <DsCard>
            <DsEmpty
              icon={<Icon name="i-book" size={28} />}
              title="هنوز منبعی اضافه نشده"
              body="هر وقت مدرس یا ادمین جزوه و فایل اضافه کند، این فهرست کامل می‌شود."
            />
          </DsCard>
        )}

        {!loading && !error && gate?.allowed && rows && rows.length > 0 && (
          <div className="lib-grid">
            {tab === 'lessons'
              ? (rows as TermItem[]).map((t) => (
                  <Link
                    key={t.name}
                    to={`/library/term/${encodeURIComponent(t.name)}`}
                    className="home-mod-link"
                  >
                    <DsCard className="lib-term-card">
                      <div className="lib-term-card__top">
                        <div className="lib-term-card__lead">
                          <span className="lib-term-card__icon" aria-hidden="true">
                            <Icon name="i-calendar" size={20} />
                          </span>
                          <span className="lib-term-card__title">
                            <bdi dir="auto">{faNum(t.name)}</bdi>
                          </span>
                        </div>
                        <DsBadge tone="accent">{faNum(t.lesson_count)} درس</DsBadge>
                      </div>
                      <div className="lib-term-card__foot">
                        <span>مشاهدهٔ درس‌های ترم</span>
                        <Icon name="i-chevron-r" size={16} className="ds-row__chev" />
                      </div>
                    </DsCard>
                  </Link>
                ))
              : (rows as SubjectItem[]).map((s) => (
                  <Link
                    key={s.id}
                    to={`/library/subject/${s.id}`}
                    className="home-mod-link"
                  >
                    <DsCard className="lib-term-card">
                      <div className="lib-term-card__top">
                        <div className="lib-term-card__lead">
                          <span className="lib-term-card__icon" aria-hidden="true">
                            <Icon name="i-layers" size={20} />
                          </span>
                          <span className="lib-term-card__title">
                            <bdi dir="auto">{s.name}</bdi>
                          </span>
                        </div>
                        <DsBadge tone="accent">{faNum(s.book_count)} کتاب</DsBadge>
                      </div>
                      <div className="lib-term-card__foot">
                        <span>مشاهدهٔ کتاب‌های مرجع</span>
                        <Icon name="i-chevron-r" size={16} className="ds-row__chev" />
                      </div>
                    </DsCard>
                  </Link>
                ))}
          </div>
        )}

        {!loading && !error && (
          <p className="lib-foot-note">محتوا به‌صورت امن داخل هامزیار باز و همگام می‌شود.</p>
        )}
      </div>
    </>
  );
}
