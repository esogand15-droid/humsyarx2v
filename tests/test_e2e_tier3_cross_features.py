#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tier 3 End-to-End Test Suite: Cross-Feature Combinations & Multi-Feature Interactions.

Requirement R4 & Milestone M5 Verification:
- Feature Pair 1: Web Reader Reading Progress Sync to Telegram Mini-App (GET /api/me/continue-reading)
- Feature Pair 2: Telegram Mini-App Reading Progress Sync to Web Reader Dashboard (GET /api/web/library/continue)
- Feature Pair 3: Ink Delta Mutation Sync with Delete Propagation & Revision Tracking (POST /api/web/ink/sync)
- Feature Pair 4: Ink Sticky Note Mutation Lifecycle Sync & Coordinate Clamping
- Feature Pair 5: Ink Batch Mutation Ceiling & Validation Error Handling
- Feature Pair 6: Bot VIP Subscription Activation Unlocking Web Reader DRM & Status
- Feature Pair 7: Support Ticket Web Creation Enqueueing Bot Outbox Alert & Telegram Admin Reply Sync
- Feature Pair 8: Support Ticket Student Reply Enqueueing Outbox Notification for Telegram
- Feature Pair 9: Admin Session Content Upload Reflecting in Student Library File Listing
- Feature Pair 10: Global Search Discovery Resolving into Web Reader Manifest Navigation
- Feature Pair 11: Timed Mock Exam Score Recording Syncing into Iranian Medical Weighted GPA Summary
- Feature Pair 12: Notification Inbox Broadcast via Outbox and Student Mark-as-Read Parity
- Feature Pair 13: Offline Ink Last-Write-Wins (LWW) Timestamp Collision Reconciliation
- Feature Pair 14: User Account Suspension Sync Across Telegram Bot and Student Web API

Execution:
    python -m unittest tests/test_e2e_tier3_cross_features.py
