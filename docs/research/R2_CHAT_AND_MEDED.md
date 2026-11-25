# R2 — هوشیار: ChatGPT-parity chat spec + medical-education UX patterns

Status: research only. No application code was changed. Date: 2026-11-25.

Grounding (files read):
- Frontend: `apps/student/src/lib/ai.ts`, `apps/student/src/screens/ai/AiChatScreen.tsx`, `apps/student/package.json` (deps are only react, react-dom, react-router-dom and pdfjs-dist).
- Backend: `backend/api/routers/ai.py` (2,622 lines), `backend/database/core.py::ai_conv_list`, `backend/services/ai_solver.py` (`MAX_INPUT_CHARS = 2000`).

---

## 0. What exists today (the baseline)

**Backend (`backend/api/routers/ai.py`)**

| Endpoint | Behaviour that matters for the UI |
|---|---|
| `GET /api/ai/status` | `enabled`, `banned`, `daily_limit`, `used_today`, `remaining`, `unlimited`, `disabled_message`, `max_input_chars` (2000), `max_media_bytes`, `capabilities{text,image,pdf,audio,reference_document}`, `active_reference`. Everything a quota or capability UI needs is here. |
| `GET /api/ai/conversations?include_archived=` | Returns up to 200 conversations, metadata only (`id,title,pinned,archived,preview(90),count,legacy,created_at,updated_at`), sorted pinned-first then by `updated_at` desc. A synthetic `legacy` thread (shared memory with the Telegram bot) is inserted after the pinned items. No pagination, search or cursor. |
| `POST /api/ai/conversations` | `{title?}` returns `{id}`. Deletes the user's earlier empty conversations first. |
| `GET /api/ai/conversations/{cid}/messages` | `[{role,text,at}]`. **Messages have no id**, there is no paging, and each text is capped at 12k chars. |
| `PATCH /api/ai/conversations/{cid}` | `title`, `pinned`, `archived`. Rename, pin and archive are covered. |
| `DELETE /api/ai/conversations/{cid}` | Deletes the conversation. On `legacy` it clears the shared memory and the reference doc. |
| `POST /api/ai/conversations/{cid}/duplicate` | Makes a full copy as a new conversation (also works on `legacy`). |
| `POST /api/ai/ask` and `/ask/stream` | Body `{message ≤2000, conversation_id?}`. SSE when `Accept: text/event-stream` is sent. Events: `event: token data:{"text"}` and `event: done data:{"tokens_used"}`. Context sent to the model is the last 10 items, each truncated to 1,200 chars. The stream checks `request.is_disconnected()` and **still saves the partial answer** after the loop, so Stop keeps the partial text. Rate limit is 30 requests per 60 s per user, plus the daily quota and one in-flight request per user (`_acquire_user`). |
| `POST /api/ai/ask-media` | Multipart `message`, `file` (image/PDF/audio) and `conversation_id`. **Not streamed.** Saved to the conversation. |
| `POST /api/ai/vision` | One-off medical-image analysis returning `{analysis, detected_structures, confidence_level, tokens_used}`. Not tied to a conversation. |
| `POST/DELETE /api/ai/reference` | Attaches or clears a PDF reference ("chat with PDF") without using quota. |
| `POST /api/ai/report` | `{question, answer}`. This is the only feedback channel, and it is effectively thumbs-down only. |
| `POST /api/ai/generate-image`, `/live/config`, `WS /live/ws` | Image generation and live voice. Out of scope here, but worth surfacing later. |

**Frontend gaps (`AiChatScreen.tsx`, `ai.ts`)**
1. `streamAiChat(text, null, …)`: the screen always passes `null`, so every message goes to the shared `legacy` memory. Multi-conversation support is effectively off, even though the backend supports it.
2. `ai.conversations()` exists but no screen uses it. There is no sidebar.
3. Messages render as `whiteSpace: pre-wrap` plain text. There is no Markdown, tables, code or math, and no `dir="auto"`.
4. `scrollIntoView({behavior:'smooth'})` runs on **every token**. This causes jank and fights the user when they scroll up.
5. The layout uses `height: calc(100vh - 120px)`. That breaks on iOS Safari because the toolbar changes `100vh` and the keyboard covers the composer.
6. The SSE parser resets `currentEvent` inside each chunk loop. If an `event:` line and its `data:` line arrive in different network chunks, the token is dropped. **Bug, P0.**
7. The textarea is `disabled` while streaming, which closes the keyboard on iOS. It also has no auto-grow (only `maxHeight`), no draft persistence and no counter for the 2000-char limit.
8. Vision is a separate modal, and its results are injected into local state only. They are not persisted to the conversation; `/ask-media` with `conversation_id` would persist them.
9. `fetch` uses `credentials:'same-origin'` with no auth header. Check that this matches how `api.ts::apiCall` authenticates (cookie or bearer). If it is bearer, streaming will return 401 in production.

