import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AppBar } from '../components/AppBar';
import {
  DsBadge,
  DsButton,
  DsCard,
  DsEmpty,
  DsInput,
  DsSegmented,
  DsSkeleton,
} from '../design/components';
import { Icon } from '../icons';
import type { IconName } from '../icons';
import { errorText } from '../lib/api';
import {
  enDigits,
  faDigits,
  faNum,
  formatJalaliDate,
  formatTerm,
} from '../lib/fa';
import { schedule, studyTasks } from '../lib/schedule';
import type { ScheduleConflict, ScheduleItem, StudyTask } from '../lib/schedule';
import { peek, put } from '../lib/swr';

interface ScheduleMeta {
  cohortTitle: string;
  selected_count: number;
  total_offered_count: number;
  has_custom_selection: boolean;
  term: string;
  conflicts: ScheduleConflict[];
}
import {
  addDays,
  buildWeekPlan,
  hasBothGroups,
  jalaliRange,
  tehranNow,
  weekStart,
} from '../lib/weekPlan';
import type { DayPlan, GroupFilter, PlannedSession } from '../lib/weekPlan';
import './schedule.css';

const GROUP_KEY = 'hy_schedule_group';

const TYPE_LABELS: Record<string, string> = {
  class: 'کلاس',
  exam: 'امتحان',
  makeup: 'جبرانی',
};

const TYPE_ICONS: Record<string, IconName> = {
  class: 'i-book-open',
  exam: 'i-award',
  makeup: 'i-clock',
};

function readGroup(): GroupFilter {
  try {
    const val = window.localStorage.getItem(GROUP_KEY);
    if (val === '1' || val === '2' || val === 'all') return val;
  } catch {
    // فقط همین نشست
  }
  return 'all';
}

function getTodayJalali(): string {
  try {
    const formatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian-nu-latn', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'Asia/Tehran',
    });
    const parts = formatter.formatToParts(new Date());
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) return faDigits(`${y}-${m}-${d}`);
  } catch {
    // fallback
  }
  return '۱۴۰۵-۰۹-۰۵';
}

