# -*- coding: utf-8 -*-
"""🎬 تستهای پخش ویدیو/ویس بزرگ (>۲۰MB) از MTProto با پشتیبانی Range."""
import asyncio
import os
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

from backend.services import media_stream as ms


def _run(coro):
    return asyncio.run(coro)


class _FakeClient:
    """شبیهساز stream_media: فایل را chunkهای ۱MB میدهد."""

    def __init__(self, data: bytes):
        self.data = data
        self.calls = []

    async def stream_media(self, file_id, limit=0, offset=0):
        self.calls.append((file_id, limit, offset))
        n = ms.MTPROTO_CHUNK
        i = offset
        sent = 0
        while i * n < len(self.data) and (limit == 0 or sent < limit):
            yield self.data[i * n:(i + 1) * n]
            i += 1
            sent += 1


async def _collect(resp) -> bytes:
    out = b""
    async for part in resp.body_iterator:
        out += part
    return out


class TestRangeParsing(unittest.TestCase):
    def test_open_ended(self):
        self.assertEqual(ms.parse_range("bytes=0-", 100), (0, 99))
        self.assertEqual(ms.parse_range("bytes=40-", 100), (40, 99))

    def test_closed_and_clamped(self):
        self.assertEqual(ms.parse_range("bytes=10-19", 100), (10, 19))
        self.assertEqual(ms.parse_range("bytes=90-500", 100), (90, 99))

    def test_suffix(self):
        self.assertEqual(ms.parse_range("bytes=-10", 100), (90, 99))
        self.assertEqual(ms.parse_range("bytes=-500", 100), (0, 99))

    def test_absent_or_garbage_means_full(self):
        self.assertIsNone(ms.parse_range(None, 100))
        self.assertIsNone(ms.parse_range("items=0-1", 100))
        self.assertIsNone(ms.parse_range("bytes=abc", 100))

    def test_unsatisfiable(self):
        with self.assertRaises(ms.RangeNotSatisfiable):
            ms.parse_range("bytes=100-", 100)
        with self.assertRaises(ms.RangeNotSatisfiable):
            ms.parse_range("bytes=50-10", 100)

    def test_continuation_range(self):
        self.assertFalse(ms.is_continuation_range(None))
        self.assertFalse(ms.is_continuation_range("bytes=0-"))
        self.assertFalse(ms.is_continuation_range("bytes=-500"))
        self.assertTrue(ms.is_continuation_range("bytes=1048576-"))


class TestMime(unittest.TestCase):
    def test_m4a_is_audio_mp4_for_safari(self):
        self.assertEqual(ms.canonical_media_mime("audio/x-m4a"), "audio/mp4")
        self.assertEqual(ms.canonical_media_mime("application/octet-stream", "جلسه.m4a"), "audio/mp4")
        self.assertEqual(ms.canonical_media_mime("", ext=".M4A"), "audio/mp4")

    def test_video_and_passthrough(self):
        self.assertEqual(ms.canonical_media_mime("", "lecture.mp4"), "video/mp4")
        self.assertEqual(ms.canonical_media_mime("video/mp4"), "video/mp4")
        self.assertEqual(ms.canonical_media_mime("audio/mpeg; charset=x"), "audio/mpeg")
        self.assertEqual(ms.canonical_media_mime(""), "application/octet-stream")


