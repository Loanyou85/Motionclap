import { useEffect, useRef, useState } from 'react';
import { applyEasing, EASING_LABELS, EASING_TYPES, easingToBezier, sampleEasing } from '../../engine/easing';
import type { Bezier, Easing, EasingType } from '../../engine/types';

const W = 240;
const H = 180;
const PAD_X = 16;
// Marge verticale pour visualiser les dépassements (back, élastique).
const Y_MIN = -0.5;
const Y_MAX = 1.5;

const sx = (x: number) => PAD_X + x * (W - PAD_X * 2);
const sy = (y: number) => H - ((y - Y_MIN) / (Y_MAX - Y_MIN)) * H;
const ix = (px: number) => (px - PAD_X) / (W - PAD_X * 2);
const iy = (py: number) => Y_MIN + ((H - py) / H) * (Y_MAX - Y_MIN);

/** Éditeur visuel de courbe : choix du type et poignées cubic-bezier déplaçables. */
export function CurveEditor({ easing, onChange }: { easing: Easing; onChange: (e: Easing, phase: 'drag' | 'commit') => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<0 | 1 | null>(null);
  const bezier = easingToBezier(easing);
  const pts = sampleEasing(easing, 120);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'} ${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`).join(' ');

  const onPointerMove = (e: React.PointerEvent) => {
    if (dragging.current === null || !bezier) return;
    const rect = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const py = ((e.clientY - rect.top) / rect.height) * H;
    const x = Math.min(1, Math.max(0, ix(px)));
    const y = Math.min(Y_MAX, Math.max(Y_MIN, iy(py)));
    const r = (v: number) => Math.round(v * 100) / 100;
    const next: Bezier = [...bezier] as Bezier;
    if (dragging.current === 0) {
      next[0] = r(x);
      next[1] = r(y);
    } else {
      next[2] = r(x);
      next[3] = r(y);
    }
    onChange({ type: 'cubicBezier', bezier: next }, 'drag');
  };

  return (
    <div className="space-y-2">
      <select
        className="field cursor-pointer"
        value={easing.type}
        aria-label="Type de courbe"
        onChange={(e) => {
          const type = e.target.value as EasingType;
          onChange(type === 'cubicBezier' ? { type, bezier: bezier ?? [0.25, 0.1, 0.25, 1] } : { type }, 'commit');
        }}
      >
        {EASING_TYPES.map((t) => (
          <option key={t} value={t}>
            {EASING_LABELS[t]}
          </option>
        ))}
      </select>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full rounded-am border border-line bg-canvas touch-none select-none"
        onPointerMove={onPointerMove}
        onPointerUp={() => {
          if (dragging.current !== null) onChange(easing, 'commit');
          dragging.current = null;
        }}
        role="img"
        aria-label="Éditeur de courbe"
      >
        {/* Cadre 0 → 1 */}
        <rect x={sx(0)} y={sy(1)} width={sx(1) - sx(0)} height={sy(0) - sy(1)} fill="#FFFFFF" stroke="#E2E8F0" />
        {[0.25, 0.5, 0.75].map((g) => (
          <g key={g} stroke="#EEF2F7">
            <line x1={sx(g)} x2={sx(g)} y1={sy(1)} y2={sy(0)} />
            <line x1={sx(0)} x2={sx(1)} y1={sy(g)} y2={sy(g)} />
          </g>
        ))}
        <line x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)} stroke="#DBEAFE" strokeDasharray="4 4" />
        <path d={d} fill="none" stroke="#1E5EFF" strokeWidth={2.5} strokeLinecap="round" />
        {bezier && easing.type !== 'linear' && (
          <>
            <line x1={sx(0)} y1={sy(0)} x2={sx(bezier[0])} y2={sy(bezier[1])} stroke="#3B82F6" strokeWidth={1.5} />
            <line x1={sx(1)} y1={sy(1)} x2={sx(bezier[2])} y2={sy(bezier[3])} stroke="#3B82F6" strokeWidth={1.5} />
            {[0, 1].map((i) => (
              <circle
                key={i}
                cx={sx(bezier[i * 2])}
                cy={sy(bezier[i * 2 + 1])}
                r={7}
                fill="#FFFFFF"
                stroke="#1E5EFF"
                strokeWidth={2}
                className="cursor-grab"
                onPointerDown={(e) => {
                  (e.target as Element).setPointerCapture(e.pointerId);
                  dragging.current = i as 0 | 1;
                }}
              />
            ))}
          </>
        )}
        <circle cx={sx(0)} cy={sy(0)} r={3} fill="#0A1F44" />
        <circle cx={sx(1)} cy={sy(1)} r={3} fill="#0A1F44" />
      </svg>
      {bezier ? (
        <p className="font-mono text-[11px] text-muted">cubic-bezier({bezier.join(', ')})</p>
      ) : (
        <p className="text-[11px] text-muted">Courbe non bézier : exportée par échantillonnage en CSS et Lottie.</p>
      )}
      <EasingPreview easing={easing} />
    </div>
  );
}

/** Aperçu animé de la courbe : une pastille parcourt la piste. */
function EasingPreview({ easing }: { easing: Easing }) {
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const cycle = ((now - start) / 1000) % 1.8;
      setP(cycle > 1.2 ? 1 : cycle / 1.2);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const v = applyEasing(easing, p);
  return (
    <div className="relative h-6 rounded-full bg-sky" aria-hidden="true">
      <span
        className="absolute top-1 h-4 w-4 rounded-full bg-primary shadow"
        style={{ left: `calc(${Math.min(1.25, Math.max(-0.25, v)) * 100}% * 0.86 + 4px)` }}
      />
    </div>
  );
}
