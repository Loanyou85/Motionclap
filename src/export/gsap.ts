import { easingToBezier } from '../engine/easing';
import { getNum } from '../engine/evaluate';
import { letterStates } from '../engine/text';
import type { Composition, Easing, Layer, Project } from '../engine/types';
import { channelTrack, cssColor, isSvgLayer, nodeChannels, shapeD, shapeKeys, visualChannels, type Channel } from './channels';
import { fontFaceCss, type ExportResult, type WebExportOptions } from './css';
import { collectItems, createContext, escapeHtml, evalValues, num, sampleTimeline, type ExportContext, type RenderItem } from './model';

/**
 * Courbes jouées nativement par GSAP avec la même formule que le moteur.
 * Les courbes bézier passent par CustomEase pour un rendu identique.
 */
const GSAP_NATIVE: Partial<Record<Easing['type'], string>> = {
  linear: 'none',
  elasticIn: 'elastic.in(1, 0.3)',
  elasticOut: 'elastic.out(1, 0.3)',
  bounceIn: 'bounce.in',
  bounceOut: 'bounce.out',
};

const isNative = (e: Easing) => e.type in GSAP_NATIVE;

interface GsapBuilder {
  ctx: ExportContext;
  lines: string[];
  customEases: Map<string, string>;
  emitted: Set<string>;
}

function easeName(b: GsapBuilder, e: Easing | null): string {
  if (!e) return 'none';
  const native = GSAP_NATIVE[e.type];
  if (native) return native;
  const bz = easingToBezier(e);
  if (!bz) return 'none';
  const key = bz.join(',');
  if (!b.customEases.has(key)) b.customEases.set(key, e.type === 'cubicBezier' ? `courbe${b.customEases.size + 1}` : e.type);
  return b.customEases.get(key)!;
}

const js = (v: unknown) => JSON.stringify(v);

function varsToJs(vars: Record<string, string | number>, isShapeD: boolean): string {
  if (isShapeD) return `{ attr: { d: ${js(vars.d)} } }`;
  return `{ ${Object.entries(vars)
    .map(([k, v]) => `${k}: ${js(v)}`)
    .join(', ')} }`;
}

/** Instructions GSAP pour un élément et ses canaux. */
function channelLines(b: GsapBuilder, selector: string, layer: Layer, channels: Channel[], offset: number): { set: Record<string, string | number>; attrD?: string } {
  const set: Record<string, string | number> = {};
  let attrD: string | undefined;
  const t0 = Math.max(0, -offset);
  for (const ch of channels) {
    const isD = ch.name === 'd';
    const track = channelTrack(b.ctx, layer, ch, offset, isNative);
    if (!track) {
      const v = ch.gsap(evalValues(layer, ch.keys, t0));
      if (isD) attrD = String(v.d);
      else Object.assign(set, v);
      continue;
    }
    const init = ch.gsap(track.initial);
    if (isD) attrD = String(init.d);
    else Object.assign(set, init);
    for (const s of track.segments) {
      const from = ch.gsap(s.from);
      const to = ch.gsap(s.to);
      const at = num(s.t0, 4);
      if (s.easing?.type === 'hold') {
        b.lines.push(`tl.set(${js(selector)}, ${varsToJs(to, isD)}, ${num(s.t1, 4)});`);
        continue;
      }
      const dur = num(s.t1 - s.t0, 4);
      const vars = varsToJs(to, isD).replace(/ }$/, `, duration: ${dur}, ease: ${js(easeName(b, s.easing))} }`);
      b.lines.push(`tl.fromTo(${js(selector)}, ${varsToJs(from, isD)}, ${vars}, ${at});`);
    }
  }
  return { set, attrD };
}

