import type { Asset } from '../engine/types';
import { notifyAssetsChanged } from './assets';
import { clearTextMetrics } from './renderer';

/** Polices personnalisées (formule Studio) enregistrées auprès du navigateur. */
const registered = new Map<string, Promise<void>>();

export const BUILTIN_FONTS = ['Inter', 'Georgia', 'Arial', 'Courier New', 'Trebuchet MS', 'Verdana'];

export function registerFonts(assets: Asset[]): Promise<void> {
  const jobs = assets
    .filter((a) => a.kind === 'font' && a.family)
    .map((a) => {
      let job = registered.get(a.id);
      if (!job) {
        const face = new FontFace(a.family!, `url(${a.src})`);
        job = face
          .load()
          .then((f) => {
            document.fonts.add(f);
            clearTextMetrics();
            notifyAssetsChanged();
          })
          .catch(() => undefined);
        registered.set(a.id, job);
      }
      return job;
    });
  return Promise.all(jobs).then(() => undefined);
}

/** Nom de famille lisible et unique à partir d'un nom de fichier. */
export function familyFromFileName(name: string, existing: string[]): string {
  const base =
    name
      .replace(/\.[^.]+$/, '')
      .replace(/[-_]+/g, ' ')
      .replace(/[^\p{L}\p{N} ]/gu, '')
      .trim() || 'Police';
  let family = base;
  let i = 2;
  while (existing.includes(family) || BUILTIN_FONTS.includes(family)) family = `${base} ${i++}`;
  return family;
}
