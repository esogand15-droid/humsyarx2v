# -*- coding: utf-8 -*-
"""QA harness: offline end-to-end run of the lecture-notes pipeline.

Runs the REAL ``run_lecture_processing_worker`` (by default through the real
``LectureWorkerQueue._process_job`` + ``ThrottledStatusUpdater`` path, the
same path production uses) against:

  * a FakeBot that records edit_message_text / send_message / send_document /
    delete_message and saves the delivered PDF to --out;
  * a patched ``download_telegram_media`` that copies a local file instead of
    talking to Telegram;
  * a mocked Gemini endpoint (default) or the real Gemini API (--real, keys
    read ONLY from env GEMINI_API_KEYS);
  * patched get_ai_config / inflight-lock / quota-refund helpers, so no
    MongoDB is needed.

SAFETY: never touches a Telegram token, never calls getUpdates, never starts
bot.py. No secrets are written anywhere.

Usage examples:
  python scripts/qa_lecture_e2e.py                       # mocked, happy path
  python scripts/qa_lecture_e2e.py --fail-at send_document
  python scripts/qa_lecture_e2e.py --fail-at all          # every mode, table
  python scripts/qa_lecture_e2e.py --via direct --throttle 0.2
  GEMINI_API_KEYS=k1,k2 python scripts/qa_lecture_e2e.py --real --audio my.m4a

Failure modes (--fail-at):
  none            happy path
  send_document   every bot.send_document raises NetworkError (upload fails)
  pdf             generate_lecture_pdf raises RuntimeError
  gemini_500      Gemini returns HTTP 500 for every request
  max_tokens      Gemini returns 200 with finishReason=MAX_TOKENS (truncated)
  deleted_status  user deletes the status message after the first edit, then
                  Gemini returns HTTP 500 (error must still reach the user)
  all             run every mode above in sequence and print a summary table

Exit code: 0 if every executed mode PASSes, 1 otherwise.
"""
from __future__ import annotations

import argparse
import asyncio
import inspect
import io
import json
import logging
import os
import shutil
import subprocess
import sys
import time
import types
import uuid
from contextlib import ExitStack
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
# Do NOT add backend/services to sys.path: the root-level shims alias to
# backend.services.* and a second import path would create duplicate modules.

# The DB singleton is constructed at import time and needs a URI. Motor is
# lazy, so a dummy local URI never opens a connection; every DB-touching
# helper used by the pipeline is patched below.
os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017/qa_lecture_e2e_offline")

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

FAIL_MODES = ["none", "send_document", "pdf", "gemini_500", "max_tokens", "deleted_status"]
FIXTURE_DIR = os.path.join(ROOT, "tests", "fixtures")
FIXTURE_AUDIO = os.path.join(FIXTURE_DIR, "qa_lecture_tone_20s.mp3")

QA_CHAT_ID = 990000001
QA_USER_ID = 990000001
QA_STATUS_MSG_ID = 5000

# Markers that identify a user-visible failure notice (Persian UI).
ERROR_MARKERS = ("خطا", "⚠️", "⛔", "⏱", "📚", "اشکال", "متأسفانه", "ناموفق", "مشکل", "کسر نگردید")


