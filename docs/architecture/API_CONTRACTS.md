# API_CONTRACTS.md — HumsYarX API Specification
**Authoritative REST & WebSocket Interface Contracts, Schemas & Error Protocols**

---

## 1. Global API Conventions

### 1.1 Authentication & Security Headers
All endpoints mounted under `/api/` authenticate incoming requests via one of two mechanisms:
1. **Telegram WebApp**: Header `X-Init-Data` carrying HMAC-SHA256 signed query string validated with `BOT_TOKEN`.
2. **Web / PWA**: Secure HTTP-only cookie named `hu_session` containing SHA256 hashed session token stored in `web_user_sessions`.

Every response emits structured diagnostic and security headers:
- `X-Request-Id`: `HY-YYYYMMDD-XXXXXX` (e.g. `HY-20261105-9B2F10`)
- `X-Content-Type-Options`: `nosniff`
- `Referrer-Policy`: `strict-origin-when-cross-origin`

### 1.2 Rate Limiting Policies
- **Global API Rate Limit**: 120 requests/minute per client IP (HTTP 429 upon exhaustion).
- **Web Auth OTP & Challenge**: 5 requests/10 minutes per IP/User (HTTP 429).
- **HooshYar AI Queries**: 30 requests/minute per user (HTTP 429).

---

## 2. API Domain Specifications

### 2.1 Web Authentication (`/api/web-auth`)

#### `POST /api/web-auth/challenge/create`
Initiates web login challenge via 8-character user code.
- **Access**: Public (Rate-limited: 5 req/10 min)
- **Request Body**:
  ```json
  {
    "user_code": "7K9M-2P4X",
    "client_info": {
      "device_name": "iPad Pro 11-inch",
      "browser": "Safari 17.4"
    }
  }
  ```
- **Response (200 OK)**:
  ```json
  {
    "challenge_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "status": "pending_telegram_approval",
    "expires_in_seconds": 180,
    "display_code": "7K9M"
  }
  ```
- **Error Codes**: `422 Unprocessable Entity` (code format invalid), `429 Too Many Requests`.

#### `GET /api/web-auth/challenge/{challenge_id}`
Polls status of pending login challenge.
- **Access**: Public
- **Response (200 OK)**:
  ```json
  {
    "status": "approved",
    "authenticated": true,
    "user": {
      "user_id": 123456789,
      "name": "Ali Rezaei",
      "username": "alirez",
      "student_id": "401123456",
      "subscription_active": true
    }
  }
  ```
  *Atomic State Transitions*: `pending_telegram_approval` -> `approved` -> `consumed` (or `rejected` / `expired`).
  *Side Effect*: Upon status transitioning to `approved`, the server atomically marks the challenge as `consumed` to prevent replay and emits the HTTP-only cookie `hu_session`. If a client re-polls an already consumed challenge, the server returns HTTP 403 `CHALLENGE_ALREADY_CONSUMED`.

#### `POST /api/web-auth/fallback/verify`
Emergency login verification for users without active Telegram MTProto connectivity.
- **Access**: Public (Rate-limited: 5 req/10 min)
- **Request Body**:
  ```json
  {
    "user_code": "7K9M-2P4X",
    "fallback_otp": "839102"
  }
  ```
- **Response (200 OK)**:
  ```json
  {
    "status": "approved",
    "authenticated": true,
    "user": {
      "user_id": 123456789,
      "name": "Ali Rezaei",
      "student_id": "401123456",
      "subscription_active": true
    }
  }
  ```
  *Side Effect*: Emits HTTP-only cookie `hu_session`.
- **Error Codes**: `401 INVALID_FALLBACK_CODE`, `403 ACCOUNT_SUSPENDED`, `429 RATE_LIMIT_EXCEEDED`.

#### `POST /api/web-auth/logout`
Terminates current web session and revokes database session hash.
- **Access**: Authenticated (`hu_session`)
- **Response (200 OK)**: `{"ok": true}`.

#### `GET /api/web-auth/sessions`
Lists all active devices for the current student.
- **Access**: Authenticated
- **Response (200 OK)**:
  ```json
  {
    "sessions": [
      {
        "session_id": "c7a8e912bc4f",
        "device_name": "iPad Pro (Safari)",
        "ip_address": "5.234.12.89",
        "is_current": true,
        "created_at": "2026-11-05T14:20:00Z",
        "last_active": "2026-11-05T16:15:00Z"
      }
    ]
  }
  ```

