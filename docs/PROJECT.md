# PROJECT BLUEPRINT — HUMSYARX PLATFORM
**Enterprise Medical Study Platform, Unified Student PWA & Telegram Ecosystem**

---

## 1. Executive Architecture Summary

**HumsYarX** (هامزیار) is an enterprise medical education platform designed for students of medical sciences. The platform provides a comprehensive learning environment encompassing study resources, reference textbooks, a categorized question bank with custom exam creation, HooshYar AI medical tutoring, Persian Jalali scheduling, progress tracking, and an Apple Pencil / stylus-compatible PDF reader with vector digital ink annotations.

### 1.1 Core Architectural Principles
1. **One Platform — One Identity — One Database**:
   - **Unified Single Backend**: A single high-performance Python FastAPI asynchronous backend (`api/main.py`) serving both Telegram WebApp clients and independent web clients.
   - **Single Persistent Database**: One MongoDB instance (database name: `medicalbot`). All clients, bots, and background workers read and write from this single source of truth. No secondary database or data fragmentation.
   - **Single User Identity**: Every student is identified by their canonical integer Telegram `user_id`. Web authentication binds directly to this user identity without duplicate user records.
   - **Centralized Access Control**: All feature gating, subscription verification, and usage quotas are centrally enforced by `core/access.py` and `core/features.py`. No client is permitted to evaluate or enforce authorization locally.

### 1.2 Dual Client Tracks
The platform supports three user interface surfaces running against the unified backend:
1. **Telegram Bot (`bot.py`)**: Real-time study companion, daily questions, broadcast notices, registration, backup dispatch, and fast transactional notifications (Active & Preserved).
2. **Telegram Mini App (`miniapp/`)**: Embedded web application accessed directly within Telegram (`/app`), optimized for quick access on mobile phones (Active & Preserved).
3. **Independent Student Web App & PWA (`apps/student/`)**: High-performance, offline-capable, standalone Progressive Web App (PWA) designed for deep multi-hour study on Android phones, iPhones, iPads/tablets, and desktop workstations.

```text
┌────────────────────────────────────────────────────────────────────────┐
│                          CLIENT ECOSYSTEM                              │
├────────────────────────┬───────────────────────┬───────────────────────┤
│     Telegram Bot       │   Telegram MiniApp    │  Independent PWA/Web  │
│      (python-ptb)      │     (React + Vite)    │   (React + TS + PWA)  │
└───────────┬────────────┴───────────┬───────────┴───────────┬───────────┘
            │                        │                       │
            │ Telegram Events        │ X-Init-Data (HMAC)    │ hu_session (Cookie)
            ▼                        ▼                       ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        FASTAPI UNIFIED BACKEND                         │
│                                                                        │
│  ┌───────────────────────┐  ┌───────────────────────┐  ┌─────────────┐ │
│  │   Auth & Security     │  │  Access Control Engine│  │ Rate Limiter│ │
│  │(Telegram HMAC/Web OTP)│  │   (core/access.py)    │  │(Token Bucket│ │
│  └───────────────────────┘  └───────────────────────┘  └─────────────┘ │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                        API ROUTERS (33+)                         │  │
│  │ • /api/web-auth        • /api/web/library       • /api/questions │  │
│  │ • /api/web/reader      • /api/web/ink           • /api/ai        │  │
│  │ • /api/schedule        • /api/subscription      • /api/web-admin │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
           ┌─────────────────────────┼─────────────────────────┐
           ▼                         ▼                         ▼
┌─────────────────────┐   ┌─────────────────────┐   ┌─────────────────────┐
│    MongoDB 7.0      │   │ Private File Store  │   │  Background Worker  │
│    `medicalbot`     │   │  Local SSD / S3     │   │(PyMuPDF WebP Render)│
└─────────────────────┘   └─────────────────────┘   └─────────────────────┘
```

---

## 2. Monorepo Code Layout & Safe Two-Phase Migration Plan

To transform the legacy flat directory structure into an enterprise modular codebase without breaking active runtime services, import paths, or the test harness, the project adopts the following monorepo architecture:

