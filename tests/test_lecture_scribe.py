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


def test_transcode_media_m4a_to_mp3():
    """تست تبدیل خودکار فایل m4a به mp3 استاندارد با ffmpeg"""
    import asyncio
    import subprocess
    import tempfile
    from backend.services.lecture_scribe import _get_ffmpeg_path, transcode_media_to_optimized_audio

    ffmpeg_exe = _get_ffmpeg_path()
    if not ffmpeg_exe:
        pytest.skip("ffmpeg در محیط تست یافت نشد")

    # ساخت یک فایل صوتی نمونه m4a با استفاده از tempfile
    with tempfile.NamedTemporaryFile(suffix='.m4a', delete=False) as tf:
        tmp_name = tf.name

    try:
        cmd = [ffmpeg_exe, '-y', '-f', 'lavfi', '-i', 'sine=frequency=800:duration=1', '-c:a', 'aac', tmp_name]
        subprocess.run(cmd, capture_output=True, check=True)
        with open(tmp_name, 'rb') as f:
            m4a_bytes = f.read()
    finally:
        if os.path.exists(tmp_name):
            os.remove(tmp_name)

    assert len(m4a_bytes) > 0

    async def _run():
        mp3_bytes, mime, out_name = await transcode_media_to_optimized_audio(
            m4a_bytes, "جلسه دوم ایین خواهران.m4a"
        )
        assert mime == "audio/mp3", "فرمت خروجی باید حتما audio/mp3 باشد"
        assert out_name == "optimized_lecture.mp3"
        assert len(mp3_bytes) > 0, "فایل تبدیل‌شده نباید خالی باشد"

    asyncio.run(_run())


def test_handle_lecture_file_input_m4a_forwarded_document():
    """تست پذیرش فایل صوتی m4a که به صورت document تلگرام فوروارد شده است"""
    import asyncio

    async def _run():
        mock_update = MagicMock()
        mock_update.effective_user.id = 55555
        mock_msg = MagicMock()
        mock_msg.voice = None
        mock_msg.audio = None
        mock_msg.video = None
        mock_msg.video_note = None
        mock_msg.caption = "ویس استاد جلسه دوم"

        doc_mock = MagicMock()
        doc_mock.file_name = "جلسه دوم ایین خواهران.m4a"
        doc_mock.mime_type = "audio/x-m4a"
        doc_mock.file_size = 53400000
        doc_mock.file_id = "doc_m4a_123"
        tg_file_mock = MagicMock()
        doc_mock.get_file = AsyncMock(return_value=tg_file_mock)

        mock_msg.document = doc_mock
        mock_msg.reply_text = AsyncMock()
        mock_update.message = mock_msg

        mock_context = MagicMock()
        mock_context.user_data = {}

        await handle_lecture_file_input(mock_update, mock_context)

        assert mock_msg.reply_text.called
        sent_text = mock_msg.reply_text.call_args[0][0]
        assert "فایل جلسه با موفقیت دریافت شد" in sent_text
        session_id = mock_context.user_data.get('lecture_session_id')
        assert session_id in _LECTURE_SESSIONS
        sess_file = _LECTURE_SESSIONS[session_id]['files'][0]
        assert sess_file['kind'] == 'audio'
        assert sess_file['name'] == "جلسه دوم ایین خواهران.m4a"

    asyncio.run(_run())


def test_handle_lecture_file_input_video_lecture():
    """تست پذیرش ویدیو کلاس درس با فرمت mp4"""
    import asyncio

    async def _run():
        mock_update = MagicMock()
        mock_update.effective_user.id = 66666
        mock_msg = MagicMock()
        mock_msg.voice = None
        mock_msg.audio = None
        mock_msg.video_note = None
        mock_msg.document = None
        mock_msg.caption = "فیلم کلاس پاتولوژی"

        vid_mock = MagicMock()
        vid_mock.file_name = "pathology_lec.mp4"
        vid_mock.mime_type = "video/mp4"
        vid_mock.file_size = 45000000
        vid_mock.file_id = "vid_123"
        tg_file_mock = MagicMock()
        vid_mock.get_file = AsyncMock(return_value=tg_file_mock)

        mock_msg.video = vid_mock
        mock_msg.reply_text = AsyncMock()
        mock_update.message = mock_msg

        mock_context = MagicMock()
        mock_context.user_data = {}

        await handle_lecture_file_input(mock_update, mock_context)

        assert mock_msg.reply_text.called
        session_id = mock_context.user_data.get('lecture_session_id')
        assert session_id in _LECTURE_SESSIONS
        sess_file = _LECTURE_SESSIONS[session_id]['files'][0]
        assert sess_file['kind'] == 'video'

    asyncio.run(_run())


