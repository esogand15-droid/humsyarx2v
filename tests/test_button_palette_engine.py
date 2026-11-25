# -*- coding: utf-8 -*-
"""Tests for the central palette pass in backend/bot/ui_buttons.StyledExtBot
and the colour-grouped main reply menus in backend/bot/utils.py.

The real ``backend/bot/button_palette.py`` table is NOT used: a small fake
module is injected into ``sys.modules`` so these tests are independent of
the table's contents. No network: requests are captured before ``_do_post``.
"""
import ast
import asyncio
import json
import pathlib
import re
import sys
import types

import pytest
from telegram import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
)
from telegram.request._requestparameter import RequestParameter

from backend.bot import ui_buttons as ub
from backend.bot.ui_buttons import DANGER, PRIMARY, SUCCESS, StyledExtBot, btn, get_style

FAKE_TOKEN = "123456:TEST-not-a-real-token"
REPO = pathlib.Path(__file__).resolve().parents[1]
ADMIN_LABEL = "\U0001f468\u200d\u2695\ufe0f پنل ادمین"
RING_LABEL = "💍 رینگ استریت"


# ── fixtures / helpers ────────────────────────────────────────────
def _make_palette(calls=None, *, raises=False):
    mod = types.ModuleType(ub.PALETTE_MODULE)

    def palette_style(text, callback_data, *, kind):
        if calls is not None:
            calls.append((text, callback_data, kind))
        if raises:
            raise RuntimeError("boom")
        if kind == "inline" and callback_data and callback_data.startswith("pay:"):
            return SUCCESS
        if kind == "inline" and callback_data is None and text.startswith("🌐"):
            return PRIMARY  # url button
        if kind == "reply" and text == "📚 منابع":
            return PRIMARY
        if text.startswith("🗑"):
            return DANGER
        if text == "bogus":
            return "rainbow"  # invalid → ignored
        return None

    mod.palette_style = palette_style
    mod.REPLY_LABEL_STYLES = {}
    mod.CALLBACK_EXACT = {}
    mod.CALLBACK_PREFIX = ()
    mod.URL_LABEL_STYLES = {}
    mod.NEVER_PREFIX = ()
    mod.NEVER_CALLBACK_EXACT = frozenset()
    return mod


def _reset_engine():
    ub._cached_palette_style.cache_clear()
    ub._palette_state["import_failed"] = False
    ub._logged_once.clear()


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for k in ("BUTTON_STYLES_ENABLED", "BUTTON_AUTO_STYLES", "BUTTON_PALETTE_ENABLED"):
        monkeypatch.delenv(k, raising=False)
    _reset_engine()
    yield
    _reset_engine()


@pytest.fixture
def palette(monkeypatch):
    calls = []
    monkeypatch.setitem(sys.modules, ub.PALETTE_MODULE, _make_palette(calls))
    return calls


class _CapturingBot(StyledExtBot):
    __slots__ = ()
    captured = []

    async def _do_post(self, endpoint, data, **kwargs):  # never hits the network
        _CapturingBot.captured.append((endpoint, data))
        return True


def _send(markup):
    bot = _CapturingBot(token=FAKE_TOKEN)
    _CapturingBot.captured.clear()
    asyncio.run(bot._post("sendMessage", {"chat_id": 1, "text": "x", "reply_markup": markup}))
    return _CapturingBot.captured[-1][1]["reply_markup"]


def _payload(markup):
    return json.loads(RequestParameter.from_input("reply_markup", markup).json_value)


def _rows(markup):
    p = _payload(markup)
    return p.get("inline_keyboard") or p.get("keyboard")


def _inline():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("💳 پرداخت", callback_data="pay:plan:1"),
         InlineKeyboardButton("🗑 حذف", callback_data="x:del:1")],
        [InlineKeyboardButton("🌐 سایت", url="https://example.org/a?b=1")],
        [InlineKeyboardButton("🔙 بازگشت", callback_data="menu:back")],
    ])


# ── 1. palette pass ───────────────────────────────────────────────
def test_palette_applied_to_unstyled_inline_buttons(palette):
    src = _inline()
    out = _send(src)
    rows = _rows(out)
    assert rows[0][0]["style"] == "success"
    assert rows[0][1]["style"] == "danger"
    assert rows[1][0]["style"] == "primary"
    assert "style" not in rows[2][0]
    # caller's markup untouched
    assert all(get_style(b) is None for r in src.inline_keyboard for b in r)


