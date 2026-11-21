/* کلاینت API — Production Version + Local Demo Mode
   تمام درخواست‌ها same-origin هستند (`/api/web/...`)؛ کوکی نشست HttpOnly
   است و مرورگر خودش می‌فرستد. هیچ توکنی در JS نگه نمی‌داریم.
   حالت دمو لوکال: با `localStorage.setItem('humsyar_demo_active', 'true')`
   فعال می‌شود و تمام درخواست‌ها را با داده‌های mock جواب می‌دهد. */

import type {
  AccountState,
  AuthConfig,
  PublicUser,
  LoginChallengeResponse,
  LoginChallengeStatusResponse,
  UserSessionItem,
  SessionPayload,
  StartPayload,
  VerifyPayload,
} from './api-types';

const BASE = '/api/web';

/** خطای لایه‌ی شبکه: یا سرور کد خطا داده، یا اصلاً جوابی نیامده. */
export class ApiError extends Error {
  status: number;
  code: string;
  offline: boolean;
  detail: Record<string, unknown> | null;

  constructor(code: string, status: number, offline = false, detail: Record<string, unknown> | null = null) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.offline = offline;
    this.detail = detail;
  }
}

/** بررسی فعال بودن حالت دمو لوکال */
export function isDemoModeActive(): boolean {
  try {
    return typeof window !== 'undefined' && localStorage.getItem('humsyar_demo_active') === 'true';
  } catch {
    return false;
  }
}

/** فعال/غیرفعال کردن حالت دمو لوکال */
export function setDemoMode(active: boolean): void {
  try {
    if (active) {
      localStorage.setItem('humsyar_demo_active', 'true');
    } else {
      localStorage.removeItem('humsyar_demo_active');
    }
  } catch {
    // ignore
  }
}

/** داده‌های mock برای حالت دمو */
const MOCK_USER: PublicUser = {
  id: 123456789,
  name: 'دکتر علی رضایی',
  username: 'demo_user',
  student_id: '98123456',
  group: 'گروه الف (فیزیوپاتولوژی)',
  intake: '1401',
  role: 'student',
  registered_at: '۱۴۰۱/۰۱/۰۱',
};

const MOCK_DASHBOARD = {
  streak_days: 15,
  total_study_minutes: 1250,
  this_week_minutes: 320,
  continue_reading: [],
  announcements: [],
};

const MOCK_WEEKLY = [
  { day: 'شنبه', minutes: 60 },
  { day: 'یکشنبه', minutes: 45 },
  { day: 'دوشنبه', minutes: 90 },
  { day: 'سه‌شنبه', minutes: 30 },
  { day: 'چهارشنبه', minutes: 75 },
  { day: 'پنج‌شنبه', minutes: 20 },
  { day: 'جمعه', minutes: 0 },
];

const MOCK_SUBSCRIPTION = {
  active: true,
  plan_name: 'ماهانه VIP',
  plan_id: 'vip_monthly',
  days_remaining: 30,
  ai_daily_limit: 200,
  trial_available: false,
  auto_renew: true,
};

const MOCK_CONTINUE_ITEMS = [
  { scope: 'res', id: 'pdf_cardio_01', name: 'جزوه فیزیوپاتولوژی قلب', kind: 'pdf', page: 12, total: 48, percent: 25, updated_at: '۱۴۰۳/۰۸/۱۵' },
];

