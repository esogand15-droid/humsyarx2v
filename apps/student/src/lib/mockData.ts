/* ═══════════════════════════════════════════════════════════════════
   داده‌های نمونه و کامل پزشکی هامزیار (Medical AI Seed Data)
   جهت تست محلی، تعاملی و بررسی تک‌تک بخش‌ها بدون وابستگی به دیتابیس خارجی
   ═══════════════════════════════════════════════════════════════════ */

import type { PublicUser } from './api';
import type { DashboardPayload, SubscriptionStatus, WeeklyActivity } from './dashboard';
import type { HistoryItem, LessonItem as ExamLessonItem, MockSummary, NextPayload } from './exam';
import type { GradesSummaryPayload } from './grades';
import type { NoteItem } from './ink';
import type { BookItem, ContentFile, LessonItem, SessionItem, SubjectItem, TermItem } from './library';
import type { ContinueItem } from './reader';
import type { ScheduleItem, StudyTask } from './schedule';

export const MOCK_USER: PublicUser = {
  id: 99999999,
  name: 'دکتر علی رضایی',
  username: 'ali_rezaei',
  student_id: '401123456',
  group: 'گروه الف (فیزیوپاتولوژی)',
  intake: '1401',
  role: 'student',
  registered_at: '1401/07/01',
};

export const MOCK_DASHBOARD: DashboardPayload = {
  user: {
    name: 'دکتر علی رضایی',
    nickname: 'علی',
    display_name: 'دکتر علی رضایی',
    intake: '1401',
    group: 'گروه الف (فیزیوپاتولوژی)',
    role: 'student',
    student_id: '401123456',
  },
  stats: {
    total_answers: 248,
    correct_answers: 216,
    accuracy: 87,
    streak_days: 12,
    weak_topics: [
      'فارماکولوژی بتا بلاکرها',
      'الکترولیت‌های پاتوفیزیولوژی کلیه',
      'آریتمی‌های قلبی (AF و VT)',
    ],
  },
  upcoming_exams: [
    {
      id: 'exam_1',
      lesson: 'فارماکولوژی بالینی',
      date: '1405-08-24',
      time: '09:00',
      days_left: 3,
      course_code: 'MED-502',
      teacher: 'دکتر حسینی',
      location: 'تالار ۱ دانشکده پزشکی',
    },
    {
      id: 'exam_2',
      lesson: 'فیزیوپاتولوژی قلب و عروق',
      date: '1405-08-27',
      time: '10:30',
      days_left: 6,
      course_code: 'MED-501',
      teacher: 'دکتر صادقی',
      location: 'تالار رازی',
    },
    {
      id: 'exam_3',
      lesson: 'پاتولوژی عمومی و اختصاصی',
      date: '1405-09-02',
      time: '11:00',
      days_left: 11,
      course_code: 'MED-504',
      teacher: 'دکتر کاظمی',
      location: 'دانشکده پزشکی',
    },
  ],
  open_tickets: 0,
  prestige: {
    xp: 1420,
    level: 8,
    level_title: 'رزیدنت پرتلاش',
    rank: 'رتبه ۱۲ دانشکده',
    streak: { current: 12, best: 24 },
    exams_completed: 18,
    downloads_count: 42,
  },
};

export const MOCK_WEEKLY: WeeklyActivity = {
  weekly: [
    { date: '1405-08-15', day: 'sat', count: 14 },
    { date: '1405-08-16', day: 'sun', count: 22 },
    { date: '1405-08-17', day: 'mon', count: 18 },
    { date: '1405-08-18', day: 'tue', count: 35 },
    { date: '1405-08-19', day: 'wed', count: 28 },
    { date: '1405-08-20', day: 'thu', count: 40 },
    { date: '1405-08-21', day: 'fri', count: 19 },
  ],
};

export const MOCK_SUBSCRIPTION: SubscriptionStatus = {
  active: true,
  days_left: 180,
  plan_name: 'اشتراک ویژه هوش‌یار (VIP)',
  expires: '2027-05-10',
  resource_access: true,
  enforced: true,
};

