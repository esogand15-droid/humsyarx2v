# -*- coding: utf-8 -*-
"""تست‌های موج W3C — تقویم هفتگی، فرمت فارسی/جلالی، نرمال‌سازی ترم و API برنامه."""
from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017/medicalbot")
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.api.routers.schedule import (  # noqa: E402
    _clamp_since,
    _format_schedule,
    _normalize_term as router_normalize_term,
    get_schedule,
)
from backend.database.content import DBContent, _normalize_term  # noqa: E402


class _FakeDB(DBContent):
    def __init__(self, settings: dict | None = None):
        self._settings = dict(settings or {})
        self.schedules = MagicMock()
        self.schedules.find.return_value.sort.return_value.limit.return_value.to_list = AsyncMock(return_value=[])
        self.course_selections = MagicMock()
        self.course_selections.update_many = AsyncMock(return_value=MagicMock(modified_count=0))

    async def get_setting(self, key: str, default=None):
        return self._settings.get(key, default)

    async def set_setting(self, key: str, val):
        self._settings[key] = val


class TermNormalizationTests(unittest.TestCase):
    def test_normalize_term_variants(self):
        self.assertIs(_normalize_term, router_normalize_term)
        cases = [
            (None, ""),
            ("", ""),
            ("   ", ""),
            (True, ""),
            (False, ""),
            (2, "2"),
            (1404, "1404"),
            ("1404-2", "1404-2"),
            ("  ترم ۲  ", "ترم ۲"),
            ({"term": "1404-2", "exams_end_date": ""}, "1404-2"),
            ({"name": "1405-1"}, "1405-1"),
            ({"label": "ترم ۳"}, "ترم ۳"),
            ({"title": 2}, "2"),
            ({"term": {"name": "1404-2"}}, "1404-2"),
            ("{'term': '1404-2', 'exams_end_date': ''}", "1404-2"),
            ('{"term": "1404-2"}', "1404-2"),
            ("{'name': 2, 'ok': True}", "2"),
            ({"foo": "bar"}, ""),
            ("{'foo': 'bar'}", ""),
            ("[object Object]", ""),
            ("None", ""),
        ]
        for raw, expected in cases:
            with self.subTest(raw=raw):
                self.assertEqual(_normalize_term(raw), expected)

    def test_db_term_config_normalizes_and_prevents_dict_corruption(self):
        async def _run():
            db_dirty = _FakeDB({"current_academic_term": "{'term': '1404-2', 'exams_end_date': ''}"})
            cfg = await db_dirty.get_current_term_config()
            self.assertEqual(cfg["term"], "1404-2")

            db_dict = _FakeDB({"current_academic_term": {"term": "1405-1"}})
            cfg2 = await db_dict.get_current_term_config()
            self.assertEqual(cfg2["term"], "1405-1")

            # شبیه‌سازی باگ ارسال dict به‌عنوان آرگومان اول set_current_term_config
            updated = await db_dict.set_current_term_config(
                {"term": "1405-2", "second_reminder_enabled": True, "second_reminder_days": 5}
            )
            self.assertEqual(updated["term"], "1405-2")
            self.assertEqual(db_dict._settings["current_academic_term"], "1405-2")
            self.assertTrue(updated["second_reminder_enabled"])
            self.assertEqual(updated["second_reminder_days"], 5)

        asyncio.run(_run())


