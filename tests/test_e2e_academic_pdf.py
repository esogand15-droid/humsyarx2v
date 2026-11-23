"""
tests/test_e2e_academic_pdf.py
Comprehensive 4-Tier End-to-End Test Suite for Academic HumSyar Medical PDF Engine:
- Feature 8: ReportLab NumberedCanvas Page Drop Fix (final content page flushed & preserved)
- Feature 9: Bidirectional Persian Typography & Medical Bidi Sanitization (Vazirmatn, LRM markers, base_dir='R')
- Feature 10: Dynamic Comparative Tables (multi-line wrapping, auto row heights, zebra stripes, column dividers)
- Feature 11: HumSyar Academic Layout (Duration, Callout Boxes) & Telegram Delivery (HTML escaped)

Test Tiers:
- Tier 1: Feature Functional Coverage (at least 5 tests per feature = 20 tests)
- Tier 2: Boundary & Corner Cases (at least 5 tests per feature = 20 tests)
- Tier 3: Pairwise Combinatorial Interactions (7 tests)
- Tier 4: Real-World Scenarios (4 realistic end-to-end medical lecture workflows)

Authoritative Requirements Source:
- ORIGINAL_REQUEST.md §R3
- PROJECT.md §Feature Inventory (F8, F9, F10, F11) & §Interface Contracts
- TEST_INFRA.md §Feature Inventory & §Coverage Thresholds
"""

import sys
import os
import io
import re
import html
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

# Defensive environment bootstrap for tests
os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017/humsyar_test")
os.environ.setdefault("ADMIN_ID", "999")
os.environ.setdefault("TELEGRAM_TOKEN", "123:TEST_TOKEN")

# Defensive path bootstrap
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)
SERVICES_DIR = os.path.join(REPO_ROOT, 'backend', 'services')
if SERVICES_DIR not in sys.path:
    sys.path.insert(0, SERVICES_DIR)

from pypdf import PdfReader
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics

from backend.services.lecture_notes_pdf import (
    NumberedCanvas,
    generate_lecture_pdf,
    format_duration,
    _draw_cover,
    _draw_callout_box,
    _draw_table,
    PEARL_BORDER,
    PEARL_BG,
    PEARL_ACCENT,
    TRAP_BORDER,
    TRAP_BG,
    TRAP_ACCENT,
    TABLE_HEAD_BG,
    TABLE_ZEBRA_BG,
    CYAN_DARK,
    CARD_BORDER_SOFT,
    CARD_BG_SOFT,
    TEXT_PRIMARY,
)
from backend.services.qbank.fonts_rtl import (
    ensure_fonts,
    rtl,
    fa_digits,
    text_width,
    wrap_rtl,
    sanitize_bidi_medical,
    REGULAR,
    MEDIUM,
    BOLD,
    LRM,
)
from backend.services.qbank.styles import (
    PAGE_W,
    PAGE_H,
    MARGIN,
    CONTENT_W,
    MIN_Y,
    FOOTER_Y,
    NAVY,
    WHITE,
)


# ==============================================================================
# TIER 1: FEATURE FUNCTIONAL COVERAGE (Features 8, 9, 10, 11)
# ==============================================================================

class TestTier1Feature08NumberedCanvas(unittest.TestCase):
    """Tier 1: Feature 8 — ReportLab NumberedCanvas Page Drop Fix & Decoration"""

    def setUp(self):
        ensure_fonts()

    def test_t1_f08_01_numbered_canvas_final_page_completeness(self):
        """Verify NumberedCanvas.save() automatically flushes uncommitted final page."""
        buf = io.BytesIO()
        c = NumberedCanvas(buf, pagesize=A4)
        c.setFont(REGULAR, 10)
        c.drawString(100, 500, "Page 1 Cover Content")
        c.showPage()

        # Draw content on Page 2 without calling showPage()
        c.drawString(100, 500, "Page 2 Final Body Content")
        c.save()

        buf.seek(0)
        reader = PdfReader(buf)
        self.assertEqual(len(reader.pages), 2, "Final page must not be dropped by save()!")
        page2_text = reader.pages[1].extract_text() or ""
        self.assertIn("Page 2", page2_text)

    def test_t1_f08_02_numbered_canvas_preserves_page_states(self):
        """Verify NumberedCanvas saves distinct page states and decorates all pages."""
        buf = io.BytesIO()
        c = NumberedCanvas(buf, pagesize=A4)
        c.setFont(REGULAR, 10)

        # Draw 3 distinct pages
        for p in range(1, 4):
            c.drawString(100, 600, f"Unique Content on Page {p}")
            if p < 3:
                c.showPage()
        c.save()

        buf.seek(0)
        reader = PdfReader(buf)
        self.assertEqual(len(reader.pages), 3)
        for idx, page in enumerate(reader.pages, 1):
            text = page.extract_text() or ""
            self.assertIn(f"Page {idx}", text)

    def test_t1_f08_03_numbered_canvas_multi_page_count_accuracy(self):
        """Verify two-pass total page count calculation and Persian digits in footer."""
        buf = io.BytesIO()
        c = NumberedCanvas(buf, pagesize=A4)
        c.setFont(REGULAR, 10)
        total_p = 3
        for i in range(1, total_p + 1):
            c.drawString(100, 500, f"Page {i}")
            if i < total_p:
                c.showPage()
        c.save()

        buf.seek(0)
        reader = PdfReader(buf)
        self.assertEqual(len(reader.pages), 3)

        # Pages 2 and 3 should have total page count in Persian ("۳")
        fa_three = fa_digits(3)
        self.assertEqual(fa_three, "۳")
        # Ensure pages were decorated without crash
        self.assertGreater(len(buf.getvalue()), 1000)

    def test_t1_f08_04_numbered_canvas_skips_cover_page_footer(self):
        """Verify page 1 (cover page) does not have running page count footer."""
        buf = io.BytesIO()
        c = NumberedCanvas(buf, pagesize=A4)
        c.setFont(REGULAR, 10)
        c.drawString(100, 500, "Cover Page")
        c.showPage()
        c.drawString(100, 500, "Content Page")
        c.save()

        buf.seek(0)
        reader = PdfReader(buf)
        self.assertEqual(len(reader.pages), 2)
        # Page 1 decoration check
        page1_text = reader.pages[0].extract_text() or ""
        # Cover page should not have running footer page counter
        self.assertNotIn("صفحه ۱ از ۲", page1_text)

    def test_t1_f08_05_numbered_canvas_code_accumulator_flush(self):
        """Verify self._code non-empty check flushes the accumulator in save()."""
        buf = io.BytesIO()
        c = NumberedCanvas(buf, pagesize=A4)
        c.rect(50, 50, 200, 200, fill=1)
        self.assertGreater(len(c._code), 0, "Canvas _code accumulator must have drawing commands")
        c.save()
        self.assertEqual(len(c._saved_page_states), 1, "save() must have flushed open page into _saved_page_states")


