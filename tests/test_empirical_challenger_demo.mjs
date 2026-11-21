/**
 * EMPIRICAL CHALLENGER TEST SUITE: Demo Mode, Auth Permutations, and Mock Endpoints
 * Target: humsyar-student web app
 */

import http from 'node:http';

// ── 1. Replicate exact logic from LoginScreen.tsx ──
function isDemoCode(input) {
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

function formatCrockfordCode(raw) {
  const faDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  const arDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  let s = raw.trim();
  for (let i = 0; i < 10; i++) {
    s = s.split(faDigits[i]).join(String(i)).split(arDigits[i]).join(String(i));
  }
  s = s.toUpperCase().replace(/\s+/g, '');

  let clean;
  if (s.startsWith('HY-')) {
    clean = s.slice(3).replace(/[^0-9A-Z]/g, '');
  } else {
    const unhyphenated = s.replace(/[^0-9A-Z]/g, '');
    if (unhyphenated.startsWith('HY') && unhyphenated.length > 8) {
      clean = unhyphenated.slice(2);
    } else {
      clean = unhyphenated;
    }
  }

  clean = clean.replace(/[IL]/g, '1').replace(/O/g, '0').replace(/U/g, 'V');
  clean = clean.slice(0, 8);
  if (clean.length === 0) return '';
  if (clean.length <= 4) return 'HY-' + clean;
  return 'HY-' + clean.slice(0, 4) + '-' + clean.slice(4);
}

// ── 2. Import mockData and simulate getMockResponse from api.ts ──
import {
  MOCK_USER,
  MOCK_DASHBOARD,
  MOCK_WEEKLY,
  MOCK_SUBSCRIPTION,
  MOCK_CONTINUE_ITEMS,
  MOCK_STUDY_TASKS,
  MOCK_TERMS,
  MOCK_LESSONS,
  MOCK_SESSIONS,
  MOCK_FILES,
  MOCK_SUBJECTS,
  MOCK_BOOKS,
  MOCK_EXAM_LESSONS,
  MOCK_QUESTION_HISTORY,
  MOCK_EXAM_SUMMARIES,
  MOCK_NEXT_QUESTION,
  MOCK_NOTES,
  MOCK_SCHEDULE,
  MOCK_GRADES,
} from '../apps/student/src/lib/mockData.ts';

function getMockResponse(path, init) {
  const p = path.toLowerCase();

  // 1. Auth & Session
  if (p.includes('/auth/session')) {
    return { authenticated: true, state: 'active', user: MOCK_USER };
  }
  if (p.includes('/auth/config')) {
    return { otp_length: 6, otp_ttl_sec: 300, resend_in: 60, session_days: 30, channels: ['telegram'], support_url: null };
  }
  if (p.includes('/challenge/create') || p.includes('/auth/start')) {
    return { challenge_id: 'ch_demo_active', status: 'approved', expires_in_seconds: 180, display_code: '7K9M' };
  }
  if (p.includes('/challenge/') || p.includes('/fallback/verify') || p.includes('/auth/verify')) {
    return { status: 'approved', authenticated: true, user: MOCK_USER };
  }
  if (p.includes('/sessions')) {
    return { sessions: [{ session_id: 'sess_demo_1', device_name: 'مرورگر وب (آزمایشی ویندوز)', ip_address: '127.0.0.1', is_current: true, created_at: '۱۴۰۵/۰۸/۲۱ ۱۰:۰۰', last_active: 'اکنون' }] };
  }
  if (p.includes('/logout')) {
    return { ok: true };
  }

  // 2. Dashboard
  if (p.includes('/dashboard/weekly')) return MOCK_WEEKLY;
  if (p.includes('/dashboard/leaderboard')) {
    return { leaderboard: [{ rank: 1, name: 'سارا محمدی', correct: 285, total: 310, percent: 92, is_me: false }] };
  }
  if (p.includes('/dashboard')) return MOCK_DASHBOARD;
  if (p.includes('/subscription/status') || p.includes('/subscription')) return MOCK_SUBSCRIPTION;

  // 3. Reader & Schedule Tasks
  if (p.includes('/library/continue')) return { items: MOCK_CONTINUE_ITEMS };
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
        url: `data:image/svg+xml;utf8,<svg></svg>`,
      })),
    };
  }
  if (p.includes('/schedule/items')) {
    if (p.includes('/toggle')) {
      return { task_id: 'task_toggle', completed: true, completed_at: '۱۴۰۵/۰۸/۲۱' };
    }
    if (init?.method === 'POST') {
      return { task_id: 'task_' + Date.now(), created: true };
    }
    return { tasks: MOCK_STUDY_TASKS };
  }

  // 4. Library & Search
  if (p.includes('/library/state')) {
    return { resources: { allowed: true, code: null, message: '' }, references: { allowed: true, code: null, message: '' }, intake: '1401', group: 'گروه الف (فیزیوپاتولوژی)' };
  }
  if (p.includes('/library/terms')) return { terms: MOCK_TERMS };
  if (p.includes('/library/lessons/')) return { lessons: MOCK_LESSONS };
  if (p.includes('/library/sessions/')) return { sessions: MOCK_SESSIONS };
  if (p.includes('/library/files/')) return { files: MOCK_FILES };
  if (p.includes('/library/search') || p.includes('/search?') || p.startsWith('/search') || p.includes('/api/search')) {
    if (p.includes('/library/search')) return { results: MOCK_FILES };
    return { results: { resources: [], questions: [], schedules: [], books: [] }, query: 'قلب' };
  }
  if (p.includes('/library/subjects')) return { subjects: MOCK_SUBJECTS };
  if (p.includes('/library/books/')) return { subject: { id: 'subj_cardio', name: 'کتب مرجع قلب' }, books: MOCK_BOOKS };
  if (p.includes('/library/book-files/')) {
    return {
      book: { id: 'book_katzung', name: 'فارماکولوژی کاتزونگ' },
      fa_files: [{ id: 'ref_1', lang: 'fa', volume: 1, description: 'جلد اول', downloads: 10, mime: 'application/pdf', size: 1000, preview: true }],
      en_files: [{ id: 'ref_en', lang: 'en', volume: 1, description: 'Vol 1', downloads: 5, mime: 'application/pdf', size: 2000, preview: true }],
    };
  }
  if (p.includes('/library/view-url/')) {
    return { id: 'pdf_cardio_01', name: 'جزوه فیزیوپاتولوژی قلب', mime: 'application/pdf', size: 12582912, kind: 'pdf', available: true, url: '' };
  }
  if (p.includes('/library/progress/')) {
    if (init?.method === 'PUT') return { ok: true };
    return { page: 24, total: 86, position: 24, updated_at: 'اکنون' };
  }

  // 5. Exam Bank & Mock Exams
  if (p.includes('/exam/lessons')) return { lessons: MOCK_EXAM_LESSONS };
  if (p.includes('/exam/topics/')) {
    return { lesson_id: 'ex_cardio', topics: [{ id: 'top_1', name: 'آریتمی‌های قلبی', count: 45 }] };
  }
  if (p.includes('/exam/stats')) {
    return { attempts: 248, solved_unique: 216, correct: 216, wrong: 32, accuracy: 87, weak_topics: [], topics: [] };
  }
  if (p.includes('/exam/flag/')) return { question_id: 'q_seed_1', flagged: true };
  if (p.includes('/exam/flagged')) return { flagged_ids: ['q_seed_1'] };
  if (p.includes('/exam/mock/preview')) {
    return { requested_count: 20, available_count: 50, can_start: true, max_count: 50, minutes: 20, output_mode: 'standard', taxonomy: {} };
  }
  if (p.includes('/exam/mock/start')) {
    return { session_id: 'mock_sess_active', lesson: 'قلب', topic: 'جامع', status: 'active', total: 20, answered: 0, correct: 0, percentage: 0, current_index: 0, minutes: 20, deadline: new Date().toISOString(), started_at: new Date().toISOString(), finished_at: null, exam_code: 'CARDIO-20', requested_count: 20, actual_count: 20 };
  }
  if (p.includes('/exam/mock/active') || p.includes('/exam/active')) return { active: false, exam: null };
  if (p.includes('/exam/mock/history')) return { exams: MOCK_EXAM_SUMMARIES, total: MOCK_EXAM_SUMMARIES.length };
  if (p.includes('/exam/mock/') && p.includes('/next')) {
    return { finished: false, question: MOCK_NEXT_QUESTION.question, progress: 1, total: 20, seconds_left: 1180, session_id: 'mock_sess_active' };
  }
  if (p.includes('/exam/mock/') && p.includes('/answer')) {
    return { accepted: true, progress: 2, total: 20, finished: false, session_id: 'mock_sess_active', result: { answered: 2, correct: 2, percentage: 100 } };
  }
  if (p.includes('/exam/mock/') && p.includes('/abandon')) return { ok: true };
  if (p.includes('/exam/mock/') && p.includes('/review')) {
    return {
      session_id: 'mock_sess_1',
      lesson: 'قلب',
      topic: 'آریتمی',
      status: 'finished',
      total: 20,
      answered: 20,
      correct: 18,
      percentage: 90,
      current_index: 20,
      minutes: 20,
      deadline: null,
      started_at: '2026-11-09T08:00:00Z',
      finished_at: '2026-11-09T08:18:30Z',
      exam_code: 'CARDIO-MOCK-20',
      requested_count: 20,
      actual_count: 20,
      review: [{ question_id: 'q_seed_1', selected: 0, correct_answer: 0, is_correct: true, answered_at: '2026-11-09T08:05:00Z', question: 'درمان اولیه دارویی در ACS چیست؟', options: ['A', 'B'], topic: 'قلب', explanation: 'توضیح' }],
    };
  }
  if (p.includes('/exam/mock/')) {
    return { session_id: 'mock_sess_1', lesson: 'قلب', topic: 'آریتمی', status: 'finished', total: 20, answered: 20, correct: 18, percentage: 90, current_index: 20, minutes: 20, deadline: null, started_at: '2026-11-09T08:00:00Z', finished_at: '2026-11-09T08:18:30Z', exam_code: 'CARDIO-MOCK-20', requested_count: 20, actual_count: 20 };
  }
  if (p.includes('/exam/history')) {
    return { answers: MOCK_QUESTION_HISTORY, total: MOCK_QUESTION_HISTORY.length, limit: 50, has_more: false, next_cursor: null };
  }
  if (p.includes('/exam/next')) return MOCK_NEXT_QUESTION;
  if (p.includes('/exam/answer')) {
    return { is_correct: true, correct_answer: 0, explanation: 'پاسخ صحیح گزینه ۱ است.', prestige: { xp_gained: 25, streak: 13 } };
  }

  // 6. Notes & Ink
  if (p.includes('/ink/notes') || p.includes('/notes')) return { items: MOCK_NOTES };
  if (p.includes('/ink/strokes/')) return { strokes: [], count: 0 };

  // 7. Schedule & Grades
  if (p.includes('/schedule')) return { items: MOCK_SCHEDULE };
  if (p.includes('/grades/summary') || p.includes('/grades')) return MOCK_GRADES;

  return undefined;
}

