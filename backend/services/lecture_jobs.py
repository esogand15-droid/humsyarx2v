# -*- coding: utf-8 -*-
"""
Lecture job tracking + admin alerts (voice -> academic PDF pipeline).

Purpose: lecture-processing failures must never be invisible. Every job leaves a
persistent trace in MongoDB and failures raise a (rate-limited) alert to admins.

Failure-safety contract
-----------------------
* Every public coroutine is wrapped: ANY exception (DB down, timeout, bad input)
  is logged on logger ``backend.services.lecture_jobs`` and swallowed. Nothing
  here may ever raise into ``run_lecture_processing_worker``.
* Each DB call is bounded by ``asyncio.wait_for`` (``DB_TIMEOUT_SEC`` ~3s) so a
  slow/unavailable Mongo cannot stall the worker.
* Raw API keys / bot tokens are never stored: ``mask_key`` for keys, and
  ``sanitize_error_text`` scrubs error strings before they reach the DB or chat.

Collection ``lecture_jobs`` (created lazily by MongoDB on first insert)
----------------------------------------------------------------------
    job_id        str        caller-provided id (session id / uuid)
    user_id       int
    started_at    datetime   UTC
    stage         str        last stage reached ('started', 'download', ...)
    stage_at      datetime   UTC, time of last stage change
    outcome       str        'running' | 'success' | 'failed' | 'timeout'
    files         list[{kind, mime, file_size, name(<=80 chars)}]
    model, key_masked, audio_bytes, duration_sec, mode   (optional, via job_stage)
    finished_at   datetime   UTC
    error_type    str|None   exception class name
    error_text    str|None   sanitized, <=300 chars

Indexes
-------
Created lazily and at most once per process (errors ignored):
``{job_id: 1}`` and ``{started_at: -1}``.
Suggested (NOT created automatically, because it deletes data): a TTL index of
30 days, e.g. ``db.lecture_jobs.createIndex({started_at: 1},
{expireAfterSeconds: 2592000})``.

DB access follows the project pattern: the shared ``db`` facade
(``from database import db``); since ``DBCore.__init__`` only exposes
pre-declared collections, ``lecture_jobs`` is resolved from the same
database as ``db.users`` (``db.users.database['lecture_jobs']``).

Admin recipients: ``ADMIN_ID`` env var (same source as message_router/reports),
optionally a comma/space-separated list.
"""
from __future__ import annotations

import asyncio
import html
import logging
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger("backend.services.lecture_jobs")

COLLECTION = "lecture_jobs"
DB_TIMEOUT_SEC = 3.0
SEND_TIMEOUT_SEC = 5.0
ALERT_COOLDOWN_SEC = 60.0
ERROR_TEXT_MAX = 300
NAME_MAX = 80

_ALLOWED_STAGE_KEYS = frozenset({
    "model", "key_masked", "audio_bytes", "duration_sec", "mode",
    "inline", "upload", "mime", "attempt",
})
_ALLOWED_FINISH_KEYS = frozenset({"model", "key_masked", "audio_bytes", "pdf_bytes", "mode"})
_VALID_OUTCOMES = frozenset({"success", "failed", "timeout"})

# in-process state
_indexes_ready = False
_started_mono: dict[str, float] = {}
_last_alert: dict[str, float] = {}
_ALERT_DICT_MAX = 64

_SECRET_PATTERNS = [
    re.compile(r"AIza[0-9A-Za-z_\-]{10,}"),                 # Google API keys
    re.compile(r"AQ\.[0-9A-Za-z_\-\.]{10,}"),               # Google OAuth-ish tokens
    re.compile(r"\d+:[A-Za-z0-9_\-]{30,}"),                 # Telegram bot tokens
    re.compile(r"(?i)((?:api[_-]?)?key|token)=[^&\s'\"]+"),  # ?key=... query params
    re.compile(r"(?i)bearer\s+[A-Za-z0-9_\-\.=]{12,}"),
]


# ─────────────────────────── helpers ───────────────────────────
def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def mask_key(key: Optional[str]) -> str:
    """Safe display of an API key (never the full value)."""
    try:
        from backend.services.ai_solver import masked_key as _mk  # reuse project helper
        return _mk(key or "")
    except Exception:
        k = (key or "").strip()
        if not k:
            return ""
        if len(k) <= 8:
            return "•" * len(k)
        return k[:4] + "…" + k[-4:]


