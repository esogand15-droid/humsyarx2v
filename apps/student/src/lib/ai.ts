/* لایهٔ دادهٔ هوشیار — گفتوگوهای چندگانه، استریم SSE، وضعیت سهمیه.
   W3: پارسر SSE مستقل از مرز تکهها (باگ P0 گم شدن توکن وقتی event: و data:
   در دو تکهٔ شبکه میرسیدند)، CRUD گفتوگو، و نگاشت خطاها به پیام فارسی.
   امضای streamAiChat برای پنل هوشیار در ریدر دستنخورده مانده است. */
import { apiCall, ApiError } from './api';

/* ── انواع ─────────────────────────────────────────────── */

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  tokens_used?: number;
  vision?: {
    image_url?: string;
    detected_structures?: string[];
    confidence_level?: string;
  };
}

export interface AiConversation {
  id: string;
  title: string;
  pinned?: boolean;
  archived?: boolean;
  preview?: string;
  count?: number;
  legacy?: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface AiHistoryMessage {
  role: 'user' | 'assistant';
  text: string;
  at?: string | null;
  index?: number;
}

export interface AiActiveReference {
  name?: string;
  filename?: string;
  mime?: string;
  size_bytes?: number;
}

export interface AiStatus {
  enabled: boolean;
  banned: boolean;
  daily_limit: number;
  used_today: number;
  remaining: number | null;
  unlimited: boolean;
  disabled_message: string;
  max_input_chars: number;
  active_reference?: AiActiveReference | null;
  capabilities?: { text?: boolean; image?: boolean; pdf?: boolean; audio?: boolean };
}

export interface VisionDiagnosisResult {
  analysis: string;
  detected_structures: string[];
  confidence_level: string;
  tokens_used: number;
}

export interface AskMediaResult {
  answer: string;
  tokens_used?: number;
  conversation_id?: string;
  active_reference?: AiActiveReference | null;
  attachment?: { kind: 'image' | 'pdf' | 'audio'; name: string; mime: string; size_bytes: number; reference_active?: boolean };
}

/** کد خطاهایی که رابط کاربری برایشان رفتار جدا دارد. */
export type AiErrorCode =
  | 'offline'
  | 'unauthorized'
  | 'no_access'
  | 'banned'
  | 'busy'
  | 'too_long'
  | 'quota'
  | 'rate_limit'
  | 'unavailable'
  | 'stream_failed'
  | 'provider_unavailable'
  | 'incomplete'
  | 'unknown';

export class AiError extends Error {
  code: AiErrorCode;
  status: number;
  retryAfter: number | null;
  /** خطا وسط استریم و بعد از چند توکن آمد (متن نیمهکاره روی سرور ذخیره شده). */
  partial: boolean;

  constructor(code: AiErrorCode, message: string, status = 0, retryAfter: number | null = null, partial = false) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
    this.partial = partial;
  }
}

const MSG: Record<AiErrorCode, string> = {
  offline: 'اتصال اینترنت برقرار نیست. دوباره تلاش کن.',
  unauthorized: 'نشست تو منقضی شده است. دوباره وارد شو.',
  no_access: 'دسترسی به هوشیار در اشتراک فعلی تو فعال نیست.',
  banned: 'دسترسی تو به هوشیار مسدود شده است.',
  busy: 'پاسخ قبلی هنوز در حال آماده‌شدن است. چند لحظه صبر کن.',
  too_long: 'متن پرسش طولانی‌تر از حد مجاز است.',
  quota: 'سهمیهٔ امروز هوشیار تمام شده است.',
  rate_limit: 'پرسش‌ها خیلی پشت سر هم بود. کمی صبر کن و دوباره بفرست.',
  unavailable: 'هوشیار موقتاً در دسترس نیست.',
  stream_failed: 'ارتباط با سرویس هوش مصنوعی قطع شد.',
  provider_unavailable: 'سرویس هوش مصنوعی موقتاً در دسترس نیست.',
  incomplete: 'پاسخ کامل نشد.',
  unknown: 'خطا در ارتباط با هوشیار.',
};

function detailOf(body: unknown): { text: string; code: string } {
  const d = (body as { detail?: unknown } | null)?.detail;
  if (typeof d === 'string') return { text: d, code: '' };
  if (d && typeof d === 'object') {
    const o = d as { message?: unknown; code?: unknown };
    return { text: typeof o.message === 'string' ? o.message : '', code: typeof o.code === 'string' ? o.code : '' };
  }
  return { text: '', code: '' };
}

