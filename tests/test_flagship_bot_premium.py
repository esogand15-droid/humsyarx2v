# -*- coding: utf-8 -*-
"""Flagship Telegram Bot Premium Tests.

Verifies:
1. Referral callback isolation (no collision with references).
2. Ticket multimedia attachments (photos, voice notes, documents).
3. Academic transcript and GPA menu integration.
4. Ambassador club routing (no dead-end donation response).
5. Smart clinical concierge fallback on free-form messages.
6. QBank exam completion card with clinical mastery tiers.
"""
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
import os
import sys

os.environ.setdefault('MONGODB_URI', 'mongodb://localhost:27017/medicalbot_test')
os.environ.setdefault('ADMIN_ID', '123456789')
os.environ.setdefault('TELEGRAM_TOKEN', '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11')

# Add project root to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'backend', 'bot')))


class FlagshipBotPremiumTests(unittest.IsolatedAsyncioTestCase):

    async def test_referral_isolated_from_references_paywall(self):
        """ref:menu must never be blocked by references subscription gate."""
        from references import references_callback

        update = MagicMock()
        update.effective_user.id = 999999
        query = MagicMock()
        query.data = 'ref:menu'
        update.callback_query = query
        context = MagicMock()
        context.user_data = {}

        # Mock referral_callback to check delegation
        with patch('referral.referral_callback', new_callable=AsyncMock) as mock_ref_cb:
            await references_callback(update, context)
            mock_ref_cb.assert_called_once_with(update, context)

    async def test_ticket_file_handler_handles_photos(self):
        """Ticket file handler must process photo attachments and set awaiting_confirm."""
        from ticket import ticket_file_handler, TICKET_WAITING

        update = MagicMock()
        update.effective_user.id = 12345
        msg = MagicMock()
        msg.text = None
        msg.caption = "اسکرین‌شات از خطای برنامه هفتگی"
        photo_mock = MagicMock()
        photo_mock.file_id = "photo_file_id_xyz"
        msg.photo = [photo_mock]
        msg.voice = None
        msg.audio = None
        msg.document = None
        msg.reply_text = AsyncMock()
        update.message = msg

        context = MagicMock()
        context.user_data = {
            'ticket_mode': 'waiting_message',
            'ticket_subject': 'مشکل فنی',
            'ticket_priority': 'high',
        }

        res = await ticket_file_handler(update, context)
        self.assertEqual(res, TICKET_WAITING)
        self.assertEqual(context.user_data['ticket_mode'], 'awaiting_confirm')
        self.assertIn('ticket_attachment', context.user_data)
        self.assertEqual(context.user_data['ticket_attachment']['type'], 'photo')
        self.assertEqual(context.user_data['ticket_attachment']['file_id'], 'photo_file_id_xyz')
        msg.reply_text.assert_called_once()
        sent_text = msg.reply_text.call_args[0][0]
        self.assertIn("پیش‌نمایش تیکت", sent_text)
        self.assertIn("پیوست", sent_text)

    async def test_db_ticket_create_and_reply_with_attachment(self):
        """Database ticket creation and replies must preserve attachment objects."""
        from database import db

        uid = 555001
        name = "دانشجو تستی"
        subject = "مشکل بارگذاری اسلاید"
        message = "اسلایدهای جلسه ۳ باز نمی‌شوند"
        attachment = {
            'type': 'photo',
            'file_id': 'fid_test_123',
            'file_name': 'err.jpg',
            'caption': 'عکس خطا'
        }

        with patch.object(db.tickets, 'insert_one', new_callable=AsyncMock) as mock_ins, \
             patch.object(db, '_next_ticket_id', new_callable=AsyncMock, return_value=7001):
            tid = await db.ticket_create(uid, name, subject, message, priority='normal', attachment=attachment)
            self.assertEqual(tid, 7001)
            mock_ins.assert_called_once()
            doc = mock_ins.call_args[0][0]
            self.assertEqual(doc['attachment'], attachment)

        with patch.object(db, 'ticket_get', new_callable=AsyncMock, return_value={'status': 'open'}), \
             patch.object(db, '_push_capped', new_callable=AsyncMock) as mock_push, \
             patch.object(db.tickets, 'update_one', new_callable=AsyncMock):
            reply_att = {'type': 'voice', 'file_id': 'voice_fid_999'}
            await db.ticket_add_reply(7001, "[دانشجو] توضیح صوتی تکمیلی", attachment=reply_att)
            mock_push.assert_called_once()
            pushed_item = mock_push.call_args[0][3]
            self.assertEqual(pushed_item['attachment'], reply_att)

    def test_main_keyboard_includes_grades(self):
        """Main reply keyboard must contain the grades button."""
        from utils import main_keyboard

        kb = main_keyboard()
        button_texts = [btn.text for row in kb.keyboard for btn in row]
        self.assertIn("📊 کارنامه و معدل", button_texts)
        self.assertIn("🎫 پشتیبانی", button_texts)

    async def test_message_router_handles_grades(self):
        """Routing '📊 کارنامه و معدل' must call show_my_grades_msg."""
        import message_router

        update = MagicMock()
        update.effective_user.id = 12345
        msg = MagicMock()
        msg.text = "📊 کارنامه و معدل"
        update.message = msg
        context = MagicMock()
        context.user_data = {}

        with patch('grades.show_my_grades_msg', new_callable=AsyncMock) as mock_show_grades, \
             patch('database.db.get_user', new_callable=AsyncMock, return_value={'approved': True}):
            await message_router.route_message(update, context)
            mock_show_grades.assert_called_once_with(update)

    async def test_ambassador_club_on_donation_disabled(self):
        """When donation is disabled, show Ambassador Club card with referral options."""
        import message_router
        from database import db

        update = MagicMock()
        update.effective_user.id = 12345
        msg = MagicMock()
        msg.text = "💙 حمایت مالی"
        msg.reply_text = AsyncMock()
        update.message = msg
        context = MagicMock()
        context.user_data = {}

        with patch.object(db, 'get_user', new_callable=AsyncMock, return_value={'approved': True}), \
             patch.object(db, 'get_setting', new_callable=AsyncMock, return_value=None):
            await message_router.route_message(update, context)
            msg.reply_text.assert_called_once()
            sent_text = msg.reply_text.call_args[0][0]
            self.assertIn("باشگاه سفیران و حامیان هامزیار", sent_text)
            self.assertIn("دعوت از دوستان", sent_text)

    async def test_smart_clinical_concierge_fallback(self):
        """Unhandled text messages must display the smart clinical concierge card."""
        import message_router
        from database import db

        update = MagicMock()
        update.effective_user.id = 12345
        msg = MagicMock()
        msg.text = "علائم افت قند خون چیست؟"
        msg.reply_text = AsyncMock()
        update.message = msg
        context = MagicMock()
        context.user_data = {}

        with patch.object(db, 'get_user', new_callable=AsyncMock, return_value={'approved': True}):
            await message_router.route_message(update, context)
            msg.reply_text.assert_called_once()
            sent_text = msg.reply_text.call_args[0][0]
            self.assertIn("دستیار هوشمند دانشجویان پزشکی هامزیار", sent_text)
            self.assertEqual(context.user_data.get('last_unhandled_query'), "علائم افت قند خون چیست؟")

    def test_exam_finish_card_mastery_tier(self):
        """Exam finish card should classify performance with clinical badges and buttons."""
        from questions import _build_exam_finish_card

        text, kb = _build_exam_finish_card(correct=9, answered=10, percentage=90.0, exam_code='EXAM-2026')
        self.assertIn("ارزیابی آزمون پزشکی", text)
        self.assertIn("Mastery Level", text)
        self.assertIn("✅ پاسخ‌های درست: <b>9</b> از 10", text)
        self.assertIn("❌ پاسخ‌های نادرست: <b>1</b>", text)
        self.assertIn("90.0٪", text)

        # Buttons
        cb_datas = [btn.callback_data for row in kb.inline_keyboard for btn in row if btn.callback_data]
        self.assertIn("questions:weak", cb_datas)
        self.assertIn("questions:custom_exam", cb_datas)
        self.assertIn("questions:exam_history", cb_datas)
