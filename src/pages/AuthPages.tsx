import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../account/auth';
import { isPaidPlan, PLANS } from '../billing/plans';
import { SitePage } from '../components/marketing/Site';
import { Icon } from '../components/ui/Icon';
import { cloudEnabled, supabase } from '../lib/supabase';
import { Link, navigate, useSearch } from '../router';

/** Destination après connexion : l'abonnement demandé, sinon l'éditeur. */
function nextPath(suite: string | null): string {
  if (suite && isPaidPlan(suite)) return `/compte?abonner=${suite}`;
  if (suite?.startsWith('/')) return suite;
  return '/app';
}

const errorText = (msg: string) =>
  ({
    'Invalid login credentials': 'Email ou mot de passe incorrect.',
    'Email not confirmed': 'Confirmez d’abord votre adresse email (lien reçu par email).',
    'User already registered': 'Un compte existe déjà avec cette adresse.',
  })[msg] ?? msg;

function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <SitePage>
      <div className="flex min-h-[70vh] items-start justify-center bg-canvas px-5 py-16">
        <div className="w-full max-w-[420px] rounded-[16px] border border-line bg-white p-8 shadow-pop">
          <h1 className="text-[22px] font-extrabold tracking-tight text-navy">{title}</h1>
          {children}
        </div>
      </div>
    </SitePage>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function LoginPage() {
  const search = useSearch();
  const user = useAuth((s) => s.user);
  const [mode, setMode] = useState<'connexion' | 'inscription' | 'oubli'>(search.get('mode') === 'inscription' ? 'inscription' : 'connexion');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const suite = search.get('suite');

  useEffect(() => {
    if (user) navigate(nextPath(suite), true);
  }, [user, suite]);

  if (!cloudEnabled || !supabase) {
    return (
      <AuthCard title="Comptes non configurés">
        <p className="mt-3 text-[14px] leading-relaxed text-muted">
          Cette installation fonctionne en mode local : renseignez <code>VITE_SUPABASE_URL</code> et <code>VITE_SUPABASE_ANON_KEY</code> dans{' '}
          <code>.env.local</code> pour activer les comptes et les abonnements (voir le README).
        </p>
        <Link to="/app" className="btn-primary mt-6 h-10 w-full">
          Ouvrir l’éditeur en mode local
        </Link>
      </AuthCard>
    );
  }
  const sb = supabase;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === 'connexion') {
        const { error: err } = await sb.auth.signInWithPassword({ email, password });
        if (err) throw err;
      } else if (mode === 'inscription') {
        const { data, error: err } = await sb.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${location.origin}${nextPath(suite)}`, data: { full_name: name.trim() || undefined } },
        });
        if (err) throw err;
        if (!data.session) setInfo('Compte créé ! Cliquez sur le lien reçu par email pour confirmer votre adresse, puis connectez-vous.');
      } else {
        const { error: err } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/reinitialisation` });
        if (err) throw err;
        setInfo('Si un compte existe pour cette adresse, un email de réinitialisation vient d’être envoyé.');
      }
    } catch (err) {
      setError(errorText((err as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'connexion' ? 'Connexion' : mode === 'inscription' ? 'Créer un compte' : 'Mot de passe oublié';
  return (
    <AuthCard title={title}>
      {suite && isPaidPlan(suite) && (
        <p className="mt-3 rounded-am bg-sky/60 px-3 py-2 text-[13px] text-navy">
          Connectez-vous ou créez un compte pour vous abonner à {PLANS[suite].name}.
        </p>
      )}
      {mode !== 'oubli' && (
        <>
          <button
            type="button"
            className="btn-outline mt-6 h-11 w-full gap-2.5 text-[14px]"
            onClick={async () => {
              const { error: err } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}${nextPath(suite)}` } });
              if (err) setError(errorText(err.message));
            }}
          >
            <GoogleIcon />
            Continuer avec Google
          </button>
          <div className="my-5 flex items-center gap-3 text-[12px] text-muted">
            <span className="h-px flex-1 bg-line" />
            ou avec votre email
            <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}
      <form onSubmit={submit} className={`space-y-3 ${mode === 'oubli' ? 'mt-5' : ''}`}>
        {mode === 'inscription' && (
          <label className="block space-y-1">
            <span className="field-label">Nom (facultatif)</span>
            <input className="field h-10 text-[14px]" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
        )}
        <label className="block space-y-1">
          <span className="field-label">Email</span>
          <input className="field h-10 text-[14px]" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
        {mode !== 'oubli' && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label htmlFor="mot-de-passe" className="field-label">
                Mot de passe
              </label>
              {mode === 'connexion' && (
                <button type="button" className="text-[12px] text-accent hover:underline" onClick={() => setMode('oubli')}>
                  Mot de passe oublié ?
                </button>
              )}
            </div>
            <input
              id="mot-de-passe"
              className="field h-10 text-[14px]"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'inscription' ? 'new-password' : 'current-password'}
            />
            {mode === 'inscription' && <span className="text-[11.5px] text-muted">8 caractères minimum.</span>}
          </div>
        )}
        {mode === 'inscription' && (
          <label className="flex items-start gap-2 text-[12.5px] text-navy">
            <input type="checkbox" required className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              J’accepte les{' '}
              <Link to="/cgv" target="_blank" className="text-accent underline">
                CGV
              </Link>{' '}
              et j’ai pris connaissance de la{' '}
              <Link to="/confidentialite" target="_blank" className="text-accent underline">
                politique de confidentialité
              </Link>
              .
            </span>
          </label>
        )}
        {error && (
          <p className="rounded-am border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700" role="alert">
            {error}
          </p>
        )}
        {info && (
          <p className="flex gap-2 rounded-am border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800" role="status">
            <Icon name="check" size={16} className="mt-0.5 shrink-0" />
            {info}
          </p>
        )}
        <button className="btn-primary h-11 w-full text-[14px]" disabled={busy}>
          {busy ? 'Un instant…' : mode === 'connexion' ? 'Se connecter' : mode === 'inscription' ? 'Créer mon compte' : 'Envoyer le lien'}
        </button>
      </form>
      <p className="mt-6 text-center text-[13px] text-muted">
        {mode === 'connexion' ? (
          <>
            Pas encore de compte ?{' '}
            <button className="font-medium text-accent hover:underline" onClick={() => setMode('inscription')}>
              Créer un compte gratuit
            </button>
          </>
        ) : (
          <>
            Déjà inscrit ?{' '}
            <button className="font-medium text-accent hover:underline" onClick={() => setMode('connexion')}>
              Se connecter
            </button>
          </>
        )}
      </p>
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AuthCard title="Nouveau mot de passe">
      {done ? (
        <>
          <p className="mt-3 text-[14px] text-navy">Votre mot de passe a été modifié.</p>
          <Link to="/app" className="btn-primary mt-6 h-10 w-full">
            Ouvrir l’éditeur
          </Link>
        </>
      ) : (
        <form
          className="mt-5 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const { error: err } = (await supabase?.auth.updateUser({ password })) ?? { error: new Error('Comptes non configurés') };
            if (err) setError(errorText(err.message));
            else setDone(true);
          }}
        >
          <label className="block space-y-1">
            <span className="field-label">Nouveau mot de passe</span>
            <input className="field h-10 text-[14px]" type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </label>
          {error && <p className="rounded-am border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>}
          <button className="btn-primary h-11 w-full">Enregistrer</button>
        </form>
      )}
    </AuthCard>
  );
}
