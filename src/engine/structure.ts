import { createComposition, createLayer } from './defaults';
import { descendants, getNum, layerMap, localMatrix, worldMatrix } from './evaluate';
import { uid } from './id';
import { cloneLayerKeyframeIds, upsertKeyframe } from './keyframes';
import { apply, decompose, invert, multiply, type Mat } from './matrix';
import type { Composition, Layer, Project } from './types';

/**
 * Opérations de structure sur les calques (ordre, groupes, parentage, précompositions).
 * Elles modifient la composition reçue (brouillon immer ou copie).
 */

const isGroup = (comp: Composition, id: string | null | undefined) =>
  !!id && comp.layers.some((l) => l.id === id && l.type === 'group');

/** Parent « d'affichage » : le groupe qui contient le calque, sinon null. */
export function panelParent(comp: Composition, layer: Layer): string | null {
  return layer.parentId && isGroup(comp, layer.parentId) ? layer.parentId : null;
}

/** Bloc d'un calque : lui-même + tous les membres des groupes qu'il contient. */
export function blockIds(comp: Composition, id: string): Set<string> {
  const out = new Set([id]);
  const layer = comp.layers.find((l) => l.id === id);
  if (layer?.type === 'group') {
    for (const d of descendants(comp, id)) if (panelParent(comp, d)) out.add(d.id);
  }
  return out;
}

/**
 * Réordonne le tableau pour que chaque groupe soit juste au-dessus de ses membres,
 * eux-mêmes contigus. L'ordre relatif existant est conservé.
 */
export function normalizeOrder(comp: Composition): void {
  const index = new Map(comp.layers.map((l, i) => [l.id, i]));
  const children = new Map<string | null, Layer[]>();
  for (const l of comp.layers) {
    const p = panelParent(comp, l);
    if (!children.has(p)) children.set(p, []);
    children.get(p)!.push(l);
  }
  for (const list of children.values()) list.sort((a, b) => index.get(a.id)! - index.get(b.id)!);
  const out: Layer[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null) => {
    for (const l of children.get(parent) ?? []) {
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      if (l.type === 'group') walk(l.id);
      out.push(l);
    }
  };
  walk(null);
  // Sécurité : calques orphelins (cycle improbable) ajoutés à la fin.
  for (const l of comp.layers) if (!seen.has(l.id)) out.push(l);
  comp.layers = out;
}

/**
 * Applique une matrice m à la transformation d'un calque (valeur fixe et images clés).
 * Exact pour les translations, rotations et échelles uniformes.
 */
export function rebaseTransform(layer: Layer, m: Mat): void {
  const d = decompose(m);
  const px = layer.props.x;
  const py = layer.props.y;
  if (px && py) {
    // Positions évaluées avant toute modification (x et y associés au même temps).
    const times = new Set([...px.keyframes.map((k) => k.time), ...py.keyframes.map((k) => k.time)]);
    const updates: Array<[number, number, number]> = [];
    for (const t of times) {
      const [nx, ny] = apply(m, getNum(layer, 'x', t), getNum(layer, 'y', t));
      updates.push([t, nx, ny]);
    }
    const [sx, sy] = apply(m, Number(px.value), Number(py.value));
    px.value = sx;
    py.value = sy;
    const xs = new Map(px.keyframes.map((k) => [k.time, k]));
    const ys = new Map(py.keyframes.map((k) => [k.time, k]));
    // Sous rotation/échelle, x et y deviennent couplés : on complète l'axe non animé.
    const pureTranslation = Math.abs(m[0] - 1) < 1e-9 && Math.abs(m[3] - 1) < 1e-9 && Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9;
    for (const [t, x, y] of updates) {
      const kx = xs.get(t);
      const ky = ys.get(t);
      if (kx) kx.value = x;
      else if (!pureTranslation) upsertKeyframe(px, t, x, ky?.easing);
      if (ky) ky.value = y;
      else if (!pureTranslation) upsertKeyframe(py, t, y, kx?.easing);
    }
  }
  if (Math.abs(d.rotation) > 1e-9 && layer.props.rotation) {
    const r = layer.props.rotation;
    r.value = Number(r.value) + d.rotation;
    for (const k of r.keyframes) k.value = Number(k.value) + d.rotation;
  }
  for (const [key, s] of [
    ['scaleX', d.scaleX],
    ['scaleY', d.scaleY],
  ] as const) {
    const p = layer.props[key];
    if (p && Math.abs(s - 1) > 1e-9) {
      p.value = Number(p.value) * s;
      for (const k of p.keyframes) k.value = Number(k.value) * s;
    }
  }
}

/**
 * Change le parent d'un calque en conservant sa position à l'écran (au temps t).
 */
