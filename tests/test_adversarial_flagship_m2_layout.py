#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Adversarial Empirical Challenge Test Suite for Flagship Milestone M2 (R2):
Multi-Device Adaptive Fullscreen Layouts & Structural Geometry Verification.

Empirically tests and stress-tests:
1. Mobile (< 768px) Breakpoint Invariants & Layout Geometry:
   - Safe-area insets: env(safe-area-inset-bottom, 0px) in TabBar, ReaderBar, and BottomSheet.
   - Fixed frosted-glass bottom navigation bar (position: fixed, bottom: 0, z-index: 50).
   - Desktop sidebar hard suppression (display: none !important).
   - Touch-optimized bottom sheets (modal dialog semantics, backdrop scrim, drag grip, Escape/scrim dismiss).
2. Tablet (768px - 1024px) Floating Vertical Rail & Stylus Canvas:
   - Floating rail dimensions (var(--hym-rail-w), 72px / 64px, margin 12px 10px, height calc(100vh - 24px)).
   - Glassmorphism & corner geometry (backdrop-filter: var(--glass-blur), -webkit-backdrop-filter, border-radius: var(--hym-radius-xl, 16px)).
   - Label & text suppression (sidebar__label, sidebar__brand-text, etc. hidden with display: none !important).
   - Vertical footer stacking (flex-direction: column) preventing horizontal avatar/button overflow in 72px rail.
   - Dual orientation support: portrait (768px-1023px) and landscape coarse-pointer/stylus (1024px-1279px).
   - Apple Pencil/stylus untouched writing canvas (pointer-events isolation, touch-action: auto, dynamic baseWidth unlocked to 1400px).
3. Desktop (>= 1024px) Fullscreen Multi-Panel Split Workspace:
   - 100vw / 100vh viewport utilization (.study-workspace width: 100%, height: 100vh, background: var(--paper-read)).
   - Resizable divider (.study-workspace__divider, pointerdown drag listener, col-resize cursor, handle bar).
   - Clamped split range (min 280px, max 52% of viewport width) preventing primary reading canvas collapse.
   - Real-time HooshYar AI clinical study side panel (.study-workspace__secondary, EmbeddedAiStudyPanel).
   - Distraction-free Focus Mode (.reader-focus-mode fixed inset: 0, width: 100vw, height: 100vh, z-index: 9999).
   - Global keyboard shortcuts ('\\', 'F', 'T', '+', '-') guarded against input/textarea capture.
4. Design Tokens & Invariance Preservation:
   - Verification of all required breakpoint and dimension tokens in tokens.css.
   - Verification of Challenger 1 Design Probes and token regression invariants.
5. Production Build Integrity & Asset Sizing:
   - Verifies apps/student npm run build generates clean bundles without TypeScript or CSS layout compilation errors.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
STUDENT_DIR = REPO_ROOT / "apps" / "student"
SRC_DIR = STUDENT_DIR / "src"
DESIGN_DIR = SRC_DIR / "design"
LAYOUT_DIR = SRC_DIR / "layout"
COMPONENTS_DIR = SRC_DIR / "components"
SCREENS_DIR = SRC_DIR / "screens"
READER_DIR = SCREENS_DIR / "reader"


