import { describe, expect, it } from 'vitest';
import { computePeaks } from '../audio';
import { createComposition, createLayer, isProject, createProject } from '../defaults';
import {
  canParent,
  evaluateLayer,
  getNum,
  getProp,
  inheritedOpacity,
  isActiveAt,
  isEffectivelyVisible,
  layerMap,
  maskLayerIds,
  worldMatrix,
} from '../evaluate';
import { evaluateProp } from '../interpolate';
import {
  removeKeyframes,
  setKeyframeEasing,
  setPropValue,
  shiftKeyframes,
  toggleKeyframe,
  upsertKeyframe,
} from '../keyframes';
import { apply, decompose, fromTRS, invert, multiply } from '../matrix';
import { applyPreset } from '../presets';
import { letterStates, suggestedRevealDuration } from '../text';
import { polygonPoints, starPoints } from '../shapes';
import type { AnimProp } from '../types';

const comp = createComposition();

describe('interpolation des images clés', () => {
  const prop: AnimProp = {
    value: 0,
    keyframes: [
      { id: 'a', time: 1, value: 0, easing: { type: 'linear' } },
      { id: 'b', time: 3, value: 100, easing: { type: 'hold' } },
      { id: 'c', time: 4, value: 50, easing: { type: 'linear' } },
    ],
  };

  it('avant la première image clé : valeur de la première', () => {
    expect(evaluateProp(prop, 'number', 0)).toBe(0);
  });

  it('interpole linéairement', () => {
    expect(evaluateProp(prop, 'number', 2)).toBe(50);
  });

  it('maintien : garde la valeur puis saute', () => {
    expect(evaluateProp(prop, 'number', 3.5)).toBe(100);
    expect(evaluateProp(prop, 'number', 4)).toBe(50);
  });

  it('après la dernière : valeur de la dernière', () => {
    expect(evaluateProp(prop, 'number', 10)).toBe(50);
  });

  it('sans image clé : valeur statique', () => {
    expect(evaluateProp({ value: 7, keyframes: [] }, 'number', 2)).toBe(7);
  });

  it('interpole les couleurs', () => {
    const c: AnimProp = {
      value: '#000000',
      keyframes: [
        { id: 'a', time: 0, value: '#000000', easing: { type: 'linear' } },
        { id: 'b', time: 1, value: '#FFFFFF', easing: { type: 'linear' } },
      ],
    };
    expect(evaluateProp(c, 'color', 0.5)).toBe('#808080');
  });

  it('interpole les tracés (morphing)', () => {
    const p: AnimProp = {
      value: '',
      keyframes: [
        { id: 'a', time: 0, value: 'M 0 0 L 10 0 L 10 10 Z', easing: { type: 'linear' } },
        { id: 'b', time: 1, value: 'M 0 0 L 20 0 L 20 20 Z', easing: { type: 'linear' } },
      ],
    };
    expect(String(evaluateProp(p, 'path', 0.5))).toContain('15');
  });
});

describe('édition des images clés', () => {
  it('setPropValue modifie la valeur fixe si la propriété n’est pas animée', () => {
    const l = createLayer('rect', comp);
    setPropValue(l, 'x', 42, 1);
    expect(l.props.x!.value).toBe(42);
    expect(l.props.x!.keyframes).toHaveLength(0);
  });

  it('setPropValue crée une image clé si la propriété est animée', () => {
    const l = createLayer('rect', comp);
    toggleKeyframe(l, 'x', 0);
    setPropValue(l, 'x', 500, 2);
    expect(l.props.x!.keyframes.map((k) => k.time)).toEqual([0, 2]);
    expect(getNum(l, "x", 1)).toBeLessThan(960);
    expect(getNum(l, "x", 1)).toBeGreaterThan(500);
  });

  it('toggleKeyframe ajoute puis retire, en conservant la valeur', () => {
    const l = createLayer('rect', comp);
    toggleKeyframe(l, 'opacity', 1);
    expect(l.props.opacity!.keyframes).toHaveLength(1);
    toggleKeyframe(l, 'opacity', 1);
    expect(l.props.opacity!.keyframes).toHaveLength(0);
    expect(l.props.opacity!.value).toBe(1);
  });

  it('les images clés restent triées et peuvent être déplacées', () => {
    const l = createLayer('rect', comp);
    const p = l.props.x!;
    const k2 = upsertKeyframe(p, 2, 10);
    upsertKeyframe(p, 1, 0);
    expect(p.keyframes.map((k) => k.time)).toEqual([1, 2]);
    shiftKeyframes(l, new Set([k2.id]), -1.5, comp.duration);
    expect(p.keyframes.map((k) => k.time)).toEqual([0.5, 1]);
    shiftKeyframes(l, new Set([k2.id]), -10, comp.duration);
    expect(p.keyframes[0].time).toBe(0);
  });

  it('une nouvelle image clé hérite de la courbe précédente', () => {
    const l = createLayer('rect', comp);
    const p = l.props.y!;
    upsertKeyframe(p, 0, 0, { type: 'bounceOut' });
    const k = upsertKeyframe(p, 1, 10);
    expect(k.easing.type).toBe('bounceOut');
  });

  it('suppression et changement de courbe', () => {
    const l = createLayer('rect', comp);
    const a = upsertKeyframe(l.props.x!, 0, 0);
    const b = upsertKeyframe(l.props.x!, 1, 100);
    setKeyframeEasing(l, new Set([a.id]), { type: 'elasticOut' });
    expect(l.props.x!.keyframes[0].easing.type).toBe('elasticOut');
    removeKeyframes(l, new Set([a.id, b.id]));
    expect(l.props.x!.keyframes).toHaveLength(0);
    expect(l.props.x!.value).toBe(0);
  });
});

