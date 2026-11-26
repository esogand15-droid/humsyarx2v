# -*- coding: utf-8 -*-
"""Adversarial Empirical Challenge Suite for Wave 7 Infrastructure & DRM Hardening.

Author: challenger_w6_2 (Empirical Challenger)
Target: Wave 7 Production Infrastructure Hardening and Zero-Storage DRM Protection

Test Categories:
- TC-ADV-DOCKER: Host budget mathematical bounds, unexposed ports, and worker pinning
- TC-ADV-CADDY: Strict TLS 1.3, complete security header set, DRM zero-store proxy, and SSE unbuffering
- TC-ADV-SW-DRM: Service Worker DRM regex fuzzing, exact Persian 503 fallback, and cache poison resistance
- TC-ADV-FERNET: Cryptographic tamper fuzzing, bit-flipping, truncation, and fail-closed assertion
- TC-ADV-BUILD: Multi-stage Dockerfile bundling, selfchecks, and student PWA build artifact integrity
"""
from __future__ import annotations

import base64
import json
import os
import re
import sys
import unittest
from pathlib import Path

import yaml
from cryptography.fernet import Fernet

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))


class TestAdversarialDockerCompose(unittest.TestCase):
    """Adversarial stress-testing of Docker Compose resource constraints and port boundaries."""

    @classmethod
    def setUpClass(cls):
        compose_file = ROOT / "docker-compose.yml"
        if not compose_file.exists():
            raise unittest.SkipTest("docker-compose.yml absent (Cloady PaaS single-container deployment)")
        with open(compose_file, "r", encoding="utf-8") as f:
            cls.compose = yaml.safe_load(f)
        cls.services = cls.compose.get("services", {})

    def _parse_memory_mb(self, mem_val: str | int) -> int:
        if isinstance(mem_val, (int, float)):
            return int(mem_val)
        mem_str = str(mem_val).strip()
        if mem_str.endswith("M") or mem_str.endswith("m"):
            return int(mem_str[:-1])
        if mem_str.endswith("G") or mem_str.endswith("g"):
            return int(float(mem_str[:-1]) * 1024)
        return int(mem_str)

    def test_all_services_have_mandatory_memory_limits(self):
        """ADVERSARIAL: Ensure 100% of defined services have explicit memory limits (no unbounded containers)."""
        self.assertGreater(len(self.services), 0, "No services defined in docker-compose.yml")
        for s_name, s_cfg in self.services.items():
            deploy = s_cfg.get("deploy", {})
            resources = deploy.get("resources", {})
            limits = resources.get("limits", {})
            mem_limit = limits.get("memory")
            self.assertIsNotNone(
                mem_limit,
                f"Security/Stability Violation: Service '{s_name}' lacks explicit memory limit and could exhaust host RAM",
            )
            parsed_mb = self._parse_memory_mb(mem_limit)
            self.assertGreater(parsed_mb, 0, f"Service '{s_name}' memory limit must be positive, got {parsed_mb}MB")

    def test_total_memory_limit_strictly_capped_at_7gb(self):
        """ADVERSARIAL: Total sum of container memory limits must be <= 7168 MB (7.0 GB on 8 GB host)."""
        total_mb = 0
        service_caps = {}
        for s_name, s_cfg in self.services.items():
            limits = s_cfg.get("deploy", {}).get("resources", {}).get("limits", {})
            mb = self._parse_memory_mb(limits["memory"])
            service_caps[s_name] = mb
            total_mb += mb

        self.assertLessEqual(
            total_mb,
            7168,
            f"Adversarial Failure: Sum of container memory limits ({total_mb} MB) exceeds 7.0 GB host budget (7168 MB)",
        )
        # Verify exact headroom: exactly 7168 MB leaves 1024 MB host headroom on 8192 MB host
        self.assertEqual(total_mb, 7168, f"Expected exactly 7168 MB total limit, found {total_mb} MB")

    def test_memory_reservations_do_not_exceed_limits(self):
        """ADVERSARIAL: For every service, reservation must be strictly <= limit."""
        for s_name, s_cfg in self.services.items():
            resources = s_cfg.get("deploy", {}).get("resources", {})
            limits = resources.get("limits", {})
            reservations = resources.get("reservations", {})

            limit_mb = self._parse_memory_mb(limits.get("memory", "0M"))
            res_mb = self._parse_memory_mb(reservations.get("memory", "0M"))
            self.assertGreater(res_mb, 0, f"Service '{s_name}' must have a positive memory reservation")
            self.assertLessEqual(
                res_mb,
                limit_mb,
                f"Service '{s_name}' memory reservation ({res_mb}MB) exceeds limit ({limit_mb}MB)",
            )

    def test_pymupdf_render_worker_strict_isolation(self):
        """ADVERSARIAL: PyMuPDF worker MUST be isolated: concurrency=1, memory <= 1024M, dedicated entrypoint."""
        worker = self.services.get("render_worker")
        self.assertIsNotNone(worker, "render_worker service must exist")

        env = worker.get("environment", {})
        concurrency = str(env.get("CONCURRENCY", "")).strip()
        self.assertEqual(
            concurrency,
            "1",
            f"Adversarial Concurrency Violation: render_worker CONCURRENCY must be '1', got '{concurrency}'",
        )

        limit_mb = self._parse_memory_mb(worker["deploy"]["resources"]["limits"]["memory"])
        self.assertLessEqual(
            limit_mb,
            1024,
            f"Adversarial Memory Violation: render_worker limit ({limit_mb}MB) exceeds 1024MB cap",
        )

        cmd = worker.get("command", [])
        cmd_str = " ".join(cmd) if isinstance(cmd, list) else str(cmd)
        self.assertIn("backend.workers.render_worker", cmd_str)

    def test_zero_backend_and_database_port_exposure_to_host(self):
        """ADVERSARIAL SECURITY: Only Caddy edge proxy may bind host ports. Internal services must NOT expose host ports."""
        dangerous_services = ["mongo", "app", "render_worker"]
        for s_name in dangerous_services:
            svc = self.services.get(s_name)
            if svc:
                ports = svc.get("ports", [])
                self.assertEqual(
                    len(ports),
                    0,
                    f"CRITICAL SECURITY VULNERABILITY: Service '{s_name}' directly exposes host ports: {ports}. Only Caddy should bind ports!",
                )

    def test_caddy_port_bindings_include_quic_udp(self):
        """ADVERSARIAL: Caddy must bind 80:80, 443:443 (TCP), and 443:443/udp (QUIC HTTP/3)."""
        caddy = self.services.get("caddy")
        self.assertIsNotNone(caddy, "caddy service must exist")
        ports = caddy.get("ports", [])
        port_strings = [str(p) for p in ports]
        self.assertIn("80:80", port_strings, "Caddy missing 80:80 HTTP redirect port")
        self.assertIn("443:443", port_strings, "Caddy missing 443:443 HTTPS TCP port")
        has_udp = any("443:443/udp" in p for p in port_strings)
        self.assertTrue(has_udp, f"Caddy missing 443:443/udp for HTTP/3 QUIC negotiation, ports: {ports}")

    def test_wiredtiger_cache_ceiling_fits_mongo_container(self):
        """ADVERSARIAL: Mongo WiredTiger cache (1.5 GB = 1536 MB) + runtime overhead must comfortably fit in 2560 MB limit."""
        mongo = self.services.get("mongo")
        self.assertIsNotNone(mongo)
        cmd = " ".join(mongo.get("command", []))
        self.assertIn("--wiredTigerCacheSizeGB", cmd)
        match = re.search(r"--wiredTigerCacheSizeGB\s+([0-9.]+)", cmd)
        self.assertIsNotNone(match, "WiredTiger cache size argument not parseable")
        wt_cache_gb = float(match.group(1))
        self.assertEqual(wt_cache_gb, 1.5, "WiredTiger cache size should be 1.5 GB")
        mongo_limit_mb = self._parse_memory_mb(mongo["deploy"]["resources"]["limits"]["memory"])
        wt_mb = wt_cache_gb * 1024
        headroom_mb = mongo_limit_mb - wt_mb
        self.assertGreaterEqual(
            headroom_mb,
            512,
            f"Mongo WiredTiger headroom ({headroom_mb}MB) insufficient for mongod process in {mongo_limit_mb}MB container",
        )


