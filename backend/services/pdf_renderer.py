# -*- coding: utf-8 -*-
"""PyMuPDF WebP Rasterization and Dynamic Watermarking Engine.

Features:
- PyMuPDF 2.0+ high-fidelity page rasterization at 150 DPI.
- Pillow WebP converter (quality=80, method=4 for medical clarity).
- Low-res (72 DPI) thumbnail generation (< 30 KB).
- Forensic micro watermark: one faint identity line burned into a fixed margin spot.
- Per-session glyph mask cache, so stamping a page stays well under 50ms.
- Singleflight coalescing lock for CPU-bounded render concurrency.
"""
from __future__ import annotations

import asyncio
from collections import OrderedDict
import hashlib
import io
import logging
import os
import time
from typing import Any, Callable, Coroutine, Dict, List, Optional, Tuple

import pymupdf  # PyMuPDF 2.0+
from PIL import Image, ImageDraw, ImageFont, ImageStat
import arabic_reshaper
from bidi.algorithm import get_display

logger = logging.getLogger(__name__)

# Font path resolution
_DEFAULT_FONT_PATH = os.path.join(
    os.path.dirname(__file__), "qbank", "fonts", "Vazirmatn-Regular.ttf"
)
if not os.path.exists(_DEFAULT_FONT_PATH):
    _alt_candidates = [
        os.path.join(os.getcwd(), "backend", "services", "qbank", "fonts", "Vazirmatn-Regular.ttf"),
        os.path.join(os.getcwd(), "humsyarx-main", "backend", "services", "qbank", "fonts", "Vazirmatn-Regular.ttf"),
    ]
    for _cand in _alt_candidates:
        if os.path.exists(_cand):
            _DEFAULT_FONT_PATH = _cand
            break

VAZIR_FONT_PATH = _DEFAULT_FONT_PATH


class SingleflightCoalescer:
    """Collapses multiple concurrent requests for the same uncached page into 1 execution."""

    def __init__(self):
        self._events: Dict[str, asyncio.Event] = {}
        self._results: Dict[str, Any] = {}
        self._errors: Dict[str, Exception] = {}
        self._mutex = asyncio.Lock()
        self.call_count: int = 0

    async def execute(self, key: str, coro_fn: Callable[[], Coroutine[Any, Any, Any]]) -> Any:
        async with self._mutex:
            if key in self._events:
                # Request is already in-flight; register as listener
                event = self._events[key]
                leader = False
            else:
                # Arrived first; register as task leader
                event = asyncio.Event()
                self._events[key] = event
                leader = True

        if not leader:
            await event.wait()
            if key in self._errors:
                raise self._errors[key]
            return self._results[key]

        try:
            self.call_count += 1
            res = await coro_fn()
            self._results[key] = res
            return res
        except Exception as exc:
            self._errors[key] = exc
            raise
        finally:
            event.set()
            asyncio.create_task(self._cleanup(key))

    async def _cleanup(self, key: str):
        # Allow awaiting coroutines on the current event loop turn to read the result
        await asyncio.sleep(0.05)
        async with self._mutex:
            self._events.pop(key, None)
            self._results.pop(key, None)
            self._errors.pop(key, None)


_COALESCER = SingleflightCoalescer()


def get_singleflight() -> SingleflightCoalescer:
    """Retrieve global Singleflight coalescing lock singleton."""
    return _COALESCER