def sanitize_error_text(text: Any, limit: int = ERROR_TEXT_MAX) -> str:
    """Strip anything that looks like an API key / bot token, then truncate."""
    try:
        s = str(text if text is not None else "")
    except Exception:
        s = "<unprintable>"
    for pat in _SECRET_PATTERNS:
        if pat.groups:
            s = pat.sub(lambda m: f"{m.group(1)}=[REDACTED]", s)
        else:
            s = pat.sub("[REDACTED]", s)
    s = s.replace("\r", " ").replace("\n", " ").strip()
    if len(s) > limit:
        s = s[: max(0, limit - 1)] + "…"
    return s


def _summarize_files(files: Any) -> list[dict]:
    out: list[dict] = []
    for f in (files or [])[:20]:
        if not isinstance(f, dict):
            continue
        name = f.get("name") or f.get("file_name") or ""
        size = f.get("file_size", f.get("size"))
        try:
            size = int(size) if size is not None else None
        except (TypeError, ValueError):
            size = None
        out.append({
            "kind": str(f.get("kind") or f.get("type") or "")[:20],
            "mime": str(f.get("mime") or f.get("mime_type") or "")[:60],
            "file_size": size,
            "name": str(name)[:NAME_MAX],
        })
    return out


def _clean_extra(extra: dict, allowed: frozenset) -> dict:
    clean: dict = {}
    for k, v in (extra or {}).items():
        if k not in allowed:
            continue
        if k == "key_masked":
            v = str(v or "")
            # defensive: caller passed a raw key by mistake -> mask it
            if "•" not in v and "…" not in v and len(v) > 12:
                v = mask_key(v)
        elif isinstance(v, str):
            v = sanitize_error_text(v, 120)
        elif not isinstance(v, (int, float, bool, type(None))):
            v = sanitize_error_text(v, 120)
        clean[k] = v
    return clean


def _get_collection():
    """Resolve the lecture_jobs collection via the shared db facade."""
    from database import db  # same import as ai_solver / bot modules
    col = getattr(db, COLLECTION, None)
    if col is not None:
        return col
    return db.users.database[COLLECTION]


async def _ensure_indexes(col) -> None:
    global _indexes_ready
    if _indexes_ready:
        return
    _indexes_ready = True  # attempt once per process, even on failure
    try:
        await asyncio.wait_for(col.create_index([("job_id", 1)]), DB_TIMEOUT_SEC)
        await asyncio.wait_for(col.create_index([("started_at", -1)]), DB_TIMEOUT_SEC)
    except Exception as e:  # never fatal
        logger.debug("lecture_jobs index creation skipped: %s", type(e).__name__)


async def _safe_db(op_name: str, job_id: str, fn) -> Any:
    try:
        col = _get_collection()
        await _ensure_indexes(col)
        return await asyncio.wait_for(fn(col), DB_TIMEOUT_SEC)
    except asyncio.TimeoutError:
        logger.warning("lecture_jobs.%s timed out (job=%s)", op_name, job_id)
    except Exception as e:
        logger.warning("lecture_jobs.%s failed (job=%s): %s: %s",
                       op_name, job_id, type(e).__name__, sanitize_error_text(e, 200))
    return None


# ─────────────────────────── public API ───────────────────────────
async def job_started(job_id: str, user_id: int, files: list[dict]) -> None:
    try:
        _started_mono[str(job_id)] = time.monotonic()
        if len(_started_mono) > 500:  # bound memory if finish is never called
            for k in list(_started_mono)[:250]:
                _started_mono.pop(k, None)
        now = _utcnow()
        doc = {
            "job_id": str(job_id),
            "user_id": int(user_id) if user_id is not None else None,
            "started_at": now,
            "stage": "started",
            "stage_at": now,
            "outcome": "running",
            "files": _summarize_files(files),
        }
        await _safe_db("job_started", job_id, lambda c: c.insert_one(doc))
    except Exception as e:
        logger.warning("lecture_jobs.job_started error: %s", type(e).__name__)


async def job_stage(job_id: str, stage: str, **extra) -> None:
    try:
        upd = {"stage": str(stage)[:40], "stage_at": _utcnow()}
        upd.update(_clean_extra(extra, _ALLOWED_STAGE_KEYS))
        await _safe_db("job_stage", job_id,
                       lambda c: c.update_one({"job_id": str(job_id)}, {"$set": upd}))
    except Exception as e:
        logger.warning("lecture_jobs.job_stage error: %s", type(e).__name__)