def test_gemini_vault_key_failover_on_429():
    """تست چرخش خودکار کلیدهای Vault هوشیار هنگام بروز خطای 429 سهمیه در Gemini"""
    import asyncio
    from backend.services.ai_solver import run_with_key_failover, _raise_gemini_status_error

    keys = ["key_alpha_exhausted", "key_beta_active"]
    attempted_keys = []

    async def _mock_api_call(key: str):
        attempted_keys.append(key)
        if key == "key_alpha_exhausted":
            _raise_gemini_status_error(429, "Resource has been exhausted (e.g. check quota).")
        return {"status": "success", "used_key": key}

    async def _run():
        result = await run_with_key_failover("gemini", keys, _mock_api_call, label="test-quota-failover")
        assert result["status"] == "success"
        assert result["used_key"] == "key_beta_active"
        assert attempted_keys == ["key_alpha_exhausted", "key_beta_active"]

    asyncio.run(_run())


def test_parse_json_from_text_resilience():
    """تست استخراج مقاوم JSON خروجی هوش مصنوعی با تگ‌های Markdown و متن‌های حاشیه‌ای"""
    from backend.services.lecture_scribe import _parse_json_from_text

    # حالت ۱: JSON استاندارد با تگ markdown
    sample1 = '```json\n{"title": "قلب", "subject": "پزشکی"}\n```'
    parsed1 = _parse_json_from_text(sample1)
    assert parsed1["title"] == "قلب"
    assert parsed1["subject"] == "پزشکی"

    # حالت ۲: متن توضیحی قبل و بعد از JSON
    sample2 = 'این خلاصه جلسه است:\n```json\n{"title": "نورولوژی", "topics": [{"title": "سکته مغزی"}]}\n```\nامیدوارم مفید باشد.'
    parsed2 = _parse_json_from_text(sample2)
    assert parsed2["title"] == "نورولوژی"
    assert len(parsed2["topics"]) == 1


def test_smart_media_routing_and_callback():
    """تست پاسخ به دکمه‌های تشخیص هوشمند خودکار صوت (Option 1)"""
    import asyncio

    async def _run():
        mock_update = MagicMock()
        mock_update.effective_user.id = 77777

        # شبیه‌سازی کلیک روی دکمه ls:smart_scribe
        query_mock = MagicMock()
        query_mock.data = "ls:smart_scribe"
        query_mock.answer = AsyncMock()
        query_mock.delete_message = AsyncMock()
        mock_update.callback_query = query_mock

        pending_msg = MagicMock()
        pending_msg.voice = None
        pending_msg.audio = None
        pending_msg.video = None
        pending_msg.video_note = None
        pending_msg.caption = ""

        doc_mock = MagicMock()
        doc_mock.file_name = "جلسه_استاد.m4a"
        doc_mock.mime_type = "audio/mp4"
        doc_mock.file_size = 12000000
        doc_mock.file_id = "doc_m4a_777"
        doc_mock.get_file = AsyncMock(return_value=MagicMock())
        pending_msg.document = doc_mock
        pending_msg.reply_text = AsyncMock()

        mock_context = MagicMock()
        mock_context.user_data = {
            'pending_smart_media_msg': pending_msg
        }

        await handle_lecture_callback(mock_update, mock_context)

        assert query_mock.answer.called
        assert query_mock.delete_message.called
        assert mock_context.user_data.get('mode') == 'lecture_scribe'
        session_id = mock_context.user_data.get('lecture_session_id')
        assert session_id in _LECTURE_SESSIONS

    asyncio.run(_run())


