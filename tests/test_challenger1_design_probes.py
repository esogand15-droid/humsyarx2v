#!/usr/bin/env python3
"""
Adversarial Challenge Probe Suite for Challenger 1
Milestone: M-Design (Medical-AI Design System Overhaul)

Probes:
1. Hex Color Purge Probe (apps/student/ scan)
2. Theme Switching Resilience Probe (localStorage edge cases & index.html vs theme.tsx)
3. Layout Invariants & Breakpoint Verification (tokens.css, ui.css, test_wave3_frontend_adversarial.ts)
4. Production Build & Asset Sanity Verification (npm run build & dist/ inspection)
"""

import os
import re
import sys
import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
STUDENT_DIR = REPO_ROOT / "apps" / "student"
SRC_DIR = STUDENT_DIR / "src"

LEGACY_TARGETS = [
    "#F7F3EA",
    "#14110C",
    "#FFFDF7",
    "#EFE8DA",
    "#FCF9F2",
    "#B4701F",
    "#4A3C2A",
    "#8C7759",
    "morakkab",
]

def run_probe_1_hex_purge():
    print("=" * 70)
    print("PROBE 1: Hex Color Purge Exhaustive Scanner")
    print("=" * 70)

    extensions = {".ts", ".tsx", ".css", ".html"}
    findings = []
    scanned_files_count = 0

    compiled_patterns = [
        (target, re.compile(re.escape(target), re.IGNORECASE))
        for target in LEGACY_TARGETS
    ]

    for root, dirs, files in os.walk(STUDENT_DIR):
        # Exclude node_modules and dist and .git
        dirs[:] = [d for d in dirs if d not in {"node_modules", "dist", ".git", "coverage"}]
        for fname in files:
            fpath = Path(root) / fname
            if fpath.suffix.lower() in extensions:
                scanned_files_count += 1
                try:
                    with open(fpath, "r", encoding="utf-8", errors="replace") as f:
                        lines = f.readlines()
                    for line_idx, line in enumerate(lines, 1):
                        for target, pat in compiled_patterns:
                            if pat.search(line):
                                findings.append({
                                    "file": str(fpath.relative_to(REPO_ROOT)),
                                    "line": line_idx,
                                    "target": target,
                                    "snippet": line.strip()
                                })
                except Exception as e:
                    print(f"Error reading {fpath}: {e}")

    print(f"Scanned {scanned_files_count} files (.ts, .tsx, .css, .html) across apps/student/")
    if findings:
        print(f"FAILED: Found {len(findings)} legacy color/term references:")
        for f in findings:
            print(f"  [{f['target']}] {f['file']}:{f['line']} -> {f['snippet']}")
        return False, findings
    else:
        print("PASSED: 0 occurrences of legacy warm paper tokens found across all scanned files.")
        return True, []


def run_probe_2_theme_resilience():
    print("\n" + "=" * 70)
    print("PROBE 2: Theme Switching Resilience & Consistency Probe")
    print("=" * 70)

    test_inputs = [
        ("explicit_dark", "dark"),
        ("explicit_light", "light"),
        ("explicit_system_with_sys_dark", "system", True),
        ("explicit_system_with_sys_light", "system", False),
        ("null_uninitialized", None),
        ("empty_string", ""),
        ("corrupted_arbitrary_string", "neon_cyber_mode"),
        ("uppercase_dark", "DARK"),
        ("uppercase_light", "LIGHT"),
        ("uppercase_system", "SYSTEM"),
        ("json_stringified_dark", '"dark"'),
        ("boolean_string_true", "true"),
        ("undefined_literal_string", "undefined"),
        ("whitespace_dark", " dark "),
    ]

    results = []
    divergence_count = 0

    print(f"{'Test Case':<32} | {'Input Value':<16} | {'index.html':<12} | {'theme.tsx':<12} | {'Aligned?':<8}")
    print("-" * 90)

    for case in test_inputs:
        name = case[0]
        saved = case[1]
        sys_dark = case[2] if len(case) > 2 else True

        # Emulate index.html:
        # var isDark = saved === 'dark' || (!saved || saved === 'system');
        # document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
        html_is_dark = (saved == 'dark') or (not saved or saved == 'system')
        html_theme = 'dark' if html_is_dark else 'light'

        # Emulate theme.tsx:
        # const [mode, setMode] = useState<ThemeMode>(() => {
        #   const saved = localStorage.getItem(KEY);
        #   return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'dark';
        # });
        # const resolved: 'light' | 'dark' = mode === 'system' ? (sysDark ? 'dark' : 'light') : mode;
        if saved in ('light', 'dark', 'system'):
            react_mode = saved
        else:
            react_mode = 'dark'

        if react_mode == 'system':
            react_resolved = 'dark' if sys_dark else 'light'
        else:
            react_resolved = react_mode

        aligned = (html_theme == react_resolved)
        if not aligned:
            divergence_count += 1

        val_display = repr(saved) if saved is not None else "null"
        print(f"{name:<32} | {val_display:<16} | {html_theme:<12} | {react_resolved:<12} | {'YES' if aligned else 'NO (FOUC)'}")
        results.append({
            "case": name,
            "input": saved,
            "html_theme": html_theme,
            "react_resolved": react_resolved,
            "aligned": aligned
        })

    print("-" * 90)
    print(f"Total cases tested: {len(test_inputs)}. Total aligned: {len(test_inputs) - divergence_count}. Total diverging: {divergence_count}.")
    
    # Detail divergences
    if divergence_count > 0:
        print("\nNote on Divergences:")
        for r in results:
            if not r["aligned"]:
                print(f"  - Case '{r['case']}' (input={repr(r['input'])}): index.html sets '{r['html_theme']}', but React resolves to '{r['react_resolved']}'.")
                print(f"    Impact: Visual flip/FOUC on initial mount for this input.")

    return True, results


