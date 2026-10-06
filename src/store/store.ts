import { produce, type Draft } from 'immer';
import { create } from 'zustand';
import { createLayer, createProject } from '../engine/defaults';
import { canParent, getProp } from '../engine/evaluate';
import { uid } from '../engine/id';
import {
  removeKeyframes,
  setKeyframeEasing,
  setPropValue,
  shiftKeyframes,
  toggleKeyframe as toggleKf,
} from '../engine/keyframes';
import { applyPreset as applyPresetFn, type PresetId } from '../engine/presets';
import { clampProp, PROP_DEFS } from '../engine/props';
import {
  canNestComp,
  deleteLayers,
  duplicateLayers,
  groupLayers,
  moveLayer as moveLayerFn,
  normalizeOrder,
  precompose,
  setParentKeepingWorld,
  stepLayer,
  ungroup,
} from '../engine/structure';
import type {
  Asset,
  Composition,
  Easing,
  Layer,
  LayerType,
  Project,
  PropKey,
  PropValue,
} from '../engine/types';

const HISTORY_LIMIT = 150;
/** Deux modifications avec la même clé à moins de 800 ms fusionnent dans l'historique. */
const MERGE_WINDOW = 800;

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';

export interface UpdateOptions {
  /** Clé de fusion : un glisser continu ne crée qu'une entrée d'historique. */
  merge?: string;
}

export interface AppState {
  project: Project;
  past: Project[];
  future: Project[];
  lastMerge: { key: string; at: number } | null;

  activeCompId: string;
  selectedLayerIds: string[];
  selectedKeyframeIds: string[];
  time: number;
  playing: boolean;
  loop: boolean;
  stageZoom: number | 'fit';
  showGuides: boolean;
  snap: boolean;
  timelineZoom: number;
  saveStatus: SaveStatus;
  dialog: null | 'export' | 'projects' | 'templates' | 'shortcuts';
  toast: { id: number; text: string; tone: 'info' | 'error' } | null;

  // Projet et historique
  loadProject: (p: Project) => void;
  update: (recipe: (draft: Draft<Project>) => void, opts?: UpdateOptions) => void;
  updateComp: (recipe: (comp: Draft<Composition>, project: Draft<Project>) => void, opts?: UpdateOptions) => void;
  undo: () => void;
  redo: () => void;
  renameProject: (name: string) => void;

  // Composition
  setActiveComp: (id: string) => void;
  setCompSettings: (patch: Partial<Pick<Composition, 'width' | 'height' | 'duration' | 'fps' | 'background' | 'name'>>) => void;

  // Calques
  addLayer: (type: LayerType, overrides?: Partial<Layer>, values?: Partial<Record<PropKey, PropValue>>) => string;
  patchLayer: (id: string, patch: Partial<Layer>, opts?: UpdateOptions) => void;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  groupSelection: () => void;
  ungroupSelection: () => void;
  precomposeSelection: () => void;
  moveLayer: (id: string, targetId: string, position: 'above' | 'below' | 'inside') => void;
  stepLayer: (id: string, dir: 1 | -1) => void;
  setParent: (id: string, parentId: string | null) => void;
  nudgeSelection: (dx: number, dy: number) => void;
  addPrecompLayer: (compId: string) => void;

  // Propriétés et images clés
  setProp: (layerId: string, key: PropKey, value: PropValue, opts?: UpdateOptions) => void;
  toggleKeyframe: (layerId: string, key: PropKey) => void;
  shiftSelectedKeyframes: (dt: number, merge: string) => void;
  deleteSelectedKeyframes: () => void;
  setEasing: (keyframeIds: string[], easing: Easing) => void;
  applyPreset: (preset: PresetId) => void;

  // Ressources
  addAsset: (asset: Omit<Asset, 'id'>) => string;

  // Interface
  selectLayer: (id: string | null, mode?: 'replace' | 'toggle' | 'add') => void;
  setSelectedLayers: (ids: string[]) => void;
  selectKeyframe: (id: string | null, mode?: 'replace' | 'toggle') => void;
  setSelectedKeyframes: (ids: string[]) => void;
  setTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
  togglePlay: () => void;
  setLoop: (l: boolean) => void;
  setStageZoom: (z: number | 'fit') => void;
  setShowGuides: (v: boolean) => void;
  setSnap: (v: boolean) => void;
  setTimelineZoom: (z: number) => void;
  setSaveStatus: (s: SaveStatus) => void;
  openDialog: (d: AppState['dialog']) => void;
  notify: (text: string, tone?: 'info' | 'error') => void;
}

