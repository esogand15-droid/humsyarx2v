# Telegram Bot API features for HumsYar (research, 2026-11-25)

Scope: Bot API 7.0 (Dec 2023) through 10.5 (22 Nov 2026), filtered for a Persian
medical-education bot. Read-only research. Nothing was run against Telegram.

Installed library: `python-telegram-bot==21.3` (pinned in `requirements.txt`), which
targets **Bot API 7.4** (`telegram/constants.py:149`).
Latest library: **PTB 22.8 (2026-06-12)**, which targets **Bot API 10.0**. No PTB release
covers Bot API 10.1 to 10.5 yet.

---

## 1. How to use features newer than PTB 21.3 (verified in the installed source)

1. **`api_kwargs` on any TelegramObject.** `TelegramObject.to_dict()` merges `api_kwargs`
   into the serialized JSON (`telegram/_telegramobject.py:649`,
   `out.update(out.pop("api_kwargs", {}))`). `InlineKeyboardButton.__init__` accepts
   `api_kwargs` (`telegram/_inline/inlinekeyboardbutton.py:250`). Because markup
   serialization is recursive, extra button fields such as `style`, `icon_custom_emoji_id`
   and `copy_text` reach Telegram unchanged.
   ```python
   InlineKeyboardButton("✅ تأیید", callback_data="x", api_kwargs={"style": "success"})
   InlineKeyboardButton("📋 کپی کد", api_kwargs={"copy_text": {"text": code}})
   ```
2. **`api_kwargs` on send methods.** Every `bot.send_*` method takes `api_kwargs=`, so new
   parameters can be passed on existing methods, for example the 9.6 poll parameters.
3. **`bot.do_api_request(endpoint, api_kwargs=..., return_type=...)`** (since PTB 20.8,
   `telegram/_bot.py:792`) calls methods PTB doesn't have, such as `sendMessageDraft`,
   `sendRichMessage` and `setMySettings`. Caveats from its docstring: `Defaults` are not
   applied, and file uploads need `InputFile`. The repo already wraps this in
   `TelegramBotApiBridge.do_custom_request` (`backend/bot/bot_modern_ui.py:273`).
4. **HTML parse-mode tags are parsed by Telegram's servers**, not by PTB. That means
   `<blockquote expandable>`, `<tg-spoiler>`, `<tg-emoji>` and `<tg-time>` work on any PTB
   version that sends `parse_mode="HTML"`.

---

## 2. Feature catalogue

"PTB native since" is the first PTB release with typed support. Rows marked **21.3 ✔** need
no workaround.

