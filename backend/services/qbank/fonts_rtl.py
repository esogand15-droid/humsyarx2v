"""
🔤 qbank.fonts_rtl — فونت فارسی + کمک‌کننده‌های راست‌چین (RTL) و بهداشت تایپوگرافی پزشکی

این ماژول تنها مسئولیتش متن است: ثبت فونت Vazirmatn، شکل‌دهی صحیح
حروف فارسی (reshape)، ترتیب‌دهی راست‌به‌چپ (bidi)، و تقسیم متن به خطوط
متناسب با عرض موجود (word-wrap).
"""
import os
import re
import logging

import arabic_reshaper
from bidi.algorithm import get_display
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

logger = logging.getLogger(__name__)

_FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fonts')
_READY = False

# نام فونت‌های ثبت‌شده — بقیه‌ی ماژول‌ها همین ثابت‌ها را import می‌کنند
REGULAR = 'Vazir'
MEDIUM  = 'Vazir-Medium'
BOLD    = 'Vazir-Bold'

LRM = '\u200e'  # Left-to-Right Mark


def ensure_fonts():
    """ثبت فونت‌ها در reportlab — idempotent (فقط بار اول واقعاً کاری می‌کند)"""
    global _READY
    if _READY:
        return
    try:
        pdfmetrics.registerFont(TTFont(REGULAR, os.path.join(_FONT_DIR, 'Vazirmatn-Regular.ttf')))
        pdfmetrics.registerFont(TTFont(MEDIUM,  os.path.join(_FONT_DIR, 'Vazirmatn-Medium.ttf')))
        pdfmetrics.registerFont(TTFont(BOLD,    os.path.join(_FONT_DIR, 'Vazirmatn-Bold.ttf')))
        _READY = True
    except Exception:
        logger.exception("qbank.fonts_rtl: خطا در بارگذاری فونت Vazirmatn")
        raise


_FA_DIGITS = str.maketrans('0123456789', '۰۱۲۳۴۵۶۷۸۹')


def fa_digits(value) -> str:
    """تبدیل اعداد لاتین به فارسی — 12 → ۱۲"""
    return str(value).translate(_FA_DIGITS)


def _reshape(text: str) -> str:
    """اتصال صحیح حروف فارسی به هم (شکل ابتدایی/میانی/پایانی/جدا)"""
    return arabic_reshaper.reshape(text or '')


def sanitize_bidi_medical(text: str) -> str:
    """
    ایزوله‌سازی عبارات پزشکی، دوزها، واحدها و عبارات داخل پرانتز لاتین
    با نشانگرهای جهت چپ‌به‌راست (LRM: \\u200e) جهت جلوگیری از وارونگی در UBA.
    """
    if not text:
        return ''

    # ۱. پرانتزهای حاوی فرمول‌های پزشکی و دوزهای لاتین بدون نویسه‌های فارسی
    # e.g. (500 mg q12h), (1-2 g IV), (10-20 mg/kg), (Ceftriaxone 1g IV daily), (BP: 140/90 mmHg), (p < 0.05)
    def repl_latin_paren(m):
        inner = m.group(1).strip()
        return f'({LRM}{inner}{LRM})'

    text = re.sub(r'\(([^()\u0600-\u06FF]*[A-Za-z0-9][^()\u0600-\u06FF]*)\)', repl_latin_paren, text)

    # ۲. دوزها، بازه‌ها و واحدهای لاتین مستقل یا درون متن فارسی
    # فاصله‌های قبل و بعد حتماً خارج از LRM حفظ می‌شوند
    dosage_pat = re.compile(
        r'(?<![A-Za-z0-9_\u200e])'
        r'('
          r'[<>=≤≥±~]?\s*'
          r'\d+(?:[./:-]\d+)*'
          r'\s*'
          r'[A-Za-z/%][A-Za-z0-9/%-]*'
          r'(?:\s+[A-Za-z0-9/%-]+)*'
        r')'
        r'(?![A-Za-z0-9_\u200e])',
        re.IGNORECASE
    )

    parts = text.split(LRM)
    for i in range(0, len(parts), 2):
        def repl_dosage(m):
            raw = m.group(1)
            l_space = raw[:len(raw) - len(raw.lstrip())]
            r_space = raw[len(raw.rstrip()):]
            core = raw.strip()
            return f'{l_space}{LRM}{core}{LRM}{r_space}'

        parts[i] = dosage_pat.sub(repl_dosage, parts[i])

    return LRM.join(parts)


def rtl(text: str, base_dir: str = 'R') -> str:
    """آماده‌سازی یک تکه متنِ تک‌خطی برای drawString با جهت درست و ایزوله‌سازی عبارات پزشکی"""
    if not text:
        return ''
    sanitized = sanitize_bidi_medical(text)
    reshaped = _reshape(sanitized)
    return get_display(reshaped, base_dir=base_dir)


def text_width(text: str, font: str, size: float) -> float:
    """عرض واقعی متنِ شکل‌دهی‌شده — LRM دارای عرض صفر در فونت وزیر است"""
    return pdfmetrics.stringWidth(_reshape(sanitize_bidi_medical(text or '')), font, size)


def wrap_rtl(text: str, font: str, size: float, max_width: float, base_dir: str = 'R') -> list[str]:
    """
    Word-wrap متن فارسی متناسب با عرض:
    - تفکیک پاراگراف‌ها با \\n جهت جلوگیری از انباشت خطوط در ReportLab
    - محافظت از عبارات دوز و پرانتزهای لاتین در برابر شکست بین سطور
    - اعمال reshape و get_display با base_dir='R' روی تک‌تک خطوط کامل
    """
    text = (text or '').strip()
    if not text:
        return []

    sanitized = sanitize_bidi_medical(text)
    paragraphs = sanitized.splitlines()
    result_lines = []

    # الگوی توکن‌های اتمی: پرانتزهای لاتین، پرانتزهای کوتاه فارسی، بلاک‌های LRM، یا کلمات عادی
    token_pat = re.compile(
        rf'\([^()\u0600-\u06FF]+\)'
        rf'|\([^()]{{1,40}}\)'
        rf'|{LRM}[^{LRM}]+{LRM}'
        rf'|\S+'
    )

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue

        raw_tokens = token_pat.findall(para)
        tokens = list(raw_tokens)
        cur = []

        idx = 0
        while idx < len(tokens):
            tok = tokens[idx]
            trial = cur + [tok]
            w = pdfmetrics.stringWidth(_reshape(' '.join(trial)), font, size)
            if w <= max_width:
                cur = trial
                idx += 1
            elif not cur:
                # اگر تک‌توکن از عرض سطر بیشتر بود، در صورت داشتن فاصله آن را می‌شکند
                sub_words = tok.split(' ')
                if len(sub_words) > 1:
                    tokens[idx:idx+1] = sub_words
                    continue
                else:
                    result_lines.append(tok)
                    idx += 1
            else:
                result_lines.append(' '.join(cur))
                cur = []

        if cur:
            result_lines.append(' '.join(cur))

    return [get_display(_reshape(l), base_dir=base_dir) for l in result_lines]

