# -*- coding: utf-8 -*-
"""🎬 backend/services/media_stream.py — پخش ویدیو/ویس بزرگ داخل وباپ و مینیاپ.

ریشهی مشکل: Bot API ابری (`getFile`) فقط فایلهای تا ۲۰MB را میدهد؛ برای
ویدیو/ویسهای بزرگتر جواب «file is too big» میآمد ⇒ 502 ⇒ پلیر روی 0:00.

راهحل:
  ۱) اگر نسخهی کامل در کش دیسک هست ⇒ FileResponse (Starlette خودش Range/206).
  ۲) فایل ≤۲۰MB ⇒ همان پروکسی ابری قبلی (در telegram_send).
  ۳) بزرگتر ⇒ استریم Range-aware از MTProto (کلاینت Kurigram دانلودر جزوهنویس)
     + دانلود پسزمینهی نسخهی کامل در کش تا دفعهی بعد مستقیم از دیسک سرو شود.

تنظیمات (همه اختیاری):
  MEDIA_CACHE_DIR       پیشفرض: $STORAGE_ROOT/media_cache
  MEDIA_CACHE_MAX_GB    سقف کل کش (پیشفرض ۱۰)؛ قدیمیترینها پاک میشوند
  MEDIA_MTPROTO_ENABLED 0 ⇒ خاموش (فقط مسیر ابری)
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
from typing import Any, AsyncIterator, Optional
from urllib.parse import quote

logger = logging.getLogger(__name__)

CLOUD_GETFILE_LIMIT = 20 * 1024 * 1024   # سقف getFile در Bot API ابری
MTPROTO_CHUNK = 1024 * 1024              # اندازهی ثابت chunk در stream_media
_UNKNOWN_SIZE_WAIT_SEC = 180             # فایل بیاندازه: صبر برای دانلود کامل
_CHUNK_TIMEOUT_SEC = float(os.getenv("MEDIA_CHUNK_TIMEOUT_SEC", "20"))  # deadline per 1MB chunk
_STREAM_RETRIES = 3                       # resumes after a stalled/failed chunk

# ─────────────────────────────────────────────────────────────
#  MIME — Safari با nosniff روی نوع اشتباه پخش نمیکند
# ─────────────────────────────────────────────────────────────
_MIME_BY_EXT = {
    "mp4": "video/mp4", "m4v": "video/mp4", "mov": "video/quicktime",
    "webm": "video/webm", "mkv": "video/x-matroska",
    "m4a": "audio/mp4", "m4b": "audio/mp4", "aac": "audio/aac",
    "mp3": "audio/mpeg", "ogg": "audio/ogg", "oga": "audio/ogg",
    "opus": "audio/ogg", "wav": "audio/wav", "flac": "audio/flac",
    "pdf": "application/pdf", "jpg": "image/jpeg", "jpeg": "image/jpeg",
    "png": "image/png", "gif": "image/gif", "webp": "image/webp",
}
_MIME_ALIASES = {
    "audio/x-m4a": "audio/mp4", "audio/m4a": "audio/mp4",
    "audio/mp3": "audio/mpeg", "audio/x-mp3": "audio/mpeg",
    "audio/x-wav": "audio/wav", "audio/wave": "audio/wav",
    "audio/x-flac": "audio/flac", "audio/opus": "audio/ogg",
    "audio/x-aac": "audio/aac", "video/x-m4v": "video/mp4",
}
_GENERIC_MIMES = {"", "application/octet-stream", "binary/octet-stream"}


def canonical_media_mime(mime: str = "", name: str = "", ext: str = "") -> str:
    """نوع درست برای مرورگر؛ m4a ⇒ audio/mp4 (نه x-m4a)، octet-stream ⇒ از پسوند."""
    m = (mime or "").strip().lower().split(";")[0].strip()
    e = (ext or "").strip().lower().lstrip(".")
    if not e and name:
        e = os.path.splitext(name)[1].lower().lstrip(".")
    if m in _MIME_ALIASES:
        return _MIME_ALIASES[m]
    if m in _GENERIC_MIMES and e in _MIME_BY_EXT:
        return _MIME_BY_EXT[e]
    return m or "application/octet-stream"


# ─────────────────────────────────────────────────────────────
#  Range
# ─────────────────────────────────────────────────────────────
class RangeNotSatisfiable(Exception):
    """درخواست Range خارج از اندازهی فایل ⇒ 416."""


def parse_range(header: Optional[str], size: int) -> Optional[tuple[int, int]]:
    """`bytes=a-b` ⇒ (start, end) شاملی. بدون/نامعتبر ⇒ None (کل فایل).

    فقط اولین بازه پشتیبانی میشود (پلیرهای مرورگر چندبازهای نمیخواهند).
    """
    if not header or size <= 0:
        return None
    h = header.strip().lower()
    if not h.startswith("bytes="):
        return None
    spec = h[6:].split(",")[0].strip()
    start_s, sep, end_s = spec.partition("-")
    if not sep:
        return None
    try:
        if start_s == "":
            suffix = int(end_s)
            if suffix <= 0:
                raise RangeNotSatisfiable()
            return max(0, size - suffix), size - 1
        start = int(start_s)
        end = int(end_s) if end_s else size - 1
    except ValueError:
        return None
    end = min(end, size - 1)
    if start < 0 or start >= size or start > end:
        raise RangeNotSatisfiable()
    return start, end


def is_continuation_range(header: Optional[str]) -> bool:
    """Range از وسط فایل (seek/بافر مجدد) — برای rate-limit شمرده نمیشود."""
    h = (header or "").strip().lower()
    if not h.startswith("bytes="):
        return False
    start_s = h[6:].split(",")[0].partition("-")[0].strip()
    try:
        return int(start_s) > 0
    except ValueError:
        return False


# ─────────────────────────────────────────────────────────────
#  کش دیسک
# ─────────────────────────────────────────────────────────────
def _cache_dir() -> str:
    explicit = (os.getenv("MEDIA_CACHE_DIR") or "").strip()
    if explicit:
        return explicit
    return os.path.join(os.getenv("STORAGE_ROOT", "/data/storage"), "media_cache")


def _cache_max_bytes() -> int:
    try:
        gb = float(os.getenv("MEDIA_CACHE_MAX_GB", "10") or 10)
    except ValueError:
        gb = 10.0
    return int(max(0.0, gb) * 1024 ** 3)


def cache_path(file_id: str) -> str:
    digest = hashlib.sha256(file_id.encode("utf-8")).hexdigest()[:40]
    return os.path.join(_cache_dir(), f"{digest}.bin")


def cached_file(file_id: str) -> Optional[str]:
    """مسیر نسخهی کامل در کش، یا None. زمان دسترسی برای LRU بهروز میشود."""
    if not file_id:
        return None
    p = cache_path(file_id)
    try:
        if os.path.getsize(p) > 0:
            try:
                os.utime(p, None)
            except OSError:
                pass
            return p
    except OSError:
        pass
    return None


def _evict(keep: str = "") -> None:
    """قدیمیترین فایلها را تا زیر سقف کش پاک میکند."""
    limit = _cache_max_bytes()
    root = _cache_dir()
    try:
        entries = []
        for fn in os.listdir(root):
            if not fn.endswith(".bin"):
                continue
            fp = os.path.join(root, fn)
            try:
                st = os.stat(fp)
            except OSError:
                continue
            entries.append((st.st_mtime, st.st_size, fp))
    except OSError:
        return
    total = sum(e[1] for e in entries)
    for _mtime, sz, fp in sorted(entries):
        if total <= limit:
            break
        if fp == keep:
            continue
        try:
            os.remove(fp)
            total -= sz
            logger.info("MEDIA_CACHE_EVICT file=%s size=%d", os.path.basename(fp), sz)
        except OSError:
            pass


def mtproto_enabled() -> bool:
    if (os.getenv("MEDIA_MTPROTO_ENABLED", "1") or "1").strip().lower() in ("0", "false", "no", "off"):
        return False
    return bool((os.getenv("TELEGRAM_TOKEN") or os.getenv("BOT_TOKEN") or "").strip())


async def _get_client() -> Any:
    from backend.services.telegram_downloader import get_mtproto_downloader_client
    return await get_mtproto_downloader_client()


async def _download_full(file_id: str) -> str:
    """دانلود کامل از MTProto به کش (نوشتن اتمیک با .part ⇒ rename)."""
    dest = cache_path(file_id)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    part = f"{dest}.{os.getpid()}.part"
    client = await _get_client()
    try:
        with open(part, "wb") as fh:
            async for chunk in client.stream_media(file_id):
                await asyncio.to_thread(fh.write, chunk)
        if os.path.getsize(part) <= 0:
            raise RuntimeError("empty media download")
        os.replace(part, dest)
    finally:
        if os.path.exists(part):
            try:
                os.remove(part)
            except OSError:
                pass
    logger.info("MEDIA_CACHE_STORED file=%s size=%d", os.path.basename(dest), os.path.getsize(dest))
    await asyncio.to_thread(_evict, dest)
    return dest


_inflight: dict[str, asyncio.Task] = {}


def ensure_cached(file_id: str) -> asyncio.Task:
    """یک دانلود کامل در پسزمینه (برای هر file_id حداکثر یکی همزمان)."""
    task = _inflight.get(file_id)
    if task is not None and not task.done():
        return task
    task = asyncio.create_task(_download_full(file_id))
    _inflight[file_id] = task

    def _done(t: asyncio.Task, key: str = file_id) -> None:
        if _inflight.get(key) is t:
            _inflight.pop(key, None)
        if not t.cancelled() and t.exception() is not None:
            logger.warning("MEDIA_CACHE_DOWNLOAD_FAILED err=%s", type(t.exception()).__name__)

    task.add_done_callback(_done)
    return task


async def download_bytes(file_id: str) -> Optional[bytes]:
    """بایتهای کامل فایل از کش یا MTProto (برای PDFهای بزرگتر از ۲۰MB)."""
    if not mtproto_enabled():
        return None
    try:
        path = cached_file(file_id) or await asyncio.shield(ensure_cached(file_id))
    except Exception as exc:
        logger.warning("MEDIA_MTPROTO_BYTES_FAILED err=%s", type(exc).__name__)
        return None

    def _read() -> bytes:
        with open(path, "rb") as fh:
            return fh.read()

    return await asyncio.to_thread(_read)


# ─────────────────────────────────────────────────────────────
#  پاسخها
# ─────────────────────────────────────────────────────────────
def _headers(name: str) -> dict:
    return {
        "Content-Disposition": f"inline; filename*=UTF-8''{quote((name or 'file')[:120])}",
        "Cache-Control": "private, max-age=3600",
    }


def file_response(path: str, mime: str, name: str):
    """سرو از دیسک — Starlette ≥0.39 خودش Range ⇒ 206 و 416 را مدیریت میکند."""
    from fastapi.responses import FileResponse
    return FileResponse(path, media_type=mime, headers=_headers(name))


async def _iter_range(client: Any, file_id: str, start: int, end: int) -> AsyncIterator[bytes]:
    """chunkهای ۱MB تلگرام را میگیرد و دقیقاً بایتهای [start, end] را میدهد.

    A Telegram chunk fetch can stall (slow DC, FloodWait sleep). Before, one stall froze the
    response forever: headers were sent, so the player spun with no error ("sometimes it just
    never loads"). Each chunk now has a deadline; on stall/error the stream resumes from the
    chunk it was on, a few times with backoff, then ends so the player can surface an error."""
    first = start // MTPROTO_CHUNK
    last = end // MTPROTO_CHUNK
    idx = first
    attempts = 0
    while idx <= last:
        pos = idx * MTPROTO_CHUNK
        agen = client.stream_media(file_id, limit=last - idx + 1, offset=idx).__aiter__()
        try:
            while idx <= last:
                chunk = await asyncio.wait_for(agen.__anext__(), timeout=_CHUNK_TIMEOUT_SEC)
                c_start, pos = pos, pos + len(chunk)
                lo = max(start, c_start) - c_start
                hi = min(end + 1, pos) - c_start
                if hi > lo:
                    yield bytes(chunk[lo:hi])
                idx += 1
                attempts = 0
                if pos > end:
                    return
            return
        except StopAsyncIteration:
            return
        except Exception as exc:  # هدرها رفتهاند؛ ادامه از همان chunk یا قطع و لاگ
            attempts += 1
            logger.warning("MEDIA_MTPROTO_STREAM_RETRY err=%s chunk=%d attempt=%d range=%d-%d",
                           type(exc).__name__, idx, attempts, start, end)
            if attempts > _STREAM_RETRIES:
                return
            await asyncio.sleep(min(4.0, 0.5 * (2 ** attempts)))
        finally:
            aclose = getattr(agen, "aclose", None)
            if aclose is not None:
                try:
                    await aclose()
                except Exception:
                    pass


async def mtproto_response(file_id: str, mime: str, name: str,
                           range_header: Optional[str], size: int):
    """پاسخ استریم Range-aware از MTProto (+ گرمکردن کش در پسزمینه)."""
    from fastapi import HTTPException
    from fastapi.responses import Response, StreamingResponse

    try:
        client = await _get_client()
    except Exception as exc:
        logger.warning("MEDIA_MTPROTO_CLIENT_FAILED err=%s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="دریافت فایل از تلگرام ناموفق بود")

    if size <= 0:
        # بدون اندازه، Content-Range درست ممکن نیست ⇒ اول کامل در کش
        try:
            path = await asyncio.wait_for(asyncio.shield(ensure_cached(file_id)),
                                          timeout=_UNKNOWN_SIZE_WAIT_SEC)
        except Exception as exc:
            logger.warning("MEDIA_MTPROTO_FULL_FAILED err=%s", type(exc).__name__)
            raise HTTPException(status_code=502, detail="دریافت فایل از تلگرام ناموفق بود")
        return file_response(path, mime, name)

    if size <= _cache_max_bytes() // 4:
        ensure_cached(file_id)

    try:
        rng = parse_range(range_header, size)
    except RangeNotSatisfiable:
        return Response(status_code=416, headers={"Content-Range": f"bytes */{size}",
                                                  "Accept-Ranges": "bytes"})
    start, end = rng if rng else (0, size - 1)
    headers = _headers(name)
    headers["Accept-Ranges"] = "bytes"
    headers["Content-Length"] = str(end - start + 1)
    status = 200
    if rng:
        status = 206
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    return StreamingResponse(_iter_range(client, file_id, start, end),
                             status_code=status, media_type=mime, headers=headers)
