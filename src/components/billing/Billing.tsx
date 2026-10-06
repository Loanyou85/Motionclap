import { useState } from 'react';
import { openBillingPortal, startCheckout, useAuth, usePlan } from '../../account/auth';
import { useUpgrade } from '../../billing/gates';
import { effectivePlan, formatPrice, PLAN_ORDER, PLANS, type PaidPlanId, type PlanId } from '../../billing/plans';
import { cloudEnabled } from '../../lib/supabase';
import { Link, navigate } from '../../router';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/overlay';

/** Pastille de la formule courante (barre du haut). */
export function PlanBadge() {
  const plan = usePlan();
  const trialing = useAuth((s) => s.subscription?.status === 'trialing');
  return (
    <Link
      to="/compte"
      className={`inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold uppercase tracking-wide ${
        plan === 'free' ? 'bg-white/10 text-white/80 hover:bg-white/20' : 'bg-sky text-primary hover:bg-white'
      }`}
      title="Mon compte et mon abonnement"
    >
      {PLANS[plan].name}
      {trialing && <span className="font-medium normal-case tracking-normal">· essai</span>}
    </Link>
  );
}

/** Carte d'une formule : prix, avantages et action. */
export function PlanCard({
  plan,
  current,
  highlighted,
  action,
}: {
  plan: PlanId;
  current?: boolean;
  highlighted?: boolean;
  action?: React.ReactNode;
}) {
  const def = PLANS[plan];
  return (
    <div
      className={`relative flex flex-col rounded-[12px] border bg-surface p-6 ${highlighted ? 'border-primary shadow-pop ring-1 ring-primary' : 'border-line shadow-soft'}`}
      data-testid={`plan-${plan}`}
    >
      {highlighted && (
        <span className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-white">
          {def.trialDays ? `${def.trialDays} jours d’essai gratuit` : 'Recommandé'}
        </span>
      )}
      <div className="flex items-center justify-between">
        <h3 className="text-[18px] font-bold text-navy">{def.name}</h3>
        {current && <span className="chip">Formule actuelle</span>}
      </div>
      <p className="mt-1 text-[13px] text-muted">{def.tagline}</p>
      <p className="mt-4 flex items-baseline gap-1">
        <span className="text-[34px] font-extrabold tracking-tight text-navy">{formatPrice(def.priceCents)}</span>
        <span className="text-[13px] text-muted">{def.priceCents ? 'TTC / mois' : 'pour toujours'}</span>
      </p>
      <ul className="mt-5 flex-1 space-y-2.5">
        {def.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-[13.5px] text-navy">
            <Icon name="check" size={16} className="mt-0.5 shrink-0 text-primary" />
            {f}
          </li>
        ))}
      </ul>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** Bouton d'abonnement : connexion, puis acceptation des CGV, puis Stripe Checkout. */
export function SubscribeButton({ plan, label, className = 'btn-primary w-full h-10' }: { plan: PaidPlanId; label?: string; className?: string }) {
  const user = useAuth((s) => s.user);
  const trialUsed = useAuth((s) => s.subscription?.trial_used ?? false);
  const hasPaidAccess = useAuth((s) => !!s.subscription?.stripe_customer_id && effectivePlan(s.subscription) !== 'free');
  const [askTerms, setAskTerms] = useState(false);
  const def = PLANS[plan];
  const text = label ?? (def.trialDays && !trialUsed && !hasPaidAccess ? `Essayer ${def.name} ${def.trialDays} jours` : `Passer à ${def.name}`);
  return (
    <>
      <button
        className={className}
        onClick={() => {
          if (!cloudEnabled) return useUpgrade.getState().show('Les abonnements nécessitent la configuration de Supabase et de Stripe.', plan);
          if (!user) return navigate(`/connexion?suite=${plan}`);
          // Déjà abonné : le changement de formule (avec prorata) se fait dans le portail Stripe.
          if (hasPaidAccess) return void openBillingPortal().catch((e) => useUpgrade.getState().show((e as Error).message, plan));
          setAskTerms(true);
        }}
      >
        {text}
      </button>
      {askTerms && <CheckoutConfirm plan={plan} onClose={() => setAskTerms(false)} />}
    </>
  );
}