def test_lecture_table_cell_wrapping_no_overlap():
    """تست جلوگیری از همپوشانی ستون‌های جدول با شکست خودکار متن‌های طولانی پزشکی"""
    from backend.services.qbank.fonts_rtl import _reshape

    digest = {
        "title": "فارماکولوژی پیشرفته فشار خون",
        "subject": "فارماکولوژی",
        "professor": "دکتر حسینی",
        "session": "جلسه ۵",
        "date": "۱۴۰۵/۰۹/۰۱",
        "executive_summary": "بررسی مقایسه‌ای داروهای ضد فشار خون و عوارض جانبی آنها.",
        "topics": [{"title": "مقدمه", "content": "مقدمه‌ای بر فشار خون."}],
        "comparison_table": {
            "title": "مقایسه داروهای خط اول بر اساس اندیکاسیون و منع مصرف",
            "headers": ["دسته دارو", "مکانیسم سلولی و مولکولی", "اندیکاسیون‌های بالینی انتخابی", "عوارض جانبی و منع مصرف"],
            "rows": [
                [
                    "ACE Inhibitors (انالاپریل)",
                    "مهار آنزیم تبدیل‌کننده آنژیوتانسین و جلوگیری از تولید AT-II و مهار تجزیه برادی‌کینین عروقی",
                    "پرفشاری خون همراه با دیابت قندی، نارسایی سیستولیک قلب (HFrEF)، پس از سکته قلبی STEMI",
                    "سرفه خشک مداوم، هایپرکالمی شدید، آنژیوادم کشنده، منع مصرف مطلق در دوران بارداری"
                ],
                [
                    "ARBs (لوزارتان)",
                    "بلوک اختصاصی و رقابتی گیرنده‌های نوع ۱ آنژیوتانسین II در عضلات صاف دیواره عروق و قشر آدرنال",
                    "جایگزین انتخابی بیماران با عدم تحمل ACEI به علت سرفه خشک، نفروپاتی دیابتی پیشرونده",
                    "هایپرکالمی، کاهش فیلتراسیون گلومرولی در تنگی دوطرفه شریان کلیه، منع مطلق در بارداری"
                ]
            ]
        }
    }

    buf = generate_lecture_pdf(digest)
    pdf_bytes = buf.getvalue()
    assert len(pdf_bytes) > 25000

    reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
    assert len(reader.pages) >= 2
    full_text = " ".join(p.extract_text() for p in reader.pages)

    # اطمینان از حضور تمام عبارات کلیدی (لاتین و شکل‌یافته فارسی) بدون برش خوردن
    assert "ACE" in full_text
    assert "ARBs" in full_text
    assert _reshape("انالاپریل") in full_text
    assert _reshape("آنژیوادم") in full_text
    assert _reshape("برادی") in full_text


def test_lecture_table_multipage_pagination():
    """تست شکست هوشمند جدول در مرز صفحه و تکرار هدر در صفحه جدید"""
    from backend.services.qbank.fonts_rtl import _reshape

    digest = {
        "title": "فارماکولوژی جامع سیستم قلبی عروقی",
        "subject": "قلب و عروق",
        "professor": "دکتر زمانی",
        "session": "جلسه تکمیلی",
        "date": "۱۴۰۵/۰۹/۱۰",
        "executive_summary": "مرور جامع داروهای کاهنده فشار خون و اینوتروپ‌های مثبت و منفی.",
        "topics": [
            {
                "title": f"مبحث تفصیلی {idx}",
                "content": "توضیحات مفصل پزشکی جهت پر کردن صفحه دوم سند و کشاندن جدول به مرز صفحه برای بررسی شکست خودکار سطرها. " * 9,
                "clinical_points": "نکته کلیدی بالینی مربوط به دوزبندی و احتیاط‌های مصرف."
            }
            for idx in range(1, 3)
        ],
        "comparison_table": {
            "title": "جدول مقایسه‌ای جامع داروهای ضد فشار خون و ریتم قلب",
            "headers": ["دسته دارو", "مکانیسم سلولی", "اندیکاسیون‌ها", "عوارض و منع مصرف"],
            "rows": [
                [f"داروی شماره {i}", f"مکانیسم دقیق اثر سلولی و مولکولی در میوکارد و عروق {i}", f"اندیکاسیون انتخابی خط اول {i}", f"عوارض جانبی و تداخلات دارویی مهم {i}"]
                for i in range(1, 10)
            ]
        }
    }

    buf = generate_lecture_pdf(digest)
    reader = pypdf.PdfReader(buf)
    # سند باید حداقل ۳ صفحه داشته باشد (جلد + شروع مباحث و جدول + ادامه جدول در صفحه سوم)
    assert len(reader.pages) >= 3, f"تعداد صفحات باید حداقل ۳ باشد اما {len(reader.pages)} است"

    page2_text = reader.pages[1].extract_text()
    page3_text = reader.pages[2].extract_text()

    # هر دو صفحه دوم و سوم باید حاوی سطرهای جدول باشند
    assert _reshape("داروی شماره") in page2_text
    assert _reshape("داروی شماره") in page3_text
    # هدر جدول باید در هر دو صفحه حاضر باشد
    assert _reshape("دسته دارو") in page2_text
    assert _reshape("دسته دارو") in page3_text


