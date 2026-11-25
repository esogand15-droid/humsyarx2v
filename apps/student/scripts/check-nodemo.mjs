#!/usr/bin/env node
/* T4: fails the build if any demo/mock data reached the production bundle.
 *
 * Demo mode and mock data live in src/lib/demo.ts (plus src/lib/mockData.ts,
 * which is used only by tests) and are reachable only through a dynamic
 * import inside `if (import.meta.env.DEV)`. In a production build that branch is
 * constant-false and gets eliminated, so none of these markers may appear in dist.
 *
 * Usage:  node scripts/check-nodemo.mjs [distDir]      (default: ./dist)
 * Wired as `npm run check:nodemo` and run automatically after `npm run build`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(process.argv[2] || path.join(here, '..', 'dist'));

/** Markers that exist only in the demo/mock code. Each one is specific enough
 *  that it never appears in real UI text. */
export const MARKERS = [
  // demo-mode plumbing
  'humsyar_demo_active',
  'getMockResponse',
  'isDemoRequest',
  'isDemoCode',
  'setDemoMode',
  // demo login codes / ids
  '7K9M2P4X',
  'HYDEMO',
  'ch_demo_active',
  'sess_demo_1',
  'mock_sess_active',
  'CARDIO-MOCK-20',
  'pdf_cardio_01',
  'demo_user',
  // fake leaderboard and profile (Persian names)
  'سارا محمدی',
  'امیرحسین رضوی',
  'نیلوفر عباسی',
  'پویا کریمی',
  'علی رضایی',
  // fake PDF page (inline SVG data URL). Note: «هامزیار Medical-AI» is real
  // branding (SystemScreen), so it must NOT be a marker; the SVG has its own unique text.
  'دیاگرام نوار قلب ECG',
  'الکتروفیزیولوژی هدایت قلبی',
];

const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.json', '.map', '.svg', '.txt', '.webmanifest']);

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (TEXT_EXT.has(path.extname(ent.name).toLowerCase())) out.push(p);
  }
  return out;
}

function main() {
  if (!fs.existsSync(dist) || !fs.statSync(dist).isDirectory()) {
    console.error(`[check:nodemo] dist not found: ${dist} (run the build first)`);
    process.exit(2);
  }
  const files = walk(dist);
  const hits = [];
  for (const f of files) {
    // sourcemaps carry the full source text (including the DEV-only branch); the bundle itself is what ships
    if (f.endsWith('.map')) continue;
    const text = fs.readFileSync(f, 'utf8');
    for (const m of MARKERS) {
      if (text.includes(m)) hits.push({ file: path.relative(dist, f), marker: m });
    }
  }
  if (hits.length) {
    console.error(`[check:nodemo] FAIL: ${hits.length} demo/mock marker(s) found in the production bundle:`);
    for (const h of hits) console.error(`  - ${h.file}: "${h.marker}"`);
    console.error('Demo/mock code must load only under import.meta.env.DEV through a dynamic import.');
    process.exit(1);
  }
  console.log(`[check:nodemo] OK: ${files.length} file(s) in ${path.relative(process.cwd(), dist) || dist}, 0 demo/mock markers.`);
}

main();
