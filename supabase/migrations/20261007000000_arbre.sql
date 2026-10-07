-- =====================================================================
-- Arbre de famille : base Supabase
--
--  * Les données sont dans le schéma « arbre », qui n'est PAS exposé par l'API.
--  * Le site n'appelle que des fonctions du schéma « public » (voir plus bas),
--    chacune vérifiant elle-même qui a le droit de l'utiliser :
--      - lecture de l'arbre : mot de passe de la famille, ou administrateur connecté ;
--      - modification : administrateur accepté (connexion par lien e-mail) ;
--      - gestion des accès : propriétaire uniquement.
-- =====================================================================

create extension if not exists unaccent with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema arbre;

-- ---------- Arbre (même modèle que data/family.json) ----------

create table arbre.persons (
  id          text primary key,
  seq         bigint generated always as identity,   -- ordre d'ajout (utilisé pour la disposition)
  first_name  text not null check (length(trim(first_name)) > 0),
  last_name   text,
  birth_name  text,
  sex         char(1) check (sex in ('F', 'M')),
  birth_date  text check (birth_date ~ '^\d{4}(-\d{2}(-\d{2})?)?$'),
  birth_place text,
  death_date  text check (death_date ~ '^\d{4}(-\d{2}(-\d{2})?)?$'),
  death_place text,
  photo       text,
  bio         text,
  created_at  timestamptz not null default now()
);

create table arbre.unions (
  id         text primary key,
  seq        bigint generated always as identity,
  date       text,
  created_at timestamptz not null default now()
);

create table arbre.union_partners (
  union_id  text not null references arbre.unions on delete cascade,
  person_id text not null references arbre.persons on delete cascade,
  position  int  not null default 0,
  primary key (union_id, person_id)
);

-- Une personne n'a qu'un seul couple de parents : person_id est unique.
create table arbre.union_children (
  union_id  text not null references arbre.unions on delete cascade,
  person_id text not null unique references arbre.persons on delete cascade,
  seq       bigint generated always as identity,
  primary key (union_id, person_id)
);

create table arbre.videos (
  id          bigint generated always as identity primary key,
  person_id   text not null references arbre.persons on delete cascade,
  provider    text not null default 'youtube',
  ref         text not null,          -- identifiant ou lien de la vidéo
  title       text,
  recorded_at text,
  position    int not null default 0
);

-- ---------- Accès ----------

-- Réglages : pour l'instant, le mot de passe de la famille (haché, jamais en clair).
create table arbre.settings (
  key   text primary key,
  value text not null
);

-- Administrateurs : une demande est créée à la première connexion par lien e-mail.
create table arbre.admins (
  email        text primary key check (email = lower(email)),
  role         text not null default 'editor' check (role in ('owner', 'editor')),
  status       text not null default 'pending' check (status in ('pending', 'approved', 'refused')),
  requested_at timestamptz not null default now(),
  decided_at   timestamptz
);

-- Essais de mot de passe ratés, pour bloquer les essais en rafale.
create table arbre.login_attempts (
  id           bigint generated always as identity primary key,
  ip           text not null,
  attempted_at timestamptz not null default now()
);
create index on arbre.login_attempts (ip, attempted_at);

-- Personne d'autre que les fonctions ci-dessous ne touche aux tables.
revoke all on all tables in schema arbre from public, anon, authenticated;
revoke all on schema arbre from public, anon, authenticated;

-- ---------- Outils internes ----------

-- « Émilie Dubois 1960 » → « emilie-dubois-1960 »
create function arbre.slugify(t text) returns text
language sql stable
set search_path = arbre, extensions, public
as $$
  select trim(both '-' from regexp_replace(lower(extensions.unaccent(coalesce(t, ''))), '[^a-z0-9]+', '-', 'g'))
$$;

-- Identifiant de personne lisible et unique (ajoute -2, -3… en cas de doublon).
create function arbre.unique_person_id(base text) returns text
language plpgsql
set search_path = arbre, public
as $$
declare
  root text := coalesce(nullif(base, ''), 'personne');
  candidate text := root;
  n int := 2;
begin
  while exists (select 1 from arbre.persons where id = candidate) loop
    candidate := root || '-' || n;
    n := n + 1;
  end loop;
  return candidate;
end
$$;

create function arbre.new_union_id() returns text
language sql volatile as $$
  select 'u-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)
$$;

-- Adresse e-mail de la personne connectée (lien e-mail), ou null.
create function arbre.current_email() returns text
language sql stable as $$
  select nullif(lower(auth.jwt() ->> 'email'), '')
