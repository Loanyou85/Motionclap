import { createComposition, createLayer, createProject } from '../engine/defaults';
import { upsertKeyframe } from '../engine/keyframes';
import { applyPreset } from '../engine/presets';
import { ellipsePathD, pointsToPathD, roundedRectPathD, starPoints } from '../engine/shapes';
import { normalizeOrder } from '../engine/structure';
import type { Composition, EasingType, Layer, LayerType, Project, PropKey, PropValue } from '../engine/types';

export interface Template {
  id: string;
  name: string;
  description: string;
  format: string;
  build: () => Project;
}

type Key = [time: number, value: PropValue, easing?: EasingType];

/** Ajoute une série d'images clés à une propriété. */
function anim(layer: Layer, key: PropKey, keys: Key[]) {
  const p = layer.props[key]!;
  for (const [t, v, e] of keys) upsertKeyframe(p, t, v, { type: e ?? 'easeInOut' });
}

function add(comp: Composition, type: LayerType, name: string, values: Partial<Record<PropKey, PropValue>>, extra: Partial<Layer> = {}): Layer {
  const l = createLayer(type, comp, { name, ...extra }, values);
  comp.layers.push(l);
  return l;
}

function introLogo(): Project {
  const comp = createComposition({ name: 'Intro logo', duration: 5, background: '#FFFFFF' });
  const cx = comp.width / 2;
  const cy = comp.height / 2 - 60;
  const halo = add(comp, 'ellipse', 'Halo', { x: cx, y: cy, width: 520, height: 520, fill: '#DBEAFE' });
  anim(halo, 'scaleX', [[0, 0, 'easeOut'], [0.9, 1.1, 'easeInOut'], [4.2, 1]]);
  anim(halo, 'scaleY', [[0, 0, 'easeOut'], [0.9, 1.1, 'easeInOut'], [4.2, 1]]);
  anim(halo, 'opacity', [[0, 0], [0.5, 1], [4.3, 1, 'easeIn'], [4.8, 0]]);

  const disc = add(comp, 'ellipse', 'Pastille', { x: cx, y: cy, width: 300, height: 300, fill: '#1E5EFF' });
  applyPreset(disc, 'pop', 0.3, comp.duration);

  const star = add(comp, 'star', 'Étoile', { x: cx, y: cy, radius: 92, innerRadius: 0.42, points: 5, fill: '#FFFFFF' });
  applyPreset(star, 'pop', 0.55, comp.duration);
  anim(star, 'rotation', [[0.55, -180, 'backOut'], [1.5, 0]]);

  const ring = add(comp, 'ellipse', 'Anneau', { x: cx, y: cy, width: 380, height: 380, fill: '#00000000', stroke: '#3B82F6', strokeWidth: 6 });
  anim(ring, 'scaleX', [[0.6, 0.6, 'easeOut'], [1.6, 1.25]]);
  anim(ring, 'scaleY', [[0.6, 0.6, 'easeOut'], [1.6, 1.25]]);
  anim(ring, 'opacity', [[0, 0, 'hold'], [0.6, 1, 'easeOut'], [1.6, 0]]);

  const title = add(comp, 'text', 'Nom de marque', { x: cx, y: cy + 270, fontSize: 110, fill: '#0A1F44', letterSpacing: 6 }, { text: 'ATELIER', textMode: 'fade' });
  anim(title, 'reveal', [[1.1, 0, 'linear'], [1.9, 1]]);
  const tagline = add(comp, 'text', 'Signature', { x: cx, y: cy + 370, fontSize: 40, fill: '#64748B' }, { text: 'Le mouvement au service de votre image', fontWeight: 500 });
  applyPreset(tagline, 'typewriter', 2, comp.duration);

  for (const l of [disc, star, title, tagline]) {
    anim(l, 'opacity', [[4.3, 1, 'easeIn'], [4.8, 0]]);
  }
  return createProject('Intro logo', comp);
}

