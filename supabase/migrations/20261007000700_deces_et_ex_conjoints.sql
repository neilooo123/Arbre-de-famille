-- 1. Décès coché dans le formulaire, même sans date connue (« décédé, date inconnue »).
-- 2. Ex-conjoints : un couple peut être marqué comme séparé (familles recomposées).

alter table arbre.persons add column deceased boolean not null default false;
update arbre.persons set deceased = true where death_date is not null or death_place is not null;

alter table arbre.unions add column ended boolean not null default false;

-- L'arbre complet, avec ces deux informations.
create or replace function arbre.family_json() returns json
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
        'deceased', p.deceased,
        'death', case when p.death_date is null and p.death_place is null then null
                      else json_build_object('date', p.death_date, 'place', p.death_place) end,
        'photo', p.photo,
        'bio', p.bio,
        'videos', coalesce((
          select json_agg(json_build_object(
            'provider', v.provider, 'id', v.ref, 'title', v.title, 'recordedAt', v.recorded_at
          ) order by v.position, v.id)
          from videos v where v.person_id = p.id), '[]'::json),
        'galleryCount', (select count(*) from photos ph where ph.person_id = p.id)
      ) order by p.seq)
      from persons p), '[]'::json),
    'unions', coalesce((
      select json_agg(json_build_object(
        'id', u.id,
        'partners', coalesce((
          select json_agg(up.person_id order by up.position)
          from union_partners up where up.union_id = u.id), '[]'::json),
        'date', u.date,
        'ended', u.ended
      ) order by u.seq)
      from unions u), '[]'::json),
    'children', coalesce((
      select json_agg(json_build_object('unionId', c.union_id, 'personId', c.person_id) order by c.seq)
      from union_children c), '[]'::json)
  )
$$;

-- Champs d'une personne : « deceased » coché, ou déduit d'une date/d'un lieu de décès.
create or replace function arbre.write_person_fields(target_id text, p jsonb) returns void
language plpgsql
set search_path = arbre, public
as $$
declare
  is_deceased boolean := coalesce((p ->> 'deceased')::boolean,
                                  coalesce(p -> 'death' ->> 'date', p -> 'death' ->> 'place') is not null);
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
    deceased    = is_deceased,
    death_date  = case when is_deceased then nullif(p -> 'death' ->> 'date', '') end,
    death_place = case when is_deceased then nullif(trim(p -> 'death' ->> 'place'), '') end,
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

-- Restauration d'une sauvegarde : avec « deceased » et « ended ».
create or replace function arbre.import_family(doc jsonb) returns void
language plpgsql
set search_path = arbre, public
as $$
begin
  delete from arbre.persons where true;
  delete from arbre.unions where true;

  insert into arbre.persons (id, first_name, last_name, birth_name, sex, birth_date, birth_place,
                             deceased, death_date, death_place, photo, bio)
  select p ->> 'id', p ->> 'firstName', p ->> 'lastName', p ->> 'birthName', nullif(p ->> 'sex', ''),
         nullif(p -> 'birth' ->> 'date', ''), p -> 'birth' ->> 'place',
         coalesce((p ->> 'deceased')::boolean, coalesce(p -> 'death' ->> 'date', p -> 'death' ->> 'place') is not null),
         nullif(p -> 'death' ->> 'date', ''), p -> 'death' ->> 'place',
         p ->> 'photo', p ->> 'bio'
  from jsonb_array_elements(doc -> 'persons') with ordinality as e(p, ord)
  order by ord;

  insert into arbre.videos (person_id, provider, ref, title, recorded_at, position)
  select p ->> 'id', coalesce(v ->> 'provider', 'youtube'), coalesce(v ->> 'id', v ->> 'url'),
         v ->> 'title', v ->> 'recordedAt', (vord - 1)::int
  from jsonb_array_elements(doc -> 'persons') as e(p),
       jsonb_array_elements(coalesce(p -> 'videos', '[]'::jsonb)) with ordinality as ve(v, vord);

  insert into arbre.unions (id, date, ended)
  select u ->> 'id', u ->> 'date', coalesce((u ->> 'ended')::boolean, false)
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

-- Ajouter un conjoint : « unionEnded » = true pour un ex-conjoint.
create or replace function public.add_person(payload jsonb) returns json
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
    insert into unions (id, date, ended)
    values (target_union, nullif(payload ->> 'unionDate', ''), coalesce((payload ->> 'unionEnded')::boolean, false));
    insert into union_partners (union_id, person_id, position)
    values (target_union, relative, 0), (target_union, new_id, 1);

  elsif relation = 'child' then
    if other is not null then
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

