# Humsyar student PWA: Design System v2

Scope: `apps/student`. Spec: `docs/research/R3_SKILLS_AND_TOOLING.md` §4–§7. Audit: `docs/audit/VISUAL_AUDIT_V2.md`.
Status: tokens, base components and the style guide are in place. **No screen has been migrated yet.** That work belongs to Wave 3/4.

Files:

| File | What it holds |
|---|---|
| `src/design/tokens.css` | Every raw colour and size value. It is the only file the ratchet excludes. |
| `src/design/components.css` | The `.ds-*` base components. They read tokens only. |
| `src/design/components/index.tsx` | Thin React wrappers (`DsButton`, `DsChip`, `DsSegmented`, `DsCard`, `DsBadge`, `DsInput`, `DsEmpty`, `DsSkeleton`). |
| `ds-preview.html` | Living style guide. Open it in dev at `/student/ds-preview.html`. It is not a build input and does not ship in `dist`. |
| `scripts/ds-ratchet.mjs` + `ratchet.json` | Style-debt gate. |

## 1. Token architecture

Tokens come in three layers. Components read **layer 3 plus the semantic tokens only**.

1. **Primitives** are theme-agnostic and never read by components.
   - Kept from v1: `--hym-brand-*`, `--hym-cyan-*`, `--hym-slate-*`, `--hym-amber-*`.
   - Added: `--hym-sky-*`, and these OKLCH ramps: `--hym-indigo-*`, `--hym-violet-*`, `--hym-emerald-*`, `--hym-green-*`, `--hym-honey-*`, `--hym-rose-*`.
   - Every ramp has steps 50–950.
   - `--hym-neon-400` (#00F2FE) is the single home for the neon literal.
2. **Roles** use a six-token contract per role, defined in light (`:root`) and dark (`html[data-theme="dark"]`):
   `--hym-role-<role>-{solid, solid-hover, on-solid, subtle, subtle-border, text}`.
   AI also has `-vivid`, `-vivid-hover` (decorative cyan, which is v1 `--cyan`) and `-gradient` (decorative only, never put text on it).
3. **Accent**: `--hym-accent`, `-hover`, `-on`, `-subtle`, `-border`, `-text`. The default is brand. `[data-section="<role>"]` re-points all six for its subtree.

### Role table

The dark generic rule is: solid 400, hover 300, on-solid 950, subtle 400 at 16%, border 400 at 32%, text 300.

| Role (`data-section`) | Use | Light solid / on | Light text on subtle | Dark solid / on |
|---|---|---|---|---|
| `brand` (default) | Primary actions, links | brand-600 / white 5.2 | brand-700 / brand-50 | brand-600 / white (logo colour kept) |
| `resources` | Library, books, video | indigo-600 / white 6.5 | indigo-700 7.2 | indigo-400 / 950 |
| `qbank` | Question bank, exams | violet-600 / white 5.9 | violet-700 6.7 | violet-400 / 950 |
| `schedule` | Timetable, calendar | amber-700 / white 5.0 | amber-800 | amber-400 / 950 |
| `ai` | AI assistant | sky-700 / white | sky-700 | neon-400 / cyan-950 |
| `grades` | Transcript, GPA | emerald-700 / white 5.4 | emerald-700 5.1 | emerald-400 / 950 |
| `money` | Subscription, payment | green-700 / white 4.95 | green-800 | green-400 / 950 |
| `notes` | Notes, annotations | honey-700 / white 4.9 | honey-800 | honey-400 / 950 |
| `danger` | Delete, errors, deadlines | rose-600 / white 4.5 | rose-700 5.5 | rose-400 / 950 |

Steps were moved where the generic 600 failed: amber, emerald and honey drop to 700 in light. All 53 text/background pairs in the style guide pass WCAG AA in both themes. The guide measures the ratios live from computed colours, at 393 WebKit and 1440 Chromium.

### Other v2 tokens

| Group | Tokens |
|---|---|
| Surfaces | `--hym-surface-0` (canvas), `-1` (cards), `-2` (raised), `-sunken` (wells, inputs) |
| Hairlines | `--hym-hairline`, `--hym-hairline-strong` |
| Elevation | `--hym-elev-0..3`, `--hym-elev-nav`. Light gets a ring plus a two-layer soft shadow, for real depth on a neutral grey canvas. Dark separates by surface step plus a hairline. |
| Bars | `--hym-bar-bg` (translucent), `--hym-bar-bg-opaque`, `--hym-bar-blur` |
| Shape | `--hym-radius-control` 12, `-card` 16, `-sheet` 24 (v1 `--hym-radius-*` kept) |
| Control heights | `--hym-control-h-sm/md/lg` = 36/44/52 |
| Spacing | `--hym-space-page/section/stack/inline` on top of the v1 4px scale |
| Type | `--hym-fs-caption` 12, `small` 13, `body` 15, `input` 16, `lead` 16, `h3` 17, `h2` 20, `h1` 24, `display` 30 |
| Line height and weight | `--hym-lh-tight/ui/body` (1.4/1.5/1.8); `--hym-fw-*` |

With a fine pointer at ≥1024px, `--hym-fs-body` and `--hym-fs-input` become 14.5px for a denser desktop.

### Legacy aliases (re-pointed, names unchanged)

| Legacy alias | Now resolves to |
|---|---|
| `--brand` | `--hym-accent` |
| `--brand-deep` | `--hym-accent-hover` |
| `--brand-soft` | `--hym-accent-subtle` |
| `--brand-ink` | `--hym-accent` |
| `--on-brand` | `--hym-accent-on` |
| `--cyan`, `--cyan-ink` | `--hym-role-ai-vivid` |
| `--cyan-deep` | `--hym-role-ai-vivid-hover` |
| `--cyan-soft` | `--hym-role-ai-subtle` |

Two more changes in this layer:
- `[data-section]` re-declares the `--brand*` aliases, so a v1 screen inside a section re-themes too.
- The v1 `--hym-accent-hover` and `--hym-accent-subtle` (cyan) collided with the v2 accent names. They were removed, and their only consumers were the cyan aliases above.
- `--hym-accent-default`, `-active` and `-muted` are still the v1 cyan semantics. Treat them as deprecated and use `--hym-role-ai-*`.

## 2. Deliberate visual changes (step 4)

| Change | Before | After |
|---|---|---|
| Light `--hym-text-muted` | #64748B (4.3:1 on inset) | #56657A (5.7:1 page, 5.4:1 inset) |
| Dark `--hym-text-muted` | #64748B (3.75:1) | #94A3B8 (7.5:1 page, 5.7:1 raised) |
| Dark `--hym-text-secondary` | #94A3B8 | #CBD5E1 (12:1), so secondary stays above muted |
| `theme-color` | One meta | Light/dark pair with `media`. The `index.html` pre-paint script and `theme.tsx` set both to the page colour on a manual toggle. |
| Input font size | 13–15px on touch | `:where(input,textarea,select){font-size:var(--hym-fs-input)}`, plus the search, ai-chat textarea, reader embedded-AI and text-layer search. The style guide measures 16px minimum on touch. |
| Persian text | Letter-spacing and uppercase | Removed from `.eyebrow` (ui.css and base.css) and `.appbar__sub` |

## 3. Component API (`components.css`)

Every component reads `--hym-accent-*`, so wrapping a screen in `data-section` re-themes it. None of them use a hex value, rgba, a physical property or `!important`.

**Button: `.ds-btn`**
- Modifiers: `--secondary`, `--ghost`, `--danger`, `--sm`/`--lg`, `--block`, `--icon`.
- Disabled (`:disabled` or `aria-disabled="true"`) is a sunken well with disabled ink, a dashed hairline and no shadow, so it looks visibly different from enabled.
- Loading: `aria-busy="true"` plus `<span class="ds-btn__spin">`.
- React: `<DsButton variant size block loading>`.

**Chip: `.ds-chip`**
- Selected state: `aria-pressed="true"` or `aria-selected="true"`.
- React: `<DsChip selected>`.

**Segmented control: `.ds-seg` > `.ds-seg__item`**
- Uses `role="tablist"`/`tab` with `aria-selected`. `--block` makes it full width.
- React: `<DsSegmented value options onChange label>`.

**Card: `.ds-card`**
- Levels: `--flat` (elev-0), default (elev-1), `--raised` (2), `--float` (3), `--sunken`, `--accent`.
- Other modifiers: `--flush`, `--interactive`. Parts: `__title`, `__sub`.

**List row: `.ds-list` > `.ds-row`**
- Parts: `__icon`, `__body`, `__title`, `__sub`, `__meta`, `__chev`. The chevron mirrors in RTL.
- `a.ds-row` and `button.ds-row` get hover and focus states.

**Field, input and search**
- Field: `.ds-field` with `__label`, `__hint`, `__error`.
- Input: `.ds-input`. Set `aria-invalid` for errors; `--ltr` is for IDs and codes.
- Search: `.ds-search` with `__icon` and `__clear`.
- React: `<DsInput label hint error ltr>`.

**Badge: `.ds-badge`**
- Tones: `--accent`, `--solid`, `--danger`, `--success`, `--warning`, `--count`.

**Empty state: `.ds-empty`**
- Parts: `__icon`, `__title`, `__body`, `__action`.

**Skeleton: `.ds-skel`**
- Shapes: `--text`, `--title`, `--row`, `--card`, `--circle`. Reduced motion is respected.

**Tab bar: `.ds-tabbar` > `.ds-tabbar__item` > `.ds-tabbar__icon`**
- Opaque by default, which fixes audit G3.
- `--blur` uses real blur with an `@supports` fallback to opaque. `--static` is for embedding.
- Safe area: bottom padding is `max(space, env(safe-area-inset-bottom))`, plus left/right insets.
- Active (`aria-current="page"`): accent text, filled pill behind the icon, no underline bar.

## 4. Migration rules for Wave 3/4

1. **Never add a hex value, `rgba()`, `!important`, `style={{…}}` or a physical `left`/`right`/`margin-left` outside `tokens.css`.** The ratchet fails the build step if any count rises.
2. **Colour:**

   | Instead of | Use |
   |---|---|
   | Raw blue | `var(--hym-accent)` |
   | `#00F2FE` | `var(--hym-neon-400)`, later `--hym-role-ai-*` |
   | Text on an accent fill | `var(--hym-accent-on)` |
   | Coloured text on a card | `var(--hym-accent-text)`, never the solid |
   | Tinted background | `var(--hym-accent-subtle)` + `border: 1px solid var(--hym-accent-border)` |
   | Feedback colours | `--hym-role-danger-*`, `--hym-role-grades-*` (success), `--hym-role-schedule-*` (warning) |

3. **Section colour:** put `data-section="…"` on the screen root (`<main>` or the page wrapper), not on each component. The mapping is library/books/media → `resources`, exam/qbank → `qbank`, schedule → `schedule`, ai-chat and reader assistant → `ai`, grades → `grades`, subscription → `money`, notes → `notes`.
4. **Surfaces:** use `--hym-surface-0/1/2/sunken`, `--hym-hairline` and `--hym-elev-*`. Don't hand-roll `box-shadow`.
5. **Type:** use `--hym-fs-*` and `--hym-lh-*`.
   - Inputs always use `--hym-fs-input`. Never set a smaller size on an input, textarea or select.
   - No letter-spacing and no `text-transform` on Persian text. Monospace or Latin codes may keep tracking.
   - Persian copy is 12px minimum; body line-height is at least 1.6.
6. **Inline styles:** move them to classes. Keep truly dynamic values as custom properties, for example `style={{'--p': pct}}` plus `width: calc(var(--p) * 1%)`. That still counts as one inline style, so remove it where possible.
7. **Logical properties:** use `margin-inline-start`, `padding-inline`, `inset-inline-end`, `text-align: start` and `border-block-start`.
8. **Dark mode:** don't add new `html[data-theme="dark"] .x` patches. If a colour must differ between themes, it belongs in layer 2.
9. **Migrating a v1 component:** prefer swapping `.btn`/`.chip`/`.card` for the `.ds-*` equivalent screen by screen, and diff each screen (§6). v1 classes are untouched and will be deleted once their counts reach zero.
10. **Check new pairs** in `ds-preview.html` in both themes. A red ratio pill means a fail.

## 5. Ratchet

```
npm run ds:ratchet               # compare with ratchet.json; exit 1 if any count rises
npm run ds:ratchet -- --files    # top offending files per rule
npm run ds:ratchet -- --update   # rewrite ratchet.json after you LOWER counts; commit it
```

Rules: hex, `rgba(`/`rgb(`, `!important`, inline `style={{`, physical (`margin|padding|border-left/right`, `left:`/`right:`, `text-align`/`float` left/right). It scans `src/**/*.{css,ts,tsx,js,jsx}` except `design/tokens.css`, with comments stripped.

Baseline: hex 348, rgba 418, !important 313, inline 314, physical 85. It was unchanged after this wave because `components.css` adds 0.

## 6. Visual QA

To capture screens:
1. Build to a dist directory.
2. Run `DIST_DIR=<dist> OUT_DIR=<dir> PORT_AUDIT=<port> node tmp/audit/shoot-student-dsv2.mjs webkit <pages> <devices> dark,light`.
3. Run `python -I tmp/audit/ds-v2/imgdiff.py <a> <b> [diffDir]`.

Baseline noise was measured by shooting the same dist twice: 0.000%.

| Step | Result |
|---|---|
| 2 + 3 (tokens, alias re-point) | 0.000% on all 20 shots (home, library, schedule, exam-home, me × iphone-15, mac-1440 × both themes) |
| 4 (semantic fixes) | 0.1–1.8% per shot. Magenta-masked diffs show text-colour changes only: muted/secondary text, plus eyebrow/appbar-sub tracking. Layout is unchanged. |
| 5 + 6 (components, preview) | 0.000% against step 4 |

To shoot the style guide: `node tmp/audit/ds-v2/tools/shoot-ds-preview.mjs apps/student <out>`. It writes PNGs plus `ds-preview-report.json` with ratio fails, minimum input font size, overflow and JS errors.