class ScheduleRouterTests(unittest.TestCase):
    def test_clamp_since_bounds(self):
        fake_now = datetime(2026, 11, 25, 10, 15, tzinfo=ZoneInfo("Asia/Tehran"))
        with patch("backend.api.routers.schedule.now_tehran", return_value=fake_now):
            self.assertIsNone(_clamp_since(None))
            self.assertIsNone(_clamp_since(""))
            self.assertIsNone(_clamp_since("not-a-date"))
            self.assertIsNone(_clamp_since("2026-11-25"))
            self.assertIsNone(_clamp_since("2026-11-28"))
            self.assertEqual(_clamp_since("2026-11-21"), "2026-11-21")
            self.assertEqual(_clamp_since("2026-11-01"), (fake_now.date() - timedelta(days=7)).isoformat())

    def test_format_schedule_and_get_schedule_normalize_term(self):
        formatted = _format_schedule({
            "_id": "s1",
            "type": "class",
            "lesson": "فیزیولوژی",
            "date": "2026-11-25",
            "time": "08:00",
            "end_time": "10:00",
            "term": "{'term': '1404-2'}",
            "flex_type": "flexible",
            "flex_note": "هماهنگی",
        })
        self.assertIsNotNone(formatted)
        self.assertEqual(formatted["term"], "1404-2")
        self.assertEqual(formatted["flex_type"], "flexible")
        self.assertEqual(formatted["flex_note"], "هماهنگی")

        async def _run():
            mock_db = MagicMock()
            mock_db.get_personalized_schedules = AsyncMock(return_value={
                "items": [{
                    "_id": "s1",
                    "type": "class",
                    "lesson": "فیزیولوژی",
                    "date": "2026-11-25",
                    "time": "08:00",
                    "end_time": "10:00",
                    "term": {"term": "1404-2"},
                }],
                "computed_group": "1",
                "registered_group": "1",
                "educational_group": "female",
                "has_custom_selection": True,
                "selected_count": 5,
                "total_offered_count": 7,
                "conflicts": [],
                "term": "{'term': '1404-2'}",
            })
            fake_now = datetime(2026, 11, 25, 10, 15, tzinfo=ZoneInfo("Asia/Tehran"))
            with (
                patch("backend.api.routers.schedule.db", mock_db),
                patch("backend.api.routers.schedule.now_tehran", return_value=fake_now),
            ):
                res = await get_schedule(user={"id": 42, "_db": {"group": "1"}}, stype=None, since="2026-11-21")
            mock_db.get_personalized_schedules.assert_awaited_once_with(
                42, stype=None, upcoming=True, since="2026-11-21"
            )
            self.assertEqual(res["term"], "1404-2")
            self.assertEqual(res["schedule"][0]["term"], "1404-2")
            self.assertEqual(res["selected_count"], 5)
            self.assertEqual(res["total_offered_count"], 7)

        asyncio.run(_run())

    def test_c2_gender_title_fallback_in_schedules_and_offerings(self):
        """C2: get_schedules و get_term_course_offerings عنوانِ جنسیت‌دار را بدون educational_group صریح فیلتر می‌کنند."""
        from backend.database.core import DBCore

        class _FakeSchedDB(_FakeDB, DBCore):
            def __init__(self, settings=None):
                _FakeDB.__init__(self, settings)

        async def _run():
            fake = _FakeSchedDB({"current_academic_term": "1404-2"})
            rows = [
                {"_id": "1", "type": "class", "lesson": "آناتومی عملی دختران", "date": "2026-11-26", "time": "08:00", "term": "1404-2", "educational_group": "mixed"},
                {"_id": "2", "type": "class", "lesson": "آناتومی عملی پسران", "date": "2026-11-26", "time": "10:00", "term": "1404-2", "educational_group": "mixed"},
                {"_id": "3", "type": "class", "lesson": "فیزیولوژی عمومی", "date": "2026-11-26", "time": "12:00", "term": "1404-2", "educational_group": "mixed"},
            ]
            fake.schedules.find.return_value.sort.return_value.to_list = AsyncMock(return_value=list(rows))
            male_items = await fake.get_schedules(stype="class", upcoming=False, educational_group="male")
            self.assertEqual([x["_id"] for x in male_items], ["2", "3"])

            female_items = await fake.get_schedules(stype="class", upcoming=False, educational_group="female")
            self.assertEqual([x["_id"] for x in female_items], ["1", "3"])

            fake.course_offerings = MagicMock()
            fake.course_offerings.find.return_value.to_list = AsyncMock(return_value=[
                {"_id": "o1", "term": "1404-2", "lesson": "بافت‌شناسی بانوان", "group": "1", "educational_group": "mixed"},
                {"_id": "o2", "term": "1404-2", "lesson": "بافت‌شناسی آقایان", "group": "1", "educational_group": "mixed"},
                {"_id": "o3", "term": "1404-2", "lesson": "بیوشیمی", "group": "1", "educational_group": "mixed"},
            ])
            fake.schedule_templates = MagicMock()
            fake.schedule_templates.find.return_value.sort.return_value.to_list = AsyncMock(return_value=[])
            fake.schedules.find.return_value.sort.return_value.to_list = AsyncMock(return_value=[])
            offerings_female = await fake.get_term_course_offerings(term="1404-2", educational_group="female")
            offering_titles = [o.get("lesson") for o in offerings_female]
            self.assertIn("بافت‌شناسی بانوان", offering_titles)
            self.assertIn("بیوشیمی", offering_titles)
            self.assertNotIn("بافت‌شناسی آقایان", offering_titles)

        asyncio.run(_run())


ESBUILD = ROOT / "apps" / "student" / "node_modules" / "esbuild" / "lib" / "main.js"
FA_TS = ROOT / "apps" / "student" / "src" / "lib" / "fa.ts"
WEEKPLAN_TS = ROOT / "apps" / "student" / "src" / "lib" / "weekPlan.ts"

