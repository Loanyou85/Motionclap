/**
 * Formules d'abonnement : source unique partagée par l'application (Vite)
 * et les fonctions Edge (Deno). Aucune dépendance, aucun accès réseau.
 * Les limites côté base (projets, stockage) sont reprises dans la migration SQL
 * et vérifiées par `npm run test:db`.
 */

export type PlanId = 'free' | 'pro' | 'studio';
export type PaidPlanId = Exclude<PlanId, 'free'>;
export type VideoFormatId = 'webm' | 'mp4';

export interface Entitlements {
  /** Nombre maximal de projets (null = illimité). */
  maxProjects: number | null;
  /** Stockage en ligne (projets + ressources), en octets. */
  storageBytes: number;
  videoFormats: VideoFormatId[];
  /** Petit côté maximal de la vidéo exportée (720 = HD, 1080 = Full HD, 2160 = 4K). */
  maxVideoHeight: number;
  /** Filigrane incrusté dans les vidéos exportées. */
  watermark: boolean;
  /** Exports web : HTML/CSS, GSAP et Lottie. */
  webExports: boolean;
  allTemplates: boolean;
  customFonts: boolean;
  customImages: boolean;
  prioritySupport: boolean;
}

export interface PlanDef {
  id: PlanId;
  name: string;
  /** Prix mensuel TTC en centimes d'euro. */
  priceCents: number;
  trialDays: number;
  tagline: string;
  features: string[];
  entitlements: Entitlements;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const PLANS: Record<PlanId, PlanDef> = {
  free: {
    id: 'free',
    name: 'Gratuit',
    priceCents: 0,
    trialDays: 0,
    tagline: 'Pour découvrir le motion design.',
    features: ['3 projets', 'Export vidéo WebM 720p avec filigrane', 'Modèles essentiels', '100 Mo de stockage'],
    entitlements: {
      maxProjects: 3,
      storageBytes: 100 * MB,
      videoFormats: ['webm'],
      maxVideoHeight: 720,
      watermark: true,
      webExports: false,
      allTemplates: false,
      customFonts: false,
      customImages: false,
      prioritySupport: false,
    },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceCents: 999,
    trialDays: 7,
    tagline: 'Pour les créateurs et les intégrateurs web.',
    features: [
      'Projets illimités',
      'Export MP4 et WebM 1080p sans filigrane',
      'Exports HTML/CSS, GSAP et Lottie',
      'Tous les modèles',
      '1 Go de stockage',
    ],
    entitlements: {
      maxProjects: null,
      storageBytes: 1 * GB,
      videoFormats: ['mp4', 'webm'],
      maxVideoHeight: 1080,
      watermark: false,
      webExports: true,
      allTemplates: true,
      customFonts: false,
      customImages: false,
      prioritySupport: false,
    },
  },
  studio: {
    id: 'studio',
    name: 'Studio',
    priceCents: 2499,
    trialDays: 0,
    tagline: 'Pour les équipes et les productions exigeantes.',
    features: ['Tout Pro', 'Export vidéo 4K', 'Polices et images personnalisées', '5 Go de stockage', 'Support prioritaire'],
    entitlements: {
      maxProjects: null,
      storageBytes: 5 * GB,
      videoFormats: ['mp4', 'webm'],
      maxVideoHeight: 2160,
      watermark: false,
      webExports: true,
      allTemplates: true,
      customFonts: true,
      customImages: true,
      prioritySupport: true,
    },
  },
};

export const PLAN_ORDER: PlanId[] = ['free', 'pro', 'studio'];

/** Modèles accessibles avec la formule gratuite. */
export const FREE_TEMPLATE_IDS = ['logo', 'title'];

/**
 * Statuts Stripe qui donnent accès à la formule payée.
 * « past_due » : Stripe retente le paiement, l'accès est maintenu pendant les relances ;
 * l'abonnement passe ensuite à « unpaid » ou « canceled » et l'accès est coupé.
 */
export const ACCESS_STATUSES = ['active', 'trialing', 'past_due'] as const;

export interface SubscriptionState {
  plan: PlanId;
  status: string;
  current_period_end?: string | null;
}

/** Formule effective d'un utilisateur à partir de sa ligne d'abonnement. */
export function effectivePlan(sub: SubscriptionState | null | undefined): PlanId {
  if (!sub || sub.plan === 'free') return 'free';
  if (!(ACCESS_STATUSES as readonly string[]).includes(sub.status)) return 'free';
  return sub.plan;
}

export function entitlementsFor(plan: PlanId): Entitlements {
  return PLANS[plan].entitlements;
}

/** Formule minimale qui débloque une fonction donnée. */
export function minimumPlanFor(check: (e: Entitlements) => boolean): PlanId | null {
  return PLAN_ORDER.find((p) => check(PLANS[p].entitlements)) ?? null;
}

export function formatPrice(cents: number): string {
  if (cents === 0) return '0 €';
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`;
}

export function isPaidPlan(p: string): p is PaidPlanId {
  return p === 'pro' || p === 'studio';
}
