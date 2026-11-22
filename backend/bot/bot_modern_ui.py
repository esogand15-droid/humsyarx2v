# -*- coding: utf-8 -*-
"""Modern Telegram Bot API UI Component Library & Bridge.

Provides:
- ButtonGridBuilder: Fluent builder for aligned, rich 2D inline keyboards,
  supporting hero buttons, split grids, disabled buttons with lock indicators,
  and RTL-aware navigation rows.
- EphemeralOverlayHelper: Dispatches modal alert dialogs, top toast banners,
  and auto-destructing ephemeral chat messages.
- CompactTableBuilder: Mobile-optimized monospace tables wrapped in <pre> tags
  with boundary clamping and Persian padding.
- TelegramBotApiBridge: Direct invocation bridge using PTB's do_api_request
  and async HTTP fallback via httpx.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional, Sequence, Union

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo

logger = logging.getLogger(__name__)


class ButtonGridBuilder:
    """Fluent builder for modern, aligned Telegram inline keyboards."""

    def __init__(self) -> None:
        self.rows: List[List[InlineKeyboardButton]] = []

    def add_hero(
        self,
        text: str,
        callback_data: Optional[str] = None,
        url: Optional[str] = None,
        web_app: Optional[Union[WebAppInfo, str]] = None,
    ) -> ButtonGridBuilder:
        """Add a full-width hero action button occupying its own row."""
        wapp = WebAppInfo(url=web_app) if isinstance(web_app, str) else web_app
        btn = InlineKeyboardButton(text=text, callback_data=callback_data, url=url, web_app=wapp)
        self.rows.append([btn])
        return self

    def add_split(self, *buttons: InlineKeyboardButton) -> ButtonGridBuilder:
        """Add a balanced multi-column row (e.g. 2-column or 3-column split)."""
        if buttons:
            self.rows.append(list(buttons))
        return self

    def add_split_row(
        self, items: Sequence[Union[InlineKeyboardButton, tuple[str, str]]]
    ) -> ButtonGridBuilder:
        """Add a split row from a sequence of buttons or (text, callback_data) tuples."""
        row: List[InlineKeyboardButton] = []
        for item in items:
            if isinstance(item, InlineKeyboardButton):
                row.append(item)
            elif isinstance(item, (tuple, list)) and len(item) >= 2:
                row.append(InlineKeyboardButton(text=str(item[0]), callback_data=str(item[1])))
        if row:
            self.rows.append(row)
        return self

    def add_disabled(
        self,
        text: str,
        reason: str = "این گزینه در حال حاضر غیرفعال است.",
        prefix: str = "🔒 ",
    ) -> ButtonGridBuilder:
        """Add a visually dimmed / locked button that triggers a modal explanation alert.

        Callback data is safely formatted to fit within Telegram's 64-byte callback limit.
        """
        clean_text = text if text.startswith("🔒") else f"{prefix}{text}"
        # Telegram callback_data limit is 64 bytes. Reserve 13 bytes for 'btn_disabled:'.
        # Ensure utf-8 encoding does not exceed 64 bytes.
        encoded_reason = reason.encode("utf-8")
        if len(encoded_reason) > 50:
            truncated_reason = encoded_reason[:47].decode("utf-8", errors="ignore") + "…"
        else:
            truncated_reason = reason
        cb_data = f"btn_disabled:{truncated_reason}"
        self.rows.append([InlineKeyboardButton(text=clean_text, callback_data=cb_data)])
        return self

    def add_nav(
        self,
        prev_cb: Optional[str] = None,
        home_cb: Optional[str] = None,
        next_cb: Optional[str] = None,
        prev_label: str = "صفحه بعد ◀️",
        home_label: str = "🏠 منو",
        next_label: str = "▶️ صفحه قبل",
    ) -> ButtonGridBuilder:
        """Add an RTL-aware navigation bar.

        In Persian RTL orientation:
        - The visual 'Next' page advances to the left (◀️)
        - The visual 'Previous' page points to the right (▶️)
        """
        nav_row: List[InlineKeyboardButton] = []
        # RTL display order: next page (left arrow), home, previous page (right arrow)
        if prev_cb:
            nav_row.append(InlineKeyboardButton(text=prev_label, callback_data=prev_cb))
        if home_cb:
            nav_row.append(InlineKeyboardButton(text=home_label, callback_data=home_cb))
        if next_cb:
            nav_row.append(InlineKeyboardButton(text=next_label, callback_data=next_cb))

        if nav_row:
            self.rows.append(nav_row)
        return self

    def add_row(self, buttons: List[InlineKeyboardButton]) -> ButtonGridBuilder:
        """Append an arbitrary row of buttons."""
        if buttons:
            self.rows.append(list(buttons))
        return self

    def build(self) -> InlineKeyboardMarkup:
        """Construct the immutable InlineKeyboardMarkup."""
        return InlineKeyboardMarkup(self.rows)


class EphemeralOverlayHelper:
    """Helper for user-scoped modal alerts, floating toasts, and ephemeral messages."""

    @staticmethod
    async def show_alert(query: Any, text: str) -> bool:
        """Display a blocking modal alert dialog requiring user acknowledgment."""
        try:
            safe_text = str(text or "")[:200]
            await query.answer(text=safe_text, show_alert=True)
            return True
        except Exception as e:
            logger.warning("Failed to show ephemeral alert: %s", e)
            return False

    @staticmethod
    async def show_toast(query: Any, text: str) -> bool:
        """Display a non-blocking toast notification banner at the top of the chat."""
        try:
            safe_text = str(text or "")[:200]
            await query.answer(text=safe_text, show_alert=False)
            return True
        except Exception as e:
            logger.warning("Failed to show ephemeral toast: %s", e)
            return False

    @staticmethod
    def send_ephemeral_message(
        bot: Any,
        chat_id: int,
        text: str,
        timeout_seconds: int = 5,
        parse_mode: str = "HTML",
        reply_markup: Optional[InlineKeyboardMarkup] = None,
    ) -> asyncio.Task:
        """Send a temporary chat message that self-destructs after timeout_seconds.

        Returns an asyncio.Task managing the send and delete lifecycle.
        """
        async def _ephemeral_worker() -> None:
            msg = None
            try:
                msg = await bot.send_message(
                    chat_id=chat_id,
                    text=text,
                    parse_mode=parse_mode,
                    reply_markup=reply_markup,
                )
                await asyncio.sleep(timeout_seconds)
            except Exception as exc:
                logger.debug("Ephemeral message lifecycle interrupted: %s", exc)
            finally:
                if msg is not None:
                    try:
                        await msg.delete()
                    except Exception:
                        pass

        return asyncio.create_task(_ephemeral_worker())


class CompactTableBuilder:
    """Renders mobile-optimized monospace tables enclosed in <pre> tags."""

    @staticmethod
    def _display_width(val: Any) -> int:
        """Calculate printable display width, stripping non-printable characters."""
        s = str(val or "")
        # Remove zero-width non-joiner for width calculation
        s_clean = s.replace("\u200c", "")
        return len(s_clean)

    @classmethod
    def render(
        cls,
        headers: Sequence[str],
        rows: Sequence[Sequence[Any]],
        max_col_widths: Optional[Sequence[int]] = None,
        title: Optional[str] = None,
    ) -> str:
        """Render a clean monospace table with aligned columns.

        Enclosed in <pre>...</pre> for fixed-pitch Telegram font rendering.
        """
        if not headers and not rows:
            return "<pre>(بدون داده)</pre>"

        num_cols = len(headers) if headers else (len(rows[0]) if rows else 0)
        if num_cols == 0:
            return "<pre>(جدول خالی)</pre>"

        # Determine optimal column widths
        col_widths = [cls._display_width(h) for h in headers] if headers else [0] * num_cols
        while len(col_widths) < num_cols:
            col_widths.append(0)

        for row in rows:
            for i in range(min(num_cols, len(row))):
                col_widths[i] = max(col_widths[i], cls._display_width(row[i]))

        # Enforce minimum width of 2 and apply optional maximums
        col_widths = [max(2, w) for w in col_widths]
        if max_col_widths:
            for i in range(min(num_cols, len(max_col_widths))):
                if max_col_widths[i] and max_col_widths[i] > 0:
                    col_widths[i] = min(col_widths[i], max_col_widths[i])

        def format_cell(val: Any, width: int) -> str:
            raw = str(val if val is not None else "—")
            dw = cls._display_width(raw)
            if dw > width:
                # Truncate with ellipsis
                target = max(1, width - 1)
                return raw[:target] + "…"
            padding = width - dw
            pad_left = padding // 2
            pad_right = padding - pad_left
            return (" " * pad_left) + raw + (" " * pad_right)

        lines: List[str] = ["<pre>"]
        if title:
            lines.append(f"📌 {title}")
            lines.append("─" * (sum(col_widths) + (3 * (num_cols - 1))))

        if headers:
            header_cells = [format_cell(headers[i] if i < len(headers) else "", col_widths[i]) for i in range(num_cols)]
            lines.append(" │ ".join(header_cells))
            sep_cells = ["─" * col_widths[i] for i in range(num_cols)]
            lines.append("─┼─".join(sep_cells))

        for row in rows:
            row_cells = [format_cell(row[i] if i < len(row) else "", col_widths[i]) for i in range(num_cols)]
            lines.append(" │ ".join(row_cells))

        lines.append("</pre>")
        result = "\n".join(lines)

        # Telegram message boundary safeguard (3900 characters)
        if len(result) > 3900:
            result = result[:3880] + "\n…\n</pre>"
        return result


class TelegramBotApiBridge:
    """Extensible bridge for direct Bot API requests using do_api_request or httpx."""

    @staticmethod
    async def do_custom_request(bot: Any, method: str, payload: Optional[Dict[str, Any]] = None) -> Any:
        """Execute a direct Telegram Bot API method via PTB's native do_api_request."""
        if hasattr(bot, "do_api_request"):
            return await bot.do_api_request(method, api_kwargs=payload or {})
        raise AttributeError("Provided bot instance does not support do_api_request")

    @staticmethod
    async def send_message_direct(
        bot_token: str,
        chat_id: Union[int, str],
        text: str,
        parse_mode: str = "HTML",
        reply_markup: Optional[Dict[str, Any]] = None,
        timeout: float = 10.0,
    ) -> Dict[str, Any]:
        """Send a message directly to Telegram Bot API via httpx async client.

        Bypasses library limitations when experimental or custom payloads are required.
        """
        import httpx

        url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        body: Dict[str, Any] = {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": parse_mode,
        }
        if reply_markup is not None:
            body["reply_markup"] = reply_markup

        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(url, json=body)
            resp.raise_for_status()
            return resp.json()
