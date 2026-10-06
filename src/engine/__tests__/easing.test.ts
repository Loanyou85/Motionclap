import { describe, expect, it } from 'vitest';
import { applyEasing, cubicBezier, easingToBezier, EASING_TYPES, sampleEasing } from '../easing';

describe('courbes d’animation', () => {
  it('toutes les courbes partent de 0 et arrivent à 1', () => {
    for (const type of EASING_TYPES) {
      expect(applyEasing({ type }, 0)).toBeCloseTo(0, 5);
      expect(applyEasing({ type }, 1)).toBeCloseTo(1, 5);
    }
  });

  it('linéaire renvoie la progression', () => {
    expect(applyEasing({ type: 'linear' }, 0.37)).toBeCloseTo(0.37);
  });

  it('maintien reste sur la valeur de départ jusqu’à la fin du segment', () => {
    expect(applyEasing({ type: 'hold' }, 0.5)).toBe(0);
    expect(applyEasing({ type: 'hold' }, 0.999)).toBe(0);
    expect(applyEasing({ type: 'hold' }, 1)).toBe(1);
  });

  it('ease-in est sous la diagonale, ease-out au-dessus', () => {
    expect(applyEasing({ type: 'easeIn' }, 0.5)).toBeLessThan(0.5);
    expect(applyEasing({ type: 'easeOut' }, 0.5)).toBeGreaterThan(0.5);
    expect(applyEasing({ type: 'easeInOut' }, 0.5)).toBeCloseTo(0.5, 2);
  });

  it('cubic-bezier correspond aux valeurs de référence CSS « ease »', () => {
    // Valeurs de référence calculées pour cubic-bezier(.25,.1,.25,1)
    expect(cubicBezier(0.25, 0.1, 0.25, 1, 0.25)).toBeCloseTo(0.4085, 3);
    expect(cubicBezier(0.25, 0.1, 0.25, 1, 0.5)).toBeCloseTo(0.8024, 3);
  });

  it('cubic-bezier personnalisée utilise les points fournis', () => {
    const e = { type: 'cubicBezier' as const, bezier: [0, 0, 1, 1] as [number, number, number, number] };
    expect(applyEasing(e, 0.3)).toBeCloseTo(0.3, 4);
  });

  it('back out dépasse 1 avant de revenir', () => {
    const max = Math.max(...sampleEasing({ type: 'backOut' }, 100).map(([, y]) => y));
    expect(max).toBeGreaterThan(1.05);
  });

  it('back in passe sous 0 au début', () => {
    expect(applyEasing({ type: 'backIn' }, 0.2)).toBeLessThan(0);
  });

  it('élastique oscille autour de 1', () => {
    const ys = sampleEasing({ type: 'elasticOut' }, 200).map(([, y]) => y);
    expect(Math.max(...ys)).toBeGreaterThan(1.1);
    expect(ys.some((y) => y < 1 && y > 0.8)).toBe(true);
  });

  it('rebond reste dans [0,1] et touche 1 plusieurs fois', () => {
    const ys = sampleEasing({ type: 'bounceOut' }, 400).map(([, y]) => y);
    expect(Math.max(...ys)).toBeLessThanOrEqual(1.0000001);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(applyEasing({ type: 'bounceOut' }, 1 / 2.75)).toBeCloseTo(1, 5);
  });

  it('borne la progression hors de [0,1]', () => {
    expect(applyEasing({ type: 'linear' }, -1)).toBe(0);
    expect(applyEasing({ type: 'linear' }, 2)).toBe(1);
  });

  it('expose la bezier équivalente seulement si elle existe', () => {
    expect(easingToBezier({ type: 'backOut' })).toEqual([0.34, 1.56, 0.64, 1]);
    expect(easingToBezier({ type: 'bounceOut' })).toBeNull();
    expect(easingToBezier({ type: 'cubicBezier', bezier: [0.1, 0.2, 0.3, 0.4] })).toEqual([0.1, 0.2, 0.3, 0.4]);
  });
});
