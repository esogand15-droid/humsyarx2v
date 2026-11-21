# -*- coding: utf-8 -*-
"""Verification suite for Wave 3 Feature 10: Student SPA Mount & Routing."""
import os
import unittest
from fastapi.testclient import TestClient

os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017/medicalbot")
os.environ.setdefault("ADMIN_ID", "1")
os.environ.setdefault("TELEGRAM_TOKEN", "123:TEST")

from backend.api.main import app


class TestStudentSpaMount(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_tc_pwa_01_student_root_returns_200_html(self):
        """TC-PWA-01: GET /student serves Vite SPA shell with HTTP 200 (not 410 Gone)."""
        resp = self.client.get("/student")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("text/html", resp.headers.get("content-type", ""))
        self.assertIn("<html", resp.text.lower())
        self.assertNotEqual(resp.status_code, 410)

    def test_student_trailing_slash_returns_200_html(self):
        """GET /student/ serves index.html with HTTP 200."""
        resp = self.client.get("/student/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("text/html", resp.headers.get("content-type", ""))
        self.assertIn("<html", resp.text.lower())

    def test_student_spa_subroute_fallback(self):
        """Arbitrary client routes under /student/* resolve cleanly to index.html with HTTP 200."""
        subroutes = [
            "/student/library",
            "/student/exam",
            "/student/me",
            "/student/schedule",
            "/student/search",
        ]
        for route in subroutes:
            with self.subTest(route=route):
                resp = self.client.get(route)
                self.assertEqual(resp.status_code, 200, f"Route {route} failed to resolve to index.html")
                self.assertIn("text/html", resp.headers.get("content-type", ""))
                self.assertIn("<html", resp.text.lower())

    def test_student_static_asset_serving(self):
        """Static assets in apps/student/dist load with correct MIME types."""
        resp = self.client.get("/student/favicon-64.png")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.headers.get("content-type", "").startswith("image/"))

        resp_manifest = self.client.get("/student/manifest.webmanifest")
        self.assertEqual(resp_manifest.status_code, 200)

    def test_student_missing_asset_returns_404(self):
        """Missing static assets with file extensions return HTTP 404, not HTML fallback."""
        resp = self.client.get("/student/assets/nonexistent-xyz.js")
        self.assertEqual(resp.status_code, 404)
        self.assertNotIn("<!doctype html>", resp.text.lower())

    def test_no_routing_conflicts(self):
        """MiniApp (/app), Admin (/admin), and API (/api/*) routes remain intact and unshadowed."""
        resp_api = self.client.get("/api/health")
        self.assertEqual(resp_api.status_code, 200)

        resp_app = self.client.get("/app", follow_redirects=True)
        self.assertIn(resp_app.status_code, (200, 503))

        resp_admin = self.client.get("/admin", follow_redirects=True)
        self.assertIn(resp_admin.status_code, (200, 503))


if __name__ == "__main__":
    unittest.main()
