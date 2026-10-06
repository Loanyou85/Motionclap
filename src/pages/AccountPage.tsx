import { useEffect, useState } from 'react';
import { deleteAccount, openBillingPortal, useAuth, usePlan } from '../account/auth';
import { exportAllData } from '../account/cloud';
import { isPaidPlan, PLAN_ORDER, PLANS, type PlanId } from '../billing/plans';
import { PlanCard, SubscribeButton } from '../components/billing/Billing';
import { SitePage } from '../components/marketing/Site';
import { Icon } from '../components/ui/Icon';
import { Modal } from '../components/ui/overlay';
import { downloadBlob } from '../lib/download';
import { cloudEnabled } from '../lib/supabase';
import { Link, navigate, useSearch } from '../router';

const date = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');

const fr1 = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const formatBytes = (n: number) => (n >= 1024 ** 3 ? `${fr1(n / 1024 ** 3)} Go` : n >= 1024 ** 2 ? `${fr1(n / 1024 ** 2)} Mo` : `${Math.round(n / 1024)} Ko`);

/** Phrase de statut lisible pour l'abonnement. */
export function statusText(sub: { status: string; current_period_end: string | null; cancel_at_period_end: boolean; trial_end: string | null } | null, plan: PlanId): string {
  if (!sub || plan === 'free') {
    if (sub?.status === 'canceled') return 'Abonnement résilié : vous êtes revenu à la formule Gratuite.';
    if (sub?.status === 'unpaid') return 'Paiement impayé : l’accès aux fonctions payantes est suspendu.';
    return 'Formule Gratuite.';
  }
  if (sub.status === 'trialing') {
    return sub.cancel_at_period_end ? `Essai gratuit jusqu’au ${date(sub.trial_end)}, sans renouvellement.` : `Essai gratuit jusqu’au ${date(sub.trial_end)}, puis prélèvement automatique.`;
  }
  if (sub.status === 'past_due') return 'Paiement en échec : mettez à jour votre carte pour conserver votre accès.';
  if (sub.cancel_at_period_end) return `Résiliation programmée : accès jusqu’au ${date(sub.current_period_end)}.`;
  return `Renouvellement le ${date(sub.current_period_end)}.`;
}

