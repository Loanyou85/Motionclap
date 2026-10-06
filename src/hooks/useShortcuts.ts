import { useEffect } from 'react';
import { activeComp, useStore } from '../store/store';

export const SHORTCUTS: Array<[string, string]> = [
  ['Espace', 'Lecture / pause'],
  ['Suppr / Retour arrière', 'Supprimer la sélection (images clés ou calques)'],
  ['Ctrl + Z', 'Annuler'],
  ['Ctrl + Maj + Z / Ctrl + Y', 'Rétablir'],
  ['Ctrl + D', 'Dupliquer les calques sélectionnés'],
  ['Ctrl + G', 'Grouper'],
  ['Ctrl + Maj + G', 'Dégrouper'],
  ['Flèches', 'Déplacer le calque de 1 px (Maj : 10 px)'],
  [', et .', 'Image précédente / suivante'],
  ['Début / Fin', 'Aller au début / à la fin'],
  ['K', 'Ajouter une image clé de position'],
  ['Échap', 'Désélectionner'],
  ['Ctrl + molette', 'Zoomer sur la scène'],
];

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** Raccourcis clavier globaux. */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      if (s.dialog) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && key === 'z') {
        if (isTyping(e)) return;
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && key === 'y') {
        if (isTyping(e)) return;
        e.preventDefault();
        s.redo();
        return;
      }
      if (isTyping(e)) return;

      if (mod && key === 'd') {
        e.preventDefault();
        s.duplicateSelection();
        return;
      }
      if (mod && key === 'g') {
        e.preventDefault();
        if (e.shiftKey) s.ungroupSelection();
        else s.groupSelection();
        return;
      }
      if (mod) return;

      const comp = activeComp(s);
      switch (e.key) {
        case ' ':
          e.preventDefault();
          s.togglePlay();
          break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          s.deleteSelection();
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          if (s.selectedLayerIds.length === 0) {
            // Sans sélection : flèches gauche/droite = image par image.
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              s.setTime(s.time + (e.key === 'ArrowLeft' ? -1 : 1) / comp.fps);
            }
            break;
          }
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          s.nudgeSelection(dx, dy);
          break;
        }
        case ',':
          s.setTime(s.time - 1 / comp.fps);
          break;
        case '.':
          s.setTime(s.time + 1 / comp.fps);
          break;
        case 'Home':
          e.preventDefault();
          s.setTime(0);
          break;
        case 'End':
          e.preventDefault();
          s.setTime(comp.duration);
          break;
        case 'k':
        case 'K':
          for (const id of s.selectedLayerIds) {
            s.toggleKeyframe(id, 'x');
            s.toggleKeyframe(id, 'y');
          }
          break;
        case 'Escape':
          s.selectLayer(null);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