def test_lecture_scribe_delivery_html_escaping():
    """تست ایمنی پیام تلگرام در برابر نمادهای مقایسه‌ای پزشکی (<, >, &)"""
    import html
    import re

    med_summary = "هدف درمانی: MAP < 65 mmHg و pO2 > 60 mmHg است. در صورت K+ > 5.5 و pH < 7.25 باید سرم‌درمانی & دیالیز ارزیابی شود (p < 0.05)."
    title = "شوک سپسیس (MAP < 65 & احیا)"
    subject = "ICU & مراقبت‌های ویژه"

    # اعمال تابع پاکسازی
    safe_summary = html.escape(med_summary)
    safe_title = html.escape(title)
    safe_subject = html.escape(subject)

    caption_msg = (
        f"🎓 <b>جزوه جامع:</b> {safe_title} — {safe_subject}\n\n"
        f"<blockquote expandable>{safe_summary}</blockquote>"
    )

    # اعتبارسنجی تگ‌های مجاز تلگرام
    clean = re.sub(r'</?(?:b|i|u|s|strike|del|code|pre|blockquote)(?:\s+expandable)?(?:\s+href="[^"]*")?>', '', caption_msg)

    # نباید هیچ تگ باز یا بسته نامعتبر مثل < 65 در متن باقی مانده باشد
    stray_tags = re.findall(r'<[^>]*>', clean)
    assert not stray_tags, f"تگ‌های نامعتبر HTML یافت شد: {stray_tags}"

    # نباید هیچ & فرار داده نشده‌ای در متن وجود داشته باشد
    stray_amps = re.findall(r'&(?!(?:lt|gt|amp|quot|apos);)', clean)
    assert not stray_amps, f"کاراکترهای فرار نیافته & یافت شد: {stray_amps}"


def test_resolve_candidate_models_hierarchy_and_filtering():
    """تست اعتبارسنجی سلسله‌مراتب مدل‌های مجاز و حذف مدل‌های خیالی (gemini-3.6-flash)"""
    from backend.services.lecture_scribe import (
        resolve_candidate_models, VERIFIED_MODEL_CASCADE, HALLUCINATED_MODELS
    )

    # 1. پیش‌فرض بدون کانفیگ
    models_default = resolve_candidate_models()
    assert models_default[0] == "gemini-2.5-flash"
    assert models_default == VERIFIED_MODEL_CASCADE

    # 2. کانفیگ حاوی مدل خیالی gemini-3.6-flash
    cfg_hallucinated = {"lecture_model": "gemini-3.6-flash"}
    models_filtered = resolve_candidate_models(cfg_hallucinated)
    assert "gemini-3.6-flash" not in models_filtered
    assert "gemini-3.5-flash-lite" not in models_filtered
    assert models_filtered[0] == "gemini-2.5-flash"

    # 3. اولویت‌بندی مدل معتبر انتخابی ادمین
    cfg_preferred = {"lecture_model": "gemini-2.0-flash"}
    models_preferred = resolve_candidate_models(cfg_preferred)
    assert models_preferred[0] == "gemini-2.0-flash"
    assert len(models_preferred) == len(VERIFIED_MODEL_CASCADE)
    assert set(models_preferred) == set(VERIFIED_MODEL_CASCADE)


