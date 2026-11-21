import { useCallback, useEffect, useState } from 'react';

import { AppBar, Button, Card, Chip, EmptyState, Input, SkeletonStack } from '../components';
import { Icon } from '../icons';
import { schedule, studyTasks } from '../lib/schedule';
import type { ScheduleItem, StudyTask } from '../lib/schedule';
import { errorText } from '../lib/api';
import { fa } from '../lib/library';

const TYPE_LABELS: Record<string, string> = {
  class: 'کلاس',
  exam: 'امتحان',
  makeup: 'جبرانی',
};

const TYPE_ICONS: Record<string, string> = {
  class: 'i-book-open',
  exam: 'i-award',
  makeup: 'i-clock',
};

function getTodayJalali(): string {
  try {
    const formatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian-nu-latn', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(new Date());
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // fallback
  }
  return '1405-08-16';
}

function ScheduleRow({ item }: { item: ScheduleItem }) {
  const isExam = item.type === 'exam';
  const label = item.days_left !== null
    ? item.days_left === 0 ? 'امروز' : `${fa(item.days_left)} روز دیگر`
    : item.date;

  return (
    <div className="list__item" style={{ alignItems: 'flex-start', padding: '14px 16px' }}>
      <div
        className="ibox"
        style={{
          width: 44,
          height: 44,
          borderRadius: 14,
          marginTop: 2,
          background: isExam ? 'var(--danger-soft)' : 'var(--cyan-soft)',
          color: isExam ? 'var(--danger)' : 'var(--cyan)',
        }}
      >
        <Icon name={TYPE_ICONS[item.type] as any || 'i-calendar'} size={20} />
      </div>
      <span className="grow">
        <span className="h3" style={{ display: 'block' }}>{item.lesson}</span>
        <span className="small" style={{ display: 'block', marginTop: 4 }}>
          {item.teacher} · {item.time}
          {item.location ? ` · ${item.location}` : ''}
        </span>
        {item.note && (
          <span className="tiny" style={{ display: 'block', marginTop: 4, color: 'var(--ink-3)' }}>
            {item.note}
          </span>
        )}
      </span>
      <div style={{ textAlign: 'left', flexShrink: 0 }}>
        <span
          style={{
            fontSize: 10,
            padding: '3px 8px',
            borderRadius: 999,
            background: isExam ? 'var(--danger-soft)' : 'var(--paper-3)',
            color: isExam ? 'var(--danger)' : 'var(--ink-3)',
            whiteSpace: 'nowrap',
            display: 'inline-block',
          }}
        >
          {TYPE_LABELS[item.type] || item.type}
        </span>
        <div className="small mt-4" style={{ textAlign: 'left', direction: 'ltr' }}>{label}</div>
      </div>
    </div>
  );
}

