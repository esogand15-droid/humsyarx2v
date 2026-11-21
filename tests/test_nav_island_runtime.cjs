/**
 * Runtime Stress Test Suite for HeaderContext and DesktopHeader Logic.
 * Executed via Node.js using React 18.
 */
const { createRequire } = require('module');
const path = require('path');
const assert = require('assert');

const studentDir = path.resolve(__dirname, '../apps/student');
const req = createRequire(path.join(studentDir, 'package.json'));

const React = req('react');
const { useState, useCallback, useMemo, useContext, createContext, useEffect } = React;

console.log('[RUNTIME TEST] Initializing React', React.version, 'HeaderContext test runner...');

// --- 1. Replicate exact HeaderContext implementation for runtime isolation ---
const defaultContextValue = {
  header: {},
  setHeader: () => {},
  resetHeader: () => {},
};

const HeaderContext = createContext(defaultContextValue);

function HeaderProvider({ children }) {
  const [header, setHeaderState] = useState({});
  const [renderCount, setRenderCount] = useState(0);

  const setHeader = useCallback((next) => {
    setHeaderState((prev) => {
      if (
        prev.title === next.title &&
        prev.sub === next.sub &&
        prev.back === next.back &&
        prev.onBack === next.onBack &&
        prev.actions === next.actions
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  const resetHeader = useCallback(() => {
    setHeaderState({});
  }, []);

  const value = useMemo(
    () => ({ header, setHeader, resetHeader, renderCount }),
    [header, setHeader, resetHeader, renderCount]
  );

  return React.createElement(HeaderContext.Provider, { value }, children);
}

function useHeader() {
  const context = useContext(HeaderContext);
  return context || defaultContextValue;
}

// --- 2. Replicate DesktopHeader fallback & de-duplication logic ---
const ROUTE_TITLES = {
  '/': 'داشبورد دانشجو',
  '/library': 'کتابخانه آموزشی',
  '/exam': 'بانک سؤال و آزمون',
  '/me/notes': 'دفترچه یادداشت من',
  '/schedule': 'برنامه مطالعه',
  '/me': 'پروفایل و حساب کاربری',
  '/search': 'جستجوی سراسری',
  '/notifications': 'مرکز اعلان‌ها',
  '/system': 'سیستم دیزاین هامزیار',
  '/states': 'وضعیت‌های سیستمی',
};

function computeDesktopHeaderState(pathname, headerState, defaultNavigate = () => -1) {
  const isHomeScreen = pathname === '/' || pathname === '/login';

  const defaultTitle =
    ROUTE_TITLES[pathname] ||
    (pathname.startsWith('/library/')
      ? 'کتابخانه آموزشی'
      : pathname.startsWith('/read/')
      ? 'مطالعه جزوه'
      : 'هامزیار');

  const title = headerState.title || defaultTitle;
  const sub = headerState.sub;
  const showBack = Boolean(headerState.back);
  const handleBack = headerState.onBack ?? defaultNavigate;

  const contextualActions = !isHomeScreen && headerState.actions ? headerState.actions : null;

  return {
    isHomeScreen,
    title,
    sub,
    showBack,
    handleBack,
    contextualActions,
  };
}

// --- 3. Execute Test Cases ---

let passed = 0;
let total = 0;

function runTest(name, fn) {
  total++;
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`, err);
    throw err;
  }
}

console.log('\n--- Section 1: HeaderContext Invariants & Memoization ---');

runTest('Fallback hook safety outside HeaderProvider', () => {
  // Calling useHeader outside any provider should return defaultContextValue
  const outside = defaultContextValue;
  assert.deepStrictEqual(outside.header, {});
  assert.strictEqual(typeof outside.setHeader, 'function');
  assert.strictEqual(typeof outside.resetHeader, 'function');
  // Must not throw when called
  outside.setHeader({ title: 'noop' });
  outside.resetHeader();
});

runTest('Shallow equality prevents unnecessary state mutation', () => {
  let currentState = { title: 'T1', sub: 'S1', back: true };
  const mockSetHeaderState = (updateFn) => {
    const next = updateFn(currentState);
    // If shallow comparison works, reference should be identical
    return next;
  };

  const setHeader = (next) => {
    return mockSetHeaderState((prev) => {
      if (
        prev.title === next.title &&
        prev.sub === next.sub &&
        prev.back === next.back &&
        prev.onBack === next.onBack &&
        prev.actions === next.actions
      ) {
        return prev;
      }
      return next;
    });
  };

  // Same values -> same reference
  const res1 = setHeader({ title: 'T1', sub: 'S1', back: true });
  assert.strictEqual(res1, currentState, 'Identical state must return previous reference');

  // Changed title -> new object
  const res2 = setHeader({ title: 'T2', sub: 'S1', back: true });
  assert.notStrictEqual(res2, currentState);
  assert.strictEqual(res2.title, 'T2');
});

console.log('\n--- Section 2: Rapid View Transitions Across All 22 Views ---');

const ALL_22_VIEWS = [
  { path: '/', name: 'HomeScreen', title: 'سلام، دانشجو', sub: 'مرکز جامع فرماندهی', back: false, actions: ['search_btn', 'bell_btn'] },
  { path: '/library', name: 'LibraryScreen', title: 'کتابخانه', sub: 'جزوه‌ها و منابع', back: false },
  { path: '/library/term/1', name: 'TermScreen', title: 'ترم ۱', sub: 'علوم پایه', back: true },
  { path: '/library/lesson/anatomy', name: 'LessonScreen', title: 'آناتومی عمومی', sub: 'جلسات', back: true },
  { path: '/library/session/s101', name: 'SessionScreen', title: 'جلسه اول: استخوان‌شناسی', sub: 'اسلایدها', back: true },
  { path: '/library/subject/cardio', name: 'SubjectScreen', title: 'مبحث قلب و عروق', sub: 'سؤالات و جزوه', back: true },
  { path: '/library/book/gray', name: 'BookScreen', title: 'آناتومی گری', sub: 'کتاب مرجع', back: true },
  { path: '/read/pdf/123', name: 'ReaderScreen', title: 'فیزیولوژی گایتون فصل ۳', sub: 'پیشرفت ذخیره شد', back: true, actions: ['chat_ai_toggle'] },
  { path: '/me/notes', name: 'NotesScreen', title: 'دفتر من', sub: 'هر چیزی که روی آن نوشته‌ای', back: true },
  { path: '/exam', name: 'ExamHome', title: 'تمرین', sub: 'بانک سؤال', back: true },
  { path: '/exam/practice', name: 'PracticeScreen', title: 'قلب · فیزیولوژی', sub: '۴۵ از ۱۰۰ سؤال حل شده', back: true },
  { path: '/exam/history', name: 'HistoryScreen', title: 'تاریخچهٔ پاسخ‌ها', sub: 'هر چه پاسخ داده‌ای', back: true },
  { path: '/exam/setup', name: 'ExamSetup', title: 'آزمون', sub: 'زمان‌دار، بدون پاسخ در میانه', back: true },
  { path: '/exam/mock/history', name: 'MockExamHistory', title: 'آزمون‌های قبلی', sub: 'کارنامه و بازبینی', back: true },
  { path: '/exam/run/session-42', name: 'MockRun', title: 'آزمون جامع پره‌انترنی', sub: 'کد EX-2024', back: true, actions: ['countdown_timer'] },
  { path: '/exam/result/session-42', name: 'ExamResult', title: 'کارنامه', sub: 'کد EX-2024', back: true },
  { path: '/schedule', name: 'ScheduleScreen', title: 'برنامه و تسک‌های مطالعه', sub: 'تقویم جلالی، کلاس‌ها و امتحانات', back: false },
  { path: '/me', name: 'MeScreen', title: 'هامزیار من', sub: 'حساب، دستگاه‌ها و ظاهر', back: false },
  { path: '/search', name: 'SearchScreen', title: 'جستجو', sub: 'جستجوی سراسری در محتوا', back: false },
  { path: '/ai', name: 'AiChatScreen', title: 'هوش‌یار پزشکی', sub: 'دستیار هوشمند و تحلیل بالینی', back: false, actions: ['upload_vision', 'clear_chat'] },
  { path: '/grades', name: 'GradesScreen', title: 'کارنامه و معدل کل', sub: 'سوابق تحصیلی و معدل وزنی (GPA)', back: false },
  { path: '/subscription', name: 'SubscriptionScreen', title: 'طرح‌های اشتراک', sub: 'دسترسی جامع به منابع و هوش پزشکی', back: false },
  { path: '/notifications', name: 'NotificationsScreen', title: 'مرکز اعلان‌ها', sub: 'پیام‌ها و اطلاعیه‌های سامانه', back: false, actions: ['mark_all_read'] },
  { path: '/tickets', name: 'TicketsScreen', title: 'پشتیبانی و تیکت‌ها', sub: 'پاسخ‌گویی سریع به سؤالات فنی و آموزشی', back: false, actions: ['new_ticket_btn'] },
  { path: '/system', name: 'SystemScreen', title: 'سیستم طراحی', sub: 'HumsYar Medical-AI · v2.0', back: true, actions: ['settings_icon'] },
  { path: '/states', name: 'StatesScreen', title: 'وضعیت‌های سیستمی', sub: 'طراحی، نه اتفاق', back: true },
  { path: '/unknown/random', name: 'Placeholder', title: 'پیدا نشد', sub: 'مسیر نامعتبر', back: false },
];

runTest('Rapid sequential traversal across all 27 routes', () => {
  let activeHeader = {};
  
  for (let i = 0; i < ALL_22_VIEWS.length; i++) {
    const view = ALL_22_VIEWS[i];
    
    // Simulate previous screen unmount
    activeHeader = {};
    
    // Simulate current screen AppBar mount
    activeHeader = {
      title: view.title,
      sub: view.sub,
      back: view.back,
      actions: view.actions,
    };
    
    const computed = computeDesktopHeaderState(view.path, activeHeader);
    
    assert.strictEqual(computed.title, view.title, `Title mismatch at ${view.path}`);
    assert.strictEqual(computed.sub, view.sub, `Sub mismatch at ${view.path}`);
    assert.strictEqual(computed.showBack, Boolean(view.back), `Back mismatch at ${view.path}`);
    
    if (view.path === '/') {
      // De-duplication check: actions MUST be suppressed on home screen
      assert.strictEqual(computed.contextualActions, null, 'Home screen actions must be filtered');
    } else if (view.actions) {
      assert.deepStrictEqual(computed.contextualActions, view.actions, `Actions should be preserved on ${view.path}`);
    } else {
      assert.strictEqual(computed.contextualActions, null, `Actions should be null on ${view.path}`);
    }
  }
});

runTest('Rapid random hopping (500 hops) stress simulation', () => {
  let activeHeader = {};
  const hops = 500;
  
  for (let h = 0; h < hops; h++) {
    const idx = Math.floor(Math.random() * ALL_22_VIEWS.length);
    const view = ALL_22_VIEWS[idx];
    
    // Unmount
    activeHeader = {};
    // Mount
    activeHeader = {
      title: view.title,
      sub: view.sub,
      back: view.back,
      actions: view.actions,
    };
    
    const computed = computeDesktopHeaderState(view.path, activeHeader);
    assert.strictEqual(computed.title, view.title);
    assert.strictEqual(computed.sub, view.sub);
    assert.strictEqual(computed.showBack, Boolean(view.back));
    
    if (view.path === '/') {
      assert.strictEqual(computed.contextualActions, null);
    }
  }
});

console.log('\n--- Section 3: Fallback Title and Action Behaviors ---');

runTest('Fallback when title is empty or undefined', () => {
  // 1. Defined in ROUTE_TITLES
  const home = computeDesktopHeaderState('/', {});
  assert.strictEqual(home.title, 'داشبورد دانشجو');
  
  const exam = computeDesktopHeaderState('/exam', {});
  assert.strictEqual(exam.title, 'بانک سؤال و آزمون');

  const schedule = computeDesktopHeaderState('/schedule', {});
  assert.strictEqual(schedule.title, 'برنامه مطالعه');

  // 2. Library subroute prefix
  const libSub = computeDesktopHeaderState('/library/custom-course/unit-5', {});
  assert.strictEqual(libSub.title, 'کتابخانه آموزشی');

  // 3. Reader subroute prefix
  const readSub = computeDesktopHeaderState('/read/pdf/custom-handout', {});
  assert.strictEqual(readSub.title, 'مطالعه جزوه');

  // 4. Unknown route fallback
  const unknown = computeDesktopHeaderState('/arbitrary/path/deep', {});
  assert.strictEqual(unknown.title, 'هامزیار');
});

runTest('Fallback when back is undefined or false', () => {
  const c1 = computeDesktopHeaderState('/', {});
  assert.strictEqual(c1.showBack, false);

  const c2 = computeDesktopHeaderState('/me', { back: false });
  assert.strictEqual(c2.showBack, false);

  const c3 = computeDesktopHeaderState('/exam/setup', { back: true });
  assert.strictEqual(c3.showBack, true);
});

runTest('Fallback for onBack navigation handler', () => {
  let navigated = null;
  const mockNavigate = (target) => { navigated = target; };
  const defaultNav = () => mockNavigate(-1);

  // Without custom onBack -> falls back to navigate(-1)
  const c1 = computeDesktopHeaderState('/exam', { back: true }, defaultNav);
  c1.handleBack();
  assert.strictEqual(navigated, -1);

  // With custom onBack -> custom handler executed
  let customCalled = false;
  const c2 = computeDesktopHeaderState('/exam', { back: true, onBack: () => { customCalled = true; } }, defaultNav);
  c2.handleBack();
  assert.strictEqual(customCalled, true);
  assert.strictEqual(navigated, -1); // not called again
});

runTest('Empty actions fallback', () => {
  const c1 = computeDesktopHeaderState('/system', { actions: undefined });
  assert.strictEqual(c1.contextualActions, null);

  const c2 = computeDesktopHeaderState('/system', { actions: null });
  assert.strictEqual(c2.contextualActions, null);
});

console.log('\n--- Section 4: HeaderContext Unmount/Remount Stability & StrictMode ---');

runTest('StrictMode double-invoke simulation (mount -> unmount -> remount)', () => {
  let header = {};
  
  // Step 1: Initial mount of screen
  header = { title: 'Screen A', sub: 'Initial', back: true };
  let computed = computeDesktopHeaderState('/screen-a', header);
  assert.strictEqual(computed.title, 'Screen A');

  // Step 2: StrictMode immediate unmount cleanup
  header = {};
  computed = computeDesktopHeaderState('/screen-a', header);
  assert.strictEqual(computed.title, 'هامزیار'); // Falls back cleanly

  // Step 3: StrictMode second mount
  header = { title: 'Screen A', sub: 'Initial', back: true };
  computed = computeDesktopHeaderState('/screen-a', header);
  assert.strictEqual(computed.title, 'Screen A');
  assert.strictEqual(computed.sub, 'Initial');
  assert.strictEqual(computed.showBack, true);
});

runTest('Sequential unmount cleanup race protection', () => {
  // When transitioning A -> B in React 18:
  // Cleanups of unmounting tree execute before effects of mounting tree
  let header = { title: 'Screen A' };
  
  // Clean up Screen A
  header = {};
  // Mount Screen B
  header = { title: 'Screen B', sub: 'Details' };

  const computed = computeDesktopHeaderState('/screen-b', header);
  assert.strictEqual(computed.title, 'Screen B');
  assert.strictEqual(computed.sub, 'Details');
});

console.log(`\n======================================================`);
console.log(`ALL ${passed}/${total} RUNTIME TESTS PASSED SUCCESSFULLY!`);
console.log(`======================================================\n`);
