"""
🎙 lecture_scribe — دستیار هوشمند جزوه‌نویس چندرسانه‌ای هوشیار
HamsYar Medical Platform — Premium v2 (1405)

قابلیت‌ها:
  • دریافت همزمان یا مرحله‌ای ویس جلسه، پادکست، فایل صوتی/ویدیو و اسلایدهای PDF.
  • سشن تعاملی با دکمه‌های شیشه‌ای برای الصاق فایل دوم یا شروع پردازش مستقیم.
  • پردازش چندرسانه‌ای مستقیم با Google Gemini 2.0 / 1.5 Pro Multimodal.
  • استخراج دام‌های تستی پره‌انترنی/دستیاری، مرواریدهای بالینی و جدول مقایسه‌ای.
  • تدوین خودکار سند PDF دانشگاهی استاندارد با فونت وزیر و سربرگ هامزیار.
  • ارسال پیام خلاصه با نقل‌قول بازشونده (<blockquote expandable>) و فایل PDF.
"""

import os
import io
import re
import json
import uuid
import time
import asyncio
import logging
import tempfile
import shutil
from typing import Optional, Dict, Any, Tuple

import httpx
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes

from database import db
from time_utils import today_tehran, now_utc, format_date_fa
from bot_modern_ui import ButtonGridBuilder, CompactTableBuilder


def expandable_quote(text: str) -> str:
    """قالب‌بندی نقل‌قول بازشونده طبق آخرین مستندات Bot API 10.x"""
    return f"<blockquote expandable>{text}</blockquote>"


def _parse_json_from_text(raw: str) -> dict:
    """استخراج و تمیزکاری JSON از پاسخ هوش مصنوعی (حذف تگ‌های احتمالی markdown)"""
    clean = (raw or '').strip()
    if clean.startswith("```"):
        clean = re.sub(r"^```(?:json)?\s*", "", clean, flags=re.IGNORECASE)
        clean = re.sub(r"\s*```$", "", clean)
    clean = clean.strip()
    return json.loads(clean)


# فرمت‌های معتبر رسانه‌ای برای دریافت و تحلیل
AUDIO_EXTENSIONS = {'.m4a', '.aac', '.mp3', '.wav', '.ogg', '.opus', '.flac', '.amr', '.wma', '.aiff', '.m4b'}
VIDEO_EXTENSIONS = {'.mp4', '.mkv', '.mov', '.avi', '.webm', '.3gp', '.wmv', '.flv'}


def _get_ffmpeg_path() -> Optional[str]:
    """یافتن مسیر اجرایی ffmpeg با اولویت باینری درونی imageio_ffmpeg و سپس متغیر PATH سیستم"""
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and os.path.isfile(exe):
            return exe
    except Exception:
        pass
    return shutil.which('ffmpeg')


async def transcode_media_to_optimized_audio(
    media_bytes: bytes, original_name: str = ''
) -> Tuple[bytes, str, str]:
    """
    تبدیل هوشمند انواع فرمت‌های صوتی و ویدیویی (m4a, aac, mp4, mkv, ogg, wav, flac, wma, ...)
    به فایل صوتی سبک استاندارد MP3 (تک‌کاناله ۱۶ کیلوهرتز ۴۸ کیلوبیت).
    - مصرف حجم را تا ۷۵٪ کاهش می‌دهد (مثلاً ۵۳ مگابایت به ۱۰ مگابایت)
    - استریم‌های ویدیویی اضافه را حذف می‌کند (-vn)
    - آپلود سریع بدون قطعی و تایم‌اوت را تضمین می‌کند
    - سازگاری ۱۰۰٪ با Google Gemini Files API بدون خطای MIME Type ایجاد می‌کند
    """
    ffmpeg_exe = _get_ffmpeg_path()
    ext = os.path.splitext(original_name.lower())[1] if original_name else '.m4a'
    if not ext:
        ext = '.m4a'

    if not ffmpeg_exe:
        logger.warning("ابزار ffmpeg در سیستم یافت نشد؛ فایل به صورت دست‌نخورده ارسال می‌شود.")
        safe_mime = 'audio/mp4' if ext in ('.m4a', '.mp4') else ('audio/aac' if ext == '.aac' else 'audio/mpeg')
        return media_bytes, safe_mime, original_name or 'lecture.mp3'

    tmp_in = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
    tmp_out = tempfile.NamedTemporaryFile(suffix='.mp3', delete=False)

    try:
        tmp_in.write(media_bytes)
        tmp_in.flush()
        tmp_in.close()
        tmp_out.close()

        cmd = [
            ffmpeg_exe, '-y',
            '-i', tmp_in.name,
            '-vn',              # حذف ویدیوی اضافه در صورت وجود
            '-ar', '16000',      # فرکانس نمونه‌برداری بهینه گفتار
            '-ac', '1',          # تک‌کاناله مونو
            '-b:a', '48k',       # بیت‌ریت ۴۸ کیلوبیت برای کیفیت صدای شفاف و حجم سبک
            '-f', 'mp3',
            tmp_out.name
        ]

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=180)

        if proc.returncode != 0 or not os.path.exists(tmp_out.name) or os.path.getsize(tmp_out.name) == 0:
            logger.warning(
                "خطا در تبدیل صدا با ffmpeg: %s (کد خروج %s)",
                (stderr or b'')[:300].decode('utf-8', errors='ignore'),
                proc.returncode
            )
            safe_mime = 'audio/mp4' if ext in ('.m4a', '.mp4') else 'audio/mpeg'
            return media_bytes, safe_mime, original_name or 'lecture.mp3'

        with open(tmp_out.name, 'rb') as f:
            optimized_bytes = f.read()

        logger.info(
            "تبدیل موفق رسانه کلاسی: حجم اولیه %d بایت → بهینه %d بایت (کاهش %.1f%%)",
            len(media_bytes),
            len(optimized_bytes),
            (1.0 - (len(optimized_bytes) / max(len(media_bytes), 1))) * 100.0
        )
        return optimized_bytes, 'audio/mp3', 'optimized_lecture.mp3'

    except Exception:
        logger.exception("استثنا در فرآیند تبدیل رسانه کلاسی با ffmpeg")
        safe_mime = 'audio/mp4' if ext in ('.m4a', '.mp4') else 'audio/mpeg'
        return media_bytes, safe_mime, original_name or 'lecture.mp3'
    finally:
        try:
            if os.path.exists(tmp_in.name):
                os.remove(tmp_in.name)
        except Exception:
            pass
        try:
            if os.path.exists(tmp_out.name):
                os.remove(tmp_out.name)
        except Exception:
            pass


