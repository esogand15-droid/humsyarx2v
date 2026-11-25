# -*- coding: utf-8 -*-
"""Tests for backend/bot/ui_buttons.py — Telegram button colours.

No network: the full send path is exercised with a bot subclass whose
``_do_post`` captures the final request data instead of calling Telegram.
"""
import asyncio
import json

import pytest
from telegram import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    LoginUrl,
    ReplyKeyboardMarkup,
    WebAppInfo,
)
from telegram.ext import ExtBot
from telegram.request._requestparameter import RequestParameter

from backend.bot import ui_buttons as ub
from backend.bot.ui_buttons import (
    DANGER,
    PRIMARY,
    SUCCESS,
    StyledExtBot,
    apply_semantic_styles,
    auto_styles_enabled,
    btn,
    get_style,
    install_button_styles,
    kbtn,
    semantic_style,
    strip_styles,
    style_button,
    styles_enabled,
)

FAKE_TOKEN = "123456:TEST-not-a-real-token"


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("BUTTON_STYLES_ENABLED", raising=False)
    monkeypatch.delenv("BUTTON_AUTO_STYLES", raising=False)
    # These tests cover explicit + keyword-auto styling; the central palette
    # table is covered (with a fake table) by tests/test_button_palette_engine.py.
    monkeypatch.setenv("BUTTON_PALETTE_ENABLED", "0")


def _styles(markup):
    rows = markup.inline_keyboard if isinstance(markup, InlineKeyboardMarkup) else markup.keyboard
    return [[get_style(b) for b in row] for row in rows]


def _payload(markup):
    return json.loads(RequestParameter.from_input("reply_markup", markup).json_value)


# ── 1. serialisation ──────────────────────────────────────────────
def test_api_kwargs_style_is_serialized_in_to_dict_and_json():
    m = InlineKeyboardMarkup([[btn("ok", callback_data="cb", style=PRIMARY)]])
    d = m.to_dict()
    assert d["inline_keyboard"][0][0] == {"text": "ok", "callback_data": "cb", "style": "primary"}
    assert '"style": "primary"' in m.to_json()


def test_request_parameter_includes_style():
    m = InlineKeyboardMarkup([[btn("ok", callback_data="cb", style=DANGER)]])
    assert _payload(m)["inline_keyboard"][0][0]["style"] == "danger"


def test_reply_keyboard_button_style_serialized():
    m = ReplyKeyboardMarkup([[kbtn("🩺 داشبورد", style=PRIMARY)]], resize_keyboard=True)
    assert m.to_dict()["keyboard"][0][0] == {"text": "🩺 داشبورد", "style": "primary"}


def test_unstyled_button_has_no_style_key():
    m = InlineKeyboardMarkup([[btn("x", callback_data="cb")]])
    assert "style" not in m.to_dict()["inline_keyboard"][0][0]


def test_invalid_style_rejected():
    with pytest.raises(ValueError):
        btn("x", callback_data="cb", style="purple")
    with pytest.raises(ValueError):
        style_button(InlineKeyboardButton("x", callback_data="cb"), "purple")


def test_frozen_original_not_mutated_and_equality_kept():
    orig = InlineKeyboardButton("🗑 حذف", callback_data="item:del:5")
    styled = style_button(orig, DANGER)
    assert get_style(orig) is None and get_style(styled) == DANGER
    assert styled is not orig
    # PTB equality is on (text, callback_data, …) — style does not change identity
    assert styled == orig
    with pytest.raises(AttributeError):
        styled.text = "changed"  # still frozen


# ── 2. env switches ───────────────────────────────────────────────
def test_defaults_styles_on_auto_off():
    assert styles_enabled() is True
    assert auto_styles_enabled() is False


def test_auto_requires_master(monkeypatch):
    monkeypatch.setenv("BUTTON_AUTO_STYLES", "1")
    assert auto_styles_enabled() is True
    monkeypatch.setenv("BUTTON_STYLES_ENABLED", "0")
    assert auto_styles_enabled() is False


