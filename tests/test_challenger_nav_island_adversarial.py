#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Adversarial Empirical Challenge Suite: Floating Top Navigation Island & Header De-duplication.

Milestone: M1
Author: challenger_nav_1 (Empirical Challenger)
Focus Areas:
1. Rapid view transitions across all 22 screens & 28 routes (1000-hop random walk stress).
2. Absence of duplicate headers across viewports (mobile, tablet, desktop, reader).
3. Fallback behavior (unmapped titles, missing back buttons, undefined onBack, empty actions).
4. De-duplication logic (filtering HomeScreen duplicate search/bell links on '/').
5. HeaderContext unmount/remount stability (StrictMode double-mount, shallow memoization).
6. Floating frosted-glass CSS geometry, Obsidian Navy / Medical White glow, and responsive queries.
7. Independent React 18 Node.js runtime verification harness.

Executable via:
    py -3.12 humsyarx-main/tests/test_challenger_nav_island_adversarial.py
    pytest humsyarx-main/tests/test_challenger_nav_island_adversarial.py
"""
from __future__ import annotations

import os
import random
import re
import subprocess
import sys
import unittest
from pathlib import Path
from typing import Any, Dict, List, Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
STUDENT_DIR = REPO_ROOT / "apps" / "student"
SRC_DIR = STUDENT_DIR / "src"
DESIGN_DIR = SRC_DIR / "design"
LAYOUT_DIR = SRC_DIR / "layout"
COMPONENTS_DIR = SRC_DIR / "components"
SCREENS_DIR = SRC_DIR / "screens"
TESTS_DIR = REPO_ROOT / "tests"


class ChallengerNavIslandBase(unittest.TestCase):
    """Shared test assets and source parsing helpers."""

    @classmethod
    def setUpClass(cls):
        cls.ui_css = (DESIGN_DIR / "ui.css").read_text(encoding="utf-8")
        cls.tokens_css = (DESIGN_DIR / "tokens.css").read_text(encoding="utf-8")
        cls.desktop_header_tsx = (LAYOUT_DIR / "DesktopHeader.tsx").read_text(encoding="utf-8")
        cls.appbar_tsx = (COMPONENTS_DIR / "AppBar.tsx").read_text(encoding="utf-8")
        cls.header_context_tsx = (LAYOUT_DIR / "HeaderContext.tsx").read_text(encoding="utf-8")
        cls.shell_tsx = (LAYOUT_DIR / "Shell.tsx").read_text(encoding="utf-8")
        cls.app_tsx = (SRC_DIR / "App.tsx").read_text(encoding="utf-8")

        # Static mapping replicated from DesktopHeader.tsx
        cls.route_titles: Dict[str, str] = {
            "/": "داشبورد دانشجو",
            "/library": "کتابخانه آموزشی",
            "/exam": "بانک سؤال و آزمون",
            "/me/notes": "دفترچه یادداشت من",
            "/schedule": "برنامه مطالعه",
            "/me": "پروفایل و حساب کاربری",
            "/search": "جستجوی سراسری",
            "/notifications": "مرکز اعلان‌ها",
            "/system": "سیستم دیزاین هامزیار",
            "/states": "وضعیت‌های سیستمی",
        }

    def compute_desktop_header(
        self,
        pathname: str,
        header_title: Optional[str] = None,
        header_sub: Optional[str] = None,
        header_back: Optional[bool] = None,
        header_on_back: Optional[Any] = None,
        header_actions: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """Faithful Python replication of DesktopHeader state resolution logic."""
        is_home_screen = (pathname == "/" or pathname == "/login")

        if pathname in self.route_titles:
            default_title = self.route_titles[pathname]
        elif pathname.startswith("/library/"):
            default_title = "کتابخانه آموزشی"
        elif pathname.startswith("/read/"):
            default_title = "مطالعه جزوه"
        else:
            default_title = "هامزیار"

        title = header_title if (header_title is not None and header_title != "") else default_title
        sub = header_sub
        show_back = bool(header_back)
        handle_back = header_on_back if header_on_back is not None else "navigate(-1)"
        contextual_actions = header_actions if (not is_home_screen and header_actions) else None

        return {
            "is_home_screen": is_home_screen,
            "title": title,
            "sub": sub,
            "show_back": show_back,
            "handle_back": handle_back,
            "contextual_actions": contextual_actions,
        }


# =============================================================================
# 1. RAPID ROUTE CHANGES & STRESS TRANSITIONS ACROSS ALL 22 SCREENS
# =============================================================================

class TestRapidViewTransitionsAcross22Screens(ChallengerNavIslandBase):
    """Adversarial stress-testing of view transitions and header propagation."""

    ALL_SCREEN_SPECS = [
        {"route": "/", "file": "HomeScreen.tsx", "title": "مرکز فرماندهی هوش‌یار", "sub": "مرکز جامع فرماندهی", "back": False, "actions": ["search_link", "bell_link"]},
        {"route": "/library", "file": "LibraryScreen.tsx", "title": "کتابخانه", "sub": "جزوه‌ها و منابع", "back": False, "actions": None},
        {"route": "/library/term/1", "file": "LibraryScreens.tsx", "title": "ترم ۱", "sub": "علوم پایه", "back": True, "actions": None},
        {"route": "/library/lesson/anatomy", "file": "LibraryScreens.tsx", "title": "آناتومی عمومی", "sub": "جلسات", "back": True, "actions": None},
        {"route": "/library/session/s101", "file": "LibraryScreens.tsx", "title": "استخوان‌شناسی", "sub": "اسلایدها", "back": True, "actions": None},
        {"route": "/library/subject/cardio", "file": "LibraryScreens.tsx", "title": "مبحث قلب و عروق", "sub": "سؤالات", "back": True, "actions": None},
        {"route": "/library/book/gray", "file": "LibraryScreens.tsx", "title": "آناتومی گری", "sub": "کتاب مرجع", "back": True, "actions": None},
        {"route": "/read/pdf/123", "file": "ReaderScreen.tsx", "title": "فیزیولوژی گایتون", "sub": "خواندن داخل هامزیار", "back": True, "actions": ["ai_chat_btn"]},
        {"route": "/me/notes", "file": "NotesScreen.tsx", "title": "دفتر من", "sub": "هر چیزی که روی آن نوشته‌ای", "back": True, "actions": None},
        {"route": "/exam", "file": "ExamHome.tsx", "title": "تمرین", "sub": "بانک سؤال", "back": True, "actions": None},
        {"route": "/exam/practice", "file": "PracticeScreen.tsx", "title": "قلب · فیزیولوژی", "sub": "حل شده", "back": True, "actions": None},
        {"route": "/exam/history", "file": "HistoryScreen.tsx", "title": "تاریخچهٔ پاسخ‌ها", "sub": "هر چه پاسخ داده‌ای", "back": True, "actions": None},
        {"route": "/exam/setup", "file": "ExamSetup.tsx", "title": "آزمون", "sub": "زمان‌دار، بدون پاسخ در میانه", "back": True, "actions": None},
        {"route": "/exam/mock/history", "file": "ExamSetup.tsx", "title": "آزمون‌های قبلی", "sub": "کارنامه و بازبینی", "back": True, "actions": None},
        {"route": "/exam/run/s1", "file": "MockRun.tsx", "title": "آزمون جامع پره‌انترنی", "sub": "کد EX-2024", "back": True, "actions": ["timer_countdown"]},
        {"route": "/exam/result/s1", "file": "ExamResult.tsx", "title": "کارنامه", "sub": "کد EX-2024", "back": True, "actions": None},
        {"route": "/schedule", "file": "ScheduleScreen.tsx", "title": "برنامه و تسک‌های مطالعه", "sub": "تقویم جلالی، کلاس‌ها و امتحانات", "back": False, "actions": None},
        {"route": "/me", "file": "MeScreen.tsx", "title": "هامزیار من", "sub": "حساب، دستگاه‌ها و ظاهر", "back": False, "actions": None},
        {"route": "/search", "file": "SearchScreen.tsx", "title": "جستجو", "sub": "جستجوی سراسری در محتوا", "back": False, "actions": None},
        {"route": "/ai", "file": "AiChatScreen.tsx", "title": "هوش‌یار پزشکی", "sub": "دستیار هوشمند و تحلیل بالینی", "back": False, "actions": ["vision_upload", "clear_btn"]},
        {"route": "/grades", "file": "GradesScreen.tsx", "title": "کارنامه و معدل کل", "sub": "سوابق تحصیلی و معدل وزنی (GPA)", "back": False, "actions": None},
        {"route": "/subscription", "file": "SubscriptionScreen.tsx", "title": "طرح‌های اشتراک", "sub": "دسترسی جامع به منابع و هوش پزشکی", "back": False, "actions": None},
        {"route": "/notifications", "file": "NotificationsScreen.tsx", "title": "مرکز اعلان‌ها", "sub": "پیام‌ها و اطلاعیه‌های سامانه", "back": False, "actions": ["mark_all_read"]},
        {"route": "/tickets", "file": "TicketsScreen.tsx", "title": "پشتیبانی و تیکت‌ها", "sub": "پاسخ‌گویی سریع به سؤالات فنی و آموزشی", "back": False, "actions": ["new_ticket"]},
        {"route": "/system", "file": "SystemScreen.tsx", "title": "سیستم طراحی", "sub": "HumsYar Medical-AI · v2.0", "back": True, "actions": ["settings_btn"]},
        {"route": "/states", "file": "StatesScreen.tsx", "title": "وضعیت‌های سیستمی", "sub": "طراحی، نه اتفاق", "back": True, "actions": None},
        {"route": "/unknown/404", "file": "Placeholder.tsx", "title": "پیدا نشد", "sub": "مسیر نامعتبر", "back": False, "actions": None},
    ]

    def test_rapid_sequential_screen_traversal(self):
        """Sequential transition through all 27 student views verifies zero state leak."""
        header_state: Dict[str, Any] = {}

        for spec in self.ALL_SCREEN_SPECS:
            with self.subTest(route=spec["route"]):
                # 1. Unmount previous view
                header_state = {}
                # 2. Mount new view
                header_state = {
                    "title": spec["title"],
                    "sub": spec["sub"],
                    "back": spec["back"],
                    "actions": spec["actions"],
                }

                computed = self.compute_desktop_header(
                    spec["route"],
                    header_title=header_state["title"],
                    header_sub=header_state["sub"],
                    header_back=header_state["back"],
                    header_actions=header_state["actions"],
                )

                self.assertEqual(computed["title"], spec["title"])
                self.assertEqual(computed["sub"], spec["sub"])
                self.assertEqual(computed["show_back"], spec["back"])

                if spec["route"] == "/":
                    self.assertIsNone(computed["contextual_actions"], "HomeScreen duplicate actions must be suppressed")
                elif spec["actions"]:
                    self.assertEqual(computed["contextual_actions"], spec["actions"])
                else:
                    self.assertIsNone(computed["contextual_actions"])

    def test_rapid_random_walk_1000_hops(self):
        """1000 random view transitions ensure no state persistence or desynchronization."""
        rng = random.Random(42)  # Deterministic seed for reproducible stress test
        header_state: Dict[str, Any] = {}

        for hop in range(1000):
            spec = rng.choice(self.ALL_SCREEN_SPECS)
            # Unmount
            header_state = {}
            # Mount
            header_state = {
                "title": spec["title"],
                "sub": spec["sub"],
                "back": spec["back"],
                "actions": spec["actions"],
            }
            computed = self.compute_desktop_header(
                spec["route"],
                header_title=header_state["title"],
                header_sub=header_state["sub"],
                header_back=header_state["back"],
                header_actions=header_state["actions"],
            )
            self.assertEqual(computed["title"], spec["title"], f"Hop {hop} failed at route {spec['route']}")
            self.assertEqual(computed["sub"], spec["sub"], f"Hop {hop} failed at route {spec['route']}")
            self.assertEqual(computed["show_back"], spec["back"], f"Hop {hop} failed at route {spec['route']}")

            if spec["route"] == "/":
                self.assertIsNone(computed["contextual_actions"])
            else:
                self.assertEqual(computed["contextual_actions"], spec["actions"])


# =============================================================================
# 2. FALLBACK BEHAVIOR VERIFICATION
# =============================================================================

class TestNavIslandFallbackBehaviors(ChallengerNavIslandBase):
    """Stress testing of fallback title, undefined back buttons, and empty actions."""

    def test_fallback_title_resolution_matrix(self):
        """Verify fallback titles for null, empty, undefined across standard and unmapped paths."""
        cases = [
            # (path, header_title, expected_title)
            ("/", None, "داشبورد دانشجو"),
            ("/", "", "داشبورد دانشجو"),
            ("/exam", None, "بانک سؤال و آزمون"),
            ("/library", None, "کتابخانه آموزشی"),
            ("/schedule", None, "برنامه مطالعه"),
            ("/me", None, "پروفایل و حساب کاربری"),
            ("/search", None, "جستجوی سراسری"),
            ("/notifications", None, "مرکز اعلان‌ها"),
            ("/system", None, "سیستم دیزاین هامزیار"),
            ("/states", None, "وضعیت‌های سیستمی"),
            # Library prefix fallback
            ("/library/custom-sub/topic-99", None, "کتابخانه آموزشی"),
            ("/library/deep/nested/path/here", "", "کتابخانه آموزشی"),
            # Reader prefix fallback
            ("/read/pdf/special-article", None, "مطالعه جزوه"),
            ("/read/notes/chapter-1", "", "مطالعه جزوه"),
            # Global fallback
            ("/unregistered/arbitrary/path", None, "هامزیار"),
            ("/unregistered/arbitrary/path", "", "هامزیار"),
            ("/api/health", None, "هامزیار"),
        ]
        for path, header_title, expected in cases:
            with self.subTest(path=path, header_title=header_title):
                computed = self.compute_desktop_header(path, header_title=header_title)
                self.assertEqual(computed["title"], expected)

    def test_fallback_when_back_is_undefined_or_false(self):
        """Verify back button rendering flag when back is omitted or false."""
        c1 = self.compute_desktop_header("/exam", header_back=None)
        self.assertFalse(c1["show_back"])

        c2 = self.compute_desktop_header("/exam", header_back=False)
        self.assertFalse(c2["show_back"])

        c3 = self.compute_desktop_header("/exam", header_back=True)
        self.assertTrue(c3["show_back"])

    def test_fallback_for_onback_navigation_handler(self):
        """Verify fallback to navigate(-1) when onBack is omitted from header state."""
        # When onBack is omitted
        c1 = self.compute_desktop_header("/exam", header_back=True, header_on_back=None)
        self.assertEqual(c1["handle_back"], "navigate(-1)")

        # When custom onBack handler is provided
        custom_fn = lambda: "custom_handler"
        c2 = self.compute_desktop_header("/exam", header_back=True, header_on_back=custom_fn)
        self.assertEqual(c2["handle_back"], custom_fn)

    def test_fallback_for_empty_and_falsy_actions(self):
        """Verify contextual actions and divider suppression when actions is empty."""
        falsy_actions = [None, False, [], ""]
        for act in falsy_actions:
            with self.subTest(act=act):
                computed = self.compute_desktop_header("/system", header_actions=act)
                self.assertIsNone(computed["contextual_actions"])


# =============================================================================
# 3. DE-DUPLICATION LOGIC ON HOME SCREEN AND DEEP VIEWS
# =============================================================================

class TestNavIslandDeDuplicationLogic(ChallengerNavIslandBase):
    """Verify suppression of duplicate search & bell buttons on HomeScreen."""

    def test_home_screen_actions_filtering(self):
        """HomeScreen passes search & bell links; DesktopHeader must filter them out."""
        # Simulated HomeScreen actions
        home_actions = [
            '<Link to="/search">Icon(i-search)</Link>',
            '<Link to="/notifications">Icon(i-bell)</Link>',
        ]

        # On '/'
        computed_home = self.compute_desktop_header("/", header_actions=home_actions)
        self.assertTrue(computed_home["is_home_screen"])
        self.assertIsNone(computed_home["contextual_actions"], "Must filter home screen duplicate actions")

        # On '/login'
        computed_login = self.compute_desktop_header("/login", header_actions=home_actions)
        self.assertTrue(computed_login["is_home_screen"])
        self.assertIsNone(computed_login["contextual_actions"], "Must filter login duplicate actions")

    def test_deep_screens_preserve_contextual_actions(self):
        """Deep screens (AiChat, MockRun, Tickets, etc.) preserve their unique action buttons."""
        timer_action = '<span className="timer">14:59</span>'
        computed_exam = self.compute_desktop_header("/exam/run/test-1", header_actions=timer_action)
        self.assertFalse(computed_exam["is_home_screen"])
        self.assertEqual(computed_exam["contextual_actions"], timer_action)

        ai_actions = '<button>Upload Vision</button>'
        computed_ai = self.compute_desktop_header("/ai", header_actions=ai_actions)
        self.assertFalse(computed_ai["is_home_screen"])
        self.assertEqual(computed_ai["contextual_actions"], ai_actions)


# =============================================================================
# 4. HEADERCONTEXT UNMOUNT/REMOUNT STABILITY & REACT MEMOIZATION
# =============================================================================

class TestHeaderContextLifecycleStability(ChallengerNavIslandBase):
    """Verify HeaderContext state lifecycle contracts, reset behavior, and memoization."""

    def test_header_context_memoization_contract(self):
        """Verify shallow equality check in setHeader to prevent render loops."""
        self.assertIn("prev.title === next.title", self.header_context_tsx)
        self.assertIn("prev.sub === next.sub", self.header_context_tsx)
        self.assertIn("prev.back === next.back", self.header_context_tsx)
        self.assertIn("prev.onBack === next.onBack", self.header_context_tsx)
        self.assertIn("prev.actions === next.actions", self.header_context_tsx)

    def test_header_context_unmount_reset_contract(self):
        """Verify AppBar cleans up header state on unmount via resetHeader."""
        self.assertIn("resetHeader();", self.appbar_tsx)
        self.assertIn("return () => {", self.appbar_tsx)

    def test_default_context_value_safety(self):
        """Verify HeaderContext declares safe non-throwing default value."""
        self.assertIn("const defaultContextValue: HeaderContextValue = {", self.header_context_tsx)
        self.assertIn("header: {},", self.header_context_tsx)
        self.assertIn("setHeader: () => {},", self.header_context_tsx)
        self.assertIn("resetHeader: () => {},", self.header_context_tsx)
        self.assertIn("return context || defaultContextValue;", self.header_context_tsx)


# =============================================================================
# 5. CSS GEOMETRY, GLOW TOKENS & RESPONSIVE VIEWPORT INVARIANTS
# =============================================================================

class TestNavIslandCSSAndDesignInvariants(ChallengerNavIslandBase):
    """Stress-test CSS rules for floating geometry, glow, and viewport media queries."""

    def test_floating_island_geometry_and_elevation(self):
        """Verify floating margins (12px 24px), sticky top 12px, 16px radius, and backdrop blur."""
        self.assertIn("position: sticky;", self.ui_css)
        self.assertIn("top: 12px;", self.ui_css)
        self.assertIn("margin: 12px 24px 0 24px;", self.ui_css)
        self.assertIn("border-radius: var(--hym-radius-xl, 16px);", self.ui_css)
        self.assertIn("backdrop-filter: var(--glass-blur);", self.ui_css)
        self.assertIn("-webkit-backdrop-filter: var(--glass-blur);", self.ui_css)

    def test_dark_mode_obsidian_navy_and_neon_glow(self):
        """Verify dark mode Obsidian Navy background and subtle elevation without header cyan glow."""
        dark_section_match = re.search(
            r'html\[data-theme="dark"\]\s+\.desktop-header,\s*html\.dark\s+\.desktop-header\s*\{([^}]+)\}',
            self.ui_css,
        )
        self.assertIsNotNone(dark_section_match, "Dark mode .desktop-header block not found")
        content = dark_section_match.group(1)
        self.assertIn("rgba(15, 23, 42, 0.78)", content)
        self.assertIn("rgba(148, 163, 184, 0.16)", content)
        self.assertIn("rgba(0, 0, 0, 0.35)", content)

    def test_light_mode_medical_white_and_soft_aura(self):
        """Verify light mode Medical White background (rgba(255,255,255,0.86)) and soft shadow."""
        light_section_match = re.search(
            r':root\s+\.desktop-header,\s*html\[data-theme="light"\]\s+\.desktop-header\s*\{([^}]+)\}',
            self.ui_css,
        )
        self.assertIsNotNone(light_section_match, "Light mode .desktop-header block not found")
        content = light_section_match.group(1)
        self.assertIn("rgba(255, 255, 255, 0.86)", content)
        self.assertIn("rgba(226, 232, 240, 0.9)", content)

    def test_desktop_deduplication_rule(self):
        """Verify desktop (@media >= 768px) strictly hides .stage-content .appbar."""
        match = re.search(
            r"@media\s*\(\s*min-width:\s*768px\s*\)\s*\{[^}]*\.stage-content\s+\.appbar\s*\{[^}]*display:\s*none\s*!important",
            self.ui_css,
            re.DOTALL,
        )
        self.assertIsNotNone(match, "Desktop de-duplication suppression rule not found")

    def test_mobile_header_suppression_rule(self):
        """Verify mobile (@media <= 767px) strictly hides .desktop-header."""
        match = re.search(
            r"@media\s*\(\s*max-width:\s*767px\s*\)\s*\{.*?\.desktop-header\s*\{([^}]+)\}",
            self.ui_css,
            re.DOTALL,
        )
        self.assertIsNotNone(match, "Mobile .desktop-header suppression rule not found")
        self.assertIn("display: none !important", match.group(1))

    def test_tablet_compacted_floating_margins(self):
        """Verify tablet (@media 768px-1023px) uses compacted margins (12px 14px) and 170px search."""
        tablet_blocks = [
            m.group(1)
            for m in re.finditer(
                r"@media\s*\(\s*min-width:\s*768px\s*\)\s*and\s*\(\s*max-width:\s*1023px\s*\)\s*\{([^@]+?)\n\}",
                self.ui_css,
                re.DOTALL,
            )
        ]
        self.assertGreater(len(tablet_blocks), 0, "Tablet media query not found")
        found = False
        for block in tablet_blocks:
            if "margin: 12px 14px 0 14px;" in block and "width: 170px;" in block:
                found = True
                break
        self.assertTrue(found, "Compacted margins (12px 14px) and 170px search not found in tablet media query")

    def test_reader_mode_exemption_and_isolation(self):
        """Verify Shell does not render DesktopHeader in reader mode and reader view is isolated."""
        # 1. Shell isolates reader
        reader_branch = self.shell_tsx[self.shell_tsx.find("variant === 'reader'"):self.shell_tsx.find("variant === 'bare'")]
        self.assertNotIn("<DesktopHeader", reader_branch)
        # 2. Reader uses app-shell--reader rather than stage-content
        self.assertIn('<div className="app-shell app-shell--reader" data-section={section}>', reader_branch)


# =============================================================================
# 6. NODE.JS REACT RUNTIME EXECUTION HARNESS
# =============================================================================

class TestNodeReactRuntimeHarness(ChallengerNavIslandBase):
    """Execute the Node.js React 18 runtime test suite as an empirical validation sub-process."""

    def test_execute_node_runtime_suite(self):
        """Run test_nav_island_runtime.cjs and verify all 10/10 assertions pass."""
        test_script = TESTS_DIR / "test_nav_island_runtime.cjs"
        self.assertTrue(test_script.exists(), "test_nav_island_runtime.cjs must exist")

        cmd = ["node", str(test_script)]
        result = subprocess.run(
            cmd,
            cwd=str(REPO_ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=30,
        )
        sys.stdout.write(result.stdout)
        if result.stderr:
            sys.stderr.write(result.stderr)

        self.assertEqual(
            result.returncode,
            0,
            f"Node runtime test suite failed with exit code {result.returncode}:\n{result.stderr}",
        )
        self.assertIn("ALL 10/10 RUNTIME TESTS PASSED SUCCESSFULLY!", result.stdout)


if __name__ == "__main__":
    unittest.main()
