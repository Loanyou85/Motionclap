import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../../store/store';
import { Icon } from './Icon';

const modalStack: object[] = [];

/** Fenêtre modale centrée. */
export function Modal({
  title,
  onClose,
  children,
  width = 720,
  footer,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  footer?: ReactNode;
}) {
  // Seule la fenêtre du dessus réagit à Échap (fenêtres empilées).
  const token = useRef<object>({});
  useEffect(() => {
    const me = token.current;
    modalStack.push(me);
    return () => {
      modalStack.splice(modalStack.indexOf(me), 1);
    };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalStack[modalStack.length - 1] === token.current) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy/30 backdrop-blur-[2px] p-6"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
    >
      <div className="panel shadow-pop flex max-h-full w-full flex-col" style={{ maxWidth: width }}>
        <header className="flex items-center justify-between border-b border-line px-5 h-14 shrink-0">
          <h2 className="text-[15px] font-semibold text-navy">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            <Icon name="close" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-5">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-2 border-t border-line px-5 h-14 shrink-0">{footer}</footer>}
      </div>
    </div>
  );
}

/** Menu déroulant ancré sous son bouton. */
export function Dropdown({
  trigger,
  children,
  align = 'left',
}: {
  trigger: (open: boolean, toggle: () => void) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      {trigger(open, () => setOpen((o) => !o))}
      {open && (
        <div className={`menu absolute top-full mt-1 ${align === 'right' ? 'right-0' : 'left-0'}`}>{children(() => setOpen(false))}</div>
      )}
    </div>
  );
}

/** Notification éphémère en bas de l'écran. */
export function Toast() {
  const toast = useStore((s) => s.toast);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 3200);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast || !visible) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center">
      <div
        className={`panel shadow-pop flex items-center gap-2 px-4 h-10 text-[13px] ${toast.tone === 'error' ? 'border-red-200 text-red-700' : 'text-navy'}`}
        role="status"
      >
        <Icon name={toast.tone === 'error' ? 'info' : 'check'} className={toast.tone === 'error' ? 'text-red-500' : 'text-primary'} />
        {toast.text}
      </div>
    </div>
  );
}
