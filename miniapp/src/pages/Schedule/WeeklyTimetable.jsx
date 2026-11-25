/* ─────────────────────────────────────────────────────────────
   📅 برنامهٔ هفتگی — شنبه تا جمعه، با تاریخ واقعی

   • گوشی: نوار روزها (قابل کشیدن) + فهرست کلاسهای همان روز؛
     کشیدن انگشت روی فهرست، روز قبل/بعد را باز میکند.
   • تبلت و دسکتاپ: جدول هفت ستونه.
   • «الان» و «کلاس بعدی» برجسته؛ جبرانی، شناور و تغییرکرده نشان دارند.
   • فقط پیشرفت ملایم: «این هفته: ۱۲ جلسه».
   ───────────────────────────────────────────────────────────── */
import { useEffect, useMemo, useRef, useState } from 'react';

import Icon from '../../components/ui/Icon';
import { faNum, faTime } from '../../lib/format';
import { haptic } from '../../lib/telegram';
import { lessonTone } from '../../lib/scheduleEngine';
import '../../styles/weekly-timetable.css';
import {
  addDays,
  buildWeekPlan,
  hasBothGroups,
  jalaliDayMonth,
  jalaliRange,
  tehranNow,
  weekStart,
} from '../../lib/weekPlan';

const GROUP_KEY = 'hy_schedule_group';

function readGroup() {
  try {
    return window.localStorage.getItem(GROUP_KEY) || 'all';
  } catch {
    return 'all';
  }
}

function timeRange(s) {
  if (s.start === null) return 'ساعت اعلام نشده';
  const a = faTime(s.time);
  return s.end_time ? `${a} تا ${faTime(s.end_time)}` : a;
}

function SessionCard({ s, onOpen, compact = false }) {
  const tone = lessonTone(s.lesson);
  const state = s.isNow ? ' is-now' : s.isNext ? ' is-next' : s.isOver ? ' is-over' : '';
  return (
    <button
      type="button"
      className={`wt-card${state}${compact ? ' wt-card--compact' : ''}`}
      style={{ '--wt-bg': tone.bg, '--wt-fg': tone.fg, '--wt-line': tone.line }}
      onClick={() => onOpen?.(s)}
    >
      <span className="wt-card__time">{timeRange(s)}</span>
      <b className="wt-card__title">{s.lesson || 'بدون عنوان'}</b>
      {(s.teacher || s.location) && (
        <span className="wt-card__meta">
          {[s.teacher, s.location].filter(Boolean).join(' · ')}
        </span>
      )}
      {(s.isNow || s.isNext || s.flags.length > 0) && (
        <span className="wt-card__tags">
          {s.isNow && <i className="wt-tag wt-tag--now">الان</i>}
          {s.isNext && <i className="wt-tag wt-tag--next">کلاس بعدی</i>}
          {s.flags.map((f) => (
            <i key={f.key} className={`wt-tag wt-tag--${f.key}`} title={f.note || undefined}>
              {f.label}
            </i>
          ))}
        </span>
      )}
    </button>
  );
}

function ExamChip({ e }) {
  return (
    <span className="wt-exam">
      <Icon name="quiz" size={13} />
      آزمون {e.lesson}
      {e.start !== null && ` · ${faTime(e.time)}`}
    </span>
  );
}

