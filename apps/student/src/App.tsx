import { Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { Suspense, lazy, useEffect } from 'react';

import { Shell } from './layout/Shell';
import { sectionFor } from './layout/section';
import { LoginScreen } from './screens/LoginScreen';
import { BlockedScreen, PendingScreen, SplashScreen } from './screens/GateScreens';
import { useSession } from './lib/session';
import { SessionExpiredBanner } from './components/SessionExpiredBanner';
import { SwUpdateBanner } from './components/SwUpdateBanner';
import { MiniPlayer } from './components/MiniPlayer';

const HomeScreen = lazy(() => import('./screens/HomeScreen').then((m) => ({ default: m.HomeScreen })));
const LibraryScreen = lazy(() => import('./screens/library/LibraryScreen').then((m) => ({ default: m.LibraryScreen })));
const TermScreen = lazy(() => import('./screens/library/LibraryScreens').then((m) => ({ default: m.TermScreen })));
const LessonScreen = lazy(() => import('./screens/library/LibraryScreens').then((m) => ({ default: m.LessonScreen })));
const SessionScreen = lazy(() => import('./screens/library/LibraryScreens').then((m) => ({ default: m.SessionScreen })));
const SubjectScreen = lazy(() => import('./screens/library/LibraryScreens').then((m) => ({ default: m.SubjectScreen })));
const BookScreen = lazy(() => import('./screens/library/LibraryScreens').then((m) => ({ default: m.BookScreen })));
const ReaderScreen = lazy(() => import('./screens/reader/ReaderScreen').then((m) => ({ default: m.ReaderScreen })));
const NotesScreen = lazy(() => import('./screens/notes/NotesScreen').then((m) => ({ default: m.NotesScreen })));
const ExamHome = lazy(() => import('./screens/exam/ExamHome').then((m) => ({ default: m.ExamHome })));
const PracticeScreen = lazy(() => import('./screens/exam/PracticeScreen').then((m) => ({ default: m.PracticeScreen })));
const HistoryScreen = lazy(() => import('./screens/exam/HistoryScreen').then((m) => ({ default: m.HistoryScreen })));
const ExamSetup = lazy(() => import('./screens/exam/ExamSetup').then((m) => ({ default: m.ExamSetup })));
const MockExamHistory = lazy(() => import('./screens/exam/ExamSetup').then((m) => ({ default: m.MockExamHistory })));
const MockRun = lazy(() => import('./screens/exam/MockRun').then((m) => ({ default: m.MockRun })));
const ExamResult = lazy(() => import('./screens/exam/ExamResult').then((m) => ({ default: m.ExamResult })));
const SearchScreen = lazy(() => import('./screens/SearchScreen').then((m) => ({ default: m.SearchScreen })));
const WelcomeScreen = lazy(() => import('./screens/WelcomeScreen').then((m) => ({ default: m.WelcomeScreen })));
const ScheduleScreen = lazy(() => import('./screens/ScheduleScreen').then((m) => ({ default: m.ScheduleScreen })));
const AiChatScreen = lazy(() => import('./screens/ai/AiChatScreen').then((m) => ({ default: m.AiChatScreen })));
const GradesScreen = lazy(() => import('./screens/GradesScreen').then((m) => ({ default: m.GradesScreen })));
const SubscriptionScreen = lazy(() => import('./screens/SubscriptionScreen').then((m) => ({ default: m.SubscriptionScreen })));
const NotificationsScreen = lazy(() => import('./screens/NotificationsScreen').then((m) => ({ default: m.NotificationsScreen })));
const TicketsScreen = lazy(() => import('./screens/TicketsScreen').then((m) => ({ default: m.TicketsScreen })));
const MeScreen = lazy(() => import('./screens/MeScreen').then((m) => ({ default: m.MeScreen })));
const InstallGuideScreen = lazy(() => import('./screens/InstallGuideScreen').then((m) => ({ default: m.InstallGuideScreen })));
const NotFoundScreen = lazy(() => import('./screens/NotFoundScreen').then((m) => ({ default: m.NotFoundScreen })));

/* SY1: the design-system showcase and states gallery are engineering tools. They exist only in
   `vite dev`; in a production build the branch is constant-false, so neither the route nor the
   chunk ships and /system, /states fall through to the 404 screen. */
const SystemScreen = import.meta.env.DEV
  ? lazy(() => import('./screens/SystemScreen').then((m) => ({ default: m.SystemScreen })))
  : null;
const StatesScreen = import.meta.env.DEV
  ? lazy(() => import('./screens/StatesScreen').then((m) => ({ default: m.StatesScreen })))
  : null;

function RouteFallback() {
  return (
    <div className="page ds-route-fallback" aria-busy="true" aria-label="در حال بارگذاری صفحه">
      <div className="ds-route-fallback__head">
        <span className="ds-skel ds-skel--title" aria-hidden="true" />
        <span className="ds-skel ds-skel--text ds-route-fallback__sub" aria-hidden="true" />
      </div>
      <div className="ds-card ds-route-fallback__card">
        <span className="ds-skel ds-skel--card" aria-hidden="true" />
        <div className="ds-route-fallback__rows">
          <span className="ds-skel ds-skel--row" aria-hidden="true" />
          <span className="ds-skel ds-skel--row" aria-hidden="true" />
          <span className="ds-skel ds-skel--row" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    document.querySelector('.stage-content')?.scrollTo({ top: 0 });
  }, [pathname]);
  return null;
}

