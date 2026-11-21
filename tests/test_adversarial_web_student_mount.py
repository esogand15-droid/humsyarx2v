# -*- coding: utf-8 -*-
"""Adversarial empirical stress-test suite for Wave 3 Feature 10: Student SPA Mount & Routing Resilience.

Authored by challenger_w3_2 (Wave 3 Adversarial Challenger 2).
Covers:
1. Deep nested route traversal & arbitrary client subroutes (HTTP 200 with SPA shell).
2. Persian and Unicode percent-encoded subroutes.
3. Missing static assets rejection across standard file extensions (HTTP 404).
4. Route safety: zero route shadowing of /api/health, /app, /admin, and sibling prefixes (/students).
5. HTTP method constraints (GET/HEAD allowed, POST/PUT/DELETE rejected with HTTP 405).
6. Range requests on static assets (TC-CORNER-01).
7. Rapid concurrent request burst execution (175 mixed requests).
8. Dedicated defect reproduction test cases exposing concrete implementation flaws.
"""
from __future__ import annotations

import concurrent.futures
import os
import sys
import time
import unittest
from fastapi.testclient import TestClient

os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017/medicalbot")
os.environ.setdefault("ADMIN_ID", "1")
os.environ.setdefault("TELEGRAM_TOKEN", "123:TEST")

from backend.api.main import app


