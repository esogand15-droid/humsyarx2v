import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import './core.css';
import { AppBar, ProgressBar, SkeletonStack } from '../components';
import { InstallCard } from '../components/InstallPrompt';
import { NotificationBell } from '../components/NotificationBell';
import { DsBadge, DsButton, DsCard, DsEmpty, DsSegmented } from '../design/components';
import type { DsSection } from '../design/components';
import { Icon } from '../icons';
import type { IconName } from '../icons/sprite';
import { errorText } from '../lib/api';
import { dashboard } from '../lib/dashboard';
import type {
  DashboardPayload,
  SubscriptionStatus,
  UpcomingExam,
  WeeklyActivityItem,
} from '../lib/dashboard';
import { faDate, faDigits, faNum, faPercent } from '../lib/fa';
import { groupLabel, intakeLabel } from '../lib/intake';
import { reader, readerPath } from '../lib/reader';
import type { ContinueItem } from '../lib/reader';
import { studyTasks } from '../lib/schedule';
import type { StudyTask } from '../lib/schedule';
import { useSession } from '../lib/session';
import { peek, put } from '../lib/swr';

const PERSIAN_WEEK_DAYS = [
  { key: 'sat', fa: 'ش', full: 'شنبه' },
  { key: 'sun', fa: 'ی', full: 'یکشنبه' },
  { key: 'mon', fa: 'د', full: 'دوشنبه' },
  { key: 'tue', fa: 'س', full: 'سه‌شنبه' },
  { key: 'wed', fa: 'چ', full: 'چهارشنبه' },
  { key: 'thu', fa: 'پ', full: 'پنجشنبه' },
  { key: 'fri', fa: 'ج', full: 'جمعه' },
];

function getMonogram(name?: string): string {
  if (!name) return 'هـ';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2);
  return `${parts[0][0] || ''}${parts[1][0] || ''}`;
}

function clockFa(seconds: number): string {
  const sec = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => `${n < 10 ? '۰' : ''}${faNum(n)}`;
  return h > 0 ? `${faNum(h)}:${pad(m)}:${pad(s)}` : `${faNum(m)}:${pad(s)}`;
}

/* ── ۱. کارت ادامه مطالعه (مبتنی بر نوع فایل: PDF / ویدیو / صوت) ──────── */
function ContinueStudyCard({ item }: { item: ContinueItem | null }) {
  if (!item) {
    return (
      <section className="home-slot--continue" aria-label="شروع مطالعه" data-section="resources">
        <DsCard className="home-continue-empty">
          <div className="home-continue-empty__lead">
            <span className="home-continue__icon" aria-hidden="true">
              <Icon name="i-book-open" size={24} />
            </span>
            <div>
              <h2 className="ds-card__title">مطالعهٔ جزوه‌ها و کتاب‌های مرجع</h2>
              <p className="ds-card__sub">
                هنوز جزوه‌ای را شروع نکرده‌اید؛ از کتابخانه نخستین فایل خود را باز کنید.
              </p>
            </div>
          </div>
          <Link to="/library" className="ds-btn ds-btn--sm home-btn-tall">
            ورود به کتابخانه
          </Link>
        </DsCard>
      </section>
    );
  }

  const isMedia = item.kind === 'video' || item.kind === 'audio';
  const isPdf = item.kind === 'pdf';
  const isSlides = item.kind === 'slides';
  const resumeUrl =
    (isPdf || isSlides) && item.page > 0
      ? `${readerPath(item.scope, item.id)}?p=${item.page}`
      : readerPath(item.scope, item.id);
  const percentVal = Math.min(100, Math.max(0, Math.round(item.percent || 0)));

  const iconName: IconName =
    item.kind === 'video' ? 'i-video' : item.kind === 'audio' ? 'i-headphones' : 'i-doc';

  let subtitle = 'ادامه از همین بخش';
  if (isMedia) {
    subtitle =
      item.position > 0
        ? `ادامهٔ پخش از دقیقهٔ ${clockFa(item.position)}`
        : item.kind === 'video'
          ? 'پخش ویدیوی آموزشی از ابتدا'
          : 'پخش فایل صوتی از ابتدا';
  } else if ((isPdf || isSlides) && item.total > 0) {
    subtitle = `${isSlides ? 'اسلاید' : 'صفحهٔ'} ${faNum(Math.max(1, item.page))} از ${faNum(item.total)} · ادامه از همین بخش`;
  } else if (item.kind === 'image') {
    subtitle = 'مشاهدهٔ تصویر آموزشی';
  } else if (item.kind === 'document' || item.kind === 'sheet') {
    subtitle = 'مشاهدهٔ سند آموزشی';
  }

  return (
    <section className="core-stack home-slot--continue" aria-label="ادامه مطالعه" data-section="resources">
      <div className="core-sec-head">
        <div className="core-sec-head__lead">
          <Icon name="i-book-open" size={18} className="core-sec-head__icon" />
          <h2 className="core-sec-head__title">ادامهٔ مطالعه</h2>
        </div>
        <Link to="/library" className="core-link">
          <span>مشاهدهٔ کتابخانه</span>
          <Icon name="i-chevron-r" size={16} className="home-continue__chev" />
        </Link>
      </div>

      <Link to={resumeUrl} className="home-continue-card">
        <DsCard className="home-continue">
          <span className="home-continue__icon" aria-hidden="true">
            <Icon name={iconName} size={24} />
          </span>

          <div className="home-continue__body">
            <div className="home-continue__top">
              <h3 className="home-continue__title">
                <bdi dir="auto">{item.name}</bdi>
              </h3>
              {(percentVal > 0 || (isPdf && item.total > 0)) && (
                <DsBadge tone="accent">{faPercent(percentVal)}</DsBadge>
              )}
            </div>

            <span className="home-continue__sub">{subtitle}</span>

            {(percentVal > 0 || (isPdf && item.total > 0)) && (
              <ProgressBar value={percentVal} thin />
            )}
          </div>

          <Icon name="i-chevron-r" size={18} className="home-continue__chev" />
        </DsCard>
      </Link>
    </section>
  );
}

