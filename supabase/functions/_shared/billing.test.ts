import { describe, expect, it } from 'vitest';
import {
  handleStripeEvent,
  invoiceSubscriptionId,
  planForPrice,
  shouldApply,
  subscriptionToRow,
  trialDaysFor,
  type StripeSubscriptionLike,
  type SubscriptionRow,
  type WebhookDeps,
} from './billing.ts';
import { effectivePlan, entitlementsFor, formatPrice, minimumPlanFor, PLANS } from './plans.ts';

const prices = { pro: 'price_pro', studio: 'price_studio' };
const sub = (over: Partial<StripeSubscriptionLike> = {}): StripeSubscriptionLike => ({
  id: 'sub_1',
  customer: 'cus_1',
  status: 'active',
  cancel_at_period_end: false,
  trial_end: null,
  metadata: { user_id: 'user_1' },
  items: { data: [{ price: { id: 'price_pro' }, current_period_end: 1_800_000_000 }] },
  ...over,
});

/** Base et Stripe simulés en mémoire. */
function fakeDeps(subs: Record<string, StripeSubscriptionLike>) {
  const rows = new Map<string, SubscriptionRow>();
  const customers = new Map<string, string>();
  const events = new Set<string>();
  const deps: WebhookDeps = {
    prices,
    retrieveSubscription: async (id) => {
      if (!subs[id]) throw new Error('inconnu');
      return subs[id];
    },
    findUserIdByCustomer: async (c) => customers.get(c) ?? null,
    getSubscriptionRow: async (u) => rows.get(u) ?? null,
    upsertSubscription: async (r) => void rows.set(r.user_id, r),
    linkCustomer: async (u, c) => void customers.set(c, u),
    isEventProcessed: async (id) => events.has(id),
    markEventProcessed: async (id) => void events.add(id),
  };
  return { deps, rows, customers, events };
}

describe('formules', () => {
  it('définit les prix et limites demandés', () => {
    expect(PLANS.pro.priceCents).toBe(999);
    expect(PLANS.studio.priceCents).toBe(2499);
    expect(PLANS.pro.trialDays).toBe(7);
    expect(entitlementsFor('free')).toMatchObject({ maxProjects: 3, videoFormats: ['webm'], maxVideoHeight: 720, watermark: true, webExports: false });
    expect(entitlementsFor('pro')).toMatchObject({ maxProjects: null, maxVideoHeight: 1080, watermark: false, webExports: true, allTemplates: true });
    expect(entitlementsFor('studio')).toMatchObject({ maxVideoHeight: 2160, customFonts: true, customImages: true, storageBytes: 5 * 1024 ** 3 });
  });

  it('calcule la formule effective selon le statut Stripe', () => {
    expect(effectivePlan(null)).toBe('free');
    expect(effectivePlan({ plan: 'pro', status: 'trialing' })).toBe('pro');
    expect(effectivePlan({ plan: 'studio', status: 'past_due' })).toBe('studio');
    expect(effectivePlan({ plan: 'pro', status: 'canceled' })).toBe('free');
    expect(effectivePlan({ plan: 'pro', status: 'unpaid' })).toBe('free');
    expect(effectivePlan({ plan: 'pro', status: 'incomplete' })).toBe('free');
  });

  it('trouve la formule minimale pour une fonction', () => {
    expect(minimumPlanFor((e) => e.webExports)).toBe('pro');
    expect(minimumPlanFor((e) => e.customFonts)).toBe('studio');
    expect(minimumPlanFor((e) => e.maxVideoHeight >= 2160)).toBe('studio');
  });

  it('formate les prix en euros', () => {
    expect(formatPrice(999)).toBe('9,99 €');
    expect(formatPrice(2499)).toBe('24,99 €');
  });
});