export function setParentKeepingWorld(comp: Composition, layerId: string, parentId: string | null, t: number): void {
  const map = layerMap(comp);
  const layer = map.get(layerId);
  if (!layer) return;
  const oldParentWorld: Mat = layer.parentId && map.get(layer.parentId) ? worldMatrix(map.get(layer.parentId)!, map, t) : [1, 0, 0, 1, 0, 0];
  const newParentWorld: Mat = parentId && map.get(parentId) ? worldMatrix(map.get(parentId)!, map, t) : [1, 0, 0, 1, 0, 0];
  const inv = invert(newParentWorld);
  if (!inv) return;
  rebaseTransform(layer, multiply(inv, oldParentWorld));
  layer.parentId = parentId;
}

/** Déplace un calque (et son bloc) au-dessus / au-dessous / dans une cible. */
export function moveLayer(
  comp: Composition,
  id: string,
  targetId: string,
  position: 'above' | 'below' | 'inside',
  t = 0,
): boolean {
  if (id === targetId) return false;
  const block = blockIds(comp, id);
  if (block.has(targetId)) return false;
  const layer = comp.layers.find((l) => l.id === id);
  const target = comp.layers.find((l) => l.id === targetId);
  if (!layer || !target) return false;
  if (position === 'inside' && target.type !== 'group') position = 'above';

  const newPanelParent = position === 'inside' ? target.id : panelParent(comp, target);
  const oldPanelParent = panelParent(comp, layer);
  if (newPanelParent !== oldPanelParent) {
    const nextParent = newPanelParent ?? (oldPanelParent ? null : layer.parentId);
    setParentKeepingWorld(comp, id, nextParent, t);
  }

  const moving = comp.layers.filter((l) => block.has(l.id));
  const rest = comp.layers.filter((l) => !block.has(l.id));
  let insertAt: number;
  if (position === 'inside') {
    // Tout en haut des membres du groupe = juste sous le groupe.
    insertAt = rest.findIndex((l) => l.id === target.id);
  } else if (position === 'above') {
    insertAt = rest.findIndex((l) => l.id === target.id) + 1;
  } else {
    const targetBlock = blockIds(comp, target.id);
    insertAt = rest.findIndex((l) => targetBlock.has(l.id));
  }
  rest.splice(Math.max(0, insertAt), 0, ...moving);
  comp.layers = rest;
  normalizeOrder(comp);
  return true;
}

/** Monte (+1) ou descend (-1) un calque parmi ses frères. */
export function stepLayer(comp: Composition, id: string, dir: 1 | -1): boolean {
  const layer = comp.layers.find((l) => l.id === id);
  if (!layer) return false;
  const parent = panelParent(comp, layer);
  const siblings = comp.layers.filter((l) => panelParent(comp, l) === parent);
  const i = siblings.findIndex((l) => l.id === id);
  const j = i + dir;
  if (j < 0 || j >= siblings.length) return false;
  return moveLayer(comp, id, siblings[j].id, dir === 1 ? 'above' : 'below');
}

/** Regroupe des calques frères dans un nouveau groupe centré sur leur position moyenne. */
export function groupLayers(comp: Composition, ids: string[], t = 0, name = 'Groupe'): Layer | null {
  const map = layerMap(comp);
  const layers = ids.map((id) => map.get(id)).filter((l): l is Layer => !!l);
  if (layers.length === 0) return null;
  const parent = panelParent(comp, layers[0]);
  // Ne garde que les calques qui partagent le même conteneur que le premier.
  const members = layers.filter((l) => panelParent(comp, l) === parent);
  let cx = 0;
  let cy = 0;
  for (const l of members) {
    const [x, y] = apply(worldMatrix(l, map, t), 0, 0);
    cx += x;
    cy += y;
  }
  cx /= members.length;
  cy /= members.length;
  const group = createLayer('group', { width: comp.width, height: comp.height, duration: comp.duration }, { name, parentId: parent });
  const parentWorld: Mat = parent ? worldMatrix(map.get(parent)!, map, t) : [1, 0, 0, 1, 0, 0];
  const [gx, gy] = apply(invert(parentWorld) ?? [1, 0, 0, 1, 0, 0], cx, cy);
  group.props.x!.value = gx;
  group.props.y!.value = gy;
  group.outPoint = Math.max(...members.map((l) => l.outPoint));
  group.inPoint = Math.min(...members.map((l) => l.inPoint));
  const topIndex = Math.max(...members.map((l) => comp.layers.indexOf(l)));
  comp.layers.splice(topIndex + 1, 0, group);
  for (const l of members) {
    rebaseTransform(l, [1, 0, 0, 1, -gx, -gy]);
    l.parentId = group.id;
  }
  normalizeOrder(comp);
  return group;
}

