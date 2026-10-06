import { describe, expect, it } from 'vitest';
import { createComposition, createLayer, createProject } from '../../engine/defaults';
import { upsertKeyframe } from '../../engine/keyframes';
import { applyPreset } from '../../engine/presets';
import { groupLayers, precompose } from '../../engine/structure';
import type { Project } from '../../engine/types';
import { exportCss, timingFunction } from '../css';
import { exportGsap } from '../gsap';
import { exportLottie, subpathToLottie } from '../lottie';
import { buildTrack, createContext } from '../model';
import { parsePath } from '../../engine/path';
import { encodeWav, outputSize } from '../wav';

function sampleProject(): Project {
  const comp = createComposition({ duration: 2, fps: 30 });
  const project = createProject('Test', comp);
  const rect = createLayer('rect', comp, { name: 'Carré' });
  upsertKeyframe(rect.props.x!, 0, 100, { type: 'easeOut' });
  upsertKeyframe(rect.props.x!, 1, 500);
  const ball = createLayer('ellipse', comp, { name: 'Balle' });
  applyPreset(ball, 'drop', 0, comp.duration);
  const title = createLayer('text', comp, { name: 'Titre', text: 'Salut' });
  applyPreset(title, 'typewriter', 0, comp.duration);
  const star = createLayer('star', comp, { name: 'Étoile', inPoint: 0.5 });
  upsertKeyframe(star.props.points!, 0, 5, { type: 'linear' });
  upsertKeyframe(star.props.points!, 1, 8);
  comp.layers.push(rect, ball, title, star);
  return project;
}

describe('segments d’export', () => {
  it('conserve une courbe bézier commune sans échantillonnage', () => {
    const p = sampleProject();
    const comp = p.compositions[0];
    const t = buildTrack(createContext(p, comp), comp.layers[0], ['x', 'y'], 0)!;
    expect(t.segments).toHaveLength(1);
    expect(t.segments[0].easing?.type).toBe('easeOut');
  });

  it('échantillonne les courbes non bézier (rebond)', () => {
    const p = sampleProject();
    const comp = p.compositions[0];
    const t = buildTrack(createContext(p, comp), comp.layers[1], ['y'], 0)!;
    expect(t.segments.length).toBeGreaterThan(20);
    expect(t.segments.every((s) => s.easing === null)).toBe(true);
  });

  it('traduit les courbes en fonctions de timing CSS', () => {
    expect(timingFunction({ type: 'hold' })).toBe('step-end');
    expect(timingFunction({ type: 'backOut' })).toBe('cubic-bezier(0.34, 1.56, 0.64, 1)');
    expect(timingFunction(null)).toBe('linear');
  });
});

