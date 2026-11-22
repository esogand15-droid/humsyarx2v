# -*- coding: utf-8 -*-
"""Unit tests for AI Streaming Draft Controls, Stop Buttons, Cancellation Registry,

and Clean Finalization (F6).
Guaranteed dual-runner compatibility with pytest and python -m unittest.
"""

from __future__ import annotations

import asyncio
import os
import sys
import unittest
from typing import Any, AsyncGenerator, Dict, List, Optional

os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017/humsyar_test")
os.environ.setdefault("ADMIN_ID", "999")
os.environ.setdefault("TELEGRAM_TOKEN", "123:TEST_TOKEN")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from telegram import InlineKeyboardMarkup
from backend.services.ai_solver import (
    _ACTIVE_AI_STREAMS,
    register_ai_stream,
    unregister_ai_stream,
    get_active_ai_stream,
    request_stop_ai_stream,
    _answer_with_live_edit,
    ai_user_callback,
    _typing_pinger,
)
import backend.services.ai_solver as ai_mod
from backend.bot.bot import handle_ai_stream_stop
from tests.test_registration_flow import FakeDB


class MockAiDB(FakeDB):
    async def ai_inc_tokens(self, uid: int, tokens: int) -> bool:
        return True

    async def ai_remember(self, uid: int, role: str, text: str, max_items: int = 10) -> bool:
        return True

    async def ai_clear_doc(self, uid: int) -> bool:
        return True


# ─────────────────────────────────────────────────────────────
# High-Fidelity In-Memory Mocks for Streaming AI Tests
# ─────────────────────────────────────────────────────────────

class MockUser:
    def __init__(self, user_id: int = 1001, full_name: str = "دکتر آزمایشی"):
        self.id = user_id
        self.full_name = full_name
        self.username = "dr_test"
        self.is_bot = False


class MockChat:
    def __init__(self, chat_id: int = 1001):
        self.id = chat_id
        self.type = "private"


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
        self.deleted = False

    async def reply_text(self, text: str, reply_markup: Optional[InlineKeyboardMarkup] = None, parse_mode: str = "HTML", **kwargs: Any) -> MockMessage:
        return MockMessage(self.message_id + 1, self.chat_id, text, reply_markup, parse_mode)

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
        self.id = "query_ai_stop_1"
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
        self.chat_actions: List[Dict[str, Any]] = []

    async def send_message(self, chat_id: int, text: str, parse_mode: str = "HTML", reply_markup: Optional[InlineKeyboardMarkup] = None, **kwargs: Any) -> MockMessage:
        msg = MockMessage(message_id=len(self.sent_messages) + 200, chat_id=chat_id, text=text, reply_markup=reply_markup, parse_mode=parse_mode)
        self.sent_messages.append(msg)
        return msg

    async def send_chat_action(self, chat_id: int, action: str, **kwargs: Any) -> bool:
        self.chat_actions.append({"chat_id": chat_id, "action": action})
        return True


class MockContext:
    def __init__(self):
        self.bot = MockBot()
        self.user_data: Dict[str, Any] = {}
        self.chat_data: Dict[str, Any] = {}


# ─────────────────────────────────────────────────────────────
# Test Suite: AI Stream Controls & Stop Button (F6)
# ─────────────────────────────────────────────────────────────

