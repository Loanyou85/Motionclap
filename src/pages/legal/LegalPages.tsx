import type { ReactNode } from 'react';
import { formatPrice, PLANS } from '../../billing/plans';
import { SitePage } from '../../components/marketing/Site';
import { Link } from '../../router';
import { hasPlaceholders, LEGAL } from './legalInfo';

function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <SitePage>
      <article className="mx-auto max-w-3xl px-5 py-14 text-[15px] leading-relaxed text-navy [&_h2]:mt-10 [&_h2]:text-[19px] [&_h2]:font-bold [&_h3]:mt-6 [&_h3]:font-semibold [&_li]:mt-1.5 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-6">
        <h1 className="text-[32px] font-extrabold tracking-tight">{title}</h1>
        <p className="!mt-2 text-[13px] text-muted">Dernière mise à jour : {LEGAL.lastUpdate}</p>
        {import.meta.env.DEV && hasPlaceholders() && (
          <p className="rounded-am border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
            Développement : complétez <code>src/pages/legal/legalInfo.ts</code> et faites relire ces textes avant la mise en ligne.
          </p>
        )}
        {children}
      </article>
    </SitePage>
  );
}

export function MentionsLegales() {
  return (
    <LegalLayout title="Mentions légales">
      <h2>Éditeur du site</h2>
      <p>
        Le site et le service {LEGAL.serviceName} ({LEGAL.siteUrl}) sont édités par {LEGAL.companyName}, {LEGAL.legalForm}, dont le siège est situé{' '}
        {LEGAL.address}, immatriculée sous le numéro {LEGAL.registration}. TVA intracommunautaire : {LEGAL.vatNumber}.
      </p>
      <p>Contact : {LEGAL.contactEmail}</p>
      <p>Directeur de la publication : {LEGAL.publicationDirector}</p>
      <h2>Hébergement</h2>
      <ul>
        <li>Application web : {LEGAL.webHost}</li>
        <li>
          Comptes, base de données et fichiers : Supabase Inc., 970 Toa Payoh North #07-04, Singapour 318992 — région d’hébergement des données :{' '}
          {LEGAL.supabaseRegion}.
        </li>
        <li>Paiements : Stripe Payments Europe, Limited, 1 Grand Canal Street Lower, Grand Canal Dock, Dublin, D02 H210, Irlande.</li>
      </ul>
      <h2>Propriété intellectuelle</h2>
      <p>
        La marque, le logiciel, l’interface et les contenus du site {LEGAL.serviceName} sont protégés. Toute reproduction non autorisée est interdite. Les
        animations, projets et exports créés par les utilisateurs leur appartiennent.
      </p>
      <h2>Données personnelles</h2>
      <p>
        Le traitement de vos données est décrit dans la <Link to="/confidentialite" className="text-accent underline">politique de confidentialité</Link>.
      </p>
    </LegalLayout>
  );
}

