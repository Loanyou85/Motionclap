import { useEffect, useMemo, useRef, useState } from 'react';
import { exportCss } from '../../export/css';
import { CUSTOM_EASE_CDN, exportGsap, GSAP_CDN } from '../../export/gsap';
import gsapSource from 'gsap/dist/gsap.min.js?raw';
import customEaseSource from 'gsap/dist/CustomEase.min.js?raw';
import { exportLottie } from '../../export/lottie';
import { ExportCancelled, exportVideo, type VideoFormat } from '../../export/video';
import { outputSize } from '../../export/wav';
import { copyText, downloadBlob, downloadText, slug } from '../../lib/download';
import { activeComp, useStore } from '../../store/store';
import { Icon, type IconName } from '../ui/Icon';
import { Modal } from '../ui/overlay';

type Tab = 'css' | 'gsap' | 'lottie' | 'video' | 'json';

const TABS: Array<{ id: Tab; label: string; icon: IconName }> = [
  { id: 'css', label: 'HTML + CSS', icon: 'code' },
  { id: 'gsap', label: 'GSAP', icon: 'code' },
  { id: 'lottie', label: 'Lottie JSON', icon: 'sparkles' },
  { id: 'video', label: 'Vidéo', icon: 'video' },
  { id: 'json', label: 'Projet JSON', icon: 'folder' },
];

const PREVIEW_LIMIT = 120_000;

