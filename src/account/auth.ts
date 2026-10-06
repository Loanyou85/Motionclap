import type { Session, User } from '@supabase/supabase-js';
import { create } from 'zustand';
import { effectivePlan, entitlementsFor, PLANS, type Entitlements, type PaidPlanId, type PlanId } from '../billing/plans';
import { cloudEnabled, supabase } from '../lib/supabase';

export interface SubscriptionInfo {
  plan: PlanId;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  trial_end: string | null;
  trial_used: boolean;
  stripe_customer_id: string | null;
}

export interface Usage {
  plan: PlanId;
  projects: number;
  max_projects: number | null;
  storage_used: number;
  storage_quota: number;
}

interface AuthState {
  ready: boolean;
  session: Session | null;
  user: User | null;
  subscription: SubscriptionInfo | null;
  usage: Usage | null;
  /** Formule simulée en développement (mode local ou tests). */
  devPlan: PlanId | null;
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  setDevPlan: (p: PlanId | null) => void;
}

const DEV_PLAN_KEY = 'atelier-motion:formule-dev';

function readDevPlan(): PlanId | null {
  if (!import.meta.env.DEV) return null;
  const fromEnv = import.meta.env.VITE_DEV_PLAN as string | undefined;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(DEV_PLAN_KEY);
  } catch {
    /* stockage indisponible */
  }
  const v = stored ?? fromEnv ?? null;
  return v && v in PLANS ? (v as PlanId) : null;
}

export const useAuth = create<AuthState>()((set, get) => ({
  ready: !cloudEnabled,
  session: null,
  user: null,
  subscription: null,
  usage: null,
  devPlan: readDevPlan(),

  init: async () => {
    if (!supabase) return set({ ready: true });
    const { data } = await supabase.auth.getSession();
    set({ session: data.session, user: data.session?.user ?? null });
    if (data.session) await get().refresh();
    set({ ready: true });
    supabase.auth.onAuthStateChange((event, session) => {
      set({ session, user: session?.user ?? null });
      if (event === 'SIGNED_OUT') set({ subscription: null, usage: null });
      // Rafraîchissement hors du rappel (recommandation Supabase pour éviter les blocages).
      if (session && (event === 'SIGNED_IN' || event === 'USER_UPDATED')) setTimeout(() => void get().refresh(), 0);
      if (event === 'PASSWORD_RECOVERY' && !location.pathname.startsWith('/reinitialisation')) {
        history.pushState({}, '', '/reinitialisation');
        dispatchEvent(new PopStateEvent('popstate'));
      }
    });
  },

  refresh: async () => {
    if (!supabase || !get().user) return;
    const [sub, usage] = await Promise.all([
      supabase
        .from('subscriptions')
        .select('plan,status,current_period_end,cancel_at_period_end,trial_end,trial_used,stripe_customer_id')
        .eq('user_id', get().user!.id)
        .maybeSingle(),
      supabase.rpc('my_usage'),
    ]);
    set({ subscription: (sub.data as SubscriptionInfo | null) ?? null, usage: (usage.data as Usage | null) ?? null });
  },

  setDevPlan: (p) => {
    if (!import.meta.env.DEV) return;
    try {
      if (p) localStorage.setItem(DEV_PLAN_KEY, p);
      else localStorage.removeItem(DEV_PLAN_KEY);
    } catch {
      /* stockage indisponible */
    }
    set({ devPlan: p });
  },
}));

/** Formule effective de l'utilisateur courant. */
export function currentPlan(s: Pick<AuthState, 'devPlan' | 'subscription'> = useAuth.getState()): PlanId {
  if (s.devPlan) return s.devPlan;
  return effectivePlan(s.subscription);
}

export function usePlan(): PlanId {
  return useAuth((s) => currentPlan(s));
}

export function useEntitlements(): Entitlements {
  return entitlementsFor(usePlan());
}

export function currentEntitlements(): Entitlements {
  return entitlementsFor(currentPlan());
}

/** Appel d'une fonction Edge avec le jeton de session. */
async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Comptes non configurés (Supabase).');
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    // Message d'erreur renvoyé par la fonction, s'il existe.
    const ctx = (error as { context?: Response }).context;
    const detail = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
    throw new Error(detail?.error ?? error.message);
  }
  return data as T;
}

export async function startCheckout(plan: PaidPlanId): Promise<void> {
  const { url } = await invoke<{ url: string }>('create-checkout-session', { plan, acceptTerms: true });
  location.assign(url);
}

export async function openBillingPortal(): Promise<void> {
  const { url } = await invoke<{ url: string }>('create-portal-session', {});
  location.assign(url);
}

export async function deleteAccount(): Promise<void> {
  await invoke('delete-account', { confirm: 'SUPPRIMER' });
  await supabase?.auth.signOut();
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
}
