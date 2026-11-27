/* «تسک‌های من» — بورد سه‌ستونه: برای انجام / در حال انجام / انجام شد.
   هر کارت: اولویت (نوار رنگی کنار کارت)، فوریت، موعد نسبی (دیرکرد، امروز، فردا…) و ساعت یادآوری.
   دسکتاپ: کارت را بین ستون‌ها بکش و رها کن. موبایل: هر بار یک ستون (سگمنت بالا) و دکمه‌های جابه‌جایی.
   تغییرها خوش‌بینانه اعمال می‌شوند و اگر سرور رد کرد برمی‌گردند. */
import { useEffect, useMemo, useState } from 'react';
import './tasks-board.css';
import { ProgressBar, Switch } from '../components';
import { DsButton, DsCard, DsChip, DsEmpty, DsSegmented, DsSkeleton } from '../design/components';
import { Icon } from '../icons';
import { errorText } from '../lib/api';
import { faDigits, faNum } from '../lib/fa';
import { studyTasks, type StudyTask, type TaskPriority, type TaskStatus } from '../lib/schedule';
import { put } from '../lib/swr';

const COLUMNS: { key: TaskStatus; title: string; empty: string }[] = [
  { key: 'todo', title: 'برای انجام', empty: 'صف خالی است.' },
  { key: 'doing', title: 'در حال انجام', empty: 'هنوز کاری را شروع نکرده‌ای.' },
  { key: 'done', title: 'انجام شد', empty: 'تسک انجام‌شده‌ای نیست.' },
];

const PRIORITY: Record<TaskPriority, { label: string; rank: number }> = {
  high: { label: 'اولویت بالا', rank: 3 },
  medium: { label: 'اولویت متوسط', rank: 2 },
  low: { label: 'اولویت کم', rank: 1 },
};
const PRIORITY_ORDER: TaskPriority[] = ['high', 'medium', 'low'];
const PRIORITY_SHORT: Record<TaskPriority, string> = { high: 'بالا', medium: 'متوسط', low: 'کم' };

const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

type Jalali = [number, number, number];

const statusOf = (t: StudyTask): TaskStatus => t.status ?? (t.completed ? 'done' : 'todo');
const priorityOf = (t: StudyTask): TaskPriority => t.priority ?? 'medium';

function toLatin(s: string): string {
  return s
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

function jalaliOf(date: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const get = (type: string) => toLatin(parts.find((p) => p.type === type)?.value ?? '');
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return '';
  }
}

function parseJalali(raw: string): Jalali | null {
  const m = toLatin(raw.trim()).match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1300 || y > 1500 || mo < 1 || mo > 12 || d < 1 || d > 31 || (mo > 6 && d > 30)) return null;
  return [y, mo, d];
}

const isoOf = ([y, m, d]: Jalali) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** شمارهٔ روز پیوسته برای تفاضل دو تاریخ جلالی (همان حساب jdf). */
function dayIndex([jy, jm, jd]: Jalali): number {
  const y = jy + 1595;
  return (
    -355668 + 365 * y + Math.floor(y / 33) * 8 + Math.floor(((y % 33) + 3) / 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186)
  );
}

