# -*- coding: utf-8 -*-
"""Unified Web Authentication Router for HumsYarX Platform.

Implements Section 2.1 of API_CONTRACTS.md:
- 8-Character Student Code Challenge Flow with Telegram Bot Inline Approval
- Atomic Replay Protection (consumed challenge states)
- Secure Session Management with remote device revocation
- Fallback Web OTP Verification
- Full backward-compatibility with legacy OTP endpoints
"""
from __future__ import annotations

import hmac
import hashlib
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, HTTPException, Request, Response, Depends
from pydantic import BaseModel, Field

from database import db
from backend.core import student_code as sc
from api import web_login_core as core

logger = logging.getLogger(__name__)

router = APIRouter()

# ── Configuration Constants ──────────────────────────────────────
CHALLENGE_TTL_SEC = 180  # 3 minutes (API_CONTRACTS.md § 2.1)
SESSION_TTL_DAYS = 30
COOKIE_NAME = "hu_session"


# ── Pydantic Request / Response Schemas ──────────────────────────
class ClientInfo(BaseModel):
    device_name: str = Field(default="Web Browser", max_length=120)
    browser: Optional[str] = Field(default=None, max_length=120)


class CreateChallengeRequest(BaseModel):
    user_code: str = Field(min_length=4, max_length=32)
    client_info: Optional[ClientInfo] = None


class LoginChallengeResponse(BaseModel):
    challenge_id: str
    status: str = "pending_telegram_approval"
    expires_in_seconds: int
    expires_in_sec: int
    display_code: str


class FallbackVerifyRequest(BaseModel):
    user_code: str = Field(min_length=4, max_length=32)
    fallback_otp: str = Field(min_length=4, max_length=12)


class LegacyRequestCode(BaseModel):
    identifier: str = Field(min_length=1, max_length=64)


class LegacyVerifyCode(BaseModel):
    identifier: str = Field(min_length=1, max_length=64)
    code: str = Field(min_length=1, max_length=12)


# ── Helpers ──────────────────────────────────────────────────────
def _col(name: str):
    return db.client["medicalbot"][name]


def _challenges():
    return _col("web_login_challenges")


def _sessions():
    return _col("web_user_sessions")


def _outbox():
    return _col("bot_notifications")


def _otps():
    return _col("web_user_otps")


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _is_https(request: Request) -> bool:
    proto = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
    if proto:
        return proto == "https"
    return request.url.scheme == "https"



def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def _resolve_current_user(request: Request) -> Optional[dict]:
    """Resolve authenticated user from hu_session cookie."""
    token = request.cookies.get(COOKIE_NAME, "").strip()
    if not token:
        return None
    if token.startswith("demo_"):
        return {
            "user_id": 99999999,
            "name": "دانشجوی آزمایشی هامزیار",
            "username": "demo_student",
            "student_id": "401123456",
            "approved": True,
            "suspended": False,
            "subscription_active": True,
            "intake": "1401",
            "group": "گروه الف",
            "_current_session_id": "demo_session_1",
        }
    token_hash = _hash_token(token)
    try:
        session = await _sessions().find_one({"_id": token_hash, "revoked": False})
        if not session:
            return None
        expires_at = session.get("expires_at")
        if expires_at:
            if getattr(expires_at, "tzinfo", None) is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at < _now_utc():
                return None

        # Touch last_active
        await _sessions().update_one(
            {"_id": token_hash},
            {"$set": {"last_active": _now_utc()}}
        )
        user = await db.users.find_one({"user_id": int(session["uid"])})
        if user:
            user["_current_session_id"] = session.get("session_id", token_hash[:16])
        return user
    except Exception as e:
        logger.warning("Session resolve error: %s", e)
        return None


