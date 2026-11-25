# R3 — Design skills, tokens and QA tooling for هامزیار (Humsyar) student PWA

> Research only. No application code was changed. Scope: `apps/student` (React + TS + Vite, Persian RTL, base `/student/`) and the landing page in `miniapp/src/landing/`. This doc complements R1 (mobile patterns, per-section hues, measured contrast values) and R2 (chat + med-ed UX). It does not repeat R1's colour values; it defines how those values are structured, enforced and tested.

## 0. Summary

1. Use three local skills as rulebooks: **design-system** (3-layer tokens, no raw hex), **better-typography** (measured type rules + iOS 16px inputs, with Persian exceptions), **web-gui-tester / control-browser** (black-box evidence discipline). argent-screenshot-diff is for a physical-iPhone pass only.
2. The token file is already layered (primitive → light semantic → dark semantic → legacy aliases → adapters), but **`ui.css` (4,503 lines) bypasses it**: 171 hex, 289 `rgba()`, 301 `!important`, 9 component-level dark patches, off-palette `#00F2FE` ×37.
3. TSX carries **314 inline `style={{`** and **122 hex literals** (HomeScreen alone: 67 hex).
4. Dark `--hym-text-muted` (`#64748B`) on `#0B0F19` is about **4.0:1** (3.75:1 on surface `#0F172A`) — fails WCAG AA for body text.
5. No section-accent tokens exist (no indigo/violet/emerald/rose/honey); add them as **role tokens** and switch per screen with `[data-section]`.
6. Migration is additive and screenshot-gated: add, re-point aliases, replace per file, then ratchet a lint gate.
7. QA: reuse `tmp/audit/shoot-student-v2.mjs` (it already does the device matrix, overflow, clipping and WCAG contrast); add axe-core, APCA, `toHaveScreenshot` baselines and Lighthouse CI.
8. A Safari/iOS + RTL checklist closes the doc (§7).

## 1. Local skills inventory and what to apply

| Skill | Path | Use it for | Apply / ignore |
|---|---|---|---|
| design-system | `C:/Users/Amir/.agents/skills/design-system/SKILL.md` | Token architecture, hardcoded-value scan | Apply the token parts; ignore the slide system (Chart.js decks, BM25 slide search) |
| better-typography | `C:/Users/Amir/.agents/skills/better-typography/SKILL.md` (+ `css-cheat-sheet.md`, `details-and-accessibility.md`, `spacing-and-sizing.md`, `wrapping-and-punctuation.md`) | Type scale, line-height, iOS input zoom, bidi | Apply fully, with the Persian exceptions below |
| argent-screenshot-diff | `C:/Users/Amir/.agents/skills/argent-screenshot-diff/SKILL.md` | Pixel diffs on iOS sim/physical iPhone via the argent tool | Apply its capture discipline; for the web matrix use Playwright `toHaveScreenshot` |
| web-gui-tester | `C:/Users/Amir/.zcode/cli/plugins/cache/zcode-plugins-official/browser-use/0.5.1/skills/web-gui-tester/SKILL.md` | Black-box exploratory test passes | Apply to flows (login → home → reader → exam) |
| control-browser | `.../browser-use/0.5.1/skills/control-browser/SKILL.md` | Driving ZCode's in-app browser from an agent | Apply when an agent runs the exploratory pass |
| design (router) + sub-skills | `.../design/0.7.2/skills/design/SKILL.md`; `design-resources/skills/{design-review,plan-design-review,frontend-design,taste-skill,brand-guidelines,design-consultation}/SKILL.md`; skeleton `design-resources/design-skeletons/mobile-app/SKILL.md` | Visual critique, anti-pattern list, plan review | Use `frontend-design` anti-patterns and `design-review` as rubrics; skeletons are reference only |
| ios-dev | `.../ios-simulator/0.1.0/skills/ios-dev/SKILL.md` | Xcode simulator build/screenshot | Needs macOS; not usable on this Windows machine. Final Mac pass only |
| android-dev | `.../android-emulator/0.1.1/skills/android-dev/SKILL.md` | Real Chrome-on-Android emulator | Optional |
| jozve-designer | `C:/Users/Amir/.agents/skills/jozve-designer/SKILL.md` | Persian print PDFs | Not for the PWA |

