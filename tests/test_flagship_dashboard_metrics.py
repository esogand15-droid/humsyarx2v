# -*- coding: utf-8 -*-
"""Flagship Test Suite: Medical Student Command Center Dashboard & Clinical Metrics.

Verifies Requirement R1:
1. GET /api/web/dashboard overview payload: student profile, academic intake/term,
   study streak counter, accuracy rate, weak topics, open tickets, prestige metrics.
2. GET /api/web/dashboard/weekly activity chart payload: 7-day continuous activity array.
3. Continue Reading card payload from reading_progress (GET /api/web/library/continue):
   exact page, total pages, visual percentage, booklet title, zero division guard.
4. Active subscription status & Jalali expiration countdown (GET /api/web/subscription/status).
5. Solar Hijri / Jalali exam countdown calculation, date boundary handling, and course tags.
6. Verification of the 7 Quick-Access Command Center modules and their backend routes:
   QBank (/api/web/exam), Library (/api/web/library/lessons), Reader/Ink (/api/web/ink/notes),
   AI Chat (/api/ai/ask), Grades (/api/web/grades), Schedule (/api/web/schedule), Support (/api/web/tickets).
"""
from __future__ import annotations

import copy
from datetime import date, datetime, timedelta
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

from backend.api.main import app
from backend.api.auth import get_current_user
from backend.api.routers.web_student import current_student
from backend.database.database import db
from backend.core.time_utils import gregorian_to_jalali, parse_gregorian_date
from backend.bot.utils import now_tehran


class MockAsyncCursor:
    """Async cursor simulator for Motor query chains."""

    def __init__(self, items: list[dict]):
        self._items = list(items)

    def sort(self, key_or_list, direction=1):
        if isinstance(key_or_list, list):
            for k, d in reversed(key_or_list):
                self._items.sort(key=lambda x: str(x.get(k, "")), reverse=(d == -1))
        else:
            self._items.sort(key=lambda x: str(x.get(key_or_list, "")), reverse=(direction == -1))
        return self

    def limit(self, count: int):
        self._items = self._items[:count]
        return self

    def __aiter__(self):
        self._iter = iter(self._items)
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration:
            raise StopAsyncIteration

    async def to_list(self, length=None):
        if length is not None:
            return [copy.deepcopy(x) for x in self._items[:length]]
        return [copy.deepcopy(x) for x in self._items]


class MockCollection:
    """In-memory collection mock for testing reading_progress and related collections."""

    def __init__(self, docs: list[dict] | None = None):
        self.docs = list(docs or [])

    def find(self, query=None, *args, **kwargs):
        filtered = []
        for d in self.docs:
            match = True
            if query:
                for k, v in query.items():
                    if d.get(k) != v:
                        match = False
                        break
            if match:
                filtered.append(copy.deepcopy(d))
        return MockAsyncCursor(filtered)

    async def find_one(self, query=None, *args, **kwargs):
        cursor = self.find(query)
        res = await cursor.to_list(1)
        return res[0] if res else None


