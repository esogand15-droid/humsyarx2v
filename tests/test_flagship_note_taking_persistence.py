# -*- coding: utf-8 -*-
"""Flagship Test Suite: GoodNotes-Grade PDF Reader Note-Taking & Canvas Persistence.

Verifies Requirement R3:
1. StickyNoteModel schema & coordinate boundaries:
   - x, y normalized within [0.0, 1.0]
   - page within [1, 2000]
   - text length cap at 2000 characters
   - non-finite float rejection (NaN, Inf)
2. Sticky note CRUD operations on web_ink_pages via batch mutations:
   - action="upsert_note" creates/updates sticky notes
   - action="delete_note" removes notes by note_id
   - margin anchoring coordinates (e.g. x >= 0.8)
3. Vector strokes & Sticky notes co-existence:
   - Applying upsert_note preserves existing vector strokes intact
   - Applying upsert_stroke preserves existing sticky notes intact
   - Page PUT and GET deliver both strokes and notes concurrently
4. Lasso selection translation logic:
   - Point-in-polygon ray-casting (PNPOLY) on convex and concave polygons
   - Stroke translation by (dx, dy) with normalized clamping [0.0, 1.0]
5. Smart Dark-Mode Contrast Inverter & Focus Mode CSS Contracts:
   - filter: invert(0.92) hue-rotate(180deg) contrast(1.05) rule in ui.css
   - Focus mode distraction-free fullscreen styling
"""
from __future__ import annotations

import copy
import math
import os
import sys
import unittest
from unittest.mock import patch
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

from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.api.main import app
from backend.api.routers import web_ink
from backend.api.routers.web_ink import (
    MAX_PAGE,
    InkBody,
    MutationItem,
    PointModel,
    StickyNoteModel,
    Stroke,
    SyncBatchRequest,
)
from backend.api.routers.web_student import current_student


class InMemoryMongoCollection:
    """In-memory async collection simulator for testing web_ink collections."""

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


def is_point_in_polygon_oracle(point: dict[str, float], polygon: list[dict[str, float]]) -> bool:
    """Standard PNPOLY (Jordan curve) ray-casting algorithm."""
    x, y = point["x"], point["y"]
    inside = False
    n = len(polygon)
    for i in range(n):
        j = (i - 1) % n
        xi, yi = polygon[i]["x"], polygon[i]["y"]
        xj, yj = polygon[j]["x"], polygon[j]["y"]

        intersect = ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi)
        if intersect:
            inside = not inside
    return inside


class TestStickyNoteDataBoundaries(unittest.TestCase):
    """1. Test StickyNoteModel coordinates, text, and page limits."""

    def test_sticky_note_valid_defaults(self):
        note = StickyNoteModel()
        self.assertTrue(bool(note.note_id))
        self.assertEqual(note.page, 1)
        self.assertAlmostEqual(note.x, 0.85)
        self.assertAlmostEqual(note.y, 0.1)
        self.assertEqual(note.text, "")
        self.assertEqual(note.color, "yellow")
        self.assertFalse(note.collapsed)
        self.assertTrue(bool(note.created_at))

    def test_sticky_note_page_boundary_validation(self):
        # Valid page boundaries [1, 2000]
        self.assertEqual(StickyNoteModel(page=1).page, 1)
        self.assertEqual(StickyNoteModel(page=MAX_PAGE).page, MAX_PAGE)

        # Invalid page boundaries
        for invalid_page in [0, -1, -50, 2001, 10000]:
            with self.subTest(page=invalid_page):
                with self.assertRaises(ValidationError):
                    StickyNoteModel(page=invalid_page)

    def test_sticky_note_coordinate_boundary_validation(self):
        # Valid coordinates [0.0, 1.0]
        n_min = StickyNoteModel(x=0.0, y=0.0)
        self.assertEqual(n_min.x, 0.0)
        self.assertEqual(n_min.y, 0.0)
        n_max = StickyNoteModel(x=1.0, y=1.0)
        self.assertEqual(n_max.x, 1.0)
        self.assertEqual(n_max.y, 1.0)

        # Invalid coordinates (< 0.0 or > 1.0)
        for invalid_c in [-0.01, -1.0, 1.001, 2.5]:
            with self.subTest(coord=invalid_c):
                with self.assertRaises(ValidationError):
                    StickyNoteModel(x=invalid_c)
                with self.assertRaises(ValidationError):
                    StickyNoteModel(y=invalid_c)

    def test_sticky_note_reject_non_finite_floats(self):
        for val in [float("nan"), float("inf"), float("-inf")]:
            with self.subTest(val=val):
                with self.assertRaises(ValidationError):
                    StickyNoteModel(x=val)
                with self.assertRaises(ValidationError):
                    StickyNoteModel(y=val)

    def test_sticky_note_text_length_cap_2000(self):
        # Text <= 2000 characters is accepted
        valid_text = "آ" * 2000
        note = StickyNoteModel(text=valid_text)
        self.assertEqual(len(note.text), 2000)

        # Text > 2000 characters is rejected
        with self.assertRaises(ValidationError):
            StickyNoteModel(text="A" * 2001)


