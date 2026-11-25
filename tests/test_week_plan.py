# -*- coding: utf-8 -*-
"""📅 منطق برنامهٔ هفتگی (miniapp/src/lib/weekPlan.js) — اجرای واقعی در Node.

جایگزین «۲۰۱ جلسه در ترم»: هر جلسه در تاریخ واقعیِ هفتهٔ شنبه‌تا‌جمعه.
اگر Node نصب نباشد تست رد (skip) می‌شود.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / "miniapp" / "src" / "lib" / "weekPlan.js"

SCRIPT = r"""
const wp = await import(process.argv[2]);
const now = { iso: '2026-11-25', minutes: 10 * 60 + 15 };   // چهارشنبه ۱۰:۱۵ تهران
const start = wp.weekStart(now.iso);
const items = [
  { id: 'a', lesson: 'فیزیولوژی', date: '2026-11-25', time: '10:00', end_time: '11:30', group: '1', type: 'class' },
  { id: 'b', lesson: 'آناتومی', date: '2026-11-25', time: '13:00', end_time: '14:30', group: 'گروه ۲', type: 'class' },
  { id: 'c', lesson: 'بیوشیمی', date: '2026-11-22', time: '08:00', group: 'هر دو', type: 'class' },
  { id: 'd', lesson: 'بافت', date: '2026-11-26', time: '08:00', type: 'makeup', flex_type: 'flexible', flex_note: 'هماهنگی' },
  { id: 'e', lesson: 'میان‌ترم', date: '2026-11-27', time: '09:00', type: 'exam' },
  { id: 'f', lesson: 'هفتهٔ بعد', date: '2026-11-28', time: '08:00', type: 'class' },
  { id: 'g', lesson: 'جابه‌جا', date: '2026-11-24', time: '08:00', type: 'class', note: 'تغییر ساعت به ۱۰' },
];
const p = wp.buildWeekPlan(items, start, { now });
const g2 = wp.buildWeekPlan(items, start, { now, group: '2' });
const nextWeek = wp.buildWeekPlan(items, wp.addDays(start, 7), { now });
console.log(JSON.stringify({
  start, end: p.end,
  dayNames: p.days.map((d) => d.name),
  counts: p.days.map((d) => d.sessions.length),
  todayIndex: p.days.findIndex((d) => d.isToday),
  total: p.total, remaining: p.remaining, exams: p.examCount,
  current: p.current && p.current.id, next: p.next && p.next.id,
  g2: g2.days.flatMap((d) => d.sessions.map((s) => s.id)),
  flagsD: p.days[5].sessions[0].flags.map((f) => f.key),
  flagsG: p.days[3].sessions[0].flags.map((f) => f.key),
  nextWeekTotal: nextWeek.total,
  both: wp.hasBothGroups(items),
  range: wp.jalaliRange(p.start, p.end),
  midnight: wp.weekStart('2026-11-21'),
}));
"""


@unittest.skipUnless(shutil.which("node"), "Node.js در دسترس نیست")
class WeekPlanTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with tempfile.TemporaryDirectory() as tmp:
            script = Path(tmp) / "run.mjs"
            script.write_text(SCRIPT, encoding="utf-8")
            proc = subprocess.run(
                [shutil.which("node"), str(script), LIB.as_uri()],
                capture_output=True, text=True, encoding="utf-8", timeout=60,
            )
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.out = json.loads(proc.stdout.strip().splitlines()[-1])

    def test_week_is_saturday_to_friday(self):
        self.assertEqual(self.out["start"], "2026-11-21")   # شنبه
        self.assertEqual(self.out["end"], "2026-11-27")     # جمعه
        self.assertEqual(self.out["dayNames"][0], "شنبه")
        self.assertEqual(self.out["dayNames"][-1], "جمعه")
        self.assertEqual(self.out["midnight"], "2026-11-21")

    def test_sessions_land_on_their_real_day_only_this_week(self):
        self.assertEqual(self.out["counts"], [0, 1, 0, 1, 2, 1, 0])
        self.assertEqual(self.out["total"], 5)
        self.assertEqual(self.out["nextWeekTotal"], 1)
        self.assertEqual(self.out["exams"], 1)

    def test_now_and_next_class(self):
        self.assertEqual(self.out["todayIndex"], 4)
        self.assertEqual(self.out["current"], "a")
        self.assertEqual(self.out["next"], "b")
        self.assertEqual(self.out["remaining"], 3)

    def test_group_filter_matches_bot_semantics(self):
        # گروه ۲ + «هر دو» + بدون گروه؛ گروه ۱ حذف
        self.assertEqual(self.out["g2"], ["c", "g", "b", "d"])
        self.assertTrue(self.out["both"])

    def test_flags(self):
        self.assertEqual(self.out["flagsD"], ["makeup", "flex"])
        self.assertEqual(self.out["flagsG"], ["changed"])

    def test_jalali_range(self):
        self.assertIn("آبان", self.out["range"])
        self.assertIn("آذر", self.out["range"])


class NoTermTotalLabel(unittest.TestCase):
    def test_scary_term_count_is_gone(self):
        src = (ROOT / "miniapp" / "src" / "pages" / "Schedule" / "ScheduleOverview.jsx").read_text(encoding="utf-8")
        self.assertNotIn("جلسه در ترم</span>", src)
        self.assertIn("WeeklyTimetable", src)


if __name__ == "__main__":
    unittest.main()
