import { defineConfig, type Plugin, type ResolvedConfig } from 'vite';
import react from '@vitejs/plugin-react';
import crypto from 'node:crypto';
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
   آن‌ها را مدیریت کند و یک شناسهٔ بیلد SHA-256 برای sw.js می‌سازد.
   ───────────────────────────────────────────────────────────────────── */
function swAssetManifestPlugin(): Plugin {
  let publicDir = '';
  const EXCLUDED = new Set(['sw.js', 'sw-assets.json', 'ds-preview.html']);

  return {
    name: 'vite-sw-asset-manifest',
    configResolved(config: ResolvedConfig) {
      publicDir = config.publicDir;
    },
    async writeBundle(outputOptions, bundle) {
      const distDir = outputOptions.dir;
      if (!distDir) return;

      const entries: string[] = [];
      const hashEntries: Array<[string, Buffer | string]> = [];

      for (const [rawName, chunk] of Object.entries(bundle)) {
        const norm = rawName.replace(/\\/g, '/').replace(/^\/+/, '');
        if (norm.endsWith('.map')) continue;
        const body = chunk.type === 'chunk' ? chunk.code : chunk.source;
        hashEntries.push([norm, typeof body === 'string' ? body : Buffer.from(body)]);
        if (EXCLUDED.has(norm) || norm === 'index.html') continue;
        entries.push(norm);
      }

      // افزون بر assetها، public/ (manifest, icons, favicon, brand) هم وارد فهرست می‌شود.
      if (publicDir && fs.existsSync(publicDir)) {
        const walk = (dir: string, rel: string) => {
          const files = fs.readdirSync(dir, { withFileTypes: true });
          for (const f of files) {
            const p = path.join(dir, f.name);
            const nextRel = rel ? `${rel}/${f.name}` : f.name;
            if (f.isDirectory()) {
              walk(p, nextRel);
            } else {
              const norm = nextRel.replace(/\\/g, '/').replace(/^\/+/, '');
              if (norm.endsWith('.map')) continue;
              hashEntries.push([norm, fs.readFileSync(p)]);
              if (EXCLUDED.has(norm)) continue;
              entries.push(norm);
            }
          }
        };
        walk(publicDir, '');
      }

      const sorted = [...new Set(entries)].sort();
      fs.writeFileSync(
        path.join(distDir, 'sw-assets.json'),
        JSON.stringify(sorted, null, 2) + '\n',
        'utf8',
      );

      hashEntries.sort((a, b) => a[0].localeCompare(b[0]));
      const hasher = crypto.createHash('sha256');
      for (const [name, content] of hashEntries) {
        hasher.update(name);
        hasher.update('\0');
        hasher.update(content);
        hasher.update('\n');
      }
      const buildHash = hasher.digest('hex').slice(0, 8);

      const distSwPath = path.join(distDir, 'sw.js');
      const srcSwPath = publicDir ? path.join(publicDir, 'sw.js') : distSwPath;
      const swTemplate = fs.existsSync(srcSwPath)
        ? fs.readFileSync(srcSwPath, 'utf8')
        : fs.readFileSync(distSwPath, 'utf8');
      fs.writeFileSync(distSwPath, swTemplate.replace(/__SW_BUILD_ID__/g, buildHash), 'utf8');
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
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const norm = id.replace(/\\/g, '/');
          if (
            norm.includes('/node_modules/react/') ||
            norm.includes('/node_modules/react-dom/') ||
            norm.includes('/node_modules/scheduler/')
          ) {
            return 'react-vendor';
          }
          return undefined;
        },
      },
    },
  },
});
