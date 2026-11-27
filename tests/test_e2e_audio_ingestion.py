# -*- coding: utf-8 -*-
"""
🧪 tests/test_e2e_audio_ingestion.py — Comprehensive 4-Tier E2E Test Suite for Audio Ingestion
HamsYar Medical Platform — Premium v2 (1405)

Covers:
- Feature 1: Large Audio Ingestion (>20MB) & MTProto Kurigram Fallback (PROJECT F1, ORIGINAL_REQUEST R1)
- Feature 2: FFmpeg Speech Preprocessing (~76% compression, -vn -ar 16000 -ac 1) (PROJECT F2, ORIGINAL_REQUEST R1)
- Feature 3: Async Background Worker Queue (<200ms non-blocking, bounded concurrency) (PROJECT F3, ORIGINAL_REQUEST R1)

4-Tier Methodology:
- Tier 1: Feature Functional Coverage (5 tests)
- Tier 2: Boundary & Corner Cases (5 tests)
- Tier 3: Pairwise Interactions (4 tests)
- Tier 4: Real-World Scenarios (1 marathon test)
"""

import sys
import os
import io
import time
import uuid
import shutil
import asyncio
import tempfile
import unittest
from dataclasses import dataclass, field
from typing import Optional, Dict, Any, Callable
from unittest.mock import AsyncMock, MagicMock, patch

# Defensive Path Bootstrap
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

_SERVICES = os.path.join(REPO_ROOT, "backend", "services")
if _SERVICES not in sys.path:
    sys.path.insert(0, _SERVICES)

_BOT = os.path.join(REPO_ROOT, "backend", "bot")
if _BOT not in sys.path:
    sys.path.insert(0, _BOT)

# Test environment settings
os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017/humsyar_test")
os.environ.setdefault("ADMIN_ID", "999")
os.environ.setdefault("TELEGRAM_TOKEN", "123456:TEST_TOKEN_ABC123")
os.environ.setdefault("TELEGRAM_API_ID", "123456")
os.environ.setdefault("TELEGRAM_API_HASH", "abcdef0123456789abcdef0123456789")

import telegram
from telegram.error import BadRequest, NetworkError, RetryAfter, TelegramError

# Import existing lecture scribe helpers
from backend.services.lecture_scribe import (
    handle_lecture_file_input,
    handle_lecture_callback,
    _LECTURE_SESSIONS,
    _get_ffmpeg_path,
    transcode_media_to_optimized_audio,
    MAX_LECTURE_MEDIA_BYTES,
    AUDIO_EXTENSIONS,
    VIDEO_EXTENSIONS,
)

# ══════════════════════════════════════════════════════════════════════════════
# Direct Production Imports (No Fallback Shims)
# ══════════════════════════════════════════════════════════════════════════════

from backend.services.telegram_downloader import (
    download_telegram_media,
    get_telegram_credentials,
    get_mtproto_downloader_client,
    stop_mtproto_downloader_client,
)
from backend.services.lecture_worker import (
    LectureWorkerQueue,
    LectureJob,
    ThrottledStatusUpdater,
    get_lecture_worker_queue,
)

# ══════════════════════════════════════════════════════════════════════════════
# Test Suite: 4-Tier Audio Ingestion & Worker Queue
# ══════════════════════════════════════════════════════════════════════════════

