import { applyEasing } from './easing';
import type { TextMode } from './types';

export interface LetterState {
  char: string;
  /** Index du caractère dans le texte (sauts de ligne compris). */
  index: number;
  opacity: number;
  /** Décalage vertical en pixels. */
  dy: number;
  scale: number;
}

export const TEXT_MODE_LABELS: Record<TextMode, string> = {
  none: 'Aucune',
  typewriter: 'Machine à écrire',
  fade: 'Fondu lettre par lettre',
  wave: 'Vague de texte',
};

/** Nombre de lettres « en transition » simultanément pour fade / wave. */
export const LETTER_SPREAD = 3;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * État de chaque lettre pour une animation lettre par lettre.
 * `reveal` ∈ [0,1] pilote la progression globale (animable par images clés),
 * `time` sert à l'ondulation continue du mode vague.
 */
export function letterStates(
  text: string,
  mode: TextMode,
  reveal: number,
  fontSize: number,
  waveAmp: number,
  time: number,
): LetterState[] {
  const chars = Array.from(text);
  // Les sauts de ligne ne comptent pas dans la progression.
  const visibleIdx: number[] = [];
  let counter = 0;
  for (const c of chars) visibleIdx.push(c === '\n' ? -1 : counter++);
  const n = counter;
  const r = clamp01(reveal);

  return chars.map((char, index) => {
    const i = visibleIdx[index];
    if (mode === 'none' || i < 0) return { char, index, opacity: 1, dy: 0, scale: 1 };
    if (mode === 'typewriter') {
      const shown = Math.floor(r * n + 1e-6);
      return { char, index, opacity: i < shown ? 1 : 0, dy: 0, scale: 1 };
    }
    const local = clamp01((r * (n + LETTER_SPREAD) - i) / LETTER_SPREAD);
    if (mode === 'fade') {
      const e = applyEasing({ type: 'easeOut' }, local);
      return { char, index, opacity: e, dy: (1 - e) * fontSize * 0.5, scale: 1 };
    }
    // Vague : entrée avec dépassement puis ondulation sinusoïdale continue.
    const e = applyEasing({ type: 'backOut' }, local);
    const wave = Math.sin(time * Math.PI * 2 * 0.8 - i * 0.55) * waveAmp * local;
    return { char, index, opacity: clamp01(local * 1.6), dy: (1 - e) * fontSize * 0.8 + wave, scale: 0.4 + 0.6 * e };
  });
}

/** Durée conseillée pour révéler un texte (≈ 16 caractères par seconde). */
export function suggestedRevealDuration(text: string, mode: TextMode): number {
  const n = Array.from(text).filter((c) => c !== '\n').length;
  const perChar = mode === 'typewriter' ? 0.06 : 0.045;
  return Math.max(0.3, Math.round(n * perChar * 100) / 100 + (mode === 'typewriter' ? 0 : 0.3));
}
