/** Encode des canaux PCM flottants en fichier WAV 16 bits. */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const numCh = Math.max(1, channels.length);
  const length = channels[0]?.length ?? 0;
  const bytesPerSample = 2;
  const dataSize = length * numCh * bytesPerSample;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true); // taille du bloc fmt
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numCh * bytesPerSample, true);
  view.setUint16(32, numCh * bytesPerSample, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, dataSize, true);
  let off = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numCh; c++) {
      const v = Math.max(-1, Math.min(1, channels[c]?.[i] ?? 0));
      view.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      off += 2;
    }
  }
  return new Uint8Array(buf);
}

/** Dimensions de sortie : `short` = petit côté (720, 1080…), arrondies au pair pour H.264. */
export function outputSize(width: number, height: number, short: number): { width: number; height: number } {
  const s = short / Math.min(width, height);
  const even = (v: number) => Math.max(2, Math.round((v * s) / 2) * 2);
  return { width: even(width), height: even(height) };
}
