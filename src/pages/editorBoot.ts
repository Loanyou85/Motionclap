import { useAuth } from '../account/auth';
import { CloudError, listCloudProjects, loadCloudProject, saveCloudProject } from '../account/cloud';
import { useUpgrade } from '../billing/gates';
import { cloudEnabled } from '../lib/supabase';
import { registerFonts } from '../render/fonts';
import { loadLastProject, migrateLegacyProjects, setPersistenceScope, setRemoteSaver, startAutosave } from '../store/persistence';
import { useStore } from '../store/store';
import { TEMPLATES } from '../templates';
import { createProject } from '../engine/defaults';

let booted = false;
let stopAutosave: (() => void) | null = null;
let stopFonts: (() => void) | null = null;

export const isEditorBooted = () => booted;

function onRemoteError(e: unknown) {
  const st = useStore.getState();
  if (e instanceof CloudError && (e.code === 'project_limit' || e.code === 'storage_quota')) {
    useUpgrade.getState().show(`${e.message} Le projet reste enregistré dans ce navigateur.`, e.code === 'storage_quota' ? 'studio' : 'pro');
  } else {
    st.notify(`Synchronisation en ligne impossible : ${(e as Error).message}. Copie locale conservée.`, 'error');
  }
}

/**
 * Ouvre le projet de travail : le plus récent en ligne si l'on est connecté,
 * sinon le dernier projet du navigateur, sinon le modèle « Intro logo ».
 */
export async function bootEditor(): Promise<void> {
  if (booted) return;
  booted = true;
  await migrateLegacyProjects().catch(() => undefined);
  const user = useAuth.getState().user;
  setPersistenceScope(user ? user.id : 'local');
  const st = useStore.getState();

  let project = null;
  if (user && cloudEnabled) {
    setRemoteSaver(saveCloudProject, onRemoteError);
    const local = await loadLastProject().catch(() => null);
    try {
      const list = await listCloudProjects();
      // Une copie locale modifiée hors ligne, plus récente que sa version en ligne, l'emporte.
      const newerLocal = local && list.some((p) => p.id === local.id && local.updatedAt > Date.parse(p.updated_at));
      if (newerLocal) project = local;
      else if (list[0]) project = await loadCloudProject(list[0].id);
      else project = local;
    } catch (e) {
      onRemoteError(e);
      project = local;
    }
  } else {
    setRemoteSaver(null);
    project = await loadLastProject().catch(() => null);
  }

  if (project) {
    st.loadProject(project);
    useStore.setState({ saveStatus: 'saved' });
  } else {
    st.loadProject(TEMPLATES[0].build());
  }
  stopAutosave = startAutosave();
  // Polices personnalisées du projet ouvert (et de ceux chargés ensuite).
  void registerFonts(useStore.getState().project.assets);
  stopFonts = useStore.subscribe((s, prev) => {
    if (s.project.assets !== prev.project.assets) void registerFonts(s.project.assets);
  });
}

/** Changement de compte : l'éditeur sera rechargé avec les projets du nouveau compte. */
export function resetEditor(): void {
  stopAutosave?.();
  stopFonts?.();
  stopAutosave = stopFonts = null;
  setRemoteSaver(null);
  booted = false;
  // Ne pas laisser le projet du compte précédent à l'écran.
  useStore.getState().loadProject(createProject());
  useStore.setState({ saveStatus: 'saved' });
}

// Réinitialisation synchrone, avant le rendu de l'éditeur du nouveau compte.
useAuth.subscribe((s, prev) => {
  if ((s.user?.id ?? null) !== (prev.user?.id ?? null) && booted) resetEditor();
});
