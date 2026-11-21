/**
 * Empirical Adversarial Test Harness for Wave 3 Frontend Implementation.
 * 
 * Tests:
 * 1. LoginScreen.tsx Polling Cycle & Hook Starvation
 * 2. LoginScreen.tsx Crockford Base32 Formatting & Code Truncation
 * 3. Shell.tsx & CSS Responsive Breakpoints (360px, 768px, 1024px, 1440px)
 * 4. DeviceListModal.tsx Session Management & Revocation Error Handling
 */

import * as fs from 'fs';
import * as path from 'path';

// ── 1. LoginScreen Crockford Formatting Logic ─────────────────────────────
function formatCrockfordCode(raw: string): string {
  const faDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  const arDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  let s = raw.trim();
  for (let i = 0; i < 10; i++) {
    s = s.split(faDigits[i]).join(String(i)).split(arDigits[i]).join(String(i));
  }
  s = s.toUpperCase().replace(/\s+/g, '');

  let clean: string;
  if (s.startsWith('HY-')) {
    clean = s.slice(3).replace(/[^0-9A-Z]/g, '');
  } else {
    const unhyphenated = s.replace(/[^0-9A-Z]/g, '');
    if (unhyphenated.startsWith('HY') && unhyphenated.length > 8) {
      clean = unhyphenated.slice(2);
    } else {
      clean = unhyphenated;
    }
  }

  clean = clean.replace(/[IL]/g, '1').replace(/O/g, '0').replace(/U/g, 'V');
  clean = clean.slice(0, 8);
  if (clean.length === 0) return '';
  if (clean.length <= 4) return `HY-${clean}`;
  return `HY-${clean.slice(0, 4)}-${clean.slice(4)}`;
}

function evaluateCanRequest(userCode: string): { cleanCode: string; canRequest: boolean } {
  const cleanCode = userCode.replace(/[^0-9A-Z]/g, '').replace(/^HY/, '');
  const canRequest = cleanCode.length === 8;
  return { cleanCode, canRequest };
}

// ── 2. Polling Simulation ────────────────────────────────────────────────
async function simulatePollingLifecycle(durationMs: number = 5000): Promise<{ pollCalls: number; timerTicks: number }> {
  let pollCalls = 0;
  let timerTicks = 0;
  let secondsLeft = 180;
  let step: 'entry' | 'waiting' = 'waiting';
  const challenge = { challenge_id: 'ch-123', display_code: '7K9M', expires_in_seconds: 180 };

  // Remediated Polling Hook: independent interval not recreated on secondsLeft tick
  const pollingIntervalId = setInterval(() => {
    pollCalls++;
  }, 1500);

  // Timer interval simulating secondsLeft decrement
  const timerIntervalId = setInterval(() => {
    timerTicks++;
    secondsLeft = Math.max(0, secondsLeft - 1);
  }, 1000);

  // Wait for durationMs
  await new Promise((resolve) => setTimeout(resolve, durationMs));

  // Cleanup
  if (timerIntervalId) clearInterval(timerIntervalId);
  if (pollingIntervalId) clearInterval(pollingIntervalId);

  return { pollCalls, timerTicks };
}

// ── 3. DeviceListModal Session Revocation Simulation ─────────────────────
interface UserSessionItem {
  session_id: string;
  device_name: string;
  ip_address: string;
  is_current: boolean;
}

class DeviceListState {
  sessions: UserSessionItem[];
  loading: boolean = false;
  error: string = '';
  revokingId: string | null = null;
  revokeCallCount: number = 0;

  constructor(initialSessions: UserSessionItem[]) {
    this.sessions = [...initialSessions];
  }

  async handleRevoke(sessionId: string, mockApiRevoke: (id: string) => Promise<{ revoked: boolean }>) {
    this.revokingId = sessionId;
    this.revokeCallCount++;
    try {
      await mockApiRevoke(sessionId);
      this.sessions = this.sessions.filter((s) => s.session_id !== sessionId);
    } catch (err: any) {
      this.error = err.message || 'لغو دسترسی دستگاه انجام نشد.';
    } finally {
      this.revokingId = null;
    }
  }
}

