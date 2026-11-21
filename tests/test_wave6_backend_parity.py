# -*- coding: utf-8 -*-
"""Comprehensive Test Suite for Wave 6 Backend Feature Parity.

Verification Areas:
1. Question Bank Flagging & PDF generation endpoints:
   - POST /api/web/exam/flag/{question_id}
   - GET /api/web/exam/flagged
   - GET /api/web/exam/{session_id}/pdf & GET /api/web/exam/mock/{session_id}/pdf
   - POST /api/web/exam/setup, GET /api/web/exam/{session_id}, POST /api/web/exam/{session_id}/finish
2. HooshYar AI SSE Streaming & Vision Diagnosis:
   - POST /api/ai/ask (SSE mode with Accept: text/event-stream) & POST /api/ai/ask/stream
   - Premature client disconnection and inflight lock release
   - POST /api/ai/vision with valid image, invalid image type 422, oversize 422
3. Persian Jalali Study Task Management:
   - POST /api/schedule/items & POST /api/web/schedule/items (Jalali boundary validation)
   - GET /api/schedule/items & GET /api/web/schedule/items (date range filtering)
   - PATCH /api/schedule/items/{task_id}/toggle & PATCH /api/web/schedule/items/{task_id}/toggle
4. Academic Weighted GPA:
   - calculate_weighted_transcript: weighted GPA, passed credits, failed credits
   - GET /api/grades/summary & GET /api/web/grades/summary
"""
from __future__ import annotations

import asyncio
import copy
import hashlib
import io
import json
import os
import sys
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
import uuid

from bson import ObjectId

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017/medicalbot")
os.environ.setdefault("ADMIN_ID", "1")
os.environ.setdefault("TELEGRAM_TOKEN", "123:TEST")

from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.api.auth import get_current_user, require_feature
from backend.api.routers import web_exam
from backend.api.routers.web_student import current_student
from backend.services.grade_utils import calculate_weighted_transcript, normalize_grade
from backend.api.routers.schedule import _validate_jalali_date


class MockAsyncCursor:
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

    async def to_list(self, length=None):
        if length is not None:
            return [copy.deepcopy(x) for x in self._items[:length]]
        return [copy.deepcopy(x) for x in self._items]

    def __aiter__(self):
        self._iter = iter(self._items)
        return self

    async def __anext__(self):
        try:
            return copy.deepcopy(next(self._iter))
        except StopIteration:
            raise StopAsyncIteration


class InMemoryMongoCollection:
    """In-memory async MongoDB collection simulator for reliable hermetic tests."""

    def __init__(self):
        self._data: dict[str, dict] = {}

    def _matches(self, doc: dict, query: dict) -> bool:
        for k, v in query.items():
            doc_val = doc.get(k)
            if isinstance(v, dict):
                if "$gte" in v and not (doc_val >= v["$gte"]):
                    return False
                if "$lte" in v and not (doc_val <= v["$lte"]):
                    return False
                if "$in" in v and doc_val not in v["$in"]:
                    return False
            else:
                if str(doc_val) != str(v):
                    return False
        return True

    async def find_one(self, query: dict, projection: dict | None = None) -> dict | None:
        for doc in self._data.values():
            if self._matches(doc, query):
                res = copy.deepcopy(doc)
                if projection:
                    return {k: res.get(k) for k in projection if k in res}
                return res
        return None

    def find(self, query: dict | None = None, projection: dict | None = None):
        results = []
        for doc in self._data.values():
            if not query or self._matches(doc, query):
                res = copy.deepcopy(doc)
                if projection:
                    res = {k: res.get(k) for k in projection if k in res}
                results.append(res)
        return MockAsyncCursor(results)

    async def insert_one(self, doc: dict):
        key = str(doc.get("_id") or ObjectId())
        stored = copy.deepcopy(doc)
        stored["_id"] = ObjectId(key) if ObjectId.is_valid(key) else key
        self._data[key] = stored
        res = MagicMock()
        res.inserted_id = stored["_id"]
        return res

    async def delete_one(self, query: dict):
        target_key = None
        for k, doc in self._data.items():
            if self._matches(doc, query):
                target_key = k
                break
        if target_key:
            del self._data[target_key]
            res = MagicMock()
            res.deleted_count = 1
            return res
        res = MagicMock()
        res.deleted_count = 0
        return res

    async def update_one(self, query: dict, update: dict):
        target_key = None
        for k, doc in self._data.items():
            if self._matches(doc, query):
                target_key = k
                break
        if target_key:
            target = self._data[target_key]
            if "$set" in update:
                for k, v in update["$set"].items():
                    target[k] = copy.deepcopy(v)
            res = MagicMock()
            res.modified_count = 1
            return res
        res = MagicMock()
        res.modified_count = 0
        return res