export const MOCK_CONTINUE_ITEMS: ContinueItem[] = [
  {
    scope: 'res',
    id: 'pdf_cardio_01',
    name: 'جزوه فیزیوپاتولوژی قلب — آریتمی‌ها و انفارکتوس میوکارد',
    kind: 'pdf',
    page: 24,
    total: 86,
    position: 24,
    percent: 38,
    updated_at: '۱۰ دقیقه پیش',
  },
  {
    scope: 'res',
    id: 'pdf_pharma_01',
    name: 'خلاصه فارماکولوژی کاتزونگ — داروهای کاهنده فشار خون و اینوتروپ',
    kind: 'pdf',
    page: 12,
    total: 50,
    position: 12,
    percent: 24,
    updated_at: 'دیروز',
  },
  {
    scope: 'res',
    id: 'pdf_preintern_01',
    name: 'سؤالات منتخب آزمون جامع علوم پایه با پاسخ تشریحی هوش‌یار',
    kind: 'pdf',
    page: 5,
    total: 32,
    position: 5,
    percent: 16,
    updated_at: '۳ روز پیش',
  },
];

export const MOCK_STUDY_TASKS: StudyTask[] = [
  {
    task_id: 'task_1',
    title: 'مرور مکانیسم اثر نیتروگلیسیرین و بتابلاکرها در آنژین پایدار',
    jalali_date: '۱۴۰۵/۰۸/۲۱',
    reminder_time: '۱۶:۰۰',
    completed: true,
    completed_at: '۱۴۰۵/۰۸/۲۱ ۱۰:۳۰',
  },
  {
    task_id: 'task_2',
    title: 'حل ۲۰ تست مروری از مبحث تغییرات نوار قلب (ECG) در هایپوکالمی',
    jalali_date: '۱۴۰۵/۰۸/۲۱',
    reminder_time: '۱۸:۳۰',
    completed: true,
    completed_at: '۱۴۰۵/۰۸/۲۱ ۱۲:۱۵',
  },
  {
    task_id: 'task_3',
    title: 'مطالعه فصل ۵ پاتولوژی اختصاصی رابینز — پاتولوژی ایسکمی میوکارد',
    jalali_date: '۱۴۰۵/۰۸/۲۱',
    reminder_time: '۲۰:۰۰',
    completed: false,
    completed_at: null,
  },
  {
    task_id: 'task_4',
    title: 'شرکت در آزمون شبیه‌ساز آنلاین هوش‌یار (بانک سؤال فارماکولوژی)',
    jalali_date: '۱۴۰۵/۰۸/۲۱',
    reminder_time: '۲۱:۳۰',
    completed: false,
    completed_at: null,
  },
];

export const MOCK_TERMS: TermItem[] = [
  { name: 'ترم ۵ (فیزیوپاتولوژی ۱)', lesson_count: 4 },
  { name: 'ترم ۶ (فیزیوپاتولوژی ۲)', lesson_count: 5 },
  { name: 'علوم پایه (مفاهیم جامع)', lesson_count: 6 },
];

export const MOCK_LESSONS: LessonItem[] = [
  {
    _id: 'lesson_cardio',
    name: 'فیزیوپاتولوژی قلب و عروق',
    teacher: 'دکتر صادقی',
    term: 'ترم ۵ (فیزیوپاتولوژی ۱)',
    session_count: 8,
  },
  {
    _id: 'lesson_pulmo',
    name: 'فیزیوپاتولوژی ریه و تنفس',
    teacher: 'دکتر میرزایی',
    term: 'ترم ۵ (فیزیوپاتولوژی ۱)',
    session_count: 6,
  },
  {
    _id: 'lesson_pharma',
    name: 'فارماکولوژی پزشکی',
    teacher: 'دکتر حسینی',
    term: 'ترم ۵ (فیزیوپاتولوژی ۱)',
    session_count: 10,
  },
  {
    _id: 'lesson_patho',
    name: 'پاتولوژی اختصاصی',
    teacher: 'دکتر کاظمی',
    term: 'ترم ۵ (فیزیوپاتولوژی ۱)',
    session_count: 7,
  },
];

