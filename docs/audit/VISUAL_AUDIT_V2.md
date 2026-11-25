# Humsyar Student PWA — Visual Audit V2 (redesign baseline)

Status: COMPLETE. All 31 pages were reviewed visually on iPhone 15 (393) webkit, iPad 820 and Mac 1440 in both themes. The 14 follow-up pages were also reviewed on iPhone SE (375). Note: the `ticket-detail` capture (`/student/tickets/t1`) renders the 404 screen because the app has no `/tickets/:id` route (see TK2/NF1).
Date: 2026-11-25 · Build: `apps/student/dist` @ HEAD 515f0e2 · Landing: `miniapp` `dist-landing`
Harness: `tmp/audit/shoot-student-v2.mjs` (mocked Persian data, no production traffic)

## 0. Coverage

| Engine | Devices | Pages | Themes | Shots |
|---|---|---|---|---|
| webkit | iphone-se, iphone-se-pwa, iphone-15, iphone-15-pwa, iphone-promax, ipad-mini, ipad-820, ipad-1024, mac-1440 | 31 | dark, light | 558 |
| chromium | android-360, android-412, tablet-800, win-1280, desktop-1920 | 31 | dark, light | 310 |
| **Total** | 14 | 31 | 2 | **868** |

Shots: `tmp/audit/shots-v2/<engine>/<page>__<device>__<theme>.png` (full-page). Detector output: `tmp/audit/results-v2-<engine>*.json`, aggregated by `tmp/audit/aggregate.py` → `tmp/audit/aggregate-out.txt`. Contact sheets used for review: `tmp/audit/sheets2/`.

Pages: landing, install, login, home, library, library-term, library-subject, library-lesson, library-session, library-book, reader-pdf, media-player, exam-home, exam-practice, exam-history, exam-setup, exam-mock-history, exam-mock-run, exam-result, search, schedule, ai-chat, me, notes, subscription, grades, notifications, tickets, ticket-detail, system, states.

## 1. Detector summary (both engines agree)

| Detector | Result |
|---|---|
| Horizontal overflow | **landing** on every phone (iphone-se/15/promax + pwa, android-360/412). `div.lp-pillar-panel__content` / `__badge-row` start at left −92px (webkit) / −125px (chromium); full-page PNG is 486px wide on a 393px device. `document.scrollWidth` reports no overflow (overflow is clipped by `overflow-x:hidden` on body but still widens the captured layout / allows sideways pan in Safari). All other routes: none. |
| Clipped text | landing `div.lp-preview-meta` (all devices); `desktop-header__title` on exam-mock-run (159 vs 106px) and `desktop-header__sub` on tickets at narrow desktop widths. |
| Tap targets < 44px | Systemic: 3–10 per app page, 17–25 on reader-pdf, exam-setup and system. Worst: reader toolbar buttons, exam-setup chips, appbar icon buttons. |
| Inputs < 16px (iOS zoom-on-focus) | `input.embedded-ai-input` 13px (reader-pdf, media-player), search `input` 15px, ai-chat `textarea` 14px. |
| Raw identifiers | `bahman_1404` (library header "ورودی bahman_1404"), `sara_m` (me — username, acceptable if labelled), `login_required` / `pending_approval` / `feature_disabled` (states gallery). No `undefined`/`null`/`NaN`/`[object Object]`/`{'` found with mock data. |
| Gregorian dates | schedule: `2026-11-25`, `2026-11-29` … rendered as raw ISO strings in class rows on every device/theme. |
| Latin digits in Persian text | schedule times `09:00`, `08:00`, `17:00`; ISO dates; AI greeting "… 2)"; system page "48 نماد". |
| Contrast < 4.5:1 | Systemic muted token ≈ 3.75:1 (`appbar__sub`, `sidebar__user-role`, `minfo__s`, `page-placeholder`) and ≈ 4.02:1 (`sidebar__sub`, `desktop-header__sub`, header search placeholder). Login light: brand strong/p at **1.1:1**. Light theme of system/states 33–39 failing nodes each. |
| Network | Unmocked `GET /api/web/exam/mock/active` (harness gap, harmless); `/audit-assets/sample.mp4` 404 → media-player shows no real frame. |

