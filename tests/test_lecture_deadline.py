# -*- coding: utf-8 -*-
"""Phase 3 — AI-stage deadline and heartbeat.

A hung Gemini call must end in a clear Persian timeout message with the quota
refunded, and the user must see periodic "still working" updates meanwhile.
"""
import asyncio
import json as json_lib
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import httpx  # noqa: E402

from test_e2e_ai_reliability import K_VAULT_1, SAMPLE_LECTURE_DIGEST  # noqa: E402
import backend.services.ai_solver as ai_solver  # noqa: E402
from backend.services import lecture_scribe as ls  # noqa: E402


def _patched(fn):
    for p in reversed([
        patch("database.db.op_claim", AsyncMock(return_value=True)),
        patch("database.db.op_release", AsyncMock(return_value=True)),
        patch("ai_solver.refund_lecture_quota", new_callable=AsyncMock),
        patch("backend.services.telegram_downloader.download_telegram_media", new_callable=AsyncMock),
        patch("backend.services.lecture_scribe.transcode_audio_file", new_callable=AsyncMock),
        patch("ai_solver.get_ai_config", new_callable=AsyncMock),
    ]):
        fn = p(fn)
    return fn


def _slow_post(delay: float):
    async def _mock_post(client, url, headers=None, json=None, **kwargs):
        await asyncio.sleep(delay)
        return httpx.Response(
            200,
            text=json_lib.dumps({"candidates": [{"content": {"parts": [{"text": json_lib.dumps(SAMPLE_LECTURE_DIGEST)}]}}]}),
            request=httpx.Request("POST", url),
        )
    return _mock_post


class TestDeadlineAndHeartbeat(unittest.TestCase):
    def setUp(self):
        ai_solver._KEY_STATE.clear()
        ai_solver._busy_users.clear()
        tmp = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
        tmp.write(b"dummy audio content")
        tmp.close()
        self.audio = tmp.name
        self.addCleanup(lambda: os.path.exists(self.audio) and os.unlink(self.audio))

    def tearDown(self):
        ai_solver._KEY_STATE.clear()
        ai_solver._busy_users.clear()

    def _prime(self, mock_cfg, mock_transcode, mock_download):
        mock_download.return_value = self.audio
        mock_transcode.return_value = self.audio
        mock_cfg.return_value = {"vault_multi": {"gemini": [K_VAULT_1]}, "provider": "gemini"}

    def _run(self, bot, uid, delay):
        session = {"files": [{"kind": "audio", "name": "lecture.m4a", "tg_file_id": "aud_1"}]}
        with patch.object(httpx.AsyncClient, "post", _slow_post(delay)):
            return asyncio.run(ls.run_lecture_processing_worker(
                bot=bot, chat_id=4242, uid=uid, session=session, status_msg_id=900,
            ))

    @_patched
    def test_deadline_gives_timeout_message_and_refund(self, mock_cfg, mock_transcode, mock_download, mock_refund):
        self._prime(mock_cfg, mock_transcode, mock_download)
        bot = AsyncMock()
        with patch.object(ls, "_lecture_ai_deadline_sec", return_value=0.3), \
             patch.object(ls, "LECTURE_HEARTBEAT_SEC", 10):
            self.assertFalse(self._run(bot, 99201, delay=5))
        mock_refund.assert_called_once_with(99201)
        bot.send_document.assert_not_called()
        texts = [c.kwargs.get("text", "") for c in bot.edit_message_text.call_args_list]
        self.assertTrue(any("زمان مجاز" in t and "کسر نگردید" in t for t in texts), texts)

    @_patched
    def test_heartbeat_updates_during_long_ai_call(self, mock_cfg, mock_transcode, mock_download, mock_refund):
        self._prime(mock_cfg, mock_transcode, mock_download)
        bot = AsyncMock()
        with patch.object(ls, "LECTURE_HEARTBEAT_SEC", 0.05):
            self.assertTrue(self._run(bot, 99202, delay=0.6))
        mock_refund.assert_not_called()
        bot.send_document.assert_called_once()

    def test_deadline_env_parsing(self):
        with patch.dict(os.environ, {"LECTURE_AI_DEADLINE_SEC": "5"}):
            self.assertEqual(ls._lecture_ai_deadline_sec(), 60.0)
        with patch.dict(os.environ, {"LECTURE_AI_DEADLINE_SEC": "bad"}):
            self.assertEqual(ls._lecture_ai_deadline_sec(), 900.0)
        with patch.dict(os.environ, {"LECTURE_AI_DEADLINE_SEC": "1200"}):
            self.assertEqual(ls._lecture_ai_deadline_sec(), 1200.0)

    def test_deadline_message(self):
        msg = ls.format_persian_lecture_error(ls.LectureDeadlineError("x"))
        self.assertIn("⏱", msg)
        self.assertIn("کسر نگردید", msg)


if __name__ == "__main__":
    unittest.main()