| Feature | Bot API (date) | JSON field / method | PTB native since | On 21.3 |
|---|---|---|---|---|
| Reactions by bot | 7.0 (2023-12-29) | `setMessageReaction(chat_id, message_id, reaction=[{type:"emoji",emoji:"👍"}], is_big)`. Non-Premium bots get 1 reaction per message, and paid reactions aren't allowed. | 20.8 | ✔ `bot.set_message_reaction` / `message.set_reaction` |
| Reply quotes (Replies 2.0) | 7.0 | `reply_parameters: ReplyParameters{message_id, chat_id, quote, quote_parse_mode, quote_position}` | 20.8 | ✔ |
| Link preview control | 7.0 | `link_preview_options: LinkPreviewOptions{is_disabled, url, prefer_small_media, prefer_large_media, show_above_text}` (replaces `disable_web_page_preview`) | 20.8 | ✔ |
| Plain blockquote | 7.0 | entity `blockquote`, `<blockquote>` | 20.8 | ✔ (server-side) |
| Business accounts | 7.2 (2024-03-31) | `business_connection_id` on sends, `business_message` updates | 21.1 | ✔, but not relevant |
| Message effects | 7.4 (2024-05-28) | `message_effect_id` (string) on sendMessage/sendPhoto/…; **private chats only**. Since 9.3 it also works on forward/copy. | 21.3 | ✔ `message_effect_id=` |
| Expandable blockquote | 7.4 | entity `expandable_blockquote`, `<blockquote expandable>`, MarkdownV2 `**>…||`. Blockquotes can't be nested. | 21.3 | ✔ (already used) |
| Caption above media | 7.4 | `show_caption_above_media` | 21.3 | ✔ |
| Telegram Stars (XTR) | 7.4 | `currency="XTR"`, no provider_token | 21.3 | ✔ |
| Paid media | 7.6 (2024-07-01) and later | `sendPaidMedia`, `InputPaidMedia*`, max 25000⭐ (9.3) | 21.4 | raw `do_api_request` |
| Copy-text button | 7.11 (2024-10-31) | `InlineKeyboardButton.copy_text: CopyTextButton{text}` | 21.7 | `api_kwargs` |
| Mini Apps 2.0 | 8.0 (2024-11-17) | fullscreen, home-screen shortcut, `savePreparedInlineMessage` + `shareMessage`, Star subscriptions (`createInvoiceLink.subscription_period`) | 21.8 | raw / frontend |
| Checklists | 9.1 (2025-07-03), 9.2 | `sendChecklist` / `editMessageChecklist`, **business accounts only** | 22.3 | not useful |
| Suggested posts / channel DMs | 9.2 (2025-08-15) | `suggested_post_parameters`, `direct_messages_topic_id` | 22.4 | not relevant |
| Topics in private chat | 9.3 (2025-12-31), 9.4 | `message_thread_id` in private chats, `createForumTopic` in private chats | 22.6 / 22.7 | raw |
| **Streaming drafts** | 9.3; all bots since 9.5 (2026-03-01) | `sendMessageDraft(chat_id, draft_id≠0, text, parse_mode, entities, message_thread_id, can_stop, keep_on_stop)`. Private chats only. The draft is an ephemeral 30-second preview, so you must finish with `sendMessage`. An empty `text` shows a "Thinking…" placeholder (10.0). `can_stop`/`keep_on_stop` arrived in 10.3 with update `stopped_message_generation`. | 22.6 (base only) | `do_api_request` |
| **Colored buttons** | 9.4 (2026-02-09) | `style`: `"primary"` (blue), `"success"` (green) or `"danger"` (red), on both `InlineKeyboardButton` and `KeyboardButton`. If omitted, the app's default style is used. | 22.7 | `api_kwargs` |
| **Custom-emoji button icons** | 9.4 | `icon_custom_emoji_id` on both button types. **Only works if the bot owner has Telegram Premium or the bot has a Fragment username.** | 22.7 | `api_kwargs` |
| Custom emoji in bot messages | 9.4 | `<tg-emoji emoji-id="…">`, same owner-Premium condition | n/a | ✔ (server-side) |
| Date/time entity | 9.5 | entity `date_time` (`unix_time`, `date_time_format`), HTML `<tg-time unix="1647531900" format="wDT">fallback</tg-time>`; doc examples also use `format="t"` | 22.7 | ✔ (server-side HTML) |
| Bottom-button icon (Mini App) | 9.5 | `BottomButton.iconCustomEmojiId` | n/a (JS) | frontend |
| Quiz polls v2 | 9.6 (2026-04-03) | `correct_option_ids` (multiple correct answers), `shuffle_options`, `allows_revoting`, `hide_results_until_closes`, `description` / `description_parse_mode`, `poll_option_id` in ReplyParameters; max auto-close 2628000 s | 22.8 | `api_kwargs` on `send_poll` |
| Poll media | 10.0 (2026-05-08) | `media` / `explanation_media` on sendPoll, media on options; `members_only` | 22.8 | `api_kwargs` |
| Delete reactions | 10.0 | `deleteMessageReaction`, `deleteAllMessageReactions` | 22.8 | raw |
| Live photos | 10.0 | `sendLivePhoto` | 22.8 | raw |
| **Rich messages** | 10.1 (2026-06-11), extended in 10.2, 10.3 and 10.5 | `sendRichMessage(rich_message: InputRichMessage, …)`, `sendRichMessageDraft`, `editMessageText.rich_message`. Blocks include Paragraph, SectionHeading, List, Table (`is_compact` in 10.3), Details, ExpandableBlockQuotation (holds arbitrary blocks since 10.5), MathematicalExpression, Footer, Divider, Photo/Video/Audio, Buttons (10.3) and Thinking. | none | `do_api_request` only |
| Ephemeral messages | 10.2 (2026-07-14) to 10.4 | `ephemeral_message_parameters: EphemeralMessageParameters{callback_query_id, receiver_user_id?, replace_callback_query_message}`, `editEphemeral*`, `deleteEphemeralMessage`, `BotCommand.is_ephemeral` | none | `do_api_request` |
| Native disabled buttons | 10.3 (2026-08-24) | `InlineKeyboardButton.disabled` / `DisabledButton`; `force_reply` on keyboards | none | `api_kwargs`. **Check the schema in the docs before use.** |
| Mini App origin lock | 10.2 | Mini App methods are blocked when called from other origins. **Turned on automatically on 2026-07-20**; opt out in @BotFather. | n/a | **check `miniapp/`** |
| Rich quotes | 10.4 (2026-11-09) | `ReplyParameters.quote_rich_texts`, `TextQuote.rich_texts` | none | raw |
| Widgets | 10.4 | `sendWidget`, `answerWidgetQuery`, … | none | skip for now |
| Bot settings | 10.5 (2026-11-22) | `setMySettings{callback_query_mode, has_topic_sidebar, can_manage_bots…}`; `getMe` now returns `BotFullInfo` | none | **Don't touch.** `callback_query_mode` can make callbacks arrive with `inline_message_id` and no `message`, which would break every `query.message` handler. |

