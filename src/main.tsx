import '@fontsource-variable/inter';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { useAuth } from './account/auth';
import App from './App';
import './index.css';

// La session est restaurée avant le premier rendu (redirections fiables).
void useAuth
  .getState()
  .init()
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
