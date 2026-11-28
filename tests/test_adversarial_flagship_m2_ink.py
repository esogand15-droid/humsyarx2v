# -*- coding: utf-8 -*-
"""Empirical Adversarial Challenge Suite: Flagship Milestone M2 (Digital Ink & Annotation Engine).

Role: challenger_flagship_m2_1 (critic, specialist)
Milestone: M2 - GoodNotes-Grade PDF Reader Annotation Engine (R3)

Adversarial Verification Dimensions:
1. Sticky notes persistence & data boundaries (StickyNoteModel coordinate clamping, page ranges, text/color caps, CRUD).
2. Digital Ink & Lasso Selection Engine (PNPOLY ray-casting point-in-polygon logic on concave/self-intersecting polygons,
   stroke coordinate normalized translation clamp [0, 1], and MAX_HISTORY = 50 stack invariants).
3. Tool Palette & Visual Filters (graphite pencil alpha, continuous slider range, clinical colors, dark-mode CSS inverter, focus mode).
"""
from __future__ import annotations

import copy
import math
import os
import sys
import time
import unittest
from unittest.mock import patch
import uuid
from typing import Any

# Ensure project root is first in sys.path
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

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
    MAX_PAGE,
    MAX_POINTS,
    MAX_STROKES,
    InkBody,
    MutationItem,
    PointModel,
    StickyNoteModel,
    Stroke,
    StrokeModel,
    SyncBatchRequest,
)
from backend.api.routers.web_student import current_student


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
# 1. Sticky Notes Schema & Boundary Validation
# ─────────────────────────────────────────────────────────────
class TestStickyNotesDataBoundaries(unittest.TestCase):
    """Adversarial stress-testing of StickyNoteModel and InkBody schemas."""

    def test_valid_sticky_note_defaults(self):
        note = StickyNoteModel()
        self.assertTrue(bool(note.note_id))
        self.assertEqual(note.page, 1)
        self.assertAlmostEqual(note.x, 0.85)
        self.assertAlmostEqual(note.y, 0.1)
        self.assertEqual(note.text, "")
        self.assertEqual(note.color, "yellow")
        self.assertFalse(note.collapsed)
        self.assertTrue(bool(note.created_at))

    def test_reject_page_boundaries(self):
        # Page must be in [1, MAX_PAGE=2000]
        invalid_pages = [0, -1, -500, 2001, 100000]
        for p in invalid_pages:
            with self.subTest(page=p):
                with self.assertRaises(ValidationError):
                    StickyNoteModel(page=p)

        # Valid boundaries
        self.assertEqual(StickyNoteModel(page=1).page, 1)
        self.assertEqual(StickyNoteModel(page=MAX_PAGE).page, MAX_PAGE)

    def test_reject_coordinate_boundaries(self):
        # x and y must be within [0.0, 1.0]
        invalid_coords = [-0.0001, -1.0, -99.0, 1.0001, 2.5, 100.0]
        for c in invalid_coords:
            with self.subTest(x=c):
                with self.assertRaises(ValidationError):
                    StickyNoteModel(x=c)
            with self.subTest(y=c):
                with self.assertRaises(ValidationError):
                    StickyNoteModel(y=c)

        # Valid coordinate extremes
        n_min = StickyNoteModel(x=0.0, y=0.0)
        self.assertEqual(n_min.x, 0.0)
        self.assertEqual(n_min.y, 0.0)
        n_max = StickyNoteModel(x=1.0, y=1.0)
        self.assertEqual(n_max.x, 1.0)
        self.assertEqual(n_max.y, 1.0)

    def test_reject_non_finite_floats(self):
        # NaN, Inf, -Inf
        for val in [float("nan"), float("inf"), float("-inf")]:
            with self.subTest(val=val):
                with self.assertRaises(ValidationError):
                    StickyNoteModel(x=val)
                with self.assertRaises(ValidationError):
                    StickyNoteModel(y=val)

    def test_text_and_color_length_caps(self):
        # Text <= 2000 characters
        valid_text = "آ" * 2000
        n_text = StickyNoteModel(text=valid_text)
        self.assertEqual(len(n_text.text), 2000)

        with self.assertRaises(ValidationError):
            StickyNoteModel(text="آ" * 2001)

        # Color <= 32 characters
        valid_color = "coral"
        n_color = StickyNoteModel(color=valid_color)
        self.assertEqual(n_color.color, "coral")

        with self.assertRaises(ValidationError):
            StickyNoteModel(color="c" * 33)

    def test_note_id_length_and_none_rejection(self):
        # note_id <= 64 chars
        with self.assertRaises(ValidationError):
            StickyNoteModel(note_id="x" * 65)

        with self.assertRaises(ValidationError):
            StickyNoteModel(note_id=None)

    def test_ink_body_with_sticky_notes(self):
        body = InkBody(
            strokes=[],
            notes=[
                StickyNoteModel(page=2, x=0.82, y=0.15, text="یادداشت حاشیه", color="cyan"),
                StickyNoteModel(page=2, x=0.05, y=0.5, text="نکته بالینی", color="green", collapsed=True),
            ]
        )
        self.assertEqual(len(body.notes), 2)
        self.assertEqual(body.notes[0].color, "cyan")
        self.assertTrue(body.notes[1].collapsed)

        # Rejection of invalid note inside InkBody
        with self.assertRaises(ValidationError):
            InkBody(notes=[{"page": -1, "x": 0.5, "y": 0.5}])


