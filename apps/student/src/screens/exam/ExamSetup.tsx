import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import './exam.css';
import { AppBar } from '../../components';
import { ErrorBlock, LoadingBlock } from '../../components/AccessStates';
import { DsBadge, DsButton, DsCard, DsChip, DsEmpty } from '../../design/components';
import { Icon } from '../../icons';
import { ApiError } from '../../lib/api';
import {
  diffTone,
  exam,
  mockExam,
  plainLabel,
  type CatalogGroup,
  type CatalogLessonItem,
  type CatalogPayload,
  type MockPreview,
  type MockSummary,
  type TopicItem,
} from '../../lib/exam';
import { faDate, faDigits, faNum, faPercent } from '../../lib/fa';

const COUNTS = [10, 20, 30, 50];
const MINUTES = [10, 20, 30, 45, 0];

const STATUS_LABEL: Record<string, string> = {
  active: 'در جریان',
  finished: 'تمام‌شده',
  expired: 'زمان تمام',
  abandoned: 'رهاشده',
};

function statusBadgeTone(status: string): 'accent' | 'success' | 'warning' | 'danger' {
  if (status === 'finished') return 'success';
  if (status === 'expired') return 'warning';
  if (status === 'abandoned') return 'danger';
  return 'accent';
}

/** ساخت آزمون زمان‌دار با دسته‌بندی منظم دروس و فیلترهای منبع، سال و سطح سختی. */
export function ExamSetup() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [catalog, setCatalog] = useState<CatalogPayload | null>(null);
  const [topics, setTopics] = useState<TopicItem[]>([]);
  const [active, setActive] = useState<MockSummary | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<unknown>(null);

  const [lessonSearch, setLessonSearch] = useState('');
  const [allBank, setAllBank] = useState(
    !params.get('lessonId') &&
      !params.get('lesson') &&
      Boolean(params.get('examYearFrom') || params.get('examSession') || params.get('source')),
  );
  const [pickedLesson, setPickedLesson] = useState<CatalogLessonItem | null>(null);
  const [pickedTopic, setPickedTopic] = useState<TopicItem | null>(null);

  const [source, setSource] = useState(params.get('source') ?? '');
  const [difficulty, setDifficulty] = useState(params.get('difficulty') ?? '');
  const [yearFrom, setYearFrom] = useState(params.get('examYearFrom') ?? '');
  const [yearTo, setYearTo] = useState(params.get('examYearTo') ?? '');
  const [examSession, setExamSession] = useState(params.get('examSession') ?? '');

  const [count, setCount] = useState<number>(20);
  const [minutes, setMinutes] = useState<number>(20);
  const [preview, setPreview] = useState<MockPreview | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const [cat, act] = await Promise.all([
        exam.catalog(),
        mockExam.active().catch(() => ({ exam: null })),
      ]);
      setCatalog(cat);
      setActive(act.exam ?? null);

      const paramLid = params.get('lessonId');
      const paramLesson = params.get('lesson');
      if (paramLid || paramLesson) {
        const flat = cat.groups.flatMap((g) => g.lessons);
        const match = flat.find(
          (l) => (paramLid && l.id === paramLid) || (paramLesson && l.name === paramLesson),
        );
        if (match) {
          setAllBank(false);
          setPickedLesson(match);
          const tRes = await exam.topics(match.id).catch(() => ({ topics: [] as TopicItem[] }));
          const tList = tRes.topics ?? [];
          setTopics(tList);
          const paramTid = params.get('topicId');
          const paramTopic = params.get('topic');
          if (paramTid || paramTopic) {
            const tMatch = tList.find(
              (t) => (paramTid && t.id === paramTid) || (paramTopic && t.name === paramTopic),
            );
            if (tMatch) setPickedTopic(tMatch);
          }
        }
      }
      setState('ready');
    } catch (err) {
      setError(err);
      setState('error');
    }
  }, [params]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasScope = allBank || Boolean(pickedLesson);

  useEffect(() => {
    if (!hasScope) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await mockExam.preview({
          lesson: allBank ? '' : pickedLesson?.name ?? '',
          topic: allBank ? null : pickedTopic?.name ?? null,
          lesson_id: allBank ? null : pickedLesson?.id ?? null,
          topic_id: allBank ? null : pickedTopic?.id ?? null,
          count,
          minutes,
          allow_smaller: true,
          difficulty: difficulty || null,
          exam_year_from: yearFrom || null,
          exam_year_to: yearTo || null,
          exam_session: examSession || null,
          content_source: source ? [source] : null,
        });
        if (!cancelled) setPreview(res);
      } catch {
        if (!cancelled) setPreview(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    hasScope,
    allBank,
    pickedLesson,
    pickedTopic,
    count,
    minutes,
    difficulty,
    yearFrom,
    yearTo,
    examSession,
    source,
  ]);

  const pickAllBank = () => {
    setAllBank(true);
    setPickedLesson(null);
    setPickedTopic(null);
    setTopics([]);
  };

  const pickLesson = async (l: CatalogLessonItem) => {
    setAllBank(false);
    setPickedLesson(l);
    setPickedTopic(null);
    setTopics([]);
    try {
      const res = await exam.topics(l.id);
      setTopics(res.topics ?? []);
    } catch {
      setTopics([]);
    }
  };

  const start = async () => {
    if (!hasScope || busy) return;
    setBusy(true);
    try {
      const s = await mockExam.start({
        lesson: allBank ? '' : pickedLesson?.name ?? '',
        topic: allBank ? null : pickedTopic?.name ?? null,
        lesson_id: allBank ? null : pickedLesson?.id ?? null,
        topic_id: allBank ? null : pickedTopic?.id ?? null,
        count,
        minutes,
        allow_smaller: true,
        difficulty: difficulty || null,
        exam_year_from: yearFrom || null,
        exam_year_to: yearTo || null,
        exam_session: examSession || null,
        content_source: source ? [source] : null,
      });
      navigate(`/exam/run/${s.session_id}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'active_exam_exists') {
        const existing = (err.detail?.exam ?? null) as MockSummary | null;
        if (existing) {
          setActive(existing);
          setBusy(false);
          return;
        }
      }
      setError(err);
      setState('error');
    } finally {
      setBusy(false);
    }
  };

  const groups = useMemo<CatalogGroup[]>(() => {
    const raw = catalog?.groups ?? [];
    const q = lessonSearch.trim().toLowerCase();
    if (!q) return raw;
    return raw
      .map((g) => ({
        ...g,
        lessons: g.lessons.filter((l) => l.name.toLowerCase().includes(q)),
      }))
      .filter((g) => g.lessons.length > 0);
  }, [catalog?.groups, lessonSearch]);

  const scientificTopics = useMemo(
    () => topics.filter((t) => t.kind !== 'exam_period'),
    [topics],
  );
  const periodTopics = useMemo(
    () => topics.filter((t) => t.kind === 'exam_period'),
    [topics],
  );

  const filterFacets = catalog?.filters;
  const hasFilters = Boolean(
    filterFacets &&
      (filterFacets.sources.length > 0 ||
        filterFacets.years.length > 0 ||
        filterFacets.sessions.length > 0 ||
        filterFacets.difficulties.length > 1),
  );

  let stepCursor = 1;
  const stepLesson = stepCursor++;
  const stepTopic = !allBank && topics.length > 0 ? stepCursor++ : null;
  const stepFilters = hasFilters ? stepCursor++ : null;
  const stepCount = stepCursor++;
  const stepMinutes = stepCursor++;

  const canStart = Boolean(hasScope && (preview?.available_count ?? 0) > 0);
  const actualCount = preview ? Math.min(count, preview.available_count) : count;

  return (
    <>
      <AppBar title="آزمون" sub="زمان‌دار، بدون پاسخ در میانه" back onBack={() => navigate(-1)} />
      <div className="page page-enter exam-page">
        {state === 'loading' && <LoadingBlock rows={4} />}
        {state === 'error' && <ErrorBlock error={error} onRetry={() => void load()} />}

        {state === 'ready' && catalog && (
          <>
            {active && (
              <DsCard className="exam-banner-card">
                <div className="exam-sec-head">
                  <h2 className="exam-sec-head__title">یک آزمون نیمه‌کاره دارید</h2>
                  <DsBadge tone="warning">در جریان</DsBadge>
                </div>
                <p className="exam-hint-text">
                  {active.lesson || 'آزمون جامع'}
                  {active.topic ? ` · ${active.topic}` : ''} : {faNum(active.answered)} از{' '}
                  {faNum(active.total)} پاسخ
                </p>
                <div className="exam-banner-actions">
                  <DsButton
                    variant="primary"
                    size="md"
                    onClick={() => navigate(`/exam/run/${active.session_id}`)}
                  >
                    ادامهٔ آزمون
                  </DsButton>
                  <DsButton
                    variant="ghost"
                    size="md"
                    onClick={async () => {
                      await mockExam.abandon(active.session_id).catch(() => undefined);
                      setActive(null);
                    }}
                  >
                    رها کردن
                  </DsButton>
                </div>
              </DsCard>
            )}

            {catalog.active_lessons_count === 0 ? (
              <DsCard>
                <DsEmpty
                  icon={<Icon name="i-file-text" size={28} />}
                  title="سؤالی برای ورودی شما ثبت نشده"
                  body="آزمون از همان بانک سؤال تمرین ساخته می‌شود؛ پس از ثبت سؤالات برای ورودی شما، اینجا فعال می‌شود."
                  action={
                    <DsButton variant="secondary" onClick={() => navigate('/exam')}>
                      بازگشت به بانک سؤال
                    </DsButton>
                  }
                />
              </DsCard>
            ) : (
              <div className="exam-setup-grid">
                <div className="exam-setup-main">
                  <DsCard className="exam-step-card">
                    <div className="exam-sec-head">
                      <div className="exam-step-head">
                        <span className="exam-step-num">{faNum(stepLesson)}</span>
                        <h2 className="exam-sec-head__title">انتخاب درس</h2>
                      </div>
                      <DsBadge tone="count">
                        {faNum(catalog.active_lessons_count)} درس فعال
                      </DsBadge>
                    </div>

                    <div className="ds-search" role="search">
                      <Icon name="i-search" size={18} className="ds-search__icon" />
                      <input
                        type="search"
                        className="ds-input"
                        value={lessonSearch}
                        onChange={(e) => setLessonSearch(e.target.value)}
                        placeholder="جستجوی درس..."
                        aria-label="جستجوی درس برای آزمون"
                      />
                      {lessonSearch && (
                        <button
                          type="button"
                          className="ds-search__clear"
                          aria-label="پاک کردن جستجو"
                          onClick={() => setLessonSearch('')}
                        >
                          <Icon name="i-x" size={16} />
                        </button>
                      )}
                    </div>

                    <div className="exam-topics-wrap">
                      <DsChip
                        selected={allBank}
                        className="exam-choice-chip"
                        onClick={pickAllBank}
                      >
                        <span>کل بانک (جامع همهٔ درس‌ها)</span>
                        <span className="exam-choice-chip__count">
                          · {faNum(catalog.total_questions)}
                        </span>
                      </DsChip>
                    </div>

                    {groups.map((g) => (
                      <div key={g.key} className="exam-drawer-sec">
                        <span className="exam-drawer-label">{g.title}</span>
                        <div className="exam-topics-wrap">
                          {g.lessons.map((l) => (
                            <DsChip
                              key={l.id}
                              selected={!allBank && pickedLesson?.id === l.id}
                              className="exam-choice-chip"
                              onClick={() => void pickLesson(l)}
                            >
                              <span>{l.name}</span>
                              <span className="exam-choice-chip__count">· {faNum(l.count)}</span>
                            </DsChip>
                          ))}
                        </div>
                      </div>
                    ))}
                  </DsCard>

                  {stepTopic !== null && (
                    <DsCard className="exam-step-card">
                      <div className="exam-sec-head">
                        <div className="exam-step-head">
                          <span className="exam-step-num">{faNum(stepTopic)}</span>
                          <h2 className="exam-sec-head__title">مبحث یا دوره</h2>
                        </div>
                        <span className="exam-sec-head__sub">اختیاری</span>
                      </div>
                      <div className="exam-topics-wrap">
                        <DsChip
                          selected={!pickedTopic}
                          className="exam-choice-chip"
                          onClick={() => setPickedTopic(null)}
                        >
                          همهٔ درس
                        </DsChip>
                      </div>
                      {scientificTopics.length > 0 && (
                        <div className="exam-drawer-sec">
                          <span className="exam-drawer-label">مباحث علمی</span>
                          <div className="exam-topics-wrap">
                            {scientificTopics.map((t) => (
                              <DsChip
                                key={t.id || t.name}
                                selected={pickedTopic?.id === t.id && pickedTopic?.name === t.name}
                                className="exam-choice-chip"
                                onClick={() => setPickedTopic(t)}
                              >
                                <span>{t.name}</span>
                                <span className="exam-choice-chip__count">· {faNum(t.count)}</span>
                              </DsChip>
                            ))}
                          </div>
                        </div>
                      )}
                      {periodTopics.length > 0 && (
                        <div className="exam-drawer-sec">
                          <span className="exam-drawer-label">آزمون‌های ادوار</span>
                          <div className="exam-topics-wrap">
                            {periodTopics.map((t) => (
                              <DsChip
                                key={t.id || t.name}
                                selected={pickedTopic?.id === t.id && pickedTopic?.name === t.name}
                                className="exam-choice-chip"
                                onClick={() => setPickedTopic(t)}
                              >
                                <span>{t.name}</span>
                                <span className="exam-choice-chip__count">· {faNum(t.count)}</span>
                              </DsChip>
                            ))}
                          </div>
                        </div>
                      )}
                    </DsCard>
                  )}

                  {stepFilters !== null && filterFacets && (
                    <DsCard className="exam-step-card">
                      <div className="exam-sec-head">
                        <div className="exam-step-head">
                          <span className="exam-step-num">{faNum(stepFilters)}</span>
                          <h2 className="exam-sec-head__title">فیلتر منبع، سال و سطح</h2>
                        </div>
                        <span className="exam-sec-head__sub">اختیاری</span>
                      </div>

                      {filterFacets.sources.length > 0 && (
                        <div className="exam-drawer-sec">
                          <span className="exam-drawer-label">منبع سؤال</span>
                          <div className="exam-topics-wrap">
                            <DsChip selected={source === ''} onClick={() => setSource('')}>
                              همه منابع
                            </DsChip>
                            {filterFacets.sources.map((s) => (
                              <DsChip
                                key={s.code}
                                selected={source === s.code}
                                onClick={() => setSource((cur) => (cur === s.code ? '' : s.code))}
                              >
                                <span>{s.label}</span>
                                <span className="exam-choice-chip__count">· {faNum(s.count)}</span>
                              </DsChip>
                            ))}
                          </div>
                        </div>
                      )}

                      {filterFacets.difficulties.length > 1 && (
                        <div className="exam-drawer-sec">
                          <span className="exam-drawer-label">سطح سختی</span>
                          <div className="exam-topics-wrap">
                            <DsChip selected={difficulty === ''} onClick={() => setDifficulty('')}>
                              همه سطوح
                            </DsChip>
                            {filterFacets.difficulties.map((d) => (
                              <DsChip
                                key={d.code}
                                selected={difficulty === d.code}
                                onClick={() =>
                                  setDifficulty((cur) => (cur === d.code ? '' : d.code))
                                }
                              >
                                {diffTone(d.code) && (
                                  <span className={`exam-diff-dot exam-diff-dot--${diffTone(d.code)}`} aria-hidden="true" />
                                )}
                                <span>{plainLabel(d.label)}</span>
                                <span className="exam-choice-chip__count">· {faNum(d.count)}</span>
                              </DsChip>
                            ))}
                          </div>
                        </div>
                      )}

                      {(filterFacets.years.length > 0 || filterFacets.sessions.length > 0) && (
                        <div className="exam-filter-fields">
                          {filterFacets.years.length > 0 && (
                            <>
                              <label className="exam-field-col">
                                <span className="exam-drawer-label">از سال</span>
                                <select
                                  className="exam-select"
                                  value={yearFrom}
                                  onChange={(e) => setYearFrom(e.target.value)}
                                >
                                  <option value="">همه سال‌ها</option>
                                  {filterFacets.years.map((y) => (
                                    <option key={y} value={y}>
                                      {faDigits(y)}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="exam-field-col">
                                <span className="exam-drawer-label">تا سال</span>
                                <select
                                  className="exam-select"
                                  value={yearTo}
                                  onChange={(e) => setYearTo(e.target.value)}
                                >
                                  <option value="">همه سال‌ها</option>
                                  {filterFacets.years.map((y) => (
                                    <option key={y} value={y}>
                                      {faDigits(y)}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </>
                          )}
                          {filterFacets.sessions.length > 0 && (
                            <label className="exam-field-col">
                              <span className="exam-drawer-label">نوبت آزمون</span>
                              <select
                                className="exam-select"
                                value={examSession}
                                onChange={(e) => setExamSession(e.target.value)}
                              >
                                <option value="">همه نوبت‌ها</option>
                                {filterFacets.sessions.map((s) => (
                                  <option key={s.code} value={s.code}>
                                    {s.label} ({faNum(s.count)})
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                        </div>
                      )}
                    </DsCard>
                  )}

                  <DsCard className="exam-step-card">
                    <div className="exam-step-head">
                      <span className="exam-step-num">{faNum(stepCount)}</span>
                      <h2 className="exam-sec-head__title">تعداد سؤال</h2>
                    </div>
                    <div className="exam-topics-wrap">
                      {COUNTS.map((c) => (
                        <DsChip
                          key={c}
                          selected={count === c}
                          className="exam-choice-chip"
                          onClick={() => setCount(c)}
                        >
                          {faNum(c)} سؤال
                        </DsChip>
                      ))}
                    </div>
                  </DsCard>

                  <DsCard className="exam-step-card">
                    <div className="exam-step-head">
                      <span className="exam-step-num">{faNum(stepMinutes)}</span>
                      <h2 className="exam-sec-head__title">مدت زمان</h2>
                    </div>
                    <div className="exam-topics-wrap">
                      {MINUTES.map((m) => (
                        <DsChip
                          key={m}
                          selected={minutes === m}
                          className="exam-choice-chip"
                          onClick={() => setMinutes(m)}
                        >
                          {m === 0 ? 'بدون زمان' : `${faNum(m)} دقیقه`}
                        </DsChip>
                      ))}
                    </div>
                  </DsCard>
                </div>

                <aside className="exam-setup-side">
                  <DsCard level="raised" className="exam-stack">
                    <div className="exam-sec-head">
                      <h2 className="exam-sec-head__title">خلاصهٔ آزمون</h2>
                      {hasScope && preview && (
                        <DsBadge
                          tone={
                            preview.available_count === 0
                              ? 'danger'
                              : preview.can_start
                                ? 'success'
                                : 'warning'
                          }
                        >
                          {faNum(preview.available_count)} سؤال موجود
                        </DsBadge>
                      )}
                    </div>

                    <ul className="exam-summary-list">
                      <li className="exam-summary-row">
                        <span className="exam-summary-row__k">محدوده</span>
                        <span className="exam-summary-row__v">
                          {allBank
                            ? 'کل بانک (همهٔ درس‌ها)'
                            : pickedLesson
                              ? pickedLesson.name
                              : 'انتخاب نشده'}
                        </span>
                      </li>
                      {!allBank && topics.length > 0 && (
                        <li className="exam-summary-row">
                          <span className="exam-summary-row__k">مبحث</span>
                          <span className="exam-summary-row__v">
                            {pickedTopic ? pickedTopic.name : 'همهٔ مباحث درس'}
                          </span>
                        </li>
                      )}
                      {(yearFrom || yearTo) && (
                        <li className="exam-summary-row">
                          <span className="exam-summary-row__k">بازهٔ سال</span>
                          <span className="exam-summary-row__v">
                            {faDigits(yearFrom || '...')} تا {faDigits(yearTo || '...')}
                          </span>
                        </li>
                      )}
                      <li className="exam-summary-row">
                        <span className="exam-summary-row__k">تعداد سؤال</span>
                        <span className="exam-summary-row__v">{faNum(actualCount)} سؤال</span>
                      </li>
                      <li className="exam-summary-row">
                        <span className="exam-summary-row__k">زمان</span>
                        <span className="exam-summary-row__v">
                          {minutes === 0 ? 'بدون محدودیت' : `${faNum(minutes)} دقیقه`}
                        </span>
                      </li>
                    </ul>

                    {hasScope && (
                      <p className="exam-hint-text">
                        {preview
                          ? preview.available_count === 0
                            ? 'برای این محدوده و فیلتر سؤالی پیدا نشد؛ فیلترها یا درس را تغییر دهید.'
                            : preview.can_start
                              ? `آزمون با ${faNum(actualCount)} سؤال از ${faNum(preview.available_count)} سؤال موجود ساخته می‌شود.`
                              : `ظرفیت کمتر از ${faNum(count)} است؛ آزمون با ${faNum(preview.available_count)} سؤال ساخته می‌شود.`
                          : 'در حال بررسی ظرفیت بانک سؤال…'}
                      </p>
                    )}

                    <div className="exam-actions">
                      <DsButton
                        size="lg"
                        block
                        onClick={() => void start()}
                        disabled={!canStart}
                        loading={busy}
                      >
                        {busy ? 'در حال ساخت آزمون…' : 'شروع آزمون'}
                      </DsButton>
                      {!hasScope && (
                        <span className="exam-actions__hint">
                          ابتدا یک درس یا کل بانک را انتخاب کنید تا شروع آزمون فعال شود
                        </span>
                      )}
                    </div>

                    <p className="ds-card__sub">
                      در جریان آزمون پاسخ صحیح نمایش داده نمی‌شود؛ کارنامه و بازبینی پس از پایان
                      در دسترس است.
                    </p>
                  </DsCard>

                  <DsButton
                    variant="ghost"
                    size="md"
                    block
                    className="exam-btn-tall"
                    onClick={() => navigate('/exam/mock/history')}
                  >
                    <Icon name="i-clock" size={16} />
                    <span>مشاهدهٔ آزمون‌های قبلی</span>
                  </DsButton>
                </aside>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

/** فهرست آزمون‌های قبلی — خلاصهٔ آماری و برچسب‌های وضعیت معنایی (Audit E4). */
export function MockExamHistory() {
  const navigate = useNavigate();
  const [items, setItems] = useState<MockSummary[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    (async () => {
      try {
        const res = await mockExam.history();
        setItems(res.exams ?? []);
        setState('ready');
      } catch {
        setState('error');
      }
    })();
  }, []);

  const completed = items.filter((e) => e.status === 'finished' || e.status === 'expired');
  const finishedCount = items.filter((e) => e.status === 'finished').length;
  const avgPct =
    completed.length > 0
      ? Math.round(completed.reduce((acc, e) => acc + (e.percentage || 0), 0) / completed.length)
      : null;

  return (
    <>
      <AppBar title="آزمون‌های قبلی" sub="کارنامه و بازبینی" back onBack={() => navigate(-1)} />
      <div className="page page-enter exam-page">
        {state === 'loading' && <LoadingBlock rows={3} />}
        {state === 'error' && <ErrorBlock error={null} onRetry={() => navigate(0)} />}
        {state === 'ready' && items.length === 0 && (
          <DsCard>
            <DsEmpty
              icon={<Icon name="i-clock" size={28} />}
              title="هنوز آزمونی نداده‌اید"
              body="اولین آزمون زمان‌دار خود را بسازید تا کارنامه و روند پیشرفتتان اینجا ثبت شود."
              action={
                <DsButton variant="primary" onClick={() => navigate('/exam/setup')}>
                  ساخت آزمون تازه
                </DsButton>
              }
            />
          </DsCard>
        )}
        {state === 'ready' && items.length > 0 && (
          <div className="exam-stack">
            <div className="exam-kpi-strip" aria-label="خلاصهٔ آزمون‌ها">
              <div className="exam-kpi-tile">
                <span className="exam-kpi-tile__val">{faNum(items.length)}</span>
                <span className="exam-kpi-tile__lbl">کل آزمون‌ها</span>
              </div>
              <div className="exam-kpi-tile">
                <span className="exam-kpi-tile__val exam-kpi-tile__val--good">
                  {faNum(finishedCount)}
                </span>
                <span className="exam-kpi-tile__lbl">تمام‌شده</span>
              </div>
              <div className="exam-kpi-tile">
                <span className="exam-kpi-tile__val exam-kpi-tile__val--accent">
                  {avgPct !== null ? faPercent(avgPct) : '-'}
                </span>
                <span className="exam-kpi-tile__lbl">میانگین نمره</span>
              </div>
            </div>

            <DsCard flush>
              <div className="ds-list">
                {items.map((e) => {
                  const dateLabel = faDate(e.finished_at || e.started_at);
                  return (
                    <button
                      key={e.session_id}
                      type="button"
                      className="exam-mock-row"
                      onClick={() =>
                        navigate(
                          e.status === 'active'
                            ? `/exam/run/${e.session_id}`
                            : `/exam/result/${e.session_id}`,
                        )
                      }
                    >
                      <span className="exam-mock-row__body">
                        <span className="exam-mock-row__title">
                          {e.lesson || 'آزمون جامع'}
                          {e.topic ? ` · ${e.topic}` : ''}
                        </span>
                        <span className="exam-mock-row__meta">
                          {faNum(e.answered)} از {faNum(e.total)} پاسخ
                          {e.status !== 'active' ? ` · ${faPercent(Math.round(e.percentage))}` : ''}
                          {dateLabel ? ` · ${dateLabel}` : ''}
                        </span>
                      </span>
                      <DsBadge tone={statusBadgeTone(e.status)}>
                        {STATUS_LABEL[e.status] ?? e.status}
                      </DsBadge>
                    </button>
                  );
                })}
              </div>
            </DsCard>
          </div>
        )}
      </div>
    </>
  );
}