-- Relier un conjoint existant : idem, avec « unionEnded ».
create or replace function public.link_person(payload jsonb) returns json
language plpgsql volatile security definer
set search_path = arbre, public
as $$
declare
  relation text := payload ->> 'relation';
  relative text := payload ->> 'relativeId';
  target   text := payload ->> 'targetId';
  sibling_union text;
  target_parents text[];
  union_parents text[];
  new_union text;
begin
  perform arbre.require_editor();
  if relation is null or relation not in ('partner', 'child', 'parent', 'sibling') then
    raise exception 'Lien de parenté inconnu : %', relation;
  end if;
  if not exists (select 1 from persons where id = relative) or not exists (select 1 from persons where id = target) then
    raise exception 'Personne introuvable dans l''arbre.';
  end if;
  if relative = target then
    raise exception 'On ne peut pas relier une personne à elle-même.';
  end if;
  if relation <> 'partner' and arbre.are_partners(relative, target) then
    raise exception '% et % sont conjoints : ils ne peuvent pas être aussi parent, enfant, frère ou sœur.',
      arbre.full_name(relative), arbre.full_name(target);
  end if;

  if relation = 'partner' then
    if arbre.are_partners(relative, target) then
      raise exception '% et % sont déjà conjoints.', arbre.full_name(relative), arbre.full_name(target);
    end if;
    if target in (select arbre.ancestors(relative)) or relative in (select arbre.ancestors(target)) then
      raise exception '% et % sont de la même lignée (parent, grand-parent…) : ils ne peuvent pas être conjoints.',
        arbre.full_name(relative), arbre.full_name(target);
    end if;
    new_union := new_union_id();
    insert into unions (id, date, ended)
    values (new_union, nullif(payload ->> 'unionDate', ''), coalesce((payload ->> 'unionEnded')::boolean, false));
    insert into union_partners (union_id, person_id, position) values (new_union, relative, 0), (new_union, target, 1);

  elsif relation = 'child' then
    perform arbre.set_parent(target, relative);

  elsif relation = 'parent' then
    perform arbre.set_parent(relative, target);

  elsif relation = 'sibling' then
    select union_id into sibling_union from union_children where person_id = relative;
    if sibling_union is null then
      raise exception 'Ajoutez d''abord un parent à % : un frère ou une sœur se rattache aux mêmes parents.',
        arbre.full_name(relative);
    end if;
    if exists (select 1 from union_children where union_id = sibling_union and person_id = target) then
      raise exception '% est déjà frère ou sœur de %.', arbre.full_name(target), arbre.full_name(relative);
    end if;
    if target in (select arbre.ancestors(relative)) or relative in (select arbre.ancestors(target)) then
      raise exception '% et % sont de la même lignée : ils ne peuvent pas être frère et sœur.',
        arbre.full_name(relative), arbre.full_name(target);
    end if;
    select coalesce(array_agg(up.person_id), '{}') into target_parents
    from union_children c join union_partners up on up.union_id = c.union_id where c.person_id = target;
    select coalesce(array_agg(person_id), '{}') into union_parents from union_partners where union_id = sibling_union;
    if not (target_parents <@ union_parents) then
      raise exception '% a déjà d''autres parents que ceux de %.', arbre.full_name(target), arbre.full_name(relative);
    end if;
    delete from union_children where person_id = target;
    insert into union_children (union_id, person_id) values (sibling_union, target);
  end if;

  perform arbre.cleanup_unions();
  return json_build_object('id', target);
end
$$;

-- Marquer un couple comme séparé (ex-conjoints) ou de nouveau actuel.
create function public.set_union_ended(person_a text, person_b text, ended boolean) returns json
language plpgsql volatile security definer
set search_path = arbre, public
as $$
begin
  perform arbre.require_editor();
  update unions u set ended = set_union_ended.ended
  where exists (select 1 from union_partners x join union_partners y on y.union_id = x.union_id
                where x.union_id = u.id and x.person_id = person_a and y.person_id = person_b);
  if not found then
    raise exception '% et % ne sont pas conjoints.', arbre.full_name(person_a), arbre.full_name(person_b);
  end if;
  return json_build_object('ended', set_union_ended.ended);
end
$$;

revoke execute on function public.set_union_ended(text, text, boolean) from public, anon, authenticated;
grant execute on function public.set_union_ended(text, text, boolean) to authenticated;
revoke execute on function public.add_person(jsonb), public.link_person(jsonb) from public, anon;
grant execute on function public.add_person(jsonb), public.link_person(jsonb) to authenticated;
