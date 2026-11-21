# TEST_INFRA.md — Systematic 4-Tier E2E Test Infrastructure Specification
**HumsYarX Modern Floating Navigation Island & Tablet-Class PDF Stylus Overhaul**

---

## 1. Executive Summary & Testing Philosophy

This document defines the formal verification architecture and test engineering standards for the HumsYarX student platform overhaul, specifically covering:
- **Requirement R1**: Floating Frosted-Glass Top Navigation Bar (`M1`)
- **Requirement R2**: Advanced Tablet-Class PDF Reader & Stylus Toolbox (`M2`, `M3`)
- **Requirement R3**: Project Stability and CI Test Passing (`M4`)

The testing framework follows a **Requirement-Driven, Multi-Tier Systematic Strategy**. Every test in the suite verifies observable behavior, visual and structural layout invariants, interface contracts, mathematical ink/zoom dynamics, and data mutations rather than volatile internal implementation details.

### 1.1 Integrity Principles
1. **Zero Synthetic Passes**: No dummy test cases, no hardcoded bypasses, no silent error suppressions (`except: pass`), and no facade stubs. All tests execute real validation logic.
2. **Deterministic Output Oracles**: Expected outputs are derived directly from normative specifications in `ORIGINAL_REQUEST.md`, architectural contracts in `PROJECT.md`, standard physics/geometry formulas, and live FastAPI/Pydantic schemas.
3. **Dual Runner Discovery**: Test suites are natively compatible with both `pytest` and Python's standard `python -m unittest` runners without third-party runner dependencies.
4. **Progressive Testability**: Tests are isolated, self-contained, and structured to allow progressive verification during milestone delivery without cascading breakages.

---

## 2. The Systematic 4-Tier Test Architecture

