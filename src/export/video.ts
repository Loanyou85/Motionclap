import type { Composition, Project } from '../engine/types';
import { getAudioBuffer, loadAudioBuffer, preloadImages } from '../render/assets';
import { renderToCanvas } from '../render/renderer';
import { registerFonts } from '../render/fonts';
import { encodeWav, outputSize } from './wav';

export type VideoFormat = 'mp4' | 'webm';

export interface VideoOptions {
  format: VideoFormat;
  fps: number;
  /** Petit côté de l'image en pixels (480, 720, 1080). */
  quality: number;
  audio: boolean;
  /** Filigrane « Atelier Motion » (formule Gratuite). */
  watermark: boolean;
}

export type ProgressFn = (ratio: number, label: string) => void;

export class ExportCancelled extends Error {
  constructor() {
    super('Export annulé');
  }
}

/** Mixe la piste audio de la composition (décalage, volume) sur sa durée exacte. */
async function renderAudio(project: Project, comp: Composition, sampleRate = 48000): Promise<AudioBuffer | null> {
  const track = comp.audio;
  if (!track || track.muted) return null;
  const asset = project.assets.find((a) => a.id === track.assetId);
  if (!asset) return null;
  const buffer = getAudioBuffer(asset) ?? (await loadAudioBuffer(asset));
  if (!buffer) return null;
  const length = Math.ceil(comp.duration * sampleRate);
  const ctx = new OfflineAudioContext(2, length, sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = track.volume;
  src.connect(gain).connect(ctx.destination);
  if (track.offset >= 0) src.start(track.offset);
  else src.start(0, -track.offset);
  return ctx.startRendering();
}

function makeCanvas(comp: Composition, quality: number): HTMLCanvasElement {
  const { width, height } = outputSize(comp.width, comp.height, quality);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Filigrane discret en bas à droite (formule Gratuite). */
export function drawWatermark(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')!;
  const size = Math.max(12, Math.round(Math.min(canvas.width, canvas.height) * 0.032));
  const pad = Math.round(size * 0.9);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `700 ${size}px 'Inter Variable', Inter, system-ui, sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  const text = 'Réalisé avec Atelier Motion';
  const w = ctx.measureText(text).width;
  const x = canvas.width - pad;
  const y = canvas.height - pad;
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = 'rgba(10,31,68,0.55)';
  const h = size * 1.6;
  ctx.beginPath();
  ctx.roundRect(x - w - size * 0.7, y - size * 1.15, w + size * 1.4, h, size * 0.4);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(text, x, y);
  ctx.restore();
}

function renderFrame(canvas: HTMLCanvasElement, project: Project, comp: Composition, t: number, watermark: boolean) {
  renderToCanvas(canvas, project, comp, t);
  if (watermark) drawWatermark(canvas);
}

async function prepare(project: Project) {
  await preloadImages(project.assets);
  await registerFonts(project.assets);
  await document.fonts?.ready;
}

const frameCount = (comp: Composition, fps: number) => Math.max(1, Math.round(comp.duration * fps));

/** Le navigateur sait-il encoder en WebM via WebCodecs ? */
async function pickVpCodec(width: number, height: number, fps: number): Promise<{ codec: string; mux: 'V_VP9' | 'V_VP8' } | null> {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const [codec, mux] of [
    ['vp09.00.40.08', 'V_VP9'],
    ['vp8', 'V_VP8'],
  ] as const) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec, width, height, framerate: fps, bitrate: 8_000_000 });
      if (r.supported) return { codec, mux };
    } catch {
      /* essai suivant */
    }
  }
  return null;
}

/** WebM : WebCodecs (rapide, image par image) avec repli sur MediaRecorder (temps réel). */
async function exportWebm(project: Project, comp: Composition, opts: VideoOptions, progress: ProgressFn, signal: AbortSignal): Promise<Blob> {
  const canvas = makeCanvas(comp, opts.quality);
  const total = frameCount(comp, opts.fps);
  const vp = await pickVpCodec(canvas.width, canvas.height, opts.fps);
  const audio = opts.audio ? await renderAudio(project, comp) : null;

  if (!vp) return exportWithMediaRecorder(project, comp, canvas, opts, audio, progress, signal);

  const { Muxer, ArrayBufferTarget } = await import('webm-muxer');
  const useAudio = !!audio && typeof AudioEncoder !== 'undefined';
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: vp.mux, width: canvas.width, height: canvas.height, frameRate: opts.fps },
    audio: useAudio ? { codec: 'A_OPUS', sampleRate: 48000, numberOfChannels: 2 } : undefined,
  });
  let encodeError: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (encodeError = e),
  });
  encoder.configure({ codec: vp.codec, width: canvas.width, height: canvas.height, framerate: opts.fps, bitrate: Math.round(canvas.width * canvas.height * opts.fps * 0.15) });

  for (let i = 0; i < total; i++) {
    if (signal.aborted) throw new ExportCancelled();
    if (encodeError) throw encodeError;
    renderFrame(canvas, project, comp, i / opts.fps, opts.watermark);
    const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / opts.fps), duration: Math.round(1e6 / opts.fps) });
    encoder.encode(frame, { keyFrame: i % (opts.fps * 2) === 0 });
    frame.close();
    if (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
    if (i % 4 === 0) {
      progress(i / total, `Image ${i + 1} / ${total}`);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  await encoder.flush();
  encoder.close();

  if (useAudio && audio) {
    progress(0.97, 'Encodage du son…');
    await encodeOpus(audio, muxer);
  }
  muxer.finalize();
  progress(1, 'Terminé');
  return new Blob([muxer.target.buffer], { type: 'video/webm' });
}

/** Encode l'audio mixé en Opus et l'ajoute au conteneur WebM. */
async function encodeOpus(audio: AudioBuffer, muxer: { addAudioChunk: (c: EncodedAudioChunk, m?: EncodedAudioChunkMetadata) => void }) {
  let err: unknown = null;
  const enc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => (err = e) });
  enc.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 160_000 });
  const chunk = 4800;
  const left = audio.getChannelData(0);
  const right = audio.numberOfChannels > 1 ? audio.getChannelData(1) : left;
  for (let i = 0; i < audio.length; i += chunk) {
    const n = Math.min(chunk, audio.length - i);
    const data = new Float32Array(n * 2);
    data.set(left.subarray(i, i + n), 0);
    data.set(right.subarray(i, i + n), n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / 48000) * 1e6), data });
    enc.encode(ad);
    ad.close();
  }
  await enc.flush();
  enc.close();
  if (err) throw err;
}

/** Repli : capture du canvas en temps réel (navigateurs sans WebCodecs). */
async function exportWithMediaRecorder(
  project: Project,
  comp: Composition,
  canvas: HTMLCanvasElement,
  opts: VideoOptions,
  audio: AudioBuffer | null,
  progress: ProgressFn,
  signal: AbortSignal,
): Promise<Blob> {
  const stream = canvas.captureStream(opts.fps);
  let audioCtx: AudioContext | null = null;
  if (audio) {
    audioCtx = new AudioContext();
    const dest = audioCtx.createMediaStreamDestination();
    const src = audioCtx.createBufferSource();
    src.buffer = audio;
    src.connect(dest);
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    src.start();
  }
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((r) => (rec.onstop = () => r()));
  rec.start(250);
  const start = performance.now();
  await new Promise<void>((resolve, reject) => {
    const tick = () => {
      if (signal.aborted) return reject(new ExportCancelled());
      const t = (performance.now() - start) / 1000;
      if (t >= comp.duration) return resolve();
      renderFrame(canvas, project, comp, t, opts.watermark);
      progress(t / comp.duration, 'Enregistrement en temps réel…');
      requestAnimationFrame(tick);
    };
    tick();
  }).finally(() => {
    rec.stop();
    void audioCtx?.close();
  });
  await done;
  progress(1, 'Terminé');
  return new Blob(chunks, { type: 'video/webm' });
}

/** Profil H.264 High adapté à la définition et à la cadence. */
export function avcCodec(height: number, fps: number): string {
  if (height > 1080) return fps > 30 ? 'avc1.640034' : 'avc1.640033'; // niveaux 5.2 / 5.1
  return fps > 30 ? 'avc1.64002A' : 'avc1.640028'; // niveaux 4.2 / 4.0
}

/** MP4 via WebCodecs + mp4-muxer quand le navigateur sait encoder en H.264 (et en AAC si besoin). */
async function exportMp4WebCodecs(
  project: Project,
  comp: Composition,
  opts: VideoOptions,
  audio: AudioBuffer | null,
  progress: ProgressFn,
  signal: AbortSignal,
): Promise<Blob | null> {
  if (typeof VideoEncoder === 'undefined') return null;
  const canvas = makeCanvas(comp, opts.quality);
  const codec = avcCodec(Math.min(canvas.width, canvas.height), opts.fps);
  const bitrate = Math.round(canvas.width * canvas.height * opts.fps * 0.12);
  const videoConfig: VideoEncoderConfig = { codec, width: canvas.width, height: canvas.height, framerate: opts.fps, bitrate, avc: { format: 'avc' } };
  try {
    if (!(await VideoEncoder.isConfigSupported(videoConfig)).supported) return null;
    if (audio) {
      if (typeof AudioEncoder === 'undefined') return null;
      const a = await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 192_000 });
      if (!a.supported) return null;
    }
  } catch {
    return null;
  }
  const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: canvas.width, height: canvas.height, frameRate: opts.fps },
    audio: audio ? { codec: 'aac', sampleRate: 48000, numberOfChannels: 2 } : undefined,
    fastStart: 'in-memory',
  });
  let encodeError: unknown = null;
  const encoder = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => (encodeError = e) });
  encoder.configure(videoConfig);
  const total = frameCount(comp, opts.fps);
  for (let i = 0; i < total; i++) {
    if (signal.aborted) throw new ExportCancelled();
    if (encodeError) throw encodeError;
    renderFrame(canvas, project, comp, i / opts.fps, opts.watermark);
    const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / opts.fps), duration: Math.round(1e6 / opts.fps) });
    encoder.encode(frame, { keyFrame: i % (opts.fps * 2) === 0 });
    frame.close();
    while (encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 2));
    if (i % 4 === 0) {
      progress(i / total, `Encodage H.264 — image ${i + 1} / ${total}`);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  await encoder.flush();
  encoder.close();
  if (audio) {
    progress(0.97, 'Encodage du son (AAC)…');
    let err: unknown = null;
    const enc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => (err = e) });
    enc.configure({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 192_000 });
    const left = audio.getChannelData(0);
    const right = audio.numberOfChannels > 1 ? audio.getChannelData(1) : left;
    for (let i = 0; i < audio.length; i += 4800) {
      const n = Math.min(4800, audio.length - i);
      const data = new Float32Array(n * 2);
      data.set(left.subarray(i, i + n), 0);
      data.set(right.subarray(i, i + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / 48000) * 1e6), data });
      enc.encode(ad);
      ad.close();
    }
    await enc.flush();
    enc.close();
    if (err) throw err;
  }
  muxer.finalize();
  progress(1, 'Terminé');
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}

/** MP4 (H.264 + AAC) : WebCodecs si disponible, sinon ffmpeg.wasm chargé à la demande. */
async function exportMp4(project: Project, comp: Composition, opts: VideoOptions, progress: ProgressFn, signal: AbortSignal): Promise<Blob> {
  const mixed = opts.audio ? await renderAudio(project, comp) : null;
  const fast = await exportMp4WebCodecs(project, comp, opts, mixed, progress, signal);
  if (fast) return fast;
  progress(0, 'Chargement de ffmpeg.wasm (≈ 30 Mo, une seule fois)…');
  const [{ FFmpeg }, coreMod, wasmMod] = await Promise.all([
    import('@ffmpeg/ffmpeg'),
    import('@ffmpeg/core?url'),
    import('@ffmpeg/core/wasm?url'),
  ]);
  const ffmpeg = new FFmpeg();
  await ffmpeg.load({ coreURL: coreMod.default, wasmURL: wasmMod.default });
  const onAbort = () => ffmpeg.terminate();
  signal.addEventListener('abort', onAbort);
  try {
    const canvas = makeCanvas(comp, opts.quality);
    const total = frameCount(comp, opts.fps);
    for (let i = 0; i < total; i++) {
      if (signal.aborted) throw new ExportCancelled();
      renderFrame(canvas, project, comp, i / opts.fps, opts.watermark);
      // En 4K, une qualité JPEG un peu plus basse limite la mémoire utilisée par ffmpeg.wasm.
      const blob = await new Promise<Blob>((r, j) => canvas.toBlob((b) => (b ? r(b) : j(new Error('Image vide'))), 'image/jpeg', canvas.height * canvas.width > 4e6 ? 0.85 : 0.93));
      await ffmpeg.writeFile(`f${String(i).padStart(5, '0')}.jpg`, new Uint8Array(await blob.arrayBuffer()));
      if (i % 3 === 0) progress((i / total) * 0.6, `Rendu des images ${i + 1} / ${total}`);
    }
    const args = ['-framerate', String(opts.fps), '-i', 'f%05d.jpg'];
    const audio = mixed;
    if (audio) {
      const chans = [audio.getChannelData(0), audio.numberOfChannels > 1 ? audio.getChannelData(1) : audio.getChannelData(0)];
      await ffmpeg.writeFile('son.wav', encodeWav(chans, audio.sampleRate));
      args.push('-i', 'son.wav');
    }
    args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '20', '-r', String(opts.fps));
    if (audio) args.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
    args.push('-movflags', '+faststart', 'sortie.mp4');
    ffmpeg.on('progress', ({ progress: p }) => progress(0.6 + Math.min(1, Math.max(0, p)) * 0.4, 'Encodage H.264…'));
    const code = await ffmpeg.exec(args);
    if (code !== 0) throw new Error(`ffmpeg a échoué (code ${code})`);
    const data = await ffmpeg.readFile('sortie.mp4');
    progress(1, 'Terminé');
    return new Blob([data as Uint8Array<ArrayBuffer>], { type: 'video/mp4' });
  } finally {
    signal.removeEventListener('abort', onAbort);
    try {
      ffmpeg.terminate();
    } catch {
      /* déjà terminé */
    }
  }
}

export async function exportVideo(project: Project, comp: Composition, opts: VideoOptions, progress: ProgressFn, signal: AbortSignal): Promise<Blob> {
  await prepare(project);
  return opts.format === 'mp4' ? exportMp4(project, comp, opts, progress, signal) : exportWebm(project, comp, opts, progress, signal);
}