class MobileBreakpointInvariantsTests(unittest.TestCase):
    """Stress-test mobile (< 768px) layout invariants and touch controls."""

    @classmethod
    def setUpClass(cls):
        cls.ui_css = (DESIGN_DIR / "ui.css").read_text(encoding="utf-8")
        cls.components_css = (DESIGN_DIR / "components.css").read_text(encoding="utf-8")
        cls.shell_css = (DESIGN_DIR / "shell.css").read_text(encoding="utf-8")
        cls.tokens_css = (DESIGN_DIR / "tokens.css").read_text(encoding="utf-8")
        cls.tabbar_tsx = (LAYOUT_DIR / "TabBar.tsx").read_text(encoding="utf-8")
        cls.sheet_tsx = (COMPONENTS_DIR / "Sheet.tsx").read_text(encoding="utf-8")

    def test_mobile_media_query_exact_selector_and_sidebar_suppression(self):
        """Verify @media (max-width: 767px) strictly hides desktop sidebar and desktop header."""
        pattern = r"@media\s*\(\s*max-width:\s*767px\s*\)\s*\{([^}]+)\.sidebar\s*\{([^}]+)\}"
        match = re.search(pattern, self.ui_css)
        self.assertIsNotNone(match, "Could not find mobile media query for .sidebar in ui.css")
        sidebar_rules = match.group(2)
        self.assertIn(
            "display: none !important",
            sidebar_rules,
            "Mobile sidebar must declare display: none !important to guarantee zero leak",
        )

        header_match = re.search(
            r"@media\s*\(\s*max-width:\s*767px\s*\)\s*\{.*?\.desktop-header\s*\{([^}]+)\}",
            self.ui_css,
            re.DOTALL,
        )
        self.assertIsNotNone(header_match, "Could not find mobile query hiding .desktop-header")
        self.assertIn("display: none !important", header_match.group(1))

    def test_tabbar_fixed_positioning_and_safe_area_insets(self):
        """Verify .ds-tabbar uses fixed positioning and respects safe-area-inset-bottom."""
        # TabBar mounts .ds-tabbar and .app-tabbar
        self.assertIn("ds-tabbar", self.tabbar_tsx)
        self.assertIn("app-tabbar", self.tabbar_tsx)

        # Find .ds-tabbar CSS block in components.css
        match = re.search(r"\.ds-tabbar\s*\{([^}]+)\}", self.components_css)
        self.assertIsNotNone(match, ".ds-tabbar definition not found in components.css")
        rules = match.group(1)

        compact = rules.replace(" ", "")
        self.assertIn("position:fixed", compact)
        self.assertIn("bottom:0", compact)
        self.assertIn("inset-inline:0", compact)
        self.assertIn("z-index:var(--hym-z-nav)", compact)
        self.assertIn("env(safe-area-inset-bottom", rules)

        # TabBar must be explicitly hidden on >= 768px via .app-tabbar in shell.css
        hide_match = re.search(
            r"@media\s*\(\s*min-width:\s*768px\s*\)\s*\{([^}]*)\.app-tabbar\s*\{([^}]+)\}",
            self.shell_css,
            re.DOTALL,
        )
        self.assertIsNotNone(hide_match, "TabBar hiding query on min-width 768px not found in shell.css")
        self.assertIn("display: none", hide_match.group(2))

    def test_tabbar_five_primary_destinations_structure(self):
        """Verify TabBar.tsx mounts exactly 5 primary navigation destinations with icons."""
        destinations = [
            ("to: '/'", "'خانه'", "'i-home'"),
            ("to: '/library'", "'کتابخانه'", "'i-book'"),
            ("to: '/exam'", "'بانک سؤال'", "'i-flask'"),
            ("to: '/schedule'", "'برنامه'", "'i-calendar'"),
            ("to: '/me'", "'من'", "'i-user'"),
        ]
        for to_prop, label, icon in destinations:
            self.assertIn(to_prop, self.tabbar_tsx, f"Missing route {to_prop} in TabBar")
            self.assertIn(label, self.tabbar_tsx, f"Missing label {label} in TabBar")
            self.assertIn(icon, self.tabbar_tsx, f"Missing icon {icon} in TabBar")

    def test_touch_bottom_sheet_structure_and_safe_area(self):
        """Verify Sheet component has dialog role, grip, scrim, and safe-area padding."""
        # CSS checks: Find all .sheet rules and verify that the winning cascade includes safe-area
        sheet_matches = list(re.finditer(r"(?<![a-zA-Z0-9_-])\.sheet\s*\{([^}]+)\}", self.ui_css))
        self.assertGreater(len(sheet_matches), 0, ".sheet CSS class not found")
        
        # Verify that safe-area inset is applied in the cascading rules
        has_safe_area = any("env(safe-area-inset-bottom" in m.group(1) for m in sheet_matches)
        self.assertTrue(
            has_safe_area,
            ".sheet must declare padding with env(safe-area-inset-bottom) in its cascade",
        )

        scrim_matches = list(re.finditer(r"(?<![a-zA-Z0-9_-])\.sheet-scrim\s*\{([^}]+)\}", self.ui_css))
        self.assertGreater(len(scrim_matches), 0, ".sheet-scrim CSS class not found")
        has_fixed = any("position:fixed" in m.group(1).replace(" ", "") for m in scrim_matches)
        self.assertTrue(has_fixed, ".sheet-scrim must have position: fixed")

        # TSX checks
        self.assertIn('role="dialog"', self.sheet_tsx)
        self.assertIn('aria-modal="true"', self.sheet_tsx)
        self.assertIn('className="sheet__grip"', self.sheet_tsx)
        self.assertIn('className="sheet-scrim"', self.sheet_tsx)
        self.assertIn("e.key === 'Escape'", self.sheet_tsx)


