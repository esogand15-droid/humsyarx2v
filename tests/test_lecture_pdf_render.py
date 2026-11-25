# -*- coding: utf-8 -*-
"""Render tests for backend.services.lecture_notes_pdf.generate_lecture_pdf.

Pure offline: no Telegram, no Gemini, no MongoDB connection (a dummy
MONGODB_URI is set only so transitive imports can construct the lazy client).
"""
import io
import os
import sys

import pytest

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)
os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017/test_lecture_pdf_render")

from backend.services.lecture_notes_pdf import generate_lecture_pdf  # noqa: E402

try:
    import pypdf
except Exception:  # pragma: no cover
    pypdf = None


def _pdf_bytes(result) -> bytes:
    if isinstance(result, (bytes, bytearray)):
        return bytes(result)
    assert hasattr(result, "read"), f"unexpected return type {type(result)!r}"
    result.seek(0)
    return result.read()


def _page_count(data: bytes):
    if pypdf is None:
        return None
    return len(pypdf.PdfReader(io.BytesIO(data)).pages)


def _rich_digest() -> dict:
    long_para = (
        "نارسایی قلبی (Heart Failure) یک سندرم بالینی است که در آن قلب قادر به پمپاژ خون کافی نیست. "
        "فعال شدن سیستم RAAS و افزایش Norepinephrine در ابتدا جبرانی است اما در ادامه به Remodeling منجر میشود. "
        "معیارهای Framingham، سطح BNP < 100 pg/mL و NT-proBNP > 125 pg/mL در تشخیص کمککنندهاند & "
        "اکوکاردیوگرافی (Echocardiography) با EF ≤ 40% تشخیص HFrEF را قطعی میکند. "
    )
    return {
        "title": "نارسایی قلبی <HFrEF> & درمان GDMT (Heart Failure)",
        "subject": "بیماریهای قلب و عروق (Cardiology) <تست>",
        "professor": "دکتر <script>alert(1)</script> & همکاران",
        "session": "جلسه ۴ - آریتمی & نارسایی",
        "date": "پاییز ۱۴۰۵",
        "duration": 5400,
        "executive_summary": long_para * 3,
        "topics": [
            {
                "title": f"مبحث {i} — Pathophysiology <{i}> & Management",
                "content": long_para * (1 + i % 4),
                "clinical_points": ("نکته بالینی: Spironolactone در K > 5.5 ممنوع است & "
                                    "در eGFR < 30 احتیاط شود.") if i % 2 == 0 else "",
            }
            for i in range(1, 9)
        ],
        "clinical_pearls": [
            f"مروارید {i}: Digoxin مرگومیر را کاهش نمیدهد ولی بستری مجدد را کم میکند (DIG trial) <{i}> & نکته."
            for i in range(1, 16)
        ],
        "exam_traps": [
            f"دام {i}: ترکیب ACEi + ARNI بهدلیل Angioedema ممنوع است؛ فاصله ۳۶ ساعت (36h) رعایت شود <&>."
            for i in range(1, 16)
        ],
        "comparison_table": {
            "title": "مقایسه داروهای GDMT <جدول> & عوارض",
            "headers": ["دارو (Drug)", "مکانیسم", "عارضه <مهم>", "پایش", "نکته & دوز"],
            "rows": [
                [f"Drug-{i} Sacubitril/Valsartan", "ARNI / RAAS blockade", "Angioedema & Hypotension",
                 "K+, Cr < 2.5", "شروع با دوز کم و تیتراسیون هر ۲ تا ۴ هفته " * (1 + i % 3)]
                for i in range(1, 26)
            ],
        },
        "qna_list": [
            {"question": f"سوال {i}: چهار ستون درمان HFrEF کداماند؟ <&>",
             "answer": "ARNI، Beta-blocker، MRA و SGLT2i — همگی مرگومیر را کاهش میدهند. " * (1 + i % 3)}
            for i in range(1, 13)
        ],
    }


def test_rich_persian_digest_renders_valid_pdf():
    data = _pdf_bytes(generate_lecture_pdf(_rich_digest()))
    assert data[:4] == b"%PDF", data[:16]
    assert len(data) > 5 * 1024, len(data)
    assert data.rstrip().endswith(b"%%EOF")
    pages = _page_count(data)
    if pages is not None:
        assert pages >= 3, pages


@pytest.mark.parametrize("digest", [
    {},
    {"title": "", "subject": "", "topics": []},
    {"title": "فقط عنوان", "subject": "x", "executive_summary": "", "topics": [],
     "clinical_pearls": [], "exam_traps": [], "qna_list": [], "comparison_table": {}},
    {"title": "None fields", "topics": None, "clinical_pearls": None, "exam_traps": None,
     "comparison_table": None, "qna_list": None},
    {"title": "Table without rows", "comparison_table": {"title": "t", "headers": ["a", "b"], "rows": []},
     "qna_list": [{"question": "", "answer": "skipped"}, {"question": "Q?", "answer": ""}],
     "topics": [{"title": "", "content": "", "clinical_points": ""}]},
], ids=["empty", "blank-strings", "empty-lists", "none-values", "degenerate-items"])
def test_minimal_or_empty_digest_renders(digest):
    data = _pdf_bytes(generate_lecture_pdf(digest))
    assert data[:4] == b"%PDF"
    assert len(data) > 1024
    pages = _page_count(data)
    if pages is not None:
        assert pages >= 1
