/* API client.
   Every request is same-origin (`/api/web/...`); the session cookie is HttpOnly
   and the browser sends it itself. No token is kept in JS.

   Demo mode / mock data: DEV ONLY. All of it lives in ./demo and is loaded only
   through import('./demo') inside an `if (import.meta.env.DEV)` branch; in a
   production build that branch is constant-false and eliminated, so dist carries
   no fake data and no mock fallback (check:nodemo verifies). */

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

type DemoModule = typeof import('./demo');

/** DEV only: the mock module (cached). Never reached in production. */
let demoModule: Promise<DemoModule> | null = null;
async function devDemo(): Promise<DemoModule | null> {
  if (import.meta.env.DEV) {
    demoModule ??= import('./demo');
    return demoModule;
  }
  return null;
}

/** DEV only: mock response (when the server is down or demo mode is on). Always undefined in production. */
async function devMock<T>(path: string, init: RequestInit | undefined, requireDemo: boolean): Promise<T | undefined> {
  if (import.meta.env.DEV) {
    const demo = await devDemo();
    if (!demo) return undefined;
    if (requireDemo && !demo.isDemoRequest(path, init)) return undefined;
    return demo.getMockResponse<T>(path, init);
  }
  return undefined;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  if (import.meta.env.DEV) {
    const mock = await devMock<T>(path, init, true);
    if (mock !== undefined) return mock;
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
    // No network. In production: an honest error (offline), never fake data.
    if (import.meta.env.DEV) {
      const fallback = await devMock<T>(path, init, false);
      if (fallback !== undefined) return fallback;
    }
    throw new ApiError('offline', 0, true);
  }

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      if (import.meta.env.DEV) {
        const fallback = await devMock<T>(path, init, false);
        if (fallback !== undefined) return fallback;
      }
      throw new ApiError('offline', res.status, true);
    }
  }

  if (!res.ok) {
    if (import.meta.env.DEV && (res.status >= 500 || res.status === 404)) {
      const fallback = await devMock<T>(path, init, false);
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
    if (res.status === 401 && !isAuthProbePath(path)) emitSessionExpired(path);
    throw new ApiError(code, res.status, false, extra);
  }
  return (body ?? {}) as T;
}

/* ── T3: global 401 handling ─────────────────────────────────────────
   A 401 from any API call must not wipe the current screen or interrupt
   the reader/player. The network layer only reports it; SessionProvider
   shows a non-blocking banner with a re-login action. No hard redirect
   ever happens here. Auth routes (session check, login, challenge) are
   expected to return 401 and do not count as "session expired". */
type ExpiredListener = (path: string) => void;
const expiredListeners = new Set<ExpiredListener>();

/** Subscribe to "session expired" (401 outside auth routes). Returns an unsubscribe function. */
export function onSessionExpired(cb: ExpiredListener): () => void {
  expiredListeners.add(cb);
  return () => {
    expiredListeners.delete(cb);
  };
}

function emitSessionExpired(path: string): void {
  expiredListeners.forEach((cb) => {
    try {
      cb(path);
    } catch {
      /* one listener's error must not break the others */
    }
  });
}

function isAuthProbePath(path: string): boolean {
  const p = path.split('?')[0];
  return p.startsWith('/auth/') || p.startsWith('/api/web-auth/') || p.startsWith('/api/web/auth/');
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