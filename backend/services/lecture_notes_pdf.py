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
    card_h = 44 * mm
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

    # آیتم‌های جدول مشخصات
    fields = [
        ("عنوان جلسه:", digest.get('title') or 'مبحث کلاسی'),
        ("دپارتمان / درس:", digest.get('subject') or 'علوم بالینی و پایه'),
        ("استاد مدرس:", digest.get('professor') or 'هیات علمی دپارتمان'),
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
        row_y -= 6.2 * mm

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
    """ترسیم جدول مقایسه‌ای تمیز با سطرهای راه‌راه"""
    headers = table_data.get('headers') or []
    rows = table_data.get('rows') or []
    tbl_title = table_data.get('title') or 'جدول مقایسه‌ای و جمع‌بندی نکات'
    if not headers or not rows:
        return y

    num_cols = len(headers)
    col_w = CONTENT_W / num_cols
    row_h = 8.5 * mm
    header_h = 9 * mm

    # عنوان بالای جدول
    c.setFont(BOLD, 10.5)
    c.setFillColor(NAVY)
    c.drawRightString(PAGE_W - MARGIN, y, rtl(f"📊 {tbl_title}"))
    y -= 4.5 * mm

    # بررسی شکست صفحه قبل از شروع جدول
    total_needed = header_h + len(rows) * row_h
    if y - total_needed < MIN_Y and len(rows) > 1:
        # اگر کل جدول جا نمی‌شود اما حداقل هدر و ۱ سطر جا نمی‌شود، برو صفحه بعد
        if y - (header_h + row_h * 2) < MIN_Y:
            c.showPage()
            _draw_content_header(c, subject, title)
            _draw_watermark(c)
            y = PAGE_H - _TOP_BAR_H - 18 * mm

    # هدر جدول
    c.setFillColor(TABLE_HEAD_BG)
    c.roundRect(MARGIN, y - header_h, CONTENT_W, header_h, 2 * mm, fill=1, stroke=0)

    c.setFont(BOLD, 8.5)
    c.setFillColor(WHITE)
    for i, h in enumerate(headers):
        cell_center_x = PAGE_W - MARGIN - (i * col_w) - (col_w / 2)
        c.drawCentredString(cell_center_x, y - header_h + 3 * mm, rtl(str(h)))

    y -= header_h

    # سطرهای داده
    c.setFont(REGULAR, 8)
    for r_idx, row in enumerate(rows):
        if y - row_h < MIN_Y:
            c.showPage()
            _draw_content_header(c, subject, title)
            _draw_watermark(c)
            y = PAGE_H - _TOP_BAR_H - 18 * mm
            # بازرسم هدر در صفحه جدید
            c.setFillColor(TABLE_HEAD_BG)
            c.roundRect(MARGIN, y - header_h, CONTENT_W, header_h, 2 * mm, fill=1, stroke=0)
            c.setFont(BOLD, 8.5)
            c.setFillColor(WHITE)
            for i, h in enumerate(headers):
                cell_center_x = PAGE_W - MARGIN - (i * col_w) - (col_w / 2)
                c.drawCentredString(cell_center_x, y - header_h + 3 * mm, rtl(str(h)))
            y -= header_h

        # رنگ سطر متناوب
        bg = TABLE_ZEBRA_BG if r_idx % 2 == 1 else WHITE
        c.setFillColor(bg)
        c.setStrokeColor(CARD_BORDER_SOFT)
        c.setLineWidth(0.5)
        c.rect(MARGIN, y - row_h, CONTENT_W, row_h, fill=1, stroke=1)

        c.setFillColor(TEXT_PRIMARY)
        c.setFont(REGULAR, 8)
        for i, val in enumerate(row[:num_cols]):
            cell_center_x = PAGE_W - MARGIN - (i * col_w) - (col_w / 2)
            c.drawCentredString(cell_center_x, y - row_h + 2.8 * mm, rtl(str(val)))

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
            check_page_break(20 * mm)
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
            check_page_break(20 * mm)
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

    c.save()
    buf.seek(0)
    return buf