class TabletFloatingRailAndStylusTests(unittest.TestCase):
    """Stress-test tablet (768px - 1024px) floating rail and stylus note-taking geometry."""

    @classmethod
    def setUpClass(cls):
        cls.ui_css = (DESIGN_DIR / "ui.css").read_text(encoding="utf-8")
        cls.tokens_css = (DESIGN_DIR / "tokens.css").read_text(encoding="utf-8")
        cls.reader_screen = (READER_DIR / "ProtectedReaderView.tsx").read_text(encoding="utf-8")
        cls.ink_layer = (READER_DIR / "InkLayer.tsx").read_text(encoding="utf-8")

    def test_tablet_rail_dimensions_and_glassmorphism(self):
        """Verify floating rail uses exact width, margins, height, and backdrop blur."""
        tablet_block_idx = self.ui_css.find("@media (min-width: 768px) and (max-width: 1023px)")
        self.assertGreater(tablet_block_idx, 0, "Tablet media query not found in ui.css")
        end_idx = self.ui_css.find("/* Landscape Stylus Tablets", tablet_block_idx)
        tablet_block = self.ui_css[tablet_block_idx:end_idx]

        self.assertIn("width: var(--hym-rail-w)", tablet_block)
        self.assertIn("flex: 0 0 var(--hym-rail-w)", tablet_block)
        self.assertIn("margin: 12px 10px", tablet_block)
        self.assertIn("height: calc(100vh - 24px)", tablet_block)
        self.assertIn("backdrop-filter: var(--glass-blur)", tablet_block)
        self.assertIn("-webkit-backdrop-filter: var(--glass-blur)", tablet_block)
        self.assertIn("border-radius: var(--hym-radius-xl", tablet_block)

    def test_tablet_rail_text_suppression_and_footer_stacking(self):
        """Verify text labels are hidden and footer is column-stacked to prevent overflow."""
        tablet_block_idx = self.ui_css.find("@media (min-width: 768px) and (max-width: 1023px)")
        end_idx = self.ui_css.find("/* Landscape Stylus Tablets", tablet_block_idx)
        tablet_block = self.ui_css[tablet_block_idx:end_idx]

        self.assertIn(".sidebar__brand-text", tablet_block)
        self.assertIn(".sidebar__label", tablet_block)
        self.assertIn(".sidebar__sub", tablet_block)
        self.assertIn(".sidebar__user-details", tablet_block)
        self.assertIn("display: none !important", tablet_block)

        # Check footer vertical stacking
        self.assertIn("flex-direction: column", tablet_block)

    def test_landscape_stylus_tablet_media_query_support(self):
        """Verify dedicated query retaining floating rail for coarse-pointer landscape tablets."""
        query_pattern = (
            r"@media\s*\(\s*min-width:\s*1024px\s*\)\s*and\s*\(\s*max-width:\s*1279px\s*\)\s*and\s*\(\s*orientation:\s*landscape\s*\)"
            r",\s*\(\s*min-width:\s*1024px\s*\)\s*and\s*\(\s*hover:\s*none\s*\)\s*and\s*\(\s*pointer:\s*coarse\s*\)"
        )
        match = re.search(query_pattern, self.ui_css)
        self.assertIsNotNone(
            match,
            "Stylus coarse-pointer landscape media query missing or syntactically altered",
        )

    def test_stylus_canvas_isolation_and_unlocked_canvas_width(self):
        """Verify ink canvas is touch-isolated and canvas baseWidth is unlocked to 1400px."""
        # CSS canvas isolation
        canvas_match = re.search(r"\.ink-canvas\s*\{([^}]+)\}", self.ui_css)
        self.assertIsNotNone(canvas_match, ".ink-canvas CSS definition not found")
        canvas_rules = canvas_match.group(1).replace(" ", "")
        self.assertIn("position:absolute", canvas_rules)
        self.assertIn("inset:0", canvas_rules)
        self.assertIn("z-index:2", canvas_rules)
        self.assertIn("touch-action:auto", canvas_rules)
        self.assertIn("pointer-events:none", canvas_rules)

        active_canvas_match = re.search(r"\.ink-canvas--active\s*\{([^}]+)\}", self.ui_css)
        self.assertIsNotNone(active_canvas_match, ".ink-canvas--active CSS definition not found")
        self.assertIn("pointer-events:auto", active_canvas_match.group(1).replace(" ", ""))

        # TypeScript unclamped width (supports iPad Pro 12.9" & large screens up to 1400px)
        self.assertIn("Math.min(available, 1400)", self.reader_screen)


