# CODEBASE_AUDIT.md — Wave 0 Comprehensive Codebase Audit
**Authoritative Technical Audit Synthesizing Backend, Frontend, and Infrastructure Investigations**

---

## 1. Executive Summary

This report establishes the verified baseline of the **HumsYarX** codebase prior to Wave 1 modifications. The audit synthesizes exhaustive investigations performed across the backend services, frontend applications, infrastructure configurations, and test suites.

### Key Audit Metrics
- **Total Backend Python Codebase**: ~84 root files, 33 API routers, 60 test modules, > 50,000 lines of Python.
- **Client Applications**: 3 active/semi-active frontends (Telegram Mini App, WebAdmin, Student App) + 1 interactive design prototype.
- **API Operations Baseline**: Exactly 734 declared OpenAPI operations across all FastAPI routers (`_ROUTE_BASELINE = 734`).
- **Database Engine**: Motor / PyMongo connected to MongoDB database `medicalbot`.
- **Target Production VPS**: `sw2.pwker.ir` (2 vCPU cores, 8 GB RAM, 50 GB NVMe SSD).

---

## 2. Backend Architecture Audit

### 2.1 Entry Points & Core Services
- **`bot.py` (2,719 lines, 154 KB)**:
  - Framework: `python-telegram-bot` 21.3 using `ApplicationBuilder`.
  - State Management: `ConversationHandler` strictly limited to registration onboarding (`start_handler` with states `REGISTER`, `STEP_NAME`, `STEP_GROUP`, `STEP_INTAKE`, `STEP_STUDENT_ID`).
  - Unified Message Dispatch: All standard messages route through `unified_text_handler` and `unified_file_handler` into `message_router.route_message`.
  - Background Job Queue: Exactly 23 recurring jobs scheduled via python-telegram-bot's built-in JobQueue (e.g. application.job_queue.run_daily, run_repeating, run_once), NOT APScheduler. These handle hourly database backups, daily subscription expiry checks (Tehran time 09:15), weekly prestige league closes, question broadcasts, and cache cleanups.
  - Startup Resilience: Employs `_run_polling_with_retry` with exponential backoff to handle Iranian datacenter network hiccups and Telegram API timeouts.
- **`start.py` (593 lines, 30 KB)**:
  - Onboarding sequence verifying blacklist (`db.is_blacklisted`), user approval status (`user.get('approved')`), and student ID enforcement.
- **`message_router.py` (305 lines, 15 KB)**:
  - Central command router enforcing approved user status and RBAC permissions (`db.has_permission`).
- **`admin.py` (3,949 lines, 225 KB)**:
  - Telegram bot administrative dashboard with fine-grained menu filtering based on admin roles.
- **`api/main.py` (989 lines, 43 KB)**:
  - Unified FastAPI application with startup lifespan managing shared HTTP client pools, MongoDB index initialization, and route mounting.
  - Registered Middlewares:
    1. Range header size limiter (rejection of > 16 intervals / > 512 chars to protect against Starlette DoS PYSEC-2026-1942).
    2. Structured Request ID injection (`HY-YYYYMMDD-XXXXXX`) and latency tracking.
    3. CORS middleware with origin configuration.
    4. Strict security headers (`nosniff`, `referrer-policy`, CSP on `/admin`).
    5. GZip compression for responses > 1000 bytes.
    6. Sliding window rate limiting (120 req/min per IP globally).

### 2.2 API Router Catalog (`api/routers/`)
The backend provides 33 modular router files mounted under `/api/`:
- **Student Core**: `dashboard.py`, `profile.py`, `registration.py`, `schedule.py`, `grades.py`, `tickets.py`, `notifications.py`, `faq.py`, `reports.py`, `referral.py`.
- **Curriculum & Library**: `resources.py` (terms, courses, sessions, files), `references.py` (medical textbooks, volumes, files), `global_search.py`.
- **Question Bank & AI**: `questions.py` (taxonomy, mock exams, practice, answer submission), `ai.py` (HooshYar LLM chat streaming, vision diagnosis, live voice).
- **Commerce & Billing**: `subscription.py` (plan catalog, discounts, receipt uploads), `payment_gateway.py` (ZarinPal checkout and callback).
- **Web Client Endpoints**: `web_login.py` (OTP login challenge), `web_student.py` (legacy web student auth), `web_library.py` (curriculum browsing), `web_reader.py` (document viewing), `web_ink.py` (vector stroke storage), `web_exam.py` (web mock exams).
- **Operations & Administration**: `web_admin.py` (comprehensive 256-endpoint web admin panel), `academic_admin.py`, `content_admin.py`, `url_import.py`, `subscription_management.py`, `ai_management.py`, `rbac.py`, `ring_admin.py`.

### 2.3 Access Control & Policy Enforcement (`core/access.py`)
- Evaluates feature access in a strictly defined 9-step cascade:
  1. Catalog registration verification (`FEATURE_CATALOG`).
  2. In-memory policy cache check (60s TTL; fail-safe returns 503 if DB unreachable).
  3. Global kill switch check (`policy["enabled"] == False`).
  4. Admin bypass check (`uid == ADMIN_ID` or `access == "free"`).
  5. Subscription active check (`db.sub_is_active(uid)`).
  6. Trial exclusion check (`policy["trial_allowed"] == False`).
  7. Plan entitlement check (`entitlements[feature]`).
  8. Usage quota verification (`db.feature_usage_get`).
  9. Grant access.