### 1.1 design-system: rules to apply
- Three layers, one direction only: primitive (raw values) → semantic (purpose aliases) → component (`--button-bg: var(--color-primary)`). Components never read primitives.
- No raw hex in components. Only the semantic layer changes between light and dark. Document each token's purpose.
- `scripts/validate-tokens.cjs --dir <src>` flags hex, `rgb(`, 2-digit `px` and `rem` outside token files. Use it as a counter, not a gate. Caveat from its source: the colour regex only matches `rgb(r,g,b)`, so `rgba(...)` (289 uses in `ui.css`) goes uncounted. Supplement it with §6.5.
- `scripts/generate-tokens.cjs --config tokens.json -o tokens.css` is a lightweight alternative to Style Dictionary (§3).

### 1.2 better-typography: rules to apply
These are measured findings, not taste: unitless line-height; weight ≥400 below 18px; 60–75ch measure for long text; 16px inputs on iOS (or 16px + `transform: scale`); `tabular-nums` on timers, counters, prices and grades; `rem` sizes; antialiasing set once on the root; `lang`/`dir` on the document and `<bdi>` around mixed-direction values (Latin drug names, course codes, URLs, phone numbers); `text-wrap: balance` on headings and `pretty` on paragraphs; line-clamp needs `display:-webkit-box`.

**Persian exceptions (our addition).** Don't apply the uppercase-label tracking rule to Arabic-script text: letter-spacing breaks cursive joining, and `text-transform` does nothing. Current violations: `.eyebrow{letter-spacing:.16em;text-transform:uppercase}` (`apps/student/src/design/ui.css:149`) and `.appbar__sub{letter-spacing:.06em}` (`:21`). Scope tracking to `:lang(en)`. Keep `tabular-nums` with Persian digits so they don't jitter.

**Reporting.** Use a severity table. `HIGH` means unreadable, truncated with no way back, or clipped at 320px or 200% zoom, and blocks the change. Write one row per root cause. Mark anything you didn't check as `Not verified`.

### 1.3 argent-screenshot-diff: rules to apply
- A pixel diff is supporting evidence, not the verdict. Pair it with DOM and a11y checks.
- Diff stable states only. Avoid timestamps, random data and unpaused animation. The audit server already returns deterministic mock data; freeze the clock too (§6.2).
- Capture the baseline before the change, keep baselines per device and resolution, and save full-resolution files.
- Use argent itself only for a physical-iPhone pass (`kind: "device"`).

### 1.4 web-gui-tester and control-browser: rules to apply
- Black-box: interact only with visible UI. Once formal testing starts, no JS injection that changes state. Declare any setup (seeded `localStorage`, mock API), and setup must not complete the behaviour under test.
- Every test point needs a screenshot you have actually looked at plus a read-only DOM check. Save evidence as `gui-test-screenshots/t<N>_before.png` / `_after.png`.
- Prioritise: P0 is auth/gates, reader and exam run; P1 is library, schedule and AI chat; P2 is settings. Ask before anything that writes real data.
- control-browser: read the page with `domSnapshot()` first, build locators only from snapshot facts, and take a screenshot only when vision matters. One state-changing action per observation.

### 1.5 Design plugin sub-skills
`frontend-design` has an anti-pattern list (generic gradients, default card grids, timid typography) that works as a review rubric. `plan-design-review` (1,235 lines) and `taste-skill` (1,217 lines) are heavy and only worth it for a full redesign review. The `mobile-app` and `ai-assistant-mobile-dashboard` skeletons are inspiration only.

## 2. Current design system (baseline)

**Files** (`apps/student/src/design/`): `tokens.css` 550 lines, `ui.css` 4,503, `base.css` 219, `media.css` 271, `brand.css` 3. The doc `DESIGN_SYSTEM.md` (322 lines) describes primitives `--hym-*`, semantic groups (surfaces, text, brand), spacing, radius, shadows, typography, motion and z-index, plus environment adapters and legacy compatibility.

