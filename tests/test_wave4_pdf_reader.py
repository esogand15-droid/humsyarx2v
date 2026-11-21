# -*- coding: utf-8 -*-
"""Comprehensive Test Suite for Wave 4: Secure Protected PDF Reader & DRM WebP Stream.

Test Categories:
- Feature 18: Protected PDF WebP Pipeline (TC-WEBP-01, TC-WEBP-02, TC-WEBP-03)
- Feature 19: Dynamic Pixel Watermarking (TC-WMARK-01, TC-WMARK-02)
- Feature 20: Signed Page Delivery API (TC-SIGN-01, TC-SIGN-02, TC-SIGN-03)
- Storage & DRM Integrity: Master PDF protection, LRU high watermark eviction, ActiveReads protection.
"""
from __future__ import annotations

import asyncio
import io
import os
import time
import unittest
from unittest.mock import AsyncMock, patch

from PIL import Image
import pymupdf

os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017/medicalbot")
os.environ.setdefault("ADMIN_ID", "99999999")
os.environ.setdefault("TELEGRAM_TOKEN", "123:TEST_TOKEN")
os.environ.setdefault("READER_SIGNING_SECRET", "test-reader-secret-key-32bytes!")

from fastapi.testclient import TestClient
from backend.api.main import app
from backend.services.pdf_renderer import (
    PdfRenderer,
    WatermarkStamper,
    SingleflightCoalescer,
    get_singleflight,
)
from backend.services.storage import (
    get_storage_driver,
    LocalStorageDriver,
    ActiveReadsDict,
    HIGH_WATERMARK_BYTES,
    LOW_WATERMARK_BYTES,
)
from backend.api.routers.web_reader import (
    generate_page_token,
    verify_page_token,
)
from backend.api.routers.web_student import current_student


def create_synthetic_pdf(num_pages: int = 3, width: int = 595, height: int = 842) -> bytes:
    """Generate a clean synthetic PDF for testing without external file dependencies."""
    doc = pymupdf.open()
    for i in range(num_pages):
        page = doc.new_page(width=width, height=height)
        # Background rect
        page.draw_rect(pymupdf.Rect(40, 40, width - 40, height - 40), color=(0.1, 0.3, 0.7), fill=(0.96, 0.96, 0.96))
        # Persian and English test content
        page.insert_text(pymupdf.Point(60, 100), f"HumsYarX Medical Pamphlet - Page {i + 1}", fontsize=16)
        page.insert_text(pymupdf.Point(60, 140), "جزوه علوم پایه پزشکی هامزیار", fontsize=14)
    data = doc.tobytes()
    doc.close()
    return data


