# -*- coding: utf-8 -*-
"""🎨 HumsYar — رنگ‌بندی دکمه‌های تلگرام (Bot API ``style``)

Bot API accepts an optional ``style`` field on ``InlineKeyboardButton`` and
``KeyboardButton``: ``"primary"`` (blue), ``"success"`` (green), ``"danger"``
(red). Omitted = default client colour. Old clients ignore the field.
python-telegram-bot 21.3 has no ``style`` parameter, so it is carried in
``api_kwargs`` — PTB serialises ``api_kwargs`` into ``to_dict()``/``to_json()``
and therefore into the request body (verified by tests/test_ui_buttons.py).

ENV SWITCHES (read on every outgoing request)
=============================================
* ``BUTTON_STYLES_ENABLED`` (default ``1``) — MASTER kill switch. When off,
  ``btn()``/``kbtn()`` stop adding ``style`` AND ``StyledExtBot`` strips every
  ``style`` key from outgoing ``reply_markup`` (explicit ones included), so all
  colours can be disabled by env + restart without a code deploy.
* ``BUTTON_PALETTE_ENABLED`` (default ``1``) — central palette table
  (``backend/bot/button_palette.py``, ``palette_style(text, callback_data,
  kind=)``) colours every button that has no explicit style. No effect when
  the master switch is off. Missing/raising palette module → markup is sent
  unchanged (logged once).
* ``BUTTON_AUTO_STYLES`` (default ``0``) — automatic semantic colouring of
  buttons that are STILL unstyled after the palette pass. OFF by default.

Order in ``StyledExtBot``: master off → strip every style; otherwise
palette pass (if enabled) → keyword auto pass (if enabled). An explicit style
(``btn``/``kbtn``/``style_button``/``add_hero(style=)``) always wins.

EXPLICIT PALETTE (call sites)
=============================
* PRIMARY (blue): main entry actions (main menu: learning group).
* SUCCESS (green): final confirm / pay buttons, subscription/support entries.
* DANGER  (red):   final destructive confirmation (delete/block), admin panels.

AUTO RULES (only when BUTTON_AUTO_STYLES=1; first match wins)
=============================================================
1. Explicit style ALWAYS wins and is never re-evaluated (idempotent).
2. Never styled (→ None):
   • quiz / option / selection callbacks (``answer:``, ``questions:exam_answer:``,
     ``questions:ai_personal_answer:``, ``exam_answer:``, ``ai_personal_answer:``,
     ``btn_disabled:``, ``qd:``, ``questions:sel_*``/``cx_*``/``cr_*``,
     ``quiz:cnt|go|tp|doc:``, ``report:question:``);
   • text starting with 🔒, or with an option marker («الف)», «ب)», «A)», 🅐 …);
   • navigation: 🔙 ◀ ▶ ⬅ ➡ 🏠 ↩ or بازگشت/برگشت/منو/قبلی/بعدی/صفحه/بستن/back/…;
   • cancel words (لغو، انصراف، cancel) and mute toggles (بی‌صدا/mute/unmute) —
     cancelling is NOT destructive, red is reserved for delete/block;
   • a leading ✅ on its own (it is a selection marker).
3. Text keywords (whole words) — only for short labels (<= 28 chars) and never
   for dynamic content callbacks (``faq:``, ``resources:``, ``ref:``):
   • danger:  حذف، مسدود، بلاک، خروج، رد، پاکسازی / delete, remove, block, ban,
              logout, reject, purge — and 🗑 anywhere.
   • success: تأیید/تایید، پرداخت، خرید، ثبت، ذخیره، پذیرش، قبول، شروع، تمدید، بله،
              «ارسال نهایی» / confirm, pay, buy, submit, accept, approve, save,
              start, renew, yes, checkout; «رفع مسدود…»/unblock/unban → success.
   • both: leading ✅ and no 🗑 → success, otherwise danger.
4. callback_data segments (split on ':') when the text gave no signal:
   back/menu/home/prev/next/page/close/cancel → none;
   delete/del/remove/reject/rej/ban/block/logout/purge → danger;
   confirm/approve/appr/pay/buy/submit/save/accept → success.
5. PRIMARY (blue) is NEVER auto-assigned.

Only the ``style`` key is ever added/removed: text, callback_data, url,
web_app, login_url, switch_inline_query*, pay … are carried over untouched.
Styling never raises — on any error the original markup is used.

Central wiring: ``install_button_styles(application.bot)`` (backend/bot/bot.py)
switches the app's bot instance to ``StyledExtBot``.
"""
from __future__ import annotations