# ─────────────────────────────────────────────────────────────────────────────
# Mock Gemini digest (matches LECTURE_DIGEST_SCHEMA)
# ─────────────────────────────────────────────────────────────────────────────
def mock_digest() -> dict:
    return {
        "title": "نارسایی قلبی و درمان دارویی (Heart Failure & GDMT)",
        "subject": "بیماری‌های قلب و عروق (Cardiology)",
        "professor": "دکتر QA <تست> & همکاران",
        "session": "جلسه ۴ - نارسایی قلبی با EF کاهش‌یافته (HFrEF)",
        "date": "پاییز ۱۴۰۵",
        "executive_summary": (
            "در این جلسه پاتوفیزیولوژی نارسایی قلبی (Heart Failure) با تأکید بر فعال‌شدن سیستم "
            "رنین-آنژیوتانسین-آلدوسترون (RAAS) و سیستم سمپاتیک بررسی شد. چهار ستون درمان دارویی "
            "(GDMT) شامل ARNI، بتابلاکر، MRA و SGLT2i مرور شد و معیارهای Framingham برای تشخیص "
            "بالینی توضیح داده شد. نکات مربوط به BNP < 100 pg/mL و NT-proBNP > 125 & تفسیر آن‌ها نیز بیان شد."
        ),
        "topics": [
            {
                "title": "پاتوفیزیولوژی (Pathophysiology)",
                "content": (
                    "کاهش برون‌ده قلبی (Cardiac Output) باعث فعال شدن RAAS و افزایش Norepinephrine می‌شود. "
                    "این پاسخ جبرانی در کوتاه‌مدت مفید ولی در درازمدت منجر به Remodeling بطنی و فیبروز می‌گردد. "
                ) * 4,
                "clinical_points": "در بیمار با تنگی نفس شبانه (PND) و ارتوپنه، ابتدا به HF فکر کنید.",
            },
            {
                "title": "تشخیص (Diagnosis)",
                "content": "اکوکاردیوگرافی (Echocardiography) استاندارد طلایی برای تعیین EF است؛ EF ≤ 40% یعنی HFrEF.",
                "clinical_points": "",
            },
            {
                "title": "درمان (Treatment / GDMT)",
                "content": (
                    "Sacubitril/Valsartan جایگزین ACEi در بیماران علامت‌دار است. بین قطع ACEi و شروع ARNI "
                    "حداقل ۳۶ ساعت فاصله لازم است تا خطر Angioedema کاهش یابد."
                ),
                "clinical_points": "Dapagliflozin حتی در بیماران غیر دیابتی مرگ‌ومیر را کاهش می‌دهد.",
            },
        ],
        "clinical_pearls": [
            "در هایپرکالمی (K > 5.5) شروع Spironolactone ممنوع است.",
            "Digoxin مرگ‌ومیر را کاهش نمی‌دهد ولی بستری مجدد را کم می‌کند.",
            "وزن روزانه بیمار بهترین شاخص سرپایی احتباس مایع است.",
        ],
        "exam_traps": [
            "ترکیب ACEi + ARNI به‌دلیل Angioedema کنتراندیکه است.",
            "Verapamil و Diltiazem در HFrEF ممنوع هستند (Negative Inotrope).",
        ],
        "comparison_table": {
            "title": "مقایسه چهار ستون GDMT",
            "headers": ["دارو", "مکانیسم", "عارضه مهم", "نکته"],
            "rows": [
                ["Sacubitril/Valsartan", "ARNI", "Angioedema", "فاصله ۳۶ ساعت با ACEi"],
                ["Carvedilol", "Beta-blocker", "Bradycardia", "شروع با دوز کم"],
                ["Spironolactone", "MRA", "Hyperkalemia", "K < 5"],
                ["Empagliflozin", "SGLT2i", "UTI / DKA", "eGFR > 20"],
            ],
        },
        "qna_list": [
            {"question": "چهار ستون درمان HFrEF کدام‌اند؟", "answer": "ARNI، بتابلاکر، MRA و SGLT2i."},
            {"question": "فاصله لازم بین قطع ACEi و شروع ARNI؟", "answer": "۳۶ ساعت."},
            {"question": "کدام دارو در HFrEF ممنوع است؟", "answer": "Non-dihydropyridine CCB."},
            {"question": "شاخص سرپایی احتباس مایع؟", "answer": "وزن روزانه."},
        ],
    }


