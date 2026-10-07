-- Optimisation : l'arbre ne reçoit plus les portraits en grand (600 px, ~60 Ko chacun) mais une
-- vignette (240 px, ~12 Ko). Le portrait en grand est chargé à la demande (agrandissement, modification).

alter table arbre.persons add column photo_thumb text;

-- L'arbre complet : « photo » = la vignette (ou le portrait si sa vignette n'existe pas encore) ;
-- « photoThumbMissing » signale aux administrateurs les vignettes à fabriquer.
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
        'photo', coalesce(p.photo_thumb, p.photo),
        'photoThumbMissing', p.photo is not null and p.photo_thumb is null,
        'bio', p.bio,
        'videos', coalesce((
          select json_agg(json_build_object(
            'provider', v.provider, 'id', v.ref, 'title', v.title, 'recordedAt', v.recorded_at
          ) order by v.position, v.id)
          from videos v where v.person_id = p.id), '[]'::json),
        'galleryCount', (select count(*) from arbre.photos_of(p.id))
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

-- Champs d'une personne. Le portrait n'est modifié que s'il est envoyé (clé « photo » présente) :
-- modifier le nom d'une personne ne renvoie plus son portrait.
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
    photo       = case when p ? 'photo' then nullif(trim(p ->> 'photo'), '') else photo end,
    photo_thumb = case when p ? 'photo' then nullif(trim(p ->> 'photoThumb'), '') else photo_thumb end,
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

-- Portrait en grand d'une personne : { photo }, ou { error }.
create function public.person_portrait(target_id text, password text default null) returns json
language plpgsql volatile security definer
set search_path = arbre, public
as $$
begin
  if not arbre.can_read(password) then
    return json_build_object('error', 'wrong_password');
  end if;
  return json_build_object('photo', (select photo from persons where id = target_id));
end
$$;

-- Vignettes fabriquées par le navigateur d'un administrateur : [{ id, thumb }].
-- Seuls les portraits qui n'en ont pas encore sont complétés.
create function public.set_portrait_thumbs(items jsonb) returns json
language plpgsql volatile security definer
set search_path = arbre, public
as $$
declare
  n int;
begin
  perform arbre.require_editor();
  update persons p set photo_thumb = i ->> 'thumb'
  from jsonb_array_elements(coalesce(items, '[]'::jsonb)) as e(i)
  where p.id = i ->> 'id' and p.photo is not null and p.photo_thumb is null
    and i ->> 'thumb' ~ '^data:image/';
  get diagnostics n = row_count;
  return json_build_object('updated', n);
end
$$;

-- Portraits en grand de tout l'arbre, pour une sauvegarde complète : { id: photo }.
create function public.export_portraits() returns json
language plpgsql stable security definer
set search_path = arbre, public
as $$
begin
  perform arbre.require_editor();
  return coalesce((select json_object_agg(id, photo) from persons where photo is not null), '{}'::json);
end
$$;

revoke execute on function public.person_portrait(text, text), public.set_portrait_thumbs(jsonb), public.export_portraits()
from public, anon, authenticated;
grant execute on function public.person_portrait(text, text) to anon, authenticated;
grant execute on function public.set_portrait_thumbs(jsonb), public.export_portraits() to authenticated;