/** Aperçu de la page exportée, mise à l'échelle dans un cadre. */
function HtmlPreview({ html, width, height }: { html: string; width: number; height: number }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  useEffect(() => {
    const el = boxRef.current!;
    const ro = new ResizeObserver(([e]) => setScale(Math.min(e.contentRect.width / width, 260 / height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);
  // On retire le centrage plein écran et on embarque GSAP : l'aperçu fonctionne hors ligne.
  const inline = (src: string) => `<script>${src.replace(/<\/script/gi, '<\\/script')}</script>`;
  const doc = html
    .replace('</style>', 'body{min-height:0!important;display:block!important;background:transparent!important}</style>')
    .replace(`<script src="${GSAP_CDN}"></script>`, () => inline(gsapSource))
    .replace(`<script src="${CUSTOM_EASE_CDN}"></script>`, () => inline(customEaseSource));
  return (
    <div ref={boxRef} className="flex justify-center overflow-hidden rounded-am border border-line checker" style={{ height: height * scale + 2 }}>
      <iframe
        title="Aperçu de l’export"
        srcDoc={doc}
        sandbox="allow-scripts"
        style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top center', border: 0, flexShrink: 0 }}
      />
    </div>
  );
}

function LottiePreview({ data, width, height }: { data: object; width: number; height: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let anim: { destroy: () => void } | null = null;
    let cancelled = false;
    import('lottie-web')
      .then(({ default: lottie }) => {
        if (cancelled || !ref.current) return;
        anim = lottie.loadAnimation({ container: ref.current, renderer: 'svg', loop: true, autoplay: true, animationData: JSON.parse(JSON.stringify(data)) });
      })
      .catch((e) => setError(String(e)));
    return () => {
      cancelled = true;
      anim?.destroy();
    };
  }, [data]);
  const ratio = height / width;
  return (
    <div className="mx-auto checker overflow-hidden rounded-am border border-line" style={{ width: Math.min(460, 260 / ratio), aspectRatio: `${width} / ${height}` }}>
      {error ? <p className="p-4 text-[12px] text-red-600">{error}</p> : <div ref={ref} className="h-full w-full" data-testid="lottie-preview" />}
    </div>
  );
}

function CodeBlock({ code, filename, mime }: { code: string; filename: string; mime: string }) {
  const [copied, setCopied] = useState(false);
  const shown = code.length > PREVIEW_LIMIT ? `${code.slice(0, PREVIEW_LIMIT)}\n\n… (${Math.round(code.length / 1024)} Ko au total : utilisez Copier ou Télécharger)` : code;
  return (
    <div className="overflow-hidden rounded-am border border-line">
      <div className="flex items-center justify-between border-b border-line bg-canvas px-3 h-10">
        <span className="font-mono text-[12px] text-muted">
          {filename} · {code.length < 1024 ? `${code.length} o` : `${(code.length / 1024).toFixed(1)} Ko`}
        </span>
        <div className="flex gap-1.5">
          <button
            className="btn-outline h-7 px-2.5 text-[12px]"
            onClick={async () => {
              if (await copyText(code)) {
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              }
            }}
          >
            <Icon name={copied ? 'check' : 'copy'} size={14} />
            {copied ? 'Copié !' : 'Copier'}
          </button>
          <button className="btn-primary h-7 px-2.5 text-[12px]" onClick={() => downloadText(code, filename, mime)}>
            <Icon name="download" size={14} />
            Télécharger
          </button>
        </div>
      </div>
      <pre className="max-h-[300px] overflow-auto bg-[#0A1F44] p-4 font-mono text-[11.5px] leading-relaxed text-[#DBEAFE]" data-testid="code-preview">
        <code>{shown}</code>
      </pre>
    </div>
  );
}

function Warnings({ list }: { list: string[] }) {
  if (list.length === 0) return null;
  return (
    <ul className="space-y-1 rounded-am border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
      {list.map((w) => (
        <li key={w} className="flex gap-2">
          <Icon name="info" size={14} className="mt-0.5 shrink-0" />
          {w}
        </li>
      ))}
    </ul>
  );
}

function VideoPanel() {
  const project = useStore((s) => s.project);
  const comp = useStore((s) => activeComp(s));
  const [format, setFormat] = useState<VideoFormat>('mp4');
  const [fps, setFps] = useState(comp.fps >= 24 ? comp.fps : 30);
  const [quality, setQuality] = useState(1080);
  const [audio, setAudio] = useState(true);
  const [progress, setProgress] = useState<{ ratio: number; label: string } | null>(null);
  const [result, setResult] = useState<{ url: string; blob: Blob } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const size = outputSize(comp.width, comp.height, quality);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => () => void (result && URL.revokeObjectURL(result.url)), [result]);

  const start = async () => {
    setError(null);
    setResult(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setProgress({ ratio: 0, label: 'Préparation…' });
    try {
      const blob = await exportVideo(project, comp, { format, fps, quality, audio }, (ratio, label) => setProgress({ ratio, label }), ctrl.signal);
      setResult({ blob, url: URL.createObjectURL(blob) });
    } catch (e) {
      if (!(e instanceof ExportCancelled) && !ctrl.signal.aborted) setError((e as Error).message || String(e));
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  };

  const filename = `${slug(project.name)}-${size.height}p-${fps}ips.${format}`;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <label className="space-y-1">
          <span className="field-label">Format</span>
          <select className="field" value={format} onChange={(e) => setFormat(e.target.value as VideoFormat)} disabled={!!progress}>
            <option value="mp4">MP4 (H.264, ffmpeg.wasm)</option>
            <option value="webm">WebM (VP9)</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="field-label">Images / seconde</span>
          <select className="field" value={fps} onChange={(e) => setFps(Number(e.target.value))} disabled={!!progress}>
            {[24, 25, 30, 50, 60].map((f) => (
              <option key={f} value={f}>
                {f} i/s
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="field-label">Définition</span>
          <select className="field" value={quality} onChange={(e) => setQuality(Number(e.target.value))} disabled={!!progress}>
            <option value={480}>480p</option>
            <option value={720}>720p (HD)</option>
            <option value={1080}>1080p (Full HD)</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="field-label">Son</span>
          <label className="flex h-7 items-center gap-2 text-[12px]">
            <input type="checkbox" checked={audio} disabled={!comp.audio || !!progress} onChange={(e) => setAudio(e.target.checked)} />
            {comp.audio ? 'Inclure la piste audio' : 'Aucune piste audio'}
          </label>
        </label>
      </div>
      <p className="text-[12px] text-muted">
        Sortie : {size.width}×{size.height} px · {comp.duration.toFixed(2)} s · {Math.round(comp.duration * fps)} images.{' '}
        {format === 'mp4' ? 'Encodage local avec ffmpeg.wasm (le module est chargé au premier export).' : 'Encodage rapide via WebCodecs, ou capture en temps réel sinon.'}
      </p>

      {progress ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-navy">{progress.label}</span>
            <span className="tabular-nums text-muted">{Math.round(progress.ratio * 100)} %</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-sky">
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress.ratio * 100}%` }} />
          </div>
          <button className="btn-outline" onClick={() => abortRef.current?.abort()}>
            Annuler
          </button>
        </div>
      ) : (
        <button className="btn-primary" onClick={start}>
          <Icon name="video" />
          Générer la vidéo
        </button>
      )}
      {error && <p className="rounded-am border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">Échec de l’export : {error}</p>}
      {result && (
        <div className="space-y-2">
          <video src={result.url} controls loop autoPlay muted className="mx-auto max-h-[260px] rounded-am border border-line bg-black" />
          <div className="flex items-center justify-center gap-2">
            <button className="btn-primary" onClick={() => downloadBlob(result.blob, filename)}>
              <Icon name="download" />
              Télécharger {filename}
            </button>
            <span className="text-[12px] text-muted">{(result.blob.size / 1024 / 1024).toFixed(2)} Mo</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function ExportDialog() {
  const project = useStore((s) => s.project);
  const comp = useStore((s) => activeComp(s));
  const st = useStore.getState();
  const [tab, setTab] = useState<Tab>('css');
  const [loop, setLoop] = useState(true);

  const result = useMemo(() => {
    try {
      if (tab === 'css') return { ...exportCss(project, comp, { loop }), filename: `${slug(project.name)}.html`, mime: 'text/html' };
      if (tab === 'gsap') return { ...exportGsap(project, comp, { loop }), filename: `${slug(project.name)}-gsap.html`, mime: 'text/html' };
      if (tab === 'lottie') {
        const r = exportLottie(project, comp);
        return { code: r.code, warnings: r.warnings, json: r.json, filename: `${slug(project.name)}.json`, mime: 'application/json' };
      }
      if (tab === 'json') return { code: JSON.stringify(project, null, 2), warnings: [], filename: `${slug(project.name)}.atelier.json`, mime: 'application/json' };
    } catch (e) {
      return { code: `// Erreur : ${(e as Error).message}`, warnings: [], filename: 'erreur.txt', mime: 'text/plain' };
    }
    return null;
  }, [tab, project, comp, loop]);

  return (
    <Modal title={`Exporter « ${comp.name} »`} onClose={() => st.openDialog(null)} width={860}>
      <div className="mb-4 flex flex-wrap items-center gap-1" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab flex items-center gap-1.5 ${tab === t.id ? 'tab-active' : ''}`} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} size={14} />
            {t.label}
          </button>
        ))}
        {(tab === 'css' || tab === 'gsap') && (
          <label className="ml-auto flex items-center gap-2 text-[12px] text-muted">
            <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
            Lecture en boucle
          </label>
        )}
      </div>

      {tab === 'video' ? (
        <VideoPanel />
      ) : (
        result && (
          <div className="space-y-3">
            <p className="text-[12px] text-muted">
              {tab === 'css' && 'Page HTML autonome animée uniquement en CSS (@keyframes), sans JavaScript.'}
              {tab === 'gsap' && 'Page HTML avec une timeline GSAP 3 (chargée depuis jsDelivr).'}
              {tab === 'lottie' && 'Fichier Lottie (Bodymovin 5.7) lisible par lottie-web, les applications iOS / Android et de nombreux outils.'}
              {tab === 'json' && 'Projet complet (calques, images clés, ressources) à réimporter dans Atelier Motion.'}
            </p>
            <Warnings list={result.warnings} />
            {(tab === 'css' || tab === 'gsap') && <HtmlPreview html={result.code} width={comp.width} height={comp.height} />}
            {tab === 'lottie' && 'json' in result && result.json && <LottiePreview data={result.json} width={comp.width} height={comp.height} />}
            <CodeBlock code={result.code} filename={result.filename} mime={result.mime} />
          </div>
        )
      )}
    </Modal>
  );
}