**Layers in `tokens.css`** (380 custom properties, 294 of them `--hym-*`):
1. `:root` primitives (line 16): brand 50–950 (`#2563EB` = 600), cyan 50–900, slate, amber, teal, status hues, spacing, radius, z-index.
2. `:root` "Clinical light" semantic (line 183): `--hym-bg-page/surface/surface-raised/surface-inset/hover/active/selected/overlay/scrim`, `--hym-text-primary/secondary/muted/disabled/inverse/link/on-brand`, `--hym-border-*`, `--hym-brand-*`, plus success/warning/danger/info `-default/-subtle/-bg`.
3. `html[data-theme="dark"], html.dark` "Obsidian navy" (line 290): the same semantic names re-pointed.
4. Legacy aliases (line 400, with dark overrides at 494): `--paper*`, `--ink*`, `--line*`, `--brand*`, `--cyan*`, `--tl`, `--dash`, `--wm-ink`, `--read-rule`. Most of `ui.css` consumes these.
5. Adapters (line 510): layout sizes, breakpoints, sticky-note colours, app-shell sizes, `--hym-safe-top/bottom: env(safe-area-inset-*)`, and `[data-density="compact"]`.

**Theme switching.** `src/lib/theme.tsx` stores the preference under `humsyar.theme`, resolves "system" through `matchMedia('(prefers-color-scheme: dark)')` with a live listener, and sets `document.documentElement.dataset.theme`. The `html.dark` selector is redundant with that.

**Structural problems (measured with grep)**

| Problem | Evidence |
|---|---|
| `ui.css` bypasses tokens | 171 hex, 289 `rgba(`, 607 `var(--`; 0 custom properties defined |
| Off-palette neon | `#00F2FE` ×37 (not a primitive; `--hym-cyan-400` is `#22D3EE`); `#FFFFFF` ×25, `#94A3B8` ×16, `#2563EB` ×9 literal |
| Specificity war | 301 `!important` in `ui.css` |
| Dark mode patched per component | 9 `html[data-theme="dark"] .x` rules, e.g. `.btn--cyan{color:#021124}`, `.desktop-header` overridden for both themes (lines 1272–1285) |
| Physical, not logical, properties | 53 `left/right`, `margin-/padding-left/right`, `text-align:left/right` in `ui.css` |
| Inline styles in TSX | 314 `style={{`: Schedule 31, AiChat 24, Grades 22, AiVisionModal 18, Tickets 18, InkToolbar 17, Subscription 17, System 15, Library 14, Login 12, Search 11, ThumbnailDrawer 9, DeviceListModal 9, Notifications 8 |
| Hex in TSX | 122: HomeScreen 67, InkToolbar 18, ProtectedReaderView 6, InstallGuide 6, StickyNoteOverlay 4, Login 4 |
| No section accents | Only amber, teal and status hues exist; nothing for the indigo/violet/emerald/rose/honey roles R1 proposes |
| Contrast bug | Dark `--hym-text-muted #64748B` is about 4.0:1 on `#0B0F19` and 3.75:1 on `#0F172A` (computed by hand with the WCAG 2 formula); needs ≥4.5 |
| Typography | 11px text with tracking on Persian (`.eyebrow`, `.appbar__sub`, `.tiny`); input font size not verified (`.input::placeholder` is 14px) |
| PWA meta | `theme-color` fixed at `#0B0F19` even in light; `apple-mobile-web-app-status-bar-style: default` |
| Landing | `miniapp/src/landing/landing.css` 1,496 lines, 54 hex, separate from student tokens |

## 3. External research (sources)

