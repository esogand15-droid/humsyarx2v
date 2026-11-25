# -*- coding: utf-8 -*-
"""T3: the web session is 30 days and *sliding*.

Before: the hu_session path (the canonical web login) only wrote last_active,
so expires_at stayed fixed 30 days after login and the browser cookie
(max_age set once at login) also died then, even for a daily user.

Contract pinned here:
  • An active hu_session older than 1h since last_active gets expires_at slid
    to now + SESSION_TTL_DAYS (at most once an hour, not on every request).
  • A fresh one (touched < 1h ago) is not rewritten.
  • An expired session is not resurrected.
  • /auth/session re-issues the same cookie token with a fresh max_age.
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import unittest
from datetime import timedelta
from unittest import mock

os.environ.setdefault("MONGODB_URI", "mongodb://localhost:27017/x")

from backend.api.routers import web_student  # noqa: E402


class _FakeColl:
    def __init__(self, docs):
        self.docs = {d["_id"]: dict(d) for d in docs}
        self.updates = []

    async def find_one(self, q):
        doc = self.docs.get(q.get("_id"))
        if not doc:
            return None
        if "revoked" in q and doc.get("revoked") != q["revoked"]:
            return None
        return dict(doc)

    async def update_one(self, q, upd, **_kw):
        self.updates.append((q, upd))
        doc = self.docs.get(q.get("_id"))
        if doc is not None:
            doc.update(upd.get("$set", {}))


class _Req:
    def __init__(self, cookies, headers=None):
        self.cookies = cookies
        self.headers = headers or {}

        class _U:
            scheme = "https"
        self.url = _U()


def _hash(tok: str) -> str:
    return hashlib.sha256(tok.encode("utf-8")).hexdigest()


class SlidingSessionTests(unittest.TestCase):
    def _run(self, coro):
        return asyncio.run(coro)

    def _coll_for(self, fake):
        return lambda name: fake

    def test_stale_hu_session_slides_expiry(self):
        now = web_student._now()
        tok = "tok-stale"
        h = web_student._sha(tok)
        fake = _FakeColl([{
            "_id": h, "uid": 1, "revoked": False,
            "last_active": now - timedelta(hours=3),
            "expires_at": now + timedelta(days=2),
        }])
        with mock.patch.object(web_student, "_coll", self._coll_for(fake)):
            doc = self._run(web_student._resolve_session(_Req({"hu_session": tok})))
        self.assertIsNotNone(doc)
        self.assertEqual(len(fake.updates), 1)
        new_exp = fake.docs[h]["expires_at"]
        self.assertGreater(new_exp, now + timedelta(days=web_student.SESSION_TTL_DAYS - 1))

    def test_fresh_hu_session_not_rewritten(self):
        now = web_student._now()
        tok = "tok-fresh"
        h = web_student._sha(tok)
        fake = _FakeColl([{
            "_id": h, "uid": 1, "revoked": False,
            "last_active": now - timedelta(minutes=5),
            "expires_at": now + timedelta(days=29),
        }])
        with mock.patch.object(web_student, "_coll", self._coll_for(fake)):
            doc = self._run(web_student._resolve_session(_Req({"hu_session": tok})))
        self.assertIsNotNone(doc)
        self.assertEqual(fake.updates, [], "must not write on every request")

    def test_expired_session_not_resurrected(self):
        now = web_student._now()
        tok = "tok-dead"
        h = web_student._sha(tok)
        fake = _FakeColl([{
            "_id": h, "uid": 1, "revoked": False,
            "last_active": now - timedelta(days=40),
            "expires_at": now - timedelta(days=1),
        }])
        with mock.patch.object(web_student, "_coll", self._coll_for(fake)):
            doc = self._run(web_student._resolve_session(_Req({"hu_session": tok})))
        self.assertIsNone(doc)
        self.assertEqual(fake.updates, [])

    def test_cookie_reissued_with_fresh_max_age(self):
        from starlette.responses import Response
        resp = Response()
        web_student._refresh_session_cookies(
            _Req({"hu_session": "abc"}, {"x-forwarded-proto": "https"}), resp)
        raw = [v.decode() for k, v in resp.raw_headers if k.decode().lower() == "set-cookie"]
        hu = [c for c in raw if c.startswith("hu_session=abc")]
        self.assertEqual(len(hu), 1, raw)
        self.assertIn(f"Max-Age={web_student.SESSION_TTL_DAYS * 86400}", hu[0])
        self.assertIn("HttpOnly", hu[0])
        self.assertIn("Secure", hu[0])

    def test_demo_cookie_never_reissued(self):
        from starlette.responses import Response
        resp = Response()
        web_student._refresh_session_cookies(_Req({"hu_session": "demo_x"}), resp)
        raw = [k for k, _ in resp.raw_headers if k.decode().lower() == "set-cookie"]
        self.assertEqual(raw, [])


if __name__ == "__main__":
    unittest.main()