## 2. Findings

Severity: **P0** = broken/blocking or embarrassing in front of every user; **P1** = clearly wrong, hurts trust/usability; **P2** = polish.

### Global (all routes)

**G1 — P0 — iOS install banner hijacks every screen** (iphone-se/15/promax, webkit, both themes)
`tmp/audit/shots-v2/webkit/home__iphone-15__dark.png`, `…/ai-chat__iphone-15__dark.png`, `…/login__iphone-15__light.png`, `…/library__iphone-15__dark.png`, `…/schedule__iphone-15__light.png`
A ~260px bottom sheet ("هامزیار را به صفحهٔ اصلی… / فهمیدم / مشاهدهٔ راهنمای تصویری کامل") sits over ~30% of the viewport on every route in Safari. Its surface is semi-transparent with no backdrop blur, so the list underneath bleeds through the copy (e.g. "همکار هوشمند بالینی", "پیوستگی مطالعه", schedule rows and ISO dates are legible *through* the banner text). On ai-chat it covers the composer entirely — the screen's only action is unreachable. On login it covers the help link and footer of the primary flow.
Redesign: one compact, opaque (or `backdrop-filter: blur(20px) saturate(1.4)`) inline card, max 88px, shown once on home only after first successful login, dismiss persisted; never on login/ai-chat/reader. Deep link to the full install guide.

**G2 — P0 — Light theme is not applied to landing, install and login** (all devices)
`…/landing__iphone-15__light.png`, `…/install__iphone-15__light.png`, `…/login__iphone-15__light.png`
The "light" captures are pixel-identical dark navy pages. On login light the only things that change are broken: the gradient wordmark "هامزیار" renders as "یار" (gradient-clipped text loses its first half), and the subtitle "کد اختصاصی ۸ کاراکتری…" drops to ~1.1:1. The user's chosen theme is therefore ignored on the first three screens and then flips abruptly to light on home.
Redesign: either make pre-auth screens theme-aware with the same tokens, or explicitly lock them to dark and stop applying light-only overrides to them. Replace gradient-clip text on the wordmark with a solid token.

**G3 — P1 — Bottom nav is translucent without blur; content text shows through labels** (iphone, both themes)
`…/home__iphone-15__dark.png` (ghost "درس‌ها/پاسخ‌ها" behind "کتابخانه"), `…/library__iphone-15__dark.png` ("محتوا فقط داخل هامزیار خوانده می‌شود" printed under the nav).
Active indicator is a bar overlapping the active label's descenders, and the home "خانه" glow ring is cut by the home indicator area.
Redesign: 64px + safe-area bar, opaque `surface-1` with 0.5px top hairline (or real blur), icon 24px + 11px label, active = filled icon + accent label, no underline bar.

**G4 — P1 — Light theme is flat, monotone turquoise/blue on near-white** (all app routes)
White cards on #F7F9FC with almost no elevation; the only accents are the same blue pill and turquoise progress, so hierarchy collapses (home light: header card, profile card and subscription card are three indistinguishable white/blue boxes). Muted text sits at 3.75:1.
Redesign: neutral grey ramp (not blue-tinted), one accent, `surface-0/1/2` steps with 1px borders `rgba(0,0,0,.06)` + soft shadow, muted text ≥ #5B6472 (≥ 4.6:1), semantic colours (success/warning/exam red) used sparingly.

**G5 — P1 — Brand name chaos**: "هامزیار" (logo), "هوشیار پزشکی" (ai-chat header), "هوشیار بالینی" (reader assistant), "HUMSYARX · هوش پزشکی" (sidebar), "HumsYar Medical-AI · v2.0" (system). Pick one Persian product name and one assistant name.

**G6 — P1 — Muted text token fails contrast in both themes** (3.75:1 / 4.02:1) — appbar subtitles, sidebar role/sub, desktop header sub, search placeholder. Raise to ≥ 4.5:1.

**G7 — P1 — Inputs under 16px trigger iOS zoom** (reader/media embedded AI input 13px, search 15px, ai-chat textarea 14px). Use 16px min on touch.