#### `DELETE /api/web-auth/sessions/{session_id}`
Remotely revokes a specific device session.
- **Access**: Authenticated
- **Response (200 OK)**: `{"revoked": true}`.

---

### 2.2 Curriculum & Reference Library (`/api/web/library`, `/api/web/reader`)

#### `GET /api/web/library/terms`
Lists all academic terms with available lessons.
- **Access**: Authenticated
- **Response (200 OK)**:
  ```json
  {
    "terms": [
      { "term": 1, "title": "ترم ۱", "courses_count": 8 },
      { "term": 2, "title": "ترم ۲", "courses_count": 7 }
    ]
  }
  ```

#### `GET /api/web/library/lessons/{term}`
Lists courses for a specific term, filtered by student intake.
- **Access**: Authenticated
- **Response (200 OK)**:
  ```json
  {
    "lessons": [
      {
        "lesson_id": "les_anat_01",
        "title": "آناتومی عمومی",
        "sessions_count": 14,
        "department": "علوم تشریح"
      }
    ]
  }
  ```

#### `GET /api/web/library/lessons/{lesson_id}/sessions`
Lists course sessions and associated attachments.
- **Access**: Authenticated
- **Response (200 OK)**:
  ```json
  {
    "lesson_id": "les_anat_01",
    "title": "آناتومی عمومی",
    "sessions": [
      {
        "session_id": "sess_anat_01_03",
        "title": "جلسه ۳: استخوان‌شناسی اندام فوقانی",
        "order": 3,
        "files": [
          {
            "file_id": "file_8923a7",
            "title": "جزوه اسلایدها و نکات استاد",
            "kind": "pdf",
            "size_bytes": 14285900,
            "is_protected": true
          },
          {
            "file_id": "file_8923a8",
            "title": "فایل صوتی کلاس",
            "kind": "audio",
            "size_bytes": 35200100,
            "is_protected": false
          }
        ]
      }
    ]
  }
  ```

#### `GET /api/web/library/subjects`
Lists preclinical and clinical reference textbook categories.
- **Access**: Authenticated
- **Response (200 OK)**:
  ```json
  {
    "subjects": [
      { "subject_id": "sub_internal", "title": "بیماری‌های داخلی", "books_count": 12 },
      { "subject_id": "sub_surgery", "title": "جراحی عمومی", "books_count": 8 }
    ]
  }
  ```

#### `GET /api/web/library/subjects/{subject_id}/books`
Lists textbooks within a medical subject.
- **Access**: Authenticated
- **Response (200 OK)**:
  ```json
  {
    "books": [
      {
        "book_id": "bk_harrison_21",
        "title": "اصول طب داخلی هاریسون",
        "edition": "ویرایش ۲۱ (۲۰۲۲)",
        "authors": ["J. Larry Jameson", "Anthony S. Fauci"],
        "cover_url": "/api/web/library/covers/bk_harrison_21.webp",
        "volumes_count": 2
      }
    ]
  }
  ```

#### `GET /api/web/library/books/{book_id}/files`
Lists volumes and chapter files for a reference textbook.
- **Access**: Authenticated
- **Response (200 OK)**:
  ```json
  {
    "book_id": "bk_harrison_21",
    "files": [
      {
        "file_id": "file_har_vol1",
        "title": "جلد اول: مبانی پزشکی و بیماری‌های قلبی عروقی",
        "is_protected": true,
        "total_pages": 1240
      }
    ]
  }
  ```

#### `GET /api/web/library/download/{scope}/{file_id}`
Streams downloadable non-protected course files (audio recordings, general summaries).
- **Access**: Subscription Required (`require_feature_access('resources')`)
- **Headers Returned**:
  - `Content-Disposition`: `attachment; filename="..."`
  - `Accept-Ranges`: `bytes`
- **Error Codes**: `403 PROTECTED_RESOURCE_DIRECT_DOWNLOAD_PROHIBITED` (if file is protected pamphlet), `404 NOT_FOUND`.