export const MOCK_SESSIONS: SessionItem[] = [
  {
    _id: 'sess_1',
    number: 1,
    topic: 'الکتروفیزیولوژی و آریتمی‌های قلبی (AF, VT, SVT)',
    teacher: 'دکتر صادقی',
    file_count: 4,
    logical_id: 'cardio_01',
  },
  {
    _id: 'sess_2',
    number: 2,
    topic: 'بیماری‌های ایسکمیک قلب و انفارکتوس میوکارد (STEMI)',
    teacher: 'دکتر صادقی',
    file_count: 3,
    logical_id: 'cardio_02',
  },
  {
    _id: 'sess_3',
    number: 3,
    topic: 'نارسایی حاد و مزمن قلب و شوک کاردیوژنیک',
    teacher: 'دکتر صادقی',
    file_count: 3,
    logical_id: 'cardio_03',
  },
  {
    _id: 'sess_4',
    number: 4,
    topic: 'بیماری‌های دریچه‌ای قلب (تنگی و نارسایی میترال)',
    teacher: 'دکتر صادقی',
    file_count: 2,
    logical_id: 'cardio_04',
  },
];

export const MOCK_FILES: ContentFile[] = [
  {
    id: 'pdf_cardio_01',
    type: 'pdf',
    name: 'جزوه تایپ‌شده جلسه ۱ — الکتروفیزیولوژی قلب (ویرایش پاییز)',
    description: 'کامل با شکل‌های رنگی، الگوریتم‌های درمانی و حاشیه‌نویسی هوش‌یار',
    downloads: 184,
    mime: 'application/pdf',
    size: 12582912,
    preview: true,
    lesson: 'فیزیوپاتولوژی قلب و عروق',
    session: 'جلسه ۱',
  },
  {
    id: 'pdf_slides_01',
    type: 'pdf',
    name: 'اسلایدهای پرزنتیشن استاد — آریتمی‌ها و بلوک‌های قلبی',
    description: 'اسلایدهای رسمی تدریس همراه با نوار قلب‌های تشخیصی',
    downloads: 142,
    mime: 'application/pdf',
    size: 8388608,
    preview: true,
    lesson: 'فیزیوپاتولوژی قلب و عروق',
    session: 'جلسه ۱',
  },
  {
    id: 'voice_sess_01',
    type: 'voice',
    name: 'فایل صوتی تدریس جلسه ۱ + خلاصه نکات کلیدی',
    description: 'صدا با کیفیت عالی و نویزگیری‌شده با هوش مصنوعی',
    downloads: 98,
    mime: 'audio/mpeg',
    size: 24117248,
    preview: false,
    lesson: 'فیزیوپاتولوژی قلب و عروق',
    session: 'جلسه ۱',
  },
  {
    id: 'test_sample_01',
    type: 'test',
    name: 'نمونه سؤالات آزمون علوم پایه جلسه ۱ با پاسخ تحلیلی',
    description: '۲۵ تست شناسنامه‌دار به همراه نکات خط‌اول بالینی',
    downloads: 215,
    mime: 'application/pdf',
    size: 3145728,
    preview: true,
    lesson: 'فیزیوپاتولوژی قلب و عروق',
    session: 'جلسه ۱',
  },
];

export const MOCK_SUBJECTS: SubjectItem[] = [
  { id: 'subj_cardio', name: 'کتب مرجع قلب و عروق (براون‌والد)', book_count: 3 },
  { id: 'subj_pharma', name: 'کتب فارماکولوژی (کاتزونگ و گودمن)', book_count: 4 },
  { id: 'subj_patho', name: 'پاتولوژی رابینز (پایه‌های آسیب‌شناسی)', book_count: 2 },
  { id: 'subj_internal', name: 'کتاب بیماری‌های داخلی هاریسون', book_count: 5 },
];

export const MOCK_BOOKS: BookItem[] = [
  { id: 'book_katzung', name: 'فارماکولوژی پایه و بالینی کاتزونگ (ویرایش ۱۶)', fa_count: 2, en_count: 1 },
  { id: 'book_robbins', name: 'پاتولوژی رابینز و کومار (ویرایش ۲۰۲۴)', fa_count: 3, en_count: 1 },
  { id: 'book_braunwald', name: 'بیماری‌های قلب براون‌والد (خلاصه کاربردی)', fa_count: 1, en_count: 1 },
];