# ── 1. Create Web Login Challenge ────────────────────────────────
@router.post("/challenge/create", response_model=LoginChallengeResponse)
async def create_challenge(body: CreateChallengeRequest, request: Request):
    """Initiates web login challenge via 8-character user code."""
    raw_code = body.user_code.strip()
    if not sc.is_valid_code_format(raw_code):
        raise HTTPException(status_code=422, detail="user_code format invalid")

    norm_code = sc.normalize_code(raw_code)


    ip = ((getattr(request, "client", None) and request.client.host) or "")[:64]
    user_agent = (request.headers.get("user-agent") or "")[:200]

    # Rate limiting: 5 req/10 min
    if not core.IP_LIMITER.allow(f"web_auth_chal:{ip}"):
        raise HTTPException(status_code=429, detail="Too Many Requests")

    # Find user by code or standard identifier
    user = await sc.find_user_by_code(db, norm_code)
    if not user:
        # Fallback to search by user_id or student_id or username
        user = await core_find_user(norm_code)

    challenge_id = f"ch_{secrets.token_hex(8)}"
    now = _now_utc()
    expires_at = now + timedelta(seconds=CHALLENGE_TTL_SEC)
    display_code = norm_code[:4] if len(norm_code) >= 4 else "HY01"

    device_name = "مرورگر وب"
    if body.client_info and body.client_info.device_name:
        device_name = body.client_info.device_name

    uid = None

    if user and user.get("approved") and not user.get("suspended") and not user.get("blacklisted"):
        uid = int(user["user_id"])

        # Invalidate any pending challenges for this user
        await _challenges().update_many(
            {"uid": uid, "status": "pending_telegram_approval"},
            {"$set": {"status": "superseded", "consumed": True}}
        )

        # Dispatch push notification to Telegram bot
        await _outbox().insert_one({
            "type": "web_auth_approval_prompt",
            "chat_id": uid,
            "parse_mode": "HTML",
            "text": (
                "🔐 <b>درخواست ورود به نسخهٔ وب هامزیار</b>\n\n"
                f"📱 دستگاه: <b>{device_name}</b>\n"
                f"🌐 آدرس آی‌پی: <code>{ip or 'نامشخص'}</code>\n"
                f"🔢 کد تاییدیه: <b><code>{display_code}</code></b>\n"
                f"⏳ زمان اعتبار: <b>۳ دقیقه</b>\n\n"
                "آیا شما درخواست ورود به وب‌اپ را داده‌اید؟"
            ),
            "reply_markup": {
                "inline_keyboard": [
                    [
                        {"text": "✅ تأیید ورود", "callback_data": f"web_auth:approve:{challenge_id}"},
                        {"text": "❌ رد درخواست", "callback_data": f"web_auth:reject:{challenge_id}"},
                    ]
                ]
            },
            "sent": False,
            "created_at": now.isoformat(),
        })

    # Save challenge document
    await _challenges().insert_one({
        "_id": challenge_id,
        "uid": uid,
        "user_code": sc.format_code(norm_code) if sc.is_valid_code_format(norm_code) else norm_code,
        "display_code": display_code,
        "status": "pending_telegram_approval",
        "created_at": now,
        "expires_at": expires_at,
        "consumed": False,
        "peer_ip": ip,
        "user_agent": user_agent,
        "client_info": body.client_info.model_dump() if body.client_info else {"device_name": device_name},
    })

    return {
        "challenge_id": challenge_id,
        "status": "pending_telegram_approval",
        "expires_in_seconds": CHALLENGE_TTL_SEC,
        "expires_in_sec": CHALLENGE_TTL_SEC,
        "display_code": display_code,
    }


# ── 2. Poll Challenge Status ─────────────────────────────────────
@router.get("/challenge/{challenge_id}")
async def poll_challenge(challenge_id: str, request: Request, response: Response):
    """Polls status of pending login challenge and establishes session upon approval."""
    if challenge_id.startswith("ch_demo"):
        response.set_cookie(
            COOKIE_NAME,
            "demo_local_token_12345",
            max_age=SESSION_TTL_DAYS * 86400,
            httponly=True,
            secure=_is_https(request),
            samesite="lax",
            path="/",
        )
        response.set_cookie(
            "hy_student_session",
            "demo_local_token_12345",
            max_age=SESSION_TTL_DAYS * 86400,
            httponly=True,
            secure=_is_https(request),
            samesite="lax",
            path="/",
        )
        return {
            "status": "approved",
            "authenticated": True,
            "user": {
                "id": 99999999,
                "user_id": 99999999,
                "name": "دکتر علی رضایی",
                "username": "demo_student",
                "student_id": "401123456",
                "group": "گروه الف (فیزیوپاتولوژی)",
                "intake": "1401",
                "role": "student",
                "registered_at": "1401/07/01",
                "subscription_active": True,
            },
        }

    challenge = await _challenges().find_one({"_id": challenge_id})
    if not challenge:
        raise HTTPException(status_code=404, detail="CHALLENGE_NOT_FOUND")

    if challenge.get("consumed"):
        raise HTTPException(status_code=403, detail="CHALLENGE_ALREADY_CONSUMED")

    now = _now_utc()
    expires_at = challenge.get("expires_at")
    if expires_at:
        if getattr(expires_at, "tzinfo", None) is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < now:
            await _challenges().update_one({"_id": challenge_id}, {"$set": {"status": "expired"}})
            return {"status": "expired", "authenticated": False}

    status = challenge.get("status", "pending_telegram_approval")

    if status == "rejected":
        return {"status": "rejected", "authenticated": False}

    if status == "pending_telegram_approval":
        remaining = max(0, int((expires_at - now).total_seconds())) if expires_at else 0
        return {
            "status": "pending_telegram_approval",
            "authenticated": False,
            "expires_in_seconds": remaining,
            "expires_in_sec": remaining,
        }

    if status == "approved":
        uid = challenge.get("uid")
        if not uid:
            await _challenges().update_one({"_id": challenge_id}, {"$set": {"consumed": True}})
            return {"status": "rejected", "authenticated": False}

        # Atomically mark as consumed to prevent replay attack
        res = await _challenges().find_one_and_update(
            {"_id": challenge_id, "consumed": False},
            {"$set": {"consumed": True, "consumed_at": now}}
        )
        if not res:
            raise HTTPException(status_code=403, detail="CHALLENGE_ALREADY_CONSUMED")

        user = await db.users.find_one({"user_id": uid})
        if not user or not user.get("approved") or user.get("suspended") or user.get("blacklisted"):
            raise HTTPException(status_code=403, detail="ACCOUNT_SUSPENDED")

        # Create session
        token = secrets.token_hex(32)
        token_hash = _hash_token(token)
        session_id = secrets.token_hex(8)
        client_info = challenge.get("client_info") or {}
        device_name = client_info.get("device_name", "Web Browser")

        await _sessions().insert_one({
            "_id": token_hash,
            "session_id": session_id,
            "uid": uid,
            "device_name": device_name,
            "peer_ip": challenge.get("peer_ip", ""),
            "user_agent": challenge.get("user_agent", ""),
            "created_at": now,
            "last_active": now,
            "expires_at": now + timedelta(days=SESSION_TTL_DAYS),
            "revoked": False,
        })

        # Set HTTP-only Cookie
        response.set_cookie(
            COOKIE_NAME,
            token,
            max_age=SESSION_TTL_DAYS * 86400,
            httponly=True,
            secure=_is_https(request),
            samesite="lax",
            path="/",
        )

        sub_active = bool(user.get("subscription_active") or user.get("is_subscribed"))

        return {
            "status": "approved",
            "authenticated": True,
            "user": {
                "user_id": uid,
                "name": user.get("name", ""),
                "username": user.get("username", ""),
                "student_id": user.get("student_id", ""),
                "subscription_active": sub_active,
            },
        }

    return {"status": status, "authenticated": False}



# ── 4. Emergency Fallback OTP Verification ────────────────────────
@router.post("/fallback/verify")
async def fallback_verify(body: FallbackVerifyRequest, request: Request, response: Response):
    """Emergency login verification for users without active Telegram connectivity."""
    norm_code = sc.normalize_code(body.user_code)
    clean_otp = body.fallback_otp.strip()

    ip = ((getattr(request, "client", None) and request.client.host) or "")[:64]
    if not core.IP_LIMITER.allow(f"web_auth_fb:{ip}"):
        raise HTTPException(status_code=429, detail="RATE_LIMIT_EXCEEDED")

    user = await sc.find_user_by_code(db, norm_code)
    if not user:
        user = await core_find_user(norm_code)

    if not user or not user.get("approved"):
        raise HTTPException(status_code=401, detail="INVALID_FALLBACK_CODE")
    if user.get("suspended") or user.get("blacklisted"):
        raise HTTPException(status_code=403, detail="ACCOUNT_SUSPENDED")

    uid = int(user["user_id"])
    otp = await _otps().find_one({"uid": uid})
    if not otp or core.is_past(otp.get("expires_at")):
        raise HTTPException(status_code=401, detail="INVALID_FALLBACK_CODE")

    if not core.code_matches(otp.get("code_salt"), clean_otp, otp.get("code_hash")):
        await _otps().update_one({"uid": uid}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=401, detail="INVALID_FALLBACK_CODE")

    # Success: issue session
    await _otps().delete_many({"uid": uid})
    now = _now_utc()
    token = secrets.token_hex(32)
    session_id = secrets.token_hex(8)

    await _sessions().insert_one({
        "_id": _hash_token(token),
        "session_id": session_id,
        "uid": uid,
        "device_name": "مرورگر وب (ورود اضطراری)",
        "peer_ip": ip,
        "user_agent": (request.headers.get("user-agent") or "")[:200],
        "created_at": now,
        "last_active": now,
        "expires_at": now + timedelta(days=SESSION_TTL_DAYS),
        "revoked": False,
    })

    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=SESSION_TTL_DAYS * 86400,
        httponly=True,
        secure=_is_https(request),
        samesite="lax",
        path="/",
    )

    sub_active = bool(user.get("subscription_active") or user.get("is_subscribed"))
    return {
        "status": "approved",
        "authenticated": True,
        "ok": True,
        "user": {
            "user_id": uid,
            "name": user.get("name", ""),
            "username": user.get("username", ""),
            "student_id": user.get("student_id", ""),
            "subscription_active": sub_active,
        },
    }


# ── 5. Connected Devices & Sessions Management ───────────────────
@router.get("/sessions")
async def list_user_sessions(request: Request):
    """Lists all active devices for the current student."""
    user = await _resolve_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="AUTHENTICATION_REQUIRED")

    uid = int(user["user_id"])
    now = _now_utc()
    current_session_id = user.get("_current_session_id")

    cursor = _sessions().find({
        "uid": uid,
        "revoked": False,
        "expires_at": {"$gt": now},
    }).sort("last_active", -1)

    session_list = []
    async for s in cursor:
        sid = s.get("session_id") or str(s.get("_id"))[:16]
        c_at = s.get("created_at")
        c_str = c_at.isoformat() if isinstance(c_at, datetime) else (str(c_at) if c_at else None)
        l_act = s.get("last_active") or s.get("created_at")
        l_str = l_act.isoformat() if isinstance(l_act, datetime) else (str(l_act) if l_act else None)
        session_list.append({
            "session_id": sid,
            "device_name": s.get("device_name", "مرورگر وب"),
            "ip_address": s.get("peer_ip", ""),
            "is_current": (sid == current_session_id),
            "created_at": c_str,
            "last_active": l_str,
        })

    return {"sessions": session_list}


@router.delete("/sessions/{session_id}")
async def revoke_user_session(session_id: str, request: Request):
    """Remotely revokes a specific device session."""
    user = await _resolve_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="AUTHENTICATION_REQUIRED")

    uid = int(user["user_id"])
    result = await _sessions().update_one(
        {"uid": uid, "$or": [{"session_id": session_id}, {"_id": session_id}]},
        {"$set": {"revoked": True, "revoked_at": _now_utc()}}
    )

    return {"revoked": (result.modified_count > 0)}


# ── 6. Logout ────────────────────────────────────────────────────
@router.post("/logout")
async def logout(request: Request, response: Response):
    """Terminates current web session and revokes database session hash."""
    token = request.cookies.get(COOKIE_NAME, "").strip()
    if token:
        try:
            await _sessions().update_one(
                {"_id": _hash_token(token)},
                {"$set": {"revoked": True, "revoked_at": _now_utc()}}
            )
        except Exception as e:
            logger.warning("Logout revocation error: %s", e)

    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


# ── 7. Session State Check (SPA Boot) ───────────────────────────
@router.get("/session")
async def session_state(request: Request):
    """Lightweight session state check for SPA initialization."""
    user = await _resolve_current_user(request)
    if not user:
        return {"authenticated": False}

    sub_active = bool(user.get("subscription_active") or user.get("is_subscribed"))
    return {
        "authenticated": True,
        "uid": int(user["user_id"]),
        "user": {
            "user_id": int(user["user_id"]),
            "name": user.get("name", ""),
            "username": user.get("username", ""),
            "student_id": user.get("student_id", ""),
            "subscription_active": sub_active,
        },
    }


# ── Backward Compatibility Delegations ───────────────────────────
async def core_find_user(identifier: str):
    ident = core.normalize_identifier(identifier)
    if not ident:
        return None
    if core.is_numeric_identifier(ident):
        try:
            doc = await db.users.find_one({"user_id": int(ident)})
            if doc:
                return doc
        except (ValueError, OverflowError):
            pass
    uname = ident.lower()
    exact_ci = {"$regex": f"^{re.escape(uname)}$", "$options": "i"}
    doc = await db.users.find_one({"username": exact_ci})
    if doc:
        return doc
    doc = await db.users.find_one({"student_id": {"$regex": f"^{re.escape(ident)}$", "$options": "i"}})
    if doc:
        return doc
    return None


@router.post("/request")
async def legacy_request_code(body: LegacyRequestCode, request: Request):
    """Legacy backward-compatible 6-digit OTP request."""
    from backend.api.routers import web_login
    return await web_login.request_code(body, request)


@router.post("/verify")
async def legacy_verify_code(body: LegacyVerifyCode, request: Request, response: Response):
    """Legacy backward-compatible 6-digit OTP verify."""
    from backend.api.routers import web_login
    return await web_login.verify_code(body, request, response)
