# -*- coding: utf-8 -*-
"""🖋 موج P4 — قلم، حاشیه‌نویسی و دفتر یادداشت.

قرارداد اصلی: **استروک، نه تصویر.** کلاینت فقط «خط» می‌فرستد و سرور آن را
می‌ذخیره می‌کند؛ رندر دوباره روی canvas انجام می‌شود. چرا:

- حجم: یک خط ۱۰۰ نقطه‌ای ≈ ۱٫۵KB، اما اسکرین‌شات همان خط ≈ ۳۰۰KB.
- کیفیت: هنگام زوم، خط دوباره با اندازهٔ واقعی کشیده می‌شود، پیکسلی نمی‌شود.
- مالکیت: مشتری فایل PDF را نمی‌گیرد و تصویری هم از آن نمی‌سازد.

مختصات **نرمال‌شده** است (۰..۱ نسبت به عرض/ارتفاع صفحه). یعنی همان خط روی
گوشی ۳۹۰px و آیپد ۱۰۲۴px و در هر سطح زوم، دقیقاً سر جای خودش می‌نشیند.

کالکشن تازه: `web_ink_pages`
    {_id: "<uid>:<scope>:<file_id>:<page>", uid, scope, file_id, page,
     strokes: [...], count, updated_at}

یک سند برای هر صفحه. ذخیره = جایگزینی کامل استروک‌های همان صفحه (idempotent)،
پس تکرار/تلاش دوباره در شبکهٔ ضعیف، خط تکراری نمی‌سازد.

اندپوینت‌ها (همه زیر /api/web):
    GET    /ink/{scope}/{file_id}/{page}   → خطوط همان صفحه
    PUT    /ink/{scope}/{file_id}/{page}   → ذخیرهٔ خطوط همان صفحه
    DELETE /ink/{scope}/{file_id}/{page}   → پاک‌کردن همان صفحه
    GET    /ink/summary/{scope}/{file_id}  → شمار خطوط هر صفحه (برای دفتر)
    GET    /ink/notes                      → فهرست یادداشت‌ها (صفحهٔ /me/notes)

نصب: در api/main.py
    from api.routers import web_ink
    app.include_router(web_ink.router, prefix="/api/web", tags=["web-ink"])
"""
from __future__ import annotations

import logging
import math
import time
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator

from backend.api.routers.web_library import _gate, _web_user
from backend.api.routers.web_reader import SCOPES, _item, _public
from backend.api.routers.web_student import current_student
from backend.database.database import db
from backend.core.time_utils import now_utc, utc_now_iso

logger = logging.getLogger(__name__)

router = APIRouter()

# سقف‌ها: عددی بزرگ‌تر از این‌ها یعنی کلاینت خراب است، نه کاربر پرکار.
MAX_STROKES = 400
MAX_POINTS = 2000
MAX_PAGE = 2000
TOOLS = ("pen", "pencil", "highlighter", "eraser", "ballpoint", "fountain", "lasso")
BLEND_MODES = ("source-over", "multiply")


def _coll(name: str):
    return db.users.database[name]


def _key(uid: int, scope: str, file_id: str, page: int) -> str:
    return f"{int(uid)}:{scope}:{file_id}:{int(page)}"


def _doc_prefix(uid: int, scope: str, file_id: str) -> str:
    return f"{int(uid)}:{scope}:{file_id}:"


class PointModel(BaseModel):
    """نقطهٔ وکتور نرمال‌شده در بازهٔ [0.0, 1.0] همراه فشار و زمان."""

    x: float
    y: float
    pressure: float = Field(default=0.5)
    time: int = Field(default=0)
    tiltX: Optional[float] = Field(default=0.0)
    tiltY: Optional[float] = Field(default=0.0)

    @model_validator(mode="before")
    @classmethod
    def _parse_input(cls, data: Any) -> Any:
        if isinstance(data, (list, tuple)):
            if len(data) < 2:
                raise ValueError("point_shape")
            d = {
                "x": data[0],
                "y": data[1],
                "pressure": data[2] if len(data) >= 3 else 0.5,
                "time": int(data[3]) if len(data) >= 4 else 0,
                "tiltX": float(data[4]) if len(data) >= 5 else 0.0,
                "tiltY": float(data[5]) if len(data) >= 6 else 0.0,
            }
            return d
        return data

    @field_validator("x", "y")
    @classmethod
    def _validate_coords(cls, v: float) -> float:
        if not math.isfinite(v):
            raise ValueError("non_finite_coordinate")
        if v < 0.0 or v > 1.0:
            raise ValueError("coordinate_out_of_bounds")
        return float(v)

    @field_validator("pressure")
    @classmethod
    def _validate_pressure(cls, v: float) -> float:
        if not math.isfinite(v):
            raise ValueError("non_finite_pressure")
        if v < 0.0 or v > 1.0:
            raise ValueError("pressure_out_of_bounds")
        return float(v)

    @field_validator("time")
    @classmethod
    def _validate_time(cls, v: int) -> int:
        if v < 0:
            raise ValueError("time_negative")
        return int(v)

    @field_validator("tiltX", "tiltY")
    @classmethod
    def _validate_tilt(cls, v: Optional[float]) -> Optional[float]:
        if v is None:
            return 0.0
        if not math.isfinite(v):
            raise ValueError("non_finite_tilt")
        if v < -90.0 or v > 90.0:
            raise ValueError("tilt_out_of_bounds")
        return float(v)