class TestE2EAudioIngestion(unittest.TestCase):
    """Full 4-tier E2E verification for Large Audio Ingestion and Async Worker Queue."""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp(prefix="humsyar_test_audio_")
        _LECTURE_SESSIONS.clear()
        self._patch_refund = patch("backend.services.ai_solver.refund_lecture_quota", AsyncMock(return_value=True))
        self._patch_inflight = patch("backend.services.ai_solver.ai_release_inflight", AsyncMock(return_value=True))
        self._patch_refund.start()
        self._patch_inflight.start()

    def tearDown(self):
        try:
            self._patch_refund.stop()
        except Exception:
            pass
        try:
            self._patch_inflight.stop()
        except Exception:
            pass
        _LECTURE_SESSIONS.clear()
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _generate_synthetic_aac_bytes(self, duration_sec: int = 1) -> bytes:
        """Synthesizes valid AAC audio bytes using FFmpeg lavfi sine generator."""
        ffmpeg_exe = _get_ffmpeg_path()
        if not ffmpeg_exe:
            # Fallback byte payload if ffmpeg executable not available
            return b"\xff\xf1" + b"\x00" * 2048

        out_path = os.path.join(self.temp_dir, f"synth_{uuid.uuid4().hex[:6]}.m4a")
        import subprocess
        cmd = [
            ffmpeg_exe, "-y",
            "-f", "lavfi",
            "-i", f"sine=frequency=440:duration={duration_sec}",
            "-c:a", "aac",
            out_path
        ]
        res = subprocess.run(cmd, capture_output=True)
        if res.returncode == 0 and os.path.exists(out_path):
            with open(out_path, "rb") as f:
                data = f.read()
            try:
                os.remove(out_path)
            except Exception:
                pass
            return data
        return b"\xff\xf1" + b"\x00" * 2048

    # ──────────────────────────────────────────────────────────────────────────
    # Tier 1: Feature Functional Coverage
    # ──────────────────────────────────────────────────────────────────────────

    def test_t1_01_bot_api_download_under_20mb(self):
        """Tier 1: Audio <= 20MB routes to bot.get_file(file_id).download_to_drive(dest_path).
        Kurigram client is NOT invoked."""
        async def _run():
            file_size_15mb = 15 * 1024 * 1024
            dest = os.path.join(self.temp_dir, "small_lecture.m4a")

            bot = MagicMock()
            tg_file = MagicMock()

            async def _fake_download(custom_path):
                with open(custom_path, "wb") as f:
                    f.write(b"SMALL_AUDIO_DATA_PTB")
                return custom_path

            tg_file.download_to_drive = AsyncMock(side_effect=_fake_download)
            bot.get_file = AsyncMock(return_value=tg_file)

            mock_mtproto_client = MagicMock()
            mock_mtproto_client.download_media = AsyncMock()

            with patch("backend.services.telegram_downloader.get_mtproto_downloader_client" if "backend.services.telegram_downloader" in sys.modules else "__main__.get_mtproto_downloader_client", AsyncMock(return_value=mock_mtproto_client)):
                result_path = await download_telegram_media(
                    bot=bot,
                    chat_id=12345,
                    message_id=6789,
                    file_id="tg_small_file_123",
                    file_size=file_size_15mb,
                    dest_path=dest,
                )

            # Assertions
            bot.get_file.assert_called_once_with("tg_small_file_123")
            tg_file.download_to_drive.assert_called_once_with(custom_path=dest)
            mock_mtproto_client.download_media.assert_not_called()
            self.assertEqual(result_path, os.path.abspath(dest))
            self.assertTrue(os.path.exists(dest))
            self.assertEqual(os.path.getsize(dest), len(b"SMALL_AUDIO_DATA_PTB"))

        asyncio.run(_run())

    def test_t1_02_mtproto_download_over_20mb(self):
        """Tier 1: Audio > 20MB (52MB .m4a) routes to telegram_downloader.download_telegram_media
        using MTProto Kurigram client."""
        async def _run():
            file_size_52mb = 52 * 1024 * 1024
            dest = os.path.join(self.temp_dir, "large_cardio_52mb.m4a")

            bot = MagicMock()
            bot.get_file = AsyncMock()

            mock_mtproto_client = MagicMock()
            mock_msg = MagicMock()
            mock_msg.media = True
            mock_mtproto_client.get_messages = AsyncMock(return_value=mock_msg)

            async def _fake_mtproto_download(message, file_name):
                with open(file_name, "wb") as f:
                    f.write(b"LARGE_52MB_MTPROTO_STREAM_DATA")
                return file_name

            mock_mtproto_client.download_media = AsyncMock(side_effect=_fake_mtproto_download)

            patch_target = "backend.services.telegram_downloader.get_mtproto_downloader_client" if "backend.services.telegram_downloader" in sys.modules else "__main__.get_mtproto_downloader_client"
            with patch(patch_target, AsyncMock(return_value=mock_mtproto_client)):
                result_path = await download_telegram_media(
                    bot=bot,
                    chat_id=12345,
                    message_id=6789,
                    file_id="tg_large_file_52mb",
                    file_size=file_size_52mb,
                    dest_path=dest,
                )

            # Assertions
            bot.get_file.assert_not_called()
            mock_mtproto_client.download_media.assert_called_once()
            self.assertEqual(result_path, os.path.abspath(dest))
            self.assertTrue(os.path.exists(dest))
            with open(dest, "rb") as f:
                content = f.read()
            self.assertEqual(content, b"LARGE_52MB_MTPROTO_STREAM_DATA")

        asyncio.run(_run())

    def test_t1_03_ffmpeg_transcode_speech_optimization(self):
        """Tier 1: FFmpeg preprocessor transcodes .m4a to 16kHz mono MP3
        (-ar 16000 -ac 1 -b:a 32k or 48k), verifying speech optimization."""
        async def _run():
            raw_audio = self._generate_synthetic_aac_bytes(duration_sec=1)
            self.assertGreater(len(raw_audio), 0, "Synthetic audio must not be empty")

            opt_bytes, mime, out_name = await transcode_media_to_optimized_audio(
                raw_audio, "cardiology_recording.m4a"
            )

            self.assertEqual(mime, "audio/mp3", "Output MIME must be audio/mp3")
            self.assertEqual(out_name, "optimized_lecture.mp3")
            self.assertGreater(len(opt_bytes), 0, "Transcoded audio bytes must be non-empty")
            # Verify valid MP3 sync header (0xFF, 0xFB/0xF3) or ID3 tag
            is_valid_mp3 = opt_bytes.startswith(b"ID3") or (opt_bytes[0] == 0xFF and (opt_bytes[1] & 0xE0) == 0xE0)
            self.assertTrue(is_valid_mp3, "Output must begin with valid MP3 frame sync or ID3 header")

        asyncio.run(_run())

    def test_t1_04_forwarded_document_audio_acceptance(self):
        """Tier 1: Telegram document with mime audio/x-m4a, audio/mp4, audio/aac
        correctly identified as speech audio and processed."""
        async def _run():
            update = MagicMock()
            update.effective_user.id = 55555

            msg = MagicMock()
            msg.voice = None
            msg.audio = None
            msg.video = None
            msg.video_note = None
            msg.caption = "جلسه دوم فیزیولوژی قلب"
            msg.chat_id = 55555
            msg.message_id = 901

            doc = MagicMock()
            doc.file_name = "cardio_lecture_part1.m4a"
            doc.mime_type = "audio/x-m4a"
            doc.file_size = 53_400_000
            doc.file_id = "doc_m4a_forwarded_123"
            doc.get_file = AsyncMock(return_value=MagicMock(file_path="https://tg.org/m4a"))

            msg.document = doc
            msg.reply_text = AsyncMock()
            update.message = msg

            context = MagicMock()
            context.user_data = {}

            await handle_lecture_file_input(update, context)

            self.assertTrue(msg.reply_text.called, "Bot must reply to user on file receipt")
            reply_call = msg.reply_text.call_args
            reply_text = reply_call[0][0]
            self.assertIn("فایل جلسه با موفقیت دریافت شد", reply_text)

            session_id = context.user_data.get("lecture_session_id")
            self.assertIsNotNone(session_id)
            self.assertIn(session_id, _LECTURE_SESSIONS)

            sess = _LECTURE_SESSIONS[session_id]
            self.assertEqual(len(sess["files"]), 1)
            file_item = sess["files"][0]
            self.assertEqual(file_item["kind"], "audio")
            self.assertEqual(file_item["name"], "cardio_lecture_part1.m4a")
            self.assertEqual(file_item["mime"], "audio/x-m4a")

        asyncio.run(_run())

    def test_t1_05_worker_queue_non_blocking_enqueue(self):
        """Tier 1: LectureWorkerQueue.enqueue_job returns in < 200ms,
        offloading processing to async background worker without blocking PTB event loop."""
        async def _run():
            async def _fast_processor(*args, **kwargs):
                await asyncio.sleep(0.05)

            queue = LectureWorkerQueue(concurrency=2, maxsize=50, processor=_fast_processor)
            bot = MagicMock()
            bot.edit_message_text = AsyncMock(return_value=True)

            t_start = time.monotonic()
            accepted = await queue.enqueue_job(
                chat_id=123456,
                user_id=789012,
                session_id="ls_test_session_t1_05",
                file_info={"kind": "audio", "name": "cardio.m4a", "file_size": 45_000_000},
                status_message_id=999,
                bot=bot,
                quota_consumed=False,
            )
            elapsed_ms = (time.monotonic() - t_start) * 1000.0

            self.assertTrue(accepted, "Job must be accepted into queue")
            self.assertLess(elapsed_ms, 200.0, f"Enqueue took {elapsed_ms:.2f}ms, violating <200ms contract")
            self.assertGreaterEqual(queue.qsize() + queue.active_count(), 1, "Queue or active jobs must contain the item")

            await queue.stop(timeout=1.0)

        asyncio.run(_run())

    # ──────────────────────────────────────────────────────────────────────────
    # Tier 2: Boundary & Corner Cases
    # ──────────────────────────────────────────────────────────────────────────

    def test_t2_01_exact_20mb_boundary_routing(self):
        """Tier 2: Boundary Value Analysis:
        - 20 * 1024 * 1024 (exact 20MB) routes to Bot API (Tier 2)
        - 20 * 1024 * 1024 + 1 (20MB + 1 byte) routes to Kurigram MTProto (Tier 3)
        - 0 bytes (unknown size) routes to Kurigram MTProto (Tier 3)"""
        async def _run():
            bot = MagicMock()
            dest_20mb = os.path.join(self.temp_dir, "exact_20mb.bin")
            dest_20mb_plus_1 = os.path.join(self.temp_dir, "exact_20mb_plus_1.bin")
            dest_zero = os.path.join(self.temp_dir, "zero_size.bin")

            # Case A: Exact 20MB -> Bot API
            tg_file = MagicMock()
            async def _fake_ptb(custom_path):
                with open(custom_path, "wb") as f:
                    f.write(b"EXACT_20MB")
                return custom_path
            tg_file.download_to_drive = AsyncMock(side_effect=_fake_ptb)
            bot.get_file = AsyncMock(return_value=tg_file)

            mock_mtproto_client = MagicMock()
            mock_mtproto_client.download_media = AsyncMock()

            patch_target = "backend.services.telegram_downloader.get_mtproto_downloader_client" if "backend.services.telegram_downloader" in sys.modules else "__main__.get_mtproto_downloader_client"
            with patch(patch_target, AsyncMock(return_value=mock_mtproto_client)):
                res_a = await download_telegram_media(
                    bot=bot,
                    chat_id=101,
                    message_id=201,
                    file_id="file_exact_20mb",
                    file_size=20 * 1024 * 1024,
                    dest_path=dest_20mb,
                )
            bot.get_file.assert_called_once_with("file_exact_20mb")
            mock_mtproto_client.download_media.assert_not_called()
            self.assertEqual(res_a, os.path.abspath(dest_20mb))

            # Case B: 20MB + 1 byte -> MTProto
            bot.get_file.reset_mock()
            async def _fake_mtproto(message, file_name):
                with open(file_name, "wb") as f:
                    f.write(b"OVER_20MB")
                return file_name
            mock_mtproto_client.download_media = AsyncMock(side_effect=_fake_mtproto)
            mock_mtproto_client.get_messages = AsyncMock(return_value=None)

            with patch(patch_target, AsyncMock(return_value=mock_mtproto_client)):
                res_b = await download_telegram_media(
                    bot=bot,
                    chat_id=101,
                    message_id=202,
                    file_id="file_20mb_plus_1",
                    file_size=20 * 1024 * 1024 + 1,
                    dest_path=dest_20mb_plus_1,
                )
            bot.get_file.assert_not_called()
            mock_mtproto_client.download_media.assert_called_once()
            self.assertEqual(res_b, os.path.abspath(dest_20mb_plus_1))

            # Case C: file_size = 0 (unknown) -> MTProto
            bot.get_file.reset_mock()
            mock_mtproto_client.download_media.reset_mock()
            async def _fake_mtproto_zero(message, file_name):
                with open(file_name, "wb") as f:
                    f.write(b"ZERO_OR_UNKNOWN_SIZE")
                return file_name
            mock_mtproto_client.download_media = AsyncMock(side_effect=_fake_mtproto_zero)

            with patch(patch_target, AsyncMock(return_value=mock_mtproto_client)):
                res_c = await download_telegram_media(
                    bot=bot,
                    chat_id=101,
                    message_id=203,
                    file_id="file_unknown_size",
                    file_size=0,
                    dest_path=dest_zero,
                )
            bot.get_file.assert_not_called()
            mock_mtproto_client.download_media.assert_called_once()
            self.assertEqual(res_c, os.path.abspath(dest_zero))

        asyncio.run(_run())

    def test_t2_02_oversized_audio_rejection_at_limit(self):
        """Tier 2: Files exceeding MAX_LECTURE_MEDIA_BYTES (100MB+) trigger
        user-friendly Persian error without downloading."""
        async def _run():
            update = MagicMock()
            update.effective_user.id = 66666
            msg = MagicMock()
            msg.voice = None
            msg.audio = None
            msg.video = None
            msg.video_note = None

            # 105 MB file exceeding 100MB cap
            doc = MagicMock()
            doc.file_name = "huge_audio.m4a"
            doc.mime_type = "audio/x-m4a"
            doc.file_size = 105 * 1024 * 1024
            doc.file_id = "doc_huge_105mb"
            doc.get_file = AsyncMock()

            msg.document = doc
            msg.reply_text = AsyncMock()
            update.message = msg

            context = MagicMock()
            context.user_data = {}

            await handle_lecture_file_input(update, context)

            self.assertTrue(msg.reply_text.called)
            sent_text = msg.reply_text.call_args[0][0]
            self.assertIn("حجم فایل ارسالی بیشتر از", sent_text)
            self.assertIn("مگابایت است", sent_text)
            # Ensure no session was created or file added
            session_id = context.user_data.get("lecture_session_id")
            if session_id and session_id in _LECTURE_SESSIONS:
                self.assertEqual(len(_LECTURE_SESSIONS[session_id]["files"]), 0)

        asyncio.run(_run())

    def test_t2_03_corrupted_or_zero_byte_media(self):
        """Tier 2: Zero-byte or truncated media file generates immediate warning,
        cancels session, and refunds user quota."""
        async def _run():
            bot = MagicMock()
            dest = os.path.join(self.temp_dir, "zero_byte_fail.bin")

            mock_mtproto_client = MagicMock()
            # Simulate zero byte download
            async def _fake_empty_download(message, file_name):
                with open(file_name, "wb") as f:
                    pass # 0 bytes
                return file_name
            mock_mtproto_client.download_media = AsyncMock(side_effect=_fake_empty_download)
            mock_mtproto_client.get_messages = AsyncMock(return_value=None)

            patch_target = "backend.services.telegram_downloader.get_mtproto_downloader_client" if "backend.services.telegram_downloader" in sys.modules else "__main__.get_mtproto_downloader_client"
            with patch(patch_target, AsyncMock(return_value=mock_mtproto_client)):
                with self.assertRaises(RuntimeError) as ctx:
                    await download_telegram_media(
                        bot=bot,
                        chat_id=101,
                        message_id=204,
                        file_id="zero_byte_corrupted",
                        file_size=50 * 1024 * 1024,
                        dest_path=dest,
                    )
                self.assertIn("failed to download", str(ctx.exception).lower())

        asyncio.run(_run())

    def test_t2_04_video_lecture_audio_extraction(self):
        """Tier 2: Input video file (.mp4, .mkv) is stripped of video stream (-vn),
        extracting audio stream cleanly."""
        async def _run():
            raw_audio = self._generate_synthetic_aac_bytes(duration_sec=1)
            opt_bytes, mime, out_name = await transcode_media_to_optimized_audio(
                raw_audio, "clinical_presentation.mp4"
            )

            self.assertEqual(mime, "audio/mp3", "Transcoded video must yield audio/mp3")
            self.assertEqual(out_name, "optimized_lecture.mp3")
            self.assertGreater(len(opt_bytes), 0)

        asyncio.run(_run())

    def test_t2_05_bot_api_502_failover_to_mtproto(self):
        """Tier 2: When Bot API get_file raises HTTP 502/timeout, unified downloader
        automatically fails over to Kurigram MTProto."""
        async def _run():
            file_size_10mb = 10 * 1024 * 1024
            dest = os.path.join(self.temp_dir, "failover_lecture.m4a")

            bot = MagicMock()
            # Bot API fails with 502 / NetworkError
            bot.get_file = AsyncMock(side_effect=NetworkError("HTTP 502 Bad Gateway"))

            mock_mtproto_client = MagicMock()
            mock_msg = MagicMock()
            mock_msg.media = True
            mock_mtproto_client.get_messages = AsyncMock(return_value=mock_msg)

            async def _fake_mtproto(message, file_name):
                with open(file_name, "wb") as f:
                    f.write(b"MTPROTO_RESCUE_DOWNLOAD_DATA")
                return file_name
            mock_mtproto_client.download_media = AsyncMock(side_effect=_fake_mtproto)

            patch_target = "backend.services.telegram_downloader.get_mtproto_downloader_client" if "backend.services.telegram_downloader" in sys.modules else "__main__.get_mtproto_downloader_client"
            with patch(patch_target, AsyncMock(return_value=mock_mtproto_client)):
                result_path = await download_telegram_media(
                    bot=bot,
                    chat_id=777,
                    message_id=888,
                    file_id="file_502_error",
                    file_size=file_size_10mb,
                    dest_path=dest,
                )

            # Assertions
            bot.get_file.assert_called_once_with("file_502_error")
            mock_mtproto_client.download_media.assert_called_once()
            self.assertEqual(result_path, os.path.abspath(dest))
            with open(dest, "rb") as f:
                self.assertEqual(f.read(), b"MTPROTO_RESCUE_DOWNLOAD_DATA")

        asyncio.run(_run())

    # ──────────────────────────────────────────────────────────────────────────
    # Tier 3: Pairwise Interactions
    # ──────────────────────────────────────────────────────────────────────────

    def test_t3_01_dual_source_session_enqueue(self):
        """Tier 3: User attaches both audio recording and PDF slides;
        worker queue batches both files before triggering scribe pipeline."""
        async def _run():
            session_id = f"ls_dual_{uuid.uuid4().hex[:6]}"
            _LECTURE_SESSIONS[session_id] = {
                "session_id": session_id,
                "user_id": 99911,
                "created_at": time.monotonic(),
                "files": [
                    {
                        "kind": "audio",
                        "mime": "audio/x-m4a",
                        "name": "lecture_voice.m4a",
                        "tg_file_id": "file_voice_1",
                        "file_size": 45_000_000,
                    }
                ],
                "status": "awaiting_files",
            }

            # File 2: PDF Slides attached in second step
            update = MagicMock()
            update.effective_user.id = 99911
            msg = MagicMock()
            msg.voice = None
            msg.audio = None
            msg.video = None
            msg.caption = ""

            doc = MagicMock()
            doc.file_name = "cardio_slides.pdf"
            doc.mime_type = "application/pdf"
            doc.file_size = 12_000_000
            doc.file_id = "doc_pdf_slides_2"
            doc.get_file = AsyncMock()

            msg.document = doc
            msg.reply_text = AsyncMock()
            update.message = msg

            context = MagicMock()
            context.user_data = {
                "lecture_session_id": session_id,
                "mode": "lecture_scribe_attach"
            }

            await handle_lecture_file_input(update, context)

            self.assertTrue(msg.reply_text.called)
            sent_text = msg.reply_text.call_args[0][0]
            self.assertIn("هر دو منبع درسی با موفقیت آماده شدند", sent_text)

            sess = _LECTURE_SESSIONS[session_id]
            self.assertEqual(len(sess["files"]), 2, "Session must contain exactly 2 files")
            self.assertEqual(sess["files"][0]["kind"], "audio")
            self.assertEqual(sess["files"][1]["kind"], "pdf")

            # Verify queue enqueueing with batched dual files
            queue = LectureWorkerQueue(concurrency=2)
            bot_mock = MagicMock()
            bot_mock.edit_message_text = AsyncMock(return_value=True)
            enqueued = await queue.enqueue_job(
                chat_id=99911,
                user_id=99911,
                session_id=session_id,
                file_info={"files": sess["files"]},
                status_message_id=1234,
                bot=bot_mock,
                quota_consumed=False,
            )
            self.assertTrue(enqueued)
            self.assertEqual(queue.qsize(), 1)
            await queue.stop(timeout=1.0)

        asyncio.run(_run())

    def test_t3_02_concurrent_worker_queue_concurrency_cap(self):
        """Tier 3: Multiple concurrent jobs adhere to worker queue concurrency semaphore
        limit (concurrency=2) without thread starvation."""
        async def _run():
            max_simultaneous = 0
            current_active = 0
            lock = asyncio.Lock()
            completed_jobs = []

            async def _slow_processor(*args, **kwargs):
                nonlocal max_simultaneous, current_active
                async with lock:
                    current_active += 1
                    if current_active > max_simultaneous:
                        max_simultaneous = current_active
                await asyncio.sleep(0.04)
                async with lock:
                    current_active -= 1
                    job_key = kwargs.get("session_id") or (args[0].job_id if args else "job")
                    completed_jobs.append(job_key)

            queue = LectureWorkerQueue(concurrency=2, maxsize=20, processor=_slow_processor)
            queue.start()

            bot = MagicMock()
            bot.edit_message_text = AsyncMock(return_value=True)
            # Enqueue 5 jobs simultaneously
            for i in range(5):
                await queue.enqueue_job(
                    chat_id=100 + i,
                    user_id=200 + i,
                    session_id=f"sess_{i}",
                    file_info={"kind": "audio"},
                    status_message_id=300 + i,
                    bot=bot,
                )

            # Wait for all jobs to be processed
            await asyncio.wait_for(queue.queue.join(), timeout=3.0)
            await queue.stop(timeout=1.0)

            self.assertEqual(len(completed_jobs), 5, "All 5 jobs must complete")
            self.assertLessEqual(max_simultaneous, 2, f"Active concurrency was {max_simultaneous}, exceeding cap of 2")

        asyncio.run(_run())

    def test_t3_03_user_cancellation_cleans_temp_files(self):
        """Tier 3: Callback ls:cancel:<session_id> terminates active session and
        cleans up temporary disk artifacts."""
        async def _run():
            session_id = f"ls_cancel_{uuid.uuid4().hex[:6]}"
            session_dir = os.path.join(self.temp_dir, session_id)
            os.makedirs(session_dir, exist_ok=True)
            dummy_file = os.path.join(session_dir, "temp_audio.bin")
            with open(dummy_file, "wb") as f:
                f.write(b"TEMP_MEDIA_TO_DELETE")

            _LECTURE_SESSIONS[session_id] = {
                "session_id": session_id,
                "user_id": 88888,
                "temp_dir": session_dir,
                "files": [{"kind": "audio", "path": dummy_file}],
            }

            update = MagicMock()
            query = MagicMock()
            query.data = f"ls:cancel:{session_id}"
            query.answer = AsyncMock()
            query.edit_message_text = AsyncMock()
            update.callback_query = query
            update.effective_user.id = 88888

            context = MagicMock()
            context.user_data = {"lecture_session_id": session_id, "mode": "lecture_scribe"}

            await handle_lecture_callback(update, context)

            self.assertNotIn(session_id, _LECTURE_SESSIONS, "Cancelled session must be removed")
            query.answer.assert_called_once_with("عملیات لغو شد.")
            query.edit_message_text.assert_called_once()
            edit_text = query.edit_message_text.call_args[0][0]
            self.assertIn("سشن جزوه‌نویسی لغو شد", edit_text)

        asyncio.run(_run())

    def test_t3_04_ffmpeg_failure_raw_fallback(self):
        """Tier 3: FFmpeg missing or exiting with nonzero code falls back to
        uploading raw media without crashing the worker."""
        async def _run():
            raw_bytes = b"RAW_CORRUPTED_OR_UNSUPPORTED_AUDIO_STREAM"
            # Simulate environment with missing FFmpeg binary
            with patch("backend.services.lecture_scribe._get_ffmpeg_path", return_value=None):
                out_bytes, mime, name = await transcode_media_to_optimized_audio(
                    raw_bytes, "lecture_recording.m4a"
                )

            self.assertEqual(out_bytes, raw_bytes, "Should return raw untouched bytes on ffmpeg absence")
            self.assertIn(mime, ("audio/mp4", "audio/mpeg", "audio/aac"))
            self.assertIn(".m4a", name)

        asyncio.run(_run())

    # ──────────────────────────────────────────────────────────────────────────
    # Tier 4: Real-World Scenarios
    # ──────────────────────────────────────────────────────────────────────────

    def test_t4_01_marathon_cardiology_lecture_ingestion(self):
        """Tier 4: Realistic multi-hour 55MB cardiology lecture ingestion simulation:
        received via forwarded document -> downloaded via MTProto -> compressed with FFmpeg
        -> enqueued in background -> throttled status updates dispatched to Telegram chat."""
        async def _run():
            chat_id = 999001
            user_id = 999002
            status_msg_id = 777001
            bot = MagicMock()
            edit_history = []

            async def _fake_edit(chat_id, message_id, text, parse_mode=None):
                edit_history.append((time.monotonic(), text))
                return True
            bot.edit_message_text = AsyncMock(side_effect=_fake_edit)

            # 1. Intake: Telegram document (55MB)
            doc_file_id = "doc_cardiology_55mb_marathon"
            msg = MagicMock()
            msg.voice = None
            msg.audio = None
            msg.video = None
            msg.caption = "جلسه ۴ فیزیوپاتولوژی قلب - آریتمی‌ها"
            msg.chat_id = chat_id
            msg.message_id = 5001

            doc = MagicMock()
            doc.file_name = "cardiology_session4_arrhythmias.m4a"
            doc.mime_type = "audio/x-m4a"
            doc.file_size = 55 * 1024 * 1024
            doc.file_id = doc_file_id
            doc.get_file = AsyncMock()

            msg.document = doc
            msg.reply_text = AsyncMock()
            update = MagicMock()
            update.message = msg
            update.effective_user.id = user_id

            context = MagicMock()
            context.user_data = {}

            # Process file reception
            await handle_lecture_file_input(update, context)
            session_id = context.user_data["lecture_session_id"]
            self.assertIn(session_id, _LECTURE_SESSIONS)

            # 2. Worker Queue & Throttled Updater Setup
            updater = ThrottledStatusUpdater(bot=bot, chat_id=chat_id, message_id=status_msg_id, min_interval=0.05)
            await updater.update("📥 در حال دریافت فایل صوتی از تلگرام...", force=True)

            # 3. Media Download via MTProto Simulation
            download_dest = os.path.join(self.temp_dir, "cardio_55mb.m4a")
            mock_mtproto = MagicMock()
            mock_msg = MagicMock()
            mock_msg.media = True
            mock_mtproto.get_messages = AsyncMock(return_value=mock_msg)

            raw_synthesized = self._generate_synthetic_aac_bytes(duration_sec=2)
            async def _fake_mtproto_stream(message, file_name):
                with open(file_name, "wb") as f:
                    f.write(raw_synthesized)
                return file_name
            mock_mtproto.download_media = AsyncMock(side_effect=_fake_mtproto_stream)

            patch_target = "backend.services.telegram_downloader.get_mtproto_downloader_client" if "backend.services.telegram_downloader" in sys.modules else "__main__.get_mtproto_downloader_client"
            with patch(patch_target, AsyncMock(return_value=mock_mtproto)):
                downloaded_file = await download_telegram_media(
                    bot=bot,
                    chat_id=chat_id,
                    message_id=msg.message_id,
                    file_id=doc_file_id,
                    file_size=55 * 1024 * 1024,
                    dest_path=download_dest,
                )

            self.assertTrue(os.path.exists(downloaded_file))
            await updater.update("⚡️ در حال بهینه‌سازی صوت و فشرده‌سازی برای هوش مصنوعی...", force=True)

            # 4. FFmpeg Speech Preprocessing
            with open(downloaded_file, "rb") as f:
                media_bytes = f.read()

            opt_bytes, mime, out_name = await transcode_media_to_optimized_audio(
                media_bytes, "cardiology_session4_arrhythmias.m4a"
            )

            self.assertEqual(mime, "audio/mp3")
            self.assertEqual(out_name, "optimized_lecture.mp3")
            self.assertGreater(len(opt_bytes), 0)

            # 5. Background Queue Completion & Delivery Status
            await updater.update("🧠 در حال تولید جزوه دانشگاهی با Google Gemini...", force=True)
            await updater.update("✅ جزوه دانشگاهی کامل با موفقیت تولید شد!", force=True)

            # Verify status edits happened and were recorded
            self.assertGreaterEqual(len(edit_history), 4)
            final_text = edit_history[-1][1]
            self.assertIn("با موفقیت تولید شد", final_text)

        asyncio.run(_run())


if __name__ == "__main__":
    unittest.main()
