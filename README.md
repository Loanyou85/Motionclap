# Atelier Motion

Application web de motion design pour animer des sites web et produire des vidéos :
calques vectoriels, texte, images et SVG, images clés avec courbes éditables,
groupes, parentage, masques, précompositions, piste audio, et exports
**HTML/CSS**, **GSAP**, **Lottie**, **MP4** et **WebM**. L'interface est entièrement en français.

## Démarrer

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # tests Vitest (moteur, exports, store, facturation, blocages, sécurité)
npm run test:db    # migration Supabase testée sur un Postgres temporaire (binaires PostgreSQL requis)
npm run build      # vérification TypeScript + build de production
```

Sans configuration, l’application tourne en **mode local** : pas de comptes, projets dans le
navigateur, formule Gratuite. En développement, la page « Mon compte » permet de **simuler une
formule** (Gratuit, Pro, Studio) pour tester les blocages sans Stripe ; cet outil n’existe pas en production.

## Abonnements : mise en service

Les clés vont dans des fichiers `.env` ignorés par git, jamais dans le code
(un test échoue si une clé secrète apparaît dans le dépôt).

| Fichier | Contenu | Où |
| --- | --- | --- |
| `.env.local` (copie de `.env.example`) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (publiques, protégées par la RLS) | navigateur |
| `supabase/functions/.env` (copie de l’exemple) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_STUDIO`, `STRIPE_PORTAL_CONFIGURATION`, `SITE_URL` | fonctions Edge uniquement |

1. **Supabase** : créez un projet (de préférence dans une région européenne), puis
   ```bash
   npx supabase link --project-ref <ref>
   npx supabase db push            # applique supabase/migrations
   ```
   Dans *Authentication › URL Configuration*, indiquez l’URL du site et ajoutez `…/app` et `…/reinitialisation` aux URL de redirection.
2. **Google** : créez un identifiant OAuth (Google Cloud › API et services), avec l’URI de redirection
   `https://<ref>.supabase.co/auth/v1/callback`, puis activez le fournisseur Google dans *Authentication › Providers*.
3. **Stripe, en mode test** : copiez la clé `sk_test_…` dans `supabase/functions/.env`, puis
   ```bash
   npm run stripe:setup            # crée Pro 9,99 € et Studio 24,99 € (TTC, mensuels) et le portail client
   ```
   Reportez les identifiants affichés (`STRIPE_PRICE_PRO`, `STRIPE_PRICE_STUDIO`, `STRIPE_PORTAL_CONFIGURATION`) dans le même fichier.
4. **Webhook** : dans le tableau de bord Stripe (mode test), ajoutez l’URL
   `https://<ref>.supabase.co/functions/v1/stripe-webhook` avec les événements `checkout.session.completed`,
   `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.paid` et `invoice.payment_failed`, puis copiez le secret de signature (`whsec_…`) dans `STRIPE_WEBHOOK_SECRET`.
   En local : `stripe listen --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhook`.
5. **Déploiement des fonctions** :
   ```bash
   npx supabase secrets set --env-file supabase/functions/.env
   npx supabase functions deploy create-checkout-session create-portal-session delete-account
   npx supabase functions deploy stripe-webhook --no-verify-jwt
   ```
6. **Essai** : carte de test `4242 4242 4242 4242` (date future, CVC quelconque). Pour simuler un échec de
   paiement à la fin de l’essai, utilisez `4000 0000 0000 0341`. Les horloges de test Stripe permettent d’avancer
   le temps pour vérifier le renouvellement, l’impayé et la coupure d’accès.
7. **Mise en production** : complétez `src/pages/legal/legalInfo.ts` et faites relire les textes légaux, désignez un
   médiateur de la consommation, puis passez aux clés live (`STRIPE_ALLOW_LIVE=true`, `npm run stripe:setup -- --live`).
   Les clés `sk_live_` sont refusées tant que ce n’est pas fait.

L’application est une SPA : `public/_redirects` (Netlify) et `vercel.json` (Vercel) renvoient toutes les routes vers `index.html`.

### Fonctionnement

- **Formules** : définies une seule fois dans `supabase/functions/_shared/plans.ts`, que partagent l’application et les
  fonctions Edge. Les limites SQL (projets, stockage) en sont la copie, et `npm run test:db` vérifie qu’elles concordent.

  | | Gratuit | Pro — 9,99 €/mois | Studio — 24,99 €/mois |
  | --- | --- | --- | --- |
  | Projets | 3 | illimités | illimités |
  | Vidéo | WebM 720p, filigrane | MP4 + WebM 1080p | MP4 + WebM 4K |
  | HTML/CSS, GSAP, Lottie | — | oui | oui |
  | Modèles | essentiels | tous | tous |
  | Polices et images perso | — | — | oui |
  | Stockage en ligne | 100 Mo | 1 Go | 5 Go |
  | Essai gratuit | — | 7 jours, une fois par compte | — |