function normTime(raw: string): string | null {
  const m = toLatin(raw.trim()).match(/^(\d{1,2})[:٫.](\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

type DueTone = 'danger' | 'warning' | 'accent' | 'neutral';

function dueInfo(t: StudyTask, today: Jalali | null): { label: string; tone: DueTone } | null {
  const p = parseJalali(t.jalali_date || '');
  if (!p) return null;
  const dateLabel = `${faNum(p[2])} ${MONTHS[p[1] - 1]}${today && today[0] !== p[0] ? ` ${faNum(p[0])}` : ''}`;
  if (!today || statusOf(t) === 'done') return { label: dateLabel, tone: 'neutral' };
  const diff = dayIndex(p) - dayIndex(today);
  if (diff < 0) return { label: `${faNum(-diff)} روز دیرکرد`, tone: 'danger' };
  if (diff === 0) return { label: 'امروز', tone: 'warning' };
  if (diff === 1) return { label: 'فردا', tone: 'accent' };
  if (diff < 7) return { label: `${faNum(diff)} روز دیگر`, tone: 'neutral' };
  return { label: dateLabel, tone: 'neutral' };
}

const MOVES: Record<TaskStatus, { to: TaskStatus; label: string }[]> = {
  todo: [{ to: 'doing', label: 'شروع' }],
  doing: [
    { to: 'todo', label: 'بازگشت' },
    { to: 'done', label: 'انجام شد' },
  ],
  done: [{ to: 'todo', label: 'بازگشایی' }],
};

interface Props {
  tasks: StudyTask[];
  setTasks: React.Dispatch<React.SetStateAction<StudyTask[]>>;
  loading: boolean;
  error: string;
}

export function TasksBoard({ tasks, setTasks, loading, error }: Props) {
  const todayIso = useMemo(() => jalaliOf(new Date()), []);
  const today = useMemo(() => parseJalali(todayIso), [todayIso]);
  const quickDates = useMemo(() => {
    const at = (days: number) => jalaliOf(new Date(Date.now() + days * 86400000));
    return [
      { label: 'امروز', value: at(0) },
      { label: 'فردا', value: at(1) },
      { label: 'هفتهٔ بعد', value: at(7) },
    ].filter((q) => q.value);
  }, []);

  const [title, setTitle] = useState('');
  const [date, setDate] = useState(() => faDigits(todayIso));
  const [time, setTime] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [urgent, setUrgent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [actionErr, setActionErr] = useState('');
  const [mobileCol, setMobileCol] = useState<TaskStatus>('todo');
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  useEffect(() => {
    if (!confirmDel) return undefined;
    const t = window.setTimeout(() => setConfirmDel(null), 3000);
    return () => window.clearTimeout(t);
  }, [confirmDel]);

  /** Every change also refreshes the screen cache, so a revisit paints the board as it was left. */
  const commit = (fn: (prev: StudyTask[]) => StudyTask[]) => setTasks((prev) => put('schedule-tasks', fn(prev)));

  const byCol = useMemo(() => {
    const out: Record<TaskStatus, StudyTask[]> = { todo: [], doing: [], done: [] };
    for (const t of tasks) out[statusOf(t)].push(t);
    const due = (t: StudyTask) => {
      const p = parseJalali(t.jalali_date || '');
      return p ? dayIndex(p) : Number.MAX_SAFE_INTEGER;
    };
    const rank = (a: StudyTask, b: StudyTask) =>
      Number(!!b.urgent) - Number(!!a.urgent) ||
      PRIORITY[priorityOf(b)].rank - PRIORITY[priorityOf(a)].rank ||
      due(a) - due(b) ||
      a.title.localeCompare(b.title, 'fa');
    out.todo.sort(rank);
    out.doing.sort(rank);
    out.done.sort((a, b) => String(b.completed_at || '').localeCompare(String(a.completed_at || '')));
    return out;
  }, [tasks]);

  const summary = useMemo(() => {
    let overdue = 0;
    let dueToday = 0;
    let urgentOpen = 0;
    for (const t of tasks) {
      if (statusOf(t) === 'done') continue;
      if (t.urgent) urgentOpen += 1;
      const p = parseJalali(t.jalali_date || '');
      if (!p || !today) continue;
      const diff = dayIndex(p) - dayIndex(today);
      if (diff < 0) overdue += 1;
      else if (diff === 0) dueToday += 1;
    }
    const done = byCol.done.length;
    return { overdue, dueToday, urgentOpen, done, pct: tasks.length ? (done / tasks.length) * 100 : 0 };
  }, [tasks, byCol, today]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t || saving) return;
    const p = parseJalali(date);
    if (!p) {
      setFormErr('تاریخ معتبر نیست؛ نمونه: ۱۴۰۵-۰۹-۰۸');
      return;
    }
    const tm = time.trim() ? normTime(time) : null;
    if (time.trim() && !tm) {
      setFormErr('ساعت را به‌شکل ۱۸:۰۰ بنویس.');
      return;
    }
    setSaving(true);
    setFormErr('');
    try {
      const jalali = isoOf(p);
      const res = await studyTasks.create({ title: t, jalali_date: jalali, reminder_time: tm, priority, urgent, status: 'todo' });
      commit((prev) => [
        ...prev,
        {
          task_id: res.task_id,
          title: t,
          jalali_date: jalali,
          reminder_time: tm,
          completed: false,
          completed_at: null,
          status: 'todo',
          priority,
          urgent,
        },
      ]);
      setTitle('');
      setTime('');
      setUrgent(false);
      setPriority('medium');
      setMobileCol('todo');
    } catch (err) {
      setFormErr(errorText(err, 'ثبت تسک انجام نشد.'));
    } finally {
      setSaving(false);
    }
  }

  async function patchTask(t: StudyTask, p: Partial<Pick<StudyTask, 'status' | 'priority' | 'urgent'>>) {
    const snapshot = tasks;
    const now = new Date().toISOString();
    commit((list) =>
      list.map((x) => {
        if (x.task_id !== t.task_id) return x;
        const status = p.status ?? statusOf(x);
        const becameDone = status === 'done' && statusOf(x) !== 'done';
        return {
          ...x,
          ...p,
          status,
          completed: status === 'done',
          completed_at: status === 'done' ? (becameDone ? now : x.completed_at) : null,
        };
      }),
    );
    setActionErr('');
    try {
      await studyTasks.update(t.task_id, p);
    } catch (err) {
      commit(() => snapshot);
      setActionErr(errorText(err, 'تغییر تسک ذخیره نشد.'));
    }
  }

  async function removeTask(t: StudyTask) {
    if (confirmDel !== t.task_id) {
      setConfirmDel(t.task_id);
      return;
    }
    setConfirmDel(null);
    const snapshot = tasks;
    commit((list) => list.filter((x) => x.task_id !== t.task_id));
    try {
      await studyTasks.remove(t.task_id);
    } catch (err) {
      commit(() => snapshot);
      setActionErr(errorText(err, 'حذف تسک انجام نشد.'));
    }
  }

  const nextPriority = (p: TaskPriority): TaskPriority => PRIORITY_ORDER[(PRIORITY_ORDER.indexOf(p) + 1) % PRIORITY_ORDER.length];

  const renderCard = (t: StudyTask) => {
    const st = statusOf(t);
    const pr = priorityOf(t);
    const due = dueInfo(t, today);
    const askDel = confirmDel === t.task_id;
    return (
      <article
        key={t.task_id}
        className={`tb-card is-${st} pr-${pr}${t.urgent ? ' is-urgent' : ''}${dragId === t.task_id ? ' is-dragging' : ''}`}
        draggable
        onDragStart={(e) => {
          setDragId(t.task_id);
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', t.task_id);
        }}
        onDragEnd={() => {
          setDragId(null);
          setOverCol(null);
        }}
      >
        <button
          type="button"
          className="tb-card__check"
          aria-pressed={st === 'done'}
          aria-label={st === 'done' ? `بازگرداندن «${t.title}»` : `انجام شد: «${t.title}»`}
          onClick={() => void patchTask(t, { status: st === 'done' ? 'todo' : 'done' })}
        >
          <Icon name="i-check" size={14} />
        </button>
        <div className="tb-card__body">
          <p className="tb-card__title">{faDigits(t.title)}</p>
          <div className="tb-card__meta">
            {t.urgent && st !== 'done' && (
              <span className="tb-tag tb-tag--urgent">
                <Icon name="i-flag" size={12} />
                فوری
              </span>
            )}
            <span className={`tb-tag tb-tag--pr pr-${pr}`}>{PRIORITY[pr].label}</span>
            {due && (
              <span className={`tb-due is-${due.tone}`}>
                <Icon name="i-calendar" size={12} />
                {due.label}
              </span>
            )}
            {t.reminder_time && (
              <span className="tb-due is-neutral">
                <Icon name="i-clock" size={12} />
                <bdi>{faDigits(t.reminder_time)}</bdi>
              </span>
            )}
          </div>
          <div className="tb-card__actions">
            {MOVES[st].map((m) => (
              <button key={m.to} type="button" className="tb-act tb-act--move" onClick={() => void patchTask(t, { status: m.to })}>
                {m.label}
              </button>
            ))}
            {st !== 'done' && (
              <>
                <button
                  type="button"
                  className={`tb-act${t.urgent ? ' is-on' : ''}`}
                  aria-pressed={!!t.urgent}
                  onClick={() => void patchTask(t, { urgent: !t.urgent })}
                >
                  {t.urgent ? 'لغو فوری' : 'فوری'}
                </button>
                <button
                  type="button"
                  className="tb-act"
                  onClick={() => void patchTask(t, { priority: nextPriority(pr) })}
                  title="تغییر اولویت"
                >
                  {`اولویت: ${PRIORITY_SHORT[pr]}`}
                </button>
              </>
            )}
            <button
              type="button"
              className={`tb-act tb-act--del${askDel ? ' is-confirm' : ''}`}
              onClick={() => void removeTask(t)}
              aria-label={askDel ? 'تأیید حذف' : `حذف «${t.title}»`}
            >
              {askDel ? 'حذف شود؟' : <Icon name="i-x" size={14} />}
            </button>
          </div>
        </div>
      </article>
    );
  };

  return (
    <div className="tb">
      <section className="tb-summary" aria-label="خلاصهٔ تسک‌ها">
        <div className={`tb-stat${summary.overdue ? ' is-danger' : ''}`}>
          <bdi className="tb-stat__value">{faNum(summary.overdue)}</bdi>
          <span className="tb-stat__label">دیرکرد</span>
        </div>
        <div className={`tb-stat${summary.dueToday ? ' is-warning' : ''}`}>
          <bdi className="tb-stat__value">{faNum(summary.dueToday)}</bdi>
          <span className="tb-stat__label">موعد امروز</span>
        </div>
        <div className="tb-stat">
          <bdi className="tb-stat__value">{faNum(summary.urgentOpen)}</bdi>
          <span className="tb-stat__label">فوری</span>
        </div>
        <div className="tb-stat tb-stat--progress">
          <span className="tb-stat__label">
            {`${faNum(summary.done)} از ${faNum(tasks.length)} انجام شد`}
          </span>
          <ProgressBar value={summary.pct} thin tone="good" />
        </div>
      </section>

      <DsCard className="tb-form-card">
        <form className="tb-form" onSubmit={(e) => void submit(e)}>
          <div className="tb-form__main">
            <input
              className="tb-form__title"
              placeholder="یک تسک تازه… مثلاً مرور فیزیولوژی قلب"
              value={title}
              maxLength={150}
              onChange={(e) => setTitle(e.target.value)}
              aria-label="عنوان تسک"
              dir="auto"
            />
            <DsButton type="submit" variant="primary" loading={saving} disabled={!title.trim()}>
              <Icon name="i-plus" size={18} />
              <span>افزودن</span>
            </DsButton>
          </div>
          <div className="tb-form__opts">
            <div className="tb-field">
              <span className="tb-field__label">موعد</span>
              <div className="tb-chips">
                {quickDates.map((q) => (
                  <DsChip key={q.label} selected={toLatin(date) === q.value} onClick={() => setDate(faDigits(q.value))}>
                    {q.label}
                  </DsChip>
                ))}
                <input
                  className="tb-input"
                  dir="ltr"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  aria-label="تاریخ جلالی موعد"
                  placeholder="۱۴۰۵-۰۹-۰۸"
                />
              </div>
            </div>
            <div className="tb-field">
              <span className="tb-field__label">یادآوری</span>
              <input
                className="tb-input tb-input--time"
                dir="ltr"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                aria-label="ساعت یادآوری (اختیاری)"
                placeholder="۱۸:۰۰"
              />
            </div>
            <div className="tb-field">
              <span className="tb-field__label">اولویت</span>
              <div className="tb-chips">
                {PRIORITY_ORDER.map((p) => (
                  <DsChip key={p} selected={priority === p} onClick={() => setPriority(p)}>
                    <span className={`tb-dot pr-${p}`} aria-hidden="true" />
                    {PRIORITY_SHORT[p]}
                  </DsChip>
                ))}
              </div>
            </div>
            <div className="tb-field tb-field--switch">
              <span className="tb-field__label">فوری</span>
              <Switch label="فوری" checked={urgent} onChange={setUrgent} />
            </div>
          </div>
          {formErr && (
            <p className="tb-err" role="alert">
              <Icon name="i-alert-circle" size={14} />
              <span>{formErr}</span>
            </p>
          )}
        </form>
      </DsCard>

      {(error || actionErr) && (
        <p className="tb-err" role="alert">
          <Icon name="i-alert-circle" size={14} />
          <span>{actionErr || error}</span>
        </p>
      )}

      {loading && tasks.length === 0 ? (
        <div className="tb-board">
          {COLUMNS.map((c) => (
            <div key={c.key} className="tb-col is-current">
              <DsSkeleton shape="row" />
              <DsSkeleton shape="card" />
            </div>
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <DsCard>
          <DsEmpty
            icon={<Icon name="i-calendar" size={28} />}
            title="هنوز تسکی نداری"
            body="اولین تسک را بالا بنویس و موعد، اولویت و فوریتش را مشخص کن تا برنامه‌ات مرتب بماند."
          />
        </DsCard>
      ) : (
        <>
          <div className="tb-tabs">
            <DsSegmented
              block
              label="ستون‌های تسک"
              value={mobileCol}
              onChange={setMobileCol}
              options={COLUMNS.map((c) => ({ value: c.key, label: `${c.title} · ${faNum(byCol[c.key].length)}` }))}
            />
          </div>
          <div className="tb-board">
            {COLUMNS.map((col) => (
              <section
                key={col.key}
                className={`tb-col is-${col.key}${mobileCol === col.key ? ' is-current' : ''}${overCol === col.key ? ' is-over' : ''}`}
                aria-label={col.title}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (overCol !== col.key) setOverCol(col.key);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverCol(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = dragId || e.dataTransfer.getData('text/plain');
                  const t = tasks.find((x) => x.task_id === id);
                  setDragId(null);
                  setOverCol(null);
                  if (t && statusOf(t) !== col.key) void patchTask(t, { status: col.key });
                }}
              >
                <header className="tb-col__head">
                  <span className={`tb-col__dot is-${col.key}`} aria-hidden="true" />
                  <h3 className="tb-col__title">{col.title}</h3>
                  <span className="tb-col__count">{faNum(byCol[col.key].length)}</span>
                </header>
                <div className="tb-col__list">
                  {byCol[col.key].length === 0 ? (
                    <p className="tb-col__empty">{col.empty}</p>
                  ) : (
                    byCol[col.key].map(renderCard)
                  )}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
