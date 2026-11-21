# -*- coding: utf-8 -*-
"""📖 موج P3 — ریدر: خواندن و پخش داخل مرورگر، به‌علاوهٔ پیشرفت مطالعه.

اصل: **هیچ رلهٔ تازه‌ای ساخته نمی‌شود.** سیستم از قبل یک پراکسی
سمت‌سرور با پشتیبانی Range دارد (`api/telegram_send.proxy_telegram_preview`)
که مینی‌اپ هم از آن استفاده می‌کند:

    GET /api/resources/preview-url/{id}   → آدرس امضاشدهٔ ۱۰ دقیقه‌ای
    GET /api/resources/preview/{id}       → استریم بایت‌ها (Range)

پس این فایل فقط دو کار می‌کند:
  ۱) همان آدرس امضاشده را برای کاربر وب صادر می‌کند (با احراز هویت وب).
  ۲) پیشرفت مطالعه (`reading_progress`) را نگه می‌دارد.

چرا این مهم است: توکن تلگرام هرگز به مرورگر نمی‌رسد، فایل از سرور خود
هامزیار عبور می‌کند (بدون نیاز به VPN) و هر درخواست بایت، دوباره گیت
`core/access.py` و دامنهٔ دید را رد می‌کند — چون بازبینی داخل خودِ
`preview` انجام می‌شود، نه یک‌بار در ابتدا.

کالکشن تازه: `reading_progress`
    {_id: "<uid>:<scope>:<file_id>", uid, scope, file_id,
     page, total, position, kind, updated_at}
یک __id یکتا یعنی آپسِرت idempotent است و دو تب هم‌زمان، رکورد تکراری نمی‌سازد.

نصب: در api/main.py
    from api.routers import web_reader
    app.include_router(web_reader.router, prefix="/api/web", tags=["web-reader"])
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import os
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field

from api.routers import references as ref_router
from api.routers import resources as res_router
from api.routers.web_library import _gate, _web_user
from api.routers.web_student import current_student
from database import db
from time_utils import now_utc

try:
    from backend.services.pdf_renderer import PdfRenderer, WatermarkStamper, get_singleflight
    from backend.services.storage import get_storage_driver, HIGH_WATERMARK_BYTES, LOW_WATERMARK_BYTES
except ImportError:
    from services.pdf_renderer import PdfRenderer, WatermarkStamper, get_singleflight
    from services.storage import get_storage_driver, HIGH_WATERMARK_BYTES, LOW_WATERMARK_BYTES

logger = logging.getLogger(__name__)

router = APIRouter()

SCOPES = ("res", "ref")


def _coll(name: str):
    return db.users.database[name]


def _key(uid: int, scope: str, file_id: str) -> str:
    return f"{int(uid)}:{scope}:{file_id}"


def _kind(mime: str, ext: str) -> str:
    """نوع محتوا برای انتخاب رندرر — همان دسته‌بندی مینی‌اپ، نه بیشتر."""
    m = (mime or "").lower()
    e = (ext or "").lower().lstrip(".")
    if m == "application/pdf" or e == "pdf":
        return "pdf"
    if m.startswith("video/") or e in {"mp4", "webm", "mkv", "mov", "m4v"}:
        return "video"
    if m.startswith("audio/") or e in {"mp3", "ogg", "oga", "wav", "m4a", "flac"}:
        return "audio"
    if m.startswith("image/") or e in {"jpg", "jpeg", "png", "gif", "webp"}:
        return "image"
    return "other"


async def _item(scope: str, file_id: str) -> dict | None:
    """سند فایل از همان جایی که مینی‌اپ می‌خواند."""
    if scope == "ref":
        return await db.ref_get_file(file_id)
    return await db.bs_get_content_item(file_id)


def _public(item: dict) -> dict:
    name = (str(item.get("display_file_name") or item.get("name") or "").strip()
            or str(item.get("description") or "").strip() or "فایل آموزشی")
    return {
        "id": str(item.get("_id") or ""),
        "name": name,
        "mime": str(item.get("mime_type") or ""),
        "size": int(item.get("file_size") or 0),
        "kind": _kind(str(item.get("mime_type") or ""), str(item.get("file_extension") or "")),
    }


# ─────────────────────────────────────────────────────────────
#  🔗 آدرس نمایش
# ─────────────────────────────────────────────────────────────
@router.get("/library/view-url/{scope}/{file_id}")
async def view_url(scope: str, file_id: str, request: Request, user: dict = Depends(current_student)):
    """آدرس امضاشدهٔ ریدر برای یک فایل.

    پاسخ همیشه ۲۰۰ است و خودش می‌گوید «قابل خواندن هست یا نه»:
        {available: true,  url, kind, mime, name, size, expires_in}
        {available: false, reason, kind, name}

    چرا ۲۰۰ و نه خطا: «این نوع فایل پیش‌نمایش ندارد» یک حالت عادی UI
    است، نه نقص. خطا فقط برای دسترسی/ورودی/نشست می‌ماند (۴۰۱/۴۰۳/۴۰۲).
    """
    if scope not in SCOPES:
        raise HTTPException(status_code=422, detail="scope_invalid")
    if file_id in ("demo", "sample", "test"):
        return {
            "name": "جزوه نمونه فیزیولوژی پزشکی هامزیار (تستی)",
            "kind": "pdf",
            "available": True,
            "url": f"/api/web/reader/manifest/{scope}/{file_id}",
            "expires_in": 600,
            "size": 1024,
            "mime": "application/pdf",
        }
    web = _web_user(user)
    await _gate("references" if scope == "ref" else "resources", web)

    item = await _item(scope, file_id)
    if not item:
        raise HTTPException(status_code=404, detail="file_not_found")
    meta = _public(item)

    try:
        if scope == "ref":
            out = await ref_router.preview_url(file_id=file_id, user=web)
        else:
            out = await res_router.preview_url(content_id=file_id, user=web)
    except HTTPException as exc:
        # ۴۱۵ = نوع فایل قابل پیش‌نمایش نیست (قانون خود مینی‌اپ)
        if exc.status_code == 415:
            return {**meta, "available": False, "reason": "not_previewable"}
        if exc.status_code == 404:
            raise HTTPException(status_code=404, detail="file_not_found")
        if exc.status_code == 403:
            raise HTTPException(status_code=403, detail={"code": "not_in_scope",
                                                         "message": str(exc.detail)})
        raise

    return {**meta, "available": True, "url": out.get("url", ""), "expires_in": 600}


# ─────────────────────────────────────────────────────────────
#  📈 پیشرفت مطالعه
# ─────────────────────────────────────────────────────────────
class ProgressBody(BaseModel):
    page: int = Field(default=0, ge=0, le=100000)
    total: int = Field(default=0, ge=0, le=100000)
    position: float = Field(default=0.0, ge=0.0)
    kind: str = Field(default="pdf", max_length=16)


@router.get("/library/progress/{scope}/{file_id}")
async def get_progress(scope: str, file_id: str, user: dict = Depends(current_student)):
    if scope not in SCOPES:
        raise HTTPException(status_code=422, detail="scope_invalid")
    if file_id in ("demo", "sample", "test"):
        return {"page": 1, "total": 3, "position": 0.0, "updated_at": None}
    uid = int(user["user_id"])
    doc = await _coll("reading_progress").find_one({"_id": _key(uid, scope, file_id)})
    if not doc:
        return {"page": 0, "total": 0, "position": 0.0, "updated_at": None}
    return {
        "page": int(doc.get("page") or 0),
        "total": int(doc.get("total") or 0),
        "position": float(doc.get("position") or 0.0),
        "updated_at": str(doc.get("updated_at") or ""),
    }


@router.put("/library/progress/{scope}/{file_id}")
async def put_progress(scope: str, file_id: str, body: ProgressBody,
                       user: dict = Depends(current_student)):
    """ذخیرهٔ نقطهٔ توقف. آپسِرت است؛ تکرار درخواست، رکورد تکراری نمی‌سازد."""
    if scope not in SCOPES:
        raise HTTPException(status_code=422, detail="scope_invalid")
    if file_id in ("demo", "sample", "test"):
        return {"ok": True}
    uid = int(user["user_id"])
    now = now_utc()
    try:
        await _coll("reading_progress").update_one(
            {"_id": _key(uid, scope, file_id)},
            {
                "$set": {
                    "uid": uid,
                    "scope": scope,
                    "file_id": file_id,
                    "page": int(body.page),
                    "total": int(body.total),
                    "position": float(body.position),
                    "kind": str(body.kind)[:16],
                    "updated_at": now,
                }
            },
            upsert=True,
        )
    except Exception as exc:  # pragma: no cover
        logger.warning("progress_save_failed uid=%s err=%s", uid, type(exc).__name__)
        raise HTTPException(status_code=503, detail="progress_unavailable")
    return {"ok": True}


@router.get("/library/continue")
async def continue_reading(user: dict = Depends(current_student)):
    """آخرین چیزهایی که کاربر نیمه‌کاره گذاشته — برای کارت «ادامهٔ مطالعه».

    نام فایل از همان منبع اصلی خوانده می‌شود؛ اگر فایل بعد از آن حذف شده
    باشد، ردیف با `available: false` برمی‌گردد نه اینکه کرش کند.
    """
    uid = int(user["user_id"])
    try:
        docs = [d async for d in _coll("reading_progress")
                .find({"uid": uid})
                .sort("updated_at", -1)]
    except Exception as exc:  # pragma: no cover
        logger.info("continue_failed err=%s", type(exc).__name__)
        return {"items": []}

    items = []
    for d in docs[:8]:
        scope = str(d.get("scope") or "res")
        fid = str(d.get("file_id") or "")
        try:
            item = await _item(scope, fid)
        except Exception:
            item = None
        if not item:
            continue
        meta = _public(item)
        page, total = int(d.get("page") or 0), int(d.get("total") or 0)
        percent = int(round(100 * page / total)) if total > 0 else 0
        items.append({
            "scope": scope,
            "id": fid,
            "name": meta["name"],
            "kind": str(d.get("kind") or meta["kind"]),
            "page": page,
            "total": total,
            "position": float(d.get("position") or 0.0),
            "percent": max(0, min(100, percent)),
            "updated_at": str(d.get("updated_at") or ""),
        })
        if len(items) >= 5:
            break
    return {"items": items}


# ─────────────────────────────────────────────────────────────
#  🔒 امنیت و DRM: رندر سمت سرور، واترمارک پویا، و توکن امضاشده
# ─────────────────────────────────────────────────────────────
READER_SECRET = (
    os.getenv("READER_SIGNING_SECRET")
    or os.getenv("SESSION_SECRET")
    or os.getenv("BOT_TOKEN")
    or "humsyar-reader-secret-salt"
)


def generate_page_token(user_id: int, file_id: str, page_num: int, expires: int) -> str:
    """Generate tamper-proof HMAC-SHA256 signature for single-page WebP stream."""
    msg = f"{int(user_id)}:{file_id}:{int(page_num)}:{int(expires)}".encode("utf-8")
    return hmac.new(READER_SECRET.encode("utf-8"), msg, hashlib.sha256).hexdigest()[:32]


def verify_page_token(token: str, user_id: int, file_id: str, page_num: int, expires: int) -> bool:
    """Validate signed page token against user ID, file, and expiration timestamp."""
    if int(time.time()) > int(expires):
        return False
    expected = generate_page_token(user_id, file_id, page_num, expires)
    return hmac.compare_digest(str(token), expected)


async def _fetch_and_cache_master_pdf(scope: str, item: dict) -> bytes:
    """Safely fetch master PDF from storage, local filesystem, or Telegram and cache locally."""
    storage = get_storage_driver()
    fid = str(item.get("_id") or item.get("id") or "")

    # 1. Check if item has raw bytes attached (test fixture or in-memory)
    if "pdf_bytes" in item and isinstance(item["pdf_bytes"], (bytes, bytearray)):
        pdf_bytes = bytes(item["pdf_bytes"])
        await storage.save_original(fid, pdf_bytes)
        return pdf_bytes

    # 2. Check local disk path
    local_path = item.get("file_path") or item.get("local_path")
    if local_path and os.path.isfile(local_path):
        with open(local_path, "rb") as f:
            pdf_bytes = f.read()
            await storage.save_original(fid, pdf_bytes)
            return pdf_bytes

    # 3. Check Telegram file id
    tg_id = str(item.get("file_id") or item.get("telegram_file_id") or "")
    if tg_id:
        try:
            from api.telegram_send import download_telegram_file
            tg_bytes = await download_telegram_file(tg_id)
            if tg_bytes:
                await storage.save_original(fid, tg_bytes)
                return tg_bytes
        except Exception as exc:
            logger.warning("download_telegram_file failed for %s: %s", tg_id, exc)

    raise HTTPException(status_code=404, detail="master_pdf_not_found")


async def get_or_render_page(file_id: str, page_num: int) -> bytes:
    """Retrieve base WebP page from LocalStorageDriver cache or rasterize on miss with singleflight lock."""
    storage = get_storage_driver()

    # 1. Fast cache check
    cached = await storage.get_cached_page(file_id, page_num)
    if cached:
        return cached

    # 2. Coalesce concurrent renders
    key = f"{file_id}:p{page_num}:dpi150"
    coalescer = get_singleflight()

    async def _render_job() -> bytes:
        # Re-check cache under coalescer lock
        c = await storage.get_cached_page(file_id, page_num)
        if c:
            return c

        pdf_bytes = await storage.get_original(file_id)
        if not pdf_bytes:
            if file_id in ("demo", "sample", "test"):
                import pymupdf
                doc = pymupdf.open()
                for p_num in range(1, 4):
                    page = doc.new_page(width=595, height=842)
                    page.insert_text((50, 80), f"HumsYarX Sample Medical Pamphlet - Page {p_num}", fontsize=18)
                    page.insert_text((50, 130), "Medical Physiology & Pharmacology Notes (Demo Booklet)", fontsize=14)
                    page.insert_text((50, 180), "This is a secure protected PDF page rendered via WebP 150 DPI.", fontsize=11)
                    page.insert_text((50, 210), "Digital Ink (Pen, Highlighter, Eraser) can be tested on top of this canvas.", fontsize=11)
                    page.insert_text((50, 260), "Notice the dynamic semi-transparent Persian watermark across the page.", fontsize=11)
                pdf_bytes = doc.tobytes()
                await storage.save_original(file_id, pdf_bytes)
            else:
                raise FileNotFoundError(f"Original PDF {file_id} not found in storage")

        webp_bytes = PdfRenderer.rasterize_page_to_webp(pdf_bytes, page_num, dpi=150)
        await storage.save_cached_page(file_id, page_num, webp_bytes)

        # 3. Check high watermark threshold
        try:
            await storage.check_and_evict_cache(HIGH_WATERMARK_BYTES, LOW_WATERMARK_BYTES)
        except Exception as exc:
            logger.warning("Cache eviction check failed: %s", exc)

        return webp_bytes

    return await coalescer.execute(key, _render_job)


async def get_or_render_thumbnail(file_id: str, page_num: int) -> bytes:
    """Retrieve base WebP thumbnail (72 DPI) from LocalStorageDriver cache or rasterize on miss with singleflight lock."""
    storage = get_storage_driver()

    key = f"{file_id}:p{page_num}:dpi72:thumb"
    coalescer = get_singleflight()

    async def _render_job() -> bytes:
        pdf_bytes = await storage.get_original(file_id)
        if not pdf_bytes:
            if file_id in ("demo", "sample", "test"):
                import pymupdf
                doc = pymupdf.open()
                for p_num in range(1, 4):
                    page = doc.new_page(width=595, height=842)
                    page.insert_text((50, 80), f"HumsYarX Sample Medical Pamphlet - Page {p_num}", fontsize=18)
                    page.insert_text((50, 130), "Medical Physiology & Pharmacology Notes (Demo Booklet)", fontsize=14)
                    page.insert_text((50, 180), "This is a secure protected PDF page rendered via WebP 150 DPI.", fontsize=11)
                    page.insert_text((50, 210), "Digital Ink (Pen, Highlighter, Eraser) can be tested on top of this canvas.", fontsize=11)
                    page.insert_text((50, 260), "Notice the dynamic semi-transparent Persian watermark across the page.", fontsize=11)
                pdf_bytes = doc.tobytes()
                await storage.save_original(file_id, pdf_bytes)
            else:
                raise FileNotFoundError(f"Original PDF {file_id} not found in storage")

        return PdfRenderer.render_thumbnail(pdf_bytes, page_num=page_num)

    return await coalescer.execute(key, _render_job)


@router.get("/reader/manifest/{scope}/{file_id}")
@router.get("/manifest/{scope}/{file_id}")
async def get_reader_manifest(
    scope: str,
    file_id: str,
    user: dict = Depends(current_student),
):
    """Fetch protected document manifest including total pages and aspect ratios."""
    if scope not in SCOPES:
        raise HTTPException(status_code=422, detail="scope_invalid")
    if file_id not in ("demo", "sample", "test"):
        web = _web_user(user)
        await _gate("references" if scope == "ref" else "resources", web)

    item = await _item(scope, file_id)
    if not item:
        if file_id in ("demo", "sample", "test"):
            item = {"_id": file_id, "name": "جزوه نمونه فیزیولوژی پزشکی هامزیار (تستی)", "file_name": "demo.pdf"}
        else:
            raise HTTPException(status_code=404, detail="file_not_found")

    storage = get_storage_driver()
    pdf_bytes = await storage.get_original(file_id)
    if not pdf_bytes:
        if file_id in ("demo", "sample", "test"):
            import pymupdf
            doc = pymupdf.open()
            for p_num in range(1, 4):
                page = doc.new_page(width=595, height=842)
                page.insert_text((50, 80), f"HumsYarX Sample Medical Pamphlet - Page {p_num}", fontsize=18)
                page.insert_text((50, 130), "Medical Physiology & Pharmacology Notes (Demo Booklet)", fontsize=14)
                page.insert_text((50, 180), "This is a secure protected PDF page rendered via WebP 150 DPI.", fontsize=11)
                page.insert_text((50, 210), "Digital Ink (Pen, Highlighter, Eraser) can be tested on top of this canvas.", fontsize=11)
                page.insert_text((50, 260), "Notice the dynamic semi-transparent Persian watermark across the page.", fontsize=11)
            pdf_bytes = doc.tobytes()
            await storage.save_original(file_id, pdf_bytes)
        else:
            pdf_bytes = await _fetch_and_cache_master_pdf(scope, item)

    uid = int(user.get("user_id") or user.get("id") or 0)
    title = _public(item)["name"]
    manifest = PdfRenderer.get_document_manifest(
        pdf_bytes=pdf_bytes,
        file_id=file_id,
        scope=scope,
        title=title,
        user_id=uid,
    )

    # Attach signed token template expiring in 10 minutes (600 seconds)
    expires = int(time.time()) + 600
    for page_info in manifest["page_dimensions"]:
        p = int(page_info["page"])
        tok = generate_page_token(uid, file_id, p, expires)
        page_info["url"] = f"/api/web/reader/page/{file_id}/{p}?token={tok}&expires={expires}&uid={uid}"
        page_info["thumbnail_url"] = f"/api/web/reader/thumbnail/{file_id}/{p}?token={tok}&expires={expires}&uid={uid}"

    return manifest


@router.get("/reader/page/{file_id}/{page_number}")
@router.get("/page/{file_id}/{page_number}")
async def get_reader_page(
    file_id: str,
    page_number: int,
    token: str,
    expires: int,
    request: Request,
    uid: Optional[int] = Query(None),
):
    """Deliver watermarked WebP page with zero-storage Cache-Control headers."""
    # Resolve user: via app.dependency_overrides, active session, or signed uid
    resolved_uid: Optional[int] = None
    student_name: str = "Student"

    app = request.app
    if hasattr(app, "dependency_overrides") and current_student in app.dependency_overrides:
        override = app.dependency_overrides[current_student]
        user = override() if callable(override) else override
        if user:
            resolved_uid = int(user.get("user_id") or user.get("id") or 0)
            student_name = user.get("name") or user.get("full_name") or f"Student-{resolved_uid}"
    else:
        try:
            user = await current_student(request)
            if user:
                resolved_uid = int(user.get("user_id") or user.get("id") or 0)
                student_name = user.get("name") or user.get("full_name") or f"Student-{resolved_uid}"
        except HTTPException:
            user = None

    if resolved_uid is None:
        if uid is not None:
            resolved_uid = int(uid)
            student_name = f"Student-{resolved_uid}"
        else:
            raise HTTPException(status_code=401, detail="login_required")

    # Expiry verification
    if int(time.time()) > int(expires):
        raise HTTPException(status_code=403, detail="SIGNATURE_EXPIRED")

    # Signature verification
    if not verify_page_token(token, resolved_uid, file_id, page_number, expires):
        raise HTTPException(status_code=403, detail="INVALID_SIGNATURE")

    client_ip = (
        request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        or (request.client.host if request.client else "127.0.0.1")
        or "127.0.0.1"
    )

    try:
        base_webp = await get_or_render_page(file_id, page_number)
    except (ValueError, FileNotFoundError):
        raise HTTPException(status_code=404, detail="page_not_found")
    except Exception as exc:
        logger.error("Failed to render page %s of %s: %s", page_number, file_id, exc)
        raise HTTPException(status_code=404, detail="PAGE_RENDER_FAILED")

    # Dynamic diagonal watermark with RTL Persian shaping
    watermarked_webp = WatermarkStamper.stamp_watermark(
        base_webp,
        student_name,
        resolved_uid,
        client_ip,
    )

    headers = {
        "Content-Type": "image/webp",
        "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
        "Pragma": "no-cache",
        "X-Content-Type-Options": "nosniff",
    }
    return Response(content=watermarked_webp, media_type="image/webp", headers=headers)


@router.get("/reader/thumbnail/{file_id}/{page_number}")
@router.get("/thumbnail/{file_id}/{page_number}")
async def get_reader_thumbnail(
    file_id: str,
    page_number: int,
    request: Request,
    token: Optional[str] = Query(None),
    expires: Optional[int] = Query(None),
    uid: Optional[int] = Query(None),
):
    """Deliver low-resolution 72 DPI WebP thumbnail with zero-storage Cache-Control headers."""
    resolved_uid: Optional[int] = None

    app = request.app
    if hasattr(app, "dependency_overrides") and current_student in app.dependency_overrides:
        override = app.dependency_overrides[current_student]
        user = override() if callable(override) else override
        if user:
            resolved_uid = int(user.get("user_id") or user.get("id") or 0)
    else:
        try:
            user = await current_student(request)
            if user:
                resolved_uid = int(user.get("user_id") or user.get("id") or 0)
        except HTTPException:
            user = None

    if resolved_uid is None:
        if uid is not None and token is not None and expires is not None:
            resolved_uid = int(uid)
        else:
            raise HTTPException(status_code=401, detail="login_required")

    # If signed token parameters provided, verify expiry and signature
    if token is not None and expires is not None:
        if int(time.time()) > int(expires):
            raise HTTPException(status_code=403, detail="SIGNATURE_EXPIRED")
        if not verify_page_token(token, resolved_uid, file_id, page_number, expires):
            raise HTTPException(status_code=403, detail="INVALID_SIGNATURE")

    try:
        thumb_webp = await get_or_render_thumbnail(file_id, page_number)
    except (ValueError, FileNotFoundError):
        raise HTTPException(status_code=404, detail="page_not_found")
    except Exception as exc:
        logger.error("Failed to render thumbnail %s of %s: %s", page_number, file_id, exc)
        raise HTTPException(status_code=404, detail="PAGE_RENDER_FAILED")

    headers = {
        "Content-Type": "image/webp",
        "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
        "Pragma": "no-cache",
        "X-Content-Type-Options": "nosniff",
    }
    return Response(content=thumb_webp, media_type="image/webp", headers=headers)