/** One soft entrance per route change. Opacity only: a transform on the main
    landmark would re-anchor its position:fixed children for the duration. */
function RouteEntrance() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const main = document.getElementById('main-content');
    if (!main || typeof main.animate !== 'function') return;
    const anim = main.animate([{ opacity: 0.001 }, { opacity: 1 }], {
      duration: 200,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    });
    return () => anim.cancel();
  }, [pathname]);
  return null;
}

/** ورودی روت: کاربر ناشناس صفحهٔ معرفی را می‌بیند، کاربر فعال مستقیم به خانه می‌رود. */
function RootEntry() {
  const { status } = useSession();
  if (status === 'loading') return <SplashScreen />;
  if (status === 'pending_approval') return <PendingScreen />;
  if (status === 'suspended') return <BlockedScreen />;
  if (status !== 'active') return <WelcomeScreen />;
  return <HomeScreen />;
}

/** ورودی ورود: اگر کاربر از پیش وارد شده بود به داشبورد هدایت می‌شود. */
function LoginEntry() {
  const { status } = useSession();
  if (status === 'loading') return <SplashScreen />;
  if (status === 'pending_approval') return <PendingScreen />;
  if (status === 'suspended') return <BlockedScreen />;
  if (status === 'active') return <Navigate to="/" replace />;
  return <LoginScreen />;
}

/** گارد — تنها جایی که «وضعیت حساب» به مسیر تبدیل میشود.
    سه وضعیت مستقل (نشست، تأیید، اشتراک) اینجا از هم جدا میمانند:
    این گارد فقط دو تای اول را میبیند؛ اشتراک در خود صفحهها تصمیم میگیرد. */
function Gate({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  if (status === 'loading') return <SplashScreen />;
  if (status === 'pending_approval') return <PendingScreen />;
  if (status === 'suspended') return <BlockedScreen />;
  if (status !== 'active') return <LoginScreen />;
  return <>{children}</>;
}

/** Legacy notification links from the bot and API: /me/tickets?t=123 → /tickets/123. */
function LegacyTicketsRedirect() {
  const [params] = useSearchParams();
  const t = params.get('t');
  return <Navigate to={t ? `/tickets/${encodeURIComponent(t)}` : '/tickets'} replace />;
}

/** صفحه‌های بدون گارد و بدون نوار ناوبری. */
const PUBLIC_PATHS = import.meta.env.DEV ? ['/system', '/states', '/install', '/welcome'] : ['/install', '/welcome'];

/** پوسته بر اساس وضعیت واقعی نشست: تببار فقط وقتی معنا دارد که
    کاربر وارد و تأییدشده باشد و در صفحه‌های مرجع یا حالت تمام‌صفحه نباشد. */
function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const { status } = useSession();
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  // ریدر و اجرای آزمون زمان‌دار فضای بیشتری می‌خواهند؛ تب‌بار پایین پنهان می‌شود
  const isReader = pathname.startsWith('/read/');
  const isExamRun = pathname.startsWith('/exam/run/');
  const immersive = isReader || isExamRun;
  const variant = isReader ? 'reader' : status === 'active' && !isPublic ? 'default' : 'bare';
  return (
    <Shell tabs={status === 'active' && !isPublic && !immersive} variant={variant} section={sectionFor(pathname)}>
      {children}
    </Shell>
  );
}

