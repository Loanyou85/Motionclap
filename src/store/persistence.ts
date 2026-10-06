import { createStore, del, get, set } from 'idb-keyval';
import { isProject } from '../engine/defaults';
import type { Project } from '../engine/types';
import { useStore } from './store';

/**
 * Sauvegarde locale des projets dans IndexedDB, cloisonnée par compte
 * (« local » sans compte, sinon l'identifiant de l'utilisateur).
 * La synchronisation en ligne est branchée via `setRemoteSaver`.
 */
const db = createStore('atelier-motion', 'projets');
let scope = 'local';

export function setPersistenceScope(s: string): void {
  scope = s;
}

const key = (k: string) => `${scope}:${k}`;

/** Reprise des projets enregistrés avant le cloisonnement par compte. */
export async function migrateLegacyProjects(): Promise<void> {
  const legacy = await get<ProjectSummary[]>('index', db);
  if (!legacy || (await get('local:index', db))) return;
  for (const s of legacy) {
    const p = await get<Project>(`projet:${s.id}`, db);
    if (p) await set(`local:projet:${s.id}`, p, db);
  }
  await set('local:index', legacy, db);
  const last = await get<string>('dernier-projet', db);
  if (last) await set('local:dernier-projet', last, db);
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  layerCount: number;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const index = (await get<ProjectSummary[]>(key('index'), db)) ?? [];
  return [...index].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveProject(p: Project): Promise<void> {
  await set(key(`projet:${p.id}`), p, db);
  const index = (await get<ProjectSummary[]>(key('index'), db)) ?? [];
  const summary: ProjectSummary = {
    id: p.id,
    name: p.name,
    updatedAt: p.updatedAt,
    layerCount: p.compositions.reduce((n, c) => n + c.layers.length, 0),
  };
  await set(key('index'), [summary, ...index.filter((x) => x.id !== p.id)], db);
  await set(key('dernier-projet'), p.id, db);
}

export async function loadProject(id: string): Promise<Project | null> {
  const p = await get<Project>(key(`projet:${id}`), db);
  return p && isProject(p) ? p : null;
}

export async function deleteProject(id: string): Promise<void> {
  await del(key(`projet:${id}`), db);
  const index = (await get<ProjectSummary[]>(key('index'), db)) ?? [];
  await set(key('index'), index.filter((x) => x.id !== id), db);
}

export async function loadLastProject(): Promise<Project | null> {
  const id = await get<string>(key('dernier-projet'), db);
  return id ? loadProject(id) : null;
}

type RemoteSaver = (p: Project) => Promise<void>;
let remoteSaver: RemoteSaver | null = null;
let onRemoteError: ((e: unknown) => void) | null = null;

/** Sauvegarde distante (projets en ligne), appelée après la sauvegarde locale. */
export function setRemoteSaver(fn: RemoteSaver | null, onError?: (e: unknown) => void): void {
  remoteSaver = fn;
  onRemoteError = onError ?? null;
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
        if (remoteSaver) await remoteSaver(p);
        if (useStore.getState().project === p) useStore.getState().setSaveStatus('saved');
      } catch (e) {
        useStore.getState().setSaveStatus('error');
        onRemoteError?.(e);
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
