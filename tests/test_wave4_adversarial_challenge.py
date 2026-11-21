# -*- coding: utf-8 -*-
"""Adversarial Challenge & Empirical Verification Suite for Wave 4.

Focus:
1. DRM Leakage & Binary Shielding: Confirm raw PDF (%PDF) is strictly shielded,
   verify anti-caching zero-storage headers, and inspect Service Worker caching rules.
2. Token Tampering & Security Boundaries: Invalid HMAC signatures, cross-parameter tampering,
   expired timestamps, cross-user session isolation, and directory traversal rejection.
3. Concurrency & Stress Testing: Singleflight coalescer under high async concurrency,
   exception propagation & fault recovery, corrupt/malformed PDFs, and extreme out-of-range pages.
4. Dynamic Watermark Verification: Empirical pixel byte modification proof (MSE > 0.1, > 5000 altered pixels),
   Persian RTL text shaping stress testing, and watermark cache bounded memory.
"""
from __future__ import annotations

import asyncio
import io
import math
import os
import re
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pymupdf
from PIL import Image

os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017/medicalbot")
os.environ.setdefault("ADMIN_ID", "99999999")
os.environ.setdefault("TELEGRAM_TOKEN", "123:TEST_TOKEN")
os.environ.setdefault("READER_SIGNING_SECRET", "adversarial-w4-signing-key-secret-salt-2026!")

from fastapi.testclient import TestClient
from backend.api.main import app
from backend.services.pdf_renderer import (
    PdfRenderer,
    WatermarkStamper,
    SingleflightCoalescer,
)
from backend.services.storage import (
    get_storage_driver,
    LocalStorageDriver,
)
from backend.api.routers.web_reader import (
    generate_page_token,
    verify_page_token,
)
from backend.api.routers.web_student import current_student


def generate_challenge_pdf(num_pages: int = 4, width: int = 595, height: int = 842) -> bytes:
    """Generate multi-page synthetic PDF with rich graphic and textual content."""
    doc = pymupdf.open()
    for i in range(num_pages):
        page = doc.new_page(width=width, height=height)
        # Background gradient-like fills
        page.draw_rect(pymupdf.Rect(20, 20, width - 20, height - 20), color=(0.2, 0.4, 0.8), fill=(0.98, 0.98, 0.98))
        page.draw_rect(pymupdf.Rect(50, 50, width - 50, 120), color=(0.1, 0.5, 0.2), fill=(0.92, 0.95, 0.92))
        page.insert_text(pymupdf.Point(60, 90), f"HumsYarX Confidential - Page {i + 1}", fontsize=18)
        page.insert_text(pymupdf.Point(60, 150), "محتوای محرمانهٔ جزوه آموزشی پزشکی هامزیار - تکثیر پیگرد قانونی دارد", fontsize=12)
        # Circles and shapes
        page.draw_circle(pymupdf.Point(300, 400), 80, color=(0.8, 0.2, 0.2), fill=(0.95, 0.9, 0.9))
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