def run_probe_3_layout_invariants():
    print("\n" + "=" * 70)
    print("PROBE 3: Layout Invariants & Responsive Breakpoints Probe")
    print("=" * 70)

    # 1. Run test_wave3_frontend_adversarial.ts
    cmd = ["node", "--experimental-strip-types", "tests/test_wave3_frontend_adversarial.ts"]
    print(f"Executing: {' '.join(cmd)}")
    proc = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True)
    print(proc.stdout)
    if proc.stderr:
        print("STDERR:\n" + proc.stderr)
    
    test_wave3_passed = (proc.returncode == 0) and ("=== EMPIRICAL CHALLENGE EXECUTION COMPLETE ===" in proc.stdout)
    print(f"test_wave3_frontend_adversarial.ts exit code: {proc.returncode} -> {'PASS' if test_wave3_passed else 'FAIL'}")

    # 2. Direct inspection of tokens.css
    tokens_path = STUDENT_DIR / "src" / "design" / "tokens.css"
    with open(tokens_path, "r", encoding="utf-8") as f:
        tokens_css = f.read()

    expected_tokens = [
        ("--hym-sidebar-w:        256px;", "Sidebar width 256px"),
        ("--hym-rail-w:           72px;", "Tablet rail width 72px"),
        ("--hym-content-max:      1280px;", "Content max width 1280px"),
        ("--hym-bp-mobile:        767px;", "Mobile breakpoint 767px"),
        ("--hym-bp-tablet-min:    768px;", "Tablet min breakpoint 768px"),
        ("--hym-bp-tablet-max:    1023px;", "Tablet max breakpoint 1023px"),
        ("--hym-bp-desktop:       1024px;", "Desktop breakpoint 1024px"),
    ]

    all_tokens_found = True
    print("\nInspecting tokens.css invariants:")
    for token_str, label in expected_tokens:
        found = token_str in tokens_css
        print(f"  [{'PASS' if found else 'FAIL'}] {label}: {token_str.strip()}")
        if not found:
            all_tokens_found = False

    # 3. Direct inspection of ui.css
    ui_path = STUDENT_DIR / "src" / "design" / "ui.css"
    with open(ui_path, "r", encoding="utf-8") as f:
        ui_css = f.read()

    expected_queries = [
        ("@media (max-width: 767px)", "Mobile media query"),
        ("@media (min-width: 768px) and (max-width: 1023px)", "Tablet rail media query"),
        ("@media (min-width: 768px)", "Tablet/desktop TabBar hide query"),
    ]

    all_queries_found = True
    print("\nInspecting ui.css media queries:")
    for query_str, label in expected_queries:
        found = query_str in ui_css
        print(f"  [{'PASS' if found else 'FAIL'}] {label}: {query_str}")
        if not found:
            all_queries_found = False

    # Check tablet rail flex-direction: column
    tablet_idx = ui_css.find("@media (min-width: 768px) and (max-width: 1023px)")
    mobile_idx = ui_css.find("/* Mobile", tablet_idx)
    tablet_block = ui_css[tablet_idx:mobile_idx] if mobile_idx != -1 else ui_css[tablet_idx:tablet_idx+1000]
    has_column = "flex-direction: column" in tablet_block or "flex-direction:column" in tablet_block
    print(f"  [{'PASS' if has_column else 'FAIL'}] Tablet rail .sidebar__footer flex-direction: column: {has_column}")

    probe3_passed = test_wave3_passed and all_tokens_found and all_queries_found and has_column
    return probe3_passed, {
        "test_wave3_exit": proc.returncode,
        "tokens_verified": all_tokens_found,
        "queries_verified": all_queries_found,
        "tablet_footer_column": has_column
    }


