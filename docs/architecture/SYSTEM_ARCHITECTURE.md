# SYSTEM_ARCHITECTURE.md — HumsYarX Platform
**Authoritative Architectural Blueprint, Network Topology & Systems Engineering**

---

## 1. System Overview & Philosophy

**HumsYarX** is an enterprise medical study platform combining real-time messaging, asynchronous learning management, offline-capable digital vector ink, and protected educational document delivery.

### 1.1 Core Immutable Architectural Decisions
1. **Unified Single Backend**: The platform runs a single, asynchronous Python FastAPI backend (`api/main.py`) serving both Telegram WebApp clients and independent web clients. There are no disjoint microservices for web vs. bot.
2. **Unified Single Database**: One MongoDB cluster running database `medicalbot`. No secondary database or data synchronization duplication.
3. **Unified Single Identity**: Students are identified across all client surfaces by their canonical integer Telegram `user_id`. Web authentication authenticates against this identity without creating secondary user records.
4. **Centralized Access Control**: Feature availability, subscription tier rights, and daily quotas are evaluated strictly server-side by `core/access.py` and `core/features.py`.

---

## 2. High-Level Component Architecture Diagram

```text
                                  INTERNET / CLIENTS
        ┌─────────────────────────┬─────────────────────────┬─────────────────────────┐
        │      Telegram Bot       │    Telegram Mini App    │   Student PWA / Web     │
        │   (Telegram Desktop/    │  (Telegram In-App Web   │ (Standalone Chrome, iOS │
        │     iOS / Android)      │   View on Mobile/PC)    │   Safari, iPad PWA)     │
        └────────────┬────────────┴────────────┬────────────┴────────────┬────────────┘
                     │                         │                         │
                     │ MTProto / Long-Polling  │ HTTPS (X-Init-Data)     │ HTTPS (hu_session Cookie)
                     ▼                         ▼                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                           REVERSE PROXY: Caddy 2 (TLS / HTTP/2 & 3)                         │
│                                 Domain: sw2.pwker.ir                                        │
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │
                                               │ Internal Docker Network (port 8000)
                                               ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                             FASTAPI ASYNCHRONOUS BACKEND                                    │
│                                                                                             │
│  ┌───────────────────────┐  ┌───────────────────────┐  ┌─────────────────────────────────┐  │
│  │   Security Headers    │  │   Range Request Guard │  │  Rate Limiting (Sliding Window) │  │
│  │   (CSP, NoSniff, XFO) │  │   (Starlette DoS Fix) │  │  (Global, OTP, AI endpoints)    │  │
│  └───────────────────────┘  └───────────────────────┘  └─────────────────────────────────┘  │
│                                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                               AUTHENTICATION GATEWAY                                  │  │
│  │  • Telegram initData HMAC Validator       • Web 8-Char Code + Bot Push Challenge      │  │
│  │  • Web User Session Resolver (hu_session) • Web Admin Session Resolver (wa_session)   │  │
│  └───────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                          CORE ACCESS CONTROL ENGINE (access.py)                       │  │
│  │  [Catalog Check] ──> [Killswitch] ──> [Admin Bypass] ──> [Subscription Entitlements]  │  │
│  │                       ──> [Trial Exclusion] ──> [Daily Usage Quotas]                  │  │
│  └───────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                                MODULAR ROUTER DOMAINS                                 │  │
│  │  • /api/web-auth          • /api/web/library       • /api/web/reader                  │  │
│  │  • /api/web/ink           • /api/questions         • /api/ai (HooshYar LLM)           │  │
│  │  • /api/schedule          • /api/subscription      • /api/web-admin                   │  │
│  └───────────────────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────┬───────────────────────────────┬──────────────────────────────────────┘
                       │                               │
                       ▼                               ▼
┌─────────────────────────────────────────┐   ┌───────────────────────────────────────────────┐
│              MONGODB 7.0                │   │             LOCAL PRIVATE STORAGE             │
│          Database: medicalbot           │   │             /data/storage/                    │
│                                         │   │                                               │
│  • users               • subscriptions  │   │  • originals/ (Master PDFs, no HTTP access)   │
│  • reading_progress    • web_ink_pages  │   │  • cache_webp/ (Base 150 DPI page renders)    │
│  • bs_content          • questions      │   │  • export/ (Generated RTL Exam PDFs)          │
│  • web_user_sessions   • schedules      │   └───────────────────────┬───────────────────────┘
└─────────────────────────────────────────┘                           │
                                                                      │ Task Queue
                                                                      ▼
                                              ┌───────────────────────────────────────────────┐
                                              │       DEDICATED PDF RENDERING WORKER          │
                                              │    (PyMuPDF / fitz, Concurrency = 1)          │
                                              │  • WebP Page Rasterization                    │
                                              │  • Dynamic Per-User Diagonal Watermarking     │
                                              └───────────────────────────────────────────────┘
```

---

## 3. End-to-End Data Flows

### 3.1 Web Authentication Protocol (8-Char Code + Bot Push Approval)

