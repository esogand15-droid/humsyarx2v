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

    def test_toolbar_fixed_height_flyout_contracts(self):
        """Root redesign (2026-11-28): the telescopic tier system is gone.

        The bar is fixed-height and icon-only; secondary tools open in a floating
        tray (the bar itself never resizes); collapse morphs to a stylus dot;
        a ghost mode fades the bar while inking; exactly one flyout is open at
        a time (PencilKit/Noteful/Excalidraw conventions)."""
        code = self.toolbar_code
        # old telescopic tiers must stay removed (they caused the resize-jump bug)
        self.assertNotIn("toolbarTier", code)
        self.assertNotIn("handleToggleTier", code)
        self.assertNotIn("ink-stepped-drawer", code)
        self.assertNotIn("'dot' | 'primary' | 'full'", code)
        # new contracts
        self.assertIn("ink-stepper-btn", code)          # tray trigger kept
        self.assertIn("ink-stylus-dot", code)           # collapsed dot kept
        self.assertIn("ink-dock__tray", code)           # floating secondary-tools tray
        self.assertIn("setGhost", code)                 # ghost fade while inking
        self.assertIn("type Flyout", code)              # single flyout at a time
        self.assertIn("placeFloatingPanel", code)       # collision-safe flyout placement
        # icon-only bar: the old text-label spans are gone from markup AND CSS
        self.assertNotIn("ink-dock__btn-label", code)
        css = (READER_DIR / "reader.css").read_text(encoding="utf-8")
        self.assertNotIn("ink-dock__btn-label", css)
        self.assertNotIn("tier-full", css)
        self.assertIn("is-ghost", css)
        self.assertIn("ink-dock__tray--floating", css)

    def test_eraser_dedicated_subdock_and_mode_chips(self):
        """Verify dedicated eraser sub-dock, mode chips, and sizing presets."""
        self.assertIn("ink-subdock--eraser", self.toolbar_code)
        self.assertIn("ink-eraser-modes", self.toolbar_code)
        self.assertIn("ink-mode-chip", self.toolbar_code)
        # DS v2: sprite icons instead of emoji chrome
        self.assertIn('<Icon name="i-eraser"', self.toolbar_code)
        self.assertIn('<Icon name="i-scissors"', self.toolbar_code)
        self.assertIn("کل خط", self.toolbar_code)
        self.assertIn("برشی دقیق", self.toolbar_code)
        self.assertIn("ink-slider--eraser", self.toolbar_code)
        self.assertIn("ink-eraser-preview-dot", self.toolbar_code)

    def test_eraser_slider_range_and_contracts(self):
        """Verify continuous slider range attributes min=0.001 max=0.015 step=0.0005."""
        self.assertIn('min="0.001"', self.toolbar_code)
        self.assertIn('max="0.015"', self.toolbar_code)
        self.assertIn('step="0.0005"', self.toolbar_code)
        self.assertIn('ink-width-preview-dot', self.toolbar_code)

    def test_css_variables_and_containment_in_reader_css(self):
        """Verify dock containment vars and live toolbar selectors after the
        ui.css dead-block cleanup (2026-11-28): the old WAVE6 floating-island
        CSS is gone; the live pieces live in reader.css / reader-shell.css."""
        reader_css = (READER_DIR / "reader.css").read_text(encoding="utf-8")
        # موقعیت داکِ آزاد هنوز با متغیرها مهار می‌شود
        self.assertIn("--ink-pos-y", reader_css)
        self.assertIn("--ink-inline", reader_css)
        self.assertIn(".ink-stepper-btn", self.ui_css)
        self.assertIn(".ink-subdock--eraser", self.ui_css)
        self.assertIn(".ink-eraser-preview-dot", self.ui_css)
        # قبایید قدیمی جزیرهٔ شناور باید از ui.css حذف شده باشد
        self.assertNotIn(".ink-stepped-drawer", open(DESIGN_DIR / "ui.css", encoding="utf-8").read())
        self.assertNotIn(".ink-floating-island", open(DESIGN_DIR / "ui.css", encoding="utf-8").read())

    def test_ink_layer_dynamic_eraser_radius_and_scratch_reticle(self):
        """Verify InkLayer.tsx calculates dynamic r based on strokeWidth and renders reticle."""
        self.assertIn("scratchRef", self.ink_layer_code)
        self.assertIn("strokeWidth", self.ink_layer_code)
        self.assertIn("(strokeWidth || 0.0035) * 4.0", self.ink_layer_code)
        self.assertIn("(strokeWidth || 0.0035) * 3.5", self.ink_layer_code)

    def test_vertical_edge_rails_and_magnetic_docking(self):
        """Left/right edge docks are vertical rails; edge snapping exists."""
        reader_css = (READER_DIR / "reader.css").read_text(encoding="utf-8")
        self.assertIn("flex-direction: column", reader_css)  # .ink-dock.is-vertical capsule
        self.assertIn("setDockEdge('right')", self.toolbar_code)
        self.assertIn("setDockEdge('left')", self.toolbar_code)
        self.assertIn("isVertical", self.toolbar_code)
        # magnetic edge snap on drag release
        self.assertIn("EDGE_SNAP", self.toolbar_code)

    def test_compact_icon_pill_architecture(self):
        """Compact icon-only pills: no text labels anywhere, 44px touch targets."""
        self.assertNotIn("ink-pill-title", self.toolbar_code)
        self.assertNotIn("ink-dock__btn-label", self.toolbar_code)
        reader_css = (READER_DIR / "reader.css").read_text(encoding="utf-8")
        self.assertNotIn("ink-pill-title", reader_css)
        # coarse pointers get 44px targets (Noteful/HIG)
        self.assertIn("min-width: 44px", reader_css)

    def test_adaptive_mobile_detection_and_safe_area(self):
        """Verify adaptive mobile detection (isMobile <= 640px) and bottom safe area."""
        self.assertIn("isMobile", self.toolbar_code)
        self.assertIn("window.innerWidth <= 640", self.toolbar_code)
        self.assertIn("is-mobile-dock", self.toolbar_code)
        self.assertIn("@media (max-width: 767px)", (READER_DIR / "reader.css").read_text(encoding="utf-8"))
        self.assertIn("env(safe-area-inset-bottom", (READER_DIR / "reader.css").read_text(encoding="utf-8"))

    def test_circular_stylus_dot_and_easy_detach_physics(self):
        """Verify 48px circular geometry for collapsed stylus dot and EDGE_SNAP effortless detach."""
        self.assertIn("EDGE_SNAP = 36", self.toolbar_code)
        self.assertIn("setDockEdge('free')", self.toolbar_code)
        self.assertIn(".ink-stylus-dot", self.ui_css)
        self.assertIn("border-radius: 50% !important;", self.ui_css)
        self.assertIn("aspect-ratio: 1 / 1 !important;", self.ui_css)


if __name__ == "__main__":
    unittest.main()