# ─────────────────────────────────────────────────────────────────────────────
# Fake Telegram bot
# ─────────────────────────────────────────────────────────────────────────────
class FakeBot:
    """Records every Telegram call; emulates 'message deleted' semantics."""

    def __init__(self, out_dir: str, fail_at: str, status_msg_id: int):
        import telegram.error as tg_err
        self._tg_err = tg_err
        self.out_dir = out_dir
        self.fail_at = fail_at
        self.status_msg_id = status_msg_id
        self.t0 = time.monotonic()
        self.calls: list[dict] = []
        self.deleted: set[int] = set()
        self.existing: set[int] = {status_msg_id}
        self.message_text: dict[int, str] = {}
        self._next_id = status_msg_id + 1
        self.successful_edits = 0
        self.saved_pdfs: list[str] = []
        self.token = "QA_FAKE_TOKEN_NOT_REAL"
        self.id = 1
        self.username = "qa_fake_bot"

    def _rec(self, method: str, ok: bool, **info):
        entry = {"t": time.monotonic() - self.t0, "method": method, "ok": ok}
        entry.update(info)
        self.calls.append(entry)
        return entry

    def _new_msg(self, chat_id, text=None):
        mid = self._next_id
        self._next_id += 1
        self.existing.add(mid)
        if text is not None:
            self.message_text[mid] = text
        return types.SimpleNamespace(message_id=mid, chat_id=chat_id, chat=types.SimpleNamespace(id=chat_id), text=text)

    async def edit_message_text(self, text=None, chat_id=None, message_id=None, parse_mode=None, **kw):
        if message_id in self.deleted or message_id not in self.existing:
            self._rec("edit_message_text", False, message_id=message_id, text=text,
                      error="BadRequest: Message to edit not found")
            raise self._tg_err.BadRequest("Message to edit not found")
        if self.message_text.get(message_id) == text:
            self._rec("edit_message_text", False, message_id=message_id, text=text,
                      error="BadRequest: Message is not modified")
            raise self._tg_err.BadRequest("Message is not modified: specified new message content and reply markup are exactly the same")
        self.message_text[message_id] = text
        self.successful_edits += 1
        self._rec("edit_message_text", True, message_id=message_id, text=text)
        # Failure injection: user deletes the status message after the first edit.
        if self.fail_at == "deleted_status" and message_id == self.status_msg_id and self.successful_edits == 1:
            self.deleted.add(message_id)
            self._rec("[user deleted status message]", True, message_id=message_id)
        return types.SimpleNamespace(message_id=message_id, chat_id=chat_id, text=text)

    async def send_message(self, chat_id=None, text=None, parse_mode=None, **kw):
        msg = self._new_msg(chat_id, text)
        self._rec("send_message", True, message_id=msg.message_id, text=text, parse_mode=parse_mode)
        return msg

    async def delete_message(self, chat_id=None, message_id=None, **kw):
        if message_id in self.deleted or message_id not in self.existing:
            self._rec("delete_message", False, message_id=message_id, error="BadRequest: Message to delete not found")
            raise self._tg_err.BadRequest("Message to delete not found")
        self.deleted.add(message_id)
        self._rec("delete_message", True, message_id=message_id)
        return True

    async def send_document(self, chat_id=None, document=None, filename=None, caption=None, **kw):
        if self.fail_at == "send_document":
            self._rec("send_document", False, filename=filename, text=caption,
                      error="NetworkError: simulated upload timeout")
            raise self._tg_err.NetworkError("httpx.WriteTimeout: simulated upload timeout")
        data = _read_document_bytes(document)
        fname = filename or getattr(document, "name", None) or "document.bin"
        safe = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in os.path.basename(str(fname)))
        path = os.path.join(self.out_dir, f"{len(self.saved_pdfs) + 1:02d}_{safe or 'document.pdf'}")
        with open(path, "wb") as fh:
            fh.write(data)
        self.saved_pdfs.append(path)
        msg = self._new_msg(chat_id)
        self._rec("send_document", True, message_id=msg.message_id, filename=fname, text=caption,
                  size=len(data), saved=path)
        return msg

    # Defensive no-ops for anything else the pipeline may add later.
    async def send_chat_action(self, *a, **kw):
        self._rec("send_chat_action", True)
        return True

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)

        async def _unknown(*a, **kw):
            self._rec(name, True, note="unmodelled FakeBot method")
            return types.SimpleNamespace(message_id=self._next_id, ok=True)
        return _unknown


def _read_document_bytes(document) -> bytes:
    if document is None:
        return b""
    if isinstance(document, (bytes, bytearray)):
        return bytes(document)
    if isinstance(document, str) and os.path.isfile(document):
        with open(document, "rb") as fh:
            return fh.read()
    inner = getattr(document, "input_file_content", None)  # telegram.InputFile
    if isinstance(inner, (bytes, bytearray)):
        return bytes(inner)
    if hasattr(document, "read"):
        try:
            document.seek(0)
        except Exception:
            pass
        return document.read()
    return b""


# ─────────────────────────────────────────────────────────────────────────────
# Fixture audio
# ─────────────────────────────────────────────────────────────────────────────
def find_ffmpeg() -> str | None:
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and os.path.isfile(exe):
            return exe
    except Exception:
        pass
    return shutil.which("ffmpeg")


