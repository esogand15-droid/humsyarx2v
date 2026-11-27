# -*- coding: utf-8 -*-
"""Verification suite for Wave 5: Digital Ink Canvas & Annotation Synchronization.

Tests:
1. Canonical PointModel validation (coordinates in [0, 1], pressure, time, tilt).
2. Strict rejection of non-finite floats (NaN, Infinity, -Infinity) and out-of-bounds.
3. StrokeModel validation (tool, color, width, opacity, blend_mode, max points).
4. Stroke serialization and deserialization roundtrip.
5. Batch sync endpoint (POST /api/web/ink/sync) idempotency and replay safety.
6. Stroke-level Last-Write-Wins (LWW) resolution based on timestamp.
7. Concurrent multi-device stroke merging without data loss.
8. Single page GET/PUT/DELETE compatibility and monotonic revision tracking.
9. Database compound index registration for web_ink_pages and web_ink_sync_log.
"""
from __future__ import annotations

import copy
import math
import os
import sys
import unittest
from unittest.mock import patch
import uuid
from typing import Any

# Ensure project root is in sys.path
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
backend_path = os.path.join(ROOT, "backend")
if backend_path not in sys.path:
    sys.path.append(backend_path)

os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017/medicalbot")
os.environ.setdefault("ADMIN_ID", "1")
os.environ.setdefault("TELEGRAM_TOKEN", "123:TEST")

import builtins
import typing
builtins.Optional = typing.Optional

from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.api.main import app
from backend.api.routers import web_ink
from backend.api.routers.web_ink import (
    MAX_POINTS,
    MAX_STROKES,
    PointModel,
    Stroke,
    StrokeModel,
    MutationItem,
    SyncBatchRequest,
)
from backend.api.routers.web_student import current_student
import database


class MockAsyncCursor:
    def __init__(self, items: list[dict]):
        self._items = list(items)

    def sort(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def __aiter__(self):
        self._iter = iter(self._items)
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration:
            raise StopAsyncIteration


class InMemoryMongoCollection:
    """In-memory async MongoDB collection simulator for reliable hermetic tests."""

    def __init__(self):
        self._data: dict[Any, dict] = {}

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

    async def update_one(self, query: dict, update: dict, upsert: bool = False):
        key = query.get("_id")
        target = self._data.get(key)
        if target is None:
            if not upsert:
                return
            target = {"_id": key}
            self._data[key] = target

        if "$set" in update:
            for k, v in update["$set"].items():
                target[k] = copy.deepcopy(v)

    async def insert_one(self, doc: dict):
        key = doc.get("_id") or uuid.uuid4().hex
        stored = copy.deepcopy(doc)
        stored["_id"] = key
        self._data[key] = stored

    async def delete_one(self, query: dict):
        key = query.get("_id")
        if key in self._data:
            del self._data[key]


class TestPointModelValidation(unittest.TestCase):
    """TC-INK-01, TC-INK-02, TC-INK-03: Point model validation and constraints."""

    def test_valid_point_normalized(self):
        pt = PointModel(x=0.5, y=0.5, pressure=0.8, time=150, tiltX=15.0, tiltY=-10.0)
        self.assertEqual(pt.x, 0.5)
        self.assertEqual(pt.y, 0.5)
        self.assertEqual(pt.pressure, 0.8)
        self.assertEqual(pt.time, 150)
        self.assertEqual(pt.tiltX, 15.0)
        self.assertEqual(pt.tiltY, -10.0)

    def test_point_boundary_limits(self):
        pt_min = PointModel(x=0.0, y=0.0, pressure=0.0, time=0)
        pt_max = PointModel(x=1.0, y=1.0, pressure=1.0, time=999999)
        self.assertEqual(pt_min.x, 0.0)
        self.assertEqual(pt_max.x, 1.0)
        self.assertEqual(pt_min.pressure, 0.0)
        self.assertEqual(pt_max.pressure, 1.0)

    def test_point_rejection_nan(self):
        with self.assertRaises(ValidationError):
            PointModel(x=float("nan"), y=0.5)
        with self.assertRaises(ValidationError):
            PointModel(x=0.5, y=float("nan"))
        with self.assertRaises(ValidationError):
            PointModel(x=0.5, y=0.5, pressure=float("nan"))

    def test_point_rejection_infinity(self):
        with self.assertRaises(ValidationError):
            PointModel(x=float("inf"), y=0.5)
        with self.assertRaises(ValidationError):
            PointModel(x=0.5, y=float("-inf"))
        with self.assertRaises(ValidationError):
            PointModel(x=0.5, y=0.5, pressure=float("inf"))

    def test_point_rejection_out_of_bounds(self):
        with self.assertRaises(ValidationError):
            PointModel(x=1.0001, y=0.5)
        with self.assertRaises(ValidationError):
            PointModel(x=-0.0001, y=0.5)
        with self.assertRaises(ValidationError):
            PointModel(x=0.5, y=1.5)
        with self.assertRaises(ValidationError):
            PointModel(x=0.5, y=-0.1)
        with self.assertRaises(ValidationError):
            PointModel(x=0.5, y=0.5, pressure=1.2)
        with self.assertRaises(ValidationError):
            PointModel(x=0.5, y=0.5, pressure=-0.1)

    def test_point_time_and_tilt_validation(self):
        with self.assertRaises(ValidationError):
            PointModel(x=0.5, y=0.5, time=-10)
        with self.assertRaises(ValidationError):
            PointModel(x=0.5, y=0.5, tiltX=95.0)
        with self.assertRaises(ValidationError):
            PointModel(x=0.5, y=0.5, tiltY=-95.0)

    def test_point_tuple_backward_compatibility(self):
        # Allow [x, y] legacy tuples to be parsed cleanly into PointModel
        pt1 = PointModel.model_validate([0.25, 0.75])
        self.assertEqual(pt1.x, 0.25)
        self.assertEqual(pt1.y, 0.75)
        self.assertEqual(pt1.pressure, 0.5)
        self.assertEqual(pt1.time, 0)

        pt2 = PointModel.model_validate([0.1, 0.2, 0.85, 300, 10.0, -5.0])
        self.assertEqual(pt2.x, 0.1)
        self.assertEqual(pt2.y, 0.2)
        self.assertEqual(pt2.pressure, 0.85)
        self.assertEqual(pt2.time, 300)
        self.assertEqual(pt2.tiltX, 10.0)
        self.assertEqual(pt2.tiltY, -5.0)


class TestStrokeModelValidation(unittest.TestCase):
    """Stroke model tools, blend modes, auto-defaults, and boundaries."""

    def test_stroke_default_generation(self):
        s = Stroke(
            points=[PointModel(x=0.1, y=0.1), PointModel(x=0.2, y=0.2)]
        )
        self.assertTrue(bool(s.stroke_id))
        self.assertEqual(s.tool, "pen")
        self.assertEqual(s.opacity, 1.0)
        self.assertEqual(s.blend_mode, "source-over")
        self.assertEqual(len(s.points), 2)

    def test_tools_accepted_and_rejected(self):
        for tool_name in ("pen", "pencil", "highlighter", "eraser"):
            s = Stroke(tool=tool_name)
            self.assertEqual(s.tool, tool_name)

        with self.assertRaises(ValidationError):
            Stroke(tool="crayon")

    def test_highlighter_automatic_defaults(self):
        # When tool is highlighter, opacity defaults to 0.35 and blend_mode to multiply
        s = Stroke(tool="highlighter")
        self.assertEqual(s.opacity, 0.35)
        self.assertEqual(s.blend_mode, "multiply")

    def test_blend_mode_validation(self):
        s1 = Stroke(blend_mode="source-over")
        self.assertEqual(s1.blend_mode, "source-over")
        s2 = Stroke(blend_mode="multiply")
        self.assertEqual(s2.blend_mode, "multiply")

        with self.assertRaises(ValidationError):
            Stroke(blend_mode="screen")

    def test_max_points_enforcement(self):
        pts = [PointModel(x=0.5, y=0.5) for _ in range(MAX_POINTS)]
        s = Stroke(points=pts)
        self.assertEqual(len(s.points), MAX_POINTS)

        with self.assertRaises(ValidationError):
            excess_pts = [PointModel(x=0.5, y=0.5) for _ in range(MAX_POINTS + 1)]
            Stroke(points=excess_pts)

    def test_stroke_serialization_roundtrip(self):
        orig = Stroke(
            stroke_id="test-stroke-1234",
            tool="pen",
            color="#1740B8",
            width=0.005,
            opacity=0.9,
            blend_mode="source-over",
            points=[
                PointModel(x=0.12, y=0.34, pressure=0.65, time=100, tiltX=5.0, tiltY=-3.0),
                PointModel(x=0.56, y=0.78, pressure=0.75, time=200, tiltX=7.0, tiltY=-2.0),
            ],
            timestamp=1700000000,
        )
        data = orig.model_dump()
        reconstituted = Stroke.model_validate(data)
        self.assertEqual(reconstituted.stroke_id, "test-stroke-1234")
        self.assertEqual(reconstituted.color, "#1740B8")
        self.assertEqual(len(reconstituted.points), 2)
        self.assertEqual(reconstituted.points[0].pressure, 0.65)
        self.assertEqual(reconstituted.points[1].time, 200)


class TestWebInkSyncEndpoints(unittest.TestCase):
    """TC-SYNC-01 to TC-SYNC-05: Batch sync idempotency, LWW conflict resolution, revisions."""

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.mock_user = {
            "user_id": 88881234,
            "name": "Wave 5 Tester",
            "username": "w5_tester",
            "student_id": "401999999",
            "approved": True,
            "suspended": False,
        }
        app.dependency_overrides[current_student] = lambda: cls.mock_user

    @classmethod
    def tearDownClass(cls):
        app.dependency_overrides.clear()

    def setUp(self):
        self.mock_pages = InMemoryMongoCollection()
        self.mock_sync_log = InMemoryMongoCollection()

        def _get_coll(name: str):
            if name == "web_ink_pages":
                return self.mock_pages
            if name == "web_ink_sync_log":
                return self.mock_sync_log
            return InMemoryMongoCollection()

        self._patcher = patch.object(web_ink, "_coll", side_effect=_get_coll)
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()

    def test_sync_batch_success_and_revision(self):
        """TC-SYNC-01: Batch mutation synchronization."""
        mutations = [
            {
                "mutation_id": f"mut-{i}",
                "scope": "res",
                "file_id": "doc_anatomy_1",
                "page": 1,
                "action": "upsert_stroke",
                "stroke": {
                    "stroke_id": f"s-{i}",
                    "tool": "pen",
                    "color": "#1740B8",
                    "width": 0.0035,
                    "points": [{"x": 0.1 * i, "y": 0.1 * i, "pressure": 0.5, "time": i * 10}],
                },
                "client_revision": i,
                "timestamp": 1000 + i,
            }
            for i in range(1, 4)
        ]

        payload = {"client_id": "client-device-alpha", "mutations": mutations}
        resp = self.client.post("/api/web/ink/sync", json=payload)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["processed"], 3)
        self.assertEqual(len(data["successful_ids"]), 3)
        self.assertEqual(data["conflicts"], [])

        # Verify MongoDB state
        page_doc = self.mock_pages._data.get("88881234:res:doc_anatomy_1:1")
        self.assertIsNotNone(page_doc)
        self.assertEqual(page_doc["page_revision"], 3)
        self.assertEqual(len(page_doc["strokes"]), 3)

    def test_sync_batch_idempotency(self):
        """TC-SYNC-02: Submitting identical batch twice produces zero duplicate strokes."""
        batch = {
            "client_id": "client-device-alpha",
            "mutations": [
                {
                    "mutation_id": "mut-fixed-101",
                    "scope": "res",
                    "file_id": "doc_cardio",
                    "page": 2,
                    "action": "upsert_stroke",
                    "stroke": {
                        "stroke_id": "stroke-cardio-1",
                        "tool": "highlighter",
                        "color": "#B4701F",
                        "width": 0.008,
                        "points": [{"x": 0.2, "y": 0.3}, {"x": 0.8, "y": 0.3}],
                    },
                    "client_revision": 1,
                    "timestamp": 2000,
                }
            ],
        }

        # First request
        resp1 = self.client.post("/api/web/ink/sync", json=batch)
        self.assertEqual(resp1.status_code, 200)
        self.assertIn("mut-fixed-101", resp1.json()["successful_ids"])

        # Second request (duplicate / network retry)
        resp2 = self.client.post("/api/web/ink/sync", json=batch)
        self.assertEqual(resp2.status_code, 200)
        self.assertIn("mut-fixed-101", resp2.json()["successful_ids"])

        # Page doc must still contain exactly 1 stroke, revision remains 1
        page_doc = self.mock_pages._data.get("88881234:res:doc_cardio:2")
        self.assertIsNotNone(page_doc)
        self.assertEqual(page_doc["page_revision"], 1)
        self.assertEqual(len(page_doc["strokes"]), 1)

    def test_stroke_level_last_write_wins(self):
        """TC-SYNC-03 & TC-SYNC-05: LWW per stroke_id based on timestamp."""
        # 1. Device A writes stroke-1 with color Red at timestamp 1000
        batch1 = {
            "client_id": "device-A",
            "mutations": [
                {
                    "mutation_id": "mut-a1",
                    "scope": "res",
                    "file_id": "doc_patho",
                    "page": 1,
                    "action": "upsert_stroke",
                    "stroke": {
                        "stroke_id": "stroke-shared-1",
                        "tool": "pen",
                        "color": "#FF0000",
                        "width": 0.004,
                        "points": [{"x": 0.1, "y": 0.1}],
                    },
                    "timestamp": 1000,
                }
            ],
        }
        resp1 = self.client.post("/api/web/ink/sync", json=batch1)
        self.assertEqual(resp1.status_code, 200)

        # 2. Device B updates stroke-1 with color Green at timestamp 2000 (newer)
        batch2 = {
            "client_id": "device-B",
            "mutations": [
                {
                    "mutation_id": "mut-b1",
                    "scope": "res",
                    "file_id": "doc_patho",
                    "page": 1,
                    "action": "upsert_stroke",
                    "stroke": {
                        "stroke_id": "stroke-shared-1",
                        "tool": "pen",
                        "color": "#00FF00",
                        "width": 0.004,
                        "points": [{"x": 0.1, "y": 0.1}],
                    },
                    "timestamp": 2000,
                }
            ],
        }
        resp2 = self.client.post("/api/web/ink/sync", json=batch2)
        self.assertEqual(resp2.status_code, 200)

        page_doc = self.mock_pages._data.get("88881234:res:doc_patho:1")
        self.assertEqual(page_doc["strokes"][0]["color"], "#00FF00")

        # 3. Device A sends stale update at timestamp 500 (older than 2000)
        batch3 = {
            "client_id": "device-A",
            "mutations": [
                {
                    "mutation_id": "mut-a2-stale",
                    "scope": "res",
                    "file_id": "doc_patho",
                    "page": 1,
                    "action": "upsert_stroke",
                    "stroke": {
                        "stroke_id": "stroke-shared-1",
                        "tool": "pen",
                        "color": "#0000FF",
                        "width": 0.004,
                        "points": [{"x": 0.1, "y": 0.1}],
                    },
                    "timestamp": 500,
                }
            ],
        }
        resp3 = self.client.post("/api/web/ink/sync", json=batch3)
        self.assertEqual(resp3.status_code, 200)

        # Color must still be Green (#00FF00) because LWW rejected the older timestamp
        page_doc = self.mock_pages._data.get("88881234:res:doc_patho:1")
        self.assertEqual(page_doc["strokes"][0]["color"], "#00FF00")

    def test_concurrent_multi_stroke_merging(self):
        """TC-SYNC-05: Concurrent non-conflicting strokes merge cleanly."""
        # Device A creates stroke A
        self.client.post(
            "/api/web/ink/sync",
            json={
                "client_id": "device-A",
                "mutations": [
                    {
                        "mutation_id": "mut-concurrent-A",
                        "scope": "ref",
                        "file_id": "book_neuro",
                        "page": 10,
                        "action": "upsert_stroke",
                        "stroke": {
                            "stroke_id": "stroke-A",
                            "tool": "pen",
                            "points": [{"x": 0.1, "y": 0.2}],
                        },
                        "timestamp": 1000,
                    }
                ],
            },
        )

        # Device B concurrently creates stroke B on same page
        self.client.post(
            "/api/web/ink/sync",
            json={
                "client_id": "device-B",
                "mutations": [
                    {
                        "mutation_id": "mut-concurrent-B",
                        "scope": "ref",
                        "file_id": "book_neuro",
                        "page": 10,
                        "action": "upsert_stroke",
                        "stroke": {
                            "stroke_id": "stroke-B",
                            "tool": "highlighter",
                            "points": [{"x": 0.5, "y": 0.6}],
                        },
                        "timestamp": 1005,
                    }
                ],
            },
        )

        page_doc = self.mock_pages._data.get("88881234:ref:book_neuro:10")
        stroke_ids = [s["stroke_id"] for s in page_doc["strokes"]]
        self.assertEqual(len(stroke_ids), 2)
        self.assertIn("stroke-A", stroke_ids)
        self.assertIn("stroke-B", stroke_ids)
        self.assertEqual(page_doc["page_revision"], 2)

    def test_delete_and_clear_mutations(self):
        """Test delete_stroke and clear_page actions."""
        # Add 2 strokes
        self.client.post(
            "/api/web/ink/sync",
            json={
                "client_id": "device-1",
                "mutations": [
                    {
                        "mutation_id": "m1",
                        "scope": "res",
                        "file_id": "doc_del",
                        "page": 1,
                        "action": "upsert_stroke",
                        "stroke": {"stroke_id": "s1", "points": [{"x": 0.1, "y": 0.1}]},
                    },
                    {
                        "mutation_id": "m2",
                        "scope": "res",
                        "file_id": "doc_del",
                        "page": 1,
                        "action": "upsert_stroke",
                        "stroke": {"stroke_id": "s2", "points": [{"x": 0.2, "y": 0.2}]},
                    },
                ],
            },
        )

        # Delete stroke s1
        self.client.post(
            "/api/web/ink/sync",
            json={
                "client_id": "device-1",
                "mutations": [
                    {
                        "mutation_id": "m3",
                        "scope": "res",
                        "file_id": "doc_del",
                        "page": 1,
                        "action": "delete_stroke",
                        "stroke": {"stroke_id": "s1"},
                    }
                ],
            },
        )
        page_doc = self.mock_pages._data.get("88881234:res:doc_del:1")
        self.assertEqual(len(page_doc["strokes"]), 1)
        self.assertEqual(page_doc["strokes"][0]["stroke_id"], "s2")

        # Clear page
        self.client.post(
            "/api/web/ink/sync",
            json={
                "client_id": "device-1",
                "mutations": [
                    {
                        "mutation_id": "m4",
                        "scope": "res",
                        "file_id": "doc_del",
                        "page": 1,
                        "action": "clear_page",
                    }
                ],
            },
        )
        page_doc = self.mock_pages._data.get("88881234:res:doc_del:1")
        self.assertEqual(len(page_doc["strokes"]), 0)

    def test_clear_page_clears_sticky_notes_too(self):
        """clear_page must remove both strokes and sticky notes on that page."""
        self.client.post(
            "/api/web/ink/sync",
            json={
                "client_id": "device-1",
                "mutations": [
                    {
                        "mutation_id": "m-note-1",
                        "scope": "res",
                        "file_id": "doc_clear_notes",
                        "page": 3,
                        "action": "upsert_note",
                        "note": {"note_id": "n1", "x": 0.4, "y": 0.5, "text": "نکته بالینی"},
                    },
                    {
                        "mutation_id": "m-stroke-1",
                        "scope": "res",
                        "file_id": "doc_clear_notes",
                        "page": 3,
                        "action": "upsert_stroke",
                        "stroke": {"stroke_id": "s1", "points": [{"x": 0.2, "y": 0.2}]},
                    },
                ],
            },
        )
        before = self.mock_pages._data.get("88881234:res:doc_clear_notes:3")
        self.assertEqual(len(before["notes"]), 1)
        self.assertEqual(len(before["strokes"]), 1)

        self.client.post(
            "/api/web/ink/sync",
            json={
                "client_id": "device-1",
                "mutations": [
                    {
                        "mutation_id": "m-clear-1",
                        "scope": "res",
                        "file_id": "doc_clear_notes",
                        "page": 3,
                        "action": "clear_page",
                    }
                ],
            },
        )
        after = self.mock_pages._data.get("88881234:res:doc_clear_notes:3")
        self.assertEqual(after["strokes"], [])
        self.assertEqual(after["notes"], [])

    def test_mutation_id_isolated_across_different_users(self):
        """User B reusing User A's mutation_id must not skip applying User B's mutation."""
        shared_batch = {
            "client_id": "client-1",
            "mutations": [
                {
                    "mutation_id": "same-mut-id-1",
                    "scope": "res",
                    "file_id": "doc_shared_mut",
                    "page": 1,
                    "action": "upsert_stroke",
                    "stroke": {"stroke_id": "s-user", "points": [{"x": 0.3, "y": 0.3}]},
                    "timestamp": 1000,
                }
            ],
        }
        r_a = self.client.post("/api/web/ink/sync", json=shared_batch)
        self.assertEqual(r_a.status_code, 200)
        self.assertIn("88881234:res:doc_shared_mut:1", self.mock_pages._data)

        other_user = {
            "user_id": 99995678,
            "name": "Other Student",
            "approved": True,
            "suspended": False,
        }
        app.dependency_overrides[current_student] = lambda: other_user
        try:
            r_b = self.client.post("/api/web/ink/sync", json=shared_batch)
            self.assertEqual(r_b.status_code, 200)
            self.assertIn("99995678:res:doc_shared_mut:1", self.mock_pages._data)
        finally:
            app.dependency_overrides[current_student] = lambda: self.mock_user

    def test_sync_batch_size_cap_50(self):
        """Batch size > 50 must be rejected with HTTP 422."""
        excess_mutations = [
            {
                "mutation_id": f"m-{i}",
                "scope": "res",
                "file_id": "doc_overflow",
                "page": 1,
                "action": "upsert_stroke",
                "stroke": {"stroke_id": f"s-{i}", "points": [{"x": 0.1, "y": 0.1}]},
            }
            for i in range(51)
        ]
        resp = self.client.post(
            "/api/web/ink/sync",
            json={"client_id": "test-dev", "mutations": excess_mutations},
        )
        self.assertEqual(resp.status_code, 422)

    def test_sync_nan_or_out_of_bounds_rejection_http_422(self):
        """Point containing NaN or coordinate > 1.0 returns HTTP 422."""
        bad_payload = {
            "client_id": "test-dev",
            "mutations": [
                {
                    "mutation_id": "m-nan",
                    "scope": "res",
                    "file_id": "doc_nan",
                    "page": 1,
                    "action": "upsert_stroke",
                    "stroke": {
                        "stroke_id": "s-nan",
                        "points": [{"x": 1.5, "y": 0.5}],  # Out of bounds > 1.0
                    },
                }
            ],
        }
        resp = self.client.post("/api/web/ink/sync", json=bad_payload)
        self.assertEqual(resp.status_code, 422)


class TestSinglePageEndpointCompatibility(unittest.TestCase):
    """GET / PUT / DELETE /ink/{scope}/{file_id}/{page} compatibility."""

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.mock_user = {
            "user_id": 77771234,
            "name": "Page Tester",
            "username": "page_tester",
            "student_id": "401888888",
            "approved": True,
            "suspended": False,
        }
        app.dependency_overrides[current_student] = lambda: cls.mock_user

    @classmethod
    def tearDownClass(cls):
        app.dependency_overrides.clear()

    def setUp(self):
        self.mock_pages = InMemoryMongoCollection()
        self._patcher = patch.object(
            web_ink, "_coll", return_value=self.mock_pages
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()

    def test_get_empty_page(self):
        resp = self.client.get("/api/web/ink/res/sample_doc/1")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["strokes"], [])
        self.assertEqual(data["page_revision"], 0)

    def test_delete_page(self):
        resp = self.client.delete("/api/web/ink/res/sample_doc/1")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["ok"])

    def test_put_page_success_and_revision(self):
        with patch.object(web_ink, "_guard", return_value={"file_id": "sample_doc"}):
            resp = self.client.put(
                "/api/web/ink/res/sample_doc/1",
                json={
                    "strokes": [
                        {
                            "stroke_id": "s-put-1",
                            "tool": "pen",
                            "color": "#1740B8",
                            "width": 0.0035,
                            "points": [{"x": 0.2, "y": 0.3}],
                        }
                    ]
                },
            )
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertTrue(data["ok"])
            self.assertEqual(data["count"], 1)
            self.assertEqual(data["page_revision"], 1)

            # Check GET now returns the saved stroke
            get_resp = self.client.get("/api/web/ink/res/sample_doc/1")
            self.assertEqual(get_resp.status_code, 200)
            get_data = get_resp.json()
            self.assertEqual(len(get_data["strokes"]), 1)
            self.assertEqual(get_data["page_revision"], 1)

    def test_put_page_stroke_limit_exceeded_http_400(self):
        with patch.object(web_ink, "_guard", return_value={"file_id": "sample_doc"}):
            excess_strokes = [
                {
                    "stroke_id": f"s-{i}",
                    "tool": "pen",
                    "points": [{"x": 0.5, "y": 0.5}],
                }
                for i in range(MAX_STROKES + 1)
            ]
            resp = self.client.put(
                "/api/web/ink/res/sample_doc/1",
                json={"strokes": excess_strokes},
            )
            self.assertIn(resp.status_code, (400, 422))



class TestDatabaseIndexDeclarations(unittest.TestCase):
    """TC-DB-01: Compound indexes on web_ink_pages and web_ink_sync_log."""

    def test_db_has_web_ink_collections(self):
        self.assertTrue(hasattr(database.db, "web_ink_pages"))
        self.assertTrue(hasattr(database.db, "web_ink_sync_log"))

    def test_ensure_indexes_specs_contain_web_ink_indexes(self):
        """Inspect ensure_indexes source to guarantee compound indexes are declared."""
        from backend.database.core import DBCore
        import inspect

        source = inspect.getsource(DBCore.ensure_indexes)
        self.assertIn("self.web_ink_pages", source)
        self.assertIn("('uid', 1), ('scope', 1), ('file_id', 1), ('page', 1)", source)
        self.assertIn("('scope', 1), ('file_id', 1), ('uid', 1)", source)
        self.assertIn("('uid', 1), ('updated_at', -1)", source)
        self.assertIn("self.web_ink_sync_log", source)
        self.assertIn("('mutation_id', 1)", source)
        self.assertIn("('created_at', 1)", source)


if __name__ == "__main__":
    unittest.main()
