# -*- coding: utf-8 -*-
"""Telegram Bot Handler for Web Authentication Approval.

Handles user tap on inline buttons:
[ ✅ تایید ورود ] -> web_auth:approve:<challenge_id>
[ ❌ رد درخواست ] -> web_auth:reject:<challenge_id>
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from telegram import Update
from telegram.ext import ContextTypes

from database import db

logger = logging.getLogger(__name__)


async def web_auth_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle web authentication approval / rejection callback queries."""
    query = update.callback_query
    if not query or not query.data:
        return

    data = query.data
    parts = data.split(":")
    if len(parts) < 3 or parts[0] != "web_auth":
        await query.answer("درخواست نامعتبر است.", show_alert=True)
        return

    action = parts[1]
    challenge_id = parts[2]
    user_id = update.effective_user.id

    challenges = db.client["medicalbot"]["web_login_challenges"]
    challenge = await challenges.find_one({"_id": challenge_id})

    if not challenge:
        await query.answer("این درخواست منقضی یا نامعتبر شده است.", show_alert=True)
        try:
            await query.edit_message_text("⚠️ این درخواست ورود منقضی شده است.")
        except Exception:
            pass
        return

    # Verify that the telegram user clicking is indeed the challenge target
    if challenge.get("uid") and int(challenge["uid"]) != user_id:
        await query.answer("شما مجاز به تأیید این درخواست نیستید.", show_alert=True)
        return

    if challenge.get("consumed"):
        await query.answer("این درخواست قبلاً مصرف شده است.", show_alert=True)
        try:
            await query.edit_message_text("ℹ️ این درخواست قبلاً استفاده شده است.")
        except Exception:
            pass
        return

    now = datetime.now(timezone.utc)

    if action == "approve":
        await challenges.update_one(
            {"_id": challenge_id},
            {"$set": {"status": "approved", "approved_at": now}}
        )
        await query.answer("ورود به وب‌اپ تأیید شد ✅", show_alert=False)
        try:
            await query.edit_message_text(
                "✅ <b>ورود به وب‌اپ هامزیار تأیید شد</b>\n\n"
                f"دستگاه: <b>{challenge.get('client_info', {}).get('device_name', 'مرورگر وب')}</b>\n"
                "اکنون نشست مرورگر شما فعال شد و می‌توانید به مطالعه بپردازید.",
                parse_mode="HTML"
            )
        except Exception as e:
            logger.warning("Failed to edit approval message: %s", e)

    elif action == "reject":
        await challenges.update_one(
            {"_id": challenge_id},
            {"$set": {"status": "rejected", "rejected_at": now}}
        )
        await query.answer("درخواست ورود لغو شد ❌", show_alert=False)
        try:
            await query.edit_message_text(
                "❌ <b>درخواست ورود به وب‌اپ رد شد</b>\n\n"
                "اگر شما این درخواست را نداده بودید، جهت امنیت توصیه می‌شود کلمه عبور یا نشست‌های فعال خود را بررسی کنید.",
                parse_mode="HTML"
            )
        except Exception as e:
            logger.warning("Failed to edit rejection message: %s", e)
    else:
        await query.answer("عملیات نامعتبر است.", show_alert=True)
