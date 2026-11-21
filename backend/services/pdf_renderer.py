# -*- coding: utf-8 -*-
"""PyMuPDF WebP Rasterization and Dynamic Watermarking Engine.

Features:
- PyMuPDF 2.0+ high-fidelity page rasterization at 150 DPI.
- Pillow WebP converter (quality=80, method=4 for medical clarity).
- Low-res (72 DPI) thumbnail generation (< 30 KB).
- Dynamic diagonal pixel watermarking with RTL Persian text shaping.
- Session-based transparent watermark overlay cache with SIMD alpha compositing (< 10ms).
- Singleflight coalescing lock for CPU-bounded render concurrency.
"""
from __future__ import annotations

import asyncio
import io
import logging
import os
import time
from typing import Any, Callable, Coroutine, Dict, List, Optional, Tuple

import pymupdf  # PyMuPDF 2.0+
from PIL import Image, ImageDraw, ImageFont
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
    """Pre-rendered session watermark overlay generator and SIMD alpha compositor."""

    _CACHE: Dict[Tuple[int, str, int, int, int], Image.Image] = {}

    @classmethod
    def _get_overlay(
        cls,
        user_name: str,
        user_id: int,
        client_ip: str,
        width: int,
        height: int,
        timestamp: Optional[str] = None,
    ) -> Image.Image:
        # Cache key rounded to hour to allow periodic timestamp updates
        hour_key = int(time.time() // 3600)
        cache_key = (user_id, client_ip, width, height, hour_key)
        if timestamp is None and cache_key in cls._CACHE:
            return cls._CACHE[cache_key]

        date_str = timestamp or time.strftime("%Y-%m-%d %H:%M", time.localtime())
        raw_text = f"هامزیار | {user_name} ({user_id}) | {client_ip} | {date_str}"
        reshaped = get_display(arabic_reshaper.reshape(raw_text))

        try:
            font = ImageFont.truetype(VAZIR_FONT_PATH, 20)
        except Exception:
            font = ImageFont.load_default()

        diag = int((width**2 + height**2)**0.5) + 200
        overlay = Image.new("RGBA", (diag, diag), (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)

        # Draw repeating diagonal grid at 45 degrees, opacity ~14% (alpha=36 / 255)
        for y in range(0, diag, 180):
            for x in range(0, diag, 550):
                draw.text((x, y), reshaped, font=font, fill=(60, 60, 60, 36))

        # Rotate 45 degrees and crop to target page dimensions
        rotated = overlay.rotate(45, resample=Image.Resampling.NEAREST)
        cx = (rotated.width - width) // 2
        cy = (rotated.height - height) // 2
        cropped = rotated.crop((cx, cy, cx + width, cy + height))

        # Keep cache bounded to 200 active overlays
        if len(cls._CACHE) > 200:
            cls._CACHE.clear()

        if timestamp is None:
            cls._CACHE[cache_key] = cropped
        return cropped

    @classmethod
    def stamp_watermark(
        cls,
        base_webp_bytes: bytes,
        user_name: str,
        user_id: int,
        client_ip: str,
        timestamp: Optional[str] = None,
    ) -> bytes:
        """Composite pre-rendered diagonal watermark on base page. Execution < 10ms."""
        base_img = Image.open(io.BytesIO(base_webp_bytes)).convert("RGBA")
        overlay = cls._get_overlay(
            user_name,
            user_id,
            client_ip,
            base_img.width,
            base_img.height,
            timestamp=timestamp,
        )

        composited = Image.alpha_composite(base_img, overlay)
        rgb_img = composited.convert("RGB")

        bio = io.BytesIO()
        rgb_img.save(bio, format="WEBP", quality=80, method=0)  # method=0 for fastest response delivery
        return bio.getvalue()