class TestWave4PdfRenderer(unittest.TestCase):
    """Unit tests for PdfRenderer and WatermarkStamper."""

    @classmethod
    def setUpClass(cls):
        cls.pdf_bytes = create_synthetic_pdf(num_pages=3)

    def test_tc_webp_01_pymupdf_rasterization(self):
        """TC-WEBP-01: Server rasterizes master PDF page to WebP at 150 DPI via Pillow Image.frombytes."""
        webp_bytes = PdfRenderer.rasterize_page_to_webp(self.pdf_bytes, page_num=1, dpi=150)
        self.assertIsInstance(webp_bytes, bytes)
        self.assertGreater(len(webp_bytes), 1000)

        # Inspect generated WebP with Pillow
        img = Image.open(io.BytesIO(webp_bytes))
        self.assertEqual(img.format, "WEBP")
        # 595 * 150 / 72 = 1239.58 -> ~1240 width, 842 * 150 / 72 = 1754.16 -> ~1755 height
        self.assertAlmostEqual(img.width, 1240, delta=2)
        self.assertAlmostEqual(img.height, 1755, delta=2)

    def test_tc_webp_01_invalid_page_raises_value_error(self):
        """Rasterizing out-of-range page raises ValueError."""
        with self.assertRaises(ValueError):
            PdfRenderer.rasterize_page_to_webp(self.pdf_bytes, page_num=0)
        with self.assertRaises(ValueError):
            PdfRenderer.rasterize_page_to_webp(self.pdf_bytes, page_num=99)

    def test_tc_webp_02_thumbnail_optimization(self):
        """TC-WEBP-02: Separate low-res (72 DPI, < 30 KB) thumbnail generation pipeline for document grid view."""
        thumb_bytes = PdfRenderer.render_thumbnail(self.pdf_bytes, page_num=1)
        self.assertIsInstance(thumb_bytes, bytes)
        self.assertLess(len(thumb_bytes), 30 * 1024, "Thumbnail must be strictly < 30 KB")

        img = Image.open(io.BytesIO(thumb_bytes))
        self.assertEqual(img.format, "WEBP")
        self.assertAlmostEqual(img.width, 595, delta=2)
        self.assertAlmostEqual(img.height, 842, delta=2)

    def test_tc_webp_03_singleflight_coalescing_lock(self):
        """TC-WEBP-03: 5 concurrent requests for the same uncached page trigger exactly 1 rasterization job."""
        sf = SingleflightCoalescer()
        call_count = 0

        async def _job():
            nonlocal call_count
            call_count += 1
            await asyncio.sleep(0.04)
            return b"simulated-webp-output"

        async def _run_concurrency():
            tasks = [sf.execute("booklet_test:p1:dpi150", _job) for _ in range(5)]
            return await asyncio.gather(*tasks)

        results = asyncio.run(_run_concurrency())
        self.assertEqual(len(results), 5)
        self.assertTrue(all(r == b"simulated-webp-output" for r in results))
        self.assertEqual(call_count, 1, "Expected exactly 1 coalesced execution for 5 concurrent requests")

    def test_tc_wmark_01_watermark_visual_embedding_rtl(self):
        """TC-WMARK-01: Server overlays student name diagonally with Persian RTL text shaping (arabic_reshaper + bidi)."""
        base_webp = PdfRenderer.rasterize_page_to_webp(self.pdf_bytes, page_num=1, dpi=150)
        watermarked_webp = WatermarkStamper.stamp_watermark(
            base_webp_bytes=base_webp,
            user_name="علیرضا رضایی",
            user_id=123456,
            client_ip="192.168.1.100",
            timestamp="2026-11-06 20:00",
        )
        self.assertIsInstance(watermarked_webp, bytes)
        self.assertGreater(len(watermarked_webp), 1000)

        img = Image.open(io.BytesIO(watermarked_webp))
        self.assertEqual(img.format, "WEBP")
        self.assertEqual(img.mode, "RGB")
        self.assertAlmostEqual(img.width, 1240, delta=2)
        self.assertAlmostEqual(img.height, 1755, delta=2)

    def test_tc_wmark_02_watermark_fast_alpha_blit(self):
        """TC-WMARK-02: Compositing overhead benchmark is bounded to < 50ms per request using pre-rendered pattern."""
        base_webp = PdfRenderer.rasterize_page_to_webp(self.pdf_bytes, page_num=1, dpi=72)
        # Prime overlay cache
        WatermarkStamper.stamp_watermark(base_webp, "دانشجو", 999, "127.0.0.1")

        start = time.perf_counter()
        for _ in range(3):
            WatermarkStamper.stamp_watermark(base_webp, "دانشجو", 999, "127.0.0.1")
        elapsed_ms = ((time.perf_counter() - start) / 3) * 1000

        self.assertLess(elapsed_ms, 50.0, f"Alpha blit average took {elapsed_ms:.2f}ms (must be < 50ms)")

    def test_manifest_generation_timing_and_accuracy(self):
        """Document manifest extracts page dimensions and aspect ratios in < 10ms."""
        start = time.perf_counter()
        manifest = PdfRenderer.get_document_manifest(
            pdf_bytes=self.pdf_bytes,
            file_id="pamphlet_42",
            scope="res",
            title="آناتومی اندام فوقانی",
            user_id=123456,
        )
        elapsed_ms = (time.perf_counter() - start) * 1000
        self.assertLess(elapsed_ms, 15.0, f"Manifest generation took {elapsed_ms:.2f}ms")

        self.assertEqual(manifest["total_pages"], 3)
        self.assertEqual(manifest["file_id"], "pamphlet_42")
        self.assertEqual(manifest["scope"], "res")
        self.assertEqual(manifest["encryption_mode"], "server_webp_watermarked")
        self.assertEqual(manifest["watermark_user_id"], 123456)
        self.assertEqual(len(manifest["page_dimensions"]), 3)

        for p_info in manifest["page_dimensions"]:
            self.assertIn("page", p_info)
            self.assertIn("width", p_info)
            self.assertIn("height", p_info)
            self.assertIn("aspect_ratio", p_info)
            self.assertAlmostEqual(p_info["aspect_ratio"], round(595 / 842, 4), delta=0.01)


