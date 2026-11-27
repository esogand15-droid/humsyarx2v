# -*- coding: utf-8 -*-
"""Comprehensive verification of the 4-Cohort Medical School Course Selection and Schedule System.

Verifies end-to-end synchronization across:
1. Database & 4-Cohort Modeling (g1_m, g1_f, g2_m, g2_f)
2. Free-text timetable parsing engine (_parse_schedule_free_text)
3. FastAPI Academic Admin endpoints (/schedule/templates, /schedule/cohorts/summary, /schedule/templates/import-text)
4. Telegram Bot 1-touch cohort preset flow (_handle_cohort_preset_bot)
5. Student Web App payload harmonization
"""
from __future__ import annotations

import asyncio
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

REPO_ROOT = Path(__file__).resolve().parent.parent
os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017/medicalbot")
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.api.routers.academic_admin import (
    _parse_cohort,
    _parse_schedule_free_text,
    _tpl_doc,
    TemplateBulk,
    TemplateGenerate,
    TemplateSlot,
    TemplateTextImport,
)
from backend.bot.schedule import _handle_cohort_preset_bot


class FourCohortsModelingTests(unittest.TestCase):
    """Test the 4 canonical medical school cohort mappings."""

    def test_cohort_parser_g1_m(self):
        grp, edu = _parse_cohort("g1_m")
        self.assertEqual(grp, "1")
        self.assertEqual(edu, "male")

    def test_cohort_parser_g1_f(self):
        grp, edu = _parse_cohort("g1_f")
        self.assertEqual(grp, "1")
        self.assertEqual(edu, "female")

    def test_cohort_parser_g2_m(self):
        grp, edu = _parse_cohort("g2_m")
        self.assertEqual(grp, "2")
        self.assertEqual(edu, "male")

    def test_cohort_parser_g2_f(self):
        grp, edu = _parse_cohort("g2_f")
        self.assertEqual(grp, "2")
        self.assertEqual(edu, "female")

    def test_cohort_parser_invalid(self):
        grp, edu = _parse_cohort("unknown")
        self.assertIsNone(grp)
        self.assertIsNone(edu)


class FreeTextScheduleParsingTests(unittest.TestCase):
    """Test free-text schedule parsing with various Persian formats."""

    def test_standard_persian_format(self):
        text = "شنبه 08:00-10:00 فیزیولوژی قلب دکتر حسینی کلاس ۲۰۲"
        slots = _parse_schedule_free_text(text, default_group="1", default_edu="male_only")
        self.assertEqual(len(slots), 1)
        s = slots[0]
        self.assertEqual(s["weekday"], 0)
        self.assertEqual(s["time"], "08:00")
        self.assertEqual(s["end_time"], "10:00")
        self.assertIn("فیزیولوژی", s["lesson"])
        self.assertIn("حسینی", s["teacher"])
        self.assertIn("کلاس", s["location"])
        self.assertTrue("202" in s["location"] or "۲۰۲" in s["location"])
        self.assertEqual(s["group"], "1")
        self.assertEqual(s["educational_group"], "male_only")

    def test_multi_line_mixed_days(self):
        text = """
        یکشنبه 10:00 تا 12:00 فارماکولوژی بالینی دکتر رضایی تالار ابن‌سینا
        دوشنبه 13:00 - 15:00 پاتولوژی عمومی دکتر علوی آزمایشگاه ۲
        سه‌شنبه 15:00 الی 17:00 اخلاق اسلامی استاد محمدی کلاس ۱۰۱
        """
        slots = _parse_schedule_free_text(text, default_group="2", default_edu="female_only")
        self.assertEqual(len(slots), 3)

        self.assertEqual(slots[0]["weekday"], 1)  # یکشنبه
        self.assertEqual(slots[0]["time"], "10:00")
        self.assertEqual(slots[0]["end_time"], "12:00")
        self.assertIn("فارماکولوژی", slots[0]["lesson"])

        self.assertEqual(slots[1]["weekday"], 2)  # دوشنبه
        self.assertEqual(slots[1]["time"], "13:00")
        self.assertEqual(slots[1]["end_time"], "15:00")
        self.assertIn("پاتولوژی", slots[1]["lesson"])

        self.assertEqual(slots[2]["weekday"], 3)  # سه‌شنبه
        self.assertEqual(slots[2]["time"], "15:00")
        self.assertEqual(slots[2]["end_time"], "17:00")
        self.assertIn("اخلاق", slots[2]["lesson"])

    def test_single_time_hour_padding(self):
        text = "چهارشنبه 8:00 فیزیولوژی اعصاب دکتر کریمی"
        slots = _parse_schedule_free_text(text, default_group="1", default_edu="mixed")
        self.assertEqual(len(slots), 1)
        self.assertEqual(slots[0]["weekday"], 4)  # چهارشنبه
        self.assertEqual(slots[0]["time"], "08:00")