```text
humsyarx/
├── apps/
│   ├── student/                  # Independent Student PWA (React 18 + TS + Vite + Tailwind/Tokens)
│   ├── miniapp/                  # Telegram Mini App (React 18 + Vite)
│   └── admin/                    # WebAdmin Operational Dashboard (React 18 + Vite)
│
├── backend/
│   ├── api/                      # FastAPI routers, middlewares, OpenAPI models
│   │   ├── routers/              # 33 Modular route handlers
│   │   ├── auth.py               # Unified HMAC & Session authentication dependency
│   │   └── rate_limit.py         # Request rate-limiting engine
│   ├── bot/                      # Telegram Bot application & message routers
│   │   ├── bot.py                # Bot lifecycle, polling engine, JobQueue jobs
│   │   ├── start.py              # Onboarding, registration, /start handler
│   │   ├── message_router.py     # Command & text routing
│   │   └── admin.py              # Telegram-native admin panel
│   ├── core/                     # Business domain rules & access control
│   │   ├── access.py             # Single-source-of-truth authorization engine
│   │   └── features.py           # Feature catalog, policy definitions, quotas
│   ├── database/                 # DAL, database connection, migrations
│   │   ├── database.py           # Central DB instance & mixin aggregator
│   │   ├── core.py               # Core collections (users, audit, notifs)
│   │   ├── content.py            # Lessons, sessions, files, references
│   │   └── finance.py            # Subscriptions, receipts, plans
│   ├── services/                 # Cross-cutting domain services
│   │   ├── pdf_renderer.py       # PyMuPDF rendering & watermark injection
│   │   ├── storage.py            # Abstract Private Storage driver (Disk & S3)
│   │   ├── ai_solver.py          # HooshYar multi-provider LLM engine
│   │   └── broadcast_service.py  # Asynchronous bulk notification engine
│   ├── integrations/             # Third-party integrations
│   │   ├── zarinpal.py           # ZarinPal payment gateway client
│   │   └── telegram_send.py      # Bot MTProto & API file streaming
│   └── workers/                  # Dedicated throttled background queue workers
│       └── render_worker.py      # Concurrency=1 PDF WebP rasterization worker
│
├── packages/
│   ├── api-contracts/            # Shared TypeScript API client & interfaces
│   ├── shared-types/             # Shared TypeScript & Python domain models
│   └── shared-config/            # Shared linting, build, and styling tokens
│
├── infrastructure/
│   ├── docker/                   # Dockerfile, supervisord.conf, entrypoint.sh
│   ├── proxy/                    # Caddyfile (SSL termination, reverse proxy)
│   └── deployment/               # deploy.sh, backup scripts, vps.env.example
│
├── tests/
│   ├── unit/                     # Fast isolated unit tests
│   ├── integration/              # Database and API integration tests
│   ├── e2e/                      # End-to-end browser & workflow tests
│   ├── security/                 # Auth, DRM bypass, rate limit verification
│   └── run_ci.py                 # Custom CI runner with baseline gating
│
├── docs/                         # Authoritative documentation suite
│   ├── architecture/             # System blueprints, contracts, audits
│   └── PROJECT_PROGRESS.md       # Master wave tracking report
│
├── PROJECT.md                    # This authoritative document
├── TEST_INFRA.md                 # Testing strategy & 4-tier matrix
├── README.md                     # Repository developer onboarding
└── docker-compose.yml            # Multi-container production orchestration
```

### 2.1 Safe Two-Phase Facade Migration Roadmap
Directly moving dozens of root Python modules breaks active imports, Docker startup commands, and test suites. Migration proceeds via a non-disruptive facade pattern:

- **Phase 1: Facade Shim Deployment (Zero-Breakage)**:
  1. The new directories under `backend/` are structured and populated with the refactored, cleanly organized Python modules.
  2. For every migrated file previously at root (e.g., `admin.py`, `database.py`, `ai_solver.py`), a lightweight **Root Shim** is left in place:
     ```python
     # root: admin.py
     """Facade shim ensuring backward compatibility with legacy imports."""
     from backend.bot.admin import *
     ```
  3. `PYTHONPATH` in `Dockerfile` and `docker/supervisord.conf` is configured to include both the root and `backend/`:
     `ENV PYTHONPATH="/srv/humsyar:/srv/humsyar/backend"`
  4. The complete test suite is executed using `python -X utf8 tests/run_ci.py` to prove zero regressions.

- **Phase 2: Gradual Consumer Re-targeting & Shim Deprecation**:
  1. Internal imports across the backend are updated to reference clean package paths (e.g., `from backend.core.access import check_feature`).
  2. Frontend paths are consolidated under `apps/` with Vite workspaces.
  3. Once all internal references and CI test runs confirm 100% direct package usage, root shims are safely pruned.

---

## 3. Complete Feature Inventory & Milestone Allocation

Every single feature identified across the Telegram Bot, Mini App, WebAdmin, and Student App (38+ features) is cataloged below and assigned to a definitive Wave milestone (Wave 0 through Wave 7). **No feature is left unassigned.**

| # | Feature Name | Domain | Original Surface | Target Surface | Wave Assignment | Core Responsibility |
|---|---|---|---|---|---|---|
| 1 | **Codebase & Infra Audit** | Architecture | All | Docs / Meta | **Wave 0** | Baseline audit of backend, frontends, Docker, and security. |
| 2 | **Contract & Test Infra** | Architecture | All | Root / Docs | **Wave 0** | Authoritative blueprints, 4-tier test matrix, and CI harness. |
| 3 | **Two-Phase Monorepo Layout** | Core/Infra | Root | `apps/`, `backend/` | **Wave 1** | Directory restructuring with facade shims preserving imports. |
| 4 | **Test Suite Modernization** | Testing | `tests/` | `tests/` | **Wave 1** | Resolving obsolete test assertions, enabling UTF-8 CI runner. |
| 5 | **Legacy Prototype Pruning** | Hygiene | Root `src/` | Archived | **Wave 1** | Removing unlinked 1.28 MB prototype and orphaned artifacts. |
| 6 | **Unified Web Authentication** | Auth | `web_login.py` | Bot + PWA | **Wave 2** | 8-character user code + Bot inline approval + `hu_session`. |
| 7 | **Device & Session Management**| Security | MongoDB | PWA Profile | **Wave 2** | Listing connected devices with remote revocation capability. |
| 8 | **Private Storage Driver** | Storage | Telegram CDN | VPS Disk / S3 | **Wave 2** | `StorageDriver` abstraction for secure pamphlet storage. |
| 9 | **Database Schema Alignment** | Database | `medicalbot` | Backend Core | **Wave 2** | Unifying MongoDB URI and hardcoded collection configurations. |
| 10 | **Student App Foundation** | Frontend | `apps/student` | Independent PWA | **Wave 3** | Unblocking `/student` route, Vite TS build, React Query state. |
| 11 | **Morakkab Design System** | Frontend | Spec HTML | PWA CSS Tokens | **Wave 3** | Warm paper light mode (`#F7F3EA`), Study dark (`#14110C`), Vazirmatn. |
| 12 | **Adaptive 3-Tier Layout** | Frontend | `apps/student` | PWA Viewport | **Wave 3** | Mobile bottom-nav, Tablet 2-panel, Desktop full fluid canvas. |
| 13 | **Student Dashboard** | LMS | MiniApp | PWA Home | **Wave 3** | Continue reading, study streak, quick actions, announcements. |
| 14 | **Student Profile & Badges** | Profile | MiniApp | PWA Profile | **Wave 3** | Account details, prestige rank, badges, intake and group info. |
| 15 | **Curriculum Terms Navigation**| Library | MiniApp | PWA Library | **Wave 4** | Academic terms 1–10 listing with course counts. |
| 16 | **Course Lessons & Sessions** | Library | MiniApp | PWA Library | **Wave 4** | Lesson modules, session files, session forks, and recordings. |
| 17 | **Reference Books Catalog** | Library | MiniApp | PWA References | **Wave 4** | Subject taxonomy, textbook editions, covers, and volume lists. |
| 18 | **Protected PDF WebP Pipeline**| Security/DRM | Backend | Server Worker | **Wave 4** | Server-side PyMuPDF 150 DPI WebP rasterization + caching. |
| 19 | **Dynamic Pixel Watermarking** | Security/DRM | Backend | Server Worker | **Wave 4** | Diagonal user-name and user-ID watermarking per request. |
| 20 | **Signed Page Delivery API** | Security/DRM | `web_reader.py`| PWA Reader | **Wave 4** | 10-minute HMAC signed page URLs with `no-store` headers. |
| 21 | **Study Progress Tracking** | LMS | MiniApp | PWA Reader | **Wave 4** | Auto-saving last page read and completion percentage. |
| 22 | **Stylus Pointer Vector Layer**| Digital Ink | `InkLayer.tsx` | PWA Reader | **Wave 5** | High-precision Canvas layer supporting Apple Pencil & stylus. |
| 23 | **Pressure & Velocity Tracking**| Digital Ink | Frontend | PWA Reader | **Wave 5** | Variable stroke width based on pointer pressure & coalesced events. |
| 24 | **Software Palm Rejection** | Digital Ink | Frontend | PWA Reader | **Wave 5** | Disabling touch strokes while stylus is active. |
| 25 | **Annotation Tooling Suite** | Digital Ink | Frontend | PWA Reader | **Wave 5** | Pen, Pencil, Highlighter, Eraser, Color Picker, Undo/Redo. |
| 26 | **Offline Queue & Sync Engine**| Sync | LocalStorage | PWA IndexedDB | **Wave 5** | IndexedDB operation queue with retry backoff and conflict sync. |
| 27 | **Student Notebooks Directory**| Digital Ink | `web_ink.py` | PWA Library | **Wave 5** | Document summary of annotated pages and exported notebooks. |
| 28 | **Question Bank Taxonomy** | QBank | MiniApp | PWA QBank | **Wave 6** | Medical taxonomy filtering by term, course, topic, and difficulty. |
| 29 | **Practice Quiz Engine** | QBank | MiniApp | PWA QBank | **Wave 6** | Random practice, weak-point training, and flagged questions. |
| 30 | **Custom Exam Builder** | QBank | `qbank/` | PWA QBank | **Wave 6** | Timed mock exam creation, question count, and timer controls. |
| 31 | **Exam Review & Score Reports** | QBank | MiniApp | PWA QBank | **Wave 6** | Answer key comparison, explanations, sources, and score analysis. |
| 32 | **RTL Exam PDF Generator** | QBank | `builder.py` | PWA / Bot | **Wave 6** | ReportLab Persian PDF generation with Vazirmatn font. |
| 33 | **HooshYar AI Chat & Stream** | AI | `ai_solver.py` | PWA AI | **Wave 6** | Multi-provider LLM medical tutor with SSE token streaming. |
| 34 | **HooshYar Vision Diagnosis** | AI | `ai.py` | PWA AI | **Wave 6** | Multi-modal medical image analysis and diagram explanation. |
| 35 | **Jalali Calendar Study Tasks** | Schedule | MiniApp | PWA Schedule | **Wave 6** | Daily/weekly Persian calendar study tasks with checkoffs. |
| 36 | **Academic Grades & GPA** | Academic | MiniApp | PWA Grades | **Wave 6** | Semester grade transcript and cumulative GPA calculator. |
| 37 | **Subscription & ZarinPal** | Finance | `payments/` | PWA Finance | **Wave 6** | Plan catalog, discount codes, card receipts, and ZarinPal gateway. |
| 38 | **Student Wallet System** | Finance | `db/wallet.py` | PWA Finance | **Wave 6** | In-app credit balance, top-up, and one-click renewals. |
| 39 | **Notifications Center** | LMS | MiniApp | PWA Inbox | **Wave 6** | Push announcements, system alerts, and unread counts. |
| 40 | **Support Tickets Desk** | Support | MiniApp | PWA Support | **Wave 6** | Ticket submission, threaded conversation, and status tracking. |
| 41 | **Global Cross-Domain Search** | Search | `global_search`| PWA Search | **Wave 6** | Unified search across lessons, references, questions, and notes. |
| 42 | **PWA Web App Manifest & SW** | PWA | None | PWA Browser | **Wave 7** | Installability on iOS/Android, standalone display, caching strategy. |
| 43 | **Production Docker Limits** | DevOps | `docker-compose`| VPS Host | **Wave 7** | Memory & CPU caps on MongoDB, FastAPI app, and Caddy proxy. |
| 44 | **Automated Encrypted Backups**| DevOps | `backup.py` | VPS / Bot | **Wave 7** | Fernet AES-encrypted database dumps with verification test. |
| 45 | **Caddy Reverse Proxy & HTTPS**| DevOps | `Caddyfile` | VPS Host | **Wave 7** | Automated TLS termination for `sw2.pwker.ir` with HTTP/2 & 3. |
| 46 | **CI/CD Pipeline Hardening** | DevOps | `.github/` | GitHub Actions | **Wave 7** | Automated multi-stage test execution and build verification. |

---

## 4. Milestones & Waves Execution Schedule

```text
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│    Wave 0    │ ──> │    Wave 1    │ ──> │    Wave 2    │ ──> │    Wave 3    │
│Audit & Arch  │     │Modernization │     │Backend & Auth│     │Student UI/PWA│
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
                                                                      │
┌──────────────┐     ┌──────────────┐     ┌──────────────┐            │
│    Wave 7    │ <── │    Wave 6    │ <── │    Wave 5    │ <──────────┘
│Production VPS│     │Feature Parity│     │Ink & Sync    │     ┌──────────────┐
└──────────────┘     └──────────────┘     └──────────────┘ <── │    Wave 4    │
                                                               │Protected Lib │
                                                               └──────────────┘
```

### Milestone Specifications
- **Wave 0: Audit & Architecture (Current Milestone)**
  - Synthesize backend, frontend, and infrastructure audit findings.
  - Formulate authoritative blueprints (`PROJECT.md`, `TEST_INFRA.md`, architecture docs).
  - Define exact interface schemas and multi-agent ownership boundaries.
- **Wave 1: Codebase Modernization**
  - Establish monorepo structure with non-breaking facade shims at root.
  - Eliminate unreferenced legacy prototypes (`humsyar-prototype.html`, redundant root `src/`).
  - Create project `.gitignore` and update CI test runner for UTF-8 compatibility.
- **Wave 2: Backend Foundation & Web Auth**
  - Unify web authentication routers into canonical `web_auth.py`.
  - Implement 8-character unique user codes and Telegram Bot approval challenges.
  - Implement abstract `StorageDriver` and standardize MongoDB connection to `medicalbot`.
- **Wave 3: Complete Student UI & PWA Shell**
  - Revitalize `apps/student/` by unblocking the `/student` endpoint in FastAPI.
  - Implement "Morakkab" design system with fluid multi-column desktop layout.
  - Build Dashboard, Library, and Profile navigation shells connected to real backend APIs.
- **Wave 4: Protected Library & PDF WebP Rendering**
  - Build server-side background worker using PyMuPDF for 150 DPI WebP page rasterization.
  - Implement dynamic user watermark injection (student name + user ID).
  - Deploy protected reader API with short-lived HMAC signed URLs and `no-store` headers.
- **Wave 5: Digital Ink & Sync Engine**
  - Deploy vector canvas supporting pressure, tilt, and 120Hz coalesced events.
  - Implement software palm rejection and annotation editing tools (pen, highlighter, eraser).
  - Deploy IndexedDB operation queue with idempotent sync and conflict resolution.
- **Wave 6: Feature Parity (QBank, AI, Schedule)**
  - Integrate Question Bank practice exams, mock timer, and ReportLab RTL Persian PDF generator.
  - Integrate HooshYar AI multi-provider streaming chat and vision diagnosis.
  - Integrate Jalali calendar study tasks, GPA tracking, ZarinPal payments, and tickets.
- **Wave 7: Production Hardening & VPS Deployment**
  - Configure PWA service worker with strict caching boundaries (DRM bypass prevention).
  - Apply strict Docker CPU and memory resource constraints for `sw2.pwker.ir`.
  - Deploy Fernet AES-encrypted database backup routines and verify automated restore.

---

## 5. Interface Contracts & Data Models

### 5.1 Web Authentication Protocol (8-Character Code + Bot Push Approval)

Web login requires zero password creation and binds directly to the student's Telegram account.

#### 5.1.1 Protocol Flow
1. **Challenge Generation**: The student enters their 8-character code (e.g., `HY-7K9M-2P4X`) on the web client.
2. **Challenge Creation**: Backend validates the code format, generates a cryptographically random challenge ID, and registers a pending login request in MongoDB (`login_challenges`).
3. **Telegram Bot Push Notification**: The backend triggers Telegram Bot `bot.py` to send an immediate alert message to the student's Telegram chat:
   > 🔐 **درخواست ورود به نسخه وب هامزیار**  
   > مرورگر: Chrome on macOS  
   > آی‌پی: 5.234.12.89  
   > کد تاییدیه: **`7K9M`**  
   > آیا این ورود توسط شما انجام شده است؟  
   > `[ ✅ تایید ورود ]`    `[ ❌ رد درخواست ]`
4. **Approval & Session Grant**: When the user taps `[ ✅ تایید ورود ]`, the bot callback flips challenge status to `approved`.
5. **Session Cookie**: The web browser, polling `/api/web-auth/challenge/{id}` or listening on a WebSocket, receives confirmation and the backend sets a secure HTTP-only cookie (`hu_session`).

#### 5.1.2 Data Schemas

```typescript
// Request: POST /api/web-auth/challenge/create
interface LoginChallengeRequest {
  user_code: string;        // Exactly 8 characters (excluding hyphens): e.g. "7K9M2P4X"
  client_info?: {
    device_name?: string;   // e.g. "iPad Pro 11-inch"
    browser?: string;       // e.g. "Safari 17.4"
  };
}

// Response: POST /api/web-auth/challenge/create
interface LoginChallengeResponse {
  challenge_id: string;     // UUIDv4
  status: "pending_telegram_approval";
  expires_in_seconds: number; // Default 180s
  display_code: string;     // First 4 characters shown to user for visual confirmation
}

// Polling: GET /api/web-auth/challenge/{challenge_id}
interface LoginChallengeStatusResponse {
  status: "pending" | "approved" | "rejected" | "expired";
  authenticated: boolean;
  user?: {
    user_id: number;
    name: string;
    username?: string;
    student_id?: string;
    subscription_active: boolean;
  };
}
```

---

### 5.2 Protected PDF Page Delivery (Zero Raw Download & Pixel Watermarking)

To prevent unauthorized distribution of proprietary medical pamphlets and study booklets, raw PDF binaries are never transmitted to client browsers.

#### 5.2.1 Pipeline Architecture
```text
Original PDF (Private Disk/S3)
       │
       ▼
PyMuPDF Rendering Worker (150 DPI)
       │
       ▼
Base WebP Page (Cached on Server SSD)
       │
       ▼
Dynamic Watermark Stamp (Student Name + UID + Timestamp)
       │
       ▼
Signed Streaming Delivery (WebP with Cache-Control: no-store)
```

#### 5.2.2 Watermark Specification
- **Stamping Engine**: Server-side PIL / PyMuPDF alpha blending before byte transmission.
- **Visual Pattern**: Repeating diagonal text across the page at 45 degrees, opacity 14%, font size 18pt.
- **Payload**: `هامزیار | {user_name} ({user_id}) | {request_ip} | {timestamp}`.
- **Delivery Protocol**:
  - Endpoint: `GET /api/web/reader/page/{file_id}/{page_number}?token={hmac_token}&expires={timestamp}`
  - Content-Type: `image/webp`
  - Headers:
    - `Cache-Control: private, no-store, no-cache, max-age=0, must-revalidate`
    - `Pragma: no-cache`
    - `X-Content-Type-Options: nosniff`

```typescript
// Response: GET /api/web/reader/manifest/{scope}/{file_id}
interface ProtectedDocumentManifest {
  file_id: string;
  scope: "res" | "ref";
  title: string;
  total_pages: number;
  page_dimensions: Array<{
    page: number;
    width: number;
    height: number;
    aspect_ratio: number;
  }>;
  encryption_mode: "server_webp_watermarked";
  watermark_user_id: number;
}
```

---

### 5.3 Digital Ink Vector Data Model (Stylus, Pressure & Time)

Digital annotations are captured and synchronized as high-fidelity normalized vector points rather than raster images, ensuring crisp scaling across any screen resolution and device zoom.

#### 5.3.1 Vector Point & Stroke Schema
- **Coordinate Space**: Normalized float values where `x ∈ [0.0, 1.0]` and `y ∈ [0.0, 1.0]`, relative to the page's intrinsic aspect ratio.
- **Pressure Support**: PointerEvent `e.pressure` recorded in range `[0.0, 1.0]`. When pressure is unavailable (e.g. mouse), normalized to `0.5`.
- **Temporal Resolution**: Relative time in milliseconds from stroke initiation, enabling natural velocity calculation for handwriting smoothing.

```typescript
interface Point {
  x: number;          // Float in [0.0, 1.0] relative to page width
  y: number;          // Float in [0.0, 1.0] relative to page height
  pressure: number;   // Float in [0.0, 1.0]
  time: number;       // Milliseconds from stroke start
}

interface Stroke {
  stroke_id: string;  // UUIDv4 per stroke
  tool: "pen" | "pencil" | "highlighter" | "eraser";
  color: string;      // Hex string, e.g. "#1740B8"
  width: number;      // Base width in points (1.0 to 24.0)
  opacity: number;    // Float in [0.0, 1.0] (e.g. 0.35 for highlighter)
  blend_mode: "source-over" | "multiply";
  points: Point[];    // Sequential vector path
  created_at: string; // ISO 8601 string
}

interface PageAnnotationDocument {
  user_id: number;
  scope: "res" | "ref";
  file_id: string;
  page: number;
  page_revision: number; // Monotonically increasing revision counter
  strokes: Stroke[];
  updated_at: string;
}
```

---

### 5.4 Sync Engine Protocol (IndexedDB Queue & Conflict Resolution)

Students frequently read and annotate study materials under unstable campus Wi-Fi or during commutes. The client must record strokes instantly with zero lag, queue mutations locally, and synchronize seamlessly with the server.

#### 5.4.1 Sync States & Architecture
1. **Local Storage**: IndexedDB object store `hy_ink_mutations` with key `mutation_id` (UUID).
2. **Mutation Envelope**:
   - `mutation_id`: UUIDv4
   - `scope`: `"res"` | `"ref"`
   - `file_id`: string
   - `page`: number
   - `action`: `"upsert_stroke"` | `"delete_stroke"` | `"clear_page"`
   - `stroke_data`?: Stroke
   - `client_revision`: number
   - `timestamp`: number
   - `status`: `"pending"` | `"syncing"` | `"synced"` | `"failed"`
3. **Server Endpoint**: `POST /api/web/ink/sync`
   - Accepts batches of up to 50 operations.
   - Idempotent execution using `mutation_id`.
   - Returns applied operations and server page revisions.
4. **Conflict Resolution Policy (Last-Write-Wins per Stroke)**:
   - Strokes are identified by persistent UUID `stroke_id`.
   - Modifying or erasing a stroke updates that specific `stroke_id`.
   - If two devices modify different strokes on the same page, the operations merge cleanly.
   - If a page revision mismatch occurs, the server applies non-conflicting stroke additions and returns the unified authoritative stroke array.

```typescript
// Request: POST /api/web/ink/sync
interface SyncBatchRequest {
  client_id: string;
  mutations: Array<{
    mutation_id: string;
    file_id: string;
    scope: "res" | "ref";
    page: number;
    action: "upsert_stroke" | "delete_stroke" | "clear_page";
    stroke?: Stroke;
    timestamp: number;
  }>;
}

// Response: POST /api/web/ink/sync
interface SyncBatchResponse {
  processed: number;
  successful_ids: string[];
  conflicts: Array<{
    mutation_id: string;
    reason: "revision_conflict" | "document_locked";
    server_page_state: PageAnnotationDocument;
  }>;
  server_timestamp: string;
}
```

---

## 6. Definition of Done (Wave 0 Exit Criteria)

Wave 0 is complete when the following artifacts are generated, verified, and committed:
1. `PROJECT.md` (this file) published at repository root.
2. `TEST_INFRA.md` published at repository root detailing the 4-tier testing philosophy and runner instructions.
3. `docs/architecture/SYSTEM_ARCHITECTURE.md` establishing the master diagrams, network topology, and security perimeters.
4. `docs/architecture/CODEBASE_AUDIT.md` consolidating backend, frontend, and infrastructure findings.
5. `docs/architecture/PROJECT_STRUCTURE.md` documenting monorepo layout and facade shim migration.
6. `docs/architecture/API_CONTRACTS.md` specifying complete REST/WebSocket endpoints and error contracts.
7. `docs/architecture/AGENT_OWNERSHIP.md` establishing write boundaries and collision rules for upcoming waves.
8. `docs/PROJECT_PROGRESS.md` published tracking Wave 0 through Wave 7 status.