/** برنامهٔ هفتگی — کلاس‌ها، امتحانات و تسک‌های مطالعه جلالی */
export function ScheduleScreen() {
  const [activeTab, setActiveTab] = useState<'timetable' | 'tasks'>('timetable');
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [days, setDays] = useState(7);
  const [meta, setMeta] = useState<{
    cohortTitle?: string;
    cohortIcon?: string;
    selected_count?: number;
    term?: string;
  }>({});

  // تسک‌های مطالعه جلالی
  const [tasks, setTasks] = useState<StudyTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDate, setTaskDate] = useState(getTodayJalali());
  const [taskTime, setTaskTime] = useState('');
  const [creatingTask, setCreatingTask] = useState(false);
  const [togglingTaskId, setTogglingTaskId] = useState<string | null>(null);

  const loadTimetable = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await schedule.list(days);
      const rawList = res.items || res.schedule || [];
      setItems(rawList);
      
      const g = res.group || res.computed_group || '';
      const edu = res.educational_group || '';
      let cTitle = '';
      let cIcon = '🎓';
      if (g === '1' && edu === 'male') {
        cTitle = 'گروه ۱ (برادران)';
        cIcon = '👨';
      } else if (g === '1' && edu === 'female') {
        cTitle = 'گروه ۱ (خواهران)';
        cIcon = '👩';
      } else if (g === '2' && edu === 'male') {
        cTitle = 'گروه ۲ (برادران)';
        cIcon = '👨';
      } else if (g === '2' && edu === 'female') {
        cTitle = 'گروه ۲ (خواهران)';
        cIcon = '👩';
      } else if (g) {
        cTitle = `گروه ${g}`;
      }
      setMeta({
        cohortTitle: cTitle,
        cohortIcon: cIcon,
        selected_count: res.selected_count,
        term: res.term,
      });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, [days]);

  const loadTasks = useCallback(async () => {
    setTasksLoading(true);
    setTasksError('');
    try {
      const res = await studyTasks.list();
      setTasks(res.tasks || []);
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

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim() || !taskDate.trim() || creatingTask) return;
    setCreatingTask(true);
    setTasksError('');
    try {
      await studyTasks.create({
        title: taskTitle.trim(),
        jalali_date: taskDate.trim(),
        reminder_time: taskTime.trim() || undefined,
      });
      setTaskTitle('');
      setTaskTime('');
      await loadTasks();
    } catch (err) {
      setTasksError(errorText(err, 'ثبت تسک مطالعه با خطا مواجه شد. فرمت تاریخ جلالی: YYYY-MM-DD'));
    } finally {
      setCreatingTask(false);
    }
  };

  const handleToggleTask = async (taskId: string) => {
    if (togglingTaskId) return;
    setTogglingTaskId(taskId);
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
      setTasksError(errorText(err, 'تغییر وضعیت تسک انجام نشد'));
    } finally {
      setTogglingTaskId(null);
    }
  };

  const exams = items.filter((i) => i.type === 'exam');
  const classes = items.filter((i) => i.type === 'class');

  return (
    <>
      <AppBar
        title="برنامه و تسک‌های مطالعه"
        sub="تقویم جلالی، کلاس‌ها و امتحانات"
      />
      <div className="page">
        {/* تب سوئیچ */}
        <div className="seg mt-8" role="tablist" aria-label="انتخاب بخش برنامه">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'tasks'}
            className={`seg__btn ${activeTab === 'tasks' ? 'is-on' : ''}`.trim()}
            onClick={() => setActiveTab('tasks')}
          >
            📋 تسک‌های مطالعه شخصی ({fa(tasks.filter((t) => !t.completed).length)})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'timetable'}
            className={`seg__btn ${activeTab === 'timetable' ? 'is-on' : ''}`.trim()}
            onClick={() => setActiveTab('timetable')}
          >
            🏛️ برنامه دانشگاهی ({fa(items.length)})
          </button>
        </div>

        {/* ═══════════ بخش اول: تسک‌های مطالعه جلالی ═══════════ */}
        {activeTab === 'tasks' && (
          <div className="mt-16">
            {/* فرم ثبت تسک */}
            <Card className="card--glass mb-16">
              <div className="h3 mb-8">افزودن برنامه مطالعه جدید</div>
              <form onSubmit={handleCreateTask}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <Input
                    label="عنوان مبحث یا تسک مطالعه"
                    placeholder="مثال: مرور مبحث آناتومی عروق یا تست فیزیولوژی کلیه"
                    value={taskTitle}
                    onChange={(e) => setTaskTitle(e.target.value)}
                    required
                  />

                  <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 160px' }}>
                      <Input
                        label="تاریخ جلالی (YYYY-MM-DD)"
                        placeholder="1405-08-16"
                        value={taskDate}
                        onChange={(e) => setTaskDate(e.target.value)}
                        required
                        code
                      />
                    </div>
                    <div style={{ flex: '1 1 120px' }}>
                      <Input
                        label="ساعت یادآوری (اختیاری)"
                        placeholder="18:00"
                        value={taskTime}
                        onChange={(e) => setTaskTime(e.target.value)}
                        code
                      />
                    </div>
                  </div>

                  <div className="row gap-8 mt-4">
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      loading={creatingTask}
                      disabled={!taskTitle.trim() || !taskDate.trim()}
                    >
                      افزودن به برنامه
                    </Button>
                  </div>
                </div>
              </form>
            </Card>

            {tasksError && (
              <div className="notice notice--warn mb-16" role="alert" style={{ color: 'var(--danger)' }}>
                <Icon name="i-alert-circle" size={16} />
                <span className="small">{tasksError}</span>
              </div>
            )}

            {tasksLoading ? (
              <SkeletonStack rows={4} />
            ) : tasks.length === 0 ? (
              <EmptyState
                icon="i-calendar"
                title="تسک مطالعه‌ای ثبت نشده"
                text="با افزودن اولین مبحث درسی، برنامه‌ریزی شخصی خود را بر اساس تقویم جلالی آغاز کن."
              />
            ) : (
              <Card variant="flush">
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {tasks.map((task) => {
                    const isToggling = togglingTaskId === task.task_id;
                    return (
                      <div
                        key={task.task_id}
                        className="list__item"
                        style={{
                          alignItems: 'center',
                          padding: '12px 16px',
                          borderBottom: '1px solid var(--line)',
                          opacity: task.completed ? 0.65 : 1,
                          transition: 'opacity var(--t-fast) ease',
                        }}
                      >
                        {/* چک‌باکس انجام */}
                        <button
                          type="button"
                          onClick={() => void handleToggleTask(task.task_id)}
                          disabled={isToggling}
                          aria-label={task.completed ? 'علامت‌گذاری به عنوان انجام‌نشده' : 'علامت‌گذاری به عنوان انجام‌شده'}
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 8,
                            border: `2px solid ${task.completed ? 'var(--hym-neon-cyan)' : 'var(--line-2)'}`,
                            background: task.completed ? 'var(--hym-neon-cyan)' : 'transparent',
                            color: task.completed ? 'var(--hym-slate-950)' : 'transparent',
                            display: 'grid',
                            placeItems: 'center',
                            cursor: 'pointer',
                            flexShrink: 0,
                            marginInlineEnd: 12,
                            transition: 'all var(--t-fast) ease',
                          }}
                        >
                          <Icon name="i-check" size={16} />
                        </button>

                        <div className="grow">
                          <span
                            className="h3"
                            style={{
                              display: 'block',
                              fontSize: 14.5,
                              textDecoration: task.completed ? 'line-through' : 'none',
                              color: task.completed ? 'var(--ink-3)' : 'var(--ink)',
                            }}
                          >
                            {task.title}
                          </span>
                          <div className="row gap-6 mt-4" style={{ alignItems: 'center' }}>
                            <span className="tiny color-muted" style={{ direction: 'ltr' }}>
                              📅 {task.jalali_date}
                            </span>
                            {task.reminder_time && (
                              <span className="tiny color-muted" style={{ direction: 'ltr' }}>
                                ⏰ {task.reminder_time}
                              </span>
                            )}
                            {task.completed && (
                              <Chip variant="cyan">انجام شد</Chip>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}
          </div>
        )}

        {/* ═══════════ بخش دوم: برنامه دانشگاهی ═══════════ */}
        {activeTab === 'timetable' && (
          <div className="mt-16">
            {meta.cohortTitle && (
              <div
                className="card card--glass mb-16"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  background: 'linear-gradient(135deg, rgba(0,229,255,0.08) 0%, rgba(0,112,243,0.08) 100%)',
                  border: '1px solid rgba(0,229,255,0.25)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 22 }}>{meta.cohortIcon}</span>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--ink)' }}>
                      {meta.cohortTitle}
                    </div>
                    <div className="tiny" style={{ color: 'var(--ink-3)', marginTop: 2 }}>
                      {meta.selected_count ? `${fa(meta.selected_count)} درس در برنامه شما` : 'برنامه پیش‌فرض گروه'}
                      {meta.term ? ` · ترم ${meta.term}` : ''}
                    </div>
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    padding: '4px 10px',
                    borderRadius: 999,
                    background: 'rgba(0,229,255,0.15)',
                    color: '#00E5FF',
                    fontWeight: 700,
                  }}
                >
                  همگام با ربات ✅
                </span>
              </div>
            )}

            {/* فیلتر بازه */}
            <div className="row gap-8 mb-12" style={{ overflowX: 'auto', paddingBottom: 4 }}>
              {[7, 14, 30].map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className="btn btn--sm"
                  style={{
                    background: days === d ? 'var(--brand)' : 'var(--paper-3)',
                    color: days === d ? 'var(--on-brand)' : 'var(--ink)',
                    borderColor: days === d ? 'var(--brand)' : 'var(--line)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {d === 7 ? 'هفته' : d === 14 ? '۲ هفته' : 'ماه'}
                </button>
              ))}
            </div>

            {loading && <div className="mt-8"><SkeletonStack rows={5} /></div>}

            {error && !loading && (
              <div className="mt-16" style={{ textAlign: 'center' }}>
                <p className="body">{error}</p>
                <button className="btn mt-8" onClick={loadTimetable}>تلاش دوباره</button>
              </div>
            )}

            {!loading && !error && items.length === 0 && (
              <div className="mt-16">
                <EmptyState
                  icon="i-calendar"
                  title="برنامه‌ای نیست"
                  text="در این بازه هیچ کلاس یا امتحانی ثبت نشده."
                />
              </div>
            )}

            {/* امتحان‌ها */}
            {!loading && !error && exams.length > 0 && (
              <>
                <div className="row row--between mt-16">
                  <div className="h3">امتحان‌ها</div>
                  <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 999, background: 'var(--danger-soft)', color: 'var(--danger)', fontWeight: 700 }}>
                    {fa(exams.length)}
                  </span>
                </div>
                <Card variant="flush" className="mt-8">
                  {exams.map((item) => (
                    <ScheduleRow key={item.id} item={item} />
                  ))}
                </Card>
              </>
            )}

            {/* کلاس‌ها */}
            {!loading && !error && classes.length > 0 && (
              <>
                <div className="row row--between mt-16">
                  <div className="h3">کلاس‌ها</div>
                  <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 999, background: 'var(--paper-3)', color: 'var(--ink-3)', fontWeight: 700 }}>
                    {fa(classes.length)}
                  </span>
                </div>
                <Card variant="flush" className="mt-8">
                  {classes.map((item) => (
                    <ScheduleRow key={item.id} item={item} />
                  ))}
                </Card>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