def test_btn_omits_style_when_master_off(monkeypatch):
    monkeypatch.setenv("BUTTON_STYLES_ENABLED", "0")
    b = btn("✅ تأیید", callback_data="x:appr:1", style=SUCCESS)
    k = kbtn("🩺 داشبورد", style=PRIMARY)
    assert get_style(b) is None and "style" not in b.to_dict()
    assert get_style(k) is None and "style" not in k.to_dict()


# ── 3. semantic rules (pure engine) ───────────────────────────────
@pytest.mark.parametrize("text", [
    "🗑 حذف", "❌ رد", "🚫 مسدود کردن", "🚪 خروج",
    "🗑 پاکسازی الگوها", "🗑", "🚫 بله، بلاک کن", "🗑 بله، برای همیشه حذف کن",
    "Delete", "Remove item", "Ban user", "Log out", "Reject",
])
def test_danger(text):
    assert semantic_style(text) == DANGER


@pytest.mark.parametrize("text", [
    "✅ تأیید", "✅ تایید", "💳 خرید اشتراک", "⚡ پرداخت آنلاین (زرین\u200cپال)",
    "📊 ثبت نمره", "💾 ذخیره", "🔄 تمدید کن", "🎁 شروع ۷ روز آزمایشی",
    "✅ بله، ارسال کن", "📨 ارسال نهایی", "✅ رفع مسدودیت: علی",
    "Confirm", "Pay now", "Buy", "Submit", "Accept", "Approve", "Save",
])
def test_success(text):
    assert semantic_style(text) == SUCCESS


@pytest.mark.parametrize("text", [
    "🔙 بازگشت", "🔙 بازگشت به پلن\u200cها", "❌ بازگشت", "❌ برگشت", "🏠 منوی اصلی",
    "◀️ قبلی", "بعدی ▶️", "📄 صفحه ۲", "Back", "Main menu", "Next", "Close",
    "🔙 انصراف",
])
def test_navigation_unstyled(text):
    assert semantic_style(text) is None


@pytest.mark.parametrize("text", [
    "📚 منابع", "🧾 تاریخچه\u200cی پرداخت\u200cها", "📤 خروجی اکسل", "❌ همه خاموش",
    "🎫 تیکت جدید", "ردهبندی", "",
])
def test_neutral_not_styled(text):
    assert semantic_style(text) is None


@pytest.mark.parametrize("text,cb", [
    ("❌ لغو", None), ("❌ انصراف", None), ("Cancel", None), ("لغو عملیات", "x:cancel"),
    ("❌ لغو", "admin:user_detail:5"), ("•", "admin:bc_cancel"), ("•", "x:cancel:1"),
])
def test_cancel_is_never_red(text, cb):
    assert semantic_style(text, cb) is None


@pytest.mark.parametrize("text", [
    "🔇 لغو بی\u200cصدا", "🔊 رفع بی\u200cصدا", "🔈 unmute", "🔇 بی\u200cصدا کردن",
])
def test_mute_toggles_never_red(text):
    assert semantic_style(text) != DANGER


@pytest.mark.parametrize("text", [
    "✅ ورود", "✅ گروه A", "✅ ترم ۳", "✅ قلب و عروق", "☑ همه", "✔ روشن",
])
def test_leading_check_alone_is_selection_marker(text):
    assert semantic_style(text) is None


