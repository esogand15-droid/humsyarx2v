"""Adversarial stress harness for M1 Flagship Medical Student Command Center Dashboard.

Empirically tests:
1. /api/web/dashboard
2. /api/web/dashboard/weekly
3. /api/web/subscription/status
4. /api/web/library/continue
Under extreme edge cases: null/empty user, missing subscriptions, zero solved questions,
zero streak, zero total pages, corrupt/missing reading items, past/future/invalid exam dates.
"""
from __future__ import annotations

import copy
import os
import sys
import unittest
from datetime import date, datetime, timedelta
from typing import Any
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
from backend.core.time_utils import now_tehran


class MockAsyncCursor:
    """Async cursor simulating Motor for collection queries."""

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
    """Mock MongoDB collection supporting find and sort."""

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


class TestAdversarialFlagshipM1(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.user = {
            "id": 999001,
            "user_id": 999001,
            "name": "دکتر آزمایشی",
            "_db": {
                "name": "دکتر آزمایشی",
                "nickname": "آزمایشگر",
                "intake": "بهمن ۱۴۰۲",
                "group": "گروه ب",
                "role": "student",
            },
        }
        app.dependency_overrides[get_current_user] = lambda: self.user
        app.dependency_overrides[current_student] = lambda: self.user

    def tearDown(self):
        app.dependency_overrides.clear()

    # ─────────────────────────────────────────────────────────────
    # 1. /api/web/dashboard Stress Tests
    # ─────────────────────────────────────────────────────────────
    def test_dashboard_success_normal_flow(self):
        """Normal response with full stats and upcoming exams."""
        today_iso = now_tehran().date().strftime("%Y-%m-%d")
        exams_fixture = [
            {"_id": "e1", "lesson": "آناتومی بالینی", "date": today_iso, "time": "09:00"},
            {"_id": "e2", "lesson": "فیزیولوژی پزشکی", "date": (now_tehran().date() + timedelta(days=2)).strftime("%Y-%m-%d"), "time": "10:30"},
        ]

        with patch.object(db, "user_stats", new_callable=AsyncMock) as m_stats, \
             patch.object(db, "upcoming_exams", new_callable=AsyncMock) as m_exams, \
             patch.object(db, "ticket_get_user", new_callable=AsyncMock) as m_tickets, \
             patch.object(db, "prestige_state", new_callable=AsyncMock) as m_prestige:

            m_stats.return_value = {
                "total_answers": 150,
                "correct_answers": 120,
                "percentage": 80.0,
                "week_activity": 45,
                "weak_topics": ["قلب", "ریه"],
            }
            m_exams.return_value = exams_fixture
            m_tickets.return_value = [{"status": "open"}, {"status": "closed"}]
            m_prestige.return_value = {"xp": 1200, "level": 4, "streak": {"current": 5, "best": 12}}

            res = self.client.get("/api/web/dashboard")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertEqual(data["user"]["name"], "دکتر آزمایشی")
            self.assertEqual(data["stats"]["total_answers"], 150)
            self.assertEqual(data["stats"]["correct_answers"], 120)
            self.assertEqual(data["stats"]["percentage"], 80.0)
            self.assertEqual(len(data["upcoming_exams"]), 2)
            self.assertEqual(data["upcoming_exams"][0]["days_left"], 0)
            self.assertEqual(data["upcoming_exams"][1]["days_left"], 2)
            self.assertEqual(data["open_tickets"], 1)

    def test_dashboard_empty_null_state_zero_answers_zero_streak(self):
        """Empty user state, 0 answers, 0 streak, missing _db, empty prestige."""
        empty_user = {"id": 999002, "user_id": 999002}
        app.dependency_overrides[get_current_user] = lambda: empty_user

        with patch.object(db, "user_stats", new_callable=AsyncMock) as m_stats, \
             patch.object(db, "upcoming_exams", new_callable=AsyncMock) as m_exams, \
             patch.object(db, "ticket_get_user", new_callable=AsyncMock) as m_tickets, \
             patch.object(db, "prestige_state", new_callable=AsyncMock) as m_prestige:

            m_stats.return_value = {}  # completely empty stats
            m_exams.return_value = []
            m_tickets.return_value = []
            m_prestige.return_value = {}

            res = self.client.get("/api/web/dashboard")
            self.assertEqual(res.status_code, 200)
            data = res.json()

            # Verify no 500, defaults properly populated
            self.assertEqual(data["user"]["role"], "student")
            self.assertEqual(data["stats"]["total_answers"], 0)
            self.assertEqual(data["stats"]["correct_answers"], 0)
            self.assertEqual(data["stats"]["percentage"], 0)
            self.assertEqual(data["upcoming_exams"], [])
            self.assertEqual(data["open_tickets"], 0)
            self.assertEqual(data["prestige"], {})

    def test_dashboard_exam_date_edge_cases(self):
        """Adversarial dates in exams: today, past, far future, invalid string, None."""
        today = now_tehran().date()
        today_iso = today.strftime("%Y-%m-%d")
        past_iso = (today - timedelta(days=10)).strftime("%Y-%m-%d")
        future_iso = (today + timedelta(days=120)).strftime("%Y-%m-%d")

        adversarial_exams = [
            {"_id": "today", "lesson": "آزمون امروز", "date": today_iso, "time": "08:00"},
            {"_id": "past", "lesson": "آزمون گذشته", "date": past_iso, "time": "14:00"},
            {"_id": "future", "lesson": "آزمون آینده", "date": future_iso, "time": "11:00"},
            {"_id": "invalid", "lesson": "آزمون با تاریخ نامعتبر", "date": "not-a-valid-date", "time": ""},
            {"_id": "none_date", "lesson": "آزمون بدون تاریخ", "date": None, "time": ""},
        ]

        with patch.object(db, "user_stats", new_callable=AsyncMock) as m_stats, \
             patch.object(db, "upcoming_exams", new_callable=AsyncMock) as m_exams, \
             patch.object(db, "ticket_get_user", new_callable=AsyncMock) as m_tickets, \
             patch.object(db, "prestige_state", new_callable=AsyncMock) as m_prestige:

            m_stats.return_value = {}
            m_exams.return_value = adversarial_exams
            m_tickets.return_value = []
            m_prestige.return_value = {}

            res = self.client.get("/api/web/dashboard")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            exams = data["upcoming_exams"]

            # Backend slices [:3]
            self.assertEqual(len(exams), 3)
            # Exam today -> days_left == 0
            self.assertEqual(exams[0]["days_left"], 0)
            # Exam past -> max(0, -10) == 0 (gracefully clamped, never crashes)
            self.assertEqual(exams[1]["days_left"], 0)
            # Exam future -> days_left == 120
            self.assertEqual(exams[2]["days_left"], 120)

    # ─────────────────────────────────────────────────────────────
    # 2. /api/web/dashboard/weekly Stress Tests
    # ─────────────────────────────────────────────────────────────
    def test_dashboard_weekly_normal_and_empty(self):
        """Weekly activity endpoint returns valid structure without crashing."""
        with patch.object(db, "weekly_activity", new_callable=AsyncMock) as m_weekly:
            # Case 1: Empty DB result -> empty list
            m_weekly.return_value = []
            res = self.client.get("/api/web/dashboard/weekly")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertIn("weekly", data)
            self.assertEqual(data["weekly"], [])

            # Case 2: Populated DB result (7 days)
            weekly_fixture = [
                {"date": "2026-11-02", "count": 10},
                {"date": "2026-11-03", "count": 15},
                {"date": "2026-11-04", "count": 0},
                {"date": "2026-11-05", "count": 25},
                {"date": "2026-11-06", "count": 30},
                {"date": "2026-11-07", "count": 5},
                {"date": "2026-11-08", "count": 40},
            ]
            m_weekly.return_value = weekly_fixture
            res2 = self.client.get("/api/web/dashboard/weekly")
            self.assertEqual(res2.status_code, 200)
            data2 = res2.json()
            self.assertEqual(len(data2["weekly"]), 7)
            self.assertEqual(data2["weekly"][0]["count"], 10)
            self.assertEqual(data2["weekly"][6]["count"], 40)

    # ─────────────────────────────────────────────────────────────
    # 3. /api/web/subscription/status Stress Tests
    # ─────────────────────────────────────────────────────────────
    def test_subscription_status_missing_and_defaults(self):
        """User with no active subscription returns active=False, days_left=0, no crash."""
        with patch.object(db, "sub_get", new_callable=AsyncMock) as m_sub, \
             patch.object(db, "sub_is_active", new_callable=AsyncMock) as m_active, \
             patch.object(db, "sub_days_left", new_callable=AsyncMock) as m_days, \
             patch.object(db, "sub_plan_list", new_callable=AsyncMock) as m_plans, \
             patch.object(db, "sub_payment_history", new_callable=AsyncMock) as m_hist, \
             patch.object(db, "get_setting", new_callable=AsyncMock) as m_setting:

            m_sub.return_value = None
            m_active.return_value = False
            m_days.return_value = 0
            m_plans.return_value = []
            m_hist.return_value = []
            m_setting.return_value = False

            with patch("backend.bot.subscription.has_access", new_callable=AsyncMock) as m_access:
                m_access.return_value = False
                res = self.client.get("/api/web/subscription/status")
                self.assertEqual(res.status_code, 200)
                data = res.json()
                self.assertFalse(data["active"])
                self.assertEqual(data["days_left"], 0)
                self.assertEqual(data["plan_name"], "")
                self.assertEqual(data["expires"], "")
                self.assertFalse(data["has_pending_payment"])

    def test_subscription_status_active_plan(self):
        """User with active subscription returns valid days_left and plan_name."""
        with patch.object(db, "sub_get", new_callable=AsyncMock) as m_sub, \
             patch.object(db, "sub_is_active", new_callable=AsyncMock) as m_active, \
             patch.object(db, "sub_days_left", new_callable=AsyncMock) as m_days, \
             patch.object(db, "sub_plan_list", new_callable=AsyncMock) as m_plans, \
             patch.object(db, "sub_payment_history", new_callable=AsyncMock) as m_hist, \
             patch.object(db, "get_setting", new_callable=AsyncMock) as m_setting:

            m_sub.return_value = {
                "plan_name": "طرح المپیاد و دستیاری",
                "end_date": "2027-01-15T00:00:00",
            }
            m_active.return_value = True
            m_days.return_value = 68
            m_plans.return_value = []
            m_hist.return_value = []
            m_setting.return_value = True

            with patch("backend.bot.subscription.has_access", new_callable=AsyncMock) as m_access:
                m_access.return_value = True
                res = self.client.get("/api/web/subscription/status")
                self.assertEqual(res.status_code, 200)
                data = res.json()
                self.assertTrue(data["active"])
                self.assertEqual(data["days_left"], 68)
                self.assertEqual(data["plan_name"], "طرح المپیاد و دستیاری")
                self.assertEqual(data["expires"], "2027-01-15")

    # ─────────────────────────────────────────────────────────────
    # 4. /api/web/library/continue Stress Tests
    # ─────────────────────────────────────────────────────────────
    def test_library_continue_empty(self):
        """Reading progress empty -> returns items: []."""
        mock_col = MockCollection([])
        with patch("backend.api.routers.web_reader._coll", return_value=mock_col):
            res = self.client.get("/api/web/library/continue")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertEqual(data, {"items": []})

    def test_library_continue_zero_division_guard_and_clamp(self):
        """Test progress documents with total=0 (no division by zero), and clamping."""
        progress_docs = [
            # total = 0 should return percent = 0
            {"uid": 999001, "scope": "res", "file_id": "f_zero", "page": 5, "total": 0, "updated_at": "2026-11-08"},
            # page > total should clamp percent to 100
            {"uid": 999001, "scope": "res", "file_id": "f_over", "page": 150, "total": 100, "updated_at": "2026-11-07"},
            # negative page should clamp to 0
            {"uid": 999001, "scope": "res", "file_id": "f_neg", "page": -5, "total": 50, "updated_at": "2026-11-06"},
            # valid progress 14 of 86
            {"uid": 999001, "scope": "res", "file_id": "f_valid", "page": 14, "total": 86, "updated_at": "2026-11-05"},
            # missing file should be ignored
            {"uid": 999001, "scope": "res", "file_id": "f_missing", "page": 1, "total": 10, "updated_at": "2026-11-04"},
        ]
        mock_col = MockCollection(progress_docs)

        async def fake_item(scope, fid):
            if fid == "f_missing":
                return None
            return {
                "_id": fid,
                "name": f"جزوه {fid}",
                "mime_type": "application/pdf",
                "file_extension": "pdf",
                "file_size": 1024,
            }

        with patch("backend.api.routers.web_reader._coll", return_value=mock_col), \
             patch("backend.api.routers.web_reader._item", side_effect=fake_item):

            res = self.client.get("/api/web/library/continue")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            items = data["items"]
            # 4 valid items, f_missing filtered out
            self.assertEqual(len(items), 4)

            # Check f_zero
            self.assertEqual(items[0]["id"], "f_zero")
            self.assertEqual(items[0]["percent"], 0)

            # Check f_over
            self.assertEqual(items[1]["id"], "f_over")
            self.assertEqual(items[1]["percent"], 100)

            # Check f_neg
            self.assertEqual(items[2]["id"], "f_neg")
            self.assertEqual(items[2]["percent"], 0)

            # Check f_valid: 14 / 86 = 16.27% -> round = 16
            self.assertEqual(items[3]["id"], "f_valid")
            self.assertEqual(items[3]["percent"], 16)
            self.assertEqual(items[3]["page"], 14)
            self.assertEqual(items[3]["total"], 86)


if __name__ == "__main__":
    unittest.main()
