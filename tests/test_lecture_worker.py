# -*- coding: utf-8 -*-
"""
🧪 tests/test_lecture_worker.py — Unit Tests for LectureWorkerQueue & ThrottledStatusUpdater
HamsYar Medical Platform — Milestone 1 (M1)
"""

import asyncio
import os
import sys
import time
from unittest.mock import AsyncMock, MagicMock, patch

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017/humsyar_test")
os.environ.setdefault("ADMIN_ID", "999")
os.environ.setdefault("TELEGRAM_TOKEN", "123:TEST_TOKEN")

import pytest
from telegram.error import BadRequest, RetryAfter

from backend.services.lecture_worker import (
    LectureWorkerQueue,
    ThrottledStatusUpdater,
    LectureJob,
    get_lecture_worker_queue,
)


def test_enqueue_job_latency_and_position():
    """Enqueue must return immediately (<200ms) and track FIFO position."""
    async def _run():
        mock_bot = MagicMock()
        mock_bot.edit_message_text = AsyncMock()

        queue = LectureWorkerQueue(concurrency=2, maxsize=20)
        t0 = time.monotonic()
        for i in range(5):
            ok = await queue.enqueue_job(
                chat_id=100 + i,
                user_id=200 + i,
                session_id=f"sess_{i}",
                file_info={"kind": "audio"},
                status_message_id=300 + i,
                bot=mock_bot,
                auto_start=False,
            )
            assert ok is True
        elapsed_ms = (time.monotonic() - t0) * 1000.0

        # 5 enqueues must finish in <50ms
        assert elapsed_ms < 50.0, f"Enqueue took {elapsed_ms}ms (expected <50ms)"
        assert queue.qsize() == 5

    asyncio.run(_run())


def test_queue_full_rejection():
    """When queue reaches maxsize, enqueue_job returns False."""
    async def _run():
        mock_bot = MagicMock()
        queue = LectureWorkerQueue(concurrency=1, maxsize=2)

        assert await queue.enqueue_job(1, 10, "s1", {}, 101, mock_bot, auto_start=False) is True
        assert await queue.enqueue_job(2, 20, "s2", {}, 102, mock_bot, auto_start=False) is True
        # 3rd job exceeds maxsize=2
        assert await queue.enqueue_job(3, 30, "s3", {}, 103, mock_bot, auto_start=False) is False

    asyncio.run(_run())


def test_bounded_concurrency_semaphore():
    """At most `concurrency` (2) tasks run simultaneously."""
    async def _run():
        max_active = 0
        current_active = 0
        lock = asyncio.Lock()

        async def fake_processor(bot, chat_id, uid, session_id, file_info, status_msg_id, status_updater):
            nonlocal current_active, max_active
            async with lock:
                current_active += 1
                if current_active > max_active:
                    max_active = current_active
            await asyncio.sleep(0.05)
            async with lock:
                current_active -= 1

        queue = LectureWorkerQueue(concurrency=2, maxsize=10, processor=fake_processor)
        queue.start()

        mock_bot = MagicMock()
        for i in range(5):
            await queue.enqueue_job(
                chat_id=100 + i,
                user_id=200 + i,
                session_id=f"concurrent_sess_{i}",
                file_info={},
                status_message_id=500 + i,
                bot=mock_bot,
            )

        # Wait for queue to process
        await queue.queue.join()
        await queue.stop(timeout=1.0)

        # Peak active tasks must be <= 2
        assert max_active == 2, f"Expected peak active concurrency of 2, got {max_active}"

    asyncio.run(_run())


