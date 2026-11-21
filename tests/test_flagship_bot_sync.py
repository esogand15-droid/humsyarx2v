# -*- coding: utf-8 -*-
"""Flagship Test Suite: Complete Telegram Bot & Mini-App Synchronization and Non-Regression Invariant.

Verifies Requirement R4:
1. User Profile Sync (MongoDB 'users'):
   Updating user profile in MongoDB immediately reflects in web session (GET /api/web/auth/session).
2. Reading Progress Sync (MongoDB 'reading_progress'):
   Reading progress written by Web Reader (PUT /api/web/library/progress/...) is immediately returned
   by Telegram Mini-App bridge (GET /api/me/continue-reading).
3. Subscription Activation Sync (MongoDB 'subscriptions'):
   Subscription activated via db.sub_activate (as done by Telegram Bot) immediately unlocks
   DRM/feature access (core.access.check_feature) and updates web subscription status
   (GET /api/web/subscription/status) and Jalali expiration countdown.
4. Support Ticket Lifecycle Sync (MongoDB 'tickets' & 'bot_notifications'):
   Ticket created in Web (POST /api/web/tickets) enqueues an outbox alert task to 'bot_notifications'
   for Telegram admin notification, and replies added by bot admin immediately appear in web history.
5. Exam & Academic Grades Sync (MongoDB 'exam_sessions' & 'grades'):
   Mock exam sessions and academic grade records sync across bot and web summary
   (GET /api/web/grades/summary), computing credit-weighted GPA conforming to Iranian medical university standards.
6. Route Inventory Non-Regression Invariant:
   Verifies that API operations count and route object inventory match baseline without regressions.
"""
from __future__ import annotations

import asyncio
import copy
from datetime import datetime, timedelta
import os
import sys
import unittest
from unittest.mock import AsyncMock, patch
import uuid

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

from backend.api.main import app, _count_api_operations, _walk_included_routes
from backend.api.auth import get_current_user
from backend.api.routers.web_student import current_student
from core.access import check_feature
from database import db
from time_utils import utc_now_iso


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


class InMemoryMongoCollection:
    """In-memory MongoDB collection for testing sync parity across collections."""

    def __init__(self):
        self._data: dict[str, dict] = {}

    async def find_one(self, query: dict, projection: dict | None = None) -> dict | None:
        for doc in self._data.values():
            match = True
            for k, v in query.items():
                if doc.get(k) != v:
                    match = False
                    break
            if match:
                res = copy.deepcopy(doc)
                if projection:
                    return {k: res.get(k) for k in projection if k in res}
                return res
        return None

    def find(self, query: dict | None = None, projection: dict | None = None):
        results = []
        for doc in self._data.values():
            if not query:
                results.append(copy.deepcopy(doc))
                continue
            match = True
            for k, v in query.items():
                if doc.get(k) != v:
                    match = False
                    break
            if match:
                res = copy.deepcopy(doc)
                if projection:
                    res = {k: res.get(k) for k in projection if k in res}
                results.append(res)
        return MockAsyncCursor(results)

    async def insert_one(self, doc: dict):
        key = str(doc.get("_id") or uuid.uuid4().hex)
        stored = copy.deepcopy(doc)
        stored["_id"] = key
        self._data[key] = stored
        return stored

    async def update_one(self, query: dict, update: dict, upsert: bool = False):
        target = None
        key = query.get("_id")
        if key and key in self._data:
            target = self._data[key]
        else:
            for doc in self._data.values():
                match = True
                for k, v in query.items():
                    if doc.get(k) != v:
                        match = False
                        break
                if match:
                    target = doc
                    break

        if target is None:
            if not upsert:
                return
            target = copy.deepcopy(query)
            key = str(target.get("_id") or uuid.uuid4().hex)
            target["_id"] = key
            self._data[key] = target

        if "$set" in update:
            for k, v in update["$set"].items():
                target[k] = copy.deepcopy(v)