// ── Run Tests ──
async function runAll() {
  console.log('====================================================');
  console.log(' EMPIRICAL CHALLENGER TEST SUITE: DEMO AUTH & MOCKS');
  console.log('====================================================\n');

  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;

  function assert(name, condition, extra = '') {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`[PASS] ${name}`);
    } else {
      failedTests++;
      console.log(`[FAIL] ${name} ${extra}`);
    }
  }

  // ── PHASE 1: isDemoCode Permutations ──
  console.log('--- Phase 1: isDemoCode Permutations ---');
  const positivePermutations = [
    '7K9M-2P4X',
    '7k9m2p4x',
    '  7k9m-2p4x  ',
    '۷k۹m-۲p۴x',
    'HY-7K9M-2P4X',
    'DEMO',
    'demo',
    'HYDEMO',
    'HY-7k9m-2p4x',
    '۷K۹M-۲P۴X',
    'DEMO-TEST',
    '7K9M2P4X',
    'hy-7k9m2p4x',
  ];

  for (const perm of positivePermutations) {
    assert(`isDemoCode accepts: ${JSON.stringify(perm)}`, isDemoCode(perm) === true);
  }

  const negativePermutations = [
    '',
    '   ',
    '12345678',
    'random string',
    'HY-1234-5678',
    '٠١٢٣٤٥٦٧',
    'NOTDEMO',
    'ADMIN',
    'STUDENT',
  ];

  for (const perm of negativePermutations) {
    assert(`isDemoCode rejects: ${JSON.stringify(perm)}`, isDemoCode(perm) === false);
  }

  // ── PHASE 2: formatCrockfordCode Interaction (Adversarial stress) ──
  console.log('\n--- Phase 2: Crockford Formatter Interaction ---');
  // When typing 7K9M-2P4X, formatCrockfordCode outputs HY-7K9M-2P4X, which passes isDemoCode
  const formattedDemo = formatCrockfordCode('7K9M-2P4X');
  assert(`formatCrockfordCode('7K9M-2P4X') produces valid code: ${formattedDemo}`, isDemoCode(formattedDemo) === true);

  // When typing Persian 7K9M2P4X, formatCrockfordCode outputs HY-7K9M-2P4X
  const formattedPersian = formatCrockfordCode('۷k۹m-۲p۴x');
  assert(`formatCrockfordCode('۷k۹m-۲p۴x') produces valid code: ${formattedPersian}`, isDemoCode(formattedPersian) === true);

  // Notice the adversary finding: typing DEMO into formatCrockfordCode turns into HY-DEM0 (O replaced with 0)
  const formattedWordDemo = formatCrockfordCode('DEMO');
  console.log(`[ADVERSARIAL PROBE] formatCrockfordCode('DEMO') => "${formattedWordDemo}"`);
  console.log(`[ADVERSARIAL PROBE] isDemoCode("${formattedWordDemo}") => ${isDemoCode(formattedWordDemo)}`);

  // ── PHASE 3: All 7 Views Endpoint Schema & Completeness ──
  console.log('\n--- Phase 3: All 7 Views Mock Endpoint Coverage & Schema ---');

  const endpointTests = [
    // 1. Session / Auth
    {
      name: 'Auth Session',
      path: '/auth/session',
      verify: (res) => res.authenticated === true && res.user && res.user.name === 'دکتر علی رضایی',
    },
    {
      name: 'Auth Config',
      path: '/auth/config',
      verify: (res) => res.otp_length === 6 && Array.isArray(res.channels),
    },
    {
      name: 'Challenge Create',
      path: '/api/web-auth/challenge/create',
      verify: (res) => res.challenge_id && res.display_code,
    },
    {
      name: 'Sessions List',
      path: '/api/web-auth/sessions',
      verify: (res) => Array.isArray(res.sessions) && res.sessions.length > 0 && res.sessions[0].session_id,
    },

    // 2. Dashboard
    {
      name: 'Dashboard Overview',
      path: '/dashboard',
      verify: (res) =>
        res.user.display_name &&
        res.stats.accuracy === 87 &&
        Array.isArray(res.upcoming_exams) &&
        res.upcoming_exams.length === 3 &&
        res.prestige.xp === 1420,
    },
    {
      name: 'Dashboard Weekly Activity',
      path: '/dashboard/weekly',
      verify: (res) => Array.isArray(res.weekly) && res.weekly.length === 7 && res.weekly[0].count > 0,
    },
    {
      name: 'Dashboard Leaderboard',
      path: '/dashboard/leaderboard',
      verify: (res) => Array.isArray(res.leaderboard) && res.leaderboard.length > 0 && res.leaderboard[0].percent,
    },
    {
      name: 'Subscription Status',
      path: '/subscription/status',
      verify: (res) => res.active === true && res.days_left > 0 && res.plan_name,
    },

    // 3. Reader & Continue
    {
      name: 'Library Continue Items',
      path: '/library/continue',
      verify: (res) => Array.isArray(res.items) && res.items.length > 0 && res.items[0].name && res.items[0].page,
    },
    {
      name: 'Reader Manifest (24 pages DRM WebP/SVG)',
      path: '/reader/manifest/res/pdf_cardio_01',
      verify: (res) =>
        res.file_id === 'pdf_cardio_01' &&
        res.total_pages === 24 &&
        Array.isArray(res.page_dimensions) &&
        res.page_dimensions.length === 24 &&
        res.page_dimensions[0].url.startsWith('data:image/svg+xml'),
    },
    {
      name: 'Reading Progress GET',
      path: '/library/progress/res/pdf_cardio_01',
      verify: (res) => res.page === 24 && res.total === 86,
    },
    {
      name: 'Reading Progress PUT',
      path: '/library/progress/res/pdf_cardio_01',
      init: { method: 'PUT', body: JSON.stringify({ page: 25 }) },
      verify: (res) => res.ok === true,
    },

    // 4. Library & Catalog
    {
      name: 'Library State',
      path: '/library/state',
      verify: (res) => res.resources.allowed === true && res.intake === '1401',
    },
    {
      name: 'Library Terms',
      path: '/library/terms',
      verify: (res) => Array.isArray(res.terms) && res.terms.length > 0 && res.terms[0].name,
    },
    {
      name: 'Library Lessons by Term',
      path: '/library/lessons/term_5',
      verify: (res) => Array.isArray(res.lessons) && res.lessons.length > 0 && res.lessons[0].name,
    },
    {
      name: 'Library Sessions by Lesson',
      path: '/library/sessions/les_cardio',
      verify: (res) => Array.isArray(res.sessions) && res.sessions.length > 0 && res.sessions[0].number,
    },
    {
      name: 'Library Files by Session',
      path: '/library/files/sess_1',
      verify: (res) => Array.isArray(res.files) && res.files.length > 0 && res.files[0].size,
    },
    {
      name: 'Library Search',
      path: '/library/search?q=cardio',
      verify: (res) => Array.isArray(res.results),
    },
    {
      name: 'Global Search',
      path: '/search?q=heart',
      verify: (res) => res.results && Array.isArray(res.results.resources) && res.query,
    },
    {
      name: 'Library Subjects',
      path: '/library/subjects',
      verify: (res) => Array.isArray(res.subjects) && res.subjects.length > 0 && res.subjects[0].id,
    },
    {
      name: 'Library Books by Subject',
      path: '/library/books/subj_cardio',
      verify: (res) => res.subject.name && Array.isArray(res.books) && res.books.length > 0,
    },
    {
      name: 'Library Book Files (Crash Prevention Shape)',
      path: '/library/book-files/book_katzung',
      verify: (res) =>
        res.book.name &&
        Array.isArray(res.fa_files) &&
        res.fa_files.length > 0 &&
        Array.isArray(res.en_files) &&
        res.en_files.length > 0,
    },
    {
      name: 'Library View URL',
      path: '/library/view-url/res/pdf_cardio_01',
      verify: (res) => res.available === true && res.mime === 'application/pdf',
    },

    // 5. Exam Bank & Mock Exams
    {
      name: 'Exam Lessons Taxonomy',
      path: '/exam/lessons',
      verify: (res) => Array.isArray(res.lessons) && res.lessons.length > 0 && res.lessons[0].count > 0,
    },
    {
      name: 'Exam Topics by Lesson',
      path: '/exam/topics/ex_cardio',
      verify: (res) => res.lesson_id === 'ex_cardio' && Array.isArray(res.topics) && res.topics.length > 0,
    },
    {
      name: 'Exam Stats',
      path: '/exam/stats',
      verify: (res) => res.attempts === 248 && res.accuracy === 87,
    },
    {
      name: 'Exam Flag Question',
      path: '/exam/flag/q_seed_1',
      verify: (res) => res.question_id === 'q_seed_1' && res.flagged === true,
    },
    {
      name: 'Exam Flagged Question IDs',
      path: '/exam/flagged',
      verify: (res) => Array.isArray(res.flagged_ids) && res.flagged_ids.includes('q_seed_1'),
    },
    {
      name: 'Mock Exam Preview',
      path: '/exam/mock/preview',
      verify: (res) => res.can_start === true && res.requested_count === 20,
    },
    {
      name: 'Mock Exam Start',
      path: '/exam/mock/start',
      verify: (res) => res.session_id === 'mock_sess_active' && res.status === 'active' && res.total === 20,
    },
    {
      name: 'Mock Exam Active Session Check',
      path: '/exam/mock/active',
      verify: (res) => res.active === false && res.exam === null,
    },
    {
      name: 'Mock Exam History List',
      path: '/exam/mock/history',
      verify: (res) => Array.isArray(res.exams) && res.total > 0 && res.exams[0].percentage >= 90,
    },
    {
      name: 'Mock Exam Next Question',
      path: '/exam/mock/sess_active/next',
      verify: (res) => res.finished === false && res.question && res.question.options.length === 4,
    },
    {
      name: 'Mock Exam Answer Submission',
      path: '/exam/mock/sess_active/answer',
      verify: (res) => res.accepted === true && res.result.percentage === 100,
    },
    {
      name: 'Mock Exam Review (Completed Exam)',
      path: '/exam/mock/sess_1/review',
      verify: (res) =>
        res.status === 'finished' &&
        res.percentage === 90 &&
        Array.isArray(res.review) &&
        res.review.length > 0 &&
        res.review[0].question,
    },
    {
      name: 'Exam Question History (All Answers)',
      path: '/exam/history',
      verify: (res) => Array.isArray(res.answers) && res.total > 0 && res.answers[0].question && res.answers[0].is_correct !== undefined,
    },
    {
      name: 'Practice Quiz Next Question',
      path: '/exam/next',
      verify: (res) => res.question && Array.isArray(res.question.options) && res.question.options.length === 4,
    },
    {
      name: 'Practice Quiz Answer Check',
      path: '/exam/answer',
      verify: (res) => res.is_correct === true && res.correct_answer === 0 && res.explanation,
    },

    // 6. Digital Ink Notes
    {
      name: 'Ink Notes List',
      path: '/ink/notes',
      verify: (res) => Array.isArray(res.items) && res.items.length > 0 && res.items[0].strokes > 0,
    },
    {
      name: 'Ink Strokes for Page',
      path: '/ink/strokes/res/pdf_cardio_01/1',
      verify: (res) => Array.isArray(res.strokes) && res.count === 0,
    },

    // 7. Schedule & Grades
    {
      name: 'University Timetable Schedule',
      path: '/schedule?days=7',
      verify: (res) => Array.isArray(res.items) && res.items.length > 0 && res.items[0].lesson,
    },
    {
      name: 'Personal Study Tasks List (Jalali)',
      path: '/schedule/items',
      verify: (res) => Array.isArray(res.tasks) && res.tasks.length > 0 && res.tasks[0].jalali_date,
    },
    {
      name: 'Personal Study Task Toggle',
      path: '/schedule/items/task_1/toggle',
      verify: (res) => res.completed === true && res.completed_at,
    },
    {
      name: 'Academic Transcript Grades Summary (Weighted GPA)',
      path: '/grades/summary',
      verify: (res) =>
        res.cumulative_gpa === 17.85 &&
        res.total_credits === 96 &&
        Array.isArray(res.semesters) &&
        res.semesters.length > 0 &&
        Array.isArray(res.semesters[0].courses) &&
        res.semesters[0].courses[0].name,
    },
  ];

  for (const tc of endpointTests) {
    const res = getMockResponse(tc.path, tc.init);
    if (!res) {
      console.log(`[DEBUG] ${tc.path} returned undefined!`);
    }
    let valid = false;
    let errMsg = '';
    try {
      valid = Boolean(tc.verify(res));
      if (!valid) errMsg = 'verify returned false';
    } catch (e) {
      valid = false;
      errMsg = e.message || String(e);
    }
    if (!valid) {
      console.log(`[DEBUG FAIL] ${tc.name} (${tc.path}) -> res:`, res, 'error:', errMsg);
    }
    assert(`Mock Endpoint: ${tc.name} (${tc.path})`, valid === true, errMsg);
  }

  // ── PHASE 4: Live HTTP Server Check (http://127.0.0.1:5173/student/) ──
  console.log('\n--- Phase 4: Live HTTP Dev Server Check ---');
  await new Promise((resolve) => {
    http
      .get('http://127.0.0.1:5173/student/', (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          assert('Live Dev Server HTTP Status 200', res.statusCode === 200, `Got: ${res.statusCode}`);
          assert('Index HTML contains root mount point', data.includes('<div id="root"></div>'));
          assert('Index HTML loads main.tsx entrypoint', data.includes('/student/src/main.tsx'));
          resolve();
        });
      })
      .on('error', (err) => {
        assert('Live Dev Server reachable on 127.0.0.1:5173', false, err.message);
        resolve();
      });
  });

  // Check main.tsx bundle serving
  await new Promise((resolve) => {
    http
      .get('http://127.0.0.1:5173/student/src/main.tsx', (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          assert('Vite transpiles and serves main.tsx (Status 200)', res.statusCode === 200);
          assert('main.tsx contains React mount logic', data.includes('createRoot'));
          resolve();
        });
      })
      .on('error', (err) => {
        assert('main.tsx reachable', false, err.message);
        resolve();
      });
  });

  console.log('\n====================================================');
  console.log(`RESULTS: ${passedTests}/${totalTests} PASSED. (Failed: ${failedTests})`);
  console.log('====================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAll().catch((err) => {
  console.error('Unhandled test suite failure:', err);
  process.exit(1);
});