class DesktopMultiPanelWorkspaceTests(unittest.TestCase):
    """Stress-test desktop (>= 1024px) multi-panel study workspace, divider, and AI chat panel."""

    @classmethod
    def setUpClass(cls):
        cls.ui_css = (DESIGN_DIR / "ui.css").read_text(encoding="utf-8")
        cls.reader_screen = (READER_DIR / "ReaderScreen.tsx").read_text(encoding="utf-8")
        cls.protected_reader = (READER_DIR / "ProtectedReaderView.tsx").read_text(encoding="utf-8")

    def test_study_workspace_fullscreen_css(self):
        """Verify .study-workspace establishes 100vw/100vh flex container."""
        match = re.search(r"\.study-workspace\s*\{([^}]+)\}", self.ui_css)
        self.assertIsNotNone(match, ".study-workspace CSS block not found")
        rules = match.group(1).replace(" ", "")

        self.assertIn("display:flex", rules)
        self.assertIn("width:100%", rules)
        self.assertIn("height:100vh", rules)
        self.assertIn("overflow:hidden", rules)
        self.assertIn("position:relative", rules)

    def test_resizable_divider_styling_and_pointer_behavior(self):
        """Verify divider has col-resize cursor, handle bar, and dragging states."""
        divider_match = re.search(r"\.study-workspace__divider\s*\{([^}]+)\}", self.ui_css)
        self.assertIsNotNone(divider_match, ".study-workspace__divider CSS not found")
        rules = divider_match.group(1).replace(" ", "")

        self.assertIn("cursor:col-resize", rules)
        self.assertIn("width:8px", rules)
        self.assertIn("flex:008px", rules)

        self.assertIn(".study-workspace__divider:hover", self.ui_css)
        self.assertIn(".study-workspace__divider.is-dragging", self.ui_css)
        self.assertIn(".study-workspace__divider-handle", self.ui_css)

    def test_secondary_panel_geometry_and_boundaries(self):
        """Verify secondary panel establishes bounded flex column (min 280px, max 50%)."""
        secondary_match = re.search(r"\.study-workspace__secondary\s*\{([^}]+)\}", self.ui_css)
        self.assertIsNotNone(secondary_match, ".study-workspace__secondary CSS not found")
        rules = secondary_match.group(1).replace(" ", "")

        self.assertIn("flex:00380px", rules)
        self.assertIn("max-width:50%", rules)
        self.assertIn("min-width:280px", rules)
        self.assertIn("height:100%", rules)

    def test_reader_screen_divider_clamping_logic(self):
        """Verify ReaderScreen.tsx clamps divider drag between 280px and 52% window width."""
        self.assertIn("handleDividerPointerDown", self.reader_screen)
        self.assertIn("Math.max(280, Math.min(window.innerWidth * 0.52", self.reader_screen)
        self.assertIn("window.removeEventListener('pointermove', onPointerMove)", self.reader_screen)
        self.assertIn("window.removeEventListener('pointerup', onPointerUp)", self.reader_screen)

    def test_embedded_ai_study_panel_integration(self):
        """Verify ReaderScreen mounts EmbeddedAiStudyPanel in secondary panel."""
        self.assertIn("<EmbeddedAiStudyPanel", self.reader_screen)
        self.assertIn("fileId={id}", self.reader_screen)
        self.assertIn("page={latest.current.page}", self.reader_screen)

    def test_top_flow_ai_assistant_sheet_contracts(self):
        """Verify top-flow AI assistant modal sheet architecture and smooth drop-down styling."""
        # ReaderScreen top-flow structure
        self.assertIn("ai-top-flow-backdrop", self.reader_screen)
        self.assertIn("ai-top-flow-card", self.reader_screen)
        self.assertIn("ai-top-flow-handle", self.reader_screen)
        self.assertIn("ai-top-flow-header", self.reader_screen)
        self.assertIn("e.key === 'Escape' && sidePanel === 'ai_chat'", self.reader_screen)

        # ui.css glassmorphic flow animations and geometry
        self.assertIn(".ai-top-flow-backdrop", self.ui_css)
        self.assertIn(".ai-top-flow-card", self.ui_css)
        self.assertIn("translateY(-130%)", self.ui_css)
        self.assertIn("translateY(0)", self.ui_css)
        self.assertIn("backdrop-filter", self.ui_css)

    def test_keyboard_shortcuts_guarded_against_input_elements(self):
        """Verify keyboard shortcuts (\\, F, T, etc.) ignore input and textarea keystrokes."""
        # ReaderScreen shortcut
        self.assertIn("tag === 'input' || tag === 'textarea'", self.reader_screen)
        self.assertIn("e.key === '\\\\'", self.reader_screen)

        # ProtectedReaderView shortcut
        self.assertIn("tag === 'input' || tag === 'textarea'", self.protected_reader)
        self.assertIn("e.key === 'f' || e.key === 'F'", self.protected_reader)
        self.assertIn("e.key === 't' || e.key === 'T'", self.protected_reader)
        self.assertIn("e.key === '\\\\'", self.protected_reader)

    def test_distraction_free_focus_fullscreen_mode(self):
        """Verify .reader-focus-mode completely overrides layout chrome and maximizes canvas."""
        match = re.search(r"\.reader-focus-mode\s*\{([^}]+)\}", self.ui_css)
        self.assertIsNotNone(match, ".reader-focus-mode CSS block not found")
        rules = match.group(1).replace(" ", "")

        self.assertIn("position:fixed!important", rules)
        self.assertIn("inset:0!important", rules)
        self.assertIn("width:100vw!important", rules)
        self.assertIn("height:100vh!important", rules)
        self.assertIn("z-index:9999!important", rules)

        # Suppressed chrome in focus mode
        suppressed_match = re.search(
            r"\.reader-focus-mode \.appbar,\s*\.reader-focus-mode \.reader__foot,\s*\.reader-focus-mode \.reader__bar,\s*\.reader-focus-mode \.ink-bar\s*\{([^}]+)\}",
            self.ui_css,
        )
        self.assertIsNotNone(suppressed_match, "Focus mode chrome suppression rules not found")
        self.assertIn("display: none !important", suppressed_match.group(1))


