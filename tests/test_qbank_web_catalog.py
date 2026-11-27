# -*- coding: utf-8 -*-
"""Tests for Medofast-structured QBank catalog, period index, filters, and smart queues."""
from __future__ import annotations

import copy
import os
import random
import sys
import unittest
from unittest.mock import patch

from bson import ObjectId
from fastapi.testclient import TestClient

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017/medicalbot")
os.environ.setdefault("ADMIN_ID", "1")
os.environ.setdefault("TELEGRAM_TOKEN", "123:TEST")

from backend.api.main import app  # noqa: E402
from backend.api.routers import questions as q_router, web_exam  # noqa: E402
from backend.api.routers.web_student import current_student  # noqa: E402
from backend.services.question_bank.contracts import (  # noqa: E402
    classify_subject_group,
    classify_topic_kind,
)
from backend.services.question_bank.service import QuestionBankService  # noqa: E402


def _get_path(doc: dict, dotted: str):
    cur = doc
    for part in dotted.split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return None
    return cur


def _matches_filter(doc: dict, query: dict | None) -> bool:
    if not query:
        return True
    for k, v in query.items():
        if k == "$and":
            if not all(_matches_filter(doc, sub) for sub in v):
                return False
            continue
        if k == "$or":
            if not any(_matches_filter(doc, sub) for sub in v):
                return False
            continue
        val = _get_path(doc, k)
        if isinstance(v, dict):
            if "$exists" in v:
                exists = k in doc if "." not in k else val is not None
                if bool(v["$exists"]) != exists:
                    return False
            if "$ne" in v and val == v["$ne"]:
                return False
            if "$in" in v and val not in v["$in"]:
                return False
            if "$nin" in v and val in v["$nin"]:
                return False
            if "$gte" in v and (val is None or val < v["$gte"]):
                return False
            if "$lte" in v and (val is None or val > v["$lte"]):
                return False
        else:
            if val != v:
                return False
    return True


class _MiniCursor:
    def __init__(self, rows: list[dict]):
        self._rows = list(rows)

    def sort(self, key_or_list, direction=1):
        if isinstance(key_or_list, list):
            for k, d in reversed(key_or_list):
                self._rows.sort(key=lambda r: str(r.get(k, "")), reverse=(d == -1))
        else:
            self._rows.sort(key=lambda r: str(r.get(key_or_list, "")), reverse=(direction == -1))
        return self

    def limit(self, n: int):
        self._rows = self._rows[:n]
        return self

    async def to_list(self, n: int | None = None):
        return [copy.deepcopy(r) for r in (self._rows[:n] if n is not None else self._rows)]