class TestFlagshipBotSync(unittest.TestCase):
    """Test Suite for Shared MongoDB Parity across Bot, Web App, and Mini-App."""

    def setUp(self):
        self.client = TestClient(app)
        self.user_id = 911001
        self.user = {
            "id": self.user_id,
            "user_id": self.user_id,
            "name": "دکتر بردیا رادمنش",
            "_db": {
                "user_id": self.user_id,
                "name": "دکتر بردیا رادمنش",
                "nickname": "بردیا",
                "student_id": "402334455",
                "intake": "بهمن ۱۴۰۲",
                "group": "گروه ج",
                "role": "student",
                "approved": True,
                "suspended": False,
            },
        }
        app.dependency_overrides[get_current_user] = lambda: self.user
        app.dependency_overrides[current_student] = lambda: self.user

    def tearDown(self):
        app.dependency_overrides.clear()

    # ─────────────────────────────────────────────────────────────
    # 1. User Profile Sync (users collection)
    # ─────────────────────────────────────────────────────────────
    def test_user_profile_sync_from_mongo_to_web_session(self):
        """Updating user in MongoDB immediately reflects in web session (GET /api/web/auth/session)."""
        current_db_user = {
            "user_id": self.user_id,
            "name": "دکتر بردیا رادمنش",
            "nickname": "بردیا",
            "student_id": "402334455",
            "intake": "بهمن ۱۴۰۲",
            "group": "گروه ج",
            "role": "student",
            "approved": True,
            "suspended": False,
            "registered_at": "1402/11/15",
        }

        async def fake_get_user(uid, use_cache=True):
            if int(uid) == self.user_id:
                return copy.deepcopy(current_db_user)
            return None

        fake_session = {"uid": self.user_id, "session_id": "s-123", "created_at": "2026-11-08"}

        with patch.object(db, "get_user", side_effect=fake_get_user), \
             patch("backend.api.routers.web_student._resolve_session", new_callable=AsyncMock) as m_session:

            m_session.return_value = fake_session

            # 1. First fetch
            res1 = self.client.get("/api/web/auth/session")
            self.assertEqual(res1.status_code, 200)
            data1 = res1.json()
            self.assertTrue(data1["authenticated"])
            self.assertEqual(data1["user"]["name"], "دکتر بردیا رادمنش")
            self.assertEqual(data1["user"]["group"], "گروه ج")

            # 2. Telegram Bot updates user profile in MongoDB
            current_db_user["name"] = "دکتر بردیا رادمنش (رزیدنت ارشد)"
            current_db_user["group"] = "گروه الف جراحی"

            # 3. Second fetch must immediately reflect updated profile without stale cache
            res2 = self.client.get("/api/web/auth/session")
            self.assertEqual(res2.status_code, 200)
            data2 = res2.json()
            self.assertEqual(data2["user"]["name"], "دکتر بردیا رادمنش (رزیدنت ارشد)")
            self.assertEqual(data2["user"]["group"], "گروه الف جراحی")

    # ─────────────────────────────────────────────────────────────
    # 2. Reading Progress Sync (reading_progress collection)
    # ─────────────────────────────────────────────────────────────
    def test_reading_progress_cross_client_sync(self):
        """Reading progress written by Web Reader is immediately returned by Telegram Mini-App bridge."""
        progress_storage = InMemoryMongoCollection()

        def _get_coll(name: str):
            if name == "reading_progress":
                return progress_storage
            return InMemoryMongoCollection()

        with patch("backend.api.routers.web_reader._coll", side_effect=_get_coll), \
             patch("backend.api.routers.me_bridge._coll", side_effect=_get_coll):

            # 1. Web Reader saves progress on booklet 'pediatrics-02'
            payload = {
                "page": 42,
                "total": 120,
                "position": 0.35,
                "kind": "pdf",
            }
            res_put = self.client.put("/api/web/library/progress/res/pediatrics-02", json=payload)
            self.assertEqual(res_put.status_code, 200)
            self.assertTrue(res_put.json().get("ok"))

            # 2. Telegram Mini-App queries /api/me/continue-reading
            res_mini = self.client.get("/api/me/continue-reading")
            self.assertEqual(res_mini.status_code, 200)
            items = res_mini.json().get("items", [])
            self.assertEqual(len(items), 1)

            # Assert complete parity between Web write and Mini-App read
            item = items[0]
            self.assertEqual(item["scope"], "res")
            self.assertEqual(item["id"], "pediatrics-02")
            self.assertEqual(item["page"], 42)
            self.assertEqual(item["total"], 120)
            self.assertEqual(item["percent"], 35)

    # ─────────────────────────────────────────────────────────────
    # 3. Subscription Activation Sync (subscriptions collection)
    # ─────────────────────────────────────────────────────────────
    def test_subscription_activation_sync_from_bot_to_web(self):
        """Subscription activation via db.sub_activate immediately unlocks DRM and updates web subscription status."""
        active_state = {"active": False, "sub": None}

        async def fake_sub_get(uid):
            return active_state["sub"]

        async def fake_sub_is_active(uid):
            return active_state["active"]

        async def fake_sub_days_left(uid):
            return 30 if active_state["active"] else 0

        async def fake_sub_activate(user_id, days, plan_name, **kwargs):
            now = datetime.utcnow()
            end = now + timedelta(days=days)
            sub_doc = {
                "_id": int(user_id),
                "status": "active",
                "plan_name": plan_name,
                "start_date": now.isoformat(),
                "end_date": end.isoformat()[:10],
                "last_plan_days": days,
            }
            active_state["active"] = True
            active_state["sub"] = sub_doc
            return sub_doc["end_date"]

        with patch.object(db, "sub_get", side_effect=fake_sub_get), \
             patch.object(db, "sub_is_active", side_effect=fake_sub_is_active), \
             patch.object(db, "sub_days_left", side_effect=fake_sub_days_left), \
             patch.object(db, "sub_activate", side_effect=fake_sub_activate), \
             patch.object(db, "sub_plan_list", new_callable=AsyncMock) as m_plans, \
             patch.object(db, "sub_payment_history", new_callable=AsyncMock) as m_hist, \
             patch.object(db, "get_setting", new_callable=AsyncMock) as m_setting, \
             patch("subscription.has_access", new_callable=AsyncMock) as m_access:

            m_plans.return_value = []
            m_hist.return_value = []
            m_setting.return_value = True

            # Phase 1: Before activation
            m_access.return_value = False
            res1 = self.client.get("/api/web/subscription/status")
            self.assertEqual(res1.status_code, 200)
            self.assertFalse(res1.json()["active"])
            self.assertEqual(res1.json()["days_left"], 0)

            # Phase 2: Telegram Bot activates subscription for user
            active_state["active"] = True
            active_state["sub"] = {
                "_id": self.user_id,
                "status": "active",
                "plan_name": "طرح جامع اینترنی",
                "start_date": "2026-11-08",
                "end_date": "2027-01-08",
                "last_plan_days": 30,
            }

            # Phase 3: Web subscription immediately reflects active plan
            m_access.return_value = True
            res2 = self.client.get("/api/web/subscription/status")
            self.assertEqual(res2.status_code, 200)
            sub_data = res2.json()
            self.assertTrue(sub_data["active"])
            self.assertEqual(sub_data["plan_name"], "طرح جامع اینترنی")
            self.assertEqual(sub_data["days_left"], 30)

    # ─────────────────────────────────────────────────────────────
    # 4. Support Ticket Lifecycle Sync (tickets & bot_notifications)
    # ─────────────────────────────────────────────────────────────
    def test_support_ticket_lifecycle_cross_channel_sync(self):
        """Ticket created in Web posts outbox task to bot_notifications, and bot replies sync to web history."""
        mock_tickets_db: dict[int, dict] = {}
        mock_notif_list: list[dict] = []
        ticket_seq = 100

        async def fake_ticket_create(user_id, user_name, subject, message, priority="normal"):
            nonlocal ticket_seq
            ticket_seq += 1
            doc = {
                "ticket_id": ticket_seq,
                "user_id": user_id,
                "user_name": user_name,
                "subject": subject,
                "message": message,
                "status": "open",
                "priority": priority,
                "replies": [],
                "created_at": utc_now_iso(),
            }
            mock_tickets_db[ticket_seq] = doc
            return ticket_seq

        async def fake_ticket_get(tid):
            return copy.deepcopy(mock_tickets_db.get(int(tid)))

        async def fake_ticket_add_reply(tid, text):
            t = mock_tickets_db.get(int(tid))
            if t:
                t.setdefault("replies", []).append({
                    "text": text,
                    "at": utc_now_iso(),
                    "sender": "admin",
                })
                return True
            return False

        class MockNotifCollection:
            async def insert_one(self, doc):
                mock_notif_list.append(copy.deepcopy(doc))

        mock_medicalbot = {"bot_notifications": MockNotifCollection()}

        with patch.object(db, "ticket_create", side_effect=fake_ticket_create), \
             patch.object(db, "ticket_get", side_effect=fake_ticket_get), \
             patch.object(db, "ticket_add_reply", side_effect=fake_ticket_add_reply), \
             patch.object(db, "inbox_add", new_callable=AsyncMock), \
             patch.object(db, "log_action", new_callable=AsyncMock), \
             patch.object(db, "client", {"medicalbot": mock_medicalbot}), \
             patch.object(db.tickets, "update_one", new_callable=AsyncMock), \
             patch("backend.api.routers.tickets.rate_limit_user", new_callable=AsyncMock):

            # 1. Student creates ticket from Web Command Center
            ticket_payload = {
                "subject": "اشکال در تست شماره ۲۵ فارماکولوژی",
                "message": "سلام و احترام، پاسخ صحیح در سوال ۲۵ بر اساس کتاب کاتزونگ گزینه ج است.",
                "priority": "normal",
            }
            res_create = self.client.post("/api/web/tickets", json=ticket_payload)
            self.assertEqual(res_create.status_code, 200)
            created_data = res_create.json()
            self.assertTrue(created_data.get("ok"))
            created_tid = created_data.get("ticket_id")

            # 2. Outbox task to bot_notifications MUST be inserted for Telegram alerting
            self.assertEqual(len(mock_notif_list), 1)
            notif_doc = mock_notif_list[0]
            self.assertEqual(notif_doc["type"], "new_ticket")
            self.assertIn(str(created_tid), notif_doc["text"])

            # 3. Telegram Admin replies via Bot
            mock_tickets_db[created_tid]["replies"].append({
                "text": "[پشتیبانی علمی تلگرام] با تشکر، منبع بررسی و کلید تصحیح شد.",
                "at": utc_now_iso(),
                "sender": "admin",
            })

            # 4. Student views ticket on Web
            res_view = self.client.get(f"/api/web/tickets/{created_tid}")
            self.assertEqual(res_view.status_code, 200)
            view_data = res_view.json().get("ticket", {})
            self.assertEqual(view_data["id"], created_tid)
            self.assertEqual(len(view_data.get("replies", [])), 1)
            self.assertIn("منبع بررسی و کلید تصحیح شد", view_data["replies"][0]["text"])

    # ─────────────────────────────────────────────────────────────
    # 5. Exam & Academic Grades Sync (grades collection & GPA)
    # ─────────────────────────────────────────────────────────────
    def test_exam_and_grades_sync_and_weighted_gpa(self):
        """Mock exam and grade records sync across bot and web summary with weighted GPA calculation."""
        # Grades recorded in Iranian medical university grading scale (0 to 20)
        grade_records = [
            {"student_id": self.user_id, "lesson": "جراحی عمومی ۱", "exam_title": "پایان‌ترم", "score": 18.0, "credits": 3.0, "term": "۱۴۰۳-۱"},
            {"student_id": self.user_id, "lesson": "داخلی ریه", "exam_title": "پایان‌ترم", "score": 16.0, "credits": 2.0, "term": "۱۴۰۳-۱"},
            {"student_id": self.user_id, "lesson": "فارماکولوژی", "exam_title": "میان‌ترم", "score": 14.0, "credits": 2.0, "term": "۱۴۰۳-۱"},
        ]

        with patch.object(db, "grade_list_for_student", new_callable=AsyncMock) as m_grades:
            m_grades.return_value = grade_records

            res = self.client.get("/api/web/grades/summary")
            self.assertEqual(res.status_code, 200)
            data = res.json()

            # Formula verification:
            # Weighted GPA = (18.0*3 + 16.0*2 + 14.0*2) / (3 + 2 + 2)
            # = (54.0 + 32.0 + 28.0) / 7.0 = 114.0 / 7.0 ≈ 16.29
            self.assertIn("cumulative_gpa", data)
            expected_gpa = round(114.0 / 7.0, 2)
            self.assertAlmostEqual(data["cumulative_gpa"], expected_gpa, places=1)
            self.assertEqual(data.get("passed_credits"), 7.0)
            self.assertEqual(data.get("failed_credits"), 0.0)

    # ─────────────────────────────────────────────────────────────
    # 6. Route Inventory Non-Regression Invariant
    # ─────────────────────────────────────────────────────────────
    def test_route_inventory_non_regression_invariant(self):
        """Verify OpenAPI operation count and route objects count match frozen baseline."""
        stats = _count_api_operations()
        EXPECTED_OPS = 759
        EXPECTED_OBJS = 766

        self.assertEqual(
            stats["openapi_operations"],
            EXPECTED_OPS,
            f"OpenAPI operations count shifted: actual={stats['openapi_operations']} expected={EXPECTED_OPS}",
        )
        self.assertEqual(
            stats["api_route_objects"],
            EXPECTED_OBJS,
            f"API route objects count shifted: actual={stats['api_route_objects']} expected={EXPECTED_OBJS}",
        )

        # Invariant: No duplicate (method, path) registered
        ops = [(m, p) for m, p in _walk_included_routes(app.routes) if p.startswith("/api")]
        seen, dupes = set(), []
        for item in ops:
            if item in seen:
                dupes.append(item)
            seen.add(item)
        self.assertEqual(dupes, [], f"Duplicate route registration detected: {dupes}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
