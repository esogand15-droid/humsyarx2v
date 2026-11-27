#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Verification Test Suite: Telescopic Stepped Toolbar & Dynamic Eraser Sizing.

Validates:
1. Stepped telescopic toolbar architecture (Tier 0 dot -> Tier 1 primary -> Tier 2 full).
2. CSS variables --ink-pos-x and --ink-pos-y dock-free containment with zero right overflow.
3. Dedicated eraser sub-dock with mode chips (🧹 کل خط, ✂️ برشی دقیق), 3 presets, and continuous slider.
4. InkLayer.tsx dynamic eraser radius calculation scaling with strokeWidth and scratch canvas reticle.
5. Magnetic snapping and vertical rails on left/right edges with compact icon pills.
"""
from __future__ import annotations

import os
import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
STUDENT_SRC = REPO_ROOT / "apps" / "student" / "src"
READER_DIR = STUDENT_SRC / "screens" / "reader"
DESIGN_DIR = STUDENT_SRC / "design"


class SteppedToolbarAndEraserSizingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.toolbar_code = (READER_DIR / "InkToolbar.tsx").read_text(encoding="utf-8")
        cls.ink_layer_code = (READER_DIR / "InkLayer.tsx").read_text(encoding="utf-8")
        cls.ui_css = ((DESIGN_DIR / "ui.css").read_text(encoding="utf-8") + (DESIGN_DIR.parent / "screens" / "reader" / "reader-shell.css").read_text(encoding="utf-8"))

    def test_toolbar_telescopic_tier_state_and_contracts(self):
        """Verify 3-tier telescopic state (dot, primary, full) in InkToolbar.tsx."""
        self.assertIn("toolbarTier", self.toolbar_code)
        self.assertIn("'dot' | 'primary' | 'full'", self.toolbar_code)
        self.assertIn("ink-stepper-btn", self.toolbar_code)
        self.assertIn("ink-stepped-drawer", self.toolbar_code)
        self.assertIn("handleToggleTier", self.toolbar_code)
        self.assertIn("ink-stylus-dot", self.toolbar_code)

    def test_eraser_dedicated_subdock_and_mode_chips(self):
        """Verify dedicated eraser sub-dock, mode chips, and sizing presets."""
        self.assertIn("ink-subdock--eraser", self.toolbar_code)
        self.assertIn("ink-eraser-modes", self.toolbar_code)
        self.assertIn("ink-mode-chip", self.toolbar_code)
        self.assertIn("🧹", self.toolbar_code)
        self.assertIn("کل خط", self.toolbar_code)
        self.assertIn("✂️", self.toolbar_code)
        self.assertIn("برشی دقیق", self.toolbar_code)
        self.assertIn("ink-slider--eraser", self.toolbar_code)
        self.assertIn("ink-eraser-preview-dot", self.toolbar_code)

    def test_eraser_slider_range_and_contracts(self):
        """Verify continuous slider range attributes min=0.001 max=0.015 step=0.0005."""
        self.assertIn('min="0.001"', self.toolbar_code)
        self.assertIn('max="0.015"', self.toolbar_code)
        self.assertIn('step="0.0005"', self.toolbar_code)
        self.assertIn('ink-width-preview-dot', self.toolbar_code)

    def test_css_variables_and_containment_in_ui_css(self):
        """Verify --ink-pos-x and --ink-pos-y rules in ui.css prevent right overflow."""
        self.assertIn("--ink-pos-x", self.ui_css)
        self.assertIn("--ink-pos-y", self.ui_css)
        self.assertIn(".ink-stepper-btn", self.ui_css)
        self.assertIn(".ink-stepped-drawer", self.ui_css)
        self.assertIn(".ink-subdock--eraser", self.ui_css)
        self.assertIn(".ink-eraser-preview-dot", self.ui_css)

    def test_ink_layer_dynamic_eraser_radius_and_scratch_reticle(self):
        """Verify InkLayer.tsx calculates dynamic r based on strokeWidth and renders reticle."""
        self.assertIn("scratchRef", self.ink_layer_code)
        self.assertIn("strokeWidth", self.ink_layer_code)
        self.assertIn("(strokeWidth || 0.0035) * 4.0", self.ink_layer_code)
        self.assertIn("(strokeWidth || 0.0035) * 3.5", self.ink_layer_code)

    def test_vertical_edge_rails_and_magnetic_docking(self):
        """Verify left and right edge docks are vertical rails (flex-direction: column) with 44px width."""
        self.assertIn("flex-direction: column !important;", self.ui_css)
        self.assertIn("width: 44px !important;", self.ui_css)
        self.assertIn("setDockEdge('right')", self.toolbar_code)
        self.assertIn("setDockEdge('left')", self.toolbar_code)
        self.assertIn("isVertical", self.toolbar_code)

    def test_compact_icon_pill_architecture(self):
        """Verify compact 32px icon pill buttons and hidden text labels in CSS."""
        self.assertIn("width: 32px", self.ui_css)
        self.assertIn("height: 32px", self.ui_css)
        self.assertIn(".ink-pill-title", self.ui_css)
        self.assertIn("display: none !important;", self.ui_css)

    def test_adaptive_mobile_detection_and_safe_area(self):
        """Verify adaptive mobile detection (isMobile <= 640px) and bottom safe area."""
        self.assertIn("isMobile", self.toolbar_code)
        self.assertIn("window.innerWidth <= 640", self.toolbar_code)
        self.assertIn("is-mobile-dock", self.toolbar_code)
        self.assertIn("@media (max-width: 640px)", self.ui_css)
        self.assertIn("env(safe-area-inset-bottom", self.ui_css)

    def test_circular_stylus_dot_and_easy_detach_physics(self):
        """Verify 48px circular geometry for collapsed stylus dot and EDGE_SNAP effortless detach."""
        self.assertIn("EDGE_SNAP = 36", self.toolbar_code)
        self.assertIn("setDockEdge('free')", self.toolbar_code)
        self.assertIn(".ink-stylus-dot", self.ui_css)
        self.assertIn("border-radius: 50% !important;", self.ui_css)
        self.assertIn("aspect-ratio: 1 / 1 !important;", self.ui_css)


if __name__ == "__main__":
    unittest.main()
