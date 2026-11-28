/* DEV-ONLY demo mode and mock data.
   This module is reached only through import('./demo') inside an
   import.meta.env.DEV branch (lib/api.ts, LoginScreen). In a production build
   that branch is a constant false and is eliminated, so not one byte of this
   file lands in dist. scripts/check-nodemo.mjs verifies that after every build. */

import type { PublicUser } from './api-types';

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
import { addDays, tehranNow, weekStart } from './weekPlan';

const MOCK_USER: PublicUser = {
  id: 123456789,
  name: 'دکتر علی رضایی',
  username: 'demo_user',
  student_id: '98123456',
  group: 'گروه الف (فیزیوپاتولوژی)',
  intake: '1401',
  role: 'student',
  registered_at: '۱۴۰۱/۰۱/۰۱',
  web_login_code: '7K9M2P4X',
};

function currentWeekDates(): string[] {
  const ws = weekStart(tehranNow().iso);
  return Array.from({ length: 7 }, (_, i) => addDays(ws, i));
}

const WEEK_DAY_LABELS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
const WEEK_COUNTS = [8, 5, 11, 4, 9, 6, 2];

function buildMockDashboard() {
  return {
    user: {
      name: MOCK_USER.name,
      nickname: 'دکتر علی',
      display_name: MOCK_USER.name,
      intake: '1401',
      group: 'گروه الف (فیزیوپاتولوژی)',
      role: 'student',
      student_id: '98123456',
    },
    stats: {
      total_answers: 248,
      correct_answers: 216,
      accuracy: 87,
      streak_days: 15,
      weak_topics: ['الکتروفیزیولوژی دهلیزی', 'فارماکولوژی ضدآریتمی'],
    },
    upcoming_exams: [
      {
        id: 'ex_demo_1',
        lesson: 'فیزیوپاتولوژی قلب',
        date: currentWeekDates()[5],
        time: '۱۰:۰۰',
        days_left: 5,
        course_code: 'MED-301',
        teacher: 'دکتر صادقی',
        location: 'تالار ابن‌سینا',
      },
    ],
    open_tickets: 1,
    prestige: {
      xp: 1840,
      level: 7,
      level_title: 'انترن پیشتاز',
      rank: 'رتبه ۴ در ورودی ۱۴۰۱',
      streak: { current: 15, best: 21 },
      exams_completed: 9,
      downloads_count: 14,
    },
  };
}

function buildMockWeekly() {
  const dates = currentWeekDates();
  return {
    weekly: dates.map((date, idx) => ({
      date,
      day: WEEK_DAY_LABELS[idx],
      count: WEEK_COUNTS[idx] ?? 0,
    })),
  };
}

const MOCK_SUBSCRIPTION = {
  active: true,
  days_left: 30,
  plan_name: 'ماهانه VIP',
  expires: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  expires_fa: '۱۴۰۵/۱۰/۰۶',
  resource_access: true,
  enforced: true,
  stacked: false,
  has_pending_payment: false,
  card_number: '۶۰۳۷-۹۹۷۱-۱۲۳۴-۵۶۷۸',
  card_owner: 'مؤسسه آموزشی هامزیار',
  plans: [
    { id: 'plan_1m', name: 'اشتراک یک‌ماهه VIP', days: 30, price: 290000 },
    { id: 'plan_3m', name: 'اشتراک سه‌ماهه VIP', days: 90, price: 750000 },
    { id: 'plan_family', name: 'اشتراک گروهی (۳ نفره)', days: 90, price: 1850000, max_members: 3 },
  ],
  history: [
    {
      id: 'pay_demo_1',
      plan_name: 'ماهانه VIP',
      amount: 290000,
      final_price: 290000,
      status: 'approved',
      status_label: 'تأیید شده',
      created_at: new Date(Date.now() - 86_400_000).toISOString(),
    },
  ],
};