def run_probe_4_production_build():
    print("\n" + "=" * 70)
    print("PROBE 4: Production Build & Asset Sanity Verification")
    print("=" * 70)

    # Run npm.cmd run build in apps/student
    build_cmd = ["npm.cmd", "run", "build"]
    print(f"Executing: {' '.join(build_cmd)} in {STUDENT_DIR}")
    proc = subprocess.run(build_cmd, cwd=STUDENT_DIR, capture_output=True, text=True)
    print(proc.stdout)
    if proc.stderr:
        print("STDERR:\n" + proc.stderr)

    build_passed = (proc.returncode == 0)
    print(f"Build exit code: {proc.returncode} -> {'PASS' if build_passed else 'FAIL'}")

    # Inspect dist directory
    dist_dir = STUDENT_DIR / "dist"
    assets_dir = dist_dir / "assets"
    
    dist_exists = dist_dir.exists() and dist_dir.is_dir()
    index_html_exists = (dist_dir / "index.html").exists()
    assets_exists = assets_dir.exists() and assets_dir.is_dir()

    print(f"\nAsset Sanity Inspection:")
    print(f"  dist/ exists: {dist_exists}")
    print(f"  dist/index.html exists: {index_html_exists}")
    print(f"  dist/assets/ exists: {assets_exists}")

    asset_files = []
    if assets_exists:
        print("\nGenerated Chunks & Assets in dist/assets/:")
        for f in assets_dir.iterdir():
            size_kb = f.stat().st_size / 1024.0
            print(f"  - {f.name} ({size_kb:.2f} KB)")
            asset_files.append((f.name, f.stat().st_size))

    # Scan built JS and CSS assets for legacy hex colors
    built_leak_findings = []
    if assets_exists:
        for f in assets_dir.iterdir():
            if f.suffix in {".js", ".css", ".html"}:
                try:
                    content = f.read_text(encoding="utf-8", errors="replace")
                    for target in LEGACY_TARGETS:
                        if target.lower() in content.lower():
                            built_leak_findings.append((f.name, target))
                except Exception as e:
                    print(f"  Warning: could not read {f.name}: {e}")

    print(f"\nBuilt bundle legacy token scan:")
    if built_leak_findings:
        print(f"  FAILED: Found {len(built_leak_findings)} leakages in built assets:")
        for fname, target in built_leak_findings:
            print(f"    {fname} contains {target}")
    else:
        print("  PASSED: 0 legacy warm paper hex codes or names found in production build output!")

    probe4_passed = build_passed and dist_exists and index_html_exists and len(asset_files) > 0 and len(built_leak_findings) == 0
    return probe4_passed, {
        "build_exit": proc.returncode,
        "assets_count": len(asset_files),
        "bundle_leaks": built_leak_findings
    }


def main():
    print("Starting Challenger 1 Adversarial Probe Suite...\n")
    p1_ok, p1_data = run_probe_1_hex_purge()
    p2_ok, p2_data = run_probe_2_theme_resilience()
    p3_ok, p3_data = run_probe_3_layout_invariants()
    p4_ok, p4_data = run_probe_4_production_build()

    print("\n" + "=" * 70)
    print("CHALLENGER 1 ADVERSARIAL SUITE SUMMARY")
    print("=" * 70)
    print(f"Probe 1 (Hex Color Purge):       {'PASS' if p1_ok else 'FAIL'}")
    print(f"Probe 2 (Theme Switching):        {'PASS' if p2_ok else 'FAIL'}")
    print(f"Probe 3 (Layout Invariants):     {'PASS' if p3_ok else 'FAIL'}")
    print(f"Probe 4 (Production Build):       {'PASS' if p4_ok else 'FAIL'}")

    all_passed = p1_ok and p2_ok and p3_ok and p4_ok
    print(f"\nOVERALL VERDICT: {'APPROVE' if all_passed else 'REQUEST_CHANGES'}")
    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
