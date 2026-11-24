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
import html
import base64
import asyncio
import logging
import tempfile
import shutil
from typing import Optional, Dict, Any, Tuple

import httpx
import telegram
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes

from database import db
from time_utils import today_tehran, now_utc, format_date_fa
from bot_modern_ui import ButtonGridBuilder, CompactTableBuilder


def expandable_quote(text: str) -> str:
    """قالب‌بندی نقل‌قول بازشونده طبق آخرین مستندات Bot API 10.x"""
    return f"<blockquote expandable>{text}</blockquote>"


def _parse_json_from_text(raw: str) -> dict:
    """استخراج و تمیزکاری JSON از پاسخ هوش مصنوعی (حذف تگ‌های markdown و استخراج شیء JSON)"""
    clean = (raw or '').strip()
    if clean.startswith("```"):
        clean = re.sub(r"^```(?:json)?\s*", "", clean, flags=re.IGNORECASE)
        clean = re.sub(r"\s*```$", "", clean)
    clean = clean.strip()
    try:
        return json.loads(clean)
    except json.JSONDecodeError:
        # در صورت وجود متن حاشیه‌ای قبل یا بعد از پاسخ مدل، استخراج شیء JSON بین اولین { و آخرین }
        m = re.search(r'(\{[\s\S]*\})', clean)
        if m:
            return json.loads(m.group(1))
        raise


# مدل‌های تأییدشده و معتبر گوگل برای جلوگیری از خطای مدل‌های خیالی
VERIFIED_MODEL_CASCADE = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.5-pro',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
]

HALLUCINATED_MODELS = [
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite',
]