let demoSessions = [
  {
    session_id: 'sess_demo_1',
    device_name: 'مرورگر وب دسکتاپ (دمو لوکال)',
    device_type: 'desktop',
    ip_address: '127.0.0.1',
    is_current: true,
    created_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    last_active: new Date().toISOString(),
  },
  {
    session_id: 'sess_demo_2',
    device_name: 'آیفون ۱۵ (Safari)',
    device_type: 'mobile',
    ip_address: '127.0.0.1',
    is_current: false,
    created_at: new Date(Date.now() - 48 * 3_600_000).toISOString(),
    last_active: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  },
];

let demoNotifications = [
  {
    id: 'notif_demo_1',
    title: 'جزوه جدید فیزیوپاتولوژی قلب منتشر شد',
    body: 'فصل آریتمی‌های دهلیزی با نمودارهای ECG در کتابخانهٔ ترم ۱۴۰۱ قرار گرفت.',
    category: 'content',
    read: false,
    pinned: true,
    created_at: new Date(Date.now() - 45 * 60_000).toISOString(),
  },
  {
    id: 'notif_demo_2',
    title: 'یادآور کلاس فارماکولوژی بالینی',
    body: 'جلسهٔ هفتهٔ جاری ساعت ۱۰:۰۰ در تالار ابن‌سینا برگزار می‌شود.',
    category: 'schedule',
    read: false,
    pinned: false,
    created_at: new Date(Date.now() - 5 * 3_600_000).toISOString(),
  },
  {
    id: 'notif_demo_3',
    title: 'اشتراک ماهانه VIP فعال است',
    body: 'دسترسی کامل به جزوه‌ها، آزمون‌ها و هوشیار تا ۳۰ روز آینده برقرار است.',
    category: 'general',
    read: true,
    pinned: false,
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  },
];

let demoTasks: {
  task_id: string;
  title: string;
  jalali_date: string;
  reminder_time: string | null;
  completed: boolean;
  completed_at: string | null;
}[] = [
  {
    task_id: 'task_demo_1',
    title: 'مرور الکتروفیزیولوژی دهلیزی و موج P',
    jalali_date: '۱۴۰۵/۰۹/۰۷',
    reminder_time: '۱۶:۰۰',
    completed: false,
    completed_at: null as string | null,
  },
  {
    task_id: 'task_demo_2',
    title: 'حل ۲۰ تست فارماکولوژی ضدآریتمی',
    jalali_date: '۱۴۰۵/۰۹/۰۷',
    reminder_time: '۱۹:۳۰',
    completed: true,
    completed_at: new Date(Date.now() - 3_600_000).toISOString(),
  },
];

let demoTickets = [
  {
    id: 1042,
    subject: 'دسترسی به اسلایدهای جلسه ۵ قلب',
    status: 'waiting_user',
    created_at: new Date(Date.now() - 18 * 3_600_000).toISOString(),
    reply_count: 1,
    priority: 'normal',
    message: 'سلام، فایل اسلاید جلسه ۵ فیزیوپاتولوژی قلب را در بخش کتابخانه پیدا نکردم.',
    replies: [
      {
        text: 'سلام دکتر رضایی؛ فایل جلسه ۵ در ترم ۱۴۰۱ اضافه شد و از بخش کتابخانه قابل مطالعه است.',
        sender: 'support',
        at: new Date(Date.now() - 12 * 3_600_000).toISOString(),
      },
    ],
  },
];

const MOCK_CONTINUE_ITEMS = [
  { scope: 'res', id: 'pdf_cardio_01', name: 'جزوه فیزیوپاتولوژی قلب', kind: 'pdf', page: 12, total: 48, percent: 25, updated_at: '۱۴۰۳/۰۸/۱۵' },
];

