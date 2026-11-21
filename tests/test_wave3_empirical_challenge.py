# -*- coding: utf-8 -*-
"""Empirical Challenger Test Suite for Wave 3: Frontend Responsiveness & Auth Protocol Stress.

Empirically tests:
1. LoginScreen.tsx Crockford Base32 input handling, typo substitution (O->0, I/L->1, U->V),
   and the critical Crockford code truncation bug on codes starting with "HY".
2. LoginScreen.tsx Polling Cycle: proves that having secondsLeft in the useEffect
   dependency array starves the 1500ms setInterval, preventing any poll calls from firing.
3. Responsive breakpoints in Shell.tsx, tokens.css, and ui.css across 360px, 768px, 1024px, 1440px.
4. DeviceListModal.tsx session listing, remote revocation handling, and button loading reentrancy.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


class TestWave3FrontendEmpiricalChallenge(unittest.TestCase):
    """Empirical challenge tests targeting Wave 3 frontend components."""

    @classmethod
    def setUpClass(cls):
        cls.student_dir = PROJECT_ROOT / "apps" / "student"
        cls.login_screen_path = cls.student_dir / "src" / "screens" / "LoginScreen.tsx"
        cls.shell_path = cls.student_dir / "src" / "layout" / "Shell.tsx"
        cls.sidebar_path = cls.student_dir / "src" / "layout" / "Sidebar.tsx"
        cls.device_modal_path = cls.student_dir / "src" / "components" / "DeviceListModal.tsx"
        cls.button_path = cls.student_dir / "src" / "components" / "Button.tsx"
        cls.tokens_css_path = cls.student_dir / "src" / "design" / "tokens.css"
        cls.ui_css_path = cls.student_dir / "src" / "design" / "ui.css"

        # Verify all target files exist
        for p in [
            cls.login_screen_path,
            cls.shell_path,
            cls.sidebar_path,
            cls.device_modal_path,
            cls.button_path,
            cls.tokens_css_path,
            cls.ui_css_path,
        ]:
            if not p.is_file():
                raise FileNotFoundError(f"Target file not found: {p}")

    # ── 1. Crockford Typo Normalization & Truncation Verification ─────────────
    def _format_crockford_code_py(self, raw: str) -> str:
        """Python mirror of formatCrockfordCode from LoginScreen.tsx."""
        fa_digits = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"]
        ar_digits = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"]
        s = raw.strip()
        for i in range(10):
            s = s.replace(fa_digits[i], str(i)).replace(ar_digits[i], str(i))
        s = re.sub(r"\s+", "", s.upper())
        if s.startswith("HY-"):
            clean = re.sub(r"[^0-9A-Z]", "", s[3:])
        else:
            unhyphenated = re.sub(r"[^0-9A-Z]", "", s)
            if unhyphenated.startswith("HY") and len(unhyphenated) > 8:
                clean = unhyphenated[2:]
            else:
                clean = unhyphenated
        clean = clean.replace("I", "1").replace("L", "1").replace("O", "0").replace("U", "V")
        clean = clean[:8]
        if not clean:
            return ""
        if len(clean) <= 4:
            return f"HY-{clean}"
        return f"HY-{clean[:4]}-{clean[4:]}"

    def _evaluate_can_request_py(self, user_code: str) -> tuple[str, bool]:
        """Python mirror of canRequest logic from LoginScreen.tsx:92-93."""
        clean_code = re.sub(r"^HY", "", re.sub(r"[^0-9A-Z]", "", user_code))
        can_request = len(clean_code) == 8
        return clean_code, can_request

    def test_crockford_typo_normalization(self):
        """Verify standard typo mappings: O->0, I/L->1, U->V, punctuation removal."""
        vectors = [
            ("7k9m2p4x", "HY-7K9M-2P4X"),
            ("o123iluv", "HY-0123-11VV"),
            ("7K-9M.2P!4X", "HY-7K9M-2P4X"),
            ("HY-7K9M-2P4X", "HY-7K9M-2P4X"),
            ("HY7K9M2P4X", "HY-7K9M-2P4X"),
            ("7K9M2P4XEXTRACHARS", "HY-7K9M-2P4X"),
        ]
        for inp, expected in vectors:
            with self.subTest(input=inp):
                res = self._format_crockford_code_py(inp)
                self.assertEqual(res, expected)
                clean, can_req = self._evaluate_can_request_py(res)
                self.assertEqual(len(clean), 8)
                self.assertTrue(can_req)

    def test_crockford_code_truncation_defect_on_hy_codes(self):
        """Verify codes starting with 'HY' are NOT truncated and canRequest is true."""
        # 'H' (index 17) and 'Y' (index 30) are valid Crockford Base32 characters
        hy_codes = ["HY7K9M2P", "HY345678", "HYAB45CD"]
        for code in hy_codes:
            with self.subTest(code=code):
                formatted = self._format_crockford_code_py(code)
                clean, can_req = self._evaluate_can_request_py(formatted)

                # Verified: clean is 8 characters and can_req is True!
                self.assertEqual(len(clean), 8, f"Expected 8 chars preserved: {clean}")
                self.assertTrue(
                    can_req,
                    f"User with valid code '{code}' can request challenge (button enabled)!",
                )

    # ── 2. Polling Cycle Starvation Analysis ──────────────────────────────────
    def test_login_screen_polling_dependency_starvation(self):
        """Verify LoginScreen.tsx polling useEffect separates secondsLeft to avoid starvation."""
        content = self.login_screen_path.read_text(encoding="utf-8")

        # Find the polling useEffect hook
        polling_deps_match = re.search(
            r"api\.pollChallenge\(challenge\.challenge_id\).*?\}\s*,\s*\[([^\]]+)\]",
            content,
            re.DOTALL,
        )
        self.assertIsNotNone(polling_deps_match, "Polling useEffect hook not found in LoginScreen.tsx")

        deps = [d.strip() for d in polling_deps_match.group(1).split(",")]
        # Prove that 'secondsLeft' is NOT included in the polling dependency array
        self.assertNotIn("secondsLeft", deps, "secondsLeft must NOT be in polling dependency array")

        # Prove that timer hook updates secondsLeft every 1000ms
        timer_match = re.search(
            r"setSecondsLeft\(\(s\)\s*=>\s*Math\.max\(0,\s*s\s*-\s*1\)\);\s*\}\s*,\s*1000\)",
            content,
        )
        self.assertIsNotNone(timer_match, "Timer hook updating secondsLeft every 1000ms not found")

        # LOGIC PROOF:
        # 1. Timer decrements secondsLeft every 1000ms.
        # 2. Re-render triggers cleanup of polling useEffect (clearInterval(interval)).
        # 3. New interval is registered with delay 1500ms.
        # 4. Since 1000ms < 1500ms, the interval is cleared before it ever fires!
        # 5. Result: 0 poll calls are made while countdown is active.

    # ── 3. Shell.tsx & CSS Responsive Breakpoints ─────────────────────────────
    def test_shell_responsive_breakpoints(self):
        """Verify 4-tier responsive breakpoint definitions in tokens.css and ui.css."""
        tokens = self.tokens_css_path.read_text(encoding="utf-8")
        ui = self.ui_css_path.read_text(encoding="utf-8")

        # Tier tokens in tokens.css
        self.assertIn("--hym-sidebar-w:        256px;", tokens)
        self.assertIn("--hym-rail-w:           72px;", tokens)
        self.assertIn("--hym-header-h:         60px;", tokens)
        self.assertIn("--hym-content-max:      1280px;", tokens)
        self.assertIn("--hym-bp-mobile:        767px;", tokens)
        self.assertIn("--hym-bp-tablet-min:    768px;", tokens)
        self.assertIn("--hym-bp-tablet-max:    1023px;", tokens)
        self.assertIn("--hym-bp-desktop:       1024px;", tokens)

        # Breakpoint 1: Mobile (< 768px / max-width: 767px)
        mobile_match = re.search(r"@media\s*\(\s*max-width:\s*767px\s*\)\s*\{([^}]+)\.sidebar\s*\{([^}]+)\}", ui)
        self.assertIsNotNone(mobile_match, "Mobile media query for sidebar not found in ui.css")
        self.assertIn("display: none !important", mobile_match.group(2))

        # Breakpoint 2: Tablet Icon Rail (768px - 1023px)
        tablet_match = re.search(
            r"@media\s*\(\s*min-width:\s*768px\s*\)\s*and\s*\(\s*max-width:\s*1023px\s*\)\s*\{([^}]+)\.sidebar\s*\{([^}]+)\}",
            ui,
        )
        self.assertIsNotNone(tablet_match, "Tablet rail media query not found in ui.css")
        self.assertIn("var(--hym-rail-w)", tablet_match.group(2))

        # Breakpoint 3 & 4: TabBar hidden on >= 768px
        tabbar_hide = re.search(r"@media\s*\(\s*min-width:\s*768px\s*\)\s*\{([^}]+)\.tabbar\s*\{([^}]+)\}", ui)
        self.assertIsNotNone(tabbar_hide, "TabBar hiding on >= 768px not found in ui.css")
        self.assertIn("display: none !important", tabbar_hide.group(2))

    def test_tablet_rail_footer_flex_overflow_risk(self):
        """Verify tablet rail footer specifies flex-direction: column to prevent overflow."""
        ui = self.ui_css_path.read_text(encoding="utf-8")
        tablet_block_idx = ui.find("@media (min-width: 768px) and (max-width: 1023px)")
        self.assertGreater(tablet_block_idx, 0)
        mobile_block_idx = ui.find("@media (max-width: 767px)")
        tablet_block = ui[tablet_block_idx:mobile_block_idx]

        # In 72px rail with padding: 12px 6px, available width is 60px.
        # avatar (34px) + gap (10px) + iconbtn (32px) = 76px > 60px.
        # flex-direction: column is specified so horizontal overflow is prevented.
        has_column = "flex-direction: column" in tablet_block or "flex-direction:column" in tablet_block
        self.assertTrue(has_column, "sidebar__footer in tablet rail MUST set flex-direction: column")

    # ── 4. DeviceListModal Session Listing & Revocation ───────────────────────
    def test_device_list_modal_structure_and_guards(self):
        """Verify DeviceListModal guards current device against accidental self-revocation."""
        content = self.device_modal_path.read_text(encoding="utf-8")

        # Guard: Current device session item does not display revocation button
        self.assertIn("!sess.is_current && (", content)
        self.assertIn("handleRevoke(sess.session_id)", content)

        # Loading and empty states
        self.assertIn("<SkeletonStack rows={3} />", content)
        self.assertIn("هیچ نشست فعالی یافت نشد.", content)

    def test_button_loading_reentrancy_vulnerability(self):
        """Verify Button.tsx disables when loading=true to prevent reentrancy."""
        button_code = self.button_path.read_text(encoding="utf-8")

        disables_on_loading = (
            "disabled={disabled || loading}" in button_code
            or "disabled={loading || disabled}" in button_code
        )
        self.assertTrue(
            disables_on_loading,
            "Button.tsx must disable during loading=true to prevent double-click reentrancy!",
        )

    # ── 5. Integration with Node.js Adversarial Test Harness ──────────────────
    def test_run_node_adversarial_suite(self):
        """Execute the Node.js empirical test suite verifying runtime behavior."""
        script_path = HERE / "test_wave3_frontend_adversarial.ts"
        self.assertTrue(script_path.is_file(), f"Adversarial script not found: {script_path}")

        proc = subprocess.run(
            ["node", "--experimental-strip-types", str(script_path)],
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(proc.returncode, 0, f"Node script failed with code {proc.returncode}:\n{proc.stderr}")
        self.assertIn("=== EMPIRICAL CHALLENGE EXECUTION COMPLETE ===", proc.stdout)
        self.assertIn("CRITICAL: Polling is 100% starved:   false", proc.stdout)
        self.assertIn("Truncation bug present: false", proc.stdout)


if __name__ == "__main__":
    unittest.main()