**G8 — P2 — Latin digits leak into Persian UI** (times `09:00`, AI greeting "2)", system "48 نماد"). Pipe every number through the fa-IR formatter.

### Landing (`landing`)

**L1 — P0 — Hero is wider than the phone** (all phones, both engines) — `…/landing__iphone-15__dark.png` (486px capture on 393px device). Body copy is cut on the left edge ("…ربات تعاملی تلگ"), centred column is visibly offset, and Safari allows sideways panning. Cause: `.lp-pillar-panel__content` positioned at −92px. Fix with `min-width:0` / `inset-inline` and `overflow-x: clip` on the section, not body.

**L2 — P1 — Duplicate primary CTA**: "ورود به نسخهٔ وب (PWA)" in the header *and* as the hero button 400px below, plus a secondary "ورود به ربات تلگرام". On a phone the header CTA is a 180px blue pill crowding the logo. Keep one primary (hero), make header a text link or hide it until scroll.

**L3 — P2 — Jargon in hero micro-copy**: "(PWA)", "iOS", "Bot API 7.0+". Students don't care. "نصب روی گوشی و کامپیوتر، بدون اپ‌استور" is enough.

### Install guide (`install`)

**I1 — P1 — Platform switcher squeezed on iPhone** — `…/install__iphone-15__dark.png`. Three tabs in 330px: "ویندوز و مک" breaks to 2 lines, "آیفون (iOS)" stacks with the "دستگاه شما" badge inside the pill, so tabs have three different heights. Redesign: segmented control with single-word labels (آیفون / اندروید / کامپیوتر) and the "دستگاه شما" hint as a dot or caption below.
**I2 — P2 — Light variant step icons nearly vanish** (icons 1–2 on `install__iphone-15__light.png` are ~1.5:1 grey on navy). Same root cause as G2.
**I3 — P2 — "حتماً" tanvin renders raised/misaligned** in the note card (font fallback for U+064B); check Vazirmatn subset.

### Login (`login`)

**LG1 — P0 — Install banner covers the login form footer** (see G1) on every iPhone non-PWA shot.
**LG2 — P1 — Wordmark broken in light** ("یار") and subtitle ~1.1:1 (see G2).
**LG3 — P1 — Primary CTA looks disabled**: "درخواست تأیید ورود از ربات تلگرام" is a dim blue on navy with low-contrast label even when it should be the hero action; there is no visible enabled/disabled distinction.
**LG4 — P2 — "(Crockford Base32)" exposed to students** in the field label. Remove; keep "کد ۸ کاراکتری".

### Home (`home`)

**H1 — P1 — Banner overlap + nav ghosting** (G1, G3).
**H2 — P2 — Percent format inconsistent**: "۳۰٪" on home vs "٪۳۰" in library.
**H3 — P2 — Profile card over-decorated**: avatar ring + level badge + "پیشرو" pill + student number + two chips + subscription card = 7 elements before any study content. Collapse profile into the header; lead with "ادامه مطالعه".

### Library (`library`, `library-term`)

**LB1 — P1 — Raw identifier in header**: "ورودی bahman_1404" (LTR snake_case inside an RTL subtitle). Map to "ورودی بهمن ۱۴۰۴" (the home screen already does this correctly). `…/library__iphone-15__dark.png`
**LB2 — P2 — library-term is a 3-row list on an empty screen**; rows have no progress, no counts beyond "۱۲ جلسه". Add per-course progress and last-opened.

### Schedule (`schedule`)

**S1 — P1 — Gregorian ISO dates + Latin digits in class rows**: "2026-11-25 · ۲۰۳ کلاس · 08:00" — three numeral systems in one line. `…/schedule__iphone-15__dark.png`. Use Jalali "چهارشنبه ۵ آذر" and fa digits.
**S2 — P1 — Tab label wraps, count orphaned**: "تسک‌های مطالعهٔ شخصی" wraps and "(۱)" falls on its own line; the two tabs differ in height. Shorten to "تسک‌های من" with a count badge.
**S3 — P1 — Week switcher is three floating pills** ("هفته / ۲ هفته / ماه") left-aligned under the group card with no container and no date-range label or prev/next. It is not clear what week is shown. Redesign: segmented control + "۲–۸ آذر" range with ‹ › arrows.
**S4 — P1 — Section counts inconsistent**: exams count is a red circle on the far left, classes count a bare grey "۴"; group card says "۶ درس در برنامهٔ شما" and tab says "(۶)" while the list shows 4 class sessions — courses vs sessions not labelled. Put counts inline after the heading with the unit ("کلاس‌ها · ۴ جلسه این هفته").
**S5 — note — raw Python dict next to "ترم"**: not reproduced with mocked data (mock sends `term: 2`, rendered "ترم ۲"). The screen renders `term` verbatim with no type guard, so a non-string/dict value from the backend would be printed raw. Recommend a formatter on the frontend and normalising `term` to an int in the API.