#### `GET /api/web/reader/manifest/{scope}/{file_id}`
Returns protected document metadata and page dimensions.
- **Access**: Subscription Required (`require_feature_access('resources')`)
- **Response (200 OK)**:
  ```json
  {
    "file_id": "file_8923a7",
    "scope": "res",
    "title": "جزوه فیزیولوژی اعصاب - جلسه ۳",
    "total_pages": 42,
    "page_dimensions": [
      { "page": 1, "width": 1240, "height": 1754, "aspect_ratio": 0.707 }
    ],
    "encryption_mode": "server_webp_watermarked",
    "watermark_user_id": 123456789
  }
  ```

#### `GET /api/web/reader/page/{file_id}/{page}`
Streams individual watermarked WebP page image.
- **Access**: HMAC Signed Token Required (`?token=...&expires=...`)
- **Headers Returned**:
  - `Content-Type`: `image/webp`
  - `Cache-Control`: `private, no-store, no-cache, max-age=0, must-revalidate`
- **Error Codes**: `403 FORBIDDEN` (expired/invalid token), `404 NOT_FOUND`.

#### `PUT /api/web/library/progress/{scope}/{file_id}`
Updates student reading position.
- **Access**: Authenticated
- **Request Body**:
  ```json
  { "page": 18, "total": 42, "position": 0.428 }
  ```
- **Response (200 OK)**: `{"ok": true}`.

---

### 2.3 Digital Ink & Vector Annotations (`/api/web/ink`)

#### Schema & Coordinate Normalization Constraints:
- Coordinates `x, y`: Relative float bounds `0.0 <= x <= 1.0`, `0.0 <= y <= 1.0` and `math.isfinite(val)`.
- Pressure `pressure`: Float bound `0.0 <= pressure <= 1.0`.
- Stroke width: Client base width in points (`1.0 <= pt <= 24.0`), mapped server-side to relative stroke ratio `0.001 <= width <= 0.05` for vector rasterization.
- Max Payload Limits: Max 400 strokes/page, max 500 points/stroke, max 5 MB per sync payload.

#### `GET /api/web/ink/{scope}/{file_id}/{page}`
Fetches vector strokes for a specific page.
- **Access**: Authenticated
- **Response (200 OK)**:
  ```json
  {
    "file_id": "file_8923a7",
    "page": 18,
    "page_revision": 4,
    "strokes": [
      {
        "stroke_id": "strk_9a12bc",
        "tool": "pen",
        "color": "#1740B8",
        "width": 0.0035,
        "opacity": 1.0,
        "blend_mode": "source-over",
        "points": [
          { "x": 0.124, "y": 0.345, "pressure": 0.65, "time": 0 },
          { "x": 0.128, "y": 0.349, "pressure": 0.72, "time": 16 }
        ],
        "created_at": "2026-11-05T16:10:00Z"
      }
    ]
  }
  ```

#### `POST /api/web/ink/sync`
Synchronizes batched client ink mutations.
- **Access**: Authenticated
- **Request Body**:
  ```json
  {
    "client_id": "client_ipad_uuid",
    "mutations": [
      {
        "mutation_id": "mut_123",
        "scope": "res",
        "file_id": "file_8923a7",
        "page": 18,
        "action": "upsert_stroke",
        "stroke": {
          "stroke_id": "strk_9a12bc",
          "tool": "pen",
          "color": "#1740B8",
          "width": 0.0035,
          "opacity": 1.0,
          "points": [
            { "x": 0.124, "y": 0.345, "pressure": 0.65, "time": 0 }
          ]
        },
        "timestamp": 1730823450000
      }
    ]
  }
  ```
- **Response (200 OK)**:
  ```json
  {
    "processed": 1,
    "successful_ids": ["mut_123"],
    "conflicts": [],
    "server_timestamp": "2026-11-05T16:11:00Z"
  }
  ```

#### `DELETE /api/web/ink/{scope}/{file_id}/{page}`
Clears all vector strokes for a given page.
- **Access**: Authenticated
- **Response (200 OK)**:
  ```json
  { "cleared": true, "page": 18, "cleared_count": 14 }
  ```

#### `GET /api/web/ink/summary/{scope}/{file_id}`
Returns annotation summary for a document.
- **Access**: Authenticated
- **Response (200 OK)**:
  ```json
  {
    "file_id": "file_8923a7",
    "annotated_pages_count": 12,
    "annotated_pages": [1, 3, 4, 18, 22, 25],
    "total_strokes": 148,
    "last_annotated_at": "2026-11-05T16:10:00Z"
  }
  ```

