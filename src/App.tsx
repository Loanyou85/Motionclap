import { useCallback, useEffect, useRef, useState } from 'react';
import { ExportDialog } from './components/export/ExportDialog';
import { LayersPanel } from './components/layers/LayersPanel';
import { ProjectsDialog, ShortcutsDialog, TemplatesDialog } from './components/projects/ProjectDialogs';
import { PropertiesPanel } from './components/properties/PropertiesPanel';
import { Stage } from './components/stage/Stage';
import { StageToolbar } from './components/stage/StageToolbar';
import { Timeline } from './components/timeline/Timeline';
import { TopBar } from './components/TopBar';
import { Toast } from './components/ui/overlay';
import { usePlayback } from './hooks/usePlayback';
import { useShortcuts } from './hooks/useShortcuts';
import { useStore } from './store/store';

/** Poignée horizontale pour redimensionner la timeline. */
function Splitter({ onDrag }: { onDrag: (dy: number) => void }) {
  const last = useRef<number | null>(null);
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Redimensionner la timeline"
      className="group flex h-2 shrink-0 cursor-row-resize items-center justify-center"
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        last.current = e.clientY;
      }}
      onPointerMove={(e) => {
        if (last.current === null) return;
        onDrag(e.clientY - last.current);
        last.current = e.clientY;
      }}
      onPointerUp={() => (last.current = null)}
    >
      <span className="h-1 w-12 rounded-full bg-line transition-colors group-hover:bg-accent" />
    </div>
  );
}

export default function App() {
  const dialog = useStore((s) => s.dialog);
  const [timelineH, setTimelineH] = useState(() => Math.round(Math.min(320, window.innerHeight * 0.32)));
  usePlayback();
  useShortcuts();
  const drag = useCallback((dy: number) => setTimelineH((h) => Math.min(window.innerHeight * 0.7, Math.max(140, h - dy))), []);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useStore.getState().saveStatus === 'unsaved' || useStore.getState().saveStatus === 'saving') e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  return (
    <div className="flex h-full flex-col bg-canvas">
      <TopBar />
      <main className="flex min-h-0 flex-1 flex-col gap-0 p-3 pb-3">
        <div className="flex min-h-0 flex-1 gap-3">
          <div className="w-[260px] shrink-0">
            <LayersPanel />
          </div>
          <section className="panel flex min-w-0 flex-1 flex-col overflow-hidden" aria-label="Scène">
            <StageToolbar />
            <div className="min-h-0 flex-1 bg-canvas">
              <Stage />
            </div>
          </section>
          <div className="w-[320px] shrink-0">
            <PropertiesPanel />
          </div>
        </div>
        <Splitter onDrag={drag} />
        <div className="shrink-0" style={{ height: timelineH }}>
          <Timeline />
        </div>
      </main>
      {dialog === 'export' && <ExportDialog />}
      {dialog === 'projects' && <ProjectsDialog />}
      {dialog === 'templates' && <TemplatesDialog />}
      {dialog === 'shortcuts' && <ShortcutsDialog />}
      <Toast />
    </div>
  );
}
