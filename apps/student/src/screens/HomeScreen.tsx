import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { AppBar, Card, Chip, ProgressBar, SkeletonStack } from '../components';
import { InstallCard } from '../components/InstallPrompt';
import { Icon } from '../icons';
import type { IconName } from '../icons/sprite';
import { dashboard } from '../lib/dashboard';
import type { DashboardPayload, SubscriptionStatus, UpcomingExam, WeeklyActivityItem } from '../lib/dashboard';
import { reader, readerPath } from '../lib/reader';
import type { ContinueItem } from '../lib/reader';
import { studyTasks } from '../lib/schedule';
import type { StudyTask } from '../lib/schedule';
import { useSession } from '../lib/session';
import { errorText } from '../lib/api';
import { fa } from '../lib/library';
import { groupLabel, intakeLabel } from '../lib/intake';

/* ═══════════════════════════════════════════════════════════════════
   توابع کمکی فرمت‌بندی جلالی و اعداد
   ═══════════════════════════════════════════════════════════════════ */

function formatJalali(dateStr?: string | null): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(d);
  } catch {
    return dateStr;
  }
}

function getMonogram(name?: string): string {
  if (!name) return 'هـ';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] || '') + (parts[1][0] || '');
}

const PERSIAN_WEEK_DAYS = [
  { key: 'sat', fa: 'ش', full: 'شنبه' },
  { key: 'sun', fa: 'ی', full: 'یکشنبه' },
  { key: 'mon', fa: 'د', full: 'دوشنبه' },
  { key: 'tue', fa: 'س', full: 'سه‌شنبه' },
  { key: 'wed', fa: 'چ', full: 'چهارشنبه' },
  { key: 'thu', fa: 'پ', full: 'پنجشنبه' },
  { key: 'fri', fa: 'ج', full: 'جمعه' },
];

/* ═══════════════════════════════════════════════════════════════════
   ۱. کارت پروفایل دانشجو و ترم تحصیلی (Hero Command Card)
   ═══════════════════════════════════════════════════════════════════ */

interface ProfileCardProps {
  displayName: string;
  studentId?: string;
  intake?: string;
  group?: string;
  prestigeTitle?: string;
  prestigeLevel?: number;
  subStatus: SubscriptionStatus | null;
}

