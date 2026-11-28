
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import './design/tokens.css';
import './design/base.css';
import './design/brand.css';
import './design/ui.css';
import './design/components.css';
import './design/shell.css';
import './design/glass.css';
import './design/motion.css';

import { App } from './App';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { UpdatedToast, UpdateOverlay } from './components/UpdateOverlay';
import { IconSprite } from './icons';
import { SessionProvider } from './lib/session';
import { isChunkLoadError, recoverFromStaleBuild, registerStudentSW } from './lib/swUpdate';
import { ThemeProvider } from './lib/theme';

const rawBase = import.meta.env.BASE_URL || '/student';
const basename = rawBase.endsWith('/') && rawBase !== '/' ? rawBase.slice(0, -1) : rawBase;

// Vite: a modulepreload / CSS chunk of the previous build is gone after a deploy.
window.addEventListener('vite:preloadError', (event) => {
  if (recoverFromStaleBuild()) event.preventDefault();
});
// Dynamic imports outside React.lazy (idle chunk warm-up) fail as unhandled rejections.
window.addEventListener('unhandledrejection', (event) => {
  if (isChunkLoadError(event.reason) && recoverFromStaleBuild()) event.preventDefault();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <IconSprite />
      <BrowserRouter basename={basename}>
        <SessionProvider>
          <AppErrorBoundary>
            <App />
          </AppErrorBoundary>
        </SessionProvider>
      </BrowserRouter>
      <UpdateOverlay />
      <UpdatedToast />
    </ThemeProvider>
  </StrictMode>,
);

registerStudentSW();