$$;

create function arbre.is_editor() returns boolean
language sql stable security definer
set search_path = arbre, public
as $$
  select exists (select 1 from arbre.admins
                 where email = arbre.current_email() and status = 'approved')
$$;

create function arbre.is_owner() returns boolean
language sql stable security definer
set search_path = arbre, public
as $$
  select exists (select 1 from arbre.admins
                 where email = arbre.current_email() and status = 'approved' and role = 'owner')
$$;

create function arbre.require_editor() returns void
language plpgsql stable as $$
begin
  if not arbre.is_editor() then
    raise exception 'Accès refusé : réservé aux administrateurs acceptés.' using errcode = '42501';
  end if;
end
$$;

create function arbre.require_owner() returns void
language plpgsql stable as $$
begin
  if not arbre.is_owner() then
    raise exception 'Accès refusé : réservé au propriétaire du site.' using errcode = '42501';
  end if;
end
$$;

-- Adresse IP du visiteur (posée par le réseau de Supabase), pour limiter les essais de mot de passe.
create function arbre.client_ip() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.headers', true), '')::json ->> 'cf-connecting-ip',
    nullif(current_setting('request.headers', true), '')::json ->> 'x-real-ip',
    nullif(trim(split_part(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ',', 1)), ''),
    'inconnue')
$$;

-- Tout l'arbre, au même format que data/family.json.
create function arbre.family_json() returns json
language sql stable
set search_path = arbre, public
as $$
  select json_build_object(
    'persons', coalesce((
      select json_agg(json_build_object(
        'id', p.id,
        'firstName', p.first_name,
        'lastName', p.last_name,
        'birthName', p.birth_name,
        'sex', p.sex,
        'birth', case when p.birth_date is null and p.birth_place is null then null
                      else json_build_object('date', p.birth_date, 'place', p.birth_place) end,
        'death', case when p.death_date is null and p.death_place is null then null
                      else json_build_object('date', p.death_date, 'place', p.death_place) end,
        'photo', p.photo,
        'bio', p.bio,
        'videos', coalesce((
          select json_agg(json_build_object(
            'provider', v.provider, 'id', v.ref, 'title', v.title, 'recordedAt', v.recorded_at
          ) order by v.position, v.id)
          from videos v where v.person_id = p.id), '[]'::json)
      ) order by p.seq)
      from persons p), '[]'::json),
    'unions', coalesce((
      select json_agg(json_build_object(
        'id', u.id,
        'partners', coalesce((
          select json_agg(up.person_id order by up.position)
          from union_partners up where up.union_id = u.id), '[]'::json),
        'date', u.date
      ) order by u.seq)
      from unions u), '[]'::json),
    'children', coalesce((
      select json_agg(json_build_object('unionId', c.union_id, 'personId', c.person_id) order by c.seq)
      from union_children c), '[]'::json)
  )
$$;

-- Remplace tout l'arbre par le contenu d'un family.json.
create function arbre.import_family(doc jsonb) returns void
language plpgsql
set search_path = arbre, public
as $$
begin
  delete from arbre.persons;
  delete from arbre.unions;

  insert into arbre.persons (id, first_name, last_name, birth_name, sex, birth_date, birth_place,
                             death_date, death_place, photo, bio)
  select p ->> 'id', p ->> 'firstName', p ->> 'lastName', p ->> 'birthName', nullif(p ->> 'sex', ''),
         nullif(p -> 'birth' ->> 'date', ''), p -> 'birth' ->> 'place',
         nullif(p -> 'death' ->> 'date', ''), p -> 'death' ->> 'place',
         p ->> 'photo', p ->> 'bio'
  from jsonb_array_elements(doc -> 'persons') with ordinality as e(p, ord)
  order by ord;

  insert into arbre.videos (person_id, provider, ref, title, recorded_at, position)
  select p ->> 'id', coalesce(v ->> 'provider', 'youtube'), coalesce(v ->> 'id', v ->> 'url'),
         v ->> 'title', v ->> 'recordedAt', (vord - 1)::int
  from jsonb_array_elements(doc -> 'persons') as e(p),
       jsonb_array_elements(coalesce(p -> 'videos', '[]'::jsonb)) with ordinality as ve(v, vord);

  insert into arbre.unions (id, date)
  select u ->> 'id', u ->> 'date'
  from jsonb_array_elements(doc -> 'unions') with ordinality as e(u, ord)
  order by ord;

  insert into arbre.union_partners (union_id, person_id, position)
  select u ->> 'id', partner, (pord - 1)::int
  from jsonb_array_elements(doc -> 'unions') as e(u),
       jsonb_array_elements_text(u -> 'partners') with ordinality as pe(partner, pord);

  insert into arbre.union_children (union_id, person_id)
  select c ->> 'unionId', c ->> 'personId'
  from jsonb_array_elements(doc -> 'children') with ordinality as e(c, ord)
  order by ord;
