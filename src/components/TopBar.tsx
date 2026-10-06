import { activeComp, useStore } from '../store/store';
import { Icon } from './ui/Icon';
import { TextField } from './ui/fields';
import { EditorAccountMenu } from './marketing/Site';
import { Link } from '../router';

export function formatTime(t: number, fps: number): string {
  const s = Math.floor(t + 1e-6);
  const f = Math.round((t - s) * fps);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}:${String(Math.min(f, fps - 1)).padStart(2, '0')}`;
}

const SAVE_LABELS = {
  saved: 'Enregistré',
  saving: 'Enregistrement…',
  unsaved: 'Modifications non enregistrées',
  error: 'Erreur de sauvegarde',
};

export function TopBar() {
  const name = useStore((s) => s.project.name);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const playing = useStore((s) => s.playing);
  const loop = useStore((s) => s.loop);
  const time = useStore((s) => s.time);
  const saveStatus = useStore((s) => s.saveStatus);
  const comp = useStore((s) => activeComp(s));
  const st = useStore.getState();

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 bg-navy px-4 text-white">
      <Link to="/" className="flex items-center gap-2.5" title="Accueil">
        <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="8" fill="#1E5EFF" />
          <path d="M8 22 L13 10 L18 22 M15.5 17 H10.5" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="23" cy="20" r="3" fill="#DBEAFE" />
        </svg>
        <span className="text-[15px] font-semibold tracking-tight">Atelier Motion</span>
      </Link>
      <span className="h-6 w-px bg-white/15" />
      <div className="flex min-w-0 items-center gap-2">
        <TextField
          value={name}
          onCommit={(v) => st.renameProject(v.trim() || 'Projet sans titre')}
          className="!h-8 !w-56 !border-transparent !bg-white/10 !text-white hover:!bg-white/15 focus:!bg-white focus:!text-navy"
        />
        <span
          className={`flex items-center gap-1.5 text-[12px] ${saveStatus === 'error' ? 'text-red-300' : 'text-white/60'}`}
          title="Sauvegarde automatique dans le navigateur (IndexedDB)"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${saveStatus === 'saved' ? 'bg-emerald-400' : saveStatus === 'error' ? 'bg-red-400' : 'bg-amber-300'}`} />
          {SAVE_LABELS[saveStatus]}
        </span>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-1">
        <button className="btn-on-dark !px-2" onClick={st.undo} disabled={!canUndo} title="Annuler (Ctrl+Z)" aria-label="Annuler">
          <Icon name="undo" />
        </button>
        <button className="btn-on-dark !px-2" onClick={st.redo} disabled={!canRedo} title="Rétablir (Ctrl+Maj+Z)" aria-label="Rétablir">
          <Icon name="redo" />
        </button>
      </div>
      <span className="h-6 w-px bg-white/15" />
      <div className="flex items-center gap-1">
        <button className="btn-on-dark !px-2" onClick={() => st.setTime(0)} title="Aller au début (Début)" aria-label="Aller au début">
          <Icon name="toStart" />
        </button>
        <button
          className="btn h-9 w-9 !px-0 rounded-full bg-primary text-white hover:bg-accent"
          onClick={st.togglePlay}
          title="Lecture / pause (Espace)"
          aria-label={playing ? 'Pause' : 'Lecture'}
        >
          <Icon name={playing ? 'pause' : 'play'} size={18} />
        </button>
        <button className="btn-on-dark !px-2" onClick={() => st.setTime(comp.duration)} title="Aller à la fin (Fin)" aria-label="Aller à la fin">
          <Icon name="toEnd" />
        </button>
        <button
          className={`btn-on-dark !px-2 ${loop ? '!text-sky' : '!text-white/40'}`}
          onClick={() => st.setLoop(!loop)}
          title={loop ? 'Lecture en boucle activée' : 'Lecture en boucle désactivée'}
          aria-pressed={loop}
        >
          <Icon name="loop" />
        </button>
        <span className="ml-2 rounded-am bg-white/10 px-2.5 py-1 font-mono text-[12px] tabular-nums" title="Minutes:secondes:images">
          {formatTime(time, comp.fps)} <span className="text-white/50">/ {formatTime(comp.duration, comp.fps)}</span>
        </span>
      </div>
      <span className="h-6 w-px bg-white/15" />
      <div className="flex items-center gap-1">
        <button className="btn-on-dark" onClick={() => st.openDialog('templates')} title="Modèles de départ">
          <Icon name="template" />
          Modèles
        </button>
        <button className="btn-on-dark" onClick={() => st.openDialog('projects')} title="Projets enregistrés, import / export JSON">
          <Icon name="folder" />
          Projets
        </button>
        <button className="btn-on-dark !px-2" onClick={() => st.openDialog('shortcuts')} title="Raccourcis clavier" aria-label="Raccourcis clavier">
          <Icon name="keyboard" />
        </button>
        <button className="btn-primary ml-1" onClick={() => st.openDialog('export')}>
          <Icon name="export" />
          Exporter
        </button>
      </div>
      <span className="h-6 w-px bg-white/15" />
      <EditorAccountMenu />
    </header>
  );
}