function itemTimeline(b: GsapBuilder, item: RenderItem): void {
  const { layer, uid, offset } = item;
  const prefix = uid.slice(0, uid.length - layer.id.length);
  for (const node of [...item.ancestors, layer]) {
    const sel = `.am-t-${prefix}${node.id}`;
    if (b.emitted.has(sel)) continue;
    b.emitted.add(sel);
    const { set } = channelLines(b, sel, node, nodeChannels(node), offset);
    b.lines.unshift(`gsap.set(${js(sel)}, ${varsToJs(set, false)});`);
  }
  // Visibilité (points d'entrée / sortie)
  const D = b.ctx.duration;
  const inG = layer.inPoint + offset;
  const outG = layer.outPoint + offset;
  if (inG > 1e-6) {
    b.lines.push(`tl.set(".am-i-${uid}", { visibility: "hidden" }, 0);`);
    if (inG < D) b.lines.push(`tl.set(".am-i-${uid}", { visibility: "visible" }, ${num(inG, 4)});`);
  }
  if (outG < D - 1e-6) b.lines.push(`tl.set(".am-i-${uid}", { visibility: "hidden" }, ${num(Math.max(0, outG), 4)});`);

  const visualSel = `.am-v-${uid}`;
  const { set } = channelLines(b, visualSel, layer, visualChannels(layer).filter((c) => c.target === 'visual'), offset);
  if (Object.keys(set).length) b.lines.unshift(`gsap.set(${js(visualSel)}, ${varsToJs(set, false)});`);
  if (isSvgLayer(layer)) {
    const pathSel = `.am-p-${uid}`;
    const r = channelLines(b, pathSel, layer, visualChannels(layer).filter((c) => c.target === 'shape'), offset);
    const setVars = { ...r.set };
    b.lines.unshift(`gsap.set(${js(pathSel)}, ${varsToJs(setVars, false).replace(/ }$/, r.attrD ? `, attr: { d: ${js(r.attrD)} } }` : ' }')});`);
  }
  if (layer.type === 'text' && (layer.textMode ?? 'none') !== 'none') {
    const from = Math.max(0, layer.inPoint);
    const to = Math.min(item.comp.duration, layer.outPoint, D - offset);
    const cache = new Map<number, ReturnType<typeof letterStates>>();
    const states = (t: number) => {
      let v = cache.get(t);
      if (!v) {
        v = letterStates(layer.text ?? '', layer.textMode ?? 'none', getNum(layer, 'reveal', t), getNum(layer, 'fontSize', t), getNum(layer, 'waveAmp', t), t);
        cache.set(t, v);
      }
      return v;
    };
    Array.from(layer.text ?? '').forEach((c, i) => {
      if (c === '\n' || to <= from) return;
      const series = sampleTimeline(b.ctx, from, to, (t) => {
        const s = states(t)[i];
        return [s.opacity, s.dy, s.scale];
      });
      const sel = `.am-${uid}-c${i}`;
      const [o, y, sc] = series[0].v;
      b.lines.unshift(`gsap.set(${js(sel)}, { opacity: ${num(o)}, y: ${num(y, 2)}, scale: ${num(sc)} });`);
      const kf = series.slice(1).map((p, k) => `{ opacity: ${num(p.v[0])}, y: ${num(p.v[1], 2)}, scale: ${num(p.v[2])}, duration: ${num(p.t - series[k].t, 4)} }`);
      if (kf.length) b.lines.push(`tl.to(${js(sel)}, { keyframes: [${kf.join(', ')}], ease: "none" }, ${num(series[0].t + offset, 4)});`);
    });
  }
  for (const c of item.children ?? []) itemTimeline(b, c);
}

function itemHtml(item: RenderItem, project: Project): string {
  const { layer, uid } = item;
  const prefix = uid.slice(0, uid.length - layer.id.length);
  const cls = `am-v am-v-${uid}`;
  let visual = '';
  switch (layer.type) {
    case 'rect':
    case 'ellipse':
    case 'line':
      visual = `<div class="${cls}"></div>`;
      break;
    case 'image':
      visual = `<img class="${cls}" src="${project.assets.find((a) => a.id === layer.assetId)?.src ?? ''}" alt="${escapeHtml(layer.name)}">`;
      break;
    case 'text': {
      const text = layer.text ?? '';
      const inner =
        (layer.textMode ?? 'none') !== 'none'
          ? Array.from(text)
              .map((c, i) => (c === '\n' ? '<br>' : `<span class="am-c am-${uid}-c${i}">${c === ' ' ? '&nbsp;' : escapeHtml(c)}</span>`))
              .join('')
          : escapeHtml(text).replace(/\n/g, '<br>');
      visual = `<div class="${cls}">${inner}</div>`;
      break;
    }
    case 'star':
    case 'polygon':
    case 'path': {
      const d = shapeD(layer, evalValues(layer, shapeKeys(layer), 0));
      const trim = layer.type === 'path' ? ' pathLength="1" stroke-dasharray="1 1"' : '';
      visual = `<svg class="am-svg ${cls}" width="1" height="1" overflow="visible"><path class="am-p-${uid}" d="${d}"${trim}/></svg>`;
      break;
    }
    case 'precomp':
      visual = `<div class="${cls} am-sub">\n${(item.children ?? []).map((c) => itemHtml(c, project)).join('\n')}\n</div>`;
      break;
  }
  const nodes = [...item.ancestors, layer];
  const open = nodes.map((n, i) => `<div class="am-t am-t-${prefix}${n.id}${i === 0 ? ` am-i-${uid}` : ''}">`).join('');
  return `  <!-- ${escapeHtml(layer.name)} -->\n  ${open}${visual}${'</div>'.repeat(nodes.length)}`;
}