describe('conversion des abonnements Stripe', () => {
  it('associe les prix aux formules', () => {
    expect(planForPrice('price_pro', prices)).toBe('pro');
    expect(planForPrice('price_studio', prices)).toBe('studio');
    expect(planForPrice('price_autre', prices)).toBeNull();
  });

  it('lit la fin de période au niveau des éléments (API récente) ou de l’abonnement', () => {
    const r1 = subscriptionToRow('u', sub(), prices);
    expect(r1.current_period_end).toBe(new Date(1_800_000_000_000).toISOString());
    const r2 = subscriptionToRow('u', sub({ current_period_end: 1_700_000_000, items: { data: [{ price: { id: 'price_studio' } }] } }), prices);
    expect(r2.plan).toBe('studio');
    expect(r2.current_period_end).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it('mémorise l’utilisation de l’essai', () => {
    expect(subscriptionToRow('u', sub({ status: 'trialing', trial_end: 1_800_000_000 }), prices).trial_used).toBe(true);
    expect(subscriptionToRow('u', sub(), prices, { trial_used: true }).trial_used).toBe(true);
    expect(subscriptionToRow('u', sub(), prices).trial_used).toBe(false);
  });

  it('n’offre l’essai qu’une fois, et seulement sur Pro', () => {
    expect(trialDaysFor('pro', 7, false)).toBe(7);
    expect(trialDaysFor('pro', 7, true)).toBeUndefined();
    expect(trialDaysFor('studio', 7, false)).toBeUndefined();
  });

  it('ignore un événement tardif d’un ancien abonnement', () => {
    const active = { stripe_subscription_id: 'sub_new', status: 'active' };
    expect(shouldApply(active, sub({ id: 'sub_old', status: 'canceled' }))).toBe(false);
    expect(shouldApply(active, sub({ id: 'sub_new', status: 'canceled' }))).toBe(true);
    expect(shouldApply({ stripe_subscription_id: 'sub_old', status: 'canceled' }, sub({ id: 'sub_new' }))).toBe(true);
  });

  it('retrouve l’abonnement d’une facture (ancien et nouveau format)', () => {
    expect(invoiceSubscriptionId({ subscription: 'sub_a' })).toBe('sub_a');
    expect(invoiceSubscriptionId({ parent: { subscription_details: { subscription: 'sub_b' } } })).toBe('sub_b');
    expect(invoiceSubscriptionId({})).toBeNull();
  });
});

describe('webhooks Stripe', () => {
  it('active Pro après le paiement (Checkout terminé)', async () => {
    const { deps, rows, customers } = fakeDeps({ sub_1: sub({ status: 'trialing', trial_end: 1_800_000_000, metadata: {} }) });
    const r = await handleStripeEvent(
      { id: 'evt_1', type: 'checkout.session.completed', data: { object: { mode: 'subscription', client_reference_id: 'user_1', customer: 'cus_1', subscription: 'sub_1' } } },
      deps,
    );
    expect(r.handled).toBe(true);
    expect(customers.get('cus_1')).toBe('user_1');
    expect(rows.get('user_1')).toMatchObject({ plan: 'pro', status: 'trialing', trial_used: true, stripe_customer_id: 'cus_1' });
  });

  it('renouvelle puis coupe l’accès', async () => {
    const subs = { sub_1: sub() };
    const { deps, rows } = fakeDeps(subs);
    await handleStripeEvent({ id: 'evt_a', type: 'invoice.paid', data: { object: { subscription: 'sub_1' } } }, deps);
    expect(effectivePlan(rows.get('user_1')!)).toBe('pro');
    subs.sub_1 = sub({ status: 'past_due' });
    await handleStripeEvent({ id: 'evt_b', type: 'invoice.payment_failed', data: { object: { subscription: 'sub_1' } } }, deps);
    expect(effectivePlan(rows.get('user_1')!)).toBe('pro');
    subs.sub_1 = sub({ status: 'canceled' });
    await handleStripeEvent({ id: 'evt_c', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', metadata: {} } } }, deps);
    expect(rows.get('user_1')!.status).toBe('canceled');
    expect(effectivePlan(rows.get('user_1')!)).toBe('free');
  });

  it('passe de Pro à Studio via le portail client', async () => {
    const subs = { sub_1: sub() };
    const { deps, rows } = fakeDeps(subs);
    await handleStripeEvent({ id: 'evt_1', type: 'customer.subscription.created', data: { object: { id: 'sub_1' } } }, deps);
    subs.sub_1 = sub({ items: { data: [{ price: { id: 'price_studio' }, current_period_end: 1_800_000_000 }] } });
    await handleStripeEvent({ id: 'evt_2', type: 'customer.subscription.updated', data: { object: { id: 'sub_1' } } }, deps);
    expect(rows.get('user_1')!.plan).toBe('studio');
  });

  it('est idempotent', async () => {
    const { deps, rows } = fakeDeps({ sub_1: sub() });
    const e = { id: 'evt_x', type: 'customer.subscription.updated', data: { object: { id: 'sub_1' } } };
    expect((await handleStripeEvent(e, deps)).handled).toBe(true);
    rows.clear();
    expect((await handleStripeEvent(e, deps)).detail).toBe('déjà traité');
    expect(rows.size).toBe(0);
  });

  it('retrouve l’utilisateur par son identifiant client', async () => {
    const { deps, rows, customers } = fakeDeps({ sub_1: sub({ metadata: {} }) });
    customers.set('cus_1', 'user_9');
    await handleStripeEvent({ id: 'e', type: 'customer.subscription.updated', data: { object: { id: 'sub_1' } } }, deps);
    expect(rows.get('user_9')?.plan).toBe('pro');
  });

  it('ignore les événements non gérés', async () => {
    const { deps } = fakeDeps({});
    const r = await handleStripeEvent({ id: 'e', type: 'charge.refunded', data: { object: {} } }, deps);
    expect(r.handled).toBe(false);
  });
});
