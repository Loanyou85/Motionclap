export interface RGBA {
  r: number; // 0-255
  g: number;
  b: number;
  a: number; // 0-1
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Analyse #rgb, #rgba, #rrggbb, #rrggbbaa, rgb(), rgba(), « transparent » et « none ». */
export function parseColor(input: string): RGBA {
  const s = input.trim().toLowerCase();
  if (s === 'transparent' || s === 'none' || s === '') return { r: 0, g: 0, b: 0, a: 0 };
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(h)) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      };
    }
  }
  const m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return {
      r: clamp(parts[0] ?? 0, 0, 255),
      g: clamp(parts[1] ?? 0, 0, 255),
      b: clamp(parts[2] ?? 0, 0, 255),
      a: clamp(parts[3] ?? 1, 0, 1),
    };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

const hex2 = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');

/** Sérialise en #RRGGBB, ou #RRGGBBAA si la couleur est translucide. */
export function toHex(c: RGBA): string {
  const base = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`.toUpperCase();
  return c.a >= 0.999 ? base : `${base}${hex2(c.a * 255).toUpperCase()}`;
}

export function toRgbaString(c: RGBA): string {
  const a = Math.round(clamp(c.a, 0, 1) * 1000) / 1000;
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${a})`;
}

/** Interpolation linéaire de deux couleurs (alpha prémultiplié pour éviter les halos gris). */
export function lerpColor(a: string, b: string, t: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  const alpha = ca.a + (cb.a - ca.a) * t;
  if (alpha <= 0) return toHex({ r: 0, g: 0, b: 0, a: 0 });
  const mix = (x: number, y: number) => (x * ca.a + (y * cb.a - x * ca.a) * t) / alpha;
  return toHex({
    r: ca.a === 0 ? cb.r : cb.a === 0 ? ca.r : mix(ca.r, cb.r),
    g: ca.a === 0 ? cb.g : cb.a === 0 ? ca.g : mix(ca.g, cb.g),
    b: ca.a === 0 ? cb.b : cb.a === 0 ? ca.b : mix(ca.b, cb.b),
    a: alpha,
  });
}

/** Couleur sans alpha (#RRGGBB) pour les champs <input type="color">. */
export function opaqueHex(input: string): string {
  return toHex({ ...parseColor(input), a: 1 });
}

export function colorAlpha(input: string): number {
  return parseColor(input).a;
}

export function withAlpha(input: string, a: number): string {
  return toHex({ ...parseColor(input), a: clamp(a, 0, 1) });
}

export function isVisibleColor(input: string): boolean {
  return parseColor(input).a > 0.001;
}