async def job_finished(job_id: str, outcome: str,
                       error: BaseException | None = None, **extra) -> None:
    try:
        oc = outcome if outcome in _VALID_OUTCOMES else "failed"
        t0 = _started_mono.pop(str(job_id), None)
        duration = extra.pop("duration_sec", None)
        if duration is None and t0 is not None:
            duration = round(time.monotonic() - t0, 2)
        upd: dict = {
            "outcome": oc,
            "finished_at": _utcnow(),
            "duration_sec": duration,
            "error_type": type(error).__name__ if error is not None else None,
            "error_text": sanitize_error_text(error) if error is not None else None,
        }
        upd.update(_clean_extra(extra, _ALLOWED_FINISH_KEYS))
        await _safe_db("job_finished", job_id,
                       lambda c: c.update_one({"job_id": str(job_id)}, {"$set": upd}))
    except Exception as e:
        logger.warning("lecture_jobs.job_finished error: %s", type(e).__name__)


def get_admin_ids() -> list[int]:
    raw = os.getenv("ADMIN_ID", "") or ""
    ids: list[int] = []
    for part in re.split(r"[,\s;]+", raw):
        try:
            v = int(part)
        except (TypeError, ValueError):
            continue
        if v and v not in ids:
            ids.append(v)
    return ids


def _rate_limited(key: str) -> bool:
    now = time.monotonic()
    last = _last_alert.get(key)
    if last is not None and now - last < ALERT_COOLDOWN_SEC:
        return True
    if len(_last_alert) >= _ALERT_DICT_MAX:
        for k, ts in list(_last_alert.items()):
            if now - ts >= ALERT_COOLDOWN_SEC:
                _last_alert.pop(k, None)
        if len(_last_alert) >= _ALERT_DICT_MAX:
            _last_alert.clear()
    _last_alert[key] = now
    return False


async def alert_admins(bot, text: str, error_type: str | None = None) -> None:
    """Send an HTML alert to every admin. Never raises.
    Rate limit: max 1 alert per ALERT_COOLDOWN_SEC per identical error_type
    (falls back to the text itself when error_type is not given)."""
    try:
        if bot is None or not text:
            return
        key = f"type:{error_type}" if error_type else f"text:{hash(text)}"
        if _rate_limited(key):
            logger.info("lecture_jobs alert suppressed by rate limit (%s)", key)
            return

        async def _send(aid: int) -> None:
            try:
                await asyncio.wait_for(
                    bot.send_message(chat_id=aid, text=text, parse_mode="HTML",
                                     disable_web_page_preview=True),
                    SEND_TIMEOUT_SEC)
            except Exception as e:
                logger.warning("lecture_jobs alert to admin %s failed: %s", aid, type(e).__name__)

        admins = get_admin_ids()
        if admins:
            await asyncio.gather(*(_send(a) for a in admins), return_exceptions=True)
    except Exception as e:
        logger.warning("lecture_jobs.alert_admins error: %s", type(e).__name__)


def failure_alert_text(job_id, user_id, stage, error, elapsed_sec) -> str:
    try:
        etype = type(error).__name__ if isinstance(error, BaseException) else (str(error or "Unknown")[:60])
        etext = sanitize_error_text(error, 200) if error is not None else "-"
        try:
            elapsed = f"{float(elapsed_sec):.1f}"
        except (TypeError, ValueError):
            elapsed = "?"
        e = html.escape
        return (
            "🚨 <b>خطا در پردازش جزوه صوتی</b>\n"
            f"🆔 جاب: <code>{e(str(job_id))}</code>\n"
            f"👤 کاربر: <code>{e(str(user_id))}</code>\n"
            f"📍 مرحله: <code>{e(str(stage))}</code>\n"
            f"⚠️ نوع خطا: <code>{e(etype)}</code>\n"
            f"⏱ زمان سپریشده: {e(elapsed)} ثانیه\n"
            f"📝 {e(etext)}"
        )
    except Exception:
        return "🚨 <b>خطا در پردازش جزوه صوتی</b>"


async def recent_failures(limit: int = 20) -> list[dict]:
    try:
        lim = max(1, min(int(limit or 20), 200))

        async def _q(c):
            cur = c.find({"outcome": {"$in": ["failed", "timeout"]}}, {"_id": 0})
            return await cur.sort("started_at", -1).limit(lim).to_list(lim)

        res = await _safe_db("recent_failures", "-", _q)
        return list(res or [])
    except Exception as e:
        logger.warning("lecture_jobs.recent_failures error: %s", type(e).__name__)
        return []
