import { useEffect } from 'react';
import { getAudioBuffer, getAudioContext, loadAudioBuffer } from '../render/assets';
import { activeComp, useStore } from '../store/store';

/**
 * Boucle de lecture : fait avancer la tête de lecture en temps réel
 * et joue la piste audio de la composition en synchronisation.
 */
export function usePlayback() {
  const playing = useStore((s) => s.playing);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let source: AudioBufferSourceNode | null = null;
    let gain: GainNode | null = null;

    const startAudio = (from: number) => {
      stopAudio();
      const s = useStore.getState();
      const comp = activeComp(s);
      const track = comp.audio;
      if (!track || track.muted) return;
      const asset = s.project.assets.find((a) => a.id === track.assetId);
      const buffer = getAudioBuffer(asset);
      if (!buffer) {
        if (asset) void loadAudioBuffer(asset);
        return;
      }
      const ctx = getAudioContext();
      void ctx.resume();
      const offsetInFile = from - track.offset;
      source = ctx.createBufferSource();
      source.buffer = buffer;
      gain = ctx.createGain();
      gain.gain.value = track.volume;
      source.connect(gain).connect(ctx.destination);
      const remaining = comp.duration - from;
      if (offsetInFile >= 0) {
        if (offsetInFile < buffer.duration) source.start(0, offsetInFile, remaining);
      } else {
        source.start(ctx.currentTime - offsetInFile, 0, Math.max(0, remaining + offsetInFile));
      }
    };
    const stopAudio = () => {
      try {
        source?.stop();
      } catch {
        /* déjà arrêté */
      }
      source?.disconnect();
      gain?.disconnect();
      source = null;
      gain = null;
    };

    let startWall = performance.now();
    let startTime = useStore.getState().time;
    startAudio(startTime);

    const tick = () => {
      const s = useStore.getState();
      const comp = activeComp(s);
      let t = startTime + (performance.now() - startWall) / 1000;
      if (t >= comp.duration) {
        if (s.loop) {
          startWall = performance.now();
          startTime = 0;
          t = 0;
          startAudio(0);
        } else {
          s.setTime(comp.duration);
          s.setPlaying(false);
          return;
        }
      }
      // Pas de recalage sur les images ici : setTime le fait à la cadence de la composition.
      s.setTime(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // Si l'utilisateur déplace la tête de lecture pendant la lecture, on repart de là.
    const unsub = useStore.subscribe((st, prev) => {
      if (!st.playing) return;
      const expected = startTime + (performance.now() - startWall) / 1000;
      if (st.time !== prev.time && Math.abs(st.time - expected) > 0.25) {
        startTime = st.time;
        startWall = performance.now();
        startAudio(st.time);
      }
    });

    return () => {
      cancelAnimationFrame(raf);
      unsub();
      stopAudio();
    };
  }, [playing]);
}