def test_auto_repair_generation_config_strips_schema_and_thinking():
    """تست حذف responseSchema و thinkingConfig هنگام مواجهه با خطای ۴۰۰ در auto_repair"""
    from backend.services.lecture_scribe import auto_repair_generation_config, LECTURE_DIGEST_SCHEMA

    initial_cfg = {
        "responseMimeType": "application/json",
        "responseSchema": LECTURE_DIGEST_SCHEMA,
        "thinkingConfig": {"thinkingBudget": 0},
        "temperature": 0.2,
        "maxOutputTokens": 8192,
    }

    repaired = auto_repair_generation_config(initial_cfg)
    assert "responseSchema" not in repaired
    assert "thinkingConfig" not in repaired
    assert repaired.get("responseMimeType") == "application/json"
    assert repaired.get("temperature") == 0.2
    assert repaired.get("maxOutputTokens") == 8192


def test_no_thinking_model_aware_behavior():
    """تست هوشمندی تابع _no_thinking در تفکیک مدل‌های استدلالی و غیراستدلالی"""
    from backend.services.ai_solver import _no_thinking

    base = {"maxOutputTokens": 4096}

    # مدل 2.5 استدلالی: باید thinkingBudget: 0 داشته باشد
    cfg_25 = _no_thinking(base, model="gemini-2.5-flash")
    assert "thinkingConfig" in cfg_25
    assert cfg_25["thinkingConfig"].get("thinkingBudget") == 0

    # مدل 2.0 غیر استدلالی: نباید thinkingConfig داشته باشد
    cfg_20 = _no_thinking(base, model="gemini-2.0-flash")
    assert "thinkingConfig" not in cfg_20

    # مدل 1.5 غیر استدلالی: نباید thinkingConfig داشته باشد
    cfg_15 = _no_thinking(base, model="gemini-1.5-flash")
    assert "thinkingConfig" not in cfg_15

    # مدل 3.0: باید thinkingLevel: 'low' داشته باشد
    cfg_30 = _no_thinking(base, model="gemini-3.0-flash")
    assert "thinkingConfig" in cfg_30
    assert cfg_30["thinkingConfig"].get("thinkingLevel") == "low"


def test_model_cascade_continues_on_400_invalid_argument():
    """تست عدم توقف چرخه مدل‌ها هنگام بروز خطای ۴۰۰ INVALID_ARGUMENT در مدل اول و صعود به مدل دوم"""
    import asyncio
    import json
    import httpx
    from backend.services.ai_solver import _extract_gemini_text, AIError
    from backend.services.lecture_scribe import auto_repair_generation_config, _parse_json_from_text

    calls = []
    models_sequence = ["gemini-2.5-flash", "gemini-2.0-flash"]

    async def _mock_client_post(url, headers, json_payload):
        model = "gemini-2.5-flash" if "gemini-2.5-flash" in url else "gemini-2.0-flash"
        calls.append((model, json_payload.get("generationConfig", {})))

        if model == "gemini-2.5-flash":
            # حتی با auto-repair هم خطای ۴۰۰ می‌دهد
            return httpx.Response(
                status_code=400,
                text='{"error": {"code": 400, "message": "INVALID_ARGUMENT: model rejected payload"}}',
                request=httpx.Request("POST", url),
            )
        # مدل دوم با موفقیت پاسخ می‌دهد
        sample_resp = {
            "candidates": [{
                "content": {"parts": [{"text": '{"title": "قلب و عروق", "subject": "پزشکی"}'}]}
            }]
        }
        return httpx.Response(status_code=200, text=json.dumps(sample_resp), request=httpx.Request("POST", url))

    async def _run_loop():
        last_err = None
        for model_cand in models_sequence:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_cand}:generateContent"
            gen_cfg = {"responseMimeType": "application/json", "responseSchema": {"type": "OBJECT"}}
            payload = {"generationConfig": gen_cfg}

            res = await _mock_client_post(url, {}, payload)
            if res.status_code == 400:
                repaired = auto_repair_generation_config(gen_cfg)
                res = await _mock_client_post(url, {}, {"generationConfig": repaired})

            if res.status_code == 200:
                data = res.json()
                raw_text = _extract_gemini_text(data)
                return _parse_json_from_text(raw_text)

            if res.status_code in (400, 404, 503):
                last_err = AIError(f"Model {model_cand} failed: {res.status_code}")
                continue

        if last_err:
            raise last_err

    result = asyncio.run(_run_loop())
    assert result["title"] == "قلب و عروق"
    assert result["subject"] == "پزشکی"
    attempted_models = [m for m, _ in calls]
    assert "gemini-2.5-flash" in attempted_models
    assert "gemini-2.0-flash" in attempted_models