export const MOCK_EXAM_LESSONS: ExamLessonItem[] = [
  { id: 'ex_cardio', name: 'فیزیوپاتولوژی قلب و عروق', term: 'ترم ۵', count: 320 },
  { id: 'ex_pharma', name: 'فارماکولوژی پزشکی', term: 'ترم ۵', count: 410 },
  { id: 'ex_pulmo', name: 'فیزیوپاتولوژی ریه و تنفس', term: 'ترم ۵', count: 240 },
  { id: 'ex_patho', name: 'پاتولوژی اختصاصی', term: 'ترم ۵', count: 285 },
  { id: 'ex_biochem', name: 'بیوشیمی بالینی', term: 'علوم پایه', count: 350 },
  { id: 'ex_anat', name: 'آناتومی بالینی', term: 'علوم پایه', count: 480 },
];

export interface MockHistoryItem {
  id: string;
  exam_title: string;
  date: string;
  questions_count: number;
  correct_count: number;
  score: number;
  passed: boolean;
}

export const MOCK_EXAM_HISTORY: MockHistoryItem[] = [
  { id: 'h_1', exam_title: 'آزمون شبیه‌ساز فارماکولوژی قلب', date: '۱۴۰۵/۰۸/۲۰', questions_count: 20, correct_count: 18, score: 90, passed: true },
  { id: 'h_2', exam_title: 'کوییز مبحث آریتمی‌های فوق بطنی', date: '۱۴۰۵/۰۸/۱۹', questions_count: 15, correct_count: 14, score: 93, passed: true },
  { id: 'h_3', exam_title: 'مرور جامع پاتولوژی رابینز (ایسکمی)', date: '۱۴۰۵/۰۸/۱۸', questions_count: 25, correct_count: 21, score: 84, passed: true },
  { id: 'h_4', exam_title: 'تست‌های برگزیده شوک کاردیوژنیک', date: '۱۴۰۵/۰۸/۱۷', questions_count: 10, correct_count: 10, score: 100, passed: true },
  { id: 'h_5', exam_title: 'آزمون شبیه‌ساز علوم پایه (قلب و عروق)', date: '۱۴۰۵/۰۸/۱۵', questions_count: 30, correct_count: 26, score: 87, passed: true },
  { id: 'h_6', exam_title: 'فارماکولوژی ضد فشارخون (ACEI و ARB)', date: '۱۴۰۵/۰۸/۱۴', questions_count: 20, correct_count: 17, score: 85, passed: true },
  { id: 'h_7', exam_title: 'مرور الکترولیت‌های کلیه و اسید-باز', date: '۱۴۰۵/۰۸/۱۲', questions_count: 20, correct_count: 15, score: 75, passed: true },
  { id: 'h_8', exam_title: 'کوییز سریع آناتومی عروق کرونر', date: '۱۴۰۵/۰۸/۱۰', questions_count: 15, correct_count: 14, score: 93, passed: true },
  { id: 'h_9', exam_title: 'آزمون جامع پره‌انترنی اسفند ۱۴۰۳', date: '۱۴۰۵/۰۸/۰۸', questions_count: 40, correct_count: 35, score: 88, passed: true },
  { id: 'h_10', exam_title: 'تست‌های خط‌اول ضدآریتمی‌های کلاس ۱ تا ۴', date: '۱۴۰۵/۰۸/۰۵', questions_count: 20, correct_count: 18, score: 90, passed: true },
  { id: 'h_11', exam_title: 'پاتوفیزیولوژی ریه — آسم و COPD', date: '۱۴۰۵/۰۸/۰۳', questions_count: 25, correct_count: 23, score: 92, passed: true },
  { id: 'h_12', exam_title: 'آزمون دوره‌ای بیوشیمی هورمون‌ها', date: '۱۴۰۵/۰۸/۰۱', questions_count: 20, correct_count: 16, score: 80, passed: true },
];

