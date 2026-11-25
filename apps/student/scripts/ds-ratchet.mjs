#!/usr/bin/env node
// Design-system ratchet: counts style debt in apps/student/src and fails if any count rises.
//   npm run ds:ratchet              -> compare with ratchet.json (exit 1 on any increase)
//   npm run ds:ratchet -- --update  -> rewrite ratchet.json with the current counts (only after lowering them)
//   npm run ds:ratchet -- --files   -> also print the top offending files per rule
// Token definition files are excluded: they are the one place raw values are allowed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const SRC = path.join(APP, 'src');
const RATCHET = path.join(APP, 'ratchet.json');
const EXCLUDE = new Set(['design/tokens.css'].map((p) => path.join(SRC, p)));
const EXT = new Set(['.css', '.ts', '.tsx', '.js', '.jsx']);

const RULES = {
  hex: /#[0-9a-fA-F]{3,8}\b/g,
  rgba: /rgba?\(/g,
  important: /!important/g,
  inline: /style=\{\{/g,
  physical: /\b(?:margin|padding|border)-(?:left|right)\b|(?<![\w-])(?:left|right)\s*:|text-align:\s*(?:left|right)\b|float:\s*(?:left|right)\b/g,
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXT.has(path.extname(e.name)) && !EXCLUDE.has(p)) out.push(p);
  }
  return out;
}

const totals = Object.fromEntries(Object.keys(RULES).map((k) => [k, 0]));
const perFile = Object.fromEntries(Object.keys(RULES).map((k) => [k, []]));
for (const f of walk(SRC)) {
  // strip block comments so commented-out code doesn't count
  const text = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [k, re] of Object.entries(RULES)) {
    const n = (text.match(re) || []).length;
    totals[k] += n;
    if (n) perFile[k].push([path.relative(APP, f).replace(/\\/g, '/'), n]);
  }
}

const args = new Set(process.argv.slice(2));
if (args.has('--files')) {
  for (const [k, list] of Object.entries(perFile)) {
    console.log(`\n${k}:`);
    for (const [f, n] of list.sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(n).padStart(4)}  ${f}`);
  }
  console.log('');
}

if (args.has('--update') || !fs.existsSync(RATCHET)) {
  fs.writeFileSync(RATCHET, JSON.stringify({ $comment: 'Max allowed counts in apps/student/src (tokens.css excluded). Only ever lower these. See docs/design/DS_V2.md.', ...totals }, null, 2) + '\n');
  console.log('[ds:ratchet] wrote ratchet.json', totals);
  process.exit(0);
}

const base = JSON.parse(fs.readFileSync(RATCHET, 'utf8'));
let failed = false;
for (const k of Object.keys(RULES)) {
  const was = base[k] ?? 0;
  const now = totals[k];
  const mark = now > was ? 'FAIL' : now < was ? 'down' : 'ok';
  if (now > was) failed = true;
  console.log(`[ds:ratchet] ${k.padEnd(9)} ${String(now).padStart(5)} / ${String(was).padStart(5)}  ${mark}`);
}
if (failed) {
  console.error('[ds:ratchet] style debt increased. Use tokens / design/components.css instead (docs/design/DS_V2.md). Run with --files to locate.');
  process.exit(1);
}
if (Object.keys(RULES).some((k) => totals[k] < (base[k] ?? 0))) console.log('[ds:ratchet] counts went down — run `npm run ds:ratchet -- --update` and commit ratchet.json.');
