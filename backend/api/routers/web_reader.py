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
import inspect
import logging
import os
import re
import time
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field

from backend.api.routers import references as ref_router
from backend.api.routers import resources as res_router
from backend.api.routers.web_library import _gate, _web_user
from backend.api.routers.web_student import current_student
from backend.database.database import db
from backend.core.time_utils import now_utc

try:
    from backend.services.pdf_renderer import PdfRenderer, WatermarkStamper, get_singleflight
    from backend.services.storage import get_storage_driver, HIGH_WATERMARK_BYTES, LOW_WATERMARK_BYTES
    from backend.services.office_viewer import (
        detect_web_kind,
        get_office_asset,
        parse_office_or_attachment,
        sniff_format_from_bytes,
    )
except ImportError:
    from services.pdf_renderer import PdfRenderer, WatermarkStamper, get_singleflight
    from services.storage import get_storage_driver, HIGH_WATERMARK_BYTES, LOW_WATERMARK_BYTES
    from services.office_viewer import (
        detect_web_kind,
        get_office_asset,
        parse_office_or_attachment,
        sniff_format_from_bytes,
    )

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


def _kind(mime: str, ext: str, content_type: str = "") -> str:
    """نوع محتوا برای انتخاب رندرر وب — شامل اسلاید، مستندات، اکسل و آرشیو."""
    return detect_web_kind(mime, ext, content_type)


async def _item(scope: str, file_id: str) -> dict | None:
    """سند فایل از همان جایی که مینی‌اپ می‌خواند."""
    if scope == "ref":
        return await db.ref_get_file(file_id)
    return await db.bs_get_content_item(file_id)


def _public(item: dict) -> dict:
    name = (str(item.get("display_file_name") or item.get("name") or "").strip()
            or str(item.get("description") or "").strip() or "فایل آموزشی")
    mime = str(item.get("mime_type") or "")
    ext = str(item.get("file_extension") or "")
    ctype = str(item.get("type") or "")
    return {
        "id": str(item.get("_id") or ""),
        "name": name,
        "mime": mime,
        "ext": ext,
        "type": ctype,
        "size": int(item.get("file_size") or 0),
        "kind": _kind(mime, ext, ctype),
    }


def _allow_download_for(kind: str, ext: str, protect_enabled: bool, item: dict) -> bool:
    """دانلود مستقیم وقتی مجاز است که قفل محتوا خاموش باشد یا فرمت فایل ذاتاً نیازمند دانلود باشد."""
    e = (ext or "").strip().lower().lstrip(".")
    if item.get("allow_web_download"):
        return True
    if not protect_enabled:
        return True
    if kind in ("archive", "attachment"):
        return True
    return e in {"ppt", "pps", "doc", "xls", "rar", "7z", "tar", "gz"}


async def _guard_and_resolve_item(scope: str, file_id: str, item: dict, web: dict) -> dict:
    """بررسی محدودیت ورودی و جایگزینی فورک فعال — مطابق resources/references."""
    if scope == "ref":
        filt = await ref_router._viewer_intake(web)
        item_intake = str(item.get("intake") or "").strip()
        try:
            item_intake = await db.ref_file_intake(file_id)
        except AttributeError:
            pass
        ref_router._intake_guard(item_intake, filt, "این فایل")
        if filt is not None:
            try:
                fork_b = await db.book_superseded_by_fork(
                    item.get("book_id", ""),
                    (web.get("_db") or {}).get("intake", ""),
                )
                if fork_b:
                    fk_file = await db.ref_files.find_one({"book_id": str(fork_b["_id"]), "fork_of": file_id})
                    if fk_file:
                        return fk_file
            except Exception:
                pass
    else:
        filt = await res_router._viewer_intake(web)
        item_intake = str(item.get("intake") or "").strip()
        try:
            item_intake = await db.content_intake(file_id)
        except AttributeError:
            pass
        res_router._intake_guard(item_intake, filt, "این فایل")
        if filt is not None:
            try:
                sess_fk = await db.session_superseded_by_fork(
                    item.get("session_id", ""),
                    (web.get("_db") or {}).get("intake", ""),
                )
                if sess_fk:
                    fk_content = await db.bs_content.find_one({"session_id": str(sess_fk["_id"]), "fork_of": file_id})
                    if fk_content:
                        return fk_content
            except Exception:
                pass
    return item