### AI chat (`ai-chat`)

**AI1 — P0 — Composer hidden behind install banner on iPhone Safari** (G1). `…/ai-chat__iphone-15__dark.png`
**AI2 — P1 — textarea 14px** (G7). **AI3 — P2 — Header name "هوشیار پزشکی" vs greeting "هوش‌یار"** (G5).

### PDF reader (`reader-pdf`)

**R1 — P1 — Annotation toolbar overflows on 393px** — `…/reader-pdf__iphone-15__dark.png`. The bottom ink bar (ابزارها, colour dots, pen/highlighter/eraser, page arrows) is wider than the viewport: the leading "‹" control is cut at the left edge, it overlaps the page canvas, and 25 targets are < 44px. The install banner (G1) sits on top of the page as well, so on first open ~45% of the document is covered.
Redesign: collapse to a single 56px floating pill (pen · highlighter · eraser · colour · more), tools in a sheet; page indicator in the appbar.
**R2 — P2 — `page-placeholder` "صفحهٔ ۲" at 3.75:1** while pages load; use a skeleton instead of grey text.

### Media player (`media-player`)

**M1 — P1 — Infinite spinner, no error state** — `…/media-player__iphone-15__light.png`. The harness video 404s, and the player shows "در حال بارگذاری..." and "۰:۰۰ / ۰:۰۰" indefinitely with live controls. Real users on a bad network will see the same thing. In light theme the player is a hard black slab under a white appbar.
Redesign: poster frame, a timeout after ~10s with "پخش ممکن نشد · تلاش دوباره", controls disabled until metadata loads.
**M2 — P2 — Dead space under the info card** — no chapters, notes or related sessions; the screen is 60% empty.

### Exams (`exam-home`, `exam-practice`, `exam-mock-run`, `exam-mock-history`)

**E1 — P1 — The primary "ثبت پاسخ" / "ثبت و سؤال بعدی" button looks disabled** (pale blue at ~50% opacity) and sits half under the banner on iPhone. Next to it, a desktop keyboard hint "با کلیدهای ۱ تا ۴ انتخاب، Enter ثبت" is shown on touch phones. `…/exam-practice__iphone-15__dark.png`, `…/exam-mock-run__iphone-15__light.png`
Redesign: a sticky bottom action bar above the nav with a clear disabled → enabled transition once an option is selected. Show keyboard hints only for `(hover:hover) and (pointer:fine)`.
**E2 — P2 — Meta chips (متوسط / فیزیولوژی قلب / شهریور) look like tappable filters.** Render them as plain caption text.
**E3 — P2 — Mock header**: the Latin code "کد PHY-20" is in the subtitle, and the desktop header title is clipped (159 vs 106px).
**E4 — P2 — Mock history**: "تمام‌شده" and "زمان تمام" share the same grey chip, so there's no semantic colour. Two rows are followed by an empty void with no summary or trend.

### Me / Notes (`me`, `notes`)

**ME1 — P1 — Mixed numerals and a confusing identity**: the student number "40312345" and "sara_m@" use Latin digits on `me`, while home shows "۴۰۳۱۲۳۴۵". The "کد کاربری اختصاصی" card shows the student number, but login asks for an 8-char "HY-" code. Verify which value is meant and label it to match login.
**ME2 — P2 — Theme setting (تاریک / روشن / خودکار) is hidden under the banner** on iPhone. Use a native-style segmented control.
**N1 — P2 — Notes**: a single card followed by an empty screen, with no empty-state copy or "new note" CTA.

