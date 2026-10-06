import { useSyncExternalStore, type AnchorHTMLAttributes } from 'react';

/** Routeur minimal fondé sur l'API History (aucune dépendance). */
const subscribe = (fn: () => void) => {
  addEventListener('popstate', fn);
  return () => removeEventListener('popstate', fn);
};

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => location.pathname);
}

export function useSearch(): URLSearchParams {
  const search = useSyncExternalStore(subscribe, () => location.search);
  return new URLSearchParams(search);
}

export function navigate(to: string, replace = false): void {
  if (replace) history.replaceState({}, '', to);
  else history.pushState({}, '', to);
  dispatchEvent(new PopStateEvent('popstate'));
  const hash = to.split('#')[1];
  if (hash) requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth' }));
  else scrollTo({ top: 0 });
}

export function Link({ to, onClick, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      href={to}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || to.startsWith('http')) return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    />
  );
}
