import { useEffect } from 'react';
import { useAuth, usePlan } from '../account/auth';
import { PLAN_ORDER, PLANS } from '../billing/plans';
import { PlanCard, SubscribeButton } from '../components/billing/Billing';
import { DemoCanvas, SitePage } from '../components/marketing/Site';
import { Icon, type IconName } from '../components/ui/Icon';
import { Link } from '../router';

const FEATURES: Array<{ icon: IconName; title: string; text: string }> = [
  { icon: 'diamond', title: 'Timeline et images clés', text: 'Animez position, échelle, rotation, couleurs, flou, contours et tracés. Déplacez les images clés à la souris, image par image.' },
  { icon: 'curve', title: 'Courbes sur mesure', text: 'Ease, cubic-bezier éditable, back, élastique, rebond ou maintien : chaque mouvement a le bon rythme.' },
  { icon: 'sparkles', title: 'Préréglages en un clic', text: 'Apparition, pop, glisser, chute, machine à écrire, vague de texte… et un morphing de formes SVG.' },
  { icon: 'code', title: 'Exports pour le web', text: 'HTML + CSS pur, timeline GSAP ou fichier Lottie : un code propre, prêt à intégrer, fidèle à l’aperçu.' },
  { icon: 'video', title: 'Vidéos jusqu’en 4K', text: 'MP4 ou WebM de 24 à 60 images par seconde, avec votre bande-son, encodés directement dans le navigateur.' },
  { icon: 'folder', title: 'Projets en ligne', text: 'Sauvegarde automatique, modèles prêts à l’emploi et accès à vos projets depuis tous vos appareils.' },
];

const FAQ: Array<[string, string]> = [
  ['Faut-il installer un logiciel ?', 'Non. Atelier Motion fonctionne dans votre navigateur (Chrome, Edge, Firefox ou Safari récents). Les vidéos sont encodées sur votre appareil : vos créations ne transitent pas par nos serveurs pour être exportées.'],
  ['Comment fonctionne l’essai gratuit de 7 jours ?', 'L’essai Pro vous donne accès à toutes les fonctions Pro pendant 7 jours. Votre carte est demandée au départ mais vous n’êtes débité qu’à la fin de l’essai. Résiliez avant le 7ᵉ jour depuis « Mon compte » : vous ne paierez rien. L’essai est offert une seule fois par compte.'],
  ['Puis-je changer de formule ou résilier à tout moment ?', 'Oui. Depuis « Mon compte », le portail sécurisé Stripe vous permet de passer de Pro à Studio (ou l’inverse), de mettre à jour votre carte, de télécharger vos factures ou de résilier. La résiliation prend effet à la fin de la période déjà payée.'],
  ['Que se passe-t-il pour mes projets si je repasse en Gratuit ?', 'Vos projets restent consultables et modifiables. Vous ne pouvez simplement plus en créer de nouveaux au-delà de 3, et les exports réservés aux formules payantes sont de nouveau verrouillés.'],
  ['Quels formats d’export sont disponibles ?', 'Gratuit : vidéo WebM 720p avec filigrane. Pro : MP4 et WebM jusqu’en 1080p sans filigrane, HTML/CSS, GSAP et Lottie. Studio : tout Pro, plus la 4K, vos polices et vos images.'],
  ['Le code exporté est-il libre d’utilisation ?', 'Oui. Les animations que vous créez et le code exporté vous appartiennent : utilisez-les sur vos sites et ceux de vos clients, sans attribution.'],
  ['Les prix incluent-ils la TVA ?', 'Oui, les prix affichés sont TTC, en euros, par mois et sans engagement. Une facture est disponible pour chaque paiement dans votre espace client.'],
  ['Comment sont protégées mes données ?', 'Le paiement est géré par Stripe : nous ne voyons jamais vos données bancaires. Vos projets sont hébergés chez notre prestataire Supabase, dans la région indiquée dans la politique de confidentialité. Vous pouvez exporter ou supprimer toutes vos données à tout moment depuis « Mon compte ».'],
];

