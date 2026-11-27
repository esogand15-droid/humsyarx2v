# -*- coding: utf-8 -*-
"""🎓 دستیار هوشمند جزوه‌نویس چندرسانه‌ای در وب‌اپ (صوت/ویدیو + اسلاید PDF → جزوه آکادمیک PDF)."""
from __future__ import annotations

import asyncio
import base64
from datetime import datetime, timezone
import logging
import os
import re
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
import httpx

from backend.api.auth import require_feature
from backend.database.database import db
from backend.services.lecture_scribe import (
    LECTURE_DIGEST_SCHEMA,
    LECTURE_INLINE_AUDIO_MAX_BYTES,
    LECTURE_INLINE_PDF_MAX_BYTES,
    MAX_LECTURE_MEDIA_BYTES,
    _lecture_ai_deadline_sec,
    _lecture_digest_from_response,
    _lecture_output_tokens,
    auto_repair_generation_config,
    canonical_audio_mime,
    format_persian_lecture_error,
    resolve_candidate_models,
    resolve_gemini_api_keys,
    transcode_media_to_optimized_audio,
)
from backend.services.storage import get_storage_driver

logger = logging.getLogger(__name__)
router = APIRouter()

_BG_TASKS: set[asyncio.Task] = set()


def _coll():
    return db.users.database["web_lecture_jobs"]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _serialize_job(doc: dict) -> dict:
    summary = doc.get("digest_summary") or {}
    return {
        "id": str(doc.get("_id") or ""),
        "title": doc.get("title") or summary.get("title") or "جزوه درسی",
        "subject": doc.get("subject") or summary.get("subject") or "",
        "professor": doc.get("professor") or summary.get("professor") or "",
        "status": doc.get("status") or "processing",
        "stage": doc.get("stage") or "",
        "status_text": doc.get("status_text") or "",
        "error": doc.get("error") or "",
        "pdf_ready": bool(doc.get("pdf_ready")),
        "pdf_size": int(doc.get("pdf_size") or 0),
        "summary": summary,
        "created_at": str(doc.get("created_at") or ""),
        "updated_at": str(doc.get("updated_at") or ""),
    }


async def _update_job(job_id: str, **fields: Any) -> None:
    try:
        fields["updated_at"] = _now_iso()
        await _coll().update_one({"_id": job_id}, {"$set": fields})
    except Exception as exc:
        logger.debug("web_lecture update failed job=%s err=%s", job_id, exc)


