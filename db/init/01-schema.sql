-- Structure de la base : reprend exactement le modèle de data/family.json
-- (personnes, unions = couples, et liens enfant → union de ses parents).

create extension if not exists unaccent;

create schema arbre;

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

-- ---------- Outils ----------

-- « Émilie Dubois 1960 » → « emilie-dubois-1960 »
create function arbre.slugify(t text) returns text
language sql stable as $$
  select trim(both '-' from regexp_replace(lower(unaccent(coalesce(t, ''))), '[^a-z0-9]+', '-', 'g'))
$$;

-- Identifiant de personne lisible et unique (ajoute -2, -3… en cas de doublon).
create function arbre.unique_person_id(base text) returns text
language plpgsql as $$
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