@pytest.mark.parametrize("text,cb", [
    ("ب) رد پیوند حاد", None),
    ("الف) شروع آنتی\u200cبیوتیک", None),
    ("ج) حذف داروی مسبب", None),
    ("د) تأیید تشخیص با بیوپسی", None),
    ("A) Reject graft", None),
    ("🅑 رد پیوند حاد", "answer:abc:1"),
    ("🅐 شروع آنتی\u200cبیوتیک", "questions:exam_answer:s1:0"),
    ("رد پیوند حاد", "questions:ai_personal_answer:a1:1"),
    ("شروع آنتی\u200cبیوتیک", "answer:q1:0"),
    ("حذف", "exam_answer:s:2"),
    ("تأیید", "ai_personal_answer:a:3"),
    ("🔒 تأیید (سؤال خودتان است)", "btn_disabled:msg"),
    ("🔴 سخت", "qd:hard"),
    ("۱۰ سؤال — شروع", "quiz:cnt:d1:practice:10"),
    ("✅ شروع", "quiz:go:d1:exam:10:all"),
    ("🗑 ترم ۳", "questions:sel_term:3"),
])
def test_quiz_options_never_styled(text, cb):
    assert semantic_style(text, cb) is None


def test_lock_prefix_never_styled():
    assert semantic_style("🔒 حذف") is None
    assert semantic_style("🔒 تأیید", "x:approve:1") is None


@pytest.mark.parametrize("text,cb", [
    ("❓ آیا خرید اشتراک قابل لغو است؟", "faq:item:3"),
    ("📕 پاتولوژی رابینز — حذف شده‌ها", "resources:topic:9"),
    ("📘 حذف و ثبت درس", "ref:book:2"),
    ("❓ چطور می‌تونم حساب کاربریم رو برای همیشه حذف کنم؟", None),
])
def test_dynamic_content_not_coloured(text, cb):
    assert semantic_style(text, cb) is None


def test_whole_word_only():
    assert semantic_style("📤 خروجی") is None      # خروجی ≠ خروج
    assert semantic_style("رده") is None
    assert semantic_style("cancellation policy") is None


def test_arabic_letter_variants_normalised():
    assert semantic_style("تأييد") == SUCCESS       # Arabic yeh
    assert semantic_style("حذف كامل") == DANGER     # Arabic kaf


def test_callback_data_fallback():
    assert semantic_style("🔒", "ticket:admin_close_confirm:5") is None
    assert semantic_style("•", "sub:appr:12") == SUCCESS
    assert semantic_style("•", "sub:rej:12") == DANGER
    assert semantic_style("•", "items:back") is None
    assert semantic_style("📚 منابع", "res:open:1") is None
    assert semantic_style("🔙 بازگشت", "x:delete") is None  # text wins


def test_primary_never_auto_assigned():
    labels = ["🩺 داشبورد", "🎫 ارسال تیکت جدید", "📚 منابع", "✅ شروع", "🗑 حذف"]
    for t in labels:
        assert semantic_style(t) != PRIMARY


# ── 4. apply_semantic_styles ──────────────────────────────────────
def _sample_markup():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("✅ تأیید", callback_data="sub:appr:1"),
         InlineKeyboardButton("❌ رد", callback_data="sub:rej:1")],
        [InlineKeyboardButton("📚 منابع", callback_data="res:main")],
        [InlineKeyboardButton("🔙 بازگشت", callback_data="dashboard:refresh")],
    ])


def test_apply_styles_rows():
    out = apply_semantic_styles(_sample_markup())
    assert _styles(out) == [[SUCCESS, DANGER], [None], [None]]


def test_cancel_next_to_delete_only_delete_red():
    m = InlineKeyboardMarkup([[
        InlineKeyboardButton("⚠️ بله، حذف", callback_data="admin:delete_user:5"),
        InlineKeyboardButton("❌ لغو", callback_data="admin:user_detail:5"),
    ], [
        InlineKeyboardButton("🚫 بله، بلاک کن", callback_data="admin:block_user:5"),
        InlineKeyboardButton("❌ انصراف", callback_data="admin:cancel"),
    ]])
    assert _styles(apply_semantic_styles(m)) == [[DANGER, None], [DANGER, None]]


