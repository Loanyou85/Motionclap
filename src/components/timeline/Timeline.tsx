import { useEffect, useMemo, useRef } from 'react';
import { getProp } from '../../engine/evaluate';
import { allKeyframes, animatedKeys } from '../../engine/keyframes';
import { PROP_DEFS, toDisplay } from '../../engine/props';
import type { Composition, Keyframe, Layer, PropKey } from '../../engine/types';
import { importAudio } from '../../lib/importFiles';
import { getPeaks, loadAudioBuffer, onAssetLoaded } from '../../render/assets';
import { activeComp, useStore } from '../../store/store';
import { flattenTree, LAYER_ICONS } from '../layers/LayersPanel';
import { Icon } from '../ui/Icon';

const LEFT_W = 232;
const ROW_H = 30;
const SUB_H = 26;
const PAD_RIGHT = 40;

/** Graduations adaptées au zoom. */
function tickStep(zoom: number): { major: number; minor: number } {
  const candidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60];
  const major = candidates.find((c) => c * zoom >= 70) ?? 60;
  const minor = major <= 0.25 ? major / 5 : major / 4;
  return { major, minor };
}

function Ruler({ comp, zoom }: { comp: Composition; zoom: number }) {
  const { major, minor } = tickStep(zoom);
  const ticks: Array<{ t: number; major: boolean }> = [];
  for (let t = 0; t <= comp.duration + 1e-6; t += minor) {
    const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
    ticks.push({ t, major: isMajor });
  }
  return (
    <svg width={comp.duration * zoom + PAD_RIGHT} height={28} className="block">
      {ticks.map(({ t, major: m }) => (
        <g key={t.toFixed(4)}>
          <line x1={t * zoom + 0.5} x2={t * zoom + 0.5} y1={m ? 14 : 20} y2={28} stroke={m ? '#64748B' : '#CBD5E1'} />
          {m && (
            <text x={t * zoom + 4} y={12} fontSize={10} fill="#64748B" fontFamily="Inter">
              {major < 1 ? `${t.toFixed(2)}s` : `${Math.round(t)}s`}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

function Diamond({
  kf,
  x,
  selected,
  active,
  onPointerDown,
  title,
}: {
  kf: Keyframe | null;
  x: number;
  selected: boolean;
  active: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  title: string;
}) {
  const hold = kf?.easing.type === 'hold';
  return (
    <button
      className="absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 p-1 cursor-ew-resize"
      style={{ left: x }}
      onPointerDown={onPointerDown}
      onClick={(e) => e.stopPropagation()}
      title={title}
      aria-label={title}
      aria-pressed={selected}
    >
      <span
        className={`block h-[11px] w-[11px] border-2 transition-transform ${hold ? '' : 'rotate-45'} ${
          selected
            ? 'border-primary bg-primary scale-125 shadow-[0_0_0_3px_rgba(30,94,255,0.2)]'
            : active
              ? 'border-primary bg-primary'
              : 'border-primary bg-white hover:bg-sky'
        } rounded-[2px]`}
      />
    </button>
  );
}

export function Timeline() {
  const comp = useStore((s) => activeComp(s));
  const project = useStore((s) => s.project);
  const time = useStore((s) => s.time);
  const zoom = useStore((s) => s.timelineZoom);
  const selectedLayers = useStore((s) => s.selectedLayerIds);
  const selectedKfs = useStore((s) => s.selectedKeyframeIds);
  const st = useStore.getState();
  const scrollRef = useRef<HTMLDivElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const nodes = useMemo(() => flattenTree(comp), [comp]);
  const trackW = comp.duration * zoom + PAD_RIGHT;

  /** Position X dans la zone des pistes → temps. */
  const timeAt = (clientX: number) => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    return (clientX - rect.left - LEFT_W + el.scrollLeft) / zoom;
  };

  const startScrub = (e: React.PointerEvent) => {
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    st.setTime(timeAt(e.clientX));
    const move = (ev: PointerEvent) => st.setTime(timeAt(ev.clientX));
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  /** Glisser d'images clés : déplacement par pas d'une image. */
  const startKeyDrag = (e: React.PointerEvent, ids: string[], layerId: string) => {
    e.stopPropagation();
    e.preventDefault();
    const cur = useStore.getState().selectedKeyframeIds;
    let selection = cur;
    if (e.shiftKey) {
      const allIn = ids.every((id) => cur.includes(id));
      selection = allIn ? cur.filter((id) => !ids.includes(id)) : [...new Set([...cur, ...ids])];
    } else if (!ids.every((id) => cur.includes(id))) {
      selection = ids;
    }
    // La sélection du calque réinitialise les images clés : on la fait d'abord.
    if (!useStore.getState().selectedLayerIds.includes(layerId)) st.selectLayer(layerId);
    st.setSelectedKeyframes(selection);
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const merge = `kf-drag-${Date.now()}`;
    let applied = 0;
    const move = (ev: PointerEvent) => {
      const total = Math.round(((ev.clientX - startX) / zoom) * comp.fps) / comp.fps;
      const delta = total - applied;
      if (Math.abs(delta) > 1e-9) {
        st.shiftSelectedKeyframes(delta, merge);
        applied = total;
      }
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  /** Glisser de la barre d'un calque (bords : entrée/sortie ; corps : décalage avec ses images clés). */
  const startBarDrag = (e: React.PointerEvent, layer: Layer, mode: 'in' | 'out' | 'move') => {
    e.stopPropagation();
    if (layer.locked) return;
    st.selectLayer(layer.id);
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const merge = `bar-${Date.now()}`;
    const { inPoint, outPoint } = layer;
    const kfIds = new Set(allKeyframes(layer).map((k) => k.kf.id));
    const original = new Map(allKeyframes(layer).map(({ kf }) => [kf.id, kf.time]));
    const move = (ev: PointerEvent) => {
      const dt = Math.round(((ev.clientX - startX) / zoom) * comp.fps) / comp.fps;
      st.updateComp(
        (c) => {
          const l = c.layers.find((x) => x.id === layer.id);
          if (!l) return;
          if (mode === 'in') l.inPoint = Math.min(outPoint - 1 / comp.fps, Math.max(0, inPoint + dt));
          else if (mode === 'out') l.outPoint = Math.max(inPoint + 1 / comp.fps, Math.min(c.duration, outPoint + dt));
          else {
            const d = Math.min(c.duration - outPoint, Math.max(-inPoint, dt));
            l.inPoint = inPoint + d;
            l.outPoint = outPoint + d;
            for (const key of Object.keys(l.props) as PropKey[]) {
              for (const k of l.props[key]!.keyframes) if (kfIds.has(k.id)) k.time = original.get(k.id)! + d;
            }
          }
        },
        { merge },
      );
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  // Garde la tête de lecture visible pendant la lecture.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const x = time * zoom;
    const visibleW = el.clientWidth - LEFT_W;
    if (x < el.scrollLeft || x > el.scrollLeft + visibleW - 20) el.scrollLeft = Math.max(0, x - visibleW / 3);
  }, [time, zoom]);

  return (
    <section className="panel flex h-full min-h-0 flex-col" aria-label="Timeline">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-line px-3">
        <h2 className="panel-title">Timeline</h2>
        <span className="chip tabular-nums">{time.toFixed(2)} s</span>
        <div className="flex-1" />
        <button className="btn-ghost h-7 px-2 text-[12px]" onClick={() => audioInput.current?.click()} title="Ajouter une piste audio">
          <Icon name="audio" size={14} />
          {comp.audio ? 'Remplacer l’audio' : 'Ajouter un son'}
        </button>
        <input
          ref={audioInput}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) await importAudio(f);
            e.target.value = '';
          }}
        />
        <span className="mx-1 h-5 w-px bg-line" />
        <Icon name="zoomOut" size={14} className="text-muted" />
        <input
          type="range"
          min={20}
          max={600}
          value={zoom}
          aria-label="Zoom de la timeline"
          onChange={(e) => st.setTimelineZoom(Number(e.target.value))}
          className="w-28"
        />
        <Icon name="zoomIn" size={14} className="text-muted" />
      </div>

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
        <div style={{ width: LEFT_W + trackW }} className="relative min-h-full">
          {/* Règle */}
          <div className="sticky top-0 z-30 flex h-7 border-b border-line bg-surface">
            <div className="sticky left-0 z-10 flex shrink-0 items-center border-r border-line bg-surface px-3 text-[11px] text-muted" style={{ width: LEFT_W }}>
              {nodes.length} calque{nodes.length > 1 ? 's' : ''} · {comp.fps} i/s
            </div>
            <div className="relative cursor-pointer select-none" style={{ width: trackW }} onPointerDown={startScrub} data-testid="timeline-ruler">
              <Ruler comp={comp} zoom={zoom} />
            </div>
          </div>

          {/* Pistes des calques */}
          {nodes.map(({ layer, depth }) => {
            const isSel = selectedLayers.includes(layer.id);
            const animKeys = animatedKeys(layer);
            const all = allKeyframes(layer);
            // Une image clé de synthèse par instant sur la ligne du calque.
            const byTime = new Map<number, string[]>();
            for (const { kf } of all) {
              const t = Math.round(kf.time * 1000) / 1000;
              byTime.set(t, [...(byTime.get(t) ?? []), kf.id]);
            }
            return (
              <div key={layer.id}>
                <div className={`flex border-b border-line/70 ${isSel ? 'bg-sky/60' : ''}`} style={{ height: ROW_H }}>
                  <div
                    className={`sticky left-0 z-20 flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-line pr-2 text-[12px] ${isSel ? 'bg-sky text-primary' : 'bg-surface text-navy'}`}
                    style={{ width: LEFT_W, paddingLeft: 6 + depth * 14 }}
                    onClick={(e) => st.selectLayer(layer.id, e.shiftKey ? 'toggle' : 'replace')}
                  >
                    <button
                      className={`flex h-5 w-5 items-center justify-center rounded hover:bg-white ${animKeys.length ? '' : 'invisible'}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        st.patchLayer(layer.id, { expanded: !layer.expanded });
                      }}
                      aria-label={layer.expanded ? 'Masquer les propriétés animées' : 'Afficher les propriétés animées'}
                    >
                      <Icon name={layer.expanded ? 'chevronDown' : 'chevronRight'} size={13} />
                    </button>
                    <Icon name={LAYER_ICONS[layer.type]} size={13} className="text-primary" />
                    <span className="min-w-0 flex-1 truncate font-medium">{layer.name}</span>
                    {animKeys.length > 0 && <span className="text-[10px] text-muted">{animKeys.length}</span>}
                  </div>
                  <div className="relative" style={{ width: trackW }} onPointerDown={() => st.setSelectedKeyframes([])}>
                    {/* Barre de durée de vie */}
                    <div
                      className={`absolute top-[6px] bottom-[6px] rounded-md ${isSel ? 'bg-primary/20 ring-1 ring-primary/40' : 'bg-sky'} ${layer.visible ? '' : 'opacity-40'}`}
                      style={{ left: layer.inPoint * zoom, width: Math.max(2, (layer.outPoint - layer.inPoint) * zoom) }}
                      onPointerDown={(e) => startBarDrag(e, layer, 'move')}
                      title="Glisser pour décaler le calque dans le temps"
                    >
                      <span className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize rounded-l-md hover:bg-accent/50" onPointerDown={(e) => startBarDrag(e, layer, 'in')} />
                      <span className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize rounded-r-md hover:bg-accent/50" onPointerDown={(e) => startBarDrag(e, layer, 'out')} />
                    </div>
                    {[...byTime.entries()].map(([t, ids]) => (
                      <Diamond
                        key={t}
                        kf={null}
                        x={t * zoom}
                        selected={ids.every((id) => selectedKfs.includes(id))}
                        active={Math.abs(t - time) < 1e-3}
                        title={`${ids.length} image${ids.length > 1 ? 's' : ''} clé${ids.length > 1 ? 's' : ''} à ${t.toFixed(2)} s`}
                        onPointerDown={(e) => startKeyDrag(e, ids, layer.id)}
                      />
                    ))}
                  </div>
                </div>

                {layer.expanded &&
                  animKeys.map((key) => {
                    const value = getProp(layer, key, time);
                    const def = PROP_DEFS[key];
                    const display =
                      def.type === 'number' ? `${Math.round(toDisplay(key, Number(value)) * 10) / 10}${def.display === 'percent' ? ' %' : def.display === 'deg' ? '°' : ''}` : def.type === 'color' ? String(value) : 'tracé';
                    return (
                      <div key={key} className="flex border-b border-line/50 bg-canvas/60" style={{ height: SUB_H }}>
                        <div
                          className="sticky left-0 z-20 flex shrink-0 items-center gap-2 border-r border-line bg-canvas pr-2 text-[11px] text-muted"
                          style={{ width: LEFT_W, paddingLeft: 34 + depth * 14 }}
                        >
                          {def.type === 'color' && <span className="h-3 w-3 rounded-sm border border-line" style={{ background: String(value) }} />}
                          <span className="min-w-0 flex-1 truncate">{def.label}</span>
                          <span className="font-mono tabular-nums text-navy/70">{display}</span>
                        </div>
                        <div className="relative" style={{ width: trackW }} onPointerDown={() => st.setSelectedKeyframes([])}>
                          <div className="absolute inset-x-0 top-1/2 h-px bg-line" />
                          {layer.props[key]!.keyframes.map((kf) => (
                            <Diamond
                              key={kf.id}
                              kf={kf}
                              x={kf.time * zoom}
                              selected={selectedKfs.includes(kf.id)}
                              active={Math.abs(kf.time - time) < 1e-3}
                              title={`${def.label} · ${kf.time.toFixed(2)} s · ${kf.easing.type}`}
                              onPointerDown={(e) => startKeyDrag(e, [kf.id], layer.id)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
              </div>
            );
          })}

          {comp.audio && <AudioRow comp={comp} zoom={zoom} trackW={trackW} assetName={project.assets.find((a) => a.id === comp.audio!.assetId)?.name ?? 'Audio'} />}

          {nodes.length === 0 && !comp.audio && (
            <div className="sticky left-0 px-4 py-6 text-[12px] text-muted" style={{ width: 'min(100%, 600px)' }}>
              Les calques et leurs images clés apparaîtront ici.
            </div>
          )}

          {/* Tête de lecture */}
          <div className="pointer-events-none absolute top-0 bottom-0 z-40" style={{ left: LEFT_W + time * zoom }}>
            <div className="absolute top-0 bottom-0 w-px -translate-x-1/2 bg-primary" />
            <div
              className="pointer-events-auto absolute top-0 h-[18px] w-[14px] -translate-x-1/2 cursor-ew-resize rounded-b-[4px] bg-primary shadow"
              onPointerDown={startScrub}
              title="Tête de lecture"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function AudioRow({ comp, zoom, trackW, assetName }: { comp: Composition; zoom: number; trackW: number; assetName: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const project = useStore((s) => s.project);
  const st = useStore.getState();
  const track = comp.audio!;
  const asset = project.assets.find((a) => a.id === track.assetId);
  const duration = asset?.duration ?? comp.duration;
  const w = Math.max(4, duration * zoom);

  useEffect(() => {
    if (!asset) return;
    let cancelled = false;
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      const dpr = window.devicePixelRatio || 1;
      const width = Math.min(16000, Math.round(w));
      canvas.width = width * dpr;
      canvas.height = 40 * dpr;
      canvas.style.width = `${width}px`;
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, 40);
      const peaks = getPeaks(asset, Math.max(10, Math.floor(width / 2)));
      if (!peaks) return;
      ctx.fillStyle = track.muted ? '#94A3B8' : '#1E5EFF';
      const bw = width / peaks.length;
      peaks.forEach((p, i) => {
        const h = Math.max(1, p * 36 * track.volume);
        ctx.fillRect(i * bw, 20 - h / 2, Math.max(1, bw - 0.6), h);
      });
    };
    void loadAudioBuffer(asset).then(draw);
    const off = onAssetLoaded(draw);
    draw();
    return () => {
      cancelled = true;
      off();
    };
  }, [asset, w, track.muted, track.volume]);

  const startDrag = (e: React.PointerEvent) => {
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const start = track.offset;
    const merge = `audio-${Date.now()}`;
    const move = (ev: PointerEvent) => {
      const off = Math.round((start + (ev.clientX - startX) / zoom) * comp.fps) / comp.fps;
      st.updateComp((c) => void (c.audio && (c.audio.offset = off)), { merge });
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  return (
    <div className="flex border-b border-line" style={{ height: 52 }}>
      <div className="sticky left-0 z-20 flex shrink-0 flex-col justify-center gap-1 border-r border-line bg-surface px-3 text-[12px]" style={{ width: LEFT_W }}>
        <div className="flex items-center gap-1.5">
          <Icon name="audio" size={13} className="text-primary" />
          <span className="min-w-0 flex-1 truncate font-medium">{assetName}</span>
          <button
            className="icon-btn !h-6 !w-6"
            title={track.muted ? 'Réactiver le son' : 'Couper le son'}
            onClick={() => st.updateComp((c) => void (c.audio && (c.audio.muted = !c.audio.muted)))}
          >
            <Icon name={track.muted ? 'eyeOff' : 'eye'} size={13} />
          </button>
          <button className="icon-btn !h-6 !w-6 hover:!text-red-600" title="Retirer la piste audio" onClick={() => st.updateComp((c) => void (c.audio = null))}>
            <Icon name="trash" size={13} />
          </button>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-muted">
          Volume
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={track.volume}
            className="h-1 flex-1"
            onChange={(e) => st.updateComp((c) => void (c.audio && (c.audio.volume = Number(e.target.value))), { merge: 'audio-volume' })}
          />
        </label>
      </div>
      <div className="relative overflow-hidden" style={{ width: trackW }}>
        <div
          className="absolute top-1.5 bottom-1.5 cursor-grab rounded-md bg-sky/80 ring-1 ring-primary/20 active:cursor-grabbing"
          style={{ left: track.offset * zoom, width: w }}
          onPointerDown={startDrag}
          title="Glisser pour décaler le son"
          data-testid="audio-waveform"
        >
          <canvas ref={canvasRef} height={40} className="block" />
        </div>
      </div>
    </div>
  );
}