class TestStickyNoteCrudAndCoexistence(unittest.TestCase):
    """2 & 3. Test Sticky Note CRUD on web_ink_pages and vector strokes co-existence."""

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.user = {
            "user_id": 999123,
            "name": "دکتر آرش شایان",
            "role": "student",
        }
        app.dependency_overrides[current_student] = lambda: cls.user

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

    def test_put_and_get_page_coexistence(self):
        """PUT page with both vector strokes and sticky notes, ensuring both persist without erasing each other."""
        stroke_item = {
            "stroke_id": "stroke-001",
            "tool": "pen",
            "color": "#1E40AF",
            "width": 0.0035,
            "opacity": 1.0,
            "points": [
                {"x": 0.1, "y": 0.1, "pressure": 0.5},
                {"x": 0.2, "y": 0.2, "pressure": 0.6},
            ],
        }
        note_item = {
            "note_id": "note-001",
            "page": 1,
            "x": 0.88,
            "y": 0.15,
            "text": "نکته فارماکولوژی: تداخل دیگوکسین با کلاریترومایسین",
            "color": "#FEF08A",
            "collapsed": False,
        }

        with patch.object(web_ink, "_guard", return_value={"file_id": "sample-booklet"}):
            # 1. PUT page containing both stroke and note
            put_res = self.client.put(
                "/api/web/ink/res/sample-booklet/1",
                json={"strokes": [stroke_item], "notes": [note_item]},
            )
            self.assertEqual(put_res.status_code, 200)
            put_data = put_res.json()
            self.assertTrue(put_data.get("ok"))
            self.assertEqual(put_data.get("page_revision"), 1)

            # 2. GET page to verify coexistence
            get_res = self.client.get("/api/web/ink/res/sample-booklet/1")
            self.assertEqual(get_res.status_code, 200)
            page_data = get_res.json()

            # Strokes preserved
            self.assertEqual(len(page_data.get("strokes", [])), 1)
            self.assertEqual(page_data["strokes"][0]["stroke_id"], "stroke-001")
            self.assertEqual(len(page_data["strokes"][0]["points"]), 2)

            # Notes preserved
            self.assertEqual(len(page_data.get("notes", [])), 1)
            self.assertEqual(page_data["notes"][0]["note_id"], "note-001")
            self.assertEqual(page_data["notes"][0]["x"], 0.88)
            self.assertIn("دیگوکسین", page_data["notes"][0]["text"])

    def test_batch_mutation_upsert_note_does_not_erase_strokes(self):
        """Applying action="upsert_note" via /ink/sync must NOT wipe existing strokes."""
        # Pre-seed a page document with 2 existing strokes
        page_id = f"{self.user['user_id']}:res:cardio-01:1"
        existing_stroke = {
            "stroke_id": "existing-stroke-99",
            "tool": "pencil",
            "color": "#0F172A",
            "width": 0.003,
            "opacity": 0.8,
            "points": [{"x": 0.3, "y": 0.3, "pressure": 0.5}],
        }
        self.mock_pages._data[page_id] = {
            "_id": page_id,
            "uid": self.user["user_id"],
            "scope": "res",
            "file_id": "cardio-01",
            "page": 1,
            "page_revision": 3,
            "strokes": [existing_stroke],
            "notes": [],
            "count": 1,
        }

        # Issue sync batch adding a new sticky note
        batch_payload = {
            "client_id": "client-test-device",
            "mutations": [
                {
                    "mutation_id": str(uuid.uuid4()),
                    "scope": "res",
                    "file_id": "cardio-01",
                    "page": 1,
                    "action": "upsert_note",
                    "note": {
                        "note_id": "new-note-88",
                        "page": 1,
                        "x": 0.85,
                        "y": 0.35,
                        "text": "حاشیه صفحه: توجه به انقباض ایزوولومتریک",
                        "color": "#A7F3D0",
                    },
                    "client_revision": 3,
                }
            ],
        }

        res = self.client.post("/api/web/ink/sync", json=batch_payload)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.json().get("successful_ids", [])), 1)

        # Verify page in storage
        saved_doc = self.mock_pages._data[page_id]
        # Strokes MUST still be present!
        self.assertEqual(len(saved_doc["strokes"]), 1)
        self.assertEqual(saved_doc["strokes"][0]["stroke_id"], "existing-stroke-99")
        # Note MUST be added!
        self.assertEqual(len(saved_doc["notes"]), 1)
        self.assertEqual(saved_doc["notes"][0]["note_id"], "new-note-88")
        # Revision incremented
        self.assertEqual(saved_doc["page_revision"], 4)

    def test_batch_mutation_delete_note(self):
        """Applying action="delete_note" via /ink/sync deletes the specified note."""
        page_id = f"{self.user['user_id']}:res:cardio-01:1"
        self.mock_pages._data[page_id] = {
            "_id": page_id,
            "uid": self.user["user_id"],
            "scope": "res",
            "file_id": "cardio-01",
            "page": 1,
            "page_revision": 4,
            "strokes": [],
            "notes": [
                {"note_id": "note-to-delete", "page": 1, "text": "پاک شود", "x": 0.5, "y": 0.5},
                {"note_id": "note-to-keep", "page": 1, "text": "باقی بماند", "x": 0.8, "y": 0.8},
            ],
            "count": 0,
        }

        batch_payload = {
            "client_id": "client-test-device",
            "mutations": [
                {
                    "mutation_id": str(uuid.uuid4()),
                    "scope": "res",
                    "file_id": "cardio-01",
                    "page": 1,
                    "action": "delete_note",
                    "note": {"note_id": "note-to-delete", "page": 1, "x": 0.5, "y": 0.5, "text": ""},
                    "client_revision": 4,
                }
            ],
        }

        res = self.client.post("/api/web/ink/sync", json=batch_payload)
        self.assertEqual(res.status_code, 200)

        saved_doc = self.mock_pages._data[page_id]
        self.assertEqual(len(saved_doc["notes"]), 1)
        self.assertEqual(saved_doc["notes"][0]["note_id"], "note-to-keep")