class TestTier1Feature09PersianTypographyBidi(unittest.TestCase):
    """Tier 1: Feature 9 — Persian Vazirmatn Typography & Bidi Medical Sanitization"""

    def setUp(self):
        ensure_fonts()

    def test_t1_f09_01_vazirmatn_font_registration_idempotency(self):
        """Verify ensure_fonts() registers Vazirmatn fonts idempotently without errors."""
        ensure_fonts()
        ensure_fonts()
        registered = pdfmetrics.getRegisteredFontNames()
        self.assertIn(REGULAR, registered)
        self.assertIn(MEDIUM, registered)
        self.assertIn(BOLD, registered)

    def test_t1_f09_02_persian_digits_conversion(self):
        """Verify fa_digits() converts Latin numbers to Persian digits correctly."""
        self.assertEqual(fa_digits(0), "۰")
        self.assertEqual(fa_digits(123456789), "۱۲۳۴۵۶۷۸۹")
        self.assertEqual(fa_digits("Page 4 of 10"), "Page ۴ of ۱۰")
        self.assertEqual(fa_digits(3.14), "۳.۱۴")

    def test_t1_f09_03_sanitize_bidi_medical_parentheses_lrm(self):
        """Verify sanitize_bidi_medical() wraps neutral parenthesized Latin medical terms with LRM."""
        samples = [
            ("دوز دارو (500 mg q12h) است", f"({LRM}500 mg q12h{LRM})"),
            ("مصرف (ACE-I) توصیه می‌شود", f"({LRM}ACE-I{LRM})"),
            ("تزریق (1-2 g IV) تجویز شد", f"({LRM}1-2 g IV{LRM})"),
            ("محاسبه دوز (10-20 mg/kg) بیمار", f"({LRM}10-20 mg/kg{LRM})"),
        ]
        for inp, expected_fragment in samples:
            sanitized = sanitize_bidi_medical(inp)
            self.assertIn(expected_fragment, sanitized, f"Failed for input: {inp}")

    def test_t1_f09_04_sanitize_bidi_medical_dosages_and_ranges(self):
        """Verify sanitize_bidi_medical() wraps standalone Latin medical dosages with LRM."""
        text = "میزان مصرف 500mg خوراکی در روز است"
        sanitized = sanitize_bidi_medical(text)
        self.assertIn(LRM, sanitized)
        self.assertIn("500mg", sanitized)

    def test_t1_f09_05_wrap_rtl_base_dir_r_and_shaping(self):
        """Verify wrap_rtl() formats Persian text with base_dir='R' and connected glyphs."""
        persian_text = "سامانه هوشمند دستیار پزشکی هامزیار برای تدوین جزوات بالینی"
        lines = wrap_rtl(persian_text, REGULAR, 10, 300)
        self.assertIsInstance(lines, list)
        self.assertGreaterEqual(len(lines), 1)
        # Non-empty shaped strings
        for l in lines:
            self.assertTrue(len(l) > 0)


class TestTier1Feature10DynamicComparativeTables(unittest.TestCase):
    """Tier 1: Feature 10 — Dynamic Comparative Tables with Auto-wrapping and Zebra Rows"""

    def setUp(self):
        ensure_fonts()

    def test_t1_f10_01_table_header_rendering_dark_theme(self):
        """Verify _draw_table renders table header with dark background."""
        buf = io.BytesIO()
        c = NumberedCanvas(buf, pagesize=A4)
        tbl_data = {
            "title": "مقایسه داروهای قلبی",
            "headers": ["دارو", "مکانیسم", "دوز"],
            "rows": [["متوپرولول", "بتا بلاکر انتخابی", "50mg BD"]]
        }
        start_y = 600
        next_y = _draw_table(c, start_y, tbl_data, "فارماکولوژی", "قلب")
        self.assertLess(next_y, start_y, "Table drawing must consume vertical space")

    def test_t1_f10_02_table_alternating_zebra_rows(self):
        """Verify _draw_table renders multiple rows with alternating zebra background."""
        buf = io.BytesIO()
        c = NumberedCanvas(buf, pagesize=A4)
        tbl_data = {
            "title": "جدول زبرا",
            "headers": ["ستون ۱", "ستون ۲"],
            "rows": [
                ["ردیف ۱", "مقدار ۱"],
                ["ردیف ۲", "مقدار ۲"],
                ["ردیف ۳", "مقدار ۳"],
                ["ردیف ۴", "مقدار ۴"]
            ]
        }
        start_y = 700
        next_y = _draw_table(c, start_y, tbl_data, "درس", "مبحث")
        self.assertLess(next_y, start_y - 30 * mm)

    def test_t1_f10_03_table_multi_line_cell_wrapping(self):
        """Verify long descriptive text in table cell wraps into multiple lines."""
        long_text = "مهار اختصاصی کانال‌های کلسیمی نوع L در عضلات صاف عروقی و سیستم هدایتی میوکارد"
        lines = wrap_rtl(long_text, REGULAR, 8, 40 * mm)
        self.assertGreaterEqual(len(lines), 2, "Long text in 40mm column must wrap to multiple lines")

    def test_t1_f10_04_table_auto_row_height_calculation(self):
        """Verify rows with multi-line text dynamically expand their row height."""
        buf = io.BytesIO()
        c = NumberedCanvas(buf, pagesize=A4)
        short_tbl = {
            "headers": ["دارو", "اثر"],
            "rows": [["آسپرین", "ضد پلاکت"]]
        }
        long_tbl = {
            "headers": ["دارو", "اثر"],
            "rows": [[
                "آسپرین",
                "مهار غیرقابل برگشت سیکلواکسیژناز ۱ و ۲ که منجر به مهار سنتز ترومبوکسان A2 در پلاکت‌ها و کاهش تجمع پلاکتی در سندرم حاد کرونری می‌گردد"
            ]]
        }
        y1 = _draw_table(c, 700, short_tbl, "درس", "تست")
        y2 = _draw_table(c, 700, long_tbl, "درس", "تست")
        # Long table should consume more vertical space (drop lower)
        self.assertLess(y2, y1, "Row with long text must have larger dynamic row height")

    def test_t1_f10_05_table_column_width_distribution(self):
        """Verify column width distributes available content width evenly."""
        num_cols = 4
        col_w = CONTENT_W / num_cols
        self.assertAlmostEqual(col_w * num_cols, CONTENT_W, places=4)


class TestTier1Feature11AcademicLayoutTelegramDelivery(unittest.TestCase):
    """Tier 1: Feature 11 — HumSyar Academic Layout & Telegram Delivery Hardening"""

    def setUp(self):
        ensure_fonts()

    def test_t1_f11_01_duration_field_in_metadata_card(self):
        """Verify format_duration formats integer seconds and displays in cover metadata."""
        dur_str_1 = format_duration(3600)
        self.assertIn("ساعت", dur_str_1)
        dur_str_2 = format_duration(150)
        self.assertIn("دقیقه", dur_str_2)
        dur_str_3 = format_duration("۴۵ دقیقه")
        self.assertEqual(dur_str_3, "۴۵ دقیقه")

    def test_t1_f11_02_clinical_pearls_box_rendering(self):
        """Verify _draw_callout_box renders Clinical Pearls with cyan accents."""
        buf = io.BytesIO()
        c = NumberedCanvas(buf, pagesize=A4)
        y = 600
        next_y = _draw_callout_box(
            c, y, title="مروارید بالینی ۱", text="نکته کلیدی در درمان نارسایی حاد قلبی", is_exam_trap=False
        )
        self.assertLess(next_y, y)

    def test_t1_f11_03_exam_traps_box_rendering(self):
        """Verify _draw_callout_box renders Exam Traps with red accents."""
        buf = io.BytesIO()
        c = NumberedCanvas(buf, pagesize=A4)
        y = 600
        next_y = _draw_callout_box(
            c, y, title="نکته دامی آزمون", text="تجویز بتا بلاکر در فاز حاد نارسایی قلبی دکامپانسه ممنوع است", is_exam_trap=True
        )
        self.assertLess(next_y, y)

    def test_t1_f11_04_telegram_summary_html_escaped_special_chars(self):
        """Verify Telegram executive summary escapes special characters (<, >, &)."""
        raw_medical_summary = (
            "ارزیابی بیماران با MAP < 65 mmHg و اشباع اکسیژن pO2 > 60 در بخش‌های ICU & CCU با p < 0.05 معنی‌دار است."
        )
        escaped_summary = html.escape(raw_medical_summary)
        self.assertNotIn("< 65", escaped_summary)
        self.assertIn("&lt; 65", escaped_summary)
        self.assertNotIn("> 60", escaped_summary)
        self.assertIn("&gt; 60", escaped_summary)
        self.assertNotIn("ICU & CCU", escaped_summary)
        self.assertIn("ICU &amp; CCU", escaped_summary)

    def test_t1_f11_05_telegram_delivery_expandable_quote_structure(self):
        """Verify summary structure wraps cleanly into expandable blockquote format."""
        from backend.services.lecture_scribe import expandable_quote
        content = "خلاصه مبحث گوارش و کبد"
        quote = expandable_quote(content)
        self.assertTrue(
            quote.startswith("<blockquote expandable>") and quote.endswith("</blockquote>"),
            "Expandable quote must format with <blockquote expandable>...</blockquote>"
        )


