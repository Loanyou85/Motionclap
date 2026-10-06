/** Utilitaires communs des fonctions Edge (Deno). */
import Stripe from 'npm:stripe@23.0.0';
import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2.117.2';
import type { PriceConfig } from './billing.ts';

export const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('SITE_URL') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

export function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new HttpError(500, `Variable d’environnement manquante : ${name}`);
  return v;
}

/** Client Stripe. Les clés « live » sont refusées tant que STRIPE_ALLOW_LIVE n'est pas à true. */
export function stripeClient(): Stripe {
  const key = env('STRIPE_SECRET_KEY');
  if (key.startsWith('sk_live_') && Deno.env.get('STRIPE_ALLOW_LIVE') !== 'true') {
    throw new HttpError(500, 'Clé Stripe live refusée : utilisez une clé de test (sk_test_…) en développement.');
  }
  return new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
}

export function prices(): PriceConfig {
  return { pro: env('STRIPE_PRICE_PRO'), studio: env('STRIPE_PRICE_STUDIO') };
}

/** Client « service role » (contourne la RLS) : réservé au code serveur. */
export function adminClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
}

/** Utilisateur authentifié à partir du jeton envoyé par l'application. */
export async function requireUser(req: Request): Promise<User> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Connexion requise');
  const { data, error } = await adminClient().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Session invalide ou expirée');
  return data.user;
}

export function siteUrl(): string {
  return env('SITE_URL').replace(/\/$/, '');
}

/** Enveloppe commune : CORS, méthode, gestion des erreurs. */
export function handler(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);
    try {
      return await fn(req);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      console.error(e);
      return json({ error: e instanceof Error ? e.message : String(e) }, status);
    }
  };
}
