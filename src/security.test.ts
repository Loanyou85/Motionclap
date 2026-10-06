import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Aucune clé secrète ne doit se trouver dans le code versionné : tout passe par les fichiers .env. */
const ROOTS = ['src', 'supabase', 'scripts', 'index.html', 'vite.config.ts', '.env.example', 'supabase/functions/.env.example'];
const SECRET_PATTERNS = [
  /sk_(test|live)_[A-Za-z0-9]{16,}/, // clé secrète Stripe
  /rk_(test|live)_[A-Za-z0-9]{16,}/, // clé restreinte Stripe
  /whsec_[A-Za-z0-9]{20,}/, // secret de webhook Stripe
  /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, // JWT (clé service_role Supabase)
];

function files(path: string): string[] {
  const st = statSync(path);
  if (st.isFile()) return [path];
  return readdirSync(path).flatMap((f) => (f === 'node_modules' || f.startsWith('.temp') ? [] : files(join(path, f))));
}

describe('sécurité', () => {
  it('aucune clé secrète dans le code source', () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const f of files(root)) {
        if (f.endsWith('security.test.ts')) continue;
        const text = readFileSync(f, 'utf8');
        if (SECRET_PATTERNS.some((re) => re.test(text))) offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('les clés serveur ne sont jamais lues côté client', () => {
    const client = files('src').filter((f) => !f.endsWith('.test.ts'));
    for (const f of client) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/SERVICE_ROLE|STRIPE_SECRET|WEBHOOK_SECRET/);
    }
  });
});
