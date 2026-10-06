# Atelier Motion

Application web de motion design pour animer des sites web et produire des vidéos :
calques vectoriels, texte, images et SVG, images clés avec courbes éditables,
groupes, parentage, masques, précompositions, piste audio, et exports
**HTML/CSS**, **GSAP**, **Lottie**, **MP4** et **WebM**. L'interface est entièrement en français.

## Démarrer

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # tests Vitest (moteur, structure, store, exports)
npm run build      # vérification TypeScript + build de production
```

Au premier lancement, le modèle « Intro logo » est ouvert. Ensuite, le dernier projet
est rouvert automatiquement : chaque modification est enregistrée dans le navigateur (IndexedDB).

## Stack

- Vite, React 19, TypeScript (strict)
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
│   ├── types.ts         Modèle de données (projet, compositions, calques, images clés)
│   ├── props.ts         Registre des propriétés animables et des propriétés par type de calque
│   ├── easing.ts        Courbes : linéaire, ease, cubic-bezier, back, élastique, rebond, maintien
│   ├── interpolate.ts   Interpolation des nombres, couleurs et tracés
│   ├── path.ts          Analyse SVG (y compris les arcs), normalisation et morphing de tracés
│   ├── color.ts         Couleurs (hexadécimal, rgba, interpolation prémultipliée)
│   ├── evaluate.ts      Évaluation à l'instant t, matrices monde, parentage
│   ├── matrix.ts        Matrices affines 2D
│   ├── keyframes.ts     Création, déplacement et suppression des images clés
│   ├── structure.ts     Ordre, groupes, parentage, duplication, précompositions
│   ├── text.ts          Animation lettre par lettre (machine à écrire, fondu, vague)
│   ├── presets.ts       Préréglages en un clic
│   ├── shapes.ts        Étoiles, polygones, rectangles arrondis
│   ├── audio.ts         Crêtes de forme d'onde
│   └── defaults.ts      Formats (16:9, 9:16, 1:1) et fabriques
├── render/            Rendu Canvas 2D, test de clic, cache des ressources
├── store/             Store Zustand (historique, sélection, lecture) et persistance IndexedDB
├── export/            Exports HTML/CSS, GSAP, Lottie, vidéo (MP4/WebM), WAV
├── templates/         Modèles de départ
├── lib/               Import de fichiers (image, SVG, audio), téléchargements
├── hooks/             Lecture temps réel synchronisée au son, raccourcis clavier
└── components/        Interface React
    ├── TopBar.tsx       Nom du projet, annuler/rétablir, lecture, export
    ├── layers/          Panneau des calques
    ├── stage/           Scène et barre d'outils (formats, zoom, repères, magnétisme)
    ├── properties/      Propriétés, préréglages, liens (parent, masque), durée de vie
    ├── timeline/        Règle, tête de lecture, pistes, images clés, piste audio
    ├── curve/           Éditeur de courbe visuel
    ├── export/          Fenêtre d'export avec aperçus et bouton Copier
    ├── projects/        Projets, modèles, raccourcis
    └── ui/              Icônes, champs, menus, fenêtres modales
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