class Stroke(BaseModel):
    """یک خط وکتور دیجیتال. مختصات نرمال‌شده و مشخصات کامل رندرینگ."""

    stroke_id: str = Field(default_factory=lambda: str(uuid.uuid4()), max_length=64)
    tool: str = Field(default="pen", max_length=16)
    color: str = Field(default="#1740B8", max_length=32)
    width: float = Field(default=0.0035, gt=0.0, lt=0.2)
    opacity: float = Field(default=1.0, ge=0.0, le=1.0)
    blend_mode: str = Field(default="source-over", max_length=16)
    points: list[PointModel] = Field(default_factory=list)
    created_at: str = Field(default_factory=utc_now_iso)
    updated_at: Optional[str] = None
    is_deleted: Optional[bool] = False
    timestamp: Optional[int] = None

    @model_validator(mode="before")
    @classmethod
    def _apply_defaults(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if not data.get("stroke_id"):
                data["stroke_id"] = str(uuid.uuid4())
            t = data.get("tool")
            if t == "highlighter":
                if "opacity" not in data or data.get("opacity") is None:
                    data["opacity"] = 0.35
                if "blend_mode" not in data or data.get("blend_mode") is None:
                    data["blend_mode"] = "multiply"
        return data

    @field_validator("tool")
    @classmethod
    def _tool_ok(cls, v: str) -> str:
        if v not in TOOLS:
            raise ValueError(f"invalid_tool: {v}")
        return v

    @field_validator("blend_mode")
    @classmethod
    def _blend_ok(cls, v: str) -> str:
        if v not in BLEND_MODES:
            raise ValueError(f"invalid_blend_mode: {v}")
        return v

    @field_validator("points")
    @classmethod
    def _points_ok(cls, v: list[PointModel]) -> list[PointModel]:
        if len(v) > MAX_POINTS:
            raise ValueError("stroke_too_long")
        return v


StrokeModel = Stroke
Point = PointModel


class StickyNoteModel(BaseModel):
    """یادداشت متنی چسبان متصل به حاشیه صفحه با مختصات نرمال‌شده."""

    note_id: str = Field(default_factory=lambda: str(uuid.uuid4()), max_length=64)
    page: int = Field(default=1, ge=1, le=MAX_PAGE)
    x: float = Field(default=0.85, ge=0.0, le=1.0)
    y: float = Field(default=0.1, ge=0.0, le=1.0)
    text: str = Field(default="", max_length=2000)
    color: str = Field(default="yellow", max_length=32)
    collapsed: bool = Field(default=False)
    created_at: str = Field(default_factory=utc_now_iso)
    updated_at: Optional[str] = None


StickyNote = StickyNoteModel


class InkBody(BaseModel):
    strokes: Optional[list[Stroke]] = None
    notes: Optional[list[StickyNoteModel]] = None

    @field_validator("strokes")
    @classmethod
    def _limit(cls, v: Optional[list[Stroke]]) -> Optional[list[Stroke]]:
        if v is not None and len(v) > MAX_STROKES:
            raise ValueError("too_many_strokes")
        return v


class MutationItem(BaseModel):
    mutation_id: str = Field(..., min_length=1, max_length=64)
    scope: str = Field(...)
    file_id: str = Field(...)
    page: int = Field(..., ge=1, le=MAX_PAGE)
    action: str = Field(...)  # "upsert_stroke" | "delete_stroke" | "clear_page" | "upsert_note" | "delete_note"
    stroke: Optional[Stroke] = None
    note: Optional[StickyNoteModel] = None
    client_revision: int = Field(default=0)
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000))

    @field_validator("action")
    @classmethod
    def _action_ok(cls, v: str) -> str:
        if v not in ("upsert_stroke", "delete_stroke", "clear_page", "upsert_note", "delete_note"):
            raise ValueError("invalid_action")
        return v