def ensure_fixture_audio(path: str = FIXTURE_AUDIO) -> str | None:
    """Generate a 20s voice-like (AM-modulated) mono 32 kbps mp3 (~80KB)."""
    if os.path.isfile(path) and os.path.getsize(path) > 0:
        return path
    exe = find_ffmpeg()
    if not exe:
        print("[fixture] ffmpeg not found (PATH or imageio_ffmpeg); skipping fixture generation.")
        return None
    os.makedirs(os.path.dirname(path), exist_ok=True)
    expr = "0.4*sin(2*PI*170*t)*(0.55+0.45*sin(2*PI*3.3*t))+0.15*sin(2*PI*340*t)*(0.5+0.5*sin(2*PI*1.7*t))"
    cmd = [exe, "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
           "-i", f"aevalsrc={expr}:s=16000:d=20", "-ac", "1", "-b:a", "32k", "-f", "mp3", path]
    try:
        subprocess.run(cmd, check=True, timeout=60)
    except Exception as exc:
        print(f"[fixture] ffmpeg failed: {exc}; skipping.")
        return None
    print(f"[fixture] generated {path} ({os.path.getsize(path)} bytes)")
    return path


# ─────────────────────────────────────────────────────────────────────────────
# Mock Gemini transport
# ─────────────────────────────────────────────────────────────────────────────
def make_gemini_handler(fail_at: str, counters: dict):
    import httpx

    def handler(request: "httpx.Request") -> "httpx.Response":
        url = str(request.url)
        counters.setdefault("requests", []).append(url.split("?")[0])
        if "generativelanguage.googleapis.com" not in url:
            return httpx.Response(599, json={"error": "QA harness: unexpected outbound host blocked"})
        if "/upload/" in url or url.rstrip("/").endswith("/files"):
            return httpx.Response(200, json={"file": {"name": "files/qa", "uri": "https://qa/files/qa",
                                                      "state": "ACTIVE", "mimeType": "audio/mpeg"}})
        if "/files/" in url:
            return httpx.Response(200, json={"name": "files/qa", "uri": "https://qa/files/qa",
                                             "state": "ACTIVE", "mimeType": "audio/mpeg"})
        if fail_at in ("gemini_500", "deleted_status"):
            return httpx.Response(500, json={"error": {"code": 500, "message": "QA simulated internal error",
                                                       "status": "INTERNAL"}})
        if fail_at == "max_tokens":
            partial = json.dumps(mock_digest(), ensure_ascii=False)[:400]
            return httpx.Response(200, json={"candidates": [{"finishReason": "MAX_TOKENS",
                                                             "content": {"parts": [{"text": partial}]}}]})
        return httpx.Response(200, json={
            "candidates": [{"finishReason": "STOP",
                            "content": {"role": "model",
                                        "parts": [{"text": json.dumps(mock_digest(), ensure_ascii=False)}]}}],
            "usageMetadata": {"totalTokenCount": 4242},
        })
    return handler


# ─────────────────────────────────────────────────────────────────────────────
# One run
# ─────────────────────────────────────────────────────────────────────────────
def _is_error_text(text: str | None) -> bool:
    return bool(text) and any(m in text for m in ERROR_MARKERS)


def _preview(text, n=90) -> str:
    if text is None:
        return ""
    s = " ".join(str(text).split())
    return s if len(s) <= n else s[: n - 1] + "…"


