-- La sauvegarde complète (portraits en grand) est réservée au propriétaire du site.

create or replace function public.export_portraits() returns json
language plpgsql stable security definer
set search_path = arbre, public
as $$
begin
  perform arbre.require_owner();
  return coalesce((select json_object_agg(id, photo) from persons where photo is not null), '{}'::json);
end
$$;