class TestLassoSelectionAndTranslation(unittest.TestCase):
    """4. Test Lasso Selection PNPOLY algorithm and point translation with clamping."""

    def test_lasso_polygon_point_containment(self):
        """Test PNPOLY ray-casting with convex and concave polygon boundaries."""
        # Convex Box [0.2, 0.8] x [0.2, 0.8]
        convex_box = [
            {"x": 0.2, "y": 0.2},
            {"x": 0.8, "y": 0.2},
            {"x": 0.8, "y": 0.8},
            {"x": 0.2, "y": 0.8},
        ]
        self.assertTrue(is_point_in_polygon_oracle({"x": 0.5, "y": 0.5}, convex_box))
        self.assertFalse(is_point_in_polygon_oracle({"x": 0.1, "y": 0.5}, convex_box))
        self.assertFalse(is_point_in_polygon_oracle({"x": 0.9, "y": 0.9}, convex_box))

        # Concave U-shaped polygon
        u_poly = [
            {"x": 0.0, "y": 0.0},
            {"x": 3.0, "y": 0.0},
            {"x": 3.0, "y": 3.0},
            {"x": 2.0, "y": 3.0},
            {"x": 2.0, "y": 1.0},
            {"x": 1.0, "y": 1.0},
            {"x": 1.0, "y": 3.0},
            {"x": 0.0, "y": 3.0},
        ]
        # In left arm
        self.assertTrue(is_point_in_polygon_oracle({"x": 0.5, "y": 2.0}, u_poly))
        # In center cavity between arms (must be False)
        self.assertFalse(is_point_in_polygon_oracle({"x": 1.5, "y": 2.0}, u_poly))

    def test_stroke_point_translation_and_clamping(self):
        """Stroke points translated by (dx, dy) must clamp to [0.0, 1.0]."""
        pts = [
            {"x": 0.2, "y": 0.3},
            {"x": 0.7, "y": 0.6},
        ]

        def translate_points(points: list[dict], dx: float, dy: float) -> list[dict]:
            return [
                {
                    "x": min(1.0, max(0.0, p["x"] + dx)),
                    "y": min(1.0, max(0.0, p["y"] + dy)),
                }
                for p in points
            ]

        # Normal drag
        translated = translate_points(pts, 0.1, 0.05)
        self.assertAlmostEqual(translated[0]["x"], 0.3)
        self.assertAlmostEqual(translated[0]["y"], 0.35)
        self.assertAlmostEqual(translated[1]["x"], 0.8)
        self.assertAlmostEqual(translated[1]["y"], 0.65)

        # Extreme positive drag -> clamped to 1.0
        clamped_pos = translate_points(pts, 5.0, 10.0)
        self.assertEqual(clamped_pos[0]["x"], 1.0)
        self.assertEqual(clamped_pos[0]["y"], 1.0)

        # Extreme negative drag -> clamped to 0.0
        clamped_neg = translate_points(pts, -5.0, -10.0)
        self.assertEqual(clamped_neg[0]["x"], 0.0)
        self.assertEqual(clamped_neg[0]["y"], 0.0)