### 2.4 Database Layer & MongoDB Collections
- Client: Async Motor client connecting to MongoDB database `medicalbot`.
- Key collections:
  - `users`: Indexed by `user_id`, `username`, `student_id`.
  - `subscriptions`: Indexed by `user_id`, tracking plan entitlements and expiration dates.
  - `sub_payments`: Financial ledger and ZarinPal verification authorities.
  - `bs_content` & `ref_files`: Academic resources referencing Telegram `file_id`.
  - `reading_progress`: Indexed by `{_id: "<uid>:<scope>:<file_id>"}`.
  - `web_ink_pages`: Indexed by `{_id: "<uid>:<scope>:<file_id>:<page>"}`.
  - `web_user_sessions`: Indexed by `_id = sha256(token)`.

---

## 3. Frontend Architecture Audit

### 3.1 Telegram Mini App (`miniapp/`)
- **Technology Stack**: React 18, Vite 5, Axios, Zustand (`authStore`, `uiStore`, `contentScopeStore`).
- **Route Architecture**: `miniapp/src/App.jsx` with code-split lazy loading across 34 screens and 5 eager-loaded tabs (`Dashboard`, `Learn`, `Schedule`, `Grades`, `Me`).
- **Authentication**: Dual-mode supporting Telegram `X-Init-Data` header and standalone cookie fallback (`hu_session`).
- **Visual Design**: Dark-navy theme (`#060B16`) based on CSS variables in `tokens.css`.

### 3.2 WebAdmin Dashboard (`webadmin/`)
- **Technology Stack**: React 18, Vite 5, custom HTTP client with abort controller.
- **Scope**: 23 administrative desks including user drawers, subscription grants, content management, AI prompt configuration, and audit log inspection.

### 3.3 Student Web Client (`apps/student/`)
- **Technology Stack**: React 18.3.1, TypeScript 5.6.3, Vite 5.4.9, `pdfjs-dist: ^4.8.69`.
- **Status in Backend**: Retired with HTTP 410 in `api/routers/web_student.py:577` during a prior wave in favor of `/app`.
- **Styling & Layout Deficiency**: Enforces a rigid 720px max-width container on desktop displays (`ui.css:484`), leaving massive empty borders on large monitors.
- **PWA Deficiencies**: Missing `<link rel="manifest">` in `index.html` and unlinked Service Worker in `main.tsx`.

### 3.4 Interactive Prototype Artifacts
- Root contains `humsyar-prototype.html` (1.28 MB) and `src/` directory containing mock data (`demo.ts`, `notes.ts`). These represent early design drafts and must be archived.

---

## 4. DevOps, Infrastructure & Security Audit

### 4.1 Production Host Bounds (`sw2.pwker.ir`)
- **Capacity**: 2 vCPU cores, 8 GB RAM, 50 GB NVMe SSD.
- **Vulnerability**: Existing `docker-compose.yml` has zero memory or CPU limit directives, risking kernel OOM kills if unthrottled PDF conversions or MongoDB memory spikes occur.

### 4.2 Storage & File Delivery Deficiencies
- **Telegram Dependency**: Academic files are uploaded to Telegram via `upload_and_get_file_id` and streamed directly via `proxy_telegram_preview`.
- **DRM Gap**: Raw PDF binaries are delivered straight to client browsers with zero server-side page rasterization, zero WebP conversion, and zero dynamic watermarking.

### 4.3 Git & Environment Vulnerabilities
- **Missing `.gitignore`**: The repository root completely lacks a `.gitignore` file, posing severe risks of committing `.env` files, secrets, or heavy build artifacts.
- **Database Identifier Discrepancy**: `docker-compose.yml` configures database `humsyar`, while Python source code explicitly hardcodes `medicalbot` across 50+ files.
- **Unencrypted Backups**: `backup.py` currently transmits database backup archives to Telegram with `encrypted=False`.

---

## 5. Technical Debt & Monolithic Modules Catalog

| File Path | Line Count | File Size | Identified Technical Debt / Architectural Issue |
|---|---|---|---|
| `api/routers/web_admin.py` | 8,434 lines | 480 KB | Monolithic admin router with 256 endpoints; needs modular decomposition. |
| `ai_solver.py` | 6,420 lines | 354 KB | Monolithic AI engine mixing OpenAI, Anthropic, Gemini, Groq, and voice calls. |
| `db/core.py` | 5,179 lines | 280 KB | Massive core database mixin covering users, schedules, audit, and settings. |
| `admin.py` | 3,949 lines | 225 KB | Monolithic Telegram bot admin panel with embedded UI callbacks. |
| `bot.py` | 2,719 lines | 154 KB | Multi-purpose bot entry point hosting polling, handlers, and 23 python-telegram-bot JobQueue jobs. |
| `content_admin.py` | 2,746 lines | 170 KB | Monolithic content management router. |
| `humsyar-prototype.html` | — | 1.28 MB | Orphaned static prototype file in repository root. |
| `tests/known_failures.txt` | 18 items | — | Legacy test failures including outdated design system (apps/student restoration), trial race tests, and outdated count assertions. |

---

## 6. Audit Verification Methods

> **Prerequisite**: All verification commands must be executed within `d:\humsyarx project\humsyarx-main` using a virtual environment containing project dependencies (`python -m venv .venv; pip install -r requirements.txt`).

1. **Verify Route Baseline**:
   ```powershell
   cd "d:\humsyarx project\humsyarx-main"
   python -c "from api.main import app, _count_api_operations; print(_count_api_operations())"
   ```
   *Expected Result*: `{'openapi_operations': 727, 'routes_match_baseline': True}`.
2. **Verify Database Hardcoding**:
   Grep `client['medicalbot']` across root Python files to confirm pervasive usage.
3. **Verify Starlette Range Middleware**:
   Inspect `api/main.py:177-188` to confirm range intervals > 16 return HTTP 416.
4. **Verify Test Baseline**:
   Run `python -X utf8 tests/run_ci.py` to confirm cataloged debt items run without newly introduced regressions.