function CheckoutConfirm({ plan, onClose }: { plan: PaidPlanId; onClose: () => void }) {
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trialUsed = useAuth((s) => s.subscription?.trial_used ?? false);
  const def = PLANS[plan];
  const trial = def.trialDays > 0 && !trialUsed;
  return (
    <Modal title={`S’abonner à ${def.name}`} onClose={onClose} width={480}>
      <div className="space-y-4 text-[13.5px] text-navy">
        <p>
          <strong>{formatPrice(def.priceCents)} TTC par mois</strong>, sans engagement.{' '}
          {trial
            ? `Les ${def.trialDays} premiers jours sont gratuits : vous ne serez débité qu’à la fin de l’essai, sauf résiliation avant.`
            : 'Le premier paiement a lieu aujourd’hui.'}{' '}
          Vous pourrez changer de formule ou résilier à tout moment depuis votre compte.
        </p>
        <label className="flex items-start gap-2.5 rounded-am border border-line bg-canvas p-3">
          <input type="checkbox" className="mt-0.5" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          <span>
            J’ai lu et j’accepte les{' '}
            <Link to="/cgv" target="_blank" className="text-accent underline">
              Conditions générales de vente
            </Link>{' '}
            et la{' '}
            <Link to="/confidentialite" target="_blank" className="text-accent underline">
              Politique de confidentialité
            </Link>
            .
          </span>
        </label>
        {error && <p className="rounded-am border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-outline" onClick={onClose}>
            Annuler
          </button>
          <button
            className="btn-primary"
            disabled={!accepted || busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await startCheckout(plan);
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
              }
            }}
          >
            {busy ? 'Redirection vers Stripe…' : trial ? 'Démarrer l’essai gratuit' : 'Continuer vers le paiement'}
          </button>
        </div>
        <p className="flex items-center gap-1.5 text-[11.5px] text-muted">
          <Icon name="lock" size={13} />
          Paiement sécurisé par Stripe. Atelier Motion ne voit jamais vos données bancaires.
        </p>
      </div>
    </Modal>
  );
}

/** Fenêtre affichée quand une fonction est réservée à une formule supérieure. */
export function UpgradeDialog() {
  const request = useUpgrade((s) => s.request);
  const close = useUpgrade((s) => s.close);
  const plan = usePlan();
  if (!request) return null;
  const options = PLAN_ORDER.filter((p): p is PaidPlanId => p !== 'free' && PLAN_ORDER.indexOf(p) >= PLAN_ORDER.indexOf(request.plan));
  return (
    <Modal title={`Passer à ${PLANS[request.plan].name}`} onClose={close} width={options.length > 1 ? 760 : 460}>
      <div className="mb-5 flex items-start gap-3 rounded-am bg-sky/60 p-4 text-[13.5px] text-navy" role="alert">
        <Icon name="sparkles" className="mt-0.5 shrink-0 text-primary" />
        <p>{request.reason}</p>
      </div>
      {!cloudEnabled && (
        <p className="mb-4 rounded-am border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
          Mode local : renseignez les clés Supabase et Stripe (fichiers .env, voir le README) pour activer les comptes et les abonnements.
        </p>
      )}
      <div className={`grid gap-4 ${options.length > 1 ? 'sm:grid-cols-2' : ''}`}>
        {options.map((p) => (
          <PlanCard key={p} plan={p} highlighted={p === request.plan} current={p === plan} action={p === plan ? null : <SubscribeButton plan={p} />} />
        ))}
      </div>
      <p className="mt-4 text-center text-[12px] text-muted">
        Comparer toutes les formules :{' '}
        <Link to="/#tarifs" onClick={close} className="text-accent underline">
          voir les tarifs
        </Link>
      </p>
    </Modal>
  );
}
