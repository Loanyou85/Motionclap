/**
 * Calcule les crêtes d'une forme d'onde : pour chaque tranche, l'amplitude max (0..1).
 * Plusieurs canaux sont fusionnés en prenant le maximum.
 */
export function computePeaks(channels: Float32Array[], buckets: number): number[] {
  const n = Math.max(1, Math.floor(buckets));
  const len = channels[0]?.length ?? 0;
  const peaks = new Array<number>(n).fill(0);
  if (len === 0) return peaks;
  const size = len / n;
  for (let b = 0; b < n; b++) {
    const start = Math.floor(b * size);
    const end = Math.max(start + 1, Math.floor((b + 1) * size));
    let max = 0;
    for (const ch of channels) {
      for (let i = start; i < end && i < len; i++) {
        const v = Math.abs(ch[i]);
        if (v > max) max = v;
      }
    }
    peaks[b] = Math.min(1, max);
  }
  return peaks;
}