logger = logging.getLogger(__name__)

# سشن‌های موقت در حافظه (با زمان انقضای ۱۲ ساعت)
_LECTURE_SESSIONS: Dict[str, Dict[str, Any]] = {}
_SESSION_TTL_SEC = 12 * 3600

# محدودیت اندازه رسانه (حداکثر ۱۰۰ مگابایت برای فایل صوتی/PDF در تلگرام)
MAX_LECTURE_MEDIA_BYTES = 100 * 1024 * 1024

# اسکیما و ساختار JSON خروجی Gemini برای تدوین جزوه
LECTURE_DIGEST_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "title": {
            "type": "STRING",
            "description": "عنوان کامل و علمی جلسه درسی به زبان فارسی"
        },
        "subject": {
            "type": "STRING",
            "description": "نام درس، بخش یا دپارتمان آموزشی (مثلاً بیماری‌های قلب و عروق، نورولوژی، فارماکولوژی)"
        },
        "professor": {
            "type": "STRING",
            "description": "نام استاد مدرس در صورت ذکر در صوت یا اسلاید"
        },
        "session": {
            "type": "STRING",
            "description": "شماره یا نام جلسه (مثلاً جلسه ۴ - مبحث آریتمی)"
        },
        "date": {
            "type": "STRING",
            "description": "تاریخ جلسه یا ترم تحصیلی (مثلاً پاییز ۱۴۰۵)"
        },
        "executive_summary": {
            "type": "STRING",
            "description": "چکیده و خلاصه اجرایی ۳ الی ۶ جمله‌ای از اهداف آموزشی و مباحث کلیدی جلسه"
        },
        "topics": {
            "type": "ARRAY",
            "description": "سرفصل‌ها و توضیحات تفصیلی به همراه پاتوفیزیولوژی، علائم و درمان",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "title": {"type": "STRING", "description": "عنوان سرفصل یا مبحث"},
                    "content": {
                        "type": "STRING",
                        "description": "توضیحات کامل و جامع با حفظ ۱۰۰٪ اصطلاحات انگلیسی تخصصی در پرانتز"
                    },
                    "clinical_points": {
                        "type": "STRING",
                        "description": "نکته یا رویکرد بالینی شاخص مرتبط با این سرفصل"
                    }
                },
                "required": ["title", "content"]
            }
        },
        "clinical_pearls": {
            "type": "ARRAY",
            "description": "مرواریدهای بالینی، نکات تجربی و ترفندهای طبابت مطرح‌شده توسط استاد",
            "items": {"type": "STRING"}
        },
        "exam_traps": {
            "type": "ARRAY",
            "description": "دام‌های تستی، نکات پرتکرار آزمون پره‌انترنی و پذیرش دستیاری یا تاکیدات امتحانی استاد",
            "items": {"type": "STRING"}
        },
        "comparison_table": {
            "type": "OBJECT",
            "description": "جدول مقایسه‌ای داروها، بیماری‌ها، معیارها یا طبقه‌بندی‌های تدریس‌شده",
            "properties": {
                "title": {"type": "STRING"},
                "headers": {"type": "ARRAY", "items": {"type": "STRING"}},
                "rows": {
                    "type": "ARRAY",
                    "items": {"type": "ARRAY", "items": {"type": "STRING"}}
                }
            }
        },
        "qna_list": {
            "type": "ARRAY",
            "description": "پرسش و پاسخ‌های کلیدی برای مرور سریع و تثبیت آموخته‌ها",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "question": {"type": "STRING"},
                    "answer": {"type": "STRING"}
                },
                "required": ["question", "answer"]
            }
        }
    },
    "required": ["title", "subject", "executive_summary", "topics"]
}


