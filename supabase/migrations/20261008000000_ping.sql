-- « Je suis là » : appelée tous les 3 jours par une tâche GitHub (.github/workflows/supabase-actif.yml)
-- pour que Supabase ne mette pas le projet en pause après 7 jours sans visite (offre gratuite).
-- Ne donne accès à aucune donnée de la famille.

create function public.ping() returns json
language sql stable
set search_path = arbre, public
as $$
  select json_build_object('ok', true, 'at', now(), 'persons', (select count(*) > 0 from arbre.persons))
$$;

revoke execute on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