Message effect IDs aren't published as constants. The values commonly used are
👍 `5107584321108051014`, 🔥 `5104841245755180586`, 🎉 `5046509860389126442`,
❤️ `5159385139981059251`, 👎 `5104858069142078462` and 💩 `5046589136895476101`.
**Test them in a private chat before relying on them.** An invalid ID makes Telegram
reject the whole send.

---

## 3. What HumsYar already uses (repo grep)

- **Expandable blockquote** is used widely: `backend/services/lecture_scribe.py:38`
  (`expandable_quote()`), `backend/bot/questions.py:1146/1220/1548/1868` (explanations),
  `backend/bot/start.py:71` (guidelines), and `backend/services/ai_solver.py:3759`
  (Markdown `>` converted to an expandable blockquote).
- **Plain `<blockquote>`** in `backend/bot/bot.py:321-368` and `backend/bot/admin.py:1713`;
  **`tg-spoiler`** is allowed in the ai_solver sanitizer (`ai_solver.py:2861`).
- **`bot_modern_ui`**:
  - `ButtonGridBuilder` is used in `start.py:65,260`, `questions.py:1246` and `lecture_scribe.py`.
  - `CompactTableBuilder` (a `<pre>` table) is used in `grades.py:368` and `lecture_scribe.py`.
  - `TelegramBotApiBridge` (`do_api_request`) exists but has no production callers.
  - Tests are in `tests/test_modern_bot_api.py`.
  - **Note:** `bot_modern_ui.py` exists both at the repo root and in `backend/bot/`, and **the
    two files differ**. Find out which one `from bot_modern_ui import …` resolves to at
    runtime before editing.
- **Quiz polls**: `backend/services/hooshyar_quiz.py:1364` `_send_question` (`type='quiz'`,
  `correct_option_id`, plain explanation) and `admin.py` `send_poll`.
- **AI streaming** is done by editing a placeholder message: `ai_solver.py` around 3794-3999
  (`thinking_msg.edit_text`, `EDIT_THROTTLE_SECONDS`, a 50-char step). `send_chat_action`
  `typing` / `record_voice` is used.
- `disable_web_page_preview=True` appears in `ai_solver.py`, `profile.py`,
  `message_router.py` and `bot.py`.
- `protect_content` is on by default (`references.py`, `basic_science.py`).
- **Not used anywhere:** `message_effect_id`, `LinkPreviewOptions`, `ReplyParameters`,
  reactions, `copy_text`, `style`, `icon_custom_emoji_id`, `sendMessageDraft`, `<tg-time>`,
  rich messages.
- `ApplicationBuilder` (`bot.py:2231`) sets no `Defaults`, and `allowed_updates=Update.ALL_TYPES`.

---

## 4. Prioritized UX upgrades (low risk first)

All items work on PTB 21.3 through `api_kwargs`, `do_api_request` or server-side HTML.
Clients that don't support a feature degrade gracefully: unknown button styles and icons
are ignored. The exception is an invalid `message_effect_id`, which fails the whole send.

1. **Colored buttons through one adapter.** Add to `ButtonGridBuilder`
   (`bot_modern_ui.py`) a `style=`/`icon=` parameter on `add_hero`, and a helper
   `styled_button(text, *, style=None, icon=None, copy_text=None, **kw)` that builds
   `api_kwargs`. Apply it as follows:
   - `utils.confirm_keyboard` (`utils.py:176`): yes is `success`, no is `danger`.
   - The "❌ انصراف" hero in `start.py:~268`: `danger`.
   - Primary CTAs (registration intake, `webapp_kb` in `utils.py:928`, `_campaign_cta_kb`
     in `subscription_admin.py:635`): `primary`.

   Add a unit test asserting `markup.to_dict()` contains `"style"`.
