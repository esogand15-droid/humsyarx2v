/** ❓ لایهٔ دادهٔ بانک سؤال — فقط همین‌جا مسیر شبکه‌ای نوشته می‌شود.
 *
 *  قرارداد سرور (موج P5، همه روی هندلرهای موجود ربات/مینی‌اپ):
 *    lessons  → {lessons: [{id,name,term,count}]}
 *    topics   → {lesson_id, topics: [{id,name,count}]}
 *    next     → {question, progress:{total,solved_unique,remaining,exhausted}, ai_available}
 *    answer   → {is_correct, correct_answer, explanation, question, prestige}
 *    stats    → {attempts, solved_unique, correct, wrong, accuracy, weak_topics, topics}
 *    history  → {answers: [...], total, limit, has_more, next_cursor}
 */
import { apiCall } from './api';

export interface LessonItem {
  id: string;
  name: string;
  term: string;
  count: number;
}

export interface TopicItem {
  id: string;
  name: string;
  count: number;
  kind?: 'topic' | 'exam_period';
  attempts?: number;
  accuracy?: number | null;
}

export interface CatalogLessonItem {
  id: string;
  name: string;
  term: string;
  group: string;
  count: number;
  solved_count: number;
  accuracy: number | null;
  topics_count: number;
  periods_count: number;
}

export interface CatalogGroup {
  key: string;
  title: string;
  description: string;
  lesson_count: number;
  question_count: number;
  lessons: CatalogLessonItem[];
}

export interface PeriodLessonCount {
  lesson_id: string;
  lesson: string;
  count: number;
}

export interface ExamPeriodItem {
  key: string;
  exam_year: string | null;
  exam_session: string | null;
  label: string;
  count: number;
  lessons: PeriodLessonCount[];
}

export interface FilterOption {
  code: string;
  label: string;
  count: number;
}

/* برچسبهای سختی از بکاند (مشترک با بات) ایموجی رنگی دارند: «آسان 🟢».
   وب بهجای ایموجی نقطهٔ DS میکشد؛ بنابراین فقط متن را نگه میداریم. */
const EMOJI_DOT = /[\u{1F534}\u{1F7E0}-\u{1F7EB}\u{26AA}\u{26AB}\u{2B24}]\uFE0F?/gu;
export const plainLabel = (label: string): string => label.replace(EMOJI_DOT, '').replace(/\s{2,}/g, ' ').trim();

export type DiffTone = 'easy' | 'medium' | 'hard';
export const diffTone = (code: string): DiffTone | null =>
  code === 'easy' || code === 'medium' || code === 'hard' ? code : null;

export interface CatalogFilters {
  sources: FilterOption[];
  years: string[];
  year_min: string | null;
  year_max: string | null;
  sessions: FilterOption[];
  difficulties: FilterOption[];
}

export interface CatalogPayload {
  total_questions: number;
  active_lessons_count: number;
  groups: CatalogGroup[];
  empty_lessons: CatalogLessonItem[];
  periods: ExamPeriodItem[];
  filters: CatalogFilters;
  smart_queues: {
    flagged_count: number;
    wrong_count: number;
    hard_count: number;
  };
}

export type PracticeMode = 'free' | 'weak' | 'hard' | 'wrong' | 'flagged';

export interface PracticeQuery {
  lesson?: string;
  topic?: string;
  lesson_id?: string;
  topic_id?: string;
  mode?: PracticeMode;
  difficulty?: string;
  exam_year_from?: string;
  exam_year_to?: string;
  exam_session?: string;
  content_source?: string[];
  include_solved?: boolean;
  exclude?: string[];
}

export interface Question {
  id: string;
  lesson_id: string;
  topic_id: string;
  lesson: string;
  topic: string;
  difficulty: string;
  difficulty_label: string;
  question: string;
  options: string[];
  source: string;
  exam_year: string | null;
  exam_session_label: string | null;
  content_source: string;
  content_source_label_fa: string;
  image: { has_image: boolean; pending_upload: boolean; alt_text: string };
  image_url: string | null;
}

export interface Progress {
  total: number;
  solved_unique: number;
  remaining: number;
  exhausted: boolean;
}

export interface NextPayload {
  question: Question | null;
  progress: Progress;
  ai_available: boolean;
  cycle_completed?: boolean;
  weak_topic?: TopicStat;
  message?: string;
}

export interface AnswerPayload {
  is_correct: boolean;
  correct_answer: number;
  explanation: string;
  question: Question;
  prestige?: unknown;
}

export interface TopicStat {
  lesson_id: string;
  topic_id: string;
  lesson: string;
  topic: string;
  attempts: number;
  correct: number;
  accuracy: number;
  weak: boolean;
}

