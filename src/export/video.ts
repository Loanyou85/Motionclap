import type { Composition, Project } from '../engine/types';
import { getAudioBuffer, loadAudioBuffer, preloadImages } from '../render/assets';
import { renderToCanvas } from '../render/renderer';
import { encodeWav, outputSize } from './wav';

export type VideoFormat = 'mp4' | 'webm';

export interface VideoOptions {
  format: VideoFormat;
  fps: number;
  /** Petit côté de l'image en pixels (480, 720, 1080). */
  quality: number;
  audio: boolean;
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

async function prepare(project: Project) {
  await preloadImages(project.assets);
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
    renderToCanvas(canvas, project, comp, i / opts.fps);
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
      renderToCanvas(canvas, project, comp, t);
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

/** MP4 (H.264 + AAC) via ffmpeg.wasm, chargé à la demande. */
async function exportMp4(project: Project, comp: Composition, opts: VideoOptions, progress: ProgressFn, signal: AbortSignal): Promise<Blob> {
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
      renderToCanvas(canvas, project, comp, i / opts.fps);
      const blob = await new Promise<Blob>((r, j) => canvas.toBlob((b) => (b ? r(b) : j(new Error('Image vide'))), 'image/jpeg', 0.93));
      await ffmpeg.writeFile(`f${String(i).padStart(5, '0')}.jpg`, new Uint8Array(await blob.arrayBuffer()));
      if (i % 3 === 0) progress((i / total) * 0.6, `Rendu des images ${i + 1} / ${total}`);
    }
    const args = ['-framerate', String(opts.fps), '-i', 'f%05d.jpg'];
    const audio = opts.audio ? await renderAudio(project, comp) : null;
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
