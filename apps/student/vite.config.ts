import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

/* ─────────────────────────────────────────────────────────────
   مسیر سرو: /student/  (تصمیم D-033)

   چرا نه /app/؟
   در مخزن هامزیار، /app/ از قبل به مینی‌اپ تلگرام (miniapp/dist)
   تعلق دارد. سرو کلاینت وب روی همان پیشوند، مینی‌اپ را shadow
   می‌کرد و کاربر مینی‌اپ صفحهٔ اشتباه می‌دید.

   namespace نهایی روی دامنه:
     /student/*  → کلاینت وب دانشجو (این بیلد)
     /app/*      → مینی‌اپ تلگرام
     /admin/*    → پنل مدیریت
     /api/*      → FastAPI

   base از VITE_BASE قابل تغییر است (مثلاً VITE_BASE=/ برای دامنهٔ جدا).
   ───────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────────────
   hook بیلد: لیست دقیق دارایی‌های استاتیک را می‌نویسد تا SW بتواند
   آن‌ها را پیش‌کش (precache) کند. پوشهٔ /api/* حذف می‌شود — API نباید
   جزو دارایی‌های استاتیک باشد (دادهٔ پویا).
   ───────────────────────────────────────────────────────────────────── */
function swAssetManifestPlugin() {
  return {
    name: 'vite-sw-asset-manifest',
    async writeBundle(outputOptions, bundle) {
      const distDir = outputOptions.dir;
      const entries: string[] = [];

      for (const fileName of Object.keys(bundle)) {
        if (fileName.endsWith('.map')) continue; // skip sourcemaps from SW
        if (/\.js$/.test(fileName) || /\.css$/.test(fileName) || fileName.includes('assets/')) {
          entries.push(path.join('assets', path.relative(distDir, path.join(outputOptions.dir, fileName))));
        }
      }

      // افزون بر assetها، public/ (manifest, icons, favicon) هم وارد فهرست می‌شود.
      const publicDir = path.join(process.cwd(), 'public');
      const walk = (dir: string, rel: string) => {
        const files = fs.readdirSync(dir, { withFileTypes: true });
        for (const f of files) {
          const p = path.join(dir, f.name);
          if (f.isDirectory()) walk(p, path.join(rel, f.name));
          else entries.push(path.join('public', rel, f.name));
        }
      };
      walk(publicDir, '');

      // normalize: مسیرهای نسبی -> مسیرهای ریشه‌ای
      const manifest = entries.map((e) => {
        if (e.startsWith('assets/') || e.startsWith('public/')) {
          const name = e.replace(/^assets\//, 'assets/').replace(/^public\//, '/');
          return name;
        }
        return e;
      });

      const sorted = [...new Set(manifest)].sort();
      fs.writeFileSync(
        path.join(distDir, 'sw-assets.json'),
        JSON.stringify(sorted, null, 2),
        'utf8',
      );
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE || '/student/',
  plugins: [react(), swAssetManifestPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    // dev: درخواست‌های /api به بک‌اند محلی FastAPI می‌روند تا
    // فرانت و بک روی یک origin دیده شوند (کوکی سشن کار کند).
    proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false } },
  },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
  build: { target: 'es2020', assetsInlineLimit: 0 },
});
