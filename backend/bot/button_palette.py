# -*- coding: utf-8 -*-
"""🎨 HumsYar — جدول مرکزی رنگ دکمه‌ها (Button palette, single source of truth)

Pure data + a tiny pure lookup. No telegram / env imports. The same ACTION
gets the same colour on every screen.

Telegram styles: ``primary`` (blue), ``success`` (green), ``danger`` (red);
anything not in these tables = ``None`` = default client colour.

PALETTE — one rule for every button (user request 2026-11-25: «همهٔ دکمه‌ها
رنگی و مرتب، با یک منطق مشخص؛ دکمهٔ بازگشت قرمز»)
-----------------------------------------------------------------------------
* primary (blue)  — "go / open": every entry, menu item, list item (terms,
                    lessons, sessions, books, FAQ, users …), page navigation,
                    toggles, external links. This is the DEFAULT for any button
                    that matches nothing else.
* success (green) — money + final positive commitments (plans/buy/pay/"I paid",
                    donation, confirm/submit/send/save/approve/renew) and the
                    selected / current item of a list (label starts with ✅).
* danger  (red)   — EXIT: back / home / cancel / «نه» / «بی‌خیال» / close (by
                    label, or by a cancel callback) — and DESTRUCTIVE: delete /
                    remove / block / reject / purge / cancel subscription (by the
                    callback tables). Also the staff-area entries
                    («👨‍⚕️ پنل ادمین», «🎓 پنل محتوا», «🎓 رفتن به پنل محتوا»).
* none            — ONLY quiz answer options (``NEVER_PREFIX``): every option of
                    a question looks identical, so a colour can never hint the
                    answer.

ROW RULE (``palette_row_styles``): when a row holds a DESTRUCTIVE button next
to an EXIT button («🗑 بله، حذف کن» | «🔙 انصراف»), the exit one turns blue so
the two are never the same red side by side.

LOOKUP ORDER (``palette_role``)
-------------------------------
1. quiz answers (``NEVER_PREFIX``) → none.
2. reply keyboards → ``REPLY_LABEL_STYLES``; else exit label → red; else blue.
3. url / web_app buttons → ``URL_LABEL_STYLES``; else exit label → red; else blue.
4. ``INLINE_PAIR_STYLES`` — (label, callback) for callbacks shared between an
   action and a back button (``sub:back``, ``quiz:main``, ``ca:main``,
   ``admin:main``).
5. ``CALLBACK_EXACT`` / longest ``CALLBACK_PREFIX`` = danger → destructive red.
6. exit label (``is_exit_text``) or exit callback → red. The label wins over a
   non-danger callback, so «↩️ بازگشت» sharing ``ring:p:done`` with «💾 ذخیره»
   is red while «💾 ذخیره» stays green.
7. any other table hit (primary / success).
8. label starts with 🗑 / 🚫 / ⛔ / 🛑 / ⏹ / ⏸ → red; ✅ / ☑ / ✔ → green;
   otherwise → blue.

Styling never changes text/callback_data (ring ``CONTROL_LABELS`` stay intact).
Labels are byte-exact copies of the source (ZWNJ ``\\u200c`` / ZWJ ``\\u200d``
written as escapes on purpose).
"""
from __future__ import annotations

import re
from typing import Optional

PRIMARY, SUCCESS, DANGER = "primary", "success", "danger"
VALID_STYLES = frozenset({PRIMARY, SUCCESS, DANGER})

_ZWNJ = "\u200c"
_ADMIN_PANEL = "\U0001F468\u200d\u2695\ufe0f پنل ادمین"   # 👨‍⚕️ (contains ZWJ)
_CONTENT_PANEL = "🎓 پنل محتوا"
_GO_CONTENT_PANEL = "🎓 رفتن به پنل محتوا"

