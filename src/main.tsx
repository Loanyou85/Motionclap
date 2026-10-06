import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { loadLastProject, startAutosave } from './store/persistence';
import { useStore } from './store/store';
import { TEMPLATES } from './templates';

async function boot() {
  // Reprend le dernier projet enregistré, sinon ouvre le modèle « Intro logo ».
  try {
    const last = await loadLastProject();
    if (last) {
      useStore.getState().loadProject(last);
      useStore.setState({ saveStatus: 'saved' });
    } else {
      useStore.getState().loadProject(TEMPLATES[0].build());
    }
  } catch {
    useStore.getState().loadProject(TEMPLATES[0].build());
  }
  startAutosave();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