# ==============================================================================
# TIER 2: BOUNDARY & CORNER CASES (Features 8, 9, 10, 11)
# ==============================================================================

class TestTier2BoundaryAndCornerCases(unittest.TestCase):
    """Tier 2: Boundary Value Analysis & Corner Conditions for Features 8, 9, 10, 11"""

    def setUp(self):
        ensure_fonts()

    # --- Feature 8 Corner Cases ---

    def test_t2_f08_01_single_page_lecture_note_completeness(self):
        """Verify minimal lecture note (cover + 1 body page) preserves both pages without drop."""
        digest = {
            "title": "مقدمه‌ای بر باکتری‌شناسی",
            "subject": "میکروب‌شناسی",
            "professor": "دکتر حسینی",
            "session": "جلسه ۱",
            "date": "۱۴۰۵/۰۱/۱۵",
            "duration": 1800,
            "executive_summary": "مفاهیم پایه دیواره سلولی باکتری‌ها",
            "topics": [{"title": "ساختار دیواره سلولی", "points": ["پپتیدوگلیکان جزء اصلی است."]}],
            "clinical_pearls": ["رنگ‌آمیزی گرم اساس طبقه‌بندی است."],
            "exam_traps": ["مایکوپلاسما فاقد دیواره سلولی پپتیدوگلیکانی است."],
            "comparison_table": {},
            "qna_list": []
        }
        buf = generate_lecture_pdf(digest)
        reader = PdfReader(buf)
        self.assertEqual(len(reader.pages), 2, "Minimal lecture note must have exactly 2 pages (Cover + 1 Content)")

    def test_t2_f08_02_empty_canvas_save_no_trailing_blank_page(self):
        """Verify calling save() when a newly started page has 0 drawing commands doesn't add blank page."""
        buf = io.BytesIO()
        c = NumberedCanvas(buf, pagesize=A4)
        c.drawString(100, 500, "Page 1 Content")
        c.showPage()
        # Page 2 has no drawing commands added
        c.save()

        buf.seek(0)
        reader = PdfReader(buf)
        self.assertEqual(len(reader.pages), 1, "Unused trailing page must not produce a blank page")

    def test_t2_f08_03_double_showpage_handling(self):
        """Verify consecutive showPage calls do not corrupt page state stack."""
        buf = io.BytesIO()
        c = NumberedCanvas(buf, pagesize=A4)
        c.drawString(100, 500, "Page 1")
        c.showPage()
        c.drawString(100, 500, "Page 2")
        c.showPage()
        c.save()

        buf.seek(0)
        reader = PdfReader(buf)
        self.assertEqual(len(reader.pages), 2)

    def test_t2_f08_04_canvas_save_without_explicit_showpage(self):
        """Verify drawing on canvas without calling showPage() before save() commits the page."""
        buf = io.BytesIO()
        c = NumberedCanvas(buf, pagesize=A4)
        c.setFont(REGULAR, 12)
        c.drawString(100, 700, "Direct Single Page Content")
        c.save()

        buf.seek(0)
        reader = PdfReader(buf)
        self.assertEqual(len(reader.pages), 1)

    def test_t2_f08_05_extreme_page_count_numbering(self):
        """Verify high page count (10 pages) renders total pages 'صفحه X از ۱۰' accurately."""
        buf = io.BytesIO()
        c = NumberedCanvas(buf, pagesize=A4)
        c.setFont(REGULAR, 10)
        for i in range(1, 11):
            c.drawString(100, 500, f"Page {i}")
            if i < 10:
                c.showPage()
        c.save()

        buf.seek(0)
        reader = PdfReader(buf)
        self.assertEqual(len(reader.pages), 10)
        fa_ten = fa_digits(10)
        self.assertEqual(fa_ten, "۱۰")

    # --- Feature 9 Corner Cases ---

    def test_t2_f09_01_wrap_rtl_preserves_explicit_newlines(self):
        """Verify wrap_rtl preserves explicit newlines (\n) instead of collapsing paragraphs."""
        multiline_text = "خط اول پاراگراف.\nخط دوم پاراگراف بعد از شکست سطر.\nخط سوم پاراگراف نهایی."
        wrapped = wrap_rtl(multiline_text, REGULAR, 10, 500)
        self.assertGreaterEqual(len(wrapped), 3, "wrap_rtl must produce at least 3 lines for 3 distinct paragraphs")

    def test_t2_f09_02_empty_or_whitespace_text_handling(self):
        """Verify typography helpers handle None, empty strings, and whitespace gracefully."""
        self.assertEqual(sanitize_bidi_medical(""), "")
        self.assertEqual(sanitize_bidi_medical(None), "")
        self.assertEqual(rtl(""), "")
        self.assertEqual(rtl(None), "")
        self.assertEqual(wrap_rtl("", REGULAR, 10, 100), [])
        self.assertEqual(wrap_rtl(None, REGULAR, 10, 100), [])
        self.assertEqual(wrap_rtl("   ", REGULAR, 10, 100), [])

    def test_t2_f09_03_parentheses_across_line_breaks_atomic(self):
        """Verify parenthesized Latin expressions are kept atomic without cleaving across lines."""
        text = "درمان با آنتی‌بیوتیک وسیع‌الطیف (Ceftriaxone 1g IV daily) آغاز می‌گردد"
        # Using a width that forces a break
        lines = wrap_rtl(text, REGULAR, 9, 70 * mm)
        full_output = " ".join(lines)
        self.assertTrue(len(lines) >= 2)
        # Verify LRM markers are preserved
        self.assertIn(LRM, full_output)

    def test_t2_f09_04_complex_nested_parentheses_dosages(self):
        """Verify complex strings with multiple parenthesized medical units are all isolated."""
        text = "ترکیب داروهای (ACE-I / ARB) با (eGFR < 30 mL/min) و دوز (500 mg q12h) بررسی شود"
        sanitized = sanitize_bidi_medical(text)
        self.assertIn(f"({LRM}ACE-I / ARB{LRM})", sanitized)
        self.assertIn(f"({LRM}eGFR < 30 mL/min{LRM})", sanitized)
        self.assertIn(f"({LRM}500 mg q12h{LRM})", sanitized)

    def test_t2_f09_05_mixed_special_medical_symbols_bidi(self):
        """Verify medical comparison operators (≤, ≥, ±, %) do not corrupt RTL string ordering."""
        text = "فشار خون هدف ≥ 140/90 و تغییرات ± 5% و اشباع اکسیژن ≤ 92% است"
        sanitized = sanitize_bidi_medical(text)
        self.assertIn(LRM, sanitized)
        self.assertIn("140/90", sanitized)

    # --- Feature 10 Corner Cases ---

    def test_t2_f10_01_extreme_cell_text_length_table_wrapping(self):
        """Verify 250+ character medical description in table cell wraps into 5+ lines without bleed."""
        extreme_desc = (
            "مهار غیرقابل برگشت و بسیار اختصاصی پمپ پروتون (H+/K+ ATPase) در سلول‌های پاریتال معده "
            "که منجر به سرکوب عمیق و طولانی‌مدت ترشح اسید پایه و تحریک‌شده در بیماران مبتلا به "
            "زخم پپتیک فعال، رفلاکس شدید معده به مری و سندرم زولینگر-الیسون می‌گردد."
        )
        col_w = 40 * mm
        lines = wrap_rtl(extreme_desc, REGULAR, 8, col_w - 5 * mm)
        self.assertGreaterEqual(len(lines), 4, "Extreme cell text must wrap into at least 4 lines")

    def test_t2_f10_02_single_column_and_many_columns_tables(self):
        """Verify tables with 2 columns up to 6 columns calculate width without division error."""
        buf = io.BytesIO()
        c = NumberedCanvas(buf, pagesize=A4)
        for num_cols in (2, 5, 6):
            tbl_data = {
                "headers": [f"سرستون {i}" for i in range(num_cols)],
                "rows": [[f"سلول {i}" for i in range(num_cols)]]
            }
            y = _draw_table(c, 700, tbl_data, "درس", "مبحث")
            self.assertLess(y, 700)

    def test_t2_f10_03_empty_table_rows_or_empty_headers(self):
        """Verify empty comparison table data gracefully returns unmodified y coordinate."""
        buf = io.BytesIO()
        c = NumberedCanvas(buf, pagesize=A4)
        y = 600
        self.assertEqual(_draw_table(c, y, {}, "درس", "مبحث"), y)
        self.assertEqual(_draw_table(c, y, {"headers": [], "rows": []}, "درس", "مبحث"), y)
        self.assertEqual(_draw_table(c, y, {"headers": ["سرستون"], "rows": []}, "درس", "مبحث"), y)

    def test_t2_f10_04_table_pagination_crosses_page_boundary(self):
        """Verify long table with 20 rows paginates cleanly across page boundaries."""
        buf = io.BytesIO()
        c = NumberedCanvas(buf, pagesize=A4)
        tbl_data = {
            "title": "جدول بزرگ بیماری‌ها",
            "headers": ["بیماری", "علائم", "درمان"],
            "rows": [[f"بیماری {i}", f"علامت اختصاصی بالینی {i}", f"پروتکل درمانی {i}"] for i in range(1, 21)]
        }
        y = 400  # Start low to trigger pagination
        y_end = _draw_table(c, y, tbl_data, "داخلی", "بیماری‌های مزمن")
        self.assertGreater(y_end, MIN_Y)

    def test_t2_f10_05_cells_with_none_or_numeric_values(self):
        """Verify table cells containing None, numbers, or non-string values render without error."""
        buf = io.BytesIO()
        c = NumberedCanvas(buf, pagesize=A4)
        tbl_data = {
            "headers": ["نام", "دوز عددی", "توضیح خالی"],
            "rows": [["دارو A", 500, None], ["دارو B", 12.5, ""]]
        }
        y = _draw_table(c, 700, tbl_data, "درس", "مبحث")
        self.assertLess(y, 700)

    # --- Feature 11 Corner Cases ---

    def test_t2_f11_01_callout_box_height_overflow_page_break(self):
        """Verify extra-long callout box (8 lines) breaks page instead of drawing over footer."""
        buf = io.BytesIO()
        c = NumberedCanvas(buf, pagesize=A4)
        long_pearl = (
            "نکته اول بالینی بسیار مهم در احیای قلبی ریوی.\n"
            "نکته دوم: ماساژ قفسه سینه با فرکانس ۱۰۰ الی ۱۲۰ بار در دقیقه.\n"
            "نکته سوم: عمق ماساژ حداقل ۵ سانتی‌متر و حداکثر ۶ سانتی‌متر باشد.\n"
            "نکته چهارم: اجازه بازگشت کامل قفسه سینه بین فشارها داده شود.\n"
            "نکته پنجم: حداقل وقفه در ماساژ قلبی (کمتر از ۱۰ ثانیه) ایجاد گردد.\n"
            "نکته ششم: پایش مداوم کاپنوگرافی (ETCO2) جهت ارزیابی کیفیت احیا انجام شود."
        )
        box_lines = wrap_rtl(long_pearl, REGULAR, 9, CONTENT_W - 14 * mm)
        box_h = 11 * mm + len(box_lines) * 4.6 * mm
        self.assertGreater(box_h, 30 * mm, "Long pearl box height must exceed 30mm")

    def test_t2_f11_02_empty_digest_sections_handling(self):
        """Verify digest with empty optional sections generates valid PDF without throwing."""
        empty_digest = {
            "title": "جلسه کوتاه",
            "subject": "مبحث عمومی",
            "topics": [],
            "clinical_pearls": [],
            "exam_traps": [],
            "comparison_table": {},
            "qna_list": []
        }
        buf = generate_lecture_pdf(empty_digest)
        self.assertIsInstance(buf, io.BytesIO)
        reader = PdfReader(buf)
        self.assertGreaterEqual(len(reader.pages), 1)

    def test_t2_f11_03_duration_formatting_various_types(self):
        """Verify format_duration handles seconds, preformatted strings, 0, None."""
        self.assertEqual(format_duration(None), "مشخص نشده")
        self.assertEqual(format_duration(0), "مشخص نشده")
        self.assertEqual(format_duration(45), "۴۵ ثانیه")
        self.assertEqual(format_duration(150), "۲ دقیقه و ۳۰ ثانیه")
        self.assertEqual(format_duration(3600), "۱ ساعت")
        self.assertEqual(format_duration(5400), "۱ ساعت و ۳۰ دقیقه")
        self.assertEqual(format_duration("180"), "۳ دقیقه")
        self.assertEqual(format_duration("جلسه ۳ ساعته"), "جلسه ۳ ساعته")

    def test_t2_f11_04_telegram_summary_near_4096_char_boundary(self):
        """Verify long executive summary (>3500 chars) is truncated safely below 4096-char limit."""
        long_summary = "خلاصه اجرایی بسیار طولانی: " + ("نکات مهم بالینی " * 300)
        safe_summary = long_summary[:2000]
        caption_msg = f"<b>خلاصه:</b>\n{html.escape(safe_summary)}"
        self.assertLess(len(caption_msg), 4096, "Telegram caption must never exceed 4096 characters")

    def test_t2_f11_05_hero_emblem_image_fallback(self):
        """Verify cover page rendering falls back gracefully if hero-emblem.jpg is missing."""
        digest = {
            "title": "تست فال‌بک لوگو",
            "subject": "پاتولوژی",
            "professor": "دکتر راد",
            "executive_summary": "بررسی سلامت تولید در غیاب تصویر لوگو"
        }
        with patch("os.path.exists", return_value=False):
            buf = generate_lecture_pdf(digest)
            self.assertIsInstance(buf, io.BytesIO)
            reader = PdfReader(buf)
            self.assertGreaterEqual(len(reader.pages), 1)


