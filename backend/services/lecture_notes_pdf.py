"""
📄 lecture_notes_pdf — تولید جزوه و سند دانشگاهی پریمیوم از جلسات درسی هوشیار
HamsYar Medical Platform — Premium v2 (1405)

ویژگی‌ها:
  • صفحه جلد با آیکون و نشان پرچمدار نئونی هامزیار (hero-emblem.jpg).
  • تایپوگرافی کامل فارسی راست‌به‌چپ (Vazirmatn RTL) با اعداد فارسی.
  • کادرهای اختصاصی:
      💎 مرواریدهای بالینی (Clinical Pearls) با نوار فیروزه‌ای.
      🚨 دام‌های تستی پره‌انترنی و دستیاری (Exam Traps) با کادر هشدار قرمز.
  • جدول‌های مقایسه‌ای داروها و بیماری‌ها با سطرهای متناوب و خطوط تمیز.
  • پرسش و پاسخ‌های کلیدی مرور سریع جلسه.
  • شماره‌گذاری صفحات دو مرحله‌ای (صفحه X از Y) و فوتر برند با واترمارک ظریف.
"""

import io
import os
import logging
from datetime import datetime

from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
from reportlab.lib.pagesizes import A4

from qbank.fonts_rtl import (
    ensure_fonts, rtl, fa_digits, wrap_rtl, text_width,
    REGULAR, MEDIUM, BOLD
)
from qbank.styles import (
    PAGE_W, PAGE_H, MARGIN, CONTENT_W, MIN_Y, FOOTER_Y,
    NAVY, NAVY_LIGHT, BRAND_GREEN, GRAY, TEXT_DARK, WHITE
)

logger = logging.getLogger(__name__)

# ── پالت رنگ اختصاصی جزوه‌های پزشکی هوشیار ──
CYAN_NEON        = HexColor('#00d2ff')
CYAN_DARK        = HexColor('#0284c7')
TEAL_DEEP        = HexColor('#0f766e')
BG_PAGE          = HexColor('#fbfcfd')
PEARL_BG         = HexColor('#f0f9ff')
PEARL_BORDER     = HexColor('#38bdf8')
PEARL_ACCENT     = HexColor('#0284c7')
TRAP_BG          = HexColor('#fff1f2')
TRAP_BORDER      = HexColor('#f87171')
TRAP_ACCENT      = HexColor('#e11d48')
CARD_BORDER_SOFT = HexColor('#e2e8f0')
CARD_BG_SOFT     = HexColor('#f8fafc')
TABLE_HEAD_BG    = HexColor('#1e293b')
TABLE_ZEBRA_BG   = HexColor('#f1f5f9')
TEXT_MUTED       = HexColor('#64748b')
TEXT_PRIMARY     = HexColor('#0f172a')

_TOP_BAR_H = 3.8 * mm
_LOGO_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    'miniapp', 'public', 'icons', 'hero-emblem.jpg'
)
_FALLBACK_LOGO_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    'miniapp', 'public', 'icons', 'icon-512.png'
)


