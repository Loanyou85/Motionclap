import { describe, expect, it } from 'vitest';
import {
  centerPath,
  morphPath,
  normalizePair,
  parsePath,
  pathBounds,
  pathLength,
  serializePath,
  splitCubic,
} from '../path';

describe('tracés SVG', () => {
  it('analyse un carré avec commandes absolues', () => {
    const p = parsePath('M0 0 L10 0 L10 10 L0 10 Z');
    expect(p).toHaveLength(1);
    expect(p[0].closed).toBe(true);
    // 3 lignes + segment de fermeture
    expect(p[0].segs).toHaveLength(4);
    expect(p[0].segs[3].slice(4)).toEqual([0, 0]);
  });

  it('gère les commandes relatives, H/V et les nombres collés', () => {
    const p = parsePath('m10,10h20v20h-20z');
    const b = pathBounds(p);
    expect(b).toEqual({ minX: 10, minY: 10, maxX: 30, maxY: 30 });
  });

  it('enchaîne les coordonnées implicites après M comme des L', () => {
    const p = parsePath('M0 0 10 0 10 10');
    expect(p[0].segs).toHaveLength(2);
  });

  it('convertit les quadratiques, S et T', () => {
    const p = parsePath('M0 0 Q 50 100 100 0 T 200 0 C 210 10 220 10 230 0 S 250 -10 260 0');
    expect(p[0].segs).toHaveLength(4);
    const last = p[0].segs[3];
    expect(last.slice(4)).toEqual([260, 0]);
    // Le premier point de contrôle de S est le reflet du précédent (220,10) autour de (230,0)
    expect(last[0]).toBeCloseTo(240);
    expect(last[1]).toBeCloseTo(-10);
  });

  it('convertit les arcs en cubiques (cercle complet)', () => {
    const p = parsePath('M -50 0 A 50 50 0 1 1 50 0 A 50 50 0 1 1 -50 0 Z');
    const b = pathBounds(p);
    expect(b.minX).toBeCloseTo(-50, 0);
    expect(b.maxX).toBeCloseTo(50, 0);
    expect(b.minY).toBeCloseTo(-50, 0);
    expect(b.maxY).toBeCloseTo(50, 0);
    expect(pathLength(p)).toBeCloseTo(2 * Math.PI * 50, -1);
  });

  it('sérialise puis ré-analyse sans perte', () => {
    const d = 'M 0 0 C 10 0 20 10 20 20 Z';
    const again = parsePath(serializePath(parsePath(d)));
    expect(serializePath(again)).toBe(serializePath(parsePath(d)));
  });

  it('coupe une cubique au milieu', () => {
    const [a, b] = splitCubic([0, 0], [0, 0, 10, 0, 10, 0], 0.5);
    expect(a[4]).toBeCloseTo(5);
    expect(b[4]).toBe(10);
  });

  it('normalise deux tracés de structures différentes', () => {
    const tri = parsePath('M0 0 L10 0 L5 10 Z');
    const twoSquares = parsePath('M0 0 H10 V10 H0 Z M20 20 H30 V30 H20 Z');
    const [a, b] = normalizePair(tri, twoSquares);
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(2);
    a.forEach((sp, i) => expect(sp.segs.length).toBe(b[i].segs.length));
  });

  it('morphing : extrémités exactes et état intermédiaire cohérent', () => {
    const sq = 'M -50 -50 L 50 -50 L 50 50 L -50 50 Z';
    const tri = 'M 0 -60 L 60 50 L -60 50 Z';
    expect(morphPath(sq, tri, 0)).toBe(sq);
    expect(morphPath(sq, tri, 1)).toBe(tri);
    const mid = parsePath(morphPath(sq, tri, 0.5));
    const b = pathBounds(mid);
    expect(b.maxY).toBeCloseTo(50, 0);
    expect(b.minY).toBeLessThan(-50);
    expect(b.minY).toBeGreaterThan(-60);
  });

  it('le morphing intermédiaire est lui-même interpolable numériquement (même structure)', () => {
    const a = 'M 0 0 L 10 0 L 10 10 Z';
    const b = 'M 0 0 L 20 0 L 20 20 L 0 20 Z';
    const m1 = morphPath(a, b, 0.25);
    const m2 = morphPath(a, b, 0.75);
    const count = (s: string) => (s.match(/C/g) ?? []).length;
    expect(count(m1)).toBe(count(m2));
  });

  it('recentre un tracé sur l’origine', () => {
    const c = centerPath('M 100 100 L 200 100 L 200 150 L 100 150 Z');
    expect(c.cx).toBe(150);
    expect(c.cy).toBe(125);
    expect(c.width).toBe(100);
    const b = pathBounds(parsePath(c.d));
    expect(b.minX).toBeCloseTo(-50);
    expect(b.maxY).toBeCloseTo(25);
  });
});

describe('normalisation multiple', () => {
  it('donne la même structure à trois tracés', async () => {
    const { normalizeMany } = await import('../path');
    const out = normalizeMany([
      parsePath('M0 0 L10 0 L5 10 Z'),
      parsePath('M0 0 H10 V10 H0 Z'),
      parsePath('M0 0 H10 V10 H0 Z M20 20 H30 V30 Z'),
    ]).map(serializePath);
    const shape = (s: string) => s.replace(/-?\d+(\.\d+)?/g, '#');
    expect(shape(out[0])).toBe(shape(out[1]));
    expect(shape(out[1])).toBe(shape(out[2]));
  });
});
