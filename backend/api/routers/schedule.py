"""Class and exam schedule endpoints."""

from typing import Any, Literal, Mapping

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from api.auth import get_current_user, require_perm
from database import db
from time_utils import parse_gregorian_date, utc_now_iso
from utils import now_tehran



router = APIRouter()

ScheduleType = Literal[
    "class",
    "exam",
    "makeup",
]


def _text(
    value: Any,
) -> str:
    if value is None:
        return ""

    return str(value).strip()


def _format_schedule(
    item: Mapping[str, Any] | None,
) -> dict | None:
    if not isinstance(item, Mapping):
        return None

    schedule_type = _text(
        item.get("type")
    )

    raw_date = _text(
        item.get("date")
    )

    document = {
        "id": _text(
            item.get("_id")
        ),

        "type": schedule_type,

        "lesson": _text(
            item.get("lesson")
        ),

        "teacher": _text(
            item.get("teacher")
        ),

        "date": raw_date,

        "time": _text(
            item.get("time")
        ),

        "end_time": _text(
            item.get("end_time") or item.get("time_end")
        ),

        "location": _text(
            item.get("location")
        ),

        # رکوردهای جدید از notes و بعضی
        # رکوردهای قدیمی از note استفاده می‌کنند.
        "note": _text(
            item.get("notes")
            or item.get("note")
        ),

        "group": _text(
            item.get("group")
        ),

        "educational_group": _text(
            item.get("educational_group") or "mixed"
        ),

        "course_code": _text(
            item.get("course_code")
        ),

        "term": _text(
            item.get("term")
        ),

        "flex_type": (
            _text(
                item.get("flex_type")
            )
            or "fixed"
        ),

        "flex_note": _text(
            item.get("flex_note")
        ),

        "days_left": None,
    }

    if (
        schedule_type == "exam"
        and raw_date
    ):
        try:
            exam_date = parse_gregorian_date(raw_date)

            document["days_left"] = max(
                0,
                (
                    exam_date
                    - now_tehran().date()
                ).days,
            )

        except (
            TypeError,
            ValueError,
        ):
            document["days_left"] = None

    return document


def _serialize(
    items: Any,
) -> list[dict]:
    result = []

    if not isinstance(items, list):
        return result

    for item in items:
        formatted = _format_schedule(
            item
        )

        if formatted is not None:
            result.append(formatted)

    return result


def _clamp_since(value: str | None) -> str | None:
    """📅 «از اول همین هفته» برای برنامهٔ هفتگی وباپ (شنبه تا امروز).

    فقط تاریخ میلادی YYYY-MM-DD پذیرفته میشود و حداکثر ۷ روز عقب؛
    هر چیز دیگر نادیده گرفته میشود (همان رفتار قبلی: از امروز).
    """
    if not value:
        return None
    try:
        day = parse_gregorian_date(str(value).strip())
    except (TypeError, ValueError):
        return None
    today = now_tehran().date()
    if day >= today:
        return None
    from datetime import timedelta
    return max(day, today - timedelta(days=7)).isoformat()


@router.get("")
async def get_schedule(
    user=Depends(get_current_user),

    stype: ScheduleType | None = Query(
        default=None
    ),
    since: str | None = Query(default=None, max_length=10),
):
    personalized = await db.get_personalized_schedules(
        user["id"],
        stype=stype,
        upcoming=True,
        since=_clamp_since(since),
    )
    items = personalized.get("items") or []
    eff_group = personalized.get("computed_group") or _text(user["_db"].get("group")) or "1"

    return {
        "schedule": _serialize(items),
        "group": eff_group,
        "computed_group": eff_group,
        "registered_group": personalized.get("registered_group") or eff_group,
        "educational_group": personalized.get("educational_group") or "unknown",
        "educational_group_info": personalized.get("educational_group_info") or {},
        "needs_educational_group_confirmation": bool(personalized.get("needs_educational_group_confirmation")),
        "mismatched_selections": personalized.get("mismatched_selections") or [],
        "has_custom_selection": bool(personalized.get("has_custom_selection")),
        "selected_count": int(personalized.get("selected_count") or 0),
        "total_offered_count": int(personalized.get("total_offered_count") or 0),
        "unselected_lessons": personalized.get("unselected_lessons") or [],
        "majority": personalized.get("majority") or {},
        "conflicts": personalized.get("conflicts") or [],
        "term": personalized.get("term") or "",
    }