import copy
import functools
import importlib
import logging
import os
import re
import sys
from types import MappingProxyType
from typing import Callable, Iterable, Optional, Sequence, Union

from telegram import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
)
from telegram.ext import ExtBot

logger = logging.getLogger(__name__)

PRIMARY = "primary"
SUCCESS = "success"
DANGER = "danger"
VALID_STYLES = frozenset({PRIMARY, SUCCESS, DANGER})

AnyButton = Union[InlineKeyboardButton, KeyboardButton]
AnyMarkup = Union[InlineKeyboardMarkup, ReplyKeyboardMarkup]

_FALSY = ("0", "false", "no", "off", "")


def styles_enabled() -> bool:
    """MASTER switch — ``BUTTON_STYLES_ENABLED=0/false/no/off`` disables ALL
    colours (explicit ones are stripped centrally). Default: on."""
    return os.getenv("BUTTON_STYLES_ENABLED", "1").strip().lower() not in _FALSY


def auto_styles_enabled() -> bool:
    """Automatic semantic colouring — ``BUTTON_AUTO_STYLES=1`` turns it on.
    Default: OFF. Has no effect when the master switch is off."""
    return (styles_enabled()
            and os.getenv("BUTTON_AUTO_STYLES", "0").strip().lower() not in _FALSY)


def palette_enabled() -> bool:
    """Central palette table — ``BUTTON_PALETTE_ENABLED=0`` turns it off.
    Default: ON. Has no effect when the master switch is off."""
    return (styles_enabled()
            and os.getenv("BUTTON_PALETTE_ENABLED", "1").strip().lower() not in _FALSY)


# ──────────────────────────────────────────────────
#  Normalisation / tokenising
# ──────────────────────────────────────────────────
_CHAR_MAP = str.maketrans({
    "ي": "ی", "ك": "ک", "أ": "ا", "إ": "ا", "ۀ": "ه", "ة": "ه",
})
# Arabic diacritics (fathatan..sukun, hamza above/below, superscript alef) + tatweel
_DIACRITICS_RE = re.compile(r"[\u064B-\u065F\u0670\u0640]")
_TOKEN_RE = re.compile(r"[\w\u200c]+")


def _norm(text: str) -> str:
    return _DIACRITICS_RE.sub("", (text or "").translate(_CHAR_MAP)).lower()


def _tokens(text: str) -> list:
    # ZWNJ is dropped inside a token so «پاک‌سازی» matches «پاکسازی», while
    # «پرداخت‌ها» → «پرداختها» still does NOT equal «پرداخت» (whole-word match).
    return [t for t in (x.replace("\u200c", "") for x in _TOKEN_RE.findall(_norm(text))) if t]


def _kwset(words: Iterable[str]) -> frozenset:
    return frozenset(_norm(w).replace("\u200c", "") for w in words)


_NAV_WORDS = _kwset([
    "بازگشت", "برگشت", "منو", "منوی", "قبلی", "بعدی", "صفحه", "صفحه‌ی", "بستن",
    "back", "menu", "home", "next", "prev", "previous", "page", "close",
])
_NAV_EMOJI = ("🔙", "◀", "▶", "⬅", "➡", "🏠", "↩")

# Cancel / mute → never coloured (cancelling is not destructive).
_CANCEL_WORDS = _kwset(["لغو", "انصراف", "cancel"])
_MUTE_WORDS = _kwset(["بی‌صدا", "بیصدا", "mute", "unmute"])

_DANGER_WORDS = _kwset([
    "حذف", "مسدود", "بلاک", "خروج", "رد", "پاکسازی",
    "delete", "remove", "block", "ban", "logout", "reject", "purge",
])
_DANGER_PHRASES = tuple(_norm(p) for p in ("log out",))
_DANGER_EMOJI = ("🗑",)

_SUCCESS_WORDS = _kwset([
    "تأیید", "تایید", "پرداخت", "خرید", "ثبت", "ذخیره", "پذیرش", "قبول", "شروع",
    "تمدید", "بله",
    "confirm", "pay", "buy", "submit", "accept", "approve", "save", "start",
    "renew", "yes", "checkout",
])
_SUCCESS_PHRASES = tuple(_norm(p) for p in ("ارسال نهایی",))
# Checked before danger: lifting a block is a positive action.
_UNBLOCK_PHRASES = tuple(_norm(p) for p in ("رفع مسدود", "unblock", "unban"))

