import { useCallback, useEffect, useRef, useState } from 'react';
import { colorAlpha } from '../../engine/color';
import { getNum, layerMap, worldMatrix } from '../../engine/evaluate';
import { setPropValue } from '../../engine/keyframes';
import { apply, invert, type Mat } from '../../engine/matrix';
import type { Composition, Layer, Project } from '../../engine/types';
import { importFile } from '../../lib/importFiles';
import { onAssetLoaded } from '../../render/assets';
import { boundsCorners, hitTest, layerFrame } from '../../render/hitTest';
import { renderComposition } from '../../render/renderer';
import { activeComp, useStore } from '../../store/store';

const PAD = 48;
const HANDLE = 8;
const SNAP_PX = 8;

type DragState =
  | { kind: 'pan'; startX: number; startY: number; panX: number; panY: number }
  | {
      kind: 'move';
      startX: number;
      startY: number;
      merge: string;
      items: Array<{ id: string; x: number; y: number; parentInv: Mat }>;
      originWorld: [number, number] | null;
    }
  | {
      kind: 'scale';
      id: string;
      merge: string;
      inv: Mat; // inverse de la matrice monde sans l'échelle du calque
      startLocal: [number, number];
      sx: number;
      sy: number;
    }
  | { kind: 'rotate'; id: string; merge: string; center: [number, number]; startAngle: number; rotation: number };

interface View {
  zoom: number;
  ox: number;
  oy: number;
}

/** Calcule la vue (zoom + origine de la composition dans le canvas, en px CSS). */
function computeView(comp: Composition, w: number, h: number, zoom: number | 'fit', pan: { x: number; y: number }): View {
  const z = zoom === 'fit' ? Math.max(0.02, Math.min((w - PAD * 2) / comp.width, (h - PAD * 2) / comp.height)) : zoom;
  return { zoom: z, ox: (w - comp.width * z) / 2 + pan.x, oy: (h - comp.height * z) / 2 + pan.y };
}

function drawGuides(ctx: CanvasRenderingContext2D, comp: Composition, z: number) {
  const W = comp.width;
  const H = comp.height;
  ctx.save();
  ctx.lineWidth = 1 / z;
  // Tiers
  ctx.strokeStyle = 'rgba(59,130,246,0.22)';
  ctx.setLineDash([6 / z, 6 / z]);
  ctx.beginPath();
  for (const f of [1 / 3, 2 / 3]) {
    ctx.moveTo(W * f, 0);
    ctx.lineTo(W * f, H);
    ctx.moveTo(0, H * f);
    ctx.lineTo(W, H * f);
  }
  ctx.stroke();
  // Centre
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(30,94,255,0.35)';
  ctx.beginPath();
  ctx.moveTo(W / 2, 0);
  ctx.lineTo(W / 2, H);
  ctx.moveTo(0, H / 2);
  ctx.lineTo(W, H / 2);
  ctx.stroke();
  // Zones de sécurité action (90 %) et titre (80 %)
  ctx.strokeStyle = 'rgba(30,94,255,0.25)';
  ctx.setLineDash([2 / z, 4 / z]);
  ctx.strokeRect(W * 0.05, H * 0.05, W * 0.9, H * 0.9);
  ctx.strokeRect(W * 0.1, H * 0.1, W * 0.8, H * 0.8);
  ctx.restore();
}

function drawSelection(
  ctx: CanvasRenderingContext2D,
  project: Project,
  comp: Composition,
  layers: Layer[],
  t: number,
  z: number,
) {
  ctx.save();
  for (const l of layers) {
    const f = layerFrame(project, comp, l, t);
    if (!f) continue;
    const corners = boundsCorners(f.bounds, f.matrix);
    ctx.strokeStyle = '#1E5EFF';
    ctx.lineWidth = 1.5 / z;
    ctx.setLineDash(l.type === 'group' ? [5 / z, 4 / z] : []);
    ctx.beginPath();
    corners.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    if (layers.length !== 1 || l.type === 'group' || l.locked || isDegenerate(f.matrix)) continue;
    // Poignées d'échelle
    const hs = HANDLE / z;
    for (const [x, y] of corners) {
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#1E5EFF';
      ctx.lineWidth = 1.5 / z;
      ctx.fillRect(x - hs / 2, y - hs / 2, hs, hs);
      ctx.strokeRect(x - hs / 2, y - hs / 2, hs, hs);
    }
    // Poignée de rotation
    const [rx, ry, tx, ty] = rotationHandle(corners, z);
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(rx, ry);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(rx, ry, hs * 0.65, 0, Math.PI * 2);
    ctx.fillStyle = '#1E5EFF';
    ctx.fill();
    // Point d'ancrage
    const [ax, ay] = apply(f.matrix, 0, 0);
    ctx.beginPath();
    ctx.arc(ax, ay, 3 / z, 0, Math.PI * 2);
    ctx.strokeStyle = '#0A1F44';
    ctx.stroke();
  }
  ctx.restore();
}

