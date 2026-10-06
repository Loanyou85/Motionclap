import { useMemo, type ReactNode } from 'react';
import { DEFAULT_EASING } from '../../engine/easing';
import { canParent, getProp, maskLayerIds } from '../../engine/evaluate';
import { allKeyframes, TIME_EPS } from '../../engine/keyframes';
import { PRESETS } from '../../engine/presets';
import { fromDisplay, LAYER_PROPS, LAYER_TYPE_LABELS, PROP_DEFS, toDisplay, type PropGroup } from '../../engine/props';
import { TEXT_MODE_LABELS } from '../../engine/text';
import type { Composition, Easing, Layer, PropKey, TextAlign, TextMode } from '../../engine/types';
import { activeComp, useStore } from '../../store/store';
import { CurveEditor } from '../curve/CurveEditor';
import { Icon } from '../ui/Icon';
import { ColorField, NumberField, Select, TextField } from '../ui/fields';
import { LAYER_ICONS } from '../layers/LayersPanel';

const GROUP_LABELS: Record<PropGroup, string> = {
  transform: 'Transformation',
  appearance: 'Apparence',
  shape: 'Forme',
  text: 'Texte',
};

const SUFFIX = { px: 'px', percent: '%', deg: '°', raw: '' } as const;

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-3 last:border-b-0">
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="panel-title">{title}</h3>
        {right}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

