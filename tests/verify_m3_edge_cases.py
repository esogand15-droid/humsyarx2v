# -*- coding: utf-8 -*-
"""Empirical Challenger Test Suite: Flagship Milestone M3 Edge Conditions & Stress Tests.

Conducted by: challenger_flagship_m3 (EMPIRICAL CHALLENGER)
Focus Areas:
1. Zero study streak, zero answers, or empty weekly activity (dashboard & analytics).
2. Non-finite float coordinates (NaN, +Inf, -Inf), out-of-range bounds, and invalid pages in sticky notes.
3. Support tickets with no replies, unread counts, and users with no subscription.
4. Iranian medical university credit-weighted GPA calculation with zero-credit, missing credits, failing grades, un-graded courses, and empty transcripts.
"""
from __future__ import annotations

import copy
import math
import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BACKEND_DIR = os.path.join(ROOT, "backend")
if ROOT in sys.path:
    sys.path.remove(ROOT)
sys.path.insert(0, ROOT)
if BACKEND_DIR not in sys.path:
    sys.path.append(BACKEND_DIR)

os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017/medicalbot")
os.environ.setdefault("ADMIN_ID", "1")
os.environ.setdefault("TELEGRAM_TOKEN", "123:TEST")
os.environ.setdefault("TZ", "Asia/Tehran")

from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.api.main import app
from backend.api.auth import get_current_user
from backend.api.routers import web_ink
from backend.api.routers.web_ink import StickyNoteModel, MAX_PAGE
from backend.api.routers.web_student import current_student
from database import db
from grade_utils import calculate_weighted_transcript


class TestEmpiricalM3DashboardEdgeCases(unittest.TestCase):
    """Stress-test zero study streak, zero answers, and empty weekly activity."""

    def setUp(self):
        self.client = TestClient(app)
        self.user_id = 955001
        self.user = {
            "id": self.user_id,
            "user_id": self.user_id,
            "name": "دانشجوی جدید آزمایشی",
            "_db": {
                "user_id": self.user_id,
                "name": "دانشجوی جدید آزمایشی",
                "role": "student",
            },
        }
        app.dependency_overrides[get_current_user] = lambda: self.user
        app.dependency_overrides[current_student] = lambda: self.user

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_dashboard_with_zero_answers_zero_streak_empty_exams(self):
        """Dashboard overview handles brand new user with 0 answers, 0 streak, no exams without crashing."""
        with patch.object(db, "user_stats", new_callable=AsyncMock) as m_stats, \
             patch.object(db, "upcoming_exams", new_callable=AsyncMock) as m_exams, \
             patch.object(db, "ticket_get_user", new_callable=AsyncMock) as m_tickets, \
             patch.object(db, "prestige_state", new_callable=AsyncMock) as m_prestige:

            m_stats.return_value = {
                "total_answers": 0,
                "correct_answers": 0,
                "percentage": 0,
                "week_activity": 0,
                "weak_topics": [],
            }
            m_exams.return_value = []
            m_tickets.return_value = []
            m_prestige.return_value = {
                "xp": 0,
                "level": 1,
                "streak": {"current": 0, "best": 0},
            }

            res = self.client.get("/api/web/dashboard")
            self.assertEqual(res.status_code, 200)
            data = res.json()

            # Ensure zero answers does not cause division by zero
            self.assertEqual(data["stats"]["total_answers"], 0)
            self.assertEqual(data["stats"]["correct_answers"], 0)
            self.assertEqual(data["stats"]["percentage"], 0)
            self.assertEqual(data["stats"]["weak_topics"], [])

            # Streak is 0
            self.assertEqual(data["prestige"]["streak"]["current"], 0)
            self.assertEqual(data["prestige"]["streak"]["best"], 0)

            # Open tickets & upcoming exams are empty
            self.assertEqual(data["open_tickets"], 0)
            self.assertEqual(data["upcoming_exams"], [])

    def test_weekly_activity_with_empty_or_none_data(self):
        """Weekly activity returns empty array when no activity logged."""
        with patch.object(db, "weekly_activity", new_callable=AsyncMock) as m_weekly:
            m_weekly.return_value = []
            res = self.client.get("/api/web/dashboard/weekly")
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json(), {"weekly": []})

            m_weekly.return_value = None
            res2 = self.client.get("/api/web/dashboard/weekly")
            self.assertEqual(res2.status_code, 200)
            self.assertEqual(res2.json(), {"weekly": []})