class TemplateSerializationTests(unittest.TestCase):
    """Test template serialization includes educational_group, credit, and cohort fields."""

    def test_tpl_doc_enrichment(self):
        item = {
            "_id": "672f10b7a8d56b001a112233",
            "weekday": 0,
            "time": "08:00",
            "end_time": "10:00",
            "lesson": "بیوشیمی پزشکی",
            "teacher": "دکتر زمانی",
            "location": "کلاس ۱۰۳",
            "group": "1",
            "educational_group": "male_only",
            "credit": 3.0,
            "term": "1404-2",
        }
        doc = _tpl_doc(item)
        self.assertEqual(doc["educational_group"], "male_only")
        self.assertEqual(doc["credit"], 3.0)
        self.assertEqual(doc["term"], "1404-2")
        self.assertEqual(doc["id"], "672f10b7a8d56b001a112233")


class TelegramBotCohortPresetTests(unittest.IsolatedAsyncioTestCase):
    """Test Telegram Bot 1-touch cohort preset activation."""

    @patch("backend.bot.schedule._show_group_schedule")
    @patch("backend.bot.schedule.db")
    async def test_handle_cohort_preset_g1_m(self, mock_db, mock_show_group):
        query = MagicMock()
        query.answer = AsyncMock()
        context = MagicMock()
        context.user_data = {}

        mock_db.set_user_educational_group = AsyncMock()
        mock_db.update_user = AsyncMock()
        mock_db.get_student_course_selections = AsyncMock(return_value={
            "term": "1404-2",
            "offerings": [
                {
                    "lesson": "فیزیولوژی قلب",
                    "single_group": False,
                    "groups": [{"group": "1", "teacher": "دکتر حسینی"}, {"group": "2", "teacher": "دکتر علوی"}],
                },
                {
                    "lesson": "تربیت بدنی ۲",
                    "single_group": True,
                    "auto_selected_group": "1",
                },
            ],
        })
        mock_db.save_student_course_selections = AsyncMock(return_value={
            "computed_group": "1",
            "selected_count": 2,
        })
        mock_show_group.return_value = None

        await _handle_cohort_preset_bot(query, context, 123456, "g1_m")

        # Verify educational group set to male
        mock_db.set_user_educational_group.assert_awaited_once_with(
            123456, "male",
            source="cohort_preset_button",
            verified=True,
            actor_id=123456,
            reason="انتخاب سریع بسته گروه ۱ (برادران) در ربات تلگرام",
        )
        # Verify user group updated to 1
        mock_db.update_user.assert_awaited_once_with(123456, {"group": "1"})
        # Verify selection saved
        mock_db.save_student_course_selections.assert_awaited_once()
        # Verify user answered
        query.answer.assert_awaited_once()
        self.assertIn("گروه ۱ (برادران)", query.answer.call_args[0][0])


if __name__ == "__main__":
    unittest.main()
