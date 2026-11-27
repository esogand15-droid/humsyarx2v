# هامزیار (Humsyar)

پلتفرم آموزشی دانشجویان پزشکی: ربات تلگرام + API (FastAPI) + وب‌اپ دانشجو + مینی‌اپ/لندینگ + پنل ادمین.

## ساختار پوشه‌ها

| مسیر | چیست |
|---|---|
| `backend/` | **کد اصلی** — `api/` (FastAPI)، `bot/` (هندلرهای ربات، python-telegram-bot 21)، `core/`، `database/`، `services/`، `integrations/`، `workers/` |
| `apps/student/` | وب‌اپ دانشجو (Vite + React + TS) روی `/student/` |
| `miniapp/` | مینی‌اپ تلگرام، PWA و لندینگ humsyar.ir (`dist`، `dist-pwa`، `dist-landing`) |
| `webadmin/` | پنل ادمین وب |
| `tests/` | تست‌های pytest/unittest (قرارداد، runtime و فرانت) |
| `scripts/` | ابزارهای اپراتور: مایگریشن بانک سؤال، `scripts/tools/` (audit / health / migration) |
| `docker/` | `supervisord.conf`، `entrypoint.sh`، اسکریپت‌های Bot API |
| `infrastructure/` | فایل‌های systemd/VPS |
| `docs/` | معماری، طراحی، گزارش‌ها و runbook |

### فایل‌های shim در ریشه

فایل‌های `*.py` ریشه (`bot.py`، `database.py`، `utils.py`، …) و پوشه‌های `api/`، `core/`، `db/`، `payments/`، `qbank/`، `question_bank/`، `ring/` فقط **shim سازگاری** هستند و به ماژول متناظر در `backend/` اشاره می‌کنند. استقرار (`supervisord`: `uvicorn api.main:app` و `python -u bot.py`) و صدها import قدیمی به آن‌ها وابسته‌اند؛ **حذفشان نکنید**. کد جدید را مستقیم در `backend/` بنویسید.

## اجرا (محلی)

```bash
pip install -r requirements.txt
export MONGODB_URI=mongodb://127.0.0.1:27017/humsyar ADMIN_ID=<id> TELEGRAM_TOKEN=<token>
python -m uvicorn backend.api.main:app --port 8000   # API
python bot.py                                        # ربات
cd apps/student && npm ci && npm run dev             # وب‌اپ دانشجو
```

متغیرهای محیطی: `.env.example` و `vps.env.example`. ساخت همهٔ فرانت‌ها از ریشه: `npm run build`.

## تست

```bash
python -m pytest tests -q
```

تست‌های دیتابیسی به `MONGODB_URI` نیاز دارند. فهرست خطاهای شناخته‌شده: `tests/known_failures.txt`.

## استقرار

Railway با `Dockerfile` (`railway.json`)؛ فرانت‌ها در مرحلهٔ build ساخته می‌شوند و `supervisord` سرویس‌های api، bot و botapi را اجرا می‌کند. جزئیات: `docs/DEPLOYMENT_GUIDE.md`.