class TestAdversarialCaddyProxy(unittest.TestCase):
    """Adversarial testing of Caddy reverse proxy security headers and zero-storage rules."""

    @classmethod
    def setUpClass(cls):
        caddy_file = ROOT / "Caddyfile"
        if not caddy_file.exists():
            raise unittest.SkipTest("Caddyfile absent (Cloady PaaS edge deployment)")
        with open(caddy_file, "r", encoding="utf-8") as f:
            cls.content = f.read()

    def test_tls_protocols_strictness(self):
        """ADVERSARIAL: Verify obsolete TLS versions (1.0, 1.1) are omitted and modern protocols enforced."""
        self.assertIn("protocols tls1.2 tls1.3", self.content)
        self.assertNotIn("tls1.0", self.content)
        self.assertNotIn("tls1.1", self.content)
        self.assertIn("curves x25519 secp256r1", self.content)

    def test_all_essential_security_headers_present(self):
        """ADVERSARIAL: Verify complete defense-in-depth security header injection."""
        # 1. HSTS with subdomains and preload
        self.assertIn("Strict-Transport-Security", self.content)
        self.assertIn("includeSubDomains", self.content)
        self.assertIn("preload", self.content)

        # 2. Nosniff MIME guard
        self.assertIn('X-Content-Type-Options "nosniff"', self.content)

        # 3. Clickjacking protection: frame-ancestors allowing telegram webapp
        self.assertIn("Content-Security-Policy", self.content)
        self.assertIn("frame-ancestors 'self' https://web.telegram.org https://*.telegram.org;", self.content)
        self.assertIn('X-Frame-Options "SAMEORIGIN"', self.content)

        # 4. Referrer & Permissions policies
        self.assertIn('Referrer-Policy "strict-origin-when-cross-origin"', self.content)
        self.assertIn("Permissions-Policy", self.content)
        self.assertIn("camera=()", self.content)
        self.assertIn("microphone=()", self.content)

        # 5. Server banner stripping
        self.assertIn("-Server", self.content)

    def test_drm_zero_storage_cache_control_headers(self):
        """ADVERSARIAL: DRM reader routes must have strict zero-cache headers."""
        self.assertIn("@drm_protected", self.content)
        self.assertIn("/api/web/reader/page/*", self.content)
        self.assertIn("/api/web/reader/manifest/*", self.content)
        self.assertIn("private, no-store, no-cache, max-age=0, must-revalidate", self.content)
        self.assertIn('Pragma "no-cache"', self.content)

    def test_immutable_chunk_caching_applies_to_student_assets(self):
        """ADVERSARIAL: Immutable 1-year cache must apply to /student/assets/*."""
        self.assertIn("/student/assets/*", self.content)
        self.assertIn("public, max-age=31536000, immutable", self.content)

    def test_streaming_and_sse_unbuffered(self):
        """ADVERSARIAL: Upstream reverse proxy must have flush_interval -1 for real-time SSE streaming."""
        self.assertIn("reverse_proxy app:8000", self.content)
        self.assertIn("flush_interval -1", self.content)


