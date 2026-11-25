# -*- coding: utf-8 -*-
"""Tests for backend/bot/button_palette.py — the central button colour table.

Pure: no network, no telegram import. The source tree is scanned so the table
cannot drift away from the real labels / callback_data in the code.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest  # noqa: E402

from backend.bot import button_palette as bp  # noqa: E402
from backend.bot.button_palette import (  # noqa: E402
    CALLBACK_EXACT,
    CALLBACK_PREFIX,
    DANGER,
    INLINE_PAIR_STYLES,
    NEVER_CALLBACK_EXACT,
    NEVER_PREFIX,
    PRIMARY,
    REPLY_LABEL_STYLES,
    SUCCESS,
    URL_LABEL_STYLES,
    palette_style,
)

BACKEND = ROOT / "backend"
UTILS = BACKEND / "bot" / "utils.py"
RING_KB = BACKEND / "services" / "ring" / "keyboards.py"
VALID = {PRIMARY, SUCCESS, DANGER}


# ── source scan helpers ─────────────────────────────────────────
def _read(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return ""


_SOURCES = {p: _read(p) for p in BACKEND.rglob("*.py") if "__pycache__" not in p.parts}
ALL_SRC = "\n".join(_SOURCES.values())
RING_SRC = _read(RING_KB)

# callback_data='...' / "..." literals (incl. f-strings → static head before "{")
_CB_RE = re.compile(r"""callback_data\s*=\s*(f?)(["'])((?:(?!\2).)*)\2""")
# ring keyboards build callbacks as CB + "xxx" / f"{CB}xxx"
_RING_RE = re.compile(r"""(?:CB\s*\+\s*(["'])((?:(?!\1).)*)\1|f(["'])\{CB\}((?:(?!\3).)*)\3)""")


def _scan_callbacks() -> set[str]:
    out: set[str] = set()
    for src in _SOURCES.values():
        for m in _CB_RE.finditer(src):
            val = m.group(3)
            if m.group(1):
                val = val.split("{", 1)[0]
            if val:
                out.add(val)
    for m in _RING_RE.finditer(RING_SRC):
        val = m.group(2) if m.group(2) is not None else m.group(4).split("{", 1)[0]
        out.add("ring:" + val)
    return out


SCANNED = _scan_callbacks()

QUIZ_ANSWER_PREFIXES = (
    "answer:", "questions:exam_answer:", "questions:ai_personal_answer:",
    "exam_answer:", "ai_personal_answer:", "btn_disabled:",
)
# whole-word only, so "backup:" / "ai_fallback" are not mistaken for back buttons
_PROTECTED_WORD = re.compile(
    r"(?<![a-z])(back|cancel|home|main_menu|menu|noop|page|close_msg|skip)(?![a-z])", re.I)
# callbacks that contain a "protected" word but are real coloured actions
_PROTECTED_ALLOW = frozenset({
    "ticket:admin_close_confirm:",
})


def _is_protected(cb: str) -> bool:
    if cb.startswith(QUIZ_ANSWER_PREFIXES):
        return True
    if any(cb.startswith(a) for a in _PROTECTED_ALLOW):
        return False
    return bool(_PROTECTED_WORD.search(cb))


PROTECTED = sorted(cb for cb in SCANNED if _is_protected(cb))


def _in_source(key: str) -> bool:
    if key in ALL_SRC:
        return True
    if key.startswith("ring:"):
        tail = key[len("ring:"):]
        return f'"{tail}' in RING_SRC or f"'{tail}" in RING_SRC or f"}}{tail}" in RING_SRC
    return False


# ── sanity of the scan itself ───────────────────────────────────
def test_scan_found_callbacks_and_quiz_answers():
    assert len(SCANNED) > 200
    assert any(cb.startswith(QUIZ_ANSWER_PREFIXES) for cb in SCANNED)
    assert PROTECTED, "scan should find back/cancel/quiz callbacks"


# ── style values ────────────────────────────────────────────────
@pytest.mark.parametrize("table", [
    REPLY_LABEL_STYLES, CALLBACK_EXACT, URL_LABEL_STYLES, INLINE_PAIR_STYLES,
], ids=["reply", "exact", "url", "pair"])
def test_every_style_value_valid(table):
    bad = {k: v for k, v in table.items() if v not in VALID}
    assert not bad


def test_prefix_styles_valid_and_unique():
    assert all(s in VALID for _, s in CALLBACK_PREFIX)
    pfx = [p for p, _ in CALLBACK_PREFIX]
    assert len(pfx) == len(set(pfx)), "duplicate prefix"
    assert all(p and p.endswith((":", "_")) for p in pfx), "prefix must end at a separator"


# ── table entries really exist in the code ──────────────────────
def test_callback_exact_keys_occur_in_source():
    missing = [k for k in CALLBACK_EXACT if not _in_source(k)]
    assert not missing, missing


def test_callback_prefixes_occur_in_source():
    missing = [p for p, _ in CALLBACK_PREFIX if not _in_source(p)]
    assert not missing, missing


def test_pair_callbacks_and_labels_occur_in_source():
    missing = [(t, cb) for (t, cb) in INLINE_PAIR_STYLES
               if t not in ALL_SRC or cb not in ALL_SRC]
    assert not missing, missing


def _string_constants(src: str) -> list[str]:
    """Evaluated str literals (so "\\u200d" escapes in source compare byte-exact)."""
    import ast
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return []
    return [n.value for n in ast.walk(tree)
            if isinstance(n, ast.Constant) and isinstance(n.value, str)]


def test_reply_labels_verbatim_in_utils_or_ring():
    srcs = (_read(UTILS), RING_SRC)
    hay = "\n".join(srcs) + "\n" + "\n".join(
        c for s in srcs for c in _string_constants(s))
    missing = [k for k in REPLY_LABEL_STYLES if k not in hay]
    assert not missing, missing
    missing_none = [k for k in bp.EXPLICIT_NONE_REPLY_LABELS if k not in hay]
    assert not missing_none, missing_none


def test_url_labels_occur_in_source():
    missing = [k for k in URL_LABEL_STYLES if k not in ALL_SRC]
    assert not missing, missing


def test_staff_labels_contain_zwj_and_are_danger():
    admin = "\U0001F468\u200d\u2695\ufe0f پنل ادمین"
    assert admin in REPLY_LABEL_STYLES and "\u200d" in admin
    assert REPLY_LABEL_STYLES[admin] == DANGER
    assert REPLY_LABEL_STYLES["🎓 پنل محتوا"] == DANGER
    assert "💍 رینگ استریت" not in REPLY_LABEL_STYLES


# ── no styled entry may touch quiz / back / cancel callbacks ────
def test_no_prefix_matches_protected_callbacks():
    hits = [(p, cb) for p, _ in CALLBACK_PREFIX for cb in PROTECTED if cb.startswith(p)]
    assert not hits, hits


def test_no_exact_key_is_protected():
    hits = [k for k in CALLBACK_EXACT if _is_protected(k)]
    assert not hits, hits


def test_styled_entries_not_shadowed_by_never():
    dead = [k for k in CALLBACK_EXACT if k in NEVER_CALLBACK_EXACT or k.startswith(NEVER_PREFIX)]
    dead += [p for p, _ in CALLBACK_PREFIX if p.startswith(NEVER_PREFIX)]
    assert not dead, dead


def test_scanned_protected_callbacks_resolve_to_none():
    # Using a neutral label: any scanned back/cancel/quiz callback is uncoloured.
    styled = [cb for cb in PROTECTED
              if palette_style("x", cb + "1", kind="inline") is not None
              or palette_style("x", cb, kind="inline") is not None]
    assert not styled, styled


# ── palette_style behaviour ─────────────────────────────────────
@pytest.mark.parametrize("cb", [
    "answer:0:1", "questions:exam_answer:3", "questions:ai_personal_answer:2",
    "exam_answer:1", "ai_personal_answer:0", "btn_disabled:x",
    "resources:term:1", "faq:item:4", "admin:users:2",
    "admin:bc_cancel", "register:cancel", "ring:t:no", "ls:cancel:9",
])
def test_never_cases_return_none(cb):
    assert palette_style("✅ تایید", cb, kind="inline") is None


@pytest.mark.parametrize("text", ["🔙 بازگشت", "🏠 منوی اصلی", "❌ لغو", "❌ انصراف", "◀️ قبلی"])
def test_never_text_wins_over_styled_callback(text):
    assert palette_style(text, "admin:delete_user:1", kind="inline") is None
    assert palette_style(text, "sub:back", kind="inline") is None


def test_never_prefix_wins_over_styled_prefix():
    for pfx in NEVER_PREFIX:
        assert palette_style("x", pfx + "1", kind="inline") is None


def test_exact_beats_prefix_and_basic_lookups():
    assert palette_style("x", "ring:block:yes", kind="inline") == DANGER
    assert palette_style("x", "sub:plan:monthly", kind="inline") == SUCCESS
    assert palette_style("x", "questions:weak", kind="inline") == PRIMARY
    assert palette_style("x", "unknown:cb", kind="inline") is None
    assert palette_style("x", "", kind="inline") is None


def test_longest_prefix_wins():
    prefixes = (("x:", PRIMARY), ("x:del:", DANGER), ("x:del:ok:", SUCCESS))
    for order in (prefixes, prefixes[::-1]):
        assert bp._lookup("x:del:ok:1", {}, order) == SUCCESS
        assert bp._lookup("x:del:1", {}, order) == DANGER
        assert bp._lookup("x:open", {}, order) == PRIMARY
    assert bp._lookup("x:del:1", {"x:del:1": PRIMARY}, prefixes) == PRIMARY
    # real table: the longest overlapping prefix is the one chosen
    assert palette_style("x", "questions:ca_q_purge_yes:9", kind="inline") == DANGER
    assert palette_style("x", "ca:confirm_del_lesson:3", kind="inline") == DANGER


def test_reply_and_url_lookups():
    assert palette_style("🩺 داشبورد", None, kind="reply") == PRIMARY
    assert palette_style("💎 اشتراک ویژه", None, kind="reply") == SUCCESS
    assert palette_style("💍 رینگ استریت", None, kind="reply") is None
    assert palette_style("📅 برنامه", None, kind="reply") is None
    # reply lookup ignores callbacks; inline lookup ignores reply table
    assert palette_style("🩺 داشبورد", None, kind="inline") is None
    assert palette_style("💙 حمایت مالی", None, kind="inline") == SUCCESS
    assert palette_style("🌐 سایت", None, kind="inline") is None
    assert palette_style("🩺 داشبورد", None, kind="other") is None


def test_pair_styles_for_shared_callbacks():
    assert palette_style("💳 خرید اشتراک", "sub:back", kind="inline") == PRIMARY
    assert palette_style("🔄 تمدید کن", "sub:back", kind="inline") == SUCCESS
    assert palette_style("🔙 بازگشت به پلن" + "\u200c" + "ها", "sub:back", kind="inline") is None
    assert palette_style("هر چیز", "sub:back", kind="inline") is None
    assert palette_style("هر چیز", "ca:main", kind="inline") is None


def test_total_for_odd_inputs():
    assert palette_style(None, None, kind="inline") is None  # type: ignore[arg-type]
    assert palette_style("", "answer:1", kind="inline") is None