async def run_once(args, fail_at: str, out_dir: str) -> dict:
    import httpx
    import backend.services.ai_solver as ai_solver
    import backend.services.lecture_scribe as ls
    import lecture_notes_pdf  # noqa: F401 — root shim; aliases to backend.services.lecture_notes_pdf
    import backend.services.lecture_notes_pdf as lnp

    try:
        import backend.services.telegram_downloader as tdl
    except Exception as exc:  # pyrogram missing etc.
        print(f"[harness] telegram_downloader import failed ({exc!r}); injecting stub module.")
        tdl = types.ModuleType("backend.services.telegram_downloader")
        sys.modules["backend.services.telegram_downloader"] = tdl

    os.makedirs(out_dir, exist_ok=True)
    bot = FakeBot(out_dir, fail_at, QA_STATUS_MSG_ID)
    counters: dict = {"refunds": 0, "claims": 0, "releases": 0, "downloads": []}

    file_map = {"qa_audio_file_id": args.audio}
    if args.pdf:
        file_map["qa_pdf_file_id"] = args.pdf

    async def fake_download(bot=None, chat_id=None, message_id=None, file_id=None,
                            file_size=0, dest_path=None, **kw):
        src = file_map.get(file_id)
        if not src:
            raise FileNotFoundError(f"QA harness: unknown file_id {file_id!r}")
        if not dest_path:
            dest_path = os.path.join(out_dir, os.path.basename(src))
        os.makedirs(os.path.dirname(dest_path) or ".", exist_ok=True)
        shutil.copyfile(src, dest_path)
        counters["downloads"].append({"file_id": file_id, "dest": dest_path, "size": os.path.getsize(dest_path)})
        return dest_path

    async def fake_claim(uid):
        counters["claims"] += 1
        ai_solver._busy_users.add(int(uid))
        return True

    async def fake_is_inflight(uid):
        return int(uid) in ai_solver._busy_users

    async def fake_release(uid):
        counters["releases"] += 1
        ai_solver._busy_users.discard(int(uid))

    async def fake_refund(uid):
        counters["refunds"] += 1

    if args.real:
        keys = [k.strip() for k in (os.environ.get("GEMINI_API_KEYS") or "").replace(";", ",").split(",") if k.strip()]
        if not keys:
            raise SystemExit("--real requires env GEMINI_API_KEYS (comma-separated). Nothing was sent.")
        cfg = {"provider": "gemini", "vault_multi": {"gemini": keys}, "api_key_list": keys, "api_key": keys[0]}
    else:
        cfg = {"provider": "gemini", "vault_multi": {"gemini": ["QA_FAKE_GEMINI_KEY"]},
               "api_key_list": ["QA_FAKE_GEMINI_KEY"], "api_key": "QA_FAKE_GEMINI_KEY"}

    async def fake_get_ai_config():
        return dict(cfg)

    ai_solver._KEY_STATE.clear()
    ai_solver._busy_users.discard(QA_USER_ID)

    session_id = f"qa_{fail_at}_{uuid.uuid4().hex[:6]}"
    files = [{
        "kind": "audio", "name": os.path.basename(args.audio), "tg_file_id": "qa_audio_file_id",
        "file_size": os.path.getsize(args.audio), "mime": "audio/mpeg",
        "chat_id": QA_CHAT_ID, "message_id": 4000,
    }]
    if args.pdf:
        files.append({"kind": "pdf", "name": os.path.basename(args.pdf), "tg_file_id": "qa_pdf_file_id",
                      "file_size": os.path.getsize(args.pdf), "mime": "application/pdf",
                      "chat_id": QA_CHAT_ID, "message_id": 4001})
    session = {"session_id": session_id, "user_id": QA_USER_ID, "files": files, "created_at": time.time()}
    ls._LECTURE_SESSIONS[session_id] = session

    with ExitStack() as st:
        st.enter_context(mock.patch.object(tdl, "download_telegram_media", fake_download, create=True))
        for name, fn in (("get_ai_config", fake_get_ai_config), ("ai_claim_inflight", fake_claim),
                         ("ai_is_inflight", fake_is_inflight), ("ai_release_inflight", fake_release),
                         ("refund_lecture_quota", fake_refund)):
            st.enter_context(mock.patch.object(ai_solver, name, fn))
            if hasattr(ls, name):  # in case Agent A hoists imports to module level
                st.enter_context(mock.patch.object(ls, name, fn))
        if hasattr(ls, "download_telegram_media"):
            st.enter_context(mock.patch.object(ls, "download_telegram_media", fake_download))
        if not args.real:
            # keep real env keys out of a mocked run entirely
            st.enter_context(mock.patch.dict(os.environ, {}, clear=False))
            for k in ("GEMINI_API_KEYS", "GEMINI_API_KEY", "GOOGLE_API_KEY"):
                os.environ.pop(k, None)
            handler = make_gemini_handler(fail_at, counters)
            real_async_client = httpx.AsyncClient

            class _MockAsyncClient(real_async_client):
                def __init__(self, *a, **kw):
                    kw["transport"] = httpx.MockTransport(handler)
                    super().__init__(*a, **kw)
            st.enter_context(mock.patch.object(httpx, "AsyncClient", _MockAsyncClient))
        if fail_at == "pdf":
            def _boom(*a, **kw):
                raise RuntimeError("QA injected PDF render failure")
            st.enter_context(mock.patch.object(lnp, "generate_lecture_pdf", _boom))
            if hasattr(ls, "generate_lecture_pdf"):
                st.enter_context(mock.patch.object(ls, "generate_lecture_pdf", _boom))

        result = {"return": None, "exception": None}
        t_start = time.monotonic()
        try:
            if args.via == "queue":
                from backend.services.lecture_worker import (
                    LectureWorkerQueue, LectureJob, ThrottledStatusUpdater)
                q = LectureWorkerQueue(concurrency=1, maxsize=5)
                updater = ThrottledStatusUpdater(bot=bot, chat_id=QA_CHAT_ID,
                                                 message_id=QA_STATUS_MSG_ID, min_interval=args.throttle)
                job_kwargs = dict(job_id=f"job_{session_id}", chat_id=QA_CHAT_ID, user_id=QA_USER_ID,
                                  session_id=session_id, file_info=session,
                                  status_message_id=QA_STATUS_MSG_ID, bot=bot,
                                  quota_consumed=True, updater=updater)
                accepted = set(inspect.signature(LectureJob).parameters)
                job = LectureJob(**{k: v for k, v in job_kwargs.items() if k in accepted})
                await asyncio.wait_for(q._process_job(job), timeout=args.timeout)
                result["return"] = "(queue path: _process_job returns None)"
            else:
                fn = ls.run_lecture_processing_worker
                sig = inspect.signature(fn)
                candidate = dict(bot=bot, chat_id=QA_CHAT_ID, uid=QA_USER_ID, user_id=QA_USER_ID,
                                 session=session, session_id=session_id, file_info=session,
                                 status_msg_id=QA_STATUS_MSG_ID, status_message_id=QA_STATUS_MSG_ID,
                                 status_updater=None, quota_consumed=True)
                has_var_kw = any(p.kind is p.VAR_KEYWORD for p in sig.parameters.values())
                kwargs = {k: v for k, v in candidate.items()
                          if k in sig.parameters and k not in ("user_id", "status_message_id")}
                if has_var_kw and "quota_consumed" not in kwargs:
                    kwargs["quota_consumed"] = True
                missing = [n for n, p in sig.parameters.items()
                           if p.default is p.empty and p.kind in (p.POSITIONAL_OR_KEYWORD, p.KEYWORD_ONLY)
                           and n not in kwargs]
                for n in missing:  # unknown new required params: best-effort aliasing
                    if n in candidate:
                        kwargs[n] = candidate[n]
                result["return"] = await asyncio.wait_for(fn(**kwargs), timeout=args.timeout)
        except Exception as exc:
            result["exception"] = f"{type(exc).__name__}: {exc}"
        result["elapsed"] = time.monotonic() - t_start

    # ── Verdict ──
    docs = [c for c in bot.calls if c["method"] == "send_document" and c["ok"]]
    pdf_checks = []
    for c in docs:
        path = c.get("saved")
        with open(path, "rb") as fh:
            data = fh.read()
        pages = None
        try:
            import pypdf
            pages = len(pypdf.PdfReader(io.BytesIO(data)).pages)
        except Exception as exc:
            pages = f"pypdf error: {exc}"
        pdf_checks.append({"path": path, "size": len(data), "is_pdf": data[:4] == b"%PDF", "pages": pages})
    sent_errors = [c for c in bot.calls if c["method"] == "send_message" and c["ok"] and _is_error_text(c.get("text"))]
    status_final = None
    if QA_STATUS_MSG_ID not in bot.deleted:
        status_final = bot.message_text.get(QA_STATUS_MSG_ID)
    status_shows_error = _is_error_text(status_final)
    got_doc = any(p["is_pdf"] and p["size"] > 0 for p in pdf_checks)
    got_error = bool(sent_errors) or status_shows_error
    caption_claims_pdf = any(c["method"] == "send_message" and c["ok"] and "پیوست" in (c.get("text") or "")
                             for c in bot.calls)
    verdict = "PASS" if (got_doc or got_error) else "FAIL (silent ending)"
    notes = []
    if not got_doc and caption_claims_pdf:
        notes.append("summary caption says the PDF is attached, but no PDF was delivered")
    if QA_STATUS_MSG_ID in bot.deleted and not got_doc:
        notes.append("status message was deleted; error edits targeted a non-existent message")
    failed_edits = [c for c in bot.calls if c["method"] == "edit_message_text" and not c["ok"]]
    if failed_edits:
        notes.append(f"{len(failed_edits)} edit_message_text call(s) failed")
    if not got_doc and counters["refunds"] == 0:
        notes.append("no quota refund recorded despite no delivery")

    return {
        "fail_at": fail_at, "verdict": verdict, "got_doc": got_doc, "got_error": got_error,
        "status_final": status_final, "status_deleted": QA_STATUS_MSG_ID in bot.deleted,
        "result": result, "counters": counters, "calls": bot.calls, "pdfs": pdf_checks, "notes": notes,
    }