describe('matrices et parentage', () => {
  it('compose translation, rotation et échelle', () => {
    const m = fromTRS(10, 20, 90, 2, 2);
    const [x, y] = apply(m, 1, 0);
    expect(x).toBeCloseTo(10);
    expect(y).toBeCloseTo(22);
  });

  it('inverse une matrice', () => {
    const m = fromTRS(5, -3, 33, 1.5, 0.5);
    const inv = invert(m)!;
    const [x, y] = apply(multiply(inv, m), 7, 9);
    expect(x).toBeCloseTo(7);
    expect(y).toBeCloseTo(9);
  });

  it('décompose une matrice', () => {
    const d = decompose(fromTRS(3, 4, 45, 2, 3));
    expect(d.rotation).toBeCloseTo(45);
    expect(d.scaleX).toBeCloseTo(2);
    expect(d.scaleY).toBeCloseTo(3);
  });

  it('un enfant suit la transformation de son parent', () => {
    const c = createComposition();
    const parent = createLayer('rect', c, {}, { x: 100, y: 100, rotation: 90 });
    const child = createLayer('ellipse', c, { parentId: parent.id }, { x: 50, y: 0 });
    c.layers.push(parent, child);
    const m = worldMatrix(child, layerMap(c), 0);
    const [x, y] = apply(m, 0, 0);
    expect(x).toBeCloseTo(100);
    expect(y).toBeCloseTo(150);
  });

  it('les groupes transmettent opacité et visibilité', () => {
    const c = createComposition();
    const g = createLayer('group', c, {}, { opacity: 0.5 });
    const child = createLayer('rect', c, { parentId: g.id }, { opacity: 0.5 });
    c.layers.push(g, child);
    const map = layerMap(c);
    expect(inheritedOpacity(child, map, 0)).toBeCloseTo(0.25);
    g.visible = false;
    expect(isEffectivelyVisible(child, map)).toBe(false);
  });

  it('refuse un parentage cyclique', () => {
    const c = createComposition();
    const a = createLayer('rect', c);
    const b = createLayer('rect', c, { parentId: a.id });
    c.layers.push(a, b);
    expect(canParent(c, a.id, b.id)).toBe(false);
    expect(canParent(c, b.id, a.id)).toBe(true);
    expect(canParent(c, a.id, a.id)).toBe(false);
  });

  it('identifie les calques masques et la plage active', () => {
    const c = createComposition();
    const m = createLayer('ellipse', c);
    const l = createLayer('rect', c, { maskId: m.id, inPoint: 1, outPoint: 2 });
    c.layers.push(m, l);
    expect(maskLayerIds(c).has(m.id)).toBe(true);
    expect(isActiveAt(l, 0.5)).toBe(false);
    expect(isActiveAt(l, 1.5)).toBe(true);
  });
});

describe('calques et formes', () => {
  it('crée un calque centré avec des valeurs par défaut', () => {
    const l = createLayer('star', comp);
    const v = evaluateLayer(l, 0);
    expect(v.x).toBe(960);
    expect(v.points).toBe(5);
    expect(l.props.width).toBeUndefined();
  });

  it('arrondit les propriétés entières', () => {
    const l = createLayer('polygon', comp);
    upsertKeyframe(l.props.points!, 0, 3, { type: 'linear' });
    upsertKeyframe(l.props.points!, 1, 8, { type: 'linear' });
    expect(getProp(l, 'points', 0.5)).toBe(6);
  });

  it('génère les sommets d’étoile et de polygone', () => {
    expect(starPoints(5, 100, 0.5)).toHaveLength(10);
    const poly = polygonPoints(4, 10);
    expect(poly[0][1]).toBeCloseTo(-10);
  });

  it('valide la forme d’un projet', () => {
    expect(isProject(createProject())).toBe(true);
    expect(isProject({ foo: 1 })).toBe(false);
  });
});

