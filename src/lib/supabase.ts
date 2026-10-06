import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Client Supabase (clé « anon » publique : les droits sont protégés par la RLS).
 * Sans configuration, l'application fonctionne en « mode local » : pas de comptes,
 * projets enregistrés uniquement dans le navigateur.
 */
export const supabase: SupabaseClient | null =
  url && anonKey && !url.includes('votre-projet') ? createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;

export const cloudEnabled = supabase !== null;