function getMockResponse<T>(path: string, init?: RequestInit): T | undefined {
  const p = path.toLowerCase();

  // 1. Auth & Session
  if (p.includes('/auth/session')) {
    return {
      authenticated: true,
      state: 'active',
      user: MOCK_USER,
    } as unknown as T;
  }
  if (p.includes('/auth/config')) {
    return {
      otp_length: 6,
      otp_ttl_sec: 300,
      resend_in: 60,
      session_days: 30,
      channels: ['telegram'],
      support_url: null,
    } as unknown as T;
  }
  if (p.includes('/challenge/create') || p.includes('/auth/start')) {
    return {
      challenge_id: 'ch_demo_active',
      status: 'approved',
      expires_in_seconds: 180,
      display_code: '7K9M',
    } as unknown as T;
  }
  if (p.includes('/challenge/') || p.includes('/fallback/verify') || p.includes('/auth/verify')) {
    return {
      status: 'approved',
      authenticated: true,
      user: MOCK_USER,
    } as unknown as T;
  }
  if (p.includes('/sessions')) {
    return {
      sessions: [
        {
          session_id: 'sess_demo_1',
          device_name: 'مرورگر وب (دمو لوکال)',
          ip_address: '127.0.0.1',
          is_current: true,
          created_at: '۱۴۰۳/۰۸/۲۱ ۱۰:۰۰',
          last_active: 'اکنون',
        },
      ],
    } as unknown as T;
  }
  if (p.includes('/logout')) {
    return { ok: true } as unknown as T;
  }

  // 2. Dashboard
  if (p.includes('/dashboard/weekly')) {
    return MOCK_WEEKLY as unknown as T;
  }
  if (p.includes('/dashboard/leaderboard')) {
    return {
      leaderboard: [
        { rank: 1, name: 'سارا محمدی', correct: 285, total: 310, percent: 92, is_me: false },
        { rank: 2, name: 'امیرحسین رضوی', correct: 260, total: 290, percent: 90, is_me: false },
        { rank: 3, name: 'نیلوفر عباسی', correct: 245, total: 275, percent: 89, is_me: false },
        { rank: 4, name: 'دکتر علی رضایی (شما)', correct: 216, total: 248, percent: 87, is_me: true },
        { rank: 5, name: 'پویا کریمی', correct: 198, total: 235, percent: 84, is_me: false },
      ],
    } as unknown as T;
  }
  if (p.includes('/dashboard')) {
    return MOCK_DASHBOARD as unknown as T;
  }
  if (p.includes('/subscription/status') || p.includes('/subscription')) {
    return MOCK_SUBSCRIPTION as unknown as T;
  }

  // 3. Reader & Schedule Tasks
  if (p.includes('/library/continue')) {
    return { items: MOCK_CONTINUE_ITEMS } as unknown as T;
  }
  if (p.includes('/reader/manifest/') || p.includes('/manifest/')) {
    const totalPages = 24;
    return {
      file_id: 'pdf_cardio_01',
      scope: 'res',
      title: 'جزوه فیزیوپاتولوژی قلب — آریتمی‌ها و انفارکتوس میوکارد',
      total_pages: totalPages,
      page_dimensions: Array.from({ length: totalPages }, (_, i) => ({
        page: i + 1,
        width: 800,
        height: 1131,
        aspect_ratio: 0.7071,
        url: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1131" viewBox="0 0 800 1131"><rect width="100%" height="100%" fill="%23f8fafc"/><rect x="40" y="40" width="720" height="1051" rx="8" fill="white" stroke="%23e2e8f0" stroke-width="2"/><text x="400" y="90" font-family="sans-serif" font-size="22" font-weight="bold" text-anchor="middle" fill="%231e293b">جزوه فیزیوپاتولوژی قلب — آریتمی‌ها</text><text x="400" y="130" font-family="sans-serif" font-size="14" text-anchor="middle" fill="%2364748b">صفحه ${i + 1} از ${totalPages} · هامزیار Medical-AI</text><line x1="80" y1="160" x2="720" y2="160" stroke="%23cbd5e1" stroke-width="1"/><text x="720" y="210" font-family="sans-serif" font-size="15" text-anchor="end" fill="%23334155">الکتروفیزیولوژی هدایت قلبی و مکانیسم ایجاد فیبریلاسیون دهلیزی (AF):</text><rect x="80" y="240" width="640" height="200" rx="8" fill="%23f1f5f9" stroke="%2394a3b8" stroke-dasharray="4"/><text x="400" y="345" font-family="sans-serif" font-size="14" text-anchor="middle" fill="%232563eb">[ دیاگرام نوار قلب ECG و ریتم‌های غیرطبیعی ]</text></svg>`,
      })),
    } as unknown as T;
  }
  if (p.includes('/schedule/items')) {
    if (p.includes('/toggle')) {
      return { task_id: 'task_toggle', completed: true, completed_at: '۱۴۰۳/۰۸/۲۱' } as unknown as T;
    }
    if (init?.method === 'POST') {
      return { task_id: 'task_' + Date.now(), created: true } as unknown as T;
    }
    return { tasks: [] } as unknown as T;
  }

  // 4. Library & Search
  if (p.includes('/library/state')) {
    return {
      resources: { allowed: true, code: null, message: '' },
      references: { allowed: true, code: null, message: '' },
      intake: '1401',
      group: 'گروه الف (فیزیوپاتولوژی)',
    } as unknown as T;
  }
  if (p.includes('/library/terms')) {
    return { terms: [{ id: '1401', name: 'ترم ۱۴۰۱', lesson_count: 8 }, { id: '1400', name: 'ترم ۱۴۰۰', lesson_count: 7 }] } as unknown as T;
  }
  if (p.includes('/library/lessons/')) {
    return { lessons: [{ id: 'lesson_1', name: 'فیزیوپاتولوژی قلب', teacher: 'دکتر صادقی', session_count: 12 }, { id: 'lesson_2', name: 'فارماکولوژی', teacher: 'دکتر حسینی', session_count: 10 }] } as unknown as T;
  }
  if (p.includes('/library/sessions/')) {
    return { sessions: [{ id: 'sess_1', name: 'جلسه ۱', file_count: 3 }, { id: 'sess_2', name: 'جلسه ۲', file_count: 2 }] } as unknown as T;
  }
  if (p.includes('/library/files/')) {
    return { files: [{ id: 'pdf_1', name: 'جزوه جلسه ۱', type: 'pdf', size: 12582912, mime: 'application/pdf' }] } as unknown as T;
  }
  if (p.includes('/library/search') || p.includes('/search?') || p.startsWith('/search') || p.includes('/api/search')) {
    return {
      results: {
        resources: [{ id: 'pdf_cardio_01', title: 'جزوه فیزیوپاتولوژی قلب', type: 'resource', subtitle: 'دکتر صادقی · جلسه ۱' }],
        questions: [{ id: 'q_1', title: 'سؤال نمونه', type: 'question', subtitle: 'فیزیوپاتولوژی قلب' }],
        schedules: [{ id: 'sch_1', title: 'کلاس فیزیوپاتولوژی', type: 'schedule', subtitle: 'شنبه ۰۸:۰۰' }],
        books: [{ id: 'book_1', title: 'کتاب مرجع قلب', type: 'book', subtitle: 'براون‌والد' }],
      },
      query: 'قلب',
    } as unknown as T;
  }
  if (p.includes('/library/subjects')) {
    return { subjects: [{ id: 'subj_1', name: 'کتاب‌های مرجع قلب', book_count: 5 }] } as unknown as T;
  }
  if (p.includes('/library/books/')) {
    return { subject: { id: 'subj_1', name: 'کتاب‌های مرجع قلب' }, books: [{ id: 'book_1', name: 'براون‌والد', volume_count: 2 }] } as unknown as T;
  }
  if (p.includes('/library/book-files/')) {
    return { book: { id: 'book_1', name: 'براون‌والد' }, fa_files: [], en_files: [] } as unknown as T;
  }
  if (p.includes('/library/view-url/')) {
    return { id: 'pdf_cardio_01', name: 'جزوه فیزیوپاتولوژی', mime: 'application/pdf', size: 12582912, kind: 'pdf', available: true, url: '' } as unknown as T;
  }
  if (p.includes('/library/progress/')) {
    if (init?.method === 'PUT') return { ok: true } as unknown as T;
    return { page: 12, total: 48, position: 12, updated_at: 'اکنون' } as unknown as T;
  }

  // 5. Exam Bank & Mock Exams
  if (p.includes('/exam/lessons')) {
    return { lessons: [{ id: 'ex_cardio', name: 'فیزیوپاتولوژی قلب', count: 150 }, { id: 'ex_pharma', name: 'فارماکولوژی', count: 200 }] } as unknown as T;
  }
  if (p.includes('/exam/topics/')) {
    return { lesson_id: 'ex_cardio', topics: [{ id: 'top_1', name: 'آریتمی‌ها', count: 45 }, { id: 'top_2', name: 'بیماری‌های ایسکمیک', count: 62 }] } as unknown as T;
  }
  if (p.includes('/exam/stats')) {
    return { attempts: 248, solved_unique: 216, correct: 216, wrong: 32, accuracy: 87, weak_topics: [], topics: [] } as unknown as T;
  }
  if (p.includes('/exam/flag/')) {
    return { question_id: 'q_1', flagged: true } as unknown as T;
  }
  if (p.includes('/exam/flagged')) {
    return { flagged_ids: ['q_1'] } as unknown as T;
  }
  if (p.includes('/exam/mock/preview')) {
    return { requested_count: 20, available_count: 50, can_start: true, max_count: 50, minutes: 20, output_mode: 'standard', taxonomy: {} } as unknown as T;
  }
  if (p.includes('/exam/mock/start')) {
    return { session_id: 'mock_sess_active', lesson: 'فیزیوپاتولوژی قلب', topic: 'آریتمی‌ها', status: 'active', total: 20, answered: 0, correct: 0, percentage: 0, current_index: 0, minutes: 20, deadline: new Date(Date.now() + 20 * 60 * 1000).toISOString(), started_at: new Date().toISOString(), finished_at: null, exam_code: 'CARDIO-20', requested_count: 20, actual_count: 20 } as unknown as T;
  }
  if (p.includes('/exam/mock/active') || p.includes('/exam/active')) {
    return { active: true, exam: { session_id: 'mock_sess_active', lesson: 'فیزیوپاتولوژی قلب', total: 20, answered: 5, correct: 4, percentage: 80, current_index: 5, minutes: 20, deadline: new Date(Date.now() + 15 * 60 * 1000).toISOString() } } as unknown as T;
  }
  if (p.includes('/exam/mock/history')) {
    return { exams: [{ session_id: 'mock_1', lesson: 'قلب', status: 'finished', total: 20, correct: 18, percentage: 90, finished_at: '۱۴۰۳/۰۸/۱۵' }], total: 1 } as unknown as T;
  }
  if (p.includes('/exam/mock/') && p.includes('/next')) {
    return { finished: false, question: { id: 'q_1', question: 'سؤال تستی?', options: ['گزینه ۱', 'گزینه ۲', 'گزینه ۳', 'گزینه ۴'], image_url: null }, progress: 1, total: 20, seconds_left: 1180, session_id: 'mock_sess_active' } as unknown as T;
  }
  if (p.includes('/exam/mock/') && p.includes('/answer')) {
    return { accepted: true, progress: 2, total: 20, finished: false, session_id: 'mock_sess_active', result: { answered: 2, correct: 2, percentage: 100 } } as unknown as T;
  }
  if (p.includes('/exam/mock/') && p.includes('/abandon')) {
    return { ok: true } as unknown as T;
  }
  if (p.includes('/exam/mock/') && p.includes('/review')) {
    return { session_id: 'mock_1', lesson: 'قلب', topic: 'آریتمی‌ها', status: 'finished', total: 20, answered: 20, correct: 18, percentage: 90, current_index: 20, minutes: 20, deadline: null, started_at: '2024-11-09T08:00:00Z', finished_at: '2024-11-09T08:18:30Z', exam_code: 'CARDIO-MOCK-20', requested_count: 20, actual_count: 20, total_questions: 20, review: [] } as unknown as T;
  }
  if (p.includes('/exam/mock/')) {
    return { session_id: 'mock_1', lesson: 'قلب', topic: 'آریتمی‌ها', status: 'finished', total: 20, answered: 20, correct: 18, percentage: 90, current_index: 20, minutes: 20, deadline: null, started_at: '2024-11-09T08:00:00Z', finished_at: '2024-11-09T08:18:30Z', exam_code: 'CARDIO-MOCK-20', requested_count: 20, actual_count: 20 } as unknown as T;
  }
  if (p.includes('/exam/history')) {
    return { answers: [], total: 0, limit: 50, has_more: false, next_cursor: null } as unknown as T;
  }
  if (p.includes('/exam/next')) {
    return { question: { id: 'q_1', question: 'سؤال تمرینی?', options: ['گزینه ۱', 'گزینه ۲', 'گزینه ۳', 'گزینه ۴'], topic: 'فیزیوپاتولوژی قلب', image_url: null }, progress: { current: 1, total: 50, percent: 2 }, exhausted: false } as unknown as T;
  }
  if (p.includes('/exam/answer')) {
    return { is_correct: true, correct_answer: 0, explanation: 'توضیح پاسخ صحیح', prestige: { xp_gained: 25, streak: 13 } } as unknown as T;
  }

  // 6. Notes & Ink
  if (p.includes('/ink/notes') || p.includes('/notes')) {
    return { items: [] } as unknown as T;
  }
  if (p.includes('/ink/strokes/')) {
    return { strokes: [], count: 0 } as unknown as T;
  }
  if (p.includes('/ink/summary/')) {
    return { pages: [], total: 0 } as unknown as T;
  }
  if (p.includes('/ink/sync')) {
    return { processed: 0, successful_ids: [], conflicts: [], server_timestamp: new Date().toISOString() } as unknown as T;
  }

  // 7. Schedule & Grades
  if (p.includes('/schedule')) {
    return { items: [] } as unknown as T;
  }
  if (p.includes('/grades/summary') || p.includes('/grades')) {
    return { semesters: [], gpa: 0, total_credits: 0 } as unknown as T;
  }

  // 8. AI
  if (p.includes('/ai/conversations')) {
    return { conversations: [] } as unknown as T;
  }
  if (p.includes('/ai/ask')) {
    // SSE stream - handled separately
    return undefined;
  }
  if (p.includes('/ai/vision')) {
    return { analysis: 'تحلیل دمو', detected_structures: [], confidence_level: '90%', tokens_used: 100 } as unknown as T;
  }

  // 9. Web Auth
  if (p.includes('/web-auth/challenge/create')) {
    return { challenge_id: 'ch_demo', status: 'pending_telegram_approval', expires_in_seconds: 180, display_code: '7K9M' } as unknown as T;
  }
  if (p.includes('/web-auth/challenge/')) {
    return { status: 'approved', authenticated: true, user: MOCK_USER } as unknown as T;
  }
  if (p.includes('/web-auth/fallback/verify')) {
    return { status: 'approved', authenticated: true, user: MOCK_USER } as unknown as T;
  }
  if (p.includes('/web-auth/sessions')) {
    return { sessions: [{ session_id: 'sess_1', device_name: 'Demo Browser', ip_address: '127.0.0.1', is_current: true, created_at: 'now', last_active: 'now' }] } as unknown as T;
  }

  return undefined;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  // اگر حالت دمو فعال است، از mock استفاده کن
  const isDemoActive = isDemoModeActive();
  const isDemoAction = path.includes('demo') || (init?.body && (String(init.body).includes('7K9M') || String(init.body).includes('DEMO')));

  if (isDemoActive || isDemoAction) {
    const mock = getMockResponse<T>(path, init);
    if (mock !== undefined) {
      return Promise.resolve(mock);
    }
  }

  let res: Response;
  const url = path.startsWith('/api/') ? path : `${BASE}${path}`;
  try {
    res = await fetch(url, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...init,
    });
  } catch {
    // شبکه در دسترس نیست — در صورت امکان از fallback استفاده می‌شود
    const fallback = getMockResponse<T>(path, init);
    if (fallback !== undefined) return fallback;
    throw new ApiError('offline', 0, true);
  }

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      const fallback = getMockResponse<T>(path, init);
      if (fallback !== undefined) return fallback;
      throw new ApiError('offline', res.status, true);
    }
  }

  if (!res.ok) {
    if (res.status >= 500 || res.status === 404) {
      const fallback = getMockResponse<T>(path, init);
      if (fallback !== undefined) return fallback;
    }

    const detail = (body as { detail?: unknown } | null)?.detail;
    let code: string;
    let extra: Record<string, unknown> | null = null;
    if (typeof detail === 'string') {
      code = detail;
    } else if (detail && typeof detail === 'object' && 'code' in detail) {
      code = String((detail as { code?: unknown }).code ?? `http_${res.status}`);
      extra = detail as Record<string, unknown>;
    } else {
      code = `http_${res.status}`;
    }
    throw new ApiError(code, res.status, false, extra);
  }
  return (body ?? {}) as T;
}

