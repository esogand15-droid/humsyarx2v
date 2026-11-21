# -*- coding: utf-8 -*-
"""Empirical Stress Test Harness for Wave 2 Remediation.

Authored by challenger_w2_iter2_1 to empirically verify:
1. Student Code Crockford-32 normalization & 'HY' prefix preservation across 10,000+ random and edge-case codes.
2. Web Auth Anti-Enumeration: identical response schemas (zero user_hint or account oracles) across active,
   suspended, blacklisted, unapproved, and non-existent users.
3. Strict HTTP 422 enforcement on malformed inputs (symbols, forbidden letters 'U'/'u', invalid lengths, injection attacks).
4. Outbox dispatch isolation (only genuine active users receive Telegram bot prompts; decoys do not pollute outbox).
"""
from __future__ import annotations

import asyncio
import os
import random
import secrets
import statistics
import time
import unittest
from datetime import datetime, timezone
from typing import Optional
from unittest.mock import patch

os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017/humsyar_test")
os.environ.setdefault("ADMIN_ID", "1")
os.environ.setdefault("TELEGRAM_TOKEN", "123:TEST")

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.core import student_code as sc
from backend.api.routers import web_auth
from api import web_login_core as core
from tests.test_wave2_web_auth import FakeDatabase


class TestStudentCodeCrockfordMassiveStress(unittest.TestCase):
    """Empirical stress test for Crockford Base32 normalization and 'HY' prefix preservation."""

    def test_ten_thousand_crockford_codes_prefix_preservation(self):
        """Generates 10,000 random Crockford codes and verifies no 8-char codes are truncated."""
        rng = random.Random(42)
        alphabet = sc.CROCKFORD_ALPHABET

        # 1. 10,000 purely random 8-character codes
        random_codes = [
            "".join(rng.choice(alphabet) for _ in range(8))
            for _ in range(10000)
        ]

        # 2. 5,000 forced "HY"-starting 8-character codes
        forced_hy_codes = [
            "HY" + "".join(rng.choice(alphabet) for _ in range(6))
            for _ in range(5000)
        ]

        # 3. 2,500 forced lowercase "hy"-starting codes
        forced_hy_lower = [
            "hy" + "".join(rng.choice(alphabet) for _ in range(6)).lower()
            for _ in range(2500)
        ]

        all_test_codes = random_codes + forced_hy_codes + forced_hy_lower
        self.assertEqual(len(all_test_codes), 17500)

        hy_started_count = 0
        truncated_count = 0

        for raw in all_test_codes:
            self.assertTrue(
                sc.is_valid_code_format(raw),
                f"Valid 8-char Crockford code {raw} failed validation"
            )

            norm = sc.normalize_code(raw)
            if len(norm) != 8:
                truncated_count += 1

            # If raw started with HY/hy, norm must still start with HY and be 8 chars
            if raw.upper().startswith("HY"):
                hy_started_count += 1
                self.assertEqual(
                    len(norm), 8,
                    f"Code {raw} starting with HY was improperly truncated to {len(norm)} chars: {norm}"
                )
                self.assertTrue(
                    norm.startswith("HY"),
                    f"Code {raw} starting with HY lost its prefix in normalization: {norm}"
                )

        self.assertGreater(hy_started_count, 7500, "Should have tested thousands of HY-starting codes")
        self.assertEqual(truncated_count, 0, f"Found {truncated_count} truncated codes!")

    def test_prefixed_variations_normalization(self):
        """Verifies prefixed codes (HY-XXXX-XXXX, HYXXXXXXXX, HY-XXXXXXXX) normalize to exact 8 chars."""
        test_samples = [
            # Standard code without naturally occurring HY
            "7K9M2P4X",
            # Code naturally starting with HY
            "HY7K9M2P",
            # Code naturally ending with HY
            "7K9M2PHY",
            # Code containing double HY
            "HYHY9M2P",
            # Code with lookalikes
            "7K9MOILX",
        ]

        for sample in test_samples:
            expected_norm = sample.upper().replace("O", "0").replace("I", "1").replace("L", "1")

            # 1. Hyphenated with prefix: HY-XXXX-XXXX
            p1 = f"HY-{sample[:4]}-{sample[4:]}"
            self.assertTrue(sc.is_valid_code_format(p1), f"Failed for {p1}")
            self.assertEqual(sc.normalize_code(p1), expected_norm)

            # 2. Lowercase hyphenated: hy-xxxx-xxxx
            p2 = f"hy-{sample[:4].lower()}-{sample[4:].lower()}"
            self.assertTrue(sc.is_valid_code_format(p2), f"Failed for {p2}")
            self.assertEqual(sc.normalize_code(p2), expected_norm)

            # 3. 10-character unhyphenated prefixed: HYXXXXXXXX
            p3 = f"HY{sample}"
            self.assertTrue(sc.is_valid_code_format(p3), f"Failed for {p3}")
            self.assertEqual(sc.normalize_code(p3), expected_norm)

            # 4. 10-character lowercase prefixed: hyxxxxxxxx
            p4 = f"hy{sample.lower()}"
            self.assertTrue(sc.is_valid_code_format(p4), f"Failed for {p4}")
            self.assertEqual(sc.normalize_code(p4), expected_norm)

            # 5. 11-character hyphen prefix without middle dash: HY-XXXXXXXX
            p5 = f"HY-{sample}"
            self.assertTrue(sc.is_valid_code_format(p5), f"Failed for {p5}")
            self.assertEqual(sc.normalize_code(p5), expected_norm)

            # 6. Raw 8-char format
            self.assertTrue(sc.is_valid_code_format(sample), f"Failed for {sample}")
            self.assertEqual(sc.normalize_code(sample), expected_norm)

    def test_double_hy_prefix_boundary(self):
        """Stress-tests codes that start with 'HY' when prefixed with 'HY-' and 'HY'."""
        # A raw 8-character code: 'HY7K9M2P'
        raw = "HY7K9M2P"
        self.assertEqual(len(raw), 8)

        # Prefixed via format_code
        formatted = sc.format_code(raw, prefix=True)
        self.assertEqual(formatted, "HY-HY7K-9M2P")
        self.assertEqual(sc.normalize_code(formatted), "HY7K9M2P")

        # Prefixed 10-char raw string: 'HYHY7K9M2P'
        raw10 = "HY" + raw
        self.assertEqual(len(raw10), 10)
        self.assertEqual(sc.normalize_code(raw10), "HY7K9M2P")

        # Prefixed 11-char dash string: 'HY-HY7K9M2P'
        raw11 = "HY-" + raw
        self.assertEqual(sc.normalize_code(raw11), "HY7K9M2P")