describe('texte lettre par lettre', () => {
  it('machine à écrire : affiche n lettres selon la révélation', () => {
    const s = letterStates('Bonjour', 'typewriter', 3 / 7, 50, 0, 0);
    expect(s.filter((l) => l.opacity === 1).map((l) => l.char).join('')).toBe('Bon');
  });

  it('fondu : progression ordonnée des lettres', () => {
    const s = letterStates('abcdef', 'fade', 0.4, 50, 0, 0);
    for (let i = 1; i < s.length; i++) expect(s[i].opacity).toBeLessThanOrEqual(s[i - 1].opacity);
    expect(letterStates('abc', 'fade', 1, 50, 0, 0).every((l) => l.opacity === 1)).toBe(true);
    expect(letterStates('abc', 'fade', 0, 50, 0, 0).every((l) => l.opacity === 0)).toBe(true);
  });

  it('vague : décalage vertical qui varie dans le temps', () => {
    const a = letterStates('vague', 'wave', 1, 50, 20, 0);
    const b = letterStates('vague', 'wave', 1, 50, 20, 0.3);
    expect(a.map((l) => l.dy)).not.toEqual(b.map((l) => l.dy));
    expect(Math.max(...a.map((l) => Math.abs(l.dy)))).toBeLessThanOrEqual(20.0001);
  });

  it('ignore les sauts de ligne dans la progression', () => {
    const s = letterStates('ab\ncd', 'typewriter', 0.5, 50, 0, 0);
    expect(s[2].opacity).toBe(1);
    expect(s.filter((l) => l.char !== '\n' && l.opacity === 1)).toHaveLength(2);
  });

  it('suggère une durée proportionnelle au texte', () => {
    expect(suggestedRevealDuration('a'.repeat(20), 'typewriter')).toBeCloseTo(1.2);
  });
});

describe('préréglages', () => {
  it('Pop : échelle de 0 à la valeur d’origine avec back out', () => {
    const l = createLayer('rect', comp);
    applyPreset(l, 'pop', 1, comp.duration);
    expect(getNum(l, 'scaleX', 1)).toBe(0);
    expect(getNum(l, 'scaleX', 1.5)).toBe(1);
    expect(getNum(l, 'scaleX', 1.3)).toBeGreaterThan(0.9);
    expect(l.props.scaleX!.keyframes[0].easing.type).toBe('backOut');
  });

  it('Glisser : part de la gauche et revient à la position', () => {
    const l = createLayer('rect', comp);
    applyPreset(l, 'slide', 0, comp.duration);
    expect(getNum(l, 'x', 0)).toBe(960 - 320);
    expect(getNum(l, 'x', 0.7)).toBe(960);
  });

  it('se recale pour tenir dans la composition', () => {
    const l = createLayer('rect', comp);
    applyPreset(l, 'fadeOut', comp.duration, comp.duration);
    const times = l.props.opacity!.keyframes.map((k) => k.time);
    expect(Math.max(...times)).toBeLessThanOrEqual(comp.duration);
    expect(getNum(l, 'opacity', comp.duration)).toBe(0);
  });

  it('Machine à écrire : réservé au texte', () => {
    const r = createLayer('rect', comp);
    expect(applyPreset(r, 'typewriter', 0, comp.duration)).toBe(false);
    const t = createLayer('text', comp, { text: 'Salut' });
    expect(applyPreset(t, 'typewriter', 0, comp.duration)).toBe(true);
    expect(t.textMode).toBe('typewriter');
    expect(getNum(t, 'reveal', 0)).toBe(0);
  });

  it('Chute utilise la courbe rebond', () => {
    const l = createLayer('ellipse', comp);
    applyPreset(l, 'drop', 0, comp.duration);
    expect(l.props.y!.keyframes[0].easing.type).toBe('bounceOut');
  });
});

describe('audio', () => {
  it('calcule les crêtes de la forme d’onde', () => {
    const data = new Float32Array([0, 0.5, -1, 0.25, 0, 0, 0.1, -0.2]);
    expect(computePeaks([data], 4)).toEqual([0.5, 1, 0, 0.2].map((v) => expect.closeTo(v, 5)));
    expect(computePeaks([new Float32Array(0)], 3)).toEqual([0, 0, 0]);
  });
});