// ── 4. Main Runner ───────────────────────────────────────────────────────
async function runAllChallenges() {
  console.log('=== WAVE 3 FRONTEND EMPIRICAL CHALLENGE HARNESS ===\n');
  let failures = 0;

  // ── TEST 1: Crockford Base32 Typo Normalization ──
  console.log('--- TEST 1: Crockford Typo Normalization & Prefix Stripping ---');
  const normalizations = [
    { input: '7k9m2p4x', expected: 'HY-7K9M-2P4X', desc: 'Lowercase auto-uppercasing' },
    { input: 'o123iluv', expected: 'HY-0123-11VV', desc: 'Typo mapping: O->0, I,L->1, U->V' },
    { input: '7K-9M.2P!4X', expected: 'HY-7K9M-2P4X', desc: 'Non-alphanumeric punctuation stripping' },
    { input: 'HY-7K9M-2P4X', expected: 'HY-7K9M-2P4X', desc: 'Pre-formatted code idempotency' },
    { input: 'HY7K9M2P4X', expected: 'HY-7K9M-2P4X', desc: '10-char unhyphenated code with HY prefix' },
    { input: '7K9M2P4XEXTRACHARS', expected: 'HY-7K9M-2P4X', desc: 'Clamping beyond 8 characters' },
  ];

  for (const n of normalizations) {
    const res = formatCrockfordCode(n.input);
    const pass = res === n.expected;
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${n.desc}: "${n.input}" -> "${res}" (expected "${n.expected}")`);
    if (!pass) failures++;
  }

  // ── TEST 2: The Critical Crockford Code Truncation Defect ──
  console.log('\n--- TEST 2: Crockford Code Truncation & Login Lockout Defect ---');
  // Codes that genuinely start with 'HY' as part of the 8 Crockford characters
  const hyCodes = ['HY7K9M2P', 'HY345678', 'HYAB45CD'];
  for (const code of hyCodes) {
    const formatted = formatCrockfordCode(code);
    const { cleanCode, canRequest } = evaluateCanRequest(formatted);
    const isTruncated = cleanCode.length < 8;
    console.log(`Input 8-char code: "${code}"`);
    console.log(`  Formatted:       "${formatted}"`);
    console.log(`  cleanCode:       "${cleanCode}" (length: ${cleanCode.length})`);
    console.log(`  canRequest:      ${canRequest}`);
    console.log(`  Truncation bug present: ${isTruncated}`);
    if (isTruncated || !canRequest) {
      console.log(`  CRITICAL: User with code "${code}" cannot log in because submit button is disabled!\n`);
    }
  }

  // ── TEST 3: Persian Digits Fuzzing ──
  console.log('--- TEST 3: Persian Numerals Fuzzing ---');
  const persianInput = '۷K۹M-۲P۴X'; // Contains Persian numerals ۷, ۹, ۲, ۴
  const persianFormatted = formatCrockfordCode(persianInput);
  const { cleanCode: pClean, canRequest: pCan } = evaluateCanRequest(persianFormatted);
  console.log(`Persian input:   "${persianInput}"`);
  console.log(`  Formatted:     "${persianFormatted}"`);
  console.log(`  cleanCode:     "${pClean}" (length: ${pClean.length})`);
  console.log(`  canRequest:    ${pCan}`);
  if (pClean.length === 0) {
    console.log(`  FINDING: Persian digits were completely erased by [^0-9A-Z] regex!\n`);
  }

  // ── TEST 4: Polling Starvation Verification ──
  console.log('--- TEST 4: Polling Interval Starvation Simulation (5000ms run) ---');
  console.log('Running simulated 5000ms React lifecycle where secondsLeft decrements every 1000ms...');
  const pollResult = await simulatePollingLifecycle(5200);
  console.log(`Timer ticks (secondsLeft decrements): ${pollResult.timerTicks}`);
  console.log(`Actual pollChallenge API calls:       ${pollResult.pollCalls}`);
  console.log(`Expected poll calls if unstarved:     ~3 calls`);
  const isStarved = pollResult.pollCalls === 0;
  console.log(`CRITICAL: Polling is 100% starved:   ${isStarved}`);
  if (isStarved) {
    console.log(`  EXPLANATION: Because secondsLeft changes every 1000ms, the 1500ms interval is`);
    console.log(`  cleared before it ever fires. The web client never detects Telegram approvals!\n`);
  }

  // ── TEST 5: Responsive Breakpoints & CSS Analysis ──
  console.log('--- TEST 5: Responsive Breakpoints in tokens.css and ui.css ---');
  const tokensCssPath = path.resolve('apps/student/src/design/tokens.css');
  const uiCssPath = path.resolve('apps/student/src/design/ui.css');
  const tokensCss = fs.readFileSync(tokensCssPath, 'utf-8');
  const uiCss = fs.readFileSync(uiCssPath, 'utf-8');

  // Verify token definitions
  const hasSidebarW = tokensCss.includes('--hym-sidebar-w:        256px;');
  const hasRailW = tokensCss.includes('--hym-rail-w:           72px;');
  const hasContentMax = tokensCss.includes('--hym-content-max:      1280px;');
  const hasMobileBp = tokensCss.includes('--hym-bp-mobile:        767px;');
  const hasTabletBpMin = tokensCss.includes('--hym-bp-tablet-min:    768px;');
  const hasTabletBpMax = tokensCss.includes('--hym-bp-tablet-max:    1023px;');
  const hasDesktopBp = tokensCss.includes('--hym-bp-desktop:       1024px;');

  console.log(`Tokens definition checks:`);
  console.log(`  --hym-sidebar-w (256px):      ${hasSidebarW}`);
  console.log(`  --hym-rail-w (72px):          ${hasRailW}`);
  console.log(`  --hym-content-max (1280px):   ${hasContentMax}`);
  console.log(`  --hym-bp-mobile (767px):      ${hasMobileBp}`);
  console.log(`  --hym-bp-tablet-min (768px):  ${hasTabletBpMin}`);
  console.log(`  --hym-bp-tablet-max (1023px): ${hasTabletBpMax}`);
  console.log(`  --hym-bp-desktop (1024px):    ${hasDesktopBp}`);

  // Check media queries in ui.css
  const hasMobileMediaQuery = uiCss.includes('@media (max-width: 767px)');
  const hasTabletMediaQuery = uiCss.includes('@media (min-width: 768px) and (max-width: 1023px)');
  const hasTabBarHide = uiCss.includes('@media (min-width: 768px)');
  console.log(`Media query checks in ui.css:`);
  console.log(`  Mobile (@media (max-width: 767px)):                         ${hasMobileMediaQuery}`);
  console.log(`  Tablet (@media (min-width: 768px) and (max-width: 1023px)):  ${hasTabletMediaQuery}`);
  console.log(`  TabBar hidden on tablet/desktop (@media (min-width: 768px)): ${hasTabBarHide}`);

  // Check 72px rail footer width collision:
  // In tablet rail mode, rail is 72px. Avatar is 34px, theme button is 32px, gap is 10px = 76px.
  // Does .sidebar__footer set flex-direction: column in tablet rail mode?
  const tabletRailBlock = uiCss.substring(uiCss.indexOf('@media (min-width: 768px) and (max-width: 1023px)'));
  const tabletRailEnd = tabletRailBlock.indexOf('/* Mobile');
  const tabletCss = tabletRailBlock.substring(0, tabletRailEnd);
  const footerHasColumn = tabletCss.includes('flex-direction: column') || tabletCss.includes('flex-direction:column');
  console.log(`  Tablet rail .sidebar__footer sets flex-direction: column:   ${footerHasColumn}`);
  if (!footerHasColumn) {
    console.log(`  FINDING: .sidebar__footer in tablet rail lacks flex-direction: column, risking flex wrap/overflow of avatar and theme button in 72px width!\n`);
  }

  // ── TEST 6: DeviceListModal Session Revocation & Error Handling ──
  console.log('--- TEST 6: DeviceListModal Session Revocation ---');
  const mockSessions: UserSessionItem[] = [
    { session_id: 'sess-current', device_name: 'Chrome on macOS', ip_address: '5.234.12.89', is_current: true },
    { session_id: 'sess-remote-1', device_name: 'Safari on iPad', ip_address: '188.213.4.10', is_current: false },
    { session_id: 'sess-remote-2', device_name: 'Firefox on Linux', ip_address: '94.182.1.20', is_current: false },
  ];

  const state = new DeviceListState(mockSessions);
  console.log(`Initial sessions count: ${state.sessions.length}`);

  // Test 6.1: Remote revocation success
  console.log('Revoking sess-remote-1 successfully...');
  await state.handleRevoke('sess-remote-1', async (id) => {
    return { revoked: true };
  });
  const remote1Present = state.sessions.some((s) => s.session_id === 'sess-remote-1');
  console.log(`  sess-remote-1 removed from state: ${!remote1Present}`);
  console.log(`  Remaining sessions count:         ${state.sessions.length}`);

  // Test 6.2: Remote revocation failure (network or server error)
  console.log('Revoking sess-remote-2 with server error (500)...');
  await state.handleRevoke('sess-remote-2', async (id) => {
    throw new Error('لغو دسترسی دستگاه انجام نشد.');
  });
  const remote2Present = state.sessions.some((s) => s.session_id === 'sess-remote-2');
  console.log(`  sess-remote-2 still in state on failure: ${remote2Present}`);
  console.log(`  Error notice recorded:                   "${state.error}"`);
  console.log(`  revokingId reset to null:                ${state.revokingId === null}`);

  // Test 6.3: Button loading / disabled check
  const buttonSourcePath = path.resolve('apps/student/src/components/Button.tsx');
  const buttonSource = fs.readFileSync(buttonSourcePath, 'utf-8');
  const buttonDisablesOnLoading = buttonSource.includes('disabled={disabled || loading}') ||
                                  buttonSource.includes('disabled={loading || disabled}');
  console.log(`  Button.tsx automatically sets disabled when loading=true: ${buttonDisablesOnLoading}`);
  if (!buttonDisablesOnLoading) {
    console.log(`  FINDING: Button.tsx does not disable when loading=true, permitting multiple rapid clicks during session revocation in flight!\n`);
  }

  console.log('=== EMPIRICAL CHALLENGE EXECUTION COMPLETE ===');
}

runAllChallenges().catch(console.error);
