-- Vérifications de la migration (exécutées par scripts/test-db.mjs).
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'bruno@example.test');

-- Profil et abonnement gratuit créés automatiquement
do $$ begin
  assert (select count(*) from public.profiles) = 2, 'profils non créés';
  assert (select plan from public.subscriptions where user_id = '00000000-0000-0000-0000-00000000000a') = 'free', 'abonnement gratuit absent';
end $$;

-- Alice (gratuit) : 3 projets maximum
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false) \gset ignore_
insert into public.projects (id, name, data) values ('p1', 'Un', '{"a":1}'), ('p2', 'Deux', '{}'), ('p3', 'Trois', '{}');
do $$ begin
  begin
    insert into public.projects (id, name, data) values ('p4', 'Quatre', '{}');
    raise exception 'ÉCHEC : la limite de 3 projets n''est pas appliquée';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'project_limit' then raise; end if;
  end;
end $$;
-- La modification d'un projet existant reste possible
update public.projects set name = 'Un bis' where id = 'p1';
do $$ begin
  assert (select size_bytes from public.projects where id = 'p1') > 0, 'taille non calculée';
  assert (select (public.my_usage() ->> 'projects')::int) = 3, 'my_usage incorrect';
  assert (select (public.my_usage() ->> 'max_projects')::int) = 3, 'max_projects incorrect';
end $$;

-- Un utilisateur ne peut pas modifier son abonnement lui-même
do $$ begin
  update public.subscriptions set plan = 'studio', status = 'active';
  assert (select plan from public.subscriptions) = 'free', 'ÉCHEC : abonnement modifiable par l''utilisateur';
end $$;

-- Images et polices réservées à Studio, sons autorisés
do $$ begin
  assert public.can_upload_asset('00000000-0000-0000-0000-00000000000a/audio/son.wav'), 'son refusé';
  assert not public.can_upload_asset('00000000-0000-0000-0000-00000000000a/images/photo.png'), 'ÉCHEC : image autorisée en gratuit';
  assert not public.can_upload_asset('00000000-0000-0000-0000-00000000000b/audio/son.wav'), 'ÉCHEC : dossier d''un autre utilisateur';
end $$;

-- Bruno ne voit pas les projets d'Alice
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false) \gset ignore_
do $$ begin
  assert (select count(*) from public.projects) = 0, 'ÉCHEC : fuite de projets entre utilisateurs';
  delete from public.projects where id = 'p1';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.projects where id = 'p1') = 1, 'ÉCHEC : suppression du projet d''un autre';
end $$;

-- Le webhook (rôle service) active Studio pour Alice
set role service_role;
update public.subscriptions set plan = 'studio', status = 'trialing', stripe_customer_id = 'cus_a'
  where user_id = '00000000-0000-0000-0000-00000000000a';
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false) \gset ignore_
insert into public.projects (id, name, data) values ('p4', 'Quatre', '{}');
do $$ begin
  assert public.can_upload_asset('00000000-0000-0000-0000-00000000000a/fonts/inter.woff2'), 'police refusée en Studio';
  assert (public.my_usage() ->> 'plan') = 'studio', 'formule Studio non détectée';
end $$;
reset role;

-- Abonnement impayé : retour au gratuit, plus de création au-delà de 3
update public.subscriptions set status = 'unpaid' where user_id = '00000000-0000-0000-0000-00000000000a';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false) \gset ignore_
do $$ begin
  assert (public.my_usage() ->> 'plan') = 'free', 'accès non coupé';
  begin
    insert into public.projects (id, name, data) values ('p5', 'Cinq', '{}');
    raise exception 'ÉCHEC : création possible après impayé';
  exception when sqlstate 'P0001' then null;
  end;
end $$;
reset role;

-- Quota de stockage (gratuit : 100 Mo)
update public.subscriptions set plan = 'free', status = 'none';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false) \gset ignore_
do $$ begin
  begin
    insert into public.projects (id, name, data) values ('gros', 'Gros', jsonb_build_object('x', repeat('a', 105000000)));
    raise exception 'ÉCHEC : quota de stockage non appliqué';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'storage_quota' then raise; end if;
  end;
end $$;
reset role;

-- Suppression du compte : tout part en cascade
delete from auth.users where id = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  assert (select count(*) from public.projects where user_id = '00000000-0000-0000-0000-00000000000a') = 0, 'projets non supprimés';
  assert (select count(*) from public.subscriptions where user_id = '00000000-0000-0000-0000-00000000000a') = 0, 'abonnement non supprimé';
end $$;

select 'OK' as resultat;
