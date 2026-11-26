# -*- coding: utf-8 -*-
"""Wave 7 VPS Production Hardening and Zero-Storage DRM Protection Test Suite.

Covers:
- TC-DOCKER-01: Docker Compose memory limits <= 7.0 GB (7168 MB) on 8 GB VPS host.
- TC-DOCKER-02: PyMuPDF worker memory <= 1.0 GB and concurrency pinned to 1.
- TC-PROXY-01 & TC-PROXY-02: Caddyfile TLS 1.3, HTTP/3 UDP, HSTS, security headers, immutable caching.
- TC-BUILD-01: Multi-stage Dockerfile apps/student compilation and selfchecks.
- TC-MANIFEST-01 & TC-MANIFEST-02: Service Worker DRM zero-storage regex and offline Persian response.
- TC-BAK-01: Fernet AES backup roundtrip encryption, decryption, and tamper rejection.
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


class TestDockerComposeHardening(unittest.TestCase):
    """TC-DOCKER-01 & TC-DOCKER-02: Docker Compose resource limits & PyMuPDF worker configuration."""

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

    def test_services_inventory(self):
        """Verify all required services are defined in docker-compose.yml."""
        expected_services = {"app", "mongo", "render_worker", "caddy"}
        self.assertTrue(
            expected_services.issubset(set(self.services.keys())),
            f"Missing services: {expected_services - set(self.services.keys())}",
        )

    def test_total_container_memory_limit_bound(self):
        """TC-DOCKER-01: Sum of container memory limits must be <= 7.0 GB (7168 MB)."""
        total_limit_mb = 0
        service_limits = {}

        for name, service in self.services.items():
            deploy = service.get("deploy", {})
            resources = deploy.get("resources", {})
            limits = resources.get("limits", {})
            mem_limit = limits.get("memory")
            self.assertIsNotNone(mem_limit, f"Service {name} lacks deploy.resources.limits.memory")
            mb = self._parse_memory_mb(mem_limit)
            service_limits[name] = mb
            total_limit_mb += mb

        # Exact limits verification
        self.assertEqual(service_limits.get("app"), 3072, "app memory limit must be 3072M (3.0 GB)")
        self.assertEqual(service_limits.get("mongo"), 2560, "mongo memory limit must be 2560M (2.5 GB)")
        self.assertEqual(service_limits.get("render_worker"), 1024, "render_worker limit must be 1024M (1.0 GB)")
        self.assertEqual(service_limits.get("caddy"), 512, "caddy memory limit must be 512M (0.5 GB)")

        self.assertLessEqual(
            total_limit_mb,
            7168,
            f"Total container memory limit {total_limit_mb}MB exceeds 7168MB (7.0 GB) VPS ceiling",
        )
        self.assertEqual(total_limit_mb, 7168, "Sum of memory limits must be exactly 7168 MB (7.0 GB)")

    def test_cpu_limits_and_reservations(self):
        """Verify cpu limits and memory reservations across services."""
        app_res = self.services["app"]["deploy"]["resources"]
        self.assertEqual(app_res["limits"]["cpus"], "1.2")
        self.assertEqual(app_res["reservations"]["cpus"], "0.5")
        self.assertEqual(self._parse_memory_mb(app_res["reservations"]["memory"]), 1024)

        mongo_res = self.services["mongo"]["deploy"]["resources"]
        self.assertEqual(mongo_res["limits"]["cpus"], "1.0")
        self.assertEqual(mongo_res["reservations"]["cpus"], "0.25")
        self.assertEqual(self._parse_memory_mb(mongo_res["reservations"]["memory"]), 512)

        caddy_res = self.services["caddy"]["deploy"]["resources"]
        self.assertEqual(caddy_res["limits"]["cpus"], "0.5")
        self.assertEqual(caddy_res["reservations"]["cpus"], "0.1")
        self.assertEqual(self._parse_memory_mb(caddy_res["reservations"]["memory"]), 64)

    def test_pymupdf_render_worker_isolation(self):
        """TC-DOCKER-02: PyMuPDF worker is pinned to concurrency=1 and memory limit <= 1.0 GB."""
        worker = self.services.get("render_worker")
        self.assertIsNotNone(worker, "render_worker service missing")

        # Concurrency pinned to 1
        env = worker.get("environment", {})
        concurrency = env.get("CONCURRENCY")
        self.assertEqual(str(concurrency), "1", "render_worker CONCURRENCY must be pinned to '1'")

        # Memory limit <= 1024M
        deploy = worker.get("deploy", {})
        limits = deploy.get("resources", {}).get("limits", {})
        mem_mb = self._parse_memory_mb(limits.get("memory", "0M"))
        self.assertLessEqual(mem_mb, 1024, f"render_worker memory limit {mem_mb}M exceeds 1024M")

        # Command runs backend.workers.render_worker
        command = worker.get("command", [])
        command_str = " ".join(command) if isinstance(command, list) else str(command)
        self.assertIn("backend.workers.render_worker", command_str)

    def test_database_identifier_and_wiredtiger_cache(self):
        """Verify canonical medicalbot database identifier and WiredTiger cache cap."""
        # App database env
        app_env = self.services["app"].get("environment", {})
        self.assertEqual(app_env.get("MONGODB_NAME"), "medicalbot")
        self.assertIn("medicalbot", app_env.get("MONGODB_URI", ""))

        # Mongo command & database init
        mongo = self.services["mongo"]
        mongo_cmd = " ".join(mongo.get("command", []))
        self.assertIn("--wiredTigerCacheSizeGB", mongo_cmd)
        self.assertIn("1.5", mongo_cmd)

        mongo_env = mongo.get("environment", {})
        self.assertEqual(mongo_env.get("MONGO_INITDB_DATABASE"), "medicalbot")

    def test_caddy_ports_quic_udp(self):
        """Verify Caddy exposes 443/udp for HTTP/3 QUIC."""
        caddy = self.services["caddy"]
        ports = caddy.get("ports", [])
        self.assertIn("80:80", ports)
        self.assertIn("443:443", ports)
        self.assertTrue(
            any("443:443/udp" in str(p) for p in ports),
            "Caddy ports must expose 443:443/udp for HTTP/3 QUIC negotiation",
        )


class TestCaddyfileHardening(unittest.TestCase):
    """TC-PROXY-01 & TC-PROXY-02: Caddy reverse proxy TLS 1.3, security headers & DRM caching."""

    @classmethod
    def setUpClass(cls):
        caddy_file = ROOT / "Caddyfile"
        if not caddy_file.exists():
            raise unittest.SkipTest("Caddyfile absent (Cloady PaaS edge deployment)")
        with open(caddy_file, "r", encoding="utf-8") as f:
            cls.content = f.read()

    def test_domain_and_tls_13_enforcement(self):
        """TC-PROXY-01: TLS 1.3 and modern cipher curves."""
        self.assertIn("protocols tls1.2 tls1.3", self.content)
        self.assertIn("curves x25519 secp256r1", self.content)
        self.assertIn("sw2.pwker.ir", self.content)

    def test_compression_and_body_limits(self):
        """Verify compression and request body limit."""
        self.assertIn("encode zstd gzip", self.content)
        self.assertIn("max_size 50MB", self.content)

    def test_strict_security_headers(self):
        """TC-PROXY-02: Security headers injection."""
        self.assertIn('Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"', self.content)
        self.assertIn('X-Content-Type-Options "nosniff"', self.content)
        self.assertIn("frame-ancestors 'self' https://web.telegram.org https://*.telegram.org;", self.content)
        self.assertIn('X-Frame-Options "SAMEORIGIN"', self.content)
        self.assertIn('Referrer-Policy "strict-origin-when-cross-origin"', self.content)
        self.assertIn('Permissions-Policy "accelerometer=(), camera=(), microphone=(), geolocation=(), payment=()"', self.content)
        self.assertIn('Cross-Origin-Opener-Policy "same-origin-allow-popups"', self.content)
        self.assertIn("-Server", self.content)

    def test_immutable_static_assets_caching(self):
        """Verify immutable caching headers for hashed Vite chunks."""
        self.assertIn("/student/assets/*", self.content)
        self.assertIn('Cache-Control "public, max-age=31536000, immutable"', self.content)

    def test_drm_reader_zero_cache_proxy_headers(self):
        """Verify DRM reader endpoints bypass proxy cache with no-store."""
        self.assertIn("/api/web/reader/page/*", self.content)
        self.assertIn("/api/web/reader/manifest/*", self.content)
        self.assertIn('Cache-Control "private, no-store, no-cache, max-age=0, must-revalidate"', self.content)
        self.assertIn('Pragma "no-cache"', self.content)

    def test_reverse_proxy_streaming_tuning(self):
        """Verify reverse proxy upstream buffering disabled for SSE / streaming."""
        self.assertIn("reverse_proxy app:8000", self.content)
        self.assertIn("flush_interval -1", self.content)
        self.assertIn("keepalive 30s", self.content)


class TestDockerfileMultiStageBuild(unittest.TestCase):
    """TC-BUILD-01: Dockerfile multi-stage build for apps/student and runtime selfcheck."""

    @classmethod
    def setUpClass(cls):
        dockerfile = ROOT / "Dockerfile"
        cls.assertTrue(dockerfile.exists(), f"Dockerfile missing at {dockerfile}")
        with open(dockerfile, "r", encoding="utf-8") as f:
            cls.content = f.read()

    def test_stage1_student_pwa_compilation(self):
        """Stage 1 builds apps/student with VITE_BASE=/student/."""
        self.assertIn("ENV VITE_BASE=/student/", self.content)
        self.assertIn("COPY apps/student/package.json apps/student/package-lock.json ./apps/student/", self.content)
        self.assertIn("npm --prefix ./apps/student ci", self.content)
        self.assertIn("npm --prefix ./apps/student run build", self.content)

    def test_stage2_student_dist_bundle(self):
        """Stage 2 copies student dist from frontend build stage."""
        self.assertIn("COPY --from=frontend /build/apps/student/dist ./apps/student/dist", self.content)

    def test_build_time_selfcheck_assertions(self):
        """Build-time selfcheck verifies student index.html and manifest."""
        self.assertIn("test -f /srv/humsyar/apps/student/dist/index.html", self.content)
        self.assertIn("test -f /srv/humsyar/apps/student/dist/manifest.webmanifest", self.content)


class TestServiceWorkerDRMProtection(unittest.TestCase):
    """TC-MANIFEST-01 & TC-MANIFEST-02: Student PWA Service Worker strict DRM bypass & offline response."""

    @classmethod
    def setUpClass(cls):
        sw_file = ROOT / "apps" / "student" / "public" / "sw.js"
        cls.assertTrue(sw_file.exists(), f"sw.js missing at {sw_file}")
        with open(sw_file, "r", encoding="utf-8") as f:
            cls.sw_content = f.read()

    def test_drm_regex_pattern_presence(self):
        """Verify DRM and secure path regex matches all proprietary endpoints."""
        expected_pattern = r"^/api/(web/reader/|web-auth/|web/sessions|web/ink/sync|ai/|web/exam/|web/wallet/|subscription/)"
        self.assertIn("DRM_AND_SECURE_REGEX", self.sw_content)

        # Extract regex from sw.js
        match = re.search(r"const DRM_AND_SECURE_REGEX\s*=\s*/((?:\\/|[^/])+)/;", self.sw_content)
        self.assertIsNotNone(match, "DRM_AND_SECURE_REGEX not found in sw.js")
        regex_str = match.group(1)
        compiled_regex = re.compile(regex_str)

        # Test positive DRM matches (MUST bypass cache)
        protected_routes = [
            "/api/web/reader/page/booklet_123/1",
            "/api/web/reader/manifest/course/anat_01",
            "/api/web-auth/challenge/create",
            "/api/web-auth/sessions",
            "/api/web/sessions",
            "/api/web/ink/sync",
            "/api/ai/ask",
            "/api/ai/vision",
            "/api/web/exam/mock/setup",
            "/api/web/exam/flag/q_999",
            "/api/web/wallet/balance",
            "/api/subscription/plans",
        ]
        for route in protected_routes:
            self.assertTrue(
                compiled_regex.match(route),
                f"DRM_AND_SECURE_REGEX failed to match protected route: {route}",
            )

        # Test negative matches (public assets allowed to cache)
        public_routes = [
            "/student/assets/index-B7x.js",
            "/student/assets/vazirmatn-latin.woff2",
            "/student/index.html",
            "/student/manifest.webmanifest",
            "/favicon-64.png",
            "/icons/icon-192.png",
        ]
        for route in public_routes:
            self.assertIsNone(
                compiled_regex.match(route),
                f"DRM_AND_SECURE_REGEX incorrectly matched public route: {route}",
            )

    def test_offline_persian_drm_response_payload(self):
        """TC-MANIFEST-02: Returns exact Persian offline fallback banner on reader fetch failure."""
        persian_msg = "مشاهده جزوات محافظت‌شده نیازمند اتصال فعال به اینترنت است"
        self.assertIn(persian_msg, self.sw_content)
        self.assertIn("DRM_OFFLINE_PROTECTED", self.sw_content)
        self.assertIn("DRM_OFFLINE_RESPONSE", self.sw_content)
        self.assertIn("503", self.sw_content)
        self.assertIn("no-store, no-cache, must-revalidate", self.sw_content)

    def test_web_app_manifest_integrity(self):
        """TC-MANIFEST-01: manifest.webmanifest has standalone display and all icon files exist."""
        manifest_path = ROOT / "apps" / "student" / "public" / "manifest.webmanifest"
        self.assertTrue(manifest_path.exists())
        with open(manifest_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        self.assertEqual(data.get("display"), "standalone")
        self.assertIn("name", data)
        self.assertIn("short_name", data)
        self.assertIn("icons", data)

        icons_dir = ROOT / "apps" / "student" / "public"
        for icon in data["icons"]:
            src = icon["src"].lstrip("./")
            icon_file = icons_dir / src
            self.assertTrue(icon_file.exists(), f"Icon file missing on disk: {icon_file}")


class TestFernetBackupEncryption(unittest.TestCase):
    """TC-BAK-01: Automated Fernet AES encryption, verified decryption, and tamper rejection."""

    def test_fernet_backup_roundtrip_and_tamper_rejection(self):
        """Generates real Fernet key, encrypts database snapshot, verifies roundtrip and tamper detection."""
        from backend.core import utils_crypto as uc

        # Generate a genuine 32-byte url-safe base64 Fernet key
        test_key = Fernet.generate_key().decode("ascii")
        original_fernet = uc._fernet
        original_key = uc._FERNET_KEY

        try:
            # Configure live Fernet instance
            uc._FERNET_KEY = test_key
            uc._fernet = Fernet(test_key.encode("ascii"))
            self.assertTrue(uc.is_encryption_enabled())

            # Sample MongoDB backup snapshot payload
            sample_backup_payload = json.dumps({
                "version": 1,
                "exported_at": "2026-11-08T01:00:00Z",
                "database": "medicalbot",
                "collections": {
                    "users": [{"_id": "u1", "user_id": 1001, "role": "student"}],
                    "wallets": [{"_id": "w1", "user_id": 1001, "balance": 50000}],
                    "qbank": [{"_id": "q1", "term": 2, "subject": "Anatomy", "text": "Question 1"}],
                },
                "sha256": "abcdef1234567890",
            }, ensure_ascii=False).encode("utf-8")

            # 1. Encryption
            encrypted_token = uc.encrypt_bytes(sample_backup_payload)
            self.assertIsNotNone(encrypted_token)
            self.assertNotEqual(encrypted_token, sample_backup_payload)
            self.assertTrue(encrypted_token.startswith(b"gAAAAA"), "Fernet token must start with gAAAAA")

            # 2. Verified Decryption
            decrypted_payload = uc.decrypt_bytes(encrypted_token)
            self.assertEqual(decrypted_payload, sample_backup_payload)

            # Roundtrip JSON validation
            restored_data = json.loads(decrypted_payload.decode("utf-8"))
            self.assertEqual(restored_data["database"], "medicalbot")
            self.assertEqual(len(restored_data["collections"]["users"]), 1)

            # 3. Tamper Rejection (Bit flipping in ciphertext)
            tampered_token = bytearray(encrypted_token)
            tampered_token[-5] ^= 0xFF  # Flip HMAC or payload bits
            tampered_result = uc.decrypt_bytes(bytes(tampered_token))
            self.assertIsNone(tampered_result, "Tampered ciphertext must fail decryption and return None (fail-closed)")

            # 4. Tamper Rejection (Payload truncation)
            truncated_token = encrypted_token[:20]
            self.assertIsNone(uc.decrypt_bytes(truncated_token), "Truncated token must return None")

            # 5. Wrong Key Rejection
            different_key = Fernet.generate_key().decode("ascii")
            uc._fernet = Fernet(different_key.encode("ascii"))
            wrong_key_result = uc.decrypt_bytes(encrypted_token)
            self.assertIsNone(wrong_key_result, "Decrypting with wrong key must fail and return None")

        finally:
            uc._FERNET_KEY = original_key
            uc._fernet = original_fernet


if __name__ == "__main__":
    unittest.main()