class TestAdversarialServiceWorkerDRM(unittest.TestCase):
    """Adversarial stress-testing of Service Worker DRM bypass regex, offline responses, and cache isolation."""

    @classmethod
    def setUpClass(cls):
        sw_file = ROOT / "apps" / "student" / "public" / "sw.js"
        cls.assertTrue(sw_file.exists(), f"sw.js missing at {sw_file}")
        with open(sw_file, "r", encoding="utf-8") as f:
            cls.sw_content = f.read()

        match = re.search(r"const DRM_AND_SECURE_REGEX\s*=\s*/((?:\\/|[^/])+)/;", cls.sw_content)
        cls.assertIsNotNone(match, "DRM_AND_SECURE_REGEX regex literal not found in sw.js")
        cls.regex = re.compile(match.group(1))

    def test_adversarial_drm_path_matrix_positive_matches(self):
        """ADVERSARIAL: Verify extensive matrix of protected routes match regex and bypass Cache Storage."""
        adversarial_protected_paths = [
            # Reader page endpoints
            "/api/web/reader/page/booklet_42/1",
            "/api/web/reader/page/demo/10",
            "/api/web/reader/page/anatomy_atlas_2026/150",
            # Reader manifest endpoints
            "/api/web/reader/manifest/res/f123",
            "/api/web/reader/manifest/ref/physiology_guyton",
            # Authentication & session endpoints
            "/api/web-auth/challenge/create",
            "/api/web-auth/challenge/verify",
            "/api/web-auth/sessions",
            "/api/web/sessions",
            "/api/web/sessions/terminate",
            # Digital Ink sync endpoints
            "/api/web/ink/sync",
            "/api/web/ink/sync/page/booklet_42/1",
            # AI chat & vision endpoints
            "/api/ai/ask",
            "/api/ai/vision",
            "/api/ai/threads",
            # QBank & Exam endpoints
            "/api/web/exam/setup",
            "/api/web/exam/mock/sess_123/finish",
            "/api/web/exam/flag/q_999",
            # Student wallet & subscription endpoints
            "/api/web/wallet/balance",
            "/api/web/wallet/topup",
            "/api/subscription/plans",
            "/api/subscription/purchase",
        ]

        for p in adversarial_protected_paths:
            self.assertTrue(
                self.regex.match(p),
                f"CRITICAL DRM BYPASS BUG: Route '{p}' failed DRM regex and risks leakage into Cache Storage!",
            )

    def test_public_and_static_routes_do_not_match_drm_regex(self):
        """ADVERSARIAL: Ensure public assets and client HTML are NOT matched by DRM regex (so caching works)."""
        public_paths = [
            "/student/index.html",
            "/student/manifest.webmanifest",
            "/student/assets/index-B7x.js",
            "/student/assets/index-rUfK6C0y.css",
            "/student/assets/vazirmatn-latin-BFexNX-K.woff2",
            "/student/assets/vazirmatn-arabic-Cafbb7Zc.woff2",
            "/favicon-64.png",
            "/icons/icon-192.png",
            "/icons/icon-512.png",
            "/icons/maskable-512.png",
        ]
        for p in public_paths:
            self.assertIsNone(
                self.regex.match(p),
                f"Public asset '{p}' incorrectly matched DRM regex, disabling static caching",
            )

    def test_verbatim_persian_offline_response_payload(self):
        """ADVERSARIAL: Offline fallback must return exact Persian DRM text and 503 status code."""
        exact_persian = "مشاهده جزوات محافظت‌شده نیازمند اتصال فعال به اینترنت است"
        self.assertIn(exact_persian, self.sw_content)

        # Extract fields from DRM_OFFLINE_RESPONSE
        err_m = re.search(r'error:\s*"([^"]+)"', self.sw_content)
        self.assertIsNotNone(err_m)
        self.assertEqual(err_m.group(1), "DRM_OFFLINE_PROTECTED")

        detail_m = re.search(r'detail:\s*"([^"]+)"', self.sw_content)
        self.assertIsNotNone(detail_m)
        self.assertEqual(detail_m.group(1), exact_persian)

        offline_m = re.search(r'offline:\s*(true|false)', self.sw_content)
        self.assertIsNotNone(offline_m)
        self.assertEqual(offline_m.group(1), "true")

        # Status 503 and headers check
        self.assertIn("status: 503", self.sw_content)
        self.assertIn("'Cache-Control': 'no-store, no-cache, must-revalidate'", self.sw_content)

    def test_sw_network_first_rejects_private_and_no_store(self):
        """ADVERSARIAL: Verify networkFirstWithTTL helper strictly checks for no-store/private before caching."""
        self.assertIn("cacheControl.includes('no-store')", self.sw_content)
        self.assertIn("cacheControl.includes('private')", self.sw_content)