end
$$;

-- Écrit les champs d'une personne (ajout ou modification) depuis le format du formulaire.
create function arbre.write_person_fields(target_id text, p jsonb) returns void
language plpgsql
set search_path = arbre, public
as $$
begin
  if coalesce(trim(p ->> 'firstName'), '') = '' then
    raise exception 'Le prénom est obligatoire.';
  end if;

  update persons set
    first_name  = trim(p ->> 'firstName'),
    last_name   = nullif(trim(p ->> 'lastName'), ''),
    birth_name  = nullif(trim(p ->> 'birthName'), ''),
    sex         = nullif(p ->> 'sex', ''),
    birth_date  = nullif(p -> 'birth' ->> 'date', ''),
    birth_place = nullif(trim(p -> 'birth' ->> 'place'), ''),
    death_date  = nullif(p -> 'death' ->> 'date', ''),
    death_place = nullif(trim(p -> 'death' ->> 'place'), ''),
    photo       = nullif(trim(p ->> 'photo'), ''),
    bio         = nullif(trim(p ->> 'bio'), '')
  where id = target_id;

  delete from videos where person_id = target_id;
  insert into videos (person_id, provider, ref, title, recorded_at, position)
  select target_id, coalesce(nullif(v ->> 'provider', ''), 'youtube'), v ->> 'id',
         nullif(trim(v ->> 'title'), ''), nullif(v ->> 'recordedAt', ''), (ord - 1)::int
  from jsonb_array_elements(coalesce(p -> 'videos', '[]'::jsonb)) with ordinality as e(v, ord)
  where coalesce(trim(v ->> 'id'), '') <> '';
end
$$;

-- =====================================================================
-- API appelée par le site (schéma public)
-- =====================================================================

-- ---------- Lecture ----------

-- Arbre complet si le mot de passe de la famille est bon.
-- Renvoie { error } plutôt que de lever une erreur, pour que l'essai raté soit bien enregistré.
create function public.family(password text) returns json
language plpgsql volatile security definer
set search_path = arbre, extensions, public
as $$
declare
  ip text := arbre.client_ip();
  hashed text;
begin
  if (select count(*) from login_attempts
      where login_attempts.ip = family.ip and attempted_at > now() - interval '15 minutes') >= 10 then
    return json_build_object('error', 'too_many_attempts');
  end if;

  select value into hashed from settings where key = 'family_password';
  if hashed is null or coalesce(password, '') = '' or extensions.crypt(password, hashed) <> hashed then
    insert into login_attempts (ip) values (family.ip);
    delete from login_attempts where attempted_at < now() - interval '1 day';
    perform pg_sleep(1);
    return json_build_object('error', 'wrong_password');
  end if;

  delete from login_attempts where login_attempts.ip = family.ip;
  return arbre.family_json();
end
$$;

-- Arbre complet pour un administrateur connecté et accepté (sans mot de passe de famille).
create function public.family_admin() returns json
language plpgsql stable security definer
set search_path = arbre, public
as $$
begin
  perform arbre.require_editor();
  return arbre.family_json();
end
$$;

-- ---------- Mode administrateur ----------

-- À appeler après la connexion par lien e-mail : crée la demande si l'adresse est inconnue.
-- Renvoie { email, status: 'pending' | 'approved' | 'refused', role }.
create function public.my_admin_status() returns json
language plpgsql volatile security definer
set search_path = arbre, public
as $$
declare
  me text := arbre.current_email();
  mine arbre.admins;
begin
  if me is null then
    raise exception 'Connectez-vous d''abord avec le lien reçu par e-mail.' using errcode = '42501';
  end if;
  insert into admins (email) values (me) on conflict (email) do nothing;
  select * into mine from admins where email = me;
  return json_build_object('email', mine.email, 'status', mine.status, 'role', mine.role);
end
$$;

-- ---------- Modification de l'arbre (administrateurs acceptés) ----------