### Tablet (`ipad-820`)

**PD1 — P1 — The install banner floats mid-page** — `…/home__ipad-820__dark.png`. On iPad it renders as a centred card over the exam list and the modules heading, not anchored to any edge. Text behind it shows through ("پایانترم فیزیولوژی ۲", "ماژول‌های مرکز فرماندهی"). The header search field (~180px) wraps its placeholder onto two lines ("جستجوی منابع، / آزمون...").
Redesign: iPad gets the desktop header with a full-width search, and the banner becomes an inline card or goes away.

### Desktop (`mac-1440`, `win-1280`, `desktop-1920`)

**D1 — P1 — Desktop is mobile density at small type; schedule is a stretched phone list** — `…/schedule__mac-1440__dark.png`, `…/home__mac-1440__light.png`. Body text renders at 11–12px and subtitles/sidebar at 10–11px on a 1440 screen. On schedule, the desktop gets the same single-column list, with ISO dates pinned to the far-left edge 600px away from their titles, the floating "هفته/۲ هفته/ماه" pills, and no week grid. Home is the only screen that adapts (KPI grid).
Redesign: a 14–15px base on desktop, a 7-column week calendar for schedule (with exam overlays) and two-pane layouts for library/exam (list + detail).
**D2 — P1 — Dark tokens leak into light theme**: the "امتحانات / تسک‌ها" segmented track is dark grey on white (`home__mac-1440__light.png`, `home__ipad-820__light.png`). Module tag chips (پاسخگویی, سوابق آموزشی, منابع درسی, زمان‌بندی) are pastel on white at ~1.5–2:1.
**D3 — P2 — Sidebar brand line "HUMSYARX · هوش پزشکی"** is 10px at 4.02:1, and the collapse caret floats outside the sidebar.

### Landing desktop

**LD1 — P1 — Nav items wrap to two lines at 1440** ("چهار ستون / هامزیار", "قابلیت‌های / بالینی", "وضعیت / سرویس‌ها") despite ample width. Three entry CTAs are above the fold (header, hero primary, hero Telegram), and every pillar panel repeats "مشاهده در نسخه وب / بررسی در ربات تلگرام". Light theme is identical to dark (G2). `…/landing__mac-1440__light.png`
Redesign: 4 nav items max, single-line, one primary CTA in the hero, header CTA as ghost.

### Follow-up pass: remaining 14 pages

Reviewed on iPhone 15 (393) and iPhone SE (375) webkit, iPad 820 and Mac 1440, dark and light. Contact sheets: `tmp/audit/sheets3/<page>-phone.png` (iPhone 15 dark/light, SE dark/light) and `tmp/audit/sheets3/<page>-big.png` (iPad 820 dark/light, Mac 1440 dark/light). Shot paths below are relative to `tmp/audit/shots-v2/webkit/`. G1 (install banner), G3 (bottom nav) and G4 (flat light theme) apply to every page here and are not repeated. On iPhone SE the banner covers more than 40% of the viewport on every page.

#### Library subject (`library-subject`)
**LS1 — P2 — Two rows and a 60% empty screen** (`library-subject__iphone-15__dark.png`). The list has no cover, edition or progress. Add a cover thumbnail, edition and last-read progress per book. On desktop, use a grid.

#### Library session (`library-session`)
**LSS1 — P2 — Two affordances per row, and titles break badly** (`library-session__iphone-15__dark.png`, `library-session__iphone-se__light.png`). Each row has both a "باز کردن ▸" pill and a "‹" chevron. Titles wrap with the dash leading the line ("جزوهٔ جلسهٔ ۱ —" / "فیزیولوژی قلب"), and on SE "ویدیو کلاس — / جلسهٔ ۱". Make the whole row tappable with one chevron, put the type icon before the title, and use a short title with the session number as a caption.
**LSS2 — P1 — Internal rationale shown to students** (same shots). The info card reads "فایلهای بدون نمایش (مثل پاورپوینت) فرستادن برای مرورگر مناسب نیست؛ لینک مستقیم تلگرام عمداً ساخته نمیشود". That's an engineering decision, not user guidance, and the tanvin in "عمداً" renders raised (I3). Replace it with a user outcome, e.g. "پاورپوینتها را از ربات تلگرام دریافت کنید", or remove it.

