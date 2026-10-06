import { isProject } from '../engine/defaults';
import type { Asset, Project } from '../engine/types';
import { supabase } from '../lib/supabase';
import { useAuth } from './auth';

/**
 * Projets en ligne (table `projects`) et ressources (bucket privé `assets`).
 * Dans la base, la source d'une ressource est une référence « storage:<chemin> » ;
 * en mémoire et dans IndexedDB, elle reste une data URL utilisable hors ligne.
 */

const REF = 'storage:';
const uploaded = new Map<string, string>(); // clé : identifiant de ressource + taille → chemin

export interface CloudProjectSummary {
  id: string;
  name: string;
  updated_at: string;
  size_bytes: number;
}

export class CloudError extends Error {
  constructor(
    public code: 'project_limit' | 'storage_quota' | 'forbidden' | 'other',
    message: string,
  ) {
    super(message);
  }
}

function toCloudError(e: { message?: string; code?: string; statusCode?: string } | null): CloudError {
  const msg = e?.message ?? 'Erreur inconnue';
  if (msg.includes('project_limit')) return new CloudError('project_limit', 'Limite de projets atteinte pour votre formule.');
  if (msg.includes('storage_quota')) return new CloudError('storage_quota', 'Espace de stockage insuffisant pour votre formule.');
  if (msg.includes('row-level security') || e?.statusCode === '403') return new CloudError('forbidden', 'Cette ressource n’est pas autorisée par votre formule.');
  return new CloudError('other', msg);
}

const userId = () => useAuth.getState().user?.id ?? null;
export const isCloudActive = () => !!supabase && !!userId();

const FOLDER: Record<string, string> = { audio: 'audio', image: 'images', font: 'fonts' };

function extensionOf(dataUrl: string): string {
  const mime = dataUrl.slice(5, dataUrl.indexOf(';'));
  return (
    { 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'font/woff2': 'woff2', 'font/woff': 'woff', 'font/ttf': 'ttf', 'font/otf': 'otf' }[mime] ?? 'bin'
  );
}

async function dataUrlToBlob(src: string): Promise<Blob> {
  return (await fetch(src)).blob();
}

/** Envoie les ressources pas encore stockées et renvoie le projet avec des références. */
async function withAssetRefs(project: Project): Promise<Project> {
  const uid = userId()!;
  const assets: Asset[] = [];
  for (const a of project.assets) {
    if (!a.src.startsWith('data:')) {
      assets.push(a);
      continue;
    }
    const key = `${a.id}:${a.src.length}`;
    let path = uploaded.get(key);
    if (!path) {
      path = `${uid}/${FOLDER[a.kind] ?? 'audio'}/${a.id}.${extensionOf(a.src)}`;
      const blob = await dataUrlToBlob(a.src);
      const { error } = await supabase!.storage.from('assets').upload(path, blob, { upsert: true, contentType: blob.type || undefined });
      if (error) throw toCloudError(error as { message: string; statusCode?: string });
      uploaded.set(key, path);
    }
    assets.push({ ...a, src: `${REF}${path}` });
  }
  return { ...project, assets };
}

/** Télécharge les ressources référencées et les remet en data URL. */
async function withDataUrls(project: Project): Promise<Project> {
  const assets = await Promise.all(
    project.assets.map(async (a) => {
      if (!a.src.startsWith(REF)) return a;
      const path = a.src.slice(REF.length);
      const { data, error } = await supabase!.storage.from('assets').download(path);
      if (error || !data) return a;
      const src = await new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.readAsDataURL(data);
      });
      uploaded.set(`${a.id}:${src.length}`, path);
      return { ...a, src };
    }),
  );
  return { ...project, assets };
}

export async function saveCloudProject(project: Project): Promise<void> {
  if (!isCloudActive()) return;
  const data = await withAssetRefs(project);
  const { error } = await supabase!.from('projects').upsert({ user_id: userId(), id: project.id, name: project.name, data }, { onConflict: 'user_id,id' });
  if (error) throw toCloudError(error);
}

export async function listCloudProjects(): Promise<CloudProjectSummary[]> {
  if (!isCloudActive()) return [];
  const { data, error } = await supabase!.from('projects').select('id,name,updated_at,size_bytes').order('updated_at', { ascending: false });
  if (error) throw toCloudError(error);
  return data ?? [];
}

export async function countCloudProjects(): Promise<number> {
  if (!isCloudActive()) return 0;
  const { count, error } = await supabase!.from('projects').select('id', { count: 'exact', head: true });
  if (error) throw toCloudError(error);
  return count ?? 0;
}

export async function loadCloudProject(id: string): Promise<Project | null> {
  if (!isCloudActive()) return null;
  const { data, error } = await supabase!.from('projects').select('data').eq('id', id).maybeSingle();
  if (error) throw toCloudError(error);
  if (!data || !isProject(data.data)) return null;
  return withDataUrls(data.data);
}

export async function deleteCloudProject(id: string): Promise<void> {
  if (!isCloudActive()) return;
  const { data } = await supabase!.from('projects').select('data').eq('id', id).maybeSingle();
  const refs = ((data?.data as Project | undefined)?.assets ?? []).filter((a) => a.src.startsWith(REF)).map((a) => a.src.slice(REF.length));
  const { error } = await supabase!.from('projects').delete().eq('id', id);
  if (error) throw toCloudError(error);
  if (refs.length) await supabase!.storage.from('assets').remove(refs);
}

/** Export de toutes les données du compte (portabilité RGPD). */
export async function exportAllData(): Promise<Blob> {
  const list = await listCloudProjects();
  const projects = [];
  for (const p of list) projects.push(await loadCloudProject(p.id));
  const { user, subscription } = useAuth.getState();
  const payload = {
    exporte_le: new Date().toISOString(),
    compte: { id: user?.id, email: user?.email, cree_le: user?.created_at },
    abonnement: subscription,
    projets: projects.filter(Boolean),
  };
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}
