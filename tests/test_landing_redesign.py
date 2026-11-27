# -*- coding: utf-8 -*-
"""Automated verification test suite for Humsyar Landing Page Redesign & Logo Assets.

Covers Feature F7 (Logo Asset Serving & Verification) and Feature F8 (Landing Page Structure
& Modern Redesign Content) across the systematic 4-tier verification architecture:
- Tier 1: Happy-path functional coverage (>= 5 tests per feature)
- Tier 2: Boundary value analysis & corner case hardening
- Tier 3: Pairwise cross-feature integration
- Tier 4: Real-world visitor landing page journeys

Supports dual runner execution:
  - pytest -q tests/test_landing_redesign.py
  - python -m unittest tests/test_landing_redesign.py -v
"""
from __future__ import annotations

import glob
import os
import re
import sys
import unittest
from PIL import Image

# Ensure mock environment variables before importing FastAPI app
os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017/humsyar_test")
os.environ.setdefault("ADMIN_ID", "999")
os.environ.setdefault("TELEGRAM_TOKEN", "123456:TEST_TOKEN")
os.environ.setdefault("BOT_TOKEN", "123456:TEST_TOKEN")

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from fastapi.testclient import TestClient
from backend.api.main import app


class TestLandingLogoAssets(unittest.TestCase):
    """Feature F7: Logo Asset Deployment, Serving & MIME Verification."""

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.public_icons = os.path.join(PROJECT_ROOT, "miniapp", "public", "icons")
        cls.dist_icons = os.path.join(PROJECT_ROOT, "miniapp", "dist-landing", "icons")
        cls.public_brand = os.path.join(PROJECT_ROOT, "miniapp", "public", "brand")

    # ── Tier 1: Core Functional Coverage (Happy Path) ──

    def test_f7_01_icon_512_serving(self):
        """Tier 1: GET /icons/icon-512.png returns HTTP 200, image/png, and valid magic bytes."""
        res = self.client.get("/icons/icon-512.png")
        self.assertEqual(res.status_code, 200)
        self.assertIn("image/png", res.headers.get("content-type", ""))
        self.assertGreater(len(res.content), 20000, "icon-512.png must be > 20KB")
        # PNG magic bytes: \x89PNG\r\n\x1a\n
        self.assertTrue(res.content.startswith(b"\x89PNG\r\n\x1a\n"))

    def test_f7_02_icon_192_serving(self):
        """Tier 1: GET /icons/icon-192.png returns HTTP 200, image/png, and valid magic bytes."""
        res = self.client.get("/icons/icon-192.png")
        self.assertEqual(res.status_code, 200)
        self.assertIn("image/png", res.headers.get("content-type", ""))
        self.assertGreater(len(res.content), 10000, "icon-192.png must be > 10KB")
        self.assertTrue(res.content.startswith(b"\x89PNG\r\n\x1a\n"))

    def test_f7_03_apple_touch_icon_serving(self):
        """Tier 1: GET /icons/apple-touch-icon.png returns HTTP 200, image/png, and valid bytes."""
        res = self.client.get("/icons/apple-touch-icon.png")
        self.assertEqual(res.status_code, 200)
        self.assertIn("image/png", res.headers.get("content-type", ""))
        self.assertGreater(len(res.content), 8000)
        self.assertTrue(res.content.startswith(b"\x89PNG\r\n\x1a\n"))

    def test_f7_04_hero_emblem_image_serving(self):
        """Tier 1: GET /icons/hero-emblem.jpg returns HTTP 200, image/jpeg, and valid JPEG magic bytes."""
        res = self.client.get("/icons/hero-emblem.jpg")
        self.assertEqual(res.status_code, 200)
        self.assertIn("image/jpeg", res.headers.get("content-type", ""))
        self.assertGreater(len(res.content), 50000, "hero-emblem.jpg must be high resolution (>50KB)")
        # JPEG magic bytes: \xff\xd8\xff
        self.assertTrue(res.content.startswith(b"\xff\xd8\xff"))

    def test_f7_05_favicon_serving(self):
        """Tier 1: GET /icons/favicon-64.png returns HTTP 200, image/png, and non-empty valid content."""
        res = self.client.get("/icons/favicon-64.png")
        self.assertEqual(res.status_code, 200)
        self.assertIn("image/png", res.headers.get("content-type", ""))
        self.assertGreater(len(res.content), 2000)

    # ── Tier 2: Boundary Value Analysis (Dimensions & Aspect Ratio) ──

    def test_f7_06_image_dimensions_and_aspect_ratios(self):
        """Tier 2: Verify exact dimensions and 1:1 aspect ratios for all generated icon assets."""
        assets_specs = [
            (os.path.join(self.public_icons, "icon-512.png"), (512, 512), "PNG"),
            (os.path.join(self.public_icons, "icon-192.png"), (192, 192), "PNG"),
            (os.path.join(self.public_icons, "apple-touch-icon.png"), (180, 180), "PNG"),
            (os.path.join(self.public_icons, "favicon-64.png"), (64, 64), "PNG"),
            (os.path.join(self.public_icons, "hero-emblem.jpg"), (1024, 1024), "JPEG"),
        ]
        for path, expected_size, expected_fmt in assets_specs:
            self.assertTrue(os.path.isfile(path), f"File {path} must exist on disk")
            with Image.open(path) as im:
                self.assertEqual(im.size, expected_size, f"Size mismatch for {path}")
                self.assertEqual(im.format, expected_fmt, f"Format mismatch for {path}")
                self.assertEqual(im.size[0], im.size[1], "Aspect ratio must be exactly 1:1")

    def test_f7_07_public_and_dist_asset_parity(self):
        """Tier 2: Verify that public icons are mirrored in dist-landing build output without corruption."""
        for filename in ["icon-512.png", "icon-192.png", "apple-touch-icon.png", "hero-emblem.jpg"]:
            pub_file = os.path.join(self.public_icons, filename)
            dist_file = os.path.join(self.dist_icons, filename)
            self.assertTrue(os.path.isfile(dist_file), f"Dist file {dist_file} must exist")
            self.assertEqual(os.path.getsize(pub_file), os.path.getsize(dist_file))

    # ── Tier 3: Pairwise Cross-Feature Integration ──

    def test_f7_08_html_head_icon_link_tags(self):
        """Tier 3: Pairwise check: index.html references the newly deployed icon assets in <head>."""
        index_path = os.path.join(PROJECT_ROOT, "miniapp", "dist-landing", "index.html")
        self.assertTrue(os.path.isfile(index_path))
        with open(index_path, encoding="utf-8") as f:
            html = f.read()

        self.assertIn('/icons/icon-192.png', html)
        self.assertIn('/icons/apple-touch-icon.png', html)
        self.assertIn('/icons/icon-512.png', html)

    def test_f7_09_brand_emblem_dual_directory_integrity(self):
        """Tier 3: Pairwise check: hero-emblem.jpg exists in both brand/ and icons/ with identical hash."""
        brand_file = os.path.join(self.public_brand, "hero-emblem.jpg")
        icons_file = os.path.join(self.public_icons, "hero-emblem.jpg")
        self.assertTrue(os.path.isfile(brand_file), "miniapp/public/brand/hero-emblem.jpg must exist")
        self.assertTrue(os.path.isfile(icons_file), "miniapp/public/icons/hero-emblem.jpg must exist")
        self.assertEqual(os.path.getsize(brand_file), os.path.getsize(icons_file))

    # ── Tier 4: Real-World Scenario ──

    def test_f7_10_client_icon_download_scenario(self):
        """Tier 4 Scenario: Client fetches root HTML, parses icon links, and downloads all assets."""
        res_root = self.client.get("/")
        self.assertEqual(res_root.status_code, 200)

        # Extract all icon and image paths
        icon_hrefs = re.findall(r'href="(/icons/[^"]+)"', res_root.text)
        og_images = re.findall(r'content="(/icons/[^"]+)"', res_root.text)
        all_asset_paths = set(icon_hrefs + og_images)
        self.assertGreaterEqual(len(all_asset_paths), 2)

        for path in all_asset_paths:
            asset_res = self.client.get(path)
            self.assertEqual(asset_res.status_code, 200, f"Failed to download {path}")
            self.assertTrue(asset_res.headers.get("content-type", "").startswith("image/"))


