-- Atelier Motion : comptes, abonnements, projets en ligne et ressources.
-- Les limites par formule reprennent supabase/functions/_shared/plans.ts
-- (vérifié par `npm run test:db`).

-- ---------------------------------------------------------------------------
-- Profils
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Lecture de son profil" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "Modification de son profil" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- ---------------------------------------------------------------------------
-- Abonnements (écrits uniquement par les webhooks Stripe, rôle service)
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  plan text not null default 'free' check (plan in ('free', 'pro', 'studio')),
  status text not null default 'none',
  price_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  trial_end timestamptz,
  trial_used boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

-- Lecture seule pour l'utilisateur : aucune politique d'écriture, seul le rôle service écrit.
create policy "Lecture de son abonnement" on public.subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);

-- Événements Stripe déjà traités (idempotence des webhooks).
create table public.stripe_events (
  id text primary key,
  type text not null,
  processed_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;

-- ---------------------------------------------------------------------------
-- Formules et limites
-- ---------------------------------------------------------------------------
create function public.current_plan(uid uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.plan from public.subscriptions s
      where s.user_id = uid
        and s.plan <> 'free'
        and s.status in ('active', 'trialing', 'past_due')),
    'free');
$$;

create function public.plan_max_projects(plan text)
returns integer
language sql
immutable
as $$
  select case plan when 'free' then 3 else null end;
$$;

create function public.plan_storage_bytes(plan text)
returns bigint
language sql
immutable
as $$
  select case plan
    when 'studio' then 5368709120   -- 5 Go
    when 'pro' then 1073741824      -- 1 Go
    else 104857600                  -- 100 Mo
  end;
$$;

-- ---------------------------------------------------------------------------
-- Projets
-- ---------------------------------------------------------------------------
create table public.projects (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  name text not null default 'Projet sans titre',
  data jsonb not null,
  size_bytes bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index projects_user_updated_idx on public.projects (user_id, updated_at desc);

alter table public.projects enable row level security;

create policy "Lecture de ses projets" on public.projects
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Création de ses projets" on public.projects
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Modification de ses projets" on public.projects
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Suppression de ses projets" on public.projects
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Espace utilisé : projets + fichiers du dossier de l'utilisateur.
create function public.storage_used(uid uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select sum(p.size_bytes) from public.projects p where p.user_id = uid), 0)
    + coalesce((select sum((o.metadata ->> 'size')::bigint) from storage.objects o
                 where o.bucket_id = 'assets' and (storage.foldername(o.name))[1] = uid::text), 0);
$$;

-- Limite de projets et quota de stockage, vérifiés côté serveur.
create function public.enforce_project_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan text := public.current_plan(new.user_id);
  max_projects integer := public.plan_max_projects(plan);
  growth bigint;
begin
  new.size_bytes := octet_length(new.data::text);
  new.updated_at := now();

  if tg_op = 'INSERT' and max_projects is not null
     and (select count(*) from public.projects p where p.user_id = new.user_id) >= max_projects then
    raise exception 'project_limit' using errcode = 'P0001',
      hint = format('La formule %s est limitée à %s projets.', plan, max_projects);
  end if;

  growth := new.size_bytes - case when tg_op = 'UPDATE' then old.size_bytes else 0 end;
  if growth > 0 and public.storage_used(new.user_id) + growth > public.plan_storage_bytes(plan) then
    raise exception 'storage_quota' using errcode = 'P0001',
      hint = 'Espace de stockage insuffisant pour cette formule.';
  end if;

  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger projects_limits
  before insert or update on public.projects
  for each row execute function public.enforce_project_limits();

-- Récapitulatif pour l'écran « Mon compte ».
create function public.my_usage()
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select json_build_object(
    'plan', public.current_plan(auth.uid()),
    'projects', (select count(*) from public.projects p where p.user_id = auth.uid()),
    'max_projects', public.plan_max_projects(public.current_plan(auth.uid())),
    'storage_used', public.storage_used(auth.uid()),
    'storage_quota', public.plan_storage_bytes(public.current_plan(auth.uid()))
  );
$$;

revoke execute on function public.storage_used(uuid) from public, anon;
revoke execute on function public.current_plan(uuid) from public, anon;
revoke execute on function public.my_usage() from public, anon;
grant execute on function public.my_usage() to authenticated;

-- ---------------------------------------------------------------------------
-- Création automatique du profil et de l'abonnement gratuit
-- ---------------------------------------------------------------------------
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'avatar_url')
  on conflict (id) do nothing;
  insert into public.subscriptions (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Ressources (sons, images, polices) dans un bucket privé
-- Chemin : <user_id>/<audio|images|fonts>/<fichier>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('assets', 'assets', false, 104857600)
on conflict (id) do nothing;

create function public.can_upload_asset(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  parts text[] := storage.foldername(object_name);
  plan text;
begin
  if uid is null or parts[1] is distinct from uid::text then
    return false;
  end if;
  plan := public.current_plan(uid);
  -- Polices et images personnalisées : formule Studio.
  if parts[2] in ('images', 'fonts') and plan <> 'studio' then
    return false;
  end if;
  if parts[2] not in ('audio', 'images', 'fonts') then
    return false;
  end if;
  return public.storage_used(uid) < public.plan_storage_bytes(plan);
end;
$$;

grant execute on function public.can_upload_asset(text) to authenticated;

create policy "Lecture de ses ressources" on storage.objects
  for select to authenticated
  using (bucket_id = 'assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Envoi de ressources selon la formule" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'assets' and public.can_upload_asset(name));
create policy "Remplacement de ses ressources" on storage.objects
  for update to authenticated
  using (bucket_id = 'assets' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'assets' and public.can_upload_asset(name));
create policy "Suppression de ses ressources" on storage.objects
  for delete to authenticated
  using (bucket_id = 'assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