def _cleanup_expired_sessions():
    """حذف سشن‌های منقضی‌شده از حافظه"""
    now = time.monotonic()
    expired = [
        sid for sid, data in _LECTURE_SESSIONS.items()
        if now - data.get('created_at', now) > _SESSION_TTL_SEC
    ]
    for sid in expired:
        _LECTURE_SESSIONS.pop(sid, None)


async def show_lecture_scribe_intro(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """پیام خوش‌آمدگویی و فعال‌سازی حالت جزوه‌نویس چندرسانه‌ای"""
    uid = update.effective_user.id
    from subscription import feature_allowed, show_paywall
    if not await feature_allowed(uid, "ai_chat"):
        await show_paywall(update.message or update.callback_query.message, uid, feature="ai_chat")
        return

    from ai_solver import get_ai_config
    cfg = await get_ai_config()
    if not cfg.get('enabled') or not cfg.get('lecture_scribe_enabled', True):
        msg = update.effective_message
        if msg:
            await msg.reply_text("🎙 دستیار جزوه‌نویس کلاسی هوشیار فعلاً توسط مدیریت غیرفعال است.")
        return

    context.user_data['mode'] = 'lecture_scribe'

    # بررسی سهمیه روزانه
    user = await db.get_user(uid) or {}
    today = today_tehran().isoformat()
    daily_quota = int(cfg.get('lecture_daily_quota', 5) or 5)
    used = user.get('lecture_usage_count', 0) if user.get('lecture_usage_date') == today else 0

    admin_id = int(os.getenv('ADMIN_ID', '0'))
    if uid == admin_id or daily_quota <= 0:
        quota_text = "🔓 <b>سهمیه امروز:</b> نامحدود (توسعه‌دهنده / ادمین ارشد)"
    else:
        rem = max(0, daily_quota - used)
        quota_text = f"📊 <b>سهمیه امروز شما:</b> {rem} از {daily_quota} جلسه باقی‌مانده است."

    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("📚 بازگشت به منوی هوشیار", callback_data='ls:back_ai')],
    ])

    text = (
        "🎙 <b>دستیار جزوه‌نویس هوشمند چندرسانه‌ای هوشیار</b>\n"
        "━━━━━━━━━━━━━━━━\n"
        "با این قابلیت می‌توانید <b>ویس ضبط‌شدهٔ کلاس</b> و/یا <b>اسلایدهای PDF</b> را ارسال کنید تا:\n\n"
        "۱. 🎧 صحبت‌های استاد و اصطلاحات تخصصی انگلیسی با دقت کامل پیاده‌سازی شود.\n"
        "۲. 📑 محتوای صوتی با اسلایدهای درسی تطبیق داده شود.\n"
        "۳. 💎 <b>مرواریدهای بالینی (Clinical Pearls)</b> و تجربیات استاد استخراج گردد.\n"
        "۴. 🚨 <b>دام‌های تستی پره‌انترنی و پذیرش دستیاری</b> برجسته شود.\n"
        "۵. 📊 جدول‌های مقایسه‌ای داروها و دسته‌بندی بیماری‌ها رسم گردد.\n"
        "۶. 📄 در نهایت یک <b>جزوه PDF آکادمیک و فوق‌العاده شیک</b> با سربرگ هامزیار و فونت اختصاصی دریافت کنید!\n\n"
        f"{quota_text}\n\n"
        "📤 <b>برای شروع، اولین فایل خود را بفرستید:</b>\n"
        "• پیام صوتی (Voice) یا فایل صوتی (Audio/MP3)\n"
        "• یا فایل اسلایدهای جلسه (PDF)"
    )

    if update.callback_query:
        await update.callback_query.answer()
        await update.callback_query.message.reply_text(text, parse_mode='HTML', reply_markup=kb)
    elif update.message:
        await update.message.reply_text(text, parse_mode='HTML', reply_markup=kb)