```text
Student (Browser)          FastAPI Backend            Telegram Bot            Student (Telegram)
      │                           │                         │                          │
      │ 1. POST /auth/challenge   │                         │                          │
      │    {code: "7K9M-2P4X"}    │                         │                          │
      ├──────────────────────────>│                         │                          │
      │                           │ 2. Create Challenge     │                          │
      │                           │    UUID & Decoy Check   │                          │
      │                           ├────────────────────────>│                          │
      │                           │                         │ 3. Send Push Message     │
      │                           │                         │    with Inline Buttons   │
      │                           │                         ├─────────────────────────>│
      │ 4. Challenge Response     │                         │                          │
      │    {challenge_id, 180s}   │                         │                          │
      │<──────────────────────────┤                         │                          │
      │                           │                         │                          │
      │ 5. Poll / Listen          │                         │ 6. Taps [ ✅ تایید ورود ] │
      │    /auth/challenge/{id}   │                         │<─────────────────────────┤
      ├──────────────────────────>│                         │                          │
      │                           │ 7. CallbackQuery        │                          │
      │                           │<────────────────────────┤                          │
      │                           │                         │                          │
      │                           │ 8. Update Challenge:    │                          │
      │                           │    status = "approved"  │                          │
      │ 9. Return Session Cookie  │                         │                          │
      │    Set-Cookie: hu_session │                         │                          │
      │<──────────────────────────┤                         │                          │
```

### 3.2 Protected PDF Page Delivery Pipeline

```text
Student (Reader)           FastAPI Backend             PyMuPDF Worker          Private Storage
      │                           │                          │                         │
      │ 1. GET /reader/page/      │                          │                         │
      │    {file_id}/{page}?token │                          │                         │
      ├──────────────────────────>│                          │                         │
      │                           │ 2. Validate HMAC Token   │                         │
      │                           │    & Check Subscription  │                         │
      │                           │                          │                         │
      │                           │ 3. Check Base WebP Cache │                         │
      │                           ├───────────────────────────────────────────────────>│
      │                           │    (Miss)                │                         │
      │                           │ 4. Singleflight Lock     │                         │
      │                           │    Coalesce Concurrency  │                         │
      │                           ├─────────────────────────>│                         │
      │                           │                          │ 5. Read Master PDF      │
      │                           │                          ├────────────────────────>│
      │                           │                          │ 6. Render Page (150DPI) │
      │                           │                          │    Pillow WebP Encoding │
      │                           │                          ├────────────────────────>│
      │                           │ 7. Return Base WebP      │                         │
      │                           │<─────────────────────────┤                         │
      │                           │                          │                         │
      │                           │ 8. Dynamic Watermark     │                         │
      │                           │    Fast Alpha Blit + Bidi│                         │
      │ 9. Return WebP Image      │                          │                         │
      │    Cache-Control: no-store│                          │                         │
      │<──────────────────────────┤                          │                         │
```

#### 3.2.1 PyMuPDF to WebP Conversion Mechanics
Direct invocation of `pixmap.tobytes("webp")` raises `ValueError: Image format webp not in ('png', 'jpg', ...)` because PyMuPDF does not bundle native WebP serialization. Page rasterization converts raw pixmap bytes into Pillow images before WebP encoding:
```python
# Server Worker WebP Encoding Pipeline
pix = page.get_pixmap(dpi=150)
img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
img.save(webp_buffer, format="WEBP", quality=80, method=4)
```

#### 3.2.2 In-Flight Singleflight Coalescing Lock
To prevent queue choking on the single-core worker (0.6 vCPU, concurrency=1) when multiple clients or pre-fetching routines request the exact same uncached page simultaneously, the backend implements the **Singleflight Pattern** (`asyncio.Event` group):
- The first arriving request registers a pending task future for `(file_id, page, dpi)`.
- Subsequent concurrent requests for that identical page await the existing future rather than enqueueing duplicate worker jobs.
- Upon completion, the rendered base WebP buffer is shared across all awaiting requests, eliminating redundant rasterization latency.

#### 3.2.3 Two-Tier Resolution Strategy
- **Thumbnail View (72 DPI)**: Low-resolution thumbnails (~30 KB) generated lazily or asynchronously with lower priority to prevent queue choking during initial booklet browsing.
- **Reading View (150 DPI)**: High-resolution crisp reading pages (~170 KB) rendered on priority queue for active viewports.

#### 3.2.4 Dynamic Watermarking & Persian RTL Shaping
- **Fast SIMD Alpha Blit**: The diagonal student watermark pattern is pre-rendered once per user session and composited over the base WebP page using optimized Pillow alpha blending, reducing per-request watermark overhead from 365ms to < 50ms.
- **RTL Persian Shaping**: Persian student names (e.g. "علوی‌زاده") are formatted with `arabic_reshaper.reshape()` and `bidi.algorithm.get_display()` to prevent disconnected glyphs and reversed letter order.

---