class TestAdversarialFernetCrypto(unittest.TestCase):
    """Adversarial stress-testing and tamper fuzzing for Fernet AES backup encryption (`TC-BAK-01`)."""

    @classmethod
    def setUpClass(cls):
        from backend.core import utils_crypto as uc
        cls.uc = uc
        cls.original_key = uc._FERNET_KEY
        cls.original_fernet = uc._fernet

    @classmethod
    def tearDownClass(cls):
        cls.uc._FERNET_KEY = cls.original_key
        cls.uc._fernet = cls.original_fernet

    def setUp(self):
        self.key = Fernet.generate_key().decode("ascii")
        self.uc._FERNET_KEY = self.key
        self.uc._fernet = Fernet(self.key.encode("ascii"))

    def test_complex_persian_medical_backup_roundtrip(self):
        """ADVERSARIAL: Roundtrip with rich nested Persian medical data, timestamps, floats, and binary IDs."""
        complex_backup = {
            "version": 2,
            "system": "HumsYarX VPS Production",
            "timestamp": "1405-08-17T22:30:00Z",
            "records": [
                {
                    "user_id": 989123456789,
                    "name": "دکتر امیرحسین محمدی",
                    "role": "student",
                    "term": 4,
                    "curriculum": "پزشکی عمومی - فیزیولوژی و پاتولوژی",
                    "gpa": 18.75,
                    "notes": ["نکته ۱: چرخه کربس در میتوکندری", "نکته ۲: کانال‌های کلسیمی نوع L"],
                },
                {
                    "question_id": "q_anat_head_neck_042",
                    "stem": "کدام عصب از فورامن اووال عبور می‌کند؟",
                    "choices": ["عصب ماندیبولار (V3)", "عصب ماگزیلاری (V2)", "عصب چشمی (V1)", "عصب صورتی (VII)"],
                    "correct": 0,
                    "weight": 1.0,
                }
            ],
            "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
        }
        raw_bytes = json.dumps(complex_backup, ensure_ascii=False).encode("utf-8")

        # 1. Encrypt
        encrypted = self.uc.encrypt_bytes(raw_bytes)
        self.assertIsNotNone(encrypted)
        self.assertNotEqual(encrypted, raw_bytes)
        self.assertTrue(encrypted.startswith(b"gAAAAA"))

        # 2. Decrypt
        decrypted = self.uc.decrypt_bytes(encrypted)
        self.assertEqual(decrypted, raw_bytes)

        restored_dict = json.loads(decrypted.decode("utf-8"))
        self.assertEqual(restored_dict["records"][0]["name"], "دکتر امیرحسین محمدی")
        self.assertEqual(restored_dict["records"][1]["correct"], 0)

    def test_tamper_fuzzing_matrix_rejection(self):
        """ADVERSARIAL FUZZING: Bit-flipping and structural mutations must return None (fail-closed)."""
        raw_payload = b"Top Secret Medical QBank & Patient Records Database Snapshot 2026"
        token = self.uc.encrypt_bytes(raw_payload)
        self.assertIsNotNone(token)

        # 1. Flip bit at every 5th byte across entire token
        for byte_idx in range(0, len(token), 5):
            tampered = bytearray(token)
            tampered[byte_idx] ^= 0x01  # Flip least significant bit
            res = self.uc.decrypt_bytes(bytes(tampered))
            self.assertIsNone(
                res,
                f"Tamper detection failed at byte index {byte_idx}: decrypted tampered ciphertext instead of returning None!",
            )

        # 2. Byte truncation fuzzing (from length 0 to len-1)
        test_truncation_lengths = [0, 1, 5, 10, 20, 30, 40, 50, len(token) - 1, len(token) - 16]
        for t_len in test_truncation_lengths:
            truncated = token[:t_len]
            res = self.uc.decrypt_bytes(truncated)
            self.assertIsNone(
                res,
                f"Truncation test failed at length {t_len}: expected None, got {res}",
            )

        # 3. Payload prepend junk
        self.assertIsNone(self.uc.decrypt_bytes(b"JUNK" + token))

        # 4. Decrypt with different key (Key mismatch)
        other_key = Fernet.generate_key().decode("ascii")
        self.uc._fernet = Fernet(other_key.encode("ascii"))
        self.assertIsNone(self.uc.decrypt_bytes(token), "Decryption with incorrect key must return None")


