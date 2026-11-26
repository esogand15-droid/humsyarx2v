# -*- coding: utf-8 -*-
"""Wave 3E verification: Student PWA bundle splitting, emblem WebP, SW v2, M1 media fix & PDF prefetch."""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STUDENT_DIR = ROOT / "apps" / "student"
DIST_DIR = STUDENT_DIR / "dist"
ASSETS_DIR = DIST_DIR / "assets"
PUBLIC_DIR = STUDENT_DIR / "public"
SRC_DIR = STUDENT_DIR / "src"


SW_HARNESS = r"""
const fs = require('fs');
const vm = require('vm');

const swCode = fs.readFileSync(process.argv[2], 'utf8');
const scope = process.argv[3];
const hasActive = process.argv[4] === '1';
const preExisting = JSON.parse(process.argv[5] || '[]');

const ORIGIN = 'https://example.test';
const store = new Map();
for (const k of preExisting) store.set(k, new Map());

const keyOf = (r) => (typeof r === 'string' ? new URL(r, ORIGIN + scope).href : r.url);

const caches = {
  async open(name) {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name);
    return {
      async add(req) {
        const res = await self.fetch(req);
        m.set(keyOf(req), res);
      },
      async put(req, res) {
        m.set(keyOf(req), res);
      },
      async match(req) {
        const res = m.get(keyOf(req));
        return res ? res.clone() : undefined;
      },
    };
  },
  async keys() { return [...store.keys()]; },
  async delete(name) { return store.delete(name); },
  async match(req) {
    for (const m of store.values()) {
      const res = m.get(keyOf(req));
      if (res) return res.clone();
    }
    return undefined;
  },
};

const listeners = {};
let skipped = 0;
let claimed = 0;
let network = 'online';
const netLog = [];

const self = {
  location: new URL(ORIGIN + scope + 'sw.js'),
  registration: {
    scope: ORIGIN + scope,
    active: hasActive ? { state: 'activated' } : null,
  },
  addEventListener: (t, fn) => {
    listeners[t] = listeners[t] || [];
    listeners[t].push(fn);
  },
  skipWaiting: async () => { skipped += 1; },
  clients: {
    claim: async () => { claimed += 1; },
  },
  fetch: async (req) => {
    const url = typeof req === 'string' ? new URL(req, ORIGIN + scope).href : req.url;
    netLog.push(url);
    if (network === 'offline') throw new TypeError('Failed to fetch');
    const u = new URL(url);
    if (u.pathname.startsWith('/api/web/reader/')) {
      return new Response('{"ok":true}', {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
      });
    }
    if (u.pathname === '/api/web/library/terms') {
      return new Response('{"terms":[1,2]}', {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' },
      });
    }
    if (u.pathname === '/api/web/private-item') {
      return new Response('{"secret":1}', {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=60' },
      });
    }
    return new Response('net:' + u.pathname, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  },
};

class SWRequest extends Request {
  constructor(input, init) {
    super(typeof input === 'string' ? new URL(input, self.location.href).href : input, init);
  }
}

const ctx = {
  self,
  caches,
  fetch: self.fetch,
  Request: SWRequest,
  Response,
  URL,
  Headers,
  setTimeout,
  clearTimeout,
  Promise,
  console,
};
vm.createContext(ctx);
vm.runInContext(swCode, ctx);

async function fire(type, extra = {}) {
  const pending = [];
  let responded = null;
  const ev = {
    ...extra,
    waitUntil: (p) => pending.push(p),
    respondWith: (p) => { responded = Promise.resolve(p); },
  };
  for (const fn of listeners[type] || []) fn(ev);
  await Promise.all(pending);
  return responded;
}

async function get(path, opts = {}) {
  const request = new Request(ORIGIN + path, { headers: opts.headers || {} });
  if (opts.mode) Object.defineProperty(request, 'mode', { value: opts.mode });
  const before = netLog.length;
  const p = await fire('fetch', { request });
  if (!p) return { handled: false };
  const res = await p;
  return {
    handled: true,
    status: res.status,
    body: await res.text(),
    hitNetwork: netLog.length > before,
  };
}

const cachedFor = (path) =>
  [...store.entries()]
    .filter(([, m]) => m.has(ORIGIN + path))
    .map(([name]) => name);

(async () => {
  const out = {};
  await fire('install');
  out.skippedAfterInstall = skipped;
  out.indexCachedOnInstall = cachedFor(scope + 'index.html');
  out.manifestCachedOnInstall = cachedFor(scope + 'manifest.webmanifest');

  await fire('activate');
  out.keysAfterActivate = await caches.keys();
  out.claimed = claimed;

  out.swFetch = await get(scope + 'sw.js');
  out.swAssetsFetch = await get(scope + 'sw-assets.json');

  out.drmOnline = await get('/api/web/reader/manifest/res/f1');
  out.drmCached = cachedFor('/api/web/reader/manifest/res/f1');

  out.privateApi = await get('/api/web/private-item');
  out.privateApiCached = cachedFor('/api/web/private-item');

  out.publicApi = await get('/api/web/library/terms');
  out.publicApiCached = cachedFor('/api/web/library/terms');

  out.asset1 = await get(scope + 'assets/index-AbCdEf12.js');
  out.asset2 = await get(scope + 'assets/index-AbCdEf12.js');

  out.navOnline = await get(scope + 'schedule', { mode: 'navigate' });

  network = 'offline';
  out.navOffline = await get(scope + 'schedule', { mode: 'navigate' });
  out.drmOffline = await get('/api/web/reader/manifest/res/f1');

  await fire('message', { data: { type: 'SKIP_WAITING' } });
  out.skippedAfterMessage = skipped;

  console.log(JSON.stringify(out));
})().catch((e) => {
  console.error((e && e.stack) || e);
  process.exit(1);
});
"""


