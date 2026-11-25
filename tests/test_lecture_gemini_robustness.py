# -*- coding: utf-8 -*-
"""Phase 2 — Gemini robustness for the lecture pipeline.

- output-token budget is configurable and bounded
- MAX_TOKENS → one retry on the same model with the maximum budget
- persistent MAX_TOKENS → LectureOutputTooLongError, which must NOT rotate keys
- inline audio stays under Gemini's 20MB request limit after base64
"""
import asyncio
import json as json_lib
import os
import sys
import unittest
from unittest.mock import patch

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for _p in (REPO_ROOT, os.path.join(REPO_ROOT, "backend", "services")):
    if _p not in sys.path:
        sys.path.insert(0, _p)
os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017/humsyar_test_ai_rel")
os.environ.setdefault("ADMIN_ID", "999")
os.environ.setdefault("TELEGRAM_TOKEN", "123:TEST_TOKEN")
os.environ.setdefault("TZ", "Asia/Tehran")

import httpx  # noqa: E402

import backend.services.ai_solver as ai_solver  # noqa: E402
from backend.services import lecture_scribe as ls  # noqa: E402


def _resp(payload: dict, status: int = 200) -> httpx.Response:
    return httpx.Response(status, text=json_lib.dumps(payload),
                          request=httpx.Request("POST", "https://example.invalid"))


def _candidate(text: str, reason: str = "STOP") -> dict:
    return {"candidates": [{"finishReason": reason, "content": {"parts": [{"text": text}]}}]}


DIGEST = {"title": "قلب", "subject": "فیزیولوژی"}


class TestOutputBudget(unittest.TestCase):
    def test_default_and_bounds(self):
        self.assertEqual(ls._lecture_output_tokens(None), ls.LECTURE_DEFAULT_OUTPUT_TOKENS)
        self.assertEqual(ls._lecture_output_tokens({"lecture_max_output_tokens": 10}), 4096)
        self.assertEqual(ls._lecture_output_tokens({"lecture_max_output_tokens": 10 ** 9}),
                         ls.LECTURE_MAX_OUTPUT_TOKENS_CAP)
        self.assertEqual(ls._lecture_output_tokens({"lecture_max_output_tokens": "bad"}),
                         ls.LECTURE_DEFAULT_OUTPUT_TOKENS)

    def test_inline_audio_fits_request_limit_after_base64(self):
        self.assertLess(ls.LECTURE_INLINE_AUDIO_MAX_BYTES * 4 / 3, 20 * 1024 * 1024)


class TestMaxTokensHandling(unittest.TestCase):
    payload = {"generationConfig": {"maxOutputTokens": 32768}}

    def test_retry_with_max_budget_then_success(self):
        sent = []

        async def _post(client, url, headers=None, json=None, **kw):
            sent.append(json["generationConfig"]["maxOutputTokens"])
            return _resp(_candidate(json_lib.dumps(DIGEST)))

        first = _resp(_candidate('{"title": "نیمه', reason="MAX_TOKENS"))
        with patch.object(httpx.AsyncClient, "post", _post):
            out = asyncio.run(ls._lecture_digest_from_response(first, self.payload, "u", {}))
        self.assertEqual(out["title"], "قلب")
        self.assertEqual(sent, [ls.LECTURE_MAX_OUTPUT_TOKENS_CAP])

    def test_persistent_max_tokens_raises_specific_error(self):
        async def _post(client, url, headers=None, json=None, **kw):
            return _resp(_candidate("...", reason="MAX_TOKENS"))

        first = _resp(_candidate("...", reason="MAX_TOKENS"))
        with patch.object(httpx.AsyncClient, "post", _post):
            with self.assertRaises(ls.LectureOutputTooLongError):
                asyncio.run(ls._lecture_digest_from_response(first, self.payload, "u", {}))

    def test_too_long_error_does_not_rotate_keys(self):
        self.assertIsNone(ai_solver.classify_key_error(ls.LectureOutputTooLongError("x")))

        calls = []

        async def factory(key):
            calls.append(key)
            raise ls.LectureOutputTooLongError("too long")

        with self.assertRaises(ls.LectureOutputTooLongError):
            asyncio.run(ai_solver.run_with_key_failover("gemini", ["k1-aaaaaaaaaaaa", "k2-bbbbbbbbbbbb"], factory))
        self.assertEqual(len(calls), 1)
        ai_solver._KEY_STATE.clear()

    def test_persian_message_for_too_long(self):
        msg = ls.format_persian_lecture_error(ls.LectureOutputTooLongError("x"))
        self.assertIn("کسر نگردید", msg)
        self.assertIn("طولانی", msg)


if __name__ == "__main__":
    unittest.main()