export function Cgv() {
  const pro = PLANS.pro;
  const studio = PLANS.studio;
  return (
    <LegalLayout title="Conditions générales de vente et d’utilisation">
      <h2>1. Objet</h2>
      <p>
        Les présentes conditions régissent l’accès au service en ligne {LEGAL.serviceName}, édité par {LEGAL.companyName} (« l’Éditeur »), et la souscription
        des abonnements payants. Toute création de compte ou souscription vaut acceptation des présentes conditions.
      </p>

      <h2>2. Description du service et formules</h2>
      <p>{LEGAL.serviceName} est un logiciel de motion design utilisable dans un navigateur web. Trois formules sont proposées :</p>
      <ul>
        <li>
          <strong>Gratuit</strong> : {PLANS.free.features.join(', ').toLowerCase()}.
        </li>
        <li>
          <strong>Pro — {formatPrice(pro.priceCents)} TTC par mois</strong> : {pro.features.join(', ').toLowerCase()}.
        </li>
        <li>
          <strong>Studio — {formatPrice(studio.priceCents)} TTC par mois</strong> : {studio.features.join(', ').toLowerCase()}.
        </li>
      </ul>
      <p>Le détail des fonctions incluses dans chaque formule figure sur la page <Link to="/#tarifs" className="text-accent underline">Tarifs</Link>.</p>

      <h2>3. Compte utilisateur</h2>
      <p>
        L’utilisation du service nécessite un compte, créé avec une adresse email ou un compte Google. Vous êtes responsable de la confidentialité de vos
        identifiants et de l’exactitude des informations fournies.
      </p>

      <h2>4. Prix et paiement</h2>
      <p>
        Les prix sont indiqués en euros toutes taxes comprises. Le paiement s’effectue par carte bancaire via notre prestataire Stripe ; l’Éditeur n’a jamais
        accès à vos données bancaires. L’abonnement est payable mensuellement et d’avance, à la date anniversaire de la souscription. Une facture est mise à
        disposition pour chaque paiement dans l’espace client.
      </p>
      <p>
        En cas d’échec de paiement, Stripe procède à de nouvelles tentatives ; l’accès aux fonctions payantes est maintenu pendant cette période, puis
        suspendu si le paiement n’aboutit pas.
      </p>

      <h2>5. Essai gratuit</h2>
      <p>
        La formule Pro peut être essayée gratuitement pendant {pro.trialDays} jours, une seule fois par compte. Un moyen de paiement est demandé à la
        souscription. Sauf résiliation avant la fin de l’essai, l’abonnement est automatiquement converti en abonnement payant et le premier prélèvement a
        lieu à l’issue de la période d’essai.
      </p>

      <h2>6. Durée, renouvellement, changement de formule et résiliation</h2>
      <p>
        L’abonnement est conclu sans engagement de durée et se renouvelle tacitement chaque mois. Vous pouvez à tout moment, depuis « Mon compte » (portail
        sécurisé Stripe), changer de formule, mettre à jour votre moyen de paiement ou résilier. Un changement de formule en cours de mois donne lieu à un
        ajustement au prorata. La résiliation prend effet à la fin de la période mensuelle en cours, déjà payée ; aucun remboursement partiel n’est dû, sous
        réserve de l’article 7.
      </p>
      <p>
        À la fin de l’abonnement, le compte repasse en formule Gratuite : les projets existants restent accessibles, mais les fonctions et limites de la
        formule Gratuite s’appliquent.
      </p>

      <h2>7. Droit de rétractation (consommateurs)</h2>
      <p>
        Conformément aux articles L221-18 et suivants du Code de la consommation, le consommateur dispose d’un délai de quatorze jours à compter de la
        souscription pour se rétracter, sans motif, en écrivant à {LEGAL.contactEmail} ou en résiliant depuis son compte. En demandant l’accès immédiat au
        service, le consommateur accepte que celui-ci commence pendant ce délai ; en cas de rétractation, il est remboursé dans les quatorze jours, déduction
        faite du montant correspondant au service fourni jusqu’à la rétractation (article L221-25). Aucun montant n’est dû pour la période d’essai gratuit.
      </p>

      <h2>8. Disponibilité et données</h2>
      <p>
        L’Éditeur s’efforce d’assurer la disponibilité du service, sans garantie d’accès ininterrompu (maintenance, incidents). Les projets sont sauvegardés
        automatiquement ; il vous est recommandé d’exporter régulièrement vos projets importants (format JSON).
      </p>

      <h2>9. Propriété intellectuelle et contenus</h2>
      <p>
        Vous conservez l’intégralité des droits sur les animations, projets et fichiers que vous créez ou importez, et garantissez disposer des droits
        nécessaires sur les contenus importés (images, polices, sons). Les fichiers exportés peuvent être utilisés librement, y compris à des fins
        commerciales. Le logiciel {LEGAL.serviceName} reste la propriété de l’Éditeur.
      </p>

      <h2>10. Responsabilité</h2>
      <p>
        L’Éditeur est tenu d’une obligation de moyens. Sa responsabilité ne saurait être engagée pour les dommages indirects ni pour l’usage fait des contenus
        créés par l’utilisateur. Les dispositions légales protectrices du consommateur demeurent applicables.
      </p>

      <h2>11. Données personnelles</h2>
      <p>
        Voir la <Link to="/confidentialite" className="text-accent underline">politique de confidentialité</Link>.
      </p>

      <h2>12. Médiation et droit applicable</h2>
      <p>
        En cas de litige, le consommateur peut recourir gratuitement au médiateur de la consommation : {LEGAL.mediator}, après une réclamation écrite
        préalable auprès de l’Éditeur. Les présentes conditions sont soumises au droit français.
      </p>
      <p className="text-[13px] text-muted">Contact : {LEGAL.contactEmail} — {LEGAL.companyName}, {LEGAL.address}.</p>
    </LegalLayout>
  );
}

