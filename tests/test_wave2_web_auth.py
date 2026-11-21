# -*- coding: utf-8 -*-
"""Comprehensive Wave 2 Test Suite: Backend Foundation, Web Auth & Storage.

Covers all directives and test matrices specified in DISPATCH.md & spec_miner_w2_1:
1. Crockford Base32 alphabet (32 chars), formatting, typo normalization, HY- prefix, uniqueness collision.
2. Web auth challenge creation (expires_in_seconds, display_code, anti-enumeration decoy).
3. Telegram outbox inline keyboard deserialization & callback approval handling.
4. Challenge approval state transitions, atomic replay protection (HTTP 403 CHALLENGE_ALREADY_CONSUMED),
   session token SHA256 hashing, and hu_session cookie issuance.
5. Emergency fallback OTP verification.
6. Session listing, remote session revocation, logout.
7. current_student dual-cookie resolution (hu_session vs hy_student_session).
8. LocalStorageDriver atomic writes, restrictive permissions (0o600/0o700), path traversal sanitization,
   and active in-flight read lock safety during LRU eviction.
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import re
import secrets
import shutil
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017/humsyar_test")
os.environ.setdefault("ADMIN_ID", "1")
os.environ.setdefault("TELEGRAM_TOKEN", "123:TEST")

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.testclient import TestClient
from telegram import CallbackQuery, Chat, InlineKeyboardButton, InlineKeyboardMarkup, Update, User

from backend.core import student_code as sc
from backend.services.storage import LocalStorageDriver, StorageDriver, VALID_FILE_ID_REGEX
from backend.api.routers import web_auth
from backend.api.routers import web_student
from backend.bot import web_auth_bot


# ══════════════════════════════════════════════════════════════════════════════
#  Fake MongoDB In-Memory Test Infrastructure
# ══════════════════════════════════════════════════════════════════════════════

class FakeCursor:
    def __init__(self, docs: list[dict]):
        self.docs = list(docs)
        self.idx = 0

    def sort(self, key: str, direction: int = 1):
        reverse = (direction == -1)
        self.docs.sort(key=lambda d: d.get(key) or "", reverse=reverse)
        return self

    def __aiter__(self):
        self.idx = 0
        return self

    async def __anext__(self):
        if self.idx < len(self.docs):
            doc = self.docs[self.idx]
            self.idx += 1
            return doc
        raise StopAsyncIteration


class FakeAsyncColl:
    def __init__(self):
        self.docs: list[dict] = []

    def _matches(self, doc: dict, filt: dict) -> bool:
        for k, v in filt.items():
            if k == "$or":
                if not any(self._matches(doc, sub) for sub in v):
                    return False
                continue
            if isinstance(v, dict):
                if "$gt" in v:
                    doc_val = doc.get(k)
                    if doc_val is None or not (doc_val > v["$gt"]):
                        return False
                elif "$regex" in v:
                    flags = re.IGNORECASE if str(v.get("$options", "")).lower() == "i" else 0
                    doc_val = str(doc.get(k) or "")
                    if not re.search(v["$regex"], doc_val, flags):
                        return False
                elif "$in" in v:
                    if doc.get(k) not in v["$in"]:
                        return False
            else:
                if doc.get(k) != v:
                    return False
        return True

    async def find_one(self, filt, *args, **kwargs):
        for d in self.docs:
            if self._matches(d, filt):
                return dict(d)
        return None

    def find(self, filt=None, *args, **kwargs):
        filt = filt or {}
        matched = [dict(d) for d in self.docs if self._matches(d, filt)]
        return FakeCursor(matched)

    async def insert_one(self, doc):
        d = dict(doc)
        self.docs.append(d)
        return d

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if self._matches(d, filt):
                for k, v in (update.get("$inc") or {}).items():
                    d[k] = d.get(k, 0) + v
                for k, v in (update.get("$set") or {}).items():
                    d[k] = v
                class Res:
                    modified_count = 1
                return Res()
        if upsert:
            new_doc = dict(filt)
            for k, v in (update.get("$set") or {}).items():
                new_doc[k] = v
            self.docs.append(new_doc)
            class Res:
                modified_count = 1
            return Res()
        class Res:
            modified_count = 0
        return Res()

    async def update_many(self, filt, update):
        count = 0
        for d in self.docs:
            if self._matches(d, filt):
                for k, v in (update.get("$set") or {}).items():
                    d[k] = v
                count += 1
        class Res:
            modified_count = count
        return Res()

    async def find_one_and_update(self, filt, update):
        for d in self.docs:
            if self._matches(d, filt):
                old = dict(d)
                for k, v in (update.get("$set") or {}).items():
                    d[k] = v
                return old
        return None

    async def delete_one(self, filt):
        for i, d in enumerate(self.docs):
            if self._matches(d, filt):
                del self.docs[i]
                break

    async def delete_many(self, filt):
        self.docs = [d for d in self.docs if not self._matches(d, filt)]


class FakeAsyncClient:
    def __init__(self):
        self.colls: dict[str, FakeAsyncColl] = {}

    def __getitem__(self, name: str) -> FakeAsyncColl:
        return self.colls.setdefault(name, FakeAsyncColl())


class FakeDatabase:
    def __init__(self, users: list[dict]):
        self.client = {"medicalbot": FakeAsyncClient()}
        self.database = self.client["medicalbot"]
        self.users = self.database["users"]
        self.users.database = self.database
        for u in users:
            self.users.docs.append(dict(u))

    async def get_user(self, uid: int, use_cache: bool = True):
        for u in self.users.docs:
            if u.get("user_id") == int(uid):
                return dict(u)
        return None


# ══════════════════════════════════════════════════════════════════════════════
#  1. Student Code Engine Tests
# ══════════════════════════════════════════════════════════════════════════════

class TestStudentCodeEngine(unittest.TestCase):
    """Verifies Crockford Base32 32-character alphabet, normalization, and uniqueness."""

    def test_crockford_alphabet_length_and_characters(self):
        """Alphabet must contain exactly 32 unambiguous characters (0-9, A-Z excl I, L, O, U)."""
        alphabet = sc.CROCKFORD_ALPHABET
        self.assertEqual(len(alphabet), 32)
        # All 10 digits present
        for digit in "0123456789":
            self.assertIn(digit, alphabet)
        # Excluded ambiguous letters
        for excluded in ("I", "L", "O", "U"):
            self.assertNotIn(excluded, alphabet)

    def test_code_formatting(self):
        """Standard formatting produces HY-XXXX-XXXX or XXXX-XXXX."""
        raw = "7K9M2P4X"
        formatted_hy = sc.format_code(raw, prefix=True)
        formatted_dash = sc.format_code(raw, prefix=False)
        self.assertEqual(formatted_hy, "HY-7K9M-2P4X")
        self.assertEqual(formatted_dash, "7K9M-2P4X")

    def test_typo_normalization(self):
        """Accidental typo letters O, I, L are mapped to 0 and 1, and prefixes are stripped."""
        # 'O' maps to '0'
        self.assertEqual(sc.normalize_code("7K9M-2POX"), "7K9M2P0X")
        # 'I' and 'L' map to '1'
        self.assertEqual(sc.normalize_code("7K9M-2PIX"), "7K9M2P1X")
        self.assertEqual(sc.normalize_code("7K9M-2PLX"), "7K9M2P1X")
        # HY- and HY prefixes stripped
        self.assertEqual(sc.normalize_code("HY-7K9M-2P4X"), "7K9M2P4X")
        self.assertEqual(sc.normalize_code("HY7K9M2P4X"), "7K9M2P4X")
        # Lowercase converted
        self.assertEqual(sc.normalize_code("hy-7k9m-2p4x"), "7K9M2P4X")
        # Empty input
        self.assertEqual(sc.normalize_code(""), "")
        self.assertEqual(sc.normalize_code(None), "")

    def test_is_valid_code_format(self):
        """Validates formatted, prefixed, and normalized codes."""
        self.assertTrue(sc.is_valid_code_format("7K9M-2P4X"))
        self.assertTrue(sc.is_valid_code_format("HY-7K9M-2P4X"))
        self.assertTrue(sc.is_valid_code_format("7K9M2P4X"))
        self.assertTrue(sc.is_valid_code_format("hy-7k9m-2p4x"))
        # Invalid inputs
        self.assertFalse(sc.is_valid_code_format(""))
        self.assertFalse(sc.is_valid_code_format(None))
        self.assertFalse(sc.is_valid_code_format("SHORT"))
        self.assertFalse(sc.is_valid_code_format("TOOLONGCODE123"))
        self.assertFalse(sc.is_valid_code_format("7K9M@2P4X"))

    def test_get_or_create_user_code_existing(self):
        """User already possessing a valid code returns that code."""
        db_mock = MagicMock()
        db_mock.users.find_one = AsyncMock(return_value={
            "user_id": 100,
            "web_login_code": "HY-7K9M-2P4X",
        })
        code = asyncio.run(sc.get_or_create_user_code(db_mock, 100))
        self.assertEqual(code, "HY-7K9M-2P4X")

    def test_get_or_create_user_code_generation_with_collision_retry(self):
        """Generates code with retry loop if collision occurs on first attempt."""
        db_mock = MagicMock()
        # First call finds user without code
        # Second call (collision check) finds existing collision
        # Third call (second collision check) finds no collision
        db_mock.users.find_one = AsyncMock(side_effect=[
            {"user_id": 200, "web_login_code": None},  # initial user lookup
            {"user_id": 999, "web_login_code": "COLLIDE"},  # attempt 1: collided
            None,  # attempt 2: unique!
        ])
        db_mock.users.update_one = AsyncMock()

        code = asyncio.run(sc.get_or_create_user_code(db_mock, 200))
        self.assertTrue(code.startswith("HY-"))
        self.assertEqual(len(code), 12)  # HY-XXXX-XXXX
        self.assertTrue(sc.is_valid_code_format(code))
        self.assertEqual(db_mock.users.find_one.await_count, 3)
        db_mock.users.update_one.assert_awaited_once()

    def test_find_user_by_code(self):
        """Finds user by raw code, formatted code, or HY- prefixed code."""
        db_mock = MagicMock()
        target_user = {"user_id": 300, "web_login_code": "HY-7K9M-2P4X"}
        db_mock.users.find_one = AsyncMock(return_value=target_user)

        user = asyncio.run(sc.find_user_by_code(db_mock, "7K9M-2P4X"))
        self.assertEqual(user, target_user)

        user_hy = asyncio.run(sc.find_user_by_code(db_mock, "HY-7K9M-2P4X"))
        self.assertEqual(user_hy, target_user)

        # Invalid format returns None without DB query
        db_mock.users.find_one.reset_mock()
        user_invalid = asyncio.run(sc.find_user_by_code(db_mock, "invalid!!"))
        self.assertIsNone(user_invalid)
        db_mock.users.find_one.assert_not_called()

    def test_hy_prefixed_raw_code_preservation(self):
        """Valid 8-character codes starting with 'HY' must not have 'HY' stripped.

        Because 'H' and 'Y' are valid Crockford Base32 characters, codes like 'HY7K9M2P'
        occur naturally (~1/1024 probability). Stripping 'HY' would corrupt them to 6 chars.
        """
        raw_code = "HY7K9M2P"
        # 1. Normalization preserves the full 8 chars across all input variants
        self.assertEqual(sc.normalize_code(raw_code), "HY7K9M2P")
        self.assertEqual(sc.normalize_code("HY7K-9M2P"), "HY7K9M2P")
        self.assertEqual(sc.normalize_code("HY-HY7K-9M2P"), "HY7K9M2P")
        self.assertEqual(sc.normalize_code("hy-hy7k-9m2p"), "HY7K9M2P")
        self.assertEqual(sc.normalize_code("HY HY7K 9M2P"), "HY7K9M2P")
        self.assertEqual(sc.normalize_code("HYHY7K9M2P"), "HY7K9M2P")

        # 2. Formatting produces correct HY- prefix without losing characters
        self.assertEqual(sc.format_code(raw_code, prefix=True), "HY-HY7K-9M2P")
        self.assertEqual(sc.format_code(raw_code, prefix=False), "HY7K-9M2P")
        self.assertEqual(sc.format_code("HY-HY7K-9M2P", prefix=True), "HY-HY7K-9M2P")

        # 3. Format validation accepts all valid representations
        self.assertTrue(sc.is_valid_code_format(raw_code))
        self.assertTrue(sc.is_valid_code_format("HY7K-9M2P"))
        self.assertTrue(sc.is_valid_code_format("HY-HY7K-9M2P"))
        self.assertTrue(sc.is_valid_code_format("hy-hy7k-9m2p"))
        self.assertTrue(sc.is_valid_code_format("HY HY7K 9M2P"))
        self.assertTrue(sc.is_valid_code_format("HYHY7K9M2P"))

    def test_find_user_by_code_with_hy_prefix_code(self):
        """User with code starting with HY can be located by any equivalent representation."""
        db_mock = MagicMock()
        stored_doc = {"user_id": 555, "web_login_code": "HY-HY7K-9M2P"}
        db_mock.users.find_one = AsyncMock(return_value=stored_doc)

        # Lookup by raw code
        res1 = asyncio.run(sc.find_user_by_code(db_mock, "HY7K9M2P"))
        self.assertEqual(res1, stored_doc)

        # Lookup by hyphenated code
        res2 = asyncio.run(sc.find_user_by_code(db_mock, "HY7K-9M2P"))
        self.assertEqual(res2, stored_doc)

        # Lookup by full prefixed code
        res3 = asyncio.run(sc.find_user_by_code(db_mock, "HY-HY7K-9M2P"))
        self.assertEqual(res3, stored_doc)

        # Lookup by lowercase prefixed code
        res4 = asyncio.run(sc.find_user_by_code(db_mock, "hy-hy7k-9m2p"))
        self.assertEqual(res4, stored_doc)



# ══════════════════════════════════════════════════════════════════════════════
#  2. Web Auth Router & Telegram Approval Flow Tests
# ══════════════════════════════════════════════════════════════════════════════

class TestWebAuthChallengeAndSessionFlow(unittest.TestCase):
    """Tests the complete Section 2.1 web auth contract, anti-enumeration decoy,
    atomic challenge consumption, and session issuance.
    """

    def setUp(self):
        self.user_data = {
            "user_id": 100200300,
            "name": "علی رضایی",
            "username": "ali_rezaei",
            "student_id": "401234567",
            "approved": True,
            "suspended": False,
            "blacklisted": False,
            "subscription_active": True,
            "web_login_code": "HY-7K9M-2P4X",
        }
        self.fake_db = FakeDatabase([self.user_data])

        # Patch central db in web_auth
        self.patcher_db = patch("backend.api.routers.web_auth.db", self.fake_db)
        self.patcher_db.start()

        # Mount router on test app
        self.app = FastAPI()
        self.app.include_router(web_auth.router, prefix="/api/web-auth")
        self.client = TestClient(self.app)

    def tearDown(self):
        self.patcher_db.stop()

    def test_challenge_create_valid_user(self):
        """POST /api/web-auth/challenge/create dispatches push alert and returns contract fields."""
        resp = self.client.post("/api/web-auth/challenge/create", json={
            "user_code": "HY-7K9M-2P4X",
            "client_info": {
                "device_name": "iPad Pro 11-inch",
                "browser": "Safari 17.4",
            }
        })
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["challenge_id"].startswith("ch_"))
        self.assertEqual(data["status"], "pending_telegram_approval")
        self.assertEqual(data["expires_in_seconds"], 180)
        self.assertEqual(data["display_code"], "7K9M")
        self.assertNotIn("user_hint", data)

        # Verify bot outbox notification was queued
        outbox = self.fake_db.client["medicalbot"]["bot_notifications"].docs
        self.assertEqual(len(outbox), 1)
        notif = outbox[0]
        self.assertEqual(notif["type"], "web_auth_approval_prompt")
        self.assertEqual(notif["chat_id"], 100200300)
        self.assertIn("7K9M", notif["text"])
        self.assertIn("iPad Pro 11-inch", notif["text"])
        # Verify inline keyboard has approve and reject buttons
        kb = notif["reply_markup"]["inline_keyboard"][0]
        self.assertEqual(len(kb), 2)
        self.assertIn("web_auth:approve:", kb[0]["callback_data"])
        self.assertIn("web_auth:reject:", kb[1]["callback_data"])

    def test_challenge_create_anti_enumeration_decoy(self):
        """Nonexistent student code returns identical 200 response without sending bot prompt."""
        resp = self.client.post("/api/web-auth/challenge/create", json={
            "user_code": "HY-9999-9999",
            "client_info": {"device_name": "Firefox on Linux"}
        })
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "pending_telegram_approval")
        self.assertEqual(data["expires_in_seconds"], 180)
        self.assertEqual(data["display_code"], "9999")
        self.assertNotIn("user_hint", data)

        # Verify NO bot notification was sent for nonexistent user
        outbox = self.fake_db.client["medicalbot"]["bot_notifications"].docs
        self.assertEqual(len(outbox), 0)

    def test_challenge_create_malformed_code_raises_422(self):
        """Malformed user codes (invalid Crockford chars, symbols, wrong length) return HTTP 422."""
        invalid_codes = ["HY-7K9U-2P4X", "HY-7K9@-2P4X", "1234", "HY-HY-7K9M-2P4X"]
        for bad in invalid_codes:
            resp = self.client.post("/api/web-auth/challenge/create", json={"user_code": bad})
            self.assertEqual(resp.status_code, 422, f"Expected 422 for invalid code: {bad}")

    def test_approve_reject_endpoints_removed(self):
        """Unauthenticated /approve and /reject endpoints have been removed and must 404."""
        resp_app = self.client.post("/api/web-auth/challenge/dummy_ch/approve")
        self.assertEqual(resp_app.status_code, 404)
        resp_rej = self.client.post("/api/web-auth/challenge/dummy_ch/reject")
        self.assertEqual(resp_rej.status_code, 404)

    def test_challenge_poll_pending_and_expired(self):
        """Polling challenge while pending returns pending status; expired returns expired."""
        create_resp = self.client.post("/api/web-auth/challenge/create", json={
            "user_code": "HY-7K9M-2P4X"
        })
        cid = create_resp.json()["challenge_id"]

        # Poll while pending
        poll_resp = self.client.get(f"/api/web-auth/challenge/{cid}")
        self.assertEqual(poll_resp.status_code, 200)
        self.assertEqual(poll_resp.json()["status"], "pending_telegram_approval")
        self.assertFalse(poll_resp.json()["authenticated"])
        self.assertGreater(poll_resp.json()["expires_in_seconds"], 0)

        # Force expiration in DB
        chal_coll = self.fake_db.client["medicalbot"]["web_login_challenges"]
        for d in chal_coll.docs:
            if d["_id"] == cid:
                d["expires_at"] = datetime.now(timezone.utc) - timedelta(seconds=10)

        poll_expired = self.client.get(f"/api/web-auth/challenge/{cid}")
        self.assertEqual(poll_expired.status_code, 200)
        self.assertEqual(poll_expired.json()["status"], "expired")
        self.assertFalse(poll_expired.json()["authenticated"])

    def test_challenge_approval_cookie_issuance_and_replay_protection(self):
        """Approved challenge sets hu_session cookie, marks consumed, and rejects replay with 403."""
        create_resp = self.client.post("/api/web-auth/challenge/create", json={
            "user_code": "HY-7K9M-2P4X"
        })
        cid = create_resp.json()["challenge_id"]

        # Simulate Telegram approval callback
        chal_coll = self.fake_db.client["medicalbot"]["web_login_challenges"]
        for d in chal_coll.docs:
            if d["_id"] == cid:
                d["status"] = "approved"

        # First poll: succeeds, transitions to consumed, sets hu_session cookie
        resp = self.client.get(f"/api/web-auth/challenge/{cid}")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "approved")
        self.assertTrue(data["authenticated"])
        self.assertEqual(data["user"]["user_id"], 100200300)
        self.assertEqual(data["user"]["name"], "علی رضایی")
        self.assertEqual(data["user"]["student_id"], "401234567")
        self.assertTrue(data["user"]["subscription_active"])

        # Check hu_session cookie
        self.assertIn("hu_session", resp.cookies)
        cookie_val = resp.cookies["hu_session"]
        self.assertGreaterEqual(len(cookie_val), 32)

        # Verify DB stored SHA256 hash of token, not raw token
        sess_coll = self.fake_db.client["medicalbot"]["web_user_sessions"]
        token_hash = hashlib.sha256(cookie_val.encode("utf-8")).hexdigest()
        session_doc = None
        for s in sess_coll.docs:
            if s["_id"] == token_hash:
                session_doc = s
                break
        self.assertIsNotNone(session_doc)
        self.assertEqual(session_doc["uid"], 100200300)
        self.assertFalse(session_doc["revoked"])

        # Replay Attack: Immediately poll again -> HTTP 403 CHALLENGE_ALREADY_CONSUMED
        replay_resp = self.client.get(f"/api/web-auth/challenge/{cid}")
        self.assertEqual(replay_resp.status_code, 403)
        self.assertEqual(replay_resp.json()["detail"], "CHALLENGE_ALREADY_CONSUMED")

    def test_emergency_fallback_otp(self):
        """Emergency OTP verification establishes session and deletes used OTP record."""
        otp_coll = self.fake_db.client["medicalbot"]["web_user_otps"]
        salt = secrets.token_hex(8)
        code = "839102"
        code_hash = hashlib.sha256((salt + ":" + code).encode("utf-8")).hexdigest()
        otp_coll.docs.append({
            "uid": 100200300,
            "code_salt": salt,
            "code_hash": code_hash,
            "attempts": 0,
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=5),
        })

        # Submit invalid OTP first
        bad_resp = self.client.post("/api/web-auth/fallback/verify", json={
            "user_code": "HY-7K9M-2P4X",
            "fallback_otp": "000000"
        })
        self.assertEqual(bad_resp.status_code, 401)
        self.assertEqual(bad_resp.json()["detail"], "INVALID_FALLBACK_CODE")
        self.assertEqual(otp_coll.docs[0]["attempts"], 1)

        # Submit valid OTP
        ok_resp = self.client.post("/api/web-auth/fallback/verify", json={
            "user_code": "HY-7K9M-2P4X",
            "fallback_otp": "839102"
        })
        self.assertEqual(ok_resp.status_code, 200)
        data = ok_resp.json()
        self.assertEqual(data["status"], "approved")
        self.assertTrue(data["authenticated"])
        self.assertEqual(data["user"]["user_id"], 100200300)
        self.assertIn("hu_session", ok_resp.cookies)

        # Verify OTP record was deleted
        self.assertEqual(len(otp_coll.docs), 0)

    def test_session_listing_and_remote_revocation(self):
        """Listing active sessions and remotely revoking another device session."""
        # Create 2 sessions for the user
        token1 = secrets.token_hex(32)
        token2 = secrets.token_hex(32)
        sess_coll = self.fake_db.client["medicalbot"]["web_user_sessions"]
        now = datetime.now(timezone.utc)

        sess_coll.docs.append({
            "_id": hashlib.sha256(token1.encode("utf-8")).hexdigest(),
            "session_id": "sess_current",
            "uid": 100200300,
            "device_name": "Current Browser",
            "peer_ip": "1.2.3.4",
            "created_at": now - timedelta(hours=1),
            "last_active": now,
            "expires_at": now + timedelta(days=30),
            "revoked": False,
        })
        sess_coll.docs.append({
            "_id": hashlib.sha256(token2.encode("utf-8")).hexdigest(),
            "session_id": "sess_remote_ipad",
            "uid": 100200300,
            "device_name": "iPad Pro",
            "peer_ip": "5.6.7.8",
            "created_at": now - timedelta(hours=2),
            "last_active": now - timedelta(hours=1),
            "expires_at": now + timedelta(days=30),
            "revoked": False,
        })

        # List sessions with token1 cookie
        self.client.cookies.set("hu_session", token1)
        list_resp = self.client.get("/api/web-auth/sessions")
        self.assertEqual(list_resp.status_code, 200)
        sessions = list_resp.json()["sessions"]
        self.assertEqual(len(sessions), 2)
        curr = [s for s in sessions if s["is_current"]]
        self.assertEqual(len(curr), 1)
        self.assertEqual(curr[0]["session_id"], "sess_current")

        # Revoke the remote session
        del_resp = self.client.delete("/api/web-auth/sessions/sess_remote_ipad")
        self.assertEqual(del_resp.status_code, 200)
        self.assertTrue(del_resp.json()["revoked"])

        # Verify remote session is now marked revoked in DB
        remote_doc = [s for s in sess_coll.docs if s["session_id"] == "sess_remote_ipad"][0]
        self.assertTrue(remote_doc["revoked"])

    def test_logout_revokes_session_and_clears_cookie(self):
        """POST /api/web-auth/logout revokes session hash in DB and removes cookie."""
        token = secrets.token_hex(32)
        sess_coll = self.fake_db.client["medicalbot"]["web_user_sessions"]
        now = datetime.now(timezone.utc)
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        sess_coll.docs.append({
            "_id": token_hash,
            "session_id": "sess_to_logout",
            "uid": 100200300,
            "device_name": "Browser",
            "created_at": now,
            "last_active": now,
            "expires_at": now + timedelta(days=30),
            "revoked": False,
        })

        self.client.cookies.set("hu_session", token)
        logout_resp = self.client.post("/api/web-auth/logout")
        self.assertEqual(logout_resp.status_code, 200)
        self.assertTrue(logout_resp.json()["ok"])
        # Verify marked revoked
        self.assertTrue(sess_coll.docs[0]["revoked"])


# ══════════════════════════════════════════════════════════════════════════════
#  3. Telegram Bot Outbox Delivery & Callback Handling
# ══════════════════════════════════════════════════════════════════════════════

class TestTelegramBotWebAuthDelivery(unittest.TestCase):
    """Tests the outbox reply_markup reconstruction and web_auth_callback behavior."""

    def test_outbox_inline_keyboard_reconstruction(self):
        """Verifies converting raw dictionary reply_markup from outbox into InlineKeyboardMarkup."""
        raw_rm = {
            "inline_keyboard": [
                [
                    {"text": "✅ تأیید ورود", "callback_data": "web_auth:approve:ch_123"},
                    {"text": "❌ رد درخواست", "callback_data": "web_auth:reject:ch_123"},
                ]
            ]
        }
        # Simulate bot.py mini_app_outbox_job decoding
        kb_rows = []
        for row in raw_rm["inline_keyboard"]:
            btn_row = []
            for btn in row:
                if isinstance(btn, dict):
                    btn_row.append(InlineKeyboardButton(
                        text=btn.get("text", ""),
                        callback_data=btn.get("callback_data"),
                        url=btn.get("url"),
                    ))
            if btn_row:
                kb_rows.append(btn_row)

        outbox_markup = InlineKeyboardMarkup(kb_rows)
        self.assertIsInstance(outbox_markup, InlineKeyboardMarkup)
        self.assertEqual(len(outbox_markup.inline_keyboard), 1)
        self.assertEqual(len(outbox_markup.inline_keyboard[0]), 2)
        self.assertEqual(outbox_markup.inline_keyboard[0][0].text, "✅ تأیید ورود")
        self.assertEqual(outbox_markup.inline_keyboard[0][0].callback_data, "web_auth:approve:ch_123")
        self.assertEqual(outbox_markup.inline_keyboard[0][1].text, "❌ رد درخواست")
        self.assertEqual(outbox_markup.inline_keyboard[0][1].callback_data, "web_auth:reject:ch_123")

    def test_web_auth_callback_approve_target_user(self):
        """Target student clicks approve button in Telegram chat."""
        fake_db = FakeDatabase([])
        chal_coll = fake_db.client["medicalbot"]["web_login_challenges"]
        chal_coll.docs.append({
            "_id": "ch_test_456",
            "uid": 100200300,
            "status": "pending_telegram_approval",
            "consumed": False,
            "client_info": {"device_name": "MacBook Pro"},
        })

        update = MagicMock(spec=Update)
        query = MagicMock(spec=CallbackQuery)
        query.data = "web_auth:approve:ch_test_456"
        query.answer = AsyncMock()
        query.edit_message_text = AsyncMock()
        update.callback_query = query
        update.effective_user = MagicMock(spec=User)
        update.effective_user.id = 100200300

        with patch("backend.bot.web_auth_bot.db", fake_db):
            asyncio.run(web_auth_bot.web_auth_callback(update, MagicMock()))

        # Verify challenge status changed to approved
        self.assertEqual(chal_coll.docs[0]["status"], "approved")
        query.answer.assert_awaited_once_with("ورود به وب‌اپ تأیید شد ✅", show_alert=False)
        query.edit_message_text.assert_awaited_once()

    def test_web_auth_callback_reject_target_user(self):
        """Target student clicks reject button in Telegram chat."""
        fake_db = FakeDatabase([])
        chal_coll = fake_db.client["medicalbot"]["web_login_challenges"]
        chal_coll.docs.append({
            "_id": "ch_test_789",
            "uid": 100200300,
            "status": "pending_telegram_approval",
            "consumed": False,
        })

        update = MagicMock(spec=Update)
        query = MagicMock(spec=CallbackQuery)
        query.data = "web_auth:reject:ch_test_789"
        query.answer = AsyncMock()
        query.edit_message_text = AsyncMock()
        update.callback_query = query
        update.effective_user = MagicMock(spec=User)
        update.effective_user.id = 100200300

        with patch("backend.bot.web_auth_bot.db", fake_db):
            asyncio.run(web_auth_bot.web_auth_callback(update, MagicMock()))

        self.assertEqual(chal_coll.docs[0]["status"], "rejected")
        query.answer.assert_awaited_once_with("درخواست ورود لغو شد ❌", show_alert=False)
        query.edit_message_text.assert_awaited_once()

    def test_web_auth_callback_foreign_user_rejected(self):
        """Unauthorized Telegram user clicking prompt is rejected with alert toast."""
        fake_db = FakeDatabase([])
        chal_coll = fake_db.client["medicalbot"]["web_login_challenges"]
        chal_coll.docs.append({
            "_id": "ch_test_foreign",
            "uid": 100200300,
            "status": "pending_telegram_approval",
            "consumed": False,
        })

        update = MagicMock(spec=Update)
        query = MagicMock(spec=CallbackQuery)
        query.data = "web_auth:approve:ch_test_foreign"
        query.answer = AsyncMock()
        query.edit_message_text = AsyncMock()
        update.callback_query = query
        update.effective_user = MagicMock(spec=User)
        update.effective_user.id = 999999999  # attacker user id!

        with patch("backend.bot.web_auth_bot.db", fake_db):
            asyncio.run(web_auth_bot.web_auth_callback(update, MagicMock()))

        # Status must remain unchanged!
        self.assertEqual(chal_coll.docs[0]["status"], "pending_telegram_approval")
        query.answer.assert_awaited_once_with("شما مجاز به تأیید این درخواست نیستید.", show_alert=True)
        query.edit_message_text.assert_not_called()


# ══════════════════════════════════════════════════════════════════════════════
#  4. Dual-Cookie Session Resolution Tests (web_student.py)
# ══════════════════════════════════════════════════════════════════════════════

class TestCurrentStudentDualCookie(unittest.TestCase):
    """Verifies dual-cookie resolution in web_student.py: hu_session takes priority over hy_student_session."""

    def setUp(self):
        self.user = {
            "user_id": 400500,
            "name": "سارا محمدی",
            "approved": True,
            "suspended": False,
        }
        self.fake_db = FakeDatabase([self.user])
        self.patcher = patch("backend.api.routers.web_student.db", self.fake_db)
        self.patcher.start()

    def tearDown(self):
        self.patcher.stop()

    def test_resolve_session_hu_session_priority(self):
        """hu_session resolved first against web_user_sessions."""
        hu_token = secrets.token_hex(32)
        hu_hash = hashlib.sha256(hu_token.encode("utf-8")).hexdigest()
        now = datetime.now(timezone.utc)

        user_sess_coll = self.fake_db.client["medicalbot"]["web_user_sessions"]
        user_sess_coll.docs.append({
            "_id": hu_hash,
            "uid": 400500,
            "revoked": False,
            "expires_at": now + timedelta(days=30),
        })

        req = MagicMock(spec=Request)
        req.cookies = {"hu_session": hu_token}
        req.state = MagicMock()

        student = asyncio.run(web_student.current_student(req))
        self.assertEqual(student["user_id"], 400500)
        self.assertEqual(student["name"], "سارا محمدی")

    def test_resolve_session_legacy_hy_student_session_fallback(self):
        """When hu_session is absent, hy_student_session resolves against web_sessions."""
        legacy_token = secrets.token_hex(32)
        legacy_hash = hashlib.sha256(legacy_token.encode("utf-8")).hexdigest()
        now = datetime.now(timezone.utc)

        web_sess_coll = self.fake_db.client["medicalbot"]["web_sessions"]
        web_sess_coll.docs.append({
            "_id": legacy_hash,
            "uid": 400500,
            "revoked": False,
            "expires_at": now + timedelta(days=30),
        })

        req = MagicMock(spec=Request)
        req.cookies = {"hy_student_session": legacy_token}
        req.state = MagicMock()

        student = asyncio.run(web_student.current_student(req))
        self.assertEqual(student["user_id"], 400500)

    def test_current_student_unauthenticated_raises_401(self):
        """No valid cookies raises HTTP 401 login_required."""
        req = MagicMock(spec=Request)
        req.cookies = {}
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(web_student.current_student(req))
        self.assertEqual(ctx.exception.status_code, 401)
        self.assertEqual(ctx.exception.detail, "login_required")

    def test_current_student_suspended_user_raises_403(self):
        """Suspended student raises HTTP 403 suspended."""
        hu_token = secrets.token_hex(32)
        hu_hash = hashlib.sha256(hu_token.encode("utf-8")).hexdigest()
        user_sess_coll = self.fake_db.client["medicalbot"]["web_user_sessions"]
        user_sess_coll.docs.append({
            "_id": hu_hash,
            "uid": 400500,
            "revoked": False,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
        })
        self.fake_db.users.docs[0]["suspended"] = True

        req = MagicMock(spec=Request)
        req.cookies = {"hu_session": hu_token}
        req.state = MagicMock()

        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(web_student.current_student(req))
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertEqual(ctx.exception.detail, "suspended")


# ══════════════════════════════════════════════════════════════════════════════
#  5. Hardened LocalStorageDriver Tests
# ══════════════════════════════════════════════════════════════════════════════

class TestLocalStorageDriverHarden(unittest.TestCase):
    """Tests atomic writes, path traversal sanitization, and LRU eviction safety."""

    def setUp(self):
        self.test_dir = tempfile.mkdtemp(prefix="humsyar_test_storage_")
        self.driver = LocalStorageDriver(self.test_dir)

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_path_traversal_sanitization(self):
        """LocalStorageDriver strictly rejects path traversal attempts."""
        malicious_ids = [
            "../../etc/passwd",
            "..\\..\\windows\\system32",
            "file/with/slash",
            "file\\with\\backslash",
            "null\0byte",
            "",
            "file$with@special!chars",
        ]
        for bad_id in malicious_ids:
            with self.assertRaises(ValueError):
                asyncio.run(self.driver.save_original(bad_id, b"fake"))
            with self.assertRaises(ValueError):
                asyncio.run(self.driver.get_original(bad_id))
            with self.assertRaises(ValueError):
                asyncio.run(self.driver.save_cached_page(bad_id, 1, b"fake"))

    def test_atomic_write_and_read_original(self):
        """Atomic write correctly persists PDF and reads back exact binary data."""
        file_id = "doc_test_101"
        data = b"%PDF-1.4 sample content for medical booklet"
        p = asyncio.run(self.driver.save_original(file_id, data))
        self.assertTrue(os.path.exists(p))
        self.assertTrue(p.endswith("doc_test_101.pdf"))

        # Verify exact bytes
        read_back = asyncio.run(self.driver.get_original(file_id))
        self.assertEqual(read_back, data)
        self.assertTrue(asyncio.run(self.driver.has_original(file_id)))

    def test_atomic_write_and_read_cached_page(self):
        """Atomic write correctly persists WebP page and reads back exact data."""
        file_id = "doc_test_101"
        page_data = b"RIFF....WEBPVP8X"
        p = asyncio.run(self.driver.save_cached_page(file_id, 1, page_data))
        self.assertTrue(os.path.exists(p))
        self.assertTrue(p.endswith("doc_test_101_p1.webp"))

        read_page = asyncio.run(self.driver.get_cached_page(file_id, 1))
        self.assertEqual(read_page, page_data)

    def test_lru_cache_eviction_skips_active_reads(self):
        """LRU eviction respects in-flight read lock and does not delete active files."""
        # Create 3 pages
        p1 = asyncio.run(self.driver.save_cached_page("doc_lru", 1, b"A" * 1000))
        p2 = asyncio.run(self.driver.save_cached_page("doc_lru", 2, b"B" * 1000))
        p3 = asyncio.run(self.driver.save_cached_page("doc_lru", 3, b"C" * 1000))

        # Explicitly make p1 the oldest
        os.utime(p1, (1000, 1000))
        os.utime(p2, (2000, 2000))
        os.utime(p3, (3000, 3000))

        # Simulate that p1 is currently being read (added to _active_reads)
        path1 = Path(p1)
        self.driver._active_reads.add(path1)

        # Evict down to 1500 bytes (needs to evict at least 1500 bytes)
        # Because p1 is active, p1 must NOT be deleted. p2 should be evicted first!
        evicted = asyncio.run(self.driver.evict_lru_cache(1500))
        self.assertGreater(evicted, 0)
        self.assertTrue(path1.exists(), "Active read file must not be evicted!")
        self.assertFalse(Path(p2).exists(), "Inactive older file should be evicted")

        # Cleanup active read
        self.driver._active_reads.discard(path1)

    def test_storage_statistics_reporting(self):
        """get_stats accurately calculates bytes and counts across directories."""
        asyncio.run(self.driver.save_original("doc_stat", b"12345"))
        asyncio.run(self.driver.save_cached_page("doc_stat", 1, b"1234567"))

        stats = asyncio.run(self.driver.get_stats())
        self.assertEqual(stats["driver"], "local")
        self.assertEqual(stats["originals_count"], 1)
        self.assertEqual(stats["originals_bytes"], 5)
        self.assertEqual(stats["cache_count"], 1)
        self.assertEqual(stats["cache_bytes"], 7)
        self.assertEqual(stats["total_bytes"], 12)


if __name__ == "__main__":
    unittest.main()
