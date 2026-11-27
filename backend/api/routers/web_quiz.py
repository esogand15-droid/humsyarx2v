# -*- coding: utf-8 -*-
"""📚 آزمون‌ساز هوشمند از روی PDF در وب‌اپ — روی همان سرویس hooshyar_quiz و DBAiQuiz."""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from backend.api.auth import require_feature
from backend.database.database import db
from backend.services import hooshyar_quiz

logger = logging.getLogger(__name__)
router = APIRouter()


def _serialize_doc(d: dict) -> dict:
    return {
        "id": str(d.get("_id") or ""),
        "name": d.get("name") or "سند PDF",
        "status": d.get("status") or "processing",
        "error": d.get("error") or "",
        "size_bytes": int(d.get("size_bytes") or 0),
        "page_count": int(d.get("page_count") or 0),
        "quality": float(d.get("quality") or 0.0),
        "quality_note": d.get("quality_note") or "",
        "topics": d.get("topics") or [],
        "created_at": str(d.get("created_at") or ""),
    }


def _sanitize_question(q: dict, reveal_answer: bool = False) -> dict:
    out: dict[str, Any] = {
        "id": str(q.get("_id") or ""),
        "order_index": int(q.get("order_index") or 0),
        "stem": q.get("stem") or "",
        "options": q.get("options") or [],
        "topic_title": q.get("topic_title") or "",
        "difficulty": q.get("difficulty") or "medium",
        "page_refs": q.get("page_refs") or [],
        "status": q.get("status") or "queued",
        "answered_option": q.get("answered_option"),
        "is_correct": q.get("is_correct"),
    }
    if reveal_answer or q.get("status") == "answered":
        out["correct_index"] = int(q.get("correct_index") or 0)
        out["explanation_short"] = q.get("explanation_short") or ""
        out["explanation_long"] = q.get("explanation_long") or ""
        out["source_evidence"] = q.get("source_evidence") or ""
    return out


def _serialize_session(s: dict) -> dict:
    return {
        "id": str(s.get("_id") or ""),
        "doc_id": str(s.get("doc_id") or ""),
        "doc_name": s.get("doc_name") or "",
        "status": s.get("status") or "active",
        "total_planned": int(s.get("total_planned") or 0),
        "answered": int(s.get("answered") or 0),
        "correct": int(s.get("correct") or 0),
        "wrong": int(s.get("wrong") or 0),
        "settings": s.get("settings") or {},
        "created_at": str(s.get("created_at") or ""),
        "finished_at": s.get("finished_at"),
    }


@router.get("/quiz/config")
async def web_quiz_config(user=Depends(require_feature("ai_practice"))):
    uid = int(user["id"])
    enabled = bool(await hooshyar_quiz._setting("quiz_pdf_enabled"))
    max_mb = int(await hooshyar_quiz._setting("quiz_max_pdf_mb"))
    max_pages = int(await hooshyar_quiz._setting("quiz_max_pages"))
    max_per_session = int(await hooshyar_quiz._setting("quiz_max_questions_per_session"))
    daily_limit = int(await hooshyar_quiz._setting("quiz_daily_question_limit"))
    used_today = await db.quiz_usage_today(uid)
    return {
        "enabled": enabled,
        "max_pdf_mb": max_mb,
        "max_pages": max_pages,
        "max_questions_per_session": max_per_session,
        "daily_limit": daily_limit,
        "used_today": used_today,
        "remaining_today": max(0, daily_limit - used_today) if daily_limit > 0 else 999,
    }


@router.get("/quiz/docs")
async def web_quiz_list_docs(user=Depends(require_feature("ai_practice"))):
    uid = int(user["id"])
    docs = await db.quiz_list_documents(uid, limit=25)
    return {"docs": [_serialize_doc(d) for d in docs]}


@router.post("/quiz/upload")
async def web_quiz_upload(
    file: UploadFile = File(...),
    user=Depends(require_feature("ai_practice")),
):
    uid = int(user["id"])
    if not bool(await hooshyar_quiz._setting("quiz_pdf_enabled")):
        raise HTTPException(status_code=403, detail="آزمون‌ساز از روی PDF موقتاً غیرفعال است.")

    max_docs = int(await hooshyar_quiz._setting("quiz_max_docs_per_user"))
    existing = await db.quiz_list_documents(uid, limit=max_docs + 1)
    if len(existing) >= max_docs:
        raise HTTPException(
            status_code=409,
            detail=f"حداکثر {max_docs} فایل PDF قابل نگهداری است؛ لطفاً ابتدا یکی از فایل‌های قبلی را حذف کنید.",
        )

    max_mb = int(await hooshyar_quiz._setting("quiz_max_pdf_mb"))
    max_bytes = max_mb * 1024 * 1024
    raw = await file.read(max_bytes + 1)
    if not raw:
        raise HTTPException(status_code=422, detail="فایل خالی است.")
    if len(raw) > max_bytes:
        raise HTTPException(status_code=413, detail=f"حجم فایل نباید بیشتر از {max_mb} مگابایت باشد.")
    if raw[:5] != b"%PDF-":
        raise HTTPException(status_code=422, detail="فقط فایل PDF معتبر پشتیبانی می‌شود.")

    doc_id = await db.quiz_create_document(
        owner_id=uid,
        name=file.filename or "جزوه.pdf",
        size_bytes=len(raw),
        source="webapp",
    )
    asyncio.create_task(hooshyar_quiz.process_document(None, doc_id, uid, raw))
    return {"ok": True, "doc_id": str(doc_id), "status": "processing"}


@router.get("/quiz/docs/{doc_id}")
async def web_quiz_get_doc(doc_id: str, user=Depends(require_feature("ai_practice"))):
    uid = int(user["id"])
    doc = await db.quiz_get_document(doc_id, owner_id=uid)
    if not doc:
        raise HTTPException(status_code=404, detail="سند پیدا نشد.")
    return {"doc": _serialize_doc(doc)}


@router.delete("/quiz/docs/{doc_id}")
async def web_quiz_delete_doc(doc_id: str, user=Depends(require_feature("ai_practice"))):
    uid = int(user["id"])
    deleted = await db.quiz_delete_document(doc_id, uid)
    if not deleted:
        raise HTTPException(status_code=404, detail="سند پیدا نشد.")
    return {"ok": True}


class QuizStartBody(BaseModel):
    doc_id: str = Field(..., min_length=12, max_length=64)
    topic_id: Optional[int] = None
    page_from: Optional[int] = Field(default=None, ge=1)
    page_to: Optional[int] = Field(default=None, ge=1)
    count: int = Field(default=10, ge=3, le=40)
    difficulty: str = Field(default="mixed", pattern="^(easy|medium|hard|mixed)$")


@router.post("/quiz/sessions/start")
async def web_quiz_start_session(
    body: QuizStartBody,
    user=Depends(require_feature("ai_practice")),
):
    uid = int(user["id"])
    doc = await db.quiz_get_document(body.doc_id, owner_id=uid)
    if not doc:
        raise HTTPException(status_code=404, detail="سند PDF پیدا نشد.")
    if doc.get("status") != "ready":
        raise HTTPException(status_code=409, detail="سند هنوز آماده نشده یا پردازش آن ناموفق بوده است.")

    daily_limit = int(await hooshyar_quiz._setting("quiz_daily_question_limit"))
    used_today = await db.quiz_usage_today(uid)
    if daily_limit > 0 and used_today >= daily_limit:
        raise HTTPException(status_code=429, detail="سقف تولید سؤال امروز شما تکمیل شده است.")

    max_sess = int(await hooshyar_quiz._setting("quiz_max_questions_per_session"))
    want = min(int(body.count), max_sess)
    if daily_limit > 0:
        want = min(want, max(1, daily_limit - used_today))

    pages = doc.get("pages") or []
    topics = doc.get("topics") or []
    total_pages = len(pages)
    if body.page_from is not None and body.page_to is not None:
        p1 = max(1, min(body.page_from, total_pages))
        p2 = max(p1, min(body.page_to, total_pages))
        target_topic = {"id": -1, "title": f"صفحات {p1} تا {p2}", "page_start": p1, "page_end": p2}
    elif body.topic_id is not None:
        matched = next((t for t in topics if int(t.get("id", -1)) == int(body.topic_id)), None)
        if not matched:
            raise HTTPException(status_code=404, detail="مبحث انتخاب‌شده یافت نشد.")
        target_topic = matched
    else:
        target_topic = {
            "id": 0,
            "title": "کل جزوه",
            "page_start": 1,
            "page_end": max(1, total_pages),
        }

    generated = await hooshyar_quiz.generate_questions_for_topic(
        doc,
        target_topic,
        want=want,
        user_id=uid,
        difficulty=body.difficulty,
    )
    if not generated:
        raise HTTPException(
            status_code=422,
            detail="سؤال معتبری از این محدوده استخراج نشد؛ بازه صفحات یا مبحث دیگری را امتحان کنید.",
        )

    settings = {
        "mode": "web_interactive",
        "count": len(generated),
        "difficulty": body.difficulty,
        "topic_id": target_topic.get("id"),
        "topic_title": target_topic.get("title"),
        "page_start": target_topic.get("page_start"),
        "page_end": target_topic.get("page_end"),
    }
    sid = await db.quiz_create_session(uid, doc, settings)
    await db.quiz_add_questions(sid, uid, doc["_id"], generated)
    await db.quiz_update_session(sid, {"status": "active", "total_planned": len(generated), "sent": len(generated)})
    await db.quiz_inc_usage(uid, len(generated))

    return {
        "ok": True,
        "session_id": str(sid),
        "doc_name": doc.get("name", ""),
        "topic_title": target_topic.get("title", ""),
        "total": len(generated),
    }