/** پاسخ HTTP ناموفق → AiError با پیام فارسی (پیام خود سرور اگر فارسی و معنادار بود). */
export function toAiError(status: number, body: unknown, retryAfterHeader?: string | null): AiError {
  const { text } = detailOf(body);
  const ra = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : NaN;
  const retryAfter = Number.isFinite(ra) && ra > 0 ? ra : null;
  const pick = (code: AiErrorCode) => new AiError(code, text && /[\u0600-\u06FF]/.test(text) ? text : MSG[code], status, retryAfter);
  if (status === 401) return new AiError('unauthorized', MSG.unauthorized, status);
  if (status === 402) return pick('no_access');
  if (status === 403) return pick('banned');
  if (status === 409) return pick('busy');
  if (status === 422) return pick('too_long');
  if (status === 429) return /سهمیه/.test(text) ? pick('quota') : pick('rate_limit');
  if (status === 502 || status === 503 || status === 504) return pick('unavailable');
  return new AiError('unknown', text && /[\u0600-\u06FF]/.test(text) ? text : MSG.unknown, status);
}

export function aiErrorFrom(err: unknown): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof ApiError) {
    if (err.offline) return new AiError('offline', MSG.offline, 0);
    return toAiError(err.status, { detail: err.detail ?? err.code });
  }
  return new AiError('unknown', MSG.unknown);
}

/* ── پارسر SSE ─────────────────────────────────────────────
   حالت (event فعلی، خطوط data، بافر نیمخط) بین تکهها حفظ میشود؛
   رویداد فقط با خط خالی تحویل میشود (طبق WHATWG). */