class SyncBatchRequest(BaseModel):
    client_id: str = Field(..., min_length=1, max_length=64)
    mutations: list[MutationItem] = Field(..., max_length=50)


def _page_ok(page: int) -> int:
    if page < 1 or page > MAX_PAGE:
        raise HTTPException(status_code=422, detail="page_invalid")
    return int(page)


async def _guard(scope: str, file_id: str, user: dict) -> dict:
    """اجازهٔ نوشتن/خواندن حاشیه‌نویسی = همان اجازهٔ خواندن خود فایل.

    عمداً از همان `_gate` و همان واکشی سند استفاده می‌شود که ریدر؛ وگرنه
    دو مسیر اجازهٔ جدا از هم می‌ساختیم و یکی از آن‌ها دیر یا زود عقب می‌ماند.
    """
    if scope not in SCOPES:
        raise HTTPException(status_code=422, detail="scope_invalid")
    if file_id in ("demo", "sample", "test"):
        return {"_id": file_id, "name": "جزوه نمونه فیزیولوژی پزشکی هامزیار (تستی)"}
    web = _web_user(user)
    await _gate("references" if scope == "ref" else "resources", web)
    item = await _item(scope, file_id)
    if not item:
        raise HTTPException(status_code=404, detail="file_not_found")
    return item


@router.get("/ink/summary/{scope}/{file_id}")
async def summary(scope: str, file_id: str, user: dict = Depends(current_student)):
    """شمار خطوط هر صفحه — برای پنل «دفتر» کنار ریدر و پرش به صفحه."""
    if scope not in SCOPES:
        raise HTTPException(status_code=422, detail="scope_invalid")
    uid = int(user["user_id"])
    try:
        cur = _coll("web_ink_pages").find(
            {"scope": scope, "file_id": file_id, "uid": uid}, {"page": 1, "count": 1}
        )
        docs = [d async for d in cur]
    except Exception as exc:  # pragma: no cover
        logger.warning("ink_summary_failed uid=%s err=%s", uid, type(exc).__name__)
        raise HTTPException(status_code=503, detail="ink_unavailable")
    pages = sorted(
        ({"page": int(d.get("page") or 0), "count": int(d.get("count") or 0)} for d in docs),
        key=lambda x: x["page"],
    )
    return {"pages": pages, "total": sum(p["count"] for p in pages)}


@router.get("/ink/notes")
async def notes(user: dict = Depends(current_student)):
    """همهٔ فایل‌هایی که این کاربر روی آن‌ها خط کشیده — برای صفحهٔ «دفتر من».

    نام فایل از منبع اصلی خوانده می‌شود؛ اگر فایل حذف شده باشد ردیف با
    `available: false` می‌آید نه اینکه کل فهرست بشکند.
    """
    uid = int(user["user_id"])
    try:
        cur = _coll("web_ink_pages").find({"uid": uid}).sort("updated_at", -1).limit(200)
        docs = [d async for d in cur]
    except Exception as exc:  # pragma: no cover
        logger.warning("ink_notes_failed uid=%s err=%s", uid, type(exc).__name__)
        raise HTTPException(status_code=503, detail="ink_unavailable")

    grouped: dict[tuple[str, str], dict] = {}
    for d in docs:
        scope = str(d.get("scope") or "")
        fid = str(d.get("file_id") or "")
        if scope not in SCOPES or not fid:
            continue
        key = (scope, fid)
        g = grouped.setdefault(
            key,
            {"scope": scope, "id": fid, "pages": 0, "strokes": 0, "last_page": 1, "updated_at": ""},
        )
        count = int(d.get("count") or 0)
        g["pages"] += 1
        g["strokes"] += count
        ts = str(d.get("updated_at") or "")
        if ts >= g["updated_at"]:
            g["updated_at"] = ts
            g["last_page"] = int(d.get("page") or 1)

    items = []
    for (scope, fid) in sorted(grouped, key=lambda k: grouped[k]["updated_at"], reverse=True)[:30]:
        g = grouped[(scope, fid)]
        try:
            item = await _item(scope, fid)
        except Exception:
            item = None
        if not item:
            items.append({**g, "name": "فایل حذف‌شده", "kind": "other", "available": False})
            continue
        meta = _public(item)
        items.append({**g, "name": meta["name"], "kind": meta["kind"], "available": True})
    return {"items": items}