/** Matrice écrasée (échelle nulle) : aucune poignée exploitable. */
const isDegenerate = (m: Mat) => Math.abs(m[0] * m[3] - m[1] * m[2]) < 1e-6;

/** Position de la poignée de rotation : au-dessus du milieu du bord supérieur. */
function rotationHandle(corners: Array<[number, number]>, z: number): [number, number, number, number] {
  const [a, b, , d] = corners;
  const tx = (a[0] + b[0]) / 2;
  const ty = (a[1] + b[1]) / 2;
  // Direction « vers le haut » du calque : de d vers a.
  let ux = a[0] - d[0];
  let uy = a[1] - d[1];
  const len = Math.hypot(ux, uy) || 1;
  ux /= len;
  uy /= len;
  const dist = 28 / z;
  return [tx + ux * dist, ty + uy * dist, tx, ty];
}

export function Stage() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [spaceDown, setSpaceDown] = useState(false);
  const [cursor, setCursor] = useState('default');
  const dragRef = useRef<DragState | null>(null);
  const snapLines = useRef<{ x: number | null; y: number | null }>({ x: null, y: null });
  const viewRef = useRef<View>({ zoom: 1, ox: 0, oy: 0 });
  const stageZoom = useStore((s) => s.stageZoom);
  const compId = useStore((s) => activeComp(s).id);

  // Le recentrage s'impose au changement de composition ou en mode « ajuster ».
  useEffect(() => setPan({ x: 0, y: 0 }), [compId]);
  useEffect(() => {
    if (stageZoom === 'fit') setPan({ x: 0, y: 0 });
  }, [stageZoom]);

  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(([entry]) => {
      setSize({ w: Math.floor(entry.contentRect.width), h: Math.floor(entry.contentRect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = useStore.getState();
    const comp = activeComp(s);
    const dpr = window.devicePixelRatio || 1;
    const view = computeView(comp, size.w, size.h, s.stageZoom, pan);
    viewRef.current = view;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Ombre portée de la scène
    ctx.save();
    ctx.shadowColor = 'rgba(10,31,68,0.12)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(view.ox, view.oy, comp.width * view.zoom, comp.height * view.zoom);
    ctx.restore();

    const z = view.zoom * dpr;
    ctx.save();
    ctx.setTransform(z, 0, 0, z, view.ox * dpr, view.oy * dpr);
    ctx.beginPath();
    ctx.rect(0, 0, comp.width, comp.height);
    ctx.clip();
    // Damier sous un fond transparent
    if (colorAlpha(comp.background) < 1) {
      const cell = 16 / view.zoom;
      ctx.fillStyle = '#EEF2F7';
      for (let y = 0; y < comp.height; y += cell)
        for (let x = (Math.floor(y / cell) % 2) * cell; x < comp.width; x += cell * 2) ctx.fillRect(x, y, cell, cell);
    }
    renderComposition(ctx, comp, { project: s.project, time: s.time, scale: z });
    if (s.showGuides) drawGuides(ctx, comp, view.zoom);
    ctx.restore();

    // Calques sélectionnés et repères de magnétisme (non découpés par la scène)
    ctx.save();
    ctx.setTransform(z, 0, 0, z, view.ox * dpr, view.oy * dpr);
    const sel = s.selectedLayerIds.map((id) => comp.layers.find((l) => l.id === id)).filter((l): l is Layer => !!l);
    drawSelection(ctx, s.project, comp, sel, s.time, view.zoom);
    const sl = snapLines.current;
    ctx.strokeStyle = '#EC4899';
    ctx.lineWidth = 1 / view.zoom;
    if (sl.x !== null) {
      ctx.beginPath();
      ctx.moveTo(sl.x, -10000);
      ctx.lineTo(sl.x, 10000);
      ctx.stroke();
    }
    if (sl.y !== null) {
      ctx.beginPath();
      ctx.moveTo(-10000, sl.y);
      ctx.lineTo(10000, sl.y);
      ctx.stroke();
    }
    ctx.restore();
  }, [size, pan]);

  // Redessine à chaque changement d'état (regroupé par image d'animation).
  useEffect(() => {
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    };
    schedule();
    const unsub = useStore.subscribe((st, prev) => {
      if (
        st.project !== prev.project ||
        st.time !== prev.time ||
        st.selectedLayerIds !== prev.selectedLayerIds ||
        st.stageZoom !== prev.stageZoom ||
        st.showGuides !== prev.showGuides ||
        st.activeCompId !== prev.activeCompId
      )
        schedule();
    });
    const offAsset = onAssetLoaded(schedule);
    document.fonts?.ready.then(schedule);
    return () => {
      cancelAnimationFrame(raf);
      unsub();
      offAsset();
    };
  }, [draw]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement).matches('input, textarea')) setSpaceDown(true);
    };
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpaceDown(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  /** Point écran → coordonnées de composition. */
  const toComp = (e: { clientX: number; clientY: number }): [number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return [(e.clientX - rect.left - v.ox) / v.zoom, (e.clientY - rect.top - v.oy) / v.zoom];
  };

  /** Poignée sous le pointeur (calque unique sélectionné). */
  const handleAt = (x: number, y: number): { kind: 'scale' | 'rotate'; corner?: number } | null => {
    const s = useStore.getState();
    if (s.selectedLayerIds.length !== 1) return null;
    const comp = activeComp(s);
    const layer = comp.layers.find((l) => l.id === s.selectedLayerIds[0]);
    if (!layer || layer.type === 'group' || layer.locked) return null;
    const f = layerFrame(s.project, comp, layer, s.time);
    if (!f || isDegenerate(f.matrix)) return null;
    const z = viewRef.current.zoom;
    const corners = boundsCorners(f.bounds, f.matrix);
    const [rx, ry] = rotationHandle(corners, z);
    if (Math.hypot(x - rx, y - ry) < 9 / z) return { kind: 'rotate' };
    const i = corners.findIndex(([cx, cy]) => Math.abs(x - cx) < 7 / z && Math.abs(y - cy) < 7 / z);
    return i >= 0 ? { kind: 'scale', corner: i } : null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const s = useStore.getState();
    const comp = activeComp(s);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (e.button === 1 || spaceDown) {
      dragRef.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
      setCursor('grabbing');
      return;
    }
    if (e.button !== 0) return;
    const [x, y] = toComp(e);
    const merge = `stage-${Date.now()}`;
    const map = layerMap(comp);

    const handle = handleAt(x, y);
    if (handle) {
      const layer = map.get(s.selectedLayerIds[0])!;
      const world = worldMatrix(layer, map, s.time);
      if (handle.kind === 'rotate') {
        const center = apply(world, 0, 0);
        dragRef.current = {
          kind: 'rotate',
          id: layer.id,
          merge,
          center,
          startAngle: Math.atan2(y - center[1], x - center[0]),
          rotation: getNum(layer, 'rotation', s.time),
        };
      } else {
        const sx = getNum(layer, 'scaleX', s.time) || 0.0001;
        const sy = getNum(layer, 'scaleY', s.time) || 0.0001;
        // Repère du calque sans son échelle propre : la position du pointeur y donne directement l'échelle.
        const unscaled: Mat = [world[0] / sx, world[1] / sx, world[2] / sy, world[3] / sy, world[4], world[5]];
        const inv = invert(unscaled);
        if (!inv) return;
        dragRef.current = { kind: 'scale', id: layer.id, merge, inv, startLocal: apply(inv, x, y), sx, sy };
      }
      return;
    }

    const hit = hitTest(s.project, comp, s.time, x, y, 6 / viewRef.current.zoom);
    if (!hit) {
      if (!e.shiftKey) s.selectLayer(null);
      return;
    }
    // Clic sur un membre de groupe replié : on sélectionne le groupe.
    let target = hit;
    const parent = target.parentId ? map.get(target.parentId) : undefined;
    if (parent?.type === 'group' && parent.collapsed && !e.altKey) target = parent;

    if (e.shiftKey) s.selectLayer(target.id, 'toggle');
    else if (!s.selectedLayerIds.includes(target.id)) s.selectLayer(target.id);

    const ids = useStore.getState().selectedLayerIds;
    const items = ids
      .map((id) => map.get(id))
      .filter((l): l is Layer => !!l && !l.locked)
      .map((l) => {
        const p = l.parentId ? map.get(l.parentId) : undefined;
        const parentInv = (p ? invert(worldMatrix(p, map, s.time)) : null) ?? [1, 0, 0, 1, 0, 0];
        return { id: l.id, x: getNum(l, 'x', s.time), y: getNum(l, 'y', s.time), parentInv: parentInv as Mat };
      });
    const primary = map.get(target.id);
    const originWorld = primary && !primary.locked ? apply(worldMatrix(primary, map, s.time), 0, 0) : null;
    dragRef.current = { kind: 'move', startX: x, startY: y, merge, items, originWorld };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    const s = useStore.getState();
    if (!d) {
      if (spaceDown) return setCursor('grab');
      const [x, y] = toComp(e);
      const h = handleAt(x, y);
      setCursor(h ? (h.kind === 'rotate' ? 'crosshair' : h.corner === 0 || h.corner === 2 ? 'nwse-resize' : 'nesw-resize') : 'default');
      return;
    }
    if (d.kind === 'pan') {
      setPan({ x: d.panX + e.clientX - d.startX, y: d.panY + e.clientY - d.startY });
      if (s.stageZoom === 'fit') s.setStageZoom(viewRef.current.zoom);
      return;
    }
    const [x, y] = toComp(e);
    const comp = activeComp(s);
    if (d.kind === 'move') {
      let dx = x - d.startX;
      let dy = y - d.startY;
      snapLines.current = { x: null, y: null };
      if (s.snap && !e.altKey && d.originWorld) {
        const tol = SNAP_PX / viewRef.current.zoom;
        const nx = d.originWorld[0] + dx;
        const ny = d.originWorld[1] + dy;
        const xs = [0, comp.width / 2, comp.width];
        const ys = [0, comp.height / 2, comp.height];
        const sx = xs.find((v) => Math.abs(v - nx) < tol);
        const sy = ys.find((v) => Math.abs(v - ny) < tol);
        if (sx !== undefined) {
          dx = sx - d.originWorld[0];
          snapLines.current.x = sx;
        }
        if (sy !== undefined) {
          dy = sy - d.originWorld[1];
          snapLines.current.y = sy;
        }
      }
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      s.updateComp(
        (c) => {
          for (const it of d.items) {
            const l = c.layers.find((q) => q.id === it.id);
            if (!l) continue;
            // Le déplacement écran est converti dans le repère du parent.
            const [a, b, cc, dd] = it.parentInv;
            const ldx = a * dx + cc * dy;
            const ldy = b * dx + dd * dy;
            setXY(l as Layer, it.x + ldx, it.y + ldy, s.time);
          }
        },
        { merge: d.merge },
      );
    } else if (d.kind === 'scale') {
      const [lx, ly] = apply(d.inv, x, y);
      const fx = Math.abs(d.startLocal[0]) > 1e-6 ? lx / d.startLocal[0] : 1;
      const fy = Math.abs(d.startLocal[1]) > 1e-6 ? ly / d.startLocal[1] : 1;
      let nsx = d.sx * fx;
      let nsy = d.sy * fy;
      if (e.shiftKey) {
        const f = Math.max(Math.abs(fx), Math.abs(fy));
        nsx = d.sx * f;
        nsy = d.sy * f;
      }
      s.setProp(d.id, 'scaleX', round(nsx, 1000), { merge: d.merge });
      s.setProp(d.id, 'scaleY', round(nsy, 1000), { merge: d.merge });
    } else if (d.kind === 'rotate') {
      const a = Math.atan2(y - d.center[1], x - d.center[0]);
      let r = d.rotation + ((a - d.startAngle) * 180) / Math.PI;
      if (e.shiftKey) r = Math.round(r / 15) * 15;
      s.setProp(d.id, 'rotation', round(r, 10), { merge: d.merge });
    }
  };

  const onPointerUp = () => {
    if (dragRef.current?.kind === 'pan') setCursor(spaceDown ? 'grab' : 'default');
    dragRef.current = null;
    if (snapLines.current.x !== null || snapLines.current.y !== null) {
      snapLines.current = { x: null, y: null };
      draw();
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const s = useStore.getState();
    if (e.ctrlKey || e.metaKey) {
      const v = viewRef.current;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const nz = Math.min(8, Math.max(0.05, v.zoom * factor));
      // Zoom centré sur le pointeur
      const rect = canvasRef.current!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const comp = activeComp(s);
      const cx = (mx - v.ox) / v.zoom;
      const cy = (my - v.oy) / v.zoom;
      const baseOx = (size.w - comp.width * nz) / 2;
      const baseOy = (size.h - comp.height * nz) / 2;
      setPan({ x: mx - cx * nz - baseOx, y: my - cy * nz - baseOy });
      s.setStageZoom(nz);
    } else {
      setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
      if (s.stageZoom === 'fit') s.setStageZoom(viewRef.current.zoom);
    }
  };

  // Empêche le zoom de page natif avec Ctrl+molette sur la scène.
  useEffect(() => {
    const el = wrapRef.current!;
    const prevent = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', prevent, { passive: false });
    return () => el.removeEventListener('wheel', prevent);
  }, []);

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full overflow-hidden"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        for (const f of Array.from(e.dataTransfer.files)) void importFile(f);
      }}
    >
      <canvas
        ref={canvasRef}
        width={Math.max(1, size.w * dpr)}
        height={Math.max(1, size.h * dpr)}
        style={{ width: size.w, height: size.h, cursor: spaceDown && !dragRef.current ? 'grab' : cursor }}
        className="block touch-none"
        data-testid="stage-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      />
    </div>
  );
}

const round = (v: number, f: number) => Math.round(v * f) / f;

/** Modifie x/y comme dans le panneau : image clé si animé, sinon valeur fixe. */
function setXY(l: Layer, x: number, y: number, t: number) {
  setPropValue(l, 'x', round(x, 100), t);
  setPropValue(l, 'y', round(y, 100), t);
}