export function createSseParser(onEvent: (event: string, data: string) => void) {
  let buf = '';
  let ev = '';
  let data: string[] = [];

  const dispatch = () => {
    if (data.length) onEvent(ev || 'message', data.join('\n'));
    ev = '';
    data = [];
  };

  const line = (l: string) => {
    if (l === '') return dispatch();
    if (l.startsWith(':')) return;
    const c = l.indexOf(':');
    const field = c < 0 ? l : l.slice(0, c);
    let value = c < 0 ? '' : l.slice(c + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') ev = value;
    else if (field === 'data') data.push(value);
  };

  return {
    push(chunk: string) {
      buf += chunk;
      for (;;) {
        const i = buf.search(/[\r\n]/);
        if (i < 0) break;
        // «\r» تنها در انتهای تکه: شاید «\n» در تکهٔ بعد بیاید — صبر کن
        if (buf[i] === '\r' && i === buf.length - 1) break;
        const step = buf[i] === '\r' && buf[i + 1] === '\n' ? 2 : 1;
        line(buf.slice(0, i));
        buf = buf.slice(i + step);
      }
    },
    end() {
      if (buf) {
        line(buf);
        buf = '';
      }
      dispatch();
    },
  };
}

/* ── استریم پرسش ───────────────────────────────────────── */

export interface StreamStartMeta {
  conversation_id: string;
  title?: string;
  regenerated?: boolean;
}

export interface StreamOptions {
  conversationId?: string | null;
  /** آخرین دور (همین پرسش) روی سرور برداشته و دوباره پرسیده شود. */
  regenerate?: boolean;
  signal?: AbortSignal;
  onStart?: (meta: StreamStartMeta) => void;
  onToken: (text: string) => void;
  onDone?: (tokensUsed: number) => void;
}

export type StreamOutcome =
  | { status: 'done'; tokensUsed: number }
  | { status: 'aborted' }
  | { status: 'error'; error: AiError };

/** POST /api/ai/ask با SSE. هرگز throw نمیکند؛ نتیجه را برمیگرداند. */
export async function streamAsk(message: string, o: StreamOptions): Promise<StreamOutcome> {
  let res: Response;
  try {
    res = await fetch('/api/ai/ask', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({
        message,
        conversation_id: o.conversationId || undefined,
        regenerate: o.regenerate || undefined,
        stream_meta: true,
      }),
      signal: o.signal,
    });
  } catch {
    if (o.signal?.aborted) return { status: 'aborted' };
    return { status: 'error', error: new AiError('offline', MSG.offline) };
  }

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = JSON.parse(await res.text());
    } catch {
      /* بدنهٔ غیر JSON */
    }
    return { status: 'error', error: toAiError(res.status, body, res.headers.get('Retry-After')) };
  }
  if (!res.body) return { status: 'error', error: new AiError('incomplete', MSG.incomplete, res.status) };

  let done = false;
  let tokens = 0;
  let sawToken = false;
  let streamErr: AiError | null = null;

  const parser = createSseParser((event, raw) => {
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    if (event === 'token' && typeof data.text === 'string') {
      sawToken = true;
      o.onToken(data.text);
    } else if (event === 'start') {
      o.onStart?.(data as unknown as StreamStartMeta);
    } else if (event === 'error') {
      const code = (typeof data.code === 'string' ? data.code : 'stream_failed') as AiErrorCode;
      const known = code in MSG ? code : 'stream_failed';
      const text = typeof data.message === 'string' && data.message ? data.message : MSG[known];
      streamErr = new AiError(known, text, 200, null, Boolean(data.partial) || sawToken);
    } else if (event === 'done') {
      done = true;
      tokens = typeof data.tokens_used === 'number' ? data.tokens_used : 0;
    }
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  try {
    for (;;) {
      const { done: eof, value } = await reader.read();
      if (eof) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.end();
  } catch {
    if (o.signal?.aborted) return { status: 'aborted' };
    return { status: 'error', error: new AiError('incomplete', MSG.incomplete, 200, null, sawToken) };
  }

  if (streamErr) return { status: 'error', error: streamErr };
  if (!done) {
    if (o.signal?.aborted) return { status: 'aborted' };
    return { status: 'error', error: new AiError('incomplete', MSG.incomplete, 200, null, sawToken) };
  }
  o.onDone?.(tokens);
  return { status: 'done', tokensUsed: tokens };
}

/* ── API قدیمی (پنل هوشیار در ریدر) ───────────────────── */

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onDone?: (tokensUsed: number) => void;
  onError?: (error: Error) => void;
}

/** سازگار با امضای قبلی: روی خطا onError و سپس throw؛ روی لغو، بیصدا. */
export async function streamAiChat(
  message: string,
  conversationId: string | null | undefined,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const out = await streamAsk(message, {
    conversationId,
    signal,
    onToken: callbacks.onToken,
    onDone: callbacks.onDone,
  });
  if (out.status === 'error') {
    callbacks.onError?.(out.error);
    throw out.error;
  }
}

/** تحلیل بالینی و تشخیصی تصویر پزشکی (مولتیمدال) */
export async function diagnoseClinicalImage(file: File, prompt?: string): Promise<VisionDiagnosisResult> {
  const formData = new FormData();
  formData.append('file', file);
  if (prompt) formData.append('prompt', prompt);

  let res: Response;
  try {
    res = await fetch('/api/ai/vision', { method: 'POST', credentials: 'same-origin', body: formData });
  } catch {
    throw new AiError('offline', MSG.offline);
  }
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = JSON.parse(await res.text());
    } catch {
      /* fallback */
    }
    const err = toAiError(res.status, body);
    if (err.code === 'unknown') err.message = 'خطا در تحلیل تصویر پزشکی';
    throw err;
  }
  return (await res.json()) as VisionDiagnosisResult;
}

/* ── گفتوگوها ─────────────────────────────────────────── */

const C = '/api/ai/conversations';