export interface StatsPayload {
  attempts: number;
  solved_unique: number;
  correct: number;
  wrong: number;
  accuracy: number;
  weak_topics: TopicStat[];
  topics: TopicStat[];
}

export interface HistoryItem {
  id: string;
  question_id: string;
  lesson: string;
  topic: string;
  question: string;
  selected: number;
  correct_answer: number;
  is_correct: boolean;
  answered_at: string;
}

export interface HistoryPayload {
  answers: HistoryItem[];
  total: number | null;
  has_more: boolean;
  next_cursor: string | null;
}

const q = (v?: string | null) => (v ? `?${v}` : '');

function buildFilterSearch(params?: {
  difficulty?: string;
  exam_year_from?: string;
  exam_year_to?: string;
  exam_session?: string;
  content_source?: string[];
}): URLSearchParams {
  const sp = new URLSearchParams();
  if (!params) return sp;
  if (params.difficulty) sp.set('difficulty', params.difficulty);
  if (params.exam_year_from) sp.set('exam_year_from', params.exam_year_from);
  if (params.exam_year_to) sp.set('exam_year_to', params.exam_year_to);
  if (params.exam_session) sp.set('exam_session', params.exam_session);
  for (const src of params.content_source ?? []) {
    if (src) sp.append('content_source', src);
  }
  return sp;
}

export const exam = {
  catalog: (params?: {
    difficulty?: string;
    exam_year_from?: string;
    exam_year_to?: string;
    exam_session?: string;
    content_source?: string[];
  }) => apiCall<CatalogPayload>(`/exam/catalog${q(buildFilterSearch(params).toString())}`),

  filters: () => apiCall<CatalogFilters>('/exam/filters'),

  lessons: () => apiCall<{ lessons: LessonItem[] }>('/exam/lessons'),

  topics: (
    lesson: string,
    params?: {
      difficulty?: string;
      exam_year_from?: string;
      exam_year_to?: string;
      exam_session?: string;
      content_source?: string[];
    },
  ) =>
    apiCall<{ lesson_id: string; topics: TopicItem[] }>(
      `/exam/topics/${encodeURIComponent(lesson)}${q(buildFilterSearch(params).toString())}`,
    ),

  next: (lessonOrQuery?: string | PracticeQuery, topic?: string) => {
    const query: PracticeQuery =
      typeof lessonOrQuery === 'object' && lessonOrQuery !== null
        ? lessonOrQuery
        : { lesson: lessonOrQuery, topic };
    const sp = buildFilterSearch(query);
    if (query.lesson) sp.set('lesson', query.lesson);
    if (query.topic) sp.set('topic', query.topic);
    if (query.lesson_id) sp.set('lesson_id', query.lesson_id);
    if (query.topic_id) sp.set('topic_id', query.topic_id);
    if (query.mode && query.mode !== 'free') sp.set('mode', query.mode);
    if (query.include_solved) sp.set('include_solved', 'true');
    if (query.exclude?.length) sp.set('exclude', query.exclude.slice(-50).join(','));
    return apiCall<NextPayload>(`/exam/next${q(sp.toString())}`);
  },

  answer: (question_id: string, selected: number) =>
    apiCall<AnswerPayload>('/exam/answer', {
      method: 'POST',
      body: JSON.stringify({ question_id, selected }),
    }),

  stats: () => apiCall<StatsPayload>('/exam/stats'),

  history: (limit = 20) => apiCall<HistoryPayload>(`/exam/history?limit=${limit}`),

  flag: (question_id: string) =>
    apiCall<{ question_id: string; flagged: boolean }>(`/exam/flag/${encodeURIComponent(question_id)}`, {
      method: 'POST',
    }),

  flagged: () => apiCall<{ flagged_ids: string[] }>('/exam/flagged'),
};

/** گزینه‌ها با حروف فارسی — «الف/ب/ج/د» همان چیزی است که دانشجو در
    برگهٔ آزمون می‌بیند؛ شمارهٔ لاتین وسط متن فارسی خواندن را کند می‌کند. */
export const OPTION_LETTERS = ['الف', 'ب', 'ج', 'د'];

export const accuracyTone = (pct: number): 'good' | 'mid' | 'low' =>
  pct >= 75 ? 'good' : pct >= 50 ? 'mid' : 'low';

/* ─────────────────────────────────────────────────────────────
   P5.2 — آزمون زمان‌دار
   ───────────────────────────────────────────────────────────── */

export interface MockStartBody {
  lesson: string;
  topic?: string | null;
  lesson_id?: string | null;
  topic_id?: string | null;
  count: number;
  minutes: number;
  allow_smaller?: boolean;
  difficulty?: string | null;
  exam_year_from?: string | null;
  exam_year_to?: string | null;
  exam_session?: string | null;
  content_source?: string[] | null;
}