-- payload = {
--   person:        { firstName, lastName, birthName, sex, birth: {date, place}, death: {date, place},
--                    photo, bio, videos: [{ provider, id, title, recordedAt }] },
--   relation:      'partner' | 'child' | 'parent' | 'sibling',
--   relativeId:    la personne de l'arbre à partir de laquelle on ajoute,
--   otherParentId: pour un enfant, l'autre parent (un conjoint de relativeId), facultatif,
--   unionDate:     pour un conjoint, date de l'union, facultative
-- }
-- Renvoie { id } : l'identifiant de la nouvelle personne.
create function public.add_person(payload jsonb) returns json
language plpgsql volatile security definer
set search_path = arbre, public
as $$
declare
  p          jsonb := payload -> 'person';
  relation   text  := payload ->> 'relation';
  relative   text  := payload ->> 'relativeId';
  other      text  := nullif(payload ->> 'otherParentId', '');
  new_id     text;
  target_union text;
  partner_count int;
begin
  perform arbre.require_editor();
  if p is null or coalesce(trim(p ->> 'firstName'), '') = '' then
    raise exception 'Le prénom est obligatoire.';
  end if;
  if relation is not null and relation not in ('partner', 'child', 'parent', 'sibling') then
    raise exception 'Lien de parenté inconnu : %', relation;
  end if;
  if relation is not null and not exists (select 1 from persons where id = relative) then
    raise exception 'Personne introuvable dans l''arbre : %', relative;
  end if;

  new_id := unique_person_id(slugify(concat_ws(' ', p ->> 'firstName', p ->> 'lastName',
                                               left(p -> 'birth' ->> 'date', 4))));
  insert into persons (id, first_name) values (new_id, trim(p ->> 'firstName'));
  perform write_person_fields(new_id, p);

  if relation = 'partner' then
    target_union := new_union_id();
    insert into unions (id, date) values (target_union, nullif(payload ->> 'unionDate', ''));
    insert into union_partners (union_id, person_id, position)
    values (target_union, relative, 0), (target_union, new_id, 1);

  elsif relation = 'child' then
    if other is not null then
      -- Le couple formé par les deux parents, s'il existe déjà.
      select up1.union_id into target_union
      from union_partners up1
      join union_partners up2 on up2.union_id = up1.union_id and up2.person_id = other
      where up1.person_id = relative
      limit 1;
      if target_union is null then
        if not exists (select 1 from persons where id = other) then
          raise exception 'Autre parent introuvable : %', other;
        end if;
        target_union := new_union_id();
        insert into unions (id) values (target_union);
        insert into union_partners (union_id, person_id, position)
        values (target_union, relative, 0), (target_union, other, 1);
      end if;
    else
      -- Parent seul : une union où il est l'unique partenaire.
      select up.union_id into target_union
      from union_partners up
      where up.person_id = relative
        and (select count(*) from union_partners x where x.union_id = up.union_id) = 1
      limit 1;
      if target_union is null then
        target_union := new_union_id();
        insert into unions (id) values (target_union);
        insert into union_partners (union_id, person_id, position) values (target_union, relative, 0);
      end if;
    end if;
    insert into union_children (union_id, person_id) values (target_union, new_id);

  elsif relation = 'parent' then
    select union_id into target_union from union_children where person_id = relative;
    if target_union is null then
      target_union := new_union_id();
      insert into unions (id) values (target_union);
      insert into union_children (union_id, person_id) values (target_union, relative);
    end if;
    select count(*) into partner_count from union_partners where union_id = target_union;
    if partner_count >= 2 then
      raise exception 'Cette personne a déjà deux parents dans l''arbre.';
    end if;
    insert into union_partners (union_id, person_id, position) values (target_union, new_id, partner_count);

  elsif relation = 'sibling' then
    select union_id into target_union from union_children where person_id = relative;
    if target_union is null then
      raise exception 'Ajoutez d''abord un parent : un frère ou une sœur se rattache aux mêmes parents.';
    end if;
    insert into union_children (union_id, person_id) values (target_union, new_id);
  end if;

  return json_build_object('id', new_id);
end
$$;

-- Modifie les informations d'une personne (pas ses liens de parenté). L'identifiant ne change pas.
create function public.update_person(target_id text, changes jsonb) returns json
language plpgsql volatile security definer
set search_path = arbre, public
as $$
begin
  perform arbre.require_editor();
  if not exists (select 1 from persons where id = target_id) then
    raise exception 'Personne introuvable dans l''arbre : %', target_id;
  end if;
  perform write_person_fields(target_id, changes);
  return json_build_object('id', target_id);