_CB_NAV = frozenset({"back", "menu", "home", "prev", "next", "page", "close", "cancel"})
_CB_DANGER = frozenset({"delete", "del", "remove", "reject", "rej",
                        "ban", "block", "logout", "purge"})
_CB_SUCCESS = frozenset({"confirm", "approve", "appr", "pay", "buy", "submit",
                         "save", "accept"})

# Quiz options / answer choices / selection lists — never auto-coloured.
# (prefixes taken from backend/bot/questions.py and services/hooshyar_quiz.py)
_NO_STYLE_CB_PREFIXES = (
    "answer:", "questions:exam_answer:", "questions:ai_personal_answer:",
    "exam_answer:", "ai_personal_answer:", "btn_disabled:",
    "qd:", "questions:sel_", "questions:cx_", "questions:cr_",
    "quiz:cnt:", "quiz:go:", "quiz:tp:", "quiz:doc:",
    "report:question:",
)
# Dynamic content (FAQ titles, resource / book names): text keywords ignored.
_CONTENT_CB_PREFIXES = ("faq:", "resources:", "ref:")
# «الف) …», «ب- …», «A) …», «1) …», 🅐 … — answer-option labels.
_OPTION_MARK_RE = re.compile(
    r"^\s*(?:[🅐🅑🅒🅓🅔]|(?:الف|ب|پ|ج|د|ه|[A-Ea-e]|[1-9۱-۹١-٩])\s*[)\-–.:])"
)
MAX_AUTO_TEXT_LEN = 28


# ──────────────────────────────────────────────────
#  Button helpers
# ──────────────────────────────────────────────────
def get_style(button: AnyButton) -> Optional[str]:
    """The explicit style already on a button (None if unstyled)."""
    kw = getattr(button, "api_kwargs", None) or {}
    val = kw.get("style")
    return val if val in VALID_STYLES else None


def style_button(button: AnyButton, style: Optional[str]) -> AnyButton:
    """Return a copy of *button* with ``style`` set (or removed if None).

    The original (frozen) button is never mutated. Every other field — text,
    callback_data, url, web_app, login_url, pay, … — is preserved as-is.
    """
    if style is not None and style not in VALID_STYLES:
        raise ValueError(f"invalid button style: {style!r}")
    kw = dict(getattr(button, "api_kwargs", None) or {})
    if style is None:
        if "style" not in kw:
            return button
        kw.pop("style", None)
    else:
        if kw.get("style") == style:
            return button
        kw["style"] = style
    new = copy.copy(button)
    with new._unfrozen():  # PTB's own idiom for copying frozen objects
        new.api_kwargs = MappingProxyType(kw)
    return new


def _api_kwargs_with_style(style: Optional[str], kwargs: dict) -> Optional[dict]:
    if style is not None and style not in VALID_STYLES:
        raise ValueError(f"invalid button style: {style!r}")
    api_kwargs = dict(kwargs.pop("api_kwargs", None) or {})
    if style is not None and styles_enabled():
        api_kwargs["style"] = style
    return api_kwargs or None


def btn(text: str, *, style: Optional[str] = None, **kwargs) -> InlineKeyboardButton:
    """``InlineKeyboardButton`` with an explicit ``style`` (primary/success/danger).

    ``btn("💳 خرید", callback_data="sub:back", style=SUCCESS)``
    The style is omitted when ``BUTTON_STYLES_ENABLED=0``.
    """
    api_kwargs = _api_kwargs_with_style(style, kwargs)
    return InlineKeyboardButton(text, api_kwargs=api_kwargs, **kwargs)


def kbtn(text: str, *, style: Optional[str] = None, **kwargs) -> KeyboardButton:
    """``KeyboardButton`` (reply keyboard) with an explicit ``style``."""
    api_kwargs = _api_kwargs_with_style(style, kwargs)
    return KeyboardButton(text, api_kwargs=api_kwargs, **kwargs)


# ──────────────────────────────────────────────────
#  Semantic rules (pure — no env)
# ──────────────────────────────────────────────────
def _has_phrase(joined: str, phrases: Sequence[str]) -> bool:
    return any(f" {p}" in joined for p in phrases)


