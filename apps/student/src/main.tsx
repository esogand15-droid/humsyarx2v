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
import { IconSprite } from './icons';
import { SessionProvider } from './lib/session';
import { registerStudentSW } from './lib/swUpdate';
import { ThemeProvider } from './lib/theme';

const rawBase = import.meta.env.BASE_URL || '/student';
const basename = rawBase.endsWith('/') && rawBase !== '/' ? rawBase.slice(0, -1) : rawBase;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <IconSprite />
      <BrowserRouter basename={basename}>
        <SessionProvider>
          <App />
        </SessionProvider>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);

registerStudentSW();