def resolve_gemini_api_keys(cfg: dict | None = None, filter_cooldown: bool = True) -> list[str]:
    """Canonical resolver for Gemini API keys across MongoDB Vault and Environment Variables.

    Order of precedence:
      1. DB Vault keys ('gemini' provider list from vault_multi or api_key_list or api_key)
      2. GEMINI_API_KEYS (comma, semicolon, or newline delimited)
      3. GEMINI_API_KEY
      4. GOOGLE_API_KEY
    All keys are sanitized, trimmed, deduplicated, and passed through ordered_keys if filter_cooldown is True.
    """
    raw_keys: list[str] = []
    if cfg:
        vault_multi = cfg.get('vault_multi') or {}
        raw_keys.extend(vault_multi.get('gemini') or [])
        if not raw_keys and cfg.get('provider') == 'gemini':
            raw_keys.extend(cfg.get('api_key_list') or [])
        if not raw_keys and cfg.get('api_key'):
            raw_keys.append(cfg['api_key'])

    for env_k in ['GEMINI_API_KEYS', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']:
        env_val = os.getenv(env_k)
        if env_val:
            for part in re.split(r"[,;\s]+", env_val.strip()):
                cleaned = part.strip()
                if cleaned:
                    raw_keys.append(cleaned)

    from backend.services.ai_solver import sanitize_api_key, ordered_keys
    seen = set()
    deduped: list[str] = []
    for k in raw_keys:
        clean = sanitize_api_key(k) if k else ""
        if clean and clean not in seen:
            seen.add(clean)
            deduped.append(clean)
    if filter_cooldown:
        return ordered_keys('gemini', deduped)
    return deduped


def canonical_audio_mime(mime: str = '', filename: str = '') -> str:
    """Canonical resolver for audio MIME types for Google Gemini and modern decoders.

    Resolves:
      .m4a, .m4b, audio/x-m4a, audio/m4a -> audio/mp4
      .mp3, audio/mp3, audio/mpeg -> audio/mpeg
      .wav, audio/x-wav, audio/wav -> audio/wav
      .aac, audio/x-aac, audio/aac -> audio/aac
      .ogg, .opus, audio/ogg, audio/opus -> audio/ogg
      .flac, audio/flac -> audio/flac
    """
    mime_clean = (mime or '').lower().strip()
    fn_lower = (filename or '').lower().strip()

    if mime_clean in ('audio/mp4', 'audio/m4a', 'audio/x-m4a') or fn_lower.endswith(('.m4a', '.m4b')):
        return 'audio/mp4'
    if mime_clean in ('audio/mpeg', 'audio/mp3') or fn_lower.endswith('.mp3'):
        return 'audio/mpeg'
    if mime_clean in ('audio/wav', 'audio/x-wav') or fn_lower.endswith('.wav'):
        return 'audio/wav'
    if mime_clean in ('audio/aac', 'audio/x-aac') or fn_lower.endswith('.aac'):
        return 'audio/aac'
    if mime_clean in ('audio/ogg', 'audio/opus') or fn_lower.endswith(('.ogg', '.opus')):
        return 'audio/ogg'
    if mime_clean in ('audio/flac', 'audio/x-flac') or fn_lower.endswith('.flac'):
        return 'audio/flac'

    if mime_clean.startswith('audio/'):
        return mime_clean
    return 'audio/mpeg'


def sanitize_filename_for_disk(filename: str, default: str = "media_file") -> str:
    """Sanitizes a filename to ensure it is valid on Windows and Linux filesystems."""
    if not filename:
        return default
    cleaned = re.sub(r'[\\/*?:"<>|\x00-\x1f]', '_', filename).strip('. ')
    return cleaned or default


def resolve_candidate_models(cfg: dict | None = None) -> list[str]:
    """Canonical resolver for candidate Gemini models adhering to verified production hierarchy.

    Eliminates hallucinated models (gemini-3.6-flash, gemini-3.5-flash-lite)
    and establishes high-throughput cascade starting with gemini-2.5-flash.
    """
    hallucinated = set(HALLUCINATED_MODELS)
    preferred = ((cfg.get('lecture_model') if cfg else '') or 'gemini-2.5-flash').strip()

    models: list[str] = []
    if preferred and preferred not in hallucinated:
        models.append(preferred)

    for m in VERIFIED_MODEL_CASCADE:
        if m not in models:
            models.append(m)
    return models


def auto_repair_generation_config(gen_cfg: dict) -> dict:
    """Auto-repairs generationConfig on HTTP 400 schema/argument mismatch.

    Strips responseSchema and thinkingConfig while preserving responseMimeType='application/json'.
    """
    return {
        k: v for k, v in (gen_cfg or {}).items()
        if k not in ('responseSchema', 'thinkingConfig')
    }


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


async def transcode_audio_file(
    input_path: str,
    output_path: Optional[str] = None,
    bitrate: str = "32k",
    sample_rate: str = "16000",
    timeout: int = 300,
) -> str:
    """
    تبدیل استریم دیسک-به-دیسک با ffmpeg:
    ورودی رسانه روی دیسک را به فایل سبک ۱۶ کیلوهرتز تک‌کاناله MP3 با بیت‌ریت ۳۲ کیلوبیت تبدیل می‌کند (~۷۶٪ فشرده‌سازی گفتار).
    """
    ffmpeg_exe = _get_ffmpeg_path()
    if not output_path:
        fd, output_path = tempfile.mkstemp(suffix=".mp3", prefix="transcoded_")
        os.close(fd)

    if not ffmpeg_exe:
        logger.warning("ابزار ffmpeg در سیستم یافت نشد؛ مسیر ورودی دست‌نخورده استفاده می‌شود: %s", input_path)
        return input_path

    cmd = [
        ffmpeg_exe, '-y',
        '-i', input_path,
        '-vn',              # حذف ویدیوی اضافه در صورت وجود
        '-ar', str(sample_rate),  # فرکانس ۱۶۰۰۰ هرتز بهینه برای پردازش صوتی هوش مصنوعی
        '-ac', '1',          # تک‌کاناله مونو
        '-b:a', str(bitrate),# بیت‌ریت ۳۲ کیلوبیت برای کیفیت صدای شفاف و حجم سبک
        '-f', 'mp3',
        output_path,
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)

        if proc.returncode != 0 or not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            logger.warning(
                "خطا در تبدیل دیسک با ffmpeg (کد خروج %s): %s",
                proc.returncode,
                (stderr or b'')[:300].decode('utf-8', errors='ignore'),
            )
            return input_path

        return output_path
    except Exception as exc:
        logger.warning("استثنا حین تبدیل فایل با ffmpeg: %s", exc)
        return input_path


async def transcode_media_to_optimized_audio(
    media_bytes: bytes, original_name: str = '', bitrate: str = "32k"
) -> Tuple[bytes, str, str]:
    """
    تبدیل هوشمند انواع فرمت‌های صوتی و ویدیویی (m4a, aac, mp4, mkv, ogg, wav, flac, wma, ...)
    به فایل صوتی سبک استاندارد MP3 (تک‌کاناله ۱۶ کیلوهرتز ۳۲ کیلوبیت).
    - مصرف حجم را تا ۷۶٪ کاهش می‌دهد (مثلاً ۵۳ مگابایت به ۱۰ مگابایت)
    - استریم‌های ویدیویی اضافه را حذف می‌کند (-vn)
    - آپلود سریع بدون قطعی و تایم‌اوت را تضمین می‌کند
    - سازگاری ۱۰۰٪ با Google Gemini Files API بدون خطای MIME Type ایجاد می‌کند
    - نسخه سازگار برای بایت‌های درون حافظه و حفظ سازگاری تست‌های واحد.
    """
    ffmpeg_exe = _get_ffmpeg_path()
    ext = os.path.splitext(original_name.lower())[1] if original_name else '.m4a'
    if not ext:
        ext = '.m4a'

    if not ffmpeg_exe:
        logger.warning("ابزار ffmpeg در سیستم یافت نشد؛ فایل به صورت دست‌نخورده ارسال می‌شود.")
        safe_mime = 'audio/mp4' if ext in ('.m4a', '.mp4') else ('audio/aac' if ext == '.aac' else 'audio/mpeg')
        return media_bytes, safe_mime, original_name or 'lecture.mp3'

    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp_in:
        tmp_in.write(media_bytes)
        in_path = tmp_in.name

    out_path = None
    try:
        out_path = await transcode_audio_file(in_path, bitrate=bitrate)
        if out_path and os.path.exists(out_path) and out_path != in_path and os.path.getsize(out_path) > 0:
            with open(out_path, 'rb') as f:
                optimized_bytes = f.read()

            logger.info(
                "تبدیل موفق رسانه کلاسی: حجم اولیه %d بایت → بهینه %d بایت (کاهش %.1f%%)",
                len(media_bytes),
                len(optimized_bytes),
                (1.0 - (len(optimized_bytes) / max(len(media_bytes), 1))) * 100.0
            )
            return optimized_bytes, 'audio/mp3', 'optimized_lecture.mp3'

        safe_mime = 'audio/mp4' if ext in ('.m4a', '.mp4') else 'audio/mpeg'
        return media_bytes, safe_mime, original_name or 'lecture.mp3'
    except Exception:
        logger.exception("استثنا در فرآیند تبدیل رسانه کلاسی با ffmpeg")
        safe_mime = 'audio/mp4' if ext in ('.m4a', '.mp4') else 'audio/mpeg'
        return media_bytes, safe_mime, original_name or 'lecture.mp3'
    finally:
        for p in (in_path, out_path):
            if p and os.path.exists(p):
                try:
                    os.remove(p)
                except OSError:
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

    # افزودن فایل جدید به سشن (بدون فراخوانی شبکه تلگرام جهت جلوگیری از خطای سقف ۲۰ مگابایت)
    file_size_num = getattr(file_obj, 'file_size', None) or getattr(file_obj, 'file_size_bytes', None) or 0
    file_info = {
        'kind': kind,
        'mime': mime,
        'name': name,
        'tg_file_id': file_obj.file_id,
        'file_unique_id': getattr(file_obj, 'file_unique_id', None),
        'tg_file_path': None,
        'file_size': file_size_num,
        'chat_id': msg.chat_id,
        'message_id': msg.message_id,
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

    # دکمه‌های تشخیص هوشمند خودکار صوت
    if data == 'ls:smart_scribe':
        await query.answer()
        context.user_data['mode'] = 'lecture_scribe'
        pending_msg = context.user_data.pop('pending_smart_media_msg', None)
        try:
            await query.delete_message()
        except Exception:
            pass
        if pending_msg:
            # کپی پیام جهت ارسال به هندلر جزوه‌نویس
            update.message = pending_msg
            return await handle_lecture_file_input(update, context)
        return await show_lecture_scribe_intro(update, context)

    if data == 'ls:smart_ai':
        await query.answer()
        context.user_data['mode'] = 'ai_query'
        pending_msg = context.user_data.pop('pending_smart_media_msg', None)
        try:
            await query.delete_message()
        except Exception:
            pass
        if pending_msg:
            update.message = pending_msg
            from ai_solver import handle_ai_media
            return await handle_ai_media(update, context)
        from ai_solver import show_ai_intro
        return await show_ai_intro(update, context)

    if data == 'ls:smart_cancel':
        context.user_data.pop('pending_smart_media_msg', None)
        await query.answer("عملیات لغو شد.")
        try:
            await query.delete_message()
        except Exception:
            pass
        return

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


def format_persian_lecture_error(exc: Exception) -> str:
    """Format reassuring Persian error message mapped to error category."""
    from backend.services.ai_solver import AIQuotaError
    err_str = str(exc).lower() if exc else ""
    if isinstance(exc, AIQuotaError) or "429" in err_str or "quota" in err_str or "سقف" in str(exc):
        return (
            "⚠️ <b>تکمیل موقت ظرفیت پردازش هوش مصنوعی</b>\n\n"
            "دانشجوی گرامی، به دلیل ترافیک بسیار بالای سرورهای هوش مصنوعی، امکان تکمیل پردازش این فایل در حال حاضر میسر نشد.\n\n"
            "✅ <b>سهمیه شما محفوظ ماند:</b> سهمیهٔ مصرف‌شده برای این جلسه برگردانده شد و کسر نگردید (کاملاً محفوظ است).\n"
            "لطفاً چند دقیقه دیگر مجدداً تلاش فرمایید یا فایل خود را در ساعتی خلوت‌تر ارسال فرمایید."
        )
    if isinstance(exc, (httpx.TimeoutException, httpx.ConnectError, asyncio.TimeoutError)) or "timeout" in err_str or "connect" in err_str:
        return (
            "⏱ <b>خطای وقفه در ارتباط شبکه (Timeout)</b>\n\n"
            "ارتباط با سرور پردازش ابری به دلیل حجم بالای محتوا یا اختلال لحظه‌ای شبکه اینترنت قطع شد.\n\n"
            "✅ <b>سهمیه شما بازگردانده شد:</b> سهمیهٔ مصرف‌شده برای این جلسه برگردانده شد و کسر نگردید.\n"
            "پیشنهاد می‌شود از پایداری ارتباط اطمینان حاصل فرموده و مجدداً فایل خود را ارسال نمایید."
        )
    if isinstance(exc, (json.JSONDecodeError, ValueError)) or "audio" in err_str or "صوت" in str(exc) or "codec" in err_str:
        return (
            "🎙 <b>اشکال در تحلیل و پردازش محتوای جلسه</b>\n\n"
            "فایل صوتی ارسال‌شده فاقد وضوح کافی گفتار است، مخدوش بوده و یا ساختار علمی جلسه کلاسی از آن قابل استخراج نبود.\n\n"
            "✅ <b>سهمیه شما کسر نگردید:</b> سهمیهٔ مصرف‌شده برای این جلسه برگردانده شد و کسر نگردید.\n"
            "لطفاً مطمئن شوید فایل حاوی صدای واضح تدریس استاد با فرمت معتبر صوتی (مانند MP3 یا M4A) است و مجدداً امتحان فرمایید."
        )
    return (
        "⚠️ <b>بروز خطای غیرمنتظره در تولید جزوه</b>\n\n"
        "متأسفانه در حین پردازش نهایی و تدوین جزوه اختلالی رخ داد و تکمیل فایل با مشکل مواجه شد.\n\n"
        "✅ <b>سهمیه شما بازگردانده شد:</b> سهمیهٔ مصرف‌شده برای این جلسه برگردانده شد و کسر نگردید.\n"
        "تیم فنی از بروز این خطا مطلع شد. لطفاً چند لحظه بعد مجدداً فایل خود را ارسال فرمایید."
    )



async def run_lecture_processing_worker(
    bot: telegram.Bot,
    chat_id: int,
    uid: int,
    session: Optional[dict] = None,
    status_msg_id: int = 0,
    status_updater: Optional[Any] = None,
    session_id: Optional[str] = None,
    file_info: Optional[Any] = None,
    **kwargs,
) -> bool:
    """
    پردازش کامل و ایزوله جلسه درسی در پس‌زمینه (Worker Queue):
    - دانلود مستقیم روی دیسک با telegram_downloader (بدون محدودیت ۲۰ مگابایت)
    - تبدیل استریم دیسک-به-دیسک با transcode_audio_file
    - ارسال به مدل‌های چندرسانه‌ای هوش مصنوعی با چرخش خودکار کلیدها و مدل‌ها
    - تولید سند آکادمیک PDF با سربرگ هامزیار و تحویل در چت کاربر
    - مدیریت خطای اتمیک: استرداد تضمینی سهمیه و آزادسازی قفل در finally
    """
    from backend.services.ai_solver import (
        ai_claim_inflight, ai_release_inflight, refund_lecture_quota, get_ai_config,
        sanitize_api_key, ordered_keys, run_with_key_failover,
        _gemini_upload_file, _gemini_wait_file_active,
        _extract_gemini_text, _raise_gemini_status_error,
        AIConfigError, AIQuotaError, AIError, _no_thinking,
        ai_is_inflight, _busy_users
    )
    from backend.services.telegram_downloader import download_telegram_media

    async def _update_status(text: str, force: bool = False):
        if status_updater:
            if callable(status_updater):
                await status_updater(text, force=force)
            elif hasattr(status_updater, 'update'):
                await status_updater.update(text, force=force)
        elif bot and chat_id and status_msg_id:
            try:
                await bot.edit_message_text(chat_id=chat_id, message_id=status_msg_id, text=text, parse_mode='HTML')
            except Exception:
                pass

    # بازیابی اطلاعات سشن
    if session is None:
        if session_id and session_id in _LECTURE_SESSIONS:
            session = _LECTURE_SESSIONS[session_id]
        elif isinstance(file_info, dict) and 'files' in file_info:
            session = file_info
        elif isinstance(file_info, dict):
            session = {'session_id': session_id or f'ls_{uid}', 'user_id': uid, 'files': [file_info]}
        elif isinstance(file_info, list):
            session = {'session_id': session_id or f'ls_{uid}', 'user_id': uid, 'files': file_info}
        else:
            session = {}

    sess_id = session.get('session_id') or session_id or f"ls_{uid}_{uuid.uuid4().hex[:6]}"
    files = session.get('files', [])
    if not files and isinstance(file_info, dict):
        files = [file_info]
        session['files'] = files

    job_temp_dir = None
    quota_consumed = kwargs.get('quota_consumed', True)

    try:
        if not files:
            if quota_consumed:
                try:
                    await refund_lecture_quota(uid)
                except Exception as ref_err:
                    logger.error("Failed to refund lecture quota for user %s: %s", uid, ref_err)
                quota_consumed = False
            await _update_status("⚠️ اطلاعات فایل‌های جلسه یافت نشد یا منقضی شده است.", force=True)
            return False

        job_temp_dir = tempfile.mkdtemp(prefix=f"lecture_{sess_id}_")

        # اخذ قفل اجرای همزمان (در صورتی که قبلاً توسط run_lecture_processing ثبت نشده باشد)
        if uid not in _busy_users and not await ai_is_inflight(uid):
            if not await ai_claim_inflight(uid):
                if quota_consumed:
                    try:
                        await refund_lecture_quota(uid)
                    except Exception as ref_err:
                        logger.error("Failed to refund lecture quota for user %s: %s", uid, ref_err)
                    quota_consumed = False
                await _update_status("⏳ لطفاً تا اتمام پردازش درخواست فعلی خود صبر فرمایید.", force=True)
                return False
        cfg = await get_ai_config()

        # مرحله ۱: دانلود فایل‌ها از سرور تلگرام به صورت دیسک-به-دیسک
        audio_file_info = next((f for f in files if f.get('kind') in ('audio', 'video')), None)
        pdf_file_info = next((f for f in files if f.get('kind') == 'pdf'), None)

        audio_bytes = None
        audio_mime = None
        pdf_bytes = None

        if audio_file_info:
            file_name = audio_file_info.get('name') or 'lecture_media.m4a'
            safe_audio_fn = sanitize_filename_for_disk(file_name, "lecture_media.m4a")
            await _update_status(
                f"📥 <b>در حال دریافت فایل صوتی/تصویری از تلگرام...</b>\n📁 <code>{file_name}</code>",
                force=True
            )
            raw_audio_path = os.path.join(job_temp_dir, f"raw_{safe_audio_fn}")
            await download_telegram_media(
                bot=bot,
                chat_id=audio_file_info.get('chat_id') or chat_id,
                message_id=audio_file_info.get('message_id') or status_msg_id,
                file_id=audio_file_info['tg_file_id'],
                file_size=audio_file_info.get('file_size', 0),
                dest_path=raw_audio_path,
            )

            await _update_status(
                "⚡️ <b>در حال بهینه‌سازی صوت و فشرده‌سازی برای پردازش فوق‌سریع هوش مصنوعی...</b>",
                force=True
            )
            out_mp3_path = os.path.join(job_temp_dir, "optimized_lecture.mp3")
            optimized_path = await transcode_audio_file(
                input_path=raw_audio_path,
                output_path=out_mp3_path,
                bitrate="32k",
            )
            if optimized_path and optimized_path != raw_audio_path and os.path.exists(optimized_path) and os.path.getsize(optimized_path) > 0:
                with open(optimized_path, 'rb') as f:
                    audio_bytes = f.read()
                audio_mime = 'audio/mpeg'
            elif os.path.exists(raw_audio_path):
                with open(raw_audio_path, 'rb') as f:
                    audio_bytes = f.read()
                audio_mime = canonical_audio_mime(audio_file_info.get('mime'), file_name)

        if pdf_file_info:
            pdf_name = pdf_file_info.get('name') or 'lecture_slides.pdf'
            safe_pdf_fn = sanitize_filename_for_disk(pdf_name, "lecture_slides.pdf")
            await _update_status(
                f"📄 <b>در حال دانلود اسلایدهای جلسه (PDF)...</b>\n📁 <code>{pdf_name}</code>",
                force=True
            )
            raw_pdf_path = os.path.join(job_temp_dir, f"slides_{safe_pdf_fn}")
            await download_telegram_media(
                bot=bot,
                chat_id=pdf_file_info.get('chat_id') or chat_id,
                message_id=pdf_file_info.get('message_id') or status_msg_id,
                file_id=pdf_file_info['tg_file_id'],
                file_size=pdf_file_info.get('file_size', 0),
                dest_path=raw_pdf_path,
            )
            if os.path.exists(raw_pdf_path):
                with open(raw_pdf_path, 'rb') as f:
                    pdf_bytes = f.read()

        # مرحله ۲: استخراج کلیدهای Gemini و پالایش ترتیب
        gemini_keys = resolve_gemini_api_keys(cfg)

        if not gemini_keys:
            raise AIConfigError(
                "هیچ کلید فعالی برای Google Gemini در بخش مدیریت هوش مصنوعی وب‌ادمین یافت نشد. "
                "لطفاً کلیدهای Google AI Studio را در پنل ادمین ثبت فرمایید."
            )

        # مرحله ۳: تعریف مدل‌های معتبر گوگل به صورت آبشاری (Cascade Fallback)
        candidate_models = resolve_candidate_models(cfg)

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

        # مرحله ۴: اجرای پایپ‌لاین تحلیل با فال‌بک کلیدها
        async def _process_with_gemini_key(key: str) -> dict:
            parts = []

            if audio_bytes:
                if len(audio_bytes) < 15 * 1024 * 1024:
                    b64_audio = base64.b64encode(audio_bytes).decode('utf-8')
                    parts.append({
                        'inline_data': {
                            'mime_type': audio_mime or 'audio/mpeg',
                            'data': b64_audio
                        }
                    })
                else:
                    await _update_status(
                        "🧠 <b>در حال بارگذاری صوت طولانی جلسه در پردازشگر ابری گوگل...</b>",
                        force=True
                    )
                    ext = 'm4a' if 'mp4' in (audio_mime or '') or 'm4a' in (audio_mime or '') else 'mp3'
                    upload_mime = audio_mime or ('audio/mp4' if ext == 'm4a' else 'audio/mpeg')
                    fi = await _gemini_upload_file(key, audio_bytes, upload_mime, f'lecture_recording.{ext}')
                    uploaded_audio = await _gemini_wait_file_active(key, fi, timeout=180)
                    state = ((uploaded_audio or {}).get('state') or '').upper()
                    if uploaded_audio and state == 'ACTIVE' and uploaded_audio.get('uri'):
                        parts.append({
                            'file_data': {
                                'file_uri': uploaded_audio['uri'],
                                'mime_type': uploaded_audio.get('mimeType') or upload_mime
                            }
                        })
                    elif state == 'FAILED':
                        raise AIError("Google Gemini failed to process the uploaded audio file (state FAILED).")
                    else:
                        raise AIError(f"فایل صوتی بارگذاری‌شده در گوگل در وضعیت فعال قرار نگرفت (state={state or 'UNKNOWN'}).")

            if pdf_bytes:
                if len(pdf_bytes) < 10 * 1024 * 1024:
                    b64_pdf = base64.b64encode(pdf_bytes).decode('utf-8')
                    parts.append({
                        'inline_data': {
                            'mime_type': 'application/pdf',
                            'data': b64_pdf
                        }
                    })
                else:
                    await _update_status(
                        "📑 <b>در حال بارگذاری اسلایدهای حجیم در پردازشگر ابری گوگل...</b>",
                        force=True
                    )
                    fi = await _gemini_upload_file(key, pdf_bytes, 'application/pdf', 'lecture_slides.pdf')
                    uploaded_doc = await _gemini_wait_file_active(key, fi, timeout=180)
                    state = ((uploaded_doc or {}).get('state') or '').upper()
                    if uploaded_doc and state == 'ACTIVE' and uploaded_doc.get('uri'):
                        parts.append({
                            'file_data': {
                                'file_uri': uploaded_doc['uri'],
                                'mime_type': 'application/pdf'
                            }
                        })
                    elif state == 'FAILED':
                        raise AIError("Google Gemini failed to process the uploaded slides PDF (state FAILED).")
                    else:
                        raise AIError(f"فایل اسلایدها در گوگل در وضعیت فعال قرار نگرفت (state={state or 'UNKNOWN'}).")

            parts.append({'text': user_prompt_text})

            last_model_error = None
            for model_cand in candidate_models:
                await _update_status(
                    f"🎧 <b>در حال شنیدن دقیق صوت و نگارش جزوه با هوش چندرسانه‌ای ({model_cand})...</b>",
                    force=False
                )
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_cand}:generateContent"
                headers = {'Content-Type': 'application/json', 'x-goog-api-key': key}

                gen_cfg = _no_thinking({
                    'responseMimeType': 'application/json',
                    'responseSchema': LECTURE_DIGEST_SCHEMA,
                    'maxOutputTokens': 8192,
                    'temperature': 0.2,
                }, model=model_cand)

                payload = {
                    'system_instruction': {'parts': [{'text': system_prompt}]},
                    'contents': [{'role': 'user', 'parts': parts}],
                    'generationConfig': gen_cfg
                }

                async with httpx.AsyncClient(timeout=240) as client:
                    res = await client.post(url, headers=headers, json=payload)

                if res.status_code == 400:
                    logger.warning("مدل %s با خطای ۴۰۰ مواجه شد (%s)؛ تلاش مجدد با حذف responseSchema و thinkingConfig...", model_cand, res.text[:140])
                    fallback_cfg = auto_repair_generation_config(gen_cfg)
                    fallback_payload = dict(payload)
                    fallback_payload['generationConfig'] = fallback_cfg
                    async with httpx.AsyncClient(timeout=240) as client:
                        res = await client.post(url, headers=headers, json=fallback_payload)

                if res.status_code == 200:
                    try:
                        data = res.json()
                        raw_text = _extract_gemini_text(data, "جزوه")
                        return _parse_json_from_text(raw_text)
                    except Exception as parse_err:
                        logger.warning("خطا در پردازش JSON دریافتی از مدل %s: %s", model_cand, parse_err)
                        last_model_error = AIError(f"JSON parse error from {model_cand}: {parse_err}")
                        continue

                if res.status_code == 429:
                    logger.warning("کلید Gemini به سقف درخواست (429) رسید → سوییچ خودکار به کلید بعدی Vault...")
                    _raise_gemini_status_error(429, res.text)

                if res.status_code in (401, 403):
                    logger.warning("کلید Gemini با کد %d نامعتبر است → سوییچ خودکار به کلید بعدی...", res.status_code)
                    _raise_gemini_status_error(res.status_code, res.text)

                if res.status_code in (400, 404, 503):
                    logger.warning("مدل %s با کد %d پاسخ نداد (%s)؛ سوئیچ به مدل بعدی در زنجیره فال‌بک...", model_cand, res.status_code, res.text[:140])
                    last_model_error = AIError(f"Model {model_cand} returned {res.status_code}: {res.text[:120]}")
                    continue

                _raise_gemini_status_error(res.status_code, res.text)

            if last_model_error:
                raise last_model_error
            raise AIError("هیچ‌کدام از مدل‌های هوش مصنوعی فعال نبودند.")

        digest = await run_with_key_failover(
            'gemini', gemini_keys, _process_with_gemini_key, label='lecture-gemini-pipeline'
        )

        # مرحله ۵: تدوین سند آکادمیک PDF با فونت فارسی وزیر
        await _update_status(
            "📑 <b>در حال صفحه‌آرایی و تدوین PDF جزوه با سربرگ هامزیار و فونت اختصاصی وزیر...</b>",
            force=True
        )

        from lecture_notes_pdf import generate_lecture_pdf
        pdf_buffer = await asyncio.to_thread(generate_lecture_pdf, digest)

        # مرحله ۶: ارسال خروجی نهایی به کاربر در تلگرام با پاکسازی HTML
        title = digest.get('title') or 'جزوه کلاسی'
        subject = digest.get('subject') or 'علوم پزشکی'
        professor = digest.get('professor') or 'هیات علمی'
        session_name = digest.get('session') or 'جلسه کلاسی'
        exec_summary = (digest.get('executive_summary') or '').strip()
        pearls = digest.get('clinical_pearls') or []
        traps = digest.get('exam_traps') or []
        qna = digest.get('qna_list') or []
        comp_tbl = digest.get('comparison_table') or {}

        # پاکسازی کاراکترهای خطرناک HTML (<, >, &) برای جلوگیری از خطای تلگرام
        safe_title = html.escape(title)
        safe_subject = html.escape(subject)
        safe_professor = html.escape(professor)
        safe_session_name = html.escape(session_name)
        safe_tbl_title = html.escape(comp_tbl.get('title') or 'دارد')

        # کنترل سقف طول متن خلاصه برای رعایت محدودیت ۴۰۹۶ کاراکتری پیام تلگرام
        safe_exec_summary = html.escape(exec_summary)
        if len(safe_exec_summary) > 2000:
            safe_exec_summary = safe_exec_summary[:1950] + "..."

        summary_content = (
            f"<b>🎯 خلاصه اجرایی و اهداف جلسه:</b>\n{safe_exec_summary}\n\n"
            f"<b>💎 مرواریدهای بالینی:</b> {len(pearls)} نکته کلیدی\n"
            f"<b>🚨 دام‌های تستی پره‌انترنی و دستیاری:</b> {len(traps)} نکته دامی\n"
            f"<b>📊 جدول مقایسه‌ای:</b> {safe_tbl_title}\n"
            f"<b>❓ پرسش و پاسخ‌های تثبیت یادگیری:</b> {len(qna)} سوال"
        )
        quoted_block = expandable_quote(summary_content)

        caption_msg = (
            f"🎓 <b>جزوه جامع کلاسی تدوین شد!</b>\n"
            f"━━━━━━━━━━━━━━━━\n"
            f"📌 <b>عنوان:</b> {safe_title}\n"
            f"📚 <b>درس:</b> {safe_subject} • <b>جلسه:</b> {safe_session_name}\n"
            f"👨‍🏫 <b>استاد:</b> {safe_professor}\n\n"
            f"{quoted_block}\n\n"
            "📥 <i>فایل کامل جزوه با کیفیت بالا و فونت اختصاصی فارسی پیوست گردید:</i>"
        )

        safe_name = re.sub(r'[\/:*?"<>| ]+', '_', title)[:40].strip('_') or 'Lecture'
        filename = f"HamsYar_{safe_name}.pdf"

        # پاک کردن پیام وضعیت در صورت امکان
        if status_msg_id and bot and chat_id:
            try:
                await bot.delete_message(chat_id=chat_id, message_id=status_msg_id)
            except Exception:
                pass

        # ارسال پیام خلاصه با فال‌بک متن ساده
        if bot and chat_id:
            try:
                await bot.send_message(chat_id=chat_id, text=caption_msg, parse_mode='HTML')
            except Exception as html_err:
                logger.warning("خطا در ارسال HTML پیام خلاصه تلگرام، ارسال به صورت متن خام: %s", html_err)
                plain_caption = re.sub(r'<[^>]+>', '', caption_msg)
                await bot.send_message(chat_id=chat_id, text=plain_caption)

            # ارسال فایل PDF با retry مکانیزم و ریست مطمئن بافر
            doc_sent = False
            last_doc_err = None
            for attempt in range(3):
                try:
                    pdf_buffer.seek(0)
                    await bot.send_document(
                        chat_id=chat_id,
                        document=pdf_buffer,
                        filename=filename,
                        caption=f"📄 {title} — {subject}",
                        read_timeout=60,
                        write_timeout=60,
                    )
                    doc_sent = True
                    break
                except Exception as send_err:
                    last_doc_err = send_err
                    logger.warning("تلاش %d برای ارسال سند PDF ناموفق بود: %s", attempt + 1, send_err)
                    await asyncio.sleep(1.5)

            if not doc_sent:
                raise last_doc_err or Exception("عدم موفقیت در ارسال سند PDF تلگرام پس از ۳ تلاش")

        # پاکسازی سشن و تثبیت سهمیه
        quota_consumed = False
        _LECTURE_SESSIONS.pop(sess_id, None)
        return True

    except Exception as exc:
        logger.exception("خطا در پردازش جزوه چندرسانه‌ای در صف پس‌زمینه: %s", exc)
        if quota_consumed:
            try:
                await refund_lecture_quota(uid)
            except Exception as ref_err:
                logger.error("Failed to refund lecture quota for user %s: %s", uid, ref_err)
            quota_consumed = False
        persian_err = format_persian_lecture_error(exc)
        await _update_status(persian_err, force=True)
        return False

    finally:
        try:
            await ai_release_inflight(uid)
        except Exception:
            pass
        _LECTURE_SESSIONS.pop(sess_id, None)
        if job_temp_dir and os.path.exists(job_temp_dir):
            shutil.rmtree(job_temp_dir, ignore_errors=True)


async def run_lecture_processing(update: Update, context: ContextTypes.DEFAULT_TYPE, session_id: str):
    """اجرای پایپ‌لاین پردازش چندرسانه‌ای با ارسال فوری و غیرمسدودکننده به صف LectureWorkerQueue (<200ms)"""
    uid = update.effective_user.id
    query = update.callback_query
    msg = query.message if query else update.effective_message

    session = _LECTURE_SESSIONS.get(session_id)
    if not session or not session.get('files'):
        await msg.reply_text("⚠️ اطلاعات این جلسه یافت نشد یا منقضی شده است. لطفاً فایل‌ها را مجدداً ارسال فرمایید.")
        return

    # ۱. گارد هم‌زمانی: ابتدا قفل اجرای همزمان بررسی می‌شود تا هیچ سهمیه‌ای برای درخواست موازی کسر نشود
    from ai_solver import ai_claim_inflight, ai_release_inflight, check_and_consume_lecture_quota, refund_lecture_quota
    if not await ai_claim_inflight(uid):
        await msg.reply_text(
            "⏳ <b>شما در حال حاضر یک درخواست در حال پردازش دارید.</b>\n"
            "لطفاً تا اتمام تولید جزوه قبلی شکیبا باشید.",
            parse_mode='HTML'
        )
        return

    quota_consumed = False
    try:
        # ۲. بررسی و کسر سهمیه روزانه کاربر
        allowed, used, limit = await check_and_consume_lecture_quota(uid)
        if not allowed:
            await ai_release_inflight(uid)
            await msg.reply_text(
                f"⛔️ <b>سقف روزانهٔ تولید جزوه پایان یافته است ({used}/{limit}).</b>\n"
                "فردا مجدداً می‌توانید برای کلاس‌های جدید جزوه تولید کنید.",
                parse_mode='HTML'
            )
            return
        quota_consumed = True

        # ۳. ثبت پیام وضعیت اولیه
        status_msg = await msg.reply_text(
            "⏳ <b>درخواست شما در صف پردازش قرار گرفت...</b>\n"
            "به محض شروع، مراحل پیشرفت در همین پیام به‌روزرسانی خواهد شد.",
            parse_mode='HTML'
        )

        # ۴. ارسال به صف پس‌زمینه LectureWorkerQueue (<200ms)
        from backend.services.lecture_worker import get_lecture_worker_queue
        worker = get_lecture_worker_queue()
        enqueued = await worker.enqueue_job(
            chat_id=msg.chat_id,
            user_id=uid,
            session_id=session_id,
            file_info=session,
            status_message_id=status_msg.message_id,
            bot=context.bot,
            quota_consumed=True,
        )

        if not enqueued:
            if quota_consumed:
                await refund_lecture_quota(uid)
                quota_consumed = False
            await ai_release_inflight(uid)
            await status_msg.edit_text(
                "⚠️ <b>صف پردازش در حال حاضر تکمیل است.</b>\n"
                "سهمیه شما محفوظ ماند و کسر نگردید. لطفاً چند دقیقه دیگر مجدداً تلاش فرمایید.",
                parse_mode='HTML'
            )
            return

        # پاکسازی وضعیت سشن از user_data تا کاربر معطل نماند
        context.user_data.pop('lecture_session_id', None)
        context.user_data['mode'] = 'ai_query'

    except Exception as exc:
        logger.exception("خطا در ثبت درخواست جزوه در صف: %s", exc)
        if quota_consumed:
            try:
                await refund_lecture_quota(uid)
            except Exception:
                pass
            quota_consumed = False
        try:
            await ai_release_inflight(uid)
        except Exception:
            pass
        persian_err = format_persian_lecture_error(exc)
        await msg.reply_text(persian_err, parse_mode='HTML')