def semantic_style(text: str, callback_data: object = None) -> Optional[str]:
    """Pure rule engine: style for a button text/callback_data (None = default)."""
    raw = text or ""
    stripped = raw.strip()
    cb = callback_data if isinstance(callback_data, str) else ""

    # 2) never styled
    if cb.startswith(_NO_STYLE_CB_PREFIXES):
        return None
    if stripped.startswith("🔒") or _OPTION_MARK_RE.match(stripped):
        return None
    toks = _tokens(raw)
    tokset = set(toks)
    joined = " " + " ".join(toks)
    if any(e in raw for e in _NAV_EMOJI) or tokset & _NAV_WORDS:
        return None
    if tokset & _CANCEL_WORDS or tokset & _MUTE_WORDS:
        return None

    # 3) text keywords — short, non-content labels only
    if len(stripped) <= MAX_AUTO_TEXT_LEN and not cb.startswith(_CONTENT_CB_PREFIXES):
        if _has_phrase(joined, _UNBLOCK_PHRASES):
            return SUCCESS
        bin_emoji = any(e in raw for e in _DANGER_EMOJI)
        danger = (bool(tokset & _DANGER_WORDS) or _has_phrase(joined, _DANGER_PHRASES)
                  or bin_emoji)
        success = bool(tokset & _SUCCESS_WORDS) or _has_phrase(joined, _SUCCESS_PHRASES)
        lead_ok = stripped.startswith(("✅", "☑", "✔"))
        if danger and success:
            return SUCCESS if lead_ok and not bin_emoji else DANGER
        if danger:
            return DANGER
        if success:
            return SUCCESS

    # 4) callback_data fallback
    if cb:
        segs = {s.strip().lower() for s in cb.split(":")}
        if segs & _CB_NAV:
            return None
        if segs & _CB_DANGER:
            return DANGER
        if segs & _CB_SUCCESS:
            return SUCCESS
    return None


def _auto_style_button(button: AnyButton) -> AnyButton:
    if not isinstance(button, (InlineKeyboardButton, KeyboardButton)):
        return button  # reply keyboards may contain plain strings
    if get_style(button) is not None:  # 1) explicit wins
        return button
    style = semantic_style(getattr(button, "text", ""),
                           getattr(button, "callback_data", None))
    return style_button(button, style) if style else button


def _strip_button(button: AnyButton) -> AnyButton:
    if not isinstance(button, (InlineKeyboardButton, KeyboardButton)):
        return button
    kw = getattr(button, "api_kwargs", None) or {}
    return style_button(button, None) if "style" in kw else button


def _map_markup(markup, fn: Callable[[AnyButton], AnyButton]):
    if isinstance(markup, InlineKeyboardMarkup):
        attr = "inline_keyboard"
    elif isinstance(markup, ReplyKeyboardMarkup):
        attr = "keyboard"
    else:
        return markup
    rows = getattr(markup, attr) or ()
    new_rows = tuple(tuple(fn(b) for b in row) for row in rows)
    if all(n is o for nr, r in zip(new_rows, rows) for n, o in zip(nr, r)):
        return markup  # nothing to change
    new = copy.copy(markup)
    with new._unfrozen():
        setattr(new, attr, new_rows)
    return new


def apply_semantic_styles(markup):
    """Return a NEW markup with semantic styles applied (original untouched).

    Pure (ignores env). Accepts InlineKeyboardMarkup / ReplyKeyboardMarkup;
    anything else (None, ForceReply, ReplyKeyboardRemove, raw dicts) is
    returned unchanged. Never raises — on error the original markup is returned.
    """
    try:
        return _map_markup(markup, _auto_style_button)
    except Exception:  # pragma: no cover — styling must never break a send
        logger.exception("apply_semantic_styles failed — sending unstyled markup")
        return markup


def strip_styles(markup):
    """Return a markup with every ``style`` key removed (same object if none)."""
    try:
        return _map_markup(markup, _strip_button)
    except Exception:  # pragma: no cover
        logger.exception("strip_styles failed — sending markup as-is")
        return markup


# ──────────────────────────────────────────────────
#  Central palette table (backend/bot/button_palette.py)
# ──────────────────────────────────────────────────
PALETTE_MODULE = "backend.bot.button_palette"
_palette_state = {"import_failed": False}
_logged_once: set = set()


def _log_once(key: str, msg: str, *args, exc_info: bool = True) -> None:
    if key in _logged_once:
        return
    _logged_once.add(key)
    logger.warning(msg, *args, exc_info=exc_info)


def _palette_callable():
    """``palette_style`` of the palette module, imported lazily; None if the
    module is missing / broken (logged once, import not retried)."""
    mod = sys.modules.get(PALETTE_MODULE)
    if mod is None:
        if _palette_state["import_failed"]:
            return None
        try:
            mod = importlib.import_module(PALETTE_MODULE)
        except Exception:
            _palette_state["import_failed"] = True
            _log_once("palette-import", "🎨 button palette unavailable (%s) — "
                      "palette colours skipped", PALETTE_MODULE)
            return None
    fn = getattr(mod, "palette_style", None)
    if not callable(fn):
        _log_once("palette-attr", "🎨 %s has no callable palette_style — "
                  "palette colours skipped", PALETTE_MODULE, exc_info=False)
        return None
    return fn


