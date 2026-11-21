# 🚀 راهنمای جامع استقرار و اجرای هامزیار (HumsYar Deployment Guide)

این راهنما شیوهٔ نصب، اجرا و استقرار تمامی بخش‌های پروژه (ربات تلگرام، بک‌اند FastAPI، وب‌اپ دانشجویی، مینی‌اپ و لندینگ) را روی هر سرور اوبونتو ۲۲/۲۴ لینوکس به صورت گام‌به‌گام توضیح می‌دهد.

---

## ۱. ساختار سرویس‌ها و پورت‌ها

```
┌─────────────────────────────────────────────────────────────┐
│                      کلودفلر (Cloudflare)                    │
│   humsyar.ir (HTTPS - پورت استاندارد 443 و 80 با ابر نارنجی)  │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    وب‌سرور Nginx روی سرور                   │
│   /          ──> لندینگ پیج (Landing)                       │
│   /student/  ──> وب‌اپ اختصاصی دانشجو (PWA Standalone)      │
│   /app/      ──> مینی‌اپ تلگرام (BotFather WebApp)          │
│   /admin/    ──> پنل مدیریت                                  │
│   /api/      ──> اندپوینت‌های بک‌اند FastAPI                │
└──────────────────────────────┬──────────────────────────────┘
                               │ (proxy_pass http://127.0.0.1:8005)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│               FastAPI (Uvicorn روی پورت 8005)               │
└──────────────────────────────┬──────────────────────────────┘
                               │
               ┌───────────────┴───────────────┐
               ▼                               ▼
┌──────────────────────────────┐ ┌─────────────────────────────┐
│  ربات تلگرام (bot.py)        │ │  لوکال سرور Telegram Bot API│
│  پایش آپدیت‌ها و کارهای زمان‌بندی│ │  (Docker روی پورت 8081)     │
└──────────────────────────────┘ └─────────────────────────────┘
```

---

## ۲. متغیرهای محیطی مورد نیاز (`.env`)

فایل `/opt/humsyarx/.env` را با مقادیر زیر ایجاد کنید:

```ini
ADMIN_ID=8799834619
BOT_USERNAME=humsyarbot
MONGODB_URI=mongodb+srv://amirxboxlive84:huSUZ75AVxJOreF7@discordccoin.cmgmcpi.mongodb.net/?appName=discordCCoin
TELEGRAM_TOKEN=8488512334:AAGcYyk7N3q4aCaJe5qNQNSC_zYjdq9pKRI

# آدرس لوکال بات ای‌پی‌آی برای انتقال سریع و نامحدود فایل تا ۲ گیگابایت
TELEGRAM_LOCAL_API_URL=http://127.0.0.1:8081
TELEGRAM_API_ID=34514776
TELEGRAM_API_HASH=7f1426930f421bc5bcbeef4e33184027

# آدرس پایه وب‌اپ و دامنه اصلی
WEBAPP_URL=https://humsyar.ir/app
BASE_URL=https://humsyar.ir
PORT=8005
```

---

## ۳. دستورات راه‌اندازی سریع روی سرور جدید

### گام اول: نصب پیش‌نیازها
```bash
sudo apt-get update
sudo apt-get install -y python3 python3-venv python3-pip git nginx docker.io docker-compose-v2
```

### گام دوم: کلون پروژه و راه‌اندازی محیط مجازی
```bash
sudo mkdir -p /opt/humsyarx
# فایل‌های پروژه را در /opt/humsyarx کپی کنید
cd /opt/humsyarx
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt pymupdf zstandard psutil
```

### گام سوم: اجرای داکر Local Telegram Bot API
```bash
docker compose -f infrastructure/docker/docker-compose.telegram-api.yml up -d
```

### گام چهارم: بیلد فرانت‌اندها (در صورت نیاز به بیلد روی سرور)
```bash
# وب‌اپ دانشجو
cd /opt/humsyarx/apps/student && npm ci && npm run build

# لندینگ پیج و مینی‌اپ
cd /opt/humsyarx/miniapp && npm ci && npm run build && npm run build:landing
```

### گام پنجم: فعال‌سازی سرویس‌های Systemd
```bash
sudo cp infrastructure/deployment/humsyar-api.service /etc/systemd/system/
sudo cp infrastructure/deployment/humsyar-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now humsyar-api
sudo systemctl enable --now humsyar-bot
```

### گام ششم: تنظیم وب‌سرور Nginx
```bash
sudo cp infrastructure/deployment/nginx-humsyar.conf /etc/nginx/sites-available/humsyarx
sudo ln -sf /etc/nginx/sites-available/humsyarx /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## ۴. بررسی وضعیت کارکرد
```bash
# بررسی وضعیت اجرای API و ربات
systemctl status humsyar-api humsyar-bot --no-pager

# بررسی لاگ‌های زنده ربات
journalctl -u humsyar-bot -f

# بررسی لاگ‌های API
journalctl -u humsyar-api -f
```
