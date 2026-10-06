import { createStore, del, get, set } from 'idb-keyval';
import { isProject } from '../engine/defaults';
import type { Project } from '../engine/types';
import { useStore } from './store';

/** Sauvegarde locale des projets dans IndexedDB. */
const db = createStore('atelier-motion', 'projets');

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  layerCount: number;
}

const INDEX_KEY = 'index';
const LAST_KEY = 'dernier-projet';

export async function listProjects(): Promise<ProjectSummary[]> {
  const index = (await get<ProjectSummary[]>(INDEX_KEY, db)) ?? [];
  return [...index].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveProject(p: Project): Promise<void> {
  await set(`projet:${p.id}`, p, db);
  const index = (await get<ProjectSummary[]>(INDEX_KEY, db)) ?? [];
  const summary: ProjectSummary = {
    id: p.id,
    name: p.name,
    updatedAt: p.updatedAt,
    layerCount: p.compositions.reduce((n, c) => n + c.layers.length, 0),
  };
  await set(INDEX_KEY, [summary, ...index.filter((x) => x.id !== p.id)], db);
  await set(LAST_KEY, p.id, db);
}

export async function loadProject(id: string): Promise<Project | null> {
  const p = await get<Project>(`projet:${id}`, db);
  return p && isProject(p) ? p : null;
}

export async function deleteProject(id: string): Promise<void> {
  await del(`projet:${id}`, db);
  const index = (await get<ProjectSummary[]>(INDEX_KEY, db)) ?? [];
  await set(INDEX_KEY, index.filter((x) => x.id !== id), db);
}

export async function loadLastProject(): Promise<Project | null> {
  const id = await get<string>(LAST_KEY, db);
  return id ? loadProject(id) : null;
}

/** Active la sauvegarde automatique : chaque modification est enregistrée après une courte pause. */
export function startAutosave(delay = 800): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = (wait: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      const p = useStore.getState().project;
      useStore.getState().setSaveStatus('saving');
      try {
        await saveProject(p);
        if (useStore.getState().project === p) useStore.getState().setSaveStatus('saved');
      } catch {
        useStore.getState().setSaveStatus('error');
      }
    }, wait);
  };
  // Un projet chargé avant l'activation (modèle de démarrage) est enregistré tout de suite.
  if (useStore.getState().saveStatus !== 'saved') schedule(0);
  const unsub = useStore.subscribe((state, prev) => {
    if (state.project !== prev.project) schedule(delay);
  });
  return () => {
    unsub();
    if (timer) clearTimeout(timer);
  };
}
