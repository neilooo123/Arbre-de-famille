-- Toute la famille (avec le mot de passe de la famille) peut ajouter des photos aux galeries.
-- Modifier ou supprimer une photo reste réservé aux administrateurs.

drop function public.add_photo(text, text, text, text, jsonb);
create function public.add_photo(target_id text, thumb text, full_image text,
                                 caption text default null, tags jsonb default '[]',
                                 password text default null) returns json
language plpgsql volatile security definer
set search_path = arbre, public
as $$
declare
  new_id bigint;
  clean_caption text := nullif(trim(caption), '');
begin
  -- Administrateur accepté, ou mot de passe de la famille (avec la protection contre les essais en rafale).
  if not arbre.is_editor() and not arbre.can_read(password) then
    raise exception 'Mot de passe de la famille incorrect.';
  end if;
  if not exists (select 1 from persons where id = target_id) then
    raise exception 'Personne introuvable dans l''arbre : %', target_id;
  end if;
  if thumb !~ '^data:image/' or full_image !~ '^data:image/' then
    raise exception 'Ce fichier n''est pas une image.';
  end if;
  -- Les photos préparées par le site font environ 20 Ko et 300 Ko : on refuse ce qui est bien au-delà.
  if length(thumb) > 200000 or length(full_image) > 4000000 then
    raise exception 'Cette photo est trop lourde.';
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

revoke execute on function public.add_photo(text, text, text, text, jsonb, text) from public;
grant execute on function public.add_photo(text, text, text, text, jsonb, text) to anon, authenticated;