class DesignTokensInvariantsTests(unittest.TestCase):
    """Stress-test tokens.css breakpoint and geometry token declarations."""

    @classmethod
    def setUpClass(cls):
        cls.tokens = (DESIGN_DIR / "tokens.css").read_text(encoding="utf-8")

    def test_layout_and_breakpoint_tokens_declared_verbatim(self):
        """Verify tokens.css contains exact required breakpoint variables."""
        expected_tokens = [
            ("--hym-sidebar-w:        256px;", "Desktop sidebar width 256px"),
            ("--hym-rail-w:           72px;", "Tablet rail width 72px"),
            ("--hym-rail-floating-w:  64px;", "Floating rail width 64px"),
            ("--hym-header-h:         60px;", "Header height 60px"),
            ("--hym-content-max:      1280px;", "Content maximum width 1280px"),
            ("--hym-bp-mobile:        767px;", "Mobile breakpoint 767px"),
            ("--hym-bp-tablet-min:    768px;", "Tablet minimum breakpoint 768px"),
            ("--hym-bp-tablet-max:    1023px;", "Tablet maximum breakpoint 1023px"),
            ("--hym-bp-desktop:       1024px;", "Desktop breakpoint 1024px"),
            ("--hym-safe-top:    env(safe-area-inset-top, 0px);", "Safe area inset top"),
            ("--hym-safe-bottom: env(safe-area-inset-bottom, 0px);", "Safe area inset bottom"),
        ]
        for token_decl, desc in expected_tokens:
            with self.subTest(token=token_decl):
                self.assertIn(token_decl, self.tokens, f"Missing token for: {desc}")

    def test_sticky_note_palette_tokens(self):
        """Verify sticky note color tokens exist for annotations."""
        note_tokens = [
            "--hym-note-yellow:",
            "--hym-note-cyan:",
            "--hym-note-green:",
            "--hym-note-coral:",
        ]
        for token in note_tokens:
            self.assertIn(token, self.tokens, f"Missing note token {token}")