async def _run_web_lecture_job(
    *,
    job_id: str,
    uid: int,
    audio_bytes: Optional[bytes],
    audio_name: str,
    audio_mime: str,
    pdf_bytes: Optional[bytes],
    pdf_name: str,
    notes: str,
    quota_consumed: bool,
) -> None:
    from backend.services.ai_solver import (
        AIConfigError,
        AIError,
        _gemini_upload_file,
        _gemini_wait_file_active,
        _no_thinking,
        _raise_gemini_status_error,
        ai_release_inflight,
        get_ai_config,
        refund_lecture_quota,
        run_with_key_failover,
    )
    from backend.services.lecture_notes_pdf import generate_lecture_pdf

    try:
        cfg = await get_ai_config()
        gemini_keys = resolve_gemini_api_keys(cfg)
        if not gemini_keys:
            raise AIConfigError(
                "هیچ کلید فعالی برای Google Gemini در پنل مدیریت تنظیم نشده است."
            )

        proc_audio = audio_bytes
        proc_mime = audio_mime
        if proc_audio:
            await _update_job(
                job_id,
                stage="transcode",
                status_text="در حال بهینه‌سازی فایل صوتی/ویدیویی…",
            )
            proc_audio, proc_mime, _ = await transcode_media_to_optimized_audio(
                proc_audio,
                audio_name,
                bitrate="32k",
            )
            if not proc_mime:
                proc_mime = canonical_audio_mime(audio_mime, audio_name)

        candidate_models = resolve_candidate_models(cfg)
        system_prompt = (
            "شما یک دستیار ارشد بالینی هوشیار و استاد تدوین جزوه‌های پزشکی دانشگاهی هستید.\n"
            "فایل‌های پیوست شامل صوت تدریس استاد و/یا اسلایدهای کلاسی است.\n"
            "سرفصل‌های دقیق علمی، اصطلاحات انگلیسی تخصصی داخل پرانتز، مرواریدهای بالینی، "
            "دام‌های تستی، جدول مقایسه‌ای و پرسش و پاسخ‌های کلیدی را استخراج کن و فقط JSON معتبر بده."
        )
        user_prompt = "لطفاً جزوه کامل این جلسه درسی را به همراه نکات بالینی و دام‌های تستی استخراج کن."
        if notes.strip():
            user_prompt += f"\nیادداشت دانشجو: {notes.strip()[:1000]}"

        await _update_job(
            job_id,
            stage="ai",
            status_text="در حال شنیدن و تحلیل محتوای جلسه توسط هوشیار…",
        )

        async def _process_key(key: str) -> dict:
            parts: list[dict[str, Any]] = []
            if proc_audio:
                if len(proc_audio) <= LECTURE_INLINE_AUDIO_MAX_BYTES:
                    parts.append(
                        {
                            "inline_data": {
                                "mime_type": proc_mime or "audio/mpeg",
                                "data": base64.b64encode(proc_audio).decode("utf-8"),
                            }
                        }
                    )
                else:
                    fi = await _gemini_upload_file(key, proc_audio, proc_mime or "audio/mpeg", audio_name)
                    uploaded = await _gemini_wait_file_active(key, fi, timeout=180)
                    state = ((uploaded or {}).get("state") or "").upper()
                    if uploaded and state == "ACTIVE" and uploaded.get("uri"):
                        parts.append(
                            {
                                "file_data": {
                                    "file_uri": uploaded["uri"],
                                    "mime_type": uploaded.get("mimeType") or proc_mime or "audio/mpeg",
                                }
                            }
                        )
                    else:
                        raise AIError("فایل صوتی برای پردازش ابری آماده نشد.")

            if pdf_bytes:
                if len(pdf_bytes) <= LECTURE_INLINE_PDF_MAX_BYTES:
                    parts.append(
                        {
                            "inline_data": {
                                "mime_type": "application/pdf",
                                "data": base64.b64encode(pdf_bytes).decode("utf-8"),
                            }
                        }
                    )
                else:
                    fi = await _gemini_upload_file(key, pdf_bytes, "application/pdf", pdf_name)
                    uploaded = await _gemini_wait_file_active(key, fi, timeout=180)
                    state = ((uploaded or {}).get("state") or "").upper()
                    if uploaded and state == "ACTIVE" and uploaded.get("uri"):
                        parts.append(
                            {
                                "file_data": {
                                    "file_uri": uploaded["uri"],
                                    "mime_type": "application/pdf",
                                }
                            }
                        )
                    else:
                        raise AIError("فایل اسلایدهای PDF برای پردازش ابری آماده نشد.")

            parts.append({"text": user_prompt})
            last_err = None
            for model_cand in candidate_models:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_cand}:generateContent"
                headers = {"Content-Type": "application/json", "x-goog-api-key": key}
                gen_cfg = _no_thinking(
                    {
                        "responseMimeType": "application/json",
                        "responseSchema": LECTURE_DIGEST_SCHEMA,
                        "maxOutputTokens": _lecture_output_tokens(cfg),
                        "temperature": 0.2,
                    },
                    model=model_cand,
                )
                payload = {
                    "system_instruction": {"parts": [{"text": system_prompt}]},
                    "contents": [{"role": "user", "parts": parts}],
                    "generationConfig": gen_cfg,
                }
                sent_payload = payload
                async with httpx.AsyncClient(timeout=240) as client:
                    res = await client.post(url, headers=headers, json=payload)
                if res.status_code == 400:
                    fallback_payload = dict(payload)
                    fallback_payload["generationConfig"] = auto_repair_generation_config(gen_cfg)
                    sent_payload = fallback_payload
                    async with httpx.AsyncClient(timeout=240) as client:
                        res = await client.post(url, headers=headers, json=fallback_payload)
                if res.status_code == 200:
                    try:
                        return await _lecture_digest_from_response(res, sent_payload, url, headers)
                    except Exception as parse_err:
                        last_err = AIError(str(parse_err))
                        continue
                if res.status_code in (401, 403, 429):
                    _raise_gemini_status_error(res.status_code, res.text)
                last_err = AIError(f"Model {model_cand} failed with {res.status_code}")
            raise last_err or AIError("مدلی برای تولید جزوه پاسخ نداد.")

        digest = await asyncio.wait_for(
            run_with_key_failover("gemini", gemini_keys, _process_key, label="web-lecture-pipeline"),
            timeout=_lecture_ai_deadline_sec(),
        )

        await _update_job(job_id, stage="pdf", status_text="در حال صفحه‌آرایی و ساخت PDF جزوه…")
        pdf_buffer = await asyncio.to_thread(generate_lecture_pdf, digest)
        out_bytes = pdf_buffer.getvalue()
        storage = get_storage_driver()
        await storage.save_original(f"lec_{job_id}", out_bytes)

        summary = {
            "title": digest.get("title") or "جزوه کلاسی",
            "subject": digest.get("subject") or "علوم پزشکی",
            "professor": digest.get("professor") or "",
            "session": digest.get("session") or "",
            "executive_summary": (digest.get("executive_summary") or "")[:1200],
            "topics_count": len(digest.get("topics") or []),
            "pearls_count": len(digest.get("clinical_pearls") or []),
            "traps_count": len(digest.get("exam_traps") or []),
            "qna_count": len(digest.get("qna_list") or []),
        }
        await _update_job(
            job_id,
            status="ready",
            stage="done",
            status_text="جزوه آماده دانلود و مطالعه است.",
            title=summary["title"],
            subject=summary["subject"],
            professor=summary["professor"],
            digest_summary=summary,
            pdf_ready=True,
            pdf_size=len(out_bytes),
        )
        quota_consumed = False
    except Exception as exc:
        logger.exception("web_lecture failed job=%s", job_id)
        if quota_consumed:
            try:
                await refund_lecture_quota(uid)
            except Exception:
                pass
        try:
            err_msg = re.sub(r"<[^>]+>", "", format_persian_lecture_error(exc)).strip()
        except Exception:
            err_msg = "تولید جزوه ناموفق بود؛ سهمیه شما برگردانده شد."
        await _update_job(job_id, status="failed", stage="error", status_text="ناموفق", error=err_msg[:500])
    finally:
        try:
            rel = ai_release_inflight(uid)
            if asyncio.iscoroutine(rel):
                await rel
        except Exception:
            pass