export function Landing() {
  const user = useAuth((s) => s.user);
  const plan = usePlan();
  const trialUsed = useAuth((s) => s.subscription?.trial_used ?? false);

  // Ancre éventuelle (/#tarifs) au chargement de la page.
  useEffect(() => {
    const id = location.hash.slice(1);
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
  }, []);

  return (
    <SitePage>
      {/* Accroche */}
      <section className="relative overflow-hidden bg-gradient-to-b from-canvas to-white">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-16 lg:grid-cols-[1fr_1.15fr] lg:pt-24">
          <div>
            <span className="chip mb-5 h-6 px-3 text-[12px]">Nouveau · exports Lottie, GSAP et vidéo 4K</span>
            <h1 className="text-[40px] font-extrabold leading-[1.08] tracking-tight text-navy sm:text-[52px]">
              Le motion design,
              <br />
              <span className="text-primary">directement dans votre navigateur.</span>
            </h1>
            <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted">
              Créez des animations pour vos sites web et des vidéos percutantes : timeline, images clés, courbes et préréglages, puis exportez en
              HTML/CSS, GSAP, Lottie, MP4 ou WebM.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to={user ? '/app' : '/connexion?mode=inscription'} className="btn-primary h-11 px-5 text-[15px]">
                Commencer gratuitement
              </Link>
              {plan === 'free' && <SubscribeButton plan="pro" className="btn-outline h-11 px-5 text-[15px]" label={trialUsed ? 'Passer à Pro' : 'Essayer Pro 7 jours'} />}
            </div>
            <p className="mt-4 text-[13px] text-muted">Sans carte bancaire pour la formule Gratuite · Résiliable à tout moment</p>
          </div>
          <div id="demo" className="scroll-mt-24">
            <div className="overflow-hidden rounded-[16px] border border-line bg-white shadow-pop">
              <div className="flex h-9 items-center gap-1.5 border-b border-line bg-canvas px-3">
                <span className="h-2.5 w-2.5 rounded-full bg-line" />
                <span className="h-2.5 w-2.5 rounded-full bg-line" />
                <span className="h-2.5 w-2.5 rounded-full bg-line" />
                <span className="ml-3 text-[12px] text-muted">Atelier Motion · aperçu en direct</span>
              </div>
              <DemoCanvas />
              <div className="flex items-center gap-2 border-t border-line bg-white px-4 py-2.5">
                {[0.18, 0.42, 0.63, 0.8].map((x) => (
                  <span key={x} className="h-2 w-2 rotate-45 border-2 border-primary bg-white" style={{ marginLeft: `${x * 12}%` }} />
                ))}
                <span className="ml-auto text-[11px] text-muted">Rendu par le moteur de l’application</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Fonctionnalités */}
      <section id="fonctionnalites" className="scroll-mt-16 bg-white py-20">
        <div className="mx-auto max-w-6xl px-5">
          <h2 className="text-center text-[32px] font-extrabold tracking-tight text-navy">Tout pour animer, rien de superflu</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-[16px] text-muted">Une interface claire, pensée pour les designers comme pour les intégrateurs.</p>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <article key={f.title} className="rounded-[12px] border border-line bg-white p-6 shadow-soft transition hover:border-accent">
                <span className="flex h-10 w-10 items-center justify-center rounded-am bg-sky text-primary">
                  <Icon name={f.icon} size={20} />
                </span>
                <h3 className="mt-4 text-[16px] font-semibold text-navy">{f.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-muted">{f.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Étapes */}
      <section className="bg-canvas py-20">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 md:grid-cols-3">
          {[
            ['1', 'Choisissez un modèle', 'Intro de logo, titre animé, bannière web, story verticale… ou partez d’une page blanche.'],
            ['2', 'Animez', 'Ajoutez des images clés, ajustez les courbes, appliquez des préréglages et prévisualisez en temps réel.'],
            ['3', 'Exportez', 'Copiez le code pour votre site ou téléchargez une vidéo prête à publier.'],
          ].map(([n, t, d]) => (
            <div key={n} className="flex gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-[16px] font-bold text-white">{n}</span>
              <div>
                <h3 className="text-[16px] font-semibold text-navy">{t}</h3>
                <p className="mt-1 text-[14px] leading-relaxed text-muted">{d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Tarifs */}
      <section id="tarifs" className="scroll-mt-16 bg-white py-20">
        <div className="mx-auto max-w-6xl px-5">
          <h2 className="text-center text-[32px] font-extrabold tracking-tight text-navy">Des tarifs simples</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-[16px] text-muted">Commencez gratuitement. Passez à Pro quand vous en avez besoin : 7 jours d’essai offerts.</p>
          <div className="mt-12 grid gap-6 lg:grid-cols-3">
            {PLAN_ORDER.map((p) => (
              <PlanCard
                key={p}
                plan={p}
                highlighted={p === 'pro'}
                current={!!user && p === plan}
                action={
                  p === 'free' ? (
                    <Link to={user ? '/app' : '/connexion?mode=inscription'} className="btn-outline h-10 w-full">
                      {user ? 'Ouvrir l’éditeur' : 'Créer un compte gratuit'}
                    </Link>
                  ) : p === plan ? (
                    <Link to="/compte" className="btn-outline h-10 w-full">
                      Gérer mon abonnement
                    </Link>
                  ) : (
                    <SubscribeButton plan={p} />
                  )
                }
              />
            ))}
          </div>
          <PlanComparison />
          <p className="mt-6 text-center text-[13px] text-muted">
            Prix TTC, facturation mensuelle, sans engagement. Paiement sécurisé par Stripe. Voir les{' '}
            <Link to="/cgv" className="text-accent underline">
              conditions générales de vente
            </Link>
            .
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-16 bg-canvas py-20">
        <div className="mx-auto max-w-3xl px-5">
          <h2 className="text-center text-[32px] font-extrabold tracking-tight text-navy">Questions fréquentes</h2>
          <div className="mt-10 space-y-3">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group rounded-[12px] border border-line bg-white px-5 py-4 shadow-soft open:border-accent">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-semibold text-navy">
                  {q}
                  <Icon name="chevronDown" className="shrink-0 text-muted transition group-open:rotate-180" />
                </summary>
                <p className="mt-3 text-[14px] leading-relaxed text-muted">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Appel final */}
      <section className="bg-navy py-16 text-center text-white">
        <div className="mx-auto max-w-3xl px-5">
          <h2 className="text-[30px] font-extrabold tracking-tight">Donnez vie à vos idées dès aujourd’hui</h2>
          <p className="mt-3 text-[16px] text-white/70">Gratuit pour commencer. Aucune installation.</p>
          <Link to={user ? '/app' : '/connexion?mode=inscription'} className="btn-primary mt-7 h-11 px-6 text-[15px]">
            Ouvrir Atelier Motion
          </Link>
        </div>
      </section>
    </SitePage>
  );
}

/** Tableau détaillé des différences entre formules. */
function PlanComparison() {
  const yes = <Icon name="check" className="mx-auto text-primary" aria-label="Inclus" />;
  const no = <span className="text-muted" aria-label="Non inclus">—</span>;
  const rows: Array<[string, (p: (typeof PLANS)['free']) => React.ReactNode]> = [
    ['Projets', (p) => (p.entitlements.maxProjects === null ? 'Illimités' : p.entitlements.maxProjects)],
    ['Export vidéo', (p) => `${p.entitlements.videoFormats.map((f) => f.toUpperCase()).join(', ')} · ${p.entitlements.maxVideoHeight === 2160 ? '4K' : `${p.entitlements.maxVideoHeight}p`}`],
    ['Sans filigrane', (p) => (p.entitlements.watermark ? no : yes)],
    ['HTML/CSS, GSAP, Lottie', (p) => (p.entitlements.webExports ? yes : no)],
    ['Tous les modèles', (p) => (p.entitlements.allTemplates ? yes : no)],
    ['Polices et images personnalisées', (p) => (p.entitlements.customFonts ? yes : no)],
    ['Stockage en ligne', (p) => (p.entitlements.storageBytes >= 1024 ** 3 ? `${p.entitlements.storageBytes / 1024 ** 3} Go` : `${p.entitlements.storageBytes / 1024 ** 2} Mo`)],
    ['Support prioritaire', (p) => (p.entitlements.prioritySupport ? yes : no)],
  ];
  return (
    <div className="mt-12 overflow-x-auto rounded-[12px] border border-line">
      <table className="w-full min-w-[560px] text-[14px]">
        <caption className="sr-only">Comparaison des formules</caption>
        <thead className="bg-canvas">
          <tr>
            <th scope="col" className="px-5 py-3 text-left font-semibold text-navy">Fonction</th>
            {PLAN_ORDER.map((p) => (
              <th key={p} scope="col" className="px-5 py-3 text-center font-semibold text-navy">
                {PLANS[p].name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map(([label, cell]) => (
            <tr key={label}>
              <th scope="row" className="px-5 py-3 text-left font-normal text-navy">{label}</th>
              {PLAN_ORDER.map((p) => (
                <td key={p} className="px-5 py-3 text-center text-navy">{cell(PLANS[p])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