@router.get("/course-selections")
async def get_course_selections_ep(
    user=Depends(get_current_user),
    term: str | None = Query(default=None),
):
    """🎓 دریافت لیست درس‌های ارائه‌شده ترم جاری + انتخاب‌های درس‌به‌درس دانشجو و گروه اکثریت."""
    return await db.get_student_course_selections(user["id"], term=term)


@router.post("/course-selections")
async def save_course_selections_ep(
    body: dict,
    user=Depends(get_current_user),
):
    """🎓 ذخیره انتخاب‌های درس‌به‌درس دانشجو + محاسبه خودکار گروه اکثریت و به‌روزرسانی پروفایل."""
    selections = body.get("selections") if isinstance(body, dict) else []
    term = body.get("term") if isinstance(body, dict) else None
    edu_grp_in = body.get("educational_group") if isinstance(body, dict) else None
    if edu_grp_in in ("male", "female"):
        await db.set_user_educational_group(
            user["id"], edu_grp_in,
            source="user_confirmed",
            verified=True,
            actor_id=user["id"],
            reason="تأیید گروه آموزشی در فرم انتخاب واحد مینی‌اپ",
        )
    if not isinstance(selections, list):
        from fastapi import HTTPException
        raise HTTPException(422, "فرمت انتخاب واحد معتبر نیست")
    res = await db.save_student_course_selections(user["id"], selections, term=term)
    try:
        db_user = user.get("_db") or {}
        name = db_user.get("name") or str(user["id"])
        await db.log_action(
            user["id"], name, "student",
            "ثبت انتخاب واحد درس‌به‌درس", "Schedule", category="academic", severity="INFO",
            target_id=str(user["id"]), target_type="user", target_label=name,
            after={
                "term": res.get("term"),
                "selected_count": res.get("selected_count"),
                "computed_group": res.get("computed_group"),
                "tie_broken_by": (res.get("majority") or {}).get("tie_broken_by"),
            },
        )
    except Exception:
        pass
    return res



@router.get("/exams")
async def get_exams(
    user=Depends(get_current_user),

    days: int = Query(
        default=30,
        ge=1,
        le=365,
    ),
):
    group = _text(
        user["_db"].get("group")
    )

    exams = await db.upcoming_exams(
        days,
        group=group,
    )

    return {
        "exams": _serialize(exams),
    }


def _ical_escape(value: str) -> str:
    return (
        str(value or "")
        .replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )


def build_ical(items: list, cal_name: str = "HumsYar") -> str:
    """🌊 W8/UX-05 — ساخت تقویم iCal (UTC، بدون وابستگی خارجی)."""
    from datetime import datetime
    from zoneinfo import ZoneInfo

    tehran = ZoneInfo("Asia/Tehran")
    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0",
        "PRODID:-//HumsYar//Schedule//FA",
        f"X-WR-CALNAME:{_ical_escape(cal_name)}",
    ]
    for it in items or []:
        try:
            day = parse_gregorian_date(str(it.get("date") or ""))
        except (TypeError, ValueError):
            continue
        hm = str(it.get("time") or "").strip()
        try:
            hh, mm = hm.split(":")
            start = datetime(day.year, day.month, day.day,
                             int(hh), int(mm), tzinfo=tehran)
        except (ValueError, AttributeError):
            continue  # بدون ساعت عینی، رویداد تقویمی نمی‌سازیم
        ehm = str(it.get("end_time") or "").strip()
        try:
            eh, em = ehm.split(":")
            end = datetime(day.year, day.month, day.day,
                           int(eh), int(em), tzinfo=tehran)
            if end <= start:
                raise ValueError
        except (ValueError, AttributeError):
            from datetime import timedelta
            end = start + timedelta(minutes=90)
        kind = {"class": "کلاس", "exam": "آزمون", "makeup": "جبرانی"}.get(
            str(it.get("type") or ""), "")
        summary = f"{kind} {it.get('lesson') or ''}".strip()
        desc = " / ".join(x for x in (
            str(it.get("teacher") or ""),
            str(it.get("notes") or it.get("note") or "")) if x)
        lines += [
            "BEGIN:VEVENT",
            f"UID:{it.get('_id', '')}@humsyar",
            f"DTSTART:{start.astimezone(ZoneInfo('UTC')).strftime('%Y%m%dT%H%M%SZ')}",
            f"DTEND:{end.astimezone(ZoneInfo('UTC')).strftime('%Y%m%dT%H%M%SZ')}",
            f"SUMMARY:{_ical_escape(summary)}",
            f"LOCATION:{_ical_escape(it.get('location') or '')}",
            f"DESCRIPTION:{_ical_escape(desc)}",
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


@router.get("/ical")
async def get_ical(
    user=Depends(get_current_user),
    days: int = Query(default=90, ge=1, le=365),
    stype: ScheduleType | None = Query(default=None),
):
    """🌊 W8/UX-05 — خروجی iCal برنامه‌ی شخصی‌سازی‌شده کاربر (۹۰ روز آینده)."""
    from datetime import timedelta
    personalized = await db.get_personalized_schedules(user["id"], stype=stype, upcoming=True)
    items = personalized.get("items") or []
    cutoff = (now_tehran().date() + timedelta(days=days)).isoformat()
    items = [it for it in (items or [])
             if str(it.get("date") or "") <= cutoff]
    body = build_ical(items)
    return Response(
        content=body.encode("utf-8"), media_type="text/calendar",
        headers={"Content-Disposition":
                 "attachment; filename=humsyar-schedule.ics"})


@router.get("/conflicts")
async def get_conflicts(
    user=Depends(require_perm("schedules.manage")),
    group: str = Query(default="هر دو"),
    date: str = Query(default=""),
):
    """🌊 W8/UX-05 — همه‌ی جفت‌های متداخل یک روز (بازبینی ادمین)."""
    if not date:
        date = now_tehran().strftime("%Y-%m-%d")
    try:
        parse_gregorian_date(date)
    except (TypeError, ValueError):
        from fastapi import HTTPException
        raise HTTPException(422, "فرمت تاریخ YYYY-MM-DD")
    from database import db as _db

    cur = await _db.schedules.find(
        {"date": date, "is_weekly": {"$ne": True}}).to_list(200)
    pairs = []
    seen = set()
    for s in cur or []:
        g = (s.get("group") or "هر دو").strip()
        if group != "هر دو" and g != "هر دو" and g != group:
            continue
        for c in await _db.schedule_find_conflicts(
                g, date, s.get("time") or "", s.get("end_time") or "",
                exclude_id=str(s.get("_id"))):
            key = tuple(sorted((str(s.get("_id")), c["id"])))
            if key in seen:
                continue
            seen.add(key)
            pairs.append({"a": {"id": str(s.get("_id")),
                                "lesson": s.get("lesson", ""),
                                "time": s.get("time", ""),
                                "group": g}, "b": c})
    return {"date": date, "group": group, "conflicts": pairs}


# ══════════════════════════════════════════════════════════════
#  🌊 Wave 6 — مدیریت تسک‌های مطالعه شخصی تقویم جلالی (Study Tasks)
# ══════════════════════════════════════════════════════════════

class StudyTaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=150)
    jalali_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    reminder_time: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")


def _tasks_col():
    """یافتن کالکشن study_tasks با پشتیبانی از DB اصلی و Mock."""
    if hasattr(db, "study_tasks") and db.study_tasks is not None:
        return db.study_tasks
    if hasattr(db, "users") and hasattr(db.users, "database"):
        return db.users.database["study_tasks"]
    if hasattr(db, "client"):
        return db.client["medicalbot"]["study_tasks"]
    return db.study_tasks