2. **Answer-review colors in Q-bank.** In the answer-review grid in `questions.py:~1246`,
   mark the correct option `success` and the user's wrong pick `danger`, keeping the ✅/❌
   emoji for old clients. Purely visual; the callbacks stay the same.
3. **Copy buttons.** Add `copy_text` for the student code (`student_code.py`), the
   referral link (`referral.py`) and any card or invoice numbers in the payment flow
   (`payments/`, `subscription.py`). The text can be 1-256 chars. This removes the
   "long-press to copy" friction.
4. **Message effects on milestones.** Pass `message_effect_id` (🎉) on private-chat sends
   for registration approval (`start.py`/`admin.py` approval notify), rank-up or challenge
   completion (the text near `questions.py:1240`), and quiz completion summaries
   (`hooshyar_quiz.py`). Guard on `chat.type == "private"` and wrap in try/except, falling
   back to a send without the effect.
5. **Native streaming for the AI tutor.** In `ai_solver.py` (~3794-3999), for private
   chats, replace the placeholder `edit_text` loop with
   `do_api_request("sendMessageDraft", {"chat_id", "draft_id", "text", "parse_mode": "HTML"})`
   using one fixed non-zero `draft_id` per answer. Keep the existing throttle, then send the
   final message with `send_message` (the draft disappears after 30 s). If the API returns
   `BadRequest`, fall back to the current edit path. Later, add `can_stop=True` and handle
   `stopped_message_generation` through the raw update in `api_kwargs`. Medium effort; it
   removes the edit-rate-limit flicker.
6. **Reactions as lightweight acks.** Use `message.set_reaction("👍")` on the user's
   message when a ticket is received (`ticket.py`), a file is uploaded to lecture_scribe, or
   a voice question is accepted. Use it instead of an extra "received" text.
   Native in 21.3 and best-effort.
7. **Localized date/time with `<tg-time>`.** Show exam dates, class times, subscription
   expiry and deadlines as `<tg-time unix="…" format="wDT">۱۴۰۵/۰۹/۰۴ ۱۰:۰۰</tg-time>` in
   `schedule.py`, `subscription.py` and `dunning.py`. Old clients see the Jalali fallback
   text. Put a helper next to the Tehran-time helpers in `backend/bot/utils.py`. Verify the
   other `format` codes in the date-time entity docs before use.
8. **Link previews done right.** Replace `disable_web_page_preview=True` with
   `link_preview_options=LinkPreviewOptions(is_disabled=True)` (in `profile.py`,
   `message_router.py`, `bot.py` and `ai_solver.py`; this also future-proofs the code).
   For resource and reference links (`references.py`, `resources.py`), use
   `LinkPreviewOptions(url=…, prefer_large_media=True, show_above_text=True)`.
9. **Spoilers for self-testing.** In flashcard and review screens (`questions.py`
   explanation blocks), wrap the answer key in `<tg-spoiler>` outside the expandable quote,
   so students can try to recall the answer before revealing it. Blockquotes can't nest, so
   keep one quote per message. Also move `expandable_quote()` from `lecture_scribe.py:38`
   into a shared util and reuse it in `questions.py`, `start.py` and `bot.py`.
10. **Quiz polls v2 for Hooshyar.** In `hooshyar_quiz._send_question`, pass through
    `api_kwargs`: `explanation_parse_mode="HTML"` (already native), `shuffle_options=True`
    (this needs a server-side index map, because shuffling is client-side and `poll_answer`
    still reports original indices — **verify**), and `description` for case vignettes.
    Keep `correct_option_id`: PTB 22.8 still accepts it and only deprecates it.
11. **Reply quotes for AI answers.** Send AI answers with
    `reply_parameters=ReplyParameters(message_id=user_msg_id, quote=<exact excerpt>)` when
    the user asked about one sentence. Native. The quote must be an exact substring or the
    send fails, so only set it when it's known to match.