class TestMtprotoStreaming(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.env = patch.dict(os.environ, {"MEDIA_CACHE_DIR": self.tmp.name,
                                           "TELEGRAM_TOKEN": "1:x"})
        self.env.start()
        self.addCleanup(self.env.stop)
        # فایل ۲.۵MB تا مرز chunkها تست شود
        self.data = bytes(range(256)) * (10 * 1024)
        self.client = _FakeClient(self.data)
        p = patch.object(ms, "_get_client", AsyncMock(return_value=self.client))
        p.start()
        self.addCleanup(p.stop)

    def _resp(self, rng):
        async def go():
            with patch.object(ms, "ensure_cached"):
                r = await ms.mtproto_response("FID", "video/mp4", "a.mp4", rng, len(self.data))
                body = await _collect(r) if hasattr(r, "body_iterator") else r.body
                return r, body
        return _run(go())

    def test_range_across_chunk_boundary_is_exact(self):
        start, end = ms.MTPROTO_CHUNK - 10, ms.MTPROTO_CHUNK + 9
        r, body = self._resp(f"bytes={start}-{end}")
        self.assertEqual(r.status_code, 206)
        self.assertEqual(body, self.data[start:end + 1])
        self.assertEqual(r.headers["content-range"], f"bytes {start}-{end}/{len(self.data)}")
        self.assertEqual(r.headers["content-length"], "20")
        self.assertEqual(r.headers["accept-ranges"], "bytes")
        # فقط chunkهای لازم خواسته شوند (offset=0, دو chunk)
        self.assertEqual(self.client.calls[-1], ("FID", 2, 0))

    def test_open_range_from_middle(self):
        start = 2 * ms.MTPROTO_CHUNK + 5
        r, body = self._resp(f"bytes={start}-")
        self.assertEqual(r.status_code, 206)
        self.assertEqual(body, self.data[start:])
        self.assertEqual(self.client.calls[-1][2], 2)

    def test_no_range_is_full_200(self):
        r, body = self._resp(None)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(body, self.data)
        self.assertEqual(r.headers["content-length"], str(len(self.data)))

    def test_unsatisfiable_is_416(self):
        r, _ = self._resp(f"bytes={len(self.data)}-")
        self.assertEqual(r.status_code, 416)
        self.assertEqual(r.headers["content-range"], f"bytes */{len(self.data)}")

    def test_full_download_to_cache_then_hit(self):
        path = _run(ms._download_full("FID"))
        self.assertEqual(open(path, "rb").read(), self.data)
        self.assertEqual(ms.cached_file("FID"), path)
        self.assertIsNone(ms.cached_file("OTHER"))
        self.assertEqual(_run(ms.download_bytes("FID")), self.data)

    def test_eviction_keeps_under_limit(self):
        with patch.dict(os.environ, {"MEDIA_CACHE_MAX_GB": str(3 / 1024 ** 3)}):
            for name in ("a", "b", "c"):
                with open(ms.cache_path(name), "wb") as fh:
                    fh.write(b"xx")
            ms._evict(keep=ms.cache_path("c"))
            left = [f for f in os.listdir(self.tmp.name) if f.endswith(".bin")]
            self.assertEqual(left, [os.path.basename(ms.cache_path("c"))])


class TestProxyRouting(unittest.TestCase):
    """proxy_telegram_preview: کش ⇒ دیسک، >۲۰MB ⇒ MTProto، getFile شکستخورده ⇒ MTProto."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.env = patch.dict(os.environ, {"MEDIA_CACHE_DIR": self.tmp.name,
                                           "TELEGRAM_TOKEN": "1:x"})
        self.env.start()
        self.addCleanup(self.env.stop)
        from api import telegram_send
        self.ts = telegram_send

    def test_large_file_goes_to_mtproto_with_canonical_mime(self):
        mt = AsyncMock(return_value="MT")
        with patch.object(ms, "mtproto_response", mt), \
             patch.object(self.ts, "telegram_file_url", AsyncMock()) as cloud:
            out = _run(self.ts.proxy_telegram_preview(
                "BIG", "audio/x-m4a", "voice.m4a", "bytes=0-",
                size=53 * 1024 * 1024, ext="m4a"))
        self.assertEqual(out, "MT")
        cloud.assert_not_called()
        self.assertEqual(mt.call_args.args[:5],
                         ("BIG", "audio/mp4", "voice.m4a", "bytes=0-", 53 * 1024 * 1024))

    def test_cloud_failure_falls_back_to_mtproto(self):
        mt = AsyncMock(return_value="MT")
        with patch.object(ms, "mtproto_response", mt), \
             patch.object(self.ts, "telegram_file_url", AsyncMock(return_value=None)):
            out = _run(self.ts.proxy_telegram_preview("X", "video/mp4", "v.mp4", None, size=0))
        self.assertEqual(out, "MT")

    def test_cache_hit_serves_from_disk_with_range(self):
        with open(ms.cache_path("C"), "wb") as fh:
            fh.write(b"0123456789")
        r = _run(self.ts.proxy_telegram_preview("C", "", "x.mp4", "bytes=2-5", size=10))
        self.assertEqual(type(r).__name__, "FileResponse")
        self.assertEqual(r.media_type, "video/mp4")

    def test_preview_ttl_is_long_enough_for_lectures(self):
        self.assertGreaterEqual(self.ts.PREVIEW_TTL_SEC, 3 * 3600)


if __name__ == "__main__":
    unittest.main()