NODE_RUNNER = r"""
const { build } = await import(process.argv[2]);
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tmpDir = process.argv[3];
const faOut = path.join(tmpDir, 'fa.mjs');
const wpOut = path.join(tmpDir, 'weekPlan.mjs');

await build({
  entryPoints: [process.argv[4]],
  outfile: faOut,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
});
await build({
  entryPoints: [process.argv[5]],
  outfile: wpOut,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
});

const fa = await import(pathToFileURL(faOut).href);
const wp = await import(pathToFileURL(wpOut).href);

const now = { iso: '2026-11-25', minutes: 10 * 60 + 15 };
const start = wp.weekStart(now.iso);
const items = [
  { id: 'a', lesson: 'فیزیولوژی', date: '2026-11-25', time: '10:00', end_time: '11:30', group: '1', type: 'class' },
  { id: 'b', lesson: 'آناتومی', date: '2026-11-25', time: '13:00', end_time: '14:30', group: 'گروه ۲', type: 'class' },
  { id: 'c', lesson: 'بیوشیمی', date: '2026-11-22', time: '08:00', group: 'هر دو', type: 'class' },
  { id: 'd', lesson: 'بافت', date: '2026-11-26', time: '08:00', type: 'makeup', flex_type: 'flexible', flex_note: 'هماهنگی' },
  { id: 'e', lesson: 'میان‌ترم', date: '2026-11-27', time: '09:00', type: 'exam', days_left: 2 },
  { id: 'f', lesson: 'هفتهٔ بعد', date: '2026-11-28', time: '08:00', type: 'class' },
  { id: 'g', lesson: 'جابه‌جا', date: '2026-11-24', time: '08:00', type: 'class', note: 'تغییر ساعت به ۱۰' },
];
const p = wp.buildWeekPlan(items, start, { now });
const g2 = wp.buildWeekPlan(items, start, { now, group: '2' });

console.log(JSON.stringify({
  faNum190k: fa.faNum(190000),
  faNumFloat: fa.faNum(16.42),
  faNumNaN: fa.faNum(Number.NaN),
  faNumInf: fa.faNum(Number.POSITIVE_INFINITY),
  faAliasId: fa.fa('40312345'),
  faDigitsTime: fa.faDigits('08:00'),
  faDigitsArabic: fa.faDigits('٠٩:٣٠'),
  faDateIso: fa.faDate('2026-11-25'),
  faShortIso: fa.faShortDate('2026-11-25'),
  faWeekdayIso: fa.faWeekday('2026-11-25'),
  faMonthDayIso: fa.faMonthDay('2026-11-25'),
  faDateInvalid: fa.faDate('bad-date'),
  faPercent75: fa.faPercent(75),
  faPercentDec: fa.faPercent(75.3),
  faPercentNaN: fa.faPercent(Number.NaN),
  termStr: fa.formatTerm('1404-2'),
  termNum: fa.formatTerm(2),
  termObj: fa.formatTerm({ term: '1404-2' }),
  termObjName: fa.formatTerm({ name: '1405-1' }),
  termObjLabel: fa.formatTerm({ label: 'بهار 1405' }),
  termObjTitle: fa.formatTerm({ title: 3 }),
  termPyDict: fa.formatTerm("{'term': '1404-2', 'exams_end_date': ''}"),
  termJson: fa.formatTerm('{"term": "1404-2"}'),
  termBadObj: fa.formatTerm({ foo: 'bar' }),
  termObjStr: fa.formatTerm('[object Object]'),
  termEmptyDictStr: fa.formatTerm("{'foo': 'bar'}"),
  start,
  end: p.end,
  dayNames: p.days.map((d) => d.name),
  counts: p.days.map((d) => d.sessions.length),
  total: p.total,
  remaining: p.remaining,
  exams: p.examCount,
  current: p.current?.id ?? null,
  next: p.next?.id ?? null,
  nextMarked: p.next?.isNext ?? false,
  g2: g2.days.flatMap((d) => d.sessions.map((s) => s.id)),
  both: wp.hasBothGroups(items),
  rangeCrossMonth: wp.jalaliRange('2026-11-21', '2026-11-27'),
  rangeSameMonth: wp.jalaliRange('2026-11-28', '2026-12-04'),
  timeLabelA: p.days[4].sessions[0].timeLabel,
  flagsD: p.days[5].sessions[0].flags.map((f) => f.key),
  flagsG: p.days[3].sessions[0].flags.map((f) => f.key),
  examDaysLeft: p.days[6].exams[0].daysLeftLabel,
}));
"""


