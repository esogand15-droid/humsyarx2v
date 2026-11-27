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
from collections import OrderedDict
import copy
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


def _reader_url_ttl() -> int:
    """⏳ اعتبار آدرسهای امضاشدهٔ صفحات ریدر PDF (ثانیه).

    قبلاً ۶۰۰ ثانیه بود و مطالعهٔ طولانی بعد از ۱۰ دقیقه با 403 قطع میشد.
    پیشفرض ۳ ساعت؛ با `READER_URL_TTL_SEC` قابل تغییر (کف ۵ دقیقه، سقف ۲۴ ساعت).
    کلاینت قبل از انقضا مانیفست را بیصدا تازه میکند، پس این عدد فقط حاشیهٔ امن است.
    """
    try:
        val = int(os.getenv("READER_URL_TTL_SEC", "10800") or 10800)
    except ValueError:
        val = 10800
    return max(300, min(val, 86400))


READER_URL_TTL_SEC = _reader_url_ttl()


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
            "expires_in": READER_URL_TTL_SEC,
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

    from api.telegram_send import PREVIEW_TTL_SEC
    # expires_at (افزوده): کلاینت زمان تازهسازی را دقیق میداند، حتی اگر
    # پاسخ با تأخیر برسد. فیلدهای قبلی دست نخوردهاند (سازگاری مینیاپ).
    return {**meta, "available": True, "url": out.get("url", ""),
            "expires_in": PREVIEW_TTL_SEC,
            "expires_at": int(time.time()) + PREVIEW_TTL_SEC}


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
            # 🎬 PDF بزرگتر از ۲۰MB هم (سقف getFile ابری) از MTProto میآید
            from api.telegram_send import download_telegram_file_any_size
            tg_bytes = await download_telegram_file_any_size(tg_id)
            if tg_bytes:
                await storage.save_original(fid, tg_bytes)
                return tg_bytes
        except Exception as exc:
            logger.warning("download_telegram_file failed for %s: %s", tg_id, exc)

    raise HTTPException(status_code=404, detail="master_pdf_not_found")


_MANIFEST_DIM_CACHE: "OrderedDict[str, Tuple[int, List[Dict[str, Any]]]]" = OrderedDict()


def _demo_pdf_bytes() -> bytes:
    import pymupdf
    doc = pymupdf.open()
    for p_num in range(1, 4):
        page = doc.new_page(width=595, height=842)
        page.insert_text((50, 80), f"HumsYarX Sample Medical Pamphlet - Page {p_num}", fontsize=18)
        page.insert_text((50, 130), "Medical Physiology & Pharmacology Notes (Demo Booklet)", fontsize=14)
        page.insert_text((50, 180), "This is a secure protected PDF page rendered via WebP 150 DPI.", fontsize=11)
        page.insert_text((50, 210), "Digital Ink (Pen, Highlighter, Eraser) can be tested on top of this canvas.", fontsize=11)
        page.insert_text((50, 260), "Notice the forensic micro watermark in the page margin.", fontsize=11)
    return doc.tobytes()


def _format_student_label(user: Optional[dict], resolved_uid: int) -> str:
    if not user:
        return f"Student-{resolved_uid}"
    base_name = str(user.get("name") or user.get("full_name") or "").strip() or f"Student-{resolved_uid}"
    parts = [base_name]
    student_id = str(user.get("student_id") or "").strip()
    username = str(user.get("username") or "").strip().lstrip("@")
    if student_id:
        parts.append(f"#{student_id}")
    if username:
        parts.append(f"@{username}")
    return " ".join(parts)


async def _resolve_student_identity(
    request: Request,
    uid: Optional[int],
    *,
    allow_uid_only: bool,
) -> Tuple[int, str, str]:
    """Resolve authenticated student uid, full identity label, and client IP."""
    resolved_uid: Optional[int] = None
    user: Optional[dict] = None

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
        if uid is not None and allow_uid_only:
            resolved_uid = int(uid)
        else:
            raise HTTPException(status_code=401, detail="login_required")

    client_ip = (
        request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        or (request.client.host if request.client else "127.0.0.1")
        or "127.0.0.1"
    )
    return resolved_uid, _format_student_label(user, resolved_uid), client_ip


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
                pdf_bytes = await asyncio.to_thread(_demo_pdf_bytes)
                await storage.save_original(file_id, pdf_bytes)
            else:
                raise FileNotFoundError(f"Original PDF {file_id} not found in storage")

        webp_bytes = await asyncio.to_thread(PdfRenderer.rasterize_page_to_webp, pdf_bytes, page_num, 150)
        await storage.save_cached_page(file_id, page_num, webp_bytes)

        # 3. Check high watermark threshold
        try:
            await storage.check_and_evict_cache(HIGH_WATERMARK_BYTES, LOW_WATERMARK_BYTES)
        except Exception as exc:
            logger.warning("Cache eviction check failed: %s", exc)

        return webp_bytes

    return await coalescer.execute(key, _render_job)