class TestAiStreamControls(unittest.IsolatedAsyncioTestCase):
    """Systematic test suite covering F6 AI streaming stop controls and draft management."""

    def setUp(self):
        self._orig_ai_db = ai_mod.db
        ai_mod.db = MockAiDB()

    def tearDown(self):
        ai_mod.db = self._orig_ai_db
        _ACTIVE_AI_STREAMS.clear()

    # ─────────────────────────────────────────────────────────
    # Active Stream Registry Unit Tests
    # ─────────────────────────────────────────────────────────

    def test_registry_registration_and_unregistration(self):
        """Verify registering and unregistering an active AI streaming event."""
        stop_event = asyncio.Event()
        stream_key = "1001:501"

        register_ai_stream(stream_key, stop_event)
        self.assertIs(get_active_ai_stream(stream_key), stop_event)
        self.assertIn(stream_key, _ACTIVE_AI_STREAMS)

        unregister_ai_stream(stream_key)
        self.assertIsNone(get_active_ai_stream(stream_key))
        self.assertNotIn(stream_key, _ACTIVE_AI_STREAMS)

    def test_request_stop_ai_stream_exact_key(self):
        """Verify request_stop_ai_stream signals stop event by exact chat:msg key."""
        stop_event = asyncio.Event()
        register_ai_stream("1001:502", stop_event)

        success = request_stop_ai_stream("1001:502")
        self.assertTrue(success)
        self.assertTrue(stop_event.is_set())

    def test_request_stop_ai_stream_suffix_match(self):
        """Verify request_stop_ai_stream matches by message_id suffix."""
        stop_event = asyncio.Event()
        register_ai_stream("1001:503", stop_event)

        success = request_stop_ai_stream("503")
        self.assertTrue(success)
        self.assertTrue(stop_event.is_set())

    def test_request_stop_ai_stream_nonexistent_returns_false(self):
        """Verify request_stop_ai_stream returns False when key is not registered."""
        success = request_stop_ai_stream("9999:8888")
        self.assertFalse(success)

    # ─────────────────────────────────────────────────────────
    # Callback Handlers & Interception Tests
    # ─────────────────────────────────────────────────────────

    async def test_handle_ai_stream_stop_interception(self):
        """Verify handle_ai_stream_stop callback in bot.py stops stream and shows toast."""
        stop_event = asyncio.Event()
        register_ai_stream("1001:504", stop_event)

        query = MockCallbackQuery("aiu:stop:1001:504", user_id=1001)
        update = MockUpdate(user_id=1001, callback_query=query)
        context = MockContext()

        await handle_ai_stream_stop(update, context)

        self.assertTrue(stop_event.is_set())
        self.assertEqual(len(query.answers), 1)
        ans = query.answers[0]
        self.assertFalse(ans["show_alert"])
        self.assertIn("متوقف شد", ans["text"])

    async def test_ai_user_callback_stop_action_interception(self):
        """Verify ai_user_callback with action=='stop' intercepts and halts stream."""
        stop_event = asyncio.Event()
        register_ai_stream("1001:505", stop_event)

        query = MockCallbackQuery("aiu:stop:1001:505", user_id=1001)
        update = MockUpdate(user_id=1001, callback_query=query)
        context = MockContext()

        await ai_user_callback(update, context)

        self.assertTrue(stop_event.is_set())
        self.assertEqual(len(query.answers), 1)
        self.assertIn("متوقف شد", query.answers[0]["text"])

    # ─────────────────────────────────────────────────────────
    # Live Streaming Execution & Finalization Tests
    # ─────────────────────────────────────────────────────────

    async def test_answer_with_live_edit_attaches_stop_button_during_streaming(self):
        """Verify _answer_with_live_edit attaches stop button to intermediate edits."""
        async def mock_stream_gen() -> AsyncGenerator[Dict[str, Any], None]:
            # Emit enough text to trigger intermediate edit (>= 50 chars)
            yield {"type": "delta", "text": "این یک توضیح بالینی طولانی برای تست عملکرد دکمه توقف و استریم پاسخ است."}
            await asyncio.sleep(0.01)
            yield {"type": "done", "answer": "پاسخ کامل نهایی بالینی.", "tokens": 15}

        update = MockUpdate(user_id=1001)
        context = MockContext()

        await _answer_with_live_edit(
            update=update,
            context=context,
            stream_gen=mock_stream_gen(),
            footer_suffix="",
            uid=1001,
            question_label="تست استریم",
            voice_input=False,
        )

        self.assertEqual(len(context.bot.sent_messages), 1)
        thinking_msg = context.bot.sent_messages[0]

        # Check intermediate text edits had stop button and draft cursor
        intermediate_text_edits = [
            edit for edit in thinking_msg.edits
            if edit.get("text") and edit.get("reply_markup") and any(
                btn.callback_data.startswith("aiu:stop:")
                for row in edit["reply_markup"].inline_keyboard
                for btn in row
            )
        ]
        self.assertGreaterEqual(len(intermediate_text_edits), 1)
        first_edit = intermediate_text_edits[0]
        self.assertIn("▌", first_edit["text"])

        # Final edit must NOT contain draft cursor ▌
        text_edits = [e for e in thinking_msg.edits if "text" in e]
        self.assertGreaterEqual(len(text_edits), 1)
        final_edit = text_edits[-1]
        self.assertNotIn("▌", final_edit["text"])

        # Final edit must NOT contain the stop button (replaced by action buttons)
        final_markup = final_edit.get("reply_markup")
        if final_markup:
            has_stop_in_final = any(
                btn.callback_data.startswith("aiu:stop:")
                for row in final_markup.inline_keyboard
                for btn in row
            )
            self.assertFalse(has_stop_in_final)

        # Registry must be completely clean (unregistered in finally)
        self.assertEqual(len(_ACTIVE_AI_STREAMS), 0)

    async def test_answer_with_live_edit_halts_immediately_on_cancellation_event(self):
        """Verify live edit loop breaks immediately when cancellation event is signaled."""
        chunks_emitted = 0

        async def mock_infinite_stream() -> AsyncGenerator[Dict[str, Any], None]:
            nonlocal chunks_emitted
            for i in range(100):
                chunks_emitted += 1
                yield {"type": "delta", "text": f"بخش شماره {i}: تست تولید متن هوش مصنوعی برای ارزیابی توقف. "}
                await asyncio.sleep(0.005)
            yield {"type": "done", "answer": "پایان غیرمنتظره", "tokens": 100}

        update = MockUpdate(user_id=1001)
        context = MockContext()

        # Run streaming in background task and trigger stop after first chunk
        async def _trigger_stop():
            while not _ACTIVE_AI_STREAMS:
                await asyncio.sleep(0.002)
            # Find the active stream key and trigger stop
            for key in list(_ACTIVE_AI_STREAMS.keys()):
                request_stop_ai_stream(key)

        stop_task = asyncio.create_task(_trigger_stop())

        await _answer_with_live_edit(
            update=update,
            context=context,
            stream_gen=mock_infinite_stream(),
            footer_suffix="",
            uid=1001,
            question_label="تست توقف فوری",
            voice_input=False,
        )
        await stop_task

        # Ensure the loop exited well before emitting all 100 chunks
        self.assertLess(chunks_emitted, 20)

        thinking_msg = context.bot.sent_messages[0]
        text_edits = [e for e in thinking_msg.edits if "text" in e]
        self.assertGreaterEqual(len(text_edits), 1)
        final_edit = text_edits[-1]
        # Final message text must indicate user cancellation
        self.assertIn("متوقف شد", final_edit["text"])
        # Final message must not contain draft cursor
        self.assertNotIn("▌", final_edit["text"])
        # Registry must be clean
        self.assertEqual(len(_ACTIVE_AI_STREAMS), 0)

    async def test_typing_pinger_terminates_on_stop_event(self):
        """Verify _typing_pinger background coroutine exits cleanly when stop_event is set."""
        context = MockContext()
        stop_event = asyncio.Event()

        pinger_task = asyncio.create_task(_typing_pinger(context, 1001, stop_event))
        await asyncio.sleep(0.01)

        stop_event.set()
        await asyncio.wait_for(pinger_task, timeout=1.0)
        self.assertTrue(pinger_task.done())
        self.assertGreaterEqual(len(context.bot.chat_actions), 1)


if __name__ == "__main__":
    unittest.main()
