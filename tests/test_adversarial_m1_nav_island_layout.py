#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Adversarial Empirical Challenge Test Suite: Milestone M1 Top Navigation Island & CSS Layout.

Author: challenger_nav_2 (Empirical Challenger Agent)
Focus: Adversarial stress testing of CSS layout, viewport boundaries, theme box-shadow layers,
       z-index stacking invariants, and desktop de-duplication rules.

Requirements Tested:
1. Viewport boundary transitions: 320px mobile, 767px mobile limit, 768px tablet transition,
   1023px tablet limit, 1024px desktop, 1920px Full HD, 3840px 4K ultrawide.
2. Theme styling invariants: Dark Mode (Obsidian Navy rgba(15, 23, 42, 0.78), border rgba(56, 189, 248, 0.22),
   multi-layer blue/cyan glow) and Light Mode (Medical White rgba(255, 255, 255, 0.86), soft aura).
3. De-duplication rules: .stage-content .appbar { display: none !important; } on desktop/tablet (>= 768px),
   preservation on mobile (< 768px), and preservation in reader mode (.app-shell--reader).
4. Z-index stacking invariants: base (0) < sticky (10) < nav (20) < sheet (30) < toast (40) < overlay (50) <= modal (60).
   Ensure nav island does not obscure modal dialogs, sheets, or overlays.
