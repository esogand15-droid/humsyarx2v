"""
🧪 tests/test_lecture_scribe.py — آزمون‌های خودکار دستیار جزوه‌نویس چندرسانه‌ای
HamsYar Medical Platform — Premium v2 (1405)
"""

import io
import os
import sys

os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017/humsyar_test")
os.environ.setdefault("ADMIN_ID", "999")
os.environ.setdefault("TELEGRAM_TOKEN", "123:TEST_TOKEN")

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)
_SERVICES = os.path.join(_ROOT, "backend", "services")
if _SERVICES not in sys.path:
    sys.path.insert(0, _SERVICES)
_BOT = os.path.join(_ROOT, "backend", "bot")
if _BOT not in sys.path:
    sys.path.insert(0, _BOT)

import pytest
import pypdf
from unittest.mock import AsyncMock, MagicMock, patch

from backend.services.lecture_notes_pdf import generate_lecture_pdf, NumberedCanvas
from backend.services.lecture_scribe import (
    LECTURE_DIGEST_SCHEMA, _LECTURE_SESSIONS, show_lecture_scribe_intro,
    handle_lecture_file_input, handle_lecture_callback
)
from backend.bot.faq import DEFAULT_FAQS


def test_lecture_digest_schema_valid():
    """اعتبارسنجی اسکیما و ساختار JSON جزوه برای گوگل جمنای"""
    assert LECTURE_DIGEST_SCHEMA["type"] == "OBJECT"
    props = LECTURE_DIGEST_SCHEMA["properties"]
    assert "title" in props
    assert "subject" in props
    assert "executive_summary" in props
    assert "topics" in props
    assert "clinical_pearls" in props
    assert "exam_traps" in props
    assert "comparison_table" in props
    assert "qna_list" in props


def test_generate_lecture_pdf_render():
    """تولید PDF کامل با فونت وزیر و تمامی کادرهای بالینی و آزمونی"""
    digest = {
        "title": "فارماکولوژی داروهای کاهنده فشار خون و اینوتروپ",
        "subject": "فارماکولوژی بالینی",
        "professor": "دکتر زمانی",
        "session": "جلسه ۳",
        "date": "۱۴۰۵/۰۸/۲۵",
        "executive_summary": "بررسی مهارکننده‌های ACE، مسدودکننده‌های گیرنده آنژیوتانسین (ARB)، بلوکرهای کانال کلسیم و داروهای وازودیلاتور اورژانس فشار خون.",
        "topics": [
            {
                "title": "مهارکننده‌های سیستم رنین-آنژیوتانسین",
                "content": "مهار ACE مانع تبدیل آنژیوتانسین I به II و کاهش تخریب برادی‌کینین می‌شود که منجر به وازودیلاسیون سیستمیک و کاهش افترلود می‌گردد.",
                "clinical_points": "پایش سطح کراتینین و پتاسیم سرم ۲ هفته پس از شروع الزامی است."
            },
            {
                "title": "بلوکرهای کانال‌های کلسیمی (CCB)",
                "content": "دی‌هیدروپیریدین‌ها (مثل آملودیپین) عمدتاً روی عروق اثر دارند و نان‌دی‌هیدروپیریدین‌ها (وراپامیل و دیلتیازم) روی گره SA و AV اثر منفی دارند.",
                "clinical_points": "ادم اندام تحتانی شایع‌ترین عارضه خوش‌خیم آملودیپین به علت وازودیلاسیون پیش‌مویرگی است."
            }
        ],
        "clinical_pearls": [
            "در بیماران دیابتی مبتلا به فشار خون، داروهای مهارکننده ACE یا ARB خط اول درمان هستند تا اثرات نفروپروتکتیو اعمال کنند.",
            "ترکیب همزمان ACE-I و ARB به علت افزایش خطر نارسایی حاد کلیه و هایپرکالمی ممنوع است."
        ],
        "exam_traps": [
            "دام پره‌انترنی: سرفه خشک ناشی از انالاپریل به علت تجمع برادی‌کینین و ماده P است و با آنتی‌هیستامین درمان نمی‌شود و باید به لوزارتان سوئیچ گردد.",
            "دام دستیاری: در اورژانس فشار خون همراه با دایسکشن آئورت، ابتدا بتابلوکر (لابتالول/اسمولول) تجویز می‌شود و سپس وازودیلاتور تا مانع تاکی‌کاردی رفلکسی شود."
        ],
        "comparison_table": {
            "title": "مقایسه داروهای خط اول پرفشاری خون",
            "headers": ["کلاس دارو", "مکانیسم", "اندیکاسیون انتخابی", "منع مصرف قطعی"],
            "rows": [
                ["ACE-I", "مهار تبدیل AT-I به AT-II", "دیابت، نارسایی قلبی", "بارداری، آنژیوادم"],
                ["ARB", "بلوک اختصاصی گیرنده AT1", "عدم تحمل سرفه ACE-I", "بارداری، تنگی دوطرفه شریان کلیه"],
                ["DHP-CCB", "بلوک کانال کلسیم نوع L عروقی", "سالمندان، فشار خون سیستولیک", "نارسایی شدید قلبی HFrEF"]
            ]
        },
        "qna_list": [
            {
                "question": "کدام داروی ضد فشار خون در زنان باردار مبتلا به پره‌اکلامپسی ایمن‌ترین گزینه است؟",
                "answer": "متیل‌دوپا، لابتالول خوراکی و نیفدیپین پیوسته رهش گزینه‌های انتخابی و ایمن هستند. ACE-I و ARB کاملاً تراتوژن و ممنوع می‌باشند."
            }
        ]
    }

    buf = generate_lecture_pdf(digest)
    pdf_bytes = buf.getvalue()
    assert len(pdf_bytes) > 20000, "حجم PDF باید بیشتر از ۲۰ کیلوبایت باشد"

    reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
    assert len(reader.pages) >= 2, "PDF باید حداقل ۲ صفحه (جلد + محتوا) داشته باشد"

    # بررسی متن استخراج‌شده
    full_text = " ".join(p.extract_text() for p in reader.pages)
    assert len(full_text) > 500, "متن استخراج‌شده باید غنی باشد"


