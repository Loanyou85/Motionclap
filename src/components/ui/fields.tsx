import { useEffect, useRef, useState, type ReactNode } from 'react';
import { colorAlpha, opaqueHex, withAlpha } from '../../engine/color';

const round = (v: number, step: number) => {
  const decimals = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)));
  return Number(v.toFixed(decimals));
};

interface NumberFieldProps {
  value: number;
  onChange: (v: number, phase: 'drag' | 'commit') => void;
  label?: ReactNode;
  suffix?: string;
  step?: number;
  min?: number;
  max?: number;
  className?: string;
  title?: string;
  disabled?: boolean;
}

/**
 * Champ numérique : saisie directe ou glisser horizontalement sur l'étiquette
 * pour faire défiler la valeur (Maj = ×10, Alt = ÷10).
 */
export function NumberField({ value, onChange, label, suffix, step = 1, min, max, className = '', title, disabled }: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const drag = useRef<{ x: number; start: number } | null>(null);

  const clamp = (v: number) => {
    let out = v;
    if (min !== undefined) out = Math.max(min, out);
    if (max !== undefined) out = Math.min(max, out);
    return out;
  };

  const commitDraft = () => {
    if (draft === null) return;
    const parsed = Number(draft.replace(',', '.'));
    if (Number.isFinite(parsed)) onChange(clamp(parsed), 'commit');
    setDraft(null);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, start: value };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    const dx = e.clientX - drag.current.x;
    onChange(clamp(round(drag.current.start + dx * step * mult, step * (e.altKey ? 0.1 : 1))), 'drag');
  };
  const onPointerUp = () => {
    if (drag.current) onChange(value, 'commit');
    drag.current = null;
  };

  return (
    <label className={`flex items-center gap-2 min-w-0 ${className}`} title={title}>
      {label !== undefined && (
        <span
          className={`field-label shrink-0 ${disabled ? '' : 'cursor-ew-resize hover:text-accent'}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {label}
        </span>
      )}
      <span className="relative flex-1 min-w-0">
        <input
          className="field pr-6 tabular-nums"
          value={draft ?? String(round(value, step))}
          disabled={disabled}
          inputMode="decimal"
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setDraft(null);
              (e.target as HTMLInputElement).blur();
            }
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
              onChange(clamp(round(value + d, step)), 'commit');
              setDraft(null);
            }
          }}
        />
        {suffix && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted">{suffix}</span>}
      </span>
    </label>
  );
}

interface ColorFieldProps {
  value: string;
  onChange: (v: string, phase: 'drag' | 'commit') => void;
}

/** Sélecteur de couleur avec saisie hexadécimale et opacité. */
export function ColorField({ value, onChange }: ColorFieldProps) {
  const alpha = colorAlpha(value);
  const [hex, setHex] = useState(opaqueHex(value));
  useEffect(() => setHex(opaqueHex(value)), [value]);

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="relative w-7 h-7 shrink-0 rounded-md checker overflow-hidden border border-line">
        <span className="absolute inset-0" style={{ background: value }} />
        <input
          type="color"
          className="absolute inset-0 opacity-0 w-full h-full"
          value={opaqueHex(value)}
          onChange={(e) => onChange(withAlpha(e.target.value, alpha === 0 ? 1 : alpha), 'drag')}
          onBlur={() => onChange(value, 'commit')}
          aria-label="Choisir une couleur"
        />
      </span>
      <input
        className="field font-mono uppercase min-w-[64px] flex-1 px-1.5"
        aria-label="Couleur hexadécimale"
        value={hex}
        onChange={(e) => setHex(e.target.value)}
        onBlur={() => {
          if (/^#?[0-9a-f]{6}$/i.test(hex)) onChange(withAlpha(hex.startsWith('#') ? hex : `#${hex}`, alpha || 1), 'commit');
          else setHex(opaqueHex(value));
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <input
        className="field w-11 shrink-0 px-1.5 tabular-nums"
        title="Opacité de la couleur (%) — 0 pour aucune couleur"
        aria-label="Opacité de la couleur"
        value={Math.round(alpha * 100)}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(withAlpha(value, Math.min(100, Math.max(0, v)) / 100), 'commit');
        }}
      />
    </div>
  );
}

export function TextField({
  value,
  onCommit,
  className = '',
  multiline = false,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
  multiline?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  if (multiline) {
    return (
      <textarea
        className={`field h-auto py-1.5 resize-y min-h-[56px] ${className}`}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => {
          setDraft(e.target.value);
          onCommit(e.target.value);
        }}
      />
    );
  }
  return (
    <input
      className={`field ${className}`}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  className = '',
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <select className={`field pr-6 cursor-pointer ${className}`} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