export const MOCK_QUESTION_HISTORY: HistoryItem[] = [
  {
    id: 'qh_1',
    question_id: 'q_seed_1',
    lesson: 'فیزیوپاتولوژی قلب و عروق',
    topic: 'بیماری‌های ایسکمیک قلب',
    question:
      'در بیمار ۵۸ ساله مشکوک به سندرم حاد کرونری (ACS) با درد قفسه سینه پایدار، تجویز فوری کدام داروی ضدپلاکت خط‌اول درمان اولیه است؟',
    selected: 0,
    correct_answer: 0,
    is_correct: true,
    answered_at: '2026-11-09T08:30:00Z',
  },
  {
    id: 'qh_2',
    question_id: 'q_seed_2',
    lesson: 'فارماکولوژی پزشکی',
    topic: 'داروهای کاهنده فشارخون',
    question:
      'کدام دسته از داروهای ضد پرفشاری خون در بیماران دیابتی مبتلا به پروتئینوری، اثر محافظت کلیوی (Renoprotective) دارند؟',
    selected: 1,
    correct_answer: 1,
    is_correct: true,
    answered_at: '2026-11-08T14:15:00Z',
  },
  {
    id: 'qh_3',
    question_id: 'q_seed_3',
    lesson: 'فیزیوپاتولوژی ریه و تنفس',
    topic: 'بیماری‌های انسدادی ریه',
    question:
      'در اسپیرومتری بیمار مبتلا به COPD پیشرفته، کدام تغییر در نسبت FEV1/FVC بعد از مصرف برونکودیلاتور پاتوقنومونیک است؟',
    selected: 2,
    correct_answer: 0,
    is_correct: false,
    answered_at: '2026-11-07T11:00:00Z',
  },
  {
    id: 'qh_4',
    question_id: 'q_seed_4',
    lesson: 'پاتولوژی اختصاصی',
    topic: 'آترواسکلروزیس و ضایعات عروقی',
    question:
      'اولین مرحله میکروسکوپی در تشکیل پلاک آترومی، تجمع کدام سلول‌های مشتق از منوسیت‌ها (Foam Cells) در انتیما است؟',
    selected: 0,
    correct_answer: 0,
    is_correct: true,
    answered_at: '2026-11-06T17:45:00Z',
  },
  {
    id: 'qh_5',
    question_id: 'q_seed_5',
    lesson: 'بیوشیمی بالینی',
    topic: 'متابولیسم لیپیدها و لیپوپروتئین‌ها',
    question:
      'آپولیپوپروتئین B-100 جزء ساختاری اصلی کدام دسته از لیپوپروتئین‌های پلاسما در مسیر آتروژنیک محسوب می‌شود؟',
    selected: 3,
    correct_answer: 3,
    is_correct: true,
    answered_at: '2026-11-05T09:20:00Z',
  },
  {
    id: 'qh_6',
    question_id: 'q_seed_6',
    lesson: 'آناتومی بالینی',
    topic: 'عروق کرونری قلب',
    question:
      'شریان کرونر راست (RCA) در ۹۰ درصد جمعیت، خونرسانی گره دهلیزی-بطنی (AV Node) را از طریق کدام شاخه تأمین می‌کند؟',
    selected: 1,
    correct_answer: 1,
    is_correct: true,
    answered_at: '2026-11-04T16:10:00Z',
  },
];

export const MOCK_EXAM_SUMMARIES: MockSummary[] = [
  {
    session_id: 'mock_sess_1',
    lesson: 'فیزیوپاتولوژی قلب و عروق',
    topic: 'آریتمی‌ها و ایسکمی',
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
  },
  {
    session_id: 'mock_sess_2',
    lesson: 'فارماکولوژی پزشکی',
    topic: 'داروهای اتونومیک و قلبی',
    status: 'finished',
    total: 15,
    answered: 15,
    correct: 14,
    percentage: 93,
    current_index: 15,
    minutes: 15,
    deadline: null,
    started_at: '2026-11-08T14:00:00Z',
    finished_at: '2026-11-08T14:14:00Z',
    exam_code: 'PHARMA-MOCK-15',
    requested_count: 15,
    actual_count: 15,
  },
];

