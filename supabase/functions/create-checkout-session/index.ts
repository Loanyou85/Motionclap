/**
 * Crée une session Stripe Checkout pour s'abonner à Pro ou Studio.
 * Si l'utilisateur a déjà un abonnement actif, renvoie vers le portail client (changement de formule).
 */
import { grantsAccess, priceForPlan, trialDaysFor } from '../_shared/billing.ts';
import { adminClient, handler, HttpError, json, prices, requireUser, siteUrl, stripeClient } from '../_shared/http.ts';
import { isPaidPlan, PLANS } from '../_shared/plans.ts';

Deno.serve(
  handler(async (req) => {
    const user = await requireUser(req);
    const { plan, acceptTerms } = await req.json().catch(() => ({}));
    if (!isPaidPlan(plan)) throw new HttpError(400, 'Formule inconnue');
    if (acceptTerms !== true) throw new HttpError(400, 'Vous devez accepter les CGV pour vous abonner.');

    const stripe = stripeClient();
    const admin = adminClient();
    const { data: row, error } = await admin.from('subscriptions').select('*').eq('user_id', user.id).maybeSingle();
    if (error) throw error;

    // Déjà abonné : le changement de formule passe par le portail (prorata géré par Stripe).
    if (row?.stripe_customer_id && row.stripe_subscription_id && grantsAccess(row.status)) {
      const portal = await stripe.billingPortal.sessions.create({ customer: row.stripe_customer_id, return_url: `${siteUrl()}/compte` });
      return json({ url: portal.url, portal: true });
    }

    let customerId: string | null = row?.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, metadata: { user_id: user.id } });
      customerId = customer.id;
      const { error: upsertError } = await admin
        .from('subscriptions')
        .upsert({ user_id: user.id, stripe_customer_id: customerId }, { onConflict: 'user_id' });
      if (upsertError) throw upsertError;
    }

    const trialDays = trialDaysFor(plan, PLANS[plan].trialDays, row?.trial_used ?? false);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: priceForPlan(plan, prices()), quantity: 1 }],
      subscription_data: {
        metadata: { user_id: user.id, plan },
        ...(trialDays
          ? { trial_period_days: trialDays, trial_settings: { end_behavior: { missing_payment_method: 'cancel' } } }
          : {}),
      },
      metadata: { user_id: user.id, plan, terms_accepted_at: new Date().toISOString() },
      payment_method_collection: 'always',
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      locale: 'fr',
      success_url: `${siteUrl()}/paiement/succes?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl()}/compte?paiement=annule`,
    });
    return json({ url: session.url, trialDays: trialDays ?? 0 });
  }),
);