#### Library book (`library-book`)
**LBK1 — P1 — BiDi bug mangles the English book title** (`library-book__iphone-15__dark.png`, `library-book__iphone-se__dark.png`). "Guyton & Hall 14th ed." renders as "Guyton & Hall 14th" / ".ed": the period jumps to the start of the second line. On SE, "مگابایت" is orphaned on its own line. Wrap Latin titles in `<bdi dir="auto">` or set `unicode-bidi: plaintext` on titles.
**LBK2 — P2 — The same double affordance as LSS1** ("خواندن ▸" pill plus chevron), and the "فارسی" / "انگلیسی" section icons are generic file glyphs. Use language badges.

#### Exam history (`exam-history`)
**EH1 — P2 — Dead-end empty state** (`exam-history__iphone-15__light.png`). It says "هنوز پاسخی ثبت نشده" with no CTA, and the icon is about 2:1. Add a "شروع تمرین" button and a stronger icon.

#### Exam setup (`exam-setup`)
**ES1 — P1 — Step numbering skips "۲"** (`exam-setup__iphone-15__dark.png`). The steps read "۱. درس", "۳. تعداد سؤال", "۴. زمان", so a step is missing or hidden. Renumber the steps, or drop the numbers and use section titles.
**ES2 — P1 — "شروع آزمون" looks disabled even though valid defaults are selected** (20 questions and 20 minutes highlighted, but the button is pale). No course is selected by default, and nothing says so. Pre-select the first course, or show "یک درس انتخاب کنید" until one is chosen, then show a fully saturated button. On SE, the time chips and the start button sit entirely under the banner (`exam-setup__iphone-se__dark.png`). Related to E1.
**ES3 — P2 — Desktop and iPad: the form is a 400px strip of 10px chips in one corner** (`exam-setup__mac-1440__dark.png`, `exam-setup__ipad-820__light.png`). Use a centred 640px form card with 44px chips and a summary panel ("۲۰ سؤال · ۲۰ دقیقه · فیزیولوژی").

#### Exam result (`exam-result`)
**ER1 — P2 — The score has no meaning attached** (`exam-result__iphone-15__dark.png`). "۷۵٪" shows the "٪" detached and small with no pass/fail, cohort or weak-topic insight. The three CTAs (دریافت دفترچه PDF, آزمون تازه, آزمونهای قبلی) wrap into an uneven 2+1 layout. Use one primary ("مرور اشتباهها") and two secondary buttons, side by side or stacked full-width.
**ER2 — P2 — A stray check icon sits above the "بازبینی" heading**, and the review metadata ("پاسخ تو: ب — … · پاسخ درست: الف") is 11px at about 3.75:1. Fix the alignment, use 13px or larger muted text at 4.5:1 or above, and colour-code the given and correct answers.

#### Search (`search`)
**SR1 — P2 — Misaligned, empty empty-state** (`search__iphone-15__dark.png`). The large magnifier icon sits on the right while the caption "برای جستجو چیزی بنویس" is centred. There are no recent searches or suggested topics, and the input is 15px (G7). Centre the icon and add recent searches and quick chips such as "فیزیولوژی قلب" or "ECG".

#### Subscription (`subscription`)
**SB1 — P1 — Persian placeholder rendered in a monospace font** (`subscription__iphone-15__dark.png`, `subscription__ipad-820__light.png`). "کد را اینجا وارد کنید" is set in a letter-spaced monospace font, so the Persian letters disconnect ("ک د ر ا ا ی ن ج ا …"). Use the UI font for the placeholder and monospace only for the typed value, with `dir="ltr"` on the value.
**SB2 — P1 — Payment CTA is unreachable until the banner is dismissed** (iPhone 15/SE, both themes). "پرداخت ۱۹۰٬۰۰۰ تومان" scrolls to a position under the install banner and bottom nav even at maximum scroll, so the revenue action sits behind G1. Use a sticky pay bar above the nav and bottom padding at least as tall as the nav plus any sheet.
**SB3 — P2 — Price format** "۱۹۰,۰۰۰" puts a Latin comma between Persian digits. Use the Persian thousands separator "٬" (`Intl.NumberFormat('fa-IR')`). The two plan cards don't show per-month savings for the quarterly plan. Desktop stretches the plans as 1000px-wide rows (`subscription__mac-1440__light.png`, see D1).

