# -*- coding: utf-8 -*-
"""🧭 رفتار سرویسورکر واحد (miniapp/sw/sw.js) — اجرای واقعی در Node.

فایل خروجی بیلد نه، خودِ منبع با جایگزینی همان دو نشانگری که
vite.config.js پر میکند اجرا میشود؛ CacheStorage و fetch شبیهسازی
میشوند. اگر Node نصب نباشد تست رد (skip) میشود.

قوانین تحتپوشش:
  • /api/* و درخواست Range هرگز از کش جواب داده یا کش نمیشوند
  • پاسخ 206، no-store و private کش نمیشود
  • ناوبری: شبکه اول، در قطعی اینترنت کش، در نهایت صفحهٔ آفلاین
  • فایل hashدار /assets/: کش اول
  • نسخهٔ تازه خودش skipWaiting نمیکند مگر پیام SKIP_WAITING بیاید
  • activate کشهای بیلد قبلی همان scope را پاک میکند ولی به scope دیگر دست نمیزند
"""
from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SW_SRC = ROOT / "miniapp" / "sw" / "sw.js"

HARNESS = r"""
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync(process.argv[2], 'utf8')
  .replace("'__BUILD_ID__'", JSON.stringify(process.argv[3]))
  .replace('__PRECACHE__', process.argv[4]);
const scope = process.argv[5];
const preExisting = JSON.parse(process.argv[6] || '[]');

const ORIGIN = 'https://example.test';
const store = new Map();               // cacheName -> Map(url -> Response)
for (const k of preExisting) store.set(k, new Map());
const key = (r) => (typeof r === 'string' ? new URL(r, ORIGIN + scope).href : r.url);
const caches = {
  async open(name) {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name);
    return {
      async add(req) { const r = await self.fetch(req); m.set(key(req), r); },
      async put(req, res) { m.set(key(req), res); },
      async match(req) { const r = m.get(key(req)); return r ? r.clone() : undefined; },
    };
  },
  async keys() { return [...store.keys()]; },
  async delete(name) { return store.delete(name); },
  async match(req) {
    for (const m of store.values()) { const r = m.get(key(req)); if (r) return r.clone(); }
    return undefined;
  },
};

const listeners = {};
let skipped = 0;
let network = 'online';
const netLog = [];
const self = {
  location: new URL(ORIGIN + scope + 'sw.js'),
  registration: { scope: ORIGIN + scope },
  addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
  skipWaiting: async () => { skipped += 1; },
  clients: { claim: async () => {} },
  fetch: async (req) => {
    const url = typeof req === 'string' ? new URL(req, ORIGIN + scope).href : req.url;
    netLog.push(url);
    if (network === 'offline') throw new TypeError('Failed to fetch');
    const u = new URL(url);
    if (u.pathname.endsWith('/partial.mp4')) {
      return new Response('x', { status: 206, headers: { 'Content-Range': 'bytes 0-0/10' } });
    }
    if (u.pathname.endsWith('/secret.png')) {
      return new Response('s', { status: 200, headers: { 'Cache-Control': 'private, max-age=60' } });
    }
    return new Response('net:' + u.pathname, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  },
};
class SWRequest extends Request {
  constructor(input, init) {
    super(typeof input === 'string' ? new URL(input, self.location.href).href : input, init);
  }
}
const ctx = { self, caches, fetch: self.fetch, Request: SWRequest, Response, URL, Headers, setTimeout, clearTimeout, Promise, console };
vm.createContext(ctx);
vm.runInContext(src, ctx);

async function fire(type, extra = {}) {
  const pending = [];
  let responded = null;
  const ev = { ...extra, waitUntil: (p) => pending.push(p), respondWith: (p) => { responded = Promise.resolve(p); } };
  for (const fn of listeners[type] || []) fn(ev);
  await Promise.all(pending);
  return responded;
}
async function get(path, opts = {}) {
  const request = new Request(ORIGIN + path, { headers: opts.headers || {} });
  Object.defineProperty(request, 'mode', { value: opts.mode || 'cors' });
  const before = netLog.length;
  const p = await fire('fetch', { request });
  if (!p) return { handled: false };
  const res = await p;
  return { handled: true, status: res.status, body: await res.text(), hitNetwork: netLog.length > before };
}
const cachedIn = (path) => [...store.entries()].filter(([, m]) => m.has(ORIGIN + path)).map(([k]) => k);

(async () => {
  const out = {};
  await fire('install');
  out.skippedAfterInstall = skipped;
  await fire('activate');
  out.keysAfterActivate = [...store.keys()].sort();

  out.api = await get('/api/profile');
  out.range = await get(scope + 'assets/video-abcdef12.js', { headers: { Range: 'bytes=0-' } });
  out.partial = await get(scope + 'icons/partial.mp4');
  out.partialCached = cachedIn(scope + 'icons/partial.mp4');
  out.privateRes = await get(scope + 'icons/secret.png');
  out.privateCached = cachedIn(scope + 'icons/secret.png');

  out.asset1 = await get(scope + 'assets/index-AbCdEf12.js');
  out.asset2 = await get(scope + 'assets/index-AbCdEf12.js');

  out.navOnline = await get(scope + 'schedule', { mode: 'navigate' });
  out.otherScopeNav = await get('/admin/', { mode: 'navigate' });
  network = 'offline';
  out.navOffline = await get(scope + 'schedule', { mode: 'navigate' });

  await fire('message', { data: { type: 'SKIP_WAITING' } });
  out.skippedAfterMessage = skipped;
  console.log(JSON.stringify(out));
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
"""