class TestWave6BackendParity(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.mock_user_a = {"id": 1001, "user_id": 1001, "name": "Student A", "first_name": "Student A"}
        self.mock_user_b = {"id": 1002, "user_id": 1002, "name": "Student B", "first_name": "Student B"}

        # Dependency overrides for hermetic auth
        app.dependency_overrides[current_student] = lambda: self.mock_user_a
        app.dependency_overrides[get_current_user] = lambda: self.mock_user_a
        app.dependency_overrides[require_feature("ai_chat")] = lambda: self.mock_user_a
        app.dependency_overrides[require_feature("mock_exam")] = lambda: self.mock_user_a

        # In-memory collections
        self.bookmarks_col = InMemoryMongoCollection()
        self.tasks_col = InMemoryMongoCollection()

        # Ensure rate limiters do not block tests
        from backend.api import rate_limit
        rate_limit._store.clear()
        self.p_rl_enabled = patch.object(rate_limit, "_ENABLED", False)
        self.p_rl_enabled.start()
        self.p_rl_global = patch.object(rate_limit, "check_global", new_callable=AsyncMock)
        self.p_rl_global.start()

        # Patch helpers
        self.p_bookmarks = patch("backend.api.routers.web_exam._bookmarks_col", return_value=self.bookmarks_col)
        self.p_tasks = patch("backend.api.routers.schedule._tasks_col", return_value=self.tasks_col)
        self.p_student = patch("backend.api.routers.web_exam._student", side_effect=lambda u: u)
        self.p_mock_gate = patch("backend.api.routers.web_exam._mock_gate", side_effect=lambda u: u)
        self.p_ai_avail = patch("backend.api.routers.ai._ensure_available", new_callable=AsyncMock, return_value={"enabled": True, "api_key": "AIza_mock"})
        self.p_ai_claim = patch("backend.api.routers.ai.ai_claim_inflight", new_callable=AsyncMock, return_value=True)
        self.p_ai_release = patch("backend.api.routers.ai.ai_release_inflight", new_callable=AsyncMock)
        self.p_ai_quota = patch("backend.api.routers.ai._consume_quota", new_callable=AsyncMock, return_value=(1, 50))
        self.p_ai_rl = patch("backend.api.routers.ai.rate_limit_user", new_callable=AsyncMock)
        self.p_ai_history = patch("backend.api.routers.ai._get_history", new_callable=AsyncMock, return_value=[])
        self.p_ai_rem = patch("backend.api.routers.ai._remember", new_callable=AsyncMock)
        self.p_ai_token = patch("backend.api.routers.ai.record_token_usage", new_callable=AsyncMock)
        self.p_ai_prestige = patch("backend.api.routers.ai.db.prestige_event", new_callable=AsyncMock)

        self.mock_bookmarks = self.p_bookmarks.start()
        self.mock_tasks = self.p_tasks.start()
        self.mock_student = self.p_student.start()
        self.mock_gate = self.p_mock_gate.start()
        self.mock_ai_avail = self.p_ai_avail.start()
        self.mock_ai_claim = self.p_ai_claim.start()
        self.mock_ai_release = self.p_ai_release.start()
        self.mock_ai_quota = self.p_ai_quota.start()
        self.mock_ai_rl = self.p_ai_rl.start()
        self.mock_ai_history = self.p_ai_history.start()
        self.mock_ai_rem = self.p_ai_rem.start()
        self.mock_ai_token = self.p_ai_token.start()
        self.mock_ai_prestige = self.p_ai_prestige.start()

    def tearDown(self):
        app.dependency_overrides.clear()
        self.p_rl_enabled.stop()
        self.p_rl_global.stop()
        from backend.api import rate_limit
        rate_limit._store.clear()
        self.p_bookmarks.stop()
        self.p_tasks.stop()
        self.p_student.stop()
        self.p_mock_gate.stop()
        self.p_ai_avail.stop()
        self.p_ai_claim.stop()
        self.p_ai_release.stop()
        self.p_ai_quota.stop()
        self.p_ai_rl.stop()
        self.p_ai_history.stop()
        self.p_ai_rem.stop()
        self.p_ai_token.stop()
        self.p_ai_prestige.stop()



    # ═════════════════════════════════════════════════════════════
    #  1. Question Bank Flagging & PDF Generation
    # ═════════════════════════════════════════════════════════════

    def test_tc_quiz_03_flag_toggle_and_state(self):
        """TC-QUIZ-03: Toggle bookmark on a question and verify state."""
        qid = "650000000000000000000001"
        # First toggle: bookmarks question
        resp1 = self.client.post(f"/api/web/exam/flag/{qid}")
        self.assertEqual(resp1.status_code, 200)
        data1 = resp1.json()
        self.assertEqual(data1["question_id"], qid)
        self.assertTrue(data1["flagged"])

        # Listing should now contain qid
        resp_list1 = self.client.get("/api/web/exam/flagged")
        self.assertEqual(resp_list1.status_code, 200)
        self.assertIn(qid, resp_list1.json()["flagged_ids"])

        # Second toggle: removes bookmark
        resp2 = self.client.post(f"/api/web/exam/flag/{qid}")
        self.assertEqual(resp2.status_code, 200)
        data2 = resp2.json()
        self.assertEqual(data2["question_id"], qid)
        self.assertFalse(data2["flagged"])

        # Listing should not contain qid anymore
        resp_list2 = self.client.get("/api/web/exam/flagged")
        self.assertEqual(resp_list2.status_code, 200)
        self.assertNotIn(qid, resp_list2.json()["flagged_ids"])

    def test_flagged_user_isolation(self):
        """Bookmark collections isolate between distinct students."""
        qid = "650000000000000000000002"
        # User A flags qid
        self.client.post(f"/api/web/exam/flag/{qid}")

        # Switch to User B
        app.dependency_overrides[current_student] = lambda: self.mock_user_b
        resp_b = self.client.get("/api/web/exam/flagged")
        self.assertEqual(resp_b.status_code, 200)
        self.assertNotIn(qid, resp_b.json()["flagged_ids"])

    @patch("backend.api.routers.questions.exam_domain.generate_pdf")
    def test_tc_rpdf_01_and_02_pdf_generation_endpoint(self, mock_gen_pdf):
        """TC-RPDF-01 & 02: ReportLab Persian RTL PDF generation with headers."""
        fake_pdf = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"
        checksum = hashlib.sha256(fake_pdf).hexdigest()
        meta = {"exam_code": "EXAM_99", "sha256": checksum}
        mock_gen_pdf.return_value = (fake_pdf, meta)

        sid = "mock_sess_abc123"
        # Test GET /api/web/exam/{session_id}/pdf
        resp = self.client.get(f"/api/web/exam/{sid}/pdf?mode=exam")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers.get("content-type"), "application/pdf")
        self.assertIn('attachment; filename="humsyar_exam_EXAM_99.pdf"', resp.headers.get("content-disposition", ""))
        self.assertEqual(resp.headers.get("x-exam-session"), sid)
        self.assertEqual(resp.headers.get("x-content-sha256"), checksum)
        self.assertTrue(resp.content.startswith(b"%PDF"))

        # Test alias route /api/web/exam/mock/{session_id}/pdf with mode=practice
        resp_mock = self.client.get(f"/api/web/exam/mock/{sid}/pdf?mode=practice")
        self.assertEqual(resp_mock.status_code, 200)
        mock_gen_pdf.assert_called_with(session_id=sid, user=self.mock_user_a, mode="practice")

        # Invalid mode rejected with 422
        resp_inv = self.client.get(f"/api/web/exam/{sid}/pdf?mode=unsupported")
        self.assertEqual(resp_inv.status_code, 422)

    @patch("backend.api.routers.questions._request_taxonomy", new_callable=AsyncMock, return_value={"lesson": "آناتومی"})
    @patch("backend.api.routers.questions.exam_domain.create")
    @patch("backend.api.routers.questions.exam_domain.load")
    @patch("backend.api.routers.questions.exam_domain.summary")
    def test_exam_contract_aliases(self, mock_summary, mock_load, mock_create, mock_tax):
        """Verify contract aliases: /setup, /{session_id}, /{session_id}/finish."""
        mock_create.return_value = {"session_id": "sid_101", "status": "active"}
        mock_load.return_value = {"_id": ObjectId(), "session_id": "sid_101", "status": "active", "answers": []}
        mock_summary.return_value = {"session_id": "sid_101", "status": "active"}

        # POST /api/web/exam/setup alias to mock_start
        resp_setup = self.client.post("/api/web/exam/setup", json={"count": 10, "minutes": 20, "lesson": "آناتومی"})
        self.assertEqual(resp_setup.status_code, 200)
        self.assertEqual(resp_setup.json()["session_id"], "sid_101")

        # GET /api/web/exam/{session_id} alias to mock_session
        resp_get = self.client.get("/api/web/exam/sid_101")
        self.assertEqual(resp_get.status_code, 200)
        self.assertEqual(resp_get.json()["session_id"], "sid_101")

        # POST /api/web/exam/{session_id}/finish concludes active exam
        with patch.object(web_exam.q_router.exam_domain, "sessions", new=InMemoryMongoCollection()):
            # Insert active session
            sess_col = web_exam.q_router.exam_domain.sessions
            asyncio.run(sess_col.insert_one({"_id": ObjectId(), "session_id": "sid_101", "status": "active"}))
            # Mock review after finish
            with patch("backend.api.routers.web_exam.mock_review", return_value={"session_id": "sid_101", "status": "finished", "review": []}) as mock_rev:
                resp_fin = self.client.post("/api/web/exam/sid_101/finish")
                self.assertEqual(resp_fin.status_code, 200)
                self.assertEqual(resp_fin.json()["status"], "finished")

    # ═════════════════════════════════════════════════════════════
    #  2. HooshYar AI SSE Streaming & Vision
    # ═════════════════════════════════════════════════════════════

    @patch("backend.api.routers.ai.ask_ai_stream")
    def test_tc_ai_01_token_streaming_sse(self, mock_stream):
        """TC-AI-01: Server-Sent Events token streaming via Accept: text/event-stream and /ask/stream."""
        async def fake_stream(**kwargs):
            yield {"type": "delta", "text": "پاسخ "}
            yield {"type": "delta", "text": "پزشکی "}
            yield {"type": "delta", "text": "دقیق."}
            yield {"type": "done", "tokens": 42}

        mock_stream.side_effect = fake_stream

        # Test POST /api/ai/ask with Accept header
        resp = self.client.post(
            "/api/ai/ask",
            json={"message": "علائم آپاندیسیت چیست؟"},
            headers={"Accept": "text/event-stream"},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIn("text/event-stream", resp.headers.get("content-type", ""))
        body_text = resp.text
        self.assertIn("event: token", body_text)
        self.assertIn('data: {"text": "پاسخ "}', body_text)
        self.assertIn('data: {"text": "پزشکی "}', body_text)
        self.assertIn("event: done", body_text)
        self.assertIn('data: {"tokens_used": 42}', body_text)
        self.mock_ai_release.assert_called_with(1001)

        # Test alias route /api/ai/ask/stream
        resp2 = self.client.post(
            "/api/ai/ask/stream",
            json={"message": "علائم آپاندیسیت چیست؟"},
        )
        self.assertEqual(resp2.status_code, 200)
        self.assertIn("text/event-stream", resp2.headers.get("content-type", ""))

    @patch("backend.api.routers.ai.ask_ai_stream")
    def test_tc_corner_15_sse_disconnect_releases_lock(self, mock_stream):
        """TC-CORNER-15: Abrupt disconnect during SSE stream breaks loop and releases inflight lock."""
        async def fake_stream(**kwargs):
            yield {"type": "delta", "text": "مرحله اول"}
            yield {"type": "delta", "text": "مرحله دوم"}
            yield {"type": "done", "tokens": 10}

        mock_stream.side_effect = fake_stream

        with patch("starlette.requests.Request.is_disconnected", new_callable=AsyncMock) as mock_disc:
            mock_disc.side_effect = [False, True]
            resp = self.client.post(
                "/api/ai/ask",
                json={"message": "درخواست قطعی ارتباط"},
                headers={"Accept": "text/event-stream"},
            )
            self.assertEqual(resp.status_code, 200)
            self.mock_ai_release.assert_called_with(1001)

    @patch("backend.api.routers.ai._ask_provider")
    def test_ai_ask_json_backward_compatibility(self, mock_ask):
        """When Accept is not text/event-stream, standard JSON dictionary is returned."""
        mock_ask.return_value = {"answer": "پاسخ متنی عادی", "tokens_used": 15}
        resp = self.client.post(
            "/api/ai/ask",
            json={"message": "تعریف بافت همبند"},
            headers={"Accept": "application/json"},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["answer"], "پاسخ متنی عادی")
        self.mock_ai_release.assert_called_with(1001)

    @patch("backend.api.routers.ai.ask_ai", new_callable=AsyncMock)
    def test_tc_vis_01_vision_diagnosis_valid_image(self, mock_ask_ai):
        """TC-VIS-01: Multi-modal clinical image diagnosis with educational guidance."""
        mock_ask_ai.return_value = ("تحلیل تصویر رادیوگرافی قفسه سینه نرمال", 120)
        # Create small synthetic JPEG bytes
        jpeg_data = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00`\x00`\x00\x00\xff\xdb\x00C\x00" + b"\x00" * 100 + b"\xff\xd9"

        resp = self.client.post(
            "/api/ai/vision",
            data={"prompt": "بررسی رادیوگرافی ریه"},
            files={"file": ("chest_xray.jpg", io.BytesIO(jpeg_data), "image/jpeg")},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("analysis", data)
        self.assertEqual(data["confidence_level"], "educational_reference_only")
        self.assertEqual(data["tokens_used"], 120)
        self.mock_ai_release.assert_called_with(1001)

    def test_tc_vis_02_vision_rejection_invalid_type_and_oversize(self):
        """TC-VIS-02: Rejects non-image files and oversized files with HTTP 422."""
        # Non-image PDF
        pdf_data = b"%PDF-1.4\nfake pdf content"
        resp_pdf = self.client.post(
            "/api/ai/vision",
            data={"prompt": "بررسی"},
            files={"file": ("doc.pdf", io.BytesIO(pdf_data), "application/pdf")},
        )
        self.assertEqual(resp_pdf.status_code, 422)
        self.assertEqual(resp_pdf.json()["detail"]["code"], "INVALID_IMAGE_TYPE")
        self.mock_ai_release.assert_called_with(1001)

        # Oversized file (>10MB)
        large_bytes = b"\xff\xd8\xff" + b"\x00" * (11 * 1024 * 1024)
        resp_large = self.client.post(
            "/api/ai/vision",
            data={"prompt": "بررسی"},
            files={"file": ("huge.jpg", io.BytesIO(large_bytes), "image/jpeg")},
        )
        self.assertEqual(resp_large.status_code, 422)



    # ═════════════════════════════════════════════════════════════
    #  3. Persian Jalali Study Task Management
    # ═════════════════════════════════════════════════════════════

    def test_tc_sched_01_jalali_date_validation_boundaries(self):
        """TC-SCHED-01: Algorithmic Jalali calendar boundary validation."""
        # Valid boundaries: months 1-6 can have 31 days
        _validate_jalali_date("1405-01-31")
        _validate_jalali_date("1405-06-31")
        # Months 7-12 can have at most 30 days
        _validate_jalali_date("1405-07-30")
        _validate_jalali_date("1405-12-30")

        # Invalid: Month 7 with 31 days must raise 422
        with self.assertRaises(HTTPException) as cm:
            _validate_jalali_date("1405-07-31")
        self.assertEqual(cm.exception.status_code, 422)
        self.assertIn("حداکثر ۳۰ روز", cm.exception.detail)

        # Invalid: Month 11 with 31 days must raise 422
        with self.assertRaises(HTTPException) as cm2:
            _validate_jalali_date("1405-11-31")
        self.assertEqual(cm2.exception.status_code, 422)

        # Invalid month 13
        with self.assertRaises(HTTPException) as cm3:
            _validate_jalali_date("1405-13-01")
        self.assertEqual(cm3.exception.status_code, 422)

        # Invalid day 32
        with self.assertRaises(HTTPException) as cm4:
            _validate_jalali_date("1405-02-32")
        self.assertEqual(cm4.exception.status_code, 422)

    def test_study_tasks_crud_and_date_range_filtering(self):
        """Create study tasks and list with Jalali date range filtering."""
        # Create task 1 via /api/schedule/items
        resp1 = self.client.post("/api/schedule/items", json={
            "title": "مطالعه فیزیولوژی قلب",
            "jalali_date": "1405-08-10",
            "reminder_time": "18:00",
        })
        self.assertEqual(resp1.status_code, 201)
        t1_id = resp1.json()["task_id"]

        # Create task 2 via web alias /api/web/schedule/items
        resp2 = self.client.post("/api/web/schedule/items", json={
            "title": "مرور فارماکولوژی آنتی‌بیوتیک‌ها",
            "jalali_date": "1405-08-20",
        })
        self.assertEqual(resp2.status_code, 201)
        t2_id = resp2.json()["task_id"]

        # List all tasks
        resp_all = self.client.get("/api/web/schedule/items")
        self.assertEqual(resp_all.status_code, 200)
        tasks = resp_all.json()["tasks"]
        self.assertEqual(len(tasks), 2)
        self.assertEqual(tasks[0]["task_id"], t1_id)
        self.assertFalse(tasks[0]["completed"])

        # Filter by date range: from 1405-08-15 to 1405-08-25 (only task 2)
        resp_filt = self.client.get("/api/schedule/items?from_jalali=1405-08-15&to_jalali=1405-08-25")
        self.assertEqual(resp_filt.status_code, 200)
        filt_tasks = resp_filt.json()["tasks"]
        self.assertEqual(len(filt_tasks), 1)
        self.assertEqual(filt_tasks[0]["task_id"], t2_id)

    def test_tc_sched_02_task_completion_toggle(self):
        """TC-SCHED-02: Toggle task completed status and record completed_at timestamp."""
        create_resp = self.client.post("/api/schedule/items", json={
            "title": "تست آزمون علوم پایه",
            "jalali_date": "1405-09-01",
        })
        task_id = create_resp.json()["task_id"]

        # First toggle: False -> True
        resp_toggle1 = self.client.patch(f"/api/web/schedule/items/{task_id}/toggle")
        self.assertEqual(resp_toggle1.status_code, 200)
        d1 = resp_toggle1.json()
        self.assertTrue(d1["completed"])
        self.assertIsNotNone(d1["completed_at"])

        # Second toggle: True -> False
        resp_toggle2 = self.client.patch(f"/api/schedule/items/{task_id}/toggle")
        self.assertEqual(resp_toggle2.status_code, 200)
        d2 = resp_toggle2.json()
        self.assertFalse(d2["completed"])
        self.assertIsNone(d2["completed_at"])

        # Non-existent task returns 404
        fake_id = str(ObjectId())
        resp_404 = self.client.patch(f"/api/schedule/items/{fake_id}/toggle")
        self.assertEqual(resp_404.status_code, 404)

    # ═════════════════════════════════════════════════════════════
    #  4. Academic Weighted GPA
    # ═════════════════════════════════════════════════════════════

    def test_tc_grade_01_weighted_gpa_math(self):
        """TC-GRADE-01: Calculate weighted semester GPA and cumulative GPA conforming to Iranian medical standards."""
        records = [
            # Term 1: Total credits = 6, weighted sum = 4*16 + 2*14 = 64 + 28 = 92, term GPA = 92/6 = 15.33
            {"_id": "c1", "term": "ترم ۱", "lesson": "آناتومی اندام", "score": 16.0, "max_score": 20.0, "credits": 4.0},
            {"_id": "c2", "term": "ترم ۱", "lesson": "بافت‌شناسی", "score": 14.0, "max_score": 20.0, "credits": 2.0},
            # Term 2: Total credits = 5, weighted sum = 3*18 + 2*8 = 54 + 16 = 70, term GPA = 70/5 = 14.0
            {"_id": "c3", "term": "ترم ۲", "lesson": "فیزیولوژی قلب", "score": 18.0, "max_score": 20.0, "credits": 3.0},
            {"_id": "c4", "term": "ترم ۲", "lesson": "ژنتیک پزشکی", "score": 8.0, "max_score": 20.0, "credits": 2.0},
        ]
        # Cumulative points = 92 + 70 = 162
        # Cumulative credits = 6 + 5 = 11
        # Cumulative GPA = 162 / 11 = 14.73
        # Passed credits = 4 + 2 + 3 = 9 (score >= 10.0)
        # Failed credits = 2 (score 8.0 < 10.0)

        transcript = calculate_weighted_transcript(records)
        self.assertEqual(transcript["cumulative_gpa"], 14.73)
        self.assertEqual(transcript["total_credits"], 11)
        self.assertEqual(transcript["passed_credits"], 9)
        self.assertEqual(transcript["failed_credits"], 2)

        semesters = transcript["semesters"]
        self.assertEqual(len(semesters), 2)
        # Term 1
        self.assertEqual(semesters[0]["term_label"], "ترم ۱")
        self.assertEqual(semesters[0]["term_gpa"], 15.33)
        self.assertEqual(semesters[0]["credits"], 6)
        # Term 2
        self.assertEqual(semesters[1]["term_label"], "ترم ۲")
        self.assertEqual(semesters[1]["term_gpa"], 14.0)
        self.assertEqual(semesters[1]["credits"], 5)

    @patch("backend.api.routers.grades.db.grade_list_for_student")
    def test_tc_grade_02_summary_endpoint(self, mock_grades):
        """TC-GRADE-02: Endpoint /api/grades/summary and /api/web/grades/summary."""
        mock_grades.return_value = [
            {"_id": "g1", "term": "ترم ۱", "lesson": "بیوشیمی", "score": 17.5, "max_score": 20.0, "credits": 3.0},
            {"_id": "g2", "term": "ترم ۱", "lesson": "فیزیک پزشکی", "score": 15.0, "max_score": 20.0, "credits": 2.0},
        ]

        # GET /api/grades/summary
        resp = self.client.get("/api/grades/summary")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["cumulative_gpa"], 16.5)
        self.assertEqual(data["total_credits"], 5)
        self.assertEqual(data["passed_credits"], 5)
        self.assertEqual(data["failed_credits"], 0)

        # GET /api/web/grades/summary alias
        resp_web = self.client.get("/api/web/grades/summary")
        self.assertEqual(resp_web.status_code, 200)
        self.assertEqual(resp_web.json()["cumulative_gpa"], 16.5)

    def test_weighted_transcript_edge_cases(self):
        """Edge cases: empty records, unrated courses, default units."""
        # Empty records
        empty_out = calculate_weighted_transcript([])
        self.assertIsNone(empty_out["cumulative_gpa"])
        self.assertEqual(empty_out["total_credits"], 0)
        self.assertEqual(len(empty_out["semesters"]), 0)

        # Ungraded course (score is None) and default credits
        ungraded_out = calculate_weighted_transcript([
            {"_id": "u1", "term": "ترم ۳", "lesson": "پاتولوژی", "score": None, "max_score": 20.0},
        ])
        self.assertIsNone(ungraded_out["cumulative_gpa"])
        self.assertEqual(ungraded_out["total_credits"], 0)
        self.assertEqual(len(ungraded_out["semesters"][0]["courses"]), 1)
        self.assertFalse(ungraded_out["semesters"][0]["courses"][0]["passed"])
        self.assertEqual(ungraded_out["semesters"][0]["courses"][0]["credits"], 2)


if __name__ == "__main__":
    unittest.main()