# ─────────────────────────────────────────────────────────────
# 2. Sticky Notes Backend CRUD & Batch Sync Mutations
# ─────────────────────────────────────────────────────────────
class TestStickyNotesBackendCrudAndSync(unittest.TestCase):
    """Integration test suite for Sticky Notes CRUD, PUT/GET page and batch mutations."""

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.mock_user = {
            "user_id": 88889999,
            "name": "Challenger M2 Tester",
            "username": "challenger_m2",
            "student_id": "402000001",
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

    def test_put_and_get_page_with_sticky_notes(self):
        """PUT and GET page preserving both vector strokes and margin sticky notes."""
        with patch.object(web_ink, "_guard", return_value={"file_id": "sample"}):
            # 1. PUT page with 1 stroke and 2 sticky notes
            payload = {
                "strokes": [
                    {
                        "stroke_id": "s-test-1",
                        "tool": "pencil",
                        "color": "#0F172A",
                        "width": 0.0035,
                        "opacity": 0.65,
                        "points": [{"x": 0.2, "y": 0.2, "pressure": 0.5}],
                    }
                ],
                "notes": [
                    {
                        "note_id": "note-1",
                        "page": 1,
                        "x": 0.85,
                        "y": 0.12,
                        "text": "نکته تست فیزیولوژی",
                        "color": "yellow",
                        "collapsed": False,
                    },
                    {
                        "note_id": "note-2",
                        "page": 1,
                        "x": 0.03,
                        "y": 0.45,
                        "text": "فرمول گلومرولی",
                        "color": "coral",
                        "collapsed": True,
                    },
                ],
            }
            resp = self.client.put("/api/web/ink/res/sample/1", json=payload)
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertTrue(data["ok"])
            self.assertEqual(data["count"], 1)
            self.assertEqual(data["notes_count"], 2)
            self.assertEqual(data["page_revision"], 1)

            # 2. GET page and verify both notes and strokes match
            get_resp = self.client.get("/api/web/ink/res/sample/1")
            self.assertEqual(get_resp.status_code, 200)
            get_data = get_resp.json()
            self.assertEqual(len(get_data["strokes"]), 1)
            self.assertEqual(len(get_data["notes"]), 2)
            self.assertEqual(get_data["notes"][0]["note_id"], "note-1")
            self.assertEqual(get_data["notes"][0]["color"], "yellow")
            self.assertFalse(get_data["notes"][0]["collapsed"])
            self.assertEqual(get_data["notes"][1]["note_id"], "note-2")
            self.assertTrue(get_data["notes"][1]["collapsed"])

    def test_sync_batch_upsert_note_and_delete_note(self):
        """Batch mutation synchronization with upsert_note and delete_note."""
        # 1. Upsert two notes via /api/web/ink/sync
        mutations = [
            {
                "mutation_id": "mut-note-add-1",
                "scope": "res",
                "file_id": "sample",
                "page": 5,
                "action": "upsert_note",
                "note": {
                    "note_id": "sync-note-101",
                    "page": 5,
                    "x": 0.82,
                    "y": 0.20,
                    "text": "تشخیص افتراقی شوک کاردیوژنیک",
                    "color": "cyan",
                },
                "timestamp": 1000,
            },
            {
                "mutation_id": "mut-note-add-2",
                "scope": "res",
                "file_id": "sample",
                "page": 5,
                "action": "upsert_note",
                "note": {
                    "note_id": "sync-note-102",
                    "page": 5,
                    "x": 0.05,
                    "y": 0.60,
                    "text": "دوزاژ دوپامین",
                    "color": "green",
                },
                "timestamp": 1001,
            },
        ]
        resp = self.client.post(
            "/api/web/ink/sync",
            json={"client_id": "ipad-stylus-1", "mutations": mutations},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["processed"], 2)
        self.assertEqual(len(data["successful_ids"]), 2)
        self.assertEqual(data["conflicts"], [])

        # Verify MongoDB state
        page_doc = self.mock_pages._data.get("88889999:res:sample:5")
        self.assertIsNotNone(page_doc)
        self.assertEqual(len(page_doc["notes"]), 2)
        self.assertEqual(page_doc["page_revision"], 2)

        # 2. Idempotency replay check: sending same mutation must succeed without duplicate insertion
        replay_resp = self.client.post(
            "/api/web/ink/sync",
            json={"client_id": "ipad-stylus-1", "mutations": [mutations[0]]},
        )
        self.assertEqual(replay_resp.status_code, 200)
        self.assertEqual(len(page_doc["notes"]), 2)

        # 3. Modify note-101 position and text (LWW)
        update_mut = {
            "mutation_id": "mut-note-update-1",
            "scope": "res",
            "file_id": "sample",
            "page": 5,
            "action": "upsert_note",
            "note": {
                "note_id": "sync-note-101",
                "page": 5,
                "x": 0.88,
                "y": 0.25,
                "text": "متن به‌روزشده با جزئیات جدید",
                "color": "coral",
            },
            "timestamp": 1050,
        }
        resp_update = self.client.post(
            "/api/web/ink/sync",
            json={"client_id": "ipad-stylus-1", "mutations": [update_mut]},
        )
        self.assertEqual(resp_update.status_code, 200)
        self.assertEqual(len(page_doc["notes"]), 2)
        updated_note = next(n for n in page_doc["notes"] if n["note_id"] == "sync-note-101")
        self.assertEqual(updated_note["text"], "متن به‌روزشده با جزئیات جدید")
        self.assertEqual(updated_note["color"], "coral")
        self.assertAlmostEqual(updated_note["x"], 0.88)

        # 4. Delete note-101 via delete_note
        delete_mut = {
            "mutation_id": "mut-note-del-1",
            "scope": "res",
            "file_id": "sample",
            "page": 5,
            "action": "delete_note",
            "note": {
                "note_id": "sync-note-101",
                "page": 5,
            },
            "timestamp": 1100,
        }
        resp_del = self.client.post(
            "/api/web/ink/sync",
            json={"client_id": "ipad-stylus-1", "mutations": [delete_mut]},
        )
        self.assertEqual(resp_del.status_code, 200)
        self.assertEqual(len(page_doc["notes"]), 1)
        self.assertEqual(page_doc["notes"][0]["note_id"], "sync-note-102")

    def test_sync_upsert_note_missing_note_payload_reports_conflict(self):
        """upsert_note action without a note payload reports missing_note conflict."""
        resp = self.client.post(
            "/api/web/ink/sync",
            json={
                "client_id": "dev-1",
                "mutations": [
                    {
                        "mutation_id": "mut-bad-1",
                        "scope": "res",
                        "file_id": "sample",
                        "page": 1,
                        "action": "upsert_note",
                        # note is None
                    }
                ],
            },
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data["conflicts"]), 1)
        self.assertEqual(data["conflicts"][0]["reason"], "missing_note")