function getPersianWeekdayIndex(isoDate?: string): number | null {
  if (!isoDate) return null;
  const dt = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(dt.getTime())) return null;
  // JS: Sun=0..Sat=6 → Persian week: Sat=0, Sun=1, Mon=2, Tue=3, Wed=4, Thu=5, Fri=6
  return (dt.getUTCDay() + 1) % 7;
}

/* ── ۲. گرید ۴ ویجت آنالیتیکس بالینی (هر ویجت با رنگ نقش خودش) ────────── */
function ClinicalAnalyticsGrid({
  streak,
  bestStreak,
  accuracy,
  totalAnswers,
  correctAnswers,
  weekly,
}: {
  streak: number;
  bestStreak: number;
  accuracy: number;
  totalAnswers: number;
  correctAnswers: number;
  weekly: WeeklyActivityItem[];
}) {
  const weeklyCounts = weekly && weekly.length > 0 ? weekly : [];
  const countsByWeekday = new Array<number>(7).fill(0);
  weeklyCounts.forEach((entry, idx) => {
    const wd = getPersianWeekdayIndex(entry?.date);
    const target = wd !== null ? wd : idx % 7;
    countsByWeekday[target] += Math.max(0, entry?.count || 0);
  });
  const maxActivity = Math.max(1, ...countsByWeekday);

  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  const targetOffset =
    circumference - (Math.min(100, Math.max(0, accuracy)) / 100) * circumference;
  const [gaugeOffset, setGaugeOffset] = useState(circumference);
  const [barsReady, setBarsReady] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setGaugeOffset(targetOffset);
      setBarsReady(true);
    });
    return () => cancelAnimationFrame(id);
  }, [targetOffset]);

  const accuracySection: DsSection =
    accuracy >= 70 ? 'grades' : accuracy >= 45 ? 'schedule' : totalAnswers > 0 ? 'danger' : 'grades';

  return (
    <section className="core-stack home-slot--analytics" aria-label="عملکرد و آنالیتیکس بالینی">
      <div className="core-sec-head">
        <div className="core-sec-head__lead">
          <Icon name="i-trend" size={18} className="core-sec-head__icon" />
          <h2 className="core-sec-head__title">عملکرد و پیوستگی مطالعه</h2>
        </div>
      </div>

      <div className="home-analytics-grid">
        {/* ۱. پیوستگی مطالعه (کهربایی) */}
        <div data-section="schedule">
          <DsCard className="home-stat-card">
            <div className="home-stat-card__head">
              <span className="home-stat-card__icon" aria-hidden="true">
                <Icon name="i-flame" size={18} />
              </span>
              <span className="home-stat-card__label">پیوستگی مطالعه</span>
            </div>
            <div className="home-stat-card__val-row">
              <span className={`home-stat-card__num${streak === 0 ? ' is-zero' : ''}`}>{faNum(streak)}</span>
              <span className="home-stat-card__unit">روز</span>
            </div>
            {streak === 0 && bestStreak === 0 ? (
              // «۰» در فونت فارسی شبیه نقطه است؛ بدون این راهنما کارت خالی بهنظر میرسید.
              <div className="home-stat-card__sub">
                <span>امروز یک جلسه مطالعه کن تا پیوستگی شروع شود.</span>
              </div>
            ) : (
              <div className="home-stat-card__sub">
                <span>بهترین رکورد:</span>
                <strong>{faNum(bestStreak)}</strong>
                <span>روز مداوم</span>
              </div>
            )}
          </DsCard>
        </div>

        {/* ۲. دقت پاسخ‌دهی (زمردی/معنایی) */}
        <div data-section={accuracySection}>
          <DsCard className="home-stat-card">
            <div className="home-stat-card__head">
              <span className="home-stat-card__icon" aria-hidden="true">
                <Icon name="i-target" size={18} />
              </span>
              <span className="home-stat-card__label">درستی پاسخ‌ها</span>
            </div>
            <div className="home-gauge-wrap">
              <div className="home-gauge">
                <svg className="home-gauge__svg" viewBox="0 0 60 60" aria-hidden="true">
                  <circle cx="30" cy="30" r={radius} strokeWidth="5" className="home-gauge__track" />
                  <circle
                    cx="30"
                    cy="30"
                    r={radius}
                    strokeWidth="5"
                    strokeDasharray={circumference}
                    strokeDashoffset={gaugeOffset}
                    strokeLinecap="round"
                    className="home-gauge__fill"
                  />
                </svg>
                <span className="home-gauge__val">{faPercent(accuracy)}</span>
              </div>
              <div className="core-stack">
                <span className="home-stat-card__sub">پاسخ‌های درست</span>
                <span className="home-stat-card__label">
                  {totalAnswers > 0
                    ? `${faNum(correctAnswers)} از ${faNum(totalAnswers)}`
                    : 'هنوز آزمونی ثبت نشده'}
                </span>
              </div>
            </div>
          </DsCard>
        </div>

        {/* ۳. تست‌های تمرینی (بنفش بانک سؤال) */}
        <div data-section="qbank">
          <DsCard className="home-stat-card">
            <div className="home-stat-card__head">
              <span className="home-stat-card__icon" aria-hidden="true">
                <Icon name="i-flask" size={18} />
              </span>
              <span className="home-stat-card__label">تست‌های تمرینی</span>
            </div>
            <div className="home-stat-card__val-row">
              <span className={`home-stat-card__num${totalAnswers === 0 ? ' is-zero' : ''}`}>{faNum(totalAnswers)}</span>
              <span className="home-stat-card__unit">سؤال</span>
            </div>
            <div className="home-stat-card__sub">
              {totalAnswers > 0 ? 'ارزیابی هوشمند در بانک سؤال' : 'برای شروع وارد آزمون شوید'}
            </div>
          </DsCard>
        </div>

        {/* ۴. فعالیت ۷ روز گذشته (ایندیگو) */}
        <div data-section="resources">
          <DsCard className="home-stat-card">
            <div className="home-stat-card__head">
              <span className="home-stat-card__icon" aria-hidden="true">
                <Icon name="i-calendar" size={18} />
              </span>
              <span className="home-stat-card__label">فعالیت ۷ روز گذشته</span>
            </div>
            <div className="home-weekly" aria-label="نمودار فعالیت ۷ روز اخیر">
              {PERSIAN_WEEK_DAYS.map((d, idx) => {
                const count = countsByWeekday[idx] ?? 0;
                const pct = count > 0
                  ? Math.max(18, Math.round((count / maxActivity) * 100))
                  : 8;
                const barH = barsReady ? pct : 8;
                return (
                  <div key={d.key} className="home-weekly__col" title={`${d.full}: ${faNum(count)} فعالیت`}>
                    <div className="home-weekly__track">
                      <svg className="home-weekly__svg" viewBox="0 0 10 100" preserveAspectRatio="none" aria-hidden="true">
                        <rect
                          className={`home-weekly__bar${count > 0 ? ' is-active' : ''}`}
                          x={0}
                          y={100 - barH}
                          width={10}
                          height={barH}
                          rx={4}
                        />
                      </svg>
                    </div>
                    <span className="home-weekly__day">{d.fa}</span>
                  </div>
                );
              })}
            </div>
          </DsCard>
        </div>
      </div>
    </section>
  );
}

