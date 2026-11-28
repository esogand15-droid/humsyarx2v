# -*- coding: utf-8 -*-
"""Empirical Adversarial Challenge & Stress-Test Suite for Wave 5.

Role: challenger_w4w5_2 (critic, specialist)
Milestone: Wave 5 (Digital Ink Canvas & Annotation Sync)

Coverage:
1. Coordinate Boundaries & Float Fuzzing (NaN, Inf, -Inf, out-of-range, corrupt point arrays, malformed JSON).
2. Concurrent Sync & Conflict Resolution (10-device simulation, LWW timestamps, replay storm idempotency).
3. Payload Caps & Stress Thresholds (400 strokes, 2000 points/stroke, batch cap 50, heavy memory resilience).
4. Canvas, Palm Rejection & Eraser Geometry (distToSegment math oracle, palm dimensions, stylus decay, multi-touch).
"""
from __future__ import annotations

import copy
import inspect
import math
import os
import sys
import time
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
    sys.path.insert(0, backend_path)

os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017/medicalbot")
os.environ.setdefault("ADMIN_ID", "1")
os.environ.setdefault("TELEGRAM_TOKEN", "123:TEST")

from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.api.main import app
from backend.api.routers import web_ink
from backend.api.routers.web_ink import (
    MAX_PAGE,
    MAX_POINTS,
    MAX_STROKES,
    InkBody,
    MutationItem,
    PointModel,
    Stroke,
    StrokeModel,
    SyncBatchRequest,
)
from backend.api.routers.web_student import current_student
import backend.database.database as database


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
    """In-memory async MongoDB collection simulator for deterministic challenge tests."""

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


# ─────────────────────────────────────────────────────────────
# 1. Coordinate Boundaries & Float Fuzzing
# ─────────────────────────────────────────────────────────────
class TestCoordinateBoundaryAndFloatFuzzing(unittest.TestCase):
    """Challenge 1: Stress-test input validation with IEEE 754 non-finite floats, out-of-range floats, corrupt point arrays."""

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.mock_user = {
            "user_id": 99990001,
            "name": "Adversarial Fuzzer",
            "username": "fuzzer",
            "student_id": "401990001",
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

    def test_nan_fuzzing_in_points_pydantic_and_api(self):
        """NaN in x, y, pressure, or tilt must strictly raise ValidationError and return HTTP 422."""
        nan_cases = [
            {"x": float("nan"), "y": 0.5},
            {"x": 0.5, "y": float("nan")},
            {"x": 0.5, "y": 0.5, "pressure": float("nan")},
            {"x": 0.5, "y": 0.5, "tiltX": float("nan")},
            {"x": 0.5, "y": 0.5, "tiltY": float("nan")},
            # Legacy tuple parsing with NaN
            [float("nan"), 0.5],
            [0.5, float("nan")],
            [0.5, 0.5, float("nan")],
            [0.5, 0.5, 0.5, 0, float("nan"), 0.0],
        ]
        for idx, case in enumerate(nan_cases):
            with self.subTest(idx=idx, case=case):
                with self.assertRaises(ValidationError):
                    PointModel.model_validate(case)

        # Test endpoint rejection via HTTP POST /api/web/ink/sync with out-of-range / NaN payload
        bad_payload = {
            "client_id": "fuzzer-1",
            "mutations": [
                {
                    "mutation_id": "m-fuzz-nan",
                    "scope": "res",
                    "file_id": "doc_fuzz",
                    "page": 1,
                    "action": "upsert_stroke",
                    "stroke": {
                        "stroke_id": "s-nan",
                        "points": [{"x": 1.0001, "y": 0.5}],  # Out-of-bounds
                    },
                }
            ],
        }
        resp = self.client.post("/api/web/ink/sync", json=bad_payload)
        self.assertEqual(resp.status_code, 422)

    def test_infinity_fuzzing_in_points(self):
        """Positive and negative infinity must be rejected in all float fields."""
        inf_cases = [
            {"x": float("inf"), "y": 0.5},
            {"x": float("-inf"), "y": 0.5},
            {"x": 0.5, "y": float("inf")},
            {"x": 0.5, "y": float("-inf")},
            {"x": 0.5, "y": 0.5, "pressure": float("inf")},
            {"x": 0.5, "y": 0.5, "pressure": float("-inf")},
            {"x": 0.5, "y": 0.5, "tiltX": float("inf")},
            {"x": 0.5, "y": 0.5, "tiltY": float("-inf")},
            # Tuple formats
            [float("inf"), 0.5],
            [0.5, float("-inf")],
            [0.5, 0.5, float("inf")],
        ]
        for idx, case in enumerate(inf_cases):
            with self.subTest(idx=idx, case=case):
                with self.assertRaises(ValidationError):
                    PointModel.model_validate(case)

    def test_out_of_range_floats_stress(self):
        """Coordinates outside [0.0, 1.0] and pressure outside [0.0, 1.0] must be rejected."""
        boundary_cases = [
            # Coordinate underflow
            {"x": -0.00000001, "y": 0.5},
            {"x": -0.001, "y": 0.5},
            {"x": -1.0, "y": 0.5},
            {"x": -1e9, "y": 0.5},
            {"x": 0.5, "y": -0.0001},
            {"x": 0.5, "y": -1e9},
            # Coordinate overflow
            {"x": 1.00000001, "y": 0.5},
            {"x": 1.001, "y": 0.5},
            {"x": 2.0, "y": 0.5},
            {"x": 1e9, "y": 0.5},
            {"x": 0.5, "y": 1.0001},
            {"x": 0.5, "y": 1e9},
            # Pressure boundaries
            {"x": 0.5, "y": 0.5, "pressure": -0.0001},
            {"x": 0.5, "y": 0.5, "pressure": 1.0001},
            {"x": 0.5, "y": 0.5, "pressure": 1e6},
            # Time negative
            {"x": 0.5, "y": 0.5, "time": -1},
            {"x": 0.5, "y": 0.5, "time": -99999},
            # Tilt out of [-90, 90]
            {"x": 0.5, "y": 0.5, "tiltX": 90.01},
            {"x": 0.5, "y": 0.5, "tiltX": -90.01},
            {"x": 0.5, "y": 0.5, "tiltY": 180.0},
            {"x": 0.5, "y": 0.5, "tiltY": -180.0},
        ]
        for idx, case in enumerate(boundary_cases):
            with self.subTest(idx=idx, case=case):
                with self.assertRaises(ValidationError):
                    PointModel.model_validate(case)

    def test_corrupt_point_arrays_and_shapes(self):
        """Empty arrays, single items, strings, or missing coordinates must raise ValidationError."""
        corrupt_cases = [
            [],
            [0.5],
            ["not_a_float", 0.5],
            [0.5, "not_a_float"],
            None,
            "just_a_string",
            {"pressure": 0.5},  # missing x and y
            {"x": "string_val", "y": 0.5},
            {"x": None, "y": 0.5},
        ]
        for idx, case in enumerate(corrupt_cases):
            with self.subTest(idx=idx, case=case):
                with self.assertRaises((ValidationError, TypeError)):
                    PointModel.model_validate(case)

    def test_stroke_attribute_fuzzing(self):
        """Stress-test StrokeModel fields: width, opacity, tool, blend_mode."""
        # Width out of bounds (gt=0.0, lt=0.2)
        for w in (0.0, -0.001, 0.2, 0.5, float("nan"), float("inf")):
            with self.subTest(width=w):
                with self.assertRaises(ValidationError):
                    Stroke(width=w)

        # Opacity out of bounds (ge=0.0, le=1.0)
        for op in (-0.01, 1.01, 2.0, float("nan"), float("inf")):
            with self.subTest(opacity=op):
                with self.assertRaises(ValidationError):
                    Stroke(opacity=op)

        # Tool injection & fuzzing
        for tool in ("<script>alert(1)</script>", "spray", "marker", "PEN", "highlighter ", ""):
            with self.subTest(tool=tool):
                with self.assertRaises(ValidationError):
                    Stroke(tool=tool)

        # Blend mode injection
        for bm in ("screen", "overlay", "difference", "multiply ", ""):
            with self.subTest(blend_mode=bm):
                with self.assertRaises(ValidationError):
                    Stroke(blend_mode=bm)

    def test_malformed_mutation_payloads_http_422(self):
        """Endpoints must return HTTP 422 for malformed sync envelopes."""
        # Missing client_id
        resp1 = self.client.post("/api/web/ink/sync", json={"mutations": []})
        self.assertEqual(resp1.status_code, 422)

        # Invalid action
        resp2 = self.client.post(
            "/api/web/ink/sync",
            json={
                "client_id": "c1",
                "mutations": [
                    {
                        "mutation_id": "m1",
                        "scope": "res",
                        "file_id": "f1",
                        "page": 1,
                        "action": "execute_shell",
                    }
                ],
            },
        )
        self.assertEqual(resp2.status_code, 422)

        # Out-of-bounds page
        for p in (0, -1, 2001, 999999):
            resp3 = self.client.post(
                "/api/web/ink/sync",
                json={
                    "client_id": "c1",
                    "mutations": [
                        {
                            "mutation_id": f"m-{p}",
                            "scope": "res",
                            "file_id": "f1",
                            "page": p,
                            "action": "clear_page",
                        }
                    ],
                },
            )
            self.assertEqual(resp3.status_code, 422)


# ─────────────────────────────────────────────────────────────
# 2. Concurrent Sync & Conflict Resolution
# ─────────────────────────────────────────────────────────────
class TestConcurrentSyncAndConflictResolution(unittest.TestCase):
    """Challenge 2: Multi-device concurrency simulation, LWW timestamps, replay storm idempotency."""

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.mock_user = {
            "user_id": 88889999,
            "name": "Sync Challenger",
            "username": "sync_challenger",
            "student_id": "401889999",
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

    def test_ten_device_concurrent_sync_simulation(self):
        """Simulate 10 distinct client devices concurrently modifying the same page.
        Confirm Last-Write-Wins (LWW) reconciles strokes without data loss or stroke duplication.
        """
        page_key = "88889999:res:book_surgery:5"

        # 1. Devices 1..5 each create their own stroke
        for dev_num in range(1, 6):
            payload = {
                "client_id": f"device-00{dev_num}",
                "mutations": [
                    {
                        "mutation_id": f"mut-create-{dev_num}",
                        "scope": "res",
                        "file_id": "book_surgery",
                        "page": 5,
                        "action": "upsert_stroke",
                        "stroke": {
                            "stroke_id": f"stroke-dev-{dev_num}",
                            "tool": "pen",
                            "color": f"#00000{dev_num}",
                            "width": 0.0035,
                            "points": [{"x": 0.1 * dev_num, "y": 0.1 * dev_num}],
                        },
                        "timestamp": 1000 + dev_num * 10,
                    }
                ],
            }
            resp = self.client.post("/api/web/ink/sync", json=payload)
            self.assertEqual(resp.status_code, 200)

        # Page doc must have 5 strokes, revision 5
        page_doc = self.mock_pages._data.get(page_key)
        self.assertIsNotNone(page_doc)
        self.assertEqual(len(page_doc["strokes"]), 5)
        self.assertEqual(page_doc["page_revision"], 5)

        # 2. Device 6 updates stroke-dev-1 to Blue with timestamp 2000 (newer than 1010)
        resp_d6 = self.client.post(
            "/api/web/ink/sync",
            json={
                "client_id": "device-006",
                "mutations": [
                    {
                        "mutation_id": "mut-update-d1-blue",
                        "scope": "res",
                        "file_id": "book_surgery",
                        "page": 5,
                        "action": "upsert_stroke",
                        "stroke": {
                            "stroke_id": "stroke-dev-1",
                            "tool": "pen",
                            "color": "#0000FF",  # Blue
                            "width": 0.005,
                            "points": [{"x": 0.1, "y": 0.1}, {"x": 0.2, "y": 0.2}],
                        },
                        "timestamp": 2000,
                    }
                ],
            },
        )
        self.assertEqual(resp_d6.status_code, 200)

        # 3. Device 7 attempts stale update to stroke-dev-1 with timestamp 500 (< 2000)
        resp_d7 = self.client.post(
            "/api/web/ink/sync",
            json={
                "client_id": "device-007",
                "mutations": [
                    {
                        "mutation_id": "mut-update-d1-stale-red",
                        "scope": "res",
                        "file_id": "book_surgery",
                        "page": 5,
                        "action": "upsert_stroke",
                        "stroke": {
                            "stroke_id": "stroke-dev-1",
                            "tool": "pen",
                            "color": "#FF0000",  # Red
                            "points": [{"x": 0.1, "y": 0.1}],
                        },
                        "timestamp": 500,  # Older than 2000
                    }
                ],
            },
        )
        self.assertEqual(resp_d7.status_code, 200)

        # 4. Device 8 deletes stroke-dev-3
        resp_d8 = self.client.post(
            "/api/web/ink/sync",
            json={
                "client_id": "device-008",
                "mutations": [
                    {
                        "mutation_id": "mut-delete-d3",
                        "scope": "res",
                        "file_id": "book_surgery",
                        "page": 5,
                        "action": "delete_stroke",
                        "stroke": {"stroke_id": "stroke-dev-3"},
                        "timestamp": 2500,
                    }
                ],
            },
        )
        self.assertEqual(resp_d8.status_code, 200)

        # 5. Device 9 adds stroke-dev-6
        resp_d9 = self.client.post(
            "/api/web/ink/sync",
            json={
                "client_id": "device-009",
                "mutations": [
                    {
                        "mutation_id": "mut-create-d6",
                        "scope": "res",
                        "file_id": "book_surgery",
                        "page": 5,
                        "action": "upsert_stroke",
                        "stroke": {
                            "stroke_id": "stroke-dev-6",
                            "tool": "highlighter",
                            "points": [{"x": 0.6, "y": 0.6}],
                        },
                        "timestamp": 3000,
                    }
                ],
            },
        )
        self.assertEqual(resp_d9.status_code, 200)

        # Final Verification of State
        final_doc = self.mock_pages._data.get(page_key)
        strokes = {s["stroke_id"]: s for s in final_doc["strokes"]}

        # Must have exactly 5 strokes: dev-1, dev-2, dev-4, dev-5, dev-6 (dev-3 deleted)
        self.assertEqual(len(strokes), 5)
        self.assertNotIn("stroke-dev-3", strokes)
        self.assertIn("stroke-dev-1", strokes)
        self.assertIn("stroke-dev-6", strokes)

        # LWW: stroke-dev-1 must be Blue (#0000FF), NOT stale Red (#FF0000)
        self.assertEqual(strokes["stroke-dev-1"]["color"], "#0000FF")
        self.assertEqual(strokes["stroke-dev-1"]["width"], 0.005)

        # Total revisions: 5 creates + 1 update + 1 stale (still increments rev) + 1 delete + 1 create = 9
        self.assertEqual(final_doc["page_revision"], 9)

    def test_strict_idempotency_replay_storm(self):
        """Replaying identical mutation_ids 10 times consecutively must return HTTP 200
        without creating duplicate strokes or re-incrementing page_revision.
        """
        batch = {
            "client_id": "replay-device",
            "mutations": [
                {
                    "mutation_id": f"replay-mut-{i}",
                    "scope": "ref",
                    "file_id": "ref_pediatrics",
                    "page": 3,
                    "action": "upsert_stroke",
                    "stroke": {
                        "stroke_id": f"replay-stroke-{i}",
                        "tool": "pen",
                        "points": [{"x": 0.05 * i, "y": 0.05 * i}],
                    },
                    "timestamp": 1000 + i,
                }
                for i in range(1, 11)
            ],
        }

        # 1. First execution
        resp1 = self.client.post("/api/web/ink/sync", json=batch)
        self.assertEqual(resp1.status_code, 200)
        data1 = resp1.json()
        self.assertEqual(data1["processed"], 10)
        self.assertEqual(len(data1["successful_ids"]), 10)

        page_key = "88889999:ref:ref_pediatrics:3"
        doc_after_first = copy.deepcopy(self.mock_pages._data.get(page_key))
        self.assertIsNotNone(doc_after_first)
        self.assertEqual(len(doc_after_first["strokes"]), 10)
        rev_after_first = doc_after_first["page_revision"]
        self.assertEqual(rev_after_first, 10)

        # 2. Replay storm: 10 identical submissions
        for replay_idx in range(1, 11):
            resp = self.client.post("/api/web/ink/sync", json=batch)
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertEqual(data["processed"], 10)
            self.assertEqual(len(data["successful_ids"]), 10)
            self.assertEqual(data["conflicts"], [])

        # 3. Verify final state: ZERO duplicate strokes, revision strictly UNCHANGED
        doc_after_replays = self.mock_pages._data.get(page_key)
        self.assertEqual(len(doc_after_replays["strokes"]), 10)
        self.assertEqual(doc_after_replays["page_revision"], rev_after_first)
        stroke_ids = [s["stroke_id"] for s in doc_after_replays["strokes"]]
        self.assertEqual(len(stroke_ids), len(set(stroke_ids)))  # 100% unique

    def test_interleaved_multi_device_replay(self):
        """Interleaved replay between two devices."""
        page_key = "88889999:res:doc_interleave:1"
        batch_a = {
            "client_id": "device-A",
            "mutations": [
                {
                    "mutation_id": "mut-a-1",
                    "scope": "res",
                    "file_id": "doc_interleave",
                    "page": 1,
                    "action": "upsert_stroke",
                    "stroke": {"stroke_id": "s-a-1", "points": [{"x": 0.1, "y": 0.1}]},
                    "timestamp": 100,
                }
            ],
        }
        batch_b = {
            "client_id": "device-B",
            "mutations": [
                {
                    "mutation_id": "mut-b-1",
                    "scope": "res",
                    "file_id": "doc_interleave",
                    "page": 1,
                    "action": "upsert_stroke",
                    "stroke": {"stroke_id": "s-b-1", "points": [{"x": 0.2, "y": 0.2}]},
                    "timestamp": 200,
                }
            ],
        }

        self.client.post("/api/web/ink/sync", json=batch_a)
        self.client.post("/api/web/ink/sync", json=batch_b)
        # Replay both
        self.client.post("/api/web/ink/sync", json=batch_a)
        self.client.post("/api/web/ink/sync", json=batch_b)

        doc = self.mock_pages._data.get(page_key)
        self.assertEqual(len(doc["strokes"]), 2)
        self.assertEqual(doc["page_revision"], 2)


# ─────────────────────────────────────────────────────────────
# 3. Payload Caps & Stress Thresholds
# ─────────────────────────────────────────────────────────────
class TestPayloadCapsAndStressThresholds(unittest.TestCase):
    """Challenge 3: Exceeding payload limits (strokes > 400, points > 2000, batch > 50).
    Clean error handling without server memory exhaustion.
    """

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.mock_user = {
            "user_id": 77770001,
            "name": "Stress Challenger",
            "username": "stress_challenger",
            "student_id": "401770001",
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

    def test_points_cap_2000_strict_enforcement(self):
        """2000 points allowed; 2001 points strictly rejected with ValidationError / HTTP 422."""
        # 2000 points: ACCEPTED
        pts_2000 = [{"x": 0.5, "y": 0.5, "pressure": 0.5, "time": i} for i in range(2000)]
        s_valid = Stroke.model_validate({"points": pts_2000})
        self.assertEqual(len(s_valid.points), 2000)

        # 2001 points: REJECTED
        pts_2001 = [{"x": 0.5, "y": 0.5, "pressure": 0.5, "time": i} for i in range(2001)]
        with self.assertRaises(ValidationError):
            Stroke.model_validate({"points": pts_2001})

        # Test via sync endpoint
        resp = self.client.post(
            "/api/web/ink/sync",
            json={
                "client_id": "dev-overflow",
                "mutations": [
                    {
                        "mutation_id": "m-pt-overflow",
                        "scope": "res",
                        "file_id": "doc_overflow",
                        "page": 1,
                        "action": "upsert_stroke",
                        "stroke": {"points": pts_2001},
                    }
                ],
            },
        )
        self.assertEqual(resp.status_code, 422)

    def test_strokes_cap_400_in_put_page(self):
        """PUT /ink/page accepts <= 400 strokes, rejects 401 strokes with HTTP 400 or 422."""
        with patch.object(web_ink, "_guard", return_value={"file_id": "doc_cap"}):
            # 400 strokes: ACCEPTED
            strokes_400 = [
                {"stroke_id": f"s-{i}", "points": [{"x": 0.1, "y": 0.1}]} for i in range(400)
            ]
            resp_400 = self.client.put(
                "/api/web/ink/res/doc_cap/1",
                json={"strokes": strokes_400},
            )
            self.assertEqual(resp_400.status_code, 200)

            # 401 strokes: REJECTED
            strokes_401 = [
                {"stroke_id": f"s-{i}", "points": [{"x": 0.1, "y": 0.1}]} for i in range(401)
            ]
            resp_401 = self.client.put(
                "/api/web/ink/res/doc_cap/1",
                json={"strokes": strokes_401},
            )
            self.assertIn(resp_401.status_code, (400, 422))

    def test_sync_batch_stroke_limit_graceful_conflict_handling(self):
        """When a page reaches 400 strokes, sync_batch reports conflict 'STROKE_LIMIT_EXCEEDED'
        without crashing or memory exhaustion.
        """
        page_key = "77770001:res:doc_full:1"
        # Seed page with 400 strokes
        initial_strokes = [
            {"stroke_id": f"seed-s-{i}", "tool": "pen", "points": [{"x": 0.1, "y": 0.1}]}
            for i in range(MAX_STROKES)
        ]
        self.mock_pages._data[page_key] = {
            "_id": page_key,
            "uid": 77770001,
            "scope": "res",
            "file_id": "doc_full",
            "page": 1,
            "page_revision": 1,
            "strokes": initial_strokes,
            "count": MAX_STROKES,
            "updated_at": "2026-11-06T00:00:00Z",
        }

        # Attempt to add 401st stroke via sync
        resp = self.client.post(
            "/api/web/ink/sync",
            json={
                "client_id": "dev-limit",
                "mutations": [
                    {
                        "mutation_id": "mut-add-overflow",
                        "scope": "res",
                        "file_id": "doc_full",
                        "page": 1,
                        "action": "upsert_stroke",
                        "stroke": {
                            "stroke_id": "stroke-401",
                            "tool": "pen",
                            "points": [{"x": 0.5, "y": 0.5}],
                        },
                    }
                ],
            },
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data["conflicts"]), 1)
        self.assertEqual(data["conflicts"][0]["reason"], "STROKE_LIMIT_EXCEEDED")

        # Page doc must still contain exactly 400 strokes
        doc = self.mock_pages._data.get(page_key)
        self.assertEqual(len(doc["strokes"]), 400)

    def test_sync_batch_cap_50_strict_enforcement(self):
        """Batch size up to 50 accepted; 51 rejected with HTTP 422."""
        # 50 mutations: ACCEPTED
        mutations_50 = [
            {
                "mutation_id": f"m-batch-{i}",
                "scope": "res",
                "file_id": "doc_batch",
                "page": 1,
                "action": "upsert_stroke",
                "stroke": {"stroke_id": f"s-{i}", "points": [{"x": 0.1, "y": 0.1}]},
            }
            for i in range(50)
        ]
        resp_50 = self.client.post(
            "/api/web/ink/sync",
            json={"client_id": "dev-batch", "mutations": mutations_50},
        )
        self.assertEqual(resp_50.status_code, 200)

        # 51 mutations: REJECTED with 422
        mutations_51 = mutations_50 + [
            {
                "mutation_id": "m-batch-51",
                "scope": "res",
                "file_id": "doc_batch",
                "page": 1,
                "action": "upsert_stroke",
                "stroke": {"stroke_id": "s-51", "points": [{"x": 0.1, "y": 0.1}]},
            }
        ]
        resp_51 = self.client.post(
            "/api/web/ink/sync",
            json={"client_id": "dev-batch", "mutations": mutations_51},
        )
        self.assertEqual(resp_51.status_code, 422)

    def test_heavy_payload_memory_resilience(self):
        """50 mutations, each containing 50 points (total 2,500 points in single request).
        Verifies sub-second completion without server memory exhaustion.
        """
        heavy_mutations = [
            {
                "mutation_id": f"heavy-m-{i}",
                "scope": "res",
                "file_id": "doc_heavy",
                "page": 1,
                "action": "upsert_stroke",
                "stroke": {
                    "stroke_id": f"heavy-s-{i}",
                    "tool": "pen",
                    "points": [{"x": (j % 100) / 100.0, "y": (j % 100) / 100.0} for j in range(50)],
                },
                "timestamp": 1000 + i,
            }
            for i in range(50)
        ]

        t0 = time.perf_counter()
        resp = self.client.post(
            "/api/web/ink/sync",
            json={"client_id": "dev-heavy", "mutations": heavy_mutations},
        )
        elapsed = time.perf_counter() - t0

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["processed"], 50)
        self.assertLess(elapsed, 3.0, f"Heavy payload took too long: {elapsed:.3f}s")


# ─────────────────────────────────────────────────────────────
# 4. Canvas, Palm Rejection & Eraser Geometry
# ─────────────────────────────────────────────────────────────
class TestCanvasPalmRejectionAndEraserGeometry(unittest.TestCase):
    """Challenge 4: Eraser Euclidean projection formula, palm contact dimension threshold, multi-touch passthrough."""

    @staticmethod
    def dist_to_segment(px: float, py: float, x1: float, y1: float, x2: float, y2: float) -> float:
        """Python oracle mirroring distToSegment in InkLayer.tsx."""
        dx = x2 - x1
        dy = y2 - y1
        l2 = dx * dx + dy * dy
        if l2 == 0:
            return math.hypot(px - x1, py - y1)
        t = ((px - x1) * dx + (py - y1) * dy) / l2
        t = max(0.0, min(1.0, t))
        projX = x1 + t * dx
        projY = y1 + t * dy
        return math.hypot(px - projX, py - projY)

    def test_eraser_dist_to_segment_edge_cases(self):
        """Adversarial stress-test of vector Euclidean projection in distToSegment."""
        # Case A: Zero-length segment (P1 == P2). Must NOT divide by zero.
        d_zero = self.dist_to_segment(0.3, 0.31, 0.3, 0.3, 0.3, 0.3)
        self.assertAlmostEqual(d_zero, 0.01, places=5)

        # Case B: Point exactly on diagonal segment
        d_on = self.dist_to_segment(0.5, 0.5, 0.1, 0.1, 0.9, 0.9)
        self.assertAlmostEqual(d_on, 0.0, places=5)

        # Case C: Perpendicular projection inside segment bounds
        d_perp = self.dist_to_segment(0.5, 0.51, 0.0, 0.5, 1.0, 0.5)
        self.assertAlmostEqual(d_perp, 0.01, places=5)

        # Case D: Clamping before start of segment (t < 0)
        # Segment from (0.2, 0.5) to (0.8, 0.5). Point at (0.0, 0.5)
        d_before = self.dist_to_segment(0.0, 0.5, 0.2, 0.5, 0.8, 0.5)
        self.assertAlmostEqual(d_before, 0.2, places=5)

        # Case E: Clamping after end of segment (t > 1)
        d_after = self.dist_to_segment(1.0, 0.5, 0.2, 0.5, 0.8, 0.5)
        self.assertAlmostEqual(d_after, 0.2, places=5)

        # Case F: Rapid diagonal sweep crossing stroke
        # Stroke segment has only 2 points: (0.1, 0.1) and (0.9, 0.9).
        # Eraser sweeps across (0.5, 0.5).
        # Sample vertex distance check would yield sqrt(0.4^2 + 0.4^2) = 0.565 > 0.015 (MISSED!).
        # Segment projection yields dist = 0.0 < 0.015 (HIT!).
        dist_crossing = self.dist_to_segment(0.5, 0.5, 0.1, 0.1, 0.9, 0.9)
        self.assertLess(dist_crossing, 0.015)

    def test_palm_rejection_logic_oracle(self):
        """Oracle for palm rejection (> 70px contact) and the stylus decay window (750ms).
        2026-11-27: the bound was 25px, which rejected ordinary fingertips (30-50px on iPad/Android),
        so finger writing drew nothing. A resting palm reports well above 70px."""
        PALM_TOUCH_BOUND_PX = 70
        STYLUS_DECAY_MS = 750

        def is_palm_rejected(
            pointer_type: str,
            width: float,
            height: float,
            touch_count: int,
            stylus_elapsed_ms: float,
            is_stylus_active: bool,
        ) -> bool:
            if pointer_type == "pen":
                return False
            if pointer_type == "touch":
                if touch_count >= 2:
                    return True  # Multi-touch gesture passthrough
                if width > PALM_TOUCH_BOUND_PX or height > PALM_TOUCH_BOUND_PX:
                    return True  # Palm contact dimension filter
                if is_stylus_active or stylus_elapsed_ms < STYLUS_DECAY_MS:
                    return True  # Stylus decay window
            return False

        # 1. Normal pen: never rejected
        self.assertFalse(is_palm_rejected("pen", 2, 2, 0, 9999, False))

        # 2. Touch within 750ms stylus window: rejected as palm
        self.assertTrue(is_palm_rejected("touch", 15, 15, 1, 300, True))

        # 3. Ordinary fingertips (incl. the 30-50px iPad/Android report) draw
        self.assertFalse(is_palm_rejected("touch", 15, 15, 1, 800, False))
        self.assertFalse(is_palm_rejected("touch", 32, 32, 1, 1000, False))
        self.assertFalse(is_palm_rejected("touch", 45, 48, 1, 1000, False))

        # 4. Large palm contact (> 70px) even after decay: rejected
        self.assertTrue(is_palm_rejected("touch", 71, 40, 1, 1000, False))
        self.assertTrue(is_palm_rejected("touch", 110, 110, 1, 1000, False))

        # 5. Exact boundary (70.0px): accepted
        self.assertFalse(is_palm_rejected("touch", 70.0, 70.0, 1, 1000, False))

        # 6. Multi-touch gesture (>= 2 touches): rejected for drawing, passed to viewport
        self.assertTrue(is_palm_rejected("touch", 15, 15, 2, 1000, False))
        self.assertTrue(is_palm_rejected("touch", 15, 15, 3, 1000, False))

    def test_frontend_source_contract_assertions(self):
        """Verify InkLayer.tsx implements the exact algorithmic formulas and thresholds."""
        reader_dir = os.path.join(ROOT, "apps", "student", "src", "screens", "reader")
        ink_layer_path = os.path.join(reader_dir, "InkLayer.tsx")
        self.assertTrue(os.path.exists(ink_layer_path), f"InkLayer.tsx not found at {ink_layer_path}")

        with open(ink_layer_path, "r", encoding="utf-8") as f:
            code = f.read()

        # Palm rejection constants — the palm-contact bound moved to the shared
        # penInput.ts module (rev. 2026-11: TextLayer/pen-selection round); InkLayer
        # keeps the stylus decay window and imports PALM_CONTACT_PX from there.
        self.assertIn("STYLUS_DECAY_MS = 750", code)
        self.assertIn("PALM_CONTACT_PX", code)
        pen_input_path = os.path.join(reader_dir, "penInput.ts")
        self.assertTrue(os.path.exists(pen_input_path), "penInput.ts not found")
        with open(pen_input_path, "r", encoding="utf-8") as f:
            pen_code = f.read()
        self.assertIn("PALM_CONTACT_PX = 70", pen_code)
        self.assertIn("touchPointers.current.size >= 2", code)

        # Vector line segment projection
        self.assertIn("function distToSegment", code)
        self.assertIn("if (l2 === 0) return Math.hypot(px - x1, py - y1)", code)
        self.assertIn("Math.max(0, Math.min(1, t))", code)

        # Multiply highlighter blend mode
        self.assertIn("'multiply'", code)
        self.assertIn("opacity: tool === 'highlighter' ? 0.35 : 1.0", code)

        # 120Hz Coalesced Events
        self.assertIn("getCoalescedEvents", code)

        # History limit
        self.assertIn("MAX_HISTORY = 50", code)

    def test_run_node_adversarial_suite(self):
        """Execute the Node.js frontend adversarial harness verifying runtime behavior."""
        import subprocess

        script_path = os.path.join(ROOT, "tests", "test_wave5_frontend_adversarial.ts")
        self.assertTrue(os.path.exists(script_path), f"Script not found: {script_path}")

        proc = subprocess.run(
            ["node", "--experimental-strip-types", script_path],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(proc.returncode, 0, f"Node script failed with code {proc.returncode}:\n{proc.stderr}")
        self.assertIn("=== WAVE 5 FRONTEND ADVERSARIAL HARNESS COMPLETE (ALL PASSED) ===", proc.stdout)


if __name__ == "__main__":
    unittest.main()

