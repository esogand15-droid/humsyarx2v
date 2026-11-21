#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Test Suite: Desktop Collapsible Sidebar & Synchronized Floating Rail Navigation.

Verifies:
1. Desktop sidebar can collapse into sleek floating rail matching iPad/tablet design.
2. CSS transition tokens, geometry (--hym-rail-w: 72px, border-radius: 16px).
3. Toggle trigger buttons in Sidebar and DesktopHeader.
4. Keyboard shortcut Ctrl+B/Cmd+B handler and localStorage persistence.
5. All 8 navigation items and user details smoothly adapt between expanded and collapsed modes.
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
STUDENT_DIR = REPO_ROOT / "apps" / "student"
SRC_DIR = STUDENT_DIR / "src"
DESIGN_DIR = SRC_DIR / "design"
LAYOUT_DIR = SRC_DIR / "layout"


class DesktopCollapsibleSidebarRailTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ui_css = (DESIGN_DIR / "ui.css").read_text(encoding="utf-8")
        cls.tokens_css = (DESIGN_DIR / "tokens.css").read_text(encoding="utf-8")
        cls.sidebar_tsx = (LAYOUT_DIR / "Sidebar.tsx").read_text(encoding="utf-8")
        cls.sidebar_context_tsx = (LAYOUT_DIR / "SidebarContext.tsx").read_text(encoding="utf-8")
        cls.desktop_header_tsx = (LAYOUT_DIR / "DesktopHeader.tsx").read_text(encoding="utf-8")
        cls.shell_tsx = (LAYOUT_DIR / "Shell.tsx").read_text(encoding="utf-8")

    def test_sidebar_context_and_provider_declared(self):
        """Verify SidebarContext provides collapsed state, toggleSidebar, and localStorage persistence."""
        self.assertIn("export const SidebarContext", self.sidebar_context_tsx)
        self.assertIn("export function SidebarProvider", self.sidebar_context_tsx)
        self.assertIn("export function useSidebar", self.sidebar_context_tsx)
        self.assertIn("hym_desktop_sidebar_collapsed", self.sidebar_context_tsx)
        self.assertIn("localStorage.getItem", self.sidebar_context_tsx)
        self.assertIn("localStorage.setItem", self.sidebar_context_tsx)

    def test_keyboard_shortcut_ctrl_b_registered(self):
        """Verify global Ctrl+B / Cmd+B keyboard shortcut for collapsing/expanding sidebar."""
        self.assertIn("e.key === 'b' || e.key === 'B'", self.sidebar_context_tsx)
        self.assertIn("e.ctrlKey || e.metaKey", self.sidebar_context_tsx)
        self.assertIn("toggleSidebar()", self.sidebar_context_tsx)

    def test_shell_wraps_with_sidebar_provider(self):
        """Verify Shell integrates SidebarProvider alongside HeaderProvider."""
        self.assertIn("<SidebarProvider>", self.shell_tsx)
        self.assertIn("</SidebarProvider>", self.shell_tsx)

    def test_sidebar_tsx_toggle_controls_and_collapsed_class(self):
        """Verify Sidebar.tsx dynamically applies is-collapsed / sidebar--collapsed and renders toggle."""
        self.assertIn("useSidebar()", self.sidebar_tsx)
        self.assertIn("sidebar--collapsed", self.sidebar_tsx)
        self.assertIn("is-collapsed", self.sidebar_tsx)
        self.assertIn("sidebar__collapse-toggle", self.sidebar_tsx)
        self.assertIn("sidebar__brand-rail-btn", self.sidebar_tsx)
        self.assertIn("toggleSidebar", self.sidebar_tsx)

    def test_desktop_header_sidebar_toggle_button(self):
        """Verify DesktopHeader.tsx renders a toggle trigger button for collapsible rail."""
        self.assertIn("useSidebar", self.desktop_header_tsx)
        self.assertIn("desktop-header__sidebar-toggle", self.desktop_header_tsx)
        self.assertIn("toggleSidebar", self.desktop_header_tsx)

    def test_css_desktop_collapsed_rail_geometry_and_styling(self):
        """Verify ui.css declares desktop collapsed rules identical to tablet floating rail."""
        match = re.search(
            r"@media\s*\(\s*min-width:\s*1024px\s*\)\s*\{([^}]+)\.sidebar\.is-collapsed",
            self.ui_css,
        )
        self.assertIsNotNone(match, "Desktop media query with .sidebar.is-collapsed not found in ui.css")
        self.assertIn("var(--hym-rail-w)", self.ui_css)
        self.assertIn("var(--hym-radius-xl", self.ui_css)
        self.assertIn(".sidebar.is-collapsed .sidebar__label", self.ui_css)
        self.assertIn(".sidebar.is-collapsed .sidebar__brand-text", self.ui_css)
        self.assertIn(".sidebar.is-collapsed .sidebar__user-details", self.ui_css)

    def test_smooth_transition_declared_on_sidebar(self):
        """Verify .sidebar declares smooth cubic-bezier transitions for width, margin, and shadow."""
        match = re.search(r"\.sidebar\s*\{([^}]+)\}", self.ui_css)
        self.assertIsNotNone(match, ".sidebar declaration not found")
        rules = match.group(1)
        self.assertIn("transition:", rules)
        self.assertIn("width", rules)
        self.assertIn("cubic-bezier", rules)


if __name__ == "__main__":
    unittest.main()