function animatedTitle(): Project {
  const comp = createComposition({ name: 'Titre animé', duration: 4, background: '#F0F6FF' });
  const cx = comp.width / 2;
  const bar = add(comp, 'rect', 'Bandeau', { x: cx, y: 540, width: 1240, height: 260, radius: 24, fill: '#0A1F44' });
  anim(bar, 'scaleX', [[0, 0, 'easeOut'], [0.7, 1]]);
  const accent = add(comp, 'rect', 'Accent', { x: cx - 560, y: 540, width: 24, height: 160, radius: 12, fill: '#1E5EFF' });
  applyPreset(accent, 'pop', 0.5, comp.duration);

  const title = add(comp, 'text', 'Titre', { x: cx + 20, y: 510, fontSize: 120, fill: '#FFFFFF' }, { text: 'Motion design', textMode: 'wave' });
  anim(title, 'reveal', [[0.6, 0, 'linear'], [1.6, 1]]);
  anim(title, 'waveAmp', [[1.6, 10, 'easeOut'], [3.2, 0]]);

  const line = add(comp, 'line', 'Soulignement', { x: cx + 20, y: 600, width: 620, stroke: '#3B82F6', strokeWidth: 8 });
  anim(line, 'trim', [[1.2, 0, 'easeInOut'], [2, 1]]);
  const sub = add(comp, 'text', 'Sous-titre', { x: cx, y: 760, fontSize: 44, fill: '#0A1F44' }, { text: 'Animez vos sites et vos vidéos', fontWeight: 500 });
  applyPreset(sub, 'slide', 1.8, comp.duration);
  return createProject('Titre animé', comp);
}

function webBanner(): Project {
  const comp = createComposition({ name: 'Bannière web', width: 1200, height: 400, duration: 6, background: '#1E5EFF' });
  const bubbles: Array<[number, number, number, string]> = [
    [120, 80, 140, '#3B82F6'],
    [1080, 330, 200, '#3B82F6'],
    [980, 60, 70, '#DBEAFE'],
    [260, 340, 60, '#DBEAFE'],
  ];
  bubbles.forEach(([x, y, r, c], i) => {
    const b = add(comp, 'ellipse', `Bulle ${i + 1}`, { x, y, width: r, height: r, fill: c, opacity: 0.6 });
    anim(b, 'y', [[0, y, 'easeInOut'], [3, y - 24, 'easeInOut'], [6, y]]);
    anim(b, 'x', [[0, x, 'easeInOut'], [3, x + (i % 2 ? -18 : 18), 'easeInOut'], [6, x]]);
  });
  const title = add(comp, 'text', 'Accroche', { x: 460, y: 165, fontSize: 72, fill: '#FFFFFF' }, { text: 'Soldes d’été −30 %' });
  applyPreset(title, 'pop', 0.2, comp.duration);
  const sub = add(comp, 'text', 'Détail', { x: 460, y: 245, fontSize: 30, fill: '#DBEAFE' }, { text: 'Sur toute la collection, jusqu’à dimanche', fontWeight: 500 });
  applyPreset(sub, 'fadeIn', 0.8, comp.duration);

  const btn = add(comp, 'group', 'Bouton', { x: 1020, y: 200 });
  add(comp, 'rect', 'Fond du bouton', { x: 0, y: 0, width: 230, height: 76, radius: 38, fill: '#FFFFFF' }, { parentId: btn.id });
  add(comp, 'text', 'Libellé', { x: 0, y: 0, fontSize: 30, fill: '#1E5EFF' }, { text: 'Découvrir', parentId: btn.id });
  anim(btn, 'scaleX', [[1.2, 0, 'backOut'], [1.7, 1, 'easeInOut'], [3.5, 1, 'easeInOut'], [3.8, 1.08, 'easeInOut'], [4.1, 1]]);
  anim(btn, 'scaleY', [[1.2, 0, 'backOut'], [1.7, 1, 'easeInOut'], [3.5, 1, 'easeInOut'], [3.8, 1.08, 'easeInOut'], [4.1, 1]]);
  normalizeOrder(comp);
  return createProject('Bannière web', comp);
}

