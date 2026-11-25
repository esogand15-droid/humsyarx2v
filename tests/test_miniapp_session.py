# -*- coding: utf-8 -*-
"""📱 نشست طولانی مینیاپ: initData کهنه وسط PDF/ویدیو دیگر ۴۰۱ نمیدهد.

ریشهٔ مشکل: initData تلگرام فقط یک ساعت معتبر است (INIT_DATA_MAX_AGE) و
auth_date با باز شدن مینیاپ ثابت میماند. حالا مینیاپ هنگام باز شدن
initData را یک بار با نشست ۳۰روزه (web_user_sessions) عوض میکند و
درخواستها با هدر X-App-Session میروند.

بدون Mongo واقعی: دیتابیس با یک فیک کوچک شبیهسازی میشود.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
import unittest
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from urllib.parse import urlencode

os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:1/x")
os.environ.setdefault("ADMIN_ID", "1")
os.environ.setdefault("TELEGRAM_TOKEN", "123:TEST")

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from backend.api import auth as auth_mod
from backend.api.routers import web_auth

BOT_TOKEN = "123456:TEST-TOKEN-FOR-UNIT-TESTS"
UID = 555000111


def _now():
    return datetime.now(timezone.utc)


def make_init_data(uid: int = UID, age_sec: int = 0, token: str = BOT_TOKEN) -> str:
    """initData با امضای واقعی HMAC (همان الگوریتم تلگرام)."""
    fields = {
        "auth_date": str(int(time.time()) - age_sec),
        "query_id": "AAH-test",
        "user": json.dumps({"id": uid, "first_name": "Test"}, separators=(",", ":")),
    }
    dcs = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(secret, dcs.encode(), hashlib.sha256).hexdigest()
    return urlencode(fields)


class FakeColl:
    def __init__(self):
        self.docs: list[dict] = []

    @staticmethod
    def _match(doc, filt):
        return all(doc.get(k) == v for k, v in filt.items())

    async def find_one(self, filt, *a, **kw):
        for d in self.docs:
            if self._match(d, filt):
                return dict(d)
        return None

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    async def update_one(self, filt, upd, upsert=False):
        for d in self.docs:
            if self._match(d, filt):
                d.update(upd.get("$set") or {})
                return


class FakeDB:
    def __init__(self, users):
        self._users = {u["user_id"]: u for u in users}
        self.sessions = FakeColl()
        colls = defaultdict(FakeColl)
        colls["web_user_sessions"] = self.sessions
        self.client = {"medicalbot": colls}

    async def get_user(self, uid, *a, **kw):
        u = self._users.get(int(uid))
        return dict(u) if u else None


class MiniappSessionTests(unittest.TestCase):
    def setUp(self):
        self.user = {"user_id": UID, "name": "دانشجو", "approved": True, "suspended": False}
        self.fake = FakeDB([self.user])
        self.patches = [
            patch.object(auth_mod, "db", self.fake),
            patch.object(web_auth, "db", self.fake),
            patch.object(auth_mod, "BOT_TOKEN", BOT_TOKEN),
            patch.dict(os.environ, {"WEB_DEMO_ENABLED": "0"}),
        ]
        for p in self.patches:
            p.start()

        app = FastAPI()
        app.include_router(web_auth.router, prefix="/api/web-auth")

        @app.get("/api/me")
        async def me(user=Depends(auth_mod.get_current_user)):
            return {"id": user["id"]}

        self.client = TestClient(app)

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()

    def _exchange(self, init_data, headers=None):
        return self.client.post(
            "/api/web-auth/miniapp/exchange",
            json={"init_data": init_data},
            headers=headers or {},
        )

    # ── ریشهٔ باگ: initData دوساعته به تنهایی ۴۰۱ میگیرد (رفتار امن قبلی حفظ شده) ──
    def test_stale_init_data_alone_is_still_rejected(self):
        r = self.client.get("/api/me", headers={"X-Init-Data": make_init_data(age_sec=2 * 3600)})
        self.assertEqual(r.status_code, 401)
        self.assertEqual(r.json()["detail"], "init_data_expired")

    # ── تبادل با initData دوساعته (مینیاپ در WebView دوباره بارگذاری شده) ──
    def test_exchange_accepts_two_hour_old_init_data(self):
        r = self._exchange(make_init_data(age_sec=2 * 3600))
        self.assertEqual(r.status_code, 200, r.text)
        token = r.json()["session"]
        self.assertGreaterEqual(len(token), 32)
        # فقط hash در دیتابیس است، نه توکن خام
        doc = self.fake.sessions.docs[0]
        self.assertEqual(doc["_id"], hashlib.sha256(token.encode()).hexdigest())
        self.assertNotIn(token, json.dumps(doc, default=str))
        self.assertEqual(doc["uid"], UID)
        self.assertEqual(doc["kind"], "miniapp")

    def test_exchange_rejects_bad_signature_and_too_old(self):
        self.assertEqual(self._exchange(make_init_data(token="999:OTHER")).status_code, 401)
        self.assertEqual(self._exchange(make_init_data(age_sec=3 * 86400)).status_code, 401)
        self.assertEqual(self._exchange("").status_code, 401)
        self.assertEqual(self.fake.sessions.docs, [])

    def test_exchange_respects_account_state(self):
        self.fake._users[UID]["suspended"] = True
        r = self._exchange(make_init_data())
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json()["detail"], "suspended")
        self.assertEqual(self.fake.sessions.docs, [])

    # ── سناریوی اصلی: دو ساعت بعد از باز شدن، وسط پخش، درخواستها کار میکنند ──
    def test_session_keeps_working_after_init_data_expires(self):
        token = self._exchange(make_init_data(age_sec=60)).json()["session"]
        stale = make_init_data(age_sec=2 * 3600 + 5)
        r = self.client.get("/api/me", headers={"X-App-Session": token, "X-Init-Data": stale})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["id"], UID)
        r = self.client.get("/api/me", headers={"X-App-Session": token})
        self.assertEqual(r.status_code, 200)

    def test_revoked_or_expired_session_falls_back_then_401(self):
        token = self._exchange(make_init_data()).json()["session"]
        self.fake.sessions.docs[0]["revoked"] = True
        # نشست باطل + initData تازه → همچنان وارد میشود (پشتیبان)
        r = self.client.get("/api/me", headers={"X-App-Session": token, "X-Init-Data": make_init_data()})
        self.assertEqual(r.status_code, 200)
        # نشست باطل و بدون initData → ۴۰۱ با کد روشن تا کلاینت بیصدا re-auth کند
        r = self.client.get("/api/me", headers={"X-App-Session": token})
        self.assertEqual(r.status_code, 401)
        self.assertEqual(r.json()["detail"], "session_expired")

        self.fake.sessions.docs[0]["revoked"] = False
        self.fake.sessions.docs[0]["expires_at"] = _now() - timedelta(seconds=1)
        self.assertEqual(self.client.get("/api/me", headers={"X-App-Session": token}).status_code, 401)

    def test_suspension_applies_to_existing_session(self):
        token = self._exchange(make_init_data()).json()["session"]
        self.fake._users[UID]["suspended"] = True
        r = self.client.get("/api/me", headers={"X-App-Session": token})
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json()["detail"], "suspended")

    def test_reexchange_reuses_valid_session(self):
        token = self._exchange(make_init_data()).json()["session"]
        r = self._exchange(make_init_data(), headers={"X-App-Session": token})
        self.assertEqual(r.json(), {"session": token, "expires_in_days": 30, "reused": True})
        self.assertEqual(len(self.fake.sessions.docs), 1)
        # نشست کاربر دیگر هرگز به این کاربر داده نمیشود
        other = self._exchange(make_init_data(uid=UID), headers={"X-App-Session": "not-a-real-token"})
        self.assertFalse(other.json()["reused"])

    def test_sliding_expiry_extends_active_session(self):
        token = self._exchange(make_init_data()).json()["session"]
        doc = self.fake.sessions.docs[0]
        doc["last_active"] = _now() - timedelta(days=2)
        doc["expires_at"] = _now() + timedelta(days=1)
        self.assertEqual(self.client.get("/api/me", headers={"X-App-Session": token}).status_code, 200)
        self.assertGreater(doc["expires_at"], _now() + timedelta(days=29))

    def test_demo_cookie_is_not_a_login_in_production(self):
        r = self.client.get("/api/me", cookies={"hu_session": "demo_local_token_12345"})
        self.assertEqual(r.status_code, 401)
        r = self.client.get("/api/me", headers={"X-App-Session": "demo_anything"})
        self.assertEqual(r.status_code, 401)
        r = self.client.get("/api/web-auth/challenge/ch_demo_1")
        self.assertNotEqual(r.json().get("status"), "approved")


if __name__ == "__main__":
    unittest.main()
