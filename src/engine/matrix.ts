/** Matrice affine 2D [a, b, c, d, e, f] (même convention que Canvas / DOMMatrix). */
export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** m1 × m2 : applique m2 puis m1. */
export function multiply(m1: Mat, m2: Mat): Mat {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

/** Translation, puis rotation (degrés), puis échelle. */
export function fromTRS(x: number, y: number, rotationDeg: number, sx: number, sy: number): Mat {
  const r = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [cos * sx, sin * sx, -sin * sy, cos * sy, x, y];
}

export function invert(m: Mat): Mat | null {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return null;
  const id = 1 / det;
  return [d * id, -b * id, -c * id, a * id, (c * f - d * e) * id, (b * e - a * f) * id];
}

export function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Décompose une matrice en translation / rotation / échelle (sans cisaillement). */
export function decompose(m: Mat): { x: number; y: number; rotation: number; scaleX: number; scaleY: number } {
  const [a, b, c, d, e, f] = m;
  const scaleX = Math.hypot(a, b);
  const det = a * d - b * c;
  const scaleY = scaleX === 0 ? Math.hypot(c, d) : det / scaleX;
  const rotation = (Math.atan2(b, a) * 180) / Math.PI;
  return { x: e, y: f, rotation, scaleX, scaleY };
}