@functools.lru_cache(maxsize=4096)
def _cached_palette_style(fn, text: str, callback_data: Optional[str], kind: str) -> Optional[str]:
    # Palette lookups are pure → memoised per (text, callback_data, kind).
    # ``fn`` is part of the key so a swapped module (tests / reload) never
    # serves stale entries. Exceptions are not cached by lru_cache.
    style = fn(text, callback_data, kind=kind)
    return style if style in VALID_STYLES else None


def _palette_button(fn, button: AnyButton) -> AnyButton:
    if isinstance(button, InlineKeyboardButton):
        kind = "inline"
        cb = button.callback_data if isinstance(button.callback_data, str) else None
    elif isinstance(button, KeyboardButton):
        kind, cb = "reply", None
    else:
        return button
    if get_style(button) is not None:  # explicit wins
        return button
    style = _cached_palette_style(fn, str(button.text or ""), cb, kind)
    return style_button(button, style) if style else button


def apply_palette_styles(markup):
    """Return a markup where every unstyled button got its palette style
    (same object when nothing changes). Ignores env. Never raises: if the
    palette module is missing or raises, the ORIGINAL markup is returned."""
    if not isinstance(markup, (InlineKeyboardMarkup, ReplyKeyboardMarkup)):
        return markup
    try:
        fn = _palette_callable()
        if fn is None:
            return markup
        return _map_markup(markup, lambda b: _palette_button(fn, b))
    except Exception:
        _log_once("palette-call", "🎨 palette_style raised — sending markup unchanged")
        return markup


# ──────────────────────────────────────────────────
#  Central wiring (bot instance level)
# ──────────────────────────────────────────────────
class StyledExtBot(ExtBot):
    """ExtBot that post-processes every outgoing ``reply_markup``.

    * master switch off → strip all ``style`` keys (kill switch, no deploy);
    * palette on (default) → palette-table style for unstyled buttons;
    * auto styles on    → semantic styles for buttons still unstyled;
    * explicit styles always go through as built.

    Hooks ``_insert_defaults`` — the single place every Bot API call's params
    pass through in ``Bot._post`` (send_*, edit_message_*, copy_message, …)
    right before serialisation. No new attributes (``__slots__ = ()``) so an
    existing ExtBot instance can be switched to it safely.
    """

    __slots__ = ()

    def _insert_defaults(self, data):  # type: ignore[override]
        super()._insert_defaults(data)
        try:
            rm = data.get("reply_markup")
            if not isinstance(rm, (InlineKeyboardMarkup, ReplyKeyboardMarkup)):
                return
            if not styles_enabled():
                data["reply_markup"] = strip_styles(rm)
                return
            out = rm
            if palette_enabled():
                out = apply_palette_styles(out)
            if auto_styles_enabled():
                out = apply_semantic_styles(out)
            if out is not rm:
                data["reply_markup"] = out
        except Exception:  # pragma: no cover
            logger.exception("StyledExtBot: styling skipped")


def install_button_styles(bot) -> bool:
    """Switch an existing ExtBot instance to StyledExtBot (instance-scoped,
    not a global PTB monkeypatch). Installed regardless of the env switches so
    the master kill switch can strip styles. Returns True if installed."""
    if isinstance(bot, StyledExtBot):
        return True
    if type(bot) is not ExtBot:  # unknown subclass — don't touch it
        logger.warning("🎨 button styles not installed: unexpected bot type %s", type(bot))
        return False
    try:
        bot.__class__ = StyledExtBot
        logger.info("🎨 button styles hook installed (styles=%s, palette=%s, auto=%s)",
                    styles_enabled(), palette_enabled(), auto_styles_enabled())
        return True
    except Exception:  # pragma: no cover
        logger.exception("🎨 install_button_styles failed")
        return False


__all__ = [
    "PRIMARY", "SUCCESS", "DANGER", "VALID_STYLES",
    "btn", "kbtn", "style_button", "get_style", "semantic_style",
    "apply_semantic_styles", "strip_styles", "StyledExtBot",
    "install_button_styles", "styles_enabled", "auto_styles_enabled",
    "palette_enabled", "apply_palette_styles",
]