class NumberedCanvas(canvas.Canvas):
    """کانواس دو مرحله‌ای برای درج خودکار تعداد کل صفحات (صفحه X از Y)"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        # Flush current open page if content was drawn on it
        if len(self._code) > 0:
            self.showPage()
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self._draw_page_decorations(num_pages)
            canvas.Canvas.showPage(self)
        canvas.Canvas.save(self)

    def _draw_page_decorations(self, total_pages: int):
        page_num = self._pageNumber
        if page_num == 1:
            # صفحه اول (جلد) نیازی به فوتر صفحه X از Y ندارد
            return

        # فوتر صفحه
        self.setStrokeColor(CARD_BORDER_SOFT)
        self.setLineWidth(0.6)
        self.line(MARGIN, FOOTER_Y, PAGE_W - MARGIN, FOOTER_Y)

        self.setFont(REGULAR, 7.5)
        self.setFillColor(TEXT_MUTED)

        # سمت چپ: شماره صفحه
        page_str = rtl(f"صفحه {fa_digits(page_num)} از {fa_digits(total_pages)}")
        self.drawString(MARGIN, FOOTER_Y - 4.5 * mm, page_str)

        # مرکز: واترمارک متنی برند
        center_str = rtl("هامزیار • سامانه هوشمند دستیار پزشکی (@humsyarbot)")
        self.drawCentredString(PAGE_W / 2, FOOTER_Y - 4.5 * mm, center_str)

        # سمت راست: نکته رفرنس
        right_str = rtl("مبتنی بر رفرنس‌های تاییدشده بالینی")
        self.drawRightString(PAGE_W - MARGIN, FOOTER_Y - 4.5 * mm, right_str)


def _draw_top_brand_bar(c):
    """نوار دوسطحی برند بالای صفحه"""
    c.setFillColor(NAVY)
    c.rect(0, PAGE_H - _TOP_BAR_H, PAGE_W, _TOP_BAR_H, fill=1, stroke=0)
    c.setFillColor(CYAN_NEON)
    c.rect(0, PAGE_H - _TOP_BAR_H - 0.8 * mm, PAGE_W, 0.8 * mm, fill=1, stroke=0)


def _draw_content_header(c, subject: str, title: str):
    """هدر صفحات دوم به بعد"""
    _draw_top_brand_bar(c)
    header_y = PAGE_H - _TOP_BAR_H - 6.5 * mm

    c.setFont(BOLD, 8.5)
    c.setFillColor(NAVY)
    # سمت راست: موضوع و عنوان درس
    clean_title = f"{subject} — {title}" if subject and subject != title else title
    if len(clean_title) > 55:
        clean_title = clean_title[:52] + "..."
    c.drawRightString(PAGE_W - MARGIN, header_y, rtl(clean_title))

    # سمت چپ: چیپ هوشیار
    c.setFont(REGULAR, 8)
    c.setFillColor(CYAN_DARK)
    c.drawString(MARGIN, header_y, rtl("دستیار چندرسانه‌ای هوشیار"))

    # خط جداکننده زیر هدر
    c.setStrokeColor(CARD_BORDER_SOFT)
    c.setLineWidth(0.5)
    c.line(MARGIN, header_y - 2.5 * mm, PAGE_W - MARGIN, header_y - 2.5 * mm)


def _draw_watermark(c):
    """واترمارک زاویه‌دار پس‌زمینه با شفافیت کنترل‌شده"""
    c.saveState()
    c.setFillColor(NAVY)
    c.setFillAlpha(0.02)
    c.setFont(BOLD, 44)
    c.translate(PAGE_W / 2, PAGE_H / 2)
    c.rotate(32)
    c.drawCentredString(0, 0, rtl("هامزیار — هوشیار"))
    c.restoreState()
    c.setFillAlpha(1)


def format_duration(val) -> str:
    """فرمت‌بندی مدت زمان جلسه (ثانیه، رشته فارسی یا خالی) به صورت متنی تمیز"""
    if not val:
        return 'مشخص نشده'
    if isinstance(val, (int, float)):
        sec = int(val)
    elif isinstance(val, str) and val.strip().isdigit():
        sec = int(val.strip())
    else:
        return fa_digits(str(val).strip())

    if sec <= 0:
        return 'مشخص نشده'
    if sec < 60:
        return fa_digits(f"{sec} ثانیه")
    h = sec // 3600
    m = (sec % 3600) // 60
    s = sec % 60
    if h > 0:
        if m > 0:
            return fa_digits(f"{h} ساعت و {m} دقیقه")
        return fa_digits(f"{h} ساعت")
    else:
        if s > 0 and m < 5:
            return fa_digits(f"{m} دقیقه و {s} ثانیه")
        return fa_digits(f"{m} دقیقه")


def _draw_cover(c, digest: dict):
    """ترسیم صفحه جلد شیک و آکادمیک"""
    _draw_top_brand_bar(c)
    _draw_watermark(c)

    # لوگو/نشان پرچمدار
    emblem_drawn = False
    emblem_y = PAGE_H - 62 * mm
    for path in (_LOGO_PATH, _FALLBACK_LOGO_PATH):
        if os.path.isfile(path):
            try:
                img = ImageReader(path)
                c.drawImage(
                    img,
                    (PAGE_W - 38 * mm) / 2,
                    emblem_y,
                    width=38 * mm,
                    height=38 * mm,
                    mask='auto',
                    preserveAspectRatio=True
                )
                emblem_drawn = True
                break
            except Exception:
                logger.warning("خطا در بارگذاری نشان لوگو روی جلد", exc_info=True)

    if not emblem_drawn:
        # فالبک برداری دایره‌ای زیبا
        cx, cy = PAGE_W / 2, emblem_y + 19 * mm
        c.setFillColor(NAVY)
        c.circle(cx, cy, 18 * mm, fill=1, stroke=0)
        c.setFillColor(CYAN_NEON)
        c.circle(cx, cy, 15 * mm, fill=1, stroke=0)
        c.setFillColor(WHITE)
        c.setFont(BOLD, 14)
        c.drawCentredString(cx, cy - 4, rtl("هامزیار"))

    # عنوان اصلی جزوه
    y = emblem_y - 12 * mm
    c.setFont(BOLD, 20)
    c.setFillColor(NAVY)
    c.drawCentredString(PAGE_W / 2, y, rtl("جزوهٔ جامع کلاسی و بالینی"))

    y -= 6.5 * mm
    c.setFont(MEDIUM, 11)
    c.setFillColor(CYAN_DARK)
    c.drawCentredString(PAGE_W / 2, y, rtl("سامانه آموزش یکپارچه پزشکی و یادگیری بالینی هامزیار"))

    # کارت مشخصات جلسه (Metadata Box)
    y -= 10 * mm
    card_h = 50 * mm
    card_y = y - card_h
    c.setFillColor(CARD_BG_SOFT)
    c.setStrokeColor(CARD_BORDER_SOFT)
    c.setLineWidth(0.8)
    c.roundRect(MARGIN, card_y, CONTENT_W, card_h, 3 * mm, fill=1, stroke=1)

    # هدر کارت مشخصات
    c.setFillColor(NAVY)
    c.roundRect(MARGIN, card_y + card_h - 8 * mm, CONTENT_W, 8 * mm, 2 * mm, fill=1, stroke=0)
    c.rect(MARGIN, card_y + card_h - 8 * mm, CONTENT_W, 3 * mm, fill=1, stroke=0)
    c.setFillColor(WHITE)
    c.setFont(BOLD, 9.5)
    c.drawRightString(PAGE_W - MARGIN - 4 * mm, card_y + card_h - 5.5 * mm, rtl("📋 شناسنامه و مشخصات جلسه درسی"))

    dur_str = format_duration(digest.get('duration'))
    # آیتم‌های جدول مشخصات
    fields = [
        ("عنوان جلسه:", digest.get('title') or 'مبحث کلاسی'),
        ("دپارتمان / درس:", digest.get('subject') or 'علوم بالینی و پایه'),
        ("استاد مدرس:", digest.get('professor') or 'هیات علمی دپارتمان'),
        ("مدت زمان جلسه:", dur_str),
        ("جلسه و تاریخ:", f"{digest.get('session') or 'جلسه کلاسی'} — {fa_digits(digest.get('date') or '۱۴۰۵')}"),
        ("منبع تدوین:", "تطبیق همزمان ویس جلسه با اسلایدهای درسی توسط دستیار هوشیار"),
    ]

    row_y = card_y + card_h - 13.5 * mm
    for label, val in fields:
        c.setFont(BOLD, 8.5)
        c.setFillColor(TEXT_MUTED)
        c.drawRightString(PAGE_W - MARGIN - 6 * mm, row_y, rtl(label))

        c.setFont(MEDIUM, 8.5)
        c.setFillColor(TEXT_PRIMARY)
        clean_val = str(val).strip()
        if len(clean_val) > 65:
            clean_val = clean_val[:62] + "..."
        c.drawRightString(PAGE_W - MARGIN - 38 * mm, row_y, rtl(clean_val))
        row_y -= 6.0 * mm

    # بخش چکیده اجرایی (Executive Summary) در صورت وجود
    summary = digest.get('executive_summary', '').strip()
    if summary:
        y = card_y - 8 * mm
        c.setFont(BOLD, 12)
        c.setFillColor(NAVY)
        c.drawRightString(PAGE_W - MARGIN, y, rtl("🎯 اهداف آموزشی و خلاصهٔ اجرایی جلسه"))

        y -= 4 * mm
        sum_lines = wrap_rtl(summary, REGULAR, 9, CONTENT_W - 12 * mm)
        sum_box_h = max(26 * mm, len(sum_lines) * 4.8 * mm + 8 * mm)
        sum_box_y = y - sum_box_h

        c.setFillColor(PEARL_BG)
        c.setStrokeColor(PEARL_BORDER)
        c.setLineWidth(0.8)
        c.roundRect(MARGIN, sum_box_y, CONTENT_W, sum_box_h, 3 * mm, fill=1, stroke=1)

        # نوار اکسنت فیروزه‌ای سمت راست
        c.setFillColor(CYAN_DARK)
        c.roundRect(PAGE_W - MARGIN - 3 * mm, sum_box_y, 3 * mm, sum_box_h, 1.5 * mm, fill=1, stroke=0)

        # رسم خطوط خلاصه
        text_y = sum_box_y + sum_box_h - 6 * mm
        c.setFont(REGULAR, 9)
        c.setFillColor(TEXT_PRIMARY)
        for line in sum_lines[:8]:
            c.drawRightString(PAGE_W - MARGIN - 7 * mm, text_y, line)
            text_y -= 4.8 * mm

    # فوتر صفحه جلد
    c.setStrokeColor(CARD_BORDER_SOFT)
    c.setLineWidth(0.6)
    c.line(MARGIN, FOOTER_Y + 5 * mm, PAGE_W - MARGIN, FOOTER_Y + 5 * mm)

    c.setFont(REGULAR, 8)
    c.setFillColor(TEXT_MUTED)
    c.drawCentredString(
        PAGE_W / 2,
        FOOTER_Y,
        rtl(f"تولید شده توسط ربات تلگرام هامزیار (@humsyarbot)  •  نسخه وب: humsyar.ir")
    )
    c.showPage()


def _draw_section_banner(c, y: float, title: str, icon: str, bg_color, text_color) -> float:
    """بنر عنوان بخش‌های اصلی"""
    banner_h = 8.5 * mm
    by = y - banner_h
    c.setFillColor(bg_color)
    c.roundRect(MARGIN, by, CONTENT_W, banner_h, 2.5 * mm, fill=1, stroke=0)

    c.setFont(BOLD, 11)
    c.setFillColor(text_color)
    c.drawRightString(PAGE_W - MARGIN - 4 * mm, by + 2.5 * mm, rtl(f"{icon}  {title}"))
    return by - 4 * mm


def _draw_callout_box(c, y: float, title: str, text: str, is_exam_trap: bool = False) -> float:
    """ترسیم کادر مروارید بالینی یا دام تستی پره‌انترنی"""
    bg_col = TRAP_BG if is_exam_trap else PEARL_BG
    border_col = TRAP_BORDER if is_exam_trap else PEARL_BORDER
    accent_col = TRAP_ACCENT if is_exam_trap else PEARL_ACCENT
    icon = "🚨" if is_exam_trap else "💎"

    body_w = CONTENT_W - 14 * mm
    text_lines = wrap_rtl(text, REGULAR, 9, body_w)

    box_h = 7 * mm + len(text_lines) * 4.6 * mm + 4 * mm
    by = y - box_h

    # پس‌زمینه و کادر
    c.setFillColor(bg_col)
    c.setStrokeColor(border_col)
    c.setLineWidth(0.8)
    c.roundRect(MARGIN, by, CONTENT_W, box_h, 2.5 * mm, fill=1, stroke=1)

    # خط حاشیه عمودی راست (اکسنت)
    c.setFillColor(accent_col)
    c.roundRect(PAGE_W - MARGIN - 3.5 * mm, by, 3.5 * mm, box_h, 1.5 * mm, fill=1, stroke=0)

    # تیتر کادر
    c.setFont(BOLD, 9.5)
    c.setFillColor(accent_col)
    c.drawRightString(PAGE_W - MARGIN - 7 * mm, by + box_h - 5.5 * mm, rtl(f"{icon} {title}"))

    # متن داخل کادر
    ty = by + box_h - 10 * mm
    c.setFont(REGULAR, 9)
    c.setFillColor(TEXT_PRIMARY)
    for line in text_lines:
        c.drawRightString(PAGE_W - MARGIN - 7 * mm, ty, line)
        ty -= 4.6 * mm

    return by - 3.5 * mm


def _draw_table(c, y: float, table_data: dict, subject: str, title: str) -> float:
    """ترسیم جدول مقایسه‌ای پویا با سطرهای خودتنظیم‌شونده و جلوگیری از همپوشانی ستون‌ها"""
    headers = table_data.get('headers') or []
    rows = table_data.get('rows') or []
    tbl_title = table_data.get('title') or 'جدول مقایسه‌ای و جمع‌بندی نکات'
    if not headers or not rows:
        return y

    num_cols = len(headers)
    col_w = CONTENT_W / num_cols
    # انتخاب اندازه فونت بر اساس تعداد ستون‌ها
    fs = 7.5 if num_cols >= 5 else 8.0
    line_h = 3.5 * mm if num_cols >= 5 else 3.8 * mm
    pad_x = 2.5 * mm
    pad_y = 3.5 * mm
    min_row_h = 8.5 * mm

    # ۱. آماده‌سازی و محاسبه ارتفاع هدر جدول
    header_cell_lines = []
    for h in headers:
        hl = wrap_rtl(str(h), BOLD, 8.5, col_w - 4 * mm)
        header_cell_lines.append(hl if hl else [rtl(str(h))])
    max_hdr_lines = max((len(hl) for hl in header_cell_lines), default=1)
    header_h = max(9.0 * mm, max_hdr_lines * line_h + pad_y)

    def _draw_tbl_header(cur_y: float) -> float:
        """رسم هدر جدول (با امکان تکرار در صورت شکست صفحه)"""
        c.setFillColor(TABLE_HEAD_BG)
        c.roundRect(MARGIN, cur_y - header_h, CONTENT_W, header_h, 2 * mm, fill=1, stroke=0)
        c.setFont(BOLD, 8.5)
        c.setFillColor(WHITE)
        hdr_start_y = cur_y - 2.0 * mm - 2.5 * mm
        for i, hlines in enumerate(header_cell_lines):
            cell_center_x = PAGE_W - MARGIN - (i * col_w) - (col_w / 2)
            cur_hy = hdr_start_y
            for hline in hlines:
                c.drawCentredString(cell_center_x, cur_hy, hline)
                cur_hy -= line_h
        return cur_y - header_h

    # ۲. پیش‌پردازش و رپینگ متن تمام سلول‌ها جهت محاسبه دقیق ارتفاع هر سطر
    wrapped_rows = []
    for r_idx, row in enumerate(rows):
        row_cell_lines = []
        raw_vals = []
        for i in range(num_cols):
            val = str(row[i]).strip() if i < len(row) else ''
            raw_vals.append(val)
            wlines = wrap_rtl(val, REGULAR, fs, col_w - 2 * pad_x)
            row_cell_lines.append(wlines if wlines else [''])
        max_lines = max((len(cl) for cl in row_cell_lines), default=1)
        row_h = max(min_row_h, max_lines * line_h + pad_y)
        wrapped_rows.append((row_cell_lines, raw_vals, row_h))

    # ۳. بررسی شکست صفحه قبل از شروع رسم جدول (تیتر + هدر + حداقل یک سطر داده)
    first_row_h = wrapped_rows[0][2] if wrapped_rows else min_row_h
    tbl_title_h = 6.0 * mm
    if y - (tbl_title_h + header_h + first_row_h) < MIN_Y and len(rows) > 0:
        c.showPage()
        _draw_content_header(c, subject, title)
        _draw_watermark(c)
        y = PAGE_H - _TOP_BAR_H - 18 * mm

    # رسم تیتر جدول
    c.setFont(BOLD, 10.5)
    c.setFillColor(NAVY)
    c.drawRightString(PAGE_W - MARGIN, y, rtl(f"📊 {tbl_title}"))
    y -= 5 * mm

    # رسم هدر اولیه جدول
    y = _draw_tbl_header(y)

    # ۴. رسم سطرهای داده با کنترل هوشمند شکست صفحه
    for r_idx, (row_cell_lines, raw_vals, row_h) in enumerate(wrapped_rows):
        if y - row_h < MIN_Y:
            c.showPage()
            _draw_content_header(c, subject, title)
            _draw_watermark(c)
            y = PAGE_H - _TOP_BAR_H - 18 * mm
            # تکرار هدر جدول در بالای صفحه جدید
            y = _draw_tbl_header(y)

        # پس‌زمینه راه‌راه متناوب
        bg = TABLE_ZEBRA_BG if r_idx % 2 == 1 else WHITE
        c.setFillColor(bg)
        c.setStrokeColor(CARD_BORDER_SOFT)
        c.setLineWidth(0.5)
        c.rect(MARGIN, y - row_h, CONTENT_W, row_h, fill=1, stroke=1)

        # ترسیم خطوط عمودی جداکننده ستون‌ها
        for ci in range(1, num_cols):
            cx = PAGE_W - MARGIN - (ci * col_w)
            c.line(cx, y, cx, y - row_h)

        # رسم متن داخل سلول‌ها
        c.setFont(REGULAR, fs)
        c.setFillColor(TEXT_PRIMARY)
        start_y = y - 2.0 * mm - 2.4 * mm
        for i, clines in enumerate(row_cell_lines):
            cell_right_x = PAGE_W - MARGIN - (i * col_w)
            cell_center_x = cell_right_x - (col_w / 2)
            raw_v = raw_vals[i]
            cur_line_y = start_y
            for line in clines:
                # اگر سلول تک‌خطی و کوتاه است، در مرکز ستون رسم شود
                if len(clines) == 1 and text_width(raw_v, REGULAR, fs) < (col_w * 0.65):
                    c.drawCentredString(cell_center_x, cur_line_y, line)
                else:
                    # برای متن‌های بلند یا چندخطی، راست‌چین با حاشیه مناسب
                    c.drawRightString(cell_right_x - pad_x, cur_line_y, line)
                cur_line_y -= line_h

        y -= row_h

    return y - 4 * mm


def generate_lecture_pdf(digest: dict) -> io.BytesIO:
    """
    تولید فایل PDF کامل جزوه بر اساس ساختار خروجی هوش مصنوعی.
    خروجی: بافر io.BytesIO حاوی بایت‌های PDF.
    """
    ensure_fonts()
    buf = io.BytesIO()
    c = NumberedCanvas(buf, pagesize=A4)

    subject = digest.get('subject') or 'علوم پزشکی'
    title = digest.get('title') or 'جزوه کلاسی'

    # ۱. رسم صفحه جلد
    _draw_cover(c, digest)

    # ۲. شروع صفحات محتوا
    _draw_content_header(c, subject, title)
    _draw_watermark(c)
    y = PAGE_H - _TOP_BAR_H - 18 * mm

    def check_page_break(needed_h: float):
        nonlocal y
        if y - needed_h < MIN_Y:
            c.showPage()
            _draw_content_header(c, subject, title)
            _draw_watermark(c)
            y = PAGE_H - _TOP_BAR_H - 18 * mm

    # بخش اول: سرفصل‌ها و توضیحات تفصیلی (Topics)
    topics = digest.get('topics') or digest.get('key_topics') or []
    if topics:
        check_page_break(14 * mm)
        y = _draw_section_banner(c, y, "سرفصل‌ها و مباحث تدریس‌شده", "📌", NAVY, WHITE)

        for idx, t in enumerate(topics, 1):
            t_title = t.get('title') or t.get('topic_title') or f"مبحث {idx}"
            t_content = t.get('content') or ''
            t_pearl = t.get('clinical_points') or ''

            lines = wrap_rtl(t_content, REGULAR, 9, CONTENT_W - 8 * mm)
            needed_h = 8 * mm + len(lines) * 4.6 * mm + (12 * mm if t_pearl else 4 * mm)

            check_page_break(min(needed_h, 30 * mm))

            # تیتر موضوع با بج شماره
            badge_r = 3.2 * mm
            bx, by = PAGE_W - MARGIN - badge_r, y - badge_r
            c.setFillColor(CYAN_DARK)
            c.circle(bx, by, badge_r, fill=1, stroke=0)
            c.setFillColor(WHITE)
            c.setFont(BOLD, 8.5)
            c.drawCentredString(bx, by - 2.8, fa_digits(idx))

            c.setFont(BOLD, 10.5)
            c.setFillColor(NAVY)
            c.drawRightString(PAGE_W - MARGIN - 9 * mm, y - 2 * mm, rtl(t_title))
            y -= 7 * mm

            # متن پاراگراف
            c.setFont(REGULAR, 9)
            c.setFillColor(TEXT_PRIMARY)
            for line in lines:
                if y - 5 * mm < MIN_Y:
                    c.showPage()
                    _draw_content_header(c, subject, title)
                    _draw_watermark(c)
                    y = PAGE_H - _TOP_BAR_H - 18 * mm
                c.drawRightString(PAGE_W - MARGIN - 4 * mm, y, line)
                y -= 4.6 * mm

            # نکته بالینی ذیل مبحث در صورت وجود
            if t_pearl:
                y -= 2 * mm
                p_lines = wrap_rtl(t_pearl, REGULAR, 8.5, CONTENT_W - 14 * mm)
                p_box_h = len(p_lines) * 4.4 * mm + 5 * mm
                if y - p_box_h < MIN_Y:
                    c.showPage()
                    _draw_content_header(c, subject, title)
                    _draw_watermark(c)
                    y = PAGE_H - _TOP_BAR_H - 18 * mm

                p_by = y - p_box_h
                c.setFillColor(PEARL_BG)
                c.setStrokeColor(PEARL_BORDER)
                c.setLineWidth(0.6)
                c.roundRect(MARGIN + 2 * mm, p_by, CONTENT_W - 4 * mm, p_box_h, 2 * mm, fill=1, stroke=1)
                c.setFillColor(CYAN_DARK)
                c.rect(PAGE_W - MARGIN - 4 * mm, p_by, 2 * mm, p_box_h, fill=1, stroke=0)

                c.setFont(BOLD, 8)
                c.setFillColor(CYAN_DARK)
                c.drawRightString(PAGE_W - MARGIN - 8 * mm, p_by + p_box_h - 4 * mm, rtl("💡 نکته بالینی:"))
                py_text = p_by + p_box_h - 4 * mm
                c.setFont(REGULAR, 8)
                c.setFillColor(TEXT_PRIMARY)
                for pl in p_lines:
                    c.drawRightString(PAGE_W - MARGIN - 26 * mm, py_text, pl)
                    py_text -= 4.4 * mm
                y = p_by - 3 * mm

            y -= 3 * mm

    # بخش دوم: مرواریدهای بالینی (Clinical Pearls)
    clinical_pearls = digest.get('clinical_pearls') or []
    if clinical_pearls:
        check_page_break(25 * mm)
        y = _draw_section_banner(c, y, "مرواریدهای بالینی و نکات تجربی استاد", "💎", TEAL_DEEP, WHITE)

        for i, pearl in enumerate(clinical_pearls, 1):
            pearl_lines = wrap_rtl(pearl, REGULAR, 9, CONTENT_W - 14 * mm)
            box_h = 11 * mm + max(1, len(pearl_lines)) * 4.6 * mm
            check_page_break(box_h + 3.5 * mm)
            y = _draw_callout_box(
                c, y,
                title=f"مروارید بالینی {fa_digits(i)}",
                text=pearl,
                is_exam_trap=False
            )

    # بخش سوم: دام‌های تستی پره‌انترنی و دستیاری (Exam Traps)
    exam_traps = digest.get('exam_traps') or []
    if exam_traps:
        check_page_break(25 * mm)
        y = _draw_section_banner(c, y, "دام‌های تستی آزمون‌های پره‌انترنی و پذیرش دستیاری", "🚨", TRAP_ACCENT, WHITE)

        for i, trap in enumerate(exam_traps, 1):
            trap_lines = wrap_rtl(trap, REGULAR, 9, CONTENT_W - 14 * mm)
            box_h = 11 * mm + max(1, len(trap_lines)) * 4.6 * mm
            check_page_break(box_h + 3.5 * mm)
            y = _draw_callout_box(
                c, y,
                title=f"نکته دامی آزمون {fa_digits(i)}",
                text=trap,
                is_exam_trap=True
            )

    # بخش چهارم: جدول مقایسه‌ای (Comparison Table)
    comp_tbl = digest.get('comparison_table')
    if comp_tbl and isinstance(comp_tbl, dict) and comp_tbl.get('headers'):
        check_page_break(30 * mm)
        y = _draw_table(c, y, comp_tbl, subject, title)

    # بخش پنجم: پرسش و پاسخ‌های کلیدی مرور سریع (Q&A)
    qna_list = digest.get('qna_list') or []
    if qna_list:
        check_page_break(25 * mm)
        y = _draw_section_banner(c, y, "پرسش‌های کلیدی و جمع‌بندی مبحث", "❓", NAVY_LIGHT, WHITE)

        for i, qa in enumerate(qna_list, 1):
            q_text = qa.get('question') or ''
            a_text = qa.get('answer') or ''
            if not q_text:
                continue

            q_lines = wrap_rtl(q_text, BOLD, 9, CONTENT_W - 14 * mm)
            a_lines = wrap_rtl(a_text, REGULAR, 8.5, CONTENT_W - 14 * mm)
            card_h = 8 * mm + len(q_lines) * 4.6 * mm + 3 * mm + len(a_lines) * 4.4 * mm + 4 * mm

            check_page_break(card_h + 4 * mm)
            by = y - card_h

            c.setFillColor(CARD_BG_SOFT)
            c.setStrokeColor(CARD_BORDER_SOFT)
            c.setLineWidth(0.7)
            c.roundRect(MARGIN, by, CONTENT_W, card_h, 2.5 * mm, fill=1, stroke=1)

            # علامت سوال
            c.setFillColor(NAVY)
            c.circle(PAGE_W - MARGIN - 5 * mm, by + card_h - 5 * mm, 3.2 * mm, fill=1, stroke=0)
            c.setFillColor(WHITE)
            c.setFont(BOLD, 9)
            c.drawCentredString(PAGE_W - MARGIN - 5 * mm, by + card_h - 7.5 * mm, fa_digits(i))

            # متن سوال
            qy = by + card_h - 6 * mm
            c.setFont(BOLD, 9)
            c.setFillColor(NAVY)
            for ql in q_lines:
                c.drawRightString(PAGE_W - MARGIN - 11 * mm, qy, ql)
                qy -= 4.6 * mm

            # خط ظریف بین سوال و پاسخ
            qy -= 1 * mm
            c.setStrokeColor(CARD_BORDER_SOFT)
            c.setLineWidth(0.5)
            c.line(MARGIN + 4 * mm, qy, PAGE_W - MARGIN - 4 * mm, qy)
            qy -= 3 * mm

            # متن پاسخ
            c.setFont(REGULAR, 8.5)
            c.setFillColor(TEXT_PRIMARY)
            for al in a_lines:
                c.drawRightString(PAGE_W - MARGIN - 6 * mm, qy, al)
                qy -= 4.4 * mm

            y = by - 3.5 * mm

    c.showPage()
    c.save()
    buf.seek(0)
    return buf