class TestStudentPerfAndSwV2(unittest.TestCase):
    """Verify Wave 3E production build artifacts, bundle targets, images, and SW v2."""

    def test_dist_sw_build_hash_and_drm_preservation(self):
        sw_dist = DIST_DIR / "sw.js"
        self.assertTrue(sw_dist.is_file(), f"Missing {sw_dist}")
        sw_text = sw_dist.read_text(encoding="utf-8")

        self.assertNotIn("__SW_BUILD_ID__", sw_text, "Build hash placeholder was not replaced in dist/sw.js")
        m = re.search(r"const SW_BUILD_ID = '([0-9a-f]{8})';", sw_text)
        self.assertIsNotNone(m, "Expected 8-char hex SW_BUILD_ID in dist/sw.js")

        self.assertIn("DRM_AND_SECURE_REGEX", sw_text)
        self.assertIn("DRM_OFFLINE_PROTECTED", sw_text)
        self.assertIn("DRM_OFFLINE_RESPONSE", sw_text)
        self.assertIn("مشاهده جزوات محافظت‌شده نیازمند اتصال فعال به اینترنت است", sw_text)
        self.assertIn("503", sw_text)
        self.assertIn("no-store, no-cache, must-revalidate", sw_text)
        self.assertIn("cacheControl.includes('no-store')", sw_text)
        self.assertIn("cacheControl.includes('private')", sw_text)
        self.assertIn("path.startsWith('/api/')", sw_text)

    def test_dist_sw_assets_manifest_normalized_and_filtered(self):
        manifest_file = DIST_DIR / "sw-assets.json"
        self.assertTrue(manifest_file.is_file(), f"Missing {manifest_file}")
        entries = json.loads(manifest_file.read_text(encoding="utf-8"))
        self.assertIsInstance(entries, list)
        self.assertGreater(len(entries), 15)

        for entry in entries:
            self.assertNotIn("\\", entry, f"Windows backslash found in sw-assets.json: {entry}")
            self.assertFalse(entry.startswith("/"), f"Entry should be relative to base: {entry}")
            self.assertFalse(entry.startswith("public/"), f"Raw public/ prefix leaked: {entry}")
            self.assertFalse(entry.startswith("assets/assets/"), f"Duplicate assets/ prefix: {entry}")
            self.assertFalse(entry.endswith(".map"), f"Sourcemap leaked into sw-assets.json: {entry}")
            self.assertNotEqual(entry, "sw.js")
            self.assertNotEqual(entry, "sw-assets.json")
            self.assertNotEqual(entry, "ds-preview.html")
            self.assertNotEqual(entry, "index.html")

        self.assertTrue(any(e.startswith("assets/index-") and e.endswith(".js") for e in entries))
        self.assertTrue(any(e.startswith("assets/PdfView-") and e.endswith(".js") for e in entries))
        self.assertTrue(any(e.startswith("assets/MediaView-") and e.endswith(".js") for e in entries))
        self.assertIn("manifest.webmanifest", entries)
        self.assertIn("favicon-64.png", entries)
        self.assertIn("brand-app-icon.webp", entries)
        self.assertIn("brand-emblem-transparent.webp", entries)

    def test_bundle_size_and_code_splitting_targets(self):
        self.assertTrue(ASSETS_DIR.is_dir(), f"Missing {ASSETS_DIR}")
        files = {p.name: p for p in ASSETS_DIR.iterdir() if p.is_file()}

        index_js = [p for n, p in files.items() if n.startswith("index-") and n.endswith(".js")]
        self.assertEqual(len(index_js), 1, f"Expected 1 index JS chunk, got {index_js}")
        index_size = index_js[0].stat().st_size
        self.assertLessEqual(index_size, 210_000, f"index-*.js too large: {index_size} bytes")
        self.assertLessEqual(index_size, 190 * 1024, f"index-*.js exceeds 190 KB: {index_size} bytes")

        # Required lazy chunks
        for prefix in (
            "PdfView-",
            "MediaView-",
            "HomeScreen-",
            "ScheduleScreen-",
            "AiChatScreen-",
            "ReaderScreen-",
            "ExamHome-",
        ):
            self.assertTrue(
                any(n.startswith(prefix) and n.endswith(".js") for n in files),
                f"Missing lazy JS chunk starting with {prefix}",
            )

        # Emblem WebP < 35 KB (and no emblem-*.png)
        emblem_webp = [p for n, p in files.items() if n.startswith("emblem-") and n.endswith(".webp")]
        self.assertEqual(len(emblem_webp), 1, f"Expected 1 emblem WebP asset, got {emblem_webp}")
        self.assertLess(emblem_webp[0].stat().st_size, 35_000)
        self.assertLess(emblem_webp[0].stat().st_size, 25_000)

        emblem_png = [n for n in files if n.startswith("emblem-") and n.endswith(".png")]
        self.assertEqual(emblem_png, [], f"Old emblem PNG still emitted in dist/assets: {emblem_png}")

    def test_public_brand_images_optimized(self):
        for rel, limit in (
            ("brand-app-icon.webp", 25_000),
            ("brand-emblem-transparent.webp", 25_000),
            ("brand-app-icon.png", 50_000),
            ("brand-emblem-transparent.png", 50_000),
            ("brand-emblem-dark.png", 50_000),
            ("brand-logo.png", 50_000),
        ):
            f = PUBLIC_DIR / rel
            self.assertTrue(f.is_file(), f"Missing public asset: {f}")
            self.assertLess(f.stat().st_size, limit, f"{rel} too large: {f.stat().st_size}")

        # Icons for manifest.webmanifest remain intact
        for icon in ("icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png"):
            self.assertTrue((PUBLIC_DIR / icon).is_file())

    def test_source_contracts_perf_media_reader_sw(self):
        reader = (SRC_DIR / "screens" / "reader" / "ProtectedReaderView.tsx").read_text(encoding="utf-8")
        self.assertIn('decoding="async"', reader)
        self.assertIn("saveData", reader)
        self.assertIn("prefetchedUrlsRef", reader)

        media = (SRC_DIR / "screens" / "reader" / "MediaView.tsx").read_text(encoding="utf-8")
        self.assertIn("12_000", media)
        self.assertIn("10_000", media)
        self.assertIn("vstage__poster", media)

        brand = (SRC_DIR / "components" / "Brand.tsx").read_text(encoding="utf-8")
        self.assertIn("<picture", brand)
        self.assertIn('type="image/webp"', brand)

        sw_update = (SRC_DIR / "lib" / "swUpdate.ts").read_text(encoding="utf-8")
        for sym in ("registerStudentSW", "subscribeSwUpdate", "applySwUpdate"):
            self.assertIn(sym, sw_update)

        banner = (SRC_DIR / "components" / "SwUpdateBanner.tsx").read_text(encoding="utf-8")
        self.assertIn('data-section="brand"', banner)
        self.assertIn("نسخهٔ جدید هامزیار آماده است", banner)