#### Grades (`grades`)
**GR1 — P2 — Latin decimal point** in "۱۶.۴۲", "۱۷.۵" and "۹.۲۵". Use the Persian decimal separator "٫". The "وضعیت عادی" chip is neutral grey with no meaning, and the counts row (۳۸ / ۳۶ / ۲) carries the only colour. On Mac 1440 the whole page is a 480px block in the top corner (`grades__mac-1440__dark.png`, see D1). Add a GPA trend by term and a two-column layout on desktop.

#### Notifications (`notifications`)
**NT1 — P2 — Unread signals are inverted in light theme** (`notifications__iphone-15__light.png`). The *read* card has a tinted background while the unread card is white. Unread is signalled twice (cyan edge plus "جدید" pill). Use a single unread dot, the same neutral surface for every card, and bold titles for unread items.

#### Tickets (`tickets`, `ticket-detail`)
**TK1 — P2 — Raw ticket id with flipped BiDi**: "#t1" renders as "t1#" (`tickets__iphone-15__dark.png`). Real ids may be long. Show "تیکت ۱۲" or hide the id behind the detail view.
**TK2 — P1 — No deep-linkable ticket detail.** `App.tsx` registers only `/tickets`, and the detail view is local state (`selectedId` in `TicketsScreen.tsx`). A notification, a refresh or the back button can't land on a specific ticket. The harness URL `/student/tickets/t1` renders the 404 screen. Add a `/tickets/:id` route.
**NF1 — P1 — The 404 screen exposes developer notes** (`ticket-detail__iphone-15__dark.png`, `ticket-detail__iphone-15__light.png`). Under "این صفحه هنوز محتوایی ندارد" a card reads "ساختهشده در فاز … تا آن فاز، هیچ عدد یا فهرست نمونهای نمایش داده نمیشود تا دادهٔ ساختگی به الزام تبدیل نشود". That's an internal build-phase note. The appbar ("پیدا نشد / مسیر نامعتبر") has no back button, and the body only says to use the bottom tabs. Remove the dev card and add "بازگشت به خانه" and back actions.

#### Design system and states gallery (`system`, `states`)
**SY1 — P1 — Internal design-system showcase shipped in the student app and broken in light theme** (`system__iphone-15__light.png`, `system__iphone-se__light.png`). `/system` is routable and shows token names (`--hym-bg-page`, `--ink`, `--brand`) and "HumsYar Medical-AI · v2.0". In light theme the hero title "هامزیار Medical-AI", its description and the "رنگ" / "تایپوگرافی" headings are about 1.3:1 (39 contrast failures). Gate `/system` and `/states` behind a dev flag. If kept, theme them properly.
**ST1 — P2 — The states gallery shows raw codes** ("login_required 401", "pending_approval 403", "feature_disabled 402", "offline") as chips (`states__iphone-15__dark.png`). That's fine for a dev gallery, but make sure the production error screens don't reuse the chip. Students should see the message and the action only. The tanvin glitch from I3 also appears here ("قبلاً", "موقتاً").

**Tablet and desktop for these 14 pages:** they confirm D1 and PD1. Every one of them renders as the phone layout centred or right-aligned in a 1000px canvas with 10–12px type (`*__mac-1440__*.png`). On iPad 820 the header search placeholder wraps and the install card floats bottom-centre (`*__ipad-820__*.png`).

## 3. Routes that failed to render / harness notes

| Route | Status | Reason |
|---|---|---|
| all 31 | rendered on all 14 devices × 2 themes | — |
| reader-pdf | initially blank (fixed) | `/api/web/reader/manifest/*` and `/api/web/ink/*` were unmocked; mocks added (fix6/fix7 re-shoot) |
| media-player | renders, no video frame | `/audit-assets/sample.mp4` 404 in harness → infinite spinner (also a product issue, M1) |
| exam pages | render | `GET /api/web/exam/mock/active` unmocked (no visible effect) |
| landing / install / login "light" | render as dark | app does not theme these screens (G2), not a harness fault |
| schedule "python dict next to ترم" | not reproduced | mock returns `term: 2`; see S5 |