"""

from __future__ import annotations

import os
import re
import sys
import unittest
from pathlib import Path
from typing import Dict, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent
STUDENT_DIR = REPO_ROOT / "apps" / "student"
SRC_DIR = STUDENT_DIR / "src"
DESIGN_DIR = SRC_DIR / "design"
LAYOUT_DIR = SRC_DIR / "layout"
COMPONENTS_DIR = SRC_DIR / "components"
SCREENS_DIR = SRC_DIR / "screens"


class CSSRule:
    """Represents a parsed CSS rule with media query context."""
    def __init__(self, selector: str, properties: Dict[str, str], media_query: Optional[str] = None):
        self.selector = selector.strip()
        self.properties = {k.strip(): v.strip() for k, v in properties.items()}
        self.media_query = media_query.strip() if media_query else None

    def matches_viewport(self, width: float) -> bool:
        if not self.media_query:
            return True
        mq = self.media_query.replace(" ", "")
        min_w_match = re.search(r"min-width:(\d+)px", mq)
        if min_w_match and width < float(min_w_match.group(1)):
            return False
        max_w_match = re.search(r"max-width:(\d+)px", mq)
        if max_w_match and width > float(max_w_match.group(1)):
            return False
        return True


class EmpiricalCSSLayoutOracle:
    """Accurate CSS parsing and cascading engine that resolves effective properties at exact viewports."""
    def __init__(self, css_text: str):
        self.css_text = css_text
        self.rules: List[CSSRule] = []
        self._parse()

    def _parse(self):
        cleaned = re.sub(r"/\*.*?\*/", "", self.css_text, flags=re.DOTALL)
        pos = 0
        while pos < len(cleaned):
            mq_m = re.compile(r"@media\s*([^{]+)\{").search(cleaned, pos)
            if not mq_m:
                chunk = cleaned[pos:]
                self._parse_rule_chunk(chunk, None)
                break

            chunk = cleaned[pos:mq_m.start()]
            self._parse_rule_chunk(chunk, None)

            mq_cond = mq_m.group(1).strip()
            idx = mq_m.end()
            brace = 1
            while idx < len(cleaned) and brace > 0:
                if cleaned[idx] == '{':
                    brace += 1
                elif cleaned[idx] == '}':
                    brace -= 1
                idx += 1
            mq_body = cleaned[mq_m.end():idx-1]
            self._parse_rule_chunk(mq_body, mq_cond)
            pos = idx

    def _parse_rule_chunk(self, chunk: str, mq: Optional[str]):
        for m in re.finditer(r"([^{}]+)\{([^}]+)\}", chunk):
            selectors = m.group(1).split(",")
            body = m.group(2).strip()
            props = {}
            for item in body.split(";"):
                if ":" in item:
                    k, v = item.split(":", 1)
                    props[k.strip()] = v.strip()
            for sel in selectors:
                s = sel.strip()
                if s:
                    self.rules.append(CSSRule(s, props, mq))

    def resolve(self, target_selector: str, width: float) -> Dict[str, str]:
        """Resolves cascading dictionary of CSS properties for an exact selector at width,
        respecting !important overrides.
        """
        result = {}
        target = target_selector.strip()
        for rule in self.rules:
            if rule.selector == target and rule.matches_viewport(width):
                for k, v in rule.properties.items():
                    if k in result and "!important" in result[k] and "!important" not in v:
                        continue
                    result[k] = v
        return result


class MilestoneM1NavIslandAdversarialTests(unittest.TestCase):
    """Adversarial challenge test suite for Milestone M1."""

    @classmethod
    def setUpClass(cls):
        cls.ui_css = (DESIGN_DIR / "ui.css").read_text(encoding="utf-8")
        cls.components_css = (DESIGN_DIR / "components.css").read_text(encoding="utf-8")
        cls.shell_css = (DESIGN_DIR / "shell.css").read_text(encoding="utf-8")
        cls.tokens_css = (DESIGN_DIR / "tokens.css").read_text(encoding="utf-8")
        cls.desktop_header_tsx = (LAYOUT_DIR / "DesktopHeader.tsx").read_text(encoding="utf-8")
        cls.header_context_tsx = (LAYOUT_DIR / "HeaderContext.tsx").read_text(encoding="utf-8")
        cls.appbar_tsx = (COMPONENTS_DIR / "AppBar.tsx").read_text(encoding="utf-8")
        cls.shell_tsx = (LAYOUT_DIR / "Shell.tsx").read_text(encoding="utf-8")
        cls.reader_screen_tsx = (SCREENS_DIR / "reader" / "ReaderScreen.tsx").read_text(encoding="utf-8")
        cls.oracle = EmpiricalCSSLayoutOracle(cls.ui_css + "\n" + cls.components_css + "\n" + cls.shell_css)

    # =========================================================================
    # CHALLENGE AREA 1: VIEWPORT BOUNDARY TRANSITIONS (320px..3840px)
    # =========================================================================

    def test_adv_viewport_320px_mobile_minimum(self):
        """Stress Test 320px: Extreme narrow mobile (e.g. iPhone SE 1st gen).
        - Desktop header strictly hidden with display: none !important
        - Sidebar strictly hidden with display: none !important
        - TabBar visible and fixed to bottom
        - In-flow AppBar active without de-duplication suppression
        """
        w = 320.0
        # Desktop header
        header_props = self.oracle.resolve(".desktop-header", w)
        self.assertEqual("none !important", header_props.get("display"))

        # Sidebar
        sidebar_props = self.oracle.resolve(".sidebar", w)
        self.assertEqual("none !important", sidebar_props.get("display"))

        # Tabbar (.ds-tabbar + .app-tabbar)
        tabbar_props = self.oracle.resolve(".ds-tabbar", w)
        app_tabbar_props = self.oracle.resolve(".app-tabbar", w)
        self.assertIn("fixed", tabbar_props.get("position", ""))
        self.assertEqual("var(--hym-z-nav)", tabbar_props.get("z-index"))
        self.assertNotEqual("none", app_tabbar_props.get("display"))
        self.assertNotEqual("none !important", app_tabbar_props.get("display"))

        # AppBar safe-area top inset active on mobile
        appbar_props = self.oracle.resolve(".appbar", w)
        self.assertIn("env(safe-area-inset-top", appbar_props.get("padding-top", ""))

    def test_adv_viewport_767px_mobile_boundary_limit(self):
        """Stress Test 767px: Upper edge of mobile breakpoint.
        - Desktop header strictly hidden
        - Sidebar strictly hidden
        - Tabbar active
        - .stage-content .appbar must NOT be suppressed by min-width 768px rule
        """
        w = 767.0
        header_props = self.oracle.resolve(".desktop-header", w)
        self.assertEqual("none !important", header_props.get("display"))

        sidebar_props = self.oracle.resolve(".sidebar", w)
        self.assertEqual("none !important", sidebar_props.get("display"))

        app_tabbar_props = self.oracle.resolve(".app-tabbar", w)
        self.assertNotEqual("none", app_tabbar_props.get("display"))
        self.assertNotEqual("none !important", app_tabbar_props.get("display"))

        # De-duplication rule does NOT trigger at 767px
        dedup_props = self.oracle.resolve(".stage-content .appbar", w)
        self.assertNotIn("none !important", dedup_props.get("display", ""))

    def test_adv_viewport_768px_tablet_transition_threshold(self):
        """Stress Test 768px: Lower edge of tablet breakpoint.
        - Switch from mobile to tablet: Tabbar becomes display: none
        - Desktop header becomes visible and active with compact tablet margins
        - Sidebar becomes compact vertical rail (72px)
        - De-duplication strictly suppresses .stage-content .appbar
        """
        w = 768.0
        # Tabbar is hidden
        app_tabbar_props = self.oracle.resolve(".app-tabbar", w)
        self.assertEqual("none", app_tabbar_props.get("display"))

        # Desktop header is visible with tablet margins: 12px 14px 0 14px
        header_props = self.oracle.resolve(".desktop-header", w)
        self.assertNotEqual("none !important", header_props.get("display", ""))
        self.assertEqual("sticky", header_props.get("position"))
        self.assertEqual("12px", header_props.get("top"))
        self.assertEqual("12px 14px 0 14px", header_props.get("margin"))
        self.assertEqual("0 16px", header_props.get("padding"))

        # Search box adapted on tablet (flex auto with min-width: 150px)
        search_props = self.oracle.resolve(".desktop-header__search", w)
        self.assertEqual("auto", search_props.get("width"))
        self.assertEqual("150px", search_props.get("min-width"))

        # De-duplication strictly active
        dedup_props = self.oracle.resolve(".stage-content .appbar", w)
        self.assertEqual("none !important", dedup_props.get("display"))

    def test_adv_viewport_1023px_tablet_boundary_limit(self):
        """Stress Test 1023px: Upper edge of tablet breakpoint.
        - Tablet compaction persists
        - Search adapts to tablet width (auto / min-width 150px)
        - Margin remains 12px 14px 0 14px
        - De-duplication strictly suppresses .stage-content .appbar
        """
        w = 1023.0
        header_props = self.oracle.resolve(".desktop-header", w)
        self.assertEqual("12px 14px 0 14px", header_props.get("margin"))
        self.assertEqual("0 16px", header_props.get("padding"))

        search_props = self.oracle.resolve(".desktop-header__search", w)
        self.assertEqual("auto", search_props.get("width"))
        self.assertEqual("150px", search_props.get("min-width"))

        dedup_props = self.oracle.resolve(".stage-content .appbar", w)
        self.assertEqual("none !important", dedup_props.get("display"))

    def test_adv_viewport_1024px_desktop_threshold(self):
        """Stress Test 1024px: Transition to full desktop.
        - Desktop header expands to full desktop margins: 12px 24px 0 24px, padding 0 20px
        - Search box expands to 220px
        - Sidebar expands from rail (72px) to full desktop sidebar (256px)
        - De-duplication persists
        """
        w = 1024.0
        header_props = self.oracle.resolve(".desktop-header", w)
        self.assertEqual("12px 24px 0 24px", header_props.get("margin"))
        self.assertEqual("0 20px", header_props.get("padding"))

        search_props = self.oracle.resolve(".desktop-header__search", w)
        self.assertEqual("220px", search_props.get("width"))

        dedup_props = self.oracle.resolve(".stage-content .appbar", w)
        self.assertEqual("none !important", dedup_props.get("display"))

    def test_adv_viewport_1920px_full_hd_desktop(self):
        """Stress Test 1920px: Standard Full HD widescreen monitor.
        - Floating island dimensions: sticky top 12px, margin 12px 24px 0 24px
        - Stage content centered with max-width limit
        - De-duplication strictly enforced
        """
        w = 1920.0
        header_props = self.oracle.resolve(".desktop-header", w)
        self.assertEqual("sticky", header_props.get("position"))
        self.assertEqual("12px", header_props.get("top"))
        self.assertEqual("12px 24px 0 24px", header_props.get("margin"))

        stage_props = self.oracle.resolve(".stage-content", w)
        self.assertEqual("auto", stage_props.get("margin-inline"))
        self.assertEqual("var(--hym-content-max)", stage_props.get("max-width"))

        dedup_props = self.oracle.resolve(".stage-content .appbar", w)
        self.assertEqual("none !important", dedup_props.get("display"))

    def test_adv_viewport_3840px_4k_ultrawide(self):
        """Stress Test 3840px: 4K Ultrawide monitor.
        - Floating island remains sticky at 12px with fixed margins
        - Stage layout flex remains stable
        - Zero horizontal overflow
        """
        w = 3840.0
        header_props = self.oracle.resolve(".desktop-header", w)
        self.assertEqual("sticky", header_props.get("position"))
        self.assertEqual("12px", header_props.get("top"))
        self.assertEqual("12px 24px 0 24px", header_props.get("margin"))

        stage_props = self.oracle.resolve(".stage-content", w)
        self.assertEqual("auto", stage_props.get("margin-inline"))

        dedup_props = self.oracle.resolve(".stage-content .appbar", w)
        self.assertEqual("none !important", dedup_props.get("display"))

    def test_adv_viewport_no_breakpoint_gap_at_thresholds(self):
        """Adversarial Boundary Continuity: Verify exact threshold pairing (767px vs 768px, 1023px vs 1024px).
        Ensures there are no fractional gaps where neither mobile nor tablet layout applies.
        """
        # Mobile cutoff vs Tablet start
        self.assertIn("@media (max-width: 767px)", self.ui_css)
        self.assertIn("@media (min-width: 768px)", self.ui_css)

        # Tablet cutoff vs Desktop start
        self.assertIn("max-width: 1023px", self.ui_css)
        self.assertIn("@media (min-width: 1024px)", self.ui_css)

    # =========================================================================
    # CHALLENGE AREA 2: THEME BOX-SHADOW LAYERS & COLOR SPECIFICATIONS
    # =========================================================================

    def test_adv_theme_dark_mode_obsidian_and_glow_layers(self):
        """Stress Test Dark Mode Styling:
        1. Background: rgba(15, 23, 42, 0.78) (Obsidian Navy)
        2. Border: 1px solid rgba(56, 189, 248, 0.22) (Electric Sky Blue)
        3. Multi-layer Box Shadow:
           - Layer 1 (ambient black elevation): 0 8px 32px 0 rgba(0, 0, 0, 0.55)
           - Layer 2 (Electric Royal Blue glow): 0 0 20px -3px rgba(37, 99, 235, 0.35)
           - Layer 3 (Neon Cyan glow): 0 0 16px -2px rgba(0, 242, 254, 0.25)
           - Layer 4 (Perimeter outline ring): 0 0 0 1px rgba(56, 189, 248, 0.15)
        4. Selectors: Must match both html[data-theme="dark"] and html.dark
        """
        # Selectors
        self.assertIn('html[data-theme="dark"] .desktop-header', self.ui_css)
        self.assertIn('html.dark .desktop-header', self.ui_css)

        # Extract dark mode block
        dark_match = re.search(
            r'html\[data-theme="dark"\]\s*\.desktop-header,\s*html\.dark\s*\.desktop-header\s*\{([^}]+)\}',
            self.ui_css,
        )
        self.assertIsNotNone(dark_match, "Dark mode desktop-header rule block not found")
        block = dark_match.group(1)

        # Background
        self.assertIn("rgba(15, 23, 42, 0.78)", block)

        # Antislop pass (2026-11-26): header separates by tone + neutral hairline and one
        # neutral elevation shadow. No colored glow: cyan is reserved for active/primary.
        self.assertIn("1px solid rgba(148, 163, 184, 0.16)", block)
        self.assertIn("0 8px 24px 0 rgba(0, 0, 0, 0.35)", block)
        self.assertNotIn("rgba(0, 242, 254", block)
        self.assertNotIn("rgba(37, 99, 235", block)

    def test_adv_theme_light_mode_medical_white_and_soft_aura_layers(self):
        """Stress Test Light Mode Styling:
        1. Background: rgba(255, 255, 255, 0.86) (Medical Pure White)
        2. Border: 1px solid rgba(226, 232, 240, 0.9) (Ice Slate Border)
        3. Multi-layer Box Shadow:
           - Layer 1 (primary elevation): 0 10px 25px -5px rgba(15, 23, 42, 0.08)
           - Layer 2 (ambient soft shadow): 0 4px 10px -2px rgba(15, 23, 42, 0.04)
           - Layer 3 (subtle royal blue aura): 0 0 16px -2px rgba(37, 99, 235, 0.12)
           - Layer 4 (subtle cyan aura): 0 0 12px -2px rgba(0, 242, 254, 0.14)
        4. Selectors: Must match :root .desktop-header and html[data-theme="light"] .desktop-header
        """
        self.assertIn(':root .desktop-header', self.ui_css)
        self.assertIn('html[data-theme="light"] .desktop-header', self.ui_css)

        light_match = re.search(
            r':root\s*\.desktop-header,\s*html\[data-theme="light"\]\s*\.desktop-header\s*\{([^}]+)\}',
            self.ui_css,
        )
        self.assertIsNotNone(light_match, "Light mode desktop-header rule block not found")
        block = light_match.group(1)

        # Background
        self.assertIn("rgba(255, 255, 255, 0.86)", block)

        # Border
        self.assertIn("1px solid rgba(226, 232, 240, 0.9)", block)

        # Neutral elevation layers only; the blue/cyan aura was removed in the antislop pass
        self.assertIn("0 10px 25px -5px rgba(15, 23, 42, 0.08)", block)
        self.assertIn("0 4px 10px -2px rgba(15, 23, 42, 0.04)", block)
        self.assertNotIn("rgba(0, 242, 254", block)
        self.assertNotIn("rgba(37, 99, 235", block)

    def test_adv_frosted_glass_blur_token_validity(self):
        """Stress Test Frosted Glassmorphism:
        - backdrop-filter and -webkit-backdrop-filter must reference var(--glass-blur)
        - --glass-blur must be defined as blur(16px) or blur(18px)
        """
        header_rules = [r for r in self.oracle.rules if r.selector == ".desktop-header" and not r.media_query]
        self.assertTrue(len(header_rules) > 0)
        main_rule = header_rules[0]
        self.assertEqual("var(--glass-blur)", main_rule.properties.get("backdrop-filter"))
        self.assertEqual("var(--glass-blur)", main_rule.properties.get("-webkit-backdrop-filter"))

        # In tokens.css
        blur_match = re.search(r"--glass-blur:\s*blur\((\d+)px\)", self.tokens_css)
        self.assertIsNotNone(blur_match, "--glass-blur token not found")
        blur_val = int(blur_match.group(1))
        self.assertGreaterEqual(blur_val, 12, "Blur must be at least 12px for frosted glass aesthetics")
        self.assertLessEqual(blur_val, 24, "Blur must not exceed 24px to prevent GPU overdraw")

    # =========================================================================
    # CHALLENGE AREA 3: DESKTOP DE-DUPLICATION RULES & READER PRESERVATION
    # =========================================================================

    def test_adv_dedup_rule_exact_presence_and_specificity(self):
        """Adversarially verify de-duplication rule presence:
        - Must be: @media (min-width: 768px) { .stage-content .appbar { display: none !important; } }
        - Uses !important to override any element or local style
        """
        match = re.search(
            r"@media\s*\(\s*min-width:\s*768px\s*\)\s*\{[^}]*\.stage-content\s+\.appbar\s*\{([^}]+)\}",
            self.ui_css,
            re.DOTALL,
        )
        self.assertIsNotNone(match, "De-duplication rule for .stage-content .appbar not found in ui.css")
        self.assertIn("display: none !important", match.group(1))

    def test_adv_dedup_reader_mode_preservation(self):
        """Adversarial Challenge: Verify Reader Mode (<ReaderScreen />) preserves its AppBar.
        Reader mode must NOT lose its header on desktop:
        1. In Shell.tsx, variant === 'reader' renders <div className="app-shell app-shell--reader">{children}</div>
           (NOT inside .stage-content).
        2. DesktopHeader is omitted in variant === 'reader'.
        3. ReaderScreen mounts <AppBar ... />.
        4. Since ReaderScreen is outside .stage-content, the de-duplication rule (.stage-content .appbar)
           does NOT apply to reader mode.
        """
        # 1. Shell reader branch structure
        self.assertIn("if (variant === 'reader')", self.shell_tsx)
        reader_branch_start = self.shell_tsx.find("if (variant === 'reader')")
        reader_branch_end = self.shell_tsx.find("if (variant === 'bare')")
        reader_branch = self.shell_tsx[reader_branch_start:reader_branch_end]

        self.assertIn("app-shell--reader", reader_branch)
        self.assertNotIn("stage-content", reader_branch, "Reader branch must NOT be enclosed in .stage-content")
        self.assertNotIn("<DesktopHeader", reader_branch, "Reader branch must NOT mount DesktopHeader")

        # 2. ReaderScreen mounts AppBar
        self.assertIn("<AppBar", self.reader_screen_tsx, "ReaderScreen must mount <AppBar />")

        # 3. Test selector matching: .app-shell--reader .appbar does NOT match .stage-content .appbar
        self.assertNotIn(".app-shell--reader .appbar { display: none", self.ui_css)

    def test_adv_dedup_all_22_views_connected_to_header_context(self):
        """Adversarially verify all 22 screens mount <AppBar> and are wrapped by Shell default stage-content.
        Ensures NO view suffers from missing header or unsuppressed dual headers.
        """
        screens = [
            "HomeScreen.tsx", "LibraryScreen.tsx", "LibraryScreens.tsx",
            "ExamHome.tsx", "PracticeScreen.tsx", "HistoryScreen.tsx",
            "ExamSetup.tsx", "MockRun.tsx", "ExamResult.tsx",
            "ScheduleScreen.tsx", "NotesScreen.tsx", "MeScreen.tsx",
            "SearchScreen.tsx", "AiChatScreen.tsx", "GradesScreen.tsx",
            "SubscriptionScreen.tsx", "NotificationsScreen.tsx", "TicketsScreen.tsx",
            "ReaderScreen.tsx", "SystemScreen.tsx", "StatesScreen.tsx", "NotFoundScreen.tsx"
        ]
        found = 0
        for name in screens:
            files = list(SCREENS_DIR.rglob(name))
            self.assertTrue(len(files) > 0, f"Screen {name} missing")
            content = files[0].read_text(encoding="utf-8")
            self.assertIn("<AppBar", content, f"{name} does not mount <AppBar>")
            found += 1
        self.assertEqual(22, found)

    # =========================================================================
    # CHALLENGE AREA 4: Z-INDEX STACKING INVARIANTS & OVERLAY CONFLICTS
    # =========================================================================

    def test_adv_z_index_token_strict_hierarchy(self):
        """Stress Test Z-Index Stacking Hierarchy:
        Verify token hierarchy guarantees:
        --hym-z-base (0) < --hym-z-sticky (10) < --hym-z-nav (20) < --hym-z-sheet (30) <
        --hym-z-toast (40) < --hym-z-overlay (50) <= --hym-z-modal (60)
        """
        tokens = [
            ("--hym-z-base", 0),
            ("--hym-z-sticky", 10),
            ("--hym-z-nav", 20),
            ("--hym-z-sheet", 30),
            ("--hym-z-toast", 40),
            ("--hym-z-overlay", 50),
            ("--hym-z-modal", 60),
        ]
        for name, expected_val in tokens:
            m = re.search(rf"{name}:\s*(\d+);", self.tokens_css)
            self.assertIsNotNone(m, f"Token {name} not found in tokens.css")
            self.assertEqual(expected_val, int(m.group(1)), f"Token {name} mismatch")

    def test_adv_z_index_desktop_header_uses_z_nav(self):
        """Verify .desktop-header explicitly uses z-index: var(--z-nav) which resolves to 20."""
        header_rules = [r for r in self.oracle.rules if r.selector == ".desktop-header" and not r.media_query]
        self.assertTrue(len(header_rules) > 0)
        rule = header_rules[0]
        self.assertEqual("var(--z-nav)", rule.properties.get("z-index"))

    def test_adv_z_index_no_conflict_with_modal_sheets_and_scrims(self):
        """Stress Test: Verify that all dialogs, bottom sheets, and scrim backdrops
        have z-index >= 30, strictly higher than --z-nav (20).
        - .sheet-scrim has z-index: var(--z-sheet) (30) or 50
        - .sheet has z-index: var(--z-sheet) (30)
        - .toast-wrap has z-index: var(--z-toast) (40)
        - .thumb-drawer-backdrop has z-index: 1000
        - .reader-focus-mode has z-index: 9999
        - .focus-counter-badge has z-index: 10000
        - .focus-restore-trigger has z-index: 10000
        """
        # Sheet scrim base declarations
        scrim_matches = [
            m.group(1) for m in re.finditer(r"\.sheet-scrim\s*\{([^}]+)\}", self.ui_css)
            if "z-index" in m.group(1)
        ]
        self.assertTrue(len(scrim_matches) > 0, "No z-index found on .sheet-scrim")
        for s in scrim_matches:
            self.assertTrue(
                "z-index:var(--z-sheet)" in s or "z-index: 50" in s or "z-index:50" in s,
                f"Unexpected z-index on .sheet-scrim: {s}"
            )

        # Toast
        self.assertIn("z-index:var(--z-toast)", self.ui_css)

        # Drawers and fullscreens
        self.assertIn("z-index: 1000;", self.ui_css)  # thumb-drawer-backdrop
        self.assertIn("z-index: 9999 !important;", self.ui_css)  # reader-focus-mode
        self.assertIn("z-index: 10000;", self.ui_css)  # focus badges

    def test_adv_z_index_no_accidental_stacking_context_trap(self):
        """Adversarial Stacking Context Trap Check:
        Ensure .main-stage and .stage-content do NOT declare transform, filter, perspective,
        or contain: paint. An accidental stacking context would trap fixed modal dialogs
        underneath the sticky header.
        """
        main_stage_rules = [r for r in self.oracle.rules if r.selector == ".main-stage"]
        for rule in main_stage_rules:
            self.assertNotIn("transform", rule.properties, ".main-stage must not declare transform")
            self.assertNotIn("filter", rule.properties, ".main-stage must not declare filter")
            self.assertNotIn("perspective", rule.properties, ".main-stage must not declare perspective")
            self.assertNotIn("contain", rule.properties, ".main-stage must not declare contain")

        stage_content_rules = [r for r in self.oracle.rules if r.selector == ".stage-content"]
        for rule in stage_content_rules:
            self.assertNotIn("transform", rule.properties, ".stage-content must not declare transform")
            self.assertNotIn("filter", rule.properties, ".stage-content must not declare filter")
            self.assertNotIn("perspective", rule.properties, ".stage-content must not declare perspective")
            self.assertNotIn("contain", rule.properties, ".stage-content must not declare contain")

    # =========================================================================
    # CHALLENGE AREA 5: HEADER CONTEXT & DESKTOP HEADER COMPONENT INTEGRITY
    # =========================================================================

    def test_adv_header_context_memoization_and_contracts(self):
        """Verify HeaderContext prevents infinite re-render loops via shallow comparison in setHeader."""
        self.assertIn("prev.title === next.title", self.header_context_tsx)
        self.assertIn("prev.sub === next.sub", self.header_context_tsx)
        self.assertIn("prev.back === next.back", self.header_context_tsx)
        self.assertIn("prev.onBack === next.onBack", self.header_context_tsx)
        self.assertIn("prev.actions === next.actions", self.header_context_tsx)
        self.assertIn("return prev;", self.header_context_tsx)

    def test_adv_desktop_header_subcomponents_and_accessibility(self):
        """Verify DesktopHeader renders required accessibility roles, deduplicated brand,
        search trigger, and NotificationBell component.
        """
        notif_bell_tsx = (COMPONENTS_DIR / "NotificationBell.tsx").read_text(encoding="utf-8")
        self.assertIn('className="desktop-header"', self.desktop_header_tsx)
        self.assertIn('aria-label="سربرگ دسکتاپ"', self.desktop_header_tsx)
        self.assertNotIn('<Brand', self.desktop_header_tsx)
        self.assertIn('className="desktop-header__search"', self.desktop_header_tsx)
        self.assertIn('aria-label="جستجو در محتوا و منابع"', self.desktop_header_tsx)
        self.assertIn('className="desktop-header__search-label"', self.desktop_header_tsx)
        self.assertIn('<NotificationBell', self.desktop_header_tsx)
        self.assertIn('notif-bell__badge', notif_bell_tsx)


if __name__ == "__main__":
    unittest.main()
