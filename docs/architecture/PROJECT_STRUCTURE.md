# PROJECT_STRUCTURE.md — Target Monorepo Architecture & Migration Roadmap
**Enterprise Codebase Modernization, Modular Directory Taxonomy & Facade Shim Design**

---

## 1. Target Directory Taxonomy

To achieve modular separation of concerns without breaking existing running services, the project establishes the following monorepo architecture:

```text
humsyarx/
├── apps/                         # Frontends & Client Applications
│   ├── student/                  # Independent Student PWA (React 18 + TS + Vite)
│   ├── miniapp/                  # Telegram Mini App (React 18 + Vite)
│   └── admin/                    # WebAdmin Operational Dashboard (React 18 + Vite)
│
├── backend/                      # Unified Python FastAPI & Telegram Services
│   ├── api/                      # Web API Layer
│   │   ├── routers/              # 33 Modular REST / WebSocket route handlers
│   │   ├── auth.py               # Unified HMAC & Session dependency injection
│   │   ├── rate_limit.py         # Request rate-limiting token bucket engine
│   │   └── main.py               # FastAPI application factory & lifespan
│   ├── bot/                      # Telegram Bot Messaging & Polling Layer
│   │   ├── bot.py                # Main bot runtime, JobQueue scheduler, polling loop
│   │   ├── start.py              # Onboarding, intake selection, registration handler
│   │   ├── message_router.py     # Command & persistent keyboard message router
│   │   └── admin.py              # Telegram-native admin callback panel
│   ├── core/                     # Core Business Domain Rules
│   │   ├── access.py             # Single-source-of-truth access control engine
│   │   └── features.py           # Feature catalog, kill switches, quotas
│   ├── database/                 # Data Access Layer & ORM
│   │   ├── database.py           # DB master instance aggregating mixins
│   │   ├── core.py               # Core users, audit, notification collections
│   │   ├── content.py            # Academic courses, sessions, files collections
│   │   ├── finance.py            # Subscriptions, payments, wallet collections
│   │   ├── rbac.py               # Roles, user roles, permission checks
│   │   └── prestige.py           # Gamification ranks, weekly leagues collections
│   ├── services/                 # Cross-Cutting Domain Engines
│   │   ├── pdf_renderer.py       # PyMuPDF WebP page rasterization & watermarking
│   │   ├── storage.py            # Abstract Private Storage driver (Disk & S3)
│   │   ├── ai_solver.py          # HooshYar multi-provider LLM engine
│   │   ├── broadcast_service.py  # Asynchronous bulk announcement dispatcher
│   │   └── qbank_builder.py      # Persian RTL exam PDF builder (ReportLab)
│   ├── integrations/             # Third-Party Gateway & Protocol Adapters
│   │   ├── zarinpal.py           # ZarinPal payment gateway integration
│   │   └── telegram_send.py      # Telegram Bot MTProto file streamer
│   └── workers/                  # Throttled Background Queue Workers
│       └── render_worker.py      # Concurrency=1 PDF WebP page rasterizer
│
├── packages/                     # Shared Cross-Platform Libraries
│   ├── api-contracts/            # Shared TypeScript API client & interfaces
│   ├── shared-types/             # Shared TypeScript & Python domain data models
│   └── shared-config/            # Shared styling design tokens & ESLint/Ruff configs
│
├── infrastructure/               # DevOps, Containers & Deployment Configuration
│   ├── docker/                   # Dockerfile, supervisord.conf, entrypoint.sh
│   ├── proxy/                    # Caddyfile (SSL termination, reverse proxy)
│   └── deployment/               # deploy.sh, backup scripts, vps.env.example
│
├── tests/                        # Comprehensive 4-Tier Test Suite
│   ├── unit/                     # Fast isolated unit tests
│   ├── integration/              # Database & API contract integration tests
│   ├── e2e/                      # End-to-end browser & workflow tests
│   ├── security/                 # Auth, DRM bypass, rate limit verification
│   └── run_ci.py                 # Custom CI runner with baseline gating
│
├── docs/                         # Authoritative Architectural Documentation
│   ├── architecture/             # System blueprints, audits, and API contracts
│   └── PROJECT_PROGRESS.md       # Master wave tracking report
│
├── PROJECT.md                    # Platform Master Blueprint
├── TEST_INFRA.md                 # Testing strategy & 4-tier matrix
├── README.md                     # Repository developer onboarding
└── docker-compose.yml            # Production container orchestration
```

---

## 2. Exhaustive File Migration Mapping

The table below maps existing root-level files into their target locations in the monorepo:

| Existing Root File | Target Monorepo Destination | Category | Status & Handling |
|---|---|---|---|
| `bot.py` | `backend/bot/bot.py` | Bot Engine | Move + Root Shim |
| `start.py` | `backend/bot/start.py` | Bot Engine | Move + Root Shim |
| `message_router.py` | `backend/bot/message_router.py` | Bot Engine | Move + Root Shim |
| `admin.py` | `backend/bot/admin.py` | Bot Engine | Move + Root Shim |
| `database.py` | `backend/database/database.py` | Data Access | Move + Root Shim |
| `db/*` | `backend/database/*` | Data Access | Move + Root Shim |
| `core/access.py` | `backend/core/access.py` | Business Logic | Move + Root Shim |
| `core/features.py` | `backend/core/features.py` | Business Logic | Move + Root Shim |
| `api/*` | `backend/api/*` | Web API | Move + Root Shim |
| `ai_solver.py` | `backend/services/ai_solver.py` | Services | Move + Root Shim |
| `broadcast_service.py` | `backend/services/broadcast_service.py` | Services | Move + Root Shim |
| `payments/zarinpal.py` | `backend/integrations/zarinpal.py` | Integrations | Move + Root Shim |
| `miniapp/` | `apps/miniapp/` | Frontend | Relocate to `apps/miniapp/` |
| `webadmin/` | `apps/admin/` | Frontend | Relocate to `apps/admin/` |
| `apps/student/` | `apps/student/` | Frontend | Retain, revitalize, & expand |
| `Dockerfile` | `infrastructure/docker/Dockerfile` | Infra | Move + Symlink at root |
| `docker/supervisord.conf` | `infrastructure/docker/supervisord.conf`| Infra | Relocate to `infrastructure/docker/` |
| `Caddyfile` | `infrastructure/proxy/Caddyfile` | Infra | Move + Symlink at root |
| `vps.env.example` | `infrastructure/deployment/vps.env.example` | Infra | Relocate |
| `humsyar-prototype.html` | Archived | Hygiene | Removed from active root |
| `src/` (root prototype) | Archived | Hygiene | Removed from active root |

---

## 3. Safe Two-Phase Facade / Shim Migration Roadmap

Directly moving Python modules breaks running code, supervisord scripts, and unittest imports. The transition must be completely non-disruptive:

### Phase 1: Facade Shim Deployment
1. Modules are created in their new target locations under `backend/`.
2. In the repository root, each original file name is retained as a lightweight **Facade Shim**. Crucially, instead of simple `from backend.xxx import *`, all module-level shims MUST employ explicit `sys.modules[__name__] = _mod` aliasing:
   ```python
   # root: database.py
   """Facade shim aliasing the module to prevent dual-import split-brain singletons."""
   import sys
   import backend.database.database as _mod
   sys.modules[__name__] = _mod
   ```
   ```python
   # root: admin.py
   """Facade shim aliasing the module to prevent dual-import split-brain singletons."""
   import sys
   import backend.bot.admin as _mod
   sys.modules[__name__] = _mod
   ```

   **Rationale for `sys.modules` Aliasing**:
   In Python, `from backend.database.database import *` creates two distinct module entries in `sys.modules` (`database` and `backend.database.database`). Modules like `database.py` define module-level singletons (`db = DB()`) and connection pools. If one consumer imports `database` while another imports `backend.database.database`, two separate instances exist in memory, resulting in state divergence, duplicate connection pools, and `unittest.mock.patch` failing to intercept calls on the aliased module. By setting `sys.modules[__name__] = _mod`, both import paths resolve to the exact same module identity object in Python runtime memory.

3. **Package Directory Facade Strategy (`api/`, `db/`)**:
   Package directories with nested submodules (e.g., `api/routers/*`, `db/helpers/*`) cannot be replaced with a single flat `.py` file without breaking sub-package imports (e.g. `import api.routers.web_auth`). For directory packages:
   - Root directory packages (`api/`, `db/`) retain their directory structure throughout Phase 1.
   - Each package's `__init__.py` delegates to `backend/<pkg>` and aliases itself in `sys.modules`.
   - Submodule shims inside `api/routers/*.py` delegate to `backend/api/routers/*.py` using the identical `sys.modules[__name__] = _mod` pattern.

4. Update `Dockerfile` and `supervisord.conf` environment configuration to include both roots:
   ```dockerfile
   ENV PYTHONPATH="/srv/humsyar:/srv/humsyar/backend"
   ```
5. Verify complete system compilation and CI test execution:
   ```powershell
   python -X utf8 -m compileall -q backend api db core
   python -X utf8 tests/run_ci.py
   ```

### Phase 2: Systematic Consumer Re-targeting & Shim Deprecation
1. Update internal import statements across `backend/` to use relative or absolute package namespaces (e.g. `from backend.core.access import check_feature`).
2. Run test suites after each package refactor.
3. Once all tests and entry points run without invoking root shims, deprecate and remove the legacy root shims.