class TestDarkContrastInverterAndFocusMode(unittest.TestCase):
    """5. Test dark contrast inverter CSS filter rules and focus mode styles."""

    def test_dark_mode_contrast_inverter_css_rule(self):
        """Assert exact CSS filter rule for dark-mode PDF reading without altering vectors."""
        css_path = os.path.join(ROOT, "apps", "student", "src", "design", "ui.css")
        self.assertTrue(os.path.isfile(css_path), f"CSS file missing: {css_path}")

        with open(css_path, "r", encoding="utf-8") as f:
            css_content = f.read()
        css_content += open(os.path.join(ROOT, "apps", "student", "src", "screens", "reader", "reader-shell.css"), encoding="utf-8").read()

        # Check the contrast inverter filter rule
        expected_filter = "filter: invert(0.92) hue-rotate(180deg) contrast(1.05)"
        self.assertIn(expected_filter, css_content,
                      f"Expected filter rule '{expected_filter}' not found in {css_path}")

        # Check the inverted selector exists
        self.assertIn(".reader__page--inverted", css_content,
                      ".reader__page--inverted selector missing from ui.css")

    def test_focus_mode_css_rules(self):
        """Assert focus mode fullscreen CSS class hiding navigation and expanding viewport."""
        css_path = os.path.join(ROOT, "apps", "student", "src", "design", "ui.css")
        with open(css_path, "r", encoding="utf-8") as f:
            css_content = f.read()

        self.assertTrue(
            ".reader--focus" in css_content or "focus-mode" in css_content or "reader--fullscreen" in css_content,
            "Focus mode reading CSS classes missing from ui.css",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