# ─────────────────────────────────────────────────────────────
# 3. Digital Ink & Lasso Selection Engine
# ─────────────────────────────────────────────────────────────
def is_point_in_polygon_oracle(point: dict[str, float], polygon: list[dict[str, float]]) -> bool:
    """Exact Python mirror of the TypeScript PNPOLY ray-casting algorithm in InkLayer.tsx."""
    inside = False
    j = len(polygon) - 1
    for i in range(len(polygon)):
        xi, yi = polygon[i]["x"], polygon[i]["y"]
        xj, yj = polygon[j]["x"], polygon[j]["y"]
        intersect = ((yi > point["y"]) != (yj > point["y"])) and (
            point["x"] < (xj - xi) * (point["y"] - yi) / (yj - yi) + xi
        )
        if intersect:
            inside = not inside
        j = i
    return inside


class TestLassoPointInPolygonEngine(unittest.TestCase):
    """Adversarial stress-testing of ray-casting point-in-polygon logic on various geometries."""

    def test_convex_square_polygon(self):
        poly = [
            {"x": 0.2, "y": 0.2},
            {"x": 0.8, "y": 0.2},
            {"x": 0.8, "y": 0.8},
            {"x": 0.2, "y": 0.8},
        ]
        # Clearly inside
        self.assertTrue(is_point_in_polygon_oracle({"x": 0.5, "y": 0.5}, poly))
        self.assertTrue(is_point_in_polygon_oracle({"x": 0.25, "y": 0.25}, poly))
        self.assertTrue(is_point_in_polygon_oracle({"x": 0.75, "y": 0.75}, poly))

        # Clearly outside
        self.assertFalse(is_point_in_polygon_oracle({"x": 0.1, "y": 0.5}, poly))
        self.assertFalse(is_point_in_polygon_oracle({"x": 0.9, "y": 0.5}, poly))
        self.assertFalse(is_point_in_polygon_oracle({"x": 0.5, "y": 0.1}, poly))
        self.assertFalse(is_point_in_polygon_oracle({"x": 0.5, "y": 0.9}, poly))
        self.assertFalse(is_point_in_polygon_oracle({"x": 1.5, "y": 1.5}, poly))

    def test_concave_l_shaped_polygon(self):
        """L-shaped polygon with a reflex corner / cutout."""
        poly = [
            {"x": 0.0, "y": 0.0},
            {"x": 2.0, "y": 0.0},
            {"x": 2.0, "y": 1.0},
            {"x": 1.0, "y": 1.0},
            {"x": 1.0, "y": 2.0},
            {"x": 0.0, "y": 2.0},
        ]
        # In bottom foot
        self.assertTrue(is_point_in_polygon_oracle({"x": 1.5, "y": 0.5}, poly))
        # In vertical arm
        self.assertTrue(is_point_in_polygon_oracle({"x": 0.5, "y": 1.5}, poly))
        # In central corner
        self.assertTrue(is_point_in_polygon_oracle({"x": 0.5, "y": 0.5}, poly))
        # In the reflex cutout (1.0 <= x <= 2.0, 1.0 <= y <= 2.0) -> must be False
        self.assertFalse(is_point_in_polygon_oracle({"x": 1.5, "y": 1.5}, poly))
        self.assertFalse(is_point_in_polygon_oracle({"x": 1.8, "y": 1.8}, poly))

    def test_concave_horseshoe_u_shape_polygon(self):
        """U-shaped horseshoe with a deep cavity/gulf between arms."""
        poly = [
            {"x": 0.0, "y": 0.0},
            {"x": 3.0, "y": 0.0},
            {"x": 3.0, "y": 3.0},
            {"x": 2.0, "y": 3.0},
            {"x": 2.0, "y": 1.0},
            {"x": 1.0, "y": 1.0},
            {"x": 1.0, "y": 3.0},
            {"x": 0.0, "y": 3.0},
        ]
        # Left arm
        self.assertTrue(is_point_in_polygon_oracle({"x": 0.5, "y": 2.0}, poly))
        # Right arm
        self.assertTrue(is_point_in_polygon_oracle({"x": 2.5, "y": 2.0}, poly))
        # Base
        self.assertTrue(is_point_in_polygon_oracle({"x": 1.5, "y": 0.5}, poly))
        # Gulf / cavity between arms -> must be False
        self.assertFalse(is_point_in_polygon_oracle({"x": 1.5, "y": 2.0}, poly))
        self.assertFalse(is_point_in_polygon_oracle({"x": 1.5, "y": 2.8}, poly))
        # Far outside
        self.assertFalse(is_point_in_polygon_oracle({"x": 4.0, "y": 1.5}, poly))

    def test_concave_star_polygon(self):
        """10-vertex star with alternating outer tips and inner reflex notches."""
        # Generates a regular 5-point star
        center = (0.5, 0.5)
        outer_r = 0.4
        inner_r = 0.15
        star_poly = []
        for i in range(10):
            r = outer_r if i % 2 == 0 else inner_r
            angle = i * (math.pi / 5) - (math.pi / 2)
            star_poly.append({
                "x": round(center[0] + r * math.cos(angle), 5),
                "y": round(center[1] + r * math.sin(angle), 5),
            })

        # Center of star
        self.assertTrue(is_point_in_polygon_oracle({"x": 0.5, "y": 0.5}, star_poly))
        # Top tip
        self.assertTrue(is_point_in_polygon_oracle({"x": 0.5, "y": 0.15}, star_poly))
        # In notch bay outside the star
        self.assertFalse(is_point_in_polygon_oracle({"x": 0.5, "y": 0.95}, star_poly))
        self.assertFalse(is_point_in_polygon_oracle({"x": 0.05, "y": 0.5}, star_poly))

    def test_self_intersecting_bowtie_polygon(self):
        """Figure-8 / bowtie polygon with an intersection node at (1, 1)."""
        poly = [
            {"x": 0.0, "y": 0.0},
            {"x": 2.0, "y": 2.0},
            {"x": 0.0, "y": 2.0},
            {"x": 2.0, "y": 0.0},
        ]
        # In the top enclosed lobe
        self.assertTrue(is_point_in_polygon_oracle({"x": 1.0, "y": 1.8}, poly))
        # In the bottom enclosed lobe
        self.assertTrue(is_point_in_polygon_oracle({"x": 1.0, "y": 0.2}, poly))
        # Outside in the side wedges
        self.assertFalse(is_point_in_polygon_oracle({"x": 0.2, "y": 1.0}, poly))
        self.assertFalse(is_point_in_polygon_oracle({"x": 1.8, "y": 1.0}, poly))

    def test_lasso_stroke_selection_inclusion_rule(self):
        """Simulate InkLayer.tsx lasso selection condition (>= 45% enclosed points or 1-point stroke)."""
        lasso_poly = [
            {"x": 0.1, "y": 0.1},
            {"x": 0.5, "y": 0.1},
            {"x": 0.5, "y": 0.5},
            {"x": 0.1, "y": 0.5},
        ]

        def is_stroke_selected(pts: list[dict[str, float]]) -> bool:
            if not pts:
                return False
            inside_cnt = sum(1 for p in pts if is_point_in_polygon_oracle(p, lasso_poly))
            return (inside_cnt >= math.ceil(len(pts) * 0.45)) or (len(pts) == 1 and inside_cnt == 1)

        # Stroke completely inside
        s_inside = [{"x": 0.2, "y": 0.2}, {"x": 0.3, "y": 0.3}, {"x": 0.4, "y": 0.4}]
        self.assertTrue(is_stroke_selected(s_inside))

        # Stroke with 2 of 4 points inside (50% >= 45%)
        s_half = [{"x": 0.2, "y": 0.2}, {"x": 0.3, "y": 0.3}, {"x": 0.8, "y": 0.8}, {"x": 0.9, "y": 0.9}]
        self.assertTrue(is_stroke_selected(s_half))

        # Stroke with 1 of 5 points inside (20% < 45%)
        s_minority = [
            {"x": 0.2, "y": 0.2},
            {"x": 0.7, "y": 0.7},
            {"x": 0.8, "y": 0.8},
            {"x": 0.85, "y": 0.85},
            {"x": 0.9, "y": 0.9},
        ]
        self.assertFalse(is_stroke_selected(s_minority))

        # Single-point stroke inside
        self.assertTrue(is_stroke_selected([{"x": 0.3, "y": 0.3}]))
        # Single-point stroke outside
        self.assertFalse(is_stroke_selected([{"x": 0.8, "y": 0.8}]))