def test_palette_receives_text_callback_and_kind(palette):
    _send(_inline())
    assert ("💳 پرداخت", "pay:plan:1", "inline") in palette
    assert ("🌐 سایت", None, "inline") in palette  # url buttons → callback_data None


def test_palette_applied_to_unstyled_reply_buttons(palette):
    kb = ReplyKeyboardMarkup([[KeyboardButton("📚 منابع"), KeyboardButton("👤 پروفایل")]],
                             resize_keyboard=True)
    rows = _rows(_send(kb))
    assert rows[0][0] == {"text": "📚 منابع", "style": "primary"}
    assert rows[0][1] == {"text": "👤 پروفایل"}
    assert ("📚 منابع", None, "reply") in palette


def test_explicit_style_wins_over_palette(palette):
    src = InlineKeyboardMarkup([[btn("💳 پرداخت", callback_data="pay:x", style=DANGER)]])
    rows = _rows(_send(src))
    assert rows[0][0]["style"] == "danger"
    assert ("💳 پرداخت", "pay:x", "inline") not in palette  # not even consulted


def test_invalid_palette_value_ignored(palette):
    rows = _rows(_send(InlineKeyboardMarkup([[InlineKeyboardButton("bogus", callback_data="b")]])))
    assert "style" not in rows[0][0]


def test_fields_preserved_and_to_dict_has_style(palette):
    out = _send(_inline())
    b0, b1 = out.inline_keyboard[0]
    u = out.inline_keyboard[1][0]
    assert (b0.text, b0.callback_data) == ("💳 پرداخت", "pay:plan:1")
    assert (b1.text, b1.callback_data) == ("🗑 حذف", "x:del:1")
    assert u.url == "https://example.org/a?b=1" and u.callback_data is None
    assert b0.to_dict()["style"] == "success" and u.to_dict()["style"] == "primary"
    assert u.to_dict()["url"] == "https://example.org/a?b=1"


def test_unchanged_markup_is_same_object(palette):
    src = InlineKeyboardMarkup([[InlineKeyboardButton("🔙 بازگشت", callback_data="menu:back")]])
    assert _send(src) is src


def test_palette_lookups_are_cached(palette):
    _send(_inline())
    n = len(palette)
    _send(_inline())
    assert len(palette) == n  # second send served from lru_cache
    assert ub._cached_palette_style.cache_info().hits >= n


# ── 2. switches ───────────────────────────────────────────────────
def test_master_switch_strips_everything_including_palette(palette, monkeypatch):
    monkeypatch.setenv("BUTTON_STYLES_ENABLED", "0")
    monkeypatch.setenv("BUTTON_AUTO_STYLES", "1")
    # a cached keyboard built while styles were on (explicit style present)
    src = InlineKeyboardMarkup([
        [ub.style_button(InlineKeyboardButton("y", callback_data="pay:2"), PRIMARY)],
        [InlineKeyboardButton("💳 پرداخت", callback_data="pay:plan:1")],
    ])
    rows = _rows(_send(src))
    assert all("style" not in b for r in rows for b in r)
    assert palette == []  # palette never consulted


def test_palette_env_off_disables_only_palette(palette, monkeypatch):
    monkeypatch.setenv("BUTTON_PALETTE_ENABLED", "0")
    src = InlineKeyboardMarkup([
        [btn("⭐ اصلی", callback_data="home:x", style=PRIMARY)],
        [InlineKeyboardButton("💳 پرداخت", callback_data="pay:plan:1")],
    ])
    rows = _rows(_send(src))
    assert rows[0][0]["style"] == "primary"       # explicit still sent
    assert "style" not in rows[1][0]              # palette off
    assert palette == []
    monkeypatch.setenv("BUTTON_AUTO_STYLES", "1")  # auto still works on its own
    rows = _rows(_send(src))
    assert rows[1][0]["style"] == "success"


def test_auto_pass_runs_after_palette_for_still_unstyled(palette, monkeypatch):
    monkeypatch.setenv("BUTTON_AUTO_STYLES", "1")
    src = InlineKeyboardMarkup([
        [InlineKeyboardButton("✅ تأیید", callback_data="sub:appr:1")],   # palette None → auto
        [InlineKeyboardButton("💳 پرداخت", callback_data="pay:plan:1")],  # palette
        [InlineKeyboardButton("🗑 پاکسازی", callback_data="x:purge")],   # palette danger
    ])
    rows = _rows(_send(src))
    assert [r[0]["style"] for r in rows] == ["success", "success", "danger"]


