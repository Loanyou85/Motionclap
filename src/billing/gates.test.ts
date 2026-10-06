import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuth } from '../account/auth';
import { createProject } from '../engine/defaults';
import { saveProject, setPersistenceScope } from '../store/persistence';
import { canCreateProject, requireFeature, useUpgrade } from './gates';

describe('blocages selon la formule', () => {
  beforeEach(() => {
    setPersistenceScope(`test-${Math.random()}`);
    useUpgrade.getState().close();
  });

  it('Gratuit : 3 projets maximum, puis fenêtre « Passer à Pro »', async () => {
    useAuth.getState().setDevPlan('free');
    for (let i = 0; i < 2; i++) await saveProject(createProject(`P${i}`));
    expect(await canCreateProject()).toBe(true);
    await saveProject(createProject('P3'));
    expect(await canCreateProject()).toBe(false);
    expect(useUpgrade.getState().request?.plan).toBe('pro');
  });

  it('Pro : projets illimités', async () => {
    useAuth.getState().setDevPlan('pro');
    for (let i = 0; i < 5; i++) await saveProject(createProject(`P${i}`));
    expect(await canCreateProject()).toBe(true);
  });

  it('propose la formule minimale qui débloque la fonction', () => {
    useAuth.getState().setDevPlan('free');
    expect(requireFeature((e) => e.webExports, 'Lottie')).toBe(false);
    expect(useUpgrade.getState().request).toEqual({ reason: 'Lottie', plan: 'pro' });
    useAuth.getState().setDevPlan('pro');
    expect(requireFeature((e) => e.webExports, 'Lottie')).toBe(true);
    expect(requireFeature((e) => e.customFonts, 'Polices')).toBe(false);
    expect(useUpgrade.getState().request?.plan).toBe('studio');
    useAuth.getState().setDevPlan('studio');
    expect(requireFeature((e) => e.customFonts && e.maxVideoHeight >= 2160, '4K')).toBe(true);
  });
});