# ─────────────────────────────────────────────────────────────
# 4. Stroke Coordinate Normalization & Undo/Redo Bounds
# ─────────────────────────────────────────────────────────────
class TestStrokeCoordinateNormalizationAndHistory(unittest.TestCase):
    """Stress-test coordinate clamping and MAX_HISTORY = 50 bounds."""

    def test_drag_relocation_coordinate_clamping(self):
        """Simulate stroke coordinate translation: p.x = min(1.0, max(0.0, p.x + dx))."""
        pts = [
            {"x": 0.1, "y": 0.2},
            {"x": 0.5, "y": 0.5},
            {"x": 0.9, "y": 0.8},
        ]

        def translate(points: list[dict[str, float]], dx: float, dy: float) -> list[dict[str, float]]:
            return [
                {
                    "x": min(1.0, max(0.0, p["x"] + dx)),
                    "y": min(1.0, max(0.0, p["y"] + dy)),
                }
                for p in points
            ]

        # Massive positive drag -> all points clamp to 1.0
        pos_drag = translate(pts, 5.0, 10.0)
        for p in pos_drag:
            self.assertEqual(p["x"], 1.0)
            self.assertEqual(p["y"], 1.0)

        # Massive negative drag -> all points clamp to 0.0
        neg_drag = translate(pts, -5.0, -10.0)
        for p in neg_drag:
            self.assertEqual(p["x"], 0.0)
            self.assertEqual(p["y"], 0.0)

        # Sub-pixel drag
        small_drag = translate(pts, 0.001, -0.002)
        self.assertAlmostEqual(small_drag[0]["x"], 0.101)
        self.assertAlmostEqual(small_drag[0]["y"], 0.198)

    def test_undo_redo_history_bounds_max_50(self):
        """Simulate InkLayer.tsx history management with MAX_HISTORY = 50."""
        MAX_HISTORY = 50
        past: list[list[str]] = []
        future: list[list[str]] = []
        current: list[str] = []

        def commit(next_state: list[str]):
            nonlocal current, past, future
            past.append(list(current))
            if len(past) > MAX_HISTORY:
                past.pop(0)  # shift oldest
            future.clear()
            current = list(next_state)

        def undo():
            nonlocal current, past, future
            if not past:
                return
            prev = past.pop()
            future.append(list(current))
            current = prev

        def redo():
            nonlocal current, past, future
            if not future:
                return
            nxt = future.pop()
            past.append(list(current))
            current = nxt

        # 1. Commit 100 sequential stroke actions
        for i in range(1, 101):
            commit([f"stroke-{j}" for j in range(i)])

        # past stack must be bounded at exactly 50
        self.assertEqual(len(past), MAX_HISTORY)
        self.assertEqual(len(future), 0)
        self.assertEqual(len(current), 100)

        # Oldest state retained in past should be state 50
        self.assertEqual(len(past[0]), 50)

        # 2. Perform 50 undos
        for _ in range(50):
            undo()

        self.assertEqual(len(past), 0)
        self.assertEqual(len(future), 50)
        self.assertEqual(len(current), 50)

        # 51st undo does nothing
        undo()
        self.assertEqual(len(current), 50)

        # 3. Perform 20 redos
        for _ in range(20):
            redo()

        self.assertEqual(len(past), 20)
        self.assertEqual(len(future), 30)
        self.assertEqual(len(current), 70)

        # 4. Branching action clears redo stack
        commit(["branch-stroke"])
        self.assertEqual(len(future), 0)
        self.assertEqual(len(past), 21)