def test_selected_toggles_unstyled():
    m = InlineKeyboardMarkup([
        [InlineKeyboardButton("✅ گروه ۱", callback_data="profile:set_group:1"),
         InlineKeyboardButton("گروه ۲", callback_data="profile:set_group:2")],
        [InlineKeyboardButton("✅ قلب", callback_data="questions:sel_topic:1"),
         InlineKeyboardButton("✅ کلیه", callback_data="notif:toggle:k")],
    ])
    m2 = apply_semantic_styles(m)
    assert _styles(m2) == [[None, None], [None, None]]
    assert m2 is m


def test_quiz_keyboard_untouched():
    m = InlineKeyboardMarkup([
        [InlineKeyboardButton("🅐 شروع آنتی\u200cبیوتیک", callback_data="answer:q:0")],
        [InlineKeyboardButton("🅑 رد پیوند حاد", callback_data="answer:q:1")],
        [InlineKeyboardButton("🅒 حذف دارو", callback_data="answer:q:2")],
        [InlineKeyboardButton("🅓 تأیید با بیوپسی", callback_data="answer:q:3")],
    ])
    assert apply_semantic_styles(m) is m


def test_callback_data_and_text_unchanged():
    src = _sample_markup()
    out = apply_semantic_styles(src)
    before = [[(b.text, b.callback_data) for b in r] for r in src.inline_keyboard]
    after = [[(b.text, b.callback_data) for b in r] for r in out.inline_keyboard]
    assert before == after
    assert _styles(src) == [[None, None], [None], [None]]  # original untouched
    assert out == src  # PTB equality preserved


def test_explicit_style_wins():
    m = InlineKeyboardMarkup([
        [btn("❌ لغو", callback_data="x:cancel", style=PRIMARY)],
        [btn("🔙 بازگشت", callback_data="back", style=SUCCESS)],
        [btn("🩺 داشبورد", callback_data="dashboard:refresh", style=PRIMARY)],
    ])
    assert _styles(apply_semantic_styles(m)) == [[PRIMARY], [SUCCESS], [PRIMARY]]


def test_idempotent():
    once = apply_semantic_styles(_sample_markup())
    twice = apply_semantic_styles(once)
    assert twice is once
    assert once.to_dict() == twice.to_dict()


def test_unchanged_markup_returns_same_object():
    m = InlineKeyboardMarkup([[InlineKeyboardButton("📚 منابع", callback_data="r")]])
    assert apply_semantic_styles(m) is m


def test_non_callback_buttons_preserved():
    m = InlineKeyboardMarkup([
        [InlineKeyboardButton("💳 پرداخت در زرین\u200cپال", url="https://example.com/pay")],
        [InlineKeyboardButton("📱 باز کردن", web_app=WebAppInfo(url="https://example.com/app"))],
        [InlineKeyboardButton("✅ ورود", login_url=LoginUrl(url="https://example.com/login"))],
        [InlineKeyboardButton("🗑 حذف", switch_inline_query="q")],
        [InlineKeyboardButton("✅ پرداخت", pay=True)],
    ])
    out = apply_semantic_styles(m)
    d_in, d_out = m.to_dict(), out.to_dict()
    for r_in, r_out in zip(d_in["inline_keyboard"], d_out["inline_keyboard"]):
        b_out = dict(r_out[0])
        b_out.pop("style", None)
        assert b_out == r_in[0]
    assert _styles(out) == [[SUCCESS], [None], [None], [DANGER], [SUCCESS]]
    assert d_out["inline_keyboard"][0][0]["url"] == "https://example.com/pay"
    assert d_out["inline_keyboard"][1][0]["web_app"] == {"url": "https://example.com/app"}


def test_reply_keyboard_preserves_options():
    m = ReplyKeyboardMarkup(
        [[kbtn("🩺 داشبورد", style=PRIMARY), KeyboardButton("📚 منابع")],
         [KeyboardButton("🗑 حذف")], [KeyboardButton("❌ لغو")]],
        resize_keyboard=True, one_time_keyboard=True, input_field_placeholder="…",
    )
    out = apply_semantic_styles(m)
    assert _styles(out) == [[PRIMARY, None], [DANGER], [None]]
    assert out.resize_keyboard and out.one_time_keyboard
    assert out.input_field_placeholder == "…"