end
$$;

-- Supprime une personne ; ses proches restent dans l'arbre. Les couples devenus vides sont nettoyés.
create function public.delete_person(target_id text) returns json
language plpgsql volatile security definer
set search_path = arbre, public
as $$
begin
  perform arbre.require_editor();
  if not exists (select 1 from persons where id = target_id) then
    raise exception 'Personne introuvable dans l''arbre : %', target_id;
  end if;

  delete from persons where id = target_id;   -- vidéos et liens supprimés en cascade
  delete from unions u
  where not exists (select 1 from union_partners up where up.union_id = u.id);
  delete from unions u
  where (select count(*) from union_partners up where up.union_id = u.id) = 1
    and not exists (select 1 from union_children c where c.union_id = u.id);

  return json_build_object('deleted', target_id);
end
$$;

-- ---------- Espace d'administration (propriétaire) ----------

create function public.admin_list() returns json
language plpgsql stable security definer
set search_path = arbre, public
as $$
begin
  perform arbre.require_owner();
  return coalesce((
    select json_agg(json_build_object(
      'email', email, 'role', role, 'status', status,
      'requestedAt', requested_at, 'decidedAt', decided_at
    ) order by status = 'pending' desc, requested_at desc)
    from admins), '[]'::json);
end
$$;

-- Accepter (accept = true) ou refuser (false) une adresse.
create function public.admin_decide(target_email text, accept boolean) returns json
language plpgsql volatile security definer
set search_path = arbre, public
as $$
begin
  perform arbre.require_owner();
  update admins
     set status = case when accept then 'approved' else 'refused' end, decided_at = now()
   where email = lower(target_email) and role <> 'owner';
  if not found then
    raise exception 'Adresse introuvable ou non modifiable : %', target_email;
  end if;
  return json_build_object('email', lower(target_email), 'status', case when accept then 'approved' else 'refused' end);
end
$$;

-- Retire une adresse de la liste (elle pourra refaire une demande).
create function public.admin_remove(target_email text) returns json
language plpgsql volatile security definer
set search_path = arbre, public
as $$
begin
  perform arbre.require_owner();
  delete from admins where email = lower(target_email) and role <> 'owner';
  if not found then
    raise exception 'Adresse introuvable ou non modifiable : %', target_email;
  end if;
  return json_build_object('removed', lower(target_email));
end
$$;

-- Change le mot de passe de la famille (8 caractères minimum).
create function public.set_family_password(new_password text) returns json
language plpgsql volatile security definer
set search_path = arbre, extensions, public
as $$
begin
  perform arbre.require_owner();
  if length(coalesce(new_password, '')) < 8 then
    raise exception 'Le mot de passe doit contenir au moins 8 caractères.';
  end if;
  insert into settings (key, value) values ('family_password', extensions.crypt(new_password, extensions.gen_salt('bf')))
  on conflict (key) do update set value = excluded.value;
  delete from login_attempts;
  return json_build_object('ok', true);
end
$$;

-- Remplace tout l'arbre par un family.json (restauration d'une sauvegarde).
create function public.admin_import(doc jsonb) returns json
language plpgsql volatile security definer
set search_path = arbre, public
as $$
begin
  perform arbre.require_owner();
  perform arbre.import_family(doc);
  return json_build_object('persons', (select count(*) from persons));
end
$$;

-- ---------- Droits d'exécution ----------
-- Supabase autorise par défaut toutes les fonctions de « public » à tout le monde : on referme,
-- puis on ouvre précisément. Les vérifications de rôle sont de toute façon faites dans chaque fonction.

revoke execute on all functions in schema arbre from public, anon, authenticated;
revoke execute on function
  public.family(text), public.family_admin(), public.my_admin_status(),
  public.add_person(jsonb), public.update_person(text, jsonb), public.delete_person(text),
  public.admin_list(), public.admin_decide(text, boolean), public.admin_remove(text),
  public.set_family_password(text), public.admin_import(jsonb)
from public, anon, authenticated;

grant execute on function public.family(text) to anon, authenticated;
grant execute on function
  public.family_admin(), public.my_admin_status(),
  public.add_person(jsonb), public.update_person(text, jsonb), public.delete_person(text),
  public.admin_list(), public.admin_decide(text, boolean), public.admin_remove(text),
  public.set_family_password(text), public.admin_import(jsonb)
to authenticated;