12. **(Pilot, higher risk) Rich messages for structured content.** Use `sendRichMessage`
    with Table, Details, MathematicalExpression and SectionHeading blocks for grade reports
    (`grades.py:368`, currently a `<pre>` table) and lecture summaries
    (`lecture_scribe.py:1149`). It arrived in June 2026, isn't in any PTB release, and
    client support on older Android/iOS apps is unknown. Put it behind a setting flag
    (`db.get_setting('rich_messages_enabled', False)`) and keep the HTML path as the
    fallback. Read the `InputRichMessage` / `InputRichBlock*` schema first; this research
    didn't capture the exact block JSON.

**Do not adopt now:**
- `setMySettings.callback_query_mode` (it would break `query.message` handlers).
- Checklists (business accounts only).
- Suggested posts and widgets (no use case).
- Custom-emoji icons, unless the bot owner has Premium.
- Private-chat topics (a large flow redesign).

**Action item:** the Mini App origin lock (Bot API 10.2) turned on automatically on
2026-07-20. Confirm that `miniapp/` and `webadmin` Telegram WebApp calls still work.

---

## 5. PTB upgrade assessment (21.3 → 22.8)

Release path:
- 21.4-21.11: Bot API 7.5-8.3
- 22.0 (2025-03-15): removes 20.x deprecations
- 22.1: Bot API 9.0
- 22.3: 9.1
- 22.4/22.5: 9.2
- 22.6 (2026-01-24): 9.3, drops Python 3.9
- 22.7 (2026-03-16): 9.4 + 9.5
- 22.8 (2026-06-12): 9.6 + 10.0

Breaking or deprecated items checked against the repo:

| Change | Repo impact |
|---|---|
| 22.0 removes `Defaults.disable_web_page_preview` / `Defaults.quote`, `reply_*(quote=)`, `proxy_url`, `filters.CHAT`, `StatusUpdate.USER_SHARED`, `run_polling(*_timeout=)` | grep found no `Defaults(`, no `quote=` on replies (the `quote=False` hits are `html.escape`), no `proxy_url`, no `filters.CHAT`. **Check the `run_polling`/`run_webhook` arguments in `bot.py:2844/2869`.** |
| 22.2/22.3 timedelta migration: int durations deprecated (`PTB_TIMEDELTA`) | `RetryAfter.retry_after` is used as an int (`admin.py:1993`, `hooshyar_quiz.py:1380`). It still works but logs deprecation warnings. |
| 22.8 deprecates `correct_option_id`; `filename` in `InputMedia*` should be passed by keyword | `hooshyar_quiz.py:1373` and `admin.py` `send_poll` still work. |
| Bot API 9.0/9.3/9.6/10.0 new required fields | Only matters when constructing those objects manually. Tests that build `Poll`/`PollOption` mocks may need `persistent_id`, `allows_revoting` and `members_only`. |
| Dependencies | Check that the `httpx` pin in `requirements.txt` fits PTB 22.x's range, that the Python version in the Dockerfile is 3.10 or newer, and that `[job-queue]` (APScheduler) is compatible. |

**Recommendation.** Don't upgrade in the same change as the UX work. For a live bot with
about 100 users:
- **Phase 1:** stay on 21.3 and implement items 1-11 through the `api_kwargs` /
  `do_api_request` adapter, which has no dependency risk.
- **Phase 2:** on a separate branch, upgrade to `python-telegram-bot[job-queue]==22.8`,
  run `pytest -q` plus a smoke test against a staging bot token, then deploy. The repo
  doesn't touch any of the removed APIs that were checked, so the upgrade is **low to
  medium risk**. Its value is typed support for `style`, `copy_text`, `sendMessageDraft`
  and the poll v2 parameters, and security bumps (cryptography).
- Even PTB 22.8 stops at Bot API 10.0, so rich and ephemeral messages (10.1-10.5) will need
  `do_api_request` either way.

---

## Sources
- https://core.telegram.org/bots/api-changelog
- https://core.telegram.org/bots/api (KeyboardButton, InlineKeyboardButton, sendMessageDraft, sendRichMessage, setMessageReaction, formatting options)
- https://github.com/python-telegram-bot/python-telegram-bot/releases
- https://docs.python-telegram-bot.org/en/stable/changelog.html
- Local: `C:\Users\Amir\AppData\Local\Programs\Python\Python312\Lib\site-packages\telegram` (`constants.py:149`, `_bot.py:792`, `_telegramobject.py:649`, `_inline/inlinekeyboardbutton.py:250`)