# ══════════════════════════════════════════════════════════════
#  1) Reply main menus — backend/bot/utils.py
#     main_keyboard / content_admin_keyboard / admin_keyboard /
#     sub_admin_keyboard / ring_aware_keyboard (all variants share labels)
# ══════════════════════════════════════════════════════════════
REPLY_LABEL_STYLES: dict[str, str] = {
    # یادگیری — آبی
    "🩺 داشبورد": PRIMARY,
    "📚 منابع": PRIMARY,
    "🧪 بانک سوال": PRIMARY,
    "🤖 هوشیار": PRIMARY,
    # پول — سبز
    "💎 اشتراک ویژه": SUCCESS,
    "💙 حمایت مالی": SUCCESS,
    # ناحیهٔ محدود (کادر) — قرمز
    _ADMIN_PANEL: DANGER,
    _CONTENT_PANEL: DANGER,
    # ابزارهای دانشجو / حساب / پشتیبانی / رینگ — آبی (باز کردن یک بخش)
    "❓ سوالات متداول": PRIMARY,
    "📅 برنامه": PRIMARY,
    "👤 پروفایل": PRIMARY,
    "🔔 اعلان" + _ZWNJ + "ها": PRIMARY,
    "📊 کارنامه و معدل": PRIMARY,
    "🎫 پشتیبانی": PRIMARY,
    "💍 رینگ استریت": PRIMARY,
}

# Kept for backwards compatibility — every main-menu label is coloured now.
EXPLICIT_NONE_REPLY_LABELS: frozenset[str] = frozenset()

# ══════════════════════════════════════════════════════════════
#  2) Inline url / web_app buttons — matched by exact label
#     (only payment / donation links are coloured)
# ══════════════════════════════════════════════════════════════
URL_LABEL_STYLES: dict[str, str] = {
    "💙 حمایت مالی": SUCCESS,                              # dashboard.py donation url
    "💙 پرداخت حمایت مالی آنلاین": SUCCESS,                  # message_router.py donation url
    "💳 پرداخت در زرین" + _ZWNJ + "پال": SUCCESS,          # subscription.py Zarinpal url
    "🎟 دریافت اشتراک با تخفیف": SUCCESS,                   # subscription_admin.py campaign web_app
}

# ══════════════════════════════════════════════════════════════
#  3) (label, callback) pairs — callbacks shared with back buttons
# ══════════════════════════════════════════════════════════════
INLINE_PAIR_STYLES: dict[tuple[str, str], str] = {
    # subscription — `sub:back` is also «🔙 بازگشت به پلن‌ها» / «🔙 انصراف»
    ("💳 خرید اشتراک", "sub:back"): PRIMARY,        # buy entry (lead: primary)
    ("🔄 تمدید کن", "sub:back"): SUCCESS,           # renew (bot.py expiry job + my_status)
    ("🔄 تمدید زودتر", "sub:back"): SUCCESS,        # renew early
    # Hooshyar hub — `quiz:main` is also «↩️ بازگشت» / «📚 آزمون‌ساز»
    ("📚 آزمون" + _ZWNJ + "ساز از PDF", "quiz:main"): PRIMARY,
    # staff entries — `ca:main` / `admin:main` are also back/cancel targets
    (_GO_CONTENT_PANEL, "ca:main"): DANGER,         # admin.py content_admin / scoped menu
    (_ADMIN_PANEL, "admin:main"): DANGER,           # dashboard.py owner row
}

# ══════════════════════════════════════════════════════════════
#  4) Exact callback_data → style
# ══════════════════════════════════════════════════════════════
CALLBACK_EXACT: dict[str, str] = {
    # ── dashboard / questions hub (questions.py, dashboard.py, stats.py) ──
    "questions:weak": PRIMARY,            # 🧪 تمرین هوشمند / ⚡ نقاط ضعف من / ⚡ تمرین نقاط ضعف
    "questions:practice": PRIMARY,        # 📖 تمرین آزاد
    "questions:custom_exam": PRIMARY,     # 🎯 آزمون سفارشی / 📜 آزمون جدید
    "questions:free": PRIMARY,            # 📖 شروع تمرین آزاد
    "questions:ai_fallback": PRIMARY,     # 🤖 ساخت سؤال شخصی
    "questions:cx_confirm": SUCCESS,      # ✅ تأیید و ساخت آزمون
    "questions:cx_confirm_smaller": SUCCESS,
    "questions:submit_question": SUCCESS,  # ✅ ارسال برای بررسی
    "questions:dup_confirm": SUCCESS,     # ✅ ثبت با وجود شباهت
    "questions:exam_abandon": DANGER,     # ⏹ رها کردن آزمون (ends the exam)
    "questions:create_ca": PRIMARY,       # content panel: ✏️ شروع طراحی سوال

    # ── Hooshyar (ai_solver.py) + lecture scribe (bot.py / lecture_scribe.py) ──
    "ls:intro": PRIMARY,                  # 🎙 جزوه‌نویس چندرسانه‌ای
    "aiu:imgstart": PRIMARY,              # 🎨 ساخت تصویر
    "aiu:fu:example": PRIMARY,            # 🔬 مثال بزن
    "aiu:ask_now": PRIMARY,               # message_router: 🤖 پاسخ بالینی با هوشیار
    "ls:smart_scribe": PRIMARY,           # 📄 تدوین جزوه کامل PDF (the ONE blue choice;
                                          # «🤖 تحلیل صوتی» = secondary → default)

    # ── profile ──
    "profile:edit_name": PRIMARY,
    "profile:clear_nick": DANGER,         # 🗑 حذف لقب

    # ── subscription (user) ──
    "sub:trial": PRIMARY,                 # 🎁 شروع … روز آزمایشی رایگان
    "sub:gift": SUCCESS,                  # 🎁 خرید اشتراک هدیه
    "sub:topup": SUCCESS,                 # 💰 شارژ کیف پول
    "sub:famcode": PRIMARY,               # ➕ ساخت کد دعوت جدید (family plan)
    "sub:famredeem": SUCCESS,             # 🎟 ثبت کد دعوت خانواده

    # ── ticket ──
    "ticket:new": PRIMARY,                # 🎫 ارسال تیکت جدید / 🎫 تیکت جدید / 💡 بازخورد
    "ticket:preview_confirm": SUCCESS,    # ✅ بله، ارسال کن

    # ── schedule (admin) ──
    "schedule:confirm_add": SUCCESS,      # ✅ تأیید و انتشار
    "schedule:cs_save": SUCCESS,          # 💾 ذخیره و مشاهده برنامه کلاسی من
    "schedule:scan_confirm": SUCCESS,
    "schedule:scan_exam_confirm": SUCCESS,
    "schedule:scan_portal_publish": SUCCESS,
    "schedule:template_generate": SUCCESS,  # ⚙️ تولید برای ۴ هفته آینده
    "schedule:template_clear": DANGER,    # 🗑 پاکسازی الگوها
    "schedule:del_list": DANGER,          # 🗑 حذف برنامه (entry)

    # ── grades ──
    "grades:confirm": SUCCESS,            # ✅ تأیید و ثبت N نفر

    # ── start / registration / channel lock ──
    "register:start": PRIMARY,            # ✅ شروع ثبت‌نام
    "channel_lock:check": SUCCESS,        # ✅ عضو شدم، بررسی کن

    # ── admin main panel (admin.py) ──
    "admin:bc_confirm": SUCCESS,          # ✅ بله، ارسال کن (broadcast)
    "admin:bc_sched_confirm": SUCCESS,
    "admin:bc_ai_use": SUCCESS,           # ✅ استفاده از این متن
    "admin:poll_confirm": SUCCESS,
    "admin:poll_create": PRIMARY,         # 📊 ساخت نظرسنجی جدید
    "admin:remove_donation_link": DANGER,  # 🗑 حذف لینک

    # ── content panel (content_admin.py) ──
    "ca:confirm_filename": SUCCESS,       # ✅ تایید

    # ── ai_admin.py ──
    "ai:save_persona": SUCCESS,
    "ai:ban_search": DANGER,              # ⛔ مسدودکردن کاربر (entry)

    # ── backup (services/backup.py) — restore overwrites data ──
    "backup:confirm_restore": DANGER,

    # ── ring keyboards (services/ring/keyboards.py, CB = "ring:") ──
    "ring:go": PRIMARY,                   # 🔎 پیدا کردن نفر / جست‌وجوی دوباره
    "ring:t:yes": SUCCESS,                # ✅ می‌پذیرم
    "ring:tp:done": SUCCESS,              # 💾 ثبت
    "ring:pa:done": SUCCESS,              # 💾 ثبت
    "ring:p:done": SUCCESS,               # 💾 ذخیره و بازگشت
    "ring:r:send": SUCCESS,               # 📨 ثبت گزارش
    "ring:reveal:yes": SUCCESS,           # ✅ بله، معرفی کنم
    "ring:next:yes": SUCCESS,             # ✅ بله، نفر بعدی
    "ring:block": DANGER,                 # 🚫 بلاک (entry)
    "ring:block:yes": DANGER,             # 🚫 بله، مسدودش کن
    "ring:block_now": DANGER,             # 🚫 مسدود کردن پارتنر فعلی
    "ring:r:send_block": DANGER,          # 🚫 گزارش + مسدودسازی
    "ring:del": DANGER,                   # 🗑 حذف پروفایل
    "ring:del:yes": DANGER,               # ⚠️ بله، پروفایل رینگ حذف شود
    "ring:stopq": DANGER,                 # ⏸ توقف جست‌وجو (leaves the queue for good)

    # ── stop / leave actions ──
    "aiu:vc_leave": DANGER,               # 📴 خروج هوشیار از ویس‌چت

    # ── list views whose label starts with 🚫 — opening a list is not destructive ──
    "admin:blacklist_view": PRIMARY,      # 🚫 لیست مسدودها (بلک‌لیست)
    "ai:ban_list": PRIMARY,               # 📋 لیست مسدودشده‌ها
    "ring:blocked": PRIMARY,              # 🚫 مسدودشده‌ها
}