def test_palette_enabled_helper(monkeypatch):
    assert ub.palette_enabled() is True
    monkeypatch.setenv("BUTTON_PALETTE_ENABLED", "off")
    assert ub.palette_enabled() is False
    monkeypatch.setenv("BUTTON_PALETTE_ENABLED", "1")
    monkeypatch.setenv("BUTTON_STYLES_ENABLED", "0")
    assert ub.palette_enabled() is False


# ── 3. failure isolation ──────────────────────────────────────────
def test_missing_palette_module_sends_markup_unchanged(monkeypatch, caplog):
    monkeypatch.setitem(sys.modules, ub.PALETTE_MODULE, None)  # import → ModuleNotFoundError
    src = _inline()
    with caplog.at_level("WARNING", logger=ub.logger.name):
        assert _send(src) is src
        assert _send(src) is src
    assert sum("palette unavailable" in r.getMessage() for r in caplog.records) == 1


def test_raising_palette_sends_markup_unchanged(monkeypatch, caplog):
    monkeypatch.setitem(sys.modules, ub.PALETTE_MODULE, _make_palette(raises=True))
    src = _inline()
    with caplog.at_level("WARNING", logger=ub.logger.name):
        assert _send(src) is src
        assert _send(src) is src
    assert sum("palette_style raised" in r.getMessage() for r in caplog.records) == 1


def test_palette_without_function_is_ignored(monkeypatch):
    monkeypatch.setitem(sys.modules, ub.PALETTE_MODULE, types.ModuleType(ub.PALETTE_MODULE))
    src = _inline()
    assert _send(src) is src


def test_apply_palette_styles_passthrough_non_markups(palette):
    for m in (None, "x", {"inline_keyboard": []}):
        assert ub.apply_palette_styles(m) is m


# ── 4. edit paths ─────────────────────────────────────────────────
def test_edit_message_reply_markup_and_text_are_styled(palette):
    bot = _CapturingBot(token=FAKE_TOKEN)

    async def run():
        _CapturingBot.captured.clear()
        await bot.edit_message_reply_markup(chat_id=1, message_id=2, reply_markup=_inline())
        await bot.edit_message_text("t", chat_id=1, message_id=2, reply_markup=_inline())

    asyncio.run(run())
    eps = [e for e, _ in _CapturingBot.captured]
    assert eps == ["editMessageReplyMarkup", "editMessageText"]
    for _, data in _CapturingBot.captured:
        rows = _rows(data["reply_markup"])
        assert rows[0][0]["style"] == "success" and rows[1][0]["style"] == "primary"


# ── 5. main menus ─────────────────────────────────────────────────
P, S, D, N = "primary", "success", "danger", None
_COMMON = [
    [("🩺 داشبورد", P), ("📚 منابع", P)],
    [("🧪 بانک سوال", P), ("🤖 هوشیار", P)],
]
_MONEY = [
    [("💎 اشتراک ویژه", S), ("💙 حمایت مالی", S)],
]
_TAIL = [
    [("👤 پروفایل", P), ("🔔 اعلان\u200cها", P)],
    [("❓ سوالات متداول", P), ("🎫 پشتیبانی", P)],
]
EXPECTED = {
    "main_keyboard": _COMMON + [[("📅 برنامه", P), ("📊 کارنامه و معدل", P)]] + _TAIL + _MONEY,
    "content_admin_keyboard": _COMMON + [[("📅 برنامه", P), ("📊 کارنامه و معدل", P)]] + _TAIL + _MONEY
    + [[("🎓 پنل محتوا", D)]],
    "admin_keyboard": _COMMON + [[("📅 برنامه", P), ("📊 کارنامه و معدل", P)]] + _TAIL + _MONEY
    + [[(ADMIN_LABEL, D), ("🎓 پنل محتوا", D)]],
    "sub_admin_keyboard": _COMMON + [[("📅 برنامه", P)]] + _TAIL + _MONEY + [[(ADMIN_LABEL, D)]],
}


def _serialized(kb):
    return [[(b["text"], b.get("style")) for b in row] for row in _payload(kb)["keyboard"]]


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_main_menu_rows_and_colours(name, monkeypatch):
    from backend.bot import utils as bu
    # explicit colours must hold even with the palette table OFF
    monkeypatch.setenv("BUTTON_PALETTE_ENABLED", "0")
    kb = getattr(bu, name)()
    assert _serialized(kb) == EXPECTED[name]
    assert kb.resize_keyboard is True
    assert _serialized(_send(kb)) == EXPECTED[name]  # through the bot hook too


def test_main_menu_master_switch_strips(monkeypatch):
    from backend.bot import utils as bu
    kb = bu.admin_keyboard()
    monkeypatch.setenv("BUTTON_STYLES_ENABLED", "0")
    assert all(st is None for row in _serialized(_send(kb)) for _, st in row)