class TestAdversarialStudentMountPassing(unittest.TestCase):
    """Stress tests verifying features that currently satisfy requirements."""

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    # =========================================================================
    # 1. DEEP NESTED ROUTE TRAVERSAL & CLIENT ARBITRARY SUBROUTES
    # =========================================================================

    def test_deep_nested_client_subroutes(self):
        """Deep nested multi-level arbitrary client routes resolve to index.html with HTTP 200."""
        routes = [
            "/student/library/terms/1",
            "/student/library/terms/1/courses/anatomy/sessions/102",
            "/student/exam/mock/123/review/question/45",
            "/student/reader/doc/chapter/1/page/42",
            "/student/me/settings/security/sessions/details",
            "/student/a/b/c/d/e/f/g/h/i/j/k",  # 11 levels deep
            "/student/unknown/deep/arbitrary/path/here",
        ]
        for route in routes:
            with self.subTest(route=route):
                resp = self.client.get(route)
                self.assertEqual(resp.status_code, 200, f"Route {route} did not return HTTP 200")
                self.assertIn("text/html", resp.headers.get("content-type", ""))
                self.assertIn("<html", resp.text.lower())
                self.assertGreater(len(resp.text), 300, "Response body suspiciously small for index.html")

    def test_persian_and_unicode_subroutes(self):
        """Percent-encoded and Unicode Iranian medical terms in client routes resolve cleanly."""
        routes = [
            # Percent-encoded: /student/library/دانشجو
            "/student/library/%D8%AF%D8%A7%D9%86%D8%B4%D8%AC%D9%88",
            # Percent-encoded: /student/library/ترم-۱
            "/student/library/%D8%AA%D8%B1%D9%85-%DB%B1",
            # Special URL characters
            "/student/search/@me",
            "/student/tag/bio+chem",
            "/student/filter/(active)",
            "/student/item~1",
        ]
        for route in routes:
            with self.subTest(route=route):
                resp = self.client.get(route)
                self.assertEqual(resp.status_code, 200, f"Unicode route {route} failed")
                self.assertIn("text/html", resp.headers.get("content-type", ""))
                self.assertIn("<html", resp.text.lower())

    def test_trailing_slash_consistency_on_subroutes(self):
        """Subroutes with and without trailing slash resolve to index.html with HTTP 200."""
        pairs = [
            ("/student/library", "/student/library/"),
            ("/student/exam", "/student/exam/"),
            ("/student/library/terms/1", "/student/library/terms/1/"),
        ]
        for without_slash, with_slash in pairs:
            with self.subTest(path=without_slash):
                r1 = self.client.get(without_slash)
                self.assertEqual(r1.status_code, 200)
                self.assertIn("text/html", r1.headers.get("content-type", ""))

                r2 = self.client.get(with_slash)
                self.assertEqual(r2.status_code, 200)
                self.assertIn("text/html", r2.headers.get("content-type", ""))

    def test_subroutes_with_query_parameters(self):
        """Subroutes carrying complex query strings still resolve to index.html with HTTP 200."""
        queries = [
            "/student/library/terms/1?sort=desc&view=grid&token=xyz123",
            "/student/search?q=%D8%A2%D9%86%D8%A7%D8%AA%D9%88%D9%85%DB%8C&page=2",
            "/student/exam/review?mode=detailed&filter=wrong_only&v=1.0.0",
        ]
        for q_route in queries:
            with self.subTest(query=q_route):
                resp = self.client.get(q_route)
                self.assertEqual(resp.status_code, 200)
                self.assertIn("text/html", resp.headers.get("content-type", ""))
                self.assertIn("<html", resp.text.lower())

    # =========================================================================
    # 2. MISSING STATIC ASSETS REJECTION (STANDARD EXTENSIONS)
    # =========================================================================

    def test_missing_static_assets_standard_extensions(self):
        """Standard web asset extensions (<= 8 chars) return HTTP 404 when missing, NEVER HTML fallback."""
        missing_assets = [
            # JavaScript
            "/student/assets/nonexistent-bundle.js",
            "/student/nonexistent.mjs",
            # Stylesheets
            "/student/assets/missing-style.css",
            # Fonts
            "/student/assets/missing-font.woff2",
            "/student/assets/missing-font.woff",
            "/student/assets/missing-font.ttf",
            # Images
            "/student/assets/missing-image.png",
            "/student/assets/missing-image.jpg",
            "/student/assets/missing-image.webp",
            "/student/icons/missing-icon.svg",
            "/student/favicon.ico",
            # Metadata & Data
            "/student/missing-manifest.json",
            "/student/sitemap.xml",
            "/student/robots.txt",
            # Source maps
            "/student/assets/index.js.map",
            # Media
            "/student/audio/track.mp3",
            "/student/video/demo.mp4",
        ]
        for asset in missing_assets:
            with self.subTest(asset=asset):
                resp = self.client.get(asset)
                self.assertEqual(resp.status_code, 404, f"Missing asset {asset} returned {resp.status_code} instead of 404")
                self.assertNotIn("<!doctype html>", resp.text.lower(), f"Missing asset {asset} returned index.html fallback!")

    def test_missing_assets_with_query_params_and_casing(self):
        """Missing assets with query strings and upper-case extensions return HTTP 404."""
        tricky_assets = [
            "/student/assets/missing.js?v=2.1.0",
            "/student/assets/missing.css?timestamp=123456",
            "/student/assets/missing.JS",
            "/student/assets/missing.CSS",
            "/student/assets/missing.PNG",
            "/student/assets/missing.WOFF2",
            "/student/nested/deep/missing.bundle.min.js",
        ]
        for asset in tricky_assets:
            with self.subTest(asset=asset):
                resp = self.client.get(asset)
                self.assertEqual(resp.status_code, 404, f"Tricky asset {asset} returned {resp.status_code} instead of 404")
                self.assertNotIn("<!doctype html>", resp.text.lower())

    def test_existing_static_assets_serve_successfully(self):
        """Existing production assets in apps/student/dist serve HTTP 200 with appropriate MIME types."""
        existing_assets = [
            ("/student/manifest.webmanifest", ["manifest", "json"]),
            ("/student/favicon-64.png", ["image/png"]),
            ("/student/sw.js", ["javascript"]),
            ("/student/sw-assets.json", ["json"]),
        ]
        for path, expected_content_types in existing_assets:
            with self.subTest(path=path):
                resp = self.client.get(path)
                self.assertEqual(resp.status_code, 200, f"Existing asset {path} failed to load")
                ctype = resp.headers.get("content-type", "").lower()
                self.assertTrue(
                    any(expected in ctype for expected in expected_content_types),
                    f"Asset {path} returned content-type '{ctype}', expected one of {expected_content_types}",
                )

    # =========================================================================
    # 3. ZERO ROUTE SHADOWING & SYSTEM ISOLATION
    # =========================================================================

    def test_zero_shadowing_of_core_api_routes(self):
        """API endpoints under /api/* must NEVER be intercepted by /student SPA."""
        api_endpoints = [
            ("/api/health", 200),
            ("/api/web/auth/config", 200),
            ("/api/web-auth/session", 200),
        ]
        for endpoint, expected_status in api_endpoints:
            with self.subTest(endpoint=endpoint):
                resp = self.client.get(endpoint)
                self.assertEqual(resp.status_code, expected_status)
                self.assertIn("application/json", resp.headers.get("content-type", ""))
                self.assertNotIn("<html", resp.text.lower())

    def test_zero_shadowing_of_app_and_admin(self):
        """MiniApp (/app) and Admin (/admin) must NOT be intercepted by /student SPA."""
        resp_app = self.client.get("/app", follow_redirects=True)
        self.assertIn(resp_app.status_code, (200, 503))
        if resp_app.status_code == 200:
            self.assertNotIn("apps/student/dist", resp_app.text)

        resp_admin = self.client.get("/admin", follow_redirects=True)
        self.assertIn(resp_admin.status_code, (200, 503))
        if resp_admin.status_code == 200:
            self.assertNotIn("apps/student/dist", resp_admin.text)

    def test_prefix_boundary_strictness(self):
        """Paths starting with /student-something must NOT be claimed by /student mount."""
        boundary_routes = [
            "/students",
            "/student-app",
            "/student_portal",
            "/student123",
            "/student.json",
        ]
        for route in boundary_routes:
            with self.subTest(route=route):
                resp = self.client.get(route)
                self.assertEqual(resp.status_code, 404, f"Route {route} was incorrectly captured by /student mount")
                self.assertNotIn("<!doctype html>", resp.text.lower())

    # =========================================================================
    # 4. HTTP METHOD CONSTRAINTS & RANGE REQUESTS
    # =========================================================================

    def test_http_method_constraints_on_static_routes(self):
        """POST, PUT, DELETE to static routes must return HTTP 405 Method Not Allowed."""
        disallowed_methods = ["post", "put", "delete", "patch"]
        for method in disallowed_methods:
            with self.subTest(method=method):
                client_fn = getattr(self.client, method)
                resp = client_fn("/student/library")
                self.assertEqual(resp.status_code, 405, f"Method {method} returned {resp.status_code} instead of 405")

    def test_range_request_on_static_asset(self):
        """TC-CORNER-01 validation: Range request on static asset returns 206 Partial Content."""
        headers = {"Range": "bytes=0-15"}
        resp = self.client.get("/student/favicon-64.png", headers=headers)
        self.assertEqual(resp.status_code, 206)
        self.assertIn("bytes 0-15/", resp.headers.get("content-range", ""))
        self.assertEqual(len(resp.content), 16)

    # =========================================================================
    # 5. RAPID CONCURRENT REQUEST EXECUTION (BURST STRESS)
    # =========================================================================

    def test_rapid_concurrent_request_burst(self):
        """Execute 175 concurrent requests across mixed endpoints without contention or leakage."""
        test_requests = [
            ("/student", 200, "text/html"),
            ("/student/", 200, "text/html"),
            ("/student/library/terms/1", 200, "text/html"),
            ("/student/exam/mock/42", 200, "text/html"),
            ("/student/assets/nonexistent-stress.js", 404, None),
            ("/student/manifest.webmanifest", 200, None),
            ("/api/health", 200, "application/json"),
        ] * 25  # 7 * 25 = 175 total requests

        start_time = time.perf_counter()

        def make_req(req_tuple):
            path, expected_status, expected_ctype = req_tuple
            resp = self.client.get(path)
            passed_status = (resp.status_code == expected_status)
            passed_ctype = True
            if expected_ctype:
                passed_ctype = (expected_ctype in resp.headers.get("content-type", ""))
            return passed_status and passed_ctype

        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as executor:
            results = list(executor.map(make_req, test_requests))

        elapsed = time.perf_counter() - start_time

        self.assertEqual(len(results), len(test_requests))
        self.assertTrue(all(results), f"Some concurrent requests failed: {results.count(False)} failures")
        self.assertLess(elapsed, 10.0, f"175 concurrent requests took {elapsed:.2f}s, exceeding 10s budget")


