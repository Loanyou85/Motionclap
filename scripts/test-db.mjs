#!/usr/bin/env node
/**
 * Teste la migration Supabase sur un Postgres temporaire (sans Docker) :
 * bouchons auth/storage, migration, puis vérifications RLS, limites et quotas.
 * Prérequis : binaires PostgreSQL (initdb, pg_ctl, psql) installés localement.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PLANS } from '../supabase/functions/_shared/plans.ts';

const root = resolve(import.meta.dirname, '..');

function findBin(name) {
  try {
    const dir = execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim();
    if (existsSync(join(dir, name))) return join(dir, name);
  } catch {
    /* pg_config absent */
  }
  const base = '/usr/lib/postgresql';
  if (existsSync(base)) {
    for (const v of readdirSync(base).sort().reverse()) {
      const p = join(base, v, 'bin', name);
      if (existsSync(p)) return p;
    }
  }
  return name;
}

// Postgres refuse de tourner en root : on passe alors par l'utilisateur « postgres ».
const asRoot = process.getuid?.() === 0;
const run = (bin, args, opts = {}) => {
  const [cmd, argv] = asRoot ? ['runuser', ['-u', 'postgres', '--', bin, ...args]] : [bin, args];
  const r = spawnSync(cmd, argv, { encoding: 'utf8', ...opts });
  if (r.status !== 0) throw new Error(`${bin} ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
};

const dir = mkdtempSync(join(tmpdir(), 'atelier-db-'));
chmodSync(dir, 0o777);
const data = join(dir, 'data');
const port = String(54000 + Math.floor(Math.random() * 900));
let started = false;

try {
  run(findBin('initdb'), ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--no-locale']);
  run(findBin('pg_ctl'), ['-D', data, '-l', join(dir, 'log.txt'), '-w', '-o', `-k ${dir} -p ${port} -c listen_addresses=''`, 'start']);
  started = true;
  const psql = (args) => run(findBin('psql'), ['-h', dir, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', ...args]);
  const file = (f) => {
    const copy = join(dir, f.split('/').pop());
    execFileSync('cp', [join(root, f), copy]);
    chmodSync(copy, 0o644);
    return copy;
  };

  psql(['-f', file('supabase/tests/supabase-stubs.sql')]);
  psql(['-f', file('supabase/migrations/20261006120000_abonnements.sql')]);
  console.log('✓ migration appliquée');

  // Les limites SQL doivent correspondre aux formules de l'application.
  for (const plan of Object.values(PLANS)) {
    const out = psql(['-At', '-c', `select coalesce(public.plan_max_projects('${plan.id}')::text, 'null') || '|' || public.plan_storage_bytes('${plan.id}')`]).trim();
    const expected = `${plan.entitlements.maxProjects ?? 'null'}|${plan.entitlements.storageBytes}`;
    if (out !== expected) throw new Error(`Limites SQL de « ${plan.id} » : ${out}, attendu ${expected}`);
  }
  console.log('✓ limites SQL identiques à plans.ts');

  const result = psql(['-At', '-f', file('supabase/tests/abonnements.test.sql')]);
  if (!result.includes('OK')) throw new Error(result);
  console.log('✓ RLS, limite de projets, quotas, droits Studio, coupure d’accès, suppression en cascade');
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exitCode = 1;
} finally {
  if (started) run(findBin('pg_ctl'), ['-D', data, '-m', 'immediate', 'stop']);
  rmSync(dir, { recursive: true, force: true });
}