class _MiniCollection:
    def __init__(self, db_ref=None):
        self.docs: list[dict] = []
        self._db = db_ref

    async def find_one(self, q=None, proj=None):
        for d in self.docs:
            if _matches_filter(d, q):
                return copy.deepcopy(d)
        return None

    def find(self, q=None, proj=None):
        return _MiniCursor([d for d in self.docs if _matches_filter(d, q)])

    async def count_documents(self, q=None):
        return sum(1 for d in self.docs if _matches_filter(d, q))

    async def insert_one(self, doc: dict):
        d = copy.deepcopy(doc)
        d.setdefault("_id", ObjectId())
        self.docs.append(d)
        return type("Res", (), {"inserted_id": d["_id"]})()

    async def delete_one(self, q: dict):
        for i, d in enumerate(self.docs):
            if _matches_filter(d, q):
                self.docs.pop(i)
                return type("Res", (), {"deleted_count": 1})()
        return type("Res", (), {"deleted_count": 0})()

    def aggregate(self, pipeline: list[dict]):
        rows = [copy.deepcopy(d) for d in self.docs]
        for stage in pipeline:
            if "$match" in stage:
                m = stage["$match"]
                if "_user_progress.0" in m:
                    want_exists = m["_user_progress.0"].get("$exists", True)
                    rows = [r for r in rows if bool(r.get("_user_progress")) == bool(want_exists)]
                else:
                    rows = [r for r in rows if _matches_filter(r, m)]
            elif "$lookup" in stage:
                lu = stage["$lookup"]
                if lu.get("from") == "question_progress" and self._db is not None:
                    prog_docs = self._db.question_progress.docs
                    # Extract uid from pipeline $match
                    uid_expr = lu["pipeline"][0]["$match"]["$expr"]["$and"][0]["$eq"][1]
                    for r in rows:
                        qid = str(r.get("_id"))
                        hits = [p for p in prog_docs if p.get("user_id") == uid_expr and p.get("question_id") == qid]
                        r[lu["as"]] = hits[:1]
            elif "$sample" in stage:
                n = int(stage["$sample"]["size"])
                if len(rows) > n:
                    rows = random.Random(7).sample(rows, n)
            elif "$project" in stage:
                proj = stage["$project"]
                for r in rows:
                    for k, v in proj.items():
                        if v == 0:
                            r.pop(k, None)
            elif "$count" in stage:
                rows = [{stage["$count"]: len(rows)}]
            elif "$group" in stage:
                spec = stage["$group"]
                id_spec = spec["_id"]
                groups: dict = {}
                for r in rows:
                    if id_spec is None:
                        gk = None
                        key_val = None
                    elif isinstance(id_spec, dict):
                        key_val = {out_k: _get_path(r, fld.lstrip("$")) for out_k, fld in id_spec.items()}
                        gk = tuple(sorted((ok, str(ov)) for ok, ov in key_val.items()))
                    else:
                        key_val = _get_path(r, id_spec.lstrip("$"))
                        gk = key_val
                    acc = groups.setdefault(gk, {"_id": key_val})
                    for out_field, expr in spec.items():
                        if out_field == "_id":
                            continue
                        if "$sum" in expr:
                            s_arg = expr["$sum"]
                            if s_arg == 1:
                                acc[out_field] = acc.get(out_field, 0) + 1
                            elif isinstance(s_arg, str) and s_arg.startswith("$"):
                                acc[out_field] = acc.get(out_field, 0) + int(r.get(s_arg[1:]) or 0)
                            elif isinstance(s_arg, dict) and "$cond" in s_arg:
                                cond, t_v, f_v = s_arg["$cond"]
                                eq_pair = cond.get("$eq", [])
                                field_name = eq_pair[0].lstrip("$")
                                ok = r.get(field_name) == eq_pair[1]
                                acc[out_field] = acc.get(out_field, 0) + (t_v if ok else f_v)
                rows = list(groups.values())
        return _MiniCursor(rows)


class _MiniDB:
    def __init__(self):
        self.bs_lessons = _MiniCollection(self)
        self.bs_sessions = _MiniCollection(self)
        self.questions = _MiniCollection(self)
        self.question_progress = _MiniCollection(self)
        self.question_topic_stats = _MiniCollection(self)
        self.content_reports = _MiniCollection(self)
        self.question_bookmarks = _MiniCollection(self)
        self.exam_sessions = _MiniCollection(self)
        self._settings = {}

    async def get_setting(self, k, default=None):
        return self._settings.get(k, default)


class TestQBankClassificationHelpers(unittest.TestCase):
    def test_subject_discipline_groups(self):
        self.assertEqual(classify_subject_group("آناتومی", "بانک سؤال")[0], "basic_structural")
        self.assertEqual(classify_subject_group("فیزیولوژِی", "بانک سؤال")[0], "basic_structural")
        self.assertEqual(classify_subject_group("باکتری‌شناسی", "بانک سؤال")[0], "microbiology_immuno")
        self.assertEqual(classify_subject_group("اپیدمیولوژی", "بانک سؤال")[0], "health_general")
        self.assertEqual(classify_subject_group("پاتولوژی", "بانک سؤال")[0], "clinical_extended")
        self.assertEqual(classify_subject_group("کارآموزی ترم ۱", "ترم ۱")[0], "classroom")

    def test_topic_kind_separates_exam_periods_from_scientific_chapters(self):
        self.assertEqual(classify_topic_kind("شهریور ۱۴۰۴"), "exam_period")
        self.assertEqual(classify_topic_kind("اسفند 1403"), "exam_period")
        self.assertEqual(classify_topic_kind("شهریور ۹۸ قطب تهران"), "exam_period")
        self.assertEqual(classify_topic_kind("آناتومی سر و گردن"), "topic")
        self.assertEqual(classify_topic_kind("فیزیولوژی قلب"), "topic")