class TestAdversarialStudentMountDefects(unittest.TestCase):
    """Adversarial challenge test cases that expose concrete bugs in web_student.py."""

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_defect_1_missing_webmanifest_returns_404(self):
        r"""DEFECT 1: Missing .webmanifest file MUST return HTTP 404, but returns HTTP 200 index.html.

        Root cause: _EXT_RE = re.compile(r'\.[A-Za-z0-9]{1,8}$') caps extension length at 8.
        len('webmanifest') == 11, so missing.webmanifest is treated as a client SPA route!
        """
        resp = self.client.get("/student/missing.webmanifest")
        self.assertEqual(
            resp.status_code,
            404,
            f"Expected HTTP 404 for missing .webmanifest asset, got {resp.status_code} with body: {resp.text[:100]}...",
        )
        self.assertNotIn("<!doctype html>", resp.text.lower())

    def test_defect_2_head_request_to_student_root_returns_200(self):
        """DEFECT 2: HEAD request to /student and /student/ MUST return HTTP 200, but returns HTTP 405.

        Root cause: lines 643-644 register only @app.get(_PREFIX) and @app.get(_PREFIX + '/')
        without HEAD method support.
        """
        for root_path in ("/student", "/student/"):
            with self.subTest(path=root_path):
                resp = self.client.head(root_path)
                self.assertEqual(
                    resp.status_code,
                    200,
                    f"Expected HTTP 200 for HEAD {root_path}, got {resp.status_code} Method Not Allowed",
                )
                self.assertIn("text/html", resp.headers.get("content-type", ""))
                self.assertEqual(resp.text, "")

    def test_defect_3_malformed_path_traversal_windows_does_not_crash_500(self):
        """DEFECT 3: Malformed path traversal on Windows MUST return HTTP 404/400, but crashes with HTTP 500.

        Root cause: In Starlette lookup_path, os.path.commonpath throws ValueError ('Paths don't have the same drive')
        on Windows ntpath when path contains '....//'. _StudentSpaStaticFiles only catches StarletteHTTPException,
        allowing ValueError to escape as an unhandled 500 error.
        """
        resp = self.client.get("/student/....//something")
        self.assertIn(
            resp.status_code,
            (400, 404),
            f"Expected HTTP 400 or 404 for malformed traversal, got unhandled {resp.status_code}: {resp.text}",
        )

    def test_defect_4_traversal_without_extension_does_not_return_200_html(self):
        """DEFECT 4: Path traversal without extension MUST return HTTP 404/400, not fall back to 200 index.html.

        Root cause: Starlette detects directory traversal and raises HTTPException(404), but
        _StudentSpaStaticFiles catches all 404s without checking for '..' and falls back to index.html.
        """
        resp = self.client.get("/student/%2e%2e/%2e%2e/etc/passwd")
        self.assertIn(
            resp.status_code,
            (400, 404),
            f"Expected HTTP 400/404 for traversal attempt, got {resp.status_code} index.html fallback",
        )


if __name__ == "__main__":
    unittest.main()