```text
┌────────────────────────────────────────────────────────────────────────┐
│                   TIER 4: REAL-WORLD CLINICAL WORKLOADS                │
│    (Clinical Case Study, Histopathology Zoom, Guideline Highlighting,  │
│     Fountain Pen Differential Diagnosis, Margin Pearl Sticky Notes)    │
├────────────────────────────────────────────────────────────────────────┤
│                 TIER 3: CROSS-FEATURE INTERACTION PAIRS                │
│   (Focus Mode + Sticky Notes, Lasso + Dual Eraser, Shape Snap + Undo,  │
│    Highlighter + Dark Mode Inversion, Floating Island + Theme Switch)  │
├────────────────────────────────────────────────────────────────────────┤
│                 TIER 2: BOUNDARY & CORNER CASE HARDENING               │
│   (0.6x/3.0x Zoom Clamping, Extreme Coordinates, Rapid Multi-Touch,    │
│    Empty Strokes, 2000-Char Note Limits, 767px/768px Breakpoint Cut)   │
├────────────────────────────────────────────────────────────────────────┤
│                 TIER 1: CORE FEATURE FUNCTIONAL COVERAGE               │
│   (>= 5 Independent Happy-Path Tests Per Feature across R1 & R2)       │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Tier 1: Category-Partition & Feature Coverage
Each cataloged feature in R1 and R2 is partitioned into its primary functional aspects. Every feature is verified by **at least 5 independent happy-path test cases**, ensuring all core contracts, dimensions, styling parameters, and event handlers are validated.

### 2.2 Tier 2: Boundary Value Analysis (BVA) & Corner Cases
Input domains are stressed at their critical limits and boundary discontinuities:
- Zoom scale limits ($z_{min} = 0.6$, $z_{max} = 2.0 / 3.0$)
- Extreme coordinates ($x, y = 0.0, 1.0$, negative coordinates, out-of-bounds rejection)
- Text length limits (sticky notes capped at 2000 characters)
- Breakpoint boundary edges ($767\text{px}$ vs $768\text{px}$, $1023\text{px}$ vs $1024\text{px}$)
- Zero-length strokes, single-point taps, rapid multi-touch bursts ($> 5$ simultaneous contacts)
- Velocity singularity guards ($\Delta t \to 0$ in velocity calculations)

### 2.3 Tier 3: Pairwise Combinatorial & Cross-Feature Interaction Matrix
Features do not operate in isolation. Tier 3 verifies pairwise combinations of distinct subsystems to catch state corruptions and UI collisions:
- **Focus Mode + Sticky Notes**: Margin notes remain functional and editable when toolbars are hidden.
- **Lasso Transform + Dual Eraser**: Selected strokes can be sliced or erased without breaking transform handles.
- **Highlighter + Dark Mode Inverted Contrast**: Highlighter pigment preserves black text legibility against inverted PDF pages.
- **Smart Shape Snapping + Undo/Redo**: Snapping strokes to geometric shapes maintains a clean 50-step undo history.
- **Floating Nav Island + Theme Toggle**: Toggling light/dark mode updates island backdrop filter and box-shadow without layout shift.
- **Thumbnail Drawer + Focus Mode**: Micro-island drawer access allows rapid page jump without breaking fullscreen state.

### 2.4 Tier 4: Real-World Medical Student Application Scenarios
End-to-end integration scenarios simulating actual medical school study marathons:
1. **Clinical Case Navigation Loop**: Opening a multi-page clinical case PDF, navigating via thumbnail drawer to target pathology page, and using island back navigation.
2. **Clinical Guideline Highlighting**: Highlighting cardiology guidelines with smart highlighters in multiply blend mode preserving diagnostic text clarity.
3. **Differential Diagnosis Note-Taking**: Taking clinical notes with calligraphic fountain pens utilizing velocity thinning and chisel nib dynamics.
4. **Margin Pearl Sticky Notes**: Dragging and pinning clinical pearl sticky notes in document margins and collapsing to compact pin icons.
5. **Histopathology Zoom & Distraction-Free Focus**: Zooming to 40x magnification on histopathology diagrams at 60fps and toggling distraction-free focus mode with ruler measurements.

---

## 3. Feature Inventory & Tier Coverage Matrix

| # | Feature Name | Tier 1 (Happy) | Tier 2 (Boundary) | Tier 3 (Pairwise) | Tier 4 (Scenario) | Test Suite File |
|---|--------------|----------------|-------------------|-------------------|-------------------|-----------------|
| **R1** | **Top Navigation Island** | | | | | `test_floating_nav_island.py` |
| F1 | Floating Frosted-Glass Island Top Bar | 5 tests | 5 tests | 2 tests | 2 scenarios | `test_floating_nav_island.py` |
| F2 | Elimination of Duplicate Headers (22 Views) | 5 tests | 5 tests | 2 tests | 2 scenarios | `test_floating_nav_island.py` |
| F3 | Responsive Multi-Viewport Adaptability | 5 tests | 5 tests | 1 test | 1 scenario | `test_floating_nav_island.py` |
| **R2** | **PDF Reader & Stylus Toolbox** | | | | | `test_tablet_pdf_reader_e2e.py` |
| F4 | 60fps GPU-Accelerated Zooming & Panning | 5 tests | 2 tests | 1 test | 1 scenario | `test_tablet_pdf_reader_e2e.py` |
| F5 | Thumbnail & Bookmark Navigation Drawer | 5 tests | 2 tests | 1 test | 1 scenario | `test_tablet_pdf_reader_e2e.py` |
| F6 | Collapsible & Draggable Margin Sticky Notes | 5 tests | 2 tests | 2 tests | 1 scenario | `test_tablet_pdf_reader_e2e.py` |
| F7 | Distraction-Free Full-Screen Focus Mode | 5 tests | 2 tests | 2 tests | 1 scenario | `test_tablet_pdf_reader_e2e.py` |
| F8 | Dual-Canvas Low-Latency 60fps/120Hz Ink Engine | 5 tests | 2 tests | 1 test | 1 scenario | `test_tablet_pdf_reader_e2e.py` |
| F9 | Ballpoint & Fountain Pen Modes | 5 tests | 2 tests | 1 test | 1 scenario | `test_tablet_pdf_reader_e2e.py` |
| F10 | Smart Highlighter with Text-Preserving Blending | 5 tests | 2 tests | 1 test | 1 scenario | `test_tablet_pdf_reader_e2e.py` |
| F11 | Dual Eraser (Whole-Stroke & Partial/Pixel) | 5 tests | 2 tests | 1 test | 1 scenario | `test_tablet_pdf_reader_e2e.py` |
| F12 | Lasso Selection & Transformation Engine | 5 tests | 2 tests | 1 test | 1 scenario | `test_tablet_pdf_reader_e2e.py` |
| F13 | Smart Shape Snapping & Digital Ruler Guide | 5 tests | 2 tests | 1 test | 1 scenario | `test_tablet_pdf_reader_e2e.py` |
| F14 | Specialized Medical Color Palette Presets | 5 tests | 1 test | 1 test | 1 scenario | `test_tablet_pdf_reader_e2e.py` |
| **R3** | **Project Stability & CI Integrity** | | | | | Existing & CI Suites |
| F15 | Zero Regression & CI Test Passing | Full CI | Boundary | Cross-suite | Build check | `run_ci.py`, Layout, Ink |

---

## 4. Test Suite Inventory

### 4.1 `humsyarx-main/tests/test_floating_nav_island.py`
Automated test suite covering Requirement R1:
- **Geometry & Tokens**: 16px border-radius, 60px height, 12px top clearance, soft elevation shadow, and subtle neon brand glow.
- **Theme Modes**: Dark mode Obsidian Navy (`rgba(15, 23, 42, 0.78)`) with Royal Blue & Neon Cyan glow; Light mode Medical White (`rgba(255, 255, 255, 0.86)`).
- **Header De-Duplication**: Global `HeaderContext` contract, `<AppBar>` metadata registration on mount and cleanup on unmount, `@media (min-width: 768px)` suppression of duplicate `.stage-content .appbar`, and verification across all 22 screens.
- **Responsive Adaptability**: Mobile suppression (`@media (max-width: 767px) { .desktop-header { display: none !important; } }`), tablet margin adaptation (`12px 14px 0 14px`), and reader mode route isolation.

### 4.2 `humsyarx-main/tests/test_tablet_pdf_reader_e2e.py`
Automated test suite covering Requirement R2:
- **Viewport Engine**: GPU transform matrix (`translate3d` + `scale`), 60fps `requestAnimationFrame` gesture loop, focal point zooming, and zoom level clamping $[0.6, 2.0]$.
- **Thumbnail Drawer**: 3-tab layout (`thumbnails`, `bookmarks`, `notes`), lazy-loading aspect ratio previews, smooth `scrollIntoView` page jumping, and `localStorage` bookmark toggling.
- **Sticky Notes**: Normalized coordinate model $[0.0, 1.0]$, margin clamping ($x < 0.12 \implies 0.03$, $x > 0.78 \implies 0.82$), 2000-char cap, compact pin state (`📌`), and batch mutation sync.
- **Focus Mode**: Fullscreen API integration, surrounding chrome suppression (`.appbar`, `.reader__foot`, `.ink-bar`), micro-island restore trigger (`.focus-restore-trigger`), and keyboard shortcut (`F`).
- **Stylus & Ink Engine**: Dual-canvas architecture (committed background + active scratchpad), palm rejection decay (750ms), ballpoint velocity invariance, fountain pen velocity thinning and chisel nib angle modulation, smart highlighter `mix-blend-mode: multiply`, dual eraser whole-stroke deletion and partial segment splitting, PNPOLY lasso selection, smart shape snapping (lines, circles, rectangles), digital ruler guide, and 5 clinical medical palette presets alongside 5 classic notes colors.

### 4.3 Regression & Existing Suites
- `test_adversarial_flagship_m2_layout.py` (21 tests)
- `test_adversarial_flagship_m2_ink.py` (24 tests)
- `test_flagship_note_taking_persistence.py` (12 tests)
- `run_ci.py` (Full repository CI suite)

---

## 5. Authoritative Expected Output Derivation & Oracles

| Dimension | Authoritative Source | Verification Technique |
|-----------|----------------------|------------------------|
| **Floating Island Dimensions** | `PROJECT.md` § 1, 2; `ORIGINAL_REQUEST.md` R1 | CSS AST & regex parsing of `.desktop-header` in `ui.css` |
| **Glow & Shadow Effects** | `explorer_survey_nav_1/handoff.md` § 4.1 | Box-shadow color channel assertions (`rgba(37,99,235,...)`, `rgba(0,242,254,...)`) |
| **Header De-Duplication** | `PROJECT.md` § 5.1; View JSX source trees | AST analysis of 22 screen components & CSS cascade rules |
| **GPU Zooming Math** | Standard affine geometry & CSS Matrix | Focal point transform formula: $O_{new} = F - (F - O_{old}) \times \frac{S_{new}}{S_{old}}$ |
| **Fountain Pen Dynamics** | Physics of fluid mechanics & chisel nibs | Calligraphy formula: $w = w_0 \times (0.4 + 1.2p) \times f_v \times (0.7 + 0.6 f_\theta)$ |
| **Lasso Point Containment** | PNPOLY algorithm (Franklin Antonio / W. Randolph Franklin) | Ray-casting Jordan curve theorem parity test on arbitrary polygons |
| **Shape Snapping** | Geometric least-squares & chord deviation | Chord deviation ratio $\frac{d_{max}}{L} < 0.08$; radial std dev $\frac{\sigma_r}{\mu_r} < 0.15$ |
| **Backend Ink Sync** | `web_ink.py` & `API_CONTRACTS.md` | Pydantic schema validation & FastAPI ASGI TestClient requests |

---

## 6. Execution Commands & Verification Guide

### 6.1 Running R1 Floating Navigation Island Suite
```powershell
# Run via pytest
pytest humsyarx-main/tests/test_floating_nav_island.py -v

# Run via python standard unittest
python -m unittest humsyarx-main/tests/test_floating_nav_island.py
```

### 6.2 Running R2 Tablet PDF Reader & Stylus E2E Suite
```powershell
# Run via pytest
pytest humsyarx-main/tests/test_tablet_pdf_reader_e2e.py -v

# Run via python standard unittest
python -m unittest humsyarx-main/tests/test_tablet_pdf_reader_e2e.py
```

### 6.3 Running Both New E2E Suites Concurrently
```powershell
pytest humsyarx-main/tests/test_floating_nav_island.py humsyarx-main/tests/test_tablet_pdf_reader_e2e.py
```

### 6.4 Running Full Flagship Regression Baseline
```powershell
pytest humsyarx-main/tests/test_adversarial_flagship_m2_layout.py humsyarx-main/tests/test_adversarial_flagship_m2_ink.py humsyarx-main/tests/test_flagship_note_taking_persistence.py
```

### 6.5 Client TypeScript Typecheck & Production Bundle Build
```powershell
npm.cmd --prefix humsyarx-main/apps/student run typecheck
npm.cmd --prefix humsyarx-main/apps/student run build
```