class TestEmpiricalM3StickyNoteCoordinates(unittest.TestCase):
    """Stress-test non-finite float coordinates and edge bounds in sticky notes."""

    def test_reject_non_finite_and_out_of_bound_floats(self):
        """Pydantic model must reject NaN, +inf, -inf, <0, and >1 coordinates."""
        invalid_floats = [float("nan"), float("inf"), float("-inf"), -0.0001, -100.0, 1.0001, 999.0]
        for val in invalid_floats:
            with self.subTest(coord_x=val):
                with self.assertRaises(ValidationError):
                    StickyNoteModel(x=val)
            with self.subTest(coord_y=val):
                with self.assertRaises(ValidationError):
                    StickyNoteModel(y=val)

    def test_reject_invalid_page_boundaries(self):
        """Page numbers outside [1, MAX_PAGE] must raise ValidationError."""
        invalid_pages = [-10, -1, 0, MAX_PAGE + 1, 999999]
        for p in invalid_pages:
            with self.subTest(page=p):
                with self.assertRaises(ValidationError):
                    StickyNoteModel(page=p)

    def test_endpoint_rejects_non_finite_in_payload(self):
        """PUT /api/web/ink/{scope}/{file_id}/{page} returns 422 when note coordinates are non-finite or invalid."""
        client = TestClient(app)
        user = {"user_id": 955002, "name": "آزمون‌گر", "role": "student"}
        app.dependency_overrides[current_student] = lambda: user
        try:
            # 1. Coordinate > 1.0
            bad_payload_1 = {
                "notes": [
                    {"note_id": "bad-1", "page": 1, "x": 1.5, "y": 0.5, "text": "test"}
                ]
            }
            res1 = client.put("/api/web/ink/res/booklet-01/1", json=bad_payload_1)
            self.assertEqual(res1.status_code, 422)

            # 2. Negative coordinate
            bad_payload_2 = {
                "notes": [
                    {"note_id": "bad-2", "page": 1, "x": -0.1, "y": 0.5, "text": "test"}
                ]
            }
            res2 = client.put("/api/web/ink/res/booklet-01/1", json=bad_payload_2)
            self.assertEqual(res2.status_code, 422)
        finally:
            app.dependency_overrides.clear()


class TestEmpiricalM3TicketAndSubscriptionEdgeCases(unittest.TestCase):
    """Stress-test tickets without replies and users without subscription."""

    def setUp(self):
        self.client = TestClient(app)
        self.user_id = 955003
        self.user = {
            "id": self.user_id,
            "user_id": self.user_id,
            "name": "دانشجوی بدون اشتراک",
            "_db": {
                "user_id": self.user_id,
                "name": "دانشجوی بدون اشتراک",
                "role": "student",
            },
        }
        app.dependency_overrides[get_current_user] = lambda: self.user

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_ticket_with_zero_replies(self):
        """Ticket with no replies returns 200 with empty replies list and 0 unread."""
        ticket_doc = {
            "ticket_id": 4040,
            "user_id": self.user_id,
            "subject": "سوال درباره آزمون جامع",
            "message": "آیا تاریخ آزمون تمدید شده است؟",
            "status": "open",
            "priority": "normal",
            "replies": [],
            "created_at": "2026-11-08T10:00:00Z",
        }

        with patch.object(db, "ticket_get", new_callable=AsyncMock) as m_get, \
             patch.object(db.tickets, "update_one", new_callable=AsyncMock):

            m_get.return_value = ticket_doc
            res = self.client.get("/api/web/tickets/4040")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            ticket = data["ticket"]
            self.assertEqual(ticket["id"], 4040)
            self.assertEqual(ticket["reply_count"], 0)
            self.assertEqual(ticket["replies"], [])

    def test_user_without_subscription(self):
        """User with no subscription returns active=False, days_left=0, empty plan."""
        with patch.object(db, "sub_get", new_callable=AsyncMock) as m_sub, \
             patch.object(db, "sub_is_active", new_callable=AsyncMock) as m_active, \
             patch.object(db, "sub_days_left", new_callable=AsyncMock) as m_days, \
             patch.object(db, "sub_plan_list", new_callable=AsyncMock) as m_plans, \
             patch.object(db, "sub_payment_history", new_callable=AsyncMock) as m_hist, \
             patch.object(db, "get_setting", new_callable=AsyncMock) as m_setting, \
             patch("subscription.has_access", new_callable=AsyncMock) as m_access:

            m_sub.return_value = None
            m_active.return_value = False
            m_days.return_value = 0
            m_plans.return_value = []
            m_hist.return_value = []
            m_setting.return_value = False
            m_access.return_value = False

            res = self.client.get("/api/web/subscription/status")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertFalse(data["active"])
            self.assertEqual(data["days_left"], 0)
            self.assertEqual(data["plan_name"], "")
            self.assertEqual(data["expires"], "")