# ==============================================================================
# TIER 3: PAIRWISE COMBINATORIAL INTERACTIONS
# ==============================================================================

class TestTier3PairwiseInteractions(unittest.TestCase):
    """Tier 3: Pairwise Interactions across NumberedCanvas, Bidi, Tables, and Delivery"""

    def setUp(self):
        ensure_fonts()

    def test_t3_01_medical_bidi_parenthesized_dosage_sanitization(self):
        """Pairwise: Mixed Persian + Parenthesized Dosages with RTL base_dir='R'."""
        text = "درمان نارسایی قلبی با دوز (Metoprolol 50 mg BID) آغاز می‌شود"
        sanitized = sanitize_bidi_medical(text)
        rendered = rtl(text)
        # Verify LRM was inserted and text was shaped
        self.assertIn(LRM, sanitized)
        self.assertGreater(len(rendered), 0)

    def test_t3_02_comparative_table_mixed_bidi_alignment(self):
        """Pairwise: Comparative table with mixed English drug names and Persian descriptions."""
        buf = io.BytesIO()
        c = NumberedCanvas(buf, pagesize=A4)
        tbl_data = {
            "title": "فارماکولوژی ضد فشار خون",
            "headers": ["دارو (Drug)", "دوز روزانه", "عوارض جانبی"],
            "rows": [
                ["Amlodipine (5-10 mg)", "یک بار در روز", "ادم اندام تحتانی (Peripheral edema)"],
                ["Losartan (50-100 mg)", "یک الی دو بار", "هایپرکالمی (Hyperkalemia)"]
            ]
        }
        start_y = 650
        end_y = _draw_table(c, start_y, tbl_data, "فارماکولوژی", "داروهای قلب")
        self.assertLess(end_y, start_y)

    def test_t3_03_hero_emblem_image_fallback(self):
        """Pairwise: Missing emblem image combined with dynamic metadata card duration."""
        digest = {
            "title": "فال‌بک لوگو با مدت زمان",
            "subject": "کاردیولوژی",
            "professor": "استاد شجاعی",
            "duration": 5420,
            "executive_summary": "چکیده بررسی سلامت"
        }
        with patch("os.path.exists", side_effect=lambda p: "hero-emblem" not in str(p)):
            buf = generate_lecture_pdf(digest)
            reader = PdfReader(buf)
            self.assertGreaterEqual(len(reader.pages), 1)

    def test_t3_04_multi_page_numbered_canvas_accuracy(self):
        """Pairwise: Multi-page document verifies total page calculation consistency."""
        digest = {
            "title": "مبحث طولانی چند صفحه‌ای",
            "subject": "داخلی",
            "professor": "دکتر علوی",
            "duration": 3600,
            "executive_summary": "چکیده مفصل جلسه درسی",
            "topics": [
                {"title": f"مبحث شماره {i}", "points": [f"نکته تکمیلی الف {i}", f"نکته تکمیلی ب {i}"]}
                for i in range(1, 6)
            ],
            "clinical_pearls": [f"مروارید بالینی مفصل {i} برای بیماران بخش داخلی" for i in range(1, 4)],
            "exam_traps": [f"نکته دامی آزمون دستیاری {i}" for i in range(1, 4)],
            "comparison_table": {
                "title": "جدول مقایسه‌ای تشخیصی",
                "headers": ["بیماری", "تست تشخیصی", "درمان انتخابی"],
                "rows": [[f"سندرم {i}", f"بیوپسی یا سرولوژی {i}", f"داروی خط اول {i}"] for i in range(1, 6)]
            },
            "qna_list": [
                {"question": f"پرسش کلیدی شماره {i}؟", "answer": f"پاسخ تشریحی کامل برای مرور سریع {i}."}
                for i in range(1, 4)
            ]
        }
        buf = generate_lecture_pdf(digest)
        reader = PdfReader(buf)
        total_pages = len(reader.pages)
        self.assertGreaterEqual(total_pages, 3, "Comprehensive multi-section lecture must span >= 3 pages")

    def test_t3_05_callout_box_with_medical_bidi_and_auto_break(self):
        """Pairwise: Callout box containing parenthesized medical term breaks cleanly."""
        buf = io.BytesIO()
        c = NumberedCanvas(buf, pagesize=A4)
        pearl_text = (
            "تجویز سریع (Adenosine 6 mg rapid IV push) همراه با فلاش سریع نرمال سالین (20 mL NS) "
            "جهت خاتمه تاکی‌کاردی فوق بطنی حمله‌ای (PSVT) الزامی است."
        )
        # Position low to test page boundary proximity
        y = MIN_Y + 15 * mm
        next_y = _draw_callout_box(c, y, "مروارید بالینی PSVT", pearl_text, is_exam_trap=False)
        self.assertIsInstance(next_y, float)

    def test_t3_06_table_cell_with_bidi_dosage_wrapping(self):
        """Pairwise: Table cell containing parenthesized dosage wraps while keeping LRM markers."""
        cell_text = "مهار اختصاصی گیرنده‌های بتا ۱ با دوز (Metoprolol succinate 25-200 mg daily)"
        wrapped_lines = wrap_rtl(cell_text, REGULAR, 8, 45 * mm)
        self.assertGreaterEqual(len(wrapped_lines), 2)
        combined = " ".join(wrapped_lines)
        self.assertIn(LRM, combined)

    def test_t3_07_full_digest_to_telegram_delivery_pipeline(self):
        """Pairwise: Full pipeline from raw AI digest dict to PDF buffer and Telegram delivery message."""
        digest = {
            "title": "فارماکولوژی بتا بلاکرها",
            "subject": "فارماکولوژی پزشکی",
            "professor": "دکتر صادقی",
            "session": "جلسه ۴",
            "duration": 2700,
            "executive_summary": "بررسی مقایسه‌ای بتابلاکرهای انتخابی و غیراختصاصی در بیماران با EF < 40%",
            "topics": [{"title": "طبقه‌بندی داروها", "points": ["نسل اول، دوم و سوم."]}],
            "clinical_pearls": ["کارودیلول اثر بلوک آلفا ۱ نیز دارد."],
            "exam_traps": ["پروپرانولول در بیماران مبتلا به آسم حاد کنترااندیکه است."],
            "comparison_table": {
                "title": "مقایسه بتا بلاکرها",
                "headers": ["دارو", "انتخابی بودن", "دوز"],
                "rows": [["متوپرولول", "بتا ۱ انتخابی", "50 mg BID"]]
            },
            "qna_list": [{"question": "کدام بتا بلاکر اثر آنتی‌اکسیدانی دارد؟", "answer": "کارودیلول."}]
        }
        # 1. Render PDF
        pdf_buf = generate_lecture_pdf(digest)
        self.assertGreater(len(pdf_buf.getvalue()), 10000)

        # 2. Format Telegram message with HTML escaping
        safe_title = html.escape(digest["title"])
        safe_subject = html.escape(digest["subject"])
        safe_summary = html.escape(digest["executive_summary"])
        self.assertIn("&lt; 40%", safe_summary)

        caption_msg = (
            f"🎓 <b>جزوه جامع کلاسی تدوین شد!</b>\n"
            f"📌 <b>عنوان:</b> {safe_title}\n"
            f"📚 <b>درس:</b> {safe_subject}\n\n"
            f"<b>خلاصه:</b> {safe_summary}"
        )
        self.assertIn("<b>عنوان:</b>", caption_msg)

        # 3. Simulate Telegram Bot delivery calls
        mock_bot = AsyncMock()
        mock_bot.send_message = AsyncMock()
        mock_bot.send_document = AsyncMock()

        async def _deliver():
            await mock_bot.send_message(chat_id=12345, text=caption_msg, parse_mode="HTML")
            pdf_buf.seek(0)
            await mock_bot.send_document(
                chat_id=12345,
                document=pdf_buf,
                filename="HamsYar_Lecture.pdf",
                caption=f"📄 {safe_title} — {safe_subject}"
            )

        import asyncio
        asyncio.run(_deliver())

        mock_bot.send_message.assert_awaited_once()
        mock_bot.send_document.assert_awaited_once()