def test_faq_contains_lecture_scribe_and_pwa():
    """بررسی وجود بخش جزوه‌نویس کلاسی و راهنمای PWA در سوالات متداول"""
    ai_faqs = DEFAULT_FAQS.get('🤖 هوشیار (دستیار هوشمند)', [])
    questions = [q for q, a in ai_faqs]

    assert any("جزوه‌نویس" in q for q in questions), "سوال متداول جزوه‌نویس باید در هوشیار موجود باشد"
    assert any("Stop" in q or "توقف" in q for q in questions), "سوال متداول دکمه Stop باید موجود باشد"

    pwa_faqs = DEFAULT_FAQS.get('📲 وب‌اپلیکیشن مستقل (PWA)', [])
    assert len(pwa_faqs) >= 4, "بخش PWA باید حداقل ۴ سوال راهنما داشته باشد"
    pwa_qs = [q for q, a in pwa_faqs]
    assert any("iOS" in q or "آیفون" in q for q in pwa_qs), "راهنمای نصب آیفون باید در PWA موجود باشد"
    assert any("اندروید" in q or "Android" in q for q in pwa_qs), "راهنمای اندروید باید در PWA موجود باشد"
    assert any("ویندوز" in q for q in pwa_qs), "راهنمای ویندوز باید در PWA موجود باشد"


def test_lecture_scribe_session_buffer_option_a():
    """تست چرخه سشن تعاملی با دکمه (Option A) هنگام ارسال ویس اول"""
    import asyncio

    async def _run():
        mock_update = MagicMock()
        mock_update.effective_user.id = 12345
        mock_msg = MagicMock()
        mock_msg.caption = "جلسه قلب"
        mock_msg.voice = MagicMock()
        mock_msg.voice.duration = 180
        mock_msg.voice.file_id = "voice_file_123"
        mock_msg.voice.file_size = 500000
        mock_msg.voice.mime_type = "audio/ogg"
        mock_msg.audio = None
        mock_msg.document = None
        mock_msg.video = None

        tg_file_mock = MagicMock()
        tg_file_mock.file_path = "https://tg.org/voice.oga"
        mock_msg.voice.get_file = AsyncMock(return_value=tg_file_mock)
        mock_msg.reply_text = AsyncMock()
        mock_update.message = mock_msg

        mock_context = MagicMock()
        mock_context.user_data = {}

        await handle_lecture_file_input(mock_update, mock_context)

        # بررسی فراخوانی reply_text با دکمه‌های تعاملی
        assert mock_msg.reply_text.called
        call_args = mock_msg.reply_text.call_args
        sent_text = call_args[0][0]
        assert "فایل جلسه با موفقیت دریافت شد" in sent_text
        assert "آیا مایلید فایل مکمل دیگری نیز پیوست کنید" in sent_text

        markup = call_args[1].get('reply_markup')
        assert markup is not None
        button_datas = [btn.callback_data for row in markup.inline_keyboard for btn in row]
        assert any(b.startswith("ls:attach:") for b in button_datas), "باید دکمه پیوست فایل دوم وجود داشته باشد"
        assert any(b.startswith("ls:start:") for b in button_datas), "باید دکمه شروع پردازش وجود داشته باشد"

        session_id = mock_context.user_data.get('lecture_session_id')
        assert session_id in _LECTURE_SESSIONS
        assert len(_LECTURE_SESSIONS[session_id]['files']) == 1

    asyncio.run(_run())


def test_lecture_scribe_attach_second_file():
    """تست ارسال فایل دوم (PDF اسلایدها) در سشن موجود"""
    import asyncio

    async def _run():
        session_id = "ls_99999_test1"
        _LECTURE_SESSIONS[session_id] = {
            'session_id': session_id,
            'user_id': 99999,
            'files': [{
                'kind': 'audio',
                'mime': 'audio/ogg',
                'name': 'ویس جلسه',
                'tg_file_id': 'voice_1',
                'file_size': 100000
            }],
            'status': 'awaiting_files'
        }

        mock_update = MagicMock()
        mock_update.effective_user.id = 99999
        mock_msg = MagicMock()
        mock_msg.voice = None
        mock_msg.audio = None
        mock_msg.video = None
        mock_msg.caption = ""

        doc_mock = MagicMock()
        doc_mock.file_name = "cardio_slides.pdf"
        doc_mock.mime_type = "application/pdf"
        doc_mock.file_size = 200000
        doc_mock.file_id = "doc_1"
        tg_file_mock = MagicMock()
        doc_mock.get_file = AsyncMock(return_value=tg_file_mock)
        mock_msg.document = doc_mock
        mock_msg.reply_text = AsyncMock()
        mock_update.message = mock_msg

        mock_context = MagicMock()
        mock_context.user_data = {
            'lecture_session_id': session_id,
            'mode': 'lecture_scribe_attach'
        }

        await handle_lecture_file_input(mock_update, mock_context)

        assert mock_msg.reply_text.called
        sent_text = mock_msg.reply_text.call_args[0][0]
        assert "هر دو منبع درسی با موفقیت آماده شدند" in sent_text
        assert len(_LECTURE_SESSIONS[session_id]['files']) == 2

    asyncio.run(_run())
