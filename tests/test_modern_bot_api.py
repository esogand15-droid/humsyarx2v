# -*- coding: utf-8 -*-
"""Unit tests for Modern Bot API UI components, rich buttons, ephemeral alerts,

expandable quote blocks, and compact tables (F1 to F5).
Guaranteed dual-runner compatibility with pytest and python -m unittest.
"""

from __future__ import annotations

import asyncio
import os
import sys
import unittest
from typing import Any, Dict, List, Optional

os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017/humsyar_test")
os.environ.setdefault("ADMIN_ID", "999")
os.environ.setdefault("TELEGRAM_TOKEN", "123:TEST_TOKEN")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.constants import MessageEntityType

from backend.bot.bot_modern_ui import (
    ButtonGridBuilder,
    CompactTableBuilder,
    EphemeralOverlayHelper,
    TelegramBotApiBridge,
)
from backend.services.ai_solver import _md_to_telegram_html
from backend.bot.bot import handle_disabled_button_tap


# ─────────────────────────────────────────────────────────────
# High-Fidelity In-Memory Mocks for Telegram Interactions
# ─────────────────────────────────────────────────────────────

class MockUser:
    def __init__(self, user_id: int = 1001, full_name: str = "دکتر آزمایشی", username: str = "dr_test"):
        self.id = user_id
        self.full_name = full_name
        self.first_name = full_name.split()[0]
        self.username = username
        self.is_bot = False


class MockChat:
    def __init__(self, chat_id: int = 1001, chat_type: str = "private"):
        self.id = chat_id
        self.type = chat_type


class MockMessage:
    def __init__(
        self,
        message_id: int = 501,
        chat_id: int = 1001,
        text: str = "",
        reply_markup: Optional[InlineKeyboardMarkup] = None,
        parse_mode: str = "HTML",
    ):
        self.message_id = message_id
        self.chat_id = chat_id
        self.chat = MockChat(chat_id)
        self.text = text
        self.reply_markup = reply_markup
        self.parse_mode = parse_mode
        self.edits: List[Dict[str, Any]] = []
        self.replies: List[MockMessage] = []
        self.deleted = False

    async def reply_text(self, text: str, reply_markup: Optional[InlineKeyboardMarkup] = None, parse_mode: str = "HTML", **kwargs: Any) -> MockMessage:
        new_msg = MockMessage(self.message_id + 1, self.chat_id, text, reply_markup, parse_mode)
        self.replies.append(new_msg)
        return new_msg

    async def edit_text(self, text: str, reply_markup: Optional[InlineKeyboardMarkup] = None, parse_mode: str = "HTML", **kwargs: Any) -> MockMessage:
        self.text = text
        if reply_markup is not None:
            self.reply_markup = reply_markup
        self.parse_mode = parse_mode
        self.edits.append({"text": text, "reply_markup": reply_markup, "parse_mode": parse_mode})
        return self

    async def edit_reply_markup(self, reply_markup: Optional[InlineKeyboardMarkup] = None) -> MockMessage:
        self.reply_markup = reply_markup
        self.edits.append({"reply_markup": reply_markup})
        return self

    async def delete(self) -> bool:
        self.deleted = True
        return True


class MockCallbackQuery:
    def __init__(self, data: str, user_id: int = 1001, message: Optional[MockMessage] = None):
        self.id = "query_cb_99"
        self.data = data
        self.from_user = MockUser(user_id)
        self.message = message or MockMessage(chat_id=user_id)
        self.answers: List[Dict[str, Any]] = []

    async def answer(self, text: Optional[str] = None, show_alert: bool = False, **kwargs: Any) -> bool:
        self.answers.append({"text": text, "show_alert": show_alert, **kwargs})
        return True

    async def edit_message_text(self, text: str, reply_markup: Optional[InlineKeyboardMarkup] = None, parse_mode: str = "HTML", **kwargs: Any) -> MockMessage:
        return await self.message.edit_text(text, reply_markup=reply_markup, parse_mode=parse_mode, **kwargs)


class MockUpdate:
    def __init__(self, user_id: int = 1001, message: Optional[MockMessage] = None, callback_query: Optional[MockCallbackQuery] = None):
        self.effective_user = MockUser(user_id)
        self.effective_chat = MockChat(user_id)
        self.message = message
        self.callback_query = callback_query


