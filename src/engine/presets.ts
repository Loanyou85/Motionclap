import { getProp } from './evaluate';
import { ensureProp, upsertKeyframe, TIME_EPS } from './keyframes';
import { layerHasProp } from './props';
import { suggestedRevealDuration } from './text';
import type { EasingType, Layer, PropKey, PropValue } from './types';

export type PresetId = 'fadeIn' | 'pop' | 'slide' | 'drop' | 'spin' | 'fadeOut' | 'typewriter' | 'wave';

export interface PresetDef {
  id: PresetId;
  label: string;
  description: string;
  textOnly?: boolean;
}

export const PRESETS: PresetDef[] = [
  { id: 'fadeIn', label: 'Apparition', description: 'Fondu d’entrée en douceur' },
  { id: 'pop', label: 'Pop', description: 'Grossit avec un léger rebond' },
  { id: 'slide', label: 'Glisser', description: 'Arrive depuis la gauche' },
  { id: 'drop', label: 'Chute', description: 'Tombe et rebondit' },
  { id: 'spin', label: 'Rotation', description: 'Un tour complet' },
  { id: 'fadeOut', label: 'Disparition', description: 'Fondu de sortie' },
  { id: 'typewriter', label: 'Machine à écrire', description: 'Lettres une à une', textOnly: true },
  { id: 'wave', label: 'Vague de texte', description: 'Lettres ondulantes', textOnly: true },
];

interface Track {
  key: PropKey;
  from: PropValue;
  to: PropValue;
  easing: EasingType;
  /** Durée propre à cette piste (sinon la durée du préréglage). */
  duration?: number;
}

/** Supprime les images clés situées dans ]start, end] pour laisser place au préréglage. */
function clearRange(layer: Layer, key: PropKey, start: number, end: number) {
  const p = ensureProp(layer, key);
  p.keyframes = p.keyframes.filter((k) => k.time < start - TIME_EPS || k.time > end + TIME_EPS);
}

/**
 * Applique un préréglage au calque à partir du temps t.
 * Le préréglage est recalé pour tenir dans la durée de la composition.
 * Renvoie false si le préréglage ne s'applique pas à ce type de calque.
 */
export function applyPreset(layer: Layer, id: PresetId, t: number, compDuration: number): boolean {
  const def = PRESETS.find((p) => p.id === id);
  if (!def) return false;
  if (def.textOnly && layer.type !== 'text') return false;

  const num = (k: PropKey) => getProp(layer, k, t) as number;
  let duration = 0.6;
  let tracks: Track[] = [];

  switch (id) {
    case 'fadeIn':
      tracks = [{ key: 'opacity', from: 0, to: num('opacity') || 1, easing: 'easeOut' }];
      break;
    case 'pop': {
      duration = 0.5;
      tracks = [
        { key: 'scaleX', from: 0, to: num('scaleX') || 1, easing: 'backOut' },
        { key: 'scaleY', from: 0, to: num('scaleY') || 1, easing: 'backOut' },
        { key: 'opacity', from: 0, to: num('opacity') || 1, easing: 'easeOut', duration: 0.2 },
      ];
      break;
    }
    case 'slide':
      duration = 0.7;
      tracks = [
        { key: 'x', from: num('x') - 320, to: num('x'), easing: 'easeOut' },
        { key: 'opacity', from: 0, to: num('opacity') || 1, easing: 'easeOut', duration: 0.4 },
      ];
      break;
    case 'drop':
      duration = 1;
      tracks = [
        { key: 'y', from: num('y') - 420, to: num('y'), easing: 'bounceOut' },
        { key: 'opacity', from: 0, to: num('opacity') || 1, easing: 'linear', duration: 0.15 },
      ];
      break;
    case 'spin':
      duration = 1;
      tracks = [{ key: 'rotation', from: num('rotation'), to: num('rotation') + 360, easing: 'easeInOut' }];
      break;
    case 'fadeOut':
      tracks = [{ key: 'opacity', from: num('opacity') || 1, to: 0, easing: 'easeIn' }];
      break;
    case 'typewriter':
    case 'wave': {
      layer.textMode = id;
      duration = suggestedRevealDuration(layer.text ?? '', id);
      tracks = [{ key: 'reveal', from: 0, to: 1, easing: 'linear' }];
      break;
    }
  }

  const start = Math.max(0, Math.min(t, compDuration - duration));
  for (const tr of tracks) {
    if (!layerHasProp(layer.type, tr.key)) continue;
    const end = Math.min(compDuration, start + (tr.duration ?? duration));
    clearRange(layer, tr.key, start, end);
    const p = ensureProp(layer, tr.key);
    upsertKeyframe(p, start, tr.from, { type: tr.easing });
    upsertKeyframe(p, end, tr.to, { type: tr.easing });
  }
  return true;
}