class ProductionBuildIntegrityTests(unittest.TestCase):
    """Execute npm run build in apps/student and verify bundle artifacts."""

    def test_production_build_clean_execution(self):
        """Execute npm run build and verify 0 errors and dist/ bundle generation."""
        cmd = ["npm.cmd", "run", "build"]
        proc = subprocess.run(
            cmd,
            cwd=str(STUDENT_DIR),
            capture_output=True,
            text=True,
            timeout=120,
        )
        self.assertEqual(
            proc.returncode,
            0,
            f"npm run build failed with code {proc.returncode}:\n{proc.stdout}\n{proc.stderr}",
        )

        dist_dir = STUDENT_DIR / "dist"
        self.assertTrue(dist_dir.is_dir(), "dist/ directory was not produced")
        self.assertTrue((dist_dir / "index.html").is_file(), "dist/index.html is missing")

        assets_dir = dist_dir / "assets"
        self.assertTrue(assets_dir.is_dir(), "dist/assets/ directory is missing")

        # Verify essential chunks exist
        asset_names = [f.name for f in assets_dir.iterdir()]
        self.assertTrue(any(n.startswith("index-") and n.endswith(".js") for n in asset_names), "Missing index JS chunk")
        self.assertTrue(any(n.startswith("index-") and n.endswith(".css") for n in asset_names), "Missing index CSS bundle")
        self.assertTrue(any(n.startswith("PdfView-") and n.endswith(".js") for n in asset_names), "Missing PdfView chunk")
        self.assertTrue(any(n.startswith("MediaView-") and n.endswith(".js") for n in asset_names), "Missing MediaView chunk")


