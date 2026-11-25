# R1 — Mobile patterns research for هامزیار (Humsyar)

Scope: navigation, space use, colour, RTL and iOS-PWA patterns for a Persian, mobile-first medical-education PWA. Research only; no code changed.
Date: 2026-11-25. Sources are linked inline. Items marked **[unverified]** come from general product knowledge. Searches for them failed in this session, so check them before relying on them.

---

## 0. Design principles (summary)

1. **One thumb, one glance.** Primary actions sit in the bottom 40% of the screen. Every screen answers "what do I do now?" first.
2. **Calm by default, colour by meaning.** Colour marks *which section you are in* and *what needs attention*. It is never decoration on every surface.
3. **Light = lively, dark = calm.** Light mode uses saturated section hues on white. Dark mode keeps the hues but uses only their pastel tones on navy, at low intensity.
4. **RTL is native, not mirrored afterwards.** Use logical CSS properties everywhere.
5. **Show the next step, not the backlog.** In schedules, exams and progress, show "this week / next class / today's goal", never totals like "201 sessions left".

---

## 1. Bottom tab bar

**Reference.** Apple HIG: a tab bar stays visible and holds the app's top-level, same-level sections. Switching tabs keeps each tab's place. Labels are short; targets are ≥44×44pt; iPad/Mac use a sidebar for deeper hierarchy ([HIG tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars); [community summary](https://github.com/sankalpaacharya/apple-human-interface-skills/blob/main/skills/components/tab-bars.md); [archived HIG navigation](https://web.archive.org/web/20220119173825/https:/developer.apple.com/design/human-interface-guidelines/ios/app-architecture/navigation/)). Material 3: the navigation bar is for 3–5 destinations in compact windows (<600dp). The Expressive update lowered the bar from 80dp to 64dp ("flexible" bar), with horizontal icon+label items allowed at medium widths ([M3 nav bar specs](https://m3.material.io/components/navigation-bar/specs)). iOS 26 Liquid Glass tab bars can shrink into a floating pill on scroll. Revolut's variant keeps all tabs and drops the labels. Developers report several bugs with this pattern (stale appearance after switching tabs, layout glitches with custom backgrounds) [unverified link; reported via react-native-bottom-tabs / expo-glass-tabs discussions]. Linear's Oct 2025 mobile redesign rebuilt navigation around a bottom toolbar, later made customisable/pinnable ([Linear changelog](https://linear.app/changelog)).

**Recommendation for Humsyar**
- **Docked bar, not floating, on phones.** Docking is more reliable with the safe area. With `env(safe-area-inset-bottom)` padding its background fills the home-indicator zone and avoids the known "white strip" bug. Height: `56px + env(safe-area-inset-bottom)`. Surface: `--surface` at 92% opacity with a blur (see §9), plus a 1px top hairline `--border`.
- **5 tabs maximum, always labelled.** Icon 24px, label 12px/16px weight 500 in Vazirmatn. Do not go below 11px: Persian glyphs need the height. Each target is ≥48×48px.
- **Active indicator.** A 56×30px pill (radius 15) behind the icon, filled with the **section's tint** (e.g. indigo-50 for منابع). The icon switches from outline to filled in the section ink colour, and the label turns semibold in section ink. Inactive items use `--text-muted`. Transition 200ms `cubic-bezier(.2,.8,.2,1)`.
- **Hide-on-scroll: compact, don't hide.** After 24px of downward scroll in long lists (library, question list), shrink to 48px and fade the labels to icons only, à la Revolut. Restore on any upward scroll of ≥8px or when scrolling stops at the top. Never compact it on Home, Schedule or AI chat. Respect `prefers-reduced-motion` (no compacting).
- Re-tapping the active tab scrolls to the top, then pops to the tab's root (iOS convention).
- Badges: an 8px dot for "new", or a numeric badge (min 16px, Persian digits, max "۹۹+") on top-start of the icon, coloured `--danger`.
- RTL order: the first tab (خانه) sits at the **right** edge. This follows automatically from `flex-direction: row` + `dir="rtl"`.

## 2. Top app bar and large-title collapse

**Reference.** iOS large titles: a 34pt bold title sits under a compact bar and collapses into the 17pt centred bar title as content scrolls [unverified this session; standard UIKit `prefersLargeTitles`]. Linear's March 2026 refresh moved header actions into predictable fixed positions ([Linear changelog](https://linear.app/changelog)).

**Recommendation**
- Top-level tab roots: a **large title** block (28px/36px, weight 800) with an optional 14px subtitle (e.g. "سه‌شنبه ۴ آذر"). Use an IntersectionObserver on the title. When it leaves the viewport, the sticky 52px bar (+`safe-area-inset-top`) fades in a 17px/600 title and its hairline.
- Pushed screens (lesson, exam, ticket): compact 52px bar only. Back chevron at the **start** (right in RTL, pointing right). At most 2 trailing icon buttons (44×44); further actions go into a "⋯" sheet.
- Keep section colour subtle in the bar: a 3px start-edge accent or the icon colour, never a full coloured bar in dark mode. In light mode, a 6–10% section-tint gradient behind the large title gives "lively" without noise.

## 3. Sheets vs modals vs pages

**Reference.** iOS sheet detents: `medium` (~half) and `large`. Medium suits quick tasks, large suits forms, and dragging moves between them ([WWDC21 Customize and resize sheets](https://developer.apple.com/videos/play/wwdc2021/10063/); [Sarunw](https://sarunw.com/posts/swiftui-bottom-sheet)). M3: modal sheets have a scrim and block the app; standard sheets coexist with content. The drag handle is optional. A known pitfall: the drag gesture competes with inner scroll ([M3 bottom sheets](https://m3.material.io/components/bottom-sheets/overview); [MDC BottomSheet](https://github.com/material-components/material-components-android/blob/master/docs/components/BottomSheet.md)).

**Recommendation**
- **Bottom sheet** (phone) for: filters, sort, "add to notes", choosing a course, share, exam settings, payment-plan picker. Detents: `auto` (content height, max 50dvh) and `92dvh`. Handle 36×5px, radius 2.5, `--text-muted` at 40%. Top corners radius 20px. Scrim `rgba(10,22,40,.45)`. Close on scrim tap, on a downward swipe >80px or velocity >0.5px/ms, and on Esc. Start the drag only when the inner scroller is at `scrollTop === 0`.
- **Full page** for anything with more than 3 inputs or its own navigation (ticket thread, exam session, PDF reader).
- **Centred dialog** only for destructive confirmations ("پایان آزمون؟"). Max width 360px, two buttons, destructive button in `--danger`.
- At ≥840px, sheets become centred dialogs (max 560px) or a 400px side panel docked to the **start** edge.
- Use `<dialog>` + `inert` on the background for focus trapping. Lock body scroll with `overflow:hidden` on the app scroller (not on `body`, see §9).

## 4. Cards, density, lists

**Recommendation** (synthesised from HIG 44pt targets and the M3 4/8dp grid)
- 4px spacing grid. Screen padding 16px (phone) / 24px (tablet) / 32px (desktop).
- Card: padding 16px, radius 16px, gap 12px. Light mode: a 1px `--border` plus `0 1px 2px rgba(15,27,51,.06)`. Dark mode: no shadow; use `--surface-2` elevation steps instead.
- List rows: min height 56px (single line) / 72px (two lines). A 40px leading icon tile (radius 12) tinted in the section colour. Swipe actions only as a bonus; always provide a visible "⋯" button too.
- Max 1 primary CTA per card. Secondary actions are text buttons.
- Large tappable cards press to `scale(.98)` + darker tint over 120ms (see §7).

## 5. Home dashboard: "Today" cards

**Reference.** Duolingo's home centres on a single path and the next lesson, with streak/XP in a top bar ([Canny Creative profile](https://www.canny-creative.com/atlas/brand/duolingo/)). Linear Mobile's inbox shows "what needs your attention", with tap to act and swipe to snooze ([Linear changelog](https://linear.app/changelog)). Revolut's Home is customisable, with products pinned to it.

**Recommendation.** A fixed priority stack, max 5 cards above the fold:
1. **کلاس بعدی** (schedule amber): course, time range, room, a "۲۵ دقیقه دیگر" countdown, and a live state "در حال برگزاری" with a progress bar.
2. **ادامه مطالعه** (resources indigo): last PDF/video, a progress ring, a "ادامه" button.
3. **هدف امروز** (question bank violet): "۲۰ سؤال امروز — ۸ تا مانده", one tap starts a session.
4. **هوشیار** (AI gradient): a one-line prompt field ("سؤالت را بپرس…") with 2–3 suggestion chips.
5. Conditional cards only when relevant: new grade (emerald), subscription expiring in ≤7 days (money green), unread ticket reply.

Rules: hide a card instead of showing it empty. Use a time-of-day greeting with the first name. No global counters on Home.

## 6. Empty, loading and refresh states

**Reference.** NN/g: use skeleton screens for **full-page** loads where the layout is known, spinners for short local waits, and progress bars for measurable progress. Skeletons reduce perceived wait ([NN/g Skeleton Screens 101](https://www.nngroup.com/articles/skeleton-screens/); [NN/g video](https://www.nngroup.com/videos/skeleton-screens-vs-progress-bars-vs-spinners/)).

**Recommendation**
- Skeletons only on the first load of a tab. Delay them 300ms (fast loads show nothing), then use blocks matching the real card geometry in `--surface-2`. Shimmer 1.4s runs RTL (right→left), and is a static block under `prefers-reduced-motion`. After first load, show cached data at once (stale-while-revalidate), with a 2px top progress line in the section colour.
- Empty states: a 120px section-coloured illustration or icon, one sentence, one CTA. Example: "هنوز یادداشتی نداری — اولین یادداشت را بنویس". Never a bare "موردی یافت نشد".
- Pull-to-refresh: on iOS, home-screen PWAs get no native pull-to-refresh [unverified this session; long-standing behaviour]. Implement a custom one only on lists that change (notifications, tickets, grades): trigger at 64px pull, show a 24px spinner in the section ink, set `overscroll-behavior-y: contain` on the scroller. Elsewhere, refresh on `visibilitychange` when the app returns after >5 min.
- Errors: inline banner + "تلاش دوباره". Offline: a persistent 32px banner "آفلاین — نسخه ذخیره‌شده" and cached PDFs still openable.

## 7. Micro-interactions ("haptics-like")

- iOS Safari does not support `navigator.vibrate` [unverified this session]. Treat haptics as Android-only progressive enhancement (10ms on correct answer, 20–30ms on wrong/submit), gated by a settings toggle.
- Visual substitutes: press `scale(.97)` over 100ms. Correct answer: a 220ms emerald fill sweep from the start edge plus a ✓ morph. Wrong answer: a 2× 4px horizontal shake (180ms) plus rose fill. Tab switch: indicator pill slides 200ms. Streak/goal completion: a 600ms confetti burst in section colours, max once per day.
- All motion ≤300ms except celebrations. Every animation gets a `prefers-reduced-motion` fallback.

## 8. Adaptive layout: phone → tablet → desktop

**Reference.** M3 window size classes: compact <600, medium 600–839, expanded 840–1199 (plus large/extra-large above). Bar on compact, rail on medium/expanded. The Expressive rail widened 80→96dp, has collapsed and expanded variants, replaces the drawer, and holds 3–7 destinations ([M3 nav bar specs](https://m3.material.io/components/navigation-bar/specs); [M3 window size classes](https://m3.material.io/foundations/layout/applying-layout/window-size-classes)). HIG: use a sidebar on iPad/Mac for deeper hierarchies ([HIG tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars)).

**Recommendation** (CSS container/media queries on `inline-size`)
| Width | Navigation | Content |
|---|---|---|
| <600px | Bottom bar (5) | Single column, 16px gutters |
| 600–839px (iPad portrait, Android tablets) | **Rail 80px on the right (start)**, icon+label stacked, FAB slot at top | Single column max 640px, or a 2-column card grid on Home |
| 840–1199px (iPad landscape, small laptops) | Rail 96px, or a **sidebar 264px** with secondary items (نمرات، یادداشت‌ها، اشتراک، پشتیبانی) | **List-detail two-pane**: library list 360px + reader; tickets list + thread; question list + question |
| ≥1200px (Windows desktop) | Sidebar 280px, collapsible to rail | Max content width 1200px. AI: conversation list 300px + chat (max 760px) + an optional sources panel |

- Bottom sheets → dialogs/side panels (§3). Hover states appear only under `@media (hover:hover)`. Add keyboard shortcuts on desktop (`/` search, `Esc` close).
- Keep the same five destinations across all sizes, so the mental model doesn't change.

## 9. iOS Safari / PWA pitfalls (checklist)

Sources: [MDN VirtualKeyboard](https://developer.mozilla.org/en-US/docs/Web/API/VirtualKeyboard_API), [HTMHell interactive-widget](https://www.htmhell.dev/adventcalendar/2024/4/), [visualViewport keyboard fix](https://dev.to/franciscomoretti/fix-mobile-keyboard-overlap-with-visualviewport-3a4a).

1. Viewport: `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">`. The last part helps only Chromium/Firefox; iOS ignores it.
2. Height: the app shell is `min-height: 100dvh` (fallback `100vh`). Avoid `100vh` for fixed full-screen panes. Safe areas: `padding-top: env(safe-area-inset-top)` on the top bar, `padding-bottom: env(safe-area-inset-bottom)` on the tab bar/composer. Combine with your own padding via `max(12px, env(safe-area-inset-bottom))`, not addition, or spacing becomes double.
3. **Inputs ≥16px** (`font-size:16px` on input/select/textarea), otherwise iOS zooms on focus. Never disable zoom with `maximum-scale=1`.
4. Keyboard: iOS shrinks only the *visual* viewport, so `position:fixed` composers end up behind the keyboard. For the AI chat and ticket composer, listen to `visualViewport` `resize`/`scroll`. Compute `inset = innerHeight − visualViewport.height − visualViewport.offsetTop` → `--kb` CSS var → `transform: translateY(calc(-1 * var(--kb)))` on the composer, and hide the tab bar while an input is focused. On Chromium, use `navigator.virtualKeyboard.overlaysContent = true` + `env(keyboard-inset-height)`.
5. Status bar: `apple-mobile-web-app-status-bar-style` = `black-translucent` draws under the clock with white status text, so the header must be dark navy in both themes or the text is unreadable in light mode. Report: on iOS 26 Liquid Glass, WebKit adds a blur over the status area with `black-translucent`; `default` avoids it but loses edge-to-edge. **Recommendation: `default` + a `theme-color` meta per theme** (`#F6F8FC` light / `#0A1628` dark, `media="(prefers-color-scheme: …)"`). This also stays correct when the theme changes. iOS reads the meta only at install, so test by deleting and re-adding the home-screen app.
6. Overscroll: make `.app-scroller` the only scroller (`height:100dvh; overflow-y:auto; overscroll-behavior-y: contain`) and keep `body` non-scrolling with a background equal to the header colour, so rubber-banding never reveals white.
7. `backdrop-filter`: always pair it with `-webkit-backdrop-filter`. Use only on the tab bar and top bar, blur ≤16px, `saturate(180%)`. Never nest blurred elements, never animate a blurred element's size, and don't combine it with `box-shadow` on the same node. Add `transform: translateZ(0)`. Use `@supports` fallback `rgba(surface,.96)`. Render blurred elements mounted, not `display:none` → shown, because Safari may skip the blur.
8. Add `-webkit-tap-highlight-color: transparent`, `touch-action: manipulation` on buttons (removes delay), and `-webkit-user-select:none` on nav chrome only. Do not apply it to content: students copy text.
9. PDFs/video: open PDFs in an in-app viewer (pdf.js) inside the scroller. External `target=_blank` leaves the standalone app on iOS.
10. Audio/video lectures: `playsinline` on `<video>`. Set Media Session API metadata so lock-screen controls show the lecture title.

## 10. Colour system: per-section hues

**Reference.** Duolingo names every colour (Owl/Feather Green, Bee, Fox, Cardinal, Macaw) and ties accents to specific features (streak, XP, hearts, gems) on an always-white base ([Duolingo colour reference](https://github.com/virgiliojr94/duolingo-ux-reference/blob/master/references/color.md); [design.duolingo.com](https://design.duolingo.com); [Canny Creative](https://www.canny-creative.com/atlas/brand/duolingo/)). Apple Health/Fitness and Things 3 give categories their own hue but keep layout neutral [unverified this session]. The pattern is: **neutral canvas, one hue per section, hue used for icon tiles, indicators, progress and the hero header, and never for body text blocks.**

**Token model** (each section gets 4 tokens): `--{s}-ink` (text/icons/AA on white and on its tint), `--{s}-fill` (solid button background, white text AA unless noted), `--{s}-tint` (card/indicator background), `--{s}-on-dark` (dark-mode accent). Switch with `[data-section="qbank"]` on the page root; components read `--sec-ink`, `--sec-tint` and so on.

### Light theme. Canvas `#F6F8FC`, surface `#FFFFFF`, text `#0F1B33` (16.12:1 on canvas), muted `#5B6B85` (5.40 on white, 5.08 on canvas, 4.83 on indigo tint), border `#E3E8F2`

| Role | ink (text) | ink on white | tint bg | ink on tint | solid fill + text |
|---|---|---|---|---|---|
| Brand navy | `#0B2545` | 15.39 | `#E8EEF7` | 13.19 | navy + white 15.39 |
| Brand turquoise | `#0F766E` | 5.47 | `#E6F7F7` | ≈4.9* | `#0F766E` + white 5.47 (decorative accent `#14B8B8` = 2.45 → **never for text**) |
| منابع (indigo) | `#4F46E5` | 6.29 | `#EEF2FF` | 5.62 | `#4F46E5` + white 6.29 |
| بانک سؤال (violet) | `#7C3AED` | 5.70 | `#F3EEFF` | 5.02 | `#7C3AED` + white 5.70 |
| برنامه (amber) | `#B45309` | 5.02 | `#FFF6E5` | 4.68 | `#F59E0B` + **dark text `#0F1B33`** 7.98 |
| هوشیار (AI) | `#0E7490` → `#1D4ED8` | 5.36 / 6.70 | `#E6FAFD` / `#EAF1FF` | 4.96 / 5.91 | gradient `#0E7490→#1D4ED8` + white ≥5.36 (`#06B6D4` + white = 2.43 ✗, `#0891B2` = 3.68, large text only) |
| نمرات (emerald) | `#047857` | 5.48 | `#E7F8F1` | 4.99 | `#047857` + white 5.48 (`#059669` = 3.77 ✗) |
| اشتراک/پرداخت (green) | `#15803D` | 5.02 | `#EAF8EE` | 4.58 | `#15803D` + white 5.02 (`#16A34A` = 3.30 ✗) |
| یادداشت (honey) | `#A16207` | 4.92 | `#FFF8DB` | 4.62 | `#FACC15` + **dark text** 11.20 |
| خطر (rose) | `#BE123C` | 6.29 | `#FFEEF2` | 5.62 | `#BE123C` + white 6.29 (`#E11D48` = 4.70 on white but 4.20 on tint ✗) |

*Turquoise-on-tint was estimated from the related `#0B7A80` result (4.63); verify with a checker. All other numbers were computed with the WCAG 2.x relative-luminance formula. Every "ink" passes AA 4.5:1 for normal text on white and on its own tint. Amber and honey fills need dark text, not white.

**Light-mode "lively" moves:** section hero header = a 135° gradient from `--sec-tint` to white, with a 48px icon tile in `--sec-fill`. Home cards use their section tint as background. Progress rings and bars use `--sec-fill`. Keep one dominant hue per screen. Home is the only multi-colour screen.

### Dark theme (calm). Canvas `#0A1628`, surface `#12223A`, surface-2 `#1A2D4A`, text `#E6EDF7` (15.39), muted `#94A3B8` (7.07 on canvas, 6.23 on surface), border `rgba(148,163,184,.16)`

| Role | accent on dark | on canvas | on surface |
|---|---|---|---|
| Brand turquoise | `#5EEAD4` (button `#2DD4BF` + text `#0A1628` = 9.74) | 12.26 | 10.79 |
| منابع | `#A5B4FC` | 9.09 | 8.01 |
| بانک سؤال | `#C4B5FD` | 9.82 | 8.65 |
| برنامه | `#FCD34D` | 12.57 | 11.07 |
| هوشیار | `#67E8F9` → `#93C5FD` | 12.51 / 10.05 | 11.01 / 8.85 |
| نمرات | `#6EE7B7` | 11.89 | 10.47 |
| اشتراک | `#86EFAC` | 12.91 | 11.37 |
| یادداشت | `#FDE68A` | 14.56 | 12.82 |
| خطر | `#FDA4AF` | 9.59 | 8.44 |

Dark-mode rules: section tint = accent at **12% alpha** over surface (e.g. `rgb(165 180 252 / .12)`). No gradients on large areas. The AI gradient appears only on the AI tab icon, the send button and a 2px top border. Use accents for icons, indicators and numbers only; body text stays `--text`. This keeps dark navy + turquoise as the calm brand base.

## 11. RTL and Persian specifics

**Reference.** Material bidirectionality: mirror icons that show direction or time (back/forward, send, undo/redo, progress sliders, list-indent). Do **not** mirror media playback controls, clocks, checkmarks, or real-world objects ([Material bidirectionality](https://m2.material.io/design/usability/bidirectionality.html)). Vazirmatn: open-source Persian/Arabic variable font by Saber Rastikerdar, Latin glyphs from Roboto ([Vazirmatn GitHub](https://github.com/rastikerdar/vazirmatn)). Persian body text needs line-height ≥1.6 because of dots and marks above and below the line (multiple Persian typography guides).

**Recommendation**
- `<html lang="fa" dir="rtl">`. Use only logical CSS (`margin-inline-start`, `padding-inline`, `inset-inline-end`, `border-start-start-radius`), so tablet/desktop RTL needs no overrides.
- **Type scale (Vazirmatn variable, `font-optical-sizing:auto`)**:
  | Token | size/line | weight | use |
  |---|---|---|---|
  | display | 30/40 | 800 | large titles |
  | headline | 24/34 | 750 | section heroes |
  | title | 20/30 | 700 | card titles |
  | title-sm | 17/26 | 600 | app-bar title, list primary |
  | body | 16/28 (1.75) | 400 | reading, inputs |
  | body-sm | 14/24 | 400 | secondary |
  | caption | 12/20 | 500 | tab labels, meta (minimum size) |
  Lecture notes / long reading: 17/30, max line length 68ch.
- **Persian digits** everywhere in UI: `new Intl.NumberFormat('fa-IR')` and `Intl.DateTimeFormat('fa-IR-u-ca-persian')` for Jalali dates. Vazirmatn also ships a Farsi-digit variant ("FD"/"Vazirmatn" non-Latin builds), useful when content arrives with Latin digits [verify file names in the repo]. Use `font-variant-numeric: tabular-nums` for timers, grades and countdowns.
- Mixed LTR content (drug names, formulas, English terms, codes): wrap in `<bdi>` or `<span dir="ltr">`, and use `unicode-bidi: isolate` on user-generated text. Use `dir="auto"` on chat bubbles and inputs so English questions to هوشیار render correctly. Code/formula blocks are always `dir="ltr"` and left-aligned.
- Mirror: back/forward chevrons, "send" (paper plane points left), progress direction, swipe-to-go-back from the right edge, carousels (start at right). Don't mirror: play/pause/seek icons, clock, checkmark, charts' numeric axes (keep time running right→left only on timelines), and phone keypad.
- Shimmer, progress fills and "correct answer" sweeps start at the right edge.

## 12. Weekly timetable (Saturday → Friday)

**Reference.** Calendar apps default to a "today/agenda" view with a week strip rather than a full grid on phones [unverified this session; e.g. iOS Calendar list view, Google Calendar schedule view]. The guiding principle is the same one as Duolingo's "next lesson" focus: one next action.

**Recommendation**
- **Top: week strip.** 7 day chips, شنبه at the **right**, جمعه at the left. Each chip is 44×56px: day initial (ش ی د س چ پ ج) + date in Persian digits. Today gets a filled amber pill, the selected day an outlined one. Days with classes get a 4px amber dot. Friday is muted. Swiping the strip changes weeks, with a "امروز" chip to jump back.
- **Hero card "کلاس بعدی"** (or "در حال برگزاری" with a live progress bar and a "تا پایان ۳۵ دقیقه" countdown). Show course name, instructor, room, time.
- **Agenda list for the selected day**: time-ordered rows (start time in tabular Persian digits at the start edge, course and room, a 4px start-edge colour bar per course). A **"now" line** (2px amber + dot) between rows on today. Past classes at 50% opacity. Empty day: "امروز کلاسی نداری 🌿 — وقت مرور" plus a CTA to the question bank.
- **Calm progress framing**: "هفته ۸ از ۱۶ ترم" with a thin bar, or "این هفته: ۹ کلاس، ۳ تا گذشته". **Never** show cumulative remaining sessions. Exams appear as rose-tinted rows with a countdown starting only 7 days before.
- Tablet/desktop: optional full week grid (6 columns Sat–Thu, Friday collapsed), 8:00–18:00, 64px per hour. Overlapping classes are shown side by side.
- Home and the schedule share the same "next class" component.

## 13. AI assistant "هوشیار" (chat)

- Chat-app layout: messages `dir="auto"` with 16px text, user bubbles at the start (right) in the AI tint, assistant messages full width without a bubble (ChatGPT/Claude style) for readable long answers. Composer is docked with the keyboard handling from §9, with a 44px gradient send button (`#0E7490→#1D4ED8`, white icon ≥5.36:1).
- Empty state: 3–4 suggestion chips per context ("این PDF را خلاصه کن", "۱۰ سؤال از این فصل بساز").
- Streaming: show a 3-dot typing indicator; stream tokens; keep a "توقف" button visible.

---

## Top 25 recommendations (prioritised)

1. Make `.app-scroller` the single scroller with `min-height:100dvh`, `overscroll-behavior-y:contain` and a non-scrolling body. Fixes bounce gaps and white strips.
2. Viewport meta with `viewport-fit=cover`; add safe-area padding via `max()` on the top bar, tab bar and composer.
3. All inputs at ≥16px font size; never disable zoom.
4. `visualViewport` keyboard inset for the AI chat and ticket composers; hide the tab bar while typing.
5. A docked 5-tab bar, 56px + safe area, labelled, with a section-tinted 56×30 active pill.
6. Introduce section tokens (`ink/fill/tint/on-dark`) with `[data-section]` switching, using the hex values in §10.
7. Light theme: `#F6F8FC` canvas, white cards, section tints on Home cards and hero headers. This removes the "bread-coloured" flatness.
8. Dark theme: navy canvas, pastel accents at 12% tints, no large gradients. Keeps it calm.
9. Never put white text on `#14B8B8`, `#06B6D4`, `#059669` or `#16A34A`. Use the AA fills listed, with dark text on amber and honey.
10. Home = priority stack: next class, continue studying, today's goal, هوشیار prompt, then conditional alerts.
11. Timetable: Sat→Fri week strip (Saturday at the right), next-class hero, agenda with a now-line, "هفته ۸ از ۱۶" framing.
12. Logical CSS properties only; audit and mirror directional icons per Material bidi rules.
13. Vazirmatn type scale from §11 with body line-height 1.75 and a 12px minimum.
14. Persian digits and Jalali dates via `Intl` (`fa-IR-u-ca-persian`); tabular numbers for times and grades.
15. `<bdi>` / `dir="auto"` for mixed English medical terms and chat.
16. Large-title collapse on tab roots; compact 52px bars on pushed screens.
17. Bottom sheets with two detents, a handle, a scrim and a scroll-aware drag; dialogs only for destructive confirmations.
18. Skeletons only on first load, after a 300ms delay; stale-while-revalidate afterwards.
19. Every empty state has an illustration, one sentence and one CTA.
20. Responsive: rail at 600px, rail or sidebar plus list-detail two-pane at 840px, three-pane AI chat at 1200px; rail on the right in RTL.
21. Limit `backdrop-filter` to the two bars, blur ≤16px, with the `-webkit-` prefix and an opaque `@supports` fallback.
22. Status bar style `default` + per-theme `theme-color`; re-test after reinstalling the home-screen app (iOS 26 blur issue).
23. Press, correct and wrong micro-animations ≤300ms; Android-only vibration behind a toggle; full `prefers-reduced-motion` support.
24. Custom pull-to-refresh only on notifications, tickets and grades; refresh on resume elsewhere.
25. In-app PDF viewer plus `playsinline` and the Media Session API for lectures, so content never kicks users out of standalone mode.

## Proposed bottom tabs (max 5, RTL order from the right)

| # | Tab | Icon | Section colour | Contains |
|---|---|---|---|---|
| 1 | **خانه** | house | brand turquoise | Today cards, notifications bell in the top bar |
| 2 | **برنامه** | calendar | amber | Week strip, next class, exams |
| 3 | **هوشیار** (centre) | sparkle | cyan→blue | AI chat, history |
| 4 | **مطالعه** | book-open | indigo/violet | Segmented control: منابع (library) / بانک سؤال & آزمون |
| 5 | **من** | person | navy | Grades (emerald), notes (honey), subscription (green), support tickets, settings, install guide |

**Rationale**
- The schedule is the most frequent daily check ("where/when is my next class?"), so it earns a tab. Home also mirrors the next-class card.
- هوشیار is the product's differentiator and a high-frequency entry point. A centre position gives it prominence without a non-standard FAB, and its gradient colour makes it the one "special" item.
- Library and question bank are both "study" activities. Merging them under مطالعه with a 2-segment control (and remembering the last segment) keeps the bar at 5. This mirrors HIG's guidance to keep tabs as same-level top sections and push depth into the section. If analytics show the question bank is used more than the schedule, swap: tab 2 becomes **آزمون** and the schedule lives as Home's top card plus a full-screen view from it.
- Grades, notes, subscription, tickets and profile are lower-frequency, personal items, so they are grouped under من (the Revolut/Airbnb "profile hub" pattern [unverified]). Each row there keeps its own section colour tile, so the multi-colour identity stays visible.
- Notifications go in a top-bar bell (with badge) on Home, not in a tab. The landing page and install guide live outside the authenticated shell; the guide is also reachable from من.
