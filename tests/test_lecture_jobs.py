# -*- coding: utf-8 -*-
"""Tests for backend/services/lecture_jobs.py — no real Mongo / Telegram."""
import asyncio
import os
import sys
import unittest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

BACKEND_DIR = os.path.join(REPO_ROOT, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.append(BACKEND_DIR)

SERVICES_DIR = os.path.join(BACKEND_DIR, "services")
if SERVICES_DIR not in sys.path:
    sys.path.insert(0, SERVICES_DIR)

os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017/humsyar_test")
os.environ.setdefault("ADMIN_ID", "999")
os.environ.setdefault("TELEGRAM_TOKEN", "123:TEST_TOKEN")

import backend.services.lecture_jobs as lj  # noqa: E402

FAKE_GOOGLE_KEY = "AIza" + "SyD3adB33fC0ffee0123456789abcdefXYZ"
FAKE_AQ_TOKEN = "AQ." + "Ab8RN6KxyzLMNOPqrstuvwxyz0123456789"
FAKE_BOT_TOKEN = "1234567890:" + "AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"


def run(coro):
    return asyncio.run(coro)


def make_col():
    col = MagicMock()
    col.insert_one = AsyncMock(return_value=MagicMock(inserted_id="x"))
    col.update_one = AsyncMock(return_value=MagicMock(modified_count=1))
    col.create_index = AsyncMock(return_value="idx")
    return col


class _Base(unittest.TestCase):
    def setUp(self):
        lj._indexes_ready = False
        lj._started_mono.clear()
        lj._last_alert.clear()
        self.col = make_col()
        self.p = patch.object(lj, "_get_collection", return_value=self.col)
        self.p.start()

    def tearDown(self):
        self.p.stop()


class TestPayloads(_Base):
    def test_job_started_insert_payload(self):
        files = [{"kind": "voice", "mime": "audio/ogg", "file_size": 12345,
                  "name": "x" * 200, "file_id": "SECRET_FILE_ID"}]
        run(lj.job_started("job1", 42, files))
        self.col.insert_one.assert_awaited_once()
        doc = self.col.insert_one.await_args.args[0]
        self.assertEqual(doc["job_id"], "job1")
        self.assertEqual(doc["user_id"], 42)
        self.assertEqual(doc["stage"], "started")
        self.assertEqual(doc["outcome"], "running")
        self.assertIsInstance(doc["started_at"], datetime)
        self.assertIsNotNone(doc["started_at"].tzinfo)
        self.assertEqual(len(doc["files"]), 1)
        f = doc["files"][0]
        self.assertEqual(set(f), {"kind", "mime", "file_size", "name"})
        self.assertEqual(len(f["name"]), 80)
        self.assertNotIn("SECRET_FILE_ID", str(doc))

    def test_indexes_created_once(self):
        run(lj.job_started("a", 1, []))
        run(lj.job_stage("a", "download"))
        self.assertEqual(self.col.create_index.await_count, 2)

    def test_index_failure_ignored(self):
        self.col.create_index = AsyncMock(side_effect=RuntimeError("no perms"))
        run(lj.job_started("a", 1, []))
        self.col.insert_one.assert_awaited_once()

    def test_job_stage_filters_extra_and_masks_raw_key(self):
        run(lj.job_stage("job1", "ai_call", model="gemini-2.5-flash",
                         key_masked=FAKE_GOOGLE_KEY, audio_bytes=1000,
                         mode="upload", api_key=FAKE_GOOGLE_KEY, evil="x"))
        flt, upd = self.col.update_one.await_args.args
        self.assertEqual(flt, {"job_id": "job1"})
        s = upd["$set"]
        self.assertEqual(s["stage"], "ai_call")
        self.assertIsInstance(s["stage_at"], datetime)
        self.assertEqual(s["model"], "gemini-2.5-flash")
        self.assertEqual(s["audio_bytes"], 1000)
        self.assertEqual(s["mode"], "upload")
        self.assertNotIn("api_key", s)
        self.assertNotIn("evil", s)
        self.assertNotIn(FAKE_GOOGLE_KEY, str(upd))
        self.assertTrue(s["key_masked"].startswith("AIza"))

    def test_job_finished_failed_payload(self):
        run(lj.job_started("j", 1, []))
        err = RuntimeError(f"400 for url ?key={FAKE_GOOGLE_KEY} " + "y" * 600)
        run(lj.job_finished("j", "failed", err, model="m1"))
        s = self.col.update_one.await_args.args[1]["$set"]
        self.assertEqual(s["outcome"], "failed")
        self.assertEqual(s["error_type"], "RuntimeError")
        self.assertLessEqual(len(s["error_text"]), 300)
        self.assertNotIn(FAKE_GOOGLE_KEY, s["error_text"])
        self.assertIsInstance(s["finished_at"], datetime)
        self.assertIsInstance(s["duration_sec"], float)
        self.assertEqual(s["model"], "m1")

    def test_job_finished_success_and_unknown_outcome(self):
        run(lj.job_finished("j", "success"))
        s = self.col.update_one.await_args.args[1]["$set"]
        self.assertEqual(s["outcome"], "success")
        self.assertIsNone(s["error_type"])
        self.assertIsNone(s["error_text"])
        run(lj.job_finished("j", "weird"))
        self.assertEqual(self.col.update_one.await_args.args[1]["$set"]["outcome"], "failed")

    def test_job_finished_timeout_explicit_duration(self):
        run(lj.job_finished("j", "timeout", asyncio.TimeoutError(), duration_sec=12.5))
        s = self.col.update_one.await_args.args[1]["$set"]
        self.assertEqual(s["outcome"], "timeout")
        self.assertEqual(s["duration_sec"], 12.5)
        self.assertEqual(s["error_type"], "TimeoutError")


class TestMaskingSanitize(unittest.TestCase):
    def test_mask_key(self):
        m = lj.mask_key(FAKE_GOOGLE_KEY)
        self.assertTrue(m.startswith(FAKE_GOOGLE_KEY[:4]))
        self.assertTrue(m.endswith(FAKE_GOOGLE_KEY[-4:]))
        self.assertNotIn(FAKE_GOOGLE_KEY[4:-4], m)
        self.assertEqual(lj.mask_key(""), "")
        self.assertEqual(lj.mask_key(None), "")
        self.assertNotIn("abc", lj.mask_key("abcdef"))

    def test_mask_key_fallback_when_ai_solver_unavailable(self):
        with patch.dict(sys.modules, {"backend.services.ai_solver": None}):
            m = lj.mask_key(FAKE_GOOGLE_KEY)
        self.assertEqual(m, FAKE_GOOGLE_KEY[:4] + "…" + FAKE_GOOGLE_KEY[-4:])

    def test_sanitize_strips_secrets(self):
        txt = (f"err key={FAKE_GOOGLE_KEY} tok {FAKE_AQ_TOKEN} "
               f"https://api.telegram.org/bot{FAKE_BOT_TOKEN}/sendMessage "
               f"raw {FAKE_GOOGLE_KEY}")
        out = lj.sanitize_error_text(txt)
        for secret in (FAKE_GOOGLE_KEY, FAKE_AQ_TOKEN, FAKE_BOT_TOKEN):
            self.assertNotIn(secret, out)
        self.assertIn("[REDACTED]", out)

    def test_sanitize_truncates_and_handles_none(self):
        self.assertLessEqual(len(lj.sanitize_error_text("z" * 1000)), 300)
        self.assertEqual(lj.sanitize_error_text(None), "")

    def test_failure_alert_text_escapes(self):
        err = ValueError(f"<script>bad</script> {FAKE_GOOGLE_KEY}")
        t = lj.failure_alert_text("<j&1>", 42, "<ai>", err, 3.14159)
        self.assertIn("&lt;j&amp;1&gt;", t)
        self.assertIn("&lt;ai&gt;", t)
        self.assertNotIn("<script>", t)
        self.assertNotIn(FAKE_GOOGLE_KEY, t)
        self.assertIn("ValueError", t)
        self.assertIn("3.1", t)
        self.assertIn("<b>", t)

    def test_failure_alert_text_bad_elapsed(self):
        t = lj.failure_alert_text("j", 1, "s", None, "nan?")
        self.assertIn("?", t)


class TestSwallowing(_Base):
    def test_db_exceptions_swallowed(self):
        self.col.insert_one = AsyncMock(side_effect=RuntimeError("mongo down"))
        self.col.update_one = AsyncMock(side_effect=ConnectionError("boom"))
        with self.assertLogs("backend.services.lecture_jobs", level="WARNING"):
            run(lj.job_started("j", 1, []))
            run(lj.job_stage("j", "x"))
            run(lj.job_finished("j", "failed", RuntimeError("e")))

    def test_get_collection_failure_swallowed(self):
        self.p.stop()
        with patch.object(lj, "_get_collection", side_effect=ImportError("no db")):
            run(lj.job_started("j", 1, []))
            self.assertEqual(run(lj.recent_failures()), [])
        self.p.start()

    def test_db_timeout_is_bounded(self):
        async def hang(*a, **k):
            await asyncio.sleep(10)
        self.col.update_one = AsyncMock(side_effect=hang)
        with patch.object(lj, "DB_TIMEOUT_SEC", 0.05):
            loop = asyncio.new_event_loop()
            try:
                t0 = loop.time()
                loop.run_until_complete(lj.job_stage("j", "x"))
                self.assertLess(loop.time() - t0, 2.0)
            finally:
                loop.close()

    def test_bad_inputs_do_not_raise(self):
        run(lj.job_started("j", "not-int", "not-a-list"))
        run(lj.job_started("j", None, [None, 5, {"file_size": "abc"}]))
        run(lj.job_stage(None, None, model=object()))

    def test_recent_failures(self):
        cur = MagicMock()
        cur.sort.return_value = cur
        cur.limit.return_value = cur
        cur.to_list = AsyncMock(return_value=[{"job_id": "a", "outcome": "failed"}])
        self.col.find = MagicMock(return_value=cur)
        res = run(lj.recent_failures(5))
        self.assertEqual(res, [{"job_id": "a", "outcome": "failed"}])
        q = self.col.find.call_args.args[0]
        self.assertEqual(q, {"outcome": {"$in": ["failed", "timeout"]}})
        cur.limit.assert_called_with(5)


class TestAlerts(unittest.TestCase):
    def setUp(self):
        lj._last_alert.clear()

    def test_rate_limit_same_error_type(self):
        bot = MagicMock()
        bot.send_message = AsyncMock()
        with patch.dict(os.environ, {"ADMIN_ID": "999"}):
            run(lj.alert_admins(bot, "<b>a</b>", error_type="AIError"))
            run(lj.alert_admins(bot, "<b>b</b>", error_type="AIError"))
            self.assertEqual(bot.send_message.await_count, 1)
            run(lj.alert_admins(bot, "<b>c</b>", error_type="TimeoutError"))
            self.assertEqual(bot.send_message.await_count, 2)
        kw = bot.send_message.await_args_list[0].kwargs
        self.assertEqual(kw["chat_id"], 999)
        self.assertEqual(kw["parse_mode"], "HTML")

    def test_rate_limit_expires(self):
        bot = MagicMock()
        bot.send_message = AsyncMock()
        with patch.dict(os.environ, {"ADMIN_ID": "999"}):
            run(lj.alert_admins(bot, "x", error_type="E"))
            run(lj.alert_admins(bot, "x", error_type="E"))   # suppressed
            self.assertEqual(bot.send_message.await_count, 1)
            # simulate 61s passing (don't patch time.monotonic: the event loop uses it)
            lj._last_alert["type:E"] -= lj.ALERT_COOLDOWN_SEC + 1
            run(lj.alert_admins(bot, "x", error_type="E"))
        self.assertEqual(bot.send_message.await_count, 2)

    def test_multiple_admins_one_failing(self):
        sent = []

        async def send(chat_id, **kw):
            if chat_id == 222:
                raise RuntimeError("Forbidden: bot was blocked")
            sent.append(chat_id)

        bot = MagicMock()
        bot.send_message = AsyncMock(side_effect=send)
        with patch.dict(os.environ, {"ADMIN_ID": "111, 222,333"}):
            self.assertEqual(lj.get_admin_ids(), [111, 222, 333])
            run(lj.alert_admins(bot, "alert", error_type="X"))
        self.assertEqual(sorted(sent), [111, 333])
        self.assertEqual(bot.send_message.await_count, 3)

    def test_alert_send_timeout_bounded(self):
        async def hang(**kw):
            await asyncio.sleep(10)

        bot = MagicMock()
        bot.send_message = AsyncMock(side_effect=hang)
        with patch.dict(os.environ, {"ADMIN_ID": "1,2"}), \
                patch.object(lj, "SEND_TIMEOUT_SEC", 0.05):
            run(lj.alert_admins(bot, "t", error_type="Y"))

    def test_alert_no_bot_no_admins_safe(self):
        run(lj.alert_admins(None, "t"))
        bot = MagicMock()
        bot.send_message = AsyncMock()
        with patch.dict(os.environ, {"ADMIN_ID": ""}):
            run(lj.alert_admins(bot, "t", error_type="Z"))
        bot.send_message.assert_not_awaited()
        with patch.dict(os.environ, {"ADMIN_ID": "abc,0"}):
            self.assertEqual(lj.get_admin_ids(), [])


if __name__ == "__main__":
    unittest.main()