export interface MockPreview {
  requested_count: number;
  available_count: number;
  can_start: boolean;
  max_count: number;
  minutes: number;
  output_mode: string;
  taxonomy: Record<string, string>;
}

export interface MockSummary {
  session_id: string;
  lesson: string;
  topic: string;
  status: 'active' | 'finished' | 'expired' | 'abandoned';
  total: number;
  answered: number;
  correct: number;
  percentage: number;
  current_index: number;
  minutes: number;
  deadline: string | null;
  started_at: string | null;
  finished_at: string | null;
  exam_code: string | null;
  requested_count: number;
  actual_count: number;
}

export interface MockNext {
  finished: boolean;
  /** فقط وقتی finished=false */
  question?: Question;
  progress?: number;
  total?: number;
  seconds_left?: number | null;
  session_id?: string;
  /* وقتی finished=true، خلاصهٔ آزمون با همین فیلدها می‌آید */
  answered?: number;
  correct?: number;
  percentage?: number;
  status?: string;
}

export interface MockAnswerResult {
  accepted: boolean;
  progress: number;
  total: number;
  finished: boolean;
  session_id: string;
  result?: { answered: number; correct: number; percentage: number };
}

export interface ReviewItem {
  question_id: string;
  selected: number;
  correct_answer: number;
  is_correct: boolean;
  answered_at: string;
  question?: string;
  options?: string[];
  topic?: string;
  explanation?: string;
  image_url?: string | null;
}

export interface MockReview extends MockSummary {
  review: ReviewItem[];
  total_questions: number;
}