# ══════════════════════════════════════════════════════════════
#  5) callback prefix → style (longest prefix wins)
# ══════════════════════════════════════════════════════════════
CALLBACK_PREFIX: tuple[tuple[str, str], ...] = (
    # questions — reviewer (content admin)
    ("questions:ca_q_approve:", SUCCESS),
    ("questions:ca_q_del:", DANGER),          # ❌ رد با دلیل / 🚫 خروج از بانک
    ("questions:ca_q_purge:", DANGER),        # 🗑 حذف همیشگی
    ("questions:ca_q_purge_yes:", DANGER),    # 🗑 بله، برای همیشه حذف کن
    # Hooshyar PDF quiz (services/hooshyar_quiz.py)
    ("quiz:start:", PRIMARY),                 # 🎯 شروع آزمون / 🔁 آزمون جدید
    ("quiz:resume:", PRIMARY),
    ("quiz:del:", DANGER),                    # 🗑 حذف جزوه
    ("quiz:del2:", DANGER),                   # 🗑 بله، حذف کن
    # lecture scribe
    ("ls:start:", PRIMARY),                   # 🚀 شروع پردازش
    # subscription (user)
    ("sub:plan:", SUCCESS),                   # paywall plan buttons
    ("sub:agree:", SUCCESS),                  # ✅ خوندم و قبول دارم
    ("sub:zpay:", SUCCESS),                   # ⚡ پرداخت آنلاین
    ("sub:wpay:", SUCCESS),                   # 💰 خرید با کیف پول
    ("sub:wbuy:", SUCCESS),                   # ✅ تأیید خرید
    ("sub:zchk:", SUCCESS),                   # ✅ پرداخت کردم، بررسی کن
    ("sub:ztop:", SUCCESS),                   # ⚡ پرداخت آنلاین (شارژ)
    # `sub:grsel:` is NOT here: it is also the multi-result recipient LIST
    # (a selection). The single «✅ بله، همینه» confirm is styled explicitly.
    ("sub:dcode:", SUCCESS),                  # 💳 تهیه اشتراک با تخفیف
    ("sub:appr:", SUCCESS),                   # admin: ✅ تأیید رسید
    ("sub:rej:", DANGER),                     # admin: ❌ رد رسید
    ("sub:famrm:", DANGER),                   # ➖ حذف عضو خانواده
    ("dun:resume:", SUCCESS),                 # 💳 ادامه‌ی پرداخت (dunning)
    # subscription admin
    ("suba:plan_del:", DANGER),
    ("suba:disc_del:", DANGER),
    ("suba:revoke:", DANGER),                 # 🚫 لغو اشتراک (با دلیل)
    ("suba:manual_quick:", SUCCESS),          # +7 / +30 / +90
    ("suba:disc_bcast_stop:", DANGER),        # ⛔ توقف انتشار
    # ticket
    ("ticket:admin_close_confirm:", SUCCESS),  # ✅ بله، ببند
    ("ticket:ai_send:", SUCCESS),             # ✅ ارسالِ همین پاسخ
    # schedule
    ("schedule:del_item:", DANGER),           # 🗑 حذف
    # admin main panel — users / roles / intakes / channel lock
    ("admin:approve:", SUCCESS),
    ("admin:reject:", DANGER),
    ("admin:suspend:", DANGER),               # 🚫 تعلیق
    ("admin:confirm_delete_user:", DANGER),   # 🗑 حذف کامل (entry)
    ("admin:delete_user:", DANGER),           # ⚠️ بله، حذف
    ("admin:confirm_block_user:", DANGER),    # 🚫 بلاک کامل (entry)
    ("admin:block_user:", DANGER),            # 🚫 بله، بلاک کن
    ("admin:channel_lock_remove:", DANGER),
    ("admin:intake_del:", DANGER),
    ("admin:role_remove:", DANGER),
    ("admin:ca_remove:", DANGER),             # ↩️ لغو دسترسی محتوا / 🗑 لغو
    # content panel — delete entries + confirmations, unfork (= drop override)
    ("ca:del_", DANGER),                      # 🗑 next to lesson/session/content/ref/faq
    ("ca:confirm_del_", DANGER),              # 🗑 بله / 🗑 حذف
    # unfork ENTRY («↩️» icon in every list row / «↩️ بازگشت به نسخهی سراسری»)
    # stays default — a second red icon per row next to 🗑 is a wall of red;
    # only the final «↩️ بله، بازگشت به سراسری» confirmation is red.
    ("ca:confirm_unfork_session:", DANGER),
    ("ca:confirm_unfork_book:", DANGER),
    # ai_admin
    ("ai:del_key_idx:", DANGER),
    ("ai:del_persona:", DANGER),
    ("ai:profile_clear:", DANGER),
)