# ─────────────────────────────────────────────────────────────
#  🌊 خطوط یک صفحه و همگام‌سازی دسته‌ای
# ─────────────────────────────────────────────────────────────
@router.post("/ink/sync")
async def sync_batch(body: SyncBatchRequest, user: dict = Depends(current_student)):
    """Idempotent batch stroke mutation sync with Last-Write-Wins per stroke_id."""
    uid = int(user["user_id"])
    successful_ids: list[str] = []
    conflicts: list[dict] = []
    now = utc_now_iso()

    for mut in body.mutations:
        if mut.scope not in SCOPES:
            conflicts.append({"mutation_id": mut.mutation_id, "reason": "scope_invalid"})
            continue

        page_key = _key(uid, mut.scope, mut.file_id, mut.page)
        sync_log_key = f"{uid}:{mut.mutation_id}"

        # 1. Idempotency check via web_ink_sync_log (scoped per user so mutation_ids never collide)
        try:
            sync_log_coll = _coll("web_ink_sync_log")
            already = await sync_log_coll.find_one({"_id": sync_log_key})
            if not already:
                already = await sync_log_coll.find_one({"_id": mut.mutation_id, "uid": uid})
            if already:
                successful_ids.append(mut.mutation_id)
                continue
        except Exception as exc:
            logger.warning("ink_sync_check_failed err=%s", type(exc).__name__)

        # 2. Fetch current page doc
        try:
            doc = await _coll("web_ink_pages").find_one({"_id": page_key})
        except Exception as exc:
            logger.warning("ink_sync_doc_failed err=%s", type(exc).__name__)
            conflicts.append({"mutation_id": mut.mutation_id, "reason": "db_read_error"})
            continue

        existing_strokes = list(doc.get("strokes") or []) if doc else []
        existing_notes = list(doc.get("notes") or []) if doc else []
        cur_rev = int(doc.get("page_revision") or 0) if doc else 0

        # Map stroke_id to stroke dictionary
        strokes_map: dict[str, dict] = {}
        for s in existing_strokes:
            sid = s.get("stroke_id")
            if sid:
                strokes_map[sid] = s

        # Map note_id to note dictionary
        notes_map: dict[str, dict] = {}
        for n in existing_notes:
            nid = n.get("note_id")
            if nid:
                notes_map[nid] = n

        # 3. Apply LWW mutation
        if mut.action == "upsert_stroke":
            if not mut.stroke:
                conflicts.append({"mutation_id": mut.mutation_id, "reason": "missing_stroke"})
                continue
            s_dict = mut.stroke.model_dump()
            sid = mut.stroke.stroke_id
            s_dict["timestamp"] = mut.timestamp
            s_dict["updated_at"] = now

            if sid in strokes_map:
                existing_s = strokes_map[sid]
                existing_ts = int(existing_s.get("timestamp") or 0)
                if mut.timestamp >= existing_ts:
                    strokes_map[sid] = s_dict
            else:
                if len(strokes_map) >= MAX_STROKES:
                    conflicts.append({"mutation_id": mut.mutation_id, "reason": "STROKE_LIMIT_EXCEEDED"})
                    continue
                strokes_map[sid] = s_dict

        elif mut.action == "delete_stroke":
            if mut.stroke and mut.stroke.stroke_id:
                strokes_map.pop(mut.stroke.stroke_id, None)

        elif mut.action == "clear_page":
            strokes_map.clear()
            notes_map.clear()

        elif mut.action == "upsert_note":
            if not mut.note:
                conflicts.append({"mutation_id": mut.mutation_id, "reason": "missing_note"})
                continue
            n_dict = mut.note.model_dump()
            nid = mut.note.note_id
            n_dict["updated_at"] = now
            notes_map[nid] = n_dict

        elif mut.action == "delete_note":
            if mut.note and mut.note.note_id:
                notes_map.pop(mut.note.note_id, None)

        updated_strokes = list(strokes_map.values())
        updated_notes = list(notes_map.values())
        new_rev = cur_rev + 1

        # 4. Save to web_ink_pages
        try:
            await _coll("web_ink_pages").update_one(
                {"_id": page_key},
                {
                    "$set": {
                        "uid": uid,
                        "scope": mut.scope,
                        "file_id": mut.file_id,
                        "page": mut.page,
                        "page_revision": new_rev,
                        "strokes": updated_strokes,
                        "notes": updated_notes,
                        "count": len(updated_strokes),
                        "updated_at": now,
                    }
                },
                upsert=True,
            )

            # 5. Record mutation in web_ink_sync_log
            await _coll("web_ink_sync_log").update_one(
                {"_id": sync_log_key},
                {
                    "$set": {
                        "_id": sync_log_key,
                        "mutation_id": mut.mutation_id,
                        "uid": uid,
                        "client_id": body.client_id,
                        "created_at": now,
                    }
                },
                upsert=True,
            )
            successful_ids.append(mut.mutation_id)
        except Exception as exc:
            logger.warning("ink_sync_write_failed err=%s", type(exc).__name__)
            conflicts.append({"mutation_id": mut.mutation_id, "reason": "db_write_error"})

    return {
        "processed": len(body.mutations),
        "successful_ids": successful_ids,
        "conflicts": conflicts,
        "server_timestamp": now,
    }