# ─────────────────────────────────────────────────────────────
#  🔗 آدرس نمایش
# ─────────────────────────────────────────────────────────────
@router.get("/library/view-url/{scope}/{file_id}")
async def view_url(scope: str, file_id: str, request: Request, user: dict = Depends(current_student)):
    """آدرس امضاشدهٔ ریدر برای یک فایل — همهٔ انواع فایل (PDF، مدیا، اسلاید، ورد، اکسل، آرشیو) باز می‌شوند."""
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
    item = await _guard_and_resolve_item(scope, file_id, item, web)
    meta = _public(item)
    kind = meta["kind"]
    uid = int(user.get("user_id") or user.get("id") or 0)
    try:
        protect_enabled = bool(await db.get_setting("protect_content_enabled", True))
    except Exception:
        protect_enabled = True
    allow_dl = _allow_download_for(kind, meta.get("ext", ""), protect_enabled, item)

    dl_exp = int(time.time()) + READER_URL_TTL_SEC
    dl_tok = generate_asset_token(uid, scope, file_id, "__dl__", dl_exp)
    download_url = (
        f"/api/web/library/download/{scope}/{quote(file_id, safe='')}"
        f"?token={dl_tok}&expires={dl_exp}&uid={uid}"
    ) if allow_dl else None

    if kind in ("pdf", "video", "audio", "image"):
        try:
            if scope == "ref":
                out = await ref_router.preview_url(file_id=file_id, user=web)
            else:
                out = await res_router.preview_url(content_id=file_id, user=web)
            from backend.api.telegram_send import PREVIEW_TTL_SEC
            return {
                **meta,
                "available": True,
                "url": out.get("url", ""),
                "expires_in": PREVIEW_TTL_SEC,
                "expires_at": int(time.time()) + PREVIEW_TTL_SEC,
                "allow_download": allow_dl,
                "download_url": download_url,
            }
        except HTTPException as exc:
            if exc.status_code == 404:
                raise HTTPException(status_code=404, detail="file_not_found")
            if exc.status_code == 403:
                raise HTTPException(status_code=403, detail={"code": "not_in_scope", "message": str(exc.detail)})
            if exc.status_code != 415:
                raise

    if kind not in ("slides", "document", "sheet", "archive", "attachment"):
        meta["kind"] = "document"
        kind = "document"
        allow_dl = _allow_download_for(kind, meta.get("ext", ""), protect_enabled, item)
        download_url = (
            f"/api/web/library/download/{scope}/{quote(file_id, safe='')}"
            f"?token={dl_tok}&expires={dl_exp}&uid={uid}"
        ) if allow_dl else None

    return {
        **meta,
        "available": True,
        "url": f"/api/web/reader/office/{scope}/{quote(file_id, safe='')}",
        "allow_download": allow_dl,
        "download_url": download_url,
        "expires_in": READER_URL_TTL_SEC,
        "expires_at": dl_exp,
    }


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
            from backend.api.telegram_send import download_telegram_file_any_size
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
        if inspect.isawaitable(user):
            user = await user
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


# ─────────────────────────────────────────────────────────────
#  📊 نمایشگر اسلایدها (PPTX/PPT)، مستندات (DOCX/TXT)، جداول و دانلود وب
# ─────────────────────────────────────────────────────────────
_OFFICE_PARSED_CACHE: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()


def generate_asset_token(user_id: int, scope: str, file_id: str, asset: str, expires: int) -> str:
    msg = f"asset:{int(user_id)}:{scope}:{file_id}:{asset}:{int(expires)}".encode("utf-8")
    return hmac.new(READER_SECRET.encode("utf-8"), msg, hashlib.sha256).hexdigest()[:40]


def verify_asset_token(token: str, user_id: int, scope: str, file_id: str, asset: str, expires: int) -> bool:
    if int(time.time()) > int(expires):
        return False
    expected = generate_asset_token(user_id, scope, file_id, asset, expires)
    return hmac.compare_digest(str(token), expected)


