-- Relier : un conjoint ne peut pas devenir aussi l'enfant, le parent ou le frère/la sœur.

create or replace function arbre.are_partners(a text, b text) returns boolean
language sql stable
set search_path = arbre, public
as $$
  select exists (select 1 from union_partners x join union_partners y on y.union_id = x.union_id
                 where x.person_id = a and y.person_id = b)
$$;

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

revoke execute on function arbre.are_partners(text, text) from public, anon, authenticated;
revoke execute on function public.link_person(jsonb) from public, anon, authenticated;
grant execute on function public.link_person(jsonb) to authenticated;