export const MOCK_NEXT_QUESTION: NextPayload = {
  question: {
    id: 'q_seed_1',
    lesson_id: 'ex_cardio',
    topic_id: 'top_ischemia',
    lesson: 'فیزیوپاتولوژی قلب و عروق',
    topic: 'بیماری‌های ایسکمیک قلب',
    difficulty: 'medium',
    difficulty_label: 'متوسط',
    question:
      'آقای ۵۸ ساله با سابقه آنژین پایدار و دیابت نوع ۲، با درد تیپیک سینه در حالت استراحت که بیش از ۳۰ دقیقه طول کشیده و با قرص زیرزبانی نیتروگلیسیرین بهبود نیافته به اورژانس مراجعه کرده است. در نوار قلب (ECG) انحراف قطعه ST دیده می‌شود. کدام اقدام دارویی اولیه صحیح‌ترین انتخاب است؟',
    options: [
      'تجویز فوری آسپیرین جویدنی ۳۰۰ میلی‌گرم + کلوپیدوگرل',
      'تجویز متوپرولول وریدی بدون انجام آنژیوگرافی',
      'شروع رژیم درمانی فقط با دیلتیازم خوراکی',
      'تزریق وریدی دیگوکسین و پیگیری سرپایی',
    ],
    source: 'آزمون پره‌انترنی شهریور ۱۴۰۴',
    exam_year: '۱۴۰۴',
    exam_session_label: 'شهریور',
    content_source: 'رسمی وزارت بهداشت',
    content_source_label_fa: 'بانک سؤالات رسمی',
    image: { has_image: false, pending_upload: false, alt_text: '' },
    image_url: null,
  },
  progress: {
    total: 25,
    solved_unique: 8,
    remaining: 17,
    exhausted: false,
  },
  ai_available: true,
};

export const MOCK_NOTES: NoteItem[] = [
  {
    scope: 'res',
    id: 'pdf_cardio_01',
    name: 'جزوه فیزیوپاتولوژی قلب — آریتمی‌ها و انفارکتوس میوکارد',
    kind: 'pdf',
    available: true,
    pages: 14,
    strokes: 68,
    last_page: 24,
    updated_at: '۱۴۰۵/۰۸/۲۱ ۱۱:۲۰',
  },
  {
    scope: 'res',
    id: 'pdf_pharma_01',
    name: 'خلاصه فارماکولوژی کاتزونگ — داروهای کاهنده فشار خون',
    kind: 'pdf',
    available: true,
    pages: 8,
    strokes: 42,
    last_page: 12,
    updated_at: '۱۴۰۵/۰۸/۱۹ ۱۶:۴۵',
  },
  {
    scope: 'res',
    id: 'pdf_pulmo_01',
    name: 'اسلایدهای مکانیسم تبادلات گازی ریه (استاد میرزایی)',
    kind: 'pdf',
    available: true,
    pages: 5,
    strokes: 26,
    last_page: 8,
    updated_at: '۱۴۰۵/۰۸/۱۷ ۰۹:۳۰',
  },
  {
    scope: 'res',
    id: 'pdf_patho_01',
    name: 'پاتولوژی اختصاصی رابینز — کاردیومیوپاتی‌ها',
    kind: 'pdf',
    available: true,
    pages: 11,
    strokes: 55,
    last_page: 19,
    updated_at: '۱۴۰۵/۰۸/۱۴ ۱۸:۰۰',
  },
  {
    scope: 'res',
    id: 'pdf_biochem_01',
    name: 'خلاصه نموداری متابولیسم لیپیدها و شیلومیکرون‌ها',
    kind: 'pdf',
    available: true,
    pages: 4,
    strokes: 18,
    last_page: 4,
    updated_at: '۱۴۰۵/۰۸/۱۰ ۲۰:۱۵',
  },
  {
    scope: 'res',
    id: 'pdf_exam_preintern',
    name: 'تحلیل تست‌های پره‌انترنی — نکات بالینی خط‌اول',
    kind: 'pdf',
    available: true,
    pages: 9,
    strokes: 47,
    last_page: 15,
    updated_at: '۱۴۰۵/۰۸/۰۸ ۱۲:۰۰',
  },
];