class TestFlagshipDashboardMetrics(unittest.TestCase):
    """Test suite for Flagship Medical Student Command Center Dashboard."""

    def setUp(self):
        self.client = TestClient(app)
        self.user_id = 900101
        self.user = {
            "id": self.user_id,
            "user_id": self.user_id,
            "name": "دکتر نیلوفر سپهری",
            "_db": {
                "user_id": self.user_id,
                "name": "دکتر نیلوفر سپهری",
                "nickname": "نیلوفر",
                "student_id": "401123456",
                "intake": "مهر ۱۴۰۱",
                "group": "گروه الف بالینی",
                "role": "student",
            },
        }
        app.dependency_overrides[get_current_user] = lambda: self.user
        app.dependency_overrides[current_student] = lambda: self.user

    def tearDown(self):
        app.dependency_overrides.clear()

    # ─────────────────────────────────────────────────────────────
    # 1. Overview Payload Contract
    # ─────────────────────────────────────────────────────────────
    def test_dashboard_overview_complete_payload(self):
        """Test GET /api/web/dashboard returns full student profile, accuracy, streak, and exams."""
        today = now_tehran().date()
        today_iso = today.strftime("%Y-%m-%d")
        future_iso = (today + timedelta(days=5)).strftime("%Y-%m-%d")

        exams_data = [
            {
                "_id": "ex-01",
                "lesson": "فارماکولوژی بالینی",
                "date": today_iso,
                "time": "08:30",
                "group": "گروه الف بالینی",
                "course_code": "PHARM-301",
            },
            {
                "_id": "ex-02",
                "lesson": "پاتولوژی عمومی",
                "date": future_iso,
                "time": "10:00",
                "group": "گروه الف بالینی",
                "course_code": "PATH-202",
            },
        ]

        with patch.object(db, "user_stats", new_callable=AsyncMock) as m_stats, \
             patch.object(db, "upcoming_exams", new_callable=AsyncMock) as m_exams, \
             patch.object(db, "ticket_get_user", new_callable=AsyncMock) as m_tickets, \
             patch.object(db, "prestige_state", new_callable=AsyncMock) as m_prestige:

            m_stats.return_value = {
                "total_answers": 340,
                "correct_answers": 289,
                "percentage": 85.0,
                "week_activity": 65,
                "weak_topics": ["آنتی‌بیوتیک‌ها", "آریتمی قلبی"],
            }
            m_exams.return_value = exams_data
            m_tickets.return_value = [{"status": "open"}, {"status": "resolved"}]
            m_prestige.return_value = {
                "xp": 3450,
                "level": 6,
                "level_title": "اینترن ارشد",
                "streak": {"current": 14, "best": 21},
                "exams_completed": 8,
            }

            res = self.client.get("/api/web/dashboard")
            self.assertEqual(res.status_code, 200)
            data = res.json()

            # Profile verification
            user_data = data["user"]
            self.assertEqual(user_data["name"], "دکتر نیلوفر سپهری")
            self.assertEqual(user_data["nickname"], "نیلوفر")
            self.assertEqual(user_data["intake"], "مهر ۱۴۰۱")
            self.assertEqual(user_data["group"], "گروه الف بالینی")
            self.assertEqual(user_data["role"], "student")

            # Clinical analytics metrics
            stats = data["stats"]
            self.assertEqual(stats["total_answers"], 340)
            self.assertEqual(stats["correct_answers"], 289)
            self.assertEqual(stats["percentage"], 85.0)
            self.assertIn("آنتی‌بیوتیک‌ها", stats["weak_topics"])

            # Prestige & Study Streak
            prestige = data["prestige"]
            self.assertEqual(prestige["xp"], 3450)
            self.assertEqual(prestige["level"], 6)
            self.assertEqual(prestige["streak"]["current"], 14)
            self.assertEqual(prestige["streak"]["best"], 21)

            # Open Tickets
            self.assertEqual(data["open_tickets"], 1)

            # Upcoming Exams
            upcoming = data["upcoming_exams"]
            self.assertEqual(len(upcoming), 2)
            self.assertEqual(upcoming[0]["lesson"], "فارماکولوژی بالینی")
            self.assertEqual(upcoming[0]["days_left"], 0)
            self.assertEqual(upcoming[1]["lesson"], "پاتولوژی عمومی")
            self.assertEqual(upcoming[1]["days_left"], 5)

    # ─────────────────────────────────────────────────────────────
    # 2. Weekly Activity Chart
    # ─────────────────────────────────────────────────────────────
    def test_dashboard_weekly_activity_payload(self):
        """Test GET /api/web/dashboard/weekly returns continuous 7-day array."""
        weekly_fixture = [
            {"date": "2026-11-02", "count": 12},
            {"date": "2026-11-03", "count": 25},
            {"date": "2026-11-04", "count": 18},
            {"date": "2026-11-05", "count": 30},
            {"date": "2026-11-06", "count": 0},
            {"date": "2026-11-07", "count": 42},
            {"date": "2026-11-08", "count": 15},
        ]

        with patch.object(db, "weekly_activity", new_callable=AsyncMock) as m_weekly:
            m_weekly.return_value = weekly_fixture
            res = self.client.get("/api/web/dashboard/weekly")
            self.assertEqual(res.status_code, 200)
            body = res.json()
            self.assertIn("weekly", body)
            self.assertEqual(len(body["weekly"]), 7)
            counts = [item["count"] for item in body["weekly"]]
            self.assertEqual(counts, [12, 25, 18, 30, 0, 42, 15])

    # ─────────────────────────────────────────────────────────────
    # 3. Continue Reading Card Payload
    # ─────────────────────────────────────────────────────────────
    def test_continue_reading_payload_from_reading_progress(self):
        """Test GET /api/web/library/continue parses reading_progress correctly."""
        progress_docs = [
            {
                "uid": self.user_id,
                "scope": "res",
                "file_id": "cardio-res-01",
                "page": 45,
                "total": 90,
                "position": 0.5,
                "kind": "pdf",
                "updated_at": "2026-11-08T14:30:00Z",
            },
            {
                "uid": self.user_id,
                "scope": "ref",
                "file_id": "guyton-ch08",
                "page": 12,
                "total": 240,
                "position": 0.05,
                "kind": "pdf",
                "updated_at": "2026-11-07T10:00:00Z",
            },
        ]
        mock_col = MockCollection(progress_docs)

        async def fake_item(scope, fid):
            if fid == "cardio-res-01":
                return {"_id": fid, "name": "جزوه فیزیولوژی قلب و عروق", "kind": "pdf"}
            if fid == "guyton-ch08":
                return {"_id": fid, "name": "گایتون فصل ۸ - تحریک عضله", "kind": "pdf"}
            return None

        with patch("backend.api.routers.web_reader._coll", return_value=mock_col), \
             patch("backend.api.routers.web_reader._item", side_effect=fake_item):
            res = self.client.get("/api/web/library/continue")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertIn("items", data)
            items = data["items"]
            self.assertEqual(len(items), 2)

            # Item 1: 45 / 90 -> exactly 50%
            self.assertEqual(items[0]["id"], "cardio-res-01")
            self.assertEqual(items[0]["name"], "جزوه فیزیولوژی قلب و عروق")
            self.assertEqual(items[0]["page"], 45)
            self.assertEqual(items[0]["total"], 90)
            self.assertEqual(items[0]["percent"], 50)

            # Item 2: 12 / 240 -> exactly 5%
            self.assertEqual(items[1]["id"], "guyton-ch08")
            self.assertEqual(items[1]["name"], "گایتون فصل ۸ - تحریک عضله")
            self.assertEqual(items[1]["page"], 12)
            self.assertEqual(items[1]["total"], 240)
            self.assertEqual(items[1]["percent"], 5)

    def test_continue_reading_zero_and_clamp_boundaries(self):
        """Test continue reading handles total=0 and clamps out-of-range pages."""
        progress_docs = [
            {"uid": self.user_id, "scope": "res", "file_id": "f_zero", "page": 10, "total": 0, "updated_at": "2026-11-08"},
            {"uid": self.user_id, "scope": "res", "file_id": "f_over", "page": 200, "total": 100, "updated_at": "2026-11-07"},
        ]
        mock_col = MockCollection(progress_docs)

        async def fake_item(scope, fid):
            return {"_id": fid, "name": f"سند {fid}", "kind": "pdf"}

        with patch("backend.api.routers.web_reader._coll", return_value=mock_col), \
             patch("backend.api.routers.web_reader._item", side_effect=fake_item):
            res = self.client.get("/api/web/library/continue")
            self.assertEqual(res.status_code, 200)
            items = res.json()["items"]
            self.assertEqual(items[0]["percent"], 0)   # total=0 -> percent=0 (no ZeroDivisionError)
            self.assertEqual(items[1]["percent"], 100) # page > total -> clamped to 100%

    # ─────────────────────────────────────────────────────────────
    # 4. Subscription Status & Jalali Expiration Countdown
    # ─────────────────────────────────────────────────────────────
    def test_subscription_status_and_expiration_countdown(self):
        """Test GET /api/web/subscription/status returns active plan and days left."""
        with patch.object(db, "sub_get", new_callable=AsyncMock) as m_sub, \
             patch.object(db, "sub_is_active", new_callable=AsyncMock) as m_active, \
             patch.object(db, "sub_days_left", new_callable=AsyncMock) as m_days, \
             patch.object(db, "sub_plan_list", new_callable=AsyncMock) as m_plans, \
             patch.object(db, "sub_payment_history", new_callable=AsyncMock) as m_hist, \
             patch.object(db, "get_setting", new_callable=AsyncMock) as m_setting, \
             patch("backend.bot.subscription.has_access", new_callable=AsyncMock) as m_access:

            m_sub.return_value = {
                "plan_name": "طرح جامع دستیاری پزشکی",
                "end_date": "2027-02-19T20:30:00Z",
            }
            m_active.return_value = True
            m_days.return_value = 103
            m_plans.return_value = []
            m_hist.return_value = []
            m_setting.return_value = True
            m_access.return_value = True

            res = self.client.get("/api/web/subscription/status")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertTrue(data["active"])
            self.assertEqual(data["plan_name"], "طرح جامع دستیاری پزشکی")
            self.assertEqual(data["days_left"], 103)
            self.assertEqual(data["expires"], "2027-02-19")

    # ─────────────────────────────────────────────────────────────
    # 5. Jalali Exam Countdown Calculation
    # ─────────────────────────────────────────────────────────────
    def test_jalali_exam_countdown_calculation(self):
        """Verify Gregorian-to-Jalali date transformation and days_left accuracy."""
        today_tehran = now_tehran().date()
        today_jalali = gregorian_to_jalali(today_tehran)

        # Confirm Solar Hijri calendar attributes
        self.assertGreaterEqual(today_jalali.year, 1403)
        self.assertIn(today_jalali.month, range(1, 13))
        self.assertIn(today_jalali.day, range(1, 32))

        # Test past exam clamping (days_left should never be negative)
        past_date = (today_tehran - timedelta(days=10)).strftime("%Y-%m-%d")
        exam_item = {
            "_id": "past-exam",
            "lesson": "میکروب‌شناسی",
            "date": past_date,
            "time": "09:00",
        }
        with patch.object(db, "user_stats", new_callable=AsyncMock) as m_stats, \
             patch.object(db, "upcoming_exams", new_callable=AsyncMock) as m_exams, \
             patch.object(db, "ticket_get_user", new_callable=AsyncMock) as m_tickets, \
             patch.object(db, "prestige_state", new_callable=AsyncMock) as m_prestige:

            m_stats.return_value = {}
            m_exams.return_value = [exam_item]
            m_tickets.return_value = []
            m_prestige.return_value = {}

            res = self.client.get("/api/web/dashboard")
            self.assertEqual(res.status_code, 200)
            exam = res.json()["upcoming_exams"][0]
            self.assertEqual(exam["days_left"], 0)

    # ─────────────────────────────────────────────────────────────
    # 6. Quick-Access Command Center Modules Reachability
    # ─────────────────────────────────────────────────────────────
    def test_quick_access_command_modules_reachability(self):
        """Verify that all 7 Quick-Access Command Center modules have live, registered API endpoints.

        Modules:
        1. QBank: /api/web/exam/...
        2. Library: /api/web/library/...
        3. Reader/Ink: /api/web/ink/...
        4. AI Chat: /api/ai/ask
        5. Grades: /api/web/grades
        6. Schedule: /api/web/schedule
        7. Support: /api/web/tickets
        """
        registered_paths = {route.path for route in app.routes if hasattr(route, "path")}

        # 1. QBank Practice / Exam
        self.assertTrue(any(p.startswith("/api/web/exam") for p in registered_paths),
                        "QBank web route missing")

        # 2. Library Catalog
        self.assertTrue(any(p.startswith("/api/web/library") for p in registered_paths),
                        "Library web route missing")

        # 3. Reader & Digital Ink Notes
        self.assertTrue(any(p.startswith("/api/web/ink") for p in registered_paths),
                        "Digital ink web route missing")

        # 4. HooshYar AI Chat
        self.assertIn("/api/ai/ask", registered_paths, "AI chat endpoint missing")

        # 5. Grades & GPA
        self.assertTrue(any(p.startswith("/api/web/grades") for p in registered_paths),
                        "Grades web alias route missing")

        # 6. Study Schedule & Jalali Tasks
        self.assertTrue(any(p.startswith("/api/web/schedule") for p in registered_paths),
                        "Schedule web alias route missing")

        # 7. Support Tickets
        self.assertTrue(any(p.startswith("/api/web/tickets") for p in registered_paths),
                        "Tickets web alias route missing")


if __name__ == "__main__":
    unittest.main(verbosity=2)