def test_other_markups_passthrough():
    from telegram import ForceReply, ReplyKeyboardRemove
    for m in (None, ForceReply(), ReplyKeyboardRemove(), {"inline_keyboard": []}):
        assert apply_semantic_styles(m) is m
        assert strip_styles(m) is m
    empty = InlineKeyboardMarkup([])
    assert apply_semantic_styles(empty) is empty


def test_strip_styles_removes_only_style():
    m = ReplyKeyboardMarkup([[kbtn("🩺 داشبورد", style=PRIMARY), KeyboardButton("📚 منابع")]],
                            resize_keyboard=True)
    out = strip_styles(m)
    assert _styles(out) == [[None, None]]
    assert out.to_dict()["keyboard"][0][0] == {"text": "🩺 داشبورد"}
    assert out.resize_keyboard
    assert _styles(m) == [[PRIMARY, None]]  # original untouched


# ── 5. central wiring (StyledExtBot) ──────────────────────────────
class _CapturingBot(StyledExtBot):
    __slots__ = ()
    captured = []

    async def _do_post(self, endpoint, data, **kwargs):  # never hits the network
        _CapturingBot.captured.append((endpoint, data))
        return True


def _send_via(bot, markup):
    _CapturingBot.captured.clear()
    asyncio.run(bot._post("sendMessage", {"chat_id": 1, "text": "x", "reply_markup": markup}))
    endpoint, data = _CapturingBot.captured[-1]
    return endpoint, data


def _explicit_markup():
    return InlineKeyboardMarkup([
        [btn("💳 خرید", callback_data="sub:plan:1", style=PRIMARY)],
        [InlineKeyboardButton("✅ تأیید", callback_data="sub:appr:1")],
        [InlineKeyboardButton("🔙 بازگشت", callback_data="sub:back")],
    ])


def test_auto_off_by_default_only_explicit_sent():
    bot = _CapturingBot(token=FAKE_TOKEN)
    src = _explicit_markup()
    _, data = _send_via(bot, src)
    assert data["reply_markup"] is src
    p = _payload(data["reply_markup"])["inline_keyboard"]
    assert p[0][0]["style"] == "primary"
    assert "style" not in p[1][0] and "style" not in p[2][0]


def test_styled_bot_auto_styles_when_enabled(monkeypatch):
    monkeypatch.setenv("BUTTON_AUTO_STYLES", "1")
    bot = _CapturingBot(token=FAKE_TOKEN)
    _, data = _send_via(bot, _sample_markup())
    row0 = _payload(data["reply_markup"])["inline_keyboard"][0]
    assert row0[0]["style"] == "success" and row0[0]["callback_data"] == "sub:appr:1"
    assert row0[1]["style"] == "danger" and row0[1]["callback_data"] == "sub:rej:1"
    assert "style" not in _payload(data["reply_markup"])["inline_keyboard"][2][0]


def test_kill_switch_strips_explicit_styles(monkeypatch):
    # markup built while styles were on (e.g. cached keyboard), sent after switch-off
    src = _explicit_markup()
    monkeypatch.setenv("BUTTON_STYLES_ENABLED", "0")
    monkeypatch.setenv("BUTTON_AUTO_STYLES", "1")
    bot = _CapturingBot(token=FAKE_TOKEN)
    _, data = _send_via(bot, src)
    p = _payload(data["reply_markup"])
    assert all("style" not in b for row in p["inline_keyboard"] for b in row)
    assert p["inline_keyboard"][0][0] == {"text": "💳 خرید", "callback_data": "sub:plan:1"}
    assert get_style(src.inline_keyboard[0][0]) == PRIMARY  # caller's object untouched