/** Bouton « image clé » : losange plein si une image clé existe au temps courant. */
function KeyButton({ layer, prop, time }: { layer: Layer; prop: PropKey; time: number }) {
  const p = layer.props[prop];
  const animated = !!p && p.keyframes.length > 0;
  const onKey = !!p?.keyframes.some((k) => Math.abs(k.time - time) <= TIME_EPS);
  const st = useStore.getState();
  return (
    <button
      className={`flex h-7 w-6 shrink-0 items-center justify-center rounded ${animated ? 'text-primary' : 'text-muted/60 hover:text-accent'}`}
      title={onKey ? 'Supprimer l’image clé' : animated ? 'Ajouter une image clé ici' : 'Animer cette propriété (image clé)'}
      aria-label={onKey ? 'Supprimer l’image clé' : 'Ajouter une image clé'}
      aria-pressed={onKey}
      onClick={() => st.toggleKeyframe(layer.id, prop)}
    >
      <svg width="12" height="12" viewBox="0 0 12 12">
        <path d="M6 1 11 6 6 11 1 6Z" fill={onKey ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </button>
  );
}

function PropRow({ layer, prop, time }: { layer: Layer; prop: PropKey; time: number }) {
  const def = PROP_DEFS[prop];
  const st = useStore.getState();
  const value = getProp(layer, prop, time);
  const disabled = layer.locked;

  let field: ReactNode;
  if (def.type === 'color') {
    field = <ColorField value={String(value)} onChange={(v, phase) => !disabled && st.setProp(layer.id, prop, v, phase === 'drag' ? { merge: `c-${layer.id}-${prop}` } : undefined)} />;
  } else if (def.type === 'path') {
    field = (
      <TextField
        value={String(value)}
        multiline
        className="font-mono text-[11px]"
        onCommit={(v) => v.trim() && st.setProp(layer.id, prop, v.trim(), { merge: `path-${layer.id}` })}
      />
    );
  } else {
    const display = def.display ?? 'px';
    field = (
      <NumberField
        value={toDisplay(prop, Number(value))}
        step={def.step ?? (display === 'raw' ? 1 : 1)}
        min={def.min !== undefined ? toDisplay(prop, def.min) : undefined}
        max={def.max !== undefined ? toDisplay(prop, def.max) : undefined}
        suffix={SUFFIX[display]}
        disabled={disabled}
        onChange={(v) => st.setProp(layer.id, prop, fromDisplay(prop, v), { merge: `n-${layer.id}-${prop}` })}
      />
    );
  }

  return (
    <div className={`grid items-center gap-2 ${def.type === 'path' ? 'grid-cols-[1fr_auto]' : 'grid-cols-[84px_1fr_auto]'}`}>
      {def.type !== 'path' && <span className="field-label truncate" title={def.label}>{def.label}</span>}
      {def.type === 'path' ? (
        <div className="space-y-1">
          <span className="field-label">{def.label} (attribut d)</span>
          {field}
        </div>
      ) : (
        field
      )}
      <KeyButton layer={layer} prop={prop} time={time} />
    </div>
  );
}

function EasingSection({ comp }: { comp: Composition }) {
  const selectedKfs = useStore((s) => s.selectedKeyframeIds);
  const st = useStore.getState();
  const found = useMemo(() => {
    for (const l of comp.layers) {
      for (const { key, kf } of allKeyframes(l)) if (kf.id === selectedKfs[0]) return { layer: l, key, kf };
    }
    return null;
  }, [comp, selectedKfs]);
  if (!found) return null;
  const easing: Easing = found.kf.easing ?? DEFAULT_EASING;
  return (
    <Section
      title="Courbe d’animation"
      right={<span className="chip">{selectedKfs.length > 1 ? `${selectedKfs.length} images clés` : `${PROP_DEFS[found.key].label} · ${found.kf.time.toFixed(2)} s`}</span>}
    >
      <p className="text-[11px] leading-snug text-muted">S’applique au segment qui part de l’image clé sélectionnée vers la suivante.</p>
      <CurveEditor easing={easing} onChange={(e) => st.setEasing(selectedKfs, e)} />
    </Section>
  );
}

function CompositionSettings({ comp }: { comp: Composition }) {
  const st = useStore.getState();
  return (
    <>
      <Section title="Composition">
        <div className="grid grid-cols-[84px_1fr] items-center gap-2">
          <span className="field-label">Nom</span>
          <TextField value={comp.name} onCommit={(v) => v.trim() && st.setCompSettings({ name: v.trim() })} />
          <span className="field-label">Largeur</span>
          <NumberField value={comp.width} min={16} max={3840} suffix="px" onChange={(v) => st.setCompSettings({ width: Math.round(v) })} />
          <span className="field-label">Hauteur</span>
          <NumberField value={comp.height} min={16} max={3840} suffix="px" onChange={(v) => st.setCompSettings({ height: Math.round(v) })} />
          <span className="field-label">Durée</span>
          <NumberField value={comp.duration} step={0.1} min={0.1} max={600} suffix="s" onChange={(v) => st.setCompSettings({ duration: v })} />
          <span className="field-label">Cadence</span>
          <Select
            value={String(comp.fps)}
            onChange={(v) => st.setCompSettings({ fps: Number(v) })}
            options={[24, 25, 30, 50, 60].map((f) => ({ value: String(f), label: `${f} i/s` }))}
          />
          <span className="field-label">Fond</span>
          <ColorField value={comp.background} onChange={(v) => st.setCompSettings({ background: v })} />
        </div>
      </Section>
      <Section title="Astuce">
        <p className="text-[12px] leading-relaxed text-muted">
          Sélectionnez un calque pour modifier ses propriétés. Cliquez sur un losange <span className="text-primary">◇</span> pour créer une image clé au
          temps courant, puis déplacez la tête de lecture et changez la valeur : l’animation est créée.
        </p>
      </Section>
    </>
  );
}

export function PropertiesPanel() {
  const comp = useStore((s) => activeComp(s));
  const time = useStore((s) => s.time);
  const selectedIds = useStore((s) => s.selectedLayerIds);
  const selectedKfs = useStore((s) => s.selectedKeyframeIds);
  const st = useStore.getState();
  const layer = selectedIds.length === 1 ? comp.layers.find((l) => l.id === selectedIds[0]) : undefined;
  const masks = useMemo(() => maskLayerIds(comp), [comp]);

  let body: ReactNode;
  if (selectedIds.length > 1) {
    body = (
      <>
        <Section title={`${selectedIds.length} calques sélectionnés`}>
          <p className="text-[12px] text-muted">Les préréglages s’appliquent à tous les calques sélectionnés.</p>
        </Section>
        <PresetsSection />
      </>
    );
  } else if (!layer) {
    body = <CompositionSettings comp={comp} />;
  } else {
    const keys = LAYER_PROPS[layer.type];
    const groups = (['transform', 'appearance', 'shape', 'text'] as PropGroup[]).map((g) => ({
      g,
      keys: keys.filter((k) => PROP_DEFS[k].group === g),
    }));
    const parentOptions = comp.layers.filter((l) => l.id !== layer.id && canParent(comp, layer.id, l.id));
    const maskOptions = comp.layers.filter((l) => l.id !== layer.id && l.type !== 'group' && l.maskId !== layer.id);

    body = (
      <>
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-am bg-sky text-primary">
            <Icon name={LAYER_ICONS[layer.type]} />
          </span>
          <div className="min-w-0 flex-1">
            <TextField value={layer.name} onCommit={(v) => v.trim() && st.patchLayer(layer.id, { name: v.trim() })} className="!h-7 font-medium" />
            <p className="mt-0.5 text-[11px] text-muted">
              {LAYER_TYPE_LABELS[layer.type]}
              {layer.locked && ' · verrouillé'}
              {masks.has(layer.id) && ' · sert de masque'}
            </p>
          </div>
        </div>

        {selectedKfs.length > 0 && <EasingSection comp={comp} />}

        <PresetsSection isText={layer.type === 'text'} />

        {layer.type === 'text' && (
          <Section title="Contenu du texte">
            <TextField value={layer.text ?? ''} multiline onCommit={(v) => st.patchLayer(layer.id, { text: v }, { merge: `text-${layer.id}` })} />
            <div className="grid grid-cols-[84px_1fr] items-center gap-2">
              <span className="field-label">Police</span>
              <Select
                value={layer.fontFamily ?? 'Inter'}
                onChange={(v) => st.patchLayer(layer.id, { fontFamily: v })}
                options={['Inter', 'Georgia', 'Arial', 'Courier New', 'Trebuchet MS', 'Verdana'].map((f) => ({ value: f, label: f }))}
              />
              <span className="field-label">Graisse</span>
              <Select
                value={String(layer.fontWeight ?? 700)}
                onChange={(v) => st.patchLayer(layer.id, { fontWeight: Number(v) })}
                options={[
                  { value: '400', label: 'Normale' },
                  { value: '500', label: 'Medium' },
                  { value: '600', label: 'Semi-gras' },
                  { value: '700', label: 'Gras' },
                  { value: '800', label: 'Extra-gras' },
                ]}
              />
              <span className="field-label">Alignement</span>
              <div className="flex gap-1">
                {(['left', 'center', 'right'] as TextAlign[]).map((a) => (
                  <button
                    key={a}
                    className={`tab h-7 flex-1 text-[12px] ${layer.textAlign === a ? 'tab-active' : ''}`}
                    onClick={() => st.patchLayer(layer.id, { textAlign: a })}
                  >
                    {a === 'left' ? 'Gauche' : a === 'center' ? 'Centre' : 'Droite'}
                  </button>
                ))}
              </div>
              <span className="field-label">Lettre à lettre</span>
              <Select
                value={layer.textMode ?? 'none'}
                onChange={(v) => st.patchLayer(layer.id, { textMode: v as TextMode })}
                options={(Object.keys(TEXT_MODE_LABELS) as TextMode[]).map((m) => ({ value: m, label: TEXT_MODE_LABELS[m] }))}
              />
            </div>
            {layer.textMode !== 'none' && (
              <p className="text-[11px] leading-snug text-muted">Animez « Révélation » de 0 à 100 % pour faire apparaître les lettres une à une.</p>
            )}
          </Section>
        )}

        {groups
          .filter((g) => g.keys.length > 0)
          .map(({ g, keys: ks }) => (
            <Section key={g} title={GROUP_LABELS[g]}>
              {ks.map((k) => (
                <PropRow key={k} layer={layer} prop={k} time={time} />
              ))}
            </Section>
          ))}

        <Section title="Liens">
          <div className="grid grid-cols-[84px_1fr] items-center gap-2">
            <span className="field-label">Parent</span>
            <Select
              value={layer.parentId ?? ''}
              onChange={(v) => st.setParent(layer.id, v || null)}
              options={[{ value: '', label: 'Aucun' }, ...parentOptions.map((l) => ({ value: l.id, label: `${l.type === 'group' ? '▣ ' : ''}${l.name}` }))]}
            />
            {layer.type !== 'group' && (
              <>
                <span className="field-label">Masque</span>
                <Select
                  value={layer.maskId ?? ''}
                  onChange={(v) => st.patchLayer(layer.id, { maskId: v || null })}
                  options={[{ value: '', label: 'Aucun' }, ...maskOptions.map((l) => ({ value: l.id, label: l.name }))]}
                />
                {layer.maskId && (
                  <>
                    <span className="field-label">Inverser</span>
                    <label className="flex items-center gap-2 text-[12px]">
                      <input type="checkbox" checked={layer.maskInvert} onChange={(e) => st.patchLayer(layer.id, { maskInvert: e.target.checked })} />
                      Masque inversé
                    </label>
                  </>
                )}
              </>
            )}
          </div>
          {layer.maskId && <p className="text-[11px] leading-snug text-muted">Le calque masque n’est plus dessiné : sa forme (animable) découpe ce calque.</p>}
        </Section>

        <Section title="Durée de vie">
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Entrée"
              value={layer.inPoint}
              step={0.05}
              min={0}
              max={layer.outPoint}
              suffix="s"
              onChange={(v) => st.patchLayer(layer.id, { inPoint: Math.round(v * comp.fps) / comp.fps }, { merge: `in-${layer.id}` })}
            />
            <NumberField
              label="Sortie"
              value={layer.outPoint}
              step={0.05}
              min={layer.inPoint}
              max={comp.duration}
              suffix="s"
              onChange={(v) => st.patchLayer(layer.id, { outPoint: Math.round(v * comp.fps) / comp.fps }, { merge: `out-${layer.id}` })}
            />
          </div>
        </Section>
      </>
    );
  }

  return (
    <aside className="panel flex h-full min-h-0 flex-col" aria-label="Propriétés">
      <div className="flex h-11 shrink-0 items-center border-b border-line px-4">
        <h2 className="panel-title">Propriétés</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
    </aside>
  );
}

function PresetsSection({ isText = true }: { isText?: boolean }) {
  const st = useStore.getState();
  return (
    <Section title="Préréglages en un clic">
      <div className="grid grid-cols-2 gap-1.5">
        {PRESETS.filter((p) => isText || !p.textOnly).map((p) => (
          <button
            key={p.id}
            className="flex flex-col items-start rounded-am border border-line bg-surface px-2.5 py-1.5 text-left transition-colors hover:border-accent hover:bg-canvas"
            onClick={() => st.applyPreset(p.id)}
            title={p.description}
          >
            <span className="text-[12px] font-medium text-navy">{p.label}</span>
            <span className="text-[10.5px] leading-tight text-muted">{p.description}</span>
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted">Appliqué à partir de la tête de lecture.</p>
    </Section>
  );
}