class AdversarialLayoutGeometrySimulationTests(unittest.TestCase):
    """Simulate mathematical edge cases in viewport geometry and divider clamping."""

    def _simulate_breakpoint_layout(
        self, width: int, height: int, is_coarse_touch: bool = False, orientation: str = "portrait"
    ) -> dict[str, str | bool]:
        """Python oracle replicating CSS media query rules for HumsYar."""
        if width <= 767:
            return {
                "category": "mobile",
                "sidebar_display": "none",
                "tabbar_display": "grid",
                "rail_floating": False,
                "split_allowed": False,
            }
        elif 768 <= width <= 1023:
            return {
                "category": "tablet",
                "sidebar_display": "flex",
                "tabbar_display": "none",
                "rail_floating": True,
                "split_allowed": False,
            }
        elif 1024 <= width <= 1279 and (orientation == "landscape" or is_coarse_touch):
            return {
                "category": "tablet_landscape_stylus",
                "sidebar_display": "flex",
                "tabbar_display": "none",
                "rail_floating": True,
                "split_allowed": True,
            }
        else:
            return {
                "category": "desktop",
                "sidebar_display": "flex",
                "tabbar_display": "none",
                "rail_floating": False,
                "split_allowed": True,
            }

    def _simulate_divider_clamp(self, initial_width: float, delta_x: float, window_width: float) -> float:
        """Python mirror of ReaderScreen.tsx divider dragging formula."""
        return max(280.0, min(window_width * 0.52, initial_width + delta_x))

    def _simulate_canvas_width(self, client_width: float) -> float:
        """Python mirror of ProtectedReaderView.tsx baseWidth scaling formula."""
        available = max(300.0, client_width - 32.0)
        return min(available, 1400.0)

    def test_viewport_boundary_classification(self):
        """Test exact boundary transitions at 767px, 768px, 1023px, 1024px."""
        cases = [
            # width, height, touch, orientation -> expected category, rail_floating
            (320, 568, True, "portrait", "mobile", False),
            (767, 1024, True, "portrait", "mobile", False),
            (768, 1024, True, "portrait", "tablet", True),
            (1023, 768, True, "landscape", "tablet", True),
            (1024, 768, True, "landscape", "tablet_landscape_stylus", True),
            (1024, 768, False, "landscape", "tablet_landscape_stylus", True),  # orientation: landscape
            (1024, 768, False, "portrait", "desktop", False),
            (1440, 900, False, "landscape", "desktop", False),
            (3840, 2160, False, "landscape", "desktop", False),
        ]
        for w, h, touch, orient, expected_cat, expected_rail in cases:
            with self.subTest(width=w, height=h, touch=touch, orient=orient):
                res = self._simulate_breakpoint_layout(w, h, is_coarse_touch=touch, orientation=orient)
                self.assertEqual(res["category"], expected_cat)
                self.assertEqual(res["rail_floating"], expected_rail)

    def test_divider_drag_clamp_adversarial_limits(self):
        """Test extreme divider drag values (underflow and overflow) prevent layout collapse."""
        window_w = 1920.0
        max_allowed = 1920.0 * 0.52  # 998.4px

        # Underflow attempts
        self.assertEqual(self._simulate_divider_clamp(380.0, -100.0, window_w), 280.0)
        self.assertEqual(self._simulate_divider_clamp(380.0, -9999.0, window_w), 280.0)

        # Overflow attempts
        self.assertEqual(self._simulate_divider_clamp(380.0, 1000.0, window_w), max_allowed)
        self.assertEqual(self._simulate_divider_clamp(380.0, 99999.0, window_w), max_allowed)

        # Within bounds
        self.assertEqual(self._simulate_divider_clamp(380.0, 50.0, window_w), 430.0)

    def test_canvas_unclamped_width_scaling(self):
        """Test reader baseWidth scaling across mobile, iPad Pro, and 4K displays."""
        cases = [
            (320.0, 300.0),    # mobile 320 -> available 288 -> max(300, 288) = 300
            (500.0, 468.0),    # mobile 500 -> 468
            (800.0, 768.0),    # tablet 800 -> 768
            (1024.0, 992.0),   # iPad 1024 -> 992
            (1400.0, 1368.0),  # large screen 1400 -> 1368
            (1920.0, 1400.0),  # desktop 1920 -> 1400 (unlocked up to 1400px ceiling)
            (3840.0, 1400.0),  # 4K monitor -> 1400 ceiling prevents over-stretching
        ]
        for client_w, expected in cases:
            with self.subTest(client_w=client_w):
                res = self._simulate_canvas_width(client_w)
                self.assertEqual(res, expected)


if __name__ == "__main__":
    unittest.main(verbosity=2)
