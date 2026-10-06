import { create } from 'zustand';
import { countCloudProjects, isCloudActive } from '../account/cloud';
import { currentEntitlements } from '../account/auth';
import { listProjects } from '../store/persistence';
import { minimumPlanFor, type Entitlements, type PaidPlanId } from './plans';

/** Fenêtre « Passer à Pro » : raison du blocage et formule conseillée. */
interface UpgradeState {
  request: { reason: string; plan: PaidPlanId } | null;
  show: (reason: string, plan?: PaidPlanId) => void;
  close: () => void;
}

export const useUpgrade = create<UpgradeState>()((set) => ({
  request: null,
  show: (reason, plan = 'pro') => set({ request: { reason, plan } }),
  close: () => set({ request: null }),
}));

/**
 * Vérifie un droit de la formule courante ; sinon ouvre la fenêtre d'abonnement
 * avec la formule minimale qui le débloque.
 */
export function requireFeature(check: (e: Entitlements) => boolean, reason: string): boolean {
  if (check(currentEntitlements())) return true;
  const plan = minimumPlanFor(check);
  useUpgrade.getState().show(reason, plan === 'studio' ? 'studio' : 'pro');
  return false;
}

/** Nombre de projets existants (en ligne si connecté, sinon dans le navigateur). */
export async function projectCount(): Promise<number> {
  if (isCloudActive()) return countCloudProjects();
  return (await listProjects()).length;
}

/** Peut-on créer un nouveau projet ? Ouvre la fenêtre d'abonnement si la limite est atteinte. */
export async function canCreateProject(): Promise<boolean> {
  const max = currentEntitlements().maxProjects;
  if (max === null) return true;
  const count = await projectCount();
  if (count < max) return true;
  useUpgrade.getState().show(`La formule Gratuite est limitée à ${max} projets. Supprimez un projet ou passez à Pro pour des projets illimités.`, 'pro');
  return false;
}