def print_report(rep: dict):
    print("=" * 100)
    print(f"MODE: {rep['fail_at']}   VERDICT: {rep['verdict']}")
    print("-" * 100)
    print("Timeline of bot calls:")
    for c in rep["calls"]:
        status = "ok " if c["ok"] else "ERR"
        extra = ""
        if c.get("error"):
            extra += f" !! {c['error']}"
        if c.get("size") is not None:
            extra += f" [{c['size']} bytes -> {c.get('saved')}]"
        mid = c.get("message_id", "")
        print(f"  t+{c['t']:7.2f}s  {status} {c['method']:<32} msg={mid!s:<5} {_preview(c.get('text'))}{extra}")
    r = rep["result"]
    print("-" * 100)
    print(f"worker return: {r['return']!r}   exception escaped: {r['exception']!r}   elapsed: {r['elapsed']:.2f}s")
    cn = rep["counters"]
    print(f"downloads={len(cn['downloads'])} claims={cn['claims']} releases={cn['releases']} refunds={cn['refunds']} "
          f"gemini_requests={len(cn.get('requests', []))}")
    print(f"PDF delivered: {rep['got_doc']}  {rep['pdfs']}")
    print(f"User-visible error: {rep['got_error']}  (status deleted={rep['status_deleted']}; "
          f"final status text: {_preview(rep['status_final'], 120)!r})")
    for n in rep["notes"]:
        print(f"  NOTE: {n}")


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Offline E2E QA harness for the lecture-notes pipeline")
    p.add_argument("--audio", help="local audio/video file (default: generated tests/fixtures fixture)")
    p.add_argument("--pdf", help="optional local slides PDF")
    p.add_argument("--real", action="store_true", help="call the real Gemini API (keys from env GEMINI_API_KEYS)")
    p.add_argument("--out", default=os.path.join(ROOT, "tmp", "qa_lecture_e2e"), help="output dir")
    p.add_argument("--fail-at", default="none", choices=FAIL_MODES + ["all"])
    p.add_argument("--via", default="queue", choices=["queue", "direct"],
                   help="queue = production path (LectureWorkerQueue._process_job + ThrottledStatusUpdater); "
                        "direct = call run_lecture_processing_worker with status_updater=None")
    p.add_argument("--throttle", type=float, default=2.5, help="ThrottledStatusUpdater min_interval (prod: 2.5)")
    p.add_argument("--timeout", type=float, default=900.0, help="per-run timeout seconds")
    args = p.parse_args(argv)

    if not args.audio:
        args.audio = ensure_fixture_audio()
        if not args.audio:
            print("No audio available: pass --audio PATH (ffmpeg unavailable for fixture generation).")
            return 2
    if not os.path.isfile(args.audio):
        print(f"--audio not found: {args.audio}")
        return 2
    if args.pdf and not os.path.isfile(args.pdf):
        print(f"--pdf not found: {args.pdf}")
        return 2
    if args.real and args.fail_at not in ("none", "send_document", "pdf"):
        print("--real only supports --fail-at none|send_document|pdf (HTTP faults are mock-only).")
        return 2

    os.makedirs(args.out, exist_ok=True)
    log_path = os.path.join(args.out, "harness.log")
    logging.basicConfig(level=logging.INFO, filename=log_path, filemode="w", encoding="utf-8",
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    print(f"[harness] mode={'REAL Gemini' if args.real else 'mocked Gemini'} via={args.via} "
          f"throttle={args.throttle}s audio={args.audio} pdf={args.pdf} log={log_path}")

    modes = FAIL_MODES if args.fail_at == "all" else [args.fail_at]
    reports = []
    for m in modes:
        rep = asyncio.run(run_once(args, m, os.path.join(args.out, m)))
        print_report(rep)
        reports.append(rep)

    if len(reports) > 1:
        print("=" * 100)
        print(f"{'mode':<16}{'verdict':<24}{'pdf':<6}{'error shown':<13}{'refunds':<9}notes")
        for r in reports:
            print(f"{r['fail_at']:<16}{r['verdict']:<24}{str(r['got_doc']):<6}{str(r['got_error']):<13}"
                  f"{r['counters']['refunds']:<9}{'; '.join(r['notes'])}")
    return 0 if all(r["verdict"] == "PASS" for r in reports) else 1


if __name__ == "__main__":
    sys.exit(main())