export function App() {
  const { status } = useSession();

  // Warm the main screen chunks once idle ONLY for signed-in active sessions so
  // unauthenticated /welcome or /login visitors do not download protected screen bundles.
  useEffect(() => {
    if (status !== 'active') return;
    // Skip speculative downloads on data-saver or 2G/3G connections.
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (conn?.saveData || /(^|-)(2g|3g)$/.test(conn?.effectiveType ?? '')) return;
    const warm = () => {
      void import('./screens/HomeScreen');
      void import('./screens/library/LibraryScreen');
      void import('./screens/exam/ExamHome');
      void import('./screens/ai/AiChatScreen');
      void import('./screens/GradesScreen');
      void import('./screens/ScheduleScreen');
      void import('./screens/notes/NotesScreen');
      void import('./screens/MeScreen');
      void import('./screens/reader/ReaderScreen');
    };
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    const id = ric ? ric(warm) : window.setTimeout(warm, 1500);
    return () => {
      if (!ric) window.clearTimeout(id);
    };
  }, [status]);

  return (
    <Layout>
      <ScrollToTop />
      <RouteEntrance />
      {/* T3: session expired mid-use, non-blocking banner (screen stays) */}
      <SessionExpiredBanner />
      <SwUpdateBanner />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
        <Route path="/welcome" element={<WelcomeScreen />} />
        <Route path="/login" element={<LoginEntry />} />
        {SystemScreen && (
          <Route path="/system" element={<Suspense fallback={null}><SystemScreen /></Suspense>} />
        )}
        {StatesScreen && (
          <Route path="/states" element={<Suspense fallback={null}><StatesScreen /></Suspense>} />
        )}
        <Route path="/install" element={<InstallGuideScreen />} />
        <Route path="/" element={<RootEntry />} />
        <Route
          path="/library"
          element={
            <Gate>
              <LibraryScreen />
            </Gate>
          }
        />
        <Route path="/library/term/:term" element={<Gate><TermScreen /></Gate>} />
        <Route path="/library/lesson/:id" element={<Gate><LessonScreen /></Gate>} />
        <Route path="/library/session/:id" element={<Gate><SessionScreen /></Gate>} />
        <Route path="/library/subject/:id" element={<Gate><SubjectScreen /></Gate>} />
        <Route path="/library/book/:id" element={<Gate><BookScreen /></Gate>} />
        <Route path="/read/:scope/:id" element={<Gate><ReaderScreen /></Gate>} />
        <Route path="/me/notes" element={<Gate><NotesScreen /></Gate>} />
        <Route path="/me/tickets" element={<LegacyTicketsRedirect />} />
        <Route path="/exam" element={<Gate><ExamHome /></Gate>} />
        <Route path="/exam/practice" element={<Gate><PracticeScreen /></Gate>} />
        <Route path="/exam/history" element={<Gate><HistoryScreen /></Gate>} />
        <Route path="/exam/setup" element={<Gate><ExamSetup /></Gate>} />
        <Route path="/exam/mock/history" element={<Gate><MockExamHistory /></Gate>} />
        <Route path="/exam/run/:sid" element={<Gate><MockRun /></Gate>} />
        <Route path="/exam/result/:sid" element={<Gate><ExamResult /></Gate>} />
        <Route path="/search" element={<Gate><SearchScreen /></Gate>} />
        <Route path="/schedule" element={<Gate><ScheduleScreen /></Gate>} />
        <Route path="/ai" element={<Gate><AiChatScreen /></Gate>} />
        <Route path="/ai/:id" element={<Gate><AiChatScreen /></Gate>} />
        <Route path="/grades" element={<Gate><GradesScreen /></Gate>} />
        <Route path="/subscription" element={<Gate><SubscriptionScreen /></Gate>} />
        <Route path="/notifications" element={<Gate><NotificationsScreen /></Gate>} />
        <Route path="/tickets" element={<Gate><TicketsScreen /></Gate>} />
        <Route path="/tickets/:id" element={<Gate><TicketsScreen /></Gate>} />
        <Route
          path="/me"
          element={
            <Gate>
              <MeScreen />
            </Gate>
          }
        />
        <Route
          path="*"
          element={
            <Gate>
              <NotFoundScreen />
            </Gate>
          }
        />
        </Routes>
      </Suspense>
      {/* outside Routes: survives navigation, so a voice keeps playing across screens */}
      <MiniPlayer />
    </Layout>
  );
}