def _node() -> str | None:
    return shutil.which("node")


@unittest.skipUnless(_node(), "Node.js در دسترس نیست")
class ServiceWorkerBehaviour(unittest.TestCase):
    PRECACHE = ["./", "./manifest.webmanifest", "./icons/icon-192.png"]

    def run_sw(self, scope="/app/", build="newbuild0001", precache=None, existing=()):
        with tempfile.TemporaryDirectory() as tmp:
            harness = Path(tmp) / "harness.js"
            harness.write_text(HARNESS, encoding="utf-8")
            proc = subprocess.run(
                [_node(), str(harness), str(SW_SRC), build,
                 json.dumps(precache or self.PRECACHE), scope, json.dumps(list(existing))],
                capture_output=True, text=True, encoding="utf-8", timeout=60,
            )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return json.loads(proc.stdout.strip().splitlines()[-1])

    def test_private_and_media_traffic_is_never_cached(self):
        out = self.run_sw()
        self.assertFalse(out["api"]["handled"], "/api/* باید مستقیم به شبکه برود")
        self.assertFalse(out["range"]["handled"], "درخواست Range نباید از سرویسورکر رد شود")
        self.assertEqual(out["partialCached"], [], "پاسخ 206 کش شد")
        self.assertEqual(out["privateCached"], [], "پاسخ private کش شد")

    def test_hashed_assets_are_cache_first(self):
        out = self.run_sw()
        self.assertTrue(out["asset1"]["hitNetwork"])
        self.assertFalse(out["asset2"]["hitNetwork"], "بار دوم باید از کش بیاید")

    def test_navigation_is_network_first_with_offline_fallback(self):
        out = self.run_sw(scope="/pwa/", precache=self.PRECACHE + ["./offline.html"])
        self.assertTrue(out["navOnline"]["hitNetwork"])
        self.assertEqual(out["navOnline"]["body"], "net:/pwa/schedule")
        # آفلاین: آخرین پوستهٔ دیدهشده
        self.assertEqual(out["navOffline"]["status"], 200)
        self.assertEqual(out["navOffline"]["body"], "net:/pwa/schedule")
        # ناوبری بیرون از scope دست نمیخورد
        self.assertFalse(out["otherScopeNav"]["handled"])

    def test_no_automatic_skip_waiting_mid_session(self):
        out = self.run_sw()
        self.assertEqual(out["skippedAfterInstall"], 0)
        self.assertEqual(out["skippedAfterMessage"], 1)

    def test_one_time_migration_from_legacy_hand_named_cache(self):
        out = self.run_sw(existing=["humsyar-v5-20261029"])
        self.assertEqual(out["skippedAfterInstall"], 1)
        self.assertNotIn("humsyar-v5-20261029", out["keysAfterActivate"])

    def test_activate_removes_old_builds_of_same_scope_only(self):
        out = self.run_sw(existing=[
            "humsyar-app-oldbuild0000-shell",
            "humsyar-app-oldbuild0000-assets",
            "humsyar-pwa-otherbuild00-shell",
        ])
        keys = out["keysAfterActivate"]
        self.assertNotIn("humsyar-app-oldbuild0000-shell", keys)
        self.assertNotIn("humsyar-app-oldbuild0000-assets", keys)
        self.assertIn("humsyar-pwa-otherbuild00-shell", keys, "کش /pwa/ نباید پاک شود")
        self.assertIn("humsyar-app-newbuild0001-shell", keys)


class ServiceWorkerSingleSource(unittest.TestCase):
    def test_old_diverging_copies_are_gone(self):
        self.assertTrue(SW_SRC.is_file())
        self.assertFalse((ROOT / "miniapp" / "public" / "sw.js").exists())
        self.assertFalse((ROOT / "miniapp" / "public-pwa" / "sw.js").exists())

    def test_vite_generates_sw_with_build_id(self):
        cfg = (ROOT / "miniapp" / "vite.config.js").read_text(encoding="utf-8")
        self.assertIn("unifiedServiceWorker", cfg)
        self.assertIn("__BUILD_ID__", cfg)
        self.assertIn("__PRECACHE__", cfg)


if __name__ == "__main__":
    unittest.main()