def _validate_jalali_date(date_str: str) -> tuple[int, int, int]:
    """اعتبارسنجی الگوریتمی روز و ماه تقویم جلالی (TC-SCHED-01).
    
    ماه‌های ۱ تا ۶ حداکثر ۳۱ روز و ماه‌های ۷ تا ۱۲ حداکثر ۳۰ روز دارند.
    """
    try:
        parts = date_str.split("-")
        if len(parts) != 3:
            raise ValueError()
        y, m, d = int(parts[0]), int(parts[1]), int(parts[2])
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail="فرمت تاریخ جلالی نامعتبر است (الگوی صحیح: YYYY-MM-DD)")

    if not (1300 <= y <= 1500):
        raise HTTPException(status_code=422, detail="سال تقویم جلالی نامعتبر است")
    if not (1 <= m <= 12 and 1 <= d <= 31):
        raise HTTPException(status_code=422, detail="ماه یا روز تقویم جلالی نامعتبر است")
    if m > 6 and d > 30:
        raise HTTPException(status_code=422, detail="ماه‌های نیمه دوم سال حداکثر ۳۰ روز هستند")
    return y, m, d


@router.get("/items")
async def list_study_tasks(
    from_jalali: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    to_jalali: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    user=Depends(get_current_user),
):
    """فهرست تسک‌های مطالعه شخصی دانشجو با فیلتر بازه زمانی جلالی."""
    uid = int(user.get("id") or user.get("user_id") or 0)
    query: dict[str, Any] = {"user_id": uid}
    if from_jalali or to_jalali:
        date_q: dict[str, str] = {}
        if from_jalali:
            date_q["$gte"] = from_jalali
        if to_jalali:
            date_q["$lte"] = to_jalali
        query["jalali_date"] = date_q

    col = _tasks_col()
    docs = await col.find(query).sort([("jalali_date", 1), ("created_at", 1)]).to_list(500)
    return {
        "tasks": [
            {
                "task_id": str(d.get("_id")),
                "title": d.get("title", ""),
                "jalali_date": d.get("jalali_date", ""),
                "reminder_time": d.get("reminder_time"),
                "completed": bool(d.get("completed")),
                "completed_at": d.get("completed_at"),
            }
            for d in docs
        ]
    }


@router.post("/items", status_code=201)
async def create_study_task(
    body: StudyTaskCreate,
    user=Depends(get_current_user),
):
    """ایجاد تسک جدید مطالعه با اعتبارسنجی تقویم جلالی."""
    uid = int(user.get("id") or user.get("user_id") or 0)
    _validate_jalali_date(body.jalali_date)

    doc = {
        "user_id": uid,
        "title": body.title.strip(),
        "jalali_date": body.jalali_date,
        "reminder_time": body.reminder_time,
        "completed": False,
        "completed_at": None,
        "created_at": utc_now_iso(),
    }
    col = _tasks_col()
    res = await col.insert_one(doc)
    return {"task_id": str(res.inserted_id), "created": True}


@router.patch("/items/{task_id}/toggle")
async def toggle_study_task(
    task_id: str,
    user=Depends(get_current_user),
):
    """تغییر وضعیت انجام تسک مطالعه و ثبت برچسب زمانی (TC-SCHED-02)."""
    uid = int(user.get("id") or user.get("user_id") or 0)
    if not ObjectId.is_valid(task_id):
        raise HTTPException(status_code=404, detail="تسک یافت نشد")
    col = _tasks_col()
    task = await col.find_one({"_id": ObjectId(task_id), "user_id": uid})
    if not task:
        raise HTTPException(status_code=404, detail="تسک یافت نشد")
    new_state = not bool(task.get("completed"))
    completed_at = utc_now_iso() if new_state else None
    await col.update_one(
        {"_id": task["_id"]},
        {"$set": {"completed": new_state, "completed_at": completed_at}},
    )
    return {"task_id": task_id, "completed": new_state, "completed_at": completed_at}

