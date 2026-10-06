/**
 * Webhook Stripe : active, renouvelle ou coupe l'accès selon les événements d'abonnement.
 * Déployée sans vérification JWT (Stripe signe ses requêtes, la signature est vérifiée ici).
 */
import Stripe from 'npm:stripe@23.0.0';
import { handleStripeEvent, type StripeSubscriptionLike, type SubscriptionRow, type WebhookDeps } from '../_shared/billing.ts';
import { adminClient, env, json, prices, stripeClient } from '../_shared/http.ts';

const cryptoProvider = Stripe.createSubtleCryptoProvider();

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);
  const signature = req.headers.get('Stripe-Signature');
  if (!signature) return json({ error: 'Signature absente' }, 400);

  const stripe = stripeClient();
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, env('STRIPE_WEBHOOK_SECRET'), undefined, cryptoProvider);
  } catch (e) {
    console.error('Signature invalide', e);
    return json({ error: 'Signature invalide' }, 400);
  }

  const db = adminClient();
  const deps: WebhookDeps = {
    prices: prices(),
    retrieveSubscription: async (id) => (await stripe.subscriptions.retrieve(id)) as unknown as StripeSubscriptionLike,
    findUserIdByCustomer: async (customerId) => {
      const { data } = await db.from('subscriptions').select('user_id').eq('stripe_customer_id', customerId).maybeSingle();
      return data?.user_id ?? null;
    },
    getSubscriptionRow: async (userId) => {
      const { data, error } = await db.from('subscriptions').select('*').eq('user_id', userId).maybeSingle();
      if (error) throw error;
      return (data as SubscriptionRow | null) ?? null;
    },
    upsertSubscription: async (row) => {
      const { error } = await db.from('subscriptions').upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (error) throw error;
    },
    linkCustomer: async (userId, customerId) => {
      const { error } = await db.from('subscriptions').upsert({ user_id: userId, stripe_customer_id: customerId }, { onConflict: 'user_id' });
      if (error) throw error;
    },
    isEventProcessed: async (id) => {
      const { data } = await db.from('stripe_events').select('id').eq('id', id).maybeSingle();
      return !!data;
    },
    markEventProcessed: async (id, type) => {
      const { error } = await db.from('stripe_events').upsert({ id, type }, { onConflict: 'id' });
      if (error) throw error;
    },
  };

  try {
    const result = await handleStripeEvent(event, deps);
    console.log(`${event.type} (${event.id}) : ${result.detail}`);
    return json({ received: true, ...result });
  } catch (e) {
    // Erreur 500 : Stripe renverra l'événement plus tard.
    console.error(`Échec du traitement de ${event.id}`, e);
    return json({ error: 'Traitement impossible' }, 500);
  }
});
