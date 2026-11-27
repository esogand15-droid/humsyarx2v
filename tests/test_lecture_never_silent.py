# -*- coding: utf-8 -*-
"""Regression: the lecture pipeline must never end silently.

Before the fix the status message was deleted *before* the PDF was sent, so a
later failure tried to edit a message that no longer existed and the user saw
nothing. Now: PDF first, then summary, then status deletion; and every final
error falls back to a fresh send_message when the status edit fails.
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
from telegram.error import BadRequest  # noqa: E402

from test_e2e_ai_reliability import K_VAULT_1, SAMPLE_LECTURE_DIGEST  # noqa: E402
import backend.services.ai_solver as ai_solver  # noqa: E402
from backend.services.lecture_scribe import run_lecture_processing_worker  # noqa: E402


def _ok_post():
    async def _mock_post(client, url, headers=None, json=None, **kwargs):
        return httpx.Response(
            200,
            text=json_lib.dumps({"candidates": [{"content": {"parts": [{"text": json_lib.dumps(SAMPLE_LECTURE_DIGEST)}]}}]}),
            request=httpx.Request("POST", url),
        )
    return _mock_post


def _patched(fn):
    for p in reversed([
        patch("backend.database.database.db.op_claim", AsyncMock(return_value=True)),
        patch("backend.database.database.db.op_release", AsyncMock(return_value=True)),
        patch("backend.services.ai_solver.refund_lecture_quota", new_callable=AsyncMock),
        patch("backend.services.telegram_downloader.download_telegram_media", new_callable=AsyncMock),
        patch("backend.services.lecture_scribe.transcode_audio_file", new_callable=AsyncMock),
        patch("backend.services.ai_solver.get_ai_config", new_callable=AsyncMock),
    ]):
        fn = p(fn)
    return fn


class TestLectureNeverSilent(unittest.TestCase):
    def setUp(self):
        ai_solver._KEY_STATE.clear()
        ai_solver._busy_users.clear()
        tmp = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
        tmp.write(b"dummy audio content")
        tmp.close()
        self.audio = tmp.name
        self.addCleanup(lambda: os.path.exists(self.audio) and os.unlink(self.audio))
        self.session = {"files": [{"kind": "audio", "name": "lecture.m4a", "tg_file_id": "aud_1"}]}

    def tearDown(self):
        ai_solver._KEY_STATE.clear()
        ai_solver._busy_users.clear()

    def _prime(self, mock_cfg, mock_transcode, mock_download):
        mock_download.return_value = self.audio
        mock_transcode.return_value = self.audio
        mock_cfg.return_value = {"vault_multi": {"gemini": [K_VAULT_1]}, "provider": "gemini"}

    def _run(self, bot, uid):
        with patch.object(httpx.AsyncClient, "post", _ok_post()):
            return asyncio.run(run_lecture_processing_worker(
                bot=bot, chat_id=4242, uid=uid, session=dict(self.session), status_msg_id=900,
            ))

    @_patched
    def test_success_sends_pdf_before_deleting_status(self, mock_cfg, mock_transcode, mock_download, mock_refund):
        self._prime(mock_cfg, mock_transcode, mock_download)
        order = []
        bot = AsyncMock()
        bot.send_document = AsyncMock(side_effect=lambda **kw: order.append("send_document"))
        bot.send_message = AsyncMock(side_effect=lambda **kw: order.append("send_message"))
        bot.delete_message = AsyncMock(side_effect=lambda **kw: order.append("delete_message"))

        self.assertTrue(self._run(bot, 99101))
        mock_refund.assert_not_called()
        self.assertEqual(order.index("send_document"), 0)
        self.assertLess(order.index("send_document"), order.index("delete_message"))

    @_patched
    def test_pdf_send_failure_keeps_status_and_shows_error(self, mock_cfg, mock_transcode, mock_download, mock_refund):
        self._prime(mock_cfg, mock_transcode, mock_download)
        bot = AsyncMock()
        bot.send_document = AsyncMock(side_effect=RuntimeError("telegram upload failed"))
        bot.delete_message = AsyncMock()
        bot.edit_message_text = AsyncMock()

        with patch("asyncio.sleep", AsyncMock()):
            self.assertFalse(self._run(bot, 99102))
        mock_refund.assert_called_once_with(99102)
        bot.delete_message.assert_not_called()
        texts = [c.kwargs.get("text", "") for c in bot.edit_message_text.call_args_list]
        self.assertTrue(any("سهمیه" in t for t in texts), texts)

    @_patched
    def test_uneditable_status_falls_back_to_new_message(self, mock_cfg, mock_transcode, mock_download, mock_refund):
        self._prime(mock_cfg, mock_transcode, mock_download)
        bot = AsyncMock()
        bot.send_document = AsyncMock(side_effect=RuntimeError("telegram upload failed"))
        bot.edit_message_text = AsyncMock(side_effect=BadRequest("Message to edit not found"))
        bot.send_message = AsyncMock()

        with patch("asyncio.sleep", AsyncMock()):
            self.assertFalse(self._run(bot, 99103))
        mock_refund.assert_called_once_with(99103)
        texts = [c.kwargs.get("text", "") for c in bot.send_message.call_args_list]
        self.assertTrue(any("سهمیه" in t for t in texts), texts)


if __name__ == "__main__":
    unittest.main()