export function Confidentialite() {
  return (
    <LegalLayout title="Politique de confidentialité">
      <p>
        Cette politique explique quelles données personnelles {LEGAL.serviceName} traite, pourquoi, et comment exercer vos droits, conformément au Règlement
        général sur la protection des données (RGPD) et à la loi Informatique et Libertés.
      </p>

      <h2>Responsable du traitement</h2>
      <p>
        {LEGAL.companyName}, {LEGAL.address}. Contact pour vos données : {LEGAL.privacyEmail}.
      </p>

      <h2>Données traitées</h2>
      <ul>
        <li>Compte : adresse email, nom (facultatif), photo de profil et identifiant Google si vous utilisez la connexion Google.</li>
        <li>Contenus : projets, sons, images et polices que vous importez ou créez.</li>
        <li>
          Abonnement : formule, statut, dates de renouvellement, identifiants client et d’abonnement Stripe. Les données de carte bancaire sont collectées
          et traitées uniquement par Stripe.
        </li>
        <li>Données techniques : journaux de connexion et de sécurité.</li>
      </ul>

      <h2>Finalités et bases légales</h2>
      <ul>
        <li>Fournir le service, sauvegarder vos projets et gérer votre compte : exécution du contrat.</li>
        <li>Gérer les abonnements, paiements et factures : exécution du contrat et obligations légales (comptabilité).</li>
        <li>Assurer la sécurité du service et prévenir les abus (par exemple, essai gratuit unique) : intérêt légitime.</li>
      </ul>
      <p>Aucune donnée n’est vendue ni utilisée à des fins publicitaires.</p>

      <h2>Destinataires et sous-traitants</h2>
      <ul>
        <li>Supabase (authentification, base de données, stockage des fichiers) — région : {LEGAL.supabaseRegion}.</li>
        <li>Stripe (paiement et facturation) — certaines données peuvent être transférées hors de l’Union européenne, dans le cadre des garanties prévues par le RGPD (clauses contractuelles types, Data Privacy Framework).</li>
        <li>Google, uniquement si vous choisissez la connexion avec un compte Google.</li>
        <li>Hébergeur de l’application web : {LEGAL.webHost}.</li>
      </ul>

      <h2>Durées de conservation</h2>
      <ul>
        <li>Compte et projets : jusqu’à la suppression du compte.</li>
        <li>Pièces comptables (factures) : 10 ans, conformément au Code de commerce (conservées par Stripe).</li>
        <li>Journaux techniques : 12 mois maximum.</li>
      </ul>

      <h2>Vos droits</h2>
      <p>
        Vous disposez des droits d’accès, de rectification, d’effacement, de limitation, d’opposition et de portabilité, ainsi que du droit de définir des
        directives sur le sort de vos données après votre décès. Depuis « Mon compte », vous pouvez à tout moment <strong>exporter toutes vos données</strong>{' '}
        (format JSON) et <strong>supprimer votre compte</strong>. Pour toute autre demande : {LEGAL.privacyEmail}. Vous pouvez également introduire une
        réclamation auprès de la CNIL (www.cnil.fr).
      </p>

      <h2>Cookies et stockage local</h2>
      <p>
        {LEGAL.serviceName} n’utilise ni cookie publicitaire ni outil de mesure d’audience. Le navigateur conserve uniquement les éléments strictement
        nécessaires au fonctionnement du service : la session de connexion (stockage local) et une copie de travail de vos projets (IndexedDB). Ces éléments
        étant indispensables, ils ne nécessitent pas de consentement. La police de caractères de l’interface est hébergée sur nos propres serveurs : aucune
        requête n’est envoyée à un service tiers pour l’afficher.
      </p>

      <h2>Sécurité</h2>
      <p>
        Les échanges sont chiffrés (HTTPS). Les données de chaque utilisateur sont cloisonnées par des règles d’accès en base de données (Row Level Security)
        et les fichiers sont stockés dans un espace privé.
      </p>
    </LegalLayout>
  );
}