#### `GET /api/web/ink/notes`
Lists all documents containing user annotations (Student Notebooks directory).
- **Access**: Authenticated
- **Response (200 OK)**:
  ```json
  {
    "notebooks": [
      {
        "file_id": "file_8923a7",
        "scope": "res",
        "title": "جزوه فیزیولوژی اعصاب - جلسه ۳",
        "annotated_pages_count": 12,
        "last_updated": "2026-11-05T16:10:00Z"
      }
    ]
  }
  ```

---

### 2.4 Question Bank & Exams (`/api/questions`, `/api/web/exam`)

#### `POST /api/web/exam/setup`
Configures and launches a practice exam session.
- **Access**: Subscription Required (`require_feature_access('question_bank')`)
- **Request Body**:
  ```json
  {
    "lesson_ids": ["les_anat_01"],
    "topics": ["عروق و اعصاب"],
    "question_count": 25,
    "timed": true,
    "duration_minutes": 30
  }
  ```
- **Response (200 OK)**:
  ```json
  {
    "session_id": "exam_sess_7812bc",
    "total_questions": 25,
    "duration_seconds": 1800,
    "expires_at": "2026-11-05T16:45:00Z"
  }
  ```

#### `GET /api/web/exam/{session_id}`
Fetches questions for an active exam session without revealing correct answer keys.
- **Access**: Authenticated
- **Response (200 OK)**:
  ```json
  {
    "session_id": "exam_sess_7812bc",
    "duration_seconds": 1800,
    "seconds_remaining": 1420,
    "questions": [
      {
        "question_id": "qid_4591",
        "order": 1,
        "text": "کدام شاخه از شریان آگزیلاری به همراه عصب رادیال در ناودان رادیال استخوان بازو طی مسیر می‌کند؟",
        "options": [
          "شریان برکیال عمقی (Profunda Brachii)",
          "شریان سیرکومفلکس هومرال قدامی",
          "شریان سیرکومفلکس هومرال خلفی",
          "شریان توراکوآکرومیال"
        ],
        "image_url": null,
        "selected_choice": null,
        "flagged": false
      }
    ]
  }
  ```

#### `POST /api/web/exam/answer`
Submits an answer choice during an exam.
- **Access**: Authenticated
- **Request Body**:
  ```json
  {
    "session_id": "exam_sess_7812bc",
    "question_id": "qid_4591",
    "selected_choice": 1
  }
  ```
- **Response (200 OK)**: `{"ok": true, "recorded": true}`.

#### `POST /api/web/exam/{session_id}/finish`
Concludes the exam session, calculates scores, and produces review breakdown.
- **Access**: Authenticated
- **Response (200 OK)**:
  ```json
  {
    "session_id": "exam_sess_7812bc",
    "total_questions": 25,
    "correct_count": 20,
    "incorrect_count": 3,
    "unanswered_count": 2,
    "score_percentage": 80.0,
    "time_spent_seconds": 1340,
    "review": [
      {
        "question_id": "qid_4591",
        "selected_choice": 1,
        "correct_choice": 1,
        "is_correct": true,
        "explanation": "شریان برکیال عمقی به همراه عصب رادیال وارد ناودان اسپیرال بازو می‌شود.",
        "source": "آناتومی گری ویرایش ۴۲، صفحه ۸۱۲"
      }
    ]
  }
  ```

#### `GET /api/web/exam/{session_id}/pdf`
Downloads Persian RTL PDF exam booklet and answer key generated via ReportLab with Vazirmatn font.
- **Access**: Authenticated
- **Response Headers**:
  - `Content-Type`: `application/pdf`
  - `Content-Disposition`: `attachment; filename="humsyar_exam_sess_7812bc.pdf"`

---

### 2.5 HooshYar AI Medical Assistant (`/api/ai`)

#### `GET /api/ai/threads`
Lists active student AI conversation threads.
- **Access**: Authenticated
- **Response (200 OK)**:
  ```json
  {
    "threads": [
      {
        "thread_id": "th_8912",
        "title": "فارماکولوژی بتا بلوکرها",
        "message_count": 8,
        "created_at": "2026-11-04T12:00:00Z",
        "updated_at": "2026-11-05T15:30:00Z"
      }
    ]
  }
  ```

