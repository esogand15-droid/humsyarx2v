import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/* ─────────────────────────────────────────────────────────────
   📲 بیلد PWA — بازنویسی «پوستهٔ نصب» روی خروجی

   `public/` بین دو بیلد مشترک است (فونت و آیکون)، پس manifest و
   سرویس‌ورکرِ مخصوص PWA باید از جای دیگری روی خروجی کپی شوند؛
   وگرنه مسیرها می‌شوند /pwa/pwa/... (تجربه‌شده و اصلاح شد).
   ───────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────
   🏠 بیلد لندینگ (صفحهٔ ریشهٔ دامنه)

   لندینگ نه manifest دارد نه سرویس‌ورکر (وگرنه مرورگر برای همان
   صفحهٔ معرفی هم «نصب» پیشنهاد می‌داد). پس `public/` کامل کپی
   نمی‌شود؛ فقط فونت و آیکون که واقعاً استفاده می‌شوند.
   ───────────────────────────────────────────────────────────── */
function landingAssets() {
  return {
    name: 'humsyar-landing-assets',
    apply: 'build',
    closeBundle() {
      const root = process.cwd();
      const to = path.resolve(root, process.env.VITE_OUT_DIR || 'dist-landing');
      if (!fs.existsSync(to)) return;
      for (const dir of ['fonts', 'icons']) {
        const from = path.join(root, 'public', dir);
        if (fs.existsSync(from)) fs.cpSync(from, path.join(to, dir), { recursive: true, force: true });
      }
      // ورودی بیلد `landing.html` است ولی روی دامنه باید `/` باشد
      const built = path.join(to, 'landing.html');
      if (fs.existsSync(built)) fs.renameSync(built, path.join(to, 'index.html'));
    },
  };
}

/* ─────────────────────────────────────────────────────────────
   🧭 سرویسورکر واحد — `sw/sw.js` تنها منبع است

   هنگام بیلد، شناسهٔ بیلد (hash نام همهٔ فایلهای خروجی) و فهرست
   پیشکش در آن جایگزین و در ریشهٔ همان خروجی نوشته میشود. پس با
   هر deploy نام کش عوض میشود و کشهای قدیمی پاک میشوند، بدون اینکه
   کسی نسخه را دستی بالا ببرد. این plugin بعد از pwaShell اجرا میشود.
   لندینگ سرویسورکر ندارد.
   ───────────────────────────────────────────────────────────── */
function unifiedServiceWorker({ isPwa }) {
  const names = [];
  return {
    name: 'humsyar-unified-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      names.push(...Object.keys(bundle));
    },
    closeBundle() {
      const root = process.cwd();
      const outDir = path.resolve(root, process.env.VITE_OUT_DIR || (isPwa ? 'dist-pwa' : 'dist'));
      if (!fs.existsSync(outDir)) return;
      const buildId = crypto.createHash('sha256')
        .update(names.sort().join('|'))
        .digest('hex')
        .slice(0, 12);
      const precache = [
        './',
        './manifest.webmanifest',
        './icons/icon-192.png',
        './icons/icon-512.png',
        './icons/maskable-512.png',
        './icons/apple-touch-icon.png',
        ...(isPwa ? ['./offline.html'] : []),
      ];
      const src = fs.readFileSync(path.join(root, 'sw', 'sw.js'), 'utf8')
        .replace("'__BUILD_ID__'", JSON.stringify(buildId))
        .replace('__PRECACHE__', JSON.stringify(precache));
      fs.writeFileSync(path.join(outDir, 'sw.js'), src);
    },
  };
}

function pwaShell() {
  return {
    name: 'humsyar-pwa-shell',
    apply: 'build',
    closeBundle() {
      const from = path.resolve(process.cwd(), 'public-pwa');
      const to = path.resolve(process.cwd(), 'dist-pwa');
      if (!fs.existsSync(from) || !fs.existsSync(to)) return;
      fs.cpSync(from, to, { recursive: true, force: true });
      // آیکون‌های PWA زیر /pwa/icons/ باشند (manifest نسبی می‌خواندشان)
      const iconsFrom = path.join(from, 'icons');
      const iconsTo = path.join(to, 'icons');
      if (fs.existsSync(iconsFrom)) fs.cpSync(iconsFrom, iconsTo, { recursive: true, force: true });
    },
  };
}

/* ─────────────────────────────────────────────────────────────
   🚂 مهاجرت Railway — مینی‌اپ به‌عنوان زیرمسیر /app/ سرو می‌شود

   چرا /app/ و نه ریشه؟
   همان دامنه‌ی Railway سه namespace مستقل دارد:
     /app/*   → Telegram Mini App (این بیلد)
     /admin/* → Web Admin (webadmin/dist، base خودش /admin/)
     /api/*   → FastAPI

   مینی‌اپ خودش routeهایی مثل /admin و /me دارد؛ اگر روی ریشه
   سرو می‌شد با Web Admin تداخل (shadow) پیدا می‌کرد.

   base از VITE_BASE خوانده می‌شود؛ پیش‌فرض /app/ است.
   برای `npm run dev` محلی می‌توان VITE_BASE=/ داد.
   ───────────────────────────────────────────────────────────── */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const isLanding = env.VITE_APP_MODE === 'landing';
  const rawBase = (isLanding ? '/' : (env.VITE_BASE || '/app/')).trim();
  // Vite به base با اسلش پایانی نیاز دارد؛ /app → /app/
  const base = rawBase === '/' ? '/' : rawBase.replace(/\/+$/, '') + '/';

  return {
    base,
    plugins: [
      react(),
      ...(env.VITE_APP_MODE === 'pwa' ? [pwaShell()] : []),
      ...(isLanding ? [landingAssets()] : []),
      ...(isLanding ? [] : [unifiedServiceWorker({ isPwa: env.VITE_APP_MODE === 'pwa' })]),
    ],
    // لندینگ نباید manifest/sw مینی‌اپ را روی ریشه ببیند
    publicDir: isLanding ? false : 'public',
    server: {
      host: true,
      port: 5173,
      // در dev، API روی همان origin شبیه‌سازی می‌شود تا رفتار
      // production (same-origin) در dev هم دیده شود.
      proxy: {
        '/api': {
          target: env.VITE_DEV_API_PROXY || 'http://localhost:8000',
          changeOrigin: true,
        },
      },
    },
    build: {
      // 📲 بیلد PWA جدا و بی‌خطر در پوشهٔ خودش؛ بیلد تلگرام دست‌نخورده می‌ماند
      outDir: (env.VITE_OUT_DIR || 'dist'),
      emptyOutDir: true,
      sourcemap: false,
      // پوشهٔ دارایی لندینگ نام اختصاصی دارد تا با /assets/ هیچ اپ دیگری
      // روی ریشهٔ دامنه اشتباه گرفته نشود.
      assetsDir: isLanding ? 'landing-assets' : 'assets',
      rollupOptions: isLanding
        ? { input: path.resolve(process.cwd(), 'landing.html') }
        : {},
    },
  };
});