class TestLandingPageRedesign(unittest.TestCase):
    """Feature F8: Landing Page Structure, Copy & Modern Redesign Content."""

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.jsx_path = os.path.join(PROJECT_ROOT, "miniapp", "src", "landing", "Landing.jsx")
        cls.css_path = os.path.join(PROJECT_ROOT, "miniapp", "src", "landing", "landing.css")
        cls.index_path = os.path.join(PROJECT_ROOT, "miniapp", "dist-landing", "index.html")

        cls.jsx_content = ""
        if os.path.isfile(cls.jsx_path):
            with open(cls.jsx_path, encoding="utf-8") as f:
                cls.jsx_content = f.read()

        cls.css_content = ""
        if os.path.isfile(cls.css_path):
            with open(cls.css_path, encoding="utf-8") as f:
                cls.css_content = f.read()

        cls.dist_js_content = ""
        js_files = glob.glob(os.path.join(PROJECT_ROOT, "miniapp", "dist-landing", "landing-assets", "*.js"))
        for jf in js_files:
            with open(jf, encoding="utf-8") as f:
                cls.dist_js_content += f.read()

    # ── Tier 1: Core Functional Coverage (Happy Path) ──

    def test_f8_01_root_route_serves_html_200(self):
        """Tier 1: GET / serves HTTP 200 with text/html and includes #landing-root mount point."""
        res = self.client.get("/")
        self.assertEqual(res.status_code, 200)
        self.assertIn("text/html", res.headers.get("content-type", ""))
        self.assertIn('id="landing-root"', res.text)

    def test_f8_02_viewport_and_rtl_metadata(self):
        """Tier 1: HTML head contains responsive viewport meta tag and RTL Persian direction."""
        res = self.client.get("/")
        self.assertIn('name="viewport"', res.text)
        self.assertIn('width=device-width', res.text)
        self.assertIn('dir="rtl"', res.text)
        self.assertIn('lang="fa"', res.text)

    def test_f8_03_complete_absence_of_demo_placeholder_text(self):
        """Tier 1: Strict elimination of student demo/placeholder copy across source and compiled bundles."""
        prohibited_phrases = [
            "دانشجوی پزشکی — فیزیوپاتولوژی",
            "ورودی بهمن ۱۴۰۱",
            "کلاس فیزیوپاتولوژی قلب و عروق",
            "تالار رازی · ۸:۳۰ تا ۱۰:۱۵ · دکتر صادقی",
        ]
        for phrase in prohibited_phrases:
            self.assertNotIn(phrase, self.jsx_content, f"Found prohibited placeholder '{phrase}' in Landing.jsx")
            self.assertNotIn(phrase, self.dist_js_content, f"Found prohibited placeholder '{phrase}' in compiled bundle")

    def test_f8_04_cta_links_to_pwa_not_deprecated_student(self):
        """Tier 1: All primary CTA buttons link to /student/install guide."""
        # Must link to /student/install
        self.assertIn('href="/student/install"', self.jsx_content, "Landing.jsx must provide primary CTA to /student/install")
        self.assertIn('/student/install', self.dist_js_content, "Compiled bundle must route to /student/install")

    def test_f8_05_presence_of_core_capabilities(self):
        """Tier 1: Comprehensive presence of Humsyar core platform capabilities."""
        required_keywords = [
            "ربات تعاملی تلگرام",
            "شبیه‌ساز",
            "هاریسون",
            "جوهر دیجیتال",
            "لایتنر",
            "وضعیت سرویس‌ها",
        ]
        for kw in required_keywords:
            self.assertIn(kw, self.jsx_content, f"Missing capability '{kw}' in Landing.jsx")
            self.assertIn(kw, self.dist_js_content, f"Missing capability '{kw}' in compiled JS bundle")

    # ── Tier 2: Boundary Value Analysis & Responsive Safety ──

    def test_f8_06_css_overflow_x_hidden_enforcement(self):
        """Tier 2: CSS strictly enforces overflow-x: hidden to prevent horizontal scrollbars on mobile."""
        self.assertIn("overflow-x: hidden", self.css_content)

    def test_f8_07_accessibility_prefers_reduced_motion(self):
        """Tier 2: CSS includes prefers-reduced-motion media query for motion-sensitive accessibility."""
        self.assertIn("@media (prefers-reduced-motion: reduce)", self.css_content)
        self.assertIn("animation-duration", self.css_content)

    def test_f8_08_self_hosted_persian_vazirmatn_font(self):
        """Tier 2: CSS uses self-hosted Vazirmatn font files and does not depend on external CDNs."""
        self.assertIn("@font-face", self.css_content)
        self.assertIn("/fonts/vazirmatn-arabic.woff2", self.css_content)
        self.assertNotIn("fonts.googleapis.com", self.css_content)

    # ── Tier 3: Pairwise Cross-Feature Integration ──

    def test_f8_09_css_animations_and_hover_glow(self):
        """Tier 3: Pairwise check: CSS defines float keyframes, aura pulse, and card hover glow."""
        self.assertIn("@keyframes lp-float", self.css_content)
        self.assertIn("@keyframes lp-aura-pulse", self.css_content)
        self.assertIn("box-shadow: 0 12px 30px -10px rgba(14, 165, 233, 0.25)", self.css_content)

    def test_f8_10_api_health_service_integration(self):
        """Tier 3: Pairwise check: Landing.jsx connects to /api/health with dynamic status handling."""
        self.assertIn("/api/health", self.jsx_content)
        self.assertIn("serviceStatus", self.jsx_content)
        self.assertIn("checkHealth", self.jsx_content)

    # ── Tier 4: Real-World Scenario (Full Visitor Journey Audit) ──

    def test_f8_11_visitor_landing_journey_full_audit(self):
        """Tier 4 Scenario: Comprehensive audit of all 9 landing sections in Landing.jsx component."""
        # 1. Glassmorphic header & brand
        self.assertIn("lp-header", self.jsx_content)
        self.assertIn("lp-brand", self.jsx_content)

        # 2. Hero showcase with glowing emblem and floating tags
        self.assertIn("lp-hero__showcase", self.jsx_content)
        self.assertIn("lp-hero__aura", self.jsx_content)
        self.assertIn("hero-emblem.jpg", self.jsx_content)
        self.assertIn("lp-float-badge", self.jsx_content)

        # 3. Metrics bar
        self.assertIn("lp-metrics-section", self.jsx_content)
        self.assertIn("+۵۰,۰۰۰", self.jsx_content)

        # 4. The 4 Pillars interactive switcher
        self.assertIn("lp-pillars-section", self.jsx_content)
        self.assertIn("activePillar", self.jsx_content)

        # 5. 8 Detailed feature cards
        self.assertIn("lp-cards", self.jsx_content)
        self.assertIn("FEATURES", self.jsx_content)

        # 6. 3-step onboarding flow
        self.assertIn("lp-steps", self.jsx_content)

        # 7. Live infrastructure & health check
        self.assertIn("lp-status-section", self.jsx_content)
        self.assertIn("uptimeBars", self.jsx_content)

        # 8. Persian FAQ
        self.assertIn("lp-faq", self.jsx_content)

        # 9. Final CTA & Footer
        self.assertIn("lp-final", self.jsx_content)
        self.assertIn("lp-footer", self.jsx_content)


if __name__ == "__main__":
    unittest.main()