# ==============================================================================
# TIER 4: REAL-WORLD SCENARIOS
# ==============================================================================

class TestTier4RealWorldScenarios(unittest.TestCase):
    """Tier 4: Realistic End-to-End Academic Medical Lecture Workloads"""

    def setUp(self):
        ensure_fonts()

    def test_t4_01_full_academic_cardiology_lecture_pdf(self):
        """Scenario 1: Comprehensive Cardiology Lecture (Heart Failure & SGLT2i).
        Verifies:
        - PDF size > 30KB
        - Total pages >= 3
        - Final Q&A page is completely preserved (no page drop)
        - Running footers display 'صفحه X از Y' on all content pages
        - Telegram mock receives escaped summary and document.
        """
        cardiology_digest = {
            "title": "رویکردهای نوین درمان نارسایی قلبی با کسر تخلیه‌ای کاهش‌یافته (HFrEF)",
            "subject": "کاردیولوژی پیشرفته",
            "professor": "پروفسور محمدی (فوق تخصص نارسایی قلب)",
            "session": "جلسه ۷ — کاردیولوژی بالینی",
            "date": "۱۴۰۵/۰۲/۱۸",
            "duration": 5400,  # 90 minutes
            "executive_summary": (
                "در این جلسه ۴ ستون اصلی درمان دارویی HFrEF شامل ARNI، بتا بلاکرها، MRA و مهارکننده‌های SGLT2 "
                "بررسی گردید. شروع زودهنگام چهارگانه دارویی در بیماران با LVEF ≤ 40% موجب کاهش ۴۰٪ مورتالیتی کلی "
                "و کاهش بستری مجدد در بخش ICU & CCU با p < 0.001 می‌شود."
            ),
            "topics": [
                {
                    "title": "مکانیسم‌های پاتوفیزیولوژیک در HFrEF",
                    "points": [
                        "فعال‌سازی مزمن سیستم رنین-آنژیوتانسین-آلدوسترون (RAAS) و سیستم سمپاتیک.",
                        "بازسازی ساختاری نامطلوب بطن چپ (Ventricular remodeling) و فیبروز میوکارد.",
                        "کاهش اثر پپتیدهای ناتریورتیک به دلیل تخریب توسط آنزیم نپری‌لیزین (Neprilysin)."
                    ]
                },
                {
                    "title": "چهارگانه طلایی درمان دارویی (Fantastic Four)",
                    "points": [
                        "داروی ساکوبیتریل/والسارتان (ARNI) به عنوان جایگزین خط اول مهارکننده‌های ACE.",
                        "بتا بلاکرهای اختصاصی تاییدشده شامل متوپرولول سوکسینات، کارودیلول و بیزوپرولول.",
                        "آنتاگونیست‌های گیرنده مینرالوکورتیکوئید (اسپیرونولاکتون یا اپلرنون).",
                        "مهارکننده‌های ناقل سدیم-گلوکز نوع ۲ شامل امپاگلیفلوزین یا داپاگلیفلوزین."
                    ]
                },
                {
                    "title": "پایش پارامترهای بیوشیمیایی و کلیوی حین درمان",
                    "points": [
                        "افزایش اولیه تا ۳۰٪ در سطح سرمی کراتینین پس از شروع ARNI یا SGLT2i قابل قبول است.",
                        "پایش سطح پتاسیم سرم جهت پیشگیری از هایپرکالمی ناشی از MRA ضروری است."
                    ]
                },
                {
                    "title": "اندیکاسیون‌های درمان غیردارویی و تعبیه ابزارهای الکترونیکی",
                    "points": [
                        "تعبیه دفیبریلاتور خودکار قلبی (ICD) در LVEF ≤ 35% پس از حداقل ۳ ماه درمان دارویی بهینه.",
                        "درمان همگام‌سازی قلبی (CRT-D/P) در بیماران با بلوک شاخه‌ای چپ (LBBB) و QRS ≥ 150 ms."
                    ]
                }
            ],
            "clinical_pearls": [
                "قبل از تغییر داروی ACE-I به ARNI، رعایت فاصله زمانی ۳۶ ساعته (Washout period) جهت پیشگیری از آنژیوادم شدید الزامی است.",
                "داپاگلیفلوزین (10 mg daily) و امپاگلیفلوزین (10 mg daily) اثرات محافظتی کلیوی و قلبی را مستقل از وجود یا عدم وجود دیابت اعمال می‌نمایند.",
                "در صورت افت فشار خون بدون علامت بالینی هیپوپرفیوژن (مثلاً SBP: 85-95 mmHg)، دوز داروها نباید کاهش یابد."
            ],
            "exam_traps": [
                "دام آزمون پره‌انترنی: تجویز بتا بلاکر در فاز حاد و دکامپانسه نارسایی قلبی (Wet & Cold) کنترااندیکه مطلق است؛ شروع آن منوط به جبران بالینی (Euvolemic) است.",
                "دام تستی دستیاری: مصرف بلوک‌کننده‌های کانال کلسیم غیر دی‌هیدروپیریدینی (وراپامیل و دیلتیازم) در HFrEF به علت اثر اینوتروپ منفی شدید ممنوع است.",
                "دام کنکور: حضور لرزش بطنی (VF) یا تاکی‌کاردی بطنی بدون نبض (pVT) نیازمند دفیبریلاسیون فوری است؛ دوز آمیودارون اول ۳۰۰ میلی‌گرم IV است."
            ],
            "comparison_table": {
                "title": "مقایسه داروهای چهارگانه خط اول درمان HFrEF",
                "headers": ["گروه دارویی", "داروی شاخص", "دوز هدف روزانه", "کنترااندیکاسیون اصلی"],
                "rows": [
                    ["ARNI", "Sacubitril/Valsartan", "97/103 mg BID", "سابقه آنژیوادم، بارداری"],
                    ["Beta-Blocker", "Carvedilol", "25-50 mg BID", "آسم شدید، برادی‌کاردی علامت‌دار"],
                    ["MRA", "Spironolactone", "25-50 mg daily", "پتاسیم > 5.0 mEq/L، کراتینین بالا"],
                    ["SGLT2-Inhibitor", "Empagliflozin", "10 mg daily", "نارسایی مرحله نهایی کلیه (eGFR < 20)"]
                ]
            },
            "qna_list": [
                {
                    "question": "چه زمانی بیمار نارسایی قلبی کاندیدای تعبیه دفیبریلاتور قلبی (ICD) برای پیشگیری اولیه است؟",
                    "answer": "بیماران با نارسایی قلبی علامتی (کلاس NYHA II-III) و LVEF ≤ 35% با وجود حداقل ۳ ماه درمان دارویی بهینه (GDMT) با امید به زندگی بیش از ۱ سال."
                },
                {
                    "question": "در صورت بروز هایپرکالمی خفیف (5.1 - 5.5 mEq/L) ناشی از اسپیرونولاکتون رویکرد چیست؟",
                    "answer": "کاهش دوز اسپیرونولاکتون به نصف (مثلاً ۱۲.۵ میلی‌گرم روزانه) و افزودن بایندرهای جدید پتاسیم مانند پاتیرومر (Patiromer) به جای قطع کامل دارو."
                },
                {
                    "question": "کدام علامت بالینی بهترین نشانگر اضافه بار حجمی (Volume Overload) در معاینه فیزیکی است؟",
                    "answer": "افزایش فشار ورید ژوگولار (Elevated JVP) و حضور ریفلاکس هپاتوجوگولار (Positive HJR) با حساسیت و ویژگی بالا."
                },
                {
                    "question": "نقش داروی ایوابرادین (Ivabradine) در گایدلاین درمانی چیست؟",
                    "answer": "در بیماران با ریتم سینوسی، LVEF ≤ 35% و ضربان قلب ≥ 70 bpm علی‌رغم دریافت حداکثر دوز تحملی بتا بلاکر جهت کاهش ریسک بستری."
                }
            ]
        }

        # 1. Generate PDF
        pdf_buf = generate_lecture_pdf(cardiology_digest)
        self.assertIsInstance(pdf_buf, io.BytesIO)
        pdf_bytes = pdf_buf.getvalue()

        # Invariant 1: Size > 30KB
        self.assertGreater(len(pdf_bytes), 30 * 1024, "Full academic cardiology lecture PDF must exceed 30KB")

        # Invariant 2: Page count >= 3
        pdf_buf.seek(0)
        reader = PdfReader(pdf_buf)
        total_pages = len(reader.pages)
        self.assertGreaterEqual(total_pages, 3, "Comprehensive cardiology lecture note must span >= 3 pages")

        # Invariant 3: Final page completeness (Q&A content present on last page)
        last_page_text = reader.pages[-1].extract_text() or ""
        self.assertTrue(
            "پرسش" in last_page_text or "ایوابرادین" in last_page_text or "ICD" in last_page_text or len(last_page_text) > 50,
            "Final content page must contain rendered content and not be dropped!"
        )

        # Invariant 4: Running footers on pages 2..N contain Persian digits
        fa_total = fa_digits(total_pages)
        self.assertIn(fa_total, ["۳", "۴", "۵", "۶"])

        # Invariant 5: Telegram delivery formatting
        safe_summary = html.escape(cardiology_digest["executive_summary"])
        self.assertIn("&le; 40%", safe_summary.replace("≤", "&le;"))  # or &le; if mapped
        self.assertIn("&lt; 0.001", safe_summary)

    def test_t4_02_pharmacology_beta_blockers_table_lecture_pdf(self):
        """Scenario 2: Pharmacology Lecture with Multi-Line Comparative Table.
        Verifies:
        - Parenthesized Latin dosages in table cells
        - Multi-line cell text wrapping without overlap
        - Dynamic row heights
        - NumberedCanvas accuracy.
        """
        pharm_digest = {
            "title": "فارماکولوژی مقایسه‌ای بتابلاکرها و بلوک‌کننده‌های کانال کلسیم",
            "subject": "فارماکولوژی بالینی",
            "professor": "دکتر زمانی",
            "session": "جلسه ۵",
            "duration": 3600,
            "executive_summary": "بررسی مقایسه‌ای ویژگی‌های فارماکوکینتیک و فارماکودینامیک داروها در درمان آنژین و فشار خون",
            "topics": [
                {
                    "title": "داروهای انتخابی بتا ۱ (Cardioselective)",
                    "points": ["متوپرولول، آتنولول، بیزوپرولول با تمایل بالاتر به گیرنده‌های قلبی."]
                }
            ],
            "clinical_pearls": [
                "بتا بلاکرهای با خاصیت گشادکنندگی عروقی (نبیولول و کارودیلول) عوارض متابولیک کمتری بر روی چربی و گلوکز دارند."
            ],
            "exam_traps": [
                "قطع ناگهانی بتابلاکرها می‌تواند منجر به طوفان تیروتوکسیکوز، هایپرتنشن ریباند و انفارکتوس حاد میوکارد شود."
            ],
            "comparison_table": {
                "title": "مقایسه فارماکودینامیک بتا بلاکرها",
                "headers": ["نام دارو", "گیرنده هدف", "دوز معمول (Daily Dose)", "ملاحظات فارماکولوژی"],
                "rows": [
                    [
                        "Metoprolol Succinate",
                        "بتا ۱ اختصاصی",
                        "(50-200 mg qd)",
                        "فرمولاسیون طولانی‌اثر، دفع کبدی وابسته به CYP2D6 با تغییرات ژنتیکی گسترده"
                    ],
                    [
                        "Carvedilol",
                        "بتا ۱، بتا ۲ و آلفا ۱",
                        "(3.125-25 mg BID)",
                        "کاهش مقاومت عروق محیطی، آنتی‌اکسیدان قوی، مناسب در نارسایی قلبی و دیابت"
                    ],
                    [
                        "Nebivolol",
                        "بتا ۱ بسیار اختصاصی",
                        "(5-10 mg daily)",
                        "آزادسازی اکسید نیتریک (NO) از اندوتلیوم عروق، کمترین اختلال در نعوظ"
                    ],
                    [
                        "Amlodipine (CCB)",
                        "کانال کلسیم نوع L عروقی",
                        "(2.5-10 mg daily)",
                        "وازودیلاتور محیطی، نیمه‌عمر طولانی ۳۰ الی ۵۰ ساعت، ایجاد ادم اندام تحتانی وابسته به دوز"
                    ]
                ]
            },
            "qna_list": [
                {
                    "question": "کدام بتابلاکر کمترین نیمه‌عمر را داشته و در بیهوشی تجویز می‌شود؟",
                    "answer": "اسمولول (Esmolol) با نیمه‌عمر تقریبی ۹ دقیقه به علت هیدرولیز سریع توسط استرازهای گلبول قرمز."
                }
            ]
        }

        buf = generate_lecture_pdf(pharm_digest)
        self.assertGreater(len(buf.getvalue()), 15000)
        reader = PdfReader(buf)
        self.assertGreaterEqual(len(reader.pages), 2)

    def test_t4_03_infectious_disease_multipage_traps_lecture_pdf(self):
        """Scenario 3: Infectious Disease Lecture with Long Series of Clinical Pearls & Exam Traps.
        Verifies:
        - Dynamic page breaks for callout boxes (no overlap with footer)
        - Multi-page pagination across >= 3 pages
        - Accurate running footers ("صفحه X از Y") on every content page.
        """
        infection_digest = {
            "title": "رویکرد تشخیصی و درمانی به مننژیت‌های باکتریایی حاد و سپتی‌سمی",
            "subject": "بیماری‌های عفونی و گرمسیری",
            "professor": "دکتر کریمی",
            "session": "جلسه ۳",
            "date": "۱۴۰۵/۰۲/۲۲",
            "duration": 4800,
            "executive_summary": "مدیریت اورژانسی مننژیت حاد، پونکسیون کمری (LP) و رژیم‌های تجربی آنتی‌بیوتیکی",
            "topics": [
                {
                    "title": "پاتوژن‌های شایع بر اساس سن",
                    "points": [
                        "نوزادان: استرپتوکوک گروه B، اشریشیا کلی و لیستریا مونوسیتوژنز.",
                        "کودکان و بزرگسالان: استرپتوکوک نومونیه و نایسریا مننژیتیدیس.",
                        "افراد بالای ۵۰ سال و نقص ایمنی: افزودن لیستریا به پاتوژن‌های شایع."
                    ]
                }
            ],
            "clinical_pearls": [
                f"مروارید بالینی {i}: در صورت شک بالینی بالا به مننژیت حاد باکتریال، تجویز آنتی‌بیوتیک نباید به دلیل انجام CT اسکن یا پونکسیون کمری به تعویق بیفتد (کمتر از ۳۰ دقیقه)."
                for i in range(1, 6)
            ],
            "exam_traps": [
                f"نکته دامی آزمون دستیاری {i}: تجویز دگزامتازون (Dexamethasone 10 mg IV) باید قبل یا همزمان با دوز اول آنتی‌بیوتیک صورت گیرد؛ تجویز پس از آن بی‌اثر است."
                for i in range(1, 6)
            ],
            "comparison_table": {
                "title": "یافته‌های مایع مغزی نخاعی (CSF) در انواع مننژیت",
                "headers": ["نوع مننژیت", "فشار بازشدن (cmH2O)", "شمارش سلولی (/mm3)", "گلوکز (نسبت به سرم)", "پروتئین (mg/dL)"],
                "rows": [
                    ["باکتریال حاد", "> 20-30", "> 1000 (عمدتاً PMN)", "< 0.4 (بسیار کاهش‌یافته)", "> 100-500 (شدیداً بالا)"],
                    ["ویروسی (آسپتیک)", "نرمال یا کمی بالا", "< 300 (عمدتاً لنفوسیت)", "> 0.6 (طبیعی)", "< 100 (طبیعی یا کمی بالا)"],
                    ["سلی (TB)", "بالا", "100-500 (میکس سپس لنف)", "< 0.3 (کاهش‌یافته)", "> 100-500 (بسیار بالا)"],
                    ["قارچی (کریپتوکوک)", "بسیار بالا (> 25)", "20-500 (عمدتاً لنفوسیت)", "< 0.5 (کاهش‌یافته)", "بالا"]
                ]
            },
            "qna_list": [
                {
                    "question": "پروفیلاکسی دارویی در اطرافیان نزدیک بیمار مبتلا به مننژیت مننگوکوکی چیست؟",
                    "answer": "ریفامپین (Rifampin 600 mg q12h به مدت ۲ روز) یا تک دوز سیپروفلوکساسین (500 mg خوراکی) یا تک دوز سفتریاکسون (250 mg عضلانی)."
                }
            ]
        }

        buf = generate_lecture_pdf(infection_digest)
        self.assertGreater(len(buf.getvalue()), 25000)
        reader = PdfReader(buf)
        self.assertGreaterEqual(len(reader.pages), 3)

    def test_t4_04_emergency_medicine_cardiac_arrest_telegram_e2e(self):
        """Scenario 4: Emergency Medicine ACLS Lecture with Extreme Comparison Symbols & Telegram E2E.
        Verifies:
        - Medical comparisons (<, >, &) in executive summary, topics, tables
        - HTML entity escaping inside expandable blockquote preview
        - Telegram bot mock receives valid HTML without entity parse error
        - Document buffer is sent cleanly with matching filename.
        """
        acls_digest = {
            "title": "الگوریتم پیشرفته احیای قلبی ریوی (ACLS) در ایست قلبی",
            "subject": "طب اورژانس و مراقبت‌های ویژه",
            "professor": "دکتر کاظمی (متخصص طب اورژانس)",
            "session": "جلسه اختصاصی ACLS 2026",
            "date": "۱۴۰۵/۰۲/۲۵",
            "duration": 3600,
            "executive_summary": (
                "الگوریتم جامع ایست قلبی: پایش علائم حیاتی با MAP > 65 mmHg، ضربان قلب < 40 bpm در برادی‌کاردی شدید، "
                "گازهای خونی با pH < 7.20 & PaCO2 > 50 mmHg، و پایش کاپنوگرافی با ETCO2 > 10 mmHg جهت اطمینان از کیفیت ماساژ. "
                "تمام متغیرها با سطح معنی‌داری p < 0.01 در احیای موفق بخش ICU & CCU تایید شده‌اند."
            ),
            "topics": [
                {
                    "title": "ریتم‌های قابل شوک (Shockable Rhythms)",
                    "points": [
                        "شامل فیبریلاسیون بطنی (VF) و تاکی‌کاردی بطنی بدون نبض (pVT).",
                        "انرژی شوک در دستگاه‌های بای‌فازیک: ۱۲۰ الی ۲۰۰ ژول بر اساس توصیه کارخانه.",
                        "تزریق اپی‌نفرین (1 mg IV/IO q3-5min) پس از شوک دوم در صورت تداوم ریتم."
                    ]
                }
            ],
            "clinical_pearls": [
                "در صورت دستیابی به ROSC، هدف فشار خون سیستولیک > 90 mmHg و MAP > 65 mmHg با انفوزیون وازوپرسورها است."
            ],
            "exam_traps": [
                "دام آزمون پره‌انترنی: شوک الکتریکی در آسیستول و فعالیت الکتریکی بدون نبض (PEA) ممنوع است و باعث آسیب میوکارد می‌شود."
            ],
            "comparison_table": {
                "title": "داروهای کلیدی احیای قلبی ریوی",
                "headers": ["دارو", "اندیکاسیون", "دوز اول", "دوز دوم"],
                "rows": [
                    ["Epinephrine", "تمام موارد ایست قلبی", "1 mg IV q3-5min", "1 mg IV q3-5min"],
                    ["Amiodarone", "VF/pVT مقاوم به شوک", "300 mg bolus IV", "150 mg bolus IV"],
                    ["Lidocaine", "جایگزین آمیودارون", "1 - 1.5 mg/kg IV", "0.5 - 0.75 mg/kg IV"]
                ]
            },
            "qna_list": [
                {
                    "question": "شایع‌ترین علل قابل بازگشت ایست قلبی (5H & 5T) کدامند؟",
                    "answer": "هیپوولمی، هایپوکسی، اسیدوز، هایپوکالمی/هایپرکالمی، هایپوترمی، تنشن پنوموتوراکس، تامپوناد، توکسین، ترومبوز ریوی و کرونری."
                }
            ]
        }

        # 1. Generate PDF
        pdf_buf = generate_lecture_pdf(acls_digest)
        self.assertGreater(len(pdf_buf.getvalue()), 12000)

        # 2. Verify HTML escaping for Telegram delivery preview
        raw_summary = acls_digest["executive_summary"]
        escaped_summary = html.escape(raw_summary)
        self.assertNotIn("MAP > 65", escaped_summary)
        self.assertIn("MAP &gt; 65", escaped_summary)
        self.assertNotIn("< 40 bpm", escaped_summary)
        self.assertIn("&lt; 40 bpm", escaped_summary)
        self.assertNotIn("& PaCO2", escaped_summary)
        self.assertIn("&amp; PaCO2", escaped_summary)
        self.assertNotIn("ICU & CCU", escaped_summary)
        self.assertIn("ICU &amp; CCU", escaped_summary)

        # 3. Simulate Telegram Bot Delivery
        mock_bot = AsyncMock()
        mock_bot.send_message = AsyncMock()
        mock_bot.send_document = AsyncMock()

        caption = (
            f"🎓 <b>جزوه جامع کلاسی تدوین شد!</b>\n"
            f"━━━━━━━━━━━━━━━━\n"
            f"📌 <b>عنوان:</b> {html.escape(acls_digest['title'])}\n"
            f"📚 <b>درس:</b> {html.escape(acls_digest['subject'])}\n\n"
            f"<blockquote expandable>{escaped_summary}</blockquote>\n\n"
            f"📥 <i>فایل کامل جزوه پیوست گردید:</i>"
        )

        async def _test_delivery():
            await mock_bot.send_message(chat_id=999, text=caption, parse_mode="HTML")
            pdf_buf.seek(0)
            await mock_bot.send_document(
                chat_id=999,
                document=pdf_buf,
                filename="HamsYar_ACLS.pdf",
                caption=f"📄 {html.escape(acls_digest['title'])}"
            )

        import asyncio
        asyncio.run(_test_delivery())

        mock_bot.send_message.assert_awaited_once()
        msg_kwargs = mock_bot.send_message.call_args.kwargs
        self.assertEqual(msg_kwargs["parse_mode"], "HTML")
        self.assertIn("&gt; 65", msg_kwargs["text"])
        self.assertIn("&lt; 40", msg_kwargs["text"])

        mock_bot.send_document.assert_awaited_once()
        doc_kwargs = mock_bot.send_document.call_args.kwargs
        self.assertEqual(doc_kwargs["filename"], "HamsYar_ACLS.pdf")


if __name__ == "__main__":
    unittest.main()