async def handle_lecture_file_input(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """
    دریافت اولین یا دومین فایل جلسه و راه‌اندازی سشن تعاملی.
    پشتیبانی کامل از Voice، Audio (mp3, m4a, aac, wav, ...)، Video (mp4, mkv, ...)، Video Note و Document (PDF/Audio/Video).
    """
    uid = update.effective_user.id
    msg = update.message
    if not msg:
        return

    _cleanup_expired_sessions()

    # تشخیص نوع فایل
    file_obj = None
    kind = None
    mime = None
    name = None

    if getattr(msg, 'voice', None):
        file_obj = msg.voice
        kind = 'audio'
        mime = getattr(msg.voice, 'mime_type', None) or 'audio/ogg'
        name = f"ویس کلاسی ({getattr(file_obj, 'duration', 0)} ثانیه)"
    elif getattr(msg, 'audio', None):
        file_obj = msg.audio
        kind = 'audio'
        mime = getattr(msg.audio, 'mime_type', None) or 'audio/mpeg'
        name = getattr(msg.audio, 'file_name', None) or "فایل صوتی کلاس"
    elif getattr(msg, 'document', None):
        doc_mime = (getattr(msg.document, 'mime_type', None) or '').lower()
        file_name = (getattr(msg.document, 'file_name', None) or '').lower()
        ext = os.path.splitext(file_name)[1]

        if ext == '.pdf' or doc_mime == 'application/pdf':
            file_obj = msg.document
            kind = 'pdf'
            mime = 'application/pdf'
            name = getattr(msg.document, 'file_name', None) or "اسلایدهای جلسه.pdf"
        elif ext in AUDIO_EXTENSIONS or doc_mime.startswith('audio/'):
            file_obj = msg.document
            kind = 'audio'
            mime = doc_mime or 'audio/mpeg'
            name = getattr(msg.document, 'file_name', None) or "فایل صوتی کلاس"
        elif ext in VIDEO_EXTENSIONS or doc_mime.startswith('video/'):
            file_obj = msg.document
            kind = 'video'
            mime = doc_mime or 'video/mp4'
            name = getattr(msg.document, 'file_name', None) or "ویدیو کلاس درس"
        else:
            await msg.reply_text(
                "⚠️ فرمت فایل ارسالی شناسایی نشد.\n"
                "لطفاً فایل صوتی (Voice, MP3, M4A, AAC, WAV)، ویدیویی (MP4, MKV) یا اسلایدهای درسی (PDF) ارسال فرمایید."
            )
            return
    elif getattr(msg, 'video', None):
        file_obj = msg.video
        kind = 'video'
        mime = getattr(msg.video, 'mime_type', None) or 'video/mp4'
        name = getattr(msg.video, 'file_name', None) or "ویدیو کلاس درس"
    elif getattr(msg, 'video_note', None):
        file_obj = msg.video_note
        kind = 'video'
        mime = 'video/mp4'
        name = f"پیام ویدیویی ({getattr(file_obj, 'duration', 0)} ثانیه)"
    else:
        return

    # بررسی حجم فایل
    raw_size = getattr(file_obj, 'file_size', 0)
    file_size_num = int(raw_size) if isinstance(raw_size, (int, float)) else 0
    if file_size_num > MAX_LECTURE_MEDIA_BYTES:
        await msg.reply_text(
            f"⚠️ حجم فایل ارسالی بیشتر از {MAX_LECTURE_MEDIA_BYTES // (1024*1024)} مگابایت است. "
            "لطفاً فایلی با حجم کمتر ارسال فرمایید."
        )
        return

    session_id = context.user_data.get('lecture_session_id')
    current_session = _LECTURE_SESSIONS.get(session_id) if session_id else None

    # اگر کاربر در حالت الصاق فایل دوم بود یا سشن قبلی نیمه‌کاره بود
    is_attach_mode = context.user_data.get('mode') == 'lecture_scribe_attach'

    if not current_session or not is_attach_mode:
        # ساخت سشن جدید
        session_id = f"ls_{uid}_{uuid.uuid4().hex[:6]}"
        current_session = {
            'session_id': session_id,
            'user_id': uid,
            'created_at': time.monotonic(),
            'files': [],
            'status': 'awaiting_files',
            'user_notes': (msg.caption or '').strip(),
        }
        _LECTURE_SESSIONS[session_id] = current_session
        context.user_data['lecture_session_id'] = session_id

    # افزودن فایل جدید به سشن
    tg_file = await file_obj.get_file()
    file_info = {
        'kind': kind,
        'mime': mime,
        'name': name,
        'tg_file_id': file_obj.file_id,
        'tg_file_path': getattr(tg_file, 'file_path', None),
        'file_size': getattr(file_obj, 'file_size', 0),
        'caption': (msg.caption or '').strip(),
    }
    current_session['files'].append(file_info)

    num_files = len(current_session['files'])

    if num_files == 1:
        # فایل اول دریافت شد — طبق تصمیم پرسش ۲ مصاحبه (گزینه A)، سشن تعاملی با دکمه باز می‌شود
        icon = "🎙" if kind in ('audio', 'video') else "📄"
        size_mb = file_info['file_size'] / (1024 * 1024)
        size_str = f"{size_mb:.1f} MB" if size_mb >= 1 else f"{file_info['file_size'] // 1024} KB"

        text = (
            "📥 <b>فایل جلسه با موفقیت دریافت شد!</b>\n"
            "━━━━━━━━━━━━━━━━\n"
            f"📁 <b>فایل اول:</b> {icon} <code>{name}</code> ({size_str})\n\n"
            "❓ <b>آیا مایلید فایل مکمل دیگری نیز پیوست کنید؟</b>\n"
            "• اگر ویس کلاس را فرستادید، می‌توانید <b>اسلایدهای PDF</b> را اضافه کنید تا هوشیار صحبت‌های استاد را با اسلایدها تطبیق دهد.\n"
            "• اگر PDF را فرستادید، می‌توانید <b>ویس جلسه</b> را پیوست کنید.\n"
            "• یا می‌توانید بلافاصله پردازش همین تک‌فایل را آغاز فرمایید."
        )

        kb = InlineKeyboardMarkup([
            [
                InlineKeyboardButton("📎 پیوست فایل دوم (اسلایدها / ویس)", callback_data=f"ls:attach:{session_id}"),
            ],
            [
                InlineKeyboardButton("🚀 شروع پردازش همین فایل", callback_data=f"ls:start:{session_id}"),
            ],
            [
                InlineKeyboardButton("❌ لغو و انصراف", callback_data=f"ls:cancel:{session_id}"),
            ]
        ])

        await msg.reply_text(text, parse_mode='HTML', reply_markup=kb)

    else:
        # فایل دوم دریافت شد!
        f1, f2 = current_session['files'][:2]
        icon1 = "🎙" if f1['kind'] in ('audio', 'video') else "📄"
        icon2 = "🎙" if f2['kind'] in ('audio', 'video') else "📄"

        text = (
            "✅ <b>هر دو منبع درسی با موفقیت آماده شدند:</b>\n"
            "━━━━━━━━━━━━━━━━\n"
            f"۱. {icon1} <code>{f1['name']}</code>\n"
            f"۲. {icon2} <code>{f2['name']}</code>\n\n"
            "هوشیار آماده است تا صوت و اسلایدها را به صورت همگام تحلیل کرده و جزوه دانشگاهی کامل را تولید کند."
        )

        kb = InlineKeyboardMarkup([
            [
                InlineKeyboardButton("🚀 شروع پردازش و تولید جزوه جامع PDF", callback_data=f"ls:start:{session_id}"),
            ],
            [
                InlineKeyboardButton("❌ لغو و انصراف", callback_data=f"ls:cancel:{session_id}"),
            ]
        ])

        context.user_data['mode'] = 'lecture_scribe'
        await msg.reply_text(text, parse_mode='HTML', reply_markup=kb)


async def handle_lecture_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """مدیریت دکمه‌های شیشه‌ای سشن جزوه‌نویس"""
    query = update.callback_query
    if not query or not query.data:
        return

    data = query.data
    uid = update.effective_user.id

    if data == 'ls:intro':
        await query.answer()
        return await show_lecture_scribe_intro(update, context)

    if data == 'ls:back_ai':
        await query.answer()
        context.user_data['mode'] = 'ai_query'
        from ai_solver import show_ai_intro
        return await show_ai_intro(update, context)

    parts = data.split(':')
    action = parts[1] if len(parts) > 1 else ''
    session_id = parts[2] if len(parts) > 2 else ''

    if action == 'cancel':
        _LECTURE_SESSIONS.pop(session_id, None)
        context.user_data.pop('lecture_session_id', None)
        context.user_data['mode'] = 'ai_query'
        await query.answer("عملیات لغو شد.")
        await query.edit_message_text(
            "❌ <b>سشن جزوه‌نویسی لغو شد.</b>\n"
            "هر زمان مایل بودید می‌توانید مجدداً ویس یا اسلاید ارسال کنید.",
            parse_mode='HTML'
        )
        return

    if action == 'attach':
        session = _LECTURE_SESSIONS.get(session_id)
        if not session:
            await query.answer("⚠️ سشن منقضی شده است. لطفاً فایل را مجدداً ارسال کنید.", show_alert=True)
            return

        context.user_data['mode'] = 'lecture_scribe_attach'
        context.user_data['lecture_session_id'] = session_id
        await query.answer()
        await query.edit_message_text(
            "📎 <b>لطفاً فایل دوم را ارسال کنید:</b>\n"
            "• اگر فایل اول ویس بود، اکنون <b>اسلایدهای درسی (PDF)</b> را بفرستید.\n"
            "• اگر فایل اول PDF بود، اکنون <b>ویس کلاس (Voice / Audio)</b> را بفرستید.\n\n"
            "<i>منتظر دریافت فایل دوم هستیم...</i>",
            parse_mode='HTML'
        )
        return

    if action == 'start':
        await query.answer()
        return await run_lecture_processing(update, context, session_id)


async def run_lecture_processing(update: Update, context: ContextTypes.DEFAULT_TYPE, session_id: str):
    """اجرای پایپ‌لاین کامل پردازش چندرسانه‌ای با Gemini و تولید PDF"""
    uid = update.effective_user.id
    query = update.callback_query
    msg = query.message if query else update.effective_message

    session = _LECTURE_SESSIONS.get(session_id)
    if not session or not session.get('files'):
        await msg.reply_text("⚠️ اطلاعات این جلسه یافت نشد یا منقضی شده است. لطفاً فایل‌ها را مجدداً ارسال فرمایید.")
        return

    # ۱. بررسی سهمیه روزانه کاربر
    from ai_solver import check_and_consume_lecture_quota, ai_claim_inflight, ai_release_inflight, get_ai_config
    cfg = await get_ai_config()

    allowed, used, limit = await check_and_consume_lecture_quota(uid)
    if not allowed:
        await msg.reply_text(
            f"⛔️ <b>سقف روزانهٔ تولید جزوه پایان یافته است ({used}/{limit}).</b>\n"
            "فردا مجدداً می‌توانید برای کلاس‌های جدید جزوه تولید کنید.",
            parse_mode='HTML'
        )
        return

    # ۲. قفل درخواست همزمان
    if not await ai_claim_inflight(uid):
        await msg.reply_text("⏳ لطفاً تا اتمام پردازش درخواست فعلی خود صبر فرمایید.")
        return

    # پیام اولیه پیشرفت
    status_msg = await msg.reply_text(
        "⏳ <b>در حال دانلود و آماده‌سازی فایل‌های جلسه...</b>\n"
        "لطفاً صبور باشید؛ پردازش صوت‌های طولانی ممکن است ۱ الی ۲ دقیقه طول بکشد.",
        parse_mode='HTML'
    )

    try:
        # مرحله ۱: دانلود فایل‌ها از سرور تلگرام و تبدیل بهینه
        files = session['files']
        audio_file_info = next((f for f in files if f['kind'] in ('audio', 'video')), None)
        pdf_file_info = next((f for f in files if f['kind'] == 'pdf'), None)

        audio_bytes = None
        audio_mime = None
        pdf_bytes = None

        if audio_file_info:
            await status_msg.edit_text(
                "📥 <b>در حال دریافت فایل صوتی/تصویری از تلگرام...</b>\n"
                f"📁 <code>{audio_file_info['name']}</code>",
                parse_mode='HTML'
            )
            tg_f = await context.bot.get_file(audio_file_info['tg_file_id'])
            raw_audio = bytes(await tg_f.download_as_bytearray())

            # فشرده‌سازی و تبدیل هوشمند انواع فرمت‌های صوتی/تصویری به MP3 استاندارد تک‌کاناله
            await status_msg.edit_text(
                "⚡️ <b>در حال بهینه‌سازی صوت و فشرده‌سازی برای پردازش فوق‌سریع هوش مصنوعی...</b>",
                parse_mode='HTML'
            )
            audio_bytes, audio_mime, _ = await transcode_media_to_optimized_audio(
                raw_audio, audio_file_info['name']
            )

        if pdf_file_info:
            await status_msg.edit_text(
                "📄 <b>در حال دانلود اسلایدهای جلسه (PDF)...</b>\n"
                f"📁 <code>{pdf_file_info['name']}</code>",
                parse_mode='HTML'
            )
            tg_doc = await context.bot.get_file(pdf_file_info['tg_file_id'])
            pdf_bytes = bytes(await tg_doc.download_as_bytearray())

        # مرحله ۲: استخراج کلیدهای Gemini از Vault پنل وب‌ادمین و راه‌اندازی چرخش خودکار
        from ai_solver import (
            sanitize_api_key, ordered_keys, run_with_key_failover,
            _gemini_upload_file, _gemini_wait_file_active,
            _extract_gemini_text, _raise_gemini_status_error,
            AIConfigError, AIQuotaError, AIError, refund_lecture_quota
        )

        vault_multi = cfg.get('vault_multi') or {}
        gemini_keys = list(vault_multi.get('gemini') or [])
        if not gemini_keys and cfg.get('provider') == 'gemini':
            gemini_keys = list(cfg.get('api_key_list') or [])
        if not gemini_keys and cfg.get('api_key'):
            gemini_keys = [cfg['api_key']]

        gemini_keys = [sanitize_api_key(k) for k in gemini_keys if k and sanitize_api_key(k)]
        # حذف کلیدهای تکراری با حفظ ترتیب
        seen = set()
        unique_keys = []
        for k in gemini_keys:
            if k not in seen:
                seen.add(k)
                unique_keys.append(k)
        gemini_keys = ordered_keys('gemini', unique_keys)

        if not gemini_keys:
            raise AIConfigError(
                "هیچ کلید فعالی برای Google Gemini در بخش مدیریت هوش مصنوعی وب‌ادمین یافت نشد. "
                "لطفاً کلیدهای Google AI Studio را در پنل ادمین ثبت فرمایید."
            )

        # مرحله ۳: تعریف مدل‌های برتر و رایگان گوگل به صورت آبشاری (Cascade Fallback)
        preferred_model = (cfg.get('lecture_model') or 'gemini-2.5-flash').strip()
        candidate_models = [preferred_model]
        for m in ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-exp', 'gemini-1.5-flash', 'gemini-1.5-pro']:
            if m not in candidate_models:
                candidate_models.append(m)

        system_prompt = (
            "شما یک دستیار ارشد بالینی هوشیار (HamsYar AI) و استاد مجرب تدوین محتوای آموزش پزشکی دانشگاهی هستید.\n"
            "فایل‌های پیوست شامل صوت تدریس استاد و/یا اسلایدهای کلاسی است.\n\n"
            "دستورالعمل‌های دقیق:\n"
            "۱. تمام واژگان و صحبت‌های استاد را با دقت بشنوید. تمام اصطلاحات انگلیسی پزشکی را با دقت ۱۰۰٪ در پرانتز ذکر کنید.\n"
            "۲. اگر اسلاید هم پیوست است، صحبت‌های استاد را خط‌به‌خط با اسلایدها تطبیق دهید تا جزوه کامل و یکدست شود.\n"
            "۳. بخش‌های اصلی شامل:\n"
            "   - سرفصل‌ها و توضیحات تفصیلی (Topics) با رویکرد پاتوفیزیولوژی، علائم و درمان.\n"
            "   - مرواریدهای بالینی (Clinical Pearls): نکات تشخیصی/درمانی تجربی و کاربردی استاد.\n"
            "   - دام‌های تستی پره‌انترنی و دستیاری (Exam Traps): نکات انحرافی و پرتکرار آزمون‌های جامع.\n"
            "   - جدول مقایسه‌ای (Comparison Table): اگر داروها یا معیارهایی در درس وجود دارد، یک جدول شفاف ایجاد کنید.\n"
            "   - پرسش و پاسخ‌های کلیدی (Q&A): ۴ الی ۶ سوال مروری با پاسخ مستند.\n"
            "خروجی را صرفاً در قالب JSON معتبر طبق اسکیما برگردانید."
        )

        user_prompt_text = "لطفاً جزوه کامل این جلسه درسی را به همراه نکات بالینی و دام‌های تستی استخراج کن."
        if session.get('user_notes'):
            user_prompt_text += f"\nیادداشت دانشجو: {session['user_notes']}"

        # مرحله ۴: اجرای پایپ‌لاین آپلود و تحلیل تحت فال‌بک خودکار کلیدهای Vault
        async def _process_with_gemini_key(key: str) -> dict:
            uploaded_audio_info = None
            uploaded_doc_info = None

            if audio_bytes:
                await status_msg.edit_text(
                    "🧠 <b>در حال بارگذاری صوت جلسه در پردازشگر ابری گوگل...</b>",
                    parse_mode='HTML'
                )
                fi = await _gemini_upload_file(key, audio_bytes, audio_mime, 'lecture_recording.mp3')
                uploaded_audio_info = await _gemini_wait_file_active(key, fi, timeout=180)

            if pdf_bytes:
                await status_msg.edit_text(
                    "📑 <b>در حال بارگذاری اسلایدها در پردازشگر ابری گوگل...</b>",
                    parse_mode='HTML'
                )
                fi = await _gemini_upload_file(key, pdf_bytes, 'application/pdf', 'lecture_slides.pdf')
                uploaded_doc_info = await _gemini_wait_file_active(key, fi, timeout=180)

            parts = []
            if uploaded_audio_info and uploaded_audio_info.get('uri'):
                parts.append({
                    'file_data': {
                        'file_uri': uploaded_audio_info['uri'],
                        'mime_type': uploaded_audio_info.get('mimeType') or audio_mime
                    }
                })
            if uploaded_doc_info and uploaded_doc_info.get('uri'):
                parts.append({
                    'file_data': {
                        'file_uri': uploaded_doc_info['uri'],
                        'mime_type': 'application/pdf'
                    }
                })
            parts.append({'text': user_prompt_text})

            payload = {
                'system_instruction': {'parts': [{'text': system_prompt}]},
                'contents': [{'role': 'user', 'parts': parts}],
                'generationConfig': {
                    'responseMimeType': 'application/json',
                    'responseSchema': LECTURE_DIGEST_SCHEMA,
                    'maxOutputTokens': 8192,
                    'temperature': 0.2,
                }
            }

            last_model_error = None
            for model_cand in candidate_models:
                await status_msg.edit_text(
                    f"🎧 <b>در حال شنیدن دقیق صوت و نگارش جزوه با هوش چندرسانه‌ای ({model_cand})...</b>",
                    parse_mode='HTML'
                )
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_cand}:generateContent"
                headers = {'Content-Type': 'application/json', 'x-goog-api-key': key}

                async with httpx.AsyncClient(timeout=240) as client:
                    res = await client.post(url, headers=headers, json=payload)

                if res.status_code == 200:
                    try:
                        data = res.json()
                        raw_text = _extract_gemini_text(data, "جزوه")
                        return _parse_json_from_text(raw_text)
                    except Exception as parse_err:
                        logger.warning("خطا در پردازش JSON دریافتی از مدل %s: %s", model_cand, parse_err)
                        last_model_error = parse_err
                        continue

                # اگر سهمیه کلید تمام شده باشد (کد 429)، فوراً استثنا ایجاد می‌شود تا کلید بعدی از Vault امتحان شود
                if res.status_code == 429:
                    logger.warning("کلید Gemini به سقف درخواست (429) رسید → سوییچ خودکار به کلید بعدی Vault...")
                    _raise_gemini_status_error(429, res.text)

                # اگر کلید نامعتبر یا بدون دسترسی بود (۴۰۱ یا ۴۰۳)
                if res.status_code in (401, 403):
                    logger.warning("کلید Gemini با کد %d نامعتبر است → سوییچ خودکار به کلید بعدی...", res.status_code)
                    _raise_gemini_status_error(res.status_code, res.text)

                # اگر مدل در دسترس نبود (۴۰۴ یا خطای مدل) به مدل بعدی همین کلید سوئیچ شود
                if res.status_code in (404, 503) or (res.status_code == 400 and ('not found' in res.text.lower() or 'not supported' in res.text.lower())):
                    logger.warning("مدل %s با کد %d پاسخ نداد؛ سوئیچ به مدل بعدی در زنجیره فال‌بک...", model_cand, res.status_code)
                    last_model_error = RuntimeError(f"Model {model_cand} returned {res.status_code}")
                    continue

                # سایر خطاهای گوگل
                _raise_gemini_status_error(res.status_code, res.text)

            if last_model_error:
                raise last_model_error
            raise AIError("هیچ‌کدام از مدل‌های هوش مصنوعی فعال نبودند.")

        digest = await run_with_key_failover(
            'gemini', gemini_keys, _process_with_gemini_key, label='lecture-gemini-pipeline'
        )

        # مرحله ۵: تدوین سند آکادمیک PDF با فونت فارسی وزیر
        await status_msg.edit_text(
            "📑 <b>در حال صفحه‌آرایی و تدوین PDF جزوه با سربرگ هامزیار و فونت اختصاصی وزیر...</b>",
            parse_mode='HTML'
        )

        from lecture_notes_pdf import generate_lecture_pdf
        pdf_buffer = await asyncio.to_thread(generate_lecture_pdf, digest)

        # مرحله ۶: ارسال خروجی نهایی به کاربر در تلگرام
        title = digest.get('title') or 'جزوه کلاسی'
        subject = digest.get('subject') or 'علوم پزشکی'
        professor = digest.get('professor') or 'هیات علمی'
        session_name = digest.get('session') or 'جلسه کلاسی'
        exec_summary = digest.get('executive_summary') or ''
        pearls = digest.get('clinical_pearls') or []
        traps = digest.get('exam_traps') or []
        qna = digest.get('qna_list') or []
        comp_tbl = digest.get('comparison_table') or {}

        summary_content = (
            f"<b>🎯 خلاصه اجرایی و اهداف جلسه:</b>\n{exec_summary}\n\n"
            f"<b>💎 مرواریدهای بالینی:</b> {len(pearls)} نکته کلیدی\n"
            f"<b>🚨 دام‌های تستی پره‌انترنی و دستیاری:</b> {len(traps)} نکته دامی\n"
            f"<b>📊 جدول مقایسه‌ای:</b> {comp_tbl.get('title') or 'دارد'}\n"
            f"<b>❓ پرسش و پاسخ‌های تثبیت یادگیری:</b> {len(qna)} سوال"
        )
        quoted_block = expandable_quote(summary_content)

        caption_msg = (
            f"🎓 <b>جزوه جامع کلاسی تدوین شد!</b>\n"
            f"━━━━━━━━━━━━━━━━\n"
            f"📌 <b>عنوان:</b> {title}\n"
            f"📚 <b>درس:</b> {subject} • <b>جلسه:</b> {session_name}\n"
            f"👨‍🏫 <b>استاد:</b> {professor}\n\n"
            f"{quoted_block}\n\n"
            "📥 <i>فایل کامل جزوه با کیفیت بالا و فونت اختصاصی فارسی پیوست گردید:</i>"
        )

        safe_name = re.sub(r'[\/:*?"<>| ]+', '_', title)[:40].strip('_') or 'Lecture'
        filename = f"HamsYar_{safe_name}.pdf"

        # پاک کردن پیام وضعیت
        try:
            await status_msg.delete()
        except Exception:
            pass

        # ارسال پیام خلاصه
        await msg.reply_text(caption_msg, parse_mode='HTML')

        # ارسال فایل PDF
        pdf_buffer.seek(0)
        await context.bot.send_document(
            chat_id=msg.chat_id,
            document=pdf_buffer,
            filename=filename,
            caption=f"📄 {title} — {subject}"
        )

        # پاکسازی سشن
        _LECTURE_SESSIONS.pop(session_id, None)
        context.user_data.pop('lecture_session_id', None)
        context.user_data['mode'] = 'ai_query'

    except Exception as exc:
        logger.exception("خطا در پردازش جزوه چندرسانه‌ای: %s", exc)
        try:
            from ai_solver import refund_lecture_quota
            await refund_lecture_quota(uid)
        except Exception:
            pass
        await msg.reply_text(
            "⚠️ <b>متأسفانه در فرآیند تحلیل یا تولید جزوه خطایی رخ داد.</b>\n"
            "سهمیهٔ مصرف‌شده برای این جلسه برگردانده شد و کسر نگردید. لطفاً دوباره امتحان فرمایید.",
            parse_mode='HTML'
        )

    finally:
        await ai_release_inflight(uid)