class TestWebAuthAntiEnumerationAndSchemaIntegrity(unittest.TestCase):
    """Empirical verification of API response schema equality and zero information leakage."""

    def setUp(self):
        self.users = [
            # 1. Normal active student
            {
                "user_id": 1001,
                "name": "Active Student",
                "username": "active_user",
                "student_id": "40100001",
                "approved": True,
                "suspended": False,
                "blacklisted": False,
                "subscription_active": True,
                "web_login_code": "HY-7K9M-2P4X",
            },
            # 2. Suspended student
            {
                "user_id": 1002,
                "name": "Suspended Student",
                "username": "suspended_user",
                "student_id": "40100002",
                "approved": True,
                "suspended": True,
                "blacklisted": False,
                "subscription_active": False,
                "web_login_code": "HY-3F8B-9K1L",
            },
            # 3. Blacklisted student
            {
                "user_id": 1003,
                "name": "Blacklisted Student",
                "username": "blacklisted_user",
                "student_id": "40100003",
                "approved": True,
                "suspended": False,
                "blacklisted": True,
                "subscription_active": False,
                "web_login_code": "HY-4G5H-6J7K",
            },
            # 4. Unapproved student
            {
                "user_id": 1004,
                "name": "Unapproved Student",
                "username": "pending_user",
                "student_id": "40100004",
                "approved": False,
                "suspended": False,
                "blacklisted": False,
                "subscription_active": False,
                "web_login_code": "HY-5M6N-7P8Q",
            },
            # 5. Student whose code naturally starts with HY
            {
                "user_id": 1005,
                "name": "Natural HY Student",
                "username": "natural_hy",
                "student_id": "40100005",
                "approved": True,
                "suspended": False,
                "blacklisted": False,
                "subscription_active": True,
                "web_login_code": "HY-HY7K-9M2P",
            },
        ]
        self.fake_db = FakeDatabase(self.users)
        self.patcher = patch("backend.api.routers.web_auth.db", self.fake_db)
        self.patcher.start()

        self.app = FastAPI()
        self.app.include_router(web_auth.router, prefix="/api/web-auth")
        self.client = TestClient(self.app)

        # Disable IP rate limiter for tests
        self.orig_allow = core.IP_LIMITER.allow
        core.IP_LIMITER.allow = lambda key: True

    def tearDown(self):
        self.patcher.stop()
        core.IP_LIMITER.allow = self.orig_allow

    def test_identical_response_schemas_across_user_states(self):
        """Responses for active, suspended, blacklisted, unapproved, and non-existent users are structurally identical."""
        expected_keys = {"challenge_id", "status", "expires_in_seconds", "expires_in_sec", "display_code"}

        test_cases = [
            ("Active User", "HY-7K9M-2P4X", True),
            ("Natural HY User", "HY-HY7K-9M2P", True),
            ("Natural HY Raw Code", "HY7K9M2P", True),
            ("Suspended User", "HY-3F8B-9K1L", False),
            ("Blacklisted User", "HY-4G5H-6J7K", False),
            ("Unapproved User", "HY-5M6N-7P8Q", False),
            ("Non-Existent User Code", "HY-8N2Q-3W5Y", False),
        ]

        responses = {}

        for label, code, should_dispatch_outbox in test_cases:
            # Clear outbox before test
            outbox_coll = self.fake_db.client["medicalbot"]["bot_notifications"]
            outbox_coll.docs.clear()

            resp = self.client.post("/api/web-auth/challenge/create", json={"user_code": code})
            self.assertEqual(
                resp.status_code, 200,
                f"Expected 200 OK for {label} (code={code}), got {resp.status_code}: {resp.text}"
            )
            data = resp.json()
            responses[label] = data

            # Verify keys match exactly
            self.assertEqual(
                set(data.keys()), expected_keys,
                f"Schema divergence for {label}: extra/missing keys={set(data.keys()) ^ expected_keys}"
            )

            # Strict verification: NO user_hint or personal identifiable info
            self.assertNotIn("user_hint", data, f"Critical security leak: user_hint present in {label}")
            self.assertNotIn("user", data, f"user object leaked in {label}")
            self.assertNotIn("uid", data, f"uid leaked in {label}")

            # Verify standard field values
            self.assertEqual(data["status"], "pending_telegram_approval")
            self.assertEqual(data["expires_in_seconds"], 180)
            self.assertEqual(data["expires_in_sec"], 180)
            self.assertTrue(data["challenge_id"].startswith("ch_"))
            self.assertEqual(len(data["display_code"]), 4)

            # Verify outbox isolation: only active accounts trigger Telegram alerts
            if should_dispatch_outbox:
                self.assertEqual(
                    len(outbox_coll.docs), 1,
                    f"Outbox should receive notification for {label}"
                )
                self.assertEqual(outbox_coll.docs[0]["type"], "web_auth_approval_prompt")
            else:
                self.assertEqual(
                    len(outbox_coll.docs), 0,
                    f"Outbox was improperly dispatched for non-active or non-existent user {label}"
                )

        print("\n[VERIFIED IDENTICAL SCHEMAS]")
        for label, payload in responses.items():
            print(f"  {label:<25} -> keys: {sorted(list(payload.keys()))}")

    def test_strict_http_422_rejections_for_malformed_codes(self):
        """All malformed codes strictly return HTTP 422 Unprocessable Entity."""
        malformed_inputs = [
            # Symbols
            "HY-7K9@-2P4X",
            "HY-7K9#-2P4X",
            "HY-7K9$-2P4X",
            "HY-7K9%-2P4X",
            "HY-7K9!-2P4X",
            "HY-7K9*-2P4X",
            "@7K9M2P4",
            "7K9M2P4#",
            "7K9M?2P4",
            # Crockford-forbidden characters 'U' and 'u'
            "HY-7K9U-2P4X",
            "HY-7K9u-2P4X",
            "U7K9M2P4",
            "u7k9m2p4",
            "7K9M2P4U",
            # Invalid lengths
            "A",
            "12",
            "123",
            "1234",
            "12345",
            "123456",
            "1234567",
            "123456789",  # 9 chars
            "1234567890123",
            "HY-12345",
            "HY-123456789",
            # Multiple prefixes
            "HY-HY-7K9M-2P4X",
            "HY-HY7K9M2P4X",
            "HY-HY-HY-7K9M-2P4X",
            # Injections and scripts
            "' OR '1'='1",
            "'; DROP TABLE users; --",
            "<script>alert(1)</script>",
            # Non-ASCII Unicode / Persian text
            "کددانشجویی",
            "۱۲۳۴۵۶۷۸",
            "🔑7K9M2P4X",
            "7K9M2P4X❤️",
        ]

        for malformed in malformed_inputs:
            # 1. Ensure student_code rejects it
            self.assertFalse(
                sc.is_valid_code_format(malformed),
                f"is_valid_code_format should reject '{malformed}'"
            )

            # 2. Call endpoint and ensure HTTP 422
            resp = self.client.post("/api/web-auth/challenge/create", json={"user_code": malformed})
            self.assertEqual(
                resp.status_code, 422,
                f"Malformed code '{malformed}' returned status {resp.status_code} instead of 422"
            )

        print(f"\n[VERIFIED HTTP 422 ENFORCEMENT] All {len(malformed_inputs)} adversarial inputs successfully rejected with HTTP 422.")

    def test_timing_channel_differential(self):
        """Measures execution timing between existing and non-existing accounts over 100 requests."""
        valid_times = []
        invalid_times = []

        # Warm up
        for _ in range(10):
            self.client.post("/api/web-auth/challenge/create", json={"user_code": "HY-7K9M-2P4X"})
            self.client.post("/api/web-auth/challenge/create", json={"user_code": "HY-8N2Q-3W5Y"})

        # 100 alternating samples
        for _ in range(100):
            t0 = time.perf_counter()
            self.client.post("/api/web-auth/challenge/create", json={"user_code": "HY-7K9M-2P4X"})
            valid_times.append((time.perf_counter() - t0) * 1000)

            t0 = time.perf_counter()
            self.client.post("/api/web-auth/challenge/create", json={"user_code": "HY-8N2Q-3W5Y"})
            invalid_times.append((time.perf_counter() - t0) * 1000)

        mean_v = statistics.mean(valid_times)
        mean_i = statistics.mean(invalid_times)
        delta = abs(mean_v - mean_i)

        print(f"\n[TIMING CHANNEL TEST]")
        print(f"  Valid code latency:   mean={mean_v:.3f}ms, stdev={statistics.stdev(valid_times):.3f}ms")
        print(f"  Invalid code latency: mean={mean_i:.3f}ms, stdev={statistics.stdev(invalid_times):.3f}ms")
        print(f"  Differential:         {delta:.3f}ms")

        # In-memory execution timing delta should be under 5 milliseconds
        self.assertLess(delta, 5.0, f"Timing channel leak detected: delta={delta:.3f}ms")


if __name__ == "__main__":
    unittest.main()