export function AccountPage() {
  const user = useAuth((s) => s.user);
  const sub = useAuth((s) => s.subscription);
  const usage = useAuth((s) => s.usage);
  const devPlan = useAuth((s) => s.devPlan);
  const plan = usePlan();
  const search = useSearch();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const wanted = search.get('abonner');

  useEffect(() => {
    void useAuth.getState().refresh();
  }, []);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const quota = usage?.storage_quota ?? PLANS[plan].entitlements.storageBytes;
  const used = usage?.storage_used ?? 0;

  return (
    <SitePage>
      <div className="bg-canvas py-12">
        <div className="mx-auto max-w-5xl space-y-6 px-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-[28px] font-extrabold tracking-tight text-navy">Mon compte</h1>
              <p className="mt-1 text-[14px] text-muted">{user ? user.email : 'Mode local (comptes non configurés)'}</p>
            </div>
            <Link to="/app" className="btn-primary h-10">
              <Icon name="play" size={14} />
              Ouvrir l’éditeur
            </Link>
          </div>

          {search.get('paiement') === 'annule' && (
            <p className="rounded-am border border-amber-200 bg-amber-50 px-4 py-3 text-[13.5px] text-amber-800">Paiement annulé : aucun montant n’a été débité.</p>
          )}
          {error && (
            <p className="rounded-am border border-red-200 bg-red-50 px-4 py-3 text-[13.5px] text-red-700" role="alert">
              {error}
            </p>
          )}

          <section className="panel p-6" aria-labelledby="formule">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 id="formule" className="panel-title">
                  Formule
                </h2>
                <p className="mt-2 flex items-center gap-2 text-[22px] font-bold text-navy" data-testid="current-plan">
                  {PLANS[plan].name}
                  {devPlan && <span className="chip">simulée (dev)</span>}
                </p>
                <p className="mt-1 text-[14px] text-muted">{statusText(sub, plan)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {sub?.stripe_customer_id && (
                  <button className="btn-outline h-10" disabled={busy === 'portal'} onClick={() => run('portal', openBillingPortal)}>
                    <Icon name="export" size={14} />
                    {busy === 'portal' ? 'Ouverture…' : 'Gérer l’abonnement et les factures'}
                  </button>
                )}
              </div>
            </div>
            {sub?.stripe_customer_id && (
              <p className="mt-4 text-[12.5px] text-muted">
                Le portail sécurisé Stripe permet de changer de formule, de mettre à jour votre carte, de télécharger vos factures ou de résilier.
              </p>
            )}
          </section>

          {plan !== 'studio' && (
            <section aria-labelledby="changer">
              <h2 id="changer" className="panel-title mb-3">
                {plan === 'free' ? 'Passer à une formule payante' : 'Changer de formule'}
              </h2>
              <div className="grid gap-5 md:grid-cols-2">
                {PLAN_ORDER.filter((p) => isPaidPlan(p) && PLAN_ORDER.indexOf(p) > PLAN_ORDER.indexOf(plan)).map((p) => (
                  <PlanCard key={p} plan={p} highlighted={wanted ? wanted === p : p === 'pro'} action={isPaidPlan(p) && <SubscribeButton plan={p} />} />
                ))}
              </div>
            </section>
          )}

          <section className="panel grid gap-6 p-6 md:grid-cols-2" aria-label="Utilisation">
            <div>
              <h2 className="panel-title">Projets</h2>
              <p className="mt-2 text-[20px] font-bold text-navy">
                {usage?.projects ?? '—'}
                <span className="text-[14px] font-medium text-muted"> / {PLANS[plan].entitlements.maxProjects ?? 'illimités'}</span>
              </p>
            </div>
            <div>
              <h2 className="panel-title">Stockage en ligne</h2>
              <p className="mt-2 text-[14px] text-navy">
                {formatBytes(used)} sur {formatBytes(quota)}
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-sky" role="progressbar" aria-valuemin={0} aria-valuemax={quota} aria-valuenow={used}>
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (used / quota) * 100)}%` }} />
              </div>
            </div>
          </section>

          {user && (
            <section className="panel p-6" aria-labelledby="donnees">
              <h2 id="donnees" className="panel-title">
                Mes données
              </h2>
              <p className="mt-2 text-[13.5px] text-muted">
                Conformément au RGPD, vous pouvez récupérer toutes vos données ou supprimer définitivement votre compte.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  className="btn-outline"
                  disabled={busy === 'export'}
                  onClick={() => run('export', async () => downloadBlob(await exportAllData(), 'atelier-motion-mes-donnees.json'))}
                >
                  <Icon name="download" size={14} />
                  {busy === 'export' ? 'Préparation…' : 'Exporter mes données'}
                </button>
                <button className="btn-outline hover:!border-red-300 hover:!text-red-600" onClick={() => setConfirmDelete(true)}>
                  <Icon name="trash" size={14} />
                  Supprimer mon compte
                </button>
              </div>
            </section>
          )}

          {import.meta.env.DEV && <DevPlanSwitcher />}
          {!cloudEnabled && (
            <p className="text-[13px] text-muted">
              Mode local : les comptes, les projets en ligne et les abonnements s’activent en renseignant les clés Supabase et Stripe (voir le README).
            </p>
          )}
        </div>
      </div>
      {confirmDelete && <DeleteAccountDialog onClose={() => setConfirmDelete(false)} />}
    </SitePage>
  );
}

function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title="Supprimer mon compte" onClose={onClose} width={480}>
      <div className="space-y-4 text-[13.5px] text-navy">
        <p>
          Cette action est <strong>définitive</strong> : votre abonnement éventuel est résilié immédiatement (sans remboursement de la période en cours), puis vos
          projets, ressources et informations de compte sont effacés. Les factures restent conservées par Stripe pour nos obligations comptables.
        </p>
        <label className="block space-y-1">
          <span className="field-label">Tapez SUPPRIMER pour confirmer</span>
          <input className="field h-10" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        {error && <p className="rounded-am border border-red-200 bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-outline" onClick={onClose}>
            Annuler
          </button>
          <button
            className="btn h-8 bg-red-600 text-white hover:bg-red-700"
            disabled={text !== 'SUPPRIMER' || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await deleteAccount();
                navigate('/');
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
              }
            }}
          >
            {busy ? 'Suppression…' : 'Supprimer définitivement'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Développement uniquement : simuler une formule pour tester les blocages sans Stripe. */
function DevPlanSwitcher() {
  const devPlan = useAuth((s) => s.devPlan);
  return (
    <section className="rounded-am border border-dashed border-amber-300 bg-amber-50 p-4 text-[13px] text-amber-900">
      <p className="font-semibold">Outil de développement (absent des builds de production)</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        Simuler la formule :
        {(['free', 'pro', 'studio'] as PlanId[]).map((p) => (
          <button key={p} className={`tab h-7 ${devPlan === p ? 'tab-active' : ''}`} onClick={() => useAuth.getState().setDevPlan(p)}>
            {PLANS[p].name}
          </button>
        ))}
        <button className="tab h-7" onClick={() => useAuth.getState().setDevPlan(null)}>
          Réelle
        </button>
      </div>
    </section>
  );
}

/** Retour de Stripe Checkout : attend que le webhook ait activé l'abonnement. */
export function CheckoutSuccessPage() {
  const plan = usePlan();
  const sub = useAuth((s) => s.subscription);
  const [waited, setWaited] = useState(0);
  useEffect(() => {
    if (plan !== 'free' || waited >= 15) return;
    const t = setTimeout(async () => {
      await useAuth.getState().refresh();
      setWaited((w) => w + 1);
    }, 2000);
    return () => clearTimeout(t);
  }, [plan, waited]);

  const active = plan !== 'free';
  return (
    <SitePage>
      <div className="flex min-h-[60vh] items-center justify-center bg-canvas px-5 py-16">
        <div className="w-full max-w-lg rounded-[16px] border border-line bg-white p-8 text-center shadow-pop" role="status">
          <span className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${active ? 'bg-primary text-white' : 'bg-sky text-primary'}`}>
            <Icon name={active ? 'check' : 'sparkles'} size={26} />
          </span>
          {active ? (
            <>
              <h1 className="mt-5 text-[24px] font-extrabold text-navy">Bienvenue dans {PLANS[plan].name} !</h1>
              <p className="mt-2 text-[14px] text-muted">
                {sub?.status === 'trialing' ? `Votre essai gratuit est actif jusqu’au ${date(sub.trial_end)}.` : 'Votre abonnement est actif.'} Toutes les fonctions{' '}
                {PLANS[plan].name} sont débloquées.
              </p>
              <Link to="/app" className="btn-primary mt-6 h-11 px-6">
                Ouvrir l’éditeur
              </Link>
            </>
          ) : waited < 15 ? (
            <>
              <h1 className="mt-5 text-[22px] font-extrabold text-navy">Activation de votre abonnement…</h1>
              <p className="mt-2 text-[14px] text-muted">Le paiement est confirmé, nous finalisons l’activation (quelques secondes).</p>
            </>
          ) : (
            <>
              <h1 className="mt-5 text-[22px] font-extrabold text-navy">Activation en cours</h1>
              <p className="mt-2 text-[14px] text-muted">
                L’activation prend plus de temps que prévu. Elle apparaîtra automatiquement dans « Mon compte » dès réception de la confirmation de Stripe.
              </p>
              <Link to="/compte" className="btn-outline mt-6 h-10">
                Voir mon compte
              </Link>
            </>
          )}
        </div>
      </div>
    </SitePage>
  );
}