## 4. Production Host Bounds & VPS Allocation Model

Target Production Environment: `sw2.pwker.ir`
- **vCPU Cores**: 2 Cores
- **System Memory**: 8,192 MB (8 GB)
- **Primary Disk**: 50 GB NVMe SSD
- **Swap Partition**: 2,048 MB (2 GB)

### 4.1 Strict Container Resource Caps (`docker-compose.yml`)

To prevent Out-Of-Memory (OOM) fatal kills or CPU starvation on the dual-core VPS, strict limits are placed on all runtime containers:

| Container / Service | Memory Limit | CPU Quota | Rationale |
|---|---|---|---|
| **`caddy`** | 256 MB | 0.2 vCPU | Reverse proxy, TLS handshake termination, static asset compression. |
| **`mongo`** | 2,560 MB (2.5 GB) | 0.8 vCPU | WiredTiger memory pinned to 1,024 MB; accommodates query caches and indexing. |
| **`app` (FastAPI + Bot)** | 3,072 MB (3.0 GB) | 1.2 vCPU | Web request event loop, Telegram bot polling, token parsing. |
| **`worker` (Rendering)** | 1,024 MB (1.0 GB) | 0.6 vCPU | PyMuPDF page rasterization; concurrency strictly throttled to 1. |
| **Host System & OS** | 1,024 MB (1.0 GB) | 0.2 vCPU | Linux kernel, SSH daemon, system logging, Docker daemon. |
| **Total** | **7,936 MB / 8 GB** | **2.0 vCPU Cores** | 100% bounded; OOM kill risk mitigated. |

### 4.2 Storage Allocation Strategy & LRU Cache Eviction (50 GB Boundary)

```text
50 GB Total Disk Space
├── [10 GB] Ubuntu Host OS, Kernel, Packages, System Logs
├── [ 6 GB] Docker Engine & Application Container Images
├── [ 6 GB] MongoDB Database Data Files & Working Indexes
├── [ 2 GB] Linux Swap Partition
├── [11 GB] Protected Master PDFs (200 volumes @ 30-55 MB)
├── [ 5 GB] Rendered WebP Page Cache (LRU Eviction Ceiling)
└── [10 GB] Emergency Free Disk Buffer (Guaranteed Host Headroom)
```

#### LRU Cache Eviction Mechanics:
1. **Watermark Ceilings**:
   - **High Watermark (4.5 GB)**: Background cleanup task triggers automatically when `/data/storage/cache_webp/` reaches 4.5 GB.
   - **Low Watermark (3.5 GB)**: Eviction systematically removes least-recently-accessed WebP files until disk usage drops below 3.5 GB, providing 1.5 GB headroom.
2. **Access Ledger vs Filesystem `atime`**:
   - Because production Linux NVMe drives mount with `noatime` for I/O performance, filesystem access timestamps cannot be relied upon.
   - Access recency is maintained via an in-memory/MongoDB access ledger (`webp_cache_ledger`) updating `last_accessed_at` upon page delivery.
3. **In-Flight Read Locking**:
   - A reference counter / read lock protects active files during watermarking and streaming. Eviction checks the lock and skips deleting any file currently being processed.

**Object Storage Migration Trigger**:
When total master PDF volume exceeds 20 GB, master PDF storage automatically switches to an S3-compatible provider (ArvanCloud / Liara / Cloudflare R2) via `STORAGE_BACKEND=s3` in `vps.env`, preserving the 50 GB VPS disk purely for database and WebP caching.


---

## 5. Security Architecture & Threat Model

### 5.1 Threat Surface Mitigations

| Threat Vector | Potential Impact | Engineered Defense |
|---|---|---|
| **Bulk PDF Scraping** | Piracy of premium proprietary medical booklets | Raw PDF binary is never sent to browser; pages rendered to WebP on server; dynamic per-user pixel watermark; 10-minute HMAC token expiry. |
| **Starlette Range Parsing DoS** | CPU exhaustion via overlapping byte ranges (PYSEC-2026-1942) | Middleware rejects Range headers with > 16 intervals or > 512 characters with HTTP 416. |
| **Account Enumeration** | Determining student presence by username/ID | Login challenge responder uses decoy challenge generation with equal-time response curves. |
| **Token Hijacking & Replay** | Unauthorized web session assumption | Tokens stored as SHA256 hashes in MongoDB; HTTP-only, Secure, SameSite=Lax cookies; remote device revocation. |
| **Unencrypted Backups** | Data leak via intercepted Telegram backup dumps | Database backups encrypted with AES-256 Fernet keys before transmission to Telegram backup channels. |
| **Client Memory Leaks in PWA**| Tablet browser crash during 100-page continuous read | Virtualized viewport rendering; off-screen canvas elements destroyed; stroke vectors batched and cleared. |

---

## 6. Monorepo Verification & Compliance

All system components adhere to the layout rules specified in `PROJECT.md` and `PROJECT_STRUCTURE.md`. No test logic or production implementations reside within `.agents/teamwork/`.