- **Paiement** : `create-checkout-session` crée le client Stripe et la session Checkout (essai de 7 jours sur Pro si
  jamais utilisé, CGV acceptées dans l’application). Un abonné qui change de formule est envoyé vers le portail client
  (prorata calculé par Stripe). `create-portal-session` ouvre le portail : changement de formule, carte, factures, résiliation.
- **Webhooks** : `stripe-webhook` vérifie la signature, ignore les événements déjà traités et relit toujours l’abonnement
  chez Stripe, si bien que l’ordre d’arrivée n’a pas d’importance. Il met ensuite la table `subscriptions` à jour.
  Accès accordé pour les statuts `active`, `trialing` et `past_due` (pendant les relances), coupé pour `unpaid`,
  `canceled` et `incomplete_expired`. Le cœur (`_shared/billing.ts`) est testé sans réseau.
- **Base** : `subscriptions` est en lecture seule pour l’utilisateur (seul le webhook écrit). `projects` est protégée par
  la RLS, avec un déclencheur qui impose la limite de projets et le quota. Le bucket privé `assets` est rangé en
  `<user_id>/<audio|images|fonts>/…`, et les images et polices n’y sont acceptées qu’en Studio.
- **Blocages dans l’éditeur** : exports web, MP4, définitions, modèles, polices et images ouvrent la fenêtre « Passer à Pro »
  avec la formule minimale nécessaire. Les exports étant calculés dans le navigateur, ce contrôle est côté client ;
  les limites de projets et de stockage sont, elles, garanties par la base.
- **RGPD** : police Inter hébergée par l’application, aucun traceur, export de toutes les données et suppression du compte
  (`delete-account` : résiliation, fichiers, compte) depuis « Mon compte ».

## Stack

- Vite, React 19, TypeScript (strict), routeur minimal maison (API History)
- Supabase (Auth email + Google, Postgres avec RLS, Storage, fonctions Edge Deno) et Stripe (Checkout, portail client, webhooks)
- Zustand pour l'état, avec un historique annuler/rétablir fondé sur des instantanés immuables (immer)
- Tailwind CSS 3 : la charte est déclarée en variables CSS (`src/index.css`) et reprise dans `tailwind.config.js`
- Rendu de la scène en Canvas 2D
- Vitest pour les tests
- ffmpeg.wasm (MP4), WebCodecs + webm-muxer (WebM), lottie-web (aperçu Lottie), GSAP (aperçu hors ligne)

## Charte graphique