def _all_menu_labels():
    from backend.bot import utils as bu
    out = set()
    for name in EXPECTED:
        for row in getattr(bu, name)().keyboard:
            out |= {b.text for b in row}
    return out


def _router_labels():
    src = (REPO / "backend" / "bot" / "message_router.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    fn = next(n for n in ast.walk(tree)
              if isinstance(n, ast.AsyncFunctionDef) and n.name == "_route_menu_button")
    labels = set()
    for node in ast.walk(fn):
        if (isinstance(node, ast.Compare) and isinstance(node.left, ast.Name)
                and node.left.id == "text"):
            for op, comp in zip(node.ops, node.comparators):
                if isinstance(op, ast.Eq) and isinstance(comp, ast.Constant):
                    labels.add(comp.value)
                elif isinstance(op, ast.In) and isinstance(comp, (ast.Tuple, ast.List, ast.Set)):
                    labels |= {e.value for e in comp.elts if isinstance(e, ast.Constant)}
    return labels


def test_every_main_menu_label_is_routed():
    routed = _router_labels()
    assert len(routed) >= 10
    missing = _all_menu_labels() - routed
    assert not missing, missing


def test_every_main_menu_label_in_bot_menu_button_texts():
    src = (REPO / "backend" / "bot" / "bot.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_menu_button_texts")
    ns = {}
    exec(compile(ast.Module(body=[fn], type_ignores=[]), "bot_menu_texts", "exec"), ns)
    texts = ns["_menu_button_texts"]()
    missing = _all_menu_labels() - texts
    assert not missing, missing


def test_ring_main_menu_labels_cover_menus():
    kbmod = pytest.importorskip("backend.services.ring.keyboards")
    kbmod._MAIN_LABELS = None
    try:
        labels = kbmod.main_menu_labels()
        assert _all_menu_labels() <= labels
        assert all(kbmod.is_main_menu_label(t) for t in _all_menu_labels())
    finally:
        kbmod._MAIN_LABELS = None
        kbmod._MAIN_NORM = None


# ── 6. ring_aware_keyboard keeps styles ───────────────────────────
def _fake_ring(monkeypatch, flag):
    settings = types.SimpleNamespace()

    async def get_flag():
        return flag

    settings.get_flag = get_flag
    settings.flag_sync = lambda: flag
    pkg = types.ModuleType("ring")
    pkg.settings = settings
    monkeypatch.setitem(sys.modules, "ring", pkg)


def test_ring_aware_keyboard_preserves_styles(monkeypatch):
    from backend.bot import utils as bu
    _fake_ring(monkeypatch, True)
    src = bu.admin_keyboard()
    out = asyncio.run(bu.ring_aware_keyboard(src))
    assert out is not src
    ser = _serialized(out)
    assert ser[0] == [(RING_LABEL, "primary")]         # ring button: blue entry
    assert ser[1:] == EXPECTED["admin_keyboard"]       # every style kept
    assert out.resize_keyboard is True
    assert _serialized(src) == EXPECTED["admin_keyboard"]  # original untouched


def test_ring_aware_keyboard_flag_off_returns_same(monkeypatch):
    from backend.bot import utils as bu
    _fake_ring(monkeypatch, False)
    src = bu.main_keyboard()
    assert asyncio.run(bu.ring_aware_keyboard(src)) is src


def test_ring_aware_keyboard_keeps_markup_options(monkeypatch):
    from backend.bot import utils as bu
    _fake_ring(monkeypatch, True)
    src = ReplyKeyboardMarkup([[KeyboardButton("a", api_kwargs={"style": "primary"})]],
                              resize_keyboard=True, one_time_keyboard=True,
                              input_field_placeholder="ph", is_persistent=True, selective=True)
    out = asyncio.run(bu.ring_aware_keyboard(src))
    d = out.to_dict()
    assert d["keyboard"][1][0] == {"text": "a", "style": "primary"}
    assert d["one_time_keyboard"] is True and d["input_field_placeholder"] == "ph"
    assert d["is_persistent"] is True and d["selective"] is True


def test_ring_aware_keyboard_error_falls_back(monkeypatch):
    from backend.bot import utils as bu
    pkg = types.ModuleType("ring")  # no .settings → ImportError inside → fallback
    monkeypatch.setitem(sys.modules, "ring", pkg)
    src = bu.main_keyboard()
    assert asyncio.run(bu.ring_aware_keyboard(src)) is src