/** Composition active (repli sur la principale). */
export function activeComp(s: Pick<AppState, 'project' | 'activeCompId'>): Composition {
  return (
    s.project.compositions.find((c) => c.id === s.activeCompId) ??
    s.project.compositions.find((c) => c.id === s.project.mainCompId) ??
    s.project.compositions[0]
  );
}

function findComp(draft: Draft<Project>, id: string): Draft<Composition> {
  return draft.compositions.find((c) => c.id === id) ?? draft.compositions[0];
}

function frameSnap(t: number, fps: number): number {
  return Math.round(t * fps) / fps;
}

let toastCounter = 0;

export const useStore = create<AppState>()((set, get) => {
  /** Applique une modification au projet en gérant l'historique. */
  const commit = (recipe: (draft: Draft<Project>) => void, opts: UpdateOptions = {}) => {
    const s = get();
    const next = produce(s.project, (d) => {
      recipe(d);
      d.updatedAt = Date.now();
    });
    if (next === s.project) return;
    const now = Date.now();
    const merging = !!opts.merge && s.lastMerge?.key === opts.merge && now - s.lastMerge.at < MERGE_WINDOW;
    set({
      project: next,
      past: merging ? s.past : [...s.past, s.project].slice(-HISTORY_LIMIT),
      future: [],
      lastMerge: opts.merge ? { key: opts.merge, at: now } : null,
      saveStatus: 'unsaved',
    });
  };

  const commitComp = (recipe: (comp: Draft<Composition>, project: Draft<Project>) => void, opts?: UpdateOptions) => {
    const compId = activeComp(get()).id;
    commit((d) => recipe(findComp(d, compId), d), opts);
  };

  const initial = createProject();

  return {
    project: initial,
    past: [],
    future: [],
    lastMerge: null,
    activeCompId: initial.mainCompId,
    selectedLayerIds: [],
    selectedKeyframeIds: [],
    time: 0,
    playing: false,
    loop: true,
    stageZoom: 'fit',
    showGuides: true,
    snap: true,
    timelineZoom: 120,
    saveStatus: 'saved',
    dialog: null,
    toast: null,

    loadProject: (p) =>
      set({
        project: p,
        past: [],
        future: [],
        lastMerge: null,
        activeCompId: p.mainCompId,
        selectedLayerIds: [],
        selectedKeyframeIds: [],
        time: 0,
        playing: false,
        saveStatus: 'unsaved',
      }),

    update: commit,
    updateComp: commitComp,

    undo: () => {
      const s = get();
      const prev = s.past[s.past.length - 1];
      if (!prev) return;
      set({
        project: prev,
        past: s.past.slice(0, -1),
        future: [s.project, ...s.future],
        lastMerge: null,
        saveStatus: 'unsaved',
        activeCompId: prev.compositions.some((c) => c.id === s.activeCompId) ? s.activeCompId : prev.mainCompId,
      });
    },

    redo: () => {
      const s = get();
      const next = s.future[0];
      if (!next) return;
      set({
        project: next,
        past: [...s.past, s.project],
        future: s.future.slice(1),
        lastMerge: null,
        saveStatus: 'unsaved',
        activeCompId: next.compositions.some((c) => c.id === s.activeCompId) ? s.activeCompId : next.mainCompId,
      });
    },

    renameProject: (name) => commit((d) => void (d.name = name), { merge: 'project-name' }),

    setActiveComp: (id) => set({ activeCompId: id, selectedLayerIds: [], selectedKeyframeIds: [], time: 0 }),

    setCompSettings: (patch) =>
      commitComp((c) => {
        const oldDuration = c.duration;
        Object.assign(c, patch);
        if (patch.duration !== undefined) {
          c.duration = Math.max(0.1, patch.duration);
          // Les calques qui couvraient toute la durée suivent le changement.
          for (const l of c.layers) {
            if (Math.abs(l.outPoint - oldDuration) < 1e-6 || l.outPoint > c.duration) l.outPoint = c.duration;
            l.inPoint = Math.min(l.inPoint, c.duration);
          }
        }
        if (patch.fps !== undefined) c.fps = Math.min(60, Math.max(1, Math.round(patch.fps)));
      }, { merge: 'comp-settings' }),

    addLayer: (type, overrides = {}, values = {}) => {
      const comp = activeComp(get());
      const layer = createLayer(type, comp, overrides, values);
      // Nom unique : « Rectangle 2 », « Rectangle 3 »…
      if (!overrides.name) {
        const count = comp.layers.filter((l) => l.type === type).length;
        if (count > 0) layer.name = `${layer.name} ${count + 1}`;
      }
      commitComp((c) => {
        c.layers.push(layer as Draft<Layer>);
        normalizeOrder(c as Composition);
      });
      set({ selectedLayerIds: [layer.id], selectedKeyframeIds: [] });
      return layer.id;
    },

    patchLayer: (id, patch, opts) =>
      commitComp((c) => {
        const l = c.layers.find((x) => x.id === id);
        if (l) Object.assign(l, patch);
      }, opts),

    deleteSelection: () => {
      const s = get();
      if (s.selectedKeyframeIds.length > 0) {
        get().deleteSelectedKeyframes();
        return;
      }
      if (s.selectedLayerIds.length === 0) return;
      const ids = s.selectedLayerIds;
      commitComp((c) => deleteLayers(c as Composition, ids));
      set({ selectedLayerIds: [] });
    },

    duplicateSelection: () => {
      const ids = get().selectedLayerIds;
      if (ids.length === 0) return;
      let newIds: string[] = [];
      commitComp((c) => {
        newIds = duplicateLayers(c as Composition, ids);
      });
      set({ selectedLayerIds: newIds, selectedKeyframeIds: [] });
    },

    groupSelection: () => {
      const s = get();
      if (s.selectedLayerIds.length === 0) return;
      let gid: string | null = null;
      commitComp((c) => {
        gid = groupLayers(c as Composition, s.selectedLayerIds, s.time)?.id ?? null;
      });
      if (gid) set({ selectedLayerIds: [gid] });
    },

    ungroupSelection: () => {
      const s = get();
      const comp = activeComp(s);
      const groups = s.selectedLayerIds.filter((id) => comp.layers.find((l) => l.id === id)?.type === 'group');
      if (groups.length === 0) return;
      let members: string[] = [];
      commitComp((c) => {
        for (const g of groups) members = members.concat(ungroup(c as Composition, g, s.time));
      });
      set({ selectedLayerIds: members });
    },

    precomposeSelection: () => {
      const s = get();
      if (s.selectedLayerIds.length === 0) return;
      const compId = activeComp(s).id;
      let lid: string | null = null;
      commit((d) => {
        const n = d.compositions.length;
        lid = precompose(d as Project, compId, s.selectedLayerIds, `Précomposition ${n}`)?.id ?? null;
      });
      if (lid) set({ selectedLayerIds: [lid], selectedKeyframeIds: [] });
    },

    moveLayer: (id, targetId, position) => {
      const t = get().time;
      commitComp((c) => void moveLayerFn(c as Composition, id, targetId, position, t));
    },

    stepLayer: (id, dir) => commitComp((c) => void stepLayer(c as Composition, id, dir)),

    setParent: (id, parentId) => {
      const s = get();
      const comp = activeComp(s);
      if (!canParent(comp, id, parentId)) {
        get().notify('Parentage impossible : cela créerait une boucle.', 'error');
        return;
      }
      commitComp((c) => {
        setParentKeepingWorld(c as Composition, id, parentId, s.time);
        normalizeOrder(c as Composition);
      });
    },

    nudgeSelection: (dx, dy) => {
      const s = get();
      const comp = activeComp(s);
      const ids = s.selectedLayerIds.filter((id) => !comp.layers.find((l) => l.id === id)?.locked);
      if (ids.length === 0) return;
      commitComp(
        (c) => {
          for (const id of ids) {
            const l = c.layers.find((x) => x.id === id) as Layer | undefined;
            if (!l) continue;
            setPropValue(l, 'x', (getProp(l, 'x', s.time) as number) + dx, s.time);
            setPropValue(l, 'y', (getProp(l, 'y', s.time) as number) + dy, s.time);
          }
        },
        { merge: 'nudge' },
      );
    },

    addPrecompLayer: (compId) => {
      const s = get();
      const host = activeComp(s);
      if (!canNestComp(s.project, host.id, compId)) {
        get().notify('Impossible : cette composition contient déjà la composition active.', 'error');
        return;
      }
      const sub = s.project.compositions.find((c) => c.id === compId);
      get().addLayer('precomp', { compId, name: sub?.name ?? 'Précomposition' });
    },

    setProp: (layerId, key, value, opts) => {
      const t = get().time;
      const v = typeof value === 'number' ? clampProp(key, value) : value;
      commitComp((c) => {
        const l = c.layers.find((x) => x.id === layerId) as Layer | undefined;
        if (l) setPropValue(l, key, v, t);
      }, opts ?? { merge: `prop-${layerId}-${key}` });
    },

    toggleKeyframe: (layerId, key) => {
      const t = get().time;
      commitComp((c) => {
        const l = c.layers.find((x) => x.id === layerId) as Layer | undefined;
        if (l) toggleKf(l, key, t);
      });
    },

    shiftSelectedKeyframes: (dt, merge) => {
      const s = get();
      const ids = new Set(s.selectedKeyframeIds);
      if (ids.size === 0) return;
      commitComp((c) => {
        for (const l of c.layers) shiftKeyframes(l as Layer, ids, dt, c.duration);
      }, { merge });
    },

    deleteSelectedKeyframes: () => {
      const ids = new Set(get().selectedKeyframeIds);
      if (ids.size === 0) return;
      commitComp((c) => {
        for (const l of c.layers) removeKeyframes(l as Layer, ids);
      });
      set({ selectedKeyframeIds: [] });
    },

    setEasing: (keyframeIds, easing) => {
      const ids = new Set(keyframeIds);
      commitComp((c) => {
        for (const l of c.layers) setKeyframeEasing(l as Layer, ids, easing);
      }, { merge: `easing-${keyframeIds.join(',')}` });
    },

    applyPreset: (preset) => {
      const s = get();
      const comp = activeComp(s);
      const ids = s.selectedLayerIds;
      if (ids.length === 0) {
        get().notify('Sélectionnez un calque pour appliquer un préréglage.');
        return;
      }
      let applied = 0;
      commitComp((c) => {
        for (const id of ids) {
          const l = c.layers.find((x) => x.id === id) as Layer | undefined;
          if (l && applyPresetFn(l, preset, s.time, comp.duration)) applied++;
        }
      });
      if (applied === 0) get().notify('Ce préréglage est réservé aux calques texte.', 'error');
    },

    addAsset: (asset) => {
      const id = uid('a');
      commit((d) => void d.assets.push({ ...asset, id }));
      return id;
    },

    selectLayer: (id, mode = 'replace') => {
      if (!id) return set({ selectedLayerIds: [], selectedKeyframeIds: [] });
      const cur = get().selectedLayerIds;
      if (mode === 'toggle') {
        set({ selectedLayerIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
      } else if (mode === 'add') {
        if (!cur.includes(id)) set({ selectedLayerIds: [...cur, id] });
      } else if (cur.length !== 1 || cur[0] !== id) {
        set({ selectedLayerIds: [id], selectedKeyframeIds: [] });
      }
    },
    setSelectedLayers: (ids) => set({ selectedLayerIds: ids }),

    selectKeyframe: (id, mode = 'replace') => {
      if (!id) return set({ selectedKeyframeIds: [] });
      const cur = get().selectedKeyframeIds;
      if (mode === 'toggle') set({ selectedKeyframeIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
      else set({ selectedKeyframeIds: [id] });
    },
    setSelectedKeyframes: (ids) => set({ selectedKeyframeIds: ids }),

    setTime: (t) => {
      const comp = activeComp(get());
      set({ time: Math.min(comp.duration, Math.max(0, frameSnap(t, comp.fps))) });
    },
    setPlaying: (p) => set({ playing: p }),
    togglePlay: () => {
      const s = get();
      const comp = activeComp(s);
      if (!s.playing && s.time >= comp.duration - 1e-6) set({ time: 0 });
      set({ playing: !s.playing });
    },
    setLoop: (l) => set({ loop: l }),
    setStageZoom: (z) => set({ stageZoom: z }),
    setShowGuides: (v) => set({ showGuides: v }),
    setSnap: (v) => set({ snap: v }),
    setTimelineZoom: (z) => set({ timelineZoom: Math.min(600, Math.max(20, z)) }),
    setSaveStatus: (s) => set({ saveStatus: s }),
    openDialog: (d) => set({ dialog: d }),
    notify: (text, tone = 'info') => set({ toast: { id: ++toastCounter, text, tone } }),
  };
});

/** Sélecteurs pratiques. */
export const useActiveComp = () => useStore((s) => activeComp(s));

export function selectedLayers(s: AppState): Layer[] {
  const comp = activeComp(s);
  return s.selectedLayerIds.map((id) => comp.layers.find((l) => l.id === id)).filter((l): l is Layer => !!l);
}

export { PROP_DEFS };
