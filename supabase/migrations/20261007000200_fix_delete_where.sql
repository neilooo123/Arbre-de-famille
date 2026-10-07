-- Correction : Supabase refuse, pour les appels venant du site, tout DELETE sans clause WHERE
-- (protection « safeupdate »). On ajoute une condition explicite partout où on vide une table.

create or replace function public.set_family_password(new_password text) returns json
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
  -- Nouveau mot de passe : on efface les essais ratés enregistrés.
  delete from login_attempts where true;
  return json_build_object('ok', true);
end
$$;

create or replace function arbre.import_family(doc jsonb) returns void
language plpgsql
set search_path = arbre, public
as $$
begin
  delete from arbre.persons where true;
  delete from arbre.unions where true;

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

revoke execute on function public.set_family_password(text) from public, anon;
grant execute on function public.set_family_password(text) to authenticated;
revoke execute on function arbre.import_family(jsonb) from public, anon, authenticated;