@router.get("/quiz/sessions")
async def web_quiz_list_sessions(user=Depends(require_feature("ai_practice"))):
    uid = int(user["id"])
    rows = await db.ai_quiz_sessions.find({"user_id": uid}).sort("created_at", -1).to_list(20)
    return {"sessions": [_serialize_session(r) for r in rows]}


@router.get("/quiz/sessions/{session_id}")
async def web_quiz_get_session(session_id: str, user=Depends(require_feature("ai_practice"))):
    uid = int(user["id"])
    sess = await db.quiz_get_session(session_id)
    if not sess or int(sess.get("user_id") or 0) != uid:
        raise HTTPException(status_code=404, detail="نشست آزمون پیدا نشد.")
    qs = await db.quiz_session_questions(session_id)
    finished = sess.get("status") == "finished"
    return {
        "session": _serialize_session(sess),
        "questions": [_sanitize_question(q, reveal_answer=finished) for q in qs],
    }


class QuizAnswerBody(BaseModel):
    question_id: str = Field(..., min_length=12, max_length=64)
    selected: int = Field(..., ge=0, le=3)
    time_ms: Optional[int] = Field(default=None, ge=0)


@router.post("/quiz/sessions/{session_id}/answer")
async def web_quiz_answer_question(
    session_id: str,
    body: QuizAnswerBody,
    user=Depends(require_feature("ai_practice")),
):
    uid = int(user["id"])
    sess = await db.quiz_get_session(session_id)
    if not sess or int(sess.get("user_id") or 0) != uid:
        raise HTTPException(status_code=404, detail="نشست آزمون پیدا نشد.")
    if not ObjectId.is_valid(body.question_id):
        raise HTTPException(status_code=422, detail="شناسه سؤال نامعتبر است.")

    # برای وب‌اپ نیازی به telegram poll نیست؛ اگر status='queued' باشد، به‌صورت اتمیک به 'sent' می‌آوریم.
    await db.ai_quiz_questions.update_one(
        {"_id": ObjectId(body.question_id), "session_id": ObjectId(session_id), "user_id": uid, "status": "queued"},
        {"$set": {"status": "sent"}},
    )
    status_res, prev_q = await db.quiz_record_answer(body.question_id, body.selected, body.time_ms)
    if status_res == "stale":
        raise HTTPException(status_code=409, detail="این سؤال قابل پاسخ‌گویی نیست.")

    updated_q = await db.ai_quiz_questions.find_one({"_id": ObjectId(body.question_id)})
    if not updated_q or int(updated_q.get("user_id") or 0) != uid:
        raise HTTPException(status_code=404, detail="سؤال پیدا نشد.")

    is_correct = bool(updated_q.get("is_correct"))
    if status_res == "first":
        await db.quiz_update_session(
            session_id,
            inc={"answered": 1, "correct": 1 if is_correct else 0, "wrong": 0 if is_correct else 1},
        )
        sess = await db.quiz_get_session(session_id) or sess
        total_qs = int(sess.get("total_planned") or 0)
        if total_qs > 0 and int(sess.get("answered") or 0) >= total_qs:
            await db.quiz_finish_session(session_id, status="finished")
            sess["status"] = "finished"

    return {
        "ok": True,
        "duplicate": status_res == "dup",
        "question": _sanitize_question(updated_q, reveal_answer=True),
        "session": _serialize_session(sess),
    }
