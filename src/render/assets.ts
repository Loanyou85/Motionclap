import { computePeaks } from '../engine/audio';
import type { Asset } from '../engine/types';

/**
 * Cache des ressources décodées (images, sons) partagé par le rendu,
 * la timeline et l'export. Les écouteurs sont prévenus quand une image finit de charger.
 */
const images = new Map<string, HTMLImageElement>();
const audioBuffers = new Map<string, AudioBuffer>();
const audioPending = new Map<string, Promise<AudioBuffer | null>>();
const listeners = new Set<() => void>();

export function onAssetLoaded(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifyAssetsChanged() {
  notify();
}

function notify() {
  for (const fn of listeners) fn();
}

/** Image prête à dessiner, ou null tant qu'elle charge. */
export function getImage(asset: Asset | undefined): HTMLImageElement | null {
  if (!asset || asset.kind !== 'image') return null;
  let img = images.get(asset.id);
  if (!img) {
    img = new Image();
    img.decoding = 'async';
    img.onload = notify;
    img.src = asset.src;
    images.set(asset.id, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/** Attend le chargement de toutes les images (export vidéo : pas d'image manquante). */
export async function preloadImages(assets: Asset[]): Promise<void> {
  await Promise.all(
    assets
      .filter((a) => a.kind === 'image')
      .map(
        (a) =>
          new Promise<void>((resolve) => {
            getImage(a);
            const img = images.get(a.id)!;
            if (img.complete) resolve();
            else {
              img.addEventListener('load', () => resolve(), { once: true });
              img.addEventListener('error', () => resolve(), { once: true });
            }
          }),
      ),
  );
}

let audioCtx: AudioContext | null = null;
export function getAudioContext(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

async function dataUrlToArrayBuffer(src: string): Promise<ArrayBuffer> {
  const res = await fetch(src);
  return res.arrayBuffer();
}

export function getAudioBuffer(asset: Asset | undefined): AudioBuffer | null {
  if (!asset) return null;
  return audioBuffers.get(asset.id) ?? null;
}

/** Décode un son (une seule fois) et prévient les écouteurs. */
export function loadAudioBuffer(asset: Asset): Promise<AudioBuffer | null> {
  const ready = audioBuffers.get(asset.id);
  if (ready) return Promise.resolve(ready);
  let p = audioPending.get(asset.id);
  if (!p) {
    p = dataUrlToArrayBuffer(asset.src)
      .then((buf) => getAudioContext().decodeAudioData(buf))
      .then((decoded) => {
        audioBuffers.set(asset.id, decoded);
        notify();
        return decoded;
      })
      .catch(() => null);
    audioPending.set(asset.id, p);
  }
  return p;
}

const peaksCache = new Map<string, number[]>();

/** Crêtes de la forme d'onde, mises en cache par ressource et résolution. */
export function getPeaks(asset: Asset, buckets: number): number[] | null {
  const buffer = audioBuffers.get(asset.id);
  if (!buffer) return null;
  const key = `${asset.id}:${buckets}`;
  let peaks = peaksCache.get(key);
  if (!peaks) {
    const channels: Float32Array[] = [];
    for (let i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));
    peaks = computePeaks(channels, buckets);
    peaksCache.set(key, peaks);
  }
  return peaks;
}