class TestEmpiricalM3GpaEdgeCases(unittest.TestCase):
    """Stress-test Iranian medical university GPA calculation on zero-credits, failing grades, and empty transcripts."""

    def test_gpa_empty_transcript(self):
        """Empty transcript returns cumulative_gpa=None and 0 credits."""
        res = calculate_weighted_transcript([])
        self.assertIsNone(res["cumulative_gpa"])
        self.assertEqual(res["total_credits"], 0)
        self.assertEqual(res["passed_credits"], 0)
        self.assertEqual(res["failed_credits"], 0)
        self.assertEqual(res["semesters"], [])

    def test_gpa_zero_credit_course_defaults_to_safe_units(self):
        """Course with credits=0 or units=0 is safely assigned standard units without dividing by zero."""
        records = [
            {"lesson": "آناتومی سر و گردن", "score": 16.0, "credits": 0, "term": "ترم ۱"},
        ]
        res = calculate_weighted_transcript(records)
        self.assertIsNotNone(res["cumulative_gpa"])
        # Should default credits to 2.0 and score to 16.0 -> GPA = 16.0
        self.assertAlmostEqual(res["cumulative_gpa"], 16.0)
        self.assertEqual(res["total_credits"], 2)
        self.assertEqual(res["passed_credits"], 2)
        self.assertEqual(res["failed_credits"], 0)

    def test_gpa_failing_grades_contribute_to_weighted_average_and_failed_credits(self):
        """Failing grades (< 10.0) increment failed_credits and lower GPA conforming to Iranian medical regulations."""
        records = [
            # Passed: 18.0 with 3 credits -> 54 points
            {"lesson": "فیزیولوژی کلیه", "score": 18.0, "credits": 3.0, "term": "ترم ۲"},
            # Failed: 8.0 with 2 credits -> 16 points (failed)
            {"lesson": "بیوشیمی بالینی", "score": 8.0, "credits": 2.0, "term": "ترم ۲"},
        ]
        # Total points = 54 + 16 = 70. Total credits = 3 + 2 = 5. GPA = 70 / 5 = 14.0
        res = calculate_weighted_transcript(records)
        self.assertAlmostEqual(res["cumulative_gpa"], 14.0)
        self.assertEqual(res["total_credits"], 5)
        self.assertEqual(res["passed_credits"], 3)
        self.assertEqual(res["failed_credits"], 2)

    def test_gpa_course_without_score_is_excluded_from_gpa_math(self):
        """Course with score=None or score < 0 is listed in courses but excluded from GPA sum."""
        records = [
            {"lesson": "ایمونولوژی", "score": 15.0, "credits": 2.0, "term": "ترم ۳"},
            {"lesson": "زبان تخصصی (در حال برگزاری)", "score": None, "credits": 2.0, "term": "ترم ۳"},
        ]
        res = calculate_weighted_transcript(records)
        self.assertAlmostEqual(res["cumulative_gpa"], 15.0)
        self.assertEqual(res["total_credits"], 2)
        self.assertEqual(res["passed_credits"], 2)
        self.assertEqual(res["failed_credits"], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
