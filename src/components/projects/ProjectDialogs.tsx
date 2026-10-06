import { useEffect, useRef, useState } from 'react';
import { createComposition, createProject, FORMATS, isProject } from '../../engine/defaults';
import { uid } from '../../engine/id';
import type { Project } from '../../engine/types';
import { SHORTCUTS } from '../../hooks/useShortcuts';
import { downloadText, slug } from '../../lib/download';
import { renderToCanvas } from '../../render/renderer';
import { deleteProject, listProjects, loadProject, saveProject, type ProjectSummary } from '../../store/persistence';
import { useStore } from '../../store/store';
import { TEMPLATES } from '../../templates';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/overlay';

/** Vignette d'un projet rendue à un instant donné. */
function Thumbnail({ project, time }: { project: Project; time: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const comp = project.compositions.find((c) => c.id === project.mainCompId) ?? project.compositions[0];
  useEffect(() => {
    const draw = () => ref.current && renderToCanvas(ref.current, project, comp, time);
    draw();
    void document.fonts?.ready.then(draw);
  }, [project, comp, time]);
  const w = 280;
  const h = Math.round((w * comp.height) / comp.width);
  return <canvas ref={ref} width={w * 2} height={h * 2} className="block w-full rounded-t-am bg-white" style={{ aspectRatio: `${comp.width} / ${comp.height}`, maxHeight: 150, objectFit: 'contain' }} />;
}

function confirmReplace(): boolean {
  const s = useStore.getState();
  // Le projet courant est sauvegardé automatiquement : on prévient seulement s'il n'est pas encore enregistré.
  if (s.saveStatus === 'saved' || s.project.compositions.every((c) => c.layers.length === 0)) return true;
  return window.confirm('Le projet en cours a des modifications non encore enregistrées. Continuer ?');
}

export function TemplatesDialog() {
  const st = useStore.getState();
  const [built] = useState(() => TEMPLATES.map((t) => ({ t, project: t.build() })));
  const open = (build: () => Project) => {
    if (!confirmReplace()) return;
    st.loadProject(build());
    st.openDialog(null);
    st.setPlaying(true);
  };
  return (
    <Modal title="Modèles de départ" onClose={() => st.openDialog(null)} width={940}>
      <p className="mb-4 text-[13px] text-muted">Choisissez un point de départ : tout est modifiable (calques, images clés, couleurs, textes).</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FORMATS.map((f) => (
          <button
            key={f.id}
            className="group flex flex-col overflow-hidden rounded-am border border-dashed border-line bg-canvas text-left transition hover:border-accent"
            onClick={() => open(() => createProject('Projet sans titre', createComposition({ width: f.width, height: f.height })))}
          >
            <div className="flex h-[120px] items-center justify-center">
              <span className="rounded border-2 border-primary/40 bg-white" style={{ width: (f.width / Math.max(f.width, f.height)) * 90, height: (f.height / Math.max(f.width, f.height)) * 90 }} />
            </div>
            <div className="border-t border-line bg-surface p-3">
              <p className="font-medium text-navy">Projet vide · {f.id}</p>
              <p className="text-[12px] text-muted">
                {f.width}×{f.height} px
              </p>
            </div>
          </button>
        ))}
        {built.map(({ t, project }) => (
          <button key={t.id} className="group flex flex-col overflow-hidden rounded-am border border-line bg-surface text-left shadow-soft transition hover:border-accent hover:shadow-pop" onClick={() => open(t.build)}>
            <div className="flex h-[150px] items-center justify-center bg-canvas p-2">
              <Thumbnail project={project} time={Math.min(2.2, project.compositions[0].duration * 0.6)} />
            </div>
            <div className="border-t border-line p-3">
              <div className="flex items-center justify-between">
                <p className="font-medium text-navy">{t.name}</p>
                <span className="chip">{t.format}</span>
              </div>
              <p className="mt-0.5 text-[12px] leading-snug text-muted">{t.description}</p>
            </div>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function ProjectsDialog() {
  const st = useStore.getState();
  const current = useStore((s) => s.project);
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = () => void listProjects().then(setList).catch(() => setList([]));
  useEffect(refresh, []);

  const openProject = async (id: string) => {
    if (id === current.id) return st.openDialog(null);
    if (!confirmReplace()) return;
    const p = await loadProject(id);
    if (!p) return st.notify('Projet introuvable.', 'error');
    st.loadProject(p);
    useStore.setState({ saveStatus: 'saved' });
    st.openDialog(null);
  };

  const importJson = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      if (!isProject(data)) throw new Error('ce fichier n’est pas un projet Atelier Motion');
      // Nouvel identifiant pour ne pas écraser un projet existant.
      const p: Project = { ...data, id: uid('p'), updatedAt: Date.now() };
      if (!confirmReplace()) return;
      st.loadProject(p);
      await saveProject(p);
      st.notify(`Projet « ${p.name} » importé.`);
      st.openDialog(null);
    } catch (e) {
      st.notify(`Import impossible : ${(e as Error).message}`, 'error');
    }
  };

  return (
    <Modal
      title="Projets"
      onClose={() => st.openDialog(null)}
      width={720}
      footer={
        <>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
          <button className="btn-outline mr-auto" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" />
            Importer un projet (.json)
          </button>
          <button className="btn-outline" onClick={() => downloadText(JSON.stringify(current, null, 2), `${slug(current.name)}.atelier.json`, 'application/json')}>
            <Icon name="download" />
            Exporter le projet
          </button>
          <button
            className="btn-primary"
            onClick={() => {
              st.openDialog('templates');
            }}
          >
            <Icon name="plus" />
            Nouveau projet
          </button>
        </>
      }
    >
      <p className="mb-3 text-[13px] text-muted">
        Vos projets sont enregistrés automatiquement dans ce navigateur (IndexedDB). Exportez-les en JSON pour les sauvegarder ou les partager.
      </p>
      {list === null ? (
        <p className="py-8 text-center text-muted">Chargement…</p>
      ) : list.length === 0 ? (
        <p className="py-8 text-center text-muted">Aucun projet enregistré pour l’instant.</p>
      ) : (
        <ul className="divide-y divide-line rounded-am border border-line">
          {list.map((p) => (
            <li key={p.id} className={`flex items-center gap-3 px-4 py-3 ${p.id === current.id ? 'bg-sky/50' : 'hover:bg-canvas'}`}>
              <span className="flex h-9 w-9 items-center justify-center rounded-am bg-sky text-primary">
                <Icon name="folder" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-navy">
                  {p.name} {p.id === current.id && <span className="chip ml-1">ouvert</span>}
                </p>
                <p className="text-[12px] text-muted">
                  {p.layerCount} calque{p.layerCount > 1 ? 's' : ''} · modifié le {new Date(p.updatedAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
              </div>
              <button className="btn-outline h-7 px-2.5 text-[12px]" onClick={() => openProject(p.id)}>
                Ouvrir
              </button>
              <button
                className="icon-btn hover:!bg-red-50 hover:!text-red-600"
                title="Supprimer"
                disabled={p.id === current.id}
                onClick={async () => {
                  if (!window.confirm(`Supprimer définitivement « ${p.name} » ?`)) return;
                  await deleteProject(p.id);
                  refresh();
                }}
              >
                <Icon name="trash" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export function ShortcutsDialog() {
  const st = useStore.getState();
  return (
    <Modal title="Raccourcis clavier" onClose={() => st.openDialog(null)} width={520}>
      <dl className="divide-y divide-line">
        {SHORTCUTS.map(([k, d]) => (
          <div key={k} className="flex items-center justify-between gap-4 py-2">
            <dt className="text-[13px] text-navy">{d}</dt>
            <dd>
              <kbd className="rounded-md border border-line bg-canvas px-2 py-0.5 font-mono text-[12px] text-navy shadow-sm">{k}</kbd>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-[12px] text-muted">Astuce : maintenez Espace et faites glisser pour vous déplacer dans la scène, glissez une étiquette de champ pour faire varier sa valeur.</p>
    </Modal>
  );
}