/** Dissout un groupe ; ses membres conservent leur position à l'écran. */
export function ungroup(comp: Composition, groupId: string, t = 0): string[] {
  const map = layerMap(comp);
  const group = map.get(groupId);
  if (!group || group.type !== 'group') return [];
  const m = localMatrix(group, t);
  const members = comp.layers.filter((l) => l.parentId === groupId);
  for (const l of members) {
    rebaseTransform(l, m);
    l.parentId = group.parentId;
  }
  // Les calques simplement « parentés » au groupe le sont désormais à son parent.
  comp.layers = comp.layers.filter((l) => l.id !== groupId);
  for (const l of comp.layers) if (l.maskId === groupId) l.maskId = null;
  normalizeOrder(comp);
  return members.map((l) => l.id);
}

/** Supprime des calques (et les membres des groupes supprimés) et nettoie les références. */
export function deleteLayers(comp: Composition, ids: string[]): void {
  const remove = new Set<string>();
  for (const id of ids) for (const b of blockIds(comp, id)) remove.add(b);
  comp.layers = comp.layers.filter((l) => !remove.has(l.id));
  for (const l of comp.layers) {
    if (l.parentId && remove.has(l.parentId)) l.parentId = null;
    if (l.maskId && remove.has(l.maskId)) l.maskId = null;
  }
}

/** Duplique des calques (avec leurs membres de groupe) au-dessus des originaux. */
export function duplicateLayers(comp: Composition, ids: string[]): string[] {
  const newIds: string[] = [];
  for (const id of ids) {
    const block = blockIds(comp, id);
    const originals = comp.layers.filter((l) => block.has(l.id));
    if (originals.length === 0) continue;
    const idMap = new Map<string, string>();
    for (const o of originals) idMap.set(o.id, uid('l'));
    const clones: Layer[] = originals.map((o) => {
      const c: Layer = JSON.parse(JSON.stringify(o));
      c.id = idMap.get(o.id)!;
      if (c.parentId && idMap.has(c.parentId)) c.parentId = idMap.get(c.parentId)!;
      if (c.maskId && idMap.has(c.maskId)) c.maskId = idMap.get(c.maskId)!;
      cloneLayerKeyframeIds(c);
      return c;
    });
    const root = clones.find((c) => c.id === idMap.get(id))!;
    root.name = `${root.name} copie`;
    const top = Math.max(...originals.map((o) => comp.layers.indexOf(o)));
    comp.layers.splice(top + 1, 0, ...clones);
    newIds.push(root.id);
  }
  normalizeOrder(comp);
  return newIds;
}

/**
 * Précompose des calques : ils sont déplacés dans une nouvelle composition
 * remplacée ici par un calque de précomposition.
 */
export function precompose(project: Project, compId: string, ids: string[], name = 'Précomposition'): Layer | null {
  const comp = project.compositions.find((c) => c.id === compId);
  if (!comp || ids.length === 0) return null;
  const moving = new Set<string>();
  for (const id of ids) for (const b of blockIds(comp, id)) moving.add(b);
  const movedLayers = comp.layers.filter((l) => moving.has(l.id));
  if (movedLayers.length === 0) return null;
  const topIndex = Math.max(...movedLayers.map((l) => comp.layers.indexOf(l)));
  const sub = createComposition({
    name,
    width: comp.width,
    height: comp.height,
    duration: comp.duration,
    fps: comp.fps,
    background: '#FFFFFF00',
  });
  for (const l of movedLayers) {
    if (l.parentId && !moving.has(l.parentId)) l.parentId = null;
    if (l.maskId && !moving.has(l.maskId)) l.maskId = null;
  }
  sub.layers = movedLayers;
  const layer = createLayer(
    'precomp',
    { width: comp.width, height: comp.height, duration: comp.duration },
    { name, compId: sub.id },
  );
  const rest = comp.layers.filter((l) => !moving.has(l.id));
  const insertAt = comp.layers.slice(0, topIndex + 1).filter((l) => !moving.has(l.id)).length;
  rest.splice(insertAt, 0, layer);
  for (const l of rest) {
    if (l.parentId && moving.has(l.parentId)) l.parentId = null;
    if (l.maskId && moving.has(l.maskId)) l.maskId = null;
  }
  comp.layers = rest;
  project.compositions.push(sub);
  normalizeOrder(comp);
  return layer;
}

/** Une composition peut-elle être insérée dans une autre sans créer de boucle ? */
export function canNestComp(project: Project, hostId: string, childId: string): boolean {
  if (hostId === childId) return false;
  const stack = [childId];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id === hostId) return false;
    if (seen.has(id)) continue;
    seen.add(id);
    const c = project.compositions.find((x) => x.id === id);
    for (const l of c?.layers ?? []) if (l.type === 'precomp' && l.compId) stack.push(l.compId);
  }
  return true;
}