function staticCss(project: Project, comp: Composition, items: RenderItem[]): string {
  const rules: string[] = [];
  const walk = (list: RenderItem[]) => {
    for (const it of list) {
      const l = it.layer;
      const sel = `.am-v-${it.uid}`;
      if (l.type === 'ellipse') rules.push(`${sel} { border-radius: 50%; outline-style: solid; }`);
      if (l.type === 'rect') rules.push(`${sel} { outline-style: solid; }`);
      if (l.type === 'image') rules.push(`${sel} { object-fit: cover; }`);
      if (l.type === 'text')
        rules.push(`${sel} { font-family: '${l.fontFamily ?? 'Inter'}', system-ui, sans-serif; font-weight: ${l.fontWeight ?? 700}; text-align: ${l.textAlign ?? 'center'}; line-height: 1.2; white-space: pre; }`);
      if (l.type === 'precomp') {
        const sub = project.compositions.find((c) => c.id === l.compId);
        if (sub) rules.push(`${sel} { width: ${sub.width}px; height: ${sub.height}px; overflow: hidden; background: ${cssColor(sub.background)}; }`);
      }
      walk(it.children ?? []);
    }
  };
  walk(items);
  return `.am-stage { position: relative; width: ${comp.width}px; height: ${comp.height}px; overflow: hidden; background: ${cssColor(comp.background)}; }
.am-stage *, .am-stage *::before, .am-stage *::after { box-sizing: border-box; }
.am-t { position: absolute; left: 0; top: 0; width: 0; height: 0; }
.am-v { position: absolute; left: 0; top: 0; display: block; }
.am-svg { position: absolute; left: 0; top: 0; overflow: visible; }
.am-c { display: inline-block; }
${rules.join('\n')}`;
}

export const GSAP_CDN = 'https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js';
export const CUSTOM_EASE_CDN = 'https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/CustomEase.min.js';

/** Page HTML + timeline GSAP (chargé depuis un CDN). */
export function exportGsap(project: Project, comp: Composition, opts: WebExportOptions = { loop: true }): ExportResult {
  const ctx = createContext(project, comp);
  const b: GsapBuilder = { ctx, lines: [], customEases: new Map(), emitted: new Set() };
  const items = collectItems(ctx, comp);
  for (const it of items) itemTimeline(b, it);
  const html = `<div class="am-stage">\n${items.map((it) => itemHtml(it, project)).join('\n')}\n</div>`;
  const needsCustom = b.customEases.size > 0;
  const sets = b.lines.filter((l) => l.startsWith('gsap.set'));
  const tweens = b.lines.filter((l) => !l.startsWith('gsap.set'));
  const script = `${needsCustom ? 'gsap.registerPlugin(CustomEase);\n' : ''}${[...b.customEases.entries()]
    .map(([bz, name]) => {
      const [x1, y1, x2, y2] = bz.split(',');
      return `CustomEase.create(${js(name)}, "M0,0 C${x1},${y1} ${x2},${y2} 1,1");`;
    })
    .join('\n')}
// Centrage : transformOrigin à l'origine des nœuds, visuels centrés.
gsap.set(".am-t", { transformOrigin: "0 0" });
gsap.set(".am-v:not(.am-svg)", { xPercent: -50, yPercent: -50 });
${sets.join('\n')}

const tl = gsap.timeline({ repeat: ${opts.loop ? -1 : 0}, defaults: { overwrite: false } });
${tweens.join('\n')}
// Durée totale de la composition
tl.set({}, {}, ${num(comp.duration, 4)});
`;
  const code = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(project.name)} — ${escapeHtml(comp.name)}</title>
<!-- Généré par Atelier Motion : animation GSAP 3. -->
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #F0F6FF; }
${fontFaceCss(project)}
${staticCss(project, comp, items)}
</style>
</head>
<body>
${html}
<script src="${GSAP_CDN}"></script>
${needsCustom ? `<script src="${CUSTOM_EASE_CDN}"></script>\n` : ''}<script>
${script}</script>
</body>
</html>
`;
  return { code, warnings: [...ctx.warnings] };
}