function morphing(): Project {
  const comp = createComposition({ name: 'Morphing', width: 1080, height: 1080, duration: 4, background: '#FFFFFF' });
  const shape = add(comp, 'path', 'Forme', { x: 540, y: 500, fill: '#1E5EFF', path: roundedRectPathD(360, 360, 40) });
  anim(shape, 'path', [
    [0.3, roundedRectPathD(360, 360, 40), 'backInOut'],
    [1.3, pointsToPathD(starPoints(5, 230, 0.45)), 'elasticOut'],
    [2.6, ellipsePathD(380, 380), 'easeInOut'],
    [3.6, roundedRectPathD(360, 360, 40)],
  ]);
  anim(shape, 'fill', [[0.3, '#1E5EFF'], [1.3, '#3B82F6'], [2.6, '#0A1F44'], [3.6, '#1E5EFF']]);
  anim(shape, 'rotation', [[0.3, 0, 'easeInOut'], [3.6, 360]]);
  const label = add(comp, 'text', 'Légende', { x: 540, y: 900, fontSize: 56, fill: '#0A1F44' }, { text: 'Morphing de tracés SVG' });
  applyPreset(label, 'fadeIn', 0.2, comp.duration);
  return createProject('Morphing', comp);
}

function story(): Project {
  const comp = createComposition({ name: 'Story verticale', width: 1080, height: 1920, duration: 5, background: '#0A1F44' });
  const card = add(comp, 'rect', 'Carte', { x: 540, y: 960, width: 860, height: 1100, radius: 48, fill: '#FFFFFF' });
  applyPreset(card, 'slide', 0, comp.duration);
  anim(card, 'y', [[0, 1160, 'easeOut'], [0.8, 960]]);
  const mask = add(comp, 'ellipse', 'Masque', { x: 540, y: 760, width: 10, height: 10, fill: '#000000' });
  anim(mask, 'width', [[0.6, 10, 'easeInOut'], [1.6, 1500]]);
  anim(mask, 'height', [[0.6, 10, 'easeInOut'], [1.6, 1500]]);
  add(comp, 'rect', 'Visuel', { x: 540, y: 760, width: 760, height: 560, radius: 32, fill: '#1E5EFF' }, { maskId: mask.id });
  const title = add(comp, 'text', 'Titre', { x: 540, y: 1180, fontSize: 92, fill: '#0A1F44' }, { text: 'Nouveauté' });
  applyPreset(title, 'wave', 1.4, comp.duration);
  const cta = add(comp, 'text', 'Appel à l’action', { x: 540, y: 1340, fontSize: 44, fill: '#1E5EFF' }, { text: 'Glissez vers le haut ↑', fontWeight: 600 });
  applyPreset(cta, 'drop', 2.4, comp.duration);
  return createProject('Story verticale', comp);
}

export const TEMPLATES: Template[] = [
  { id: 'logo', name: 'Intro logo', description: 'Pastille qui apparaît, étoile en rotation, nom et signature.', format: '16:9', build: introLogo },
  { id: 'title', name: 'Titre animé', description: 'Bandeau, titre en vague et soulignement dessiné.', format: '16:9', build: animatedTitle },
  { id: 'banner', name: 'Bannière web', description: 'Bannière 1200×400 en boucle avec bouton animé.', format: '3:1', build: webBanner },
  { id: 'morph', name: 'Morphing', description: 'Carré → étoile → cercle avec courbes élastiques.', format: '1:1', build: morphing },
  { id: 'story', name: 'Story verticale', description: 'Format 9:16 avec masque animé et texte.', format: '9:16', build: story },
];
