# -*- coding: utf-8 -*-
"""🎨 HumsYar — جدول مرکزی رنگ دکمه‌ها (Button palette, single source of truth)

Pure data + a tiny pure lookup. No telegram / env imports. The same ACTION
gets the same colour on every screen.

Telegram styles: ``primary`` (blue), ``success`` (green), ``danger`` (red);
anything not in these tables = ``None`` = default client colour.

PALETTE (decided by the lead)
-----------------------------
* primary  — go deeper into learning content / the main "open" action of a
             hub (dashboard, resources, question bank, Hooshyar, smart practice,
             start exam/quiz, open lecture scribe, start registration,
             new ticket, buy-subscription entry, edit-profile main action).
* success  — money + final positive commitments (plans/buy/pay/"I paid,
             check", donation, final confirm/submit/send/save/approve/accept/
             renew, admin approve).
* danger   — destructive / rejecting actions (delete, remove, block/ban,
             reject, purge/clear, cancel subscription) — entry button AND the
             final "yes, delete" confirmation. Also the staff-area entries
             («👨‍⚕️ پنل ادمین», «🎓 پنل محتوا», «🎓 رفتن به پنل محتوا») ONLY on the
             reply main menu and their direct entry buttons.
* none     — back/home/menu/page/close, cancel/«لغو»/«انصراف»/«نه», toggles,
             DB selection lists, info/secondary entries, external urls (unless
             payment/donation) and NEVER quiz answer options.

LOOKUP ORDER (``palette_style``)
--------------------------------
1. NEVER wins over everything: ``NEVER_TEXT_PREFIX`` / ``NEVER_TEXT_EXACT``
   (navigation / cancel labels), then ``NEVER_CALLBACK_EXACT`` /
   ``NEVER_PREFIX`` (quiz answers, selections, cancel callbacks).
2. reply keyboards → ``REPLY_LABEL_STYLES`` (exact label).
3. inline url / web_app buttons (no callback_data) → ``URL_LABEL_STYLES``.
4. ``INLINE_PAIR_STYLES`` — (exact label, exact callback) for callbacks that
   are SHARED between an action and a back button (``sub:back``,
   ``quiz:main``, ``ca:main``, ``admin:main``) and therefore can't be keyed
   by callback alone.
5. ``CALLBACK_EXACT`` → longest matching ``CALLBACK_PREFIX``.

Styling never changes text/callback_data (ring ``CONTROL_LABELS`` stay intact).
Labels are byte-exact copies of the source (ZWNJ ``\\u200c`` / ZWJ ``\\u200d``
written as escapes on purpose).
"""
from __future__ import annotations

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
}

# Reply labels deliberately left default (documentation + drift test).
EXPLICIT_NONE_REPLY_LABELS: frozenset[str] = frozenset({
    "❓ سوالات متداول",
    "📅 برنامه",
    "👤 پروفایل",
    "🔔 اعلان" + _ZWNJ + "ها",
    "📊 کارنامه و معدل",
    "🎫 پشتیبانی",
    "💍 رینگ استریت",          # ring entry → none
})

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
#  6) NEVER styled — wins over everything above
# ══════════════════════════════════════════════════════════════
NEVER_PREFIX: tuple[str, ...] = (
    # quiz answer options / disabled — must never leak the correct answer
    "answer:", "questions:exam_answer:", "questions:ai_personal_answer:",
    "exam_answer:", "ai_personal_answer:", "btn_disabled:",
    # quiz / exam setup selections
    "qd:", "questions:sel_", "questions:cr_",
    "questions:cx_count:", "questions:cx_lesson:", "questions:cx_topic:",
    "questions:cx_time:", "questions:cx_output:",
    "quiz:cnt:", "quiz:go:", "quiz:tp:", "quiz:doc:",
    "report:question:", "report:reason:",
    # DB selection lists (terms, lessons, sessions, books, FAQ, users, intakes)
    "resources:term:", "resources:lesson:", "resources:topic:", "resources:files:",
    "download_resource:", "bs:term:", "bs:lesson:", "bs:session:", "bs_dl:",
    "ref:subject:", "ref:book:", "ref:volumes:", "ref:dl:",
    "faq:cat:", "faq:item:",
    "ca:term:", "ca:lesson:", "ca:session:", "ca:ref_subject:", "ca:ref_book:",
    "ca:intake:", "admin:user_detail:", "admin:users:", "suba:user:",
    "suba:view_pay:", "grades:lesson_pick:", "grades:term_pick",
    "register:intake:", "profile:set_intake:", "admin:set_intake_user:",
    # cancel
    "ls:cancel:",
)