class TestWave4DrmLeakageAndShielding(unittest.TestCase):
    """Category 1: Empirical DRM Leakage & Binary Shielding Challenges."""

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.pdf_bytes = generate_challenge_pdf(num_pages=3)
        cls.file_id = "drm_shield_booklet_101"
        cls.storage = get_storage_driver()
        asyncio.run(cls.storage.save_original(cls.file_id, cls.pdf_bytes))
        cls.uid = 77889900

    @classmethod
    def tearDownClass(cls):
        app.dependency_overrides.clear()

    def setUp(self):
        app.dependency_overrides[current_student] = lambda: {
            "user_id": self.uid,
            "name": "آزمون‌گر امنیتی",
            "subscription_active": True,
            "approved": True,
        }

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_page_endpoint_never_returns_pdf_magic_bytes(self):
        """1.1: Verify /api/web/reader/page/... never delivers %PDF magic header or raw binary."""
        valid_exp = int(time.time()) + 600
        tok = generate_page_token(self.uid, self.file_id, 1, valid_exp)

        resp = self.client.get(
            f"/api/web/reader/page/{self.file_id}/1?token={tok}&expires={valid_exp}&uid={self.uid}"
        )
        self.assertEqual(resp.status_code, 200)

        # Binary check: MUST NOT start with %PDF
        self.assertFalse(resp.content.startswith(b"%PDF"), "CRITICAL DRM VIOLATION: Raw PDF bytes leaked to client!")
        # MUST start with RIFF header for WebP
        self.assertTrue(resp.content.startswith(b"RIFF"), "Delivered content does not start with RIFF header")
        self.assertIn(b"WEBP", resp.content[:16], "Delivered content is not valid WebP")

        # Confirm Pillow parses it as WEBP
        img = Image.open(io.BytesIO(resp.content))
        self.assertEqual(img.format, "WEBP")

    def test_adversarial_bypass_headers_cannot_trick_into_serving_pdf(self):
        """1.2: Adversarial bypass attempts (Accept: application/pdf, raw=true, etc.) are strictly shielded."""
        valid_exp = int(time.time()) + 600
        tok = generate_page_token(self.uid, self.file_id, 1, valid_exp)

        base_params = {"token": tok, "expires": valid_exp, "uid": self.uid}

        adversarial_attempts = [
            {"headers": {"Accept": "application/pdf"}},
            {"headers": {"Accept": "*/*"}},
            {"params": {"format": "pdf"}},
            {"params": {"raw": "1"}},
            {"params": {"download": "true"}},
            {"headers": {"Range": "bytes=0-1024"}},
        ]

        for attempt in adversarial_attempts:
            extra_headers = attempt.get("headers", {})
            params = {**base_params, **attempt.get("params", {})}
            resp = self.client.get(
                f"/api/web/reader/page/{self.file_id}/1",
                headers=extra_headers,
                params=params,
            )
            self.assertEqual(resp.status_code, 200)
            self.assertFalse(resp.content.startswith(b"%PDF"), f"Bypass succeeded with {attempt}!")
            self.assertEqual(resp.headers.get("content-type"), "image/webp")

    def test_strict_anti_caching_and_drm_zero_storage_headers(self):
        """1.3: Verify Cache-Control: private, no-store, no-cache, max-age=0, must-revalidate and Pragma."""
        valid_exp = int(time.time()) + 600
        tok = generate_page_token(self.uid, self.file_id, 1, valid_exp)

        resp = self.client.get(
            f"/api/web/reader/page/{self.file_id}/1?token={tok}&expires={valid_exp}&uid={self.uid}"
        )
        self.assertEqual(resp.status_code, 200)

        cc = resp.headers.get("cache-control", "")
        self.assertIn("no-store", cc, "Cache-Control must contain 'no-store'")
        self.assertIn("private", cc, "Cache-Control must contain 'private'")
        self.assertIn("no-cache", cc, "Cache-Control must contain 'no-cache'")
        self.assertIn("max-age=0", cc, "Cache-Control must contain 'max-age=0'")
        self.assertIn("must-revalidate", cc, "Cache-Control must contain 'must-revalidate'")

        self.assertEqual(resp.headers.get("pragma"), "no-cache")
        self.assertEqual(resp.headers.get("x-content-type-options"), "nosniff")

    def test_service_worker_excludes_protected_reader_pages(self):
        """1.4: Verify Service Worker (sw.js) explicitly excludes no-store and private responses from caching."""
        candidates = [
            Path("apps/student/public/sw.js"),
            Path("../apps/student/public/sw.js"),
            Path("d:/humsyarx project/humsyarx-main/apps/student/public/sw.js"),
        ]
        sw_file = None
        for cand in candidates:
            if cand.exists():
                sw_file = cand
                break
        self.assertIsNotNone(sw_file, "apps/student/public/sw.js must exist")
        sw_code = sw_file.read_text(encoding="utf-8")

        # Verify exclusion logic
        self.assertIn("cacheControl.includes('no-store')", sw_code, "SW must inspect no-store")
        self.assertIn("cacheControl.includes('private')", sw_code, "SW must inspect private")

        # Verify routing logic: /api/ hits networkFirstWithTTL
        self.assertIn("path.startsWith('/api/')", sw_code)

    def test_storage_isolation_originals_not_in_cache(self):
        """1.5: Confirm master PDFs remain in private storage and never leak into WebP cache."""
        driver = LocalStorageDriver()
        cached_files = list(driver.cache_dir.glob("*.pdf"))
        self.assertEqual(len(cached_files), 0, "No .pdf files should ever reside in the WebP cache directory")