def test_kill_switch_strips_reply_keyboard(monkeypatch):
    from backend.bot import utils as bu
    kb = bu.main_keyboard()  # built with styles on
    monkeypatch.setenv("BUTTON_STYLES_ENABLED", "0")
    bot = _CapturingBot(token=FAKE_TOKEN)
    _, data = _send_via(bot, kb)
    p = _payload(data["reply_markup"])
    assert all("style" not in b for row in p["keyboard"] for b in row)


def test_kill_switch_unstyled_markup_same_object(monkeypatch):
    monkeypatch.setenv("BUTTON_STYLES_ENABLED", "0")
    bot = _CapturingBot(token=FAKE_TOKEN)
    src = _sample_markup()
    _, data = _send_via(bot, src)
    assert data["reply_markup"] is src


def test_install_switches_instance_only():
    bot = ExtBot(token=FAKE_TOKEN)
    other = ExtBot(token=FAKE_TOKEN)
    assert install_button_styles(bot) is True
    assert isinstance(bot, StyledExtBot) and isinstance(bot, ExtBot)
    assert type(other) is ExtBot  # not a global patch
    assert install_button_styles(bot) is True  # idempotent
    assert bot.token == FAKE_TOKEN


def test_install_even_when_master_off(monkeypatch):
    # hook must be present so the kill switch can strip explicit styles
    monkeypatch.setenv("BUTTON_STYLES_ENABLED", "off")
    bot = ExtBot(token=FAKE_TOKEN)
    assert install_button_styles(bot) is True
    assert type(bot) is StyledExtBot


def test_install_skips_unknown_bot_types():
    class OtherBot(ExtBot):
        __slots__ = ()

    bot = OtherBot(token=FAKE_TOKEN)
    assert install_button_styles(bot) is False
    assert type(bot) is OtherBot


# ── 6. explicit palette at call sites ─────────────────────────────
def test_main_keyboards_have_single_primary_dashboard():
    # colour-grouped main menu: blue block (learning first) → green money row
    # → red staff panels; every button is coloured.
    from backend.bot import utils as bu
    for fn in (bu.main_keyboard, bu.content_admin_keyboard, bu.admin_keyboard, bu.sub_admin_keyboard):
        kb = fn()
        flat = [b for row in kb.keyboard for b in row]
        prim = [b.text for b in flat if get_style(b) == PRIMARY]
        assert prim[:4] == ["🩺 داشبورد", "📚 منابع", "🧪 بانک سوال", "🤖 هوشیار"], fn.__name__
        assert all(get_style(b) is not None for b in flat), fn.__name__
        order = [get_style(b) for b in flat]
        assert order == sorted(order, key=[PRIMARY, "success", "danger"].index), fn.__name__
        assert kb.keyboard[0][0].text == "🩺 داشبورد", fn.__name__


def test_hero_builder_style_optional():
    from backend.bot.bot_modern_ui import ButtonGridBuilder
    b = ButtonGridBuilder().add_hero("✅ شروع ثبت\u200cنام", callback_data="register:start", style=PRIMARY)
    first = b.rows[0][0]
    assert get_style(first) == PRIMARY and first.callback_data == "register:start"
    plain = ButtonGridBuilder().add_hero("x", callback_data="y").rows[0][0]
    assert get_style(plain) is None and "style" not in plain.to_dict()


def test_hero_builder_respects_master_switch(monkeypatch):
    from backend.bot.bot_modern_ui import ButtonGridBuilder
    monkeypatch.setenv("BUTTON_STYLES_ENABLED", "0")
    b = ButtonGridBuilder().add_hero("x", callback_data="y", style=PRIMARY).rows[0][0]
    assert get_style(b) is None


def test_module_exports():
    assert ub.PRIMARY == "primary" and ub.SUCCESS == "success" and ub.DANGER == "danger"