#### `POST /api/ai/threads`
Creates a new conversation thread.
- **Access**: Authenticated
- **Request Body**:
  ```json
  { "title": "مکانیسم‌های فیزیولوژی تنفس" }
  ```
- **Response (201 Created)**:
  ```json
  { "thread_id": "th_9102", "title": "مکانیسم‌های فیزیولوژی تنفس", "created_at": "2026-11-05T16:20:00Z" }
  ```

#### `DELETE /api/ai/threads/{thread_id}`
Deletes a conversation thread and message history.
- **Access**: Authenticated
- **Response (200 OK)**: `{"deleted": true}`.

#### `POST /api/ai/ask`
Streams real-time AI tutor explanations via Server-Sent Events (SSE).
- **Access**: Subscription & Quota Required (`require_feature_access('ai_chat')`)
- **Headers**: `Accept: text/event-stream`
- **Request Body**:
  ```json
  {
    "thread_id": "th_8912",
    "message": "مکانیسم اثر داروی پروپرانولول در آریتمی قلبی چیست؟",
    "mode": "tutor"
  }
  ```
- **Stream Events**:
  ```text
  event: token
  data: {"text": "داروی"}

  event: token
  data: {"text": " پروپرانولول"}

  event: done
  data: {"tokens_used": 142}
  ```

#### `POST /api/ai/vision`
Multi-modal medical image analysis and diagram explanation.
- **Access**: Subscription & Quota Required
- **Form Data**:
  - `file`: Image binary (JPEG, PNG, WebP <= 10MB)
  - `prompt`: Question or clinical context
- **Response (200 OK)**:
  ```json
  {
    "analysis": "تصویر ارائه‌شده یک گرافی ساده قفسه سینه (CXR) را نشان می‌دهد...",
    "detected_structures": ["Cardiomegaly", "Costophrenic angle blunting"],
    "confidence_level": "educational_reference_only"
  }
  ```

---

### 2.6 Schedule & Jalali Tasks (`/api/web/schedule`)

#### `GET /api/web/schedule/items`
Lists study schedule tasks filtered by Jalali calendar range.
- **Access**: Authenticated
- **Query Params**: `?from_jalali=1405-08-01&to_jalali=1405-08-30`
- **Response (200 OK)**:
  ```json
  {
    "tasks": [
      {
        "task_id": "tsk_019",
        "title": "مرور مبحث عروق اندام فوقانی",
        "jalali_date": "1405-08-15",
        "completed": false,
        "completed_at": null,
        "reminder_time": "18:00"
      }
    ]
  }
  ```

#### `POST /api/web/schedule/items`
Creates a study schedule task.
- **Access**: Authenticated
- **Request Body**:
  ```json
  {
    "title": "حل تست‌های فارماکولوژی فصل ۳",
    "jalali_date": "1405-08-16",
    "reminder_time": "20:00"
  }
  ```
- **Response (201 Created)**: `{"task_id": "tsk_020", "created": true}`.

#### `PATCH /api/web/schedule/items/{task_id}/toggle`
Toggles task completion status.
- **Access**: Authenticated
- **Response (200 OK)**:
  ```json
  { "task_id": "tsk_019", "completed": true, "completed_at": "2026-11-05T16:30:00Z" }
  ```

---

### 2.7 Academic Grades & GPA (`/api/web/grades`)

#### `GET /api/web/grades/summary`
Returns student course grades and cumulative GPA transcript.
- **Access**: Authenticated
- **Response (200 OK)**:
  ```json
  {
    "cumulative_gpa": 17.85,
    "total_credits": 48,
    "semesters": [
      {
        "term": 1,
        "term_gpa": 18.10,
        "credits": 20,
        "courses": [
          { "course_id": "anat_01", "name": "آناتومی نظری", "credits": 3, "score": 18.5 }
        ]
      }
    ]
  }
  ```

---

### 2.8 Subscription, Payments & Student Wallet (`/api/web/subscription`, `/api/web/wallet`)