# ══════════════════════════════════════════════════════════════
#  6) Never / exit
# ══════════════════════════════════════════════════════════════
# Quiz answer options — NEVER coloured: all options of a question must look
# identical whatever their callbacks, so no colour can hint the answer.
NEVER_PREFIX: tuple[str, ...] = (
    "answer:", "questions:exam_answer:", "questions:ai_personal_answer:",
    "exam_answer:", "ai_personal_answer:", "btn_disabled:",
)
# Kept for backwards compatibility (cancel callbacks are EXIT now).
NEVER_CALLBACK_EXACT: frozenset[str] = frozenset()

# Cancel / «نه» / skip / clear-filter callbacks → EXIT (red) whatever the label.
EXIT_CALLBACK_EXACT: frozenset[str] = frozenset({
    "admin:bc_cancel", "admin:poll_cancel", "ls:smart_cancel",
    "schedule:scan_cancel", "schedule:cancel_pending",
    "questions:dup_cancel", "register:cancel", "report:cancel",
    "ca:cancel_filename", "ring:cancelq", "ring:t:no", "ring:reveal:no",
    "sub:gskip", "admin:uf_clear",
})
# «✏️ ویرایش» uses ticket:preview_cancel — an edit, so it is NOT an exit.
EXIT_PREFIX: tuple[str, ...] = ("ls:cancel:",)

# Back / home / cancel labels → EXIT (red): a leading icon, or a FIRST word
# from EXIT_WORDS («🔒 بازگشت به …», «🙏 نه», «بی‌خیال پیام ✋»). Only the first
# word counts, so «💾 ذخیره و بازگشت» stays a save button.
EXIT_TEXT_PREFIX: tuple[str, ...] = ("🔙", "🏠", "↩", "❌", "✖", "🔚")
EXIT_WORDS: frozenset[str] = frozenset({
    "بازگشت", "برگشت", "انصراف", "لغو", "بیخیال", "بستن", "خیر", "نه",
})
# Stop / delete / block icons → DESTRUCTIVE (red) when no table entry decides
# (ring reply controls «🚫 بلاک», «⏹ پایان گفتگو», «🛑 توقف پاسخ», «⛔️ پایان و گزارش»).
DANGER_TEXT_PREFIX: tuple[str, ...] = ("🗑", "🚫", "⛔", "🛑", "⏹", "⏸")
# «🔔 لغو بی‌صدا» = unmute, not cancel.
_NOT_EXIT_MARKERS: tuple[str, ...] = ("صدا",)
# A leading tick marks the selected / current item of a list → green.
SELECTED_TEXT_PREFIX: tuple[str, ...] = ("✅", "☑", "✔")

EXIT, DESTRUCTIVE = "exit", "destructive"

_PREFIX_SORTED: tuple[tuple[str, str], ...] = tuple(
    sorted(CALLBACK_PREFIX, key=lambda p: len(p[0]), reverse=True))
_WORD_RE = re.compile(r"[\w\u200c]+")
_CHAR_MAP = str.maketrans({"ي": "ی", "ك": "ک"})


def _lookup(cb: str, exact, prefixes) -> Optional[str]:
    """exact match first, then the LONGEST matching prefix."""
    if cb in exact:
        return exact[cb]
    best, best_len = None, -1
    for pfx, style in prefixes:
        if len(pfx) > best_len and cb.startswith(pfx):
            best, best_len = style, len(pfx)
    return best


