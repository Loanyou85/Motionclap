/**
 * Cœur de la facturation, indépendant de Stripe et de Supabase (testé avec Vitest).
 * Les fonctions Edge y branchent le SDK Stripe et le client Supabase « service role ».
 */
import { ACCESS_STATUSES, type PaidPlanId, type PlanId } from './plans.ts';

/* Sous-ensemble des objets Stripe utilisés (compatibles avec les versions d'API récentes). */
export interface StripeSubscriptionLike {
  id: string;
  customer: string | { id: string };
  status: string;
  cancel_at_period_end: boolean;
  trial_end: number | null;
  /** Avant l'API 2025-03-31 : au niveau de l'abonnement ; ensuite : sur chaque élément. */
  current_period_end?: number | null;
  metadata?: Record<string, string> | null;
  items: { data: Array<{ price: { id: string }; current_period_end?: number | null }> };
}

export interface StripeEventLike {
  id: string;
  type: string;
  // deno-lint-ignore no-explicit-any
  data: { object: any };
}

export interface PriceConfig {
  pro: string;
  studio: string;
}

export interface SubscriptionRow {
  user_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string | null;
  plan: PlanId;
  status: string;
  price_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  trial_end: string | null;
  trial_used: boolean;
}

export const idOf = (v: string | { id: string } | null | undefined): string | null => (v == null ? null : typeof v === 'string' ? v : v.id);

const iso = (unix: number | null | undefined) => (unix ? new Date(unix * 1000).toISOString() : null);

export function planForPrice(priceId: string | null | undefined, prices: PriceConfig): PaidPlanId | null {
  if (!priceId) return null;
  if (priceId === prices.pro) return 'pro';
  if (priceId === prices.studio) return 'studio';
  return null;
}

export function priceForPlan(plan: PaidPlanId, prices: PriceConfig): string {
  return plan === 'pro' ? prices.pro : prices.studio;
}

export const grantsAccess = (status: string) => (ACCESS_STATUSES as readonly string[]).includes(status);

/** Convertit un abonnement Stripe en ligne de la table `subscriptions`. */
export function subscriptionToRow(
  userId: string,
  sub: StripeSubscriptionLike,
  prices: PriceConfig,
  existing: Pick<SubscriptionRow, 'trial_used'> | null = null,
): SubscriptionRow {
  const item = sub.items.data[0];
  const priceId = item?.price.id ?? null;
  return {
    user_id: userId,
    stripe_customer_id: idOf(sub.customer)!,
    stripe_subscription_id: sub.id,
    // Prix inconnu (ancienne formule supprimée…) : aucun droit payant.
    plan: planForPrice(priceId, prices) ?? 'free',
    status: sub.status,
    price_id: priceId,
    current_period_end: iso(sub.current_period_end ?? item?.current_period_end ?? null),
    cancel_at_period_end: sub.cancel_at_period_end,
    trial_end: iso(sub.trial_end),
    trial_used: Boolean(existing?.trial_used) || sub.trial_end != null,
  };
}

/**
 * Faut-il appliquer cet abonnement à la ligne existante ?
 * Évite qu'un événement tardif d'un ancien abonnement résilié écrase un abonnement actif.
 */
export function shouldApply(existing: Pick<SubscriptionRow, 'stripe_subscription_id' | 'status'> | null, incoming: StripeSubscriptionLike): boolean {
  if (!existing?.stripe_subscription_id || existing.stripe_subscription_id === incoming.id) return true;
  if (grantsAccess(incoming.status)) return true;
  return !grantsAccess(existing.status);
}

/** L'essai gratuit n'est offert qu'une fois, et uniquement sur la formule qui en propose un. */
export function trialDaysFor(plan: PaidPlanId, trialDays: number, trialAlreadyUsed: boolean): number | undefined {
  if (plan !== 'pro' || trialAlreadyUsed || trialDays <= 0) return undefined;
  return trialDays;
}

export interface WebhookDeps {
  prices: PriceConfig;
  retrieveSubscription(id: string): Promise<StripeSubscriptionLike>;
  findUserIdByCustomer(customerId: string): Promise<string | null>;
  getSubscriptionRow(userId: string): Promise<SubscriptionRow | null>;
  upsertSubscription(row: SubscriptionRow): Promise<void>;
  linkCustomer(userId: string, customerId: string): Promise<void>;
  isEventProcessed(eventId: string): Promise<boolean>;
  markEventProcessed(eventId: string, type: string): Promise<void>;
}

export interface WebhookResult {
  handled: boolean;
  detail: string;
}

/** Identifiant d'abonnement porté par une facture (ancien et nouveau format d'API). */
// deno-lint-ignore no-explicit-any
export function invoiceSubscriptionId(invoice: any): string | null {
  return idOf(invoice?.subscription) ?? idOf(invoice?.parent?.subscription_details?.subscription) ?? null;
}

/**
 * Traite un événement Stripe (signature déjà vérifiée).
 * L'abonnement est toujours relu depuis Stripe : l'ordre d'arrivée des événements n'a pas d'importance.
 */
export async function handleStripeEvent(event: StripeEventLike, deps: WebhookDeps): Promise<WebhookResult> {
  if (await deps.isEventProcessed(event.id)) return { handled: false, detail: 'déjà traité' };

  const sync = async (subscriptionId: string, userHint: string | null): Promise<WebhookResult> => {
    const sub = await deps.retrieveSubscription(subscriptionId);
    const customerId = idOf(sub.customer)!;
    const userId = sub.metadata?.user_id || userHint || (await deps.findUserIdByCustomer(customerId));
    if (!userId) return { handled: false, detail: `utilisateur introuvable pour ${customerId}` };
    const existing = await deps.getSubscriptionRow(userId);
    if (!shouldApply(existing, sub)) return { handled: false, detail: `événement ancien ignoré (${sub.id})` };
    const row = subscriptionToRow(userId, sub, deps.prices, existing);
    await deps.upsertSubscription(row);
    return { handled: true, detail: `${row.plan} · ${row.status}` };
  };

  const obj = event.data.object;
  let result: WebhookResult;
  switch (event.type) {
    case 'checkout.session.completed': {
      if (obj.mode !== 'subscription') {
        result = { handled: false, detail: 'session hors abonnement' };
        break;
      }
      const userId: string | null = obj.client_reference_id ?? obj.metadata?.user_id ?? null;
      const customerId = idOf(obj.customer);
      if (userId && customerId) await deps.linkCustomer(userId, customerId);
      const subId = idOf(obj.subscription);
      result = subId ? await sync(subId, userId) : { handled: false, detail: 'pas d’abonnement' };
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
      result = await sync(obj.id, obj.metadata?.user_id ?? null);
      break;
    case 'invoice.paid':
    case 'invoice.payment_succeeded':
    case 'invoice.payment_failed': {
      const subId = invoiceSubscriptionId(obj);
      result = subId ? await sync(subId, null) : { handled: false, detail: 'facture hors abonnement' };
      break;
    }
    default:
      result = { handled: false, detail: `événement ignoré : ${event.type}` };
  }
  await deps.markEventProcessed(event.id, event.type);
  return result;
}