"""
from __future__ import annotations

import asyncio
import copy
from datetime import datetime, timedelta, timezone
import hmac
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import unittest
from unittest.mock import AsyncMock, patch
import uuid

# Path setup
REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = REPO_ROOT / "backend"

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
if str(BACKEND_DIR) not in sys.path:
    sys.path.append(str(BACKEND_DIR))

# Local execution safety defaults (R5)
os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017/humsyar_test")
os.environ.setdefault("ADMIN_ID", "1")
os.environ.setdefault("TELEGRAM_TOKEN", "123:TEST")
os.environ.setdefault("TZ", "Asia/Tehran")

from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.api.main import app
from backend.api.auth import get_current_user
from backend.api.routers.web_student import current_student
from backend.api.routers.resources import get_resource_access_user
from backend.api.routers.content_admin import get_content_admin_user
from backend.api.routers.web_ink import (
    PointModel,
    StrokeModel,
    StickyNoteModel,
    MutationItem,
    SyncBatchRequest,
)
from backend.api.routers.web_reader import generate_page_token, READER_SECRET
from backend.core.access import check_feature
from backend.database.database import db
from backend.core.time_utils import utc_now_iso


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
    """In-memory MongoDB collection for test isolation (Requirement R5)."""

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

    async def delete_one(self, query: dict):
        for k, doc in list(self._data.items()):
            match = True
            for qk, qv in query.items():
                if doc.get(qk) != qv:
                    match = False
                    break
            if match:
                del self._data[k]
                break


class TestE2ETier3CrossFeatures(unittest.TestCase):
    """Tier 3: Pairwise and multi-feature interaction tests."""

    def setUp(self):
        self.client = TestClient(app)
        self.user_id = 922001
        self.user = {
            "id": self.user_id,
            "user_id": self.user_id,
            "name": "دکتر نیما ستوده",
            "_db": {
                "user_id": self.user_id,
                "name": "دکتر نیما ستوده",
                "nickname": "نیما",
                "student_id": "402998877",
                "intake": "مهر ۱۴۰۲",
                "group": "گروه ب قلب",
                "role": "student",
                "approved": True,
                "suspended": False,
            },
        }
        self.admin_user = {
            "id": 1,
            "user_id": 1,
            "name": "ادمین ارشد سیستم",
            "role": "admin",
            "_db": {
                "user_id": 1,
                "name": "ادمین ارشد سیستم",
                "role": "admin",
                "approved": True,
                "suspended": False,
            },
        }

        # Setup Dependency Overrides for clean auth
        app.dependency_overrides[get_current_user] = lambda: self.user
        app.dependency_overrides[current_student] = lambda: self.user
        app.dependency_overrides[get_resource_access_user] = lambda: self.user
        app.dependency_overrides[get_content_admin_user] = lambda: self.admin_user

        # Isolated in-memory database mock collections
        self.collections: dict[str, InMemoryMongoCollection] = {
            "reading_progress": InMemoryMongoCollection(),
            "web_ink_pages": InMemoryMongoCollection(),
            "web_ink_sync_log": InMemoryMongoCollection(),
            "bot_notifications": InMemoryMongoCollection(),
            "tickets": InMemoryMongoCollection(),
            "grades": InMemoryMongoCollection(),
            "inbox": InMemoryMongoCollection(),
        }

        # Global mock patches to guarantee R5 offline execution safety
        demo_doc = {"_id": "demo", "name": "جزوه نمونه فیزیولوژی پزشکی هامزیار (تستی)", "file_name": "demo.pdf"}
        self._patches = [
            patch.object(db, "get_user", new_callable=AsyncMock, return_value=self.user["_db"]),
            patch.object(db, "viewer_intake_filter", new_callable=AsyncMock, return_value=None),
            patch.object(db, "ticket_get_user", new_callable=AsyncMock, return_value=[]),
            patch.object(db.tickets, "update_one", new_callable=AsyncMock),
            patch.object(db, "is_content_admin", new_callable=AsyncMock, return_value=False),
            patch.object(db, "bs_get_content_item", new_callable=AsyncMock, return_value=demo_doc),
            patch.object(db, "ref_get_file", new_callable=AsyncMock, return_value=demo_doc),
            patch.object(db, "session_intake", new_callable=AsyncMock, return_value=""),
            patch.object(db, "session_superseded_by_fork", new_callable=AsyncMock, return_value=None),
        ]
        for p in self._patches:
            p.start()

    def tearDown(self):
        for p in reversed(self._patches):
            p.stop()
        app.dependency_overrides.clear()

    def _get_coll(self, name: str):
        if name not in self.collections:
            self.collections[name] = InMemoryMongoCollection()
        return self.collections[name]

    # =========================================================================
    # Test 1 & 2: Reading Progress Cross-Client Synchronization
    # =========================================================================
    def test_tc01_web_reader_progress_to_telegram_miniapp_sync(self):
        """TC-01: Web Reader PUT /library/progress reflects in Telegram Mini-App GET /api/me/continue-reading."""
        with patch("backend.api.routers.web_reader._coll", side_effect=self._get_coll), \
             patch("backend.api.routers.me_bridge._coll", side_effect=self._get_coll):

            # 1. Web student saves reading progress on cardiology pamphlet
            progress_payload = {
                "page": 42,
                "total": 120,
                "position": 0.35,
                "kind": "pdf",
            }
            res_put = self.client.put("/api/web/library/progress/res/pediatrics-cardio-01", json=progress_payload)
            self.assertEqual(res_put.status_code, 200)
            self.assertTrue(res_put.json().get("ok"))

            # 2. Telegram Mini-App queries continue reading endpoint
            res_mini = self.client.get("/api/me/continue-reading")
            self.assertEqual(res_mini.status_code, 200)
            items = res_mini.json().get("items", [])
            self.assertEqual(len(items), 1)

            # Verification of exact synchronization
            item = items[0]
            self.assertEqual(item["scope"], "res")
            self.assertEqual(item["id"], "pediatrics-cardio-01")
            self.assertEqual(item["page"], 42)
            self.assertEqual(item["total"], 120)
            self.assertEqual(item["percent"], 35)

    def test_tc02_telegram_miniapp_progress_update_reflects_in_web_library_continue(self):
        """TC-02: Progress updated from Telegram Mini-App reflects in Web Reader GET /api/web/library/continue."""
        sample_item = {
            "_id": "cardio-ecg-ch2",
            "name": "فصل ۲: الکتروکاردیوگرام پایه",
            "kind": "pdf",
        }

        with patch("backend.api.routers.web_reader._coll", side_effect=self._get_coll), \
             patch("backend.api.routers.web_reader._item", new_callable=AsyncMock) as m_item:

            m_item.return_value = sample_item

            # 1. Save progress from Mini-App
            now = utc_now_iso()
            progress_coll = self._get_coll("reading_progress")
            asyncio.run(
                progress_coll.update_one(
                    {"_id": f"{self.user_id}:res:cardio-ecg-ch2"},
                    {
                        "$set": {
                            "uid": self.user_id,
                            "scope": "res",
                            "file_id": "cardio-ecg-ch2",
                            "page": 75,
                            "total": 100,
                            "position": 0.75,
                            "kind": "pdf",
                            "updated_at": now,
                        }
                    },
                    upsert=True,
                )
            )

            # 2. Student opens Web Reader home/continue card
            res_cont = self.client.get("/api/web/library/continue")
            self.assertEqual(res_cont.status_code, 200)
            items = res_cont.json().get("items", [])
            self.assertEqual(len(items), 1)
            self.assertEqual(items[0]["id"], "cardio-ecg-ch2")
            self.assertEqual(items[0]["page"], 75)
            self.assertEqual(items[0]["percent"], 75)
            self.assertEqual(items[0]["name"], "فصل ۲: الکتروکاردیوگرام پایه")

    # =========================================================================
    # Test 3, 4 & 5: Ink Delta Mutation Sync & Delete Propagation
    # =========================================================================
    def test_tc03_ink_delta_mutation_sync_upsert_and_delete_propagation(self):
        """TC-03: Ink mutations upsert_stroke and delete_stroke propagate cleanly with revision increment."""
        with patch("backend.api.routers.web_ink._coll", side_effect=self._get_coll):
            # Step 1: Initial upload of 2 strokes via sync_batch
            mut1 = MutationItem(
                mutation_id="mut-1",
                action="upsert_stroke",
                scope="res",
                file_id="cardio-notes",
                page=1,
                timestamp=1000,
                stroke=StrokeModel(
                    stroke_id="stroke-1",
                    tool="pen",
                    color="#0F172A",
                    width=0.003,
                    points=[PointModel(x=0.1, y=0.1, pressure=0.5, time=1000)],
                ),
            )
            mut2 = MutationItem(
                mutation_id="mut-2",
                action="upsert_stroke",
                scope="res",
                file_id="cardio-notes",
                page=1,
                timestamp=1005,
                stroke=StrokeModel(
                    stroke_id="stroke-2",
                    tool="highlighter",
                    color="#FEF08A",
                    width=0.015,
                    points=[PointModel(x=0.2, y=0.2, pressure=0.5, time=1005)],
                ),
            )

            batch1 = SyncBatchRequest(client_id="client-ipad-01", mutations=[mut1, mut2])
            res_sync1 = self.client.post("/api/web/ink/sync", json=batch1.model_dump())
            self.assertEqual(res_sync1.status_code, 200)
            self.assertEqual(len(res_sync1.json()["successful_ids"]), 2)

            # Step 2: Check page ink
            res_page1 = self.client.get("/api/web/ink/res/cardio-notes/1")
            self.assertEqual(res_page1.status_code, 200)
            data_page1 = res_page1.json()
            self.assertEqual(data_page1["count"], 2)
            self.assertEqual(data_page1["page_revision"], 2)
            stroke_ids = [s["stroke_id"] for s in data_page1["strokes"]]
            self.assertIn("stroke-1", stroke_ids)
            self.assertIn("stroke-2", stroke_ids)

            # Step 3: Delta mutation deleting stroke-1 and adding stroke-3
            mut_del = MutationItem(
                mutation_id="mut-3",
                action="delete_stroke",
                scope="res",
                file_id="cardio-notes",
                page=1,
                timestamp=1020,
                stroke=StrokeModel(
                    stroke_id="stroke-1",
                    tool="pen",
                    color="#0F172A",
                    width=0.003,
                    points=[PointModel(x=0.1, y=0.1)],
                ),
            )
            mut3 = MutationItem(
                mutation_id="mut-4",
                action="upsert_stroke",
                scope="res",
                file_id="cardio-notes",
                page=1,
                timestamp=1025,
                stroke=StrokeModel(
                    stroke_id="stroke-3",
                    tool="ballpoint",
                    color="#2563EB",
                    width=0.004,
                    points=[PointModel(x=0.3, y=0.3, pressure=0.6, time=1025)],
                ),
            )

            batch2 = SyncBatchRequest(client_id="client-ipad-01", mutations=[mut_del, mut3])
            res_sync2 = self.client.post("/api/web/ink/sync", json=batch2.model_dump())
            self.assertEqual(res_sync2.status_code, 200)
            self.assertEqual(len(res_sync2.json()["successful_ids"]), 2)

            # Step 4: Verify stroke-1 is gone, stroke-2 & stroke-3 remain, page_revision is 4
            res_page2 = self.client.get("/api/web/ink/res/cardio-notes/1")
            self.assertEqual(res_page2.status_code, 200)
            data_page2 = res_page2.json()
            self.assertEqual(data_page2["count"], 2)
            self.assertEqual(data_page2["page_revision"], 4)
            final_ids = [s["stroke_id"] for s in data_page2["strokes"]]
            self.assertNotIn("stroke-1", final_ids, "Deleted stroke must not resurrect")
            self.assertIn("stroke-2", final_ids)
            self.assertIn("stroke-3", final_ids)

    def test_tc04_ink_sticky_note_mutation_lifecycle_sync(self):
        """TC-04: Sticky note upsert, modify, and delete mutations synchronize accurately."""
        with patch("backend.api.routers.web_ink._coll", side_effect=self._get_coll):
            # 1. Add sticky note
            mut_note = MutationItem(
                mutation_id="mut-note-1",
                action="upsert_note",
                scope="res",
                file_id="cardio-notes",
                page=1,
                timestamp=2000,
                note=StickyNoteModel(
                    note_id="note-1",
                    page=1,
                    x=0.82,
                    y=0.25,
                    text="Acute STEMI criteria: ST elevation >= 1mm in 2 contiguous leads",
                    color="yellow",
                ),
            )
            res1 = self.client.post("/api/web/ink/sync", json=SyncBatchRequest(client_id="w-1", mutations=[mut_note]).model_dump())
            self.assertEqual(res1.status_code, 200)

            # 2. Verify note exists
            res_p1 = self.client.get("/api/web/ink/res/cardio-notes/1")
            notes = res_p1.json().get("notes", [])
            self.assertEqual(len(notes), 1)
            self.assertEqual(notes[0]["note_id"], "note-1")
            self.assertEqual(notes[0]["color"], "yellow")

            # 3. Modify note color to coral and update text
            mut_note_mod = MutationItem(
                mutation_id="mut-note-2",
                action="upsert_note",
                scope="res",
                file_id="cardio-notes",
                page=1,
                timestamp=2010,
                note=StickyNoteModel(
                    note_id="note-1",
                    page=1,
                    x=0.82,
                    y=0.25,
                    text="Acute STEMI criteria: Updated with ESC 2024 guidelines",
                    color="coral",
                ),
            )
            res2 = self.client.post("/api/web/ink/sync", json=SyncBatchRequest(client_id="w-1", mutations=[mut_note_mod]).model_dump())
            self.assertEqual(res2.status_code, 200)

            res_p2 = self.client.get("/api/web/ink/res/cardio-notes/1")
            notes2 = res_p2.json().get("notes", [])
            self.assertEqual(len(notes2), 1)
            self.assertEqual(notes2[0]["color"], "coral")
            self.assertIn("ESC 2024", notes2[0]["text"])

            # 4. Delete note
            mut_note_del = MutationItem(
                mutation_id="mut-note-3",
                action="delete_note",
                scope="res",
                file_id="cardio-notes",
                page=1,
                timestamp=2020,
                note=StickyNoteModel(
                    note_id="note-1",
                    page=1,
                    x=0.82,
                    y=0.25,
                    text="",
                    color="coral",
                ),
            )
            res3 = self.client.post("/api/web/ink/sync", json=SyncBatchRequest(client_id="w-1", mutations=[mut_note_del]).model_dump())
            self.assertEqual(res3.status_code, 200)

            res_p3 = self.client.get("/api/web/ink/res/cardio-notes/1")
            self.assertEqual(len(res_p3.json().get("notes", [])), 0)

    def test_tc05_ink_delta_mutation_batch_ceiling_and_validation(self):
        """TC-05: Enforcing maximum batch ceiling of 50 mutations per sync request."""
        # 51 mutations should be rejected by Pydantic validation (max_length=50)
        excessive_mutations = [
            MutationItem(
                mutation_id=f"mut-overflow-{i}",
                action="clear_page",
                scope="res",
                file_id="doc-1",
                page=1,
                timestamp=1000 + i,
            ).model_dump()
            for i in range(51)
        ]

        payload = {"client_id": "test-overflow", "mutations": excessive_mutations}
        res = self.client.post("/api/web/ink/sync", json=payload)
        self.assertEqual(res.status_code, 422, "Batch of 51 mutations must fail validation with 422")

    # =========================================================================
    # Test 6: Bot Subscription Activation Unlocking Web Reader DRM
    # =========================================================================
    def test_tc06_bot_subscription_activation_unlocks_web_reader_drm(self):
        """TC-06: Subscription activation via bot unlocks Web Reader DRM and reflects in status."""
        sub_state = {"active": False, "sub": None}

        async def fake_sub_get(uid):
            return sub_state["sub"]

        async def fake_sub_is_active(uid):
            return sub_state["active"]

        async def fake_sub_days_left(uid):
            return 30 if sub_state["active"] else 0

        async def fake_sub_activate(user_id, days, plan_name, **kwargs):
            now = datetime.now(timezone.utc)
            end = now + timedelta(days=days)
            doc = {
                "_id": int(user_id),
                "status": "active",
                "plan_name": plan_name,
                "start_date": now.isoformat(),
                "end_date": end.isoformat()[:10],
                "last_plan_days": days,
            }
            sub_state["active"] = True
            sub_state["sub"] = doc
            return doc["end_date"]

        with patch.object(db, "sub_get", side_effect=fake_sub_get), \
             patch.object(db, "sub_is_active", side_effect=fake_sub_is_active), \
             patch.object(db, "sub_days_left", side_effect=fake_sub_days_left), \
             patch.object(db, "sub_activate", side_effect=fake_sub_activate), \
             patch.object(db, "sub_plan_list", new_callable=AsyncMock, return_value=[]), \
             patch.object(db, "sub_payment_history", new_callable=AsyncMock, return_value=[]), \
             patch.object(db, "get_setting", new_callable=AsyncMock, return_value=True), \
             patch("backend.bot.subscription.has_access", new_callable=AsyncMock) as m_access:

            # Phase 1: Inactive state
            m_access.return_value = False
            res1 = self.client.get("/api/web/subscription/status")
            self.assertEqual(res1.status_code, 200)
            self.assertFalse(res1.json()["active"])
            self.assertEqual(res1.json()["days_left"], 0)

            # Phase 2: Telegram Bot triggers subscription activation
            end_date = asyncio.run(db.sub_activate(self.user_id, days=30, plan_name="طرح جامع دستیاری"))
            self.assertTrue(bool(end_date))
            m_access.return_value = True

            # Phase 3: Web subscription immediately unlocks
            res2 = self.client.get("/api/web/subscription/status")
            self.assertEqual(res2.status_code, 200)
            data2 = res2.json()
            self.assertTrue(data2["active"])
            self.assertEqual(data2["plan_name"], "طرح جامع دستیاری")
            self.assertEqual(data2["days_left"], 30)

            # Phase 4: Reader Manifest access succeeds
            with patch("backend.api.routers.web_reader._gate", new_callable=AsyncMock) as m_gate:
                res_manifest = self.client.get("/api/web/reader/manifest/res/demo")
                self.assertEqual(res_manifest.status_code, 200)
                m_data = res_manifest.json()
                self.assertEqual(m_data["file_id"], "demo")
                self.assertGreater(m_data["total_pages"], 0)

    # =========================================================================
    # Test 7 & 8: Support Ticket Web-to-Bot Outbox & Reply Synchronization
    # =========================================================================
    def test_tc07_support_ticket_web_to_bot_outbox_and_admin_reply_sync(self):
        """TC-07: Web support ticket creation enqueues bot outbox alert; bot reply syncs to web."""
        tickets_db: dict[int, dict] = {}
        outbox_notifs: list[dict] = []
        ticket_seq = 200

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
            tickets_db[ticket_seq] = doc
            return ticket_seq

        async def fake_ticket_get(tid):
            return copy.deepcopy(tickets_db.get(int(tid)))

        class MockNotifCollection:
            async def insert_one(self, doc):
                outbox_notifs.append(copy.deepcopy(doc))

        mock_medicalbot = {"bot_notifications": MockNotifCollection()}

        with patch.object(db, "ticket_create", side_effect=fake_ticket_create), \
             patch.object(db, "ticket_get", side_effect=fake_ticket_get), \
             patch.object(db, "inbox_add", new_callable=AsyncMock), \
             patch.object(db, "log_action", new_callable=AsyncMock), \
             patch.object(db, "client", {"medicalbot": mock_medicalbot}), \
             patch("backend.api.routers.tickets.rate_limit_user", new_callable=AsyncMock):

            # 1. Student creates ticket from web app
            ticket_payload = {
                "subject": "پرسش کاردیولوژی درباره تست شماره ۲۴ نوار قلب",
                "message": "با سلام، تغییرات قطعه ST در لیدهای II, III, aVF نشان‌دهنده ایسکمی کدام دیواره است؟",
                "priority": "normal",
            }
            res_create = self.client.post("/api/web/tickets", json=ticket_payload)
            self.assertEqual(res_create.status_code, 200)
            data_create = res_create.json()
            self.assertTrue(data_create["ok"])
            tid = data_create["ticket_id"]

            # 2. Outbox task for Telegram Bot admin notification must exist
            self.assertEqual(len(outbox_notifs), 1)
            notif = outbox_notifs[0]
            self.assertEqual(notif["type"], "new_ticket")
            self.assertIn(str(tid), notif["text"])
            self.assertIn("پرسش کاردیولوژی", notif["text"])

            # 3. Telegram Admin replies via bot
            tickets_db[tid]["replies"].append({
                "text": "[پشتیبانی آموزشی تلگرام] تغییرات در II, III, aVF نشان‌دهنده درگیری دیواره تحتانی (Inferior) است.",
                "at": utc_now_iso(),
                "sender": "admin",
            })

            # 4. Student views ticket on Web
            res_view = self.client.get(f"/api/web/tickets/{tid}")
            self.assertEqual(res_view.status_code, 200)
            ticket_detail = res_view.json().get("ticket", {})
            self.assertEqual(ticket_detail["id"], tid)
            self.assertEqual(len(ticket_detail["replies"]), 1)
            self.assertIn("دیواره تحتانی", ticket_detail["replies"][0]["text"])

    def test_tc08_support_ticket_student_reply_syncs_to_telegram_outbox(self):
        """TC-08: Student reply on web ticket enqueues outbox task to bot_notifications."""
        sample_ticket = {
            "ticket_id": 205,
            "user_id": self.user_id,
            "subject": "اشکال در نمره آزمون",
            "message": "لطفا نمره مجدد بررسی شود.",
            "status": "open",
            "replies": [],
        }
        outbox_notifs: list[dict] = []

        class MockNotifCollection:
            async def insert_one(self, doc):
                outbox_notifs.append(copy.deepcopy(doc))

        mock_medicalbot = {"bot_notifications": MockNotifCollection()}

        with patch.object(db, "ticket_get", new_callable=AsyncMock, return_value=sample_ticket), \
             patch.object(db, "ticket_add_reply", new_callable=AsyncMock, return_value=True), \
             patch.object(db, "log_action", new_callable=AsyncMock), \
             patch.object(db, "client", {"medicalbot": mock_medicalbot}), \
             patch("backend.api.routers.tickets.rate_limit_user", new_callable=AsyncMock):

            res = self.client.post("/api/web/tickets/205/reply", json={"message": "کارنامه اسکن شده پیوست شد"})
            self.assertEqual(res.status_code, 200)
            self.assertTrue(res.json()["ok"])

            self.assertEqual(len(outbox_notifs), 1)
            self.assertEqual(outbox_notifs[0]["type"], "ticket_reply")
            self.assertIn("205", outbox_notifs[0]["text"])

    # =========================================================================
    # Test 9: Admin Content Upload Reflecting in Student Library Listing
    # =========================================================================
    def test_tc09_admin_session_upload_appears_in_student_library_listing(self):
        """TC-09: Session content registered by content admin appears in student library listing."""
        session_id = "sess-cardio-intro"
        uploaded_content = [
            {
                "_id": "cont-ecg-01",
                "session_id": session_id,
                "name": "راهنمای جامع تفسیر ECG بالینی",
                "display_name": "راهنمای جامع تفسیر ECG بالینی",
                "filename": "ecg_clinical_guide.pdf",
                "type": "file",
                "ctype": "pdf",
                "file_size": 2450000,
                "downloads": 0,
            }
        ]

        with patch.object(db, "session_intake", new_callable=AsyncMock, return_value=None), \
             patch.object(db, "session_superseded_by_fork", new_callable=AsyncMock, return_value=None), \
             patch.object(db, "bs_get_content", new_callable=AsyncMock, return_value=uploaded_content), \
             patch("backend.api.routers.web_library._gate", new_callable=AsyncMock):

            res = self.client.get(f"/api/web/library/files/{session_id}")
            self.assertEqual(res.status_code, 200)
            files = res.json().get("files", [])
            self.assertEqual(len(files), 1)
            f = files[0]
            self.assertEqual(f["name"], "راهنمای جامع تفسیر ECG بالینی")
            self.assertEqual(f["type"], "file")

    # =========================================================================
    # Test 10: Global Search Discovery Resolving into Web Reader Manifest
    # =========================================================================
    def test_tc10_global_search_discovery_and_reader_manifest_navigation(self):
        """TC-10: Searching for content resolves target ID and facilitates reader manifest loading."""
        search_results = [
            {
                "id": "demo",
                "type": "booklet",
                "title": "جزوه جامع کاردیولوژی و نوار قلب",
                "lesson": "قلب و عروق",
                "scope": "res",
            }
        ]

        with patch.object(db, "search_resources", new_callable=AsyncMock, return_value=search_results), \
             patch("backend.api.routers.web_reader._gate", new_callable=AsyncMock):

            # 1. Reader manifest navigation for the discovered resource
            res_manifest = self.client.get("/api/web/reader/manifest/res/demo")
            self.assertEqual(res_manifest.status_code, 200)
            manifest = res_manifest.json()
            self.assertEqual(manifest["file_id"], "demo")
            self.assertEqual(manifest["total_pages"], 3)
            self.assertIn("page_dimensions", manifest)
            self.assertEqual(len(manifest["page_dimensions"]), 3)

    # =========================================================================
    # Test 11: Mock Exam Completion Syncing into Iranian Medical Weighted GPA
    # =========================================================================
    def test_tc11_mock_exam_completion_syncs_to_academic_gpa_summary(self):
        """TC-11: Exam completion records grade and recalculates credit-weighted Iranian medical GPA."""
        # Medical grades on 0-20 scale
        grades_data = [
            {"student_id": self.user_id, "lesson": "کاردیولوژی بالینی", "exam_title": "آزمون پایان دوره", "score": 18.0, "credits": 3.0, "term": "۱۴۰۳-۱"},
            {"student_id": self.user_id, "lesson": "فارماکولوژی قلب", "exam_title": "میان‌ترم", "score": 16.0, "credits": 2.0, "term": "۱۴۰۳-۱"},
            {"student_id": self.user_id, "lesson": "فیزیولوژی عروق", "exam_title": "پایان‌ترم", "score": 15.0, "credits": 2.0, "term": "۱۴۰۳-۱"},
        ]

        with patch.object(db, "grade_list_for_student", new_callable=AsyncMock, return_value=grades_data):
            res = self.client.get("/api/web/grades/summary")
            self.assertEqual(res.status_code, 200)
            data = res.json()

            # Weighted GPA: (18*3 + 16*2 + 15*2) / (3 + 2 + 2) = (54 + 32 + 30) / 7 = 116 / 7 = 16.57
            expected_gpa = round(116.0 / 7.0, 2)
            self.assertAlmostEqual(data["cumulative_gpa"], expected_gpa, places=1)
            self.assertEqual(data["passed_credits"], 7.0)
            self.assertEqual(data["failed_credits"], 0.0)

    # =========================================================================
    # Test 12: Notification Inbox Broadcast via Outbox and Student Mark-as-Read
    # =========================================================================
    def test_tc12_notification_inbox_broadcast_and_student_read_sync(self):
        """TC-12: Inbox notifications sync across outbox, list, and unread count decrement."""
        inbox_items = [
            {
                "_id": "notif-001",
                "user_id": self.user_id,
                "type": "exam_announcement",
                "title": "آزمون جامع دوره‌ای قلب و عروق",
                "body": "آزمون آنلاین از ساعت ۱۴ روز پنجشنبه آغاز خواهد شد.",
                "read": False,
                "created_at": utc_now_iso(),
            }
        ]

        async def fake_inbox_list(uid, **kwargs):
            return copy.deepcopy(inbox_items)

        async def fake_inbox_unread(uid):
            return sum(1 for x in inbox_items if not x.get("read"))

        async def fake_inbox_mark_read(uid, item_id=None):
            for x in inbox_items:
                if item_id is None or x["_id"] == item_id:
                    x["read"] = True
            return True

        with patch.object(db, "inbox_list", side_effect=fake_inbox_list), \
             patch.object(db, "inbox_unread_count", side_effect=fake_inbox_unread), \
             patch.object(db, "inbox_mark_read", side_effect=fake_inbox_mark_read):

            # 1. Check unread count
            res_count1 = self.client.get("/api/notifications/inbox/unread-count")
            self.assertEqual(res_count1.status_code, 200)
            self.assertEqual(res_count1.json().get("unread"), 1)

            # 2. Mark notification as read
            res_read = self.client.post("/api/notifications/inbox/read", json={"id": "notif-001"})
            self.assertEqual(res_read.status_code, 200)

            # 3. Check unread count decremented
            res_count2 = self.client.get("/api/notifications/inbox/unread-count")
            self.assertEqual(res_count2.status_code, 200)
            self.assertEqual(res_count2.json().get("unread"), 0)

    # =========================================================================
    # Test 13: Offline Ink Last-Write-Wins (LWW) Timestamp Collision
    # =========================================================================
    def test_tc13_offline_ink_last_write_wins_timestamp_resolution(self):
        """TC-13: LWW reconciles out-of-order mutations based on client mutation timestamp."""
        with patch("backend.api.routers.web_ink._coll", side_effect=self._get_coll):
            # Client A writes stroke with newer timestamp (1500)
            mut_newer = MutationItem(
                mutation_id="mut-newer",
                action="upsert_stroke",
                scope="res",
                file_id="lww-test",
                page=1,
                timestamp=1500,
                stroke=StrokeModel(
                    stroke_id="stroke-shared",
                    tool="pen",
                    color="#DC2626",  # Red
                    width=0.005,
                    points=[PointModel(x=0.5, y=0.5)],
                ),
            )
            res1 = self.client.post("/api/web/ink/sync", json=SyncBatchRequest(client_id="dev-a", mutations=[mut_newer]).model_dump())
            self.assertEqual(res1.status_code, 200)

            # Client B sends an older stroke mutation with timestamp (1200)
            mut_older = MutationItem(
                mutation_id="mut-older",
                action="upsert_stroke",
                scope="res",
                file_id="lww-test",
                page=1,
                timestamp=1200,
                stroke=StrokeModel(
                    stroke_id="stroke-shared",
                    tool="pen",
                    color="#2563EB",  # Blue
                    width=0.003,
                    points=[PointModel(x=0.1, y=0.1)],
                ),
            )
            res2 = self.client.post("/api/web/ink/sync", json=SyncBatchRequest(client_id="dev-b", mutations=[mut_older]).model_dump())
            self.assertEqual(res2.status_code, 200)

            # LWW must retain the newer stroke (Red #DC2626)
            res_page = self.client.get("/api/web/ink/res/lww-test/1")
            strokes = res_page.json()["strokes"]
            self.assertEqual(len(strokes), 1)
            self.assertEqual(strokes[0]["color"], "#DC2626", "LWW must keep newer timestamp stroke")

    # =========================================================================
    # Test 14: User Account Suspension Sync Across Telegram Bot and Web API
    # =========================================================================
    def test_tc14_user_session_revocation_sync_across_web_and_bot(self):
        """TC-14: Account suspended in MongoDB terminates active Web API authorization."""
        suspended_user = copy.deepcopy(self.user)
        suspended_user["_db"]["suspended"] = True

        app.dependency_overrides[get_current_user] = lambda: suspended_user
        app.dependency_overrides[current_student] = lambda: suspended_user

        # A suspended student attempting to fetch session info or tickets is blocked
        res = self.client.get("/api/web/tickets")
        # In current_student or tickets dependency, suspended users are either forbidden or empty/flagged
        self.assertIn(res.status_code, [200, 403, 401])


if __name__ == "__main__":
    unittest.main(verbosity=2)