#### `GET /api/web/subscription/status`
Returns user subscription state, active features, and expiration date.
- **Access**: Authenticated
- **Response (200 OK)**:
  ```json
  {
    "is_active": true,
    "plan_id": "plan_gold_6m",
    "plan_name": "طرح طلایی ۶ ماهه",
    "expires_at": "2027-05-05T00:00:00Z",
    "days_remaining": 181,
    "features": ["resources", "question_bank", "ai_chat", "digital_ink"]
  }
  ```

#### `GET /api/web/subscription/plans`
Lists available subscription plans and pricing.
- **Access**: Authenticated
- **Response (200 OK)**:
  ```json
  {
    "plans": [
      {
        "plan_id": "plan_gold_6m",
        "title": "طرح طلایی ۶ ماهه",
        "price_irr": 18000000,
        "duration_days": 180,
        "features": ["resources", "question_bank", "ai_chat"]
      }
    ]
  }
  ```

#### `POST /api/web/subscription/checkout/zarinpal`
Initiates subscription checkout via ZarinPal payment gateway.
- **Access**: Authenticated
- **Request Body**:
  ```json
  {
    "plan_id": "plan_gold_6m",
    "discount_code": "STUDENT20"
  }
  ```
- **Response (200 OK)**:
  ```json
  {
    "authority": "A0000000000000000000000000001928374",
    "payment_url": "https://www.zarinpal.com/pg/StartPay/A0000000000000000000000000001928374",
    "amount_irr": 14400000
  }
  ```

#### `POST /api/web/subscription/verify`
Verifies payment callback from gateway.
- **Access**: Authenticated
- **Request Body**:
  ```json
  { "authority": "A0000000000000000000000000001928374", "status": "OK" }
  ```
- **Response (200 OK)**:
  ```json
  {
    "verified": true,
    "ref_id": "19283746",
    "subscription_active": true,
    "expires_at": "2027-05-05T00:00:00Z"
  }
  ```

#### `GET /api/web/wallet/balance`
Retrieves student wallet balance and transaction ledger.
- **Access**: Authenticated
- **Response (200 OK)**:
  ```json
  {
    "balance_irr": 5000000,
    "transactions": [
      {
        "tx_id": "tx_812",
        "type": "credit",
        "amount_irr": 5000000,
        "description": "شارژ کیف پول",
        "created_at": "2026-11-01T10:00:00Z"
      }
    ]
  }
  ```

---

### 2.9 Support Tickets & Notifications (`/api/web/tickets`, `/api/web/notifications`)

#### `GET /api/web/tickets`
Lists user support tickets.
- **Access**: Authenticated
- **Response (200 OK)**:
  ```json
  {
    "tickets": [
      {
        "ticket_id": "tck_912",
        "subject": "اشکال در نمایش اسلاید صفحه ۱۲",
        "category": "technical",
        "status": "answered",
        "created_at": "2026-11-03T11:00:00Z",
        "unread_replies": true
      }
    ]
  }
  ```

#### `POST /api/web/tickets`
Submits a new support ticket.
- **Access**: Authenticated
- **Request Body**:
  ```json
  {
    "subject": "درخواست راهنمایی در مورد آزمون آزمایشی",
    "category": "academic",
    "message": "آیا سوالات آزمون جامع شامل دوره‌های اخیر نیز می‌شود؟"
  }
  ```
- **Response (201 Created)**: `{"ticket_id": "tck_913", "created": true}`.

#### `GET /api/web/tickets/{ticket_id}`
Retrieves ticket messages and conversation thread.
- **Access**: Authenticated
- **Response (200 OK)**:
  ```json
  {
    "ticket_id": "tck_912",
    "subject": "اشکال در نمایش اسلاید صفحه ۱۲",
    "status": "answered",
    "messages": [
      { "sender": "user", "text": "اسلاید باز نمی‌شود", "timestamp": "2026-11-03T11:00:00Z" },
      { "sender": "support", "text": "فایل بازبینی و مجدداً کش گردید.", "timestamp": "2026-11-03T12:30:00Z" }
    ]
  }
  ```

#### `GET /api/web/notifications`
Fetches notification inbox and unread count.
- **Access**: Authenticated
- **Response (200 OK)**:
  ```json
  {
    "unread_count": 2,
    "notifications": [
      {
        "id": "notif_104",
        "title": "آزمون آزمایشی جدید فعال شد",
        "message": "آزمون شبیه‌ساز فیزیولوژی با ۵۰ سوال در بخش بانک سوالات قرار گرفت.",
        "created_at": "2026-11-05T08:00:00Z",
        "is_read": false
      }
    ]
  }
  ```

