-- Supabase a jugé l'activité insuffisante malgré un appel en lecture tous les 3 jours.
-- ping() écrit désormais une petite ligne (un « battement de cœur ») à chaque appel : une vraie
-- activité de la base. Les lignes de plus de 30 jours sont effacées au passage.

create table if not exists arbre.heartbeat (
  id bigint generated always as identity primary key,
  at timestamptz not null default now()
);
revoke all on arbre.heartbeat from public, anon, authenticated;

create or replace function public.ping() returns json
language plpgsql volatile security definer
set search_path = arbre, public
as $$
begin
  insert into heartbeat default values;
  delete from heartbeat where at < now() - interval '30 days';
  return json_build_object('ok', true, 'at', now(), 'beats', (select count(*) from heartbeat));
end
$$;

revoke execute on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