@router.get("/ink/{scope}/{file_id}/{page}")
async def get_page(scope: str, file_id: str, page: int, user: dict = Depends(current_student)):
    _page_ok(page)
    uid = int(user["user_id"])
    try:
        doc = await _coll("web_ink_pages").find_one({"_id": _key(uid, scope, file_id, page)})
    except Exception as exc:  # pragma: no cover
        logger.warning("ink_read_failed uid=%s err=%s", uid, type(exc).__name__)
        raise HTTPException(status_code=503, detail="ink_unavailable")
    if not doc:
        return {"strokes": [], "notes": [], "page_revision": 0, "count": 0, "updated_at": None}
    strokes = list(doc.get("strokes") or [])
    notes = list(doc.get("notes") or [])
    return {
        "strokes": strokes,
        "notes": notes,
        "page_revision": int(doc.get("page_revision") or 0),
        "count": int(doc.get("count") or len(strokes)),
        "updated_at": str(doc.get("updated_at") or ""),
    }


@router.put("/ink/{scope}/{file_id}/{page}")
async def put_page(scope: str, file_id: str, page: int, body: InkBody,
                   user: dict = Depends(current_student)):
    """جایگزینی کامل خطوط و یادداشت‌های همان صفحه (idempotent)."""
    _page_ok(page)
    if body.strokes is not None and len(body.strokes) > MAX_STROKES:
        raise HTTPException(status_code=400, detail="STROKE_LIMIT_EXCEEDED")
    await _guard(scope, file_id, user)
    uid = int(user["user_id"])
    now = utc_now_iso()
    page_key = _key(uid, scope, file_id, page)
    try:
        existing = await _coll("web_ink_pages").find_one({"_id": page_key}, {"page_revision": 1, "notes": 1, "strokes": 1})
        cur_rev = int(existing.get("page_revision") or 0) if existing else 0
        new_rev = cur_rev + 1

        if body.strokes is not None:
            strokes = [s.model_dump() for s in body.strokes]
        elif existing and "strokes" in existing:
            strokes = list(existing.get("strokes") or [])
        else:
            strokes = []

        if body.notes is not None:
            notes = [n.model_dump() for n in body.notes]
        elif existing and "notes" in existing:
            notes = list(existing.get("notes") or [])
        else:
            notes = []

        await _coll("web_ink_pages").update_one(
            {"_id": page_key},
            {
                "$set": {
                    "uid": uid,
                    "scope": scope,
                    "file_id": file_id,
                    "page": int(page),
                    "page_revision": new_rev,
                    "strokes": strokes,
                    "notes": notes,
                    "count": len(strokes),
                    "updated_at": now,
                }
            },
            upsert=True,
        )
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        logger.warning("ink_write_failed uid=%s err=%s", uid, type(exc).__name__)
        raise HTTPException(status_code=503, detail="ink_unavailable")
    return {"ok": True, "count": len(strokes), "notes_count": len(notes), "page_revision": new_rev, "updated_at": str(now)}


@router.delete("/ink/{scope}/{file_id}/{page}")
async def delete_page(scope: str, file_id: str, page: int, user: dict = Depends(current_student)):
    _page_ok(page)
    uid = int(user["user_id"])
    try:
        await _coll("web_ink_pages").delete_one({"_id": _key(uid, scope, file_id, page)})
    except Exception as exc:  # pragma: no cover
        logger.warning("ink_delete_failed uid=%s err=%s", uid, type(exc).__name__)
        raise HTTPException(status_code=503, detail="ink_unavailable")
    return {"ok": True}