class TestQBankWebCatalogAndQueues(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.db = _MiniDB()
        self.svc = QuestionBankService(self.db)
        self.user = {"id": 501, "user_id": 501, "intake": "402"}

        # Seed active lessons across medical groups + 5 empty classroom lessons
        anat_id = (await self.db.bs_lessons.insert_one({"name": "آناتومی", "term": "بانک سؤال", "intake": "", "order": 0})).inserted_id
        bact_id = (await self.db.bs_lessons.insert_one({"name": "باکتری شناسی", "term": "بانک سؤال", "intake": "", "order": 1})).inserted_id
        for i in range(5):
            await self.db.bs_lessons.insert_one({"name": f"درس خالی {i}", "term": f"ترم {i+1}", "intake": "402", "order": i})

        self.anat_id = str(anat_id)
        self.bact_id = str(bact_id)

        t_head = (await self.db.bs_sessions.insert_one({"lesson_id": self.anat_id, "number": 1, "topic": "آناتومی سر و گردن"})).inserted_id
        t_sh = (await self.db.bs_sessions.insert_one({"lesson_id": self.anat_id, "number": 2, "topic": "شهریور ۱۴۰۴"})).inserted_id
        t_bact = (await self.db.bs_sessions.insert_one({"lesson_id": self.bact_id, "number": 1, "topic": "اسفند ۱۴۰۳"})).inserted_id

        self.q1_id = (await self.db.questions.insert_one({
            "lesson_id": self.anat_id, "topic_id": str(t_head),
            "lesson": "آناتومی", "topic": "آناتومی سر و گردن",
            "question": "کدام عصب از سوراخ بیضی عبور می‌کند؟",
            "options": ["ماندیبولار", "ماگزیلاری", "افتالمیک", "فاسیال"],
            "correct_answer": 0, "difficulty": "hard", "status": "approved", "approved": True,
            "intake": "", "content_source": "konkoor_sarasari",
            "exam_year": "1404", "exam_session": "shahrivar", "exam_session_label": "شهریور ۱۴۰۴",
        })).inserted_id

        self.q2_id = (await self.db.questions.insert_one({
            "lesson_id": self.anat_id, "topic_id": str(t_sh),
            "lesson": "آناتومی", "topic": "شهریور ۱۴۰۴",
            "question": "کدام شریان از قوس آئورت منشا می‌گیرد؟",
            "options": ["براکیوسفالیک", "فمورال", "راکیال", "پوپلیتئال"],
            "correct_answer": 0, "difficulty": "medium", "status": "approved", "approved": True,
            "intake": "", "content_source": "hamsyar",
            "exam_year": "1404", "exam_session": "shahrivar", "exam_session_label": "شهریور ۱۴۰۴",
        })).inserted_id

        self.q3_id = (await self.db.questions.insert_one({
            "lesson_id": self.bact_id, "topic_id": str(t_bact),
            "lesson": "باکتری شناسی", "topic": "اسفند ۱۴۰۳",
            "question": "کدام باکتری کاتالاز مثبت و کوآگولاز مثبت است؟",
            "options": ["استافیلوکوک اورئوس", "استرپتوکوک پیوژنز", "انتروکوک", "باسیلوس آنتراسیس"],
            "correct_answer": 0, "difficulty": "easy", "status": "approved", "approved": True,
            "intake": "", "content_source": "konkoor_sarasari",
            "exam_year": "1403", "exam_session": "esfand", "exam_session_label": "اسفند ۱۴۰۳",
        })).inserted_id

        # Mark q1 as wrong in progress, q3 as solved correctly
        await self.db.question_progress.insert_one({
            "user_id": 501, "question_id": str(self.q1_id),
            "lesson_id": self.anat_id, "attempts": 1, "correct_count": 0, "last_correct": False,
        })
        await self.db.question_progress.insert_one({
            "user_id": 501, "question_id": str(self.q3_id),
            "lesson_id": self.bact_id, "attempts": 1, "correct_count": 1, "last_correct": True,
        })

    async def test_catalog_groups_periods_filters_and_hides_empty(self):
        cat = await self.svc.web_catalog(user=self.user)
        self.assertEqual(cat["active_lessons_count"], 2)
        self.assertEqual(len(cat["empty_lessons"]), 5)
        self.assertEqual(cat["total_questions"], 3)
        group_keys = [g["key"] for g in cat["groups"]]
        self.assertEqual(group_keys, ["basic_structural", "microbiology_immuno"])
        # Empty term label for QBANK_LESSON_TERM avoids repeating "بانک سؤال"
        anat = cat["groups"][0]["lessons"][0]
        self.assertEqual(anat["name"], "آناتومی")
        self.assertEqual(anat["term"], "")
        self.assertEqual(anat["count"], 2)
        self.assertEqual(anat["solved_count"], 1)
        self.assertEqual(anat["topics_count"], 1)
        self.assertEqual(anat["periods_count"], 1)

        # Reverse chronological periods (1404 shahrivar before 1403 esfand)
        self.assertEqual([p["label"] for p in cat["periods"]], ["شهریور ۱۴۰۴", "اسفند ۱۴۰۳"])
        self.assertEqual(cat["periods"][0]["count"], 2)
        self.assertEqual(cat["smart_queues"]["wrong_count"], 1)
        self.assertEqual(cat["smart_queues"]["hard_count"], 1)

        # Filter by source
        filtered = await self.svc.web_catalog(user=self.user, content_source=["hamsyar"])
        self.assertEqual(filtered["active_lessons_count"], 1)
        self.assertEqual(filtered["total_questions"], 1)

    async def test_lesson_topics_view_splits_scientific_and_periods(self):
        res = await self.svc.lesson_topics_view(lesson=self.anat_id, user=self.user)
        kinds = {t["name"]: t["kind"] for t in res["topics"]}
        self.assertEqual(kinds["آناتومی سر و گردن"], "topic")
        self.assertEqual(kinds["شهریور ۱۴۰۴"], "exam_period")

    async def test_wrong_and_flagged_practice_queues(self):
        wrong_res = await self.svc.practice_next(user=self.user, taxonomy={}, mode="wrong")
        self.assertIsNotNone(wrong_res["question"])
        self.assertEqual(wrong_res["question"]["id"], str(self.q1_id))

        flagged_res = await self.svc.practice_next(
            user=self.user, taxonomy={}, mode="flagged", question_ids=[str(self.q2_id)],
        )
        self.assertEqual(flagged_res["question"]["id"], str(self.q2_id))

        # Cycle complete when all flagged IDs were seen in current session
        done_res = await self.svc.practice_next(
            user=self.user, taxonomy={}, mode="flagged",
            question_ids=[str(self.q2_id)], exclude_ids=[str(self.q2_id)],
        )
        self.assertIsNone(done_res["question"])
        self.assertTrue(done_res["cycle_completed"])


class TestWebExamRouterCatalogAndModes(unittest.TestCase):
    def setUp(self):
        self.db = _MiniDB()
        self.qbank = QuestionBankService(self.db)
        self.user = {"id": 9001, "user_id": 9001, "intake": "402"}
        app.dependency_overrides[current_student] = lambda: self.user
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_catalog_filters_and_flagged_endpoints(self):
        import asyncio
        lid = asyncio.run(self.db.bs_lessons.insert_one({"name": "آناتومی", "term": "بانک سؤال", "intake": "", "order": 0})).inserted_id
        qid = asyncio.run(self.db.questions.insert_one({
            "lesson_id": str(lid), "topic_id": "", "lesson": "آناتومی", "topic": "سر و گردن",
            "question": "کدام استخوان در حفره کرانیال میانی قرار دارد؟",
            "options": ["اسفنوئید", "اتموئید", "فرونتال", "اکسیپیتال"],
            "correct_answer": 0, "difficulty": "medium", "status": "approved", "approved": True,
            "intake": "", "content_source": "konkoor_sarasari", "exam_year": "1404", "exam_session": "shahrivar",
            "image": {"has_image": True, "pending_upload": False},
        })).inserted_id
        asyncio.run(self.db.question_bookmarks.insert_one({"user_id": 9001, "question_id": str(qid)}))

        with (
            patch("backend.api.routers.web_exam._student", side_effect=lambda u: u),
            patch("backend.api.routers.web_exam._bookmarks_col", return_value=self.db.question_bookmarks),
            patch.object(q_router, "question_bank", self.qbank),
            patch.object(self.qbank, "db", self.db),
        ):
            r_cat = self.client.get("/api/web/exam/catalog")
            self.assertEqual(r_cat.status_code, 200)
            body = r_cat.json()
            self.assertEqual(body["smart_queues"]["flagged_count"], 1)
            self.assertEqual(body["active_lessons_count"], 1)

            r_flt = self.client.get("/api/web/exam/filters")
            self.assertEqual(r_flt.status_code, 200)
            self.assertEqual(r_flt.json()["years"], ["1404"])

            r_next = self.client.get("/api/web/exam/next?mode=flagged")
            self.assertEqual(r_next.status_code, 200)
            q = r_next.json()["question"]
            self.assertIsNotNone(q)
            self.assertEqual(q["image_url"], f"/api/web/exam/image/{qid}")
