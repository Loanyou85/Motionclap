import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../engine/defaults';
import { getNum } from '../engine/evaluate';
import { listProjects, loadLastProject, saveProject } from './persistence';
import { activeComp, useStore } from './store';

const s = () => useStore.getState();
const comp = () => activeComp(s());

beforeEach(() => {
  s().loadProject(createProject('Test'));
});

describe('store du projet', () => {
  it('ajoute un calque et le sélectionne', () => {
    const id = s().addLayer('rect');
    expect(comp().layers).toHaveLength(1);
    expect(s().selectedLayerIds).toEqual([id]);
  });

  it('annule et rétablit', () => {
    s().addLayer('rect');
    s().addLayer('ellipse');
    expect(comp().layers).toHaveLength(2);
    s().undo();
    expect(comp().layers).toHaveLength(1);
    s().undo();
    expect(comp().layers).toHaveLength(0);
    s().redo();
    expect(comp().layers).toHaveLength(1);
  });

  it('fusionne les modifications continues dans une seule entrée d’historique', () => {
    const id = s().addLayer('rect');
    const before = s().past.length;
    s().setProp(id, 'x', 10, { merge: 'drag-1' });
    s().setProp(id, 'x', 20, { merge: 'drag-1' });
    s().setProp(id, 'x', 30, { merge: 'drag-1' });
    expect(s().past.length).toBe(before + 1);
    s().undo();
    expect(getNum(comp().layers[0], 'x', 0)).toBe(960);
  });

  it('borne les valeurs (opacité entre 0 et 1)', () => {
    const id = s().addLayer('rect');
    s().setProp(id, 'opacity', 3);
    expect(getNum(comp().layers[0], 'opacity', 0)).toBe(1);
  });

  it('crée des images clés au temps courant et les déplace', () => {
    const id = s().addLayer('rect');
    s().toggleKeyframe(id, 'x');
    s().setTime(2);
    s().setProp(id, 'x', 100);
    const kfs = comp().layers[0].props.x!.keyframes;
    expect(kfs.map((k) => k.time)).toEqual([0, 2]);
    s().setSelectedKeyframes([kfs[1].id]);
    s().shiftSelectedKeyframes(0.5, 'move');
    expect(comp().layers[0].props.x!.keyframes[1].time).toBe(2.5);
    s().deleteSelection();
    expect(comp().layers[0].props.x!.keyframes).toHaveLength(1);
  });

  it('cale le temps sur les images et la durée', () => {
    s().setTime(1.017);
    expect(s().time).toBeCloseTo(1.0333, 3);
    s().setTime(99);
    expect(s().time).toBe(comp().duration);
  });

  it('duplique, groupe et dégroupe la sélection', () => {
    const a = s().addLayer('rect');
    s().duplicateSelection();
    expect(comp().layers).toHaveLength(2);
    s().setSelectedLayers(comp().layers.map((l) => l.id));
    s().groupSelection();
    expect(comp().layers.find((l) => l.type === 'group')).toBeTruthy();
    s().ungroupSelection();
    expect(comp().layers.find((l) => l.type === 'group')).toBeUndefined();
    expect(comp().layers.some((l) => l.id === a)).toBe(true);
  });

  it('applique un préréglage au calque sélectionné', () => {
    s().addLayer('ellipse');
    s().applyPreset('pop');
    expect(comp().layers[0].props.scaleX!.keyframes).toHaveLength(2);
  });

  it('précompose et refuse les boucles d’imbrication', () => {
    s().addLayer('rect');
    s().precomposeSelection();
    expect(s().project.compositions).toHaveLength(2);
    const sub = s().project.compositions[1];
    s().setActiveComp(sub.id);
    s().addPrecompLayer(s().project.mainCompId);
    expect(s().toast?.tone).toBe('error');
  });
});

describe('sauvegarde IndexedDB', () => {
  it('enregistre et recharge le dernier projet', async () => {
    const p = createProject('Sauvé');
    await saveProject(p);
    const list = await listProjects();
    expect(list.some((x) => x.id === p.id && x.name === 'Sauvé')).toBe(true);
    const last = await loadLastProject();
    expect(last?.id).toBe(p.id);
  });
});
