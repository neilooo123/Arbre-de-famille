-- Relier deux personnes déjà présentes dans l'arbre (au lieu d'en créer une nouvelle) :
-- conjoint, enfant, parent ou frère/sœur. Les parents déjà connus sont conservés : par exemple,
-- relier Séverine (fille de Christine) comme enfant de Michel (conjoint de Christine) en fait
-- l'enfant du couple Michel + Christine.

-- Ancêtres d'une personne (parents, grands-parents…), pour refuser les boucles impossibles.
create function arbre.ancestors(pid text) returns setof text
language sql stable
set search_path = arbre, public
as $$
  with recursive a(id) as (
    select up.person_id
    from union_children c join union_partners up on up.union_id = c.union_id
    where c.person_id = pid
    union
    select up.person_id
    from a join union_children c on c.person_id = a.id
           join union_partners up on up.union_id = c.union_id
  )
  select id from a
$$;

create function arbre.full_name(pid text) returns text
language sql stable
set search_path = arbre, public
as $$
  select concat_ws(' ', first_name, last_name) from persons where id = pid
$$;

-- Supprime les couples devenus inutiles : sans aucun parent, ou réduits à une personne sans enfant.
create function arbre.cleanup_unions() returns void
language sql
set search_path = arbre, public
as $$
  delete from unions u
  where not exists (select 1 from union_partners up where up.union_id = u.id);
  delete from unions u
  where (select count(*) from union_partners up where up.union_id = u.id) = 1
    and not exists (select 1 from union_children c where c.union_id = u.id);
$$;

-- Fait de `parent` un parent de `child`, en gardant les parents que `child` a déjà.
create function arbre.set_parent(child text, parent text) returns void
language plpgsql
set search_path = arbre, public
as $$
declare
  old_union text;
  current_parents text[];
  wanted text[];
  target_union text;
begin
  if child = parent then
    raise exception 'Une personne ne peut pas être son propre parent.';
  end if;
  if child in (select arbre.ancestors(parent)) then
    raise exception '% est un ancêtre de % : ce lien créerait une boucle impossible.',
      arbre.full_name(child), arbre.full_name(parent);
  end if;

  select union_id into old_union from union_children where person_id = child;
  select coalesce(array_agg(person_id order by position), '{}') into current_parents
  from union_partners where union_id = old_union;

  if parent = any(current_parents) then
    raise exception '% est déjà un parent de %.', arbre.full_name(parent), arbre.full_name(child);
  end if;
  wanted := current_parents || parent;
  if cardinality(wanted) > 2 then
    raise exception '% a déjà deux parents (% et %).', arbre.full_name(child),
      arbre.full_name(current_parents[1]), arbre.full_name(current_parents[2]);
  end if;

  -- Le couple formé par exactement ces parents, s'il existe déjà ; sinon on le crée.
  select u.id into target_union
  from unions u
  where (select count(*) from union_partners up where up.union_id = u.id) = cardinality(wanted)
    and not exists (select 1 from union_partners up where up.union_id = u.id and up.person_id <> all(wanted))
  limit 1;
  if target_union is null then
    target_union := new_union_id();
    insert into unions (id) values (target_union);
    insert into union_partners (union_id, person_id, position)
    select target_union, p, (ord - 1)::int from unnest(wanted) with ordinality as w(p, ord);
  end if;

  delete from union_children where person_id = child;
  insert into union_children (union_id, person_id) values (target_union, child);
end
$$;

-- payload = { relation: 'partner' | 'child' | 'parent' | 'sibling', relativeId, targetId, unionDate }
--   relativeId : la personne dont on ouvre la fiche ; targetId : la personne existante à relier.
-- Renvoie { id: targetId }.
create function public.link_person(payload jsonb) returns json
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

  if relation = 'partner' then
    if exists (select 1 from union_partners a join union_partners b on b.union_id = a.union_id
               where a.person_id = relative and b.person_id = target) then
      raise exception '% et % sont déjà conjoints.', arbre.full_name(relative), arbre.full_name(target);
    end if;
    if target in (select arbre.ancestors(relative)) or relative in (select arbre.ancestors(target)) then
      raise exception '% et % sont de la même lignée (parent, grand-parent…) : ils ne peuvent pas être conjoints.',
        arbre.full_name(relative), arbre.full_name(target);
    end if;
    new_union := new_union_id();
    insert into unions (id, date) values (new_union, nullif(payload ->> 'unionDate', ''));
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

revoke execute on function arbre.ancestors(text), arbre.full_name(text), arbre.cleanup_unions(),
                          arbre.set_parent(text, text)
from public, anon, authenticated;
revoke execute on function public.link_person(jsonb) from public, anon, authenticated;
grant execute on function public.link_person(jsonb) to authenticated;
