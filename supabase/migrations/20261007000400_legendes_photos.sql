-- Légende facultative pour chaque photo de galerie (300 caractères au plus).

alter table arbre.photos add column caption text check (length(caption) <= 300);

create or replace function public.person_photos(target_id text, password text default null) returns json
language plpgsql volatile security definer
set search_path = arbre, public
as $$
begin
  if not arbre.can_read(password) then
    return json_build_object('error', 'wrong_password');
  end if;
  return coalesce((
    select json_agg(json_build_object('id', id, 'thumb', thumb, 'caption', caption) order by position, id)
    from photos where person_id = target_id), '[]'::json);
end
$$;

-- add_photo reçoit maintenant la légende.
drop function public.add_photo(text, text, text);
create function public.add_photo(target_id text, thumb text, full_image text, caption text default null) returns json
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
  return json_build_object('id', new_id, 'thumb', thumb, 'caption', clean_caption);
end
$$;

-- Ajouter ou changer la légende d'une photo (administrateurs acceptés).
create function public.update_photo_caption(photo_id bigint, caption text) returns json
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
  return json_build_object('id', photo_id, 'caption', clean_caption);
end
$$;

-- Sauvegarde et restauration : avec les légendes.
create or replace function public.admin_export_photos() returns json
language plpgsql stable security definer
set search_path = arbre, public
as $$
begin
  perform arbre.require_owner();
  return coalesce((
    select json_agg(json_build_object('personId', person_id, 'thumb', thumb, 'full', full_image, 'caption', caption)
                    order by person_id, position, id)
    from photos), '[]'::json);
end
$$;

create or replace function public.admin_import(doc jsonb) returns json
language plpgsql volatile security definer
set search_path = arbre, public
as $$
begin
  perform arbre.require_owner();
  perform arbre.import_family(doc);   -- vide aussi les galeries (suppression en cascade)
  insert into photos (person_id, thumb, full_image, caption, position)
  select ph ->> 'personId', ph ->> 'thumb', ph ->> 'full', left(nullif(trim(ph ->> 'caption'), ''), 300), (ord - 1)::int
  from jsonb_array_elements(coalesce(doc -> 'photos', '[]'::jsonb)) with ordinality as e(ph, ord)
  where exists (select 1 from persons where id = ph ->> 'personId')
    and ph ->> 'thumb' ~ '^data:image/' and ph ->> 'full' ~ '^data:image/';
  return json_build_object('persons', (select count(*) from persons),
                           'photos', (select count(*) from photos));
end
$$;

revoke execute on function
  public.add_photo(text, text, text, text), public.update_photo_caption(bigint, text)
from public, anon, authenticated;
grant execute on function
  public.add_photo(text, text, text, text), public.update_photo_caption(bigint, text)
to authenticated;