@unittest.skipUnless(shutil.which("node") and ESBUILD.exists(), "Node.js یا esbuild در دسترس نیست")
class FrontendFaAndWeekPlanTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with tempfile.TemporaryDirectory() as tmp:
            runner = Path(tmp) / "run.mjs"
            runner.write_text(NODE_RUNNER, encoding="utf-8")
            proc = subprocess.run(
                [shutil.which("node"), str(runner), ESBUILD.as_uri(), tmp, str(FA_TS), str(WEEKPLAN_TS)],
                capture_output=True, text=True, encoding="utf-8", timeout=60,
            )
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.out = json.loads(proc.stdout.strip().splitlines()[-1])

    def test_fa_numbers_digits_and_percent(self):
        self.assertEqual(self.out["faNum190k"], "۱۹۰٬۰۰۰")
        self.assertEqual(self.out["faNumFloat"], "۱۶٫۴۲")
        self.assertEqual(self.out["faNumNaN"], "")
        self.assertEqual(self.out["faNumInf"], "")
        self.assertEqual(self.out["faAliasId"], "۴۰۳۱۲۳۴۵")
        self.assertEqual(self.out["faDigitsTime"], "۰۸:۰۰")
        self.assertEqual(self.out["faDigitsArabic"], "۰۹:۳۰")
        self.assertEqual(self.out["faPercent75"], "۷۵٪")
        self.assertEqual(self.out["faPercentDec"], "۷۵٫۳٪")
        self.assertEqual(self.out["faPercentNaN"], "")

    def test_fa_dates(self):
        self.assertEqual(self.out["faDateIso"], "۴ آذر ۱۴۰۵")
        self.assertEqual(self.out["faShortIso"], "۱۴۰۵/۰۹/۰۴")
        self.assertEqual(self.out["faWeekdayIso"], "چهارشنبه")
        self.assertEqual(self.out["faMonthDayIso"], "۴ آذر")
        self.assertEqual(self.out["faDateInvalid"], "")

    def test_format_term_audit_s5(self):
        self.assertEqual(self.out["termStr"], "۱۴۰۴-۲")
        self.assertEqual(self.out["termNum"], "۲")
        self.assertEqual(self.out["termObj"], "۱۴۰۴-۲")
        self.assertEqual(self.out["termObjName"], "۱۴۰۵-۱")
        self.assertEqual(self.out["termObjLabel"], "بهار ۱۴۰۵")
        self.assertEqual(self.out["termObjTitle"], "۳")
        self.assertEqual(self.out["termPyDict"], "۱۴۰۴-۲")
        self.assertEqual(self.out["termJson"], "۱۴۰۴-۲")
        self.assertEqual(self.out["termBadObj"], "")
        self.assertEqual(self.out["termObjStr"], "")
        self.assertEqual(self.out["termEmptyDictStr"], "")

    def test_week_plan_ts(self):
        self.assertEqual(self.out["start"], "2026-11-21")
        self.assertEqual(self.out["end"], "2026-11-27")
        self.assertEqual(self.out["dayNames"][0], "شنبه")
        self.assertEqual(self.out["dayNames"][-1], "جمعه")
        self.assertEqual(self.out["counts"], [0, 1, 0, 1, 2, 1, 0])
        self.assertEqual(self.out["total"], 5)
        self.assertEqual(self.out["remaining"], 3)
        self.assertEqual(self.out["exams"], 1)
        self.assertEqual(self.out["current"], "a")
        self.assertEqual(self.out["next"], "b")
        self.assertTrue(self.out["nextMarked"])
        self.assertEqual(self.out["g2"], ["c", "g", "b", "d"])
        self.assertTrue(self.out["both"])
        self.assertIn("آبان", self.out["rangeCrossMonth"])
        self.assertIn("آذر", self.out["rangeCrossMonth"])
        self.assertIn("۱۴۰۵", self.out["rangeSameMonth"])
        self.assertEqual(self.out["timeLabelA"], "۱۰:۰۰ تا ۱۱:۳۰")
        self.assertEqual(self.out["flagsD"], ["makeup", "flex"])
        self.assertEqual(self.out["flagsG"], ["changed"])
        self.assertEqual(self.out["examDaysLeft"], "۲ روز دیگر")


class ScheduleScreenDsV2Contracts(unittest.TestCase):
    def test_zero_ratchet_debt_and_appbar_present(self):
        tsx = (ROOT / "apps" / "student" / "src" / "screens" / "ScheduleScreen.tsx").read_text(encoding="utf-8")
        css = (ROOT / "apps" / "student" / "src" / "screens" / "schedule.css").read_text(encoding="utf-8")
        self.assertIn("<AppBar", tsx)
        self.assertIn('data-section="schedule"', tsx)
        for src in (tsx, css):
            stripped = re.sub(r"/\*[\s\S]*?\*/", "", src)
            self.assertIsNone(re.search(r"#[0-9a-fA-F]{3,8}\b", stripped))
            self.assertIsNone(re.search(r"rgba?\(", stripped))
            self.assertNotIn("!important", stripped)
            self.assertNotIn("style={{", stripped)
            self.assertIsNone(
                re.search(
                    r"\b(?:margin|padding|border)-(?:left|right)\b|(?<![\w-])(?:left|right)\s*:|text-align:\s*(?:left|right)\b|float:\s*(?:left|right)\b",
                    stripped,
                )
            )


if __name__ == "__main__":
    unittest.main()