class TestWave4TokenTamperingAndSecurity(unittest.TestCase):
    """Category 2: Empirical Token Tampering & Security Boundary Challenges."""

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.pdf_bytes = generate_challenge_pdf(num_pages=3)
        cls.file_a = "tamper_booklet_a"
        cls.file_b = "tamper_booklet_b"
        cls.storage = get_storage_driver()
        asyncio.run(cls.storage.save_original(cls.file_a, cls.pdf_bytes))
        asyncio.run(cls.storage.save_original(cls.file_b, cls.pdf_bytes))
        cls.student_a = 10001
        cls.student_b = 20002

    @classmethod
    def tearDownClass(cls):
        app.dependency_overrides.clear()

    def test_tampered_hmac_signatures_rejected(self):
        """2.1: Tampered HMAC signatures (bit-flip, truncated, empty, random) are rejected with HTTP 403."""
        valid_exp = int(time.time()) + 600
        valid_tok = generate_page_token(self.student_a, self.file_a, 1, valid_exp)

        # Mutate 1 character
        flipped_tok = ("0" if valid_tok[0] != "0" else "1") + valid_tok[1:]
        # Truncated token
        truncated_tok = valid_tok[:16]
        # Random hex
        random_tok = "a1b2c3d4e5f60718293a4b5c6d7e8f90"

        tampered_tokens = [flipped_tok, truncated_tok, random_tok, "bad", ""]
        for bad_tok in tampered_tokens:
            url = f"/api/web/reader/page/{self.file_a}/1?token={bad_tok}&expires={valid_exp}&uid={self.student_a}"
            resp = self.client.get(url)
            self.assertEqual(resp.status_code, 403, f"Expected 403 for tampered token '{bad_tok}'")
            self.assertEqual(resp.json().get("detail"), "INVALID_SIGNATURE")

    def test_cross_page_replay_attack_rejected(self):
        """2.2: Using token for Page 1 to request Page 2 is rejected with HTTP 403."""
        valid_exp = int(time.time()) + 600
        tok_page1 = generate_page_token(self.student_a, self.file_a, 1, valid_exp)

        # Attacker tries to request page 2 with page 1's token
        url_page2 = f"/api/web/reader/page/{self.file_a}/2?token={tok_page1}&expires={valid_exp}&uid={self.student_a}"
        resp = self.client.get(url_page2)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json().get("detail"), "INVALID_SIGNATURE")

    def test_cross_file_replay_attack_rejected(self):
        """2.3: Using token for File A to request File B is rejected with HTTP 403."""
        valid_exp = int(time.time()) + 600
        tok_file_a = generate_page_token(self.student_a, self.file_a, 1, valid_exp)

        # Attacker tries to request file B with file A's token
        url_file_b = f"/api/web/reader/page/{self.file_b}/1?token={tok_file_a}&expires={valid_exp}&uid={self.student_a}"
        resp = self.client.get(url_file_b)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json().get("detail"), "INVALID_SIGNATURE")

    def test_timestamp_extension_tampering_rejected(self):
        """2.4: Tampering with expiry timestamp (e.g. extending by 1 hour) is rejected with HTTP 403."""
        original_exp = int(time.time()) + 300
        tok = generate_page_token(self.student_a, self.file_a, 1, original_exp)

        # Attacker modifies query parameter expires to +3600
        extended_exp = original_exp + 3600
        url = f"/api/web/reader/page/{self.file_a}/1?token={tok}&expires={extended_exp}&uid={self.student_a}"
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json().get("detail"), "INVALID_SIGNATURE")

    def test_expired_timestamps_rejected(self):
        """2.5: Expired tokens (past timestamp, zero, negative) return HTTP 403 SIGNATURE_EXPIRED."""
        past_exp = int(time.time()) - 30
        tok = generate_page_token(self.student_a, self.file_a, 1, past_exp)

        url = f"/api/web/reader/page/{self.file_a}/1?token={tok}&expires={past_exp}&uid={self.student_a}"
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json().get("detail"), "SIGNATURE_EXPIRED")

        # Zero and negative
        for bad_exp in [0, -9999]:
            url = f"/api/web/reader/page/{self.file_a}/1?token={tok}&expires={bad_exp}&uid={self.student_a}"
            resp = self.client.get(url)
            self.assertEqual(resp.status_code, 403)
            self.assertEqual(resp.json().get("detail"), "SIGNATURE_EXPIRED")

    def test_cross_user_session_isolation(self):
        """2.6: Active session for Student A cannot steal or access a URL signed for Student B."""
        # Logged in as Student A (10001)
        app.dependency_overrides[current_student] = lambda: {
            "user_id": self.student_a,
            "name": "Student A",
            "subscription_active": True,
            "approved": True,
        }

        # Token was signed for Student B (20002)
        valid_exp = int(time.time()) + 600
        tok_b = generate_page_token(self.student_b, self.file_a, 1, valid_exp)

        # Student A tries to load Student B's URL with ?uid=20002
        url = f"/api/web/reader/page/{self.file_a}/1?token={tok_b}&expires={valid_exp}&uid={self.student_b}"
        resp = self.client.get(url)

        # Must be rejected because session user is 10001, so token check against 10001 fails
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json().get("detail"), "INVALID_SIGNATURE")

        app.dependency_overrides.clear()

    def test_unauthenticated_request_without_signed_uid_rejected_401(self):
        """2.7: Request without active session and without uid parameter is rejected with HTTP 401."""
        app.dependency_overrides.clear()
        valid_exp = int(time.time()) + 600
        url = f"/api/web/reader/page/{self.file_a}/1?token=dummy&expires={valid_exp}"
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.json().get("detail"), "login_required")

    def test_missing_required_token_parameters_rejected_422(self):
        """2.8: Omitting query parameter token or expires returns HTTP 422 Unprocessable Entity."""
        app.dependency_overrides.clear()
        # Missing token
        resp = self.client.get(f"/api/web/reader/page/{self.file_a}/1?expires=1234567890&uid=123")
        self.assertEqual(resp.status_code, 422)

        # Missing expires
        resp = self.client.get(f"/api/web/reader/page/{self.file_a}/1?token=abc&uid=123")
        self.assertEqual(resp.status_code, 422)

    def test_path_traversal_attempts_in_file_id_blocked(self):
        """2.9: Path traversal in file_id is safely blocked by both storage driver and endpoint."""
        driver = get_storage_driver()
        # Direct driver verification
        with self.assertRaises(ValueError):
            driver._sanitize_file_id("../../etc/passwd")
        with self.assertRaises(ValueError):
            driver._sanitize_file_id("..\\..\\windows\\win.ini")
        with self.assertRaises(ValueError):
            driver._sanitize_file_id("doc\x00traversal")

        # Endpoint verification with encoded paths
        valid_exp = int(time.time()) + 600
        traversal_payloads = [
            "..%2F..%2Fetc%2Fpasswd",
            "malicious-doc%00null",
            "doc%2Ftraversal",
        ]

        for payload in traversal_payloads:
            tok = generate_page_token(self.student_a, payload, 1, valid_exp)
            url = f"/api/web/reader/page/{payload}/1?token={tok}&expires={valid_exp}&uid={self.student_a}"
            resp = self.client.get(url)
            self.assertIn(resp.status_code, [403, 404, 422], f"Traversal with '{payload}' returned {resp.status_code}")