describe('export HTML + CSS', () => {
  it('produit une page autonome avec @keyframes', () => {
    const { code } = exportCss(sampleProject(), sampleProject().compositions[0]);
    expect(code).toContain('<!doctype html>');
    expect(code).toContain('@keyframes');
    expect(code).toContain('animation-timing-function: cubic-bezier(0.33, 1, 0.68, 1)');
    expect(code).not.toContain('<script');
  });

  it('gère points d’entrée, morphing et lettres', () => {
    const p = sampleProject();
    const { code, warnings } = exportCss(p, p.compositions[0]);
    expect(code).toMatch(/visibility: hidden/);
    expect(code).toMatch(/d: path\("M/);
    expect(code).toContain('am-c');
    expect(warnings.some((w) => w.includes('Safari'))).toBe(true);
  });

  it('enveloppe les enfants dans les transformations de leurs parents', () => {
    const p = sampleProject();
    const comp = p.compositions[0];
    const g = groupLayers(comp, [comp.layers[0].id, comp.layers[1].id])!;
    const { code } = exportCss(p, comp);
    expect(code).toContain(`am-t-${g.id}`);
    expect(code).toMatch(new RegExp(`<div class="am-t am-t-${g.id} am-i-[^"]+"><div class="am-t am-t-`));
  });

  it('exporte les précompositions avec décalage', () => {
    const p = sampleProject();
    const comp = p.compositions[0];
    precompose(p, comp.id, [comp.layers[0].id]);
    const { code } = exportCss(p, comp);
    expect(code).toContain('am-sub');
  });
});

describe('export GSAP', () => {
  it('construit une timeline avec eases natives', () => {
    const p = sampleProject();
    const { code } = exportGsap(p, p.compositions[0]);
    expect(code).toContain('gsap.timeline({ repeat: -1');
    expect(code).toContain('ease: "easeOut"');
    expect(code).toContain('CustomEase.create("easeOut", "M0,0 C0.33,1 0.68,1 1,1")');
    // Le rebond est joué nativement, sans échantillonnage
    expect(code).toContain('ease: "bounce.out"');
    expect(code).toContain('attr: { d:');
    expect(code).toContain('keyframes: [');
    expect(code).toContain('gsap.min.js');
  });

  it('déclare CustomEase pour les bézier personnalisées', () => {
    const p = sampleProject();
    const l = p.compositions[0].layers[0];
    l.props.x!.keyframes[0].easing = { type: 'cubicBezier', bezier: [0.1, 0.7, 0.2, 1] };
    const { code } = exportGsap(p, p.compositions[0]);
    expect(code).toMatch(/CustomEase.create\("courbe\d", "M0,0 C0.1,0.7 0.2,1 1,1"\)/);
  });
});

describe('export Lottie', () => {
  it('produit un JSON Lottie valide', () => {
    const p = sampleProject();
    const { json } = exportLottie(p, p.compositions[0]);
    expect(json.fr).toBe(30);
    expect(json.op).toBe(60);
    const layers = json.layers as Array<Record<string, unknown>>;
    // 4 calques + le fond (solide) en dernier
    expect(layers).toHaveLength(5);
    expect(layers[4]).toMatchObject({ ty: 1, sc: '#ffffff' });
    // Ordre Lottie : premier plan en premier
    expect(layers[0].nm).toBe('Étoile');
    expect(layers[0].ip).toBe(15);
    const rect = layers.find((l) => l.nm === 'Carré')!;
    const ks = rect.ks as { p: { x: { a: number; k: Array<{ o: { x: number[] } }> } } };
    expect(ks.p.x.a).toBe(1);
    expect(ks.p.x.k[0].o.x[0]).toBe(0.33);
  });

  it('crée des track mattes pour les masques', () => {
    const p = sampleProject();
    const comp = p.compositions[0];
    const mask = createLayer('ellipse', comp, { name: 'Masque' });
    comp.layers.push(mask);
    comp.layers[0].maskId = mask.id;
    const { json } = exportLottie(p, comp);
    const layers = json.layers as Array<Record<string, unknown>>;
    const i = layers.findIndex((l) => l.nm === 'Carré');
    expect(layers[i].tt).toBe(1);
    expect(layers[i - 1].td).toBe(1);
    expect(layers[i - 1].nm).toBe('Masque');
  });

  it('exporte les précompositions comme ressources', () => {
    const p = sampleProject();
    const comp = p.compositions[0];
    precompose(p, comp.id, [comp.layers[0].id]);
    const { json } = exportLottie(p, comp);
    const assets = json.assets as Array<Record<string, unknown>>;
    expect(assets.some((a) => Array.isArray(a.layers))).toBe(true);
  });

  it('convertit un tracé fermé en sommets et tangentes', () => {
    const sp = parsePath('M0 0 L10 0 L10 10 Z')[0];
    const shape = subpathToLottie(sp);
    expect(shape.v).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    expect(shape.c).toBe(true);
    expect(shape.o[0][0]).toBeCloseTo(10 / 3, 2);
  });
});

describe('vidéo', () => {
  it('calcule la taille de sortie paire', () => {
    expect(outputSize(1920, 1080, 720)).toEqual({ width: 1280, height: 720 });
    expect(outputSize(1080, 1920, 1080)).toEqual({ width: 1080, height: 1920 });
    expect(outputSize(1000, 333, 480).width % 2).toBe(0);
  });

  it('encode un WAV valide', () => {
    const wav = encodeWav([new Float32Array([0, 1, -1])], 48000);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF');
    expect(wav.length).toBe(44 + 6);
  });
});

describe('modèles de départ', () => {
  it('tous les modèles se construisent et s’exportent', async () => {
    const { TEMPLATES } = await import('../../templates');
    for (const t of TEMPLATES) {
      const p = t.build();
      const comp = p.compositions[0];
      expect(comp.layers.length).toBeGreaterThan(1);
      expect(exportCss(p, comp).code).toContain('@keyframes');
      expect(exportGsap(p, comp).code).toContain('tl.');
      expect((exportLottie(p, comp).json.layers as unknown[]).length).toBeGreaterThan(0);
    }
  });
});
