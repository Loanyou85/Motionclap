import { useEffect, type ReactNode } from 'react';
import { useAuth } from './account/auth';
import { UpgradeDialog } from './components/billing/Billing';
import { SitePage } from './components/marketing/Site';
import { Toast } from './components/ui/overlay';
import { cloudEnabled } from './lib/supabase';
import { AccountPage, CheckoutSuccessPage } from './pages/AccountPage';
import { LoginPage, ResetPasswordPage } from './pages/AuthPages';
import { Editor } from './pages/Editor';
import { Landing } from './pages/Landing';
import { Cgv, Confidentialite, MentionsLegales } from './pages/legal/LegalPages';
import { Link, navigate, usePath } from './router';

const TITLES: Record<string, string> = {
  '/': 'Atelier Motion — motion design pour le web et la vidéo',
  '/app': 'Éditeur — Atelier Motion',
  '/connexion': 'Connexion — Atelier Motion',
  '/compte': 'Mon compte — Atelier Motion',
  '/paiement/succes': 'Abonnement — Atelier Motion',
  '/reinitialisation': 'Nouveau mot de passe — Atelier Motion',
  '/mentions-legales': 'Mentions légales — Atelier Motion',
  '/cgv': 'Conditions générales de vente — Atelier Motion',
  '/confidentialite': 'Politique de confidentialité — Atelier Motion',
};

/** Pages réservées aux utilisateurs connectés (sauf en mode local, sans Supabase). */
function RequireAuth({ children }: { children: ReactNode }) {
  const user = useAuth((s) => s.user);
  const path = usePath();
  const mustLogin = cloudEnabled && !user;
  useEffect(() => {
    // Garde : l'effet peut être rejoué (mode strict) après la redirection.
    if (mustLogin && location.pathname === path) navigate(`/connexion?suite=${encodeURIComponent(path + location.search)}`, true);
  }, [mustLogin, path]);
  return mustLogin ? null : <>{children}</>;
}

function NotFound() {
  return (
    <SitePage>
      <div className="mx-auto max-w-xl px-5 py-24 text-center">
        <p className="text-[64px] font-extrabold text-primary">404</p>
        <h1 className="text-[22px] font-bold text-navy">Page introuvable</h1>
        <Link to="/" className="btn-primary mt-6 h-10">
          Retour à l’accueil
        </Link>
      </div>
    </SitePage>
  );
}

export default function App() {
  const path = usePath();
  const userId = useAuth((s) => s.user?.id ?? null);

  useEffect(() => {
    document.title = TITLES[path] ?? 'Atelier Motion';
  }, [path]);

  let page: ReactNode;
  switch (path) {
    case '/':
    case '/tarifs':
      page = <Landing />;
      break;
    case '/app':
      page = (
        <RequireAuth>
          <Editor key={userId ?? 'local'} />
        </RequireAuth>
      );
      break;
    case '/connexion':
      page = <LoginPage />;
      break;
    case '/compte':
      page = (
        <RequireAuth>
          <AccountPage />
        </RequireAuth>
      );
      break;
    case '/paiement/succes':
      page = (
        <RequireAuth>
          <CheckoutSuccessPage />
        </RequireAuth>
      );
      break;
    case '/reinitialisation':
      page = <ResetPasswordPage />;
      break;
    case '/mentions-legales':
      page = <MentionsLegales />;
      break;
    case '/cgv':
      page = <Cgv />;
      break;
    case '/confidentialite':
      page = <Confidentialite />;
      break;
    default:
      page = <NotFound />;
  }
  return (
    <>
      {page}
      <UpgradeDialog />
      <Toast />
    </>
  );
}