export function getMockResponse<T>(path: string, init?: RequestInit): T | undefined {
  const p = path.toLowerCase();
  const method = (init?.method || 'GET').toUpperCase();

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
    if (method === 'DELETE') {
      const seg = path.split('/').filter(Boolean).pop() || '';
      demoSessions = demoSessions.filter((s) => s.session_id !== seg);
      return { ok: true, revoked: true } as unknown as T;
    }
    return { sessions: demoSessions } as unknown as T;
  }
  if (p.includes('/logout')) {
    return { ok: true } as unknown as T;
  }

  // 2. Dashboard & Notifications & Subscription
  if (p.includes('/notifications/inbox/unread-count')) {
    const unread = demoNotifications.reduce((acc, n) => acc + (n.read ? 0 : 1), 0);
    return { unread } as unknown as T;
  }
  if (p.includes('/notifications/inbox/read') && method === 'POST') {
    let ids: string[] | null = null;
    try {
      const parsed = init?.body ? JSON.parse(String(init.body)) : {};
      if (Array.isArray(parsed?.ids)) ids = parsed.ids as string[];
    } catch {
      /* ignore parse error */
    }
    demoNotifications = demoNotifications.map((n) =>
      ids === null || ids.includes(n.id) ? { ...n, read: true } : n,
    );
    const unread = demoNotifications.reduce((acc, n) => acc + (n.read ? 0 : 1), 0);
    return { ok: true, unread } as unknown as T;
  }
  if (p.includes('/notifications/inbox')) {
    const unread = demoNotifications.reduce((acc, n) => acc + (n.read ? 0 : 1), 0);
    return { items: demoNotifications, unread } as unknown as T;
  }
  if (p.includes('/notifications/settings')) {
    return {
      settings: [
        { key: 'exam_reminder', label: 'یادآور آزمون‌ها', enabled: true },
        { key: 'content_update', label: 'جزوه‌ها و منابع تازه', enabled: true },
        { key: 'schedule_change', label: 'تغییر برنامه کلاسی', enabled: true },
      ],
    } as unknown as T;
  }
  if (p.includes('/dashboard/weekly')) {
    return buildMockWeekly() as unknown as T;
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
    return buildMockDashboard() as unknown as T;
  }
  if (p.includes('/subscription/gateway')) {
    return { online_pay_enabled: true, bot_username: 'HumsyarBot' } as unknown as T;
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
      const segs = path.split('/').filter(Boolean);
      const taskId = decodeURIComponent(segs[segs.length - 2] || '');
      let nextCompleted = true;
      let completedAt: string | null = new Date().toISOString();
      demoTasks = demoTasks.map((t) => {
        if (t.task_id !== taskId) return t;
        nextCompleted = !t.completed;
        completedAt = nextCompleted ? new Date().toISOString() : null;
        return { ...t, completed: nextCompleted, completed_at: completedAt };
      });
      return { task_id: taskId, completed: nextCompleted, completed_at: completedAt } as unknown as T;
    }
    if (method === 'POST') {
      let title = 'مرور درس';
      let jalali_date = '۱۴۰۵/۰۹/۰۷';
      let reminder_time: string | null = null;
      try {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        if (body.title) title = String(body.title);
        if (body.jalali_date) jalali_date = String(body.jalali_date);
        if (body.reminder_time) reminder_time = String(body.reminder_time);
      } catch {
        /* fallback */
      }
      const id = 'task_' + Date.now();
      demoTasks = [{ task_id: id, title, jalali_date, reminder_time, completed: false, completed_at: null }, ...demoTasks];
      return { task_id: id, created: true } as unknown as T;
    }
    return { tasks: demoTasks } as unknown as T;
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
    return {
      terms: [
        { name: 'ترم ۱۴۰۱', lesson_count: 8 },
        { name: 'ترم ۱۴۰۰', lesson_count: 7 },
      ],
    } as unknown as T;
  }
  if (p.includes('/library/lessons/')) {
    return {
      lessons: [
        { _id: 'lesson_cardio', name: 'فیزیوپاتولوژی قلب', teacher: 'دکتر صادقی', term: 'ترم ۱۴۰۱', session_count: 12 },
        { _id: 'lesson_pharma', name: 'فارماکولوژی بالینی', teacher: 'دکتر حسینی', term: 'ترم ۱۴۰۱', session_count: 10 },
      ],
    } as unknown as T;
  }
  if (p.includes('/library/sessions/')) {
    return {
      sessions: [
        { _id: 'sess_1', number: 1, topic: 'الکتروفیزیولوژی و آریتمی‌ها', teacher: 'دکتر صادقی', file_count: 3, logical_id: 'cardio_s1' },
        { _id: 'sess_2', number: 2, topic: 'نارسایی احتقانی قلب', teacher: 'دکتر صادقی', file_count: 2, logical_id: 'cardio_s2' },
      ],
    } as unknown as T;
  }
  if (p.includes('/library/files/')) {
    return {
      files: [
        {
          id: 'pdf_cardio_01',
          name: 'جزوه جلسه ۱ — آریتمی‌های دهلیزی',
          description: 'نسخه کامل با نمودارهای ECG',
          type: 'pdf',
          downloads: 142,
          size: 12582912,
          mime: 'application/pdf',
          preview: true,
        },
      ],
    } as unknown as T;
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
    return { subject: { id: 'subj_1', name: 'کتاب‌های مرجع قلب' }, books: [{ id: 'book_1', name: 'براون‌والد', fa_count: 1, en_count: 1 }] } as unknown as T;
  }
  if (p.includes('/library/book-files/')) {
    return { book: { id: 'book_1', name: 'براون‌والد' }, fa_files: [], en_files: [] } as unknown as T;
  }
  if (p.includes('/library/view-url/')) {
    // ویس دمو واقعاً قابل‌پخش است تا چرخهٔ کامل handoff (صفحه ↔ پیل شناور) QA شود
    if (p.includes('voice_')) {
      const base = import.meta.env.BASE_URL || '/';
      return {
        id: p.split('/').pop() || 'voice_demo',
        name: 'ویس دمو — جلسهٔ آموزشی',
        mime: 'audio/wav',
        size: 384044,
        kind: 'audio',
        available: true,
        url: `${base}demo-voice.wav`,
        expires_in: 600,
      } as unknown as T;
    }
    return { id: 'pdf_cardio_01', name: 'جزوه فیزیوپاتولوژی', mime: 'application/pdf', size: 12582912, kind: 'pdf', available: true, url: '' } as unknown as T;
  }
  if (p.includes('/library/progress/')) {
    if (init?.method === 'PUT') return { ok: true } as unknown as T;
    return { page: 12, total: 48, position: 12, updated_at: 'اکنون' } as unknown as T;
  }

  // 5. Exam Bank & Mock Exams
  if (p.includes('/exam/catalog')) {
    return {
      total_questions: 350,
      active_lessons_count: 2,
      groups: [
        {
          key: 'basic_structural',
          title: 'دروس پایه و ساختاری',
          description: 'آناتومی، بافت‌شناسی، جنین‌شناسی، فیزیولوژی و بیوشیمی',
          lesson_count: 1,
          question_count: 150,
          lessons: [
            {
              id: 'ex_cardio',
              name: 'فیزیولوژی',
              term: '',
              group: 'basic_structural',
              count: 150,
              solved_count: 42,
              accuracy: 87,
              topics_count: 2,
              periods_count: 1,
            },
          ],
        },
        {
          key: 'clinical_extended',
          title: 'علوم تکمیلی و بالینی',
          description: 'پاتولوژی، ژنتیک، تغذیه، فیزیک پزشکی، فارماکولوژی و بالین',
          lesson_count: 1,
          question_count: 200,
          lessons: [
            {
              id: 'ex_pharma',
              name: 'فارماکولوژی',
              term: '',
              group: 'clinical_extended',
              count: 200,
              solved_count: 0,
              accuracy: null,
              topics_count: 1,
              periods_count: 0,
            },
          ],
        },
      ],
      empty_lessons: [],
      periods: [
        {
          key: '1404:shahrivar',
          exam_year: '1404',
          exam_session: 'shahrivar',
          label: 'شهریور ۱۴۰۴',
          count: 85,
          lessons: [
            { lesson_id: 'ex_cardio', lesson: 'فیزیولوژی', count: 45 },
            { lesson_id: 'ex_pharma', lesson: 'فارماکولوژی', count: 40 },
          ],
        },
      ],
      filters: {
        sources: [
          { code: 'konkoor_sarasari', label: 'کنکور سراسری علوم پایه', count: 250 },
          { code: 'hamsyar', label: 'هوشیار (طراحی با AI هامزیار)', count: 100 },
        ],
        years: ['1404', '1403'],
        year_min: '1403',
        year_max: '1404',
        sessions: [{ code: 'shahrivar', label: 'شهریور', count: 85 }],
        difficulties: [
          { code: 'easy', label: 'آسان 🟢', count: 100 },
          { code: 'medium', label: 'متوسط 🟡', count: 180 },
          { code: 'hard', label: 'سخت 🔴', count: 70 },
        ],
      },
      smart_queues: { flagged_count: 1, wrong_count: 12, hard_count: 70 },
    } as unknown as T;
  }
  if (p.includes('/exam/filters')) {
    return {
      sources: [
        { code: 'konkoor_sarasari', label: 'کنکور سراسری علوم پایه', count: 250 },
        { code: 'hamsyar', label: 'هوشیار (طراحی با AI هامزیار)', count: 100 },
      ],
      years: ['1404', '1403'],
      year_min: '1403',
      year_max: '1404',
      sessions: [{ code: 'shahrivar', label: 'شهریور', count: 85 }],
      difficulties: [
        { code: 'easy', label: 'آسان 🟢', count: 100 },
        { code: 'medium', label: 'متوسط 🟡', count: 180 },
        { code: 'hard', label: 'سخت 🔴', count: 70 },
      ],
    } as unknown as T;
  }
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
  if (p.includes('/ink/notebook/')) {
    // دفتر دمو با محتوای واقعی تا پرش به هایلایت/ویس در حالت دمو هم QA شود
    return {
      pages: [
        { page: 2, count: 6, updated_at: '' },
        { page: 5, count: 11, updated_at: '' },
      ],
      highlights: [
        { page: 2, stroke_id: 'demo_hl_1', bbox: [0.1, 0.3, 0.88, 0.37], color: '#F59E0B' },
        { page: 2, stroke_id: 'demo_hl_2', bbox: [0.1, 0.52, 0.8, 0.58], color: '#DC2626' },
        { page: 5, stroke_id: 'demo_hl_3', bbox: [0.12, 0.42, 0.9, 0.48], color: '#16A34A' },
      ],
      notes: [
        {
          note_id: 'demo_note_1',
          page: 2,
          x: 0.82,
          y: 0.12,
          text: 'این بخش در آزمون میان‌ترم زیاد پرسیده شده — قبل از آزمون مرور کن.',
          color: 'yellow',
          created_at: '',
        },
        {
          note_id: 'demo_note_2',
          page: 5,
          x: 0.78,
          y: 0.24,
          text: 'مقایسهٔ حفره‌های بدن را با جدول همین صفحه یاد بگیر.',
          color: 'cyan',
          created_at: '',
        },
      ],
      total: 17,
    } as unknown as T;
  }
  if (p.includes('/ink/voice/')) {
    // یک ویس دمو روی صفحهٔ ۵ — کلیک در دفتر باید به همان پین برسد
    return {
      items: [
        {
          voice_id: 'voice_demo_1',
          file_id: 'demo',
          page: 5,
          x: 0.5,
          y: 0.72,
          duration_ms: 42000,
          mime: 'audio/wav',
          created_at: '',
        },
      ],
    } as unknown as T;
  }
  if (p.includes('/ink/summary/')) {
    return { pages: [], total: 0 } as unknown as T;
  }
  if (p.includes('/ink/sync')) {
    return { processed: 0, successful_ids: [], conflicts: [], server_timestamp: new Date().toISOString() } as unknown as T;
  }

  // 7. Schedule, Grades & Tickets
  if (p.includes('/schedule')) {
    const dates = currentWeekDates();
    return {
      items: [
        {
          id: 'sch_demo_1',
          type: 'class',
          lesson: 'فیزیوپاتولوژی قلب',
          teacher: 'دکتر صادقی',
          date: dates[0],
          time: '۰۸:۰۰',
          end_time: '۱۰:۰۰',
          location: 'تالار ابن‌سینا',
          note: 'مرور نوار قلب پیش از کلاس',
          group: 'گروه الف',
          educational_group: 'گروه الف',
          course_code: 'MED-301',
          term: '14041',
          days_left: 0,
        },
        {
          id: 'sch_demo_2',
          type: 'class',
          lesson: 'فارماکولوژی بالینی',
          teacher: 'دکتر حسینی',
          date: dates[1],
          time: '۱۰:۳۰',
          end_time: '۱۲:۳۰',
          location: 'تالار رازی',
          note: '',
          group: 'گروه الف',
          educational_group: 'گروه الف',
          course_code: 'MED-304',
          term: '14041',
          days_left: 1,
        },
        {
          id: 'sch_demo_3',
          type: 'makeup',
          lesson: 'آسیب‌شناسی عملی',
          teacher: 'دکتر کاظمی',
          date: dates[3],
          time: '۱۴:۰۰',
          end_time: '۱۶:۰۰',
          location: 'آزمایشگاه مرکزی',
          note: 'روپوش سفید الزامی است',
          group: 'گروه الف',
          educational_group: 'گروه الف',
          course_code: 'MED-309',
          term: '14041',
          days_left: 3,
        },
        {
          id: 'sch_demo_4',
          type: 'exam',
          lesson: 'آزمون میان‌ترم قلب',
          teacher: 'دکتر صادقی',
          date: dates[5],
          time: '۱۰:۰۰',
          end_time: '۱۱:۳۰',
          location: 'سالن امتحانات',
          note: 'مبحث آریتمی‌ها',
          group: 'گروه الف',
          educational_group: 'گروه الف',
          course_code: 'MED-301',
          term: '14041',
          days_left: 5,
        },
      ],
      has_custom_selection: false,
      selected_count: 4,
      total_offered_count: 6,
      computed_group: 'گروه الف',
      educational_group: 'گروه الف',
      conflicts: [],
      term: '14041',
    } as unknown as T;
  }
  if (p.includes('/grades/summary') || p.includes('/grades')) {
    return {
      cumulative_gpa: 17.85,
      total_credits: 42,
      passed_credits: 42,
      failed_credits: 0,
      semesters: [
        {
          term_label: 'نیم‌سال اول ۱۴۰۳–۱۴۰۴',
          term_gpa: 18.12,
          credits: 21,
          courses: [
            { course_id: 'c_1', name: 'فیزیوپاتولوژی قلب', credits: 4, score: 18.5, normalized_score: 18.5, passed: true },
            { course_id: 'c_2', name: 'فارماکولوژی بالینی', credits: 3, score: 17.75, normalized_score: 17.75, passed: true },
          ],
        },
        {
          term_label: 'نیم‌سال دوم ۱۴۰۲–۱۴۰۳',
          term_gpa: 17.58,
          credits: 21,
          courses: [
            { course_id: 'c_3', name: 'آسیب‌شناسی عمومی', credits: 4, score: 17.5, normalized_score: 17.5, passed: true },
            { course_id: 'c_4', name: 'میکروب‌شناسی پزشکی', credits: 3, score: 17.7, normalized_score: 17.7, passed: true },
          ],
        },
      ],
    } as unknown as T;
  }
  if (p.includes('/tickets')) {
    const cleanPath = path.split('?')[0];
    if (p.endsWith('/reply') && method === 'POST') {
      const idNum = Number(cleanPath.split('/').slice(-2, -1)[0]);
      let msg = '';
      try {
        msg = String((init?.body ? JSON.parse(String(init.body)) : {}).message || '').trim();
      } catch {
        /* ignore */
      }
      demoTickets = demoTickets.map((t) =>
        t.id === idNum
          ? {
              ...t,
              status: 'open',
              reply_count: t.reply_count + 1,
              replies: [...t.replies, { text: msg || 'پیام جدید', sender: 'user', at: new Date().toISOString() }],
            }
          : t,
      );
      return { ok: true } as unknown as T;
    }
    const idMatch = cleanPath.match(/\/tickets\/(\d+)$/);
    if (idMatch && method === 'GET') {
      const idNum = Number(idMatch[1]);
      const found = demoTickets.find((t) => t.id === idNum) || demoTickets[0];
      return { ticket: found } as unknown as T;
    }
    if (method === 'POST') {
      let subject = 'پشتیبانی';
      let message = '';
      try {
        const parsed = init?.body ? JSON.parse(String(init.body)) : {};
        if (parsed.subject) subject = String(parsed.subject);
        if (parsed.message) message = String(parsed.message);
      } catch {
        /* ignore */
      }
      const nextId = Math.max(1042, ...demoTickets.map((t) => t.id)) + 1;
      demoTickets = [
        {
          id: nextId,
          subject,
          status: 'open',
          created_at: new Date().toISOString(),
          reply_count: 0,
          priority: 'normal',
          message,
          replies: [],
        },
        ...demoTickets,
      ];
      return { ok: true, ticket_id: nextId } as unknown as T;
    }
    return {
      tickets: demoTickets.map(({ message: _m, replies: _r, ...summary }) => summary),
      subjects: ['محتوای درسی و جزوه', 'اشتراک و پرداخت', 'آزمون و کارنامه', 'مشکل فنی'],
    } as unknown as T;
  }

  // 8. AI
  if (p.includes('/ai/status')) {
    return {
      enabled: true,
      banned: false,
      daily_limit: 50,
      used_today: 8,
      remaining: 42,
      unlimited: false,
      disabled_message: '',
      max_input_chars: 2000,
      capabilities: { text: true, image: true, pdf: true, audio: false },
    } as unknown as T;
  }
  if (p.includes('/ai/conversations/') && p.includes('/messages')) {
    return {
      messages: [
        { role: 'user', text: 'تفاوت فیبریلاسیون دهلیزی و فلوتر دهلیزی در نوار قلب چیست؟', at: new Date(Date.now() - 3_600_000).toISOString(), index: 0 },
        { role: 'assistant', text: 'در **فیبریلاسیون دهلیزی (AF)** موج P مشخص حذف می‌شود و ریتم به‌صورت نامنظم (irregularly irregular) است؛ در **فلوتر دهلیزی** امواج دندانه‌دار مشخص با بسامد حدود ۳۰۰ در دقیقه دیده می‌شود.', at: new Date(Date.now() - 3_590_000).toISOString(), index: 1 },
      ],
      total: 2,
      has_more: false,
    } as unknown as T;
  }
  if (p.includes('/ai/conversations')) {
    if (method === 'POST') return { id: 'conv_demo_' + Date.now() } as unknown as T;
    if (method === 'PATCH' || method === 'DELETE') return { ok: true } as unknown as T;
    return {
      conversations: [
        {
          id: 'conv_demo_1',
          title: 'مقایسه AF و فلوتر دهلیزی',
          pinned: true,
          preview: 'در فیبریلاسیون دهلیزی موج P مشخص حذف می‌شود...',
          count: 2,
          created_at: new Date(Date.now() - 3_600_000).toISOString(),
          updated_at: new Date(Date.now() - 3_590_000).toISOString(),
        },
        {
          id: 'conv_demo_2',
          title: 'الگوریتم درمان هیپوناترمی',
          pinned: false,
          preview: 'ابتدا اسمولالیته پلاسما و وضعیت حجمی بیمار ارزیابی می‌شود.',
          count: 4,
          created_at: new Date(Date.now() - 86_400_000).toISOString(),
          updated_at: new Date(Date.now() - 86_000_000).toISOString(),
        },
      ],
      total: 2,
      has_more: false,
    } as unknown as T;
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

  return undefined;
}

/** Demo login code (only for local development). */
export function isDemoCode(input: string): boolean {
  if (!input) return false;
  const faDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  const arDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  let s = input.trim();
  for (let i = 0; i < 10; i++) {
    s = s.split(faDigits[i]).join(String(i)).split(arDigits[i]).join(String(i));
  }
  const clean = s.toUpperCase().replace(/[^0-9A-Z]/g, '');
  return (
    clean === '7K9M2P4X' ||
    clean === 'HY7K9M2P4X' ||
    clean.includes('7K9M2P4X') ||
    clean === 'DEMO' ||
    clean === 'HYDEMO' ||
    clean.startsWith('DEMO')
  );
}

/** Is this request in demo mode? (active local demo, or a demo action in the path/body) */
export function isDemoRequest(path: string, init?: RequestInit): boolean {
  const body = init?.body ? String(init.body) : '';
  return isDemoModeActive() || path.includes('demo') || body.includes('7K9M') || body.includes('DEMO');
}