# ─────────────────────────────────────────────────────────────
# 5. UI Tokens, Styling & Exact Contract Invariants
# ─────────────────────────────────────────────────────────────
class TestVisualTokensAndCssContracts(unittest.TestCase):
    """Adversarial static inspection of CSS rules and TypeScript component contracts."""

    def test_dark_mode_contrast_inverter_css_rule(self):
        """Assert exact contract string: filter: invert(0.92) hue-rotate(180deg) contrast(1.05) !important;"""
        ui_css_path = os.path.join(ROOT, "apps", "student", "src", "design", "ui.css")
        self.assertTrue(os.path.isfile(ui_css_path), f"File not found: {ui_css_path}")
        with open(ui_css_path, "r", encoding="utf-8") as f:
            content = f.read()
        content += open(os.path.join(ROOT, "apps", "student", "src", "screens", "reader", "reader-shell.css"), encoding="utf-8").read()

        expected_rule = "filter: invert(0.92) hue-rotate(180deg) contrast(1.05) !important;"
        self.assertIn(expected_rule, content, "Smart dark-mode contrast inverter rule missing in ui.css")
        self.assertIn(".reader__page--inverted", content, ".reader__page--inverted selector missing in ui.css")

    def test_continuous_stroke_width_slider_contracts(self):
        """Verify stroke width slider ranges in InkToolbar.tsx."""
        toolbar_path = os.path.join(ROOT, "apps", "student", "src", "screens", "reader", "InkToolbar.tsx")
        self.assertTrue(os.path.isfile(toolbar_path))
        with open(toolbar_path, "r", encoding="utf-8") as f:
            content = f.read()

        self.assertIn('min="0.001"', content)
        self.assertIn('max="0.015"', content)
        self.assertIn('step="0.0005"', content)
        self.assertIn('ink-width-preview-dot', content)

    def test_ink_palette_clinical_colors(self):
        """Verify clinical and neon color swatches in InkToolbar.tsx."""
        toolbar_path = os.path.join(ROOT, "apps", "student", "src", "screens", "reader", "InkToolbar.tsx")
        with open(toolbar_path, "r", encoding="utf-8") as f:
            content = f.read()

        required_colors = [
            "#0F172A",  # Carbon Black
            "#2563EB",  # Royal Blue
            "#DC2626",  # Clinical Red
            "#059669",  # Emerald Green
            "#00F2FE",  # Neon Turquoise
            "#FEF08A",  # Neon Yellow
            "#34D399",  # Clinical Green
            "#FB7185",  # Coral
            "#C084FC",  # Pastel Lilac
        ]
        for color in required_colors:
            self.assertIn(color, content, f"Required swatch {color} not found in InkToolbar.tsx")

    def test_ink_layer_algorithmic_contracts(self):
        """Verify exact contract tokens in InkLayer.tsx."""
        layer_path = os.path.join(ROOT, "apps", "student", "src", "screens", "reader", "InkLayer.tsx")
        self.assertTrue(os.path.isfile(layer_path))
        with open(layer_path, "r", encoding="utf-8") as f:
            content = f.read()

        # Contract strings
        self.assertIn("opacity: tool === 'highlighter' ? 0.35 : 1.0", content)
        self.assertIn("MAX_HISTORY = 50", content)
        self.assertIn("STYLUS_DECAY_MS = 750", content)
        self.assertIn("isPointInPolygon", content)
        self.assertIn("pencil", content)
        self.assertIn("0.65", content)  # Pencil opacity

    def test_sticky_note_colors_and_margin_snapping(self):
        """Verify sticky note colors and snapping thresholds in StickyNoteOverlay.tsx."""
        overlay_path = os.path.join(ROOT, "apps", "student", "src", "screens", "reader", "StickyNoteOverlay.tsx")
        self.assertTrue(os.path.isfile(overlay_path))
        with open(overlay_path, "r", encoding="utf-8") as f:
            content = f.read()

        self.assertIn("yellow", content)
        self.assertIn("cyan", content)
        self.assertIn("green", content)
        self.assertIn("coral", content)
        # snapping is note-size-aware now: clamp to the page minus the note's real
        # box (was fixed 0.12 / 0.78 margins that ignored note dimensions)
        self.assertIn("(width - noteW) / Math.max(1, width) - 0.02", content)
        self.assertIn("(height - noteH) / Math.max(1, height) - 0.02", content)

    def test_protected_reader_focus_mode_and_shortcuts(self):
        """Verify keyboard shortcuts and focus mode classes in ProtectedReaderView.tsx."""
        reader_path = os.path.join(ROOT, "apps", "student", "src", "screens", "reader", "ProtectedReaderView.tsx")
        self.assertTrue(os.path.isfile(reader_path))
        with open(reader_path, "r", encoding="utf-8") as f:
            content = f.read()

        self.assertIn("reader-focus-mode", content)
        self.assertIn("focus-counter-badge", content)
        self.assertIn("focus-restore-trigger", content)
        self.assertIn("reader__page--inverted", content)
        self.assertIn("'f'", content)
        self.assertIn("'t'", content)
        self.assertIn("onToggleSplitWorkspace", content)


if __name__ == "__main__":
    unittest.main()