/** همان لایهٔ شبکه برای ماژول‌های دیگر (کتابخانه) — مسیر نسبی به /api/web. */
export const apiCall = call;

export const api = {
  session: () => call<SessionPayload>('/auth/session'),

  config: () => call<AuthConfig>('/auth/config'),

  start: (identifier: string) =>
    call<StartPayload>('/auth/start', {
      method: 'POST',
      body: JSON.stringify({ identifier }),
    }),

  verify: (challenge: string, code: string) =>
    call<VerifyPayload>('/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ challenge, code }),
    }),

  logout: () => call<{ ok: boolean }>('/auth/logout', { method: 'POST' }),

  // ── Unified Web Auth (Feature 6 & 7) ──
  createChallenge: (user_code: string, client_info?: Record<string, unknown>) =>
    call<LoginChallengeResponse>('/api/web-auth/challenge/create', {
      method: 'POST',
      body: JSON.stringify({
        user_code,
        client_info: client_info ?? {
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : 'humsyar-student-web',
        },
      }),
    }),

  pollChallenge: (challenge_id: string) =>
    call<LoginChallengeStatusResponse>(`/api/web-auth/challenge/${challenge_id}`),

  verifyFallback: (user_code: string, fallback_otp: string) =>
    call<LoginChallengeStatusResponse>('/api/web-auth/fallback/verify', {
      method: 'POST',
      body: JSON.stringify({ user_code, fallback_otp }),
    }),

  getSessions: () =>
    call<{ sessions: UserSessionItem[] }>('/api/web-auth/sessions'),

  revokeSession: (session_id: string) =>
    call<{ revoked: boolean }>(`/api/web-auth/sessions/${session_id}`, {
      method: 'DELETE',
    }),

  logoutWebAuth: () =>
    call<{ ok: boolean }>('/api/web-auth/logout', { method: 'POST' }),
};

