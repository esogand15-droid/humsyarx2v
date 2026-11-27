"""احراز هویت امن Telegram Mini App با HMAC-SHA256."""
import hashlib
import hmac
import json
import os
import secrets
import time
from datetime import datetime, timedelta
from urllib.parse import parse_qsl

from fastapi import Depends, Header, HTTPException, Request

from backend.database.database import db
from backend.core.time_utils import TimeContractError, now_utc as _contract_now_utc, parse_machine_datetime


BOT_TOKEN = os.getenv("TELEGRAM_TOKEN", "").strip()
try:
    ADMIN_ID = int(os.getenv("ADMIN_ID", "0"))
except (TypeError, ValueError):
    ADMIN_ID = 0

# 🛡 AUDIT-R1 — پنجره‌ی اعتبار امضا؛ به‌صورت env قابل تنظیم است تا در
# محیط‌هایی که ساعت سرور کشیده است یا flowهای کُند، بدون دیپلوی تازه
# بسته/باز شود. replay کامل در مدل Telegram WebApp حذف‌شدنی نیست (امضای
# stateless)، پس این عدد خودش «پنجره‌ی replay» است و پیش‌فرض یک ساعت نگه
# داشته شده تا سشن‌های وب‌ادمین نشکنند (sane ceiling = 24h).
try:
    INIT_DATA_MAX_AGE = max(30, min(int(os.getenv("INIT_DATA_MAX_AGE_SEC", "3600") or 3600), 86400))
except (TypeError, ValueError):
    INIT_DATA_MAX_AGE = 3600


# ── W1 Nonce (Replay) — best-effort, fails open if DB unavailable ──
# Stores hash(init_data) with TTL = INIT_DATA_MAX_AGE to reject replay.
# Nonce check is AFTER HMAC verification (never store unverified data).
_INIT_NONCE_TTL = INIT_DATA_MAX_AGE
try:
    _NONCE_ENABLED = os.getenv("INIT_NONCE_ENABLED", "0").strip().lower() not in ("0","false","no","off")
except: _NONCE_ENABLED = False
# If enabled, every init_data hash is stored once (TTL=INIT_DATA_MAX_AGE) and replay → 401.
# Disabled by default to allow Telegram's own re-sends (same initData on page reload).
# Enable with INIT_NONCE_ENABLED=1 when you need strict replay protection.

async def _check_init_nonce_once(init_data: str) -> None:
    """Strict once-only nonce using insert+DuplicateKeyError. Raises 401 on replay if DB available."""
    if not _NONCE_ENABLED or not init_data:
        return
    h = hashlib.sha256(init_data.encode("utf-8")).hexdigest()
    try:
        await db.init_nonces.insert_one({"_id": h, "at": utc_now(), "hash": h})
    except Exception as e:
        try:
            from pymongo.errors import DuplicateKeyError as DKE
            if isinstance(e, DKE):
                raise HTTPException(status_code=401, detail="init_data_reused")
        except HTTPException:
            raise
        except Exception:
            pass
        try:
            import logging as _lg
            _lg.getLogger("api.auth").debug(f"nonce check fail-open: {e}")
        except: pass

def _auth_error(detail: str = "invalid_init_data") -> HTTPException:
    return HTTPException(status_code=401, detail=detail)


def init_data_exchange_max_age() -> int:
    """حداکثر عمر initData برای «تبدیل به نشست» (پیشفرض ۲۴ ساعت).

    مینیاپ ممکن است در WebView تلگرام بعد از چند ساعت دوباره بارگذاری
    شود و همان initData قدیمی را داشته باشد؛ امضا همچنان چک میشود.
    """
    try:
        return max(INIT_DATA_MAX_AGE, min(int(os.getenv("INIT_DATA_EXCHANGE_MAX_AGE_SEC", "86400") or 86400), 7 * 86400))
    except (TypeError, ValueError):
        return max(INIT_DATA_MAX_AGE, 86400)