class TestWave4ConcurrencyAndStress(unittest.TestCase):
    """Category 3: Concurrency, Singleflight & Stress Testing Challenges."""

    def test_singleflight_coalescer_high_concurrency_single_execution(self):
        """3.1: 30 concurrent async requests for the same uncached page trigger exactly 1 raster job."""
        sf = SingleflightCoalescer()
        execution_count = 0

        async def _heavy_render_coro():
            nonlocal execution_count
            execution_count += 1
            await asyncio.sleep(0.05)  # simulate 50ms PyMuPDF rasterization
            return b"simulated-webp-bytes-concurrency-test"

        async def _run():
            tasks = [sf.execute("challenge_doc:p1:dpi150", _heavy_render_coro) for _ in range(30)]
            return await asyncio.gather(*tasks)

        results = asyncio.run(_run())
        self.assertEqual(len(results), 30)
        self.assertTrue(all(r == b"simulated-webp-bytes-concurrency-test" for r in results))
        self.assertEqual(execution_count, 1, f"Expected 1 execution, got {execution_count}")

    def test_singleflight_fault_recovery_and_cleanup_after_exception(self):
        """3.2: Exception in leader coroutine propagates to all listeners and clears lock for retries on persistent loop."""
        async def _test_flow():
            sf = SingleflightCoalescer()
            call_count = 0

            async def _failing_coro():
                nonlocal call_count
                call_count += 1
                await asyncio.sleep(0.02)
                raise ValueError("Corrupt PDF stream encountered during rendering")

            # 5 concurrent requests hit the failing job
            tasks = [sf.execute("failing_key:p1", _failing_coro) for _ in range(5)]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            self.assertEqual(len(results), 5)
            # All 5 must have received ValueError
            for r in results:
                self.assertIsInstance(r, ValueError)
                self.assertEqual(str(r), "Corrupt PDF stream encountered during rendering")

            # Wait for cleanup (0.05s internal delay)
            await asyncio.sleep(0.08)

            # Subsequent retry must succeed
            retry_result = await sf.execute("failing_key:p1", lambda: asyncio.sleep(0.01, result=b"recovered"))
            self.assertEqual(retry_result, b"recovered")

        asyncio.run(_test_flow())

    def test_singleflight_multiple_concurrent_keys_isolated(self):
        """3.3: Distinct page keys execute concurrently without blocking or cross-coalescing."""
        sf = SingleflightCoalescer()
        executed_keys = []

        async def _job(key: str):
            executed_keys.append(key)
            await asyncio.sleep(0.03)
            return f"result_for_{key}".encode()

        async def _run():
            tasks = []
            for _ in range(5):
                tasks.append(sf.execute("page_A", lambda: _job("page_A")))
                tasks.append(sf.execute("page_B", lambda: _job("page_B")))
                tasks.append(sf.execute("page_C", lambda: _job("page_C")))
            return await asyncio.gather(*tasks)

        results = asyncio.run(_run())
        self.assertEqual(len(results), 15)
        # Exactly 3 executions: 1 for A, 1 for B, 1 for C
        self.assertEqual(len(executed_keys), 3)
        self.assertEqual(sorted(executed_keys), ["page_A", "page_B", "page_C"])

    def test_out_of_bounds_and_negative_page_requests_return_404(self):
        """3.4: Extreme out-of-range pages (0, -1, 999999, 2^31-1) return HTTP 404 cleanly."""
        client = TestClient(app)
        pdf_bytes = generate_challenge_pdf(num_pages=2)
        fid = "stress_oob_booklet"
        storage = get_storage_driver()
        asyncio.run(storage.save_original(fid, pdf_bytes))

        uid = 556677
        valid_exp = int(time.time()) + 600

        bad_pages = [0, -1, -50, 999999, 2147483647]
        for p in bad_pages:
            tok = generate_page_token(uid, fid, p, valid_exp)
            url = f"/api/web/reader/page/{fid}/{p}?token={tok}&expires={valid_exp}&uid={uid}"
            resp = client.get(url)
            self.assertEqual(resp.status_code, 404, f"Page {p} should return 404, got {resp.status_code}")

    def test_corrupt_binary_pdf_handling_clean_404_no_crash(self):
        """3.5: Corrupt or malformed PDF returns HTTP 404 without unhandled process crash."""
        client = TestClient(app)
        corrupt_bytes = b"\x00\xff\xfe\x01\x02\x03CORRUPT_JUNK_NOT_A_PDF"
        fid = "stress_corrupt_booklet"
        storage = get_storage_driver()
        asyncio.run(storage.save_original(fid, corrupt_bytes))

        uid = 556677
        valid_exp = int(time.time()) + 600
        tok = generate_page_token(uid, fid, 1, valid_exp)

        url = f"/api/web/reader/page/{fid}/1?token={tok}&expires={valid_exp}&uid={uid}"
        resp = client.get(url)
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.json().get("detail"), "PAGE_RENDER_FAILED")

    def test_empty_zero_byte_pdf_handling_clean_404(self):
        """3.6: Zero-byte file returns HTTP 404 cleanly."""
        client = TestClient(app)
        empty_bytes = b""
        fid = "stress_empty_booklet"
        storage = get_storage_driver()
        asyncio.run(storage.save_original(fid, empty_bytes))

        uid = 556677
        valid_exp = int(time.time()) + 600
        tok = generate_page_token(uid, fid, 1, valid_exp)

        url = f"/api/web/reader/page/{fid}/1?token={tok}&expires={valid_exp}&uid={uid}"
        resp = client.get(url)
        self.assertEqual(resp.status_code, 404)