@unittest.skipUnless(shutil.which("node"), "Node.js not available")
class TestStudentServiceWorkerRuntime(unittest.TestCase):
    """Execute built dist/sw.js in Node VM with mocked CacheStorage & fetch."""

    def _run_sw(self, has_active: bool, existing: list[str] | None = None) -> dict:
        sw_dist = DIST_DIR / "sw.js"
        with tempfile.TemporaryDirectory() as tmp:
            harness = Path(tmp) / "harness.js"
            harness.write_text(SW_HARNESS, encoding="utf-8")
            proc = subprocess.run(
                [
                    shutil.which("node"),
                    str(harness),
                    str(sw_dist),
                    "/student/",
                    "1" if has_active else "0",
                    json.dumps(existing or []),
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=30,
            )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return json.loads(proc.stdout.strip().splitlines()[-1])

    def test_first_install_and_runtime_policies(self):
        out = self._run_sw(has_active=False, existing=["shell-humsyar-student-00000000"])
        self.assertEqual(out["skippedAfterInstall"], 1)
        self.assertEqual(out["indexCachedOnInstall"], [], "index.html must never be precached on install")
        self.assertGreater(len(out["manifestCachedOnInstall"]), 0)
        self.assertEqual(out["claimed"], 1)
        self.assertNotIn("shell-humsyar-student-00000000", out["keysAfterActivate"])

        self.assertFalse(out["swFetch"]["handled"], "sw.js must bypass SW")
        self.assertFalse(out["swAssetsFetch"]["handled"], "sw-assets.json must bypass SW")

        self.assertEqual(out["drmOnline"]["status"], 200)
        self.assertEqual(out["drmCached"], [], "DRM route must never enter CacheStorage")
        self.assertEqual(out["privateApiCached"], [], "private API response must never be cached")
        self.assertGreater(len(out["publicApiCached"]), 0)

        self.assertTrue(out["asset1"]["hitNetwork"])
        self.assertFalse(out["asset2"]["hitNetwork"], "Hashed asset must be Cache-First on repeat")

        self.assertTrue(out["navOnline"]["hitNetwork"])
        self.assertEqual(out["navOffline"]["status"], 200)
        self.assertEqual(out["navOffline"]["body"], "net:/student/schedule")

        self.assertEqual(out["drmOffline"]["status"], 503)
        drm_payload = json.loads(out["drmOffline"]["body"])
        self.assertEqual(drm_payload["error"], "DRM_OFFLINE_PROTECTED")
        self.assertTrue(drm_payload["offline"])

    def test_returning_user_update_waits_for_skip_waiting(self):
        out = self._run_sw(has_active=True, existing=["shell-humsyar-student-old12345", "static-humsyar-student-old12345"])
        self.assertEqual(out["skippedAfterInstall"], 0, "Update must wait for user confirmation")
        self.assertEqual(out["skippedAfterMessage"], 1)

    def test_legacy_v4_migration_triggers_skip_waiting_and_cleanup(self):
        out = self._run_sw(has_active=True, existing=["static-humsyar-student-v4"])
        self.assertEqual(out["skippedAfterInstall"], 1)
        self.assertNotIn("static-humsyar-student-v4", out["keysAfterActivate"])


if __name__ == "__main__":
    unittest.main()
