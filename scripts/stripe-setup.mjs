#!/usr/bin/env node
/**
 * Crée (ou retrouve) les produits, prix et la configuration du portail client Stripe.
 * Utilise la clé de supabase/functions/.env. Refuse les clés live sauf avec --live.
 *
 *   node scripts/stripe-setup.mjs
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Stripe from 'stripe';
import { PLANS } from '../supabase/functions/_shared/plans.ts';

const envFile = resolve(import.meta.dirname, '../supabase/functions/.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('STRIPE_SECRET_KEY manquante (supabase/functions/.env).');
  process.exit(1);
}
if (key.startsWith('sk_live_') && !process.argv.includes('--live')) {
  console.error('Clé live détectée : utilisez une clé de test (sk_test_…), ou ajoutez --live en connaissance de cause.');
  process.exit(1);
}
const siteUrl = (process.env.SITE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const stripe = new Stripe(key);

async function ensurePrice(plan) {
  const lookupKey = `atelier_${plan.id}_mensuel`;
  const found = await stripe.prices.list({ lookup_keys: [lookupKey], expand: ['data.product'] });
  if (found.data[0]) return found.data[0];
  const product = await stripe.products.create({
    name: `Atelier Motion ${plan.name}`,
    description: plan.tagline,
    metadata: { plan: plan.id },
  });
  return stripe.prices.create({
    product: product.id,
    currency: 'eur',
    unit_amount: plan.priceCents,
    recurring: { interval: 'month' },
    tax_behavior: 'inclusive',
    lookup_key: lookupKey,
    metadata: { plan: plan.id },
  });
}

const pro = await ensurePrice(PLANS.pro);
const studio = await ensurePrice(PLANS.studio);
const productOf = (p) => (typeof p.product === 'string' ? p.product : p.product.id);

const portal = await stripe.billingPortal.configurations.create({
  business_profile: {
    headline: 'Atelier Motion — gérer mon abonnement',
    privacy_policy_url: `${siteUrl}/confidentialite`,
    terms_of_service_url: `${siteUrl}/cgv`,
  },
  default_return_url: `${siteUrl}/compte`,
  features: {
    customer_update: { enabled: true, allowed_updates: ['email', 'address', 'tax_id'] },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true, mode: 'at_period_end', cancellation_reason: { enabled: true, options: ['too_expensive', 'missing_features', 'unused', 'other'] } },
    subscription_update: {
      enabled: true,
      default_allowed_updates: ['price'],
      proration_behavior: 'create_prorations',
      products: [
        { product: productOf(pro), prices: [pro.id] },
        { product: productOf(studio), prices: [studio.id] },
      ],
    },
  },
});

console.log(`Mode : ${key.startsWith('sk_test_') ? 'TEST' : 'LIVE'}
Ajoutez ces lignes à supabase/functions/.env puis lancez « supabase secrets set --env-file supabase/functions/.env » :

STRIPE_PRICE_PRO=${pro.id}
STRIPE_PRICE_STUDIO=${studio.id}
STRIPE_PORTAL_CONFIGURATION=${portal.id}

Webhook à déclarer (Dashboard Stripe › Développeurs › Webhooks, ou « stripe listen » en local) :
  URL : https://<projet>.supabase.co/functions/v1/stripe-webhook
  Événements : checkout.session.completed, customer.subscription.created, customer.subscription.updated,
               customer.subscription.deleted, invoice.paid, invoice.payment_failed`);
