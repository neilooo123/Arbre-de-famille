-- Correction : dans family(), la variable « family.ip » était lue comme une table.
-- On utilise une variable au nom sans ambiguïté.

create or replace function public.family(password text) returns json
language plpgsql volatile security definer
set search_path = arbre, extensions, public
as $$
declare
  visitor_ip text := arbre.client_ip();
  hashed text;
begin
  if (select count(*) from arbre.login_attempts a
      where a.ip = visitor_ip and a.attempted_at > now() - interval '15 minutes') >= 10 then
    return json_build_object('error', 'too_many_attempts');
  end if;

  select s.value into hashed from arbre.settings s where s.key = 'family_password';
  if hashed is null or coalesce(password, '') = '' or extensions.crypt(password, hashed) <> hashed then
    insert into arbre.login_attempts (ip) values (visitor_ip);
    delete from arbre.login_attempts where attempted_at < now() - interval '1 day';
    perform pg_sleep(1);
    return json_build_object('error', 'wrong_password');
  end if;

  delete from arbre.login_attempts a where a.ip = visitor_ip;
  return arbre.family_json();
end
$$;

revoke execute on function public.family(text) from public;
grant execute on function public.family(text) to anon, authenticated;