def is_exit_text(text: str) -> bool:
    """True for back / home / cancel / «نه» labels."""
    t = (text if isinstance(text, str) else "").strip()
    if not t:
        return False
    if t.startswith(EXIT_TEXT_PREFIX):
        return True
    if any(mk in t for mk in _NOT_EXIT_MARKERS):
        return False
    m = _WORD_RE.search(t.translate(_CHAR_MAP))
    return bool(m) and m.group(0).replace(_ZWNJ, "") in EXIT_WORDS


def _by_label(t: str) -> tuple[Optional[str], Optional[str]]:
    """Fallback when no table entry decides: exit → red, stop/delete icon →
    red, tick → green, anything else → blue."""
    if is_exit_text(t):
        return DANGER, EXIT
    s = t.lstrip()
    if s.startswith(DANGER_TEXT_PREFIX):
        return DANGER, DESTRUCTIVE
    if s.startswith(SELECTED_TEXT_PREFIX):
        return SUCCESS, None
    return PRIMARY, None


def palette_role(text: str, callback_data: Optional[str], *,
                 kind: str) -> tuple[Optional[str], Optional[str]]:
    """``(style, role)`` of a button; role is ``EXIT``, ``DESTRUCTIVE`` or None.

    ``kind`` is ``'reply'`` or ``'inline'``. Pure and total: never raises for
    str/None inputs.
    """
    t = text if isinstance(text, str) else ""
    if not t.strip():
        return None, None
    if kind == "reply":
        style = REPLY_LABEL_STYLES.get(t)
        return (style, None) if style is not None else _by_label(t)
    if kind != "inline":
        return None, None
    if not callback_data:            # url / web_app / login_url buttons
        style = URL_LABEL_STYLES.get(t)
        return (style, None) if style is not None else _by_label(t)
    cb = str(callback_data)
    if cb.startswith(NEVER_PREFIX) or cb in NEVER_CALLBACK_EXACT:
        return None, None
    pair = INLINE_PAIR_STYLES.get((t, cb))
    if pair is not None:
        return pair, None
    looked = _lookup(cb, CALLBACK_EXACT, _PREFIX_SORTED)
    if looked == DANGER:
        return DANGER, DESTRUCTIVE
    if is_exit_text(t) or cb in EXIT_CALLBACK_EXACT or cb.startswith(EXIT_PREFIX):
        return DANGER, EXIT
    if looked is not None:
        return looked, None
    return _by_label(t)


def palette_style(text: str, callback_data: Optional[str], *, kind: str) -> Optional[str]:
    """Central colour for a single button (no row context).

    Returns ``"primary"``/``"success"``/``"danger"`` or ``None`` (default).
    """
    return palette_role(text, callback_data, kind=kind)[0]


def palette_row_styles(row) -> tuple:
    """Styles for one keyboard row, with the row rule applied.

    ``row`` items are ``(text, callback_data, kind, explicit_style)`` — or
    None for a non-button. Explicit styles are returned unchanged; an
    unstyled EXIT next to a DESTRUCTIVE button becomes PRIMARY.
    """
    styles, roles = [], []
    for item in row:
        if item is None:
            styles.append(None)
            roles.append((None, True))
            continue
        text, cb, kind, explicit = item
        if explicit in VALID_STYLES:
            role = EXIT if is_exit_text(text) else (DESTRUCTIVE if explicit == DANGER else None)
            styles.append(explicit)
            roles.append((role, True))
        else:
            style, role = palette_role(text, cb, kind=kind)
            styles.append(style)
            roles.append((role, False))
    if any(role == DESTRUCTIVE for role, _ in roles):
        styles = [PRIMARY if (role == EXIT and not fixed) else s
                  for s, (role, fixed) in zip(styles, roles)]
    return tuple(styles)


__all__ = [
    "PRIMARY", "SUCCESS", "DANGER", "VALID_STYLES", "EXIT", "DESTRUCTIVE",
    "REPLY_LABEL_STYLES", "EXPLICIT_NONE_REPLY_LABELS", "URL_LABEL_STYLES",
    "INLINE_PAIR_STYLES", "CALLBACK_EXACT", "CALLBACK_PREFIX",
    "NEVER_PREFIX", "NEVER_CALLBACK_EXACT", "EXIT_CALLBACK_EXACT", "EXIT_PREFIX",
    "EXIT_TEXT_PREFIX", "EXIT_WORDS", "SELECTED_TEXT_PREFIX", "DANGER_TEXT_PREFIX",
    "is_exit_text", "palette_role", "palette_style", "palette_row_styles",
]