def verify_telegram_init_data(init_data: str, max_age: int | None = None) -> dict:
    """Validate Telegram WebApp initData and return its user object.

    Telegram signs the decoded query-string values.  ``parse_qsl`` is used
    instead of manually splitting the string so encoded characters and plus
    signs are handled correctly.  No user-provided id is trusted before the
    signature has been verified.
    """
    if not BOT_TOKEN:
        raise HTTPException(status_code=500, detail="BOT_TOKEN not set")
    if not isinstance(init_data, str) or not init_data.strip():
        raise _auth_error("missing_init_data")

    try:
        pairs = parse_qsl(init_data, keep_blank_values=True, strict_parsing=True)
        parsed = dict(pairs)
    except (TypeError, ValueError):
        raise _auth_error()

    received_hash = parsed.pop("hash", "")
    if not received_hash or len(received_hash) != 64:
        raise _auth_error()

    try:
        auth_date = int(parsed.get("auth_date", "0"))
    except (TypeError, ValueError):
        raise _auth_error()

    now = int(time.time())
    limit = INIT_DATA_MAX_AGE if max_age is None else int(max_age)
    if auth_date <= 0 or auth_date > now + 60 or now - auth_date > limit:
        raise _auth_error("init_data_expired")

    data_check_string = "\n".join(
        f"{key}={value}" for key, value in sorted(parsed.items())
    )
    secret_key = hmac.new(
        b"WebAppData", BOT_TOKEN.encode("utf-8"), hashlib.sha256
    ).digest()
    computed_hash = hmac.new(
        secret_key, data_check_string.encode("utf-8"), hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(computed_hash, received_hash):
        raise _auth_error()

    try:
        user = json.loads(parsed.get("user", "{}"))
    except (TypeError, json.JSONDecodeError):
        raise _auth_error("invalid_user_data")
    if not isinstance(user, dict) or not user.get("id"):
        raise _auth_error("invalid_user_data")
    return user


# ──────────────────────────────────────────────────────────
#  🖥️ موج WA — Web Admin Session (HttpOnly cookie)
#  مسیر initData عیناً حفظ شده و همیشه در اولویت است؛ اگر هدر
#  نبود و کوکی wa_session معتبر بود، همان dict کاربر ساخته می‌شود.
# ──────────────────────────────────────────────────────────
WA_SESSION_COOKIE = "wa_session"
#: 📲 کوکی نشست وب/PWA (کاربر عادی) — نامش با کوکی ادمین یکی نیست
#: تا هرگز نشست ادمین و کاربر قاطی نشود.
WEB_SESSION_COOKIE = "hu_session"
STUDENT_LEGACY_COOKIE = "hy_student_session"
WA_SESSION_TTL_H = 12


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def utc_now() -> datetime:
    """Compatibility alias for the global HUMSYAR time contract."""
    return _contract_now_utc()


def expiry_is_past(value, now: datetime | None = None) -> bool:
    """Read both legacy ISO-string expiries and new BSON datetime values.

    New documents use BSON datetimes so Mongo TTL indexes can physically remove
    expired OTP/session records. Legacy string records remain readable during
    rollout and are rejected in Python once expired.
    """
    now = now or utc_now()
    try:
        parsed = parse_machine_datetime(value)
    except (TimeContractError, TypeError, ValueError):
        return True
    return parsed <= parse_machine_datetime(now)


async def resolve_web_session(token: str) -> dict | None:
    """توکن خام کوکی را به سند سشن معتبر نگاشت می‌کند (expiry/revoke چک‌شده)."""
    if not token:
        return None
    doc = await db.web_admin_sessions.find_one({
        "_id": _hash_token(token),
        "revoked": False,
    })
    if not doc or expiry_is_past(doc.get("expires_at")):
        return None
    return doc


#: 📱 هدر نشست مینیاپ: initData تلگرام فقط یک ساعت اعتبار دارد و
#: auth_date با باز شدن مینیاپ ثابت میماند؛ پس مینیاپ هنگام باز شدن
#: initData را یک بار با یک نشست سروری طولانی (همان web_user_sessions)
#: عوض میکند و بعد از آن با این هدر درخواست میفرستد.
APP_SESSION_HEADER = "X-App-Session"
#: تمدید خودکار نشست (sliding) — حداکثر یک بار در ساعت نوشته میشود.
WEB_USER_SESSION_TTL_DAYS = 30
_SLIDE_EVERY = timedelta(hours=1)


def demo_sessions_enabled() -> bool:
    """نشست آزمایشی `demo_*` فقط برای توسعهٔ محلی؛ در production خاموش."""
    return os.getenv("WEB_DEMO_ENABLED", "0").strip().lower() in ("1", "true", "yes", "on")


async def _slide_web_user_session(doc: dict) -> None:
    """اگر از آخرین تمدید بیش از یک ساعت گذشته، انقضا را ۳۰ روز جلو میبرد."""
    try:
        last = parse_machine_datetime(doc.get("last_active") or doc.get("created_at"))
        if last and utc_now() - last < _SLIDE_EVERY:
            return
    except (TimeContractError, TypeError, ValueError):
        pass
    now = utc_now()
    try:
        await db.client["medicalbot"]["web_user_sessions"].update_one(
            {"_id": doc["_id"]},
            {"$set": {"last_active": now,
                      "expires_at": now + timedelta(days=WEB_USER_SESSION_TTL_DAYS)}},
        )
    except Exception:
        pass


async def resolve_web_user_session(token: str) -> dict | None:
    """📲 توکن کوکی کاربر وب → سند نشست معتبر (انقضا/revoke چک‌شده).

    کالکشن عمداً جداست (`web_user_sessions`) تا سشن ادمین و سشن
    کاربر هرگز با هم اشتباه نشوند.
    """
    if not token:
        return None
    if token.startswith("demo_") and demo_sessions_enabled():
        return {
            "_id": "demo_hash",
            "uid": 99999999,
            "session_id": "demo_session_1",
            "device_name": "مرورگر وب (تست محلی)",
            "expires_at": utc_now() + timedelta(days=30),
            "revoked": False,
        }
    try:
        doc = await db.client["medicalbot"]["web_user_sessions"].find_one({
            "_id": _hash_token(token),
            "revoked": False,
        })
    except Exception:
        return None
    if not doc or expiry_is_past(doc.get("expires_at")):
        return None
    await _slide_web_user_session(doc)
    return doc


async def resolve_student_legacy_session(token: str) -> dict | None:
    """پشتیبانی کوکی نشست `hy_student_session` برای همهٔ مسیرهای /api/*."""
    if not token:
        return None
    try:
        coll = db.users.database["web_sessions"]
        doc = await coll.find_one({"_id": _hash_token(token), "revoked": False})
    except Exception:
        return None
    if not doc or expiry_is_past(doc.get("expires_at")):
        return None
    return doc


async def _user_from_web_session(request: Request, sess: dict) -> dict:
    """سند نشست معتبر web_user_sessions → dict کاربر (همان گاردهای initData)."""
    uid = int(sess.get("uid") or 0)
    try:
        request.state.user_id = uid
    except Exception:
        pass
    db_user = await db.get_user(uid)
    if not db_user:
        raise HTTPException(status_code=403, detail="not_registered")
    if not db_user.get("approved"):
        raise HTTPException(status_code=403, detail="pending_approval")
    if db_user.get("suspended") or db_user.get("blacklisted"):
        raise HTTPException(status_code=403, detail="suspended")
    return {"id": uid, "first_name": db_user.get("name", ""),
            "_db": db_user, "_web_session": sess}


async def get_current_user(
    request: Request,
    x_init_data: str = Header(default="", alias="X-Init-Data"),
) -> dict:
    # 📱 نشست مینیاپ: initData یک بار با نشست ۳۰روزه عوض شده است، پس
    # گذشت یک ساعت از باز شدن مینیاپ دیگر وسط PDF یا ویدیو ۴۰۱ نمیدهد.
    app_tok = (request.headers.get(APP_SESSION_HEADER) or "").strip()
    if app_tok:
        app_sess = await resolve_web_user_session(app_tok)
        if app_sess:
            return await _user_from_web_session(request, app_sess)
        if not x_init_data:
            raise _auth_error("session_expired")
    if not x_init_data:
        # 🖥️ WA — fallback سشن وب‌ادمین (فقط وقتی هدر غایب است)
        # 📲 PWA — fallback سشن وب کاربر (ورود با کد تلگرام) — قبل از
        # سشن ادمین بررسی می‌شود چون کوکی مستقل و کم‌دسترس‌تری است.
        _web_user = await resolve_web_user_session(
            request.cookies.get(WEB_SESSION_COOKIE, ""))
        if _web_user:
            uid = int(_web_user.get("uid") or 0)
            try:
                request.state.user_id = uid
            except Exception:
                pass
            if uid == 99999999 and demo_sessions_enabled():
                demo_db_user = {
                    "user_id": 99999999,
                    "name": "دکتر علی رضایی",
                    "username": "demo_student",
                    "student_id": "401123456",
                    "approved": True,
                    "suspended": False,
                    "subscription_active": True,
                    "intake": "1401",
                    "group": "گروه الف (فیزیوپاتولوژی)",
                    "role": "student",
                    "registered_at": "1401/07/01",
                }
                return {
                    "id": 99999999,
                    "first_name": "دکتر علی رضایی",
                    "_db": demo_db_user,
                    "_web_session": _web_user,
                }
            db_user = await db.get_user(uid)
            if not db_user:
                raise HTTPException(status_code=403, detail="not_registered")
            if not db_user.get("approved"):
                raise HTTPException(status_code=403, detail="pending_approval")
            if db_user.get("suspended"):
                raise HTTPException(status_code=403, detail="suspended")
            if db_user.get("blacklisted"):
                raise HTTPException(status_code=403, detail="suspended")
            return {"id": uid, "first_name": db_user.get("name", ""),
                    "_db": db_user, "_web_session": _web_user}
        _legacy_sess = await resolve_student_legacy_session(
            request.cookies.get(STUDENT_LEGACY_COOKIE, ""))
        if _legacy_sess:
            return await _user_from_web_session(request, _legacy_sess)
        sess = await resolve_web_session(request.cookies.get(WA_SESSION_COOKIE, ""))
        if sess:
            uid = int(sess["uid"])
            try: request.state.user_id = uid
            except: pass
            db_user = await db.get_user(uid)
            if not db_user:
                raise HTTPException(status_code=403, detail="not_registered")
            if not db_user.get("approved"):
                raise HTTPException(status_code=403, detail="pending_approval")
            if db_user.get("suspended"):
                raise HTTPException(status_code=403, detail="suspended")
            return {"id": uid, "first_name": db_user.get("name", ""),
                    "_db": db_user, "_wa_session": sess}
        raise _auth_error("missing_init_data")
    tg_user = verify_telegram_init_data(x_init_data)
    # W1 — after HMAC verified, enforce once-only nonce (if enabled)
    try:
        await _check_init_nonce_once(x_init_data)
    except HTTPException:
        raise
    except Exception:
        pass
    try:
        uid = int(tg_user["id"])
    except (KeyError, TypeError, ValueError):
        raise _auth_error("invalid_user_data")
    try: request.state.user_id = uid
    except: pass

    db_user = await db.get_user(uid)
    if not db_user:
        raise HTTPException(status_code=403, detail="not_registered")
    if not db_user.get("approved"):
        raise HTTPException(status_code=403, detail="pending_approval")
    if db_user.get("suspended"):
        raise HTTPException(status_code=403, detail="suspended")
    return {**tg_user, "id": uid, "_db": db_user}


async def get_admin_user(user=Depends(get_current_user)) -> dict:
    if user["id"] != ADMIN_ID:
        raise HTTPException(status_code=403, detail="admin_only")
    return user


def require_perm(permission: str):
    """🛡 گیت مجوز RBAC — موج W8: thin-wrapper روی core.rbac.

    هر روتر جدید باید به‌جای چسبیدن به role/ADMIN_ID، از این کارخانه
    استفاده کند: Depends(require_perm('roles.manage'))
    تفویض به core/rbac — قرارداد واحد در هر ۳ لایه."""
    async def _guard(user=Depends(get_current_user)) -> dict:
        # W8 core path — واحد با Bot
        try:
            from backend.core.rbac import has_permission
            if await has_permission(user["id"], permission):
                return user
        except Exception:
            if await db.has_perm(user["id"], permission):
                return user
        raise HTTPException(status_code=403, detail={"code": "PERMISSION_DENIED", "message": "forbidden"})

    _guard.__name__ = f"require_perm_{permission.replace('.', '_')}"
    return _guard


async def get_content_admin_user(user=Depends(get_current_user)) -> dict:
    """🌊 موج C1 — گیت پنل محتوا: هر دارنده‌ی scope معتبر عبور می‌کند:
    مالک/ادمین/ادمین ارشد محتوا (global) و ادمین محتوای ورودی خاص (scoped).
    scope محاسبه‌شده روی user['_scope'] سوار می‌شود تا endpointها با
    enforce_content_intake تصمیم نهایی را بگیرند — گیت فقط «ورود به
    پنل» است، سطح دسترسیِ هر عملیات در خود endpoint enforce می‌شود."""
    scope = await db.get_content_scope(user["id"])
    if not scope:
        raise HTTPException(status_code=403, detail="content_admin_only")
    user["_scope"] = scope
    return user


async def get_content_global_user(user=Depends(get_current_user)) -> dict:
    """فقط ادمین ارشد محتوا/مالک/ادمین — معادل دقیق رفتار قبلیِ
    get_content_admin_user برای بخش‌هایی که scope ندارند
    (schedule/grades/reports) — ادمین ورودی خاص همچنان ۴۰۳."""
    scope = await db.get_content_scope(user["id"])
    if not scope or scope.get("kind") != "global":
        raise HTTPException(status_code=403, detail="content_admin_only")
    user["_scope"] = scope
    return user


def resolve_content_intake(user: dict, requested=None) -> str:
    """تصمیم نهایی intake برای یک endpoint محتوا (§۱۰ spec):
      • global → intake درخواستی (پیش‌فرض '' = سراسری)
      • scoped → اگر intake درخواستی با scope مغایرت داشت ۴۰۳؛
        در غیر این صورت همیشه scope (نه چیزی که کلاینت فرستاده)
    """
    scope = user.get("_scope") or {"kind": "scoped", "intake": ""}
    if scope.get("kind") == "global":
        return (requested or "") if requested is not None else ""
    own = scope.get("intake") or ""
    if requested not in (None, "", own):
        raise HTTPException(status_code=403, detail="intake_out_of_scope")
    return own


def require_feature(feature: str):
    """🌊 W7 — کارخانه‌ی گیت فیچر: تنها نقطه‌ی اعمال سمت API.

    402 دسترسی / 429 سهمیه / 503 موقت — همیشه با {code, message, feature}.
    """
    async def _gate(user=Depends(get_current_user)) -> dict:
        from backend.core.access import require_feature_access
        await require_feature_access(user["id"], feature)
        return user
    _gate.__name__ = f"require_feature_{feature}"
    return _gate


async def get_question_access_user(user=Depends(get_current_user)) -> dict:
    """Single server-side subscription gate for every student Question Bank API — W8 core."""
    try:
        from backend.core.access import require_feature_access
        await require_feature_access(user["id"], "question_bank")
    except HTTPException:
        raise
    except Exception:
        from backend.bot.subscription import has_access
        if not await has_access(user["id"]):
            raise HTTPException(status_code=402, detail={"code": "SUB_REQUIRED", "message": "subscription_required"})
    return user


async def get_resource_access_user(user=Depends(get_current_user)) -> dict:
    """گیت اشتراک برای «منابع علوم پایه» و «رفرنس‌ها» — W8 core.

    دقیقاً همان قانونِ واحد ربات از هسته (core.access) اجرا می‌شود.
    کد خطا ساختاریافته: {code: SUB_REQUIRED, message} تا MiniApp با کد
    تصمیم بگیرد نه با تطبیق رشته فارسی.
    """
    try:
        from backend.core.access import require_feature_access
        await require_feature_access(user["id"], "resources")
    except HTTPException:
        raise
    except Exception:
        from backend.bot.subscription import has_access
        if not await has_access(user["id"]):
            raise HTTPException(status_code=402, detail={"code": "SUB_REQUIRED", "message": "subscription_required"})
    return user


async def get_references_access_user(user=Depends(get_current_user)) -> dict:
    """🌊 W7 — گیت اشتراک رفرنس‌ها (جدا از منابع؛ سوییچ مستقل)."""
    try:
        from backend.core.access import require_feature_access
        await require_feature_access(user["id"], "references")
    except HTTPException:
        raise
    except Exception:
        from backend.bot.subscription import has_access
        if not await has_access(user["id"]):
            raise HTTPException(status_code=402, detail={"code": "SUB_REQUIRED", "message": "subscription_required"})
    return user

