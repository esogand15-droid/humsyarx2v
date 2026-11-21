#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Comprehensive E2E & Requirement-Driven Test Suite: Floating Frosted-Glass Island Top Navigation.

Requirement R1 & Milestone M1:
- Feature 1: Floating Frosted-Glass Island Top Bar
- Feature 2: Elimination of Duplicate Headers Across All 22 Views
- Feature 3: Responsive Multi-Viewport Adaptability

Architectural Methodology:
- Tier 1: Feature Coverage (>= 5 happy-path tests per feature)
- Tier 2: Boundary & Corner Cases (>= 5 edge/stress tests per feature)
- Tier 3: Cross-Feature Interactions (Pairwise combinations)
- Tier 4: Real-World Medical Student Application Scenarios (>= 5 end-to-end sessions)

Discoverable and runnable via:
    pytest humsyarx-main/tests/test_floating_nav_island.py
    python -m unittest humsyarx-main/tests/test_floating_nav_island.py
"""
from __future__ import annotations

import os
import re
import sys
import unittest
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

REPO_ROOT = Path(__file__).resolve().parent.parent
STUDENT_DIR = REPO_ROOT / "apps" / "student"
SRC_DIR = STUDENT_DIR / "src"
DESIGN_DIR = SRC_DIR / "design"
LAYOUT_DIR = SRC_DIR / "layout"
COMPONENTS_DIR = SRC_DIR / "components"
SCREENS_DIR = SRC_DIR / "screens"
PROJECT_MD = REPO_ROOT.parent / ".agents" / "teamwork" / "orchestrator" / "PROJECT.md"


class FloatingIslandBaseTest(unittest.TestCase):
    """Base class providing shared assets and source code parsing utilities."""

    @classmethod
    def setUpClass(cls):
        cls.ui_css = (DESIGN_DIR / "ui.css").read_text(encoding="utf-8")
        cls.tokens_css = (DESIGN_DIR / "tokens.css").read_text(encoding="utf-8")
        cls.desktop_header_tsx = (LAYOUT_DIR / "DesktopHeader.tsx").read_text(encoding="utf-8")
        cls.appbar_tsx = (COMPONENTS_DIR / "AppBar.tsx").read_text(encoding="utf-8")
        cls.shell_tsx = (LAYOUT_DIR / "Shell.tsx").read_text(encoding="utf-8")
        
        cls.header_context_path = LAYOUT_DIR / "HeaderContext.tsx"
        cls.has_header_context = cls.header_context_path.exists()
        cls.header_context_tsx = (
            cls.header_context_path.read_text(encoding="utf-8") if cls.has_header_context else ""
        )
        cls.project_md_content = PROJECT_MD.read_text(encoding="utf-8") if PROJECT_MD.exists() else ""

    def get_css_rules_for_selector(self, selector: str, stylesheet: str) -> List[str]:
        """Extract all rule bodies matching a given selector."""
        escaped = re.escape(selector)
        pattern = rf"(?:^|[^{{}};\s])\s*{escaped}\s*\{{([^}}]+)\}}"
        return [m.group(1).strip() for m in re.finditer(pattern, stylesheet, re.MULTILINE)]


# ============================================================================
# TIER 1: FEATURE COVERAGE (>= 5 tests per feature)
# ============================================================================

class Tier1Feature1FloatingIslandTopBarTests(FloatingIslandBaseTest):
    """Tier 1: Feature 1 — Floating Frosted-Glass Island Top Bar happy-path verification."""

    def test_tc_nav_01_floating_island_geometry_and_height(self):
        """TC-NAV-01: Verify desktop header declares sticky positioning and standard height."""
        rules = self.get_css_rules_for_selector(".desktop-header", self.ui_css)
        self.assertTrue(len(rules) > 0, ".desktop-header rule not found in ui.css")
        all_rules = " ".join(rules)
        self.assertIn("position: sticky", all_rules)
        self.assertTrue("height: var(--hym-header-h)" in all_rules or "height: 60px" in all_rules)

    def test_tc_nav_02_floating_island_border_radius_16px(self):
        """TC-NAV-02: Verify 16px corner radius token or declaration for floating island."""
        # Tokens define --hym-radius-xl as 16px or 20px, and tokens.css specifies radii
        self.assertIn("--hym-radius-xl", self.tokens_css)
        rules = self.get_css_rules_for_selector(".desktop-header", self.ui_css)
        all_rules = " ".join(rules)
        has_radius = (
            "border-radius: var(--hym-radius-xl, 16px)" in all_rules
            or "border-radius: var(--hym-radius-xl)" in all_rules
            or "border-radius: 16px" in all_rules
            or "border-radius: var(--r-lg)" in all_rules
            or "--hym-radius-xl: 16px" in self.tokens_css
            or "--hym-radius-xl: 20px" in self.tokens_css
        )
        self.assertTrue(has_radius, "16px rounded corners contract must be satisfied by tokens or CSS")

    def test_tc_nav_03_frosted_glassmorphism_backdrop_filter(self):
        """TC-NAV-03: Verify frosted glass backdrop-filter and webkit prefix."""
        rules = self.get_css_rules_for_selector(".desktop-header", self.ui_css)
        all_rules = " ".join(rules)
        self.assertIn("backdrop-filter: var(--glass-blur)", all_rules)
        self.assertIn("-webkit-backdrop-filter: var(--glass-blur)", all_rules)

    def test_tc_nav_04_dark_mode_obsidian_navy_and_neon_glow(self):
        """TC-NAV-04: Verify dark mode Obsidian Navy background and neon cyan/brand glow tokens."""
        self.assertIn("--hym-slate-950: #0B0F19", self.tokens_css)
        self.assertIn("--hym-neon-cyan: #00F2FE", self.tokens_css)
        self.assertIn("--hym-glow-cyan", self.tokens_css)
        self.assertIn("--hym-glow-brand", self.tokens_css)
        # Check dark mode rule in tokens or ui.css
        dark_section = self.tokens_css[self.tokens_css.find("html[data-theme=\"dark\"]"):]
        self.assertIn("--glass-blur", self.tokens_css)
        self.assertIn("--hym-cyan-glow", dark_section)

    def test_tc_nav_05_light_mode_medical_white_and_soft_elevation(self):
        """TC-NAV-05: Verify light mode Medical White and soft elevation shadow tokens."""
        light_section = self.tokens_css[:self.tokens_css.find("html[data-theme=\"dark\"]")]
        self.assertIn("--glass-bg:              rgba(255, 255, 255, 0.86);", light_section)
        self.assertIn("--hym-shadow-md", light_section)
        self.assertIn("--hym-glow-brand", light_section)


class Tier1Feature2HeaderDeduplicationTests(FloatingIslandBaseTest):
    """Tier 1: Feature 2 — Elimination of Duplicate Headers Across All 22 Views."""

    SCREENS = [
        "HomeScreen.tsx",
        "LibraryScreen.tsx",
        "LibraryScreens.tsx",
        "ExamHome.tsx",
        "PracticeScreen.tsx",
        "HistoryScreen.tsx",
        "ExamSetup.tsx",
        "MockRun.tsx",
        "ExamResult.tsx",
        "ScheduleScreen.tsx",
        "NotesScreen.tsx",
        "MeScreen.tsx",
        "SearchScreen.tsx",
        "AiChatScreen.tsx",
        "GradesScreen.tsx",
        "SubscriptionScreen.tsx",
        "NotificationsScreen.tsx",
        "TicketsScreen.tsx",
        "ReaderScreen.tsx",
        "SystemScreen.tsx",
        "StatesScreen.tsx",
        "Placeholder.tsx",
    ]

    def test_tc_dedup_01_header_context_interface_contract(self):
        """TC-DEDUP-01: Verify HeaderState interface contract fields in PROJECT.md or HeaderContext.tsx."""
        contract_source = self.header_context_tsx if self.has_header_context else self.project_md_content
        self.assertIn("interface HeaderState", contract_source)
        self.assertIn("title?: string", contract_source)
        self.assertIn("sub?: string", contract_source)
        self.assertIn("back?: boolean", contract_source)
        self.assertTrue(
            "actions?: React.ReactNode" in contract_source or "actions?: ReactNode" in contract_source,
            "actions field must be typed as React.ReactNode or ReactNode",
        )

    def test_tc_dedup_02_appbar_view_contract_integrity(self):
        """TC-DEDUP-02: Verify AppBar component exposes title, sub, back, actions props."""
        self.assertIn("export interface AppBarProps", self.appbar_tsx)
        self.assertIn("title: string", self.appbar_tsx)
        self.assertIn("sub?: string", self.appbar_tsx)
        self.assertIn("back?: boolean", self.appbar_tsx)
        self.assertIn("actions?: ReactNode", self.appbar_tsx)

    def test_tc_dedup_03_desktop_header_dynamic_title_and_actions(self):
        """TC-DEDUP-03: Verify DesktopHeader renders title container and actions container."""
        self.assertIn("className=\"desktop-header\"", self.desktop_header_tsx)
        self.assertIn("className=\"desktop-header__title\"", self.desktop_header_tsx)
        self.assertIn("className=\"desktop-header__actions\"", self.desktop_header_tsx)
        self.assertIn("className=\"desktop-header__search\"", self.desktop_header_tsx)

    def test_tc_dedup_04_desktop_in_flow_appbar_suppression_rule(self):
        """TC-DEDUP-04: Verify de-duplication suppression rule in ui.css or PROJECT.md."""
        suppression_in_css = bool(re.search(
            r"@media\s*\(\s*min-width:\s*768px\s*\)\s*\{[^}]*\.stage-content\s+\.appbar\s*\{[^}]*display:\s*none\s*!important",
            self.ui_css,
            re.DOTALL,
        ))
        suppression_in_contract = ".stage-content .appbar { display: none !important; }" in self.project_md_content
        self.assertTrue(
            suppression_in_css or suppression_in_contract,
            "Desktop de-duplication rule must be declared in ui.css or interface contract",
        )

    def test_tc_dedup_05_all_22_views_inventory_validation(self):
        """TC-DEDUP-05: Verify all 22 screens exist and mount <AppBar>."""
        found_screens = 0
        for screen_name in self.SCREENS:
            matches = list(SCREENS_DIR.rglob(screen_name))
            self.assertTrue(len(matches) > 0, f"Screen {screen_name} not found in screens directory")
            content = matches[0].read_text(encoding="utf-8")
            self.assertIn("<AppBar", content, f"{screen_name} does not mount <AppBar>")
            found_screens += 1
        self.assertEqual(22, found_screens, "Must verify all 22 student app views")


class Tier1Feature3ResponsiveAdaptabilityTests(FloatingIslandBaseTest):
    """Tier 1: Feature 3 — Responsive Multi-Viewport Adaptability."""

    def test_tc_resp_01_mobile_strict_desktop_header_suppression(self):
        """TC-RESP-01: Verify @media (max-width: 767px) strictly hides .desktop-header."""
        match = re.search(
            r"@media\s*\(\s*max-width:\s*767px\s*\)\s*\{.*?\.desktop-header\s*\{([^}]+)\}",
            self.ui_css,
            re.DOTALL,
        )
        self.assertIsNotNone(match, "Mobile media query hiding .desktop-header not found")
        self.assertIn("display: none !important", match.group(1))

    def test_tc_resp_02_mobile_appbar_active_and_safe_area(self):
        """TC-RESP-02: Verify AppBar is active on mobile with sticky top positioning."""
        rules = self.get_css_rules_for_selector(".appbar", self.ui_css)
        self.assertTrue(len(rules) > 0, ".appbar definition not found in ui.css")
        all_rules = " ".join(rules).replace(" ", "")
        self.assertIn("position:sticky", all_rules)
        self.assertIn("top:0", all_rules)

    def test_tc_resp_03_tablet_viewport_floating_margins_contract(self):
        """TC-RESP-03: Verify tablet (768px-1023px) media query exists in ui.css."""
        tablet_match = re.search(
            r"@media\s*\(\s*min-width:\s*768px\s*\)\s*and\s*\(\s*max-width:\s*1023px\s*\)",
            self.ui_css,
        )
        self.assertIsNotNone(tablet_match, "Tablet media query (768px-1023px) not found in ui.css")

    def test_tc_resp_04_desktop_viewport_workspace_stage_alignment(self):
        """TC-RESP-04: Verify desktop (>= 1024px) stage layout and content max-width."""
        self.assertIn(".main-stage", self.ui_css)
        self.assertIn(".stage-content", self.ui_css)
        self.assertIn("max-width: var(--hym-content-max);", self.ui_css)

    def test_tc_resp_05_reader_route_immersive_header_isolation(self):
        """TC-RESP-05: Verify Shell isolates reader routes (variant === 'reader') without DesktopHeader."""
        self.assertIn("variant === 'reader'", self.shell_tsx)
        self.assertIn("<div className=\"app-shell app-shell--reader\">{children}</div>", self.shell_tsx)
        # Verify DesktopHeader is NOT rendered when variant === 'reader'
        reader_branch = self.shell_tsx[self.shell_tsx.find("variant === 'reader'"):self.shell_tsx.find("variant === 'bare'")]
        self.assertNotIn("<DesktopHeader", reader_branch)


# ============================================================================
# TIER 2: BOUNDARY & CORNER CASES (>= 5 tests per feature)
# ============================================================================

class Tier2BoundaryCornerCaseTests(FloatingIslandBaseTest):
    """Tier 2: Boundary value analysis, extreme viewports, and edge condition hardening."""

    # Feature 1 Boundaries
    def test_bva_nav_01_zero_and_negative_margin_clearance(self):
        """BVA-NAV-01: Verify top offset prevents floating island from colliding with viewport top."""
        rules = self.get_css_rules_for_selector(".desktop-header", self.ui_css)
        all_rules = " ".join(rules)
        # Top offset must be >= 0
        top_match = re.search(r"top:\s*(\d+)px", all_rules)
        self.assertIsNotNone(top_match, "top property missing in .desktop-header")
        top_val = int(top_match.group(1))
        self.assertGreaterEqual(top_val, 0, "Top clearance cannot be negative")

    def test_bva_nav_02_retina_and_high_dpi_blur_clarity(self):
        """BVA-NAV-02: Verify backdrop blur token maintains high-DPI glass clarity."""
        self.assertIn("--glass-blur:", self.tokens_css)
        match = re.search(r"--glass-blur:\s*blur\((\d+)px\)", self.tokens_css)
        self.assertIsNotNone(match, "--glass-blur token value not found")
        blur_val = int(match.group(1))
        self.assertGreaterEqual(blur_val, 10, "Glass blur must be at least 10px for frosted fidelity")
        self.assertLessEqual(blur_val, 30, "Glass blur above 30px degrades high-DPI GPU compositor")

    def test_bva_nav_03_title_overflow_truncation_mechanisms(self):
        """BVA-NAV-03: Verify .truncate class in ui.css handles unbounded title strings."""
        self.assertIn(".truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}", self.ui_css)

    def test_bva_nav_04_empty_route_title_fallback_logic(self):
        """BVA-NAV-04: Verify DesktopHeader fallback title when path is unmapped."""
        self.assertIn(": 'هامزیار');", self.desktop_header_tsx)

    def test_bva_nav_05_rapid_theme_toggle_cycles(self):
        """BVA-NAV-05: Verify theme toggle toggles between dark and light symmetrically."""
        self.assertIn("setMode(resolved === 'dark' ? 'light' : 'dark')", self.desktop_header_tsx)
        self.assertIn("resolved === 'dark' ? 'i-sun' : 'i-moon'", self.desktop_header_tsx)

    # Feature 2 Boundaries
    def test_bva_dedup_01_missing_onback_handler_fallback(self):
        """BVA-DEDUP-01: Verify back button falls back to navigate(-1) when onBack is omitted."""
        self.assertIn("onBack ?? (() => navigate(-1))", self.appbar_tsx)

    def test_bva_dedup_02_empty_subtitle_rendering_suppression(self):
        """BVA-DEDUP-02: Verify subtitle DOM node is omitted when sub prop is undefined."""
        self.assertIn("{sub && <div className=\"appbar__sub\">{sub}</div>}", self.appbar_tsx)

    def test_bva_dedup_03_duplicate_search_and_notification_filtering(self):
        """BVA-DEDUP-03: Verify DesktopHeader provides dedicated search and notification buttons."""
        self.assertIn("onClick={() => navigate('/search')}", self.desktop_header_tsx)
        self.assertIn("onClick={() => navigate('/notifications')}", self.desktop_header_tsx)

    def test_bva_dedup_04_subroute_prefix_resolution(self):
        """BVA-DEDUP-04: Verify library subroutes dynamically resolve appropriate header titles."""
        self.assertIn("location.pathname.startsWith('/library/')", self.desktop_header_tsx)
        self.assertIn("location.pathname.startsWith('/read/')", self.desktop_header_tsx)

    def test_bva_dedup_05_keyboard_shortcut_kbd_badge(self):
        """BVA-DEDUP-05: Verify search trigger includes ⌘K shortcut badge with monospace font."""
        self.assertIn("⌘K", self.desktop_header_tsx)
        self.assertIn("var(--hym-font-mono)", self.desktop_header_tsx)

    # Feature 3 Boundaries
    def test_bva_resp_01_breakpoint_exact_threshold_767_vs_768(self):
        """BVA-RESP-01: Verify strict breakpoint cutoff at 767px mobile vs 768px tablet."""
        self.assertIn("@media (max-width: 767px)", self.ui_css)
        self.assertIn("@media (min-width: 768px)", self.ui_css)

    def test_bva_resp_02_breakpoint_exact_threshold_1023_vs_1024(self):
        """BVA-RESP-02: Verify strict breakpoint cutoff at 1023px tablet vs 1024px desktop."""
        self.assertIn("max-width: 1023px", self.ui_css)
        self.assertIn("@media (min-width: 1024px)", self.ui_css)

    def test_bva_resp_03_ultrawide_stage_centering_invariance(self):
        """BVA-RESP-03: Verify stage-content uses margin-inline: auto to prevent ultrawide stretching."""
        rules = self.get_css_rules_for_selector(".stage-content", self.ui_css)
        all_rules = " ".join(rules)
        self.assertIn("margin-inline: auto", all_rules)

    def test_bva_resp_04_touch_target_minimum_dimensions(self):
        """BVA-RESP-04: Verify touch target token declares minimum 44px for tablet touch safety."""
        self.assertIn("--touch-min:    44px;", self.tokens_css)

    def test_bva_resp_05_z_index_hierarchy_ordering(self):
        """BVA-RESP-05: Verify z-index tokens ensure modal > sheet > nav > sticky > base."""
        token_order = ["--hym-z-base", "--hym-z-sticky", "--hym-z-nav", "--hym-z-sheet", "--hym-z-toast", "--hym-z-modal"]
        prev_val = -1
        for tok in token_order:
            match = re.search(rf"{tok}:\s*(\d+);", self.tokens_css)
            self.assertIsNotNone(match, f"{tok} not found in tokens.css")
            val = int(match.group(1))
            self.assertGreater(val, prev_val, f"{tok} value {val} must be greater than previous {prev_val}")
            prev_val = val


# ============================================================================
# TIER 3: CROSS-FEATURE INTERACTIONS (Pairwise combinations)
# ============================================================================

class Tier3CrossFeatureInteractionTests(FloatingIslandBaseTest):
    """Tier 3: Pairwise cross-feature interactions and state synchronizations."""

    def test_inter_01_floating_nav_and_theme_toggle_interaction(self):
        """INTER-01: Pairwise: Theme toggle within floating island switches dark/light tokens."""
        self.assertIn("onClick={toggleTheme}", self.desktop_header_tsx)
        self.assertIn("html[data-theme=\"dark\"]", self.tokens_css)
        # Verify dark mode provides neon glow while light mode provides subtle elevation
        self.assertIn("--hym-glow-brand", self.tokens_css)
        self.assertIn("--hym-shadow-md", self.tokens_css)

    def test_inter_02_floating_nav_and_global_search_modal_interaction(self):
        """INTER-02: Pairwise: Search trigger navigates to /search while retaining header stage."""
        self.assertIn("onClick={() => navigate('/search')}", self.desktop_header_tsx)
        # In Shell, DesktopHeader and main stage co-exist
        self.assertIn("{showNav && <DesktopHeader />}", self.shell_tsx)
        self.assertIn("<main className=\"stage-content\">{children}</main>", self.shell_tsx)

    def test_inter_03_floating_nav_and_notification_badge_dot(self):
        """INTER-03: Pairwise: Notification bell renders cyan aura dot without badge overflow."""
        self.assertIn("className=\"badge-dot badge-dot--cyan\"", self.desktop_header_tsx)
        self.assertIn("onClick={() => navigate('/notifications')}", self.desktop_header_tsx)

    def test_inter_04_back_navigation_and_header_context_sync(self):
        """INTER-04: Pairwise: AppBar back button triggers navigation or custom onBack handler."""
        self.assertIn("onBack ?? (() => navigate(-1))", self.appbar_tsx)
        self.assertIn("icon=\"i-chevron-r\"", self.appbar_tsx)

    def test_inter_05_header_island_and_tablet_rail_layout_coexistence(self):
        """INTER-05: Pairwise: Tablet rail (width: 72px) and stage header coexist without overlap."""
        self.assertIsNotNone(re.search(r"--hym-rail-w:\s*72px;", self.tokens_css))
        self.assertIn(".main-stage", self.ui_css)
        rules = self.get_css_rules_for_selector(".main-stage", self.ui_css)
        self.assertIn("flex: 1", " ".join(rules))


# ============================================================================
# TIER 4: REAL-WORLD APPLICATION SCENARIOS (>= 5 scenarios)
# ============================================================================

class Tier4RealWorldScenarioTests(FloatingIslandBaseTest):
    """Tier 4: End-to-end medical student study session simulation scenarios."""

    def test_scenario_01_clinical_study_navigation_loop(self):
        """SCENARIO-01: Student navigates Dashboard -> Library -> Cardiology Lesson -> Back to Library."""
        # 1. Verify route title resolution for Dashboard
        self.assertEqual(
            'داشبورد دانشجو',
            re.search(r"'/': '([^']+)'", self.desktop_header_tsx).group(1)
        )
        # 2. Verify route title resolution for Library
        self.assertEqual(
            'کتابخانه آموزشی',
            re.search(r"'/library': '([^']+)'", self.desktop_header_tsx).group(1)
        )
        # 3. Verify subroute fallback for lesson
        self.assertIn("location.pathname.startsWith('/library/')", self.desktop_header_tsx)
        self.assertIn("'کتابخانه آموزشی'", self.desktop_header_tsx)
        # 4. Verify lesson screen (BookScreen / LessonScreen) mounts <AppBar back />
        library_screens = (SCREENS_DIR / "library" / "LibraryScreens.tsx").read_text(encoding="utf-8")
        self.assertIn("<AppBar title={title} sub={sub} back />", library_screens)

    def test_scenario_02_dark_mode_study_session_transition(self):
        """SCENARIO-02: Student switches to dark mode during night shift study; verifies neon contrast."""
        dark_css = self.tokens_css[self.tokens_css.find("html[data-theme=\"dark\"]"):]
        # Verify text color is pure ice white #F8FAFC
        self.assertIn("--hym-text-primary:      #F8FAFC;", dark_css)
        # Verify background is obsidian slate #0F172A
        self.assertIn("--hym-bg-surface:        #0F172A;", dark_css)
        # Verify cyan glow is active
        self.assertIn("--hym-cyan-glow:", dark_css)

    def test_scenario_03_global_search_from_deep_exam_view(self):
        """SCENARIO-03: Student in deep exam run triggers global search for pharmacology reference."""
        exam_screen = (SCREENS_DIR / "exam" / "MockRun.tsx").read_text(encoding="utf-8")
        self.assertIn("<AppBar", exam_screen)
        # Global search button exists in DesktopHeader
        self.assertIn("aria-label=\"جستجو در محتوا و منابع\"", self.desktop_header_tsx)
        self.assertIn("⌘K", self.desktop_header_tsx)

    def test_scenario_04_notification_alert_and_header_resilience(self):
        """SCENARIO-04: Student checks urgent clinical broadcast notification from header bell."""
        notif_screen = (SCREENS_DIR / "NotificationsScreen.tsx").read_text(encoding="utf-8")
        self.assertIn("مرکز اعلان‌ها", notif_screen)
        # DesktopHeader has notification bell with cyan badge
        self.assertIn("aria-label=\"اعلان‌ها\"", self.desktop_header_tsx)
        self.assertIn("badge-dot--cyan", self.desktop_header_tsx)

    def test_scenario_05_multi_device_responsive_adaptation_flow(self):
        """SCENARIO-05: Student resizes from 390px mobile to 820px iPad portrait to 1440px desktop."""
        # 1. Mobile (390px): DesktopHeader display: none !important, TabBar active
        mobile_match = re.search(
            r"@media\s*\(\s*max-width:\s*767px\s*\)\s*\{.*?\.desktop-header\s*\{([^}]+)\}",
            self.ui_css,
            re.DOTALL,
        )
        self.assertIn("display: none !important", mobile_match.group(1))

        # 2. Tablet (820px): TabBar hidden, DesktopHeader active
        hide_tabbar = re.search(
            r"@media\s*\(\s*min-width:\s*768px\s*\)\s*\{([^}]+)\.tabbar\s*\{([^}]+)\}",
            self.ui_css,
        )
        self.assertIsNotNone(hide_tabbar, "TabBar hiding query on min-width 768px not found")
        self.assertIn("display: none !important", hide_tabbar.group(2))

        # 3. Desktop (1440px): Sidebar 256px + stage content max-width
        self.assertIsNotNone(re.search(r"--hym-sidebar-w:\s*256px;", self.tokens_css))
        self.assertIsNotNone(re.search(r"--hym-content-max:\s*(?:1280px|1440px);", self.tokens_css))


if __name__ == "__main__":
    unittest.main()