def test_throttled_status_updater_timing_and_skips():
    """Status updater enforces interval gap for unforced edits and skips identical text."""
    async def _run():
        mock_bot = MagicMock()
        mock_bot.edit_message_text = AsyncMock()

        updater = ThrottledStatusUpdater(
            bot=mock_bot,
            chat_id=1234,
            message_id=5678,
            min_interval=0.25,
        )

        # 1. First edit succeeds immediately
        res1 = await updater.update("مرحله اول: دانلود فایل", force=False)
        assert res1 is True
        assert mock_bot.edit_message_text.call_count == 1

        # 2. Duplicate text returns True immediately without network call
        res_dup = await updater.update("مرحله اول: دانلود فایل", force=False)
        assert res_dup is True
        assert mock_bot.edit_message_text.call_count == 1

        # 3. Intermediate edit within interval is skipped (returns False)
        res2 = await updater.update("مرحله دوم: پردازش مقدماتی", force=False)
        assert res2 is False
        assert mock_bot.edit_message_text.call_count == 1

        # 4. Forced edit satisfies min_interval by waiting
        t0 = time.monotonic()
        res3 = await updater.update("مرحله نهایی: تولید PDF", force=True)
        elapsed = time.monotonic() - t0
        assert res3 is True
        assert mock_bot.edit_message_text.call_count == 2
        assert elapsed >= 0.2, f"Expected delay for force=True, elapsed={elapsed}"

    asyncio.run(_run())


def test_throttled_status_updater_error_resilience():
    """Handles BadRequest ('Message is not modified') and RetryAfter gracefully."""
    async def _run():
        mock_bot = MagicMock()
        mock_bot.edit_message_text = AsyncMock(side_effect=[
            BadRequest("Message is not modified: specified new message content and reply markup are exactly the same"),
            RetryAfter(0.05),
            None,  # Success after retry
        ])

        updater = ThrottledStatusUpdater(bot=mock_bot, chat_id=1, message_id=2, min_interval=0.01)

        # 1. Message not modified handled cleanly
        ok1 = await updater.update("متن تکراری")
        assert ok1 is True

        # 2. RetryAfter handled with retry
        ok2 = await updater.update("متن جدید")
        assert ok2 is True
        assert mock_bot.edit_message_text.call_count == 3

    asyncio.run(_run())


def test_atomic_error_recovery_on_job_failure():
    """Failed job triggers quota refund, in-flight release, and Persian user feedback."""
    async def _run():
        async def failing_processor(bot, chat_id, uid, session_id, file_info, status_msg_id, status_updater):
            raise RuntimeError("Google Gemini API simulated failure")

        queue = LectureWorkerQueue(concurrency=1, maxsize=5, processor=failing_processor)
        queue.start()

        mock_bot = MagicMock()
        mock_bot.edit_message_text = AsyncMock()

        with patch("backend.services.ai_solver.refund_lecture_quota", new_callable=AsyncMock) as mock_refund, \
             patch("backend.services.ai_solver.ai_release_inflight", new_callable=AsyncMock) as mock_release:

            await queue.enqueue_job(
                chat_id=9999,
                user_id=7777,
                session_id="fail_session",
                file_info={"kind": "audio"},
                status_message_id=8888,
                bot=mock_bot,
                quota_consumed=True,
            )

            await queue.queue.join()
            await queue.stop(timeout=1.0)

            mock_refund.assert_called_once_with(7777)
            mock_release.assert_called_once_with(7777)

            assert mock_bot.edit_message_text.called
            last_edit = mock_bot.edit_message_text.call_args[1]["text"]
            assert "سهمیهٔ شما محفوظ ماند" in last_edit

    asyncio.run(_run())


def test_worker_queue_shutdown_drains_unstarted_jobs():
    """Queue shutdown drains pending unstarted jobs and refunds their quotas."""
    async def _run():
        queue = LectureWorkerQueue(concurrency=1, maxsize=10)
        mock_bot = MagicMock()
        mock_bot.edit_message_text = AsyncMock()

        with patch("backend.services.ai_solver.refund_lecture_quota", new_callable=AsyncMock) as mock_refund, \
             patch("backend.services.ai_solver.ai_release_inflight", new_callable=AsyncMock) as mock_release:

            await queue.enqueue_job(1, 101, "sess_drain_1", {}, 201, mock_bot, quota_consumed=True, auto_start=False)
            await queue.enqueue_job(2, 102, "sess_drain_2", {}, 202, mock_bot, quota_consumed=True, auto_start=False)

            assert queue.qsize() == 2

            await queue.stop(timeout=1.0)

            assert queue.qsize() == 0
            assert mock_refund.call_count == 2
            mock_refund.assert_any_call(101)
            mock_refund.assert_any_call(102)
            assert mock_release.call_count == 2

    asyncio.run(_run())
