# -*- coding: utf-8 -*-
"""⏳ STABILITY T1/T2 — signed reader/media URLs must outlive a real study session.

Before: PDF page tokens expired after 600 s, so a student reading for more
than 10 minutes got broken pages. These tests pin the contract:

  • READER_URL_TTL_SEC defaults to 3 hours and is env-overridable (clamped).
  • The manifest carries additive `expires_in` / `expires_at` fields and every
    page/thumbnail URL is signed with that same expiry.
  • Media preview links (also used by the MTProto >20MB streamer, which sits
    behind the same /preview endpoint) live at least 3 hours.
"""
from __future__ import annotations

import os
import re
import time
import unittest
from unittest import mock

os.environ.setdefault("MONGODB_URI", "mongodb://localhost:27017/x")

from fastapi.testclient import TestClient  # noqa: E402

from backend.api.main import app  # noqa: E402
from backend.api.routers import web_reader  # noqa: E402
from backend.api.routers.web_student import current_student  # noqa: E402

THREE_HOURS = 3 * 3600


class ReaderTtlConstantTests(unittest.TestCase):
    def test_default_is_three_hours(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("READER_URL_TTL_SEC", None)
            self.assertEqual(web_reader._reader_url_ttl(), THREE_HOURS)

    def test_env_override_and_clamping(self):
        with mock.patch.dict(os.environ, {"READER_URL_TTL_SEC": "7200"}):
            self.assertEqual(web_reader._reader_url_ttl(), 7200)
        with mock.patch.dict(os.environ, {"READER_URL_TTL_SEC": "5"}):
            self.assertEqual(web_reader._reader_url_ttl(), 300)
        with mock.patch.dict(os.environ, {"READER_URL_TTL_SEC": "999999"}):
            self.assertEqual(web_reader._reader_url_ttl(), 86400)
        with mock.patch.dict(os.environ, {"READER_URL_TTL_SEC": "abc"}):
            self.assertEqual(web_reader._reader_url_ttl(), THREE_HOURS)

    def test_module_constant_not_ten_minutes(self):
        self.assertGreaterEqual(web_reader.READER_URL_TTL_SEC, THREE_HOURS)


class MediaPreviewTtlTests(unittest.TestCase):
    def test_preview_ttl_at_least_three_hours(self):
        from backend.api.telegram_send import PREVIEW_TTL_SEC
        self.assertGreaterEqual(PREVIEW_TTL_SEC, THREE_HOURS)

    def test_mtproto_streamer_has_no_separate_short_signature(self):
        """The >20MB MTProto path is served by the same signed /preview endpoint;
        media_stream must not mint its own short-lived URL tokens."""
        from pathlib import Path
        src = (Path(__file__).resolve().parent.parent / "backend" / "services" / "media_stream.py").read_text(encoding="utf-8")
        self.assertNotIn("preview_token(", src)
        self.assertNotIn("expires_in", src)


class ManifestExpiryContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        app.dependency_overrides[current_student] = lambda: {"user_id": 4242, "name": "Tester"}
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        app.dependency_overrides.pop(current_student, None)

    def test_manifest_has_additive_expiry_and_signed_urls_match(self):
        before = int(time.time())
        resp = self.client.get("/api/web/reader/manifest/res/demo")
        self.assertEqual(resp.status_code, 200, resp.text[:300])
        data = resp.json()
        # additive fields
        self.assertEqual(data["expires_in"], web_reader.READER_URL_TTL_SEC)
        self.assertGreaterEqual(data["expires_at"], before + THREE_HOURS - 5)
        # legacy fields untouched
        self.assertIn("page_dimensions", data)
        self.assertIn("total_pages", data)
        for dim in data["page_dimensions"]:
            m = re.search(r"[?&]expires=(\d+)", dim["url"])
            self.assertIsNotNone(m)
            self.assertEqual(int(m.group(1)), data["expires_at"])
            self.assertIn(f"expires={data['expires_at']}", dim["thumbnail_url"])

    def test_page_token_still_valid_after_ten_minutes(self):
        data = self.client.get("/api/web/reader/manifest/res/demo").json()
        url = data["page_dimensions"][0]["url"]
        token = re.search(r"token=([0-9a-f]+)", url).group(1)
        expires = int(re.search(r"expires=(\d+)", url).group(1))
        later = time.time() + 11 * 60
        with mock.patch("time.time", return_value=later):
            self.assertTrue(web_reader.verify_page_token(token, 4242, "demo", 1, expires))


if __name__ == "__main__":
    unittest.main()