@router.get("/lecture/config")
async def web_lecture_config(user=Depends(require_feature("ai_chat"))):
    from backend.services.ai_solver import get_ai_config
    uid = int(user["id"])
    cfg = await get_ai_config()
    limit = int(cfg.get("lecture_daily_quota", 5) or 5)
    used = 0
    try:
        from backend.core.time_utils import today_tehran
        u = await db.users.find_one({"user_id": uid}, {"lecture_quota_date": 1, "lecture_quota_used": 1}) or {}
        if u.get("lecture_quota_date") == today_tehran().isoformat():
            used = int(u.get("lecture_quota_used") or 0)
    except Exception:
        used = 0
    admin_id = int(os.getenv("ADMIN_ID", "0") or 0)
    unlimited = uid == admin_id or limit <= 0
    return {
        "enabled": bool(cfg.get("enabled", True)),
        "daily_limit": limit,
        "used_today": used,
        "remaining_today": 999 if unlimited else max(0, limit - used),
        "unlimited": unlimited,
        "max_upload_mb": int(MAX_LECTURE_MEDIA_BYTES // (1024 * 1024)),
    }


@router.get("/lecture/jobs")
async def web_lecture_jobs(user=Depends(require_feature("ai_chat"))):
    uid = int(user["id"])
    docs = await _coll().find({"user_id": uid}).sort("created_at", -1).to_list(20)
    return {"jobs": [_serialize_job(d) for d in docs]}


@router.get("/lecture/jobs/{job_id}")
async def web_lecture_job_detail(job_id: str, user=Depends(require_feature("ai_chat"))):
    uid = int(user["id"])
    doc = await _coll().find_one({"_id": job_id, "user_id": uid})
    if not doc:
        raise HTTPException(status_code=404, detail="جزوه پیدا نشد.")
    return {"job": _serialize_job(doc)}


@router.post("/lecture/create")
async def web_lecture_create(
    audio: UploadFile | None = File(default=None),
    slides: UploadFile | None = File(default=None),
    notes: str = Form(default=""),
    user=Depends(require_feature("ai_chat")),
):
    from backend.services.ai_solver import (
        ai_claim_inflight,
        ai_release_inflight,
        check_and_consume_lecture_quota,
        refund_lecture_quota,
    )

    uid = int(user["id"])
    if audio is None and slides is None:
        raise HTTPException(status_code=422, detail="حداقل یک فایل صوتی/ویدیویی یا اسلاید PDF لازم است.")

    audio_bytes: Optional[bytes] = None
    audio_name = ""
    audio_mime = ""
    if audio is not None:
        audio_bytes = await audio.read(MAX_LECTURE_MEDIA_BYTES + 1)
        await audio.close()
        if len(audio_bytes) > MAX_LECTURE_MEDIA_BYTES:
            raise HTTPException(status_code=413, detail="حجم فایل صوتی/ویدیویی بیش از سقف مجاز است.")
        audio_name = audio.filename or "lecture.mp3"
        audio_mime = audio.content_type or ""

    pdf_bytes: Optional[bytes] = None
    pdf_name = ""
    if slides is not None:
        pdf_bytes = await slides.read(MAX_LECTURE_MEDIA_BYTES + 1)
        await slides.close()
        if len(pdf_bytes) > MAX_LECTURE_MEDIA_BYTES:
            raise HTTPException(status_code=413, detail="حجم فایل اسلاید بیش از سقف مجاز است.")
        if pdf_bytes[:5] != b"%PDF-":
            raise HTTPException(status_code=422, detail="فایل اسلاید باید با فرمت معتبر PDF باشد.")
        pdf_name = slides.filename or "slides.pdf"

    allowed, used, limit = await check_and_consume_lecture_quota(uid)
    if not allowed:
        raise HTTPException(status_code=429, detail=f"سهمیه روزانه جزوه‌نویس شما تکمیل شده است ({used}/{limit}).")

    if not await ai_claim_inflight(uid):
        await refund_lecture_quota(uid)
        raise HTTPException(status_code=409, detail="درخواست دیگری در حال پردازش است؛ لطفاً کمی صبر کنید.")

    job_id = f"lec_{uid}_{uuid.uuid4().hex[:10]}"
    now = _now_iso()
    title_hint = (pdf_name or audio_name or "جزوه جدید").rsplit(".", 1)[0][:80]
    try:
        await _coll().insert_one(
            {
                "_id": job_id,
                "user_id": uid,
                "title": title_hint,
                "subject": "",
                "professor": "",
                "status": "processing",
                "stage": "queued",
                "status_text": "در صف پردازش هوشیار…",
                "error": "",
                "pdf_ready": False,
                "pdf_size": 0,
                "digest_summary": {},
                "created_at": now,
                "updated_at": now,
            }
        )
    except Exception:
        await refund_lecture_quota(uid)
        await ai_release_inflight(uid)
        raise

    task = asyncio.create_task(
        _run_web_lecture_job(
            job_id=job_id,
            uid=uid,
            audio_bytes=audio_bytes,
            audio_name=audio_name,
            audio_mime=audio_mime,
            pdf_bytes=pdf_bytes,
            pdf_name=pdf_name,
            notes=notes,
            quota_consumed=True,
        )
    )
    _BG_TASKS.add(task)
    task.add_done_callback(_BG_TASKS.discard)
    return {"ok": True, "job_id": job_id, "status": "processing"}


@router.get("/lecture/jobs/{job_id}/pdf")
async def web_lecture_download_pdf(
    job_id: str,
    inline: int = Query(0),
    user=Depends(require_feature("ai_chat")),
):
    uid = int(user["id"])
    doc = await _coll().find_one({"_id": job_id, "user_id": uid})
    if not doc:
        raise HTTPException(status_code=404, detail="جزوه پیدا نشد.")
    storage = get_storage_driver()
    raw = await storage.get_original(f"lec_{job_id}")
    if not raw:
        raise HTTPException(status_code=404, detail="فایل PDF هنوز آماده نشده یا منقضی شده است.")
    disp = "inline" if inline else "attachment"
    return Response(
        content=raw,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'{disp}; filename="HumsYar-{job_id}.pdf"',
            "Cache-Control": "private, no-store",
        },
    )


@router.delete("/lecture/jobs/{job_id}")
async def web_lecture_delete_job(job_id: str, user=Depends(require_feature("ai_chat"))):
    uid = int(user["id"])
    res = await _coll().delete_one({"_id": job_id, "user_id": uid})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="جزوه پیدا نشد.")
    return {"ok": True}
