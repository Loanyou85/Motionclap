import { useEffect, useRef, type ReactNode } from 'react';
import { signOut, useAuth } from '../../account/auth';
import { renderToCanvas } from '../../render/renderer';
import { Link, navigate } from '../../router';
import { TEMPLATES } from '../../templates';
import { PlanBadge } from '../billing/Billing';

export function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label="Atelier Motion — accueil">
      <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#1E5EFF" />
        <path d="M8 22 L13 10 L18 22 M15.5 17 H10.5" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="23" cy="20" r="3" fill="#DBEAFE" />
      </svg>
      <span className={`whitespace-nowrap text-[16px] font-bold tracking-tight ${dark ? 'text-white' : 'text-navy'}`}>Atelier Motion</span>
    </Link>
  );
}

export function SiteHeader() {
  const user = useAuth((s) => s.user);
  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:gap-6 sm:px-5">
        <Logo />
        <nav className="hidden flex-1 items-center gap-1 md:flex" aria-label="Navigation principale">
          {[
            ['Fonctionnalités', '/#fonctionnalites'],
            ['Démo', '/#demo'],
            ['Tarifs', '/#tarifs'],
            ['FAQ', '/#faq'],
          ].map(([label, to]) => (
            <Link key={to} to={to} className="rounded-am px-3 py-2 text-[14px] font-medium text-navy/80 hover:bg-sky hover:text-primary">
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              <Link to="/compte" className="btn-ghost h-9 text-[14px]">
                Mon compte
              </Link>
              <Link to="/app" className="btn-primary h-9 whitespace-nowrap text-[14px]">
                Ouvrir l’éditeur
              </Link>
            </>
          ) : (
            <>
              <Link to="/connexion" className="btn-ghost h-9 whitespace-nowrap px-2 text-[14px] sm:px-3">
                Connexion
              </Link>
              <Link to="/connexion?mode=inscription" className="btn-primary h-9 whitespace-nowrap text-[14px]">
                <span className="hidden sm:inline">Commencer gratuitement</span>
                <span className="sm:hidden">S’inscrire</span>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:grid-cols-[1.5fr_1fr_1fr]">
        <div className="space-y-3">
          <Logo />
          <p className="max-w-xs text-[13px] text-muted">Animez vos sites web et produisez des vidéos motion design, directement dans votre navigateur.</p>
        </div>
        <div>
          <h3 className="panel-title mb-3">Produit</h3>
          <ul className="space-y-2 text-[14px]">
            <li><Link className="text-navy hover:text-accent" to="/#fonctionnalites">Fonctionnalités</Link></li>
            <li><Link className="text-navy hover:text-accent" to="/#tarifs">Tarifs</Link></li>
            <li><Link className="text-navy hover:text-accent" to="/#faq">Questions fréquentes</Link></li>
            <li><Link className="text-navy hover:text-accent" to="/app">Éditeur</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="panel-title mb-3">Informations légales</h3>
          <ul className="space-y-2 text-[14px]">
            <li><Link className="text-navy hover:text-accent" to="/mentions-legales">Mentions légales</Link></li>
            <li><Link className="text-navy hover:text-accent" to="/cgv">Conditions générales de vente</Link></li>
            <li><Link className="text-navy hover:text-accent" to="/confidentialite">Politique de confidentialité</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-line py-5 text-center text-[12px] text-muted">© {new Date().getFullYear()} Atelier Motion. Tous droits réservés.</div>
    </footer>
  );
}

/** Mise en page des pages publiques. */
export function SitePage({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full overflow-y-auto bg-white" style={{ height: '100%' }}>
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
    </div>
  );
}

/** Barre de compte de l'éditeur : formule et menu rapide. */
export function EditorAccountMenu() {
  const user = useAuth((s) => s.user);
  return (
    <div className="flex items-center gap-2">
      <PlanBadge />
      {user && (
        <button
          className="btn-on-dark h-8 !px-2 text-[12px]"
          title={`Connecté : ${user.email}`}
          onClick={async () => {
            await signOut();
            navigate('/');
          }}
        >
          Déconnexion
        </button>
      )}
    </div>
  );
}

/**
 * Démo animée : les modèles fournis, rendus en direct par le moteur de l'application.
 * Respecte « réduire les animations » et se met en pause hors de l'écran.
 */
const DEMO_TEMPLATES = ['title', 'logo', 'morph', 'banner'];

export function DemoCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const off = document.createElement('canvas');
    const projects = DEMO_TEMPLATES.map((id) => TEMPLATES.find((t) => t.id === id)!.build());
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let index = 0;
    let start = performance.now();
    let raf = 0;
    let visible = true;
    const W = 960;
    const draw = (now: number) => {
      const p = projects[index];
      const comp = p.compositions[0];
      const t = reduced ? Math.min(2.2, comp.duration * 0.6) : (now - start) / 1000;
      if (t >= comp.duration && !reduced) {
        index = (index + 1) % projects.length;
        start = now;
      }
      const H = Math.round((W * 9) / 16);
      if (canvas.width !== W * 2) {
        canvas.width = W * 2;
        canvas.height = H * 2;
      }
      const ctx = canvas.getContext('2d')!;
      // Chaque modèle est centré dans un cadre 16:9 (bannière et carré compris).
      const scale = Math.min((W * 2) / comp.width, (H * 2) / comp.height);
      const ow = Math.round(comp.width * scale);
      const oh = Math.round(comp.height * scale);
      if (off.width !== ow || off.height !== oh) {
        off.width = ow;
        off.height = oh;
      }
      renderToCanvas(off, p, comp, Math.min(t, comp.duration));
      ctx.fillStyle = '#F0F6FF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(off, (canvas.width - off.width) / 2, (canvas.height - off.height) / 2);
      if (!reduced && visible) raf = requestAnimationFrame(draw);
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      cancelAnimationFrame(raf);
      if (visible) raf = requestAnimationFrame(draw);
    });
    io.observe(canvas);
    void document.fonts.ready.then(() => requestAnimationFrame(draw));
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, []);
  return <canvas ref={ref} className="block aspect-video w-full" role="img" aria-label="Démonstration animée réalisée avec Atelier Motion" />;
}