/** زمان باقی‌مانده از سرور؛ شمارش محلی فقط نمایشی است. */
export const mockExam = {
  preview: (b: MockStartBody) =>
    apiCall<MockPreview>('/exam/mock/preview', { method: 'POST', body: JSON.stringify(b) }),

  start: (b: MockStartBody) =>
    apiCall<MockSummary>('/exam/mock/start', { method: 'POST', body: JSON.stringify(b) }),

  active: () => apiCall<{ exam: MockSummary | null }>('/exam/mock/active'),

  session: (sid: string) => apiCall<MockSummary>(`/exam/mock/${sid}`),

  next: (sid: string) => apiCall<MockNext>(`/exam/mock/${sid}/next`),

  answer: (sid: string, selected: number) =>
    apiCall<MockAnswerResult>(`/exam/mock/${sid}/answer`, {
      method: 'POST',
      body: JSON.stringify({ selected }),
    }),

  abandon: (sid: string) =>
    apiCall<{ ok: boolean }>(`/exam/mock/${sid}/abandon`, { method: 'POST' }),

  history: () => apiCall<{ exams: MockSummary[]; total: number }>('/exam/mock/history'),

  review: (sid: string) => apiCall<MockReview>(`/exam/mock/${sid}/review`),

  downloadPdf: async (sessionId: string, mode: 'exam' | 'practice' = 'exam', filename?: string) => {
    const url = `/api/web/exam/${encodeURIComponent(sessionId)}/pdf?mode=${mode}`;
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('دریافت دفترچه PDF با خطا مواجه شد');
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename || `humsyar-exam-${sessionId}-${mode}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  },
};

/** ثانیه → «۱۲:۳۴» با رقم فارسی (همان قاعدهٔ کل محصول: رقم فارسی،
 *  چیدمان عددی چپ‌به‌راست تا ساعت مثل ساعت خوانده شود). */
export function clockFa(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  const fa2 = (n: number) =>
    String(n)
      .padStart(2, '0')
      .replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
  return `${fa2(m)}:${fa2(r)}`;
}

/* ── طراحی سؤال و سؤال‌های من ── */
export interface MyQuestionDesign {
  id: string;
  lesson: string;
  topic: string;
  question: string;
  options: string[];
  correct: number;
  explanation?: string;
  difficulty?: string;
  status: string;
  status_label?: string;
  approved?: boolean;
  review_note?: string;
  created_at?: string;
}

export interface QuestionDesignPayload {
  lesson_id?: string | null;
  topic_id?: string | null;
  lesson: string;
  topic: string;
  question: string;
  options: string[];
  correct: number;
  explanation?: string;
  difficulty?: string;
}

export const questionDesignApi = {
  mine: (skip = 0, limit = 50) =>
    apiCall<{ questions: MyQuestionDesign[] }>(`/api/questions/my-designs?skip=${skip}&limit=${limit}`),

  create: (body: QuestionDesignPayload) =>
    apiCall<{ ok: boolean; question_id: string; message?: string }>('/api/questions/design', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  update: (id: string, body: QuestionDesignPayload, resubmit = false) =>
    apiCall<{ ok: boolean; status?: string }>(`/api/questions/my-designs/${encodeURIComponent(id)}?resubmit=${resubmit}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  resubmit: (id: string, body: QuestionDesignPayload) =>
    apiCall<{ ok: boolean; status?: string }>(`/api/questions/my-designs/${encodeURIComponent(id)}/resubmit`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  withdraw: (id: string) =>
    apiCall<{ ok: boolean; message?: string }>(`/api/questions/my-designs/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
};

/* ── چالش ارتقای رتبه (Promotion Challenge) ── */
export interface PromotionStartResult {
  session_id: string;
  total: number;
  promotion: boolean;
  resume?: boolean;
  index?: number;
  target_rank?: string;
  target_title?: string;
  target_icon?: string;
  apex?: boolean;
  pass_pct?: number;
}

export const promotionApi = {
  start: () =>
    apiCall<PromotionStartResult>('/api/questions/custom-exam/start', {
      method: 'POST',
      body: JSON.stringify({ count: 10, minutes: 0, output_mode: 'app', promotion: true }),
    }),

  next: (sid: string) =>
    apiCall<MockNext>(`/api/questions/custom-exam/${encodeURIComponent(sid)}/next`),

  answer: (sid: string, selected: number) =>
    apiCall<{
      is_correct?: boolean;
      correct_answer?: number;
      finished?: boolean;
      promotion_result?: {
        win: boolean;
        pct: number;
        pass_pct: number;
        need: number;
        reward: number;
        target_rank?: string;
        cooldown_h?: number;
      };
    }>(`/api/questions/custom-exam/${encodeURIComponent(sid)}/answer`, {
      method: 'POST',
      body: JSON.stringify({ selected }),
    }),
};

/* ── آزمون‌ساز هوشمند از روی PDF ── */
export interface QuizDocTopic {
  id: number;
  title: string;
  page_start: number;
  page_end: number;
}

export interface QuizDocItem {
  id: string;
  name: string;
  status: 'processing' | 'ready' | 'failed';
  error?: string;
  size_bytes: number;
  page_count: number;
  quality: number;
  quality_note?: string;
  topics: QuizDocTopic[];
  created_at: string;
}

export interface PdfQuizQuestion {
  id: string;
  order_index: number;
  stem: string;
  options: string[];
  topic_title?: string;
  difficulty?: string;
  page_refs?: number[];
  status: string;
  answered_option?: number | null;
  is_correct?: boolean | null;
  correct_index?: number;
  explanation_short?: string;
  explanation_long?: string;
  source_evidence?: string;
}

export interface PdfQuizSession {
  id: string;
  doc_id: string;
  doc_name: string;
  status: string;
  total_planned: number;
  answered: number;
  correct: number;
  wrong: number;
  settings?: Record<string, unknown>;
}

export const pdfQuizApi = {
  config: () =>
    apiCall<{
      enabled: boolean;
      max_pdf_mb: number;
      max_pages: number;
      max_questions_per_session: number;
      daily_limit: number;
      used_today: number;
      remaining_today: number;
    }>('/quiz/config'),

  docs: () => apiCall<{ docs: QuizDocItem[] }>('/quiz/docs'),

  getDoc: (docId: string) => apiCall<{ doc: QuizDocItem }>(`/quiz/docs/${encodeURIComponent(docId)}`),

  deleteDoc: (docId: string) =>
    apiCall<{ ok: boolean }>(`/quiz/docs/${encodeURIComponent(docId)}`, { method: 'DELETE' }),

  upload: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return apiCall<{ ok: boolean; doc_id: string; status: string }>('/quiz/upload', {
      method: 'POST',
      body: fd,
    });
  },

  startSession: (body: {
    doc_id: string;
    topic_id?: number;
    page_from?: number;
    page_to?: number;
    count: number;
    difficulty: 'easy' | 'medium' | 'hard' | 'mixed';
  }) =>
    apiCall<{ ok: boolean; session_id: string; doc_name: string; topic_title: string; total: number }>(
      '/quiz/sessions/start',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  sessions: () => apiCall<{ sessions: PdfQuizSession[] }>('/quiz/sessions'),

  session: (sid: string) =>
    apiCall<{ session: PdfQuizSession; questions: PdfQuizQuestion[] }>(`/quiz/sessions/${encodeURIComponent(sid)}`),

  answer: (sid: string, question_id: string, selected: number, time_ms?: number) =>
    apiCall<{ ok: boolean; question: PdfQuizQuestion; session: PdfQuizSession }>(
      `/quiz/sessions/${encodeURIComponent(sid)}/answer`,
      { method: 'POST', body: JSON.stringify({ question_id, selected, time_ms }) },
    ),
};
