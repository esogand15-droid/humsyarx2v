import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import './exam.css';
import { AppBar } from '../../components';
import { ErrorBlock, LoadingBlock } from '../../components/AccessStates';
import {
  DsBadge,
  DsButton,
  DsCard,
  DsChip,
  DsEmpty,
  DsSegmented,
} from '../../design/components';
import { Icon } from '../../icons';
import type { IconName } from '../../icons/sprite';
import {
  accuracyTone,
  diffTone,
  exam,
  plainLabel,
  type CatalogLessonItem,
  type CatalogPayload,
  type ExamPeriodItem,
  type PracticeMode,
  type StatsPayload,
  type TopicItem,
  type TopicStat,
} from '../../lib/exam';
import { faNum, faPercent, formatTerm } from '../../lib/fa';
import { peek, put } from '../../lib/swr';

type CatalogTab = 'subjects' | 'periods' | 'smart';

const GROUP_ICONS: Record<string, IconName> = {
  basic_structural: 'i-stethoscope',
  microbiology_immuno: 'i-flask',
  health_general: 'i-book-open',
  clinical_extended: 'i-pill',
  classroom: 'i-layers',
};

function formatTopicLabel(t: Pick<TopicStat, 'lesson' | 'topic'>): string {
  if (t.lesson && t.topic && t.lesson !== t.topic) {
    return `${t.lesson} (${t.topic})`;
  }
  return t.topic || t.lesson;
}

function buildSearchParams(opts: {
  lesson?: string;
  lessonId?: string;
  topic?: string;
  topicId?: string;
  mode?: PracticeMode;
  difficulty?: string;
  examYearFrom?: string | null;
  examYearTo?: string | null;
  examSession?: string | null;
  source?: string;
}): string {
  const sp = new URLSearchParams();
  if (opts.lesson) sp.set('lesson', opts.lesson);
  if (opts.lessonId) sp.set('lessonId', opts.lessonId);
  if (opts.topic) sp.set('topic', opts.topic);
  if (opts.topicId) sp.set('topicId', opts.topicId);
  if (opts.mode && opts.mode !== 'free') sp.set('mode', opts.mode);
  if (opts.difficulty) sp.set('difficulty', opts.difficulty);
  if (opts.examYearFrom) sp.set('examYearFrom', opts.examYearFrom);
  if (opts.examYearTo) sp.set('examYearTo', opts.examYearTo);
  if (opts.examSession) sp.set('examSession', opts.examSession);
  if (opts.source) sp.set('source', opts.source);
  return sp.toString();
}

/** خانهٔ بانک سؤال طبقه‌بندی‌شده: دروس بر پایهٔ شاخهٔ علمی، آرشیو ادوار و مرور هوشمند. */
export function ExamHome() {
  const navigate = useNavigate();
  const [cached] = useState(() =>
    peek<{ catalog: CatalogPayload; stats: StatsPayload | null }>('exam-catalog-v2'),
  );
  const [catalog, setCatalog] = useState<CatalogPayload | null>(cached?.catalog ?? null);
  const [stats, setStats] = useState<StatsPayload | null>(cached?.stats ?? null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(cached ? 'ready' : 'loading');
  const [error, setError] = useState<unknown>(null);

  const [tab, setTab] = useState<CatalogTab>('subjects');
  const [search, setSearch] = useState('');
  const [selectedSource, setSelectedSource] = useState('');
  const [selectedDiff, setSelectedDiff] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [showEmpty, setShowEmpty] = useState(false);

  const [picked, setPicked] = useState<CatalogLessonItem | null>(null);
  const [topics, setTopics] = useState<TopicItem[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [pickedPeriod, setPickedPeriod] = useState<string | null>(null);

  const load = useCallback(async (sourceVal: string, diffVal: string) => {
    const isUnfiltered = !sourceVal && !diffVal;
    if (!isUnfiltered || !peek('exam-catalog-v2')) {
      setState((prev) => (prev === 'ready' && catalog ? 'ready' : 'loading'));
    }
    setError(null);
    try {
      const [cat, st] = await Promise.all([
        exam.catalog({
          content_source: sourceVal ? [sourceVal] : undefined,
          difficulty: diffVal || undefined,
        }),
        exam.stats().catch(() => null),
      ]);
      if (isUnfiltered) {
        put('exam-catalog-v2', { catalog: cat, stats: st });
      }
      setCatalog(cat);
      setStats(st);
      setState('ready');
    } catch (err) {
      setError(err);
      setState('error');
    }
  }, [catalog]);

  useEffect(() => {
    void load(selectedSource, selectedDiff);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSource, selectedDiff]);

  const fetchTopics = useCallback(
    async (lesson: CatalogLessonItem, sourceVal: string, diffVal: string) => {
      setTopics([]);
      setTopicsLoading(true);
      try {
        const res = await exam.topics(lesson.id, {
          content_source: sourceVal ? [sourceVal] : undefined,
          difficulty: diffVal || undefined,
        });
        setTopics(res.topics ?? []);
      } catch {
        setTopics([]);
      } finally {
        setTopicsLoading(false);
      }
    },
    [],
  );

  const pick = async (lesson: CatalogLessonItem) => {
    if (picked?.id === lesson.id) {
      setPicked(null);
      setTopics([]);
      return;
    }
    setPicked(lesson);
    await fetchTopics(lesson, selectedSource, selectedDiff);
  };

  useEffect(() => {
    if (picked) {
      void fetchTopics(picked, selectedSource, selectedDiff);
    }
  }, [picked, selectedSource, selectedDiff, fetchTopics]);

  const goPractice = (opts: Parameters<typeof buildSearchParams>[0]) => {
    const qs = buildSearchParams({
      ...opts,
      source: opts.source ?? (selectedSource || undefined),
      difficulty: opts.difficulty ?? (selectedDiff || undefined),
    });
    navigate(qs ? `/exam/practice?${qs}` : '/exam/practice');
  };

  const goSetup = (opts: Parameters<typeof buildSearchParams>[0]) => {
    const qs = buildSearchParams({
      ...opts,
      source: opts.source ?? (selectedSource || undefined),
      difficulty: opts.difficulty ?? (selectedDiff || undefined),
    });
    navigate(qs ? `/exam/setup?${qs}` : '/exam/setup');
  };

  const queryNorm = search.trim().toLowerCase();

  const filteredGroups = useMemo(() => {
    const groups = catalog?.groups ?? [];
    if (!queryNorm) return groups;
    return groups
      .map((g) => ({
        ...g,
        lessons: g.lessons.filter(
          (l) =>
            l.name.toLowerCase().includes(queryNorm) ||
            (l.term && l.term.toLowerCase().includes(queryNorm)),
        ),
      }))
      .filter((g) => g.lessons.length > 0);
  }, [catalog?.groups, queryNorm]);

  const filteredPeriods = useMemo(() => {
    const periods = catalog?.periods ?? [];
    if (!queryNorm) return periods;
    return periods.filter(
      (p) =>
        p.label.toLowerCase().includes(queryNorm) ||
        p.lessons.some((l) => l.lesson.toLowerCase().includes(queryNorm)),
    );
  }, [catalog?.periods, queryNorm]);

  const scientificTopics = useMemo(
    () => topics.filter((t) => t.kind !== 'exam_period'),
    [topics],
  );
  const periodTopics = useMemo(
    () => topics.filter((t) => t.kind === 'exam_period'),
    [topics],
  );

  const accuracy = Math.round(stats?.accuracy ?? 0);
  const tone = accuracyTone(accuracy);
  const weakTopics = stats?.weak_topics ?? [];
  const sources = catalog?.filters?.sources ?? [];
  const difficulties = catalog?.filters?.difficulties ?? [];
  const emptyLessons = catalog?.empty_lessons ?? [];
  const smart = catalog?.smart_queues ?? { flagged_count: 0, wrong_count: 0, hard_count: 0 };

  return (
    <>
      <AppBar title="تمرین" sub="بانک سؤال" />
      <div className="page page-enter exam-page">
        {state === 'loading' && <LoadingBlock rows={4} />}
        {state === 'error' && (
          <ErrorBlock error={error} onRetry={() => void load(selectedSource, selectedDiff)} />
        )}

        {state === 'ready' && catalog && (
          <div className="exam-home-grid">
            <aside className="exam-home-side">
              {stats && stats.attempts > 0 ? (
                <DsCard className="exam-stack">
                  <div className="exam-stat-head">
                    <div className="exam-stat-big">
                      <span className="exam-stat-big__num">{faPercent(accuracy)}</span>
                      <span className="exam-stat-big__sub">
                        درست از {faNum(stats.attempts)} پاسخ
                      </span>
                    </div>
                    <DsBadge
                      tone={tone === 'good' ? 'success' : tone === 'mid' ? 'warning' : 'danger'}
                    >
                      {faNum(stats.solved_unique)} سؤال یکتا
                    </DsBadge>
                  </div>

                  <div
                    className="exam-progress"
                    role="progressbar"
                    aria-valuenow={accuracy}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="درصد پاسخ‌های درست"
                  >
                    <svg
                      className="exam-progress__svg"
                      viewBox="0 0 100 8"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      <rect
                        className={`exam-progress__fill exam-progress__fill--${tone}`}
                        x={100 - Math.min(100, Math.max(0, accuracy))}
                        y={0}
                        width={Math.min(100, Math.max(0, accuracy))}
                        height={8}
                        rx={0}
                      />
                    </svg>
                  </div>

                  <div className="exam-stat-meta">
                    <span className="exam-stat-meta__good">درست: {faNum(stats.correct)}</span>
                    <span className="exam-stat-meta__bad">غلط: {faNum(stats.wrong)}</span>
                  </div>

                  {weakTopics.length > 0 && (
                    <div className="exam-stack">
                      <p className="exam-weak-note">
                        نقطهٔ نیاز به مرور:{' '}
                        {weakTopics.slice(0, 2).map(formatTopicLabel).join(' · ')}
                      </p>
                      <DsButton
                        variant="secondary"
                        size="sm"
                        onClick={() => goPractice({ mode: 'weak' })}
                      >
                        <Icon name="i-target" size={16} />
                        <span>تمرین نقطهٔ ضعف</span>
                      </DsButton>
                    </div>
                  )}
                </DsCard>
              ) : (
                <DsCard level="accent" className="exam-stack">
                  <h2 className="ds-card__title">شروع ارزیابی</h2>
                  <p className="ds-card__sub">
                    هنوز سؤالی پاسخ نداده‌اید. با اولین تمرین، آمار دقت و نقاط ضعف شما همین‌جا ثبت
                    می‌شود.
                  </p>
                </DsCard>
              )}

              <DsCard className="exam-stack">
                <DsButton
                  variant="primary"
                  size="lg"
                  block
                  onClick={() =>
                    goPractice(
                      picked ? { lesson: picked.name, lessonId: picked.id } : {},
                    )
                  }
                >
                  <Icon name="i-play" size={18} />
                  <span>{picked ? `تمرین ${picked.name}` : 'شروع تمرین آزاد'}</span>
                </DsButton>
                <DsButton
                  variant="secondary"
                  size="md"
                  block
                  onClick={() =>
                    goSetup(picked ? { lesson: picked.name, lessonId: picked.id } : {})
                  }
                >
                  <Icon name="i-clock" size={18} />
                  <span>ساخت آزمون زمان‌دار</span>
                </DsButton>
                {!picked && (
                  <p className="ds-card__sub">
                    تمرین آزاد از همهٔ درس‌های فعال سؤال می‌آورد؛ از فهرست روبه‌رو درس یا دوره
                    را انتخاب کنید.
                  </p>
                )}
              </DsCard>

              <div className="exam-quick-links">
                <DsButton
                  variant="ghost"
                  size="md"
                  className="exam-btn-tall"
                  onClick={() => navigate('/exam/history')}
                >
                  <Icon name="i-clock" size={16} />
                  <span>تاریخچهٔ پاسخ‌ها</span>
                </DsButton>
                <DsButton
                  variant="ghost"
                  size="md"
                  className="exam-btn-tall"
                  onClick={() => navigate('/exam/mock/history')}
                >
                  <Icon name="i-file-text" size={16} />
                  <span>آزمون‌های قبلی</span>
                </DsButton>
              </div>
            </aside>

            <section className="exam-home-main" aria-label="فهرست طبقه‌بندی‌شدهٔ بانک سؤال">
              <div className="exam-sec-head">
                <div className="exam-sec-head__lead">
                  <Icon name="i-grid" size={18} />
                  <h2 className="exam-sec-head__title">فهرست بانک سؤال</h2>
                </div>
                <DsBadge tone="accent">
                  {faNum(catalog.active_lessons_count)} درس · {faNum(catalog.total_questions)} سؤال
                </DsBadge>
              </div>

              <DsSegmented
                block
                label="روش دسته‌بندی بانک سؤال"
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'subjects', label: 'بر اساس درس' },
                  { value: 'periods', label: 'دوره و سال' },
                  { value: 'smart', label: 'مرور هوشمند' },
                ]}
              />

              {tab !== 'smart' && (
                <div className="exam-toolbar">
                  <div className="ds-search" role="search">
                    <Icon name="i-search" size={18} className="ds-search__icon" />
                    <input
                      type="search"
                      className="ds-input"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={
                        tab === 'subjects'
                          ? 'جستجوی درس یا ترم...'
                          : 'جستجوی دوره، سال یا درس...'
                      }
                      aria-label="جستجو در بانک سؤال"
                    />
                    {search && (
                      <button
                        type="button"
                        className="ds-search__clear"
                        aria-label="پاک کردن جستجو"
                        onClick={() => setSearch('')}
                      >
                        <Icon name="i-x" size={16} />
                      </button>
                    )}
                  </div>

                  {tab === 'subjects' && sources.length > 0 && (
                    <div className="exam-filter-strip" aria-label="فیلتر منبع بانک">
                      <span className="exam-filter-label">منبع:</span>
                      <DsChip
                        selected={selectedSource === ''}
                        onClick={() => setSelectedSource('')}
                      >
                        همه منابع
                      </DsChip>
                      {sources.map((src) => (
                        <DsChip
                          key={src.code}
                          selected={selectedSource === src.code}
                          onClick={() =>
                            setSelectedSource((cur) => (cur === src.code ? '' : src.code))
                          }
                        >
                          <span>{src.label}</span>
                          <span className="exam-choice-chip__count">· {faNum(src.count)}</span>
                        </DsChip>
                      ))}
                    </div>
                  )}

                  {tab === 'subjects' && difficulties.length > 1 && (
                    <div className="exam-filter-strip" aria-label="فیلتر سطح سختی">
                      <span className="exam-filter-label">سطح:</span>
                      <DsChip selected={selectedDiff === ''} onClick={() => setSelectedDiff('')}>
                        همه سطوح
                      </DsChip>
                      {difficulties.map((d) => (
                        <DsChip
                          key={d.code}
                          selected={selectedDiff === d.code}
                          onClick={() => setSelectedDiff((cur) => (cur === d.code ? '' : d.code))}
                        >
                          {diffTone(d.code) && (
                            <span className={`exam-diff-dot exam-diff-dot--${diffTone(d.code)}`} aria-hidden="true" />
                          )}
                          <span>{plainLabel(d.label)}</span>
                          <span className="exam-choice-chip__count">· {faNum(d.count)}</span>
                        </DsChip>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {tab === 'subjects' && (
                <>
                  {catalog.active_lessons_count === 0 ? (
                    <DsCard>
                      <DsEmpty
                        icon={<Icon name="i-book" size={28} />}
                        title={
                          selectedSource || selectedDiff
                            ? 'سؤالی با این فیلتر پیدا نشد'
                            : 'سؤالی برای ورودی شما ثبت نشده'
                        }
                        body={
                          selectedSource || selectedDiff
                            ? 'فیلتر منبع یا سطح سختی را تغییر دهید تا همهٔ درس‌ها نمایش داده شوند.'
                            : 'بانک سؤال بر پایهٔ ورودی تحصیلی و اشتراک فعال ارائه می‌شود.'
                        }
                        action={
                          selectedSource || selectedDiff ? (
                            <DsButton
                              variant="secondary"
                              onClick={() => {
                                setSelectedSource('');
                                setSelectedDiff('');
                              }}
                            >
                              حذف فیلترها
                            </DsButton>
                          ) : (
                            <DsButton variant="secondary" onClick={() => navigate('/library')}>
                              مشاهدهٔ کتابخانه
                            </DsButton>
                          )
                        }
                      />
                    </DsCard>
                  ) : filteredGroups.length === 0 ? (
                    <DsCard>
                      <DsEmpty
                        icon={<Icon name="i-search" size={28} />}
                        title="درسی با این عبارت پیدا نشد"
                        body="عبارت جستجو را کوتاه‌تر کنید یا فیلترها را پاک کنید."
                        action={
                          <DsButton variant="secondary" onClick={() => setSearch('')}>
                            پاک کردن جستجو
                          </DsButton>
                        }
                      />
                    </DsCard>
                  ) : (
                    <div className="exam-groups">
                      {filteredGroups.map((group) => {
                        const isGroupClosed = !queryNorm && Boolean(collapsedGroups[group.key]);
                        const gIcon = GROUP_ICONS[group.key] ?? 'i-grid';
                        return (
                          <div key={group.key} className="exam-group">
                            <button
                              type="button"
                              className="exam-group-head"
                              aria-expanded={!isGroupClosed}
                              onClick={() =>
                                setCollapsedGroups((prev) => ({
                                  ...prev,
                                  [group.key]: !prev[group.key],
                                }))
                              }
                            >
                              <span className="exam-group-head__lead">
                                <Icon name={gIcon} size={18} className="exam-group-head__icon" />
                                <span className="exam-group-head__title">{group.title}</span>
                              </span>
                              <span className="exam-group-head__meta">
                                <DsBadge tone="neutral">
                                  {faNum(group.lessons.length)} درس · {faNum(group.question_count)}{' '}
                                  سؤال
                                </DsBadge>
                                <Icon
                                  name="i-chevron"
                                  size={16}
                                  className={`exam-lesson-chev${!isGroupClosed ? ' is-open' : ''}`}
                                />
                              </span>
                            </button>

                            {!isGroupClosed && (
                              <div className="exam-lesson-list">
                                {group.lessons.map((l) => {
                                  const isOpen = picked?.id === l.id;
                                  const termText = l.term ? formatTerm(l.term) : '';
                                  const pct =
                                    l.count > 0
                                      ? Math.min(100, Math.round((l.solved_count / l.count) * 100))
                                      : 0;
                                  const subParts = [`${faNum(l.count)} سؤال`];
                                  if (l.solved_count > 0) {
                                    subParts.push(`${faNum(l.solved_count)} حل‌شده`);
                                  }
                                  if (l.accuracy !== null && l.accuracy !== undefined) {
                                    subParts.push(`دقت ${faPercent(Math.round(l.accuracy))}`);
                                  }
                                  if (termText) subParts.push(termText);

                                  return (
                                    <DsCard
                                      key={l.id}
                                      level={isOpen ? 'accent' : 'default'}
                                      className="exam-lesson-card"
                                    >
                                      <button
                                        type="button"
                                        className="exam-lesson-trigger"
                                        aria-expanded={isOpen}
                                        onClick={() => void pick(l)}
                                      >
                                        <span className="exam-lesson-icon" aria-hidden="true">
                                          <Icon name={gIcon} size={20} />
                                        </span>
                                        <span className="exam-lesson-body">
                                          <span className="exam-lesson-top">
                                            <span className="exam-lesson-title">{l.name}</span>
                                          </span>
                                          <span className="exam-lesson-sub">
                                            {subParts.join(' · ')}
                                          </span>
                                          {l.solved_count > 0 && (
                                            <div className="exam-lesson-progress" aria-hidden="true">
                                              <svg
                                                className="exam-lesson-progress__svg"
                                                viewBox="0 0 100 4"
                                                preserveAspectRatio="none"
                                              >
                                                <rect
                                                  className="exam-lesson-progress__fill"
                                                  x={100 - pct}
                                                  y={0}
                                                  width={pct}
                                                  height={4}
                                                  rx={0}
                                                />
                                              </svg>
                                            </div>
                                          )}
                                        </span>
                                        <Icon
                                          name="i-chevron"
                                          size={18}
                                          className={`exam-lesson-chev${isOpen ? ' is-open' : ''}`}
                                        />
                                      </button>

                                      {isOpen && (
                                        <div className="exam-lesson-drawer">
                                          <div className="exam-drawer-actions">
                                            <DsButton
                                              variant="primary"
                                              size="md"
                                              onClick={() =>
                                                goPractice({ lesson: l.name, lessonId: l.id })
                                              }
                                            >
                                              <Icon name="i-play" size={16} />
                                              <span>تمرین جامع {l.name}</span>
                                            </DsButton>
                                            <DsButton
                                              variant="secondary"
                                              size="md"
                                              onClick={() =>
                                                goSetup({ lesson: l.name, lessonId: l.id })
                                              }
                                            >
                                              <Icon name="i-clock" size={16} />
                                              <span>آزمون زمان‌دار</span>
                                            </DsButton>
                                          </div>

                                          {topicsLoading && (
                                            <p className="ds-card__sub">در حال دریافت مباحث…</p>
                                          )}

                                          {!topicsLoading && scientificTopics.length > 0 && (
                                            <div className="exam-drawer-sec">
                                              <span className="exam-drawer-label">
                                                مباحث علمی درس
                                              </span>
                                              <div className="exam-topics-wrap">
                                                {scientificTopics.map((t) => (
                                                  <DsChip
                                                    key={t.id || t.name}
                                                    className="exam-choice-chip"
                                                    onClick={() =>
                                                      goPractice({
                                                        lesson: l.name,
                                                        lessonId: l.id,
                                                        topic: t.name,
                                                        topicId: t.id || undefined,
                                                      })
                                                    }
                                                  >
                                                    <span>{t.name}</span>
                                                    <span className="exam-choice-chip__count">
                                                      · {faNum(t.count)}
                                                      {t.accuracy != null
                                                        ? ` · ${faPercent(Math.round(t.accuracy))}`
                                                        : ''}
                                                    </span>
                                                  </DsChip>
                                                ))}
                                              </div>
                                            </div>
                                          )}

                                          {!topicsLoading && periodTopics.length > 0 && (
                                            <div className="exam-drawer-sec">
                                              <span className="exam-drawer-label">
                                                آزمون‌های ادوار این درس
                                              </span>
                                              <div className="exam-topics-wrap">
                                                {periodTopics.map((t) => (
                                                  <DsChip
                                                    key={t.id || t.name}
                                                    className="exam-choice-chip"
                                                    onClick={() =>
                                                      goPractice({
                                                        lesson: l.name,
                                                        lessonId: l.id,
                                                        topic: t.name,
                                                        topicId: t.id || undefined,
                                                      })
                                                    }
                                                  >
                                                    <span>{t.name}</span>
                                                    <span className="exam-choice-chip__count">
                                                      · {faNum(t.count)}
                                                    </span>
                                                  </DsChip>
                                                ))}
                                              </div>
                                            </div>
                                          )}

                                          {!topicsLoading &&
                                            scientificTopics.length === 0 &&
                                            periodTopics.length === 0 && (
                                              <p className="ds-card__sub">
                                                همهٔ سؤالات این درس در تمرین جامع در دسترس است.
                                              </p>
                                            )}
                                        </div>
                                      )}
                                    </DsCard>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {emptyLessons.length > 0 && !queryNorm && (
                    <div className="exam-empty-toggle">
                      <div>
                        <DsButton
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowEmpty((v) => !v)}
                        >
                          <Icon name="i-layers" size={16} />
                          <span>
                            {showEmpty
                              ? 'پنهان کردن درس‌های بدون سؤال'
                              : `نمایش ${faNum(emptyLessons.length)} درس بدون سؤال`}
                          </span>
                        </DsButton>
                      </div>
                      {showEmpty && (
                        <DsCard level="sunken" className="exam-empty-grid">
                          {emptyLessons.map((el) => (
                            <DsBadge key={el.id} tone="neutral">
                              {el.name}
                              {el.term ? ` (${formatTerm(el.term)})` : ''}
                            </DsBadge>
                          ))}
                        </DsCard>
                      )}
                    </div>
                  )}
                </>
              )}

              {tab === 'periods' && (
                <>
                  {filteredPeriods.length === 0 ? (
                    <DsCard>
                      <DsEmpty
                        icon={<Icon name="i-calendar" size={28} />}
                        title="دورهٔ آزمونی ثبت نشده"
                        body="هنوز سؤالی با برچسب سال و نوبت آزمون در این محدوده ثبت نشده است. از تب «بر اساس درس» تمرین کنید."
                        action={
                          <DsButton variant="secondary" onClick={() => setTab('subjects')}>
                            نمایش بر اساس درس
                          </DsButton>
                        }
                      />
                    </DsCard>
                  ) : (
                    <div className="exam-lesson-list">
                      {filteredPeriods.map((period: ExamPeriodItem) => {
                        const isOpen = pickedPeriod === period.key;
                        return (
                          <DsCard key={period.key} className="exam-period-card">
                            <div className="exam-period-head">
                              <div className="exam-sec-head__lead">
                                <Icon name="i-calendar" size={18} />
                                <h3 className="exam-period-title">{period.label}</h3>
                              </div>
                              <DsBadge tone="accent">{faNum(period.count)} سؤال</DsBadge>
                            </div>

                            <div className="exam-drawer-actions">
                              <DsButton
                                variant="primary"
                                size="md"
                                onClick={() =>
                                  goPractice({
                                    examYearFrom: period.exam_year,
                                    examYearTo: period.exam_year,
                                    examSession: period.exam_session,
                                  })
                                }
                              >
                                <Icon name="i-play" size={16} />
                                <span>تمرین جامع دوره</span>
                              </DsButton>
                              <DsButton
                                variant="secondary"
                                size="md"
                                onClick={() =>
                                  goSetup({
                                    examYearFrom: period.exam_year,
                                    examYearTo: period.exam_year,
                                    examSession: period.exam_session,
                                  })
                                }
                              >
                                <Icon name="i-clock" size={16} />
                                <span>آزمون زمان‌دار</span>
                              </DsButton>
                              {period.lessons.length > 0 && (
                                <DsButton
                                  variant="ghost"
                                  size="md"
                                  onClick={() =>
                                    setPickedPeriod((cur) =>
                                      cur === period.key ? null : period.key,
                                    )
                                  }
                                >
                                  <span>
                                    {isOpen
                                      ? 'بستن درس‌ها'
                                      : `تفکیک ${faNum(period.lessons.length)} درس`}
                                  </span>
                                </DsButton>
                              )}
                            </div>

                            {isOpen && (
                              <div className="exam-topics-wrap">
                                {period.lessons.map((pl) => (
                                  <DsChip
                                    key={pl.lesson_id || pl.lesson}
                                    className="exam-choice-chip"
                                    onClick={() =>
                                      goPractice({
                                        lesson: pl.lesson,
                                        lessonId: pl.lesson_id || undefined,
                                        examYearFrom: period.exam_year,
                                        examYearTo: period.exam_year,
                                        examSession: period.exam_session,
                                      })
                                    }
                                  >
                                    <span>{pl.lesson}</span>
                                    <span className="exam-choice-chip__count">
                                      · {faNum(pl.count)}
                                    </span>
                                  </DsChip>
                                ))}
                              </div>
                            )}
                          </DsCard>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {tab === 'smart' && (
                <div className="exam-smart-grid">
                  <DsCard className="exam-smart-card">
                    <div className="exam-smart-head">
                      <div className="exam-smart-lead">
                        <span className="exam-smart-icon" aria-hidden="true">
                          <Icon name="i-bookmark" size={20} />
                        </span>
                        <div>
                          <h3 className="exam-smart-title">سؤالات نشان‌شده</h3>
                          <p className="exam-smart-desc">مرور تست‌هایی که نشان کرده‌اید</p>
                        </div>
                      </div>
                      <DsBadge tone={smart.flagged_count > 0 ? 'accent' : 'neutral'}>
                        {faNum(smart.flagged_count)} سؤال
                      </DsBadge>
                    </div>
                    <DsButton
                      variant={smart.flagged_count > 0 ? 'primary' : 'ghost'}
                      size="md"
                      disabled={smart.flagged_count === 0}
                      onClick={() => goPractice({ mode: 'flagged' })}
                    >
                      <Icon name="i-play" size={16} />
                      <span>
                        {smart.flagged_count > 0 ? 'مرور نشان‌شده‌ها' : 'سؤال نشان‌شده‌ای نیست'}
                      </span>
                    </DsButton>
                  </DsCard>

                  <DsCard className="exam-smart-card">
                    <div className="exam-smart-head">
                      <div className="exam-smart-lead">
                        <span className="exam-smart-icon" aria-hidden="true">
                          <Icon name="i-alert-circle" size={20} />
                        </span>
                        <div>
                          <h3 className="exam-smart-title">اشتباهات من</h3>
                          <p className="exam-smart-desc">تکرار سؤال‌هایی که غلط زده‌اید</p>
                        </div>
                      </div>
                      <DsBadge tone={smart.wrong_count > 0 ? 'danger' : 'neutral'}>
                        {faNum(smart.wrong_count)} سؤال
                      </DsBadge>
                    </div>
                    <DsButton
                      variant={smart.wrong_count > 0 ? 'primary' : 'ghost'}
                      size="md"
                      disabled={smart.wrong_count === 0}
                      onClick={() => goPractice({ mode: 'wrong' })}
                    >
                      <Icon name="i-play" size={16} />
                      <span>
                        {smart.wrong_count > 0 ? 'شروع رفع اشکال' : 'اشتباه ثبت‌شده‌ای نیست'}
                      </span>
                    </DsButton>
                  </DsCard>

                  <DsCard className="exam-smart-card">
                    <div className="exam-smart-head">
                      <div className="exam-smart-lead">
                        <span className="exam-smart-icon" aria-hidden="true">
                          <Icon name="i-flame" size={20} />
                        </span>
                        <div>
                          <h3 className="exam-smart-title">سؤالات سخت</h3>
                          <p className="exam-smart-desc">تست‌های سطح سخت برای جمع‌بندی پیشرفته</p>
                        </div>
                      </div>
                      <DsBadge tone={smart.hard_count > 0 ? 'warning' : 'neutral'}>
                        {faNum(smart.hard_count)} سؤال
                      </DsBadge>
                    </div>
                    <DsButton
                      variant={smart.hard_count > 0 ? 'secondary' : 'ghost'}
                      size="md"
                      disabled={smart.hard_count === 0}
                      onClick={() => goPractice({ mode: 'hard' })}
                    >
                      <Icon name="i-play" size={16} />
                      <span>
                        {smart.hard_count > 0 ? 'شروع سؤالات سخت' : 'سؤال سختی ثبت نشده'}
                      </span>
                    </DsButton>
                  </DsCard>

                  <DsCard className="exam-smart-card exam-smart-card--wide">
                    <div className="exam-smart-head">
                      <div className="exam-smart-lead">
                        <span className="exam-smart-icon" aria-hidden="true">
                          <Icon name="i-target" size={20} />
                        </span>
                        <div>
                          <h3 className="exam-smart-title">نقاط ضعف من</h3>
                          <p className="exam-smart-desc">
                            مبحث‌هایی که درصد پاسخ صحیح در آن‌ها نیاز به تقویت دارد
                          </p>
                        </div>
                      </div>
                      <DsBadge tone={weakTopics.length > 0 ? 'warning' : 'neutral'}>
                        {faNum(weakTopics.length)} مبحث
                      </DsBadge>
                    </div>

                    {weakTopics.length > 0 ? (
                      <>
                        <div className="exam-weak-list">
                          {weakTopics.slice(0, 5).map((wt) => (
                            <DsChip
                              key={`${wt.lesson_id}:${wt.topic_id || wt.topic}`}
                              className="exam-choice-chip"
                              onClick={() =>
                                goPractice({
                                  lesson: wt.lesson,
                                  lessonId: wt.lesson_id || undefined,
                                  topic: wt.topic || undefined,
                                  topicId: wt.topic_id || undefined,
                                })
                              }
                            >
                              <span>{formatTopicLabel(wt)}</span>
                              <span className="exam-choice-chip__count">
                                · {faPercent(Math.round(wt.accuracy))}
                              </span>
                            </DsChip>
                          ))}
                        </div>
                        <div>
                          <DsButton
                            variant="primary"
                            size="md"
                            onClick={() => goPractice({ mode: 'weak' })}
                          >
                            <Icon name="i-play" size={16} />
                            <span>تمرین ضعیف‌ترین مبحث</span>
                          </DsButton>
                        </div>
                      </>
                    ) : (
                      <p className="ds-card__sub">
                        با پاسخ به چند سؤال در هر مبحث، نقاط ضعف شما به‌صورت خودکار اینجا فهرست
                        می‌شوند.
                      </p>
                    )}
                  </DsCard>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </>
  );
}