function qs(params: Record<string, string | number | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

export const ai = {
  stream: streamAiChat,
  vision: diagnoseClinicalImage,

  status: () => apiCall<AiStatus>('/api/ai/status'),

  /** فهرست گفتوگوها (پینشدهها اول، سپس جدیدترین). q/limit/offset اختیاری. */
  conversations: (p: { q?: string; limit?: number; offset?: number } = {}) =>
    apiCall<{ conversations: AiConversation[]; total?: number; has_more?: boolean }>(
      C + qs({ q: p.q?.trim() || undefined, limit: p.limit, offset: p.offset || undefined }),
    ),

  createConversation: (title?: string) =>
    apiCall<{ id: string }>(C, { method: 'POST', body: JSON.stringify(title ? { title } : {}) }),

  /** پیامهای یک گفتوگو؛ با limit دُم تاریخچه، با before صفحهٔ قدیمیتر. */
  messages: (id: string, p: { before?: number; limit?: number } = {}) =>
    apiCall<{ messages: AiHistoryMessage[]; total?: number; has_more?: boolean }>(
      `${C}/${encodeURIComponent(id)}/messages` + qs({ before: p.before, limit: p.limit }),
    ),

  rename: (id: string, title: string) =>
    apiCall<{ ok: boolean }>(`${C}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ title }) }),

  setPinned: (id: string, pinned: boolean) =>
    apiCall<{ ok: boolean }>(`${C}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ pinned }) }),

  remove: (id: string) => apiCall<{ ok: boolean }>(`${C}/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  askMedia: async (file: File, message = '', conversationId?: string | null): Promise<AskMediaResult> => {
    const fd = new FormData();
    fd.append('file', file);
    if (message.trim()) fd.append('message', message.trim());
    if (conversationId) fd.append('conversation_id', conversationId);
    const res = await fetch('/api/ai/ask-media', { method: 'POST', credentials: 'same-origin', body: fd });
    if (!res.ok) {
      let body: unknown = null;
      try { body = JSON.parse(await res.text()); } catch { /* fallback */ }
      throw toAiError(res.status, body);
    }
    return (await res.json()) as AskMediaResult;
  },

  attachReference: async (file: File): Promise<{ ok: boolean; active_reference: AiActiveReference | null }> => {
    const fd = new FormData();
    fd.append('file', file);
    return apiCall<{ ok: boolean; active_reference: AiActiveReference | null }>('/api/ai/reference', {
      method: 'POST',
      body: fd,
    });
  },

  clearReference: () => apiCall<{ ok: boolean }>('/api/ai/reference', { method: 'DELETE' }),

  report: (question: string, answer: string) =>
    apiCall<{ ok: boolean; message?: string }>('/api/ai/report', {
      method: 'POST',
      body: JSON.stringify({ question: question || 'سؤال کاربر', answer }),
    }),

  generateImage: (prompt: string, aspect_ratio = '1:1') =>
    apiCall<{
      ok: boolean;
      image: string;
      mime: string;
      model?: string;
      usage?: { used_today: number; daily_limit: number; remaining: number | null; unlimited: boolean };
    }>('/api/ai/generate-image', {
      method: 'POST',
      body: JSON.stringify({ prompt, aspect_ratio }),
    }),

  liveConfig: () =>
    apiCall<{
      enabled: boolean;
      live_enabled: boolean;
      model: string;
      voice: string;
      thinking_level: string;
      target_language: string;
      max_session_sec: number;
      models?: Array<{ id: string; label: string; free?: boolean }>;
      voices?: Array<{ id: string; label: string }>;
      translate_languages?: Array<{ code: string; label: string }>;
      usage?: { used_today_sec: number; daily_limit_sec: number; remaining_sec: number | null; unlimited: boolean };
    }>('/api/ai/live/config'),
};

/* ── جزوه‌نویس هوشمند چندرسانه‌ای ── */
export interface LectureJob {
  id: string;
  title: string;
  subject: string;
  professor: string;
  status: 'processing' | 'ready' | 'failed';
  stage: string;
  status_text: string;
  error: string;
  pdf_ready: boolean;
  pdf_size: number;
  summary?: {
    title?: string;
    subject?: string;
    professor?: string;
    session?: string;
    executive_summary?: string;
    topics_count?: number;
    pearls_count?: number;
    traps_count?: number;
    qna_count?: number;
  };
  created_at: string;
}

export const lectureApi = {
  config: () =>
    apiCall<{
      enabled: boolean;
      daily_limit: number;
      used_today: number;
      remaining_today: number;
      unlimited: boolean;
      max_upload_mb: number;
    }>('/lecture/config'),

  jobs: () => apiCall<{ jobs: LectureJob[] }>('/lecture/jobs'),

  job: (id: string) => apiCall<{ job: LectureJob }>(`/lecture/jobs/${encodeURIComponent(id)}`),

  create: (params: { audio?: File | null; slides?: File | null; notes?: string }) => {
    const fd = new FormData();
    if (params.audio) fd.append('audio', params.audio);
    if (params.slides) fd.append('slides', params.slides);
    if (params.notes?.trim()) fd.append('notes', params.notes.trim());
    return apiCall<{ ok: boolean; job_id: string; status: string }>('/lecture/create', {
      method: 'POST',
      body: fd,
    });
  },

  deleteJob: (id: string) =>
    apiCall<{ ok: boolean }>(`/lecture/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  pdfUrl: (id: string, inline = false) =>
    `/api/web/lecture/jobs/${encodeURIComponent(id)}/pdf${inline ? '?inline=1' : ''}`,
};
