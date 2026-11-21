# AGENT_OWNERSHIP.md — Multi-Agent Boundaries, Ownership & Collision Prevention
**Authoritative Scope Governance, Write Isolation & Collaboration Protocol**

---

## 1. Multi-Agent Team Taxonomy & Scopes

To ensure rapid, defect-free execution without race conditions or conflicting edits, strict directory and file boundaries govern all engineering agents across Waves 0 through 7.

```text
┌────────────────────────────────────────────────────────────────────────┐
│                   ORCHESTRATOR / CHIEF ARCHITECT                       │
│    Owns: PROJECT.md, docs/architecture/*, docs/PROJECT_PROGRESS.md     │
└───────────┬──────────────┬──────────────┬──────────────┬───────────────┘
            │              │              │              │
            ▼              ▼              ▼              ▼
     ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
     │  Backend &   │ │  Frontend &  │ │ PDF Reader & │ │   DevOps &   │
     │  Database    │ │  Product UI  │ │ Digital Ink  │ │Infrastructure│
     │   Engineer   │ │   Engineer   │ │   Engineer   │ │   Engineer   │
     └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
            │                │                │                │
            └────────────────┼────────────────┼────────────────┘
                             ▼
              ┌──────────────────────────────┐
              │   QA, Security & Testing     │
              │         Engineer             │
              │   Owns: tests/*, TEST_INFRA  │
              └──────────────────────────────┘
```

---

## 2. Strict Domain & Directory Ownership Matrix

| Agent Role | Exclusive Write Directories / Files | Read-Only Access | Strictly Prohibited Modifications |
|---|---|---|---|
| **Agent 1: Chief Architect** | `PROJECT.md`, `docs/architecture/*`, `docs/PROJECT_PROGRESS.md` | Entire repository | Modifying production implementation code directly without task dispatch. |
| **Agent 2: Backend & Database** | `backend/api/`, `backend/core/`, `backend/database/`, `backend/services/` (non-PDF), `backend/bot/` | `apps/`, `tests/` | Modifying frontend UI files in `apps/` or altering test assertion baselines. |
| **Agent 3: Frontend & UI** | `apps/student/`, `packages/shared-config/`, `packages/shared-types/` | `backend/`, `tests/` | Editing FastAPI Python routers, modifying MongoDB queries, or editing bot handlers. |
| **Agent 4: PDF Reader & Ink** | `backend/services/pdf_renderer.py`, `backend/workers/`, `apps/student/src/screens/reader/`, `apps/student/src/lib/ink.ts` | `backend/core/`, `apps/` | Modifying backend payment modules, touching `bot.py`, or editing admin panels. |
| **Agent 5: DevOps & Infra** | `infrastructure/`, `docker-compose.yml`, `Dockerfile`, `Caddyfile`, `vps.env.example` | `backend/`, `apps/` | Modifying business logic or altering frontend application components. |
| **Agent 6: QA & Security** | `tests/unit/`, `tests/integration/`, `tests/e2e/`, `tests/security/`, `TEST_INFRA.md` | Entire repository | Modifying source code to force tests to pass; loosening security policies. |

---

## 3. Wave-by-Wave Agent Interaction Schedule

| Wave | Primary Lead Agent | Secondary Support Agents | Milestone Objective |
|---|---|---|---|
| **Wave 0** | Agent 1 (Architect) | Agents 2, 3, 5, 6 | Complete codebase audit, publish master blueprints and API contracts. |
| **Wave 1** | Agent 1 (Architect) | Agent 2 (Backend), Agent 5 (Infra) | Establish monorepo structure with root facade shims; prune dead prototypes. |
| **Wave 2** | Agent 2 (Backend) | Agent 1 (Architect), Agent 6 (QA) | Unify web authentication, 8-character codes, Telegram bot approval challenges. |
| **Wave 3** | Agent 3 (Frontend) | Agent 2 (Backend), Agent 6 (QA) | Build student PWA shell, Morakkab design system, fluid desktop layout. |
| **Wave 4** | Agent 4 (PDF/Ink) | Agent 2 (Backend), Agent 5 (Infra) | PyMuPDF WebP rasterizer, dynamic per-user watermark, signed page streaming. |
| **Wave 5** | Agent 4 (PDF/Ink) | Agent 3 (Frontend), Agent 2 (Backend) | Stylus pointer vector layer, software palm rejection, IndexedDB sync engine. |
| **Wave 6** | Agent 3 (Frontend) | Agent 2 (Backend), Agent 6 (QA) | Complete feature parity: QBank, HooshYar AI streaming, Persian Jalali schedule. |
| **Wave 7** | Agent 5 (DevOps) | Agent 6 (QA), Agent 1 (Architect) | PWA caching rules, production Docker limits, Caddy HTTPS on `sw2.pwker.ir`. |

---

## 4. Collision Prevention Rules

1. **Single Writer Rule**: No file may be opened for modification by more than one agent during the same wave turn.
2. **Pre-Modification Re-Reading**: Every agent MUST execute `view_file` on target files immediately before modifying them to verify current line numbers and contents.
3. **Interface Freeze Before Implementation**: Backend routers and frontend consumers must freeze their interface schemas in `docs/architecture/API_CONTRACTS.md` before writing implementation code.
4. **Isolated Metadata Workspaces**: Each agent writes internal notes, briefing, and handoff reports strictly within their dedicated workspace folder in `.agents/teamwork/<agent_name>/`. Writing metadata outside this folder or committing source files into `.agents/` is an integrity violation.
5. **No Silent Regression Modification**: If a test fails after an agent makes a code change, the agent must fix the implementation code. Under no circumstance may an agent disable, delete, or add dummy assertions to test files.
