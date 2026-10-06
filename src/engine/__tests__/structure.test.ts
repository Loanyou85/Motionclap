import { describe, expect, it } from 'vitest';
import { createComposition, createLayer, createProject } from '../defaults';
import { getNum, layerMap, worldMatrix } from '../evaluate';
import { upsertKeyframe } from '../keyframes';
import { apply } from '../matrix';
import {
  canNestComp,
  deleteLayers,
  duplicateLayers,
  groupLayers,
  moveLayer,
  normalizeOrder,
  precompose,
  setParentKeepingWorld,
  stepLayer,
  ungroup,
} from '../structure';
import type { Composition } from '../types';

function setup() {
  const comp = createComposition();
  const a = createLayer('rect', comp, { name: 'A' }, { x: 100, y: 100 });
  const b = createLayer('ellipse', comp, { name: 'B' }, { x: 300, y: 100 });
  const c = createLayer('star', comp, { name: 'C' }, { x: 500, y: 500 });
  comp.layers.push(a, b, c);
  return { comp, a, b, c };
}

const names = (comp: Composition) => comp.layers.map((l) => l.name);
const worldPos = (comp: Composition, id: string, t = 0) => {
  const map = layerMap(comp);
  return apply(worldMatrix(map.get(id)!, map, t), 0, 0);
};

describe('structure des calques', () => {
  it('monte et descend un calque', () => {
    const { comp, a } = setup();
    expect(stepLayer(comp, a.id, 1)).toBe(true);
    expect(names(comp)).toEqual(['B', 'A', 'C']);
    expect(stepLayer(comp, a.id, -1)).toBe(true);
    expect(names(comp)).toEqual(['A', 'B', 'C']);
    expect(stepLayer(comp, a.id, -1)).toBe(false);
  });

  it('déplace un calque au-dessus d’un autre', () => {
    const { comp, a, c } = setup();
    moveLayer(comp, a.id, c.id, 'above');
    expect(names(comp)).toEqual(['B', 'C', 'A']);
  });

  it('groupe des calques sans les déplacer à l’écran', () => {
    const { comp, a, b } = setup();
    const before = [worldPos(comp, a.id), worldPos(comp, b.id)];
    const g = groupLayers(comp, [a.id, b.id])!;
    expect(getNum(g, 'x', 0)).toBe(200);
    expect(names(comp)).toEqual(['A', 'B', 'Groupe', 'C']);
    expect(worldPos(comp, a.id)).toEqual(before[0]);
    expect(worldPos(comp, b.id)).toEqual(before[1]);
    expect(getNum(a, 'x', 0)).toBe(-100);
  });

  it('dégroupe en conservant les positions, y compris animées', () => {
    const { comp, a, b } = setup();
    upsertKeyframe(a.props.x!, 0, 100);
    upsertKeyframe(a.props.x!, 1, 400);
    const g = groupLayers(comp, [a.id, b.id])!;
    g.props.rotation!.value = 90;
    const rotated = worldPos(comp, a.id, 1);
    ungroup(comp, g.id);
    expect(comp.layers.find((l) => l.id === g.id)).toBeUndefined();
    const after = worldPos(comp, a.id, 1);
    expect(after[0]).toBeCloseTo(rotated[0]);
    expect(after[1]).toBeCloseTo(rotated[1]);
    expect(getNum(a, 'rotation', 0)).toBeCloseTo(90);
  });

  it('entrer dans un groupe par glisser-déposer', () => {
    const { comp, a, b, c } = setup();
    const g = groupLayers(comp, [a.id, b.id])!;
    const before = worldPos(comp, c.id);
    moveLayer(comp, c.id, g.id, 'inside');
    expect(c.parentId).toBe(g.id);
    expect(names(comp)).toEqual(['A', 'B', 'C', 'Groupe']);
    expect(worldPos(comp, c.id)).toEqual(before);
  });

  it('sortir d’un groupe', () => {
    const { comp, a, b, c } = setup();
    groupLayers(comp, [a.id, b.id]);
    moveLayer(comp, a.id, c.id, 'above');
    expect(a.parentId).toBeNull();
    expect(names(comp)).toEqual(['B', 'Groupe', 'C', 'A']);
    expect(worldPos(comp, a.id)).toEqual([100, 100]);
  });

  it('déplace un groupe avec tout son contenu', () => {
    const { comp, a, b, c } = setup();
    const g = groupLayers(comp, [a.id, b.id])!;
    moveLayer(comp, g.id, c.id, 'above');
    expect(names(comp)).toEqual(['C', 'A', 'B', 'Groupe']);
    expect(moveLayer(comp, g.id, a.id, 'above')).toBe(false);
  });

  it('le parentage conserve la position à l’écran', () => {
    const { comp, a, b } = setup();
    a.props.rotation!.value = 45;
    setParentKeepingWorld(comp, b.id, a.id, 0);
    expect(b.parentId).toBe(a.id);
    const p = worldPos(comp, b.id);
    expect(p[0]).toBeCloseTo(300);
    expect(p[1]).toBeCloseTo(100);
  });

  it('normalise l’ordre : groupe juste au-dessus de ses membres', () => {
    const { comp, a, b, c } = setup();
    const g = createLayer('group', comp, { name: 'G' });
    comp.layers.unshift(g);
    a.parentId = g.id;
    c.parentId = g.id;
    normalizeOrder(comp);
    expect(names(comp)).toEqual(['A', 'C', 'G', 'B']);
    expect(b.parentId).toBeNull();
  });

  it('duplique un groupe avec de nouveaux identifiants', () => {
    const { comp, a, b } = setup();
    const g = groupLayers(comp, [a.id, b.id])!;
    const [copyId] = duplicateLayers(comp, [g.id]);
    expect(comp.layers).toHaveLength(7);
    const copy = comp.layers.find((l) => l.id === copyId)!;
    expect(copy.name).toBe('Groupe copie');
    const members = comp.layers.filter((l) => l.parentId === copyId);
    expect(members).toHaveLength(2);
    expect(members.every((m) => m.id !== a.id && m.id !== b.id)).toBe(true);
  });

  it('supprime un groupe, ses membres et les références', () => {
    const { comp, a, b, c } = setup();
    const g = groupLayers(comp, [a.id, b.id])!;
    c.maskId = a.id;
    deleteLayers(comp, [g.id]);
    expect(names(comp)).toEqual(['C']);
    expect(c.maskId).toBeNull();
  });

  it('précompose des calques', () => {
    const project = createProject();
    const comp = project.compositions[0];
    const a = createLayer('rect', comp, { name: 'A' });
    const b = createLayer('rect', comp, { name: 'B' });
    const c = createLayer('rect', comp, { name: 'C', maskId: a.id });
    comp.layers.push(a, b, c);
    const pre = precompose(project, comp.id, [a.id, b.id])!;
    expect(project.compositions).toHaveLength(2);
    expect(names(comp)).toEqual(['Précomposition', 'C']);
    expect(project.compositions[1].layers.map((l) => l.name)).toEqual(['A', 'B']);
    expect(pre.compId).toBe(project.compositions[1].id);
    expect(c.maskId).toBeNull();
    expect(canNestComp(project, project.compositions[1].id, comp.id)).toBe(false);
    expect(canNestComp(project, comp.id, project.compositions[1].id)).toBe(true);
  });
});
