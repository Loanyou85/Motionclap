import { useMemo, useRef, useState } from 'react';
import { maskLayerIds } from '../../engine/evaluate';
import { LAYER_TYPE_LABELS } from '../../engine/props';
import { canNestComp, panelParent } from '../../engine/structure';
import type { Composition, Layer, LayerType } from '../../engine/types';
import { importFile } from '../../lib/importFiles';
import { activeComp, useStore } from '../../store/store';
import { Icon, type IconName } from '../ui/Icon';
import { Dropdown } from '../ui/overlay';

export const LAYER_ICONS: Record<LayerType, IconName> = {
  rect: 'rect',
  ellipse: 'ellipse',
  star: 'star',
  polygon: 'polygon',
  line: 'line',
  text: 'text',
  image: 'image',
  path: 'path',
  group: 'group',
  precomp: 'precomp',
};

const ADDABLE: LayerType[] = ['rect', 'ellipse', 'star', 'polygon', 'line', 'text'];

interface TreeNode {
  layer: Layer;
  depth: number;
}

/** Liste à plat de l'arborescence affichée (du dessus vers le dessous). */
export function flattenTree(comp: Composition): TreeNode[] {
  const byParent = new Map<string | null, Layer[]>();
  for (const l of comp.layers) {
    const p = panelParent(comp, l);
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(l);
  }
  const out: TreeNode[] = [];
  const walk = (parent: string | null, depth: number) => {
    const list = [...(byParent.get(parent) ?? [])].reverse();
    for (const l of list) {
      out.push({ layer: l, depth });
      if (l.type === 'group' && !l.collapsed) walk(l.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

type DropPos = 'above' | 'below' | 'inside';

export function LayersPanel() {
  const comp = useStore((s) => activeComp(s));
  const project = useStore((s) => s.project);
  const selected = useStore((s) => s.selectedLayerIds);
  const st = useStore.getState();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; pos: DropPos } | null>(null);
  const dragId = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const nodes = useMemo(() => flattenTree(comp), [comp]);
  const masks = useMemo(() => maskLayerIds(comp), [comp]);
  const byId = useMemo(() => new Map(comp.layers.map((l) => [l.id, l])), [comp]);
  const otherComps = project.compositions.filter((c) => c.id !== comp.id && canNestComp(project, comp.id, c.id));
  const selectedLayers = selected.map((id) => byId.get(id)).filter((l): l is Layer => !!l);
  const hasGroupSelected = selectedLayers.some((l) => l.type === 'group');

  const onRowClick = (e: React.MouseEvent, id: string) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) st.selectLayer(id, 'toggle');
    else st.selectLayer(id);
  };

  const onDragOver = (e: React.DragEvent, layer: Layer) => {
    if (!dragId.current) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const r = (e.clientY - rect.top) / rect.height;
    let pos: DropPos = r < 0.5 ? 'above' : 'below';
    if (layer.type === 'group' && r > 0.25 && r < 0.75) pos = 'inside';
    setDrop({ id: layer.id, pos });
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (dragId.current && drop) st.moveLayer(dragId.current, drop.id, drop.pos);
    dragId.current = null;
    setDrop(null);
  };

  return (
    <aside className="panel flex h-full min-h-0 flex-col" aria-label="Calques">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3">
        <h2 className="panel-title">Calques</h2>
        <Dropdown
          align="right"
          trigger={(open, toggle) => (
            <button className={`btn-primary h-7 px-2.5 text-[12px] ${open ? 'bg-accent' : ''}`} onClick={toggle} aria-haspopup="menu">
              <Icon name="plus" size={14} />
              Ajouter
            </button>
          )}
        >
          {(close) => (
            <div role="menu">
              {ADDABLE.map((t) => (
                <button
                  key={t}
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    st.addLayer(t);
                    close();
                  }}
                >
                  <Icon name={LAYER_ICONS[t]} className="text-primary" />
                  {LAYER_TYPE_LABELS[t]}
                </button>
              ))}
              <div className="my-1 border-t border-line" />
              <button
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  fileRef.current?.click();
                  close();
                }}
              >
                <Icon name="upload" className="text-primary" />
                Importer image, SVG ou audio…
              </button>
              {otherComps.length > 0 && <div className="my-1 border-t border-line" />}
              {otherComps.map((c) => (
                <button
                  key={c.id}
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    st.addPrecompLayer(c.id);
                    close();
                  }}
                >
                  <Icon name="precomp" className="text-primary" />
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </Dropdown>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          accept="image/*,.svg,audio/*"
          multiple
          onChange={(e) => {
            for (const f of Array.from(e.target.files ?? [])) void importFile(f);
            e.target.value = '';
          }}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1" onDragLeave={(e) => e.currentTarget === e.target && setDrop(null)}>
        {nodes.length === 0 && (
          <div className="px-4 py-8 text-center text-[12px] leading-relaxed text-muted">
            Aucun calque pour l’instant.
            <br />
            Ajoutez une forme, un texte ou glissez une image sur la scène.
          </div>
        )}
        <ul role="tree" aria-label="Arborescence des calques">
          {nodes.map(({ layer, depth }) => {
            const isSel = selected.includes(layer.id);
            const parent = layer.parentId ? byId.get(layer.parentId) : undefined;
            const linked = parent && parent.type !== 'group';
            const isMask = masks.has(layer.id);
            const indicator = drop?.id === layer.id ? drop.pos : null;
            return (
              <li
                key={layer.id}
                role="treeitem"
                aria-selected={isSel}
                aria-expanded={layer.type === 'group' ? !layer.collapsed : undefined}
                draggable={renaming !== layer.id}
                onDragStart={(e) => {
                  dragId.current = layer.id;
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', layer.id);
                }}
                onDragEnd={() => {
                  dragId.current = null;
                  setDrop(null);
                }}
                onDragOver={(e) => onDragOver(e, layer)}
                onDrop={onDrop}
                onClick={(e) => onRowClick(e, layer.id)}
                className={`group relative mx-1 flex h-8 cursor-pointer items-center gap-1.5 rounded-am pr-1 text-[13px] ${
                  isSel ? 'bg-primary text-white' : 'text-navy hover:bg-sky'
                } ${indicator === 'inside' ? 'ring-2 ring-accent ring-inset' : ''} ${!layer.visible ? 'opacity-50' : ''}`}
                style={{ paddingLeft: 6 + depth * 16 }}
              >
                {indicator === 'above' && <span className="absolute -top-px left-2 right-2 h-0.5 rounded bg-accent" />}
                {indicator === 'below' && <span className="absolute -bottom-px left-2 right-2 h-0.5 rounded bg-accent" />}
                {layer.type === 'group' ? (
                  <button
                    className="flex h-5 w-5 items-center justify-center rounded hover:bg-black/5"
                    onClick={(e) => {
                      e.stopPropagation();
                      st.patchLayer(layer.id, { collapsed: !layer.collapsed });
                    }}
                    aria-label={layer.collapsed ? 'Déplier le groupe' : 'Replier le groupe'}
                  >
                    <Icon name={layer.collapsed ? 'chevronRight' : 'chevronDown'} size={14} />
                  </button>
                ) : (
                  <span className="w-5" />
                )}
                <Icon name={LAYER_ICONS[layer.type]} size={15} className={isSel ? 'text-white' : 'text-primary'} />
                {renaming === layer.id ? (
                  <input
                    autoFocus
                    defaultValue={layer.name}
                    className="field h-6 flex-1 text-navy"
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== layer.name) st.patchLayer(layer.id, { name: v });
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                  />
                ) : (
                  <span
                    className="min-w-0 flex-1 truncate"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setRenaming(layer.id);
                    }}
                    title="Double-clic pour renommer"
                  >
                    {layer.name}
                  </span>
                )}
                {linked && (
                  <span title={`Parent : ${parent!.name}`} className={isSel ? 'text-white/80' : 'text-muted'}>
                    <Icon name="link" size={13} />
                  </span>
                )}
                {(isMask || layer.maskId) && (
                  <span title={isMask ? 'Utilisé comme masque' : 'Masqué par un autre calque'} className={isSel ? 'text-white/80' : 'text-accent'}>
                    <Icon name="mask" size={13} />
                  </span>
                )}
                <button
                  className={`flex h-6 w-6 items-center justify-center rounded ${isSel ? 'hover:bg-white/15' : 'hover:bg-white'} ${
                    layer.visible ? 'opacity-0 group-hover:opacity-100' : ''
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    st.patchLayer(layer.id, { visible: !layer.visible });
                  }}
                  title={layer.visible ? 'Masquer' : 'Afficher'}
                  aria-label={layer.visible ? 'Masquer le calque' : 'Afficher le calque'}
                >
                  <Icon name={layer.visible ? 'eye' : 'eyeOff'} size={14} />
                </button>
                <button
                  className={`flex h-6 w-6 items-center justify-center rounded ${isSel ? 'hover:bg-white/15' : 'hover:bg-white'} ${
                    layer.locked ? '' : 'opacity-0 group-hover:opacity-100'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    st.patchLayer(layer.id, { locked: !layer.locked });
                  }}
                  title={layer.locked ? 'Déverrouiller' : 'Verrouiller'}
                  aria-label={layer.locked ? 'Déverrouiller le calque' : 'Verrouiller le calque'}
                >
                  <Icon name={layer.locked ? 'lock' : 'unlock'} size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex h-11 shrink-0 items-center gap-0.5 border-t border-line px-2">
        <button className="icon-btn" title="Monter" disabled={selected.length !== 1} onClick={() => st.stepLayer(selected[0], 1)}>
          <Icon name="arrowUp" />
        </button>
        <button className="icon-btn" title="Descendre" disabled={selected.length !== 1} onClick={() => st.stepLayer(selected[0], -1)}>
          <Icon name="arrowDown" />
        </button>
        <span className="mx-1 h-5 w-px bg-line" />
        <button className="icon-btn" title="Grouper (Ctrl+G)" disabled={selected.length === 0} onClick={st.groupSelection}>
          <Icon name="group" />
        </button>
        <button className="icon-btn" title="Dégrouper (Ctrl+Maj+G)" disabled={!hasGroupSelected} onClick={st.ungroupSelection}>
          <Icon name="ungroup" />
        </button>
        <button className="icon-btn" title="Précomposer" disabled={selected.length === 0} onClick={st.precomposeSelection}>
          <Icon name="precomp" />
        </button>
        <div className="flex-1" />
        <button className="icon-btn" title="Dupliquer (Ctrl+D)" disabled={selected.length === 0} onClick={st.duplicateSelection}>
          <Icon name="copy" />
        </button>
        <button
          className="icon-btn hover:!text-red-600 hover:!bg-red-50"
          title="Supprimer (Suppr)"
          disabled={selected.length === 0}
          onClick={() => {
            useStore.setState({ selectedKeyframeIds: [] });
            st.deleteSelection();
          }}
        >
          <Icon name="trash" />
        </button>
      </div>
    </aside>
  );
}