async def _fetch_raw_file_bytes(file_id: str, item: dict) -> bytes:
    """دریافت بایت‌های خام هر فایل (اسلاید/ورد/اکسل/ضمایم) از حافظه، دیسک یا تلگرام و کش آن."""
    storage = get_storage_driver()
    storage_key = f"raw_{file_id}"

    for key in ("raw_bytes", "file_bytes", "pdf_bytes"):
        val = item.get(key)
        if isinstance(val, (bytes, bytearray)):
            raw = bytes(val)
            try:
                await storage.save_original(storage_key, raw)
            except Exception:
                pass
            return raw

    cached = await storage.get_original(storage_key)
    if cached:
        return cached

    local_path = item.get("file_path") or item.get("local_path")
    if local_path and os.path.isfile(local_path):
        with open(local_path, "rb") as f:
            raw = f.read()
        try:
            await storage.save_original(storage_key, raw)
        except Exception:
            pass
        return raw

    tg_id = str(item.get("file_id") or item.get("telegram_file_id") or "")
    if tg_id:
        try:
            from backend.api.telegram_send import download_telegram_file_any_size
            tg_bytes = await download_telegram_file_any_size(tg_id)
            if tg_bytes:
                try:
                    await storage.save_original(storage_key, tg_bytes)
                except Exception:
                    pass
                return tg_bytes
        except Exception as exc:
            logger.warning("download_telegram_file_any_size failed for %s: %s", tg_id, exc)

    raise HTTPException(status_code=404, detail="raw_file_not_found")


@router.get("/reader/office/{scope}/{file_id}")
async def get_reader_office(
    scope: str,
    file_id: str,
    user: dict = Depends(current_student),
):
    """استخراج و ارائهٔ ساختاریافتهٔ اسلایدها، مستندات و جداول برای نمایش داخل برنامه."""
    if scope not in SCOPES:
        raise HTTPException(status_code=422, detail="scope_invalid")

    web = _web_user(user)
    await _gate("references" if scope == "ref" else "resources", web)
    item = await _item(scope, file_id)
    if not item:
        raise HTTPException(status_code=404, detail="file_not_found")
    item = await _guard_and_resolve_item(scope, file_id, item, web)
    meta = _public(item)
    resolved_fid = str(item.get("_id") or file_id)

    cached_doc = _OFFICE_PARSED_CACHE.get(resolved_fid)
    if cached_doc is not None:
        _OFFICE_PARSED_CACHE.move_to_end(resolved_fid)
        parsed = copy.deepcopy(cached_doc)
    else:
        raw_bytes = await _fetch_raw_file_bytes(resolved_fid, item)
        sniffed = sniff_format_from_bytes(raw_bytes, ext=meta.get("ext", ""), mime=meta.get("mime", ""))
        if sniffed == "pdf":
            storage = get_storage_driver()
            await storage.save_original(resolved_fid, raw_bytes)
            return {
                "kind": "pdf",
                "format": "pdf",
                "name": meta["name"],
                "redirect_manifest": f"/api/web/reader/manifest/{scope}/{quote(resolved_fid, safe='')}",
            }
        parsed = await asyncio.to_thread(
            parse_office_or_attachment,
            raw_bytes,
            resolved_fid,
            meta.get("mime", ""),
            meta.get("ext", ""),
            meta.get("name", ""),
        )
        while len(_OFFICE_PARSED_CACHE) >= 48:
            _OFFICE_PARSED_CACHE.popitem(last=False)
        _OFFICE_PARSED_CACHE[resolved_fid] = copy.deepcopy(parsed)

    uid = int(user.get("user_id") or user.get("id") or 0)
    exp = int(time.time()) + READER_URL_TTL_SEC
    asset_urls: Dict[str, str] = {}
    for asset_name in parsed.get("assets") or []:
        tok = generate_asset_token(uid, scope, resolved_fid, asset_name, exp)
        asset_urls[asset_name] = (
            f"/api/web/reader/asset/{scope}/{quote(resolved_fid, safe='')}"
            f"?name={quote(asset_name, safe='')}&token={tok}&expires={exp}&uid={uid}"
        )

    try:
        protect_enabled = bool(await db.get_setting("protect_content_enabled", True))
    except Exception:
        protect_enabled = True
    allow_dl = _allow_download_for(parsed.get("kind") or meta["kind"], meta.get("ext", ""), protect_enabled, item)
    dl_tok = generate_asset_token(uid, scope, resolved_fid, "__dl__", exp)
    download_url = (
        f"/api/web/library/download/{scope}/{quote(resolved_fid, safe='')}"
        f"?token={dl_tok}&expires={exp}&uid={uid}"
    ) if allow_dl else None

    return {
        **parsed,
        "scope": scope,
        "name": meta["name"],
        "mime": meta["mime"],
        "ext": meta.get("ext", ""),
        "size": meta["size"],
        "asset_urls": asset_urls,
        "allow_download": allow_dl,
        "download_url": download_url,
        "expires_in": READER_URL_TTL_SEC,
        "expires_at": exp,
    }


