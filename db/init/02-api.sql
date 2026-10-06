-- API exposée par PostgREST (schéma « api ») :
--   GET  /rpc/family         → tout l'arbre, au même format que data/family.json
--   POST /rpc/add_person     → ajoute une personne et la relie à quelqu'un de l'arbre
--   POST /rpc/update_person  → modifie les informations d'une personne
--   POST /rpc/delete_person  → supprime une personne (ses proches restent dans l'arbre)

create schema api;

create function api.family() returns json
language sql stable security definer
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

-- payload = {
--   person:        { firstName, lastName, birthName, sex, birth: {date, place}, death: {date, place},
--                    photo, bio, videos: [{ provider, id, title, recordedAt }] },
--   relation:      'partner' | 'child' | 'parent' | 'sibling' | null (personne isolée),
--   relativeId:    la personne de l'arbre à partir de laquelle on ajoute,
--   otherParentId: pour un enfant, l'autre parent (un conjoint de relativeId), facultatif,
--   unionDate:     pour un conjoint, date de l'union, facultative
-- }
-- Renvoie { id } : l'identifiant de la nouvelle personne.
create function api.add_person(payload jsonb) returns json
language plpgsql security definer
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

  insert into persons (id, first_name, last_name, birth_name, sex, birth_date, birth_place,
                       death_date, death_place, photo, bio)
  values (new_id,
          trim(p ->> 'firstName'),
          nullif(trim(p ->> 'lastName'), ''),
          nullif(trim(p ->> 'birthName'), ''),
          nullif(p ->> 'sex', ''),
          nullif(p -> 'birth' ->> 'date', ''),
          nullif(trim(p -> 'birth' ->> 'place'), ''),
          nullif(p -> 'death' ->> 'date', ''),
          nullif(trim(p -> 'death' ->> 'place'), ''),
          nullif(trim(p ->> 'photo'), ''),
          nullif(trim(p ->> 'bio'), ''));

  insert into videos (person_id, provider, ref, title, recorded_at, position)
  select new_id, coalesce(nullif(v ->> 'provider', ''), 'youtube'), v ->> 'id',
         nullif(trim(v ->> 'title'), ''), nullif(v ->> 'recordedAt', ''), (ord - 1)::int
  from jsonb_array_elements(coalesce(p -> 'videos', '[]'::jsonb)) with ordinality as e(v, ord)
  where coalesce(trim(v ->> 'id'), '') <> '';

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

-- Modifie les informations d'une personne (pas ses liens de parenté).
-- changes = même format que payload.person de add_person. Les vidéos sont remplacées par la liste fournie.
-- L'identifiant ne change pas, même si le nom change : les liens partagés restent valides.
create function api.update_person(target_id text, changes jsonb) returns json
language plpgsql security definer
set search_path = arbre, public
as $$
begin
  if not exists (select 1 from persons where id = target_id) then
    raise exception 'Personne introuvable dans l''arbre : %', target_id;
  end if;
  if coalesce(trim(changes ->> 'firstName'), '') = '' then
    raise exception 'Le prénom est obligatoire.';
  end if;

  update persons set
    first_name  = trim(changes ->> 'firstName'),
    last_name   = nullif(trim(changes ->> 'lastName'), ''),
    birth_name  = nullif(trim(changes ->> 'birthName'), ''),
    sex         = nullif(changes ->> 'sex', ''),
    birth_date  = nullif(changes -> 'birth' ->> 'date', ''),
    birth_place = nullif(trim(changes -> 'birth' ->> 'place'), ''),
    death_date  = nullif(changes -> 'death' ->> 'date', ''),
    death_place = nullif(trim(changes -> 'death' ->> 'place'), ''),
    photo       = nullif(trim(changes ->> 'photo'), ''),
    bio         = nullif(trim(changes ->> 'bio'), '')
  where id = target_id;

  delete from videos where person_id = target_id;
  insert into videos (person_id, provider, ref, title, recorded_at, position)
  select target_id, coalesce(nullif(v ->> 'provider', ''), 'youtube'), v ->> 'id',
         nullif(trim(v ->> 'title'), ''), nullif(v ->> 'recordedAt', ''), (ord - 1)::int
  from jsonb_array_elements(coalesce(changes -> 'videos', '[]'::jsonb)) with ordinality as e(v, ord)
  where coalesce(trim(v ->> 'id'), '') <> '';

  return json_build_object('id', target_id);
end
$$;

-- Supprime une personne. Ses vidéos et ses liens disparaissent avec elle ; ses parents,
-- conjoints et enfants restent dans l'arbre. Les couples devenus vides sont nettoyés.
create function api.delete_person(target_id text) returns json
language plpgsql security definer
set search_path = arbre, public
as $$
begin
  if not exists (select 1 from persons where id = target_id) then
    raise exception 'Personne introuvable dans l''arbre : %', target_id;
  end if;

  delete from persons where id = target_id;   -- vidéos et liens supprimés en cascade

  -- Union sans plus aucun parent : ses enfants n'ont plus de parents connus.
  delete from unions u
  where not exists (select 1 from union_partners up where up.union_id = u.id);
  -- Union réduite à une seule personne et sans enfant : elle ne représente plus rien.
  delete from unions u
  where (select count(*) from union_partners up where up.union_id = u.id) = 1
    and not exists (select 1 from union_children c where c.union_id = u.id);

  return json_build_object('deleted', target_id);
end
$$;

revoke execute on all functions in schema api from public;
grant usage on schema api to web_anon;
grant execute on function api.family() to web_anon;
grant execute on function api.add_person(jsonb) to web_anon;
grant execute on function api.update_person(text, jsonb) to web_anon;
grant execute on function api.delete_person(text) to web_anon;