class TestAdversarialStudentPWABuild(unittest.TestCase):
    """Adversarial verification of Student PWA build artifacts and Dockerfile multi-stage packaging."""

    def test_student_pwa_dist_artifacts_exist(self):
        """ADVERSARIAL: Verify production build output exists on disk with complete assets."""
        dist_dir = ROOT / "apps" / "student" / "dist"
        self.assertTrue(dist_dir.exists(), f"apps/student/dist missing: {dist_dir}")

        index_file = dist_dir / "index.html"
        self.assertTrue(index_file.exists(), f"apps/student/dist/index.html missing: {index_file}")
        self.assertGreater(index_file.stat().st_size, 500, "index.html is suspiciously small or empty")

        manifest_file = dist_dir / "manifest.webmanifest"
        self.assertTrue(manifest_file.exists(), f"apps/student/dist/manifest.webmanifest missing: {manifest_file}")

        with open(manifest_file, "r", encoding="utf-8") as f:
            manifest_data = json.load(f)

        self.assertEqual(manifest_data.get("display"), "standalone")
        self.assertEqual(manifest_data.get("dir"), "rtl")

    def test_dockerfile_multi_stage_student_pwa_integration(self):
        """ADVERSARIAL: Verify Dockerfile compiles apps/student in Stage 1 and bundles into Stage 2."""
        dockerfile = ROOT / "Dockerfile"
        self.assertTrue(dockerfile.exists())
        with open(dockerfile, "r", encoding="utf-8") as f:
            content = f.read()

        # Stage 1: Build
        self.assertIn("ENV VITE_BASE=/student/", content)
        self.assertIn("COPY apps/student/package.json apps/student/package-lock.json ./apps/student/", content)
        self.assertIn("npm --prefix ./apps/student ci", content)
        self.assertIn("npm --prefix ./apps/student run build", content)

        # Stage 2: Runtime bundle
        self.assertIn("COPY --from=frontend /build/apps/student/dist ./apps/student/dist", content)

        # Selfchecks
        self.assertIn("test -f /srv/humsyar/apps/student/dist/index.html", content)
        self.assertIn("test -f /srv/humsyar/apps/student/dist/manifest.webmanifest", content)


if __name__ == "__main__":
    unittest.main()