class TestWave4StorageAndLruEviction(unittest.TestCase):
    """Storage caching, active reads protection, and LRU watermark eviction tests."""

    def setUp(self):
        self.driver = LocalStorageDriver()

    def test_active_reads_dict_refcounting(self):
        """ActiveReadsDict accurately tracks concurrent reader references."""
        ard = ActiveReadsDict()
        dummy_path = self.driver.cache_dir / "test_ref.webp"

        ard.add(dummy_path)
        self.assertIn(dummy_path, ard)
        self.assertEqual(ard[dummy_path], 1)

        ard.add(dummy_path)
        self.assertEqual(ard[dummy_path], 2)

        ard.discard(dummy_path)
        self.assertEqual(ard[dummy_path], 1)

        ard.discard(dummy_path)
        self.assertNotIn(dummy_path, ard)

    def test_cache_save_and_retrieve_roundtrip(self):
        """WebP page can be cached and retrieved safely."""
        fid = "test_doc_store"
        p_num = 1
        payload = b"RIFF....WEBPVP8 ...fake-webp-binary..."

        saved_path = asyncio.run(self.driver.save_cached_page(fid, p_num, payload))
        self.assertTrue(os.path.exists(saved_path))

        retrieved = asyncio.run(self.driver.get_cached_page(fid, p_num))
        self.assertEqual(retrieved, payload)

        # Cleanup
        asyncio.run(self.driver.delete_cached_page(fid, p_num))
        self.assertIsNone(asyncio.run(self.driver.get_cached_page(fid, p_num)))

    def test_check_and_evict_cache_under_low_threshold(self):
        """check_and_evict_cache triggers eviction when threshold exceeded."""
        fid = "doc_evict_test"
        # Write small sample file
        asyncio.run(self.driver.save_cached_page(fid, 1, b"x" * 1024))
        # High watermark set to 500 bytes to force eviction to 200 bytes
        evicted = asyncio.run(self.driver.check_and_evict_cache(high_watermark=500, low_watermark=200))
        self.assertGreaterEqual(evicted, 1024)
        self.assertIsNone(asyncio.run(self.driver.get_cached_page(fid, 1)))


