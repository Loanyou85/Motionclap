/**
 * Ouvre le portail client Stripe : changer de formule, mettre à jour la carte,
 * consulter les factures ou résilier.
 */
import { adminClient, handler, HttpError, json, requireUser, siteUrl, stripeClient } from '../_shared/http.ts';

Deno.serve(
  handler(async (req) => {
    const user = await requireUser(req);
    const { data: row, error } = await adminClient().from('subscriptions').select('stripe_customer_id').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    if (!row?.stripe_customer_id) throw new HttpError(400, 'Aucun abonnement à gérer pour ce compte.');
    const configuration = Deno.env.get('STRIPE_PORTAL_CONFIGURATION') || undefined;
    const session = await stripeClient().billingPortal.sessions.create({
      customer: row.stripe_customer_id,
      return_url: `${siteUrl()}/compte`,
      locale: 'fr',
      ...(configuration ? { configuration } : {}),
    });
    return json({ url: session.url });
  }),
);
