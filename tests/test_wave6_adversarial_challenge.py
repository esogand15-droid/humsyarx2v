# -*- coding: utf-8 -*-
"""Adversarial Challenge Test Suite for Wave 6 Backend Feature Parity.

Created by: challenger_w6_1 (critic, specialist)
Purpose: Empirical stress-testing of functional logic, mathematical invariants,
         concurrency locks, boundary conditions, and cross-student isolation.
"""
from __future__ import annotations

import asyncio
import copy
import hashlib
import io
import json
import math
import os
import sys
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from bson import ObjectId
from fastapi import HTTPException
from fastapi.testclient import TestClient

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017/medicalbot")
os.environ.setdefault("ADMIN_ID", "1")
os.environ.setdefault("TELEGRAM_TOKEN", "123:TEST")

from backend.api.main import app
from backend.api.auth import get_current_user, require_feature
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


class TestWave6AdversarialChallenge(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.user_a = {"id": 2001, "user_id": 2001, "name": "Student Alpha"}
        self.user_b = {"id": 2002, "user_id": 2002, "name": "Student Beta"}
        self.user_c = {"id": 2003, "user_id": 2003, "name": "Student Gamma"}

        app.dependency_overrides[current_student] = lambda: self.user_a
        app.dependency_overrides[get_current_user] = lambda: self.user_a
        app.dependency_overrides[require_feature("ai_chat")] = lambda: self.user_a
        app.dependency_overrides[require_feature("mock_exam")] = lambda: self.user_a

        self.bookmarks_col = InMemoryMongoCollection()
        self.tasks_col = InMemoryMongoCollection()

        from backend.api import rate_limit
        rate_limit._store.clear()
        self.p_rl_enabled = patch.object(rate_limit, "_ENABLED", False)
        self.p_rl_enabled.start()
        self.p_rl_global = patch.object(rate_limit, "check_global", new_callable=AsyncMock)
        self.p_rl_global.start()

        self.p_bookmarks = patch("backend.api.routers.web_exam._bookmarks_col", return_value=self.bookmarks_col)
        self.p_tasks = patch("backend.api.routers.schedule._tasks_col", return_value=self.tasks_col)
        self.p_student = patch("backend.api.routers.web_exam._student", side_effect=lambda u: u)
        self.p_mock_gate = patch("backend.api.routers.web_exam._mock_gate", side_effect=lambda u: u)

        self.p_bookmarks.start()
        self.p_tasks.start()
        self.p_student.start()
        self.p_mock_gate.start()

    def tearDown(self):
        app.dependency_overrides.clear()
        self.p_rl_enabled.stop()
        self.p_rl_global.stop()
        self.p_bookmarks.stop()
        self.p_tasks.stop()
        self.p_student.stop()
        self.p_mock_gate.stop()

    # ═════════════════════════════════════════════════════════════
    #  CHALLENGE 1: Exhaustive Jalali Calendar Boundary Testing
    # ═════════════════════════════════════════════════════════════

    def test_adv_jalali_first_half_year_31_days(self):
        """Months 1 through 6 MUST accept day 31."""
        for m in range(1, 7):
            date_str = f"1403-{m:02d}-31"
            y, month, d = _validate_jalali_date(date_str)
            self.assertEqual(month, m)
            self.assertEqual(d, 31)

            # Test through HTTP POST endpoint
            resp = self.client.post("/api/web/schedule/items", json={
                "title": f"تسک ماه {m}",
                "jalali_date": date_str,
            })
            self.assertEqual(resp.status_code, 201, f"Failed for valid date {date_str}: {resp.text}")

    def test_adv_jalali_second_half_year_30_days_valid(self):
        """Months 7 through 12 MUST accept day 30."""
        for m in range(7, 13):
            date_str = f"1403-{m:02d}-30"
            y, month, d = _validate_jalali_date(date_str)
            self.assertEqual(month, m)
            self.assertEqual(d, 30)

            resp = self.client.post("/api/web/schedule/items", json={
                "title": f"تسک ماه {m}",
                "jalali_date": date_str,
            })
            self.assertEqual(resp.status_code, 201, f"Failed for valid date {date_str}: {resp.text}")

    def test_adv_jalali_second_half_year_31_days_strictly_rejected(self):
        """Months 7 through 12 MUST reject day 31 with HTTP 422."""
        for m in range(7, 13):
            date_str = f"1403-{m:02d}-31"
            with self.assertRaises(HTTPException) as cm:
                _validate_jalali_date(date_str)
            self.assertEqual(cm.exception.status_code, 422)

            resp = self.client.post("/api/web/schedule/items", json={
                "title": f"تسک نامعتبر ماه {m}",
                "jalali_date": date_str,
            })
            self.assertEqual(resp.status_code, 422, f"Should reject {date_str} with 422 but got {resp.status_code}")

    def test_adv_jalali_invalid_months_and_days(self):
        """Invalid month numbers (0, 13, 99) and day numbers (0, 32) must fail with 422."""
        invalid_dates = [
            "1403-00-15",   # Month 0
            "1403-13-01",   # Month 13
            "1403-99-01",   # Month 99
            "1403-01-00",   # Day 0
            "1403-01-32",   # Day 32
            "1403-07-32",   # Day 32 in second half
            "1299-01-01",   # Year < 1300
            "1501-01-01",   # Year > 1500
        ]
        for inv in invalid_dates:
            with self.assertRaises(HTTPException, msg=f"Should raise HTTPException for {inv}") as cm:
                _validate_jalali_date(inv)
            self.assertEqual(cm.exception.status_code, 422)

            resp = self.client.post("/api/web/schedule/items", json={
                "title": "تسک نامعتبر",
                "jalali_date": inv,
            })
            self.assertEqual(resp.status_code, 422, f"Endpoint should reject {inv} with 422")

    # ═════════════════════════════════════════════════════════════
    #  CHALLENGE 2: Academic GPA Invariants and Edge Cases
    # ═════════════════════════════════════════════════════════════

    def test_adv_gpa_mathematical_precision_and_weighting(self):
        """Verify GPA calculation: sum(score * credits) / sum(credits).

        Construct an adversarial case where simple average differs substantially
        from credit-weighted average:
        - Course A: Score 20.0, Credits 1.0 -> 20.0
        - Course B: Score 10.0, Credits 5.0 -> 50.0
        Simple average: (20 + 10) / 2 = 15.0
        Weighted average: (20*1 + 10*5) / (1 + 5) = 70 / 6 = 11.67
        """
        records = [
            {"term": "ترم ۱", "lesson": "درس کم‌واحد عالی", "score": 20.0, "max_score": 20.0, "credits": 1.0},
            {"term": "ترم ۱", "lesson": "درس پرواحد ناپلئونی", "score": 10.0, "max_score": 20.0, "credits": 5.0},
        ]
        res = calculate_weighted_transcript(records)
        self.assertEqual(res["cumulative_gpa"], 11.67)
        self.assertEqual(res["total_credits"], 6)
        self.assertEqual(res["passed_credits"], 6)
        self.assertEqual(res["failed_credits"], 0)

    def test_adv_gpa_pass_fail_exact_threshold(self):
        """Scores >= 10.0 count as passed; scores < 10.0 count as failed."""
        records = [
            {"term": "ترم ۱", "lesson": "قبول مرزی", "score": 10.0, "max_score": 20.0, "credits": 3.0},
            {"term": "ترم ۱", "lesson": "رد با ۹.۹", "score": 9.9, "max_score": 20.0, "credits": 2.0},
            {"term": "ترم ۱", "lesson": "رد با صفر", "score": 0.0, "max_score": 20.0, "credits": 1.0},
        ]
        # Weighted points: 10.0*3 + 9.9*2 + 0.0*1 = 30 + 19.8 + 0 = 49.8
        # Total credits: 3 + 2 + 1 = 6
        # GPA: 49.8 / 6 = 8.30
        # Passed credits: 3.0
        # Failed credits: 2.0 + 1.0 = 3.0
        res = calculate_weighted_transcript(records)
        self.assertEqual(res["cumulative_gpa"], 8.30)
        self.assertEqual(res["total_credits"], 6)
        self.assertEqual(res["passed_credits"], 3)
        self.assertEqual(res["failed_credits"], 3)

    def test_adv_gpa_edge_cases_zero_division_and_unrated(self):
        """Edge cases: Zero credits, unrated courses, empty records."""
        # 1. Empty records
        r_empty = calculate_weighted_transcript([])
        self.assertIsNone(r_empty["cumulative_gpa"])
        self.assertEqual(r_empty["total_credits"], 0)
        self.assertEqual(r_empty["passed_credits"], 0)
        self.assertEqual(r_empty["failed_credits"], 0)
        self.assertEqual(r_empty["semesters"], [])

        # 2. Unrated courses (score is None) should NOT contribute to total credits or GPA
        records_unrated = [
            {"term": "ترم ۳", "lesson": "پایان‌نامه در جریان", "score": None, "max_score": 20.0, "credits": 4.0},
            {"term": "ترم ۳", "lesson": "انترنی", "score": None, "max_score": 20.0, "credits": 6.0},
        ]
        r_unrated = calculate_weighted_transcript(records_unrated)
        self.assertIsNone(r_unrated["cumulative_gpa"])
        self.assertEqual(r_unrated["total_credits"], 0)
        self.assertEqual(r_unrated["passed_credits"], 0)
        self.assertEqual(r_unrated["failed_credits"], 0)
        self.assertEqual(len(r_unrated["semesters"]), 1)
        self.assertIsNone(r_unrated["semesters"][0]["term_gpa"])
        self.assertEqual(len(r_unrated["semesters"][0]["courses"]), 2)

        # 3. Default unit fallback when credits/units missing or invalid
        records_default_credits = [
            {"term": "ترم ۱", "lesson": "درس بدون واحد", "score": 14.0, "max_score": 20.0, "credits": None},
        ]
        r_default = calculate_weighted_transcript(records_default_credits)
        self.assertEqual(r_default["total_credits"], 2)  # Fallback to 2.0
        self.assertEqual(r_default["cumulative_gpa"], 14.0)

    def test_adv_gpa_multi_term_chronological_ordering(self):
        """Ensure multi-term records are sorted chronologically: Term 1, Term 2, Term 3."""
        records = [
            {"term": "ترم ۳", "lesson": "درس ترم ۳", "score": 15.0, "max_score": 20.0, "credits": 2.0},
            {"term": "ترم ۱", "lesson": "درس ترم ۱", "score": 17.0, "max_score": 20.0, "credits": 3.0},
            {"term": "ترم ۲", "lesson": "درس ترم ۲", "score": 13.0, "max_score": 20.0, "credits": 4.0},
        ]
        res = calculate_weighted_transcript(records)
        terms = [s["term_label"] for s in res["semesters"]]
        self.assertEqual(terms, ["ترم ۱", "ترم ۲", "ترم ۳"])

    # ═════════════════════════════════════════════════════════════
    #  CHALLENGE 3: HooshYar AI SSE Format & Disconnect Cleanup
    # ═════════════════════════════════════════════════════════════

    @patch("backend.api.routers.ai.ask_ai_stream")
    @patch("backend.api.routers.ai.ai_claim_inflight", new_callable=AsyncMock, return_value=True)
    @patch("backend.api.routers.ai.ai_release_inflight", new_callable=AsyncMock)
    @patch("backend.api.routers.ai._ensure_available", new_callable=AsyncMock, return_value={"enabled": True, "api_key": "k"})
    @patch("backend.api.routers.ai._consume_quota", new_callable=AsyncMock, return_value=(1, 50))
    @patch("backend.api.routers.ai.rate_limit_user", new_callable=AsyncMock)
    @patch("backend.api.routers.ai._get_history", new_callable=AsyncMock, return_value=[])
    @patch("backend.api.routers.ai._remember", new_callable=AsyncMock)
    @patch("backend.api.routers.ai.record_token_usage", new_callable=AsyncMock)
    def test_adv_sse_token_format_and_completion(
        self, mock_rec, mock_rem, mock_hist, mock_rl, mock_quota, mock_avail,
        mock_release, mock_claim, mock_stream,
    ):
        """Verify exact SSE protocol wire format:
        event: token\\ndata: {\\"text\\": \\"...\\"}\\n\\n
        event: done\\ndata: {\\"tokens_used\\": ...}\\n\\n
        """
        async def sample_stream(**kwargs):
            yield {"type": "delta", "text": "سلام "}
            yield {"type": "delta", "text": "به دنیای "}
            yield {"type": "delta", "text": "هوشیار."}
            yield {"type": "done", "tokens": 88}

        mock_stream.side_effect = sample_stream

        resp = self.client.post(
            "/api/ai/ask",
            json={"message": "سلام"},
            headers={"Accept": "text/event-stream"},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIn("text/event-stream", resp.headers["content-type"])

        raw_text = resp.text
        # Split on double newline
        events = [e.strip() for e in raw_text.split("\n\n") if e.strip()]
        self.assertGreaterEqual(len(events), 4)

        # Verify token events
        for ev in events[:-1]:
            lines = ev.split("\n")
            self.assertEqual(lines[0], "event: token")
            self.assertTrue(lines[1].startswith("data: "))
            data_json = json.loads(lines[1][6:])
            self.assertIn("text", data_json)

        # Verify done event
        done_ev = events[-1]
        done_lines = done_ev.split("\n")
        self.assertEqual(done_lines[0], "event: done")
        self.assertTrue(done_lines[1].startswith("data: "))
        done_json = json.loads(done_lines[1][6:])
        self.assertEqual(done_json.get("tokens_used"), 88)

        # Concurrency lock must be released
        mock_release.assert_called_with(2001)

    @patch("backend.api.routers.ai.ask_ai_stream")
    @patch("backend.api.routers.ai.ai_claim_inflight", new_callable=AsyncMock, return_value=True)
    @patch("backend.api.routers.ai.ai_release_inflight", new_callable=AsyncMock)
    @patch("backend.api.routers.ai._ensure_available", new_callable=AsyncMock, return_value={"enabled": True, "api_key": "k"})
    @patch("backend.api.routers.ai._consume_quota", new_callable=AsyncMock, return_value=(1, 50))
    @patch("backend.api.routers.ai.rate_limit_user", new_callable=AsyncMock)
    @patch("backend.api.routers.ai._get_history", new_callable=AsyncMock, return_value=[])
    def test_adv_sse_disconnect_releases_inflight_lock(
        self, mock_hist, mock_rl, mock_quota, mock_avail,
        mock_release, mock_claim, mock_stream,
    ):
        """When client prematurely aborts / disconnects, generator terminates and lock is freed."""
        async def endless_stream(**kwargs):
            for i in range(100):
                yield {"type": "delta", "text": f"بخش {i}"}
                await asyncio.sleep(0.01)

        mock_stream.side_effect = endless_stream

        # Simulate disconnect on second chunk
        with patch("starlette.requests.Request.is_disconnected", new_callable=AsyncMock) as mock_disc:
            mock_disc.side_effect = [False, True, True]
            resp = self.client.post(
                "/api/ai/ask",
                json={"message": "پرسش طولانی"},
                headers={"Accept": "text/event-stream"},
            )
            self.assertEqual(resp.status_code, 200)

            # Verification: lock was released even though generator aborted
            mock_release.assert_called_with(2001)

    # ═════════════════════════════════════════════════════════════
    #  CHALLENGE 4: QBank Flagging Toggle & Cross-Student Isolation
    # ═════════════════════════════════════════════════════════════

    def test_adv_qbank_flag_toggle_sequence(self):
        """Multi-cycle toggle: True -> False -> True -> False."""
        qid = "660000000000000000000001"
        for cycle in range(3):
            # First toggle -> True
            r1 = self.client.post(f"/api/web/exam/flag/{qid}")
            self.assertEqual(r1.status_code, 200)
            self.assertTrue(r1.json()["flagged"], f"Cycle {cycle}: Expected True")

            list1 = self.client.get("/api/web/exam/flagged").json()["flagged_ids"]
            self.assertIn(qid, list1)

            # Second toggle -> False
            r2 = self.client.post(f"/api/web/exam/flag/{qid}")
            self.assertEqual(r2.status_code, 200)
            self.assertFalse(r2.json()["flagged"], f"Cycle {cycle}: Expected False")

            list2 = self.client.get("/api/web/exam/flagged").json()["flagged_ids"]
            self.assertNotIn(qid, list2)

    def test_adv_qbank_flag_strict_user_isolation(self):
        """Strict isolation: Student A, B, and C bookmarks do not bleed into each other."""
        q_alpha = "66000000000000000000000a"
        q_shared = "6600000000000000000000ab"
        q_beta = "66000000000000000000000b"

        # User A flags q_alpha and q_shared
        app.dependency_overrides[current_student] = lambda: self.user_a
        self.client.post(f"/api/web/exam/flag/{q_alpha}")
        self.client.post(f"/api/web/exam/flag/{q_shared}")

        # User B flags q_beta and q_shared
        app.dependency_overrides[current_student] = lambda: self.user_b
        self.client.post(f"/api/web/exam/flag/{q_beta}")
        self.client.post(f"/api/web/exam/flag/{q_shared}")

        # Check User A bookmarks
        app.dependency_overrides[current_student] = lambda: self.user_a
        res_a = self.client.get("/api/web/exam/flagged").json()["flagged_ids"]
        self.assertIn(q_alpha, res_a)
        self.assertIn(q_shared, res_a)
        self.assertNotIn(q_beta, res_a)

        # Check User B bookmarks
        app.dependency_overrides[current_student] = lambda: self.user_b
        res_b = self.client.get("/api/web/exam/flagged").json()["flagged_ids"]
        self.assertIn(q_beta, res_b)
        self.assertIn(q_shared, res_b)
        self.assertNotIn(q_alpha, res_b)

        # Check User C (has flagged nothing)
        app.dependency_overrides[current_student] = lambda: self.user_c
        res_c = self.client.get("/api/web/exam/flagged").json()["flagged_ids"]
        self.assertEqual(res_c, [])

        # User A toggles off q_shared -> User B MUST still retain q_shared!
        app.dependency_overrides[current_student] = lambda: self.user_a
        unflag_res = self.client.post(f"/api/web/exam/flag/{q_shared}")
        self.assertFalse(unflag_res.json()["flagged"])

        app.dependency_overrides[current_student] = lambda: self.user_b
        res_b_after = self.client.get("/api/web/exam/flagged").json()["flagged_ids"]
        self.assertIn(q_shared, res_b_after, "User B's flag on q_shared was corrupted by User A's unflag!")

    # ═════════════════════════════════════════════════════════════
    #  CHALLENGE 5: ReportLab Persian RTL PDF Generation Header & Content
    # ═════════════════════════════════════════════════════════════

    def test_adv_reportlab_actual_pdf_builder_binary_generation(self):
        """Invoke actual generate_exam_pdf from qbank.builder to verify valid %PDF binary."""
        from qbank.builder import generate_exam_pdf
        from qbank.query import ExamMeta

        questions = [
            {
                "_id": "q1",
                "question": "کدام آنزیم در گلیکولیز واکنش غیرقابل برگشت را کاتالیز می‌کند؟",
                "options": ["هگزوکیناز", "فسفوهگزوز ایزومراز", "آلدولاز", "فسفوگلیسرات موتاز"],
                "correct": 0,
                "explanation": "هگزوکیناز یکی از سه آنزیم غیرقابل بازگشت مسیر گلیکولیز است.",
                "lesson": "بیوشیمی",
                "topic": "متابولیسم کربوهیدرات",
            },
            {
                "_id": "q2",
                "question": "عصب حرکتی اصلی عضلات قدام ران کدام است؟",
                "options": ["عصب فمورال", "عصب ابتوراتور", "عصب سیاتیک", "عصب پرونئال"],
                "correct": 0,
                "explanation": "عصب فمورال عضلات چهارسر ران را عصب‌دهی می‌کند.",
                "lesson": "آناتومی",
                "topic": "اندام تحتانی",
            },
        ]
        meta = ExamMeta(
            lesson="جامع پزشکی",
            topic="بیوشیمی و آناتومی",
            difficulty=None,
            student_name="دانشجو تست",
            exam_code="TEST_CODE_88",
        )

        # 1. Test Practice mode (inline answers)
        pdf_practice = generate_exam_pdf(questions, meta, mode="practice")
        self.assertIsInstance(pdf_practice, bytes)
        self.assertTrue(pdf_practice.startswith(b"%PDF"), "Practice PDF must begin with %PDF header")
        self.assertGreater(len(pdf_practice), 1000, "Practice PDF size too small")

        # 2. Test Exam mode (answer key grid at the end)
        pdf_exam = generate_exam_pdf(questions, meta, mode="exam")
        self.assertIsInstance(pdf_exam, bytes)
        self.assertTrue(pdf_exam.startswith(b"%PDF"), "Exam PDF must begin with %PDF header")
        self.assertGreater(len(pdf_exam), 1000, "Exam PDF size too small")

    @patch("backend.api.routers.questions.exam_domain.generate_pdf")
    def test_adv_pdf_endpoint_content_disposition_and_sha256(self, mock_gen_pdf):
        """Verify endpoint headers, filename encoding, and sha256 checksum integrity."""
        synthetic_pdf = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"
        expected_sha = hashlib.sha256(synthetic_pdf).hexdigest()
        mock_gen_pdf.return_value = (synthetic_pdf, {"exam_code": "BIO_101", "sha256": expected_sha})

        resp = self.client.get("/api/web/exam/mock/sess_xyz/pdf?mode=exam")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers["content-type"], "application/pdf")
        self.assertEqual(resp.headers["x-content-sha256"], expected_sha)
        self.assertEqual(resp.headers["x-exam-session"], "sess_xyz")
        self.assertIn('attachment; filename="humsyar_exam_BIO_101.pdf"', resp.headers["content-disposition"])
        self.assertEqual(resp.content, synthetic_pdf)


if __name__ == "__main__":
    unittest.main()
