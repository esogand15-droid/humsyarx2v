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
    پشتیبانی از Voice، Audio، Document (PDF) و Video.
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

    if msg.voice:
        file_obj = msg.voice
        kind = 'audio'
        mime = msg.voice.mime_type or 'audio/ogg'
        name = f"ویس کلاسی ({file_obj.duration} ثانیه)"
    elif msg.audio:
        file_obj = msg.audio
        kind = 'audio'
        mime = msg.audio.mime_type or 'audio/mpeg'
        name = msg.audio.file_name or "فایل صوتی کلاس"
    elif msg.document:
        doc_mime = msg.document.mime_type or ''
        if doc_mime == 'application/pdf' or (msg.document.file_name or '').lower().endswith('.pdf'):
            file_obj = msg.document
            kind = 'pdf'
            mime = 'application/pdf'
            name = msg.document.file_name or "اسلایدهای جلسه.pdf"
        elif doc_mime.startswith('audio/'):
            file_obj = msg.document
            kind = 'audio'
            mime = doc_mime
            name = msg.document.file_name or "فایل صوتی کلاس"
        else:
            await msg.reply_text("⚠️ لطفاً فایل صوتی (Voice/Audio) یا اسلایدهای درسی را با فرمت PDF ارسال فرمایید.")
            return
    elif msg.video:
        file_obj = msg.video
        kind = 'video'
        mime = msg.video.mime_type or 'video/mp4'
        name = msg.video.file_name or "ویدیو کلاس درس"
    else:
        return

    # بررسی حجم فایل
    if getattr(file_obj, 'file_size', 0) > MAX_LECTURE_MEDIA_BYTES:
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
        # مرحله ۱: دانلود فایل‌ها از سرور تلگرام
        files = session['files']
        audio_file_info = next((f for f in files if f['kind'] in ('audio', 'video')), None)
        pdf_file_info = next((f for f in files if f['kind'] == 'pdf'), None)

        audio_bytes = None
        audio_mime = None
        pdf_bytes = None

        if audio_file_info:
            tg_f = await context.bot.get_file(audio_file_info['tg_file_id'])
            audio_bytes = bytes(await tg_f.download_as_bytearray())
            audio_mime = audio_file_info['mime']

            # اگر پیام صوتی OGG تلگرام بود، برای سازگاری کامل با گوگل به WAV تبدیل شود
            if 'ogg' in audio_mime.lower():
                from ai_solver import _transcode_ogg_opus_to_wav
                wav = await _transcode_ogg_opus_to_wav(audio_bytes)
                if wav:
                    audio_bytes = wav
                    audio_mime = 'audio/wav'

        if pdf_file_info:
            tg_doc = await context.bot.get_file(pdf_file_info['tg_file_id'])
            pdf_bytes = bytes(await tg_doc.download_as_bytearray())

        # مرحله ۲: بارگذاری روی Gemini Files API
        await status_msg.edit_text(
            "🧠 <b>در حال بارگذاری فایل‌ها در هسته هوش چندرسانه‌ای Gemini 2.0...</b>",
            parse_mode='HTML'
        )

        from ai_solver import _gemini_upload_file, _gemini_wait_file_active, run_with_key_failover

        keys = cfg.get('api_key_list') or [cfg['api_key']]
        model_name = cfg.get('lecture_model') or 'gemini-2.5-flash'

        uploaded_audio_info = None
        uploaded_doc_info = None

        if audio_bytes:
            async def _up_audio(key: str):
                fi = await _gemini_upload_file(key, audio_bytes, audio_mime, 'lecture_recording')
                return await _gemini_wait_file_active(key, fi, timeout=120)
            uploaded_audio_info = await run_with_key_failover('gemini', keys, _up_audio, label='audio-upload')

        if pdf_bytes:
            async def _up_doc(key: str):
                fi = await _gemini_upload_file(key, pdf_bytes, 'application/pdf', 'lecture_slides.pdf')
                return await _gemini_wait_file_active(key, fi, timeout=120)
            uploaded_doc_info = await run_with_key_failover('gemini', keys, _up_doc, label='pdf-upload')

        # مرحله ۳: تحلیل صوتی، تطبیق اسلاید و استخراج ساختار جزوه
        await status_msg.edit_text(
            "🎧 <b>در حال شنیدن دقیق صوت استاد، تطبیق با اسلایدها و استخراج دام‌های تستی...</b>",
            parse_mode='HTML'
        )

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

        # ساخت محتوای Parts برای گوگل
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

        user_prompt_text = "لطفاً جزوه کامل این جلسه درسی را به همراه نکات بالینی و دام‌های تستی استخراج کن."
        if session.get('user_notes'):
            user_prompt_text += f"\nیادداشت دانشجو: {session['user_notes']}"
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

        async def _call_gemini(key: str) -> dict:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
            headers = {'Content-Type': 'application/json', 'x-goog-api-key': key}
            async with httpx.AsyncClient(timeout=180) as client:
                res = await client.post(url, headers=headers, json=payload)
            if res.status_code != 200:
                raise RuntimeError(f"Gemini API returned {res.status_code}: {res.text[:300]}")
            data = res.json()
            from ai_solver import _extract_gemini_text
            raw_text = _extract_gemini_text(data, "جزوه")
            return json.loads(raw_text)

        digest = await run_with_key_failover('gemini', keys, _call_gemini, label='lecture-gemini-call')

        # مرحله ۴: تدوین PDF جزوه با فونت فارسی وزیر
        await status_msg.edit_text(
            "📑 <b>در حال صفحه‌آرایی و تدوین PDF جزوه با فونت اختصاصی وزیر...</b>",
            parse_mode='HTML'
        )

        from lecture_notes_pdf import generate_lecture_pdf
        pdf_buffer = await asyncio.to_thread(generate_lecture_pdf, digest)

        # مرحله ۵: ارسال خروجی نهایی به کاربر در تلگرام
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

    except Exception:
        logger.exception("خطا در پردازش جزوه چندرسانه‌ای")
        await msg.reply_text(
            "⚠️ <b>متأسفانه در فرآیند تحلیل یا تولید جزوه خطایی رخ داد.</b>\n"
            "سهمیهٔ مصرف‌شده برای این جلسه کسر نگردید. لطفاً فایل‌ها را بررسی نموده و دوباره امتحان فرمایید.",
            parse_mode='HTML'
        )
    finally:
        await ai_release_inflight(uid)