class MockBot:
    def __init__(self):
        self.sent_messages: List[MockMessage] = []
        self.do_api_requests: List[Dict[str, Any]] = []

    async def send_message(self, chat_id: int, text: str, parse_mode: str = "HTML", reply_markup: Optional[InlineKeyboardMarkup] = None, **kwargs: Any) -> MockMessage:
        msg = MockMessage(message_id=len(self.sent_messages) + 100, chat_id=chat_id, text=text, reply_markup=reply_markup, parse_mode=parse_mode)
        self.sent_messages.append(msg)
        return msg

    async def do_api_request(self, method: str, api_kwargs: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        req = {"method": method, "api_kwargs": api_kwargs or {}}
        self.do_api_requests.append(req)
        return {"ok": True, "result": req}


class MockContext:
    def __init__(self):
        self.bot = MockBot()
        self.user_data: Dict[str, Any] = {}
        self.chat_data: Dict[str, Any] = {}


# ─────────────────────────────────────────────────────────────
# Test Suite: Modern Bot API Payloads & Features (F1 - F5)
# ─────────────────────────────────────────────────────────────

class TestModernBotApi(unittest.IsolatedAsyncioTestCase):
    """Systematic test suite covering F1, F2, F3, F4, and F5 modern Bot API capabilities."""

    # ─────────────────────────────────────────────────────────
    # F1: Rich Message Buttons & Grid Alignment
    # ─────────────────────────────────────────────────────────

    def test_f1_hero_button_structure(self):
        """Verify full-width hero button occupies its own row."""
        builder = ButtonGridBuilder()
        builder.add_hero("🚀 شروع آزمون جامع", callback_data="exam:start")
        markup = builder.build()
        self.assertIsInstance(markup, InlineKeyboardMarkup)
        self.assertEqual(len(markup.inline_keyboard), 1)
        self.assertEqual(len(markup.inline_keyboard[0]), 1)
        btn = markup.inline_keyboard[0][0]
        self.assertEqual(btn.text, "🚀 شروع آزمون جامع")
        self.assertEqual(btn.callback_data, "exam:start")

    def test_f1_hero_button_with_url_and_webapp(self):
        """Verify hero button supports external URLs and WebAppInfo."""
        builder = ButtonGridBuilder()
        builder.add_hero("🌐 وب‌اپ دانشجویی", url="https://humsyar.ir/pwa/")
        builder.add_hero("📱 مینی‌اپ تلگرام", web_app="https://humsyar.ir/miniapp/")
        markup = builder.build()
        self.assertEqual(len(markup.inline_keyboard), 2)
        btn_url = markup.inline_keyboard[0][0]
        self.assertEqual(btn_url.url, "https://humsyar.ir/pwa/")
        btn_wapp = markup.inline_keyboard[1][0]
        self.assertIsInstance(btn_wapp.web_app, WebAppInfo)
        self.assertEqual(btn_wapp.web_app.url, "https://humsyar.ir/miniapp/")

    def test_f1_split_grid_alignment(self):
        """Verify multi-column balanced rows (2-column and 3-column splits)."""
        builder = ButtonGridBuilder()
        btn1 = InlineKeyboardButton("پزشکی عمومی", callback_data="field:gp")
        btn2 = InlineKeyboardButton("دندانپزشکی", callback_data="field:dent")
        builder.add_split(btn1, btn2)
        btn_a = InlineKeyboardButton("آسان 🟢", callback_data="diff:easy")
        btn_b = InlineKeyboardButton("متوسط 🟡", callback_data="diff:med")
        btn_c = InlineKeyboardButton("سخت 🔴", callback_data="diff:hard")
        builder.add_split(btn_a, btn_b, btn_c)

        markup = builder.build()
        self.assertEqual(len(markup.inline_keyboard), 2)
        self.assertEqual(len(markup.inline_keyboard[0]), 2)
        self.assertEqual(len(markup.inline_keyboard[1]), 3)
        self.assertEqual(markup.inline_keyboard[0][0].text, "پزشکی عمومی")
        self.assertEqual(markup.inline_keyboard[1][2].text, "سخت 🔴")

    def test_f1_split_row_tuples(self):
        """Verify adding split rows directly from (label, callback_data) tuples."""
        builder = ButtonGridBuilder()
        builder.add_split_row([
            ("📖 جزوات", "res:notes"),
            ("🧪 بانک تست", "res:tests"),
        ])
        markup = builder.build()
        self.assertEqual(len(markup.inline_keyboard), 1)
        self.assertEqual(len(markup.inline_keyboard[0]), 2)
        self.assertEqual(markup.inline_keyboard[0][0].callback_data, "res:notes")
        self.assertEqual(markup.inline_keyboard[0][1].callback_data, "res:tests")

    def test_f1_rtl_navigation_row(self):
        """Verify RTL-aware navigation bar layout (left=next, right=prev)."""
        builder = ButtonGridBuilder()
        builder.add_nav(prev_cb="page:2", home_cb="page:home", next_cb="page:0")
        markup = builder.build()
        self.assertEqual(len(markup.inline_keyboard), 1)
        nav_row = markup.inline_keyboard[0]
        self.assertEqual(len(nav_row), 3)
        self.assertEqual(nav_row[0].text, "صفحه بعد ◀️")
        self.assertEqual(nav_row[0].callback_data, "page:2")
        self.assertEqual(nav_row[1].text, "🏠 منو")
        self.assertEqual(nav_row[1].callback_data, "page:home")
        self.assertEqual(nav_row[2].text, "▶️ صفحه قبل")
        self.assertEqual(nav_row[2].callback_data, "page:0")

    def test_f1_fluent_chaining_combined_grid(self):
        """Verify fluent chaining constructs complex 4-row keyboard."""
        kb = (
            ButtonGridBuilder()
            .add_hero("🏆 آزمون جامع هفتگی", callback_data="exam:weekly")
            .add_split_row([("📊 کارنامه", "user:grades"), ("📅 برنامه", "user:sched")])
            .add_disabled("ویژه اعضای VIP", reason="نیازمند ارتقا به اشتراک طلایی")
            .add_nav(prev_cb="p:next", home_cb="p:main")
            .build()
        )
        self.assertEqual(len(kb.inline_keyboard), 4)
        self.assertTrue(kb.inline_keyboard[2][0].text.startswith("🔒"))

    # ─────────────────────────────────────────────────────────
    # F2: Disabled Inline Button States & Alerts
    # ─────────────────────────────────────────────────────────

    def test_f2_disabled_button_lock_badge(self):
        """Verify disabled button automatically includes 🔒 prefix."""
        builder = ButtonGridBuilder()
        builder.add_disabled("بانک سؤالات پری‌انترنی")
        markup = builder.build()
        btn = markup.inline_keyboard[0][0]
        self.assertTrue(btn.text.startswith("🔒 "))
        self.assertIn("بانک سؤالات پری‌انترنی", btn.text)

    def test_f2_disabled_callback_schema_and_length_limit(self):
        """Verify disabled button callback data starts with btn_disabled: and fits in 64 bytes."""
        builder = ButtonGridBuilder()
        long_reason = "این دوره آموزشی فقط مخصوص دانشجویان ترم‌های بالینی فیزیوپاتولوژی به بعد می‌باشد."
        builder.add_disabled("دوره پیشرفته", reason=long_reason)
        markup = builder.build()
        btn = markup.inline_keyboard[0][0]
        self.assertTrue(btn.callback_data.startswith("btn_disabled:"))
        self.assertLessEqual(len(btn.callback_data.encode("utf-8")), 64)

    async def test_f2_disabled_button_tap_handler_modal_alert(self):
        """Verify tapping a disabled button invokes query.answer with show_alert=True."""
        cb_query = MockCallbackQuery("btn_disabled:ظرفیت این دوره تکمیل شده است.")
        update = MockUpdate(callback_query=cb_query)
        context = MockContext()

        await handle_disabled_button_tap(update, context)

        self.assertEqual(len(cb_query.answers), 1)
        ans = cb_query.answers[0]
        self.assertTrue(ans["show_alert"])
        self.assertEqual(ans["text"], "ظرفیت این دوره تکمیل شده است.")

    async def test_f2_disabled_button_tap_default_fallback_reason(self):
        """Verify empty reason in callback data falls back gracefully."""
        cb_query = MockCallbackQuery("btn_disabled:")
        update = MockUpdate(callback_query=cb_query)
        context = MockContext()

        await handle_disabled_button_tap(update, context)

        self.assertEqual(len(cb_query.answers), 1)
        ans = cb_query.answers[0]
        self.assertTrue(ans["show_alert"])
        self.assertIn("غیرفعال", ans["text"])

    async def test_f2_disabled_button_tap_no_state_corruption(self):
        """Verify tapping a disabled button does not mutate conversation or user state."""
        cb_query = MockCallbackQuery("btn_disabled:بخش غیرفعال")
        update = MockUpdate(callback_query=cb_query)
        context = MockContext()
        context.user_data["current_step"] = "INTAKE_SELECTION"
        context.user_data["student_id"] = "40112345"

        await handle_disabled_button_tap(update, context)

        self.assertEqual(context.user_data["current_step"], "INTAKE_SELECTION")
        self.assertEqual(context.user_data["student_id"], "40112345")

    # ─────────────────────────────────────────────────────────
    # F3: Ephemeral Overlays & User Alerts
    # ─────────────────────────────────────────────────────────

    async def test_f3_show_alert_modal_dialog(self):
        """Verify EphemeralOverlayHelper.show_alert triggers a modal dialog."""
        cb_query = MockCallbackQuery("action:test")
        success = await EphemeralOverlayHelper.show_alert(cb_query, "هشدار: زمان آزمون به پایان رسید!")
        self.assertTrue(success)
        self.assertEqual(len(cb_query.answers), 1)
        self.assertTrue(cb_query.answers[0]["show_alert"])
        self.assertEqual(cb_query.answers[0]["text"], "هشدار: زمان آزمون به پایان رسید!")

    async def test_f3_show_toast_banner(self):
        """Verify EphemeralOverlayHelper.show_toast triggers a floating banner."""
        cb_query = MockCallbackQuery("action:test")
        success = await EphemeralOverlayHelper.show_toast(cb_query, "پاسخ شما با موفقیت ثبت شد ✅")
        self.assertTrue(success)
        self.assertEqual(len(cb_query.answers), 1)
        self.assertFalse(cb_query.answers[0]["show_alert"])
        self.assertEqual(cb_query.answers[0]["text"], "پاسخ شما با موفقیت ثبت شد ✅")

    async def test_f3_ephemeral_alert_length_truncation(self):
        """Verify alert texts longer than 200 characters are safely clamped."""
        cb_query = MockCallbackQuery("action:test")
        long_msg = "الف" * 250
        await EphemeralOverlayHelper.show_alert(cb_query, long_msg)
        self.assertLessEqual(len(cb_query.answers[0]["text"]), 200)

    async def test_f3_ephemeral_overlay_handles_exceptions_gracefully(self):
        """Verify show_alert returns False and does not raise on query.answer failure."""
        class BrokenQuery:
            async def answer(self, **kwargs):
                raise RuntimeError("Telegram connection dropped")

        success = await EphemeralOverlayHelper.show_alert(BrokenQuery(), "پیام")
        self.assertFalse(success)

    async def test_f3_ephemeral_message_auto_deletion(self):
        """Verify send_ephemeral_message schedules message and deletes it after timeout."""
        bot = MockBot()
        task = EphemeralOverlayHelper.send_ephemeral_message(bot, chat_id=1001, text="پیام موقت", timeout_seconds=0.01)
        await task
        self.assertEqual(len(bot.sent_messages), 1)
        msg = bot.sent_messages[0]
        self.assertTrue(msg.deleted)

    # ─────────────────────────────────────────────────────────
    # F4: Expandable Quote Blocks (<blockquote expandable>)
    # ─────────────────────────────────────────────────────────

    def test_f4_single_line_blockquote_conversion(self):
        """Verify markdown blockquote transforms into <blockquote expandable>."""
        raw_md = "> نکته بالینی: دوز بارگیری آمیودارون باید با پایش دقیق ECG همراه باشد."
        html_out = _md_to_telegram_html(raw_md)
        self.assertIn("<blockquote expandable>", html_out)
        self.assertIn("</blockquote>", html_out)
        self.assertIn("نکته بالینی: دوز بارگیری آمیودارون", html_out)
        self.assertNotIn("&gt;", html_out)

    def test_f4_multi_line_contiguous_blockquote(self):
        """Verify multiple contiguous quote lines merge into a single expandable block."""
        raw_md = (
            "> علائم شایع مننژیت:\n"
            "> ۱. سردرد شدید و ناگهانی\n"
            "> ۲. سفتی گردن (Rigidity)\n"
            "> ۳. تب بالا و فتوفوبی"
        )
        html_out = _md_to_telegram_html(raw_md)
        self.assertEqual(html_out.count("<blockquote expandable>"), 1)
        self.assertEqual(html_out.count("</blockquote>"), 1)
        self.assertIn("سردرد شدید", html_out)
        self.assertIn("سفتی گردن", html_out)

    def test_f4_nested_markdown_in_expandable_blockquote(self):
        """Verify **bold** and `code` formatting work inside expandable quotes."""
        raw_md = "> داروی خط اول: **پنی‌سیلین** با دوز `500mg` خوراکی."
        html_out = _md_to_telegram_html(raw_md)
        self.assertIn("<blockquote expandable>", html_out)
        self.assertIn("<b>پنی‌سیلین</b>", html_out)
        self.assertIn("<code>500mg</code>", html_out)

    def test_f4_html_entity_escaping_inside_blockquote(self):
        """Verify angle brackets and ampersands inside quotes are sanitized."""
        raw_md = "> شرط آزمایشگاهی: K+ < 3.5 & Na+ > 145"
        html_out = _md_to_telegram_html(raw_md)
        self.assertIn("&lt; 3.5", html_out)
        self.assertIn("&amp;", html_out)
        self.assertIn("&gt; 145", html_out)
        self.assertNotIn("< 3.5", html_out)

    def test_f4_ptb_expandable_blockquote_constant_verified(self):
        """Verify python-telegram-bot supports EXPANDABLE_BLOCKQUOTE entity type."""
        self.assertTrue(hasattr(MessageEntityType, "EXPANDABLE_BLOCKQUOTE"))
        self.assertEqual(MessageEntityType.EXPANDABLE_BLOCKQUOTE, "expandable_blockquote")

    # ─────────────────────────────────────────────────────────
    # F5: Compact Monospace Tables (<pre>)
    # ─────────────────────────────────────────────────────────

    def test_f5_compact_table_rendering_structure(self):
        """Verify monospace table rendered inside <pre> with headers and dividers."""
        headers = ["درس", "نمره", "واحد"]
        rows = [
            ["فیزیولوژی", "19.5", "3"],
            ["آناتومی", "17.0", "4"],
        ]
        table = CompactTableBuilder.render(headers, rows)
        self.assertTrue(table.startswith("<pre>"))
        self.assertTrue(table.endswith("</pre>"))
        self.assertIn(" │ ", table)
        self.assertIn("─┼─", table)
        self.assertIn("فیزیولوژی", table)
        self.assertIn("19.5", table)

    def test_f5_compact_table_empty_handling(self):
        """Verify empty data lists render informative placeholder."""
        self.assertEqual(CompactTableBuilder.render([], []), "<pre>(بدون داده)</pre>")

    def test_f5_compact_table_max_widths_and_truncation(self):
        """Verify cell contents exceeding column max widths are truncated with ellipsis."""
        headers = ["عنوان طولانی دوره آموزشی پزشکی", "وضعیت"]
        rows = [["کارآموزی در عرصه بخش بیماری‌های عفونی و گرمسیری", "قبول"]]
        table = CompactTableBuilder.render(headers, rows, max_col_widths=[15, 6])
        self.assertIn("…", table)
        for line in table.splitlines():
            if not line.startswith("<pre>") and not line.startswith("</pre>"):
                self.assertLessEqual(len(line), 30)

    def test_f5_compact_table_persian_zwnj_alignment(self):
        """Verify display width ignores zero-width non-joiners (ZWNJ)."""
        w_without = CompactTableBuilder._display_width("همیار")
        w_with = CompactTableBuilder._display_width("هم‌يار")
        self.assertEqual(w_without, w_with)

    def test_f5_compact_table_boundary_safeguard(self):
        """Verify massive tables are clamped at 3900 characters to prevent Telegram 400."""
        headers = ["شماره", "مبحث", "امتیاز"]
        rows = [[str(i), f"مبحث آموزشی شماره {i}", f"{i * 10}"] for i in range(150)]
        table = CompactTableBuilder.render(headers, rows)
        self.assertLessEqual(len(table), 3900)
        self.assertTrue(table.endswith("</pre>"))

    # ─────────────────────────────────────────────────────────
    # Cross-Feature Integration Tests
    # ─────────────────────────────────────────────────────────

    async def test_cross_feature_start_handler_rich_markup_and_quotes(self):
        """Verify start_handler sends expandable guidelines and ButtonGridBuilder hero markup."""
        from backend.bot.start import start_handler, REGISTER
        from tests.test_registration_flow import FakeDB
        import backend.bot.start as start_mod

        fake_db = FakeDB()
        fake_db.blacklisted = set()
        orig_db = start_mod.db
        start_mod.db = fake_db

        try:
            bot = MockBot()
            msg = MockMessage(message_id=1, chat_id=1001)
            update = MockUpdate(user_id=1001, message=msg)
            context = MockContext()
            context.bot = bot

            res = await start_handler(update, context)

            self.assertEqual(res, REGISTER)
            self.assertEqual(len(msg.replies), 1)
            sent = msg.replies[0]
            self.assertIn("<blockquote expandable>", sent.text)
            self.assertIn("</blockquote>", sent.text)
            self.assertIsInstance(sent.reply_markup, InlineKeyboardMarkup)
            self.assertEqual(sent.reply_markup.inline_keyboard[0][0].callback_data, "register:start")
        finally:
            start_mod.db = orig_db

    async def test_cross_feature_intake_selection_disabled_cohorts(self):
        """Verify _proceed_to_intake with disabled cohorts attaches btn_disabled: buttons."""
        from backend.bot.start import _proceed_to_intake, STEP_INTAKE
        from tests.test_registration_flow import FakeDB
        import backend.bot.start as start_mod

        fake_db = FakeDB()
        fake_db.intakes = [
            {"code": "active_cohort", "label": "مهر ۱۴۰۴", "active": True},
            {"code": "full_cohort", "label": "بهمن ۱۴۰۴ (تکمیل)", "active": True, "is_full": True},
        ]
        orig_db = start_mod.db
        start_mod.db = fake_db

        try:
            cb = MockCallbackQuery("register:group1", user_id=1001)
            update = MockUpdate(user_id=1001, callback_query=cb)
            context = MockContext()
            context.user_data["reg_name"] = "علی رضایی"

            res = await _proceed_to_intake(update, context, "1")

            self.assertEqual(res, STEP_INTAKE)
            self.assertEqual(len(cb.message.edits), 1)
            edit = cb.message.edits[0]
            kb = edit["reply_markup"]
            self.assertIsInstance(kb, InlineKeyboardMarkup)
            # Row 0: active cohort -> register:intake:active_cohort
            self.assertEqual(kb.inline_keyboard[0][0].callback_data, "register:intake:active_cohort")
            # Row 1: full cohort -> btn_disabled:ظرفیت این دوره تکمیل شده است.
            self.assertTrue(kb.inline_keyboard[1][0].callback_data.startswith("btn_disabled:"))
            self.assertTrue(kb.inline_keyboard[1][0].text.startswith("🔒"))
        finally:
            start_mod.db = orig_db

    async def test_telegram_bot_api_bridge_custom_request(self):
        """Verify TelegramBotApiBridge properly delegates to bot.do_api_request."""
        bot = MockBot()
        payload = {"chat_id": 1001, "text": "Direct payload test"}
        res = await TelegramBotApiBridge.do_custom_request(bot, "sendMessage", payload)
        self.assertTrue(res["ok"])
        self.assertEqual(len(bot.do_api_requests), 1)
        self.assertEqual(bot.do_api_requests[0]["method"], "sendMessage")
        self.assertEqual(bot.do_api_requests[0]["api_kwargs"], payload)


if __name__ == "__main__":
    unittest.main()