- **Radix Colors.** 12 steps with fixed jobs: 1–2 app backgrounds, 3–5 component backgrounds (normal/hover/pressed), 6–8 borders and focus, 9–10 solid fill and its hover, 11–12 low- and high-contrast text. Step 11 on step 2 is guaranteed APCA Lc 60, step 12 Lc 90 ([understanding the scale](https://www.radix-ui.com/docs/colors/palette-composition/understanding-the-scale), [composing a palette](https://www.radix-ui.com/docs/colors/palette-composition/composing-a-palette)). **Adopt the step semantics as our naming contract.**
- **Tailwind v4** uses 11-step 50–950 ramps written in OKLCH; **Open Props** uses `--blue-0…12`, with OKLCH palettes in beta ([Open Props](https://open-props.style), [palette viewer](https://palettes.colorjs.io/palettes/openprops/)). Our existing 50–950 ramps fit the Tailwind shape. Keep them, and author new hues in OKLCH so they match in lightness.
- **Material 3.** Tonal palettes run 0–100 in HCT, and roles map to tones per theme: primary 40 light / 80 dark, on-primary 100/20, container 90/30, on-container 10/90 ([how the system works](https://m3.material.io/styles/color/system/how-the-system-works), [key colors & tones](https://m3.material.io/styles/color/the-color-system/key-colors-tones)). **Copy the role quartet (solid, on-solid, container, on-container) for each section accent.**
- **Apple HIG.** Use semantic dynamic colours; in dark mode, elevated surfaces are lighter so sheets read as "in front". Hardcoded `#FFFFFF` breaks dark mode and Increased Contrast ([WWDC19 Dark Mode](https://developer.apple.com/videos/play/wwdc2019-214/), [HIG mirror](https://github.com/dickwu/apple-design-skill/blob/main/references/hig/color.md)). **The dark `surface-raised` should be lighter than `surface`; ours already is (`#1E293B` > `#0F172A`).**
- **W3C DTCG.** The Design Tokens Format Module reached its first stable version, 2025.10, as a Community Group report, not a W3C Standard ([spec](https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/), [announcement](https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/)). Style Dictionary supports DTCG `$value`/`$type` (reportedly since v4), with a known `dimension` bug ([styledictionary.com](https://styledictionary.com), [issue #1398](https://github.com/style-dictionary/style-dictionary/issues/1398)). **Optional for us: one platform (CSS) doesn't need a build step yet.**
- **Contrast automation.** WCAG 2 ratio via axe-core (`color-contrast` rule), plus APCA via the `apca-w3` package (`calcAPCA`, `fontLookupAPCA`): Lc 75 minimum for body text, Lc 90 preferred, about Lc 60 for large or bold text. Lc is signed, so compare the absolute value ([apca-w3](https://www.npmjs.com/package/apca-w3), [SAPC-APCA](https://github.com/Myndex/SAPC-APCA)).
- **Playwright visual regression.** `toHaveScreenshot` disables animations by default, hides the caret, and retries until two consecutive shots match before comparing with the baseline. Tune it with `maxDiffPixelRatio` and `threshold` ([PageAssertions](https://playwright.dev/docs/api/class-pageassertions), [visual comparisons](https://playwright.dev/docs/test-snapshots)).
- **axe-core.** `new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'])` ([Playwright a11y testing](https://playwright.dev/docs/accessibility-testing), [@axe-core/playwright](https://www.npmjs.com/package/@axe-core/playwright)).
- **Lighthouse CI.** `lighthouserc.json` with `numberOfRuns: 3`, `categories:*` `minScore`, and `resource-summary:script:size` `maxNumericValue` assertions ([getting started](https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/getting-started.md), [performance budgets](https://web.dev/articles/use-lighthouse-for-performance-budgets)).
- **iOS PWA.** Inputs under 16px trigger zoom; don't fix it with `maximum-scale=1`, which blocks user zoom. Standalone insets were measured at about 59px top and 34px bottom. `svh`/`dvh`/`lvh` can differ in standalone mode. After the keyboard opens, the viewport can stay shrunk. iOS caches `viewport-fit` until the PWA is re-added (community reports; see the threads in [WebKit viewport-fit](https://webkit.org/blog/7929/designing-websites-for-iphone-x/) and [MDN env()](https://developer.mozilla.org/en-US/docs/Web/CSS/env)).
- **RTL.** Use logical properties and the `dir` attribute rather than CSS `direction`. Mirror arrows, chevrons and progress indicators; don't mirror logos, play buttons, checkmarks or clocks. Use `<bdi>` for Latin runs, lint for physical properties, snapshot both directions, and test with real Persian text ([RTL in practice](https://dev.to/mamareza/rtl-in-practice-css-logical-properties-bidi-text-icons-numerals-and-a-testing-checklist-5hl7), [Material bidirectionality](https://m2.material.io/design/usability/bidirectionality.html)).

## 4. Target token architecture (primitive → semantic → component)

Keep the `--hym-` prefix and the existing ramps. Add, don't rename.

**Layer 1: primitives** (theme-agnostic, never used by components)
```css
:root{
  /* existing: --hym-brand-50..950, --hym-cyan-50..900, --hym-slate-*, --hym-amber-* … */
  /* new ramps, authored in OKLCH so lightness matches across hues */
  --hym-indigo-50: oklch(.97 .02 275); /* … */ --hym-indigo-600: oklch(.51 .21 275);
  --hym-violet-*; --hym-emerald-*; --hym-green-*; --hym-honey-*; --hym-rose-*;
  --hym-neon-400: #00F2FE; /* promote the 37 literals so they can be retired deliberately */
}
```

**Layer 2: semantic.** One role contract per accent with Radix and M3 semantics, defined twice (light `:root`, dark `html[data-theme="dark"]`):

| Token suffix | Radix step / M3 tone | Light | Dark |
|---|---|---|---|
| `-solid` | step 9 / tone 40–80 | 600 | 400 |
| `-solid-hover` | step 10 | 700 | 300 |
| `-on-solid` | text on step 9 | white | 950 |
| `-subtle` (container) | step 3 / tone 90–30 | 50 | `color-mix(in oklch, var(400) 16%, transparent)` |
| `-subtle-border` | step 6–7 | 200 | `color-mix(… 32%, transparent)` |
| `-text` (on-container) | step 11 / tone 10–90 | 700 | 300 |

Roles: `brand` (royal blue), `resources` (indigo), `qbank` (violet), `schedule` (amber), `ai` (cyan → blue; adds `--hym-role-ai-gradient: linear-gradient(135deg,var(--hym-cyan-400),var(--hym-brand-600))`), `grades` (emerald), `money` (green), `notes` (honey), `danger` (rose). Fix `--hym-text-muted` in dark to `#94A3B8` (R1 measures 7.07 on canvas) and move secondary to about `#CBD5E1`.

**Layer 3: component.** Components read only `--hym-accent-*`, and a section sets which role feeds it:
```css
:root,[data-section="brand"]{--hym-accent:var(--hym-role-brand-solid);--hym-accent-hover:var(--hym-role-brand-solid-hover);
  --hym-accent-on:var(--hym-role-brand-on-solid);--hym-accent-subtle:var(--hym-role-brand-subtle);
  --hym-accent-text:var(--hym-role-brand-text);--hym-accent-border:var(--hym-role-brand-subtle-border)}
[data-section="qbank"]{--hym-accent:var(--hym-role-qbank-solid); /* …same six */}
/* components */
.btn{--btn-bg:var(--hym-accent);--btn-fg:var(--hym-accent-on);background:var(--btn-bg);color:var(--btn-fg)}
.chip[aria-selected="true"]{background:var(--hym-accent-subtle);color:var(--hym-accent-text);border-color:var(--hym-accent-border)}
.tabbar__item[aria-current="page"]{color:var(--hym-accent-text)}
```
The screen root (`<main data-section="qbank">`) re-themes every button, chip and progress bar inside it, with no per-component dark rules. Dark mode only touches layer 2, which removes the 9 `html[data-theme="dark"] .x` patches.

Optional source of truth later: `tokens/*.tokens.json` in DTCG (`{"hym":{"indigo":{"600":{"$type":"color","$value":"oklch(...)"}}}}`) → Style Dictionary or `generate-tokens.cjs` → `tokens.css`. Wait until the admin panel or native shells need the same tokens.

## 5. Non-breaking migration strategy

1. **Freeze and measure.** Run the audit matrix (§6) to record baseline screenshots and JSON. Commit the counts (hex/rgba/`!important`/inline/physical props) to `tmp/audit/ratchet.json`.
2. **Additive tokens.** Add new primitive ramps, `--hym-role-*` and `--hym-accent-*` (defaulting to brand). Nothing consumes them yet, so the visual diff must be 0.
3. **Re-point the legacy layer.** Make `--brand*`/`--cyan*` resolve through `--hym-accent-*` and `--hym-role-ai-*`. Legacy names stay, so `ui.css` is untouched. Expect a 0 diff with the default `data-section`.
4. **Fix the semantic bugs** (dark muted text, `theme-color` pair) as one deliberate, reviewed visual change. Update baselines.
5. **Replace literals file by file,** highest count first: `ui.css` `#00F2FE` → `var(--hym-neon-400)` → later `--hym-role-ai-*`; HomeScreen's 67 hex; InkToolbar. Each PR must show a 0 or approved diff on all 14 device configs × 2 themes.
6. **Inline styles to classes,** in order: Schedule, AiChat, Grades, AiVisionModal, Tickets, Subscription. Keep truly dynamic values (positions, progress %) as CSS variables: `style={{'--p': pct}}` with `width:calc(var(--p)*1%)`.
7. **Logical properties.** Convert the 53 physical declarations (`margin-inline-start`, `inset-inline-end`, `text-align:start`).
8. **De-escalate `!important`** once the specificity sources are gone. Delete the dark component patches after step 3 covers them.
9. **Ratchet gate.** A script fails if any count rises above `ratchet.json` (§6.5); lower the numbers as PRs land. Later, add stylelint `color-no-hex` plus `declaration-strict-value` for files outside `tokens.css`.
10. **Landing.** Import `tokens.css` into `miniapp/src/landing` and map its 54 hex values onto roles. Do this last, since it is a separate bundle.

## 6. Local automated QA pipeline

`tmp/audit/shoot-student-v2.mjs` (436 lines) already covers a lot:
- It serves `apps/student/dist` and `miniapp/dist-landing` with realistic mock `/api` data.
- It runs 12 devices plus 2 "PWA" iPhones across WebKit and Chromium, about 22 pages, dark and light.
- Contexts use `locale: 'fa-IR'`, `timezoneId: 'Asia/Tehran'`, `serviceWorkers: 'block'` and `colorScheme`, and the theme is seeded via `localStorage['humsyar.theme']`.
- It records `overflowX` with offenders, WCAG-ratio low contrast (skipping background images), and clipped text, writing to `results-v2-<engine>.json` and `shots-v2/<engine>/`.

Don't rebuild this. Extend it as follows.

### 6.1 Share the matrix
Move `UA`, `DEVICES`, `PWA_DEVICES` and `PAGES` into `tmp/audit/matrix.mjs` and import them from both the shooter and a Playwright Test project. Playwright lives in `C:/Users/Amir/.cache/hy-audit/tools`; add `@axe-core/playwright`, `apca-w3` and `@lhci/cli` there, which keeps app `package.json` clean.

**Note:** `displayMode: 'standalone'` is passed to `newContext`, but it isn't a documented Playwright context option (verify that it does anything). Emulate standalone explicitly:
```js
await ctx.addInitScript(() => {
  const mm = window.matchMedia.bind(window);
  window.matchMedia = q => /display-mode:\s*standalone/.test(q)
    ? { matches: true, media: q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){}, onchange: null, dispatchEvent: () => false }
    : mm(q);
  Object.defineProperty(navigator, 'standalone', { get: () => true });
});
```
Safe-area insets can't be emulated in Playwright. Approximate them with a debug override, `html[data-qa-safe]{--hym-safe-top:59px;--hym-safe-bottom:34px}`, applied only in QA, and keep the real check for a device (§7).

### 6.2 Determinism
Before each capture: `await page.clock.setFixedTime(new Date('2026-11-25T09:00:00+03:30'))`, `await page.evaluate(() => document.fonts.ready)`, then `page.addStyleTag({content:'*,*::before,*::after{caret-color:transparent!important}'})`. Mask live regions: `mask: [page.locator('[data-qa-dynamic]')]`.

### 6.3 axe scan (per page × theme, one device per engine)
```js
import AxeBuilder from '@axe-core/playwright';
const axe = await new AxeBuilder({ page })
  .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
  .exclude('canvas, .pdf-page') // pdf.js raster
  .analyze();
result.axe = axe.violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, sample: v.nodes[0]?.target }));
```
Fail on `critical`/`serious`. Treat `color-contrast` as a cross-check with the existing in-page contrast walker.

### 6.4 APCA alongside WCAG
In the existing `contrast(el)` function, keep the ratio and add APCA (inject `apca-w3` with `page.addScriptTag({path: require.resolve('apca-w3/dist/apca-w3.min.js')})`, or port `calcAPCA`):
```js
const lc = Math.abs(APCAcontrast(sRGBtoY([fg.r, fg.g, fg.b]), sRGBtoY([bg.r, bg.g, bg.b])));
const needLc = size >= 24 || (size >= 16 && weight >= 700) ? 60 : size < 14 ? 90 : 75;
if (lc < needLc) out.lowApca.push({ el: label(el), lc: Math.round(lc), size, weight });
```
Persian at 11–12px should be held to Lc 90, which is why `.tiny`/`.eyebrow` need a size bump.

Add a **static token contrast test** (no browser) that resolves every `-text`/`-on-solid` and `-subtle`/`-solid`/`bg-*` pair for both themes from `tokens.css` and asserts WCAG ≥4.5 (≥3 for large) and APCA ≥75/60. This catches regressions like the dark muted-text bug before any screenshot runs.

### 6.5 Overflow, RTL and ratchet detectors
The shooter already measures `scrollWidth - innerWidth`. Add:
```js
// elements poking outside the viewport on either side (RTL bugs show on the left)
const vw = innerWidth;
out.outside = [...document.querySelectorAll('body *')].filter(e => {
  const r = e.getBoundingClientRect(); return r.width && (r.left < -1 || r.right > vw + 1);
}).slice(0, 10).map(label);
// tap targets < 44×44 (R1)
out.smallTargets = [...document.querySelectorAll('button,a,[role=button],input')].filter(e => {
  const r = e.getBoundingClientRect(); return r.width && (r.width < 44 || r.height < 44);
}).length;
// iOS zoom risk
out.smallInputs = [...document.querySelectorAll('input,textarea,select')]
  .filter(e => parseFloat(getComputedStyle(e).fontSize) < 16).map(label);
```
Also run every page at 320px width and at 200% (`deviceScaleFactor: 1`, viewport 187×400), as the typography skill requires.

Static ratchet (`tmp/audit/ratchet.mjs`):
```js
const rules = { hex: /#[0-9a-f]{3,8}\b/gi, rgba: /rgba?\(/g, important: /!important/g,
  inline: /style=\{\{/g, physical: /\b(margin|padding)-(left|right)|\b(left|right)\s*:|text-align:\s*(left|right)/g };
// walk apps/student/src (skip design/tokens.css), sum per rule, compare with ratchet.json, exit 1 on increase
```

### 6.6 Visual regression
Use a Playwright Test project fed by `matrix.mjs`, with `expect(page).toHaveScreenshot(`${dev.id}-${theme}-${pg.id}.png`, { fullPage: true, maxDiffPixelRatio: 0.002, animations: 'disabled', mask })`. Store baselines per engine (`snapshotPathTemplate: '{testDir}/__shots__/{projectName}/{arg}{ext}'`). WebKit on Windows is not Safari, so treat it as a proxy and confirm on a device. Refresh with `--update-snapshots` only in the PR that intends the change. For a physical iPhone, use argent's `baselinePath` + `captureCurrent` flow (§1.3).

### 6.7 Lighthouse CI (mobile, against `vite preview`)
```json
{ "ci": { "collect": { "url": ["http://localhost:4173/student/", "http://localhost:4173/student/library"], "numberOfRuns": 3,
    "settings": { "preset": "mobile" } },
  "assert": { "assertions": {
    "categories:performance": ["error", {"minScore": 0.85}], "categories:accessibility": ["error", {"minScore": 0.95}],
    "categories:best-practices": ["warn", {"minScore": 0.9}], "installable-manifest": "warn",
    "resource-summary:script:size": ["error", {"maxNumericValue": 350000}],
    "resource-summary:font:size": ["warn", {"maxNumericValue": 200000}],
    "largest-contentful-paint": ["warn", {"maxNumericValue": 2500}], "cumulative-layout-shift": ["error", {"maxNumericValue": 0.1}] } },
  "upload": { "target": "filesystem", "outputDir": "tmp/audit/lhci" } } }
```
Lazy-load `pdfjs-dist` per route, or the script budget fails.

**Run order (one command, `tmp/audit/qa.ps1`):** `npm --prefix apps/student run build`, then `node tmp/audit/ratchet.mjs`, the token contrast test, the shooter (chromium, then webkit) with axe/APCA/overflow, `playwright test` (visual), and `lhci autorun`. Finish with a summary table of which pages/devices fail each check.

## 7. Safari/iOS PWA + RTL checklist

**iOS Safari / standalone**
- [ ] `viewport-fit=cover` present (it is). Never add `maximum-scale`/`user-scalable=no`.
- [ ] Header and tab bar pad with `max(var(--space), env(safe-area-inset-*))`. Landscape uses `inset-left/right` (the media player already does).
- [ ] Full-height shells use `min-height:100dvh`, with a `100vh` fallback first. Don't use `dvh` for anything that animates (it reflows while the toolbar moves). Check standalone separately, because `svh`/`dvh` differ there.
- [ ] Every `input/textarea/select` computes to ≥16px (detector in §6.5); the chat composer included.
- [ ] Keyboard: the composer and exam answer bar follow `visualViewport` (`resize`/`scroll`), not `position:fixed; bottom:0` alone. After blur, verify the viewport returns to full height (known standalone bug). Use `inputmode="numeric"` for student ID/OTP and `enterkeyhint` on chat.
- [ ] `backdrop-filter` always paired with `-webkit-backdrop-filter`; give it a solid fallback colour under `@supports not`. Limit it to bars, since blur over the PDF reader is costly.
- [ ] `theme-color` uses two metas with `media="(prefers-color-scheme: …)"`, updated by `theme.tsx` on manual toggle. Consider `black-translucent` status bar with a safe-area top pad.
- [ ] `overscroll-behavior: contain` on sheets and chat lists. Use `-webkit-tap-highlight-color: transparent` together with visible `:focus-visible`.
- [ ] `apple-touch-icon` 180px and splash screens; the manifest `start_url`/`scope` is `/student/`. After any change to these, re-test with a freshly re-added home-screen icon (iOS caches them).
- [ ] Persistent storage and auth survive a standalone relaunch. Standalone has separate storage from Safari tabs, so login state isn't shared.
- [ ] Haptics/`vibrate` absent on iOS: no feature depends on it.

**RTL / Persian**
- [ ] `<html lang="fa" dir="rtl">`. Never use CSS `direction` for layout.
- [ ] Logical properties only (ratchet the 53 physical ones to 0). Transforms and gradients reviewed with `:dir(rtl)` (e.g. `translateX`, `to right`).
- [ ] Mirror back/forward chevrons, progress, sliders and swipe directions. Don't mirror logos, play/pause, checkmarks, clocks, or the PDF page-turn order (the book's own direction).
- [ ] `<bdi>` around Latin terms, file names, emails, course codes and mixed numbers. Snapshot with a stress string: `داروی Metformin 500mg — کد درس MED-101 (۳ واحد)`.
- [ ] Persian digits in UI (`Intl.NumberFormat('fa-IR')`), Latin digits kept inside code and IDs. `tabular-nums` on timers, grades and prices.
- [ ] No letter-spacing or uppercase on Persian text. Line-height ≥1.6 for Persian body. Keep ZWNJ (U+200C) in strings and don't strip it in sanitisers.
- [ ] The weekly timetable starts on Saturday (R1 §12), and the Jalali date is correct at the Tehran timezone boundary (the shooter already fixes `Asia/Tehran`).
- [ ] Charts and progress bars fill from the right. Carousels start at the right, and `scrollLeft` sign differences are handled.
- [ ] Every page runs at 320px and 200% zoom with no horizontal overflow and no clipped text (shooter fields `overflowX`, `outside`, `clipped`).

## Sources
- Radix Colors: https://www.radix-ui.com/docs/colors/palette-composition/understanding-the-scale , https://www.radix-ui.com/docs/colors/palette-composition/composing-a-palette
- Open Props: https://open-props.style , https://palettes.colorjs.io/palettes/openprops/
- Tailwind colors: https://tailwindcss.com/docs/colors
- Material 3: https://m3.material.io/styles/color/system/how-the-system-works , https://m3.material.io/styles/color/the-color-system/key-colors-tones
- Apple: https://developer.apple.com/videos/play/wwdc2019-214/ , https://developer.apple.com/design/
- DTCG 2025.10: https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/ , https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/
- Style Dictionary: https://styledictionary.com , https://github.com/style-dictionary/style-dictionary/issues/1398
- APCA: https://www.npmjs.com/package/apca-w3 , https://github.com/Myndex/SAPC-APCA
- Playwright: https://playwright.dev/docs/api/class-pageassertions , https://playwright.dev/docs/test-snapshots , https://playwright.dev/docs/accessibility-testing
- axe: https://www.npmjs.com/package/@axe-core/playwright
- Lighthouse CI: https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/getting-started.md , https://web.dev/articles/use-lighthouse-for-performance-budgets
- iOS: https://webkit.org/blog/7929/designing-websites-for-iphone-x/ , https://developer.mozilla.org/en-US/docs/Web/CSS/env
- RTL: https://dev.to/mamareza/rtl-in-practice-css-logical-properties-bidi-text-icons-numerals-and-a-testing-checklist-5hl7 , https://m2.material.io/design/usability/bidirectionality.html