| Rôle | Couleur | Variable CSS | Classe Tailwind |
| --- | --- | --- | --- |
| Bleu principal (boutons, sélection, images clés actives) | `#1E5EFF` | `--am-primary` | `primary` |
| Bleu foncé (barre du haut, textes forts) | `#0A1F44` | `--am-navy` | `navy` |
| Bleu moyen (survols, liens) | `#3B82F6` | `--am-accent` | `accent` |
| Bleu clair (panneaux, pistes) | `#DBEAFE` | `--am-light` | `sky` |
| Bleu très clair (fond de l'application) | `#F0F6FF` | `--am-app-bg` | `canvas` |
| Blanc (scène, cartes, champs) | `#FFFFFF` | `--am-white` | `surface` |
| Gris bleuté (textes secondaires) | `#64748B` | `--am-muted` | `muted` |
| Bordures | `#E2E8F0` | `--am-border` | `line` |

Police Inter, coins arrondis de 8 px, ombres douces. Chaque couleur existe aussi en canaux RGB
(`--am-primary-rgb`…) pour que les opacités Tailwind fonctionnent (`bg-primary/20`).

## Arborescence

```
src/
├── engine/            Moteur d'animation, sans DOM, entièrement testé
├── render/            Rendu Canvas 2D, test de clic, ressources, polices personnalisées
├── store/             Store Zustand (historique, sélection, lecture) et persistance IndexedDB par compte
├── export/            Exports HTML/CSS, GSAP, Lottie, vidéo (MP4/WebM, filigrane, 4K), WAV
├── account/           Session et abonnement (auth.ts), projets et ressources en ligne (cloud.ts)
├── billing/           Formules (plans.ts) et blocages (gates.ts : « Passer à Pro », limite de projets)
├── pages/             Accueil, éditeur, connexion, compte, retour de paiement, pages légales
├── components/        Interface : éditeur, billing/ (fenêtre d'abonnement, cartes), marketing/ (site, démo animée)
├── templates/         Modèles de départ
├── lib/               Supabase, import de fichiers, téléchargements
├── hooks/             Lecture temps réel, raccourcis clavier
└── router.tsx         Routeur minimal
supabase/
├── migrations/        Schéma : profils, abonnements, projets, quotas, bucket, RLS
├── functions/         Fonctions Edge (Deno) : checkout, portail, webhook Stripe, suppression de compte
│   └── _shared/       plans.ts (formules) et billing.ts (logique des webhooks, testée)
├── tests/             Bouchons Supabase et vérifications SQL (npm run test:db)
└── config.toml
scripts/
├── stripe-setup.mjs   Produits, prix et portail Stripe (mode test par défaut)
└── test-db.mjs        Postgres temporaire + migration + vérifications
```

## Fonctionnalités

**Interface**
- Barre du haut : nom du projet modifiable, état de la sauvegarde, annuler/rétablir, lecture, boucle, temps, modèles, projets, export.
- Calques : ajout, renommage (double-clic), masquage, verrouillage, réordonnancement par glisser-déposer ou par flèches, groupes repliables, duplication, suppression, précomposition.
- Scène : formats 16:9, 9:16 et 1:1, zoom (molette + Ctrl, menu, ajuster), déplacement de la vue (Espace + glisser, bouton du milieu), repères (tiers, centre, zones de sécurité), magnétisme sur le centre et les bords, déplacement des calques à la souris, poignées d'échelle (Maj : proportionnel) et de rotation (Maj : pas de 15°). On peut aussi glisser des fichiers directement sur la scène.
- Propriétés : chaque propriété animable a son losange d'image clé. Les étiquettes se glissent pour faire varier la valeur.
- Timeline : règle cliquable, tête de lecture, barres de durée de vie (bords et corps déplaçables), losanges déplaçables image par image (Maj pour une sélection multiple), pistes de propriétés dépliables, piste audio avec forme d'onde, décalage et volume.

**Animation**
- Calques : rectangle, ellipse, étoile, polygone, ligne, texte, image, SVG importé (un calque « tracé » par forme), groupe, précomposition.
- Propriétés animables : position, échelle, rotation, opacité, flou, remplissage, contour (couleur et épaisseur), dimensions, rayon, branches, rayon intérieur, tracé SVG (morphing), tracé dessiné, taille et interlettrage du texte, révélation lettre par lettre, amplitude de vague.
- Courbes : linéaire, ease-in, ease-out, ease-in-out, cubic-bezier éditable à la souris, back, élastique, rebond, maintien.
- Préréglages : apparition, pop, glisser, chute, rotation, disparition, machine à écrire, vague de texte.
- Parentage avec conservation de la position à l'écran, masques animables (normaux ou inversés), précompositions imbriquées (sans boucle possible).

**Exports**
- HTML + CSS : page autonome, animation en `@keyframes` uniquement, sans JavaScript.
- GSAP : page HTML avec une timeline GSAP 3. Les courbes bézier passent par CustomEase, élastique et rebond utilisent les eases natives.
- Lottie JSON (Bodymovin 5.7) : formes, tracés animés, track mattes pour les masques, précompositions, images, texte, fond.
- Vidéo : MP4 H.264 + AAC via ffmpeg.wasm (cœur servi localement), WebM VP9 + Opus via WebCodecs (repli sur MediaRecorder), de 24 à 60 i/s, en 480p, 720p ou 1080p.
- Projet JSON réimportable.
- Chaque export de code a un aperçu en direct, un bouton Copier et un bouton Télécharger.

**Projets**
- Sauvegarde automatique (IndexedDB), liste des projets, import et export JSON.
- Modèles : Intro logo, Titre animé, Bannière web, Morphing, Story verticale, plus des projets vides dans les trois formats.

## Raccourcis

| Touche | Action |
| --- | --- |
| Espace | Lecture / pause |
| Suppr, Retour arrière | Supprimer les images clés sélectionnées, sinon les calques |
| Ctrl + Z / Ctrl + Maj + Z, Ctrl + Y | Annuler / rétablir |
| Ctrl + D | Dupliquer |
| Ctrl + G / Ctrl + Maj + G | Grouper / dégrouper |
| Flèches | Déplacer le calque de 1 px (Maj : 10 px), ou image par image sans sélection |
| , et . | Image précédente / suivante |
| Début / Fin | Aller au début / à la fin |
| K | Image clé de position |

## Fidélité des exports

Les exports CSS et GSAP partagent le même modèle (`export/model.ts`, `export/channels.ts`).
Chaque calque devient un élément enveloppé par les transformations de ses parents, ce qui
respecte l'ordre d'empilement du moteur. Une courbe exprimable en cubic-bezier est exportée
telle quelle ; sinon (élastique, rebond, propriétés désalignées), le segment est échantillonné
à la cadence de la composition. Le rendu du moteur, l'export CSS et l'export GSAP ont été
comparés image par image sur les modèles fournis.

Limites connues :
- Le morphing de tracé en CSS repose sur la propriété `d` (Chrome, Edge et Firefox, pas Safari). L'export GSAP n'a pas cette limite.
- Les masques ne sont pas exportés en HTML/CSS ni en GSAP. Lottie et la vidéo les prennent en charge.
- Lottie : le flou n'est pas exporté, la taille de texte animée est figée, fondu et vague sont rendus comme une révélation lettre par lettre, et l'opacité d'un groupe n'est pas transmise à ses enfants.
- Le premier export MP4 charge ffmpeg.wasm (environ 30 Mo).
