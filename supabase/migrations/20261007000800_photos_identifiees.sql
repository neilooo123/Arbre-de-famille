-- Personnes identifiées sur une photo de galerie : la photo apparaît aussi dans leur galerie.

create table arbre.photo_tags (
  photo_id  bigint not null references arbre.photos on delete cascade,
  person_id text   not null references arbre.persons on delete cascade,
  primary key (photo_id, person_id)
);
create index on arbre.photo_tags (person_id);
revoke all on arbre.photo_tags from public, anon, authenticated;

-- Photos d'une personne : les siennes et celles où elle est identifiée.
create function arbre.photos_of(pid text) returns setof arbre.photos
language sql stable
set search_path = arbre, public
as $$
  select ph.* from photos ph
  where ph.person_id = pid
     or exists (select 1 from photo_tags t where t.photo_id = ph.id and t.person_id = pid)
$$;

-- Enregistre la liste des personnes identifiées (sans la personne qui « possède » la photo).
create function arbre.set_photo_tags(target_photo bigint, tags jsonb) returns void
language sql
set search_path = arbre, public
as $$
  delete from photo_tags where photo_id = target_photo;
  insert into photo_tags (photo_id, person_id)
  select distinct target_photo, t
  from jsonb_array_elements_text(coalesce(tags, '[]'::jsonb)) as e(t)
  where exists (select 1 from persons where id = t)
    and t <> (select person_id from photos where id = target_photo);
$$;

-- Nombre de photos dans la galerie de chacun : les siennes + celles où il est identifié.
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

-- Galerie d'une personne : [{ id, thumb, caption, owner, tags }].
create or replace function public.person_photos(target_id text, password text default null) returns json
language plpgsql volatile security definer
set search_path = arbre, public
as $$
begin
  if not arbre.can_read(password) then
    return json_build_object('error', 'wrong_password');
  end if;
  return coalesce((
    select json_agg(json_build_object(
      'id', ph.id, 'thumb', ph.thumb, 'caption', ph.caption, 'owner', ph.person_id,
      'tags', coalesce((select json_agg(t.person_id) from photo_tags t where t.photo_id = ph.id), '[]'::json)
    ) order by ph.person_id <> target_id, ph.position, ph.id)
    from arbre.photos_of(target_id) ph), '[]'::json);
end
$$;

-- Ajout d'une photo : avec sa légende et les personnes identifiées.
drop function public.add_photo(text, text, text, text);
create function public.add_photo(target_id text, thumb text, full_image text,
                                 caption text default null, tags jsonb default '[]') returns json
language plpgsql volatile security definer
set search_path = arbre, public
as $$
declare
  new_id bigint;
  clean_caption text := nullif(trim(caption), '');
begin
  perform arbre.require_editor();
  if not exists (select 1 from persons where id = target_id) then
    raise exception 'Personne introuvable dans l''arbre : %', target_id;
  end if;
  if thumb !~ '^data:image/' or full_image !~ '^data:image/' then
    raise exception 'Ce fichier n''est pas une image.';
  end if;
  if length(clean_caption) > 300 then
    raise exception 'La légende est trop longue (300 caractères au plus).';
  end if;
  insert into photos (person_id, thumb, full_image, caption, position)
  values (target_id, thumb, full_image, clean_caption,
          coalesce((select max(position) + 1 from photos where person_id = target_id), 0))
  returning id into new_id;
  perform arbre.set_photo_tags(new_id, tags);
  return json_build_object('id', new_id);
end
$$;

-- Modifier la légende et les personnes identifiées d'une photo.
create function public.update_photo(photo_id bigint, caption text, tags jsonb default '[]') returns json
language plpgsql volatile security definer
set search_path = arbre, public
as $$
declare
  clean_caption text := nullif(trim(caption), '');
begin
  perform arbre.require_editor();
  if length(clean_caption) > 300 then
    raise exception 'La légende est trop longue (300 caractères au plus).';
  end if;
  update photos set caption = clean_caption where id = photo_id;
  if not found then
    raise exception 'Photo introuvable.';
  end if;
  perform arbre.set_photo_tags(photo_id, tags);
  return json_build_object('id', photo_id, 'caption', clean_caption,
    'tags', coalesce((select json_agg(person_id) from photo_tags where photo_tags.photo_id = update_photo.photo_id), '[]'::json));
end
$$;

-- Sauvegarde et restauration : avec les personnes identifiées.
create or replace function public.admin_export_photos() returns json
language plpgsql stable security definer
set search_path = arbre, public
as $$
begin
  perform arbre.require_owner();
  return coalesce((
    select json_agg(json_build_object(
      'personId', ph.person_id, 'thumb', ph.thumb, 'full', ph.full_image, 'caption', ph.caption,
      'tags', coalesce((select json_agg(t.person_id) from photo_tags t where t.photo_id = ph.id), '[]'::json)
    ) order by ph.person_id, ph.position, ph.id)
    from photos ph), '[]'::json);
end
$$;

create or replace function public.admin_import(doc jsonb) returns json
language plpgsql volatile security definer
set search_path = arbre, public
as $$
declare
  ph jsonb;
  new_id bigint;
  pos int := 0;
begin
  perform arbre.require_owner();
  perform arbre.import_family(doc);   -- vide aussi les galeries (suppression en cascade)
  for ph in select value from jsonb_array_elements(coalesce(doc -> 'photos', '[]'::jsonb)) loop
    continue when not exists (select 1 from persons where id = ph ->> 'personId')
               or coalesce(ph ->> 'thumb', '') !~ '^data:image/' or coalesce(ph ->> 'full', '') !~ '^data:image/';
    insert into photos (person_id, thumb, full_image, caption, position)
    values (ph ->> 'personId', ph ->> 'thumb', ph ->> 'full', left(nullif(trim(ph ->> 'caption'), ''), 300), pos)
    returning id into new_id;
    perform arbre.set_photo_tags(new_id, ph -> 'tags');
    pos := pos + 1;
  end loop;
  return json_build_object('persons', (select count(*) from persons),
                           'photos', (select count(*) from photos));
end
$$;

revoke execute on function arbre.photos_of(text), arbre.set_photo_tags(bigint, jsonb) from public, anon, authenticated;
revoke execute on function public.add_photo(text, text, text, text, jsonb), public.update_photo(bigint, text, jsonb)
from public, anon, authenticated;
grant execute on function public.add_photo(text, text, text, text, jsonb), public.update_photo(bigint, text, jsonb)
to authenticated;