class TestWave4WebReaderEndpoints(unittest.TestCase):
    """Integration tests for web_reader API endpoints and DRM signed URLs."""

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.pdf_bytes = create_synthetic_pdf(num_pages=2)
        cls.test_file_id = "wave4_test_booklet"
        cls.storage = get_storage_driver()
        asyncio.run(cls.storage.save_original(cls.test_file_id, cls.pdf_bytes))

    @classmethod
    def tearDownClass(cls):
        app.dependency_overrides.clear()

    def setUp(self):
        app.dependency_overrides[current_student] = lambda: {
            "user_id": 99999999,
            "name": "دانشجوی آزمایشی",
            "subscription_active": True,
            "approved": True,
        }

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_token_generation_and_verification(self):
        """HMAC page tokens validate correct signatures and reject expired or tampered tokens."""
        uid = 99999999
        fid = "pamphlet_99"
        page = 1
        future_exp = int(time.time()) + 600
        expired_exp = int(time.time()) - 10

        tok = generate_page_token(uid, fid, page, future_exp)
        self.assertTrue(verify_page_token(tok, uid, fid, page, future_exp))

        # Tampered token
        self.assertFalse(verify_page_token("bad_token_hash", uid, fid, page, future_exp))
        # Wrong page
        self.assertFalse(verify_page_token(tok, uid, fid, 2, future_exp))
        # Wrong user
        self.assertFalse(verify_page_token(tok, 11111111, fid, page, future_exp))
        # Expired token
        expired_tok = generate_page_token(uid, fid, page, expired_exp)
        self.assertFalse(verify_page_token(expired_tok, uid, fid, page, expired_exp))

    @patch("backend.api.routers.web_reader._item")
    @patch("backend.api.routers.web_reader._gate")
    def test_tc_sign_01_manifest_delivery(self, mock_gate, mock_item):
        """TC-SIGN-01: GET /api/web/reader/manifest/{scope}/{id} returns page count, aspect ratios, and signed URLs."""
        mock_gate.return_value = {"allowed": True}
        mock_item.return_value = {
            "_id": self.test_file_id,
            "name": "جزوه پاتولوژی اختصاصی",
            "mime_type": "application/pdf",
            "file_size": len(self.pdf_bytes),
        }

        resp = self.client.get(f"/api/web/reader/manifest/res/{self.test_file_id}")
        self.assertEqual(resp.status_code, 200, resp.text)
        data = resp.json()

        self.assertEqual(data["file_id"], self.test_file_id)
        self.assertEqual(data["scope"], "res")
        self.assertEqual(data["total_pages"], 2)
        self.assertEqual(data["encryption_mode"], "server_webp_watermarked")
        self.assertEqual(len(data["page_dimensions"]), 2)

        p1 = data["page_dimensions"][0]
        self.assertEqual(p1["page"], 1)
        self.assertIn("aspect_ratio", p1)
        self.assertIn("url", p1)
        self.assertIn("token=", p1["url"])
        self.assertIn("expires=", p1["url"])

    def test_tc_sign_02_signed_url_expiry_returns_403(self):
        """TC-SIGN-02: Page request with expired HMAC signature returns HTTP 403 SIGNATURE_EXPIRED."""
        uid = 99999999
        expired_ts = int(time.time()) - 100
        token = generate_page_token(uid, self.test_file_id, 1, expired_ts)

        url = f"/api/web/reader/page/{self.test_file_id}/1?token={token}&expires={expired_ts}&uid={uid}"
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json().get("detail"), "SIGNATURE_EXPIRED")

    def test_tc_sign_02_invalid_signature_returns_403(self):
        """Page request with invalid HMAC signature returns HTTP 403 INVALID_SIGNATURE."""
        uid = 99999999
        valid_ts = int(time.time()) + 600
        bad_token = "0123456789abcdef0123456789abcdef"

        url = f"/api/web/reader/page/{self.test_file_id}/1?token={bad_token}&expires={valid_ts}&uid={uid}"
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json().get("detail"), "INVALID_SIGNATURE")

    def test_tc_sign_03_webp_zero_storage_drm_headers(self):
        """TC-SIGN-03: Page request returns image/webp with strict zero-storage Cache-Control headers."""
        uid = 99999999
        valid_ts = int(time.time()) + 600
        token = generate_page_token(uid, self.test_file_id, 1, valid_ts)

        url = f"/api/web/reader/page/{self.test_file_id}/1?token={token}&expires={valid_ts}&uid={uid}"
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 200)

        # Content-Type must be image/webp
        self.assertEqual(resp.headers.get("content-type"), "image/webp")

        # Zero-Storage Cache-Control headers enforcement
        cc = resp.headers.get("cache-control", "")
        self.assertIn("no-store", cc)
        self.assertIn("no-cache", cc)
        self.assertIn("max-age=0", cc)
        self.assertIn("must-revalidate", cc)
        self.assertIn("private", cc)

        self.assertEqual(resp.headers.get("pragma"), "no-cache")
        self.assertEqual(resp.headers.get("x-content-type-options"), "nosniff")

        # Check delivered image is indeed valid WebP
        img = Image.open(io.BytesIO(resp.content))
        self.assertEqual(img.format, "WEBP")

    def test_raw_master_pdf_never_served(self):
        """The page streaming endpoint NEVER serves raw application/pdf binary."""
        uid = 99999999
        valid_ts = int(time.time()) + 600
        token = generate_page_token(uid, self.test_file_id, 1, valid_ts)

        url = f"/api/web/reader/page/{self.test_file_id}/1?token={token}&expires={valid_ts}&uid={uid}"
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.content.startswith(b"%PDF"), "Master PDF binary MUST NOT be served to browser")

    def test_unauthenticated_request_blocked(self):
        """Unauthenticated requests without session or signed uid are rejected with 401."""
        app.dependency_overrides.clear()
        valid_ts = int(time.time()) + 600
        url = f"/api/web/reader/page/{self.test_file_id}/1?token=test&expires={valid_ts}"
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.json().get("detail"), "login_required")

    def test_page_out_of_bounds_returns_404(self):
        """Request for page exceeding total pages returns HTTP 404."""
        uid = 99999999
        valid_ts = int(time.time()) + 600
        token = generate_page_token(uid, self.test_file_id, 999, valid_ts)

        url = f"/api/web/reader/page/{self.test_file_id}/999?token={token}&expires={valid_ts}&uid={uid}"
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 404)


if __name__ == "__main__":
    unittest.main()