/* ── ۳. کارت فشردهٔ هویت و اشتراک (H3) ────────────────────────────────── */
function AcademicIdentityCard({
  displayName,
  studentId,
  intake,
  group,
  prestigeTitle,
  prestigeLevel,
  subStatus,
}: {
  displayName: string;
  studentId?: string;
  intake?: string;
  group?: string;
  prestigeTitle?: string;
  prestigeLevel?: number;
  subStatus: SubscriptionStatus | null;
}) {
  const monogram = getMonogram(displayName);
  const isSubActive = subStatus?.active ?? false;
  const daysLeft = subStatus?.days_left ?? 0;
  const planName = subStatus?.plan_name || 'اشتراک ویژهٔ هامزیار';
  const expireJalali = subStatus?.expires ? faDate(subStatus.expires) : '';

  return (
    <DsCard className="home-identity home-slot--identity">
      <div className="home-identity__top">
        <div className="home-avatar" aria-hidden="true">
          <span>{monogram}</span>
          {prestigeLevel !== undefined && prestigeLevel > 0 && (
            <span className="home-avatar__lvl">{faNum(prestigeLevel)}</span>
          )}
        </div>
        <div className="home-identity__info">
          <div className="home-identity__name-row">
            <h2 className="home-identity__name">
              <bdi dir="auto">{displayName}</bdi>
            </h2>
            {prestigeTitle && (
              <DsBadge tone="accent">
                <Icon name="i-award" size={12} />
                <span>{prestigeTitle}</span>
              </DsBadge>
            )}
          </div>
          <div className="home-identity__meta">
            {studentId && <span>شماره: {faDigits(studentId)}</span>}
            {intake && <span>{intake}</span>}
            {group && <span>{group}</span>}
          </div>
        </div>
      </div>

      <div data-section={isSubActive ? (daysLeft <= 5 ? 'danger' : 'money') : 'danger'}>
        <Link to="/subscription" className="home-sub-strip">
          <span className="home-sub-strip__lead">
            <Icon name={isSubActive ? 'i-shield' : 'i-alert-circle'} size={16} />
            <span>{planName}</span>
          </span>
          <span className="home-sub-strip__meta">
            <span>
              {isSubActive
                ? `${faNum(daysLeft)} روز مانده${expireJalali ? ` · تا ${expireJalali}` : ''}`
                : 'اشتراک غیرفعال'}
            </span>
            {(!isSubActive || daysLeft <= 3) && (
              <DsBadge tone={isSubActive ? 'warning' : 'danger'}>تمدید</DsBadge>
            )}
          </span>
        </Link>
      </div>
    </DsCard>
  );
}