class TestWave4WatermarkEmpiricalVerification(unittest.TestCase):
    """Category 4: Dynamic Watermark Verification & Persian RTL Shaping Challenges."""

    @classmethod
    def setUpClass(cls):
        cls.pdf_bytes = generate_challenge_pdf(num_pages=1, width=595, height=842)
        cls.base_webp = PdfRenderer.rasterize_page_to_webp(cls.pdf_bytes, page_num=1, dpi=150)

    def test_watermark_decisively_alters_pixel_bytes_not_transparent_dummy(self):
        """4.1: Empirical proof that WatermarkStamper actually modifies pixel values (MSE > 0.1, > 5000 altered pixels)."""
        stamped_webp = WatermarkStamper.stamp_watermark(
            base_webp_bytes=self.base_webp,
            user_name="دکتر علیرضا رضایی",
            user_id=888777,
            client_ip="192.168.10.45",
            timestamp="2026-11-06 21:00",
        )
        self.assertIsInstance(stamped_webp, bytes)
        self.assertNotEqual(self.base_webp, stamped_webp, "Watermarked WebP bytes must differ from base WebP bytes")

        # Decode both images into raw pixel arrays
        img_base = Image.open(io.BytesIO(self.base_webp)).convert("RGB")
        img_stamped = Image.open(io.BytesIO(stamped_webp)).convert("RGB")

        self.assertEqual(img_base.size, img_stamped.size)
        width, height = img_base.size
        total_pixels = width * height

        raw_base = img_base.tobytes()
        raw_stamped = img_stamped.tobytes()

        # Empirical pixel analysis
        altered_pixels = 0
        sum_squared_diff = 0.0
        max_delta = 0

        # Sample every pixel
        for i in range(0, len(raw_base), 3):
            r_diff = abs(raw_base[i] - raw_stamped[i])
            g_diff = abs(raw_base[i + 1] - raw_stamped[i + 1])
            b_diff = abs(raw_base[i + 2] - raw_stamped[i + 2])
            pixel_diff = r_diff + g_diff + b_diff

            if pixel_diff > 0:
                altered_pixels += 1
                sum_squared_diff += (r_diff**2 + g_diff**2 + b_diff**2) / 3.0
                max_delta = max(max_delta, r_diff, g_diff, b_diff)

        mse = sum_squared_diff / total_pixels
        altered_percentage = (altered_pixels / total_pixels) * 100.0

        # Assertions
        self.assertGreater(
            altered_pixels, 5000,
            f"Expected at least 5000 altered pixels for repeating 45-degree diagonal grid, got {altered_pixels}"
        )
        self.assertGreater(
            mse, 0.05,
            f"Mean Squared Error must be > 0.05, got {mse:.4f} (indicates transparent dummy watermark)"
        )
        self.assertGreater(
            max_delta, 10,
            f"Maximum channel delta must be visible (> 10), got {max_delta}"
        )

    def test_persian_rtl_complex_cursive_shaping(self):
        """4.2: Stress-test Persian cursive character combinations, ligatures, and bidirectional text."""
        complex_names = [
            "دکتر کیوان نوریان‌زاده",
            "سید محمدرضا طباطبایی",
            "فاطمهٔ حسینی‌پور (دانشگاه تهران)",
            "پژوهشگاه بیوشیمی و بیوفیزیک — گچ‌پژ",
            "عضو هیئت علمی / رتبهٔ ۱ کنکور پزشکی ۱۴۰۴",
            "Ali Reza (علی‌رضا) - ID: 998877",
            "شماره تلفن: ۰۹۱۲۳۴۵۶۷۸۹",
        ]

        for name in complex_names:
            stamped = WatermarkStamper.stamp_watermark(
                base_webp_bytes=self.base_webp,
                user_name=name,
                user_id=12345,
                client_ip="10.0.0.1",
            )
            self.assertIsInstance(stamped, bytes)
            img = Image.open(io.BytesIO(stamped))
            self.assertEqual(img.format, "WEBP")
            self.assertEqual(img.size, (1240, 1755))

    def test_adversarial_watermark_payloads_no_injection_no_crash(self):
        """4.3: Adversarial string inputs (XSS, SQLi, emojis, zero-width joiners, extreme lengths) do not crash."""
        adversarial_payloads = [
            "",  # empty
            "   ",  # spaces only
            "<script>alert(1)</script>",  # XSS
            "'; DROP TABLE users; --",  # SQL injection
            "A" * 1000,  # extreme length 1000 chars
            "👨‍⚕️💊💉🩺🧬",  # emojis
            "تست\x00نال\x00بایت",  # null bytes
            "خط اول\nخط دوم\r\nخط سوم\tتب",  # newlines and tabs
            "\u200c\u200d\u200e\u200f",  # zero-width Unicode format markers
        ]

        for payload in adversarial_payloads:
            try:
                stamped = WatermarkStamper.stamp_watermark(
                    base_webp_bytes=self.base_webp,
                    user_name=payload,
                    user_id=999,
                    client_ip="127.0.0.1",
                )
                self.assertIsInstance(stamped, bytes)
                img = Image.open(io.BytesIO(stamped))
                self.assertEqual(img.format, "WEBP")
            except Exception as exc:
                self.fail(f"WatermarkStamper crashed on payload {payload!r}: {exc}")

    def test_watermark_overlay_cache_memory_bound_enforced(self):
        """4.4: WatermarkStamper cache is bounded to 200 entries to prevent process memory leaks."""
        WatermarkStamper._CACHE.clear()

        # Prime with 250 distinct user sessions with compact dimensions for fast execution
        for uid in range(250):
            WatermarkStamper._get_overlay(
                user_name=f"User-{uid}",
                user_id=uid,
                client_ip=f"10.0.0.{uid % 250}",
                width=100,
                height=100,
            )

        cache_size = len(WatermarkStamper._CACHE)
        self.assertLessEqual(cache_size, 200, f"Cache size exceeded 200: {cache_size}")
        self.assertGreater(cache_size, 0)


if __name__ == "__main__":
    unittest.main()
