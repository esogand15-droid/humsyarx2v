# -*- coding: utf-8 -*-
"""W3 — هوشیار: conversation history gaps (all mocked, no DB / no LLM).

Covers the additive, backward-compatible API changes:
  - GET  /api/ai/conversations        ?q= / ?limit= / ?offset=  (+ total, has_more)
  - GET  /api/ai/conversations/{cid}/messages  index + ?before= / ?limit=
  - POST /api/ai/ask (SSE)             event:start, auto-title, event:error, regenerate
  - DBCore.ai_conv_pop_last_turn       guarded removal of the last turn
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import types
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017/humsyar_test")
os.environ.setdefault("ADMIN_ID", "999")
os.environ.setdefault("TELEGRAM_TOKEN", "123:TEST_TOKEN")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bson import ObjectId  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from backend.api.main import app  # noqa: E402
from backend.api.auth import get_current_user, require_feature  # noqa: E402
import backend.api.routers.ai as ai_router  # noqa: E402
from backend.database.core import DBCore  # noqa: E402

CID = str(ObjectId())


def parse_sse(text: str) -> list[tuple[str, dict]]:
    out = []
    for block in text.split("\n\n"):
        ev, data = "", None
        for line in block.splitlines():
            if line.startswith("event:"):
                ev = line[6:].strip()
            elif line.startswith("data:"):
                data = json.loads(line[5:].strip())
        if ev:
            out.append((ev, data))
    return out


class _Base(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.user = {"id": 1001, "user_id": 1001, "name": "Student A"}
        app.dependency_overrides[get_current_user] = lambda: self.user
        app.dependency_overrides[require_feature("ai_chat")] = lambda: self.user

        from backend.api import rate_limit
        rate_limit._store.clear()
        self._patches = [
            patch.object(rate_limit, "_ENABLED", False),
            patch.object(rate_limit, "check_global", new_callable=AsyncMock),
            patch.object(ai_router, "_ensure_available", new_callable=AsyncMock, return_value={"enabled": True}),
            patch.object(ai_router, "ai_claim_inflight", new_callable=AsyncMock, return_value=True),
            patch.object(ai_router, "ai_release_inflight", new_callable=AsyncMock),
            patch.object(ai_router, "_consume_quota", new_callable=AsyncMock, return_value=(1, 50)),
            patch.object(ai_router, "rate_limit_user", new_callable=AsyncMock),
            patch.object(ai_router, "_get_history", new_callable=AsyncMock, return_value=[]),
            patch.object(ai_router, "_remember", new_callable=AsyncMock),
            patch.object(ai_router, "record_token_usage", new_callable=AsyncMock),
            patch.object(ai_router.db, "prestige_event", new_callable=AsyncMock),
        ]
        self.mocks = [p.start() for p in self._patches]
        self.release = self.mocks[4]

    def tearDown(self):
        app.dependency_overrides.clear()
        for p in reversed(self._patches):
            p.stop()


# ─────────────────────────────────────────────────────────────
class TestAutoTitle(unittest.TestCase):
    def test_short_message_kept(self):
        self.assertEqual(ai_router._auto_title("علائم آپاندیسیت چیست؟"), "علائم آپاندیسیت چیست؟")

    def test_label_prefix_and_newlines_stripped(self):
        self.assertEqual(ai_router._auto_title("[تصویر]  تفسیر ECG\nخط دوم"), "تفسیر ECG")

    def test_long_message_cut_on_word_with_ellipsis(self):
        t = ai_router._auto_title("پاتوفیزیولوژی نارسایی قلبی با کسر جهشی کاهش‌یافته را ساده و مرحله به مرحله توضیح بده")
        self.assertTrue(t.endswith("…"))
        self.assertLessEqual(len(t), 41)
        self.assertNotIn("  ", t)

    def test_empty_falls_back_to_default(self):
        self.assertEqual(ai_router._auto_title("   "), ai_router.DEFAULT_CONV_TITLE)


# ─────────────────────────────────────────────────────────────
def _conv(i, title, pinned=False, updated="2026-11-20T10:00:00+00:00"):
    return {"_id": f"c{i}", "title": title, "pinned": pinned, "archived": False,
            "preview": f"پیش‌نمایش {i}", "msg_count": 2, "created_at": updated, "updated_at": updated}


class TestListConversations(_Base):
    def setUp(self):
        super().setUp()
        docs = [_conv(1, "قلب", pinned=True), _conv(2, "ECG تفسیر"), _conv(3, "آناتومی اندام"), _conv(4, "داروهای ACE")]
        self._extra = [
            patch.object(ai_router.db, "ai_conv_list", new_callable=AsyncMock, return_value=docs),
            patch.object(ai_router.db, "ai_get_memory", new_callable=AsyncMock, return_value=([], None)),
        ]
        for p in self._extra:
            p.start()

    def tearDown(self):
        for p in self._extra:
            p.stop()
        super().tearDown()

    def test_default_shape_backward_compatible(self):
        r = self.client.get("/api/ai/conversations")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual([c["id"] for c in body["conversations"]], ["c1", "c2", "c3", "c4"])
        self.assertEqual(body["total"], 4)
        self.assertFalse(body["has_more"])

    def test_search_title_case_insensitive(self):
        r = self.client.get("/api/ai/conversations", params={"q": "ecg"})
        self.assertEqual([c["id"] for c in r.json()["conversations"]], ["c2"])

    def test_search_matches_preview(self):
        r = self.client.get("/api/ai/conversations", params={"q": "پیش‌نمایش 3"})
        self.assertEqual([c["id"] for c in r.json()["conversations"]], ["c3"])

    def test_pagination(self):
        r = self.client.get("/api/ai/conversations", params={"limit": 2})
        b = r.json()
        self.assertEqual([c["id"] for c in b["conversations"]], ["c1", "c2"])
        self.assertTrue(b["has_more"])
        r2 = self.client.get("/api/ai/conversations", params={"limit": 2, "offset": 2})
        b2 = r2.json()
        self.assertEqual([c["id"] for c in b2["conversations"]], ["c3", "c4"])
        self.assertFalse(b2["has_more"])
        self.assertEqual(b2["total"], 4)

    def test_limit_out_of_range_rejected(self):
        self.assertEqual(self.client.get("/api/ai/conversations", params={"limit": 0}).status_code, 422)
        self.assertEqual(self.client.get("/api/ai/conversations", params={"limit": 999}).status_code, 422)


# ─────────────────────────────────────────────────────────────
class TestMessages(_Base):
    def setUp(self):
        super().setUp()
        items = [{"r": "user" if i % 2 == 0 else "assistant", "t": f"m{i}", "at": "2026-11-25T10:00:00+00:00"} for i in range(6)]
        self._p = patch.object(ai_router.db, "ai_conv_get", new_callable=AsyncMock,
                               return_value={"_id": CID, "user_id": 1001, "items": items, "msg_count": 6})
        self._p.start()

    def tearDown(self):
        self._p.stop()
        super().tearDown()

    def test_all_messages_have_stable_index(self):
        b = self.client.get(f"/api/ai/conversations/{CID}/messages").json()
        self.assertEqual([m["index"] for m in b["messages"]], list(range(6)))
        self.assertEqual(b["messages"][0]["role"], "user")
        self.assertEqual(b["total"], 6)
        self.assertFalse(b["has_more"])

    def test_tail_page_then_older(self):
        b = self.client.get(f"/api/ai/conversations/{CID}/messages", params={"limit": 4}).json()
        self.assertEqual([m["text"] for m in b["messages"]], ["m2", "m3", "m4", "m5"])
        self.assertTrue(b["has_more"])
        older = self.client.get(f"/api/ai/conversations/{CID}/messages", params={"limit": 4, "before": 2}).json()
        self.assertEqual([m["index"] for m in older["messages"]], [0, 1])
        self.assertFalse(older["has_more"])

    def test_unknown_conversation_404(self):
        with patch.object(ai_router.db, "ai_conv_get", new_callable=AsyncMock, return_value=None):
            self.assertEqual(self.client.get(f"/api/ai/conversations/{CID}/messages").status_code, 404)

    def test_legacy_thread_indexed(self):
        with patch.object(ai_router.db, "ai_get_memory", new_callable=AsyncMock,
                          return_value=([{"r": "user", "t": "a"}, {"r": "model", "t": "b"}], None)):
            b = self.client.get("/api/ai/conversations/legacy/messages").json()
        self.assertEqual([(m["role"], m["index"]) for m in b["messages"]], [("user", 0), ("assistant", 1)])


# ─────────────────────────────────────────────────────────────
class TestStream(_Base):
    def setUp(self):
        super().setUp()
        self.conv_doc = {"_id": CID, "user_id": 1001, "title": ai_router.DEFAULT_CONV_TITLE, "items": [], "msg_count": 0}
        self._p = [
            patch.object(ai_router.db, "ai_conv_get", new_callable=AsyncMock, side_effect=lambda *_: self.conv_doc),
            patch.object(ai_router.db, "ai_conv_append", new_callable=AsyncMock, return_value=True),
            patch.object(ai_router.db, "ai_conv_pop_last_turn", new_callable=AsyncMock, return_value=True),
        ]
        self.get, self.append, self.pop = [p.start() for p in self._p]

    def tearDown(self):
        for p in self._p:
            p.stop()
        super().tearDown()

    def _post(self, **body):
        body.setdefault("stream_meta", True)
        return self.client.post("/api/ai/ask", json=body, headers={"Accept": "text/event-stream"})

    def test_wire_format_unchanged_without_stream_meta(self):
        """Old clients (no stream_meta) see exactly token… then done — no start event."""
        async def fake(**kw):
            yield {"type": "delta", "text": "پاسخ"}
            yield {"type": "done", "tokens": 3}

        with patch.object(ai_router, "ask_ai_stream", side_effect=fake):
            r = self._post(message="سؤال اول", conversation_id=CID, stream_meta=False)
        self.assertEqual([e for e, _ in parse_sse(r.text)], ["token", "done"])
        # auto-title is still persisted server-side even without the start event
        self.assertEqual(self.append.await_args.kwargs["title"], "سؤال اول")

    def test_start_event_and_auto_title_on_first_turn(self):
        async def fake(**kw):
            yield {"type": "delta", "text": "پاسخ"}
            yield {"type": "done", "tokens": 7}

        with patch.object(ai_router, "ask_ai_stream", side_effect=fake):
            r = self._post(message="تفسیر موج T معکوس در ECG", conversation_id=CID)
        events = parse_sse(r.text)
        self.assertEqual(events[0][0], "start")
        self.assertEqual(events[0][1]["conversation_id"], CID)
        self.assertEqual(events[0][1]["title"], "تفسیر موج T معکوس در ECG")
        self.assertEqual([e for e, _ in events], ["start", "token", "done"])
        self.assertEqual(self.append.await_args.kwargs["title"], "تفسیر موج T معکوس در ECG")
        self.release.assert_awaited()

    def test_no_title_overwrite_after_first_turn(self):
        self.conv_doc.update({"title": "نام دلخواه", "msg_count": 4})

        async def fake(**kw):
            yield {"type": "delta", "text": "x"}

        with patch.object(ai_router, "ask_ai_stream", side_effect=fake):
            r = self._post(message="سؤال دوم", conversation_id=CID)
        self.assertNotIn("title", parse_sse(r.text)[0][1])
        self.assertIsNone(self.append.await_args.kwargs["title"])

    def test_renamed_empty_conversation_keeps_user_title(self):
        self.conv_doc.update({"title": "مرور قلب"})

        async def fake(**kw):
            yield {"type": "delta", "text": "x"}

        with patch.object(ai_router, "ask_ai_stream", side_effect=fake):
            self._post(message="سؤال", conversation_id=CID)
        self.assertIsNone(self.append.await_args.kwargs["title"])

    def test_midstream_error_emits_error_event_and_saves_partial(self):
        async def fake(**kw):
            yield {"type": "delta", "text": "نیمه"}
            raise RuntimeError("provider exploded")

        with patch.object(ai_router, "ask_ai_stream", side_effect=fake):
            r = self._post(message="سؤال", conversation_id=CID)
        events = parse_sse(r.text)
        names = [e for e, _ in events]
        self.assertEqual(names, ["start", "token", "error", "done"])
        err = dict(events)["error"]
        self.assertEqual(err["code"], "stream_failed")
        self.assertTrue(err["partial"])
        self.assertNotIn("exploded", err["message"])  # never leak internals
        self.assertEqual(self.append.await_args.args[3]["t"], "نیمه")
        self.release.assert_awaited()

    def test_error_before_any_token_saves_nothing(self):
        async def fake(**kw):
            raise ai_router.AIError("سرویس موقتاً در دسترس نیست")
            yield  # pragma: no cover

        with patch.object(ai_router, "ask_ai_stream", side_effect=fake):
            r = self._post(message="سؤال", conversation_id=CID)
        err = dict(parse_sse(r.text))["error"]
        self.assertEqual(err["code"], "provider_unavailable")
        self.assertFalse(err["partial"])
        self.append.assert_not_awaited()

    def test_regenerate_pops_last_turn_first(self):
        self.conv_doc.update({"title": "قلب", "msg_count": 2,
                              "items": [{"r": "user", "t": "سؤال"}, {"r": "assistant", "t": "پاسخ قدیمی"}]})

        async def fake(**kw):
            yield {"type": "delta", "text": "پاسخ تازه"}

        with patch.object(ai_router, "ask_ai_stream", side_effect=fake):
            r = self._post(message="سؤال", conversation_id=CID, regenerate=True)
        self.pop.assert_awaited_once_with(CID, 1001, user_text="سؤال")
        self.assertTrue(parse_sse(r.text)[0][1]["regenerated"])

    def test_regenerate_flag_default_off(self):
        async def fake(**kw):
            yield {"type": "delta", "text": "x"}

        with patch.object(ai_router, "ask_ai_stream", side_effect=fake):
            self._post(message="سؤال", conversation_id=CID)
        self.pop.assert_not_awaited()

    def test_legacy_stream_still_uses_shared_memory(self):
        async def fake(**kw):
            yield {"type": "delta", "text": "پاسخ"}

        with patch.object(ai_router, "ask_ai_stream", side_effect=fake):
            r = self._post(message="سؤال")
        self.assertEqual(parse_sse(r.text)[0][1]["conversation_id"], "legacy")
        self.append.assert_not_awaited()
        self.assertEqual(self.mocks[8].await_count, 2)  # _remember(user) + _remember(assistant)


# ─────────────────────────────────────────────────────────────
class _FakeConvs:
    def __init__(self, doc):
        self.doc = doc
        self.updates = []

    async def find_one(self, q, proj=None):
        return dict(self.doc) if self.doc and q["_id"] == self.doc["_id"] and q["user_id"] == self.doc["user_id"] else None

    async def update_one(self, q, upd):
        r = MagicMock()
        ok = self.doc and q.get("msg_count") == self.doc.get("msg_count")
        if ok:
            self.doc.update(upd["$set"])
            self.updates.append(upd)
        r.matched_count = 1 if ok else 0
        return r


class TestPopLastTurn(unittest.TestCase):
    def _run(self, items, **kw):
        oid = ObjectId()
        fake = _FakeConvs({"_id": oid, "user_id": 1, "items": items, "msg_count": len(items)})
        self_ = types.SimpleNamespace(ai_conversations=fake)
        ok = asyncio.run(DBCore.ai_conv_pop_last_turn(self_, str(oid), 1, **kw))
        return ok, fake

    def test_pops_matching_turn(self):
        items = [{"r": "user", "t": "a"}, {"r": "assistant", "t": "b"}, {"r": "user", "t": "c"}, {"r": "assistant", "t": "d"}]
        ok, fake = self._run(items, user_text="c")
        self.assertTrue(ok)
        self.assertEqual([i["t"] for i in fake.doc["items"]], ["a", "b"])
        self.assertEqual(fake.doc["msg_count"], 2)
        self.assertEqual(fake.doc["preview"], "b")

    def test_refuses_when_text_differs(self):
        ok, fake = self._run([{"r": "user", "t": "a"}, {"r": "assistant", "t": "b"}], user_text="other")
        self.assertFalse(ok)
        self.assertEqual(fake.updates, [])

    def test_refuses_when_last_is_not_assistant(self):
        ok, _ = self._run([{"r": "assistant", "t": "a"}, {"r": "user", "t": "b"}])
        self.assertFalse(ok)

    def test_invalid_id_and_foreign_user(self):
        self_ = types.SimpleNamespace(ai_conversations=_FakeConvs(None))
        self.assertFalse(asyncio.run(DBCore.ai_conv_pop_last_turn(self_, "not-an-oid", 1)))
        self.assertFalse(asyncio.run(DBCore.ai_conv_pop_last_turn(self_, str(ObjectId()), 1)))


if __name__ == "__main__":
    unittest.main()
