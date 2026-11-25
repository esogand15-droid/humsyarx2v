# -*- coding: utf-8 -*-
"""
⚙️ backend/services/lecture_worker.py — Asynchronous Background Lecture Worker Queue
HamsYar Medical Platform — Milestone 1 (M1)

Features:
- Bounded concurrency (concurrency=2) using asyncio.Semaphore.
- Non-blocking enqueue (<200ms acknowledgment) with queue position tracking.
- Throttled status updates (minimum 2.5s between edits) preventing Telegram 429 RetryAfter.
- Background worker lifecycle (start and stop) wired to bot post_init and graceful shutdown.
- Atomic error recovery: automatic quota refund, in-flight lock release, and Persian user notifications.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
import logging
import os
import re
import time
from typing import Any, Callable, Dict, Optional

import telegram
from telegram.error import BadRequest, NetworkError, RetryAfter, TelegramError

logger = logging.getLogger("backend.services.lecture_worker")


# ══════════════════════════════════════════════════════════════════════════════
# 1. Throttled Status Message Updater
# ══════════════════════════════════════════════════════════════════════════════

class ThrottledStatusUpdater:
    """Safe rate-limiting wrapper for Telegram message edits.
    
    Guarantees:
    - Minimum 2.5s gap between edits on the same message to avoid Telegram 429.
    - Automatic RetryAfter handling with backoff.
    - Suppression of 'Message is not modified' errors.
    - Fallback to plain text if HTML entity parsing fails.
    - Non-fatal error handling: a status update failure never crashes the worker.
    """

    def __init__(
        self,
        bot: Optional[telegram.Bot],
        chat_id: int,
        message_id: int,
        min_interval: float = 2.5,
    ) -> None:
        self.bot = bot
        self.chat_id = chat_id
        self.message_id = message_id
        self.min_interval = min_interval
        self.last_edit_time: float = 0.0
        self.last_text: str = ""
        self._lock = asyncio.Lock()
        self._is_deleted: bool = False

    async def update(
        self,
        text: str,
        parse_mode: Optional[str] = "HTML",
        force: bool = False,
    ) -> bool:
        """Update the status message safely.

        Args:
            text: Persian status text to display.
            parse_mode: 'HTML', 'MarkdownV2', or None.
            force: If True (for major milestone transitions), delays if needed
                   to satisfy min_interval rather than skipping.

        Returns:
            bool: True if updated or skipped harmlessly, False if failed.
        """
        if self._is_deleted or not self.message_id or not self.bot:
            return False

        stripped = text.strip()
        if stripped == self.last_text:
            return True

        async with self._lock:
            if stripped == self.last_text:
                return True

            now = time.monotonic()
            elapsed = now - self.last_edit_time

            if elapsed < self.min_interval:
                if force:
                    wait_time = self.min_interval - elapsed
                    await asyncio.sleep(wait_time)
                else:
                    # Intermediate progress tick skipped to prevent 429
                    return False

            try:
                await self.bot.edit_message_text(
                    chat_id=self.chat_id,
                    message_id=self.message_id,
                    text=stripped,
                    parse_mode=parse_mode,
                )
                self.last_edit_time = time.monotonic()
                self.last_text = stripped
                return True

            except RetryAfter as exc:
                retry_sec = float(getattr(exc, "retry_after", 3.0)) + 0.5
                logger.warning(
                    "Telegram RetryAfter (%s s) on message %s (chat %s)",
                    retry_sec, self.message_id, self.chat_id
                )
                await asyncio.sleep(retry_sec)
                try:
                    await self.bot.edit_message_text(
                        chat_id=self.chat_id,
                        message_id=self.message_id,
                        text=stripped,
                        parse_mode=parse_mode,
                    )
                    self.last_edit_time = time.monotonic()
                    self.last_text = stripped
                    return True
                except Exception as retry_err:
                    logger.warning("Retry edit failed: %s", retry_err)
                    return False

            except BadRequest as exc:
                err_msg = str(exc).lower()
                if "message is not modified" in err_msg:
                    self.last_text = stripped
                    return True
                elif "message to edit not found" in err_msg or "chat not found" in err_msg:
                    logger.warning("Status message %s was deleted by user or not found", self.message_id)
                    self._is_deleted = True
                    return False
                elif "can't parse entities" in err_msg:
                    try:
                        await self.bot.edit_message_text(
                            chat_id=self.chat_id,
                            message_id=self.message_id,
                            text=stripped,
                            parse_mode=None,
                        )
                        self.last_edit_time = time.monotonic()
                        self.last_text = stripped
                        return True
                    except Exception:
                        return False
                else:
                    logger.warning("BadRequest editing status message %s: %s", self.message_id, exc)
                    return False

            except (NetworkError, TelegramError, Exception) as exc:
                logger.warning("Network or Telegram error editing message %s: %s", self.message_id, exc)
                return False

    async def __call__(
        self,
        text: str,
        parse_mode: Optional[str] = "HTML",
        force: bool = False,
    ) -> bool:
        """Enables status_updater('...') shorthand."""
        return await self.update(text, parse_mode=parse_mode, force=force)


# ══════════════════════════════════════════════════════════════════════════════
# 2. Lecture Job Dataclass
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class LectureJob:
    """Represents an enqueued lecture processing task."""
    job_id: str
    chat_id: int
    user_id: int
    session_id: str
    file_info: Any
    status_message_id: int
    bot: telegram.Bot
    quota_consumed: bool = True
    created_at: float = field(default_factory=time.time)
    position: int = 1
    updater: Optional[ThrottledStatusUpdater] = None


# Helper for dual sync/async start calls
class _StartResult:
    """Awaitable result allowing both sync `worker.start()` and `await worker.start()`."""
    def __await__(self):
        async def _noop():
            return None
        return _noop().__await__()


# ══════════════════════════════════════════════════════════════════════════════
# 3. Lecture Worker Queue
# ══════════════════════════════════════════════════════════════════════════════

class LectureWorkerQueue:
    """Asynchronous worker queue managing lecture processing with bounded concurrency."""

    def __init__(
        self,
        concurrency: int = 2,
        maxsize: int = 100,
        processor: Optional[Callable] = None,
    ) -> None:
        self.concurrency = max(1, int(concurrency))
        self.maxsize = maxsize
        self.semaphore = asyncio.Semaphore(self.concurrency)
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=maxsize)
        self.processor = processor
        self._running: bool = False
        self._stop_event = asyncio.Event()
        self._worker_tasks: list[asyncio.Task] = []
        self._active_jobs: Dict[str, LectureJob] = {}

    def start(self, bot: Optional[Any] = None) -> _StartResult:
        """Start the background worker tasks. Supports both sync and await."""
        if self._running:
            return _StartResult()
        self._running = True
        self._stop_event.clear()
        for i in range(self.concurrency):
            task = asyncio.create_task(
                self._worker_loop(f"lecture-worker-{i + 1}"),
                name=f"lecture-worker-{i + 1}",
            )
            self._worker_tasks.append(task)
        logger.info("LectureWorkerQueue started (concurrency=%d, maxsize=%d)", self.concurrency, self.maxsize)
        return _StartResult()

    async def stop(self, timeout: float = 5.0) -> None:
        """Gracefully stop workers and drain remaining jobs with quota restoration."""
        was_running = self._running
        self._running = False
        self._stop_event.set()
        logger.info("Stopping LectureWorkerQueue (draining active and queued jobs)...")

        # Send stop sentinels to wake up idle workers
        if was_running:
            for _ in range(self.concurrency):
                try:
                    self.queue.put_nowait(None)
                except asyncio.QueueFull:
                    pass

        # Drain unstarted jobs in the queue and safely refund their quotas
        while not self.queue.empty():
            try:
                pending_job = self.queue.get_nowait()
                if pending_job is not None and isinstance(pending_job, LectureJob):
                    await self._recover_unstarted_job(pending_job)
                self.queue.task_done()
            except asyncio.QueueEmpty:
                break

        # Wait for worker loops to conclude
        if self._worker_tasks:
            done, pending = await asyncio.wait(self._worker_tasks, timeout=timeout)
            for t in pending:
                t.cancel()
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)
            self._worker_tasks.clear()

        logger.info("LectureWorkerQueue stopped successfully.")

    async def enqueue_job(
        self,
        chat_id: int,
        user_id: int,
        session_id: str,
        file_info: Any,
        status_message_id: int,
        bot: telegram.Bot,
        quota_consumed: bool = True,
        auto_start: bool = True,
    ) -> bool:
        """Enqueues a lecture processing task.
        
        Returns immediately (<200ms) with True if accepted, False if queue is full.
        """
        if auto_start and not self._running:
            self.start()

        if self.queue.full():
            logger.warning("LectureWorkerQueue is full (size=%d). Rejecting job for user %s", self.queue.qsize(), user_id)
            return False

        position = self.queue.qsize() + 1
        updater = ThrottledStatusUpdater(bot=bot, chat_id=chat_id, message_id=status_message_id, min_interval=2.5)

        job = LectureJob(
            job_id=f"job_{session_id}_{int(time.time())}",
            chat_id=chat_id,
            user_id=user_id,
            session_id=session_id,
            file_info=file_info,
            status_message_id=status_message_id,
            bot=bot,
            quota_consumed=quota_consumed,
            position=position,
            updater=updater,
        )

        try:
            self.queue.put_nowait(job)
        except asyncio.QueueFull:
            return False

        # Immediate non-blocking status edit if waiting in queue
        if position > 1:
            asyncio.create_task(
                updater.update(
                    f"⏳ <b>درخواست شما در صف پردازش قرار گرفت.</b>\n"
                    f"📊 <b>موقعیت در صف:</b> {position}\n\n"
                    f"<i>به محض آزاد شدن ظرفیت هوش مصنوعی، تحلیل جلسه آغاز می‌شود...</i>",
                    force=False,
                )
            )

        logger.info("Enqueued lecture job %s for user %s (position=%d)", job.job_id, user_id, position)
        return True

    def qsize(self) -> int:
        """Returns the current number of pending jobs in queue."""
        return self.queue.qsize()

    def active_count(self) -> int:
        """Returns the number of jobs currently processing."""
        return len(self._active_jobs)

    async def _worker_loop(self, worker_name: str) -> None:
        """Worker loop continuously popping jobs from the queue."""
        logger.debug("Worker loop %s started", worker_name)
        while not self._stop_event.is_set():
            try:
                job = await self.queue.get()
            except asyncio.CancelledError:
                break

            if job is None:
                self.queue.task_done()
                break

            try:
                async with self.semaphore:
                    self._active_jobs[job.session_id] = job
                    await self._process_job(job)
            except Exception as exc:
                logger.exception("Unexpected error in worker loop %s for job %s: %s", worker_name, job.job_id, exc)
            finally:
                self._active_jobs.pop(job.session_id, None)
                self.queue.task_done()

        logger.debug("Worker loop %s exiting", worker_name)

    async def _process_job(self, job: LectureJob) -> None:
        """Executes a single lecture job with guaranteed atomic error recovery."""
        updater = job.updater or ThrottledStatusUpdater(
            bot=job.bot, chat_id=job.chat_id, message_id=job.status_message_id, min_interval=2.5
        )

        try:
            if self.processor is not None:
                await self.processor(
                    bot=job.bot,
                    chat_id=job.chat_id,
                    uid=job.user_id,
                    session_id=job.session_id,
                    file_info=job.file_info,
                    status_msg_id=job.status_message_id,
                    status_updater=updater,
                )
            else:
                # Dynamic import to prevent circular dependency
                from backend.services.lecture_scribe import run_lecture_processing_worker
                await run_lecture_processing_worker(
                    bot=job.bot,
                    chat_id=job.chat_id,
                    uid=job.user_id,
                    session_id=job.session_id,
                    file_info=job.file_info,
                    status_msg_id=job.status_message_id,
                    status_updater=updater,
                )
            logger.info("Successfully finished lecture job %s for user %s", job.job_id, job.user_id)

        except (Exception, asyncio.CancelledError) as exc:
            logger.exception("Lecture job %s failed: %s", job.job_id, exc)
            await self._recover_failed_job(job, exc, updater=updater)

    async def _recover_failed_job(self, job: LectureJob, exc: BaseException,
                                  updater: Optional[ThrottledStatusUpdater] = None) -> None:
        """Atomically refunds quota, releases inflight lock, and notifies user in Persian."""
        # 1. Quota Refund
        if job.quota_consumed:
            try:
                from ai_solver import refund_lecture_quota
                await refund_lecture_quota(job.user_id)
                logger.info("Restored lecture quota for user %s following error", job.user_id)
            except Exception as refund_err:
                logger.warning("Failed to restore quota for user %s: %s", job.user_id, refund_err)

        # 2. Release in-flight lock
        try:
            from ai_solver import ai_release_inflight
            await ai_release_inflight(job.user_id)
        except Exception:
            pass

        # 3. User Notification
        error_msg = (
            "⚠️ <b>متأسفانه در فرآیند تحلیل یا تولید جزوه خطایی رخ داد.</b>\n\n"
            "✅ <b>سهمیهٔ شما محفوظ ماند:</b> سهمیهٔ مصرف‌شده برای این جلسه برگردانده شد و کسر نگردید.\n"
            "لطفاً مجدداً فایل خود را ارسال فرمایید یا در صورت تکرار خطا، با پشتیبانی مطرح فرمایید."
        )
        # بیصدا تمام نشود: اول ویرایش پیام وضعیت، وگرنه پیام تازه.
        # قبلاً اگر job.updater خالی بود، هیچ پیامی ارسال نمیشد.
        updated = False
        status = job.updater or updater
        if status is not None:
            try:
                updated = bool(await status.update(error_msg, force=True))
            except Exception:
                updated = False
        if not updated and job.bot and job.chat_id:
            try:
                await job.bot.send_message(chat_id=job.chat_id, text=error_msg, parse_mode="HTML")
            except Exception:
                try:
                    await job.bot.send_message(chat_id=job.chat_id, text=re.sub(r"<[^>]+>", "", error_msg))
                except Exception as send_err:
                    logger.error("Lecture failure notice to user %s failed: %s", job.user_id, send_err)

        # 4. Cleanup session
        try:
            from backend.services.lecture_scribe import _LECTURE_SESSIONS
            _LECTURE_SESSIONS.pop(job.session_id, None)
        except Exception:
            pass

    async def _recover_unstarted_job(self, job: LectureJob) -> None:
        """Safely refunds an enqueued job drained during server shutdown."""
        if job.quota_consumed:
            try:
                from ai_solver import refund_lecture_quota
                await refund_lecture_quota(job.user_id)
            except Exception:
                pass
        try:
            from ai_solver import ai_release_inflight
            await ai_release_inflight(job.user_id)
        except Exception:
            pass
        if job.updater:
            msg = (
                "⚠️ <b>سرور ربات در حال راه‌اندازی مجدد است.</b>\n"
                "سهمیهٔ مصرف‌شدهٔ این جلسه به حساب شما برگشت داده شد. لطفاً چند دقیقه دیگر مجدداً تلاش فرمایید."
            )
            await job.updater.update(msg, force=True)


# ══════════════════════════════════════════════════════════════════════════════
# 4. Singleton Accessor
# ══════════════════════════════════════════════════════════════════════════════

_LECTURE_WORKER_QUEUE: Optional[LectureWorkerQueue] = None


def get_lecture_worker_queue() -> LectureWorkerQueue:
    """Returns the singleton instance of LectureWorkerQueue."""
    global _LECTURE_WORKER_QUEUE
    if _LECTURE_WORKER_QUEUE is None:
        _LECTURE_WORKER_QUEUE = LectureWorkerQueue(concurrency=2, maxsize=100)
    return _LECTURE_WORKER_QUEUE


# Alias for backward-compatible calls
get_lecture_worker = get_lecture_worker_queue