## 4. Severity counts

| Severity | Count |
|---|---|
| P0 | 5 (G1, G2, L1, LG1, AI1) |
| P1 | 33 (24 first pass + 9 follow-up: LSS2, LBK1, ES1, ES2, SB1, SB2, TK2, NF1, SY1) |
| P2 | 30 (17 first pass + 13 follow-up) |
| **Total** | **68** (+ 1 note, S5) |

## 5. Top 30 fixes (priority order, re-ranked after follow-up pass)

1. G1/LG1/AI1/SB2 — Kill the global iOS install bottom sheet (it hides chat input, login footer and the subscription pay button); one-time opaque inline card on home only.
2. L1 — Fix landing hero horizontal overflow (`.lp-pillar-panel__content` at −92/−125px); `overflow-x: clip` on sections.
3. G2 — Make landing/install/login theme-aware (or lock dark explicitly); fix the "یار" gradient wordmark and 1.1:1 subtitle.
4. SB2 — Sticky payment bar above the nav; bottom padding ≥ nav + sheet height.
5. NF1/TK2 — 404 screen: remove the build-phase dev card, add back/home actions; add a deep-linkable `/tickets/:id` route.
6. SY1/ST1 — Gate `/system` and `/states` behind a dev flag (token names, raw codes, broken light theme).
7. S1 — Jalali dates + fa digits in schedule rows (remove ISO `2026-11-25`, `08:00`).
8. LB1 — Map `bahman_1404` → "بهمن ۱۴۰۴" in the library header.
9. G7 — 16px minimum for all inputs on touch (AI inputs 13px, search 15px, chat 14px).
10. G6 — Raise the muted text token to ≥ 4.5:1 in both themes.
11. E1/ES2 — Submit/start buttons: clear enabled vs disabled state, sticky on mobile, explain what's missing; hide keyboard hints on touch.
12. ES1 — Fix exam-setup step numbering (۱ → ۳ skips ۲).
13. SB1 — Subscription code field: UI font for the Persian placeholder, monospace only for the value.
14. LBK1/TK1 — BiDi isolation (`<bdi dir="auto">`) for Latin titles and ids ("14th ed.", "#t1").
15. G3 — Opaque/blurred bottom nav with proper safe-area and active state.
16. R1 — Collapse the reader annotation toolbar into a pill; 44px targets.
17. D2 — Remove dark-token leaks in light (segmented track) and fix pastel chip contrast.
18. G4 — Rebuild the light palette: neutral ramp, real elevation, one accent.
19. S3/S4/S2 — Schedule: segmented week switcher with date range and arrows, unit-labelled counts, short tab labels.
20. D1/PD1/ES3 — Real desktop and tablet layouts: 14–15px base, week-grid schedule, two-pane library/exam, centred forms, desktop header on iPad.
21. LSS2/LG4/L3 — Remove internal rationale and jargon from student copy ("لینک مستقیم تلگرام عمداً…", "Crockford Base32", "PWA", "Bot API 7.0+").
22. G8/SB3/GR1 — `Intl.NumberFormat('fa-IR')` everywhere: digits, "٬" thousands, "٫" decimals, percent placement.
23. M1 — Media player poster, timeout and error state.
24. I1 — Install guide platform switcher: single-word segmented tabs.
25. L2/LD1 — One primary CTA on landing; single-line nav, ≤ 4 items.
26. ME1/LG3 — Consistent identity line (fa digits; clarify the login code); login CTA looks enabled.
27. G5 — One product name and one assistant name everywhere.
28. S5 — Frontend formatter + API normalisation for `term` (guard against raw dict/objects).
29. LSS1/LBK2/NT1/ER1 — List and row hygiene: one affordance per row, a single unread signal, one primary action on results.
30. N1/M2/LB2/LS1/EH1/SR1/H3/E4/I3/D3 — Empty states with CTAs, sparse-screen content, profile card slimming, polish (tanvin, sidebar brand line).