class PdfRenderer:
    """Server-side PDF processing, dimension extraction, and WebP rasterization."""

    @staticmethod
    def get_document_manifest(
        pdf_bytes: bytes,
        file_id: str,
        scope: str,
        title: str,
        user_id: int,
    ) -> Dict[str, Any]:
        """Extract page count and intrinsic dimensions in < 10ms without rasterizing pages."""
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
        total_pages = doc.page_count
        dimensions: List[Dict[str, Any]] = []

        for p_no in range(total_pages):
            page = doc.load_page(p_no)
            rect = page.rect
            w = round(rect.width, 2)
            h = round(rect.height, 2)
            aspect_ratio = round(w / h, 4) if h > 0 else 0.7071
            dimensions.append({
                "page": p_no + 1,
                "width": int(w * (150 / 72)),    # 150 DPI pixel width
                "height": int(h * (150 / 72)),  # 150 DPI pixel height
                "aspect_ratio": aspect_ratio,
            })
        doc.close()

        return {
            "file_id": file_id,
            "scope": scope,
            "title": title,
            "total_pages": total_pages,
            "page_dimensions": dimensions,
            "encryption_mode": "server_webp_watermarked",
            "watermark_user_id": user_id,
        }

    @staticmethod
    def rasterize_page_to_webp(pdf_bytes: bytes, page_num: int, dpi: int = 150) -> bytes:
        """Rasterize a single 1-indexed page to WebP format using PyMuPDF and Pillow."""
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
        if page_num < 1 or page_num > doc.page_count:
            total = doc.page_count
            doc.close()
            raise ValueError(f"Page {page_num} out of range (1..{total})")

        page = doc.load_page(page_num - 1)
        pix = page.get_pixmap(dpi=dpi, alpha=False)
        doc.close()

        # Convert raw pixel samples to Pillow image
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)

        bio = io.BytesIO()
        # Quality=80, Method=4 provides optimal balance of speed and medical-grade fidelity
        img.save(bio, format="WEBP", quality=80, method=4)
        return bio.getvalue()

    @staticmethod
    def render_thumbnail(pdf_bytes: bytes, page_num: int = 1) -> bytes:
        """Low-res 72 DPI thumbnail (< 30 KB) for catalog and grid views."""
        return PdfRenderer.rasterize_page_to_webp(pdf_bytes, page_num=page_num, dpi=72)


