import { Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { Suspense, lazy, useEffect } from 'react';

import { Shell } from './layout/Shell';
import { sectionFor } from './layout/section';
import { LoginScreen } from './screens/LoginScreen';
import { BlockedScreen, PendingScreen, SplashScreen } from './screens/GateScreens';
import { HomeScreen } from './screens/HomeScreen';
import { LibraryScreen } from './screens/library/LibraryScreen';
import { ExamHome } from './screens/exam/ExamHome';
import { ExamResult } from './screens/exam/ExamResult';
import { ExamSetup, MockExamHistory } from './screens/exam/ExamSetup';
import { MockRun } from './screens/exam/MockRun';
import { HistoryScreen } from './screens/exam/HistoryScreen';
import { PracticeScreen } from './screens/exam/PracticeScreen';
import { NotesScreen } from './screens/notes/NotesScreen';
import { ReaderScreen } from './screens/reader/ReaderScreen';
import {
  BookScreen,
  LessonScreen,
  SessionScreen,
  SubjectScreen,
  TermScreen,
} from './screens/library/LibraryScreens';
import { MeScreen } from './screens/MeScreen';
import { NotFoundScreen } from './screens/NotFoundScreen';
import { SearchScreen } from './screens/SearchScreen';
import { ScheduleScreen } from './screens/ScheduleScreen';
import { AiChatScreen } from './screens/ai/AiChatScreen';
import { GradesScreen } from './screens/GradesScreen';
import { SubscriptionScreen } from './screens/SubscriptionScreen';
import { NotificationsScreen } from './screens/NotificationsScreen';
import { TicketsScreen } from './screens/TicketsScreen';
import { InstallGuideScreen } from './screens/InstallGuideScreen';
import { useSession } from './lib/session';
import { SessionExpiredBanner } from './components/SessionExpiredBanner';

/* SY1: the design-system showcase and states gallery are engineering tools. They exist only in
   `vite dev`; in a production build the branch is constant-false, so neither the route nor the
   chunk ships and /system, /states fall through to the 404 screen. */
const SystemScreen = import.meta.env.DEV
  ? lazy(() => import('./screens/SystemScreen').then((m) => ({ default: m.SystemScreen })))
  : null;
const StatesScreen = import.meta.env.DEV
  ? lazy(() => import('./screens/StatesScreen').then((m) => ({ default: m.StatesScreen })))
  : null;

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    document.querySelector('.stage-content')?.scrollTo({ top: 0 });
  }, [pathname]);
  return null;
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

/** صفحههای بدون گارد و بدون نوار ناوبری. */
const PUBLIC_PATHS = ['/system', '/states', '/install'];

/** پوسته بر اساس وضعیت واقعی نشست: تببار فقط وقتی معنا دارد که
    کاربر وارد و تأییدشده باشد و در صفحههای مرجع نباشد. */
function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const { status } = useSession();
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  // ریدر فضای بیشتری میخواهد؛ تببار پایین در آن پنهان میشود
  const immersive = pathname.startsWith('/read/');
  const variant = immersive ? 'reader' : status === 'active' && !isPublic ? 'default' : 'bare';
  return (
    <Shell tabs={status === 'active' && !isPublic && !immersive} variant={variant} section={sectionFor(pathname)}>
      {children}
    </Shell>
  );
}

export function App() {
  return (
    <Layout>
      <ScrollToTop />
      {/* T3: session expired mid-use, non-blocking banner (screen stays) */}
      <SessionExpiredBanner />
      <Routes>
        <Route
          path="/login"
          element={
            <Gate>
              <HomeScreen />
            </Gate>
          }
        />
        {SystemScreen && (
          <Route path="/system" element={<Suspense fallback={null}><SystemScreen /></Suspense>} />
        )}
        {StatesScreen && (
          <Route path="/states" element={<Suspense fallback={null}><StatesScreen /></Suspense>} />
        )}
        <Route path="/install" element={<InstallGuideScreen />} />
        <Route
          path="/"
          element={
            <Gate>
              <HomeScreen />
            </Gate>
          }
        />
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
    </Layout>
  );
}