export default function WeeklyTimetable({ items, onOpenLesson }) {
  const now = useMemo(() => tehranNow(), []);
  const thisWeek = useMemo(() => weekStart(now.iso), [now.iso]);
  const [start, setStart] = useState(thisWeek);
  const [group, setGroup] = useState(readGroup);
  const lastSession = useMemo(
    () => items.reduce((max, i) => (i?.date && i.date > max ? i.date : max), ''),
    [items],
  );

  const plan = useMemo(() => {
    const p = buildWeekPlan(items, start, { now, group });
    if (p.next) p.next.isNext = true;
    return p;
  }, [items, start, now, group]);

  const todayIndex = plan.days.findIndex((d) => d.isToday);
  const firstBusy = plan.days.findIndex((d) => d.sessions.length || d.exams.length);
  const [dayIndex, setDayIndex] = useState(todayIndex >= 0 ? todayIndex : Math.max(0, firstBusy));
  useEffect(() => {
    setDayIndex(todayIndex >= 0 ? todayIndex : Math.max(0, firstBusy));
  }, [start]); // eslint-disable-line react-hooks/exhaustive-deps

  const showGroup = useMemo(() => hasBothGroups(items), [items]);
  const pickGroup = (g) => {
    haptic('light');
    setGroup(g);
    try {
      window.localStorage.setItem(GROUP_KEY, g);
    } catch {
      /* فقط همین نشست */
    }
  };

  const canPrev = start > thisWeek;
  const canNext = Boolean(lastSession) && addDays(start, 7) <= lastSession;
  const goWeek = (dir) => {
    haptic('light');
    setStart((s) => addDays(s, 7 * dir));
  };

  /* کشیدن افقی روی فهرست روز (RTL: کشیدن به چپ = روز بعد) */
  const touch = useRef(null);
  const onTouchStart = (e) => {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e) => {
    if (!touch.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.current.x;
    const dy = t.clientY - touch.current.y;
    touch.current = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    setDayIndex((i) => Math.min(6, Math.max(0, i + (dx < 0 ? 1 : -1))));
    haptic('light');
  };

  const day = plan.days[dayIndex] || plan.days[0];
  const isThisWeek = start === thisWeek;
  const weekLabel = isThisWeek ? 'این هفته' : start === addDays(thisWeek, 7) ? 'هفتهٔ بعد' : 'هفتهٔ انتخابی';

  return (
    <section className="wt" aria-label="برنامهٔ هفتگی">
      <header className="wt-head">
        <button
          type="button"
          className="wt-nav"
          onClick={() => goWeek(-1)}
          disabled={!canPrev}
          aria-label="هفتهٔ قبل"
        >
          ›
        </button>
        <div className="wt-head__mid">
          <b>{weekLabel}</b>
          <span>{jalaliRange(plan.start, plan.end)}</span>
        </div>
        <button
          type="button"
          className="wt-nav"
          onClick={() => goWeek(1)}
          disabled={!canNext}
          aria-label="هفتهٔ بعد"
        >
          ‹
        </button>
      </header>

      <div className="wt-summary">
        <span>
          {weekLabel}: <b>{faNum(plan.total)}</b> جلسه
          {isThisWeek && plan.total > 0 && plan.remaining < plan.total && (
            <> · {faNum(plan.remaining)} جلسه مانده</>
          )}
          {plan.examCount > 0 && <> · {faNum(plan.examCount)} آزمون</>}
        </span>
        {showGroup && (
          <span className="wt-groups" role="radiogroup" aria-label="گروه">
            {[
              { k: 'all', l: 'همه' },
              { k: '1', l: 'گروه ۱' },
              { k: '2', l: 'گروه ۲' },
            ].map((g) => (
              <button
                type="button"
                key={g.k}
                role="radio"
                aria-checked={group === g.k}
                className={`wt-group${group === g.k ? ' is-on' : ''}`}
                onClick={() => pickGroup(g.k)}
              >
                {g.l}
              </button>
            ))}
          </span>
        )}
      </div>

      {isThisWeek && (plan.current || plan.next) && (
        <div className="wt-now">
          {plan.current ? (
            <span>
              <i className="wt-tag wt-tag--now">الان</i> {plan.current.lesson}
              {plan.current.location ? ` · ${plan.current.location}` : ''}
            </span>
          ) : (
            <span>
              <i className="wt-tag wt-tag--next">کلاس بعدی</i> {plan.next.lesson} ·{' '}
              {plan.next.iso === now.iso ? 'امروز' : jalaliDayMonth(plan.next.iso)} ساعت {faTime(plan.next.time)}
            </span>
          )}
        </div>
      )}

      {/* ── گوشی: نوار روزها + فهرست همان روز ── */}
      <div className="wt-phone">
        <div className="wt-strip" role="tablist" aria-label="روزهای هفته">
          {plan.days.map((d, i) => (
            <button
              type="button"
              key={d.iso}
              role="tab"
              aria-selected={i === dayIndex}
              className={`wt-strip__day${i === dayIndex ? ' is-on' : ''}${d.isToday ? ' is-today' : ''}`}
              onClick={() => {
                haptic('light');
                setDayIndex(i);
              }}
            >
              <span className="wt-strip__name">{d.short}</span>
              <span className="wt-strip__date">{jalaliDayMonth(d.iso).split(' ')[0]}</span>
              <span className="wt-strip__dots" aria-hidden="true">
                {d.exams.length > 0 && <i className="is-exam" />}
                {d.sessions.slice(0, 3).map((s, k) => (
                  <i key={k} style={{ background: lessonTone(s.lesson).fg }} />
                ))}
              </span>
            </button>
          ))}
        </div>

        <div className="wt-agenda" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <div className="wt-agenda__title">
            <b>{day.name}</b> {jalaliDayMonth(day.iso)}
            {day.isToday && <i className="wt-tag wt-tag--today">امروز</i>}
          </div>
          {day.exams.map((e) => (
            <ExamChip key={`${e.id}-${e.time}`} e={e} />
          ))}
          {day.sessions.length === 0 ? (
            <p className="wt-free">{day.exams.length ? 'کلاسی ندارید.' : 'این روز کلاسی ندارید.'}</p>
          ) : (
            day.sessions.map((s) => (
              <SessionCard key={`${s.id}-${s.time}-${s.lesson}`} s={s} onOpen={onOpenLesson} />
            ))
          )}
        </div>
      </div>

      {/* ── تبلت و دسکتاپ: جدول هفت ستونه ── */}
      <div className="wt-grid" role="table" aria-label="جدول هفته">
        {plan.days.map((d) => (
          <div
            key={d.iso}
            role="row"
            className={`wt-col${d.isToday ? ' is-today' : ''}${d.isPast ? ' is-past' : ''}`}
          >
            <div className="wt-col__head" role="rowheader">
              <b>{d.name}</b>
              <span>{jalaliDayMonth(d.iso)}</span>
            </div>
            {d.exams.map((e) => (
              <ExamChip key={`${e.id}-${e.time}`} e={e} />
            ))}
            {d.sessions.length === 0 && d.exams.length === 0 && (
              <span className="wt-free wt-free--sm">بدون کلاس</span>
            )}
            {d.sessions.map((s) => (
              <SessionCard key={`${s.id}-${s.time}-${s.lesson}`} s={s} onOpen={onOpenLesson} compact />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