@router.get("/reader/asset/{scope}/{file_id}")
async def get_reader_office_asset(
    scope: str,
    file_id: str,
    request: Request,
    name: str = Query(..., min_length=1, max_length=256),
    token: str = Query(..., min_length=8),
    expires: int = Query(...),
    uid: Optional[int] = Query(None),
):
    """سرو تصاویر جاسازی‌شده داخل اسلایدهای PPTX یا فایل‌های DOCX با توکن امضاشده."""
    if scope not in SCOPES:
        raise HTTPException(status_code=422, detail="scope_invalid")
    resolved_uid, _, _ = await _resolve_student_identity(request, uid, allow_uid_only=True)
    if int(time.time()) > int(expires):
        raise HTTPException(status_code=403, detail="SIGNATURE_EXPIRED")
    if not verify_asset_token(token, resolved_uid, scope, file_id, name, expires):
        raise HTTPException(status_code=403, detail="INVALID_SIGNATURE")

    storage = get_storage_driver()
    raw_bytes = await storage.get_original(f"raw_{file_id}")
    if not raw_bytes:
        item = await _item(scope, file_id)
        if not item:
            raise HTTPException(status_code=404, detail="file_not_found")
        raw_bytes = await _fetch_raw_file_bytes(file_id, item)

    res = await asyncio.to_thread(get_office_asset, raw_bytes, name)
    if not res:
        raise HTTPException(status_code=404, detail="asset_not_found")
    img_bytes, mime = res
    return Response(
        content=img_bytes,
        media_type=mime,
        headers={
            "Cache-Control": "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/library/download/{scope}/{file_id}")
async def get_library_download(
    scope: str,
    file_id: str,
    request: Request,
    token: Optional[str] = Query(None),
    expires: Optional[int] = Query(None),
    uid: Optional[int] = Query(None),
):
    """دانلود مستقیم فایل در مرورگر وب (بدون نیاز به ربات تلگرام) با ثبت آمار دانلود."""
    if scope not in SCOPES:
        raise HTTPException(status_code=422, detail="scope_invalid")

    if token and expires is not None and uid is not None:
        if int(time.time()) > int(expires):
            raise HTTPException(status_code=403, detail="SIGNATURE_EXPIRED")
        if not verify_asset_token(token, int(uid), scope, file_id, "__dl__", int(expires)):
            raise HTTPException(status_code=403, detail="INVALID_SIGNATURE")
        db_user = await db.get_user(int(uid))
        if not db_user:
            raise HTTPException(status_code=401, detail="login_required")
        web = _web_user(db_user)
        user_id = int(uid)
    else:
        student = await current_student(request)
        web = _web_user(student)
        user_id = int(student.get("user_id") or student.get("id") or 0)

    await _gate("references" if scope == "ref" else "resources", web)
    item = await _item(scope, file_id)
    if not item:
        raise HTTPException(status_code=404, detail="file_not_found")
    item = await _guard_and_resolve_item(scope, file_id, item, web)
    meta = _public(item)

    try:
        protect_enabled = bool(await db.get_setting("protect_content_enabled", True))
    except Exception:
        protect_enabled = True
    if not _allow_download_for(meta["kind"], meta.get("ext", ""), protect_enabled, item):
        raise HTTPException(status_code=403, detail="download_protected")

    raw_bytes = await _fetch_raw_file_bytes(str(item.get("_id") or file_id), item)

    # ثبت آمار دانلود مثل ربات
    try:
        if scope == "ref":
            await db.ref_inc_download(file_id, user_id)
        else:
            await db.bs_inc_download(file_id, user_id)
    except Exception:
        pass

    ext = (meta.get("ext") or "").strip().lstrip(".")
    base_name = (meta.get("name") or "file").replace('"', "").replace("\n", " ").strip()
    filename = base_name if (not ext or base_name.lower().endswith("." + ext.lower())) else f"{base_name}.{ext}"
    ascii_fallback = re.sub(r"[^a-zA-Z0-9._-]+", "_", filename).strip("_") or (f"file.{ext}" if ext else "file")
    headers = {
        "Content-Disposition": f"attachment; filename=\"{ascii_fallback}\"; filename*=UTF-8''{quote(filename)}",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
    }
    return Response(content=raw_bytes, media_type=meta.get("mime") or "application/octet-stream", headers=headers)