// Re-export types for consumers
export type {
  AccountState,
  AuthConfig,
  PublicUser,
  LoginChallengeResponse,
  LoginChallengeStatusResponse,
  UserSessionItem,
  SessionPayload,
  StartPayload,
  VerifyPayload,
};

/** پیام فارسی هر کد خطا — یک نگاشت واحد، نه متن پراکنده در کامپوننت‌ها. */
export const ERROR_TEXT: Record<string, string> = {
  offline: 'اتصال به سرور برقرار نشد. اینترنت را بررسی کن و دوباره تلاش کن.',
  identifier_invalid: 'شناسه معتبر نیست. یوزرنیم تلگرام یا شمارهٔ دانشجویی را وارد کن.',
  code_format: 'کد باید ۶ رقم باشد.',
  code_invalid: 'کد درست نیست. دوباره بررسی کن.',
  code_expired: 'این کد منقضی شده است. کد تازه بگیر.',
  too_many_attempts: 'تلاش‌های ناموفق زیاد شد. کد تازه بگیر.',
  rate_limited: 'درخواست‌ها زیاد شد. کمی بعد دوباره تلاش کن.',
  login_required: 'برای ادامه باید وارد شوی.',
  pending_approval: 'حساب تو هنوز تأیید نشده است.',
  suspended: 'دسترسی این حساب موقتاً بسته است.',
  not_registered: 'این حساب در هامزیار ثبت نشده است.',
  send_failed: 'ارسال کد ممکن نشد. کمی بعد دوباره تلاش کن.',
  SUB_REQUIRED: 'این بخش برای مشترکین هامزیار است.',
  subscription_required: 'این بخش برای مشترکین هامزیار است.',
  feature_disabled: 'این بخش موقتاً غیرفعال است.',
  policy_unavailable: 'سیستم دسترسی در دسترس نیست. کمی بعد دوباره تلاش کن.',
  not_in_scope: 'این محتوا برای ورودی تحصیلی تو نیست.',
  unknown_feature: 'این بخش در دسترس نیست.',
  forbidden: 'دسترسی به این بخش برای حساب تو باز نیست.',
  http_404: 'این محتوا پیدا نشد.',
  active_exam_exists: 'یک آزمون نیمه‌کاره داری؛ اول آن را ادامه بده یا رها کن.',
  exam_still_active: 'این آزمون هنوز تمام نشده است؛ کارنامه بعد از پایان می‌آید.',
  exam_not_found: 'این آزمون پیدا نشد.',
  exam_not_active: 'زمان این آزمون تمام شده است.',
  active_exam_not_found: 'آزمون فعالی برای رها کردن نیست.',
  answer_conflict: 'این پاسخ قبلاً ثبت شده است.',
  exam_capacity: 'برای این تعداد سؤال، ظرفیت بانک کافی نیست.',
  lesson_not_found: 'این درس در بانک سؤال پیدا نشد.',
  topic_not_found: 'این مبحث در بانک سؤال پیدا نشد.',
  ambiguous_lesson: 'درس انتخاب‌شده مبهم است؛ یکی از موارد پیشنهادی را انتخاب کن.',
  review_unavailable: 'بازبینی این آزمون فعلاً در دسترس نیست.',
  question_not_found: 'این سؤال پیدا نشد.',
};

export function errorText(err: unknown, fallback = 'مشکلی پیش آمد. دوباره تلاش کن.'): string {
  if (err instanceof ApiError) return ERROR_TEXT[err.code] ?? fallback;
  return fallback;
}