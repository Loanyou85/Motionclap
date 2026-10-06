/**
 * Suppression du compte (droit à l'effacement, RGPD) : résiliation immédiate de l'abonnement,
 * suppression des fichiers puis de l'utilisateur (projets, profil et abonnement partent en cascade).
 * Les factures restent chez Stripe, qui les conserve au titre de ses obligations comptables.
 */
import { grantsAccess } from '../_shared/billing.ts';
import { adminClient, handler, HttpError, json, requireUser, stripeClient } from '../_shared/http.ts';

Deno.serve(
  handler(async (req) => {
    const user = await requireUser(req);
    const { confirm } = await req.json().catch(() => ({}));
    if (confirm !== 'SUPPRIMER') throw new HttpError(400, 'Confirmation manquante');
    const db = adminClient();

    const { data: row } = await db.from('subscriptions').select('*').eq('user_id', user.id).maybeSingle();
    if (row?.stripe_subscription_id && grantsAccess(row.status)) {
      await stripeClient().subscriptions.cancel(row.stripe_subscription_id);
    }

    for (const folder of ['audio', 'images', 'fonts']) {
      const prefix = `${user.id}/${folder}`;
      const { data: files } = await db.storage.from('assets').list(prefix, { limit: 1000 });
      if (files?.length) await db.storage.from('assets').remove(files.map((f) => `${prefix}/${f.name}`));
    }

    const { error } = await db.auth.admin.deleteUser(user.id);
    if (error) throw error;
    return json({ deleted: true });
  }),
);