/* ── ۴. ویجت امتحانات پیش‌رو و تسک‌های مطالعه ──────────────────────────── */
function UpcomingExamsAndTasks({
  exams,
  tasks,
  onToggleTask,
}: {
  exams: UpcomingExam[];
  tasks: StudyTask[];
  onToggleTask: (taskId: string) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<'exams' | 'tasks'>('exams');

  const urgencyBadge = (daysLeft: number | null) => {
    if (daysLeft === null) return null;
    if (daysLeft === 0) return <DsBadge tone="danger">امروز</DsBadge>;
    if (daysLeft <= 3) return <DsBadge tone="danger">{faNum(daysLeft)} روز</DsBadge>;
    if (daysLeft <= 7) return <DsBadge tone="warning">{faNum(daysLeft)} روز</DsBadge>;
    return <DsBadge tone="accent">{faNum(daysLeft)} روز</DsBadge>;
  };

  return (
    <section className="core-stack home-slot--upcoming" aria-label="امتحانات و برنامه مطالعه" data-section="schedule">
      <div className="core-sec-head">
        <div className="core-sec-head__lead">
          <Icon name="i-calendar" size={18} className="core-sec-head__icon" />
          <h2 className="core-sec-head__title">برنامه و امتحانات</h2>
        </div>
        <Link to="/schedule" className="core-link">
          تقویم کامل
        </Link>
      </div>

      <DsSegmented
        block
        label="نمایش امتحانات یا تسک‌ها"
        value={activeTab}
        onChange={setActiveTab}
        options={[
          { value: 'exams', label: `امتحانات (${faNum(exams.length)})` },
          { value: 'tasks', label: `تسک‌ها (${faNum(tasks.length)})` },
        ]}
      />

      {activeTab === 'exams' ? (
        exams.length > 0 ? (
          <DsCard flush>
            <div className="ds-list">
              {exams.slice(0, 5).map((ex) => (
                <div key={ex.id} className="home-upcoming-item">
                  <div className="home-upcoming-item__body">
                    <span className="home-upcoming-item__title">{ex.lesson}</span>
                    <span className="home-upcoming-item__meta">
                      {[
                        ex.time ? `ساعت ${faDigits(ex.time)}` : '',
                        ex.date ? faDate(ex.date) : '',
                        ex.teacher ? `استاد ${ex.teacher}` : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                  {urgencyBadge(ex.days_left)}
                </div>
              ))}
            </div>
          </DsCard>
        ) : (
          <DsCard>
            <div className="home-empty-inline">
              <div className="home-empty-inline__lead">
                <span className="home-stat-card__icon" aria-hidden="true">
                  <Icon name="i-check" size={18} />
                </span>
                <div>
                  <h3 className="ds-card__title">امتحانی در ۷ روز آینده نیست</h3>
                  <p className="ds-card__sub">برنامهٔ کامل ترم در تقویم در دسترس است.</p>
                </div>
              </div>
              <Link to="/schedule" className="ds-btn ds-btn--secondary ds-btn--sm home-btn-tall">
                تقویم
              </Link>
            </div>
          </DsCard>
        )
      ) : tasks.length > 0 ? (
        <DsCard flush>
          <div className="ds-list">
            {tasks.slice(0, 5).map((task) => (
              <div key={task.task_id} className="home-task-row">
                <button
                  type="button"
                  className={`home-task-check${task.completed ? ' is-done' : ''}`}
                  onClick={() => void onToggleTask(task.task_id)}
                  aria-label={task.completed ? 'علامت به عنوان انجام‌نشده' : 'علامت به عنوان انجام‌شده'}
                >
                  <span className="home-task-check__box" aria-hidden="true">
                    {task.completed && <Icon name="i-check" size={14} />}
                  </span>
                </button>
                <div className="home-upcoming-item__body">
                  <span className={`home-task-title${task.completed ? ' is-done' : ''}`}>
                    {task.title}
                  </span>
                  <span className="home-upcoming-item__meta">
                    {[
                      `تاریخ: ${faDigits(task.jalali_date)}`,
                      task.reminder_time ? `یادآور ${faDigits(task.reminder_time)}` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </DsCard>
      ) : (
        <DsCard>
          <div className="home-empty-inline">
            <div className="home-empty-inline__lead">
              <span className="home-stat-card__icon" aria-hidden="true">
                <Icon name="i-calendar" size={18} />
              </span>
              <div>
                <h3 className="ds-card__title">تسکی برای امروز ثبت نشده</h3>
                <p className="ds-card__sub">برای نظم مطالعه، تسک‌های شخصی اضافه کنید.</p>
              </div>
            </div>
            <Link to="/schedule" className="ds-btn ds-btn--secondary ds-btn--sm home-btn-tall">
              افزودن تسک
            </Link>
          </div>
        </DsCard>
      )}
    </section>
  );
}

/* ── ۵. شبکهٔ ماژول‌های رنگی مرکز فرماندهی ───────────────────────────── */
interface QuickModule {
  to: string;
  label: string;
  sub: string;
  icon: IconName;
  tag: string;
  section: DsSection;
}

const COMMAND_MODULES: QuickModule[] = [
  {
    to: '/exam',
    label: 'بانک سؤال',
    sub: 'تمرین بالینی و آزمون زمان‌دار',
    icon: 'i-flask',
    tag: 'آزمون‌ها',
    section: 'qbank',
  },
  {
    to: '/library',
    label: 'کتابخانهٔ مرجع',
    sub: 'جزوه‌ها، کتب مرجع و ویدیوها',
    icon: 'i-book',
    tag: 'منابع درسی',
    section: 'resources',
  },
  {
    to: '/me/notes',
    label: 'دفتر و قلم دیجیتال',
    sub: 'یادداشت‌ها و حاشیه‌نویسی جزوه‌ها',
    icon: 'i-pen',
    tag: 'یادداشت‌ها',
    section: 'notes',
  },
  {
    to: '/ai',
    label: 'هوشیار',
    sub: 'دستیار پزشکی، سناریو و تحلیل تصویر',
    icon: 'i-chat',
    tag: 'هوش مصنوعی',
    section: 'ai',
  },
  {
    to: '/grades',
    label: 'کارنامه و معدل',
    sub: 'ریز نمرات و معدل وزنی تحصیلی',
    icon: 'i-award',
    tag: 'سوابق تحصیلی',
    section: 'grades',
  },
  {
    to: '/schedule',
    label: 'برنامهٔ هفتگی',
    sub: 'کلاس‌های هفته و تسک‌های مطالعه',
    icon: 'i-calendar',
    tag: 'زمان‌بندی',
    section: 'schedule',
  },
  {
    to: '/tickets',
    label: 'پشتیبانی دانشجویی',
    sub: 'ارسال تیکت و گفتگو با پشتیبانی',
    icon: 'i-message-circle',
    tag: 'پاسخگویی',
    section: 'brand',
  },
  {
    to: '/subscription',
    label: 'اشتراک و دسترسی',
    sub: 'وضعیت اشتراک، پلن‌ها و تمدید',
    icon: 'i-credit-card',
    tag: 'اشتراک',
    section: 'money',
  },
];

function QuickAccessCommandGrid() {
  return (
    <section className="core-stack home-slot--modules" aria-label="ماژول‌های هامزیار">
      <div className="core-sec-head">
        <div className="core-sec-head__lead">
          <Icon name="i-grid" size={18} className="core-sec-head__icon" />
          <h2 className="core-sec-head__title">دسترسی سریع بخش‌ها</h2>
        </div>
      </div>

      <div className="home-modules-grid">
        {COMMAND_MODULES.map((mod) => (
          <Link key={mod.to} to={mod.to} className="home-mod-link" data-section={mod.section}>
            <DsCard className="home-mod-card">
              <div className="home-mod-card__top">
                <span className="home-mod-card__icon" aria-hidden="true">
                  <Icon name={mod.icon} size={20} />
                </span>
                <DsBadge tone="accent">{mod.tag}</DsBadge>
              </div>
              <div>
                <h3 className="home-mod-card__title">{mod.label}</h3>
                <p className="home-mod-card__sub">{mod.sub}</p>
              </div>
            </DsCard>
          </Link>
        ))}
      </div>
    </section>
  );
}

interface HomeBundle {
  data: DashboardPayload | null;
  recent: ContinueItem[];
  subStatus: SubscriptionStatus | null;
  tasks: StudyTask[];
  weekly: WeeklyActivityItem[];
}

/* ── صفحهٔ اصلی خانه ──────────────────────────────────────────────────── */
export function HomeScreen() {
  const { user } = useSession();
  const [cached] = useState(() => peek<HomeBundle>('home'));
  const [data, setData] = useState<DashboardPayload | null>(cached?.data ?? null);
  const [recent, setRecent] = useState<ContinueItem[]>(cached?.recent ?? []);
  const [subStatus, setSubStatus] = useState<SubscriptionStatus | null>(cached?.subStatus ?? null);
  const [tasks, setTasks] = useState<StudyTask[]>(cached?.tasks ?? []);
  const [weekly, setWeekly] = useState<WeeklyActivityItem[]>(cached?.weekly ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    // cached data stays on screen while it refreshes; skeleton only on a cold cache
    const hasCached = Boolean(peek('home'));
    if (!hasCached) setLoading(true);
    setError('');
    try {
      const results = await Promise.allSettled([
        dashboard.overview(),
        reader.recent(),
        dashboard.subscriptionStatus(),
        studyTasks.list(),
        dashboard.weekly(),
      ]);

      if (results.every((r) => r.status === 'rejected')) {
        const firstErr = (results[0] as PromiseRejectedResult).reason;
        throw firstErr;
      }

      const dashRes = results[0].status === 'fulfilled' ? results[0].value : null;
      const recentRes = results[1].status === 'fulfilled' ? results[1].value : { items: [] };
      const subRes = results[2].status === 'fulfilled' ? results[2].value : null;
      const tasksRes = results[3].status === 'fulfilled' ? results[3].value : { tasks: [] };
      const weeklyRes = results[4].status === 'fulfilled' ? results[4].value : { weekly: [] };

      const next = put<HomeBundle>('home', {
        data: dashRes,
        recent: recentRes?.items || [],
        subStatus: subRes,
        tasks: tasksRes?.tasks || [],
        weekly: weeklyRes?.weekly || [],
      });
      setData(next.data);
      setRecent(next.recent);
      setSubStatus(next.subStatus);
      setTasks(next.tasks);
      setWeekly(next.weekly);
    } catch (err) {
      if (!hasCached) {
        setError(errorText(err, 'اتصال به سرور برقرار نشد؛ لطفاً اینترنت را بررسی کنید.'));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleToggleTask = async (taskId: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.task_id === taskId ? { ...t, completed: !t.completed } : t)),
    );
    try {
      await studyTasks.toggle(taskId);
    } catch {
      void loadData();
    }
  };

  const displayName = data?.user?.display_name || user?.name || 'دانشجوی هامزیار';
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
  const accuracy =
    stats?.accuracy ?? (totalAnswers > 0 ? Math.round((correctAnswers / totalAnswers) * 100) : 0);

  if (loading) {
    return (
      <>
        <AppBar title="خانه" sub="در حال بارگذاری اطلاعات…" />
        <div className="page core-page">
          <SkeletonStack rows={6} />
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <AppBar title="خانه" sub="عدم اتصال به سرور" />
        <div className="page core-page">
          <DsCard>
            <DsEmpty
              icon={<Icon name="i-alert-circle" size={28} />}
              title="خطا در بارگذاری صفحهٔ خانه"
              body={error}
              action={
                <DsButton variant="primary" onClick={() => void loadData()}>
                  تلاش دوباره
                </DsButton>
              }
            />
          </DsCard>
        </div>
      </>
    );
  }

  return (
    <>
      <AppBar
        title={`سلام، ${displayName.split(' ')[0]}`}
        sub="داشبورد مطالعه و ارزیابی بالینی هامزیار"
        actions={
          <div className="home-action-pair">
            <Link to="/search" className="iconbtn" aria-label="جستجو" title="جستجو در سامانه">
              <Icon name="i-search" size={18} />
            </Link>
            <NotificationBell />
          </div>
        }
      />

      <div className="page page-enter core-page">
        <div className="home-layout">
          <div className="home-main">
            {/* اولویت اول مطالعه: ادامه از جایی که رها کرده‌اید (H3) */}
            <ContinueStudyCard item={recent.length > 0 ? recent[0] : null} />

            {/* کارت جمع‌وجور و یک‌بارهٔ نصب روی گوشی (G1) */}
            <InstallCard />

            {/* آنالیتیکس بالینی چهاررنگ */}
            <ClinicalAnalyticsGrid
              streak={streak}
              bestStreak={bestStreak}
              accuracy={accuracy}
              totalAnswers={totalAnswers}
              correctAnswers={correctAnswers}
              weekly={weekly}
            />

            {/* شبکه دسترسی سریع ماژول‌ها */}
            <QuickAccessCommandGrid />
          </div>

          <aside className="home-side" aria-label="اطلاعات حساب و برنامه">
            <AcademicIdentityCard
              displayName={displayName}
              studentId={studentId}
              intake={intake}
              group={group}
              prestigeTitle={prestigeTitle}
              prestigeLevel={prestigeLevel}
              subStatus={subStatus}
            />

            <UpcomingExamsAndTasks
              exams={data?.upcoming_exams || []}
              tasks={tasks}
              onToggleTask={handleToggleTask}
            />
          </aside>
        </div>
      </div>
    </>
  );
}