class WatermarkStamper:
    """Forensic micro watermark: one small, low-contrast identity line per page.

    The old diagonal grid covered every page with the student's name and made the
    booklet hard to read. Now there is one line in a fixed spot. It is unreadable at
    normal reading size and readable when you zoom into that spot:

        bottom margin, left corner (LTR end side of an RTL page), inset ~3% from the
        left edge and ~1.2% from the bottom edge.

    The line is burned into the page pixels (not a DOM overlay), so screenshots and
    saved images keep it. It carries the student's name, user id, client IP, the
    issue time and a short check code tied to the file and page:

        HY-<CODE> | <name> | <user id> | <ip> | <YYYY-MM-DD HH:MM>

    <CODE> is the first 8 hex chars of sha256(uid|file|page|time|secret), so a leaked
    page can be checked against the server secret and cannot be forged by editing text.
    """

    _CACHE: "OrderedDict[Tuple[Any, ...], Image.Image]" = OrderedDict()

    # Fixed placement, as fractions of the page (documented above, keep in sync)
    INSET_X = 0.03
    INSET_Y = 0.012
    # Font size as a fraction of page height, with a floor so the glyphs survive encoding
    FONT_FRACTION = 0.0055
    FONT_MIN_PX = 9
    # Grey-level distance from the local paper tone: invisible at reading size, legible zoomed
    INK_DELTA = 44

    @staticmethod
    def _secret() -> str:
        return (
            os.getenv("READER_SIGNING_SECRET")
            or os.getenv("SESSION_SECRET")
            or "humsyar-reader-secret-salt"
        )

    @classmethod
    def mark_text(
        cls,
        user_name: str,
        user_id: int,
        client_ip: str,
        timestamp: Optional[str] = None,
        file_id: str = "",
        page_number: int = 0,
    ) -> str:
        date_str = timestamp or time.strftime("%Y-%m-%d %H:%M", time.localtime())
        raw = f"{user_id}|{file_id}|{page_number}|{date_str}|{cls._secret()}"
        code = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:8].upper()
        name = " ".join((user_name or "").replace("|", "-").split())[:72] or "Student"
        return f"HY-{code} | {name} | {user_id} | {client_ip} | {date_str}"

    @classmethod
    def _font_px(cls, height: int) -> int:
        return max(cls.FONT_MIN_PX, int(round(height * cls.FONT_FRACTION)))

    @classmethod
    def _get_overlay(
        cls,
        user_name: str,
        user_id: int,
        client_ip: str,
        width: int,
        height: int,
        timestamp: Optional[str] = None,
        file_id: str = "",
        page_number: int = 0,
    ) -> Image.Image:
        """Return the glyph mask ('L' image, 255 = ink) for one identity line."""
        hour_key = int(time.time() // 3600)
        cache_key = (user_id, client_ip, width, height, hour_key, file_id, page_number, user_name[:32])
        if timestamp is None and cache_key in cls._CACHE:
            cls._CACHE.move_to_end(cache_key)
            return cls._CACHE[cache_key]

        text = cls.mark_text(user_name, user_id, client_ip, timestamp, file_id, page_number)
        # Shape only the name: running bidi over the whole line reorders the LTR fields
        # and printed the date as "03:30 27-11-2026".
        head, _, tail = text.partition(" | ")
        name, _, rest = tail.partition(" | ")
        shaped = f"{head} | {get_display(arabic_reshaper.reshape(name))} | {rest}"
        size = cls._font_px(height)
        try:
            font = ImageFont.truetype(VAZIR_FONT_PATH, size)
        except Exception:
            font = ImageFont.load_default()

        probe = ImageDraw.Draw(Image.new("L", (1, 1)))
        left, top, right, bottom = probe.textbbox((0, 0), shaped, font=font)
        pad = 2
        mask = Image.new("L", (max(1, right - left + pad * 2), max(1, bottom - top + pad * 2)), 0)
        ImageDraw.Draw(mask).text((pad - left, pad - top), shaped, font=font, fill=255)

        # Keep cache bounded to 200 active masks via LRU eviction (never wipe hot entries)
        if timestamp is None:
            while len(cls._CACHE) >= 200:
                cls._CACHE.popitem(last=False)
            cls._CACHE[cache_key] = mask
        return mask

    @classmethod
    def mark_box(cls, width: int, height: int, mask_size: Tuple[int, int]) -> Tuple[int, int, int, int]:
        """Pixel box (x0, y0, x1, y1) of the mark on a page of the given size."""
        mw, mh = mask_size
        x0 = int(round(width * cls.INSET_X))
        y0 = max(0, height - int(round(height * cls.INSET_Y)) - mh)
        return x0, y0, min(width, x0 + mw), min(height, y0 + mh)

    @classmethod
    def stamp_watermark(
        cls,
        base_webp_bytes: bytes,
        user_name: str,
        user_id: int,
        client_ip: str,
        timestamp: Optional[str] = None,
        file_id: str = "",
        page_number: int = 0,
    ) -> bytes:
        """Burn the identity line into the page at its fixed spot and re-encode."""
        base_img = Image.open(io.BytesIO(base_webp_bytes)).convert("RGB")
        width, height = base_img.size
        mask = cls._get_overlay(
            user_name, user_id, client_ip, width, height,
            timestamp=timestamp, file_id=file_id, page_number=page_number,
        )
        x0, y0, x1, y1 = cls.mark_box(width, height, mask.size)
        if x1 > x0 and y1 > y0:
            region = base_img.crop((x0, y0, x1, y1))
            paper = int(ImageStat.Stat(region.convert("L")).mean[0])
            tone = paper - cls.INK_DELTA if paper >= 128 else paper + cls.INK_DELTA
            tone = max(0, min(255, tone))
            ink = Image.new("RGB", region.size, (tone, tone, tone))
            region.paste(ink, (0, 0), mask.crop((0, 0, x1 - x0, y1 - y0)))
            base_img.paste(region, (x0, y0))

        bio = io.BytesIO()
        # q90 keeps the faint glyph edges intact; method=0 stays fast
        base_img.save(bio, format="WEBP", quality=90, method=0)
        return bio.getvalue()