export const MOCK_SCHEDULE: ScheduleItem[] = [
  {
    id: 'sch_1',
    type: 'class',
    lesson: 'فیزیوپاتولوژی قلب و عروق',
    teacher: 'دکتر صادقی',
    date: '1405-08-22',
    time: '08:00',
    end_time: '10:00',
    location: 'تالار رازی',
    note: 'مبحث آریتمی‌های قلبی',
    group: 'گروه الف',
    educational_group: 'گروه داخلی',
    course_code: 'MED-501',
    term: 'ترم ۵',
    days_left: 1,
  },
  {
    id: 'sch_2',
    type: 'class',
    lesson: 'فارماکولوژی پزشکی',
    teacher: 'دکتر حسینی',
    date: '1405-08-22',
    time: '10:15',
    end_time: '12:15',
    location: 'کلاس ۴ دانشکده پزشکی',
    note: 'داروهای اینوتروپ و دیورتیک',
    group: 'گروه الف',
    educational_group: 'گروه فارماکولوژی',
    course_code: 'MED-502',
    term: 'ترم ۵',
    days_left: 1,
  },
  {
    id: 'sch_3',
    type: 'class',
    lesson: 'پاتولوژی اختصاصی',
    teacher: 'دکتر کاظمی',
    date: '1405-08-23',
    time: '08:00',
    end_time: '10:00',
    location: 'آزمایشگاه پاتولوژی',
    note: 'بررسی لام‌های بیوپسی میوکارد',
    group: 'گروه الف',
    educational_group: 'گروه آسیب‌شناسی',
    course_code: 'MED-504',
    term: 'ترم ۵',
    days_left: 2,
  },
  {
    id: 'sch_4',
    type: 'class',
    lesson: 'فیزیوپاتولوژی ریه و تنفس',
    teacher: 'دکتر میرزایی',
    date: '1405-08-24',
    time: '10:00',
    end_time: '12:00',
    location: 'تالار ۱ دانشکده',
    note: 'اسپیرومتری و بیماری‌های انسدادی',
    group: 'گروه الف',
    educational_group: 'گروه ریه',
    course_code: 'MED-503',
    term: 'ترم ۵',
    days_left: 3,
  },
  {
    id: 'sch_5',
    type: 'exam',
    lesson: 'فارماکولوژی بالینی',
    teacher: 'دکتر حسینی',
    date: '1405-08-24',
    time: '09:00',
    end_time: '10:30',
    location: 'تالار ۱ دانشکده پزشکی',
    note: 'میان‌ترم اول',
    group: 'گروه الف',
    educational_group: 'فارماکولوژی',
    course_code: 'MED-502',
    term: 'ترم ۵',
    days_left: 3,
  },
];

export const MOCK_GRADES: GradesSummaryPayload = {
  cumulative_gpa: 17.85,
  total_credits: 96,
  passed_credits: 78,
  failed_credits: 0,
  semesters: [
    {
      term_label: 'نیم‌سال اول ۱۴۰۴-۱۴۰۵ (ترم ۴)',
      term_gpa: 18.1,
      credits: 19,
      courses: [
        { course_id: 'c_401', name: 'فیزیولوژی پزشکی ۲', credits: 4, score: 19.5, normalized_score: 19.5, passed: true },
        { course_id: 'c_402', name: 'فارماکولوژی عمومی', credits: 3, score: 18.0, normalized_score: 18.0, passed: true },
        { course_id: 'c_403', name: 'بافت‌شناسی اختصاصی', credits: 3, score: 17.5, normalized_score: 17.5, passed: true },
        { course_id: 'c_404', name: 'ایمونولوژی پایه', credits: 3, score: 17.0, normalized_score: 17.0, passed: true },
        { course_id: 'c_405', name: 'زبان تخصصی پزشکی', credits: 2, score: 18.5, normalized_score: 18.5, passed: true },
        { course_id: 'c_406', name: 'انگل‌شناسی و قارچ‌شناسی', credits: 4, score: 18.0, normalized_score: 18.0, passed: true },
      ],
    },
    {
      term_label: 'نیم‌سال دوم ۱۴۰۳-۱۴۰۴ (ترم ۳)',
      term_gpa: 17.6,
      credits: 20,
      courses: [
        { course_id: 'c_301', name: 'آناتومی اندام و تنه', credits: 5, score: 17.0, normalized_score: 17.0, passed: true },
        { course_id: 'c_302', name: 'بیوشیمی پزشکی ۲', credits: 4, score: 18.25, normalized_score: 18.25, passed: true },
        { course_id: 'c_303', name: 'فیزیولوژی پزشکی ۱', credits: 4, score: 18.0, normalized_score: 18.0, passed: true },
        { course_id: 'c_304', name: 'ژنتیک پزشکی', credits: 3, score: 17.5, normalized_score: 17.5, passed: true },
        { course_id: 'c_305', name: 'روانشناسی سلامت', credits: 2, score: 16.5, normalized_score: 16.5, passed: true },
        { course_id: 'c_306', name: 'بهداشت عمومی', credits: 2, score: 18.5, normalized_score: 18.5, passed: true },
      ],
    },
  ],
};
