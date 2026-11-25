# -*- coding: utf-8 -*-
"""Regression: two lecture failure paths that used to end with no message.

1. Queue recovery only notified the user through ``job.updater``. A job
   enqueued without one got its quota refunded but never heard about the error.
2. If ``format_persian_lecture_error`` itself raised, the worker skipped
   ``_notify_user`` entirely.
"""
import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import test_e2e_ai_reliability  # noqa: E402,F401  (sets up import paths like the other lecture tests)
import backend.services.lecture_scribe as scribe  # noqa: E402
from backend.services.lecture_worker import LectureJob, LectureWorkerQueue  # noqa: E402


def _bot(edit_fails: bool):
    bot = AsyncMock()
    if edit_fails:
        bot.edit_message_text.side_effect = RuntimeError("message to edit not found")
    return bot


def _job(bot, **kw):
    base = dict(
        job_id="j1", chat_id=111, user_id=222, session_id="ls_test",
        file_info={}, status_message_id=333, bot=bot, quota_consumed=False,
    )
    base.update(kw)
    return LectureJob(**base)


async def _boom(**_kwargs):
    raise RuntimeError("processor crashed")


class TestQueueRecoveryNeverSilent(unittest.TestCase):
    def test_job_without_updater_still_gets_error_message(self):
        bot = _bot(edit_fails=True)
        queue = LectureWorkerQueue(processor=_boom)
        asyncio.run(queue._process_job(_job(bot)))
        bot.send_message.assert_awaited()
        text = bot.send_message.await_args.kwargs.get("text", "")
        self.assertIn("سهمیه", text)

    def test_job_without_updater_edits_status_when_possible(self):
        bot = _bot(edit_fails=False)
        queue = LectureWorkerQueue(processor=_boom)
        asyncio.run(queue._process_job(_job(bot)))
        bot.edit_message_text.assert_awaited()
        bot.send_message.assert_not_awaited()


class TestWorkerFormatterFailure(unittest.TestCase):
    def test_formatter_crash_still_notifies_and_refunds_once(self):
        bot = _bot(edit_fails=False)
        refund = AsyncMock()
        with patch("backend.services.ai_solver.ai_is_inflight", AsyncMock(return_value=True)), \
             patch("backend.services.ai_solver.ai_release_inflight", AsyncMock()), \
             patch("backend.services.ai_solver.refund_lecture_quota", refund), \
             patch("backend.services.ai_solver.get_ai_config", AsyncMock(side_effect=RuntimeError("config down"))), \
             patch.object(scribe, "_lecture_jobs_enabled", lambda: False), \
             patch.object(scribe, "format_persian_lecture_error", side_effect=ValueError("formatter bug")):
            ok = asyncio.run(scribe.run_lecture_processing_worker(
                bot=bot, chat_id=111, uid=222, status_msg_id=0,
                session={"session_id": "ls_fmt", "files": [{"kind": "audio", "file_id": "x"}]},
            ))
        self.assertFalse(ok)
        bot.send_message.assert_awaited()
        self.assertIn("خطایی", bot.send_message.await_args.kwargs.get("text", ""))
        self.assertEqual(refund.await_count, 1)


if __name__ == "__main__":
    unittest.main()
