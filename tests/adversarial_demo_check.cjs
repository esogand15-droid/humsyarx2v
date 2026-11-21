// Empirical Challenger test for isDemoCode & formatCrockfordCode

function isDemoCode(input) {
  if (!input) return false;
  const faDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  const arDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  let s = input.trim();
  for (let i = 0; i < 10; i++) {
    s = s.split(faDigits[i]).join(String(i)).split(arDigits[i]).join(String(i));
  }
  const clean = s.toUpperCase().replace(/[^0-9A-Z]/g, '');
  return (
    clean === '7K9M2P4X' ||
    clean === 'HY7K9M2P4X' ||
    clean.includes('7K9M2P4X') ||
    clean === 'DEMO' ||
    clean === 'HYDEMO' ||
    clean.startsWith('DEMO')
  );
}

function formatCrockfordCode(raw) {
  const faDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  const arDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  let s = raw.trim();
  for (let i = 0; i < 10; i++) {
    s = s.split(faDigits[i]).join(String(i)).split(arDigits[i]).join(String(i));
  }
  s = s.toUpperCase().replace(/\s+/g, '');

  let clean;
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
  if (clean.length <= 4) return 'HY-' + clean;
  return 'HY-' + clean.slice(0, 4) + '-' + clean.slice(4);
}

function checkLoginEligibility(raw) {
  const formatted = formatCrockfordCode(raw);
  const isDemo = isDemoCode(formatted);
  const cleanCode = formatted.replace(/[^0-9A-Z]/g, '').replace(/^HY/, '');
  const canRequest = cleanCode.length === 8 || isDemo;
  return { formatted, isDemo, cleanCode, canRequest };
}

const testCases = [
  { input: '7K9M-2P4X', expectedDemo: true },
  { input: '7k9m2p4x', expectedDemo: true },
  { input: '  7k9m-2p4x  ', expectedDemo: true },
  { input: '۷k۹m-۲p۴x', expectedDemo: true },
  { input: 'HY-7K9M-2P4X', expectedDemo: true },
  { input: 'DEMO', expectedDemo: true },
  { input: 'demo', expectedDemo: true },
  { input: 'HYDEMO', expectedDemo: true },
  { input: '', expectedDemo: false },
  { input: '12345678', expectedDemo: false },
  { input: 'random string', expectedDemo: false },
  // Additional boundary cases
  { input: 'HY-7k9m-2p4x', expectedDemo: true },
  { input: '۷K۹M2P۴X', expectedDemo: true },
  { input: '٠١٢٣٤٥٦٧', expectedDemo: false },
  { input: '   ', expectedDemo: false },
  { input: 'DEMO1234', expectedDemo: true },
];

console.log('=== TEST 1: Direct isDemoCode ===');
let passDirect = 0;
let failDirect = 0;
for (const tc of testCases) {
  const actual = isDemoCode(tc.input);
  const ok = actual === tc.expectedDemo;
  if (ok) passDirect++; else failDirect++;
  console.log(`${ok ? 'PASS' : 'FAIL'}: isDemoCode(${JSON.stringify(tc.input)}) = ${actual} (expected ${tc.expectedDemo})`);
}

console.log('\n=== TEST 2: Typing flow through formatCrockfordCode ===');
for (const tc of testCases) {
  const res = checkLoginEligibility(tc.input);
  console.log(`Input: ${JSON.stringify(tc.input)} -> formatted: "${res.formatted}" -> isDemo: ${res.isDemo}, canRequest: ${res.canRequest}`);
}

console.log(`\nSummary: Direct isDemoCode ${passDirect}/${testCases.length} passed.`);
if (failDirect > 0) process.exit(1);