NEVER_CALLBACK_EXACT: frozenset[str] = frozenset({
    # cancel / «نه» / skip — cancelling is not destructive
    "admin:bc_cancel", "admin:poll_cancel", "ls:smart_cancel",
    "schedule:scan_cancel", "schedule:cancel_pending", "ticket:preview_cancel",
    "questions:dup_cancel", "register:cancel", "report:cancel",
    "ca:cancel_filename", "ring:cancelq", "ring:t:no", "ring:reveal:no",
    "sub:gskip",
    # «❌ حذف فیلتر» only clears a list filter; «🙂 کسی را مسدود نکرده‌ای» is info
    "admin:uf_clear", "ring:blocked",
})

# Navigation / cancel labels — never coloured whatever the callback is
# (protects shared callbacks such as `sub:back`, `questions:practice` used as
# back targets). «↩️» is NOT a prefix here: it also starts undo actions
# (↩️ لغو دسترسی محتوا, ↩️ بله، بازگشت به سراسری) — so the ↩️ BACK labels are
# listed exactly (they share callbacks such as `ring:p:done`, `quiz:start:`).
NEVER_TEXT_PREFIX: tuple[str, ...] = ("🔙", "🏠", "◀", "⬅", "⏮", "🔒")
NEVER_TEXT_EXACT: frozenset[str] = frozenset({
    "❌ لغو", "❌ انصراف",
    "↩️ بازگشت", "↩️ بازگشت به رینگ", "↩️ بازگشت به گفتگو",
    "↩️ بازگشت به پروفایل من", "↩️ بیخیال",
})

_PREFIX_SORTED: tuple[tuple[str, str], ...] = tuple(
    sorted(CALLBACK_PREFIX, key=lambda p: len(p[0]), reverse=True))


def _lookup(cb: str, exact, prefixes) -> Optional[str]:
    """exact match first, then the LONGEST matching prefix."""
    if cb in exact:
        return exact[cb]
    best, best_len = None, -1
    for pfx, style in prefixes:
        if len(pfx) > best_len and cb.startswith(pfx):
            best, best_len = style, len(pfx)
    return best


def _never_text(text: str) -> bool:
    return text in NEVER_TEXT_EXACT or text.startswith(NEVER_TEXT_PREFIX)


def palette_style(text: str, callback_data: Optional[str], *, kind: str) -> Optional[str]:
    """Central colour for a button. ``kind`` is ``'reply'`` or ``'inline'``.

    Returns ``"primary"``/``"success"``/``"danger"`` or ``None`` (default).
    Pure and total: never raises for str/None inputs.
    """
    t = text if isinstance(text, str) else ""
    if _never_text(t):
        return None
    if kind == "reply":
        return REPLY_LABEL_STYLES.get(t)
    if kind != "inline":
        return None
    if not callback_data:            # url / web_app / login_url buttons
        return URL_LABEL_STYLES.get(t)
    cb = str(callback_data)
    if cb in NEVER_CALLBACK_EXACT or cb.startswith(NEVER_PREFIX):
        return None
    pair = INLINE_PAIR_STYLES.get((t, cb))
    if pair is not None:
        return pair
    return _lookup(cb, CALLBACK_EXACT, _PREFIX_SORTED)


__all__ = [
    "PRIMARY", "SUCCESS", "DANGER", "VALID_STYLES",
    "REPLY_LABEL_STYLES", "EXPLICIT_NONE_REPLY_LABELS", "URL_LABEL_STYLES",
    "INLINE_PAIR_STYLES", "CALLBACK_EXACT", "CALLBACK_PREFIX",
    "NEVER_PREFIX", "NEVER_CALLBACK_EXACT", "NEVER_TEXT_PREFIX",
    "NEVER_TEXT_EXACT", "palette_style",
]