function StudentProfileHeroCard({
  displayName,
  studentId,
  intake,
  group,
  prestigeTitle,
  prestigeLevel,
  subStatus,
}: ProfileCardProps) {
  const monogram = getMonogram(displayName);

  // وضعیت و روزهای اشتراک
  const isSubActive = subStatus?.active ?? false;
  const daysLeft = subStatus?.days_left ?? 0;
  const planName = subStatus?.plan_name || 'اشتراک ویژه هوش‌یار';
  const expireJalali = subStatus?.expires ? formatJalali(subStatus.expires) : '';

  return (
    <Card className="command-hero-card card--glass mt-12">
      <div className="hero-grid">
        {/* آواتار و مونوگرام با هالهٔ درخشان رنک پرستیژ */}
        <div className="avatar-container">
          <div className="avatar-glow-ring">
            <div className="avatar-monogram">{monogram}</div>
          </div>
          {prestigeLevel !== undefined && prestigeLevel > 0 && (
            <div className="avatar-level-badge" title={`سطح ${fa(prestigeLevel)}`}>
              {fa(prestigeLevel)}
            </div>
          )}
        </div>

        {/* مشخصات هویتی و آکادمیک */}
        <div className="hero-info grow">
          <div className="hero-header-row">
            <h2 className="hero-name">{displayName}</h2>
            {prestigeTitle && (
              <span className="prestige-title-badge">
                <Icon name="i-award" size={14} />
                <span>{prestigeTitle}</span>
              </span>
            )}
          </div>

          <div className="hero-meta-row mt-4">
            {studentId && (
              <span className="hero-meta-item">
                <Icon name="i-user" size={14} />
                <span>شماره دانشجویی: <strong>{fa(studentId)}</strong></span>
              </span>
            )}
            {intake && (
              <span className="hero-meta-chip intake-chip">
                <Icon name="i-calendar" size={13} />
                <span>{intake}</span>
              </span>
            )}
            {group && (
              <span className="hero-meta-chip group-chip">
                <span>{group}</span>
              </span>
            )}
          </div>
        </div>

        {/* وضعیت اشتراک و روزشمار جلالی */}
        <div className="hero-sub-status">
          <Link to="/subscription" className="sub-badge-link" title="مدیریت اشتراک">
            <div className={`sub-status-box ${isSubActive ? 'sub-status-box--active' : 'sub-status-box--inactive'}`}>
              <div className="sub-icon-row">
                <Icon name={isSubActive ? 'i-shield' : 'i-alert-circle'} size={16} />
                <span className="sub-plan-name">{planName}</span>
              </div>
              <div className="sub-countdown-row mt-4">
                {isSubActive ? (
                  daysLeft <= 5 ? (
                    <span className="sub-chip sub-chip--danger">{fa(daysLeft)} روز تا تمدید</span>
                  ) : daysLeft <= 14 ? (
                    <span className="sub-chip sub-chip--warn">{fa(daysLeft)} روز تا تمدید</span>
                  ) : (
                    <span className="sub-chip sub-chip--cyan">{fa(daysLeft)} روز مانده ({expireJalali})</span>
                  )
                ) : (
                  <span className="sub-chip sub-chip--expired">نیاز به تمدید اشتراک</span>
                )}
              </div>
            </div>
          </Link>
        </div>
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ۲. کارت ادامه مطالعه (Continue Reading Card)
   ═══════════════════════════════════════════════════════════════════ */

function ContinueReadingCard({ item }: { item: ContinueItem | null }) {
  if (!item) {
    return (
      <Card className="continue-card continue-card--empty mt-16 card--glass">
        <div className="continue-empty-body">
          <div className="continue-empty-icon">
            <Icon name="i-book-open" size={28} />
          </div>
          <div className="continue-empty-text grow">
            <div className="h3">مطالعه جزوات و کتب مرجع</div>
            <div className="small color-muted mt-4">
              هنوز مطالعه جزوه‌ای را شروع نکرده‌اید. کتابخانه را باز کرده و مطالعه را آغاز کنید.
            </div>
          </div>
          <Link to="/library" className="btn btn--brand btn--sm">
            ورود به کتابخانه
          </Link>
        </div>
      </Card>
    );
  }

  const resumeUrl = `${readerPath(item.scope, item.id)}?p=${item.page}`;
  const percentVal = Math.min(100, Math.max(0, item.percent || 0));

  return (
    <div className="continue-reading-container mt-16">
      <div className="section-header-row mb-8">
        <div className="section-title">
          <Icon name="i-book-open" size={18} className="color-brand" />
          <span>ادامه مطالعه</span>
        </div>
        <Link to="/library" className="small link-accent">
          مشاهده تمام جزوات
        </Link>
      </div>

      <Link to={resumeUrl} className="continue-card-link">
        <Card className="continue-card card--glass">
          <div className="continue-card-body">
            <div className="continue-booklet-icon">
              <Icon name="i-doc" size={24} />
            </div>

            <div className="continue-details grow">
              <div className="continue-title-row">
                <h3 className="continue-title">{item.name}</h3>
                <span className="continue-percent-badge">{fa(percentVal)}٪</span>
              </div>

              <div className="continue-page-info mt-4">
                <span>صفحه {fa(item.page)} از {fa(item.total)}</span>
                <span className="dot-separator">·</span>
                <span className="color-muted">کلیک برای ادامه از همین صفحه</span>
              </div>

              <div className="continue-progress mt-8">
                <ProgressBar value={percentVal} />
              </div>
            </div>

            <div className="continue-action-arrow">
              <Icon name="i-chevron" size={20} />
            </div>
          </div>
        </Card>
      </Link>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ۳. گرید ۴ ویجت آنالیتیکس بالینی (Clinical Analytics Grid)
   ═══════════════════════════════════════════════════════════════════ */

interface AnalyticsProps {
  streak: number;
  bestStreak: number;
  accuracy: number;
  totalAnswers: number;
  correctAnswers: number;
  weekly: WeeklyActivityItem[];
}

function ClinicalAnalyticsGrid({
  streak,
  bestStreak,
  accuracy,
  totalAnswers,
  correctAnswers,
  weekly,
}: AnalyticsProps) {
  // آماده‌سازی داده‌های نمودار ۷ روزه
  const weeklyCounts = weekly && weekly.length > 0 ? weekly : [];
  const maxActivity = Math.max(1, ...weeklyCounts.map((w) => w.count || 0));

  // محیط دایره سنجش درستی SVG (Radius = 24 -> C = 2 * PI * 24 = 150.8)
  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (Math.min(100, Math.max(0, accuracy)) / 100) * circumference;

  return (
    <div className="analytics-section mt-20">
      <div className="section-title mb-10">
        <Icon name="i-trend" size={18} className="color-cyan" />
        <span>آنالیتیکس و عملکرد بالینی</span>
      </div>

      <div className="analytics-grid">
        {/* ۱. روزشمار استریک پیوستگی مطالعه */}
        <Card className="analytics-card card--glass">
          <div className="analytics-header">
            <div className="analytics-icon-box analytics-icon--fire">
              <Icon name="i-trend" size={20} />
            </div>
            <span className="analytics-tag">پیوستگی مطالعه</span>
          </div>
          <div className="analytics-value-row mt-10">
            <span className="analytics-number">{fa(streak)}</span>
            <span className="analytics-unit">روز</span>
          </div>
          <div className="analytics-subtext mt-4">
            🔥 بهترین رکورد: <strong>{fa(bestStreak)}</strong> روز مداوم
          </div>
        </Card>

        {/* ۲. نرخ درستی پاسخ‌ها با گیج چرخشی مدرن */}
        <Card className="analytics-card card--glass">
          <div className="analytics-header">
            <div className="analytics-icon-box analytics-icon--target">
              <Icon name="i-target" size={20} />
            </div>
            <span className="analytics-tag">درستی پاسخ‌ها</span>
          </div>
          <div className="accuracy-widget-content mt-8">
            <div className="accuracy-circular-gauge">
              <svg width="60" height="60" viewBox="0 0 60 60" className="gauge-svg">
                <circle
                  cx="30"
                  cy="30"
                  r={radius}
                  className="gauge-bg-circle"
                  strokeWidth="5"
                  fill="none"
                />
                <circle
                  cx="30"
                  cy="30"
                  r={radius}
                  className="gauge-progress-circle"
                  strokeWidth="5"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
              <div className="gauge-center-text">{fa(accuracy)}٪</div>
            </div>
            <div className="accuracy-stats-details">
              <div className="small color-muted">پاسخ‌های صحیح:</div>
              <div className="h3 mt-2">{fa(correctAnswers)} <span className="small color-muted">از {fa(totalAnswers)}</span></div>
            </div>
          </div>
        </Card>

        {/* ۳. حجم تست‌زنی و سؤالات حل‌شده */}
        <Card className="analytics-card card--glass">
          <div className="analytics-header">
            <div className="analytics-icon-box analytics-icon--flask">
              <Icon name="i-flask" size={20} />
            </div>
            <span className="analytics-tag">تست‌های تمرینی</span>
          </div>
          <div className="analytics-value-row mt-10">
            <span className="analytics-number">{fa(totalAnswers)}</span>
            <span className="analytics-unit">سؤال</span>
          </div>
          <div className="analytics-subtext mt-4">
            📚 ارزیابی هوشمند در بانک سؤالات
          </div>
        </Card>

        {/* ۴. نمودار هیستوگرام فعالیت ۷ روز اخیر */}
        <Card className="analytics-card card--glass weekly-activity-card">
          <div className="analytics-header">
            <div className="analytics-icon-box analytics-icon--calendar">
              <Icon name="i-calendar" size={20} />
            </div>
            <span className="analytics-tag">فعالیت ۷ روز گذشته</span>
          </div>

          <div className="weekly-chart-container mt-12">
            {PERSIAN_WEEK_DAYS.map((d, idx) => {
              const dayItem = weeklyCounts[idx];
              const count = dayItem ? dayItem.count : 0;
              const barHeightPct = maxActivity > 0 ? Math.max(12, Math.round((count / maxActivity) * 100)) : 12;

              return (
                <div key={d.key} className="chart-col" title={`${d.full}: ${fa(count)} فعالیت`}>
                  <div className="chart-bar-track">
                    <div
                      className={`chart-bar-fill ${count > 0 ? 'chart-bar-fill--active' : ''}`}
                      style={{ height: `${barHeightPct}%` }}
                    />
                  </div>
                  <span className="chart-day-label">{d.fa}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ۴. ویجت روزشمار امتحانات جلالی و تسک‌های درسی
   ═══════════════════════════════════════════════════════════════════ */

interface UpcomingExamsWidgetProps {
  exams: UpcomingExam[];
  tasks: StudyTask[];
  onToggleTask: (taskId: string) => Promise<void>;
}

function UpcomingJalaliExamsAndTasksWidget({ exams, tasks, onToggleTask }: UpcomingExamsWidgetProps) {
  const [activeTab, setActiveTab] = useState<'exams' | 'tasks'>('exams');

  const getUrgencyChip = (daysLeft: number | null) => {
    if (daysLeft === null) return null;
    if (daysLeft === 0) return <Chip variant="danger">امروز!</Chip>;
    if (daysLeft <= 3) return <Chip variant="danger">بسیار نزدیک ({fa(daysLeft)} روز)</Chip>;
    if (daysLeft <= 7) return <Chip variant="amber">نزدیک ({fa(daysLeft)} روز)</Chip>;
    return <Chip variant="cyan">{fa(daysLeft)} روز مانده</Chip>;
  };

  return (
    <div className="upcoming-section mt-20">
      <div className="section-header-row mb-10">
        <div className="section-title">
          <Icon name="i-calendar" size={18} className="color-brand" />
          <span>امتحانات و برنامه‌ریزی مطالعه</span>
        </div>
        <div className="tab-pill-toggle">
          <button
            type="button"
            className={`pill-btn ${activeTab === 'exams' ? 'pill-btn--active' : ''}`}
            onClick={() => setActiveTab('exams')}
          >
            امتحانات ({fa(exams.length)})
          </button>
          <button
            type="button"
            className={`pill-btn ${activeTab === 'tasks' ? 'pill-btn--active' : ''}`}
            onClick={() => setActiveTab('tasks')}
          >
            تسک‌ها ({fa(tasks.length)})
          </button>
        </div>
      </div>

      {activeTab === 'exams' ? (
        exams.length > 0 ? (
          <Card className="exams-container-card card--glass">
            <div className="exams-list">
              {exams.map((exam) => (
                <div key={exam.id || exam.lesson} className="exam-card-row">
                  <div className="exam-icon-wrapper">
                    <Icon name="i-calendar" size={20} />
                  </div>
                  <div className="exam-info-grow grow">
                    <div className="exam-title-line">
                      <span className="exam-lesson-name">{exam.lesson}</span>
                      {exam.course_code && (
                        <span className="exam-code-tag">کد: {fa(exam.course_code)}</span>
                      )}
                    </div>
                    <div className="exam-meta-line mt-4">
                      {exam.time && <span>ساعت {exam.time}</span>}
                      {exam.date && <span>· {formatJalali(exam.date)}</span>}
                      {exam.teacher && <span>· استاد {exam.teacher}</span>}
                    </div>
                  </div>
                  <div className="exam-urgency-wrapper">
                    {getUrgencyChip(exam.days_left)}
                  </div>
                </div>
              ))}
            </div>
            <div className="exams-card-footer mt-10">
              <Link to="/schedule" className="small link-accent">
                مشاهده کل تقویم امتحانات و برنامه هفتگی ←
              </Link>
            </div>
          </Card>
        ) : (
          <Card className="empty-exams-card card--glass">
            <div className="row gap-12" style={{ alignItems: 'center' }}>
              <div className="ibox ibox--cyan" style={{ width: 40, height: 40, borderRadius: 12 }}>
                <Icon name="i-check" size={20} />
              </div>
              <div className="grow">
                <div className="h3">امتحان پیش‌رویی در ۷ روز آینده ثبت نشده است</div>
                <div className="small color-muted mt-2">برنامه کامل ترم را در تقویم بررسی کنید.</div>
              </div>
              <Link to="/schedule" className="btn btn--sm">تقویم</Link>
            </div>
          </Card>
        )
      ) : (
        /* تب تسک‌های مطالعه جلالی */
        tasks.length > 0 ? (
          <Card className="tasks-container-card card--glass">
            <div className="tasks-list">
              {tasks.slice(0, 5).map((task) => (
                <div key={task.task_id} className="task-row">
                  <button
                    type="button"
                    className={`task-checkbox ${task.completed ? 'task-checkbox--checked' : ''}`}
                    onClick={() => void onToggleTask(task.task_id)}
                    aria-label={task.completed ? 'علامت به عنوان انجام نشده' : 'علامت به عنوان انجام شده'}
                  >
                    {task.completed && <Icon name="i-check" size={14} />}
                  </button>
                  <div className="task-info grow">
                    <div className={`task-title ${task.completed ? 'task-title--done' : ''}`}>
                      {task.title}
                    </div>
                    <div className="task-date-line mt-2">
                      <span className="small color-muted">تاریخ: {fa(task.jalali_date)}</span>
                      {task.reminder_time && (
                        <span className="small color-muted"> · یادآور: {task.reminder_time}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="tasks-footer mt-10">
              <Link to="/schedule" className="small link-accent">
                مدیریت همه تسک‌های مطالعه در تقویم ←
              </Link>
            </div>
          </Card>
        ) : (
          <Card className="empty-tasks-card card--glass">
            <div className="row gap-12" style={{ alignItems: 'center' }}>
              <div className="ibox" style={{ width: 40, height: 40, borderRadius: 12 }}>
                <Icon name="i-calendar" size={20} />
              </div>
              <div className="grow">
                <div className="h3">تسکی برای امروز ثبت نشده است</div>
                <div className="small color-muted mt-2">برای مدیریت ساعات مطالعه خود، تسک‌های شخصی اضافه کنید.</div>
              </div>
              <Link to="/schedule" className="btn btn--brand btn--sm">ثبت تسک جدید</Link>
            </div>
          </Card>
        )
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ۵. شبکه دسترسی سریع فرماندهی (۷ ماژول پلتفرم)
   ═══════════════════════════════════════════════════════════════════ */

interface QuickAction {
  to: string;
  label: string;
  sub: string;
  icon: IconName;
  tag: string;
  colorScheme: 'brand' | 'cyan' | 'neon' | 'amber' | 'emerald' | 'indigo' | 'purple';
}

const COMMAND_MODULES: QuickAction[] = [
  {
    to: '/exam',
    label: 'بانک سؤال (QBank)',
    sub: 'تمرین بالینی و آزمون زمان‌دار',
    icon: 'i-flask',
    tag: 'آزمون‌ها',
    colorScheme: 'brand',
  },
  {
    to: '/library',
    label: 'کتابخانه مرجع',
    sub: 'جزوات، کتب و ویدیوهای آموزشی',
    icon: 'i-book',
    tag: 'منابع درسی',
    colorScheme: 'cyan',
  },
  {
    to: '/me/notes',
    label: 'کتابخوان و قلم دیجیتال',
    sub: 'مطالعه PDF و حاشیه‌نویسی هوشمند',
    icon: 'i-pen',
    tag: 'یادداشت‌ها',
    colorScheme: 'neon',
  },
  {
    to: '/ai',
    label: 'هوش‌یار بالینی (AI)',
    sub: 'دستیار پزشکی، سناریو و تحلیل تصویر',
    icon: 'i-chat',
    tag: 'هوش مصنوعی',
    colorScheme: 'indigo',
  },
  {
    to: '/grades',
    label: 'کارنامه و GPA',
    sub: 'ریز نمرات و معدل وزنی تحصیلی',
    icon: 'i-award',
    tag: 'سوابق آموزشی',
    colorScheme: 'amber',
  },
  {
    to: '/schedule',
    label: 'برنامه و تقویم مطالعه',
    sub: 'کلاس‌های هفتگی و تسک‌های جلالی',
    icon: 'i-calendar',
    tag: 'زمان‌بندی',
    colorScheme: 'emerald',
  },
  {
    to: '/tickets',
    label: 'پشتیبانی دانشجویی',
    sub: 'ارسال تیکت و راهنمای تحصیلی',
    icon: 'i-message-circle',
    tag: 'پاسخگویی',
    colorScheme: 'purple',
  },
];

function QuickAccessCommandGrid() {
  return (
    <div className="quick-access-section mt-24 mb-32">
      <div className="section-title mb-12">
        <Icon name="i-grid" size={18} className="color-brand" />
        <span>ماژول‌های مرکز فرماندهی</span>
      </div>

      <div className="command-grid">
        {COMMAND_MODULES.map((mod) => (
          <Link key={mod.to} to={mod.to} className="command-card-link">
            <Card className={`command-card card--glass command-card--${mod.colorScheme}`}>
              <div className="command-card-inner">
                <div className="command-card-top">
                  <div className={`command-icon-box command-icon--${mod.colorScheme}`}>
                    <Icon name={mod.icon} size={22} />
                  </div>
                  <span className={`command-tag command-tag--${mod.colorScheme}`}>{mod.tag}</span>
                </div>
                <div className="command-card-bottom mt-12">
                  <h4 className="command-title">{mod.label}</h4>
                  <p className="command-sub mt-2">{mod.sub}</p>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   صفحه اصلی داشبورد فرماندهی دانشجو (Flagship Command Center)
   ═══════════════════════════════════════════════════════════════════ */

export function HomeScreen() {
  const { user } = useSession();
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [recent, setRecent] = useState<ContinueItem[]>([]);
  const [subStatus, setSubStatus] = useState<SubscriptionStatus | null>(null);
  const [tasks, setTasks] = useState<StudyTask[]>([]);
  const [weekly, setWeekly] = useState<WeeklyActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [dRes, rRes, subRes, tasksRes, weeklyRes] = await Promise.all([
        dashboard.overview(),
        reader.recent().catch(() => ({ items: [] as ContinueItem[] })),
        dashboard.subscriptionStatus().catch(() => null),
        studyTasks.list().catch(() => ({ tasks: [] as StudyTask[] })),
        dashboard.weekly().catch(() => ({ weekly: [] as WeeklyActivityItem[] })),
      ]);

      setData(dRes);
      setRecent(rRes.items || []);
      setSubStatus(subRes);
      setTasks(tasksRes.tasks || []);
      setWeekly(weeklyRes.weekly || []);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleToggleTask = async (taskId: string) => {
    try {
      // به‌روزرسانی پیش‌دستانه (optimistic update)
      setTasks((prev) =>
        prev.map((t) => (t.task_id === taskId ? { ...t, completed: !t.completed } : t)),
      );
      await studyTasks.toggle(taskId);
    } catch (err) {
      // واگردانی در صورت خطا
      void loadData();
    }
  };

  const displayName = data?.user?.display_name || user?.name || 'دانشجوی گرامی';
  const studentId = user?.student_id || data?.user?.student_id || '';
  const intake = intakeLabel(data?.user?.intake || user?.intake);
  const group = groupLabel(data?.user?.group || user?.group);
  const prestigeTitle = (data?.prestige?.level_title as string) || '';
  const prestigeLevel = typeof data?.prestige?.level === 'number' ? data.prestige.level : undefined;

  const stats = data?.stats;
  const streak = (data?.prestige?.streak?.current as number) || stats?.streak_days || 0;
  const bestStreak = (data?.prestige?.streak?.best as number) || streak;
  const totalAnswers = stats?.total_answers || 0;
  const correctAnswers = stats?.correct_answers || 0;
  const accuracy = stats?.accuracy ?? (totalAnswers > 0 ? Math.round((correctAnswers / totalAnswers) * 100) : 0);

  if (loading) {
    return (
      <>
        <AppBar title="مرکز فرماندهی هوش‌یار" sub="در حال دریافت داده‌های بالینی…" />
        <div className="page flagship-dashboard-page">
          <SkeletonStack rows={8} />
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <AppBar title="مرکز فرماندهی هوش‌یار" sub="عدم اتصال به سرور" />
        <div className="page flagship-dashboard-page text-center pt-48">
          <div className="color-danger opacity-75 mb-16">
            <Icon name="i-alert-circle" size={54} />
          </div>
          <h3 className="h2">خطا در بارگذاری داشبورد</h3>
          <p className="body color-muted mt-8 mb-24">{error}</p>
          <button type="button" className="btn btn--brand" onClick={loadData}>
            تلاش مجدد
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <AppBar
        title={`سلام، ${displayName.split(' ')[0]}`}
        sub="مرکز جامع فرماندهی و ارزیابی بالینی هامزیار"
        actions={
          <div className="row gap-12" style={{ alignItems: 'center' }}>
            <Link to="/search" className="header-action-btn" title="جستجو در سامانه">
              <Icon name="i-search" size={20} />
            </Link>
            <Link to="/notifications" className="header-action-btn" title="اعلانات">
              <Icon name="i-bell" size={20} />
            </Link>
          </div>
        }
      />

      <div className="page flagship-dashboard-page page-enter">
        {/* ۱. هیرو کارت پروفایل دانشجو و ترم تحصیلی */}
        <StudentProfileHeroCard
          displayName={displayName}
          studentId={studentId}
          intake={intake}
          group={group}
          prestigeTitle={prestigeTitle}
          prestigeLevel={prestigeLevel}
          subStatus={subStatus}
        />

        {/* ۲. کارت هوشمند ادامه مطالعه جزوه و کتاب */}
        <ContinueReadingCard item={recent.length > 0 ? recent[0] : null} />

        {/* install to home screen: here only, once, never in standalone (audit G1) */}
        <InstallCard />

        {/* ۳. گرید ۴ ویجت آنالیتیکس بالینی و استریک پیوستگی */}
        <ClinicalAnalyticsGrid
          streak={streak}
          bestStreak={bestStreak}
          accuracy={accuracy}
          totalAnswers={totalAnswers}
          correctAnswers={correctAnswers}
          weekly={weekly}
        />

        {/* ۴. ویجت روزشمار امتحانات جلالی و تسک‌های تحصیلی */}
        <UpcomingJalaliExamsAndTasksWidget
          exams={data?.upcoming_exams || []}
          tasks={tasks}
          onToggleTask={handleToggleTask}
        />

        {/* ۵. شبکه دسترسی سریع فرماندهی (۷ ماژول) */}
        <QuickAccessCommandGrid />
      </div>

      <style>{`
        .flagship-dashboard-page {
          max-width: 1200px;
          margin: 0 auto;
          padding-bottom: 80px;
        }

        /* ── Hero Card ── */
        .command-hero-card {
          padding: 20px;
          border-radius: var(--hym-radius-xl, 20px);
          border: 1px solid var(--hym-border-default, rgba(56, 189, 248, 0.15));
          background: var(--glass-bg, rgba(15, 23, 42, 0.75));
          backdrop-filter: var(--glass-blur, blur(16px));
          box-shadow: var(--hym-shadow-md, 0 4px 6px -1px rgba(0, 0, 0, 0.4));
        }

        .hero-grid {
          display: flex;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
        }

        .avatar-container {
          position: relative;
          flex-shrink: 0;
        }

        .avatar-glow-ring {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: linear-gradient(135deg, var(--hym-brand-600, #2563EB), var(--hym-neon-cyan, #00F2FE));
          padding: 2px;
          box-shadow: 0 0 16px -2px rgba(0, 242, 254, 0.45);
          display: grid;
          place-items: center;
        }

        .avatar-monogram {
          width: 100%;
          height: 100%;
          border-radius: 50%;
          background: var(--hym-bg-surface-raised, #1E293B);
          color: var(--hym-text-primary, #F8FAFC);
          font-weight: 700;
          font-size: 1.15rem;
          display: grid;
          place-items: center;
          letter-spacing: -0.5px;
        }

        .avatar-level-badge {
          position: absolute;
          bottom: -4px;
          left: -4px;
          background: var(--hym-neon-cyan, #00F2FE);
          color: #0B0F19;
          font-size: 0.72rem;
          font-weight: 800;
          padding: 1px 6px;
          border-radius: 999px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4);
        }

        .hero-info {
          min-width: 220px;
        }

        .hero-header-row {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .hero-name {
          font-size: 1.25rem;
          font-weight: 700;
          margin: 0;
          color: var(--hym-text-primary, #F8FAFC);
        }

        .prestige-title-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background: rgba(0, 242, 254, 0.12);
          color: var(--hym-neon-cyan, #00F2FE);
          border: 1px solid rgba(0, 242, 254, 0.25);
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 0.75rem;
          font-weight: 600;
        }

        .hero-meta-row {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          font-size: 0.82rem;
          color: var(--hym-text-secondary, #94A3B8);
        }

        .hero-meta-item {
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }

        .hero-meta-chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 8px;
          border-radius: 6px;
          font-size: 0.78rem;
        }

        .intake-chip {
          background: rgba(37, 99, 235, 0.15);
          color: var(--hym-brand-400, #60A5FA);
        }

        .group-chip {
          background: rgba(148, 163, 184, 0.15);
          color: var(--hym-text-secondary, #94A3B8);
        }

        .hero-sub-status {
          margin-inline-start: auto;
        }

        .sub-badge-link {
          text-decoration: none;
          display: block;
        }

        .sub-status-box {
          padding: 8px 14px;
          border-radius: 12px;
          border: 1px solid rgba(56, 189, 248, 0.2);
          transition: transform 0.15s ease, border-color 0.15s ease;
        }

        .sub-status-box:hover {
          transform: translateY(-2px);
          border-color: var(--hym-neon-cyan, #00F2FE);
        }

        .sub-status-box--active {
          background: rgba(37, 99, 235, 0.1);
        }

        .sub-status-box--inactive {
          background: rgba(244, 63, 94, 0.1);
          border-color: rgba(244, 63, 94, 0.3);
        }

        .sub-icon-row {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--hym-brand-400, #60A5FA);
        }

        .sub-chip {
          font-size: 0.74rem;
          padding: 2px 6px;
          border-radius: 4px;
          font-weight: 600;
        }

        .sub-chip--cyan {
          background: rgba(0, 242, 254, 0.15);
          color: var(--hym-neon-cyan, #00F2FE);
        }

        .sub-chip--warn {
          background: rgba(245, 158, 11, 0.15);
          color: #F59E0B;
        }

        .sub-chip--danger, .sub-chip--expired {
          background: rgba(244, 63, 94, 0.15);
          color: #F43F5E;
        }

        /* ── Continue Reading Card ── */
        .section-header-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .section-title {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 1.05rem;
          font-weight: 700;
          color: var(--hym-text-primary, #F8FAFC);
        }

        .link-accent {
          color: var(--hym-neon-cyan, #00F2FE);
          text-decoration: none;
          font-weight: 600;
        }

        .continue-card-link {
          display: block;
          text-decoration: none;
          color: inherit;
        }

        .continue-card {
          padding: 16px;
          border-radius: var(--hym-radius-lg, 14px);
          border-inline-start: 4px solid var(--hym-neon-cyan, #00F2FE);
          transition: transform 0.18s ease, box-shadow 0.18s ease;
        }

        .continue-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.5);
        }

        .continue-card-body {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .continue-booklet-icon {
          width: 48px;
          height: 48px;
          border-radius: 12px;
          background: rgba(37, 99, 235, 0.15);
          color: var(--hym-neon-cyan, #00F2FE);
          display: grid;
          place-items: center;
          flex-shrink: 0;
        }

        .continue-title-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .continue-title {
          font-size: 1.05rem;
          font-weight: 700;
          margin: 0;
          color: var(--hym-text-primary, #F8FAFC);
        }

        .continue-percent-badge {
          font-size: 0.82rem;
          font-weight: 800;
          color: var(--hym-neon-cyan, #00F2FE);
        }

        .continue-page-info {
          font-size: 0.8rem;
          color: var(--hym-text-secondary, #94A3B8);
        }

        .dot-separator {
          margin: 0 6px;
        }

        .continue-action-arrow {
          color: var(--hym-text-muted, #64748B);
          transition: transform 0.15s ease;
        }

        .continue-card:hover .continue-action-arrow {
          transform: translateX(-4px);
          color: var(--hym-neon-cyan, #00F2FE);
        }

        .continue-empty-body {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 8px;
        }

        .continue-empty-icon {
          width: 48px;
          height: 48px;
          border-radius: 12px;
          background: rgba(56, 189, 248, 0.1);
          color: var(--hym-brand-400, #60A5FA);
          display: grid;
          place-items: center;
          flex-shrink: 0;
        }

        /* ── Analytics Grid ── */
        .analytics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 14px;
        }

        .analytics-card {
          padding: 16px;
          border-radius: var(--hym-radius-lg, 14px);
        }

        .analytics-header {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .analytics-icon-box {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          display: grid;
          place-items: center;
        }

        .analytics-icon--fire {
          background: rgba(245, 158, 11, 0.15);
          color: #F59E0B;
        }

        .analytics-icon--target {
          background: rgba(16, 185, 129, 0.15);
          color: #10B981;
        }

        .analytics-icon--flask {
          background: rgba(0, 242, 254, 0.15);
          color: var(--hym-neon-cyan, #00F2FE);
        }

        .analytics-icon--calendar {
          background: rgba(37, 99, 235, 0.15);
          color: var(--hym-brand-400, #60A5FA);
        }

        .analytics-tag {
          font-size: 0.82rem;
          font-weight: 600;
          color: var(--hym-text-secondary, #94A3B8);
        }

        .analytics-value-row {
          display: flex;
          align-items: baseline;
          gap: 6px;
        }

        .analytics-number {
          font-size: 2rem;
          font-weight: 800;
          color: var(--hym-text-primary, #F8FAFC);
          line-height: 1;
        }

        .analytics-unit {
          font-size: 0.88rem;
          color: var(--hym-text-secondary, #94A3B8);
        }

        .analytics-subtext {
          font-size: 0.78rem;
          color: var(--hym-text-muted, #64748B);
        }

        .accuracy-widget-content {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .accuracy-circular-gauge {
          position: relative;
          width: 60px;
          height: 60px;
          flex-shrink: 0;
        }

        .gauge-svg {
          transform: rotate(-90deg);
        }

        .gauge-bg-circle {
          stroke: rgba(255, 255, 255, 0.08);
        }

        .gauge-progress-circle {
          stroke: var(--hym-neon-cyan, #00F2FE);
          transition: stroke-dashoffset 0.5s ease;
        }

        .gauge-center-text {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          font-size: 0.78rem;
          font-weight: 800;
          color: var(--hym-text-primary, #F8FAFC);
        }

        .weekly-chart-container {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          height: 70px;
          padding-top: 8px;
          gap: 8px;
        }

        .chart-col {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          flex: 1;
          height: 100%;
          cursor: pointer;
        }

        .chart-bar-track {
          width: 100%;
          max-width: 16px;
          height: 100%;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 4px;
          display: flex;
          align-items: flex-end;
          overflow: hidden;
        }

        .chart-bar-fill {
          width: 100%;
          background: rgba(148, 163, 184, 0.2);
          border-radius: 4px;
          transition: height 0.3s ease;
        }

        .chart-bar-fill--active {
          background: linear-gradient(180deg, var(--hym-neon-cyan, #00F2FE) 0%, var(--hym-brand-600, #2563EB) 100%);
        }

        .chart-day-label {
          font-size: 0.72rem;
          color: var(--hym-text-muted, #64748B);
          font-weight: 600;
        }

        /* ── Upcoming Exams & Tasks ── */
        .tab-pill-toggle {
          display: inline-flex;
          background: rgba(15, 23, 42, 0.5);
          padding: 2px;
          border-radius: 999px;
          border: 1px solid var(--hym-border-default, rgba(56, 189, 248, 0.12));
        }

        .pill-btn {
          border: none;
          background: transparent;
          color: var(--hym-text-secondary, #94A3B8);
          font-size: 0.78rem;
          font-weight: 600;
          padding: 4px 12px;
          border-radius: 999px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .pill-btn--active {
          background: var(--hym-brand-600, #2563EB);
          color: #FFFFFF;
        }

        .exams-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .exam-card-row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }

        .exam-card-row:last-child {
          border-bottom: none;
        }

        .exam-icon-wrapper {
          width: 40px;
          height: 40px;
          border-radius: 12px;
          background: rgba(37, 99, 235, 0.12);
          color: var(--hym-brand-400, #60A5FA);
          display: grid;
          place-items: center;
          flex-shrink: 0;
        }

        .exam-title-line {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .exam-lesson-name {
          font-size: 0.95rem;
          font-weight: 700;
          color: var(--hym-text-primary, #F8FAFC);
        }

        .exam-code-tag {
          font-size: 0.72rem;
          background: rgba(56, 189, 248, 0.1);
          color: var(--hym-neon-cyan, #00F2FE);
          padding: 1px 6px;
          border-radius: 4px;
        }

        .exam-meta-line {
          font-size: 0.78rem;
          color: var(--hym-text-secondary, #94A3B8);
        }

        .tasks-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .task-row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 8px 0;
        }

        .task-checkbox {
          width: 22px;
          height: 22px;
          border-radius: 6px;
          border: 2px solid var(--hym-border-default, rgba(56, 189, 248, 0.3));
          background: transparent;
          color: #FFFFFF;
          display: grid;
          place-items: center;
          cursor: pointer;
          flex-shrink: 0;
          transition: all 0.15s ease;
        }

        .task-checkbox--checked {
          background: var(--hym-brand-600, #2563EB);
          border-color: var(--hym-brand-600, #2563EB);
        }

        .task-title {
          font-size: 0.92rem;
          font-weight: 600;
          color: var(--hym-text-primary, #F8FAFC);
        }

        .task-title--done {
          text-decoration: line-through;
          color: var(--hym-text-muted, #64748B);
        }

        /* ── Command Modules Grid ── */
        .command-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
          gap: 14px;
        }

        .command-card-link {
          text-decoration: none;
          color: inherit;
          display: block;
        }

        .command-card {
          padding: 16px;
          border-radius: var(--hym-radius-lg, 14px);
          transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
          border: 1px solid var(--hym-border-default, rgba(56, 189, 248, 0.12));
          height: 100%;
        }

        .command-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 10px 20px -5px rgba(0, 0, 0, 0.6);
        }

        .command-card-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .command-icon-box {
          width: 44px;
          height: 44px;
          border-radius: 12px;
          display: grid;
          place-items: center;
        }

        .command-icon--brand { background: rgba(37, 99, 235, 0.18); color: #3B82F6; }
        .command-icon--cyan { background: rgba(0, 242, 254, 0.18); color: #00F2FE; }
        .command-icon--neon { background: rgba(14, 165, 233, 0.18); color: #0EA5E9; }
        .command-icon--indigo { background: rgba(99, 102, 241, 0.18); color: #818CF8; }
        .command-icon--amber { background: rgba(245, 158, 11, 0.18); color: #FBBF24; }
        .command-icon--emerald { background: rgba(16, 185, 129, 0.18); color: #34D399; }
        .command-icon--purple { background: rgba(168, 85, 247, 0.18); color: #C084FC; }

        .command-tag {
          font-size: 0.72rem;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 999px;
        }

        .command-tag--brand { background: rgba(37, 99, 235, 0.12); color: #60A5FA; }
        .command-tag--cyan { background: rgba(0, 242, 254, 0.12); color: #67E8F9; }
        .command-tag--neon { background: rgba(14, 165, 233, 0.12); color: #38BDF8; }
        .command-tag--indigo { background: rgba(99, 102, 241, 0.12); color: #A5B4FC; }
        .command-tag--amber { background: rgba(245, 158, 11, 0.12); color: #FCD34D; }
        .command-tag--emerald { background: rgba(16, 185, 129, 0.12); color: #6EE7B7; }
        .command-tag--purple { background: rgba(168, 85, 247, 0.12); color: #D8B4FE; }

        .command-title {
          font-size: 1rem;
          font-weight: 700;
          margin: 0;
          color: var(--hym-text-primary, #F8FAFC);
        }

        .command-sub {
          font-size: 0.8rem;
          color: var(--hym-text-secondary, #94A3B8);
          margin: 0;
        }

        .header-action-btn {
          width: 38px;
          height: 38px;
          border-radius: 10px;
          display: grid;
          place-items: center;
          color: var(--hym-text-primary, #F8FAFC);
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.08);
          text-decoration: none;
          transition: all 0.15s ease;
        }

        .header-action-btn:hover {
          background: rgba(0, 242, 254, 0.15);
          color: var(--hym-neon-cyan, #00F2FE);
        }

        @media (max-width: 640px) {
          .hero-grid {
            flex-direction: column;
            align-items: flex-start;
          }
          .hero-sub-status {
            width: 100%;
            margin-inline-start: 0;
          }
          .analytics-grid {
            grid-template-columns: 1fr;
          }
          .command-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </>
  );
}