---

## Part A — Parity checklist (ChatGPT / Claude.ai / Gemini vs OSS vs Humsyar)

Legend for the last column: ✅ backend supports it today · ➕ small additive endpoint or field needed · FE = frontend-only work.

OSS references:
- **LibreChat** ([repo](https://github.com/danny-avila/LibreChat)) uses `react-markdown`, `remark-gfm`, `remark-math`, `rehype-katex`, `rehype-highlight`, `react-textarea-autosize`, `@tanstack/react-virtual`, `sse.js`, recoil/jotai and react-query. Its README lists branching on edit/resubmit, forking, message search, resumable streams, RTL layouts and restored drafts.
- **open-webui** ([repo](https://github.com/open-webui/open-webui)) is built with Svelte and uses `marked`, `katex`, `highlight.js`/`shiki`, `mermaid`, `dompurify` and `eventsource-parser`.
- **lobe-chat** ([repo](https://github.com/lobehub/lobe-chat)) uses `react-markdown`, `remark-gfm`, `shiki`, `react-virtuoso`/`virtua`, `zustand`+`immer` and a custom `fetch-sse`.
- **chatbot-ui** ([repo](https://github.com/mckaywrigley/chatbot-ui)) uses `react-markdown`, `remark-gfm`, `remark-math`, `react-syntax-highlighter` and Context for state.
- **big-AGI** ([repo](https://github.com/enricoros/big-AGI)) is React with zustand. Its notable UX is branching/"beam" multi-answer and per-message edit/delete. These are general knowledge, not re-verified in this pass.

### A1. Conversation sidebar / history

| Feature | ChatGPT / Claude pattern | OSS implementation | Humsyar |
|---|---|---|---|
| Time grouping (Today, Yesterday, Previous 7 days, Previous 30 days, then by month) | Groups by `updated_at` in the sidebar. | LibreChat groups client-side with date-fns style buckets. | ✅ `updated_at` exists. FE: bucket in the Tehran tz using `Intl.DateTimeFormat('fa-IR',{calendar:'persian'})` and labels «امروز / دیروز / ۷ روز گذشته / ۳۰ روز گذشته / <ماه شمسی>». |
| Pinned section on top | ChatGPT has a pin item in the ⋯ menu (web) or on long-press (mobile); one guide reports a 3-pin cap. | — | ✅ `pinned` in PATCH, and the list is already sorted pinned-first. |
| Search chats | ChatGPT finds chats from the sidebar search ([help](https://help.openai.com/en/articles/10056348-finding-your-chats-projects-and-files-in-chatgpt)). Searching message bodies too is the expected bar. | LibreChat "search all messages/conversations" (Meilisearch). | FE can filter titles and previews in place, because there are at most 200 items. ➕ `GET /conversations/search?q=` for message-body search (a Mongo `$text` index on `items.t`). P1. |
| Rename (inline) | ⋯ → Rename, inline input. | — | ✅ PATCH `title` (≤80). |
| Auto-title after the first answer | Title is generated from the first exchange. | LibreChat runs a title-generation call. | ➕ The SSE path calls `ai_conv_append(title=None)`. Add server-side auto-title: first 40 chars of the first user message, or a cheap model call when `msg_count==2`. P0, because otherwise everything is titled «گفتوگوی جدید». |
| Delete with confirm + undo toast | Confirm modal. | — | ✅ DELETE. FE: optimistic removal plus a 5 s undo that delays the DELETE call. |
| Archive | ChatGPT has Archive. | — | ✅ `archived` and `include_archived`. |
| Duplicate / branch-from-here | ChatGPT "Branch in new chat". | LibreChat Fork. | ✅ Whole-conversation duplicate. ➕ `duplicate?upto=<index>` for branching from a message. P1. |
| Share link (read-only snapshot) | Snapshot links, so later messages are not included ([help](https://help.openai.com/en/articles/7925741-sharing-conversations-and-scheduled-tasks-in-chatgpt)). | LibreChat shared links. | ➕ `POST /conversations/{cid}/share` → `{token}`, plus a public `GET /share/{token}`. Medical content needs a disclaimer banner. P2. |
| Infinite scroll | Lazy pagination of history. | react-virtual / virtuoso. | 200 items in one call is fine for now (FE only). ➕ `?cursor=&limit=` later. P2. |
| Legacy/Telegram thread | — | — | ✅ Render `legacy:true` with a Telegram badge. Rename and pin are blocked (the server returns 400), so hide those actions. |

### A2. New chat
- ChatGPT: a "New chat" button (pencil icon) at the top of the sidebar and in the header. The conversation is created **lazily on the first send**, so blank threads never pile up.
- Humsyar: ✅ `POST /conversations` already cleans up empty threads. Recommendation: on the first send with no `activeId`, call `POST /conversations {title: first 40 chars}`, then stream with the returned id, then `navigate('/ai/c/:id', {replace:true})`. Routes: `/ai` (new) and `/ai/c/:cid`.

### A3. Streaming

| Item | Pattern | Implementation | Humsyar |
|---|---|---|---|
| Transport | ChatGPT and Claude use POST + SSE over fetch. | `eventsource-parser` (about 1 kB, open-webui), `@microsoft/fetch-event-source`, `sse.js` (LibreChat). | ✅ SSE already works. FE: replace the hand parser with `eventsource-parser` (fixes bug #6). |
| Start event with ids | The server sends the message and conversation ids first. | LibreChat `created` event. | ➕ Emit `event: start data:{conversation_id, user_msg_index}` before the first token. P1. |
| Error event mid-stream | An inline red "Something went wrong · Retry" bubble. | — | ➕ Today an exception in `ask_ai_stream` simply ends the stream with no `done` and no message. Wrap it and emit `event: error data:{code,message}`. P0 (backend, about 10 lines). |
| Stop button | The send button turns into ■ while streaming. | AbortController. | ✅ The partial answer is persisted on disconnect. FE: keep the partial text and mark it «متوقف شد». |
| Typing indicator / caret | Pulsing dot, then a caret at the end of the text. | — | FE. |
| Auto-scroll with "jump to bottom" | Follows the stream only while the user is at the bottom (within about 80 px). Scrolling up pauses it and shows a ↓ pill. | `use-stick-to-bottom` (about 3 kB, by StackBlitz, used by Vercel's ai-chatbot) or react-virtuoso `followOutput`. | FE: an IntersectionObserver on a bottom sentinel plus `scrollTop` assignments. Never smooth-scroll per token. |
| Render throttling | Tokens are batched per animation frame. | lobe-chat uses an rAF buffer. | FE: buffer tokens in a ref, flush with `requestAnimationFrame`, and re-parse Markdown at most every 50–80 ms. |
| Resumable stream after reload or network drop | LibreChat "Resumable Streams" (Redis). | — | P2. On iOS a backgrounded tab kills fetch. Minimal fallback: on reconnect, refetch `/messages`, which contains the saved partial. |
| Streamed media answers | — | — | ➕ `/ask-media` is non-streaming. Acceptable for P0 (show a skeleton). P2 is SSE parity. |

### A4. Message actions

| Action | ChatGPT | OSS | Humsyar |
|---|---|---|---|
| Copy (Markdown text) | Icon row under each assistant message; "Copied" tick. | LibreChat can also copy as rich text. | FE: `navigator.clipboard.writeText`, with an execCommand fallback for old iOS. |
| Copy a code block | Copy button on the block header. | — | FE. |
| Regenerate the last answer | ↻ under the last answer. Versions were shown as "‹ 2/3 ›". OpenAI has recently moved some web accounts to a "View versions" window (community reports, Oct 2026). | LibreChat keeps a message tree with `parentMessageId`. | ➕ `POST /conversations/{cid}/regenerate` (SSE): drop the last assistant item, re-ask using the last user item. P0-lite: the client sends `regenerate:true` on `/ask`. Versions are P2. |
| Edit & resend a user message | Pencil on hover; the conversation re-forks from that point. | LibreChat branching; big-AGI edit-in-place. | ➕ `POST /conversations/{cid}/truncate {index}` (keep items `< index`) followed by a normal `/ask`. P1. A true branch tree is P2 and needs `parent_id` per item. |
| Thumbs up/down + reason | 👍/👎; 👎 opens chips plus free text. | — | Partial: `/report {question, answer}` covers 👎. ➕ `POST /conversations/{cid}/feedback {index, rating, reason?}`, stored on the item. P1. Clinicians care about "factually wrong" and "unsafe dose" reasons. |
| Read aloud | 🔊 TTS per message. | LibreChat TTS. | FE: `speechSynthesis` with `lang='fa-IR'`. iOS has a Persian voice only on some versions, so feature-detect and hide the button if none exists. The server has `/live` (Gemini Live) for a later P2. |
| Message timestamp / tokens | ChatGPT hides these. | — | Hide tokens from students; show the time on long-press. |
| Report unsafe content | Report button. | — | ✅ `/report`. |

### A5. Rendering (the highest-risk area for Persian)

| Item | Recommendation |
|---|---|
| Markdown | `react-markdown` v9 + `remark-gfm` (tables, task lists, strikethrough, autolinks). About 45 kB gz combined. Load it in the chat route chunk only. No `rehype-raw`, so HTML is never rendered (XSS-safe without DOMPurify). |
| Math | `remark-math` + `rehype-katex`, with `katex/dist/katex.min.css` plus fonts (about 75 kB gz JS and 20 kB CSS). **Lazy-load** only when the text matches `/\$|\\\(|\\\[/`. Also normalise `\(…\)` and `\[…\]` to `$…$` and `$$…$$`, because LLMs emit both. Math must be forced to `direction:ltr; unicode-bidi:isolate`. |
| Code highlight | **shiki** gives the best output but is about 250 kB+ with wasm, and its grammars load async. Use it lazily through `shiki/bundle/web` with only a few languages, or use **highlight.js core** with a few languages (python, js, sql, bash, json; about 20 kB). For a medical app code is rare, so recommend highlight.js core via `rehype-highlight`, lazy-loaded. The code block gets a header with the language label and a Copy button, `dir="ltr"`, horizontal scroll and `-webkit-overflow-scrolling: touch`. |
| Tables | Wrap them in `<div class="md-table" dir="auto" style="overflow-x:auto">`. Use a sticky first column on mobile for drug comparison tables. |
| Per-paragraph auto direction | ChatGPT and Claude use `dir="auto"` on blocks. In the react-markdown `components` map, put `dir="auto"` on `p, li, h1–h6, blockquote, td, th`. `dir=auto` uses the first strong character, so a Persian paragraph that starts with "ECG" would render LTR. Add a custom heuristic: compute the RTL character ratio of the block's text and set `dir="rtl"` when it is at least 30%. Wrap inline Latin runs (drug names, lab units such as `mg/dL`) in `<bdi>`; the browser handles that via `unicode-bidi: plaintext` on `p`. LibreChat lists "RTL layouts"; open-webui has a per-chat RTL toggle. |
| Lists in RTL | Use `padding-inline-start`, never `padding-left`. Use Persian digits only in prose, never inside doses or code. Do not run a global `toFa()` over the model output, because it corrupts "5 mg" vs «۵ mg» consistency and formulas. |
| Links | `target=_blank rel="noopener noreferrer"`. External medical links show the domain chip. |
| Mermaid diagrams | P2, lazy-loaded (about 600 kB). Useful for algorithms such as ACLS flowcharts. |
| Medical disclaimer | A small footer under the composer: «هوشیار ممکن است اشتباه کند؛ برای تصمیم بالینی به منابع معتبر مراجعه کنید». ChatGPT has an equivalent line. |

### A6. Composer

| Item | Implementation |
|---|---|
| Auto-growing textarea, 1–8 rows | `react-textarea-autosize` (about 1.3 kB, LibreChat) or CSS `field-sizing: content`. That property is Chromium-only and missing on iOS 18, so use JS. |
| Enter vs Shift+Enter | Desktop: Enter sends. **Mobile (coarse pointer): Enter inserts a newline** and only the button sends, as in the ChatGPT iOS app. Check `e.nativeEvent.isComposing` to avoid sending mid-IME. |
| Do not disable while streaming | Keep it editable so the keyboard stays open. Only the send button switches to Stop. |
| Char limit | `status.max_input_chars` (2000). Show a counter from 80%, block at 100%, and use «…/۲۰۰۰» in Persian digits. The backend `Field(max_length)` returns 422, so map that to a friendly message. |
| Image attach / paste / drag-drop | One attachment tray with thumbnails, a remove (×) button and a progress ring. Paste listens to `onPaste` for `clipboardData.files`; drag-drop uses `onDrop`. On iOS, `<input type=file accept="image/*,application/pdf" capture>` offers camera or library. Downscale on the client to 2048 px and convert HEIC to JPEG through `createImageBitmap` + canvas, then send with `/ask-media` and the `conversation_id`. That persists the exchange and retires the separate vision modal. Keep "تحلیل تخصصی تصویر" as a toggle that routes to `/vision`. Gate it on `status.capabilities.image/pdf/audio`. |
| Prompt suggestions | Empty-state cards. After an answer, optionally show 2–3 follow-up chips (P2, needs the model to return them). |
| Draft persistence | `localStorage['hym.ai.draft.'+cid]`, debounced at 300 ms and cleared on send. LibreChat lists "restored drafts". |
| Voice input | P2: the Web Speech API is unreliable on iOS Safari. Use the `/live` WebSocket or server STT. |

### A7. Mobile UX (iPhone Safari first)
- **Layout:** the shell uses `height: 100dvh` (with a `100vh` fallback) and a `grid-template-rows: auto 1fr auto` layout. Header, scroller and composer are each regular blocks; never put the composer in `position:fixed`.
- **Keyboard:** iOS Safari ignores `interactive-widget=resizes-content` (supported in Chrome and Firefox). Listen to `visualViewport` `resize` and `scroll` events, compute `inset = innerHeight − vv.height − vv.offsetTop`, and ignore values under 60 px (those are toolbar changes). Write the result to `--kb` and apply `padding-bottom: max(var(--kb), env(safe-area-inset-bottom))` to the composer. Reference implementation: [ios-pwa-keyboard-fix](https://github.com/Crscristi28/ios-pwa-keyboard-fix); see also [SO 77200936](https://stackoverflow.com/questions/77200936/is-there-any-fix-to-ios-safari-and-chrome-fixed-position-for-when-keyboard-show) and [SO 79751159](https://stackoverflow.com/questions/79751159/mobile-chat-widget-panel-shrinks-and-header-composer-misaligns-when-keyboard-ope). Known bug: in home-screen PWAs the viewport can stay shrunk after the first keyboard open, so recompute on `focusout`.
- Use `font-size ≥ 16px` on the textarea, otherwise iOS zooms on focus. The current 14 px triggers zoom.
- **Safe areas:** `viewport-fit=cover`, `env(safe-area-inset-*)` on the header and composer.
- **Sidebar:** a drawer that slides in from the **right** (RTL), with an edge swipe, backdrop and focus trap. Persistent column at ≥1024 px. Long-press a row to open an action sheet (Pin, Rename, Duplicate, Archive, Delete), matching ChatGPT mobile.
- `overscroll-behavior: contain` on the scroller; touch targets ≥44 px; `touch-action: manipulation`.
- Handle `visibilitychange` and `pagehide`: if a stream was running when the tab was backgrounded, refetch messages on return.

### A8. Errors, retry, quota

| State | UX | Source |
|---|---|---|
| Network or SSE error | Inline bubble «پاسخ کامل نشد» with a Retry button (regenerate). The partial text is kept. | ➕ `event:error` |
| 429 rate limit (30/min) | «کمی صبر کن — X ثانیه» with a countdown. Read `Retry-After` if present. | ✅ rate_limit; check the header is set (gap if not). |
| 409/423 in-flight lock | «پاسخ قبلی هنوز در حال تولید است». | ✅ `_acquire_user` |
| Daily quota exhausted | The composer is replaced by a card showing «سهمیهی امروز تمام شد (used/limit)» and the reset time (Tehran midnight), plus an upgrade CTA if plans exist. Show a soft "۳ پرسش باقیمانده" chip once `remaining ≤ 3`. | ✅ `/status` |
| Disabled or banned | A full-screen empty state with `disabled_message`. | ✅ `/status` |
| 422 input too long | Inline counter error. | ✅ |
| 503/502 provider | «سرویس موقتاً در دسترس نیست» with retry. | ✅ |

### A9. Empty state (Persian medical starter prompts)
Show 4 cards (2×2 on tablet), chosen at random from a pool of about 16 and grouped by intent:
- توضیح: «پاتوفیزیولوژی نارسایی قلبی با EF کاهشیافته را ساده توضیح بده»
- مقایسه: «جدول مقایسهی مهارکنندههای ACE و ARB (مکانیسم، عوارض، منع مصرف)»
- کیس: «یک کیس بالینی درد قفسهسینه برای تمرین تشخیص افتراقی بساز»
- آزمون: «۵ سؤال چهارگزینهای سطح پرهانترنی از اختلالات اسیدوباز با پاسخ تشریحی»
- تفسیر: «این ABG را تفسیر کن: pH 7.31, PaCO2 30, HCO3 15»
- حفظ: «یک مِنمونیک برای اعصاب مغزی و عملکردشان»
- تصویر (only if `capabilities.image`): «تصویر رادیولوژی/ECG را بفرست تا تحلیل کنم»

Also show the active reference PDF chip (`status.active_reference`) when present: «در حال گفتوگو با: <نام فایل>».

### A10. Library and bundle plan (Vite + React + TS)

| Lib | Size (gz, approx.) | Load |
|---|---|---|
| `react-markdown`, `remark-gfm` | about 45 kB | chat route chunk |
| `eventsource-parser` | about 1 kB | eager in `ai.ts` |
| `react-textarea-autosize` | about 1.3 kB | eager |
| `use-stick-to-bottom` (or a custom ~60 LOC hook) | about 3 kB | eager |
| `remark-math`, `rehype-katex`, `katex` CSS and fonts | about 95 kB | `import()` on first math detection |
| `rehype-highlight` + highlight.js core with 6 languages | about 25 kB | `import()` on first fenced block |
| `zustand` (store) | about 1 kB | eager |
| `@tanstack/react-virtual` | about 5 kB | P2, only if conversations exceed about 300 messages (the cap is 120 today, so not needed) |
| `mermaid` | about 600 kB | P2, lazy |

Load the chat screen itself with `React.lazy` so the dashboard bundle stays untouched.

---

## Part B — Medical-education app patterns

### B1. Question bank UX
- **UWorld:** the Create Test screen has a mode (Tutor on/off, Timed on/off), then a Subjects × Systems grid with counts, then question filters (Unused, Incorrect, Marked, All). Tutor mode shows the answer and explanation right after each question; with Tutor off nothing is revealed until the block ends, mimicking the exam. Timed mode is off by default and recommended only for exam simulation. Explanations cover every option ("why each choice is right/wrong") and end with an educational objective. Blocks contain up to 40 questions (the Step 1 forms are 8×20 at 30 min each). Mark/flag, strike-through of options, a lab-values pane, an exhibit viewer and a notebook. Sources: [uworld.com](https://www.uworld.com/) (QBank guides, via web search).
- **AMBOSS:** a Study vs Exam mode toggle per session; Study mode turns on aids. The **Attending Tip** is a graded hint for working toward a differential; "Highlight relevant terms" marks the stem; each question has a difficulty hammer rating (1–5) and %-correct by peers; explanations deep-link into the Library. Exam-mode highlights reset per question. Library: "Key exam info" (3 shades of yellow) and "High-yield mode" that collapses an article. Source: [support.amboss.com](https://support.amboss.com/).
- **Patterns for Humsyar:** (1) a session builder of mode × subject chips × source filter (new / wrong / flagged); (2) tutor reveal via a bottom sheet after submit, showing the chosen option in red, the correct in green, the % of peers who chose each, and the explanation; (3) flag and strike-through with long-press on an option; (4) a review screen as a grid of numbered tiles coloured correct/incorrect/flagged, filterable by subject; (5) **"از هوشیار بپرس"** on every explanation, which opens a هوشیار chat pre-seeded with the stem and the user's answer (the main integration point between the qbank and the AI).

### B2. Spaced repetition and flashcards
- **Anki/FSRS:** the default target retention is 0.9; higher retention means more reviews. The scheduler predicts difficulty, stability and retrievability. The "Review Heatmap" add-on popularised a GitHub-style calendar with streaks. Its known pitfall is streaks visually "breaking" after a scheduler change, which causes anxiety. Sources: [FSRS](https://github.com/open-spaced-repetition/fsrs4anki), [AnkiWeb add-ons](https://ankiweb.net/shared/addons).
- **Brainscape:** Confidence-Based Repetition (rate 1–5 after reveal, and the interval follows). The rating step is framed as metacognition, and the 1–5 scale is simpler than Anki's 4 buttons. Source: [brainscape.com/academy](https://www.brainscape.com/academy/).
- **Lecturio:** recall questions inside or right after each video, tied to learning objectives, with states Unanswered / Due Today / Memorized. Source: [lecturio.com](https://www.lecturio.com/).
- **Pattern:** after each lecture or PDF chapter, offer 3–5 quick recall questions (هوشیار can generate them), feeding a "Due today" counter.

### B3. Study dashboards (progress without anxiety)
- Use a **weekly target** instead of a hard daily streak. Duolingo-style streak freezes help, or Anki's heatmap without a "broken" red day. Show "۵ از ۷ روز این هفته" rather than "streak lost".
- Lead with **one primary next action** («۲۰ کارت مرور + ادامهی فصل ۳ قلب»). This is the AMBOSS/UWorld study-plan pattern.
- Show performance by subject as a horizontal bar with a percentile band, colour-coded only when n ≥ 20 questions to avoid noisy alarm. Show trend arrows, not raw red numbers.
- Celebrate mastery, such as "Memorized" counts (Lecturio). Keep the ranking or leaderboard opt-in.

### B4. PDF and lecture reader
- **Resume position:** auto-save page and scroll offset per document (debounced) and show a "ادامه از صفحهی ۴۷" chip on open. Osmosis and Lecturio resume videos; the web search did not confirm Osmosis specifics.
- **Bookmarks and highlights:** colour highlights with a note, plus a side panel listing all notes grouped by page and exportable. AMBOSS highlights persist in Study mode.
- **Ask about the selection:** select text, then "از هوشیار بپرس". The backend already supports `/reference` (PDF attached as context), so هوشیار can answer "از همین جزوه".
- **Offline:** pdf.js plus Cache Storage via the service worker for the last N opened docs; annotations are queued in IndexedDB and synced.
- Tap the centre to hide chrome; show a reading progress bar; offer a dark sepia theme for night study.

### B5. Weekly schedule presentation
- A 7-day horizontal strip (Saturday-first, Persian calendar) showing today, with per-day load dots. Tapping a day opens a vertical agenda of blocks (lecture, Qbank, review) with estimated minutes.
- **Elastic rescheduling:** a missed block rolls forward with a calm notice («۲ مورد به فردا منتقل شد»). AMBOSS and UWorld study planners recompute from the exam date.
- Show the countdown to the exam date as a quiet header, not a red alarm.

---

## 1. Prioritized implementation spec for هوشیار

### P0 — make it a real multi-conversation ChatGPT-class chat (about 1.5–2 weeks FE, about 1 day BE)
1. Routes `/ai` and `/ai/c/:cid`. Lazy creation on the first send. Actually pass `conversation_id`.
2. Sidebar drawer: list with time groups, pinned section, client-side title search, and rename/pin/duplicate/archive/delete through an action sheet. Show the legacy thread with a badge.
3. Load the history (`/messages`) when switching conversations.
4. Streaming: `eventsource-parser`, a rAF token buffer, Stop that keeps the partial text, a stick-to-bottom scroller and a ↓ pill.
5. Markdown with `remark-gfm` and a direction heuristic per block; lazy KaTeX; lazy highlight.js; a code copy button; scrollable tables.
6. Message actions: copy, regenerate (last answer), and 👎 report (existing `/report`).
7. Composer: autosize, Enter rules, stays enabled while streaming, 2000 counter, draft persistence, 16 px font, attachments through `/ask-media` with `conversation_id`.
8. iOS shell: `100dvh`, `visualViewport` → `--kb`, safe areas, right-side drawer.
9. Status-driven states: quota chip and exhausted card, disabled or banned, 429 countdown, inline error with retry.
10. Empty state with Persian medical starters and a disclaimer.
11. Backend P0: `event:error`, auto-title for the SSE path, regenerate (flag or endpoint), and a check that the streaming auth matches `apiCall`.

### P1
Edit & resend (truncate), 👍/👎 with reasons, message-body search, branch-from-message (partial duplicate), a `start` SSE event with ids, TTS read-aloud (feature-detected), "Ask هوشیار" deep links from the qbank and reader (seeded prompt plus `/reference`), an archived view, follow-up suggestion chips.

### P2
A true branch tree with version arrows, share links, resumable streams, streamed media answers, Mermaid, voice via `/live`, virtualisation, cursor pagination, export to Markdown or PDF.

### Component tree
```
<AiShell>                         // 100dvh grid, --kb var, safe areas
  <ConversationDrawer>            // right drawer (mobile) / column (≥1024)
    <NewChatButton/> <ConversationSearch/>
    <ConversationGroup label="سنجاقشده|امروز|دیروز|۷ روز|۳۰ روز|ماه">
      <ConversationRow/>          // long-press → <ConversationActionSheet/>
  <ChatPane>
    <ChatHeader/>                 // title (tap to rename), menu, quota chip
    <MessageList>                 // stick-to-bottom scroller
      <EmptyState/> | <MessageItem>*
         <UserBubble/> (edit P1) | <AssistantMessage>
            <MarkdownView/>       // lazy <MathBlock/>, <CodeBlock/>, <TableWrap/>
            <AttachmentPreview/>
            <MessageActions/>     // copy · regenerate · 👍👎 · 🔊
         <StreamErrorBubble/>
      <JumpToBottomPill/>
    <Composer>
      <AttachmentTray/> <AutoTextarea/> <CharCounter/> <SendStopButton/>
    <QuotaBanner/> <Disclaimer/>
```

### State model (zustand, a single `useAiStore`)
```ts
type Role = 'user'|'assistant';
interface Msg { key: string;            // client key; server index once loaded
  role: Role; text: string; at?: string;
  status: 'done'|'streaming'|'stopped'|'error';
  attachments?: {kind:'image'|'pdf'|'audio'; url: string; name: string}[];
  feedback?: 1|-1; error?: {code:string; message:string} }
interface Conv { id: string; title: string; pinned: boolean; archived: boolean;
  preview: string; count: number; legacy: boolean; updated_at?: string }
interface AiState {
  status: AiStatus | null;                     // GET /status, refreshed after each answer
  convs: Conv[]; convsLoaded: boolean; query: string;
  activeId: string | null;                     // null = unsaved new chat
  messages: Record<string, Msg[]>;             // per conversation cache
  stream: { convId: string; abort: AbortController; buffer: string } | null;
  drafts: Record<string, string>;              // mirrored to localStorage
  drawerOpen: boolean;
  // actions
  loadConvs(); openConv(id); newChat(); send(text, files?); stop();
  regenerate(); rename(id,t); togglePin(id); duplicate(id); archive(id); remove(id);
}
```
Rules:
- One stream at a time, which matches the server's in-flight lock.
- Optimistic updates for sidebar mutations, rolled back on error.
- After `done`, bump the conversation's `updated_at`, `preview` and `count` locally, then call `/status` to update the quota.

---

## 2. Backend endpoint gaps (all additive and backward-compatible)

| # | Gap | Proposal | Pri |
|---|---|---|---|
| 1 | Errors inside the stream are silent | Wrap `ask_ai_stream` in try/except, then `yield "event: error\ndata:{code,message}"`, and always emit `done`. | P0 |
| 2 | SSE path never sets a title | When `msg_count==0`, pass `title=message[:40]` to `ai_conv_append` (optionally an LLM title later). | P0 |
| 3 | No regenerate | `AskRequest.regenerate: bool`: pop the last assistant item and reuse the last user item, or add `POST /conversations/{cid}/regenerate` (SSE). | P0 |
| 4 | Streaming auth parity | Confirm that `/ask` accepts the same auth mechanism `apiCall` uses (cookie vs `Authorization`), or have the FE add the header. | P0 (verify) |
| 5 | 429 without `Retry-After` (unverified) | Ensure `rate_limit_dependency` sets `Retry-After`, and return a structured `{code:'RATE_LIMIT', retry_after}`. | P0 |
| 6 | Messages have no stable id or index | Return `index` (and later `id`) in `/messages`; add an `event: start {conversation_id, index}`. | P1 |
| 7 | Edit & resend | `POST /conversations/{cid}/truncate {index}`. | P1 |
| 8 | Feedback | `POST /conversations/{cid}/feedback {index, rating:±1, reason?, note?}`, reusing `ai_log_report` for −1. | P1 |
| 9 | Message search | `GET /conversations/search?q=` with a Mongo text index on `items.t`, returning `{cid, title, snippet, index}`. | P1 |
| 10 | Branch from a message | `POST /conversations/{cid}/duplicate?upto=index`. | P1 |
| 11 | Attachments not echoed in history | Store `{kind, name}` (no remote URI) on the user item from `/ask-media`, and return it in `/messages`. | P1 |
| 12 | Share links | `POST /conversations/{cid}/share`, `DELETE …/share`, public `GET /share/{token}` (snapshot copy). | P2 |
| 13 | Pagination | `GET /conversations?cursor=&limit=`; `GET /messages?before=&limit=`. | P2 |
| 14 | Streaming media | SSE variant of `/ask-media`. | P2 |
| 15 | Branch tree | `parent_index` per item, `GET /messages?leaf=`. | P2 |
| 16 | Context window | Context is the last 10 items at 1,200 chars each, which is too short for edited long answers or "continue". Consider a configurable `CONV_CONTEXT_ITEMS` or a summary memory. | P2 |

Sources (web): [help.openai.com — finding chats](https://help.openai.com/en/articles/10056348-finding-your-chats-projects-and-files-in-chatgpt) · [help.openai.com — sharing](https://help.openai.com/en/articles/7925741-sharing-conversations-and-scheduled-tasks-in-chatgpt) · [LibreChat](https://github.com/danny-avila/LibreChat) and its [client/package.json](https://raw.githubusercontent.com/danny-avila/LibreChat/main/client/package.json) · [open-webui](https://github.com/open-webui/open-webui) and its [package.json](https://raw.githubusercontent.com/open-webui/open-webui/main/package.json) · [lobe-chat package.json](https://raw.githubusercontent.com/lobehub/lobe-chat/main/package.json) · [chatbot-ui package.json](https://raw.githubusercontent.com/mckaywrigley/chatbot-ui/main/package.json) · [ios-pwa-keyboard-fix](https://github.com/Crscristi28/ios-pwa-keyboard-fix) · [SO 77200936](https://stackoverflow.com/questions/77200936/is-there-any-fix-to-ios-safari-and-chrome-fixed-position-for-when-keyboard-show) · [SO 79751159](https://stackoverflow.com/questions/79751159/mobile-chat-widget-panel-shrinks-and-header-composer-misaligns-when-keyboard-ope) · [UWorld](https://www.uworld.com/) · [AMBOSS support](https://support.amboss.com/) · [FSRS](https://github.com/open-spaced-repetition/fsrs4anki) · [Brainscape Academy](https://www.brainscape.com/academy/) · [Lecturio](https://www.lecturio.com/).

Caveats:
- The ChatGPT version-arrow and "View versions" details come from OpenAI community forum reports (Oct 2026), not official documentation.
- The ChatGPT pin cap of 3 comes from a third-party guide.
- UWorld, AMBOSS, Brainscape and Lecturio details come from web-search summaries. Links are to the product domains, not specific articles.
- big-AGI and Claude.ai/Gemini specifics are general knowledge and were not re-fetched in this pass.