async def get_or_render_thumbnail(file_id: str, page_num: int) -> bytes:
    """Retrieve base WebP thumbnail (72 DPI) via singleflight lock off the event loop."""
    storage = get_storage_driver()

    key = f"{file_id}:p{page_num}:dpi72:thumb"
    coalescer = get_singleflight()

    async def _render_job() -> bytes:
        pdf_bytes = await storage.get_original(file_id)
        if not pdf_bytes:
            if file_id in ("demo", "sample", "test"):
                pdf_bytes = await asyncio.to_thread(_demo_pdf_bytes)
                await storage.save_original(file_id, pdf_bytes)
            else:
                raise FileNotFoundError(f"Original PDF {file_id} not found in storage")

        return await asyncio.to_thread(PdfRenderer.render_thumbnail, pdf_bytes, page_num)

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

    uid = int(user.get("user_id") or user.get("id") or 0)
    title = _public(item)["name"]

    cached_dims = _MANIFEST_DIM_CACHE.get(file_id)
    if cached_dims is not None:
        _MANIFEST_DIM_CACHE.move_to_end(file_id)
        total_pages, dims_template = cached_dims
        manifest = {
            "file_id": file_id,
            "scope": scope,
            "title": title,
            "total_pages": total_pages,
            "page_dimensions": copy.deepcopy(dims_template),
            "encryption_mode": "server_webp_watermarked",
            "watermark_user_id": uid,
        }
    else:
        storage = get_storage_driver()
        pdf_bytes = await storage.get_original(file_id)
        if not pdf_bytes:
            if file_id in ("demo", "sample", "test"):
                pdf_bytes = await asyncio.to_thread(_demo_pdf_bytes)
                await storage.save_original(file_id, pdf_bytes)
            else:
                pdf_bytes = await _fetch_and_cache_master_pdf(scope, item)

        manifest = await asyncio.to_thread(
            PdfRenderer.get_document_manifest,
            pdf_bytes,
            file_id,
            scope,
            title,
            uid,
        )
        while len(_MANIFEST_DIM_CACHE) >= 256:
            _MANIFEST_DIM_CACHE.popitem(last=False)
        _MANIFEST_DIM_CACHE[file_id] = (
            int(manifest["total_pages"]),
            copy.deepcopy(manifest["page_dimensions"]),
        )

    # ⏳ توکنهای امضاشدهٔ صفحه با READER_URL_TTL_SEC (پیشفرض ۳ ساعت).
    # expires_at/expires_in افزودهاند تا کلاینت پیش از انقضا مانیفست را تازه کند.
    expires = int(time.time()) + READER_URL_TTL_SEC
    manifest["expires_at"] = expires
    manifest["expires_in"] = READER_URL_TTL_SEC
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
    resolved_uid, student_label, client_ip = await _resolve_student_identity(
        request, uid, allow_uid_only=True
    )

    # Expiry verification
    if int(time.time()) > int(expires):
        raise HTTPException(status_code=403, detail="SIGNATURE_EXPIRED")

    # Signature verification
    if not verify_page_token(token, resolved_uid, file_id, page_number, expires):
        raise HTTPException(status_code=403, detail="INVALID_SIGNATURE")

    try:
        base_webp = await get_or_render_page(file_id, page_number)
    except (ValueError, FileNotFoundError):
        raise HTTPException(status_code=404, detail="page_not_found")
    except Exception as exc:
        logger.error("Failed to render page %s of %s: %s", page_number, file_id, exc)
        raise HTTPException(status_code=404, detail="PAGE_RENDER_FAILED")

    # Forensic micro watermark: one faint identity line in the page's bottom-left margin.
    # Off the event loop: decode + encode of a 150 DPI page is CPU work.
    watermarked_webp = await asyncio.to_thread(
        WatermarkStamper.stamp_watermark,
        base_webp,
        student_label,
        resolved_uid,
        client_ip,
        file_id=file_id,
        page_number=page_number,
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
    """Deliver watermarked 72 DPI WebP thumbnail with zero-storage Cache-Control headers."""
    if page_number < 1:
        raise HTTPException(status_code=422, detail="invalid_page_number")

    resolved_uid, student_label, client_ip = await _resolve_student_identity(
        request,
        uid,
        allow_uid_only=(token is not None and expires is not None),
    )

    if token and expires is not None:
        if int(time.time()) > int(expires):
            raise HTTPException(status_code=403, detail="SIGNATURE_EXPIRED")
        if not verify_page_token(token, resolved_uid, file_id, page_number, expires):
            raise HTTPException(status_code=403, detail="INVALID_SIGNATURE")
    elif file_id not in ("demo", "sample", "test"):
        # Unsigned thumbnail requests require an active signed-in session that passes subscription/intake access.
        student = await current_student(request)
        web = _web_user(student)
        item_res = await _item("res", file_id)
        item_ref = None if item_res else await _item("ref", file_id)
        if not item_res and not item_ref:
            raise HTTPException(status_code=404, detail="file_not_found")
        scope = "res" if item_res else "ref"
        await _gate("references" if scope == "ref" else "resources", web)
        item = item_res or item_ref
        item_intake = str((item or {}).get("intake") or "").strip()
        user_intake = str(web.get("intake") or "").strip()
        if item_intake and user_intake and item_intake not in ("all", "همه", user_intake):
            raise HTTPException(status_code=403, detail="not_in_scope")

    try:
        base_thumb = await get_or_render_thumbnail(file_id, page_number)
        thumb_webp = await asyncio.to_thread(
            WatermarkStamper.stamp_watermark,
            base_thumb,
            student_label,
            resolved_uid,
            client_ip,
            file_id=file_id,
            page_number=page_number,
        )
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