function normalizeJalaliInput(raw: string): string | null {
  const ascii = enDigits(raw).trim().replace(/\//g, '-');
  const m = ascii.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1300 || year > 1500 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  if (month > 6 && day > 30) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizeTimeInput(raw: string): string | null | 'invalid' {
  const ascii = enDigits(raw).trim();
  if (!ascii) return null;
  const m = ascii.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 'invalid';
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return 'invalid';
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function formatCohortTitle(group?: string, edu?: string): string {
  const g = enDigits(group || '').trim();
  if (g === '1' && edu === 'male') return 'گروه ۱ (برادران)';
  if (g === '1' && edu === 'female') return 'گروه ۱ (خواهران)';
  if (g === '2' && edu === 'male') return 'گروه ۲ (برادران)';
  if (g === '2' && edu === 'female') return 'گروه ۲ (خواهران)';
  if (g) return `گروه ${faDigits(g)}`;
  return '';
}

function sessionNotes(s: PlannedSession): string[] {
  const out: string[] = [];
  if (s.flex_note) out.push(faDigits(s.flex_note));
  if (s.note && s.note !== s.flex_note) out.push(faDigits(s.note));
  return out;
}

function sessionExtraFlags(s: PlannedSession) {
  return s.flags.filter((f) => f.key !== 'makeup');
}

function AgendaSessionRow({ session }: { session: PlannedSession }) {
  const isExam = session.type === 'exam';
  const isMakeup = session.type === 'makeup';
  const notes = sessionNotes(session);
  const flags = sessionExtraFlags(session);
  const teacherLoc = [session.teacher, session.location]
    .filter(Boolean)
    .map((v) => faDigits(v))
    .join(' · ');

  const rowClass = [
    'sched-row',
    isExam && 'is-exam',
    isMakeup && 'is-makeup',
    session.isNow && 'is-now',
    session.isNext && 'is-next',
    session.isOver && 'is-over',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li className={rowClass}>
      <div className="sched-row__icon" aria-hidden="true">
        <Icon name={TYPE_ICONS[session.type] || 'i-calendar'} size={20} />
      </div>
      <div className="sched-row__body">
        <div className="sched-row__top">
          <span className="sched-row__lesson">{faDigits(session.lesson || 'بدون عنوان')}</span>
          <div className="sched-row__badges">
            <DsBadge tone={isExam ? 'danger' : isMakeup ? 'warning' : 'neutral'}>
              {TYPE_LABELS[session.type] || session.type}
            </DsBadge>
            {session.isNow && <DsBadge tone="success">الان</DsBadge>}
            {session.isNext && <DsBadge tone="accent">کلاس بعدی</DsBadge>}
            {session.daysLeftLabel && (
              <DsBadge
                tone={
                  isExam && session.daysLeft !== null && session.daysLeft <= 3
                    ? 'danger'
                    : session.daysLeft === 0
                      ? 'accent'
                      : 'neutral'
                }
              >
                {session.daysLeftLabel}
              </DsBadge>
            )}
            {flags.map((f) => (
              <DsBadge key={f.key} tone={f.key === 'changed' ? 'danger' : 'warning'}>
                {f.label}
              </DsBadge>
            ))}
          </div>
        </div>

        <div className="sched-row__meta">
          <span className="sched-row__time">{session.timeLabel}</span>
          <span aria-hidden="true">·</span>
          <span>{session.jalaliWeekday} {session.jalaliMonthDay}</span>
        </div>

        {teacherLoc && <div className="sched-row__sub">{teacherLoc}</div>}

        {notes.map((txt, idx) => (
          <div key={idx} className="sched-row__note">
            {txt}
          </div>
        ))}
      </div>
    </li>
  );
}

function DesktopGridCell({ session }: { session: PlannedSession }) {
  const isExam = session.type === 'exam';
  const notes = sessionNotes(session);
  const flags = sessionExtraFlags(session);
  const teacherLoc = [session.teacher, session.location]
    .filter(Boolean)
    .map((v) => faDigits(v))
    .join(' · ');

  const cellClass = [
    'sched-cell',
    isExam && 'is-exam',
    session.isNow && 'is-now',
    session.isNext && 'is-next',
    session.isOver && 'is-over',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cellClass}>
      <div className="sched-cell__time">{session.timeLabel}</div>
      <div className="sched-cell__lesson">{faDigits(session.lesson || 'بدون عنوان')}</div>
      {teacherLoc && <div className="sched-cell__meta">{teacherLoc}</div>}
      <div className="sched-cell__tags">
        <DsBadge tone={isExam ? 'danger' : session.type === 'makeup' ? 'warning' : 'neutral'}>
          {TYPE_LABELS[session.type] || session.type}
        </DsBadge>
        {session.isNow && <DsBadge tone="success">الان</DsBadge>}
        {session.isNext && <DsBadge tone="accent">بعدی</DsBadge>}
        {session.daysLeftLabel && session.daysLeft !== null && session.daysLeft >= 0 && (
          <DsBadge tone={isExam && session.daysLeft <= 3 ? 'danger' : 'neutral'}>
            {session.daysLeftLabel}
          </DsBadge>
        )}
        {flags.map((f) => (
          <DsBadge key={f.key} tone={f.key === 'changed' ? 'danger' : 'warning'}>
            {f.label}
          </DsBadge>
        ))}
      </div>
      {notes.map((txt, idx) => (
        <div key={idx} className="sched-cell__note">
          {txt}
        </div>
      ))}
    </div>
  );
}

function DayAgendaCard({ day }: { day: DayPlan }) {
  const combined: PlannedSession[] = [...day.exams, ...day.sessions];
  const cardClass = [
    'sched-day-card',
    day.isToday && 'is-today',
    day.isPast && 'is-past',
  ]
    .filter(Boolean)
    .join(' ');

  const countParts: string[] = [];
  if (day.sessions.length > 0) countParts.push(`${faNum(day.sessions.length)} جلسه`);
  if (day.exams.length > 0) countParts.push(`${faNum(day.exams.length)} امتحان`);

  return (
    <DsCard flush className={cardClass}>
      <div className="sched-day-card__head">
        <div className="sched-day-card__title-wrap">
          <h3 className="sched-day-card__title">{day.name}</h3>
          <span className="sched-day-card__date">{day.jalaliDate}</span>
          {day.isToday && <DsBadge tone="solid">امروز</DsBadge>}
        </div>
        {countParts.length > 0 && (
          <DsBadge tone={day.exams.length > 0 ? 'danger' : 'accent'}>
            {countParts.join(' · ')}
          </DsBadge>
        )}
      </div>
      <ul className="ds-list">
        {combined.map((s) => (
          <AgendaSessionRow key={`${s.id}-${s.date}-${s.time}-${s.lesson}`} session={s} />
        ))}
      </ul>
    </DsCard>
  );
}

/** برنامهٔ هفتگی (شنبه تا جمعه)، امتحانات و تسک‌های مطالعه جلالی (Wave 3C · DS v2) */
export function ScheduleScreen() {
  const initialTab =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('tab') === 'tasks'
      ? 'tasks'
      : 'timetable';

  const [activeTab, setActiveTab] = useState<'timetable' | 'tasks'>(initialTab);
  const [cachedTt] = useState(() => peek<{ items: ScheduleItem[]; meta: ScheduleMeta }>('schedule'));
  const [items, setItems] = useState<ScheduleItem[]>(cachedTt?.items ?? []);
  const [loading, setLoading] = useState(!cachedTt);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState<ScheduleMeta>(
    cachedTt?.meta ?? {
      cohortTitle: '',
      selected_count: 0,
      total_offered_count: 0,
      has_custom_selection: false,
      term: '',
      conflicts: [],
    },
  );

  const now = useMemo(() => tehranNow(), []);
  const thisWeek = useMemo(() => weekStart(now.iso), [now.iso]);
  const [weekStartIso, setWeekStartIso] = useState(thisWeek);
  const [group, setGroup] = useState<GroupFilter>(readGroup);
  const [showEmptyDays, setShowEmptyDays] = useState(false);

  // تسک‌های مطالعه جلالی
  const [tasks, setTasks] = useState<StudyTask[]>(() => peek<StudyTask[]>('schedule-tasks') ?? []);
  const [tasksLoading, setTasksLoading] = useState(() => !peek('schedule-tasks'));
  const [tasksError, setTasksError] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDate, setTaskDate] = useState(getTodayJalali);
  const [taskTime, setTaskTime] = useState('');
  const [creatingTask, setCreatingTask] = useState(false);
  const [togglingTaskId, setTogglingTaskId] = useState<string | null>(null);
  const taskFormRef = useRef<HTMLFormElement>(null);

  const focusTaskTitle = () => {
    taskFormRef.current?.querySelector<HTMLInputElement>('#sched-task-title')?.focus();
  };

  const loadTimetable = useCallback(async () => {
    if (!peek('schedule')) setLoading(true);
    setError('');
    try {
      const res = await schedule.list({ since: thisWeek });
      const rawList = res.items || res.schedule || [];
      const nextMeta: ScheduleMeta = {
        cohortTitle: formatCohortTitle(res.group || res.computed_group, res.educational_group),
        selected_count: res.selected_count ?? 0,
        total_offered_count: res.total_offered_count ?? 0,
        has_custom_selection: Boolean(res.has_custom_selection),
        term: formatTerm(res.term),
        conflicts: res.conflicts || [],
      };
      put('schedule', { items: rawList, meta: nextMeta });
      setItems(rawList);
      setMeta(nextMeta);
    } catch (err) {
      setError(errorText(err, 'دریافت برنامه هفتگی با خطا مواجه شد'));
    } finally {
      setLoading(false);
    }
  }, [thisWeek]);

  const loadTasks = useCallback(async () => {
    if (!peek('schedule-tasks')) setTasksLoading(true);
    setTasksError('');
    try {
      const res = await studyTasks.list();
      setTasks(put('schedule-tasks', res.tasks || []));
    } catch (err) {
      setTasksError(errorText(err, 'دریافت تسک‌های مطالعه با خطا مواجه شد'));
    } finally {
      setTasksLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTimetable();
  }, [loadTimetable]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const plan = useMemo(
    () => buildWeekPlan(items, weekStartIso, { now, group }),
    [items, weekStartIso, now, group],
  );

  const firstSession = useMemo(
    () => items.reduce((min, i) => (i?.date && (!min || i.date < min) ? i.date : min), ''),
    [items],
  );
  const lastSession = useMemo(
    () => items.reduce((max, i) => (i?.date && i.date > max ? i.date : max), ''),
    [items],
  );
  const nextUpcomingSession = useMemo(
    () => items.find((i) => i?.date && i.date >= now.iso) || items[0] || null,
    [items, now.iso],
  );

  const showGroup = useMemo(() => hasBothGroups(items), [items]);
  const pickGroup = (g: GroupFilter) => {
    setGroup(g);
    try {
      window.localStorage.setItem(GROUP_KEY, g);
    } catch {
      // فقط همین نشست
    }
  };

  const canPrev =
    weekStartIso > thisWeek ||
    (Boolean(firstSession) && addDays(weekStartIso, -7) >= weekStart(firstSession));
  const canNext = Boolean(lastSession) && addDays(weekStartIso, 7) <= lastSession;
  const goWeek = (dir: -1 | 1) => setWeekStartIso((s) => addDays(s, 7 * dir));

  const isThisWeek = weekStartIso === thisWeek;
  const weekLabel = isThisWeek
    ? 'هفته جاری'
    : weekStartIso === addDays(thisWeek, 7)
      ? 'هفته بعد'
      : weekStartIso === addDays(thisWeek, -7)
        ? 'هفته قبل'
        : 'هفته انتخابی';
  const rangeLabel = jalaliRange(plan.start, plan.end);

  const busyDays = useMemo(
    () => plan.days.filter((d) => d.sessions.length > 0 || d.exams.length > 0),
    [plan.days],
  );
  const emptyDays = useMemo(
    () => plan.days.filter((d) => d.sessions.length === 0 && d.exams.length === 0),
    [plan.days],
  );

  const pendingTaskCount = useMemo(
    () => tasks.filter((t) => !t.completed).length,
    [tasks],
  );

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = taskTitle.trim();
    if (!title || creatingTask) return;
    const normDate = normalizeJalaliInput(taskDate);
    if (!normDate) {
      setTasksError('تاریخ جلالی معتبر نیست. نمونه صحیح: ۱۴۰۵-۰۹-۰۵');
      return;
    }
    const normTime = normalizeTimeInput(taskTime);
    if (normTime === 'invalid') {
      setTasksError('فرمت ساعت یادآوری باید به‌صورت ۱۸:۰۰ باشد.');
      return;
    }
    setCreatingTask(true);
    setTasksError('');
    try {
      await studyTasks.create({
        title,
        jalali_date: normDate,
        reminder_time: normTime,
      });
      setTaskTitle('');
      setTaskTime('');
      await loadTasks();
    } catch (err) {
      setTasksError(errorText(err, 'ثبت تسک مطالعه با خطا مواجه شد.'));
    } finally {
      setCreatingTask(false);
    }
  };

  const handleToggleTask = async (taskId: string) => {
    if (togglingTaskId) return;
    setTogglingTaskId(taskId);
    setTasksError('');
    try {
      const res = await studyTasks.toggle(taskId);
      setTasks((prev) =>
        prev.map((t) =>
          t.task_id === taskId
            ? { ...t, completed: res.completed, completed_at: res.completed_at }
            : t,
        ),
      );
    } catch (err) {
      setTasksError(errorText(err, 'تغییر وضعیت تسک انجام نشد.'));
    } finally {
      setTogglingTaskId(null);
    }
  };

  const termBadgeText = meta.term
    ? meta.term.startsWith('ترم')
      ? meta.term
      : `ترم ${meta.term}`
    : '';
  const courseSummary =
    meta.selected_count > 0
      ? meta.total_offered_count > 0
        ? `${faNum(meta.selected_count)} از ${faNum(meta.total_offered_count)} درس انتخابی`
        : `${faNum(meta.selected_count)} درس انتخابی`
      : 'برنامه پیش‌فرض گروه';

  const tabOptions = [
    {
      value: 'timetable' as const,
      label: (
        <span className="sched-tab-label">
          <span>برنامه کلاسی</span>
          {!loading && !error && (
            <DsBadge tone={activeTab === 'timetable' ? 'accent' : 'neutral'}>
              {faNum(plan.total + plan.examCount)}
            </DsBadge>
          )}
        </span>
      ),
    },
    {
      value: 'tasks' as const,
      label: (
        <span className="sched-tab-label">
          <span>تسک‌های من</span>
          {!tasksLoading && (
            <DsBadge tone={pendingTaskCount > 0 ? 'accent' : 'neutral'}>
              {faNum(pendingTaskCount)}
            </DsBadge>
          )}
        </span>
      ),
    },
  ];

  const groupOptions: ReadonlyArray<{ value: GroupFilter; label: string }> = [
    { value: 'all', label: 'همه' },
    { value: '1', label: 'گروه ۱' },
    { value: '2', label: 'گروه ۲' },
  ];

  return (
    <>
      <AppBar
        title="برنامه و تسک‌های مطالعه"
        sub="برنامه هفتگی و تقویم جلالی"
      />
      <div className="page page-enter sched-page" data-section="schedule">
        <div className="sched-tabs">
          <DsSegmented
            block
            label="انتخاب بخش برنامه"
            value={activeTab}
            options={tabOptions}
            onChange={setActiveTab}
          />
        </div>

        {/* ═══════════ تب برنامه کلاسی و امتحانات ═══════════ */}
        {activeTab === 'timetable' && (
          <div className="sched-stack">
            {(meta.cohortTitle || termBadgeText) && (
              <DsCard level="raised">
                <div className="sched-cohort">
                  <div className="sched-cohort__lead">
                    <div className="sched-cohort__icon" aria-hidden="true">
                      <Icon name="i-award" size={20} />
                    </div>
                    <div className="sched-cohort__titles">
                      <h2 className="sched-cohort__title">
                        {meta.cohortTitle || 'برنامه کلاسی'}
                      </h2>
                      <p className="sched-cohort__sub">
                        {[courseSummary, termBadgeText].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  </div>
                </div>
              </DsCard>
            )}

            {isThisWeek && (plan.current || plan.next) && (
              <DsCard level="accent">
                <div className="sched-live">
                  {plan.current ? (
                    <>
                      <div className="sched-live__lead">
                        <DsBadge tone="success">در حال برگزاری</DsBadge>
                        <span className="sched-live__title">
                          {faDigits(plan.current.lesson)}
                        </span>
                      </div>
                      <span className="sched-live__meta">
                        {[plan.current.timeLabel, faDigits(plan.current.location)]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </>
                  ) : plan.next ? (
                    <>
                      <div className="sched-live__lead">
                        <DsBadge tone="accent">کلاس بعدی</DsBadge>
                        <span className="sched-live__title">
                          {faDigits(plan.next.lesson)}
                        </span>
                      </div>
                      <span className="sched-live__meta">
                        {[
                          plan.next.iso === now.iso
                            ? 'امروز'
                            : `${plan.next.jalaliWeekday} ${plan.next.jalaliMonthDay}`,
                          plan.next.timeLabel,
                          faDigits(plan.next.location),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </>
                  ) : null}
                </div>
              </DsCard>
            )}

            {meta.conflicts.length > 0 && (
              <div data-section="danger">
                <DsCard level="accent" role="alert">
                  <details className="sched-alert sched-alert--collapsible">
                    <summary className="sched-alert__summary">
                      <Icon name="i-alert-circle" size={18} className="sched-alert__icon" />
                      <span className="sched-alert__title">
                        تداخل زمانی ({faNum(meta.conflicts.length)} مورد)
                      </span>
                      <Icon name="i-chevron" size={16} className="sched-alert__chev" />
                    </summary>
                    <ul className="sched-conflict-list">
                      {meta.conflicts.map((cf, idx) => (
                        <li key={idx} className="sched-conflict">
                          {cf.lesson_a && cf.lesson_b ? (
                            <>
                              <span className="sched-conflict__pair">
                                {faDigits(cf.lesson_a)}
                                <span className="sched-conflict__sep" aria-label="و">
                                  ⇄
                                </span>
                                {faDigits(cf.lesson_b)}
                              </span>
                              <span className="sched-conflict__when">
                                {[cf.day_label, cf.time_a || cf.time_b].filter(Boolean).map((s) => faDigits(s)).join(' · ')}
                              </span>
                            </>
                          ) : (
                            <span className="sched-conflict__pair">{faDigits(cf.message || '')}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                </DsCard>
              </div>
            )}

            {/* نوار جابه‌جایی هفته + شاخص‌های واحددار + فیلتر گروه (S3 / S4) */}
            <DsCard className="sched-week-card">
              <div className="sched-week-bar">
                <DsButton
                  variant="ghost"
                  className="sched-week-nav"
                  onClick={() => goWeek(-1)}
                  disabled={!canPrev}
                  aria-label="هفته قبل"
                >
                  <Icon name="i-chevron-r" size={18} />
                  <span className="sched-week-nav__label">هفته قبل</span>
                </DsButton>

                <div className="sched-week-mid">
                  <span className="sched-week-label">{weekLabel}</span>
                  <span className="sched-week-range">{rangeLabel}</span>
                </div>

                <DsButton
                  variant="ghost"
                  className="sched-week-nav"
                  onClick={() => goWeek(1)}
                  disabled={!canNext}
                  aria-label="هفته بعد"
                >
                  <span className="sched-week-nav__label">هفته بعد</span>
                  <Icon name="i-chevron" size={18} />
                </DsButton>
              </div>

              <div className="sched-toolbar">
                <div className="sched-kpis">
                  <DsBadge tone="neutral">{faNum(plan.total)} جلسه</DsBadge>
                  <DsBadge tone={plan.examCount > 0 ? 'danger' : 'neutral'}>
                    {faNum(plan.examCount)} امتحان
                  </DsBadge>
                  <DsBadge tone="accent">{faNum(plan.remaining)} باقیمانده</DsBadge>
                </div>

                <div className="sched-toolbar__actions">
                  {!isThisWeek && (
                    <DsButton
                      variant="secondary"
                      className="sched-jump-btn"
                      onClick={() => setWeekStartIso(thisWeek)}
                    >
                      هفته جاری
                    </DsButton>
                  )}
                  {showGroup && (
                    <div className="sched-groups">
                      <DsSegmented
                        label="فیلتر گروه کلاسی"
                        value={group}
                        options={groupOptions}
                        onChange={pickGroup}
                      />
                    </div>
                  )}
                </div>
              </div>
            </DsCard>

            {loading && (
              <div className="sched-skel">
                <DsSkeleton shape="card" />
                <DsSkeleton shape="row" />
                <DsSkeleton shape="row" />
                <DsSkeleton shape="row" />
              </div>
            )}

            {error && !loading && (
              <div data-section="danger">
                <DsCard level="accent" role="alert">
                  <div className="sched-alert">
                    <Icon name="i-alert-circle" size={18} className="sched-alert__icon" />
                    <div className="sched-alert__body">
                      <span>{error}</span>
                      <div>
                        <DsButton variant="secondary" onClick={() => void loadTimetable()}>
                          <Icon name="i-refresh" size={16} />
                          <span>تلاش دوباره</span>
                        </DsButton>
                      </div>
                    </div>
                  </div>
                </DsCard>
              </div>
            )}

            {!loading && !error && busyDays.length === 0 && (
              <DsCard>
                <DsEmpty
                  icon={<Icon name="i-calendar" size={28} />}
                  title={
                    items.length === 0
                      ? 'برنامه‌ای ثبت نشده'
                      : 'در این هفته کلاس یا امتحانی ندارید'
                  }
                  body={
                    items.length === 0
                      ? 'هنوز جلسه‌ای برای برنامه شما ثبت نشده است؛ می‌توانید تسک‌های مطالعه شخصی بسازید.'
                      : `در بازهٔ ${rangeLabel} برنامه‌ای ثبت نشده است.`
                  }
                  action={
                    <div className="sched-empty-state-actions">
                      {nextUpcomingSession && (
                        <DsButton
                          variant="primary"
                          onClick={() =>
                            setWeekStartIso(weekStart(enDigits(nextUpcomingSession.date).slice(0, 10)))
                          }
                        >
                          رفتن به هفتهٔ دارای کلاس
                        </DsButton>
                      )}
                      <DsButton variant="secondary" onClick={() => setActiveTab('tasks')}>
                        مشاهده تسک‌های من
                      </DsButton>
                    </div>
                  }
                />
              </DsCard>
            )}

            {!loading && !error && busyDays.length > 0 && (
              <>
                {/* نمای موبایل و تبلت (< 1024px): کارت‌های روزبه‌روز */}
                <div className="sched-agenda">
                  {busyDays.map((day) => (
                    <DayAgendaCard key={day.iso} day={day} />
                  ))}

                  {emptyDays.length > 0 && (
                    <DsCard level="flat" className="sched-empty-days">
                      <DsButton
                        variant="ghost"
                        block
                        className="sched-empty-toggle"
                        aria-expanded={showEmptyDays}
                        onClick={() => setShowEmptyDays((v) => !v)}
                      >
                        <span>روزهای بدون کلاس ({faNum(emptyDays.length)} روز)</span>
                        <Icon
                          name={showEmptyDays ? 'i-chevron-r' : 'i-chevron'}
                          size={18}
                        />
                      </DsButton>
                      {showEmptyDays && (
                        <div className="sched-empty-list">
                          {emptyDays.map((day) => (
                            <span key={day.iso} className="sched-empty-pill">
                              {day.name} {day.jalaliMonthDay}
                            </span>
                          ))}
                        </div>
                      )}
                    </DsCard>
                  )}
                </div>

                {/* نمای دسکتاپ (>= 1024px): جدول ۷ ستونه شنبه تا جمعه */}
                <section className="sched-grid" aria-label="جدول هفتگی شنبه تا جمعه">
                  {plan.days.map((day) => {
                    const colClass = [
                      'sched-col',
                      day.isToday && 'is-today',
                      day.isPast && 'is-past',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    const hasAny = day.exams.length > 0 || day.sessions.length > 0;
                    return (
                      <div key={day.iso} className={colClass}>
                        <header className="sched-col__head">
                          <span className="sched-col__day">{day.name}</span>
                          <span className="sched-col__date">{day.jalaliMonthDay}</span>
                          {day.isToday && <DsBadge tone="solid">امروز</DsBadge>}
                        </header>
                        <div className="sched-col__body">
                          {!hasAny && <p className="sched-col__empty">بدون کلاس</p>}
                          {day.exams.map((e) => (
                            <DesktopGridCell
                              key={`${e.id}-${e.date}-${e.time}-${e.lesson}`}
                              session={e}
                            />
                          ))}
                          {day.sessions.map((s) => (
                            <DesktopGridCell
                              key={`${s.id}-${s.date}-${s.time}-${s.lesson}`}
                              session={s}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </section>
              </>
            )}
          </div>
        )}

        {/* ═══════════ تب تسک‌های مطالعه جلالی ═══════════ */}
        {activeTab === 'tasks' && (
          <div className="sched-tasks-layout">
            <DsCard className="sched-task-form-card">
              <h2 className="ds-card__title">افزودن تسک مطالعه</h2>
              <p className="ds-card__sub">
                مباحث مطالعه و مرور خود را با تاریخ جلالی و ساعت یادآوری ثبت کنید.
              </p>
              <form ref={taskFormRef} className="sched-task-form" onSubmit={handleCreateTask}>
                <DsInput
                  id="sched-task-title"
                  label="عنوان مبحث یا تسک"
                  placeholder="مثلاً: مرور فیزیولوژی قلب یا ۵۰ تست آناتومی"
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  required
                />

                <div className="sched-task-form__row">
                  <DsInput
                    id="sched-task-date"
                    className="sched-input-ltr"
                    label="تاریخ جلالی"
                    placeholder="۱۴۰۵-۰۹-۰۵"
                    hint="الگو: ۱۴۰۵-۰۹-۰۵"
                    value={taskDate}
                    onChange={(e) => setTaskDate(e.target.value)}
                    required
                    ltr
                  />
                  <DsInput
                    id="sched-task-time"
                    className="sched-input-ltr"
                    label="ساعت یادآوری (اختیاری)"
                    placeholder="۱۸:۰۰"
                    hint="مثلاً ۱۸:۰۰"
                    value={taskTime}
                    onChange={(e) => setTaskTime(e.target.value)}
                    ltr
                  />
                </div>

                <div className="sched-task-form__actions">
                  <DsButton
                    type="submit"
                    variant="primary"
                    size="md"
                    block
                    loading={creatingTask}
                    disabled={!taskTitle.trim() || !taskDate.trim()}
                  >
                    <Icon name="i-plus" size={18} />
                    <span>افزودن به برنامه</span>
                  </DsButton>
                </div>
              </form>
            </DsCard>

            <div className="sched-tasks-col">
              {tasksError && (
                <div data-section="danger">
                  <DsCard level="accent" role="alert">
                    <div className="sched-alert">
                      <Icon name="i-alert-circle" size={18} className="sched-alert__icon" />
                      <div className="sched-alert__body">
                        <span>{tasksError}</span>
                      </div>
                    </div>
                  </DsCard>
                </div>
              )}

              {tasksLoading ? (
                <div className="sched-skel">
                  <DsSkeleton shape="row" />
                  <DsSkeleton shape="row" />
                  <DsSkeleton shape="row" />
                </div>
              ) : tasks.length === 0 ? (
                <DsCard>
                  <DsEmpty
                    icon={<Icon name="i-calendar" size={28} />}
                    title="تسک مطالعه‌ای ثبت نشده"
                    body="با افزودن اولین مبحث درسی، برنامه‌ریزی شخصی خود را بر اساس تقویم جلالی آغاز کنید."
                    action={
                      <DsButton
                        variant="secondary"
                        onClick={focusTaskTitle}
                      >
                        <Icon name="i-plus" size={18} />
                        <span>ثبت اولین تسک</span>
                      </DsButton>
                    }
                  />
                </DsCard>
              ) : (
                <>
                  <div className="sched-tasks-head">
                    <h2 className="sched-tasks-head__title">تسک‌های مطالعه</h2>
                    <DsBadge tone={pendingTaskCount > 0 ? 'accent' : 'success'}>
                      {faNum(pendingTaskCount)} مانده از {faNum(tasks.length)} تسک
                    </DsBadge>
                  </div>
                  <DsCard flush>
                    <ul className="ds-list">
                      {tasks.map((task) => {
                        const isToggling = togglingTaskId === task.task_id;
                        const dateLabel = formatJalaliDate(task.jalali_date);
                        return (
                          <li
                            key={task.task_id}
                            className={`sched-task${task.completed ? ' is-done' : ''}`}
                          >
                            <button
                              type="button"
                              className="sched-task__check-btn"
                              onClick={() => void handleToggleTask(task.task_id)}
                              disabled={isToggling}
                              aria-pressed={task.completed}
                              aria-label={
                                task.completed
                                  ? `بازگرداندن «${task.title}» به حالت انجام‌نشده`
                                  : `تکمیل تسک «${task.title}»`
                              }
                            >
                              <span className="sched-task__box" aria-hidden="true">
                                <Icon name="i-check" size={15} />
                              </span>
                            </button>

                            <div className="sched-task__body">
                              <span className="sched-task__title">{faDigits(task.title)}</span>
                              <div className="sched-task__meta">
                                {dateLabel && (
                                  <span className="sched-task__meta-item">
                                    <Icon name="i-calendar" size={14} />
                                    <span>{dateLabel}</span>
                                  </span>
                                )}
                                {task.reminder_time && (
                                  <span className="sched-task__meta-item">
                                    <Icon name="i-clock" size={14} />
                                    <span>{faDigits(task.reminder_time)}</span>
                                  </span>
                                )}
                                {task.completed && <DsBadge tone="success">انجام شد</DsBadge>}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </DsCard>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
