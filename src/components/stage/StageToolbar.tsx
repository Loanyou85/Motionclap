import { FORMATS, formatIdOf } from '../../engine/defaults';
import { activeComp, useStore } from '../../store/store';
import { Icon } from '../ui/Icon';

const ZOOMS = [0.1, 0.25, 0.33, 0.5, 0.75, 1, 1.5, 2, 4];

export function StageToolbar() {
  const comp = useStore((s) => activeComp(s));
  const compositions = useStore((s) => s.project.compositions);
  const mainCompId = useStore((s) => s.project.mainCompId);
  const zoom = useStore((s) => s.stageZoom);
  const showGuides = useStore((s) => s.showGuides);
  const snap = useStore((s) => s.snap);
  const st = useStore.getState();
  const formatId = formatIdOf(comp);

  const setFormat = (id: string) => {
    const f = FORMATS.find((x) => x.id === id);
    if (!f) return;
    // Les calques restent à la même place relative au centre.
    const dx = (f.width - comp.width) / 2;
    const dy = (f.height - comp.height) / 2;
    st.updateComp((c) => {
      c.width = f.width;
      c.height = f.height;
      for (const l of c.layers) {
        if (l.parentId) continue;
        const px = l.props.x;
        const py = l.props.y;
        if (px) {
          px.value = Number(px.value) + dx;
          for (const k of px.keyframes) k.value = Number(k.value) + dx;
        }
        if (py) {
          py.value = Number(py.value) + dy;
          for (const k of py.keyframes) k.value = Number(k.value) + dy;
        }
      }
    });
    st.setStageZoom('fit');
  };

  const zoomStep = (dir: 1 | -1) => {
    const cur = typeof zoom === 'number' ? zoom : 0.5;
    const next = dir > 0 ? ZOOMS.find((z) => z > cur + 1e-6) : [...ZOOMS].reverse().find((z) => z < cur - 1e-6);
    if (next) st.setStageZoom(next);
  };

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 px-3 border-b border-line bg-surface rounded-t-am">
      {compositions.length > 1 && (
        <div className="flex items-center gap-1 overflow-x-auto max-w-[45%]" role="tablist" aria-label="Compositions">
          {compositions.map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={c.id === comp.id}
              className={`tab h-7 whitespace-nowrap text-[12px] ${c.id === comp.id ? 'tab-active' : ''}`}
              onClick={() => st.setActiveComp(c.id)}
              title={c.id === mainCompId ? 'Composition principale' : 'Précomposition'}
            >
              {c.id === mainCompId ? '★ ' : ''}
              {c.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1" role="group" aria-label="Format">
        {FORMATS.map((f) => (
          <button
            key={f.id}
            className={`tab h-7 text-[12px] ${formatId === f.id ? 'tab-active' : ''}`}
            onClick={() => setFormat(f.id)}
            title={`${f.label} (${f.width}×${f.height})`}
          >
            {f.id}
          </button>
        ))}
        {formatId === 'custom' && <span className="chip">{comp.width}×{comp.height}</span>}
      </div>
      <div className="flex-1" />
      <button className={`icon-btn ${showGuides ? 'icon-btn-active' : ''}`} title="Repères (tiers, centre, zones de sécurité)" onClick={() => st.setShowGuides(!showGuides)}>
        <Icon name="guides" />
      </button>
      <button className={`icon-btn ${snap ? 'icon-btn-active' : ''}`} title="Magnétisme (Alt pour l’ignorer)" onClick={() => st.setSnap(!snap)}>
        <Icon name="magnet" />
      </button>
      <span className="mx-1 h-5 w-px bg-line" />
      <button className="icon-btn" title="Zoom arrière" onClick={() => zoomStep(-1)}>
        <Icon name="zoomOut" />
      </button>
      <select
        className="field w-[92px] h-7 tabular-nums"
        aria-label="Zoom"
        value={zoom === 'fit' ? 'fit' : String(zoom)}
        onChange={(e) => st.setStageZoom(e.target.value === 'fit' ? 'fit' : Number(e.target.value))}
      >
        <option value="fit">Ajuster</option>
        {typeof zoom === 'number' && !ZOOMS.includes(zoom) && <option value={String(zoom)}>{Math.round(zoom * 100)} %</option>}
        {ZOOMS.map((z) => (
          <option key={z} value={String(z)}>
            {Math.round(z * 100)} %
          </option>
        ))}
      </select>
      <button className="icon-btn" title="Zoom avant" onClick={() => zoomStep(1)}>
        <Icon name="zoomIn" />
      </button>
      <button className="icon-btn" title="Ajuster à la fenêtre" onClick={() => st.setStageZoom('fit')}>
        <Icon name="fit" />
      </button>
    </div>
  );
}