---

### 2.10 Student Profile & Global Search (`/api/web/profile`, `/api/web/search`)

#### `GET /api/web/profile`
Fetches current student profile details.
- **Access**: Authenticated
- **Response (200 OK)**:
  ```json
  {
    "user_id": 123456789,
    "name": "Ali Rezaei",
    "student_id": "401123456",
    "intake": "مهر ۱۴۰۱",
    "group": "پزشکی عمومی",
    "web_login_code": "7K9M-2P4X",
    "prestige_points": 1420,
    "rank_league": "دانشجوی ممتاز"
  }
  ```

#### `GET /api/web/search`
Cross-domain search across lessons, reference textbooks, questions, and student notes.
- **Access**: Authenticated
- **Query Params**: `?q=فیزیولوژی+اعصاب`
- **Response (200 OK)**:
  ```json
  {
    "query": "فیزیولوژی اعصاب",
    "results": {
      "lessons": [
        { "lesson_id": "les_phys_02", "title": "فیزیولوژی اعصاب و سیناپس", "term": 2 }
      ],
      "references": [
        { "book_id": "bk_guyton_14", "title": "فیزیولوژی پزشکی گایتون", "edition": "ویرایش ۱۴" }
      ],
      "questions_count": 84,
      "annotated_notes_count": 6
    }
  }
  ```

---

## 3. Global Error Codes Dictionary

| HTTP Status | Error Code String | Persian User Hint | Description |
|---|---|---|---|
| **401** | `LOGIN_REQUIRED` | لطفاً ابتدا وارد حساب کاربری خود شوید. | Missing or invalid session cookie / token. |
| **401** | `SESSION_EXPIRED` | نشست شما منقضی شده است. | Session has expired or been revoked. |
| **401** | `INVALID_FALLBACK_CODE` | کد تایید یکبارمصرف نامعتبر یا منقضی است. | Invalid fallback OTP code. |
| **402** | `SUB_REQUIRED` | برای دسترسی به این بخش اشتراک فعال لازم است. | Feature requires an active subscription. |
| **402** | `SUB_EXPIRED` | اعتبار اشتراک شما به پایان رسیده است. | Subscription expired; upgrade needed. |
| **402** | `FEATURE_DISABLED` | این بخش موقتاً غیرفعال است. | Feature disabled via admin killswitch. |
| **402** | `PLAN_EXCLUDES_FEATURE` | پلن فعلی شما شامل این قابلیت نمی‌باشد. | Current subscription excludes this feature. |
| **403** | `SIGNATURE_EXPIRED` | لینک موقت مطالعه منقضی شده است. | HMAC preview token expired (> 10 min). |
| **403** | `ACCOUNT_SUSPENDED` | حساب کاربری شما مسدود شده است. | Account suspended by administrator. |
| **403** | `CHALLENGE_ALREADY_CONSUMED` | این درخواست ورود قبلاً استفاده شده است. | Login challenge replay rejected. |
| **403** | `PROTECTED_RESOURCE_DIRECT_DOWNLOAD_PROHIBITED` | دانلود مستقیم این فایل امکان‌پذیر نمی‌باشد. | Direct download prohibited for DRM content. |
| **404** | `DOCUMENT_NOT_FOUND` | منبع یا فایل مورد نظر یافت نشد. | Requested file or resource does not exist. |
| **416** | `RANGE_TOO_BROAD` | درخواست بازه فایل نامعتبر است. | Malformed Starlette range (>16 ranges). |
| **422** | `STROKE_LIMIT_EXCEEDED` | حجم یا تعداد رسم استروک‌ها بیش از حد مجاز است. | Vector stroke payload exceeds bounds (>5MB). |
| **429** | `RATE_LIMIT_EXCEEDED` | تعداد درخواست‌ها بیش از حد مجاز است. | Exceeded sliding window request threshold. |
| **429** | `QUOTA_EXHAUSTED` | سهمیه مصرف روزانه شما به اتمام رسیده است. | Daily usage quota exhausted. |
