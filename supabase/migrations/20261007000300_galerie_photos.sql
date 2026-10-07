-- Galerie de photos par personne.
-- Chaque photo est gardée en deux tailles : une vignette (petite, pour la galerie) et une grande
-- version (chargée seulement quand on l'agrandit). La galerie est chargée à l'ouverture d'une fiche,
-- pas avec tout l'arbre, pour que le site reste rapide même avec beaucoup de photos.

create table arbre.photos (
  id         bigint generated always as identity primary key,
  person_id  text not null references arbre.persons on delete cascade,
  thumb      text not null,     -- vignette carrée (data URL JPEG)
  full_image text not null,     -- grande version (data URL JPEG)
  position   int  not null default 0,
  created_at timestamptz not null default now()
);
create index on arbre.photos (person_id, position, id);
revoke all on arbre.photos from public, anon, authenticated;

-- Droit de lecture : administrateur accepté, ou mot de passe de la famille (avec la même
-- protection contre les essais en rafale que family()).
create function arbre.can_read(password text) returns boolean
language plpgsql volatile security definer
set search_path = arbre, extensions, public
as $$
declare
  visitor_ip text := arbre.client_ip();
  hashed text;
begin
  if arbre.is_editor() then
    return true;
  end if;
  if (select count(*) from arbre.login_attempts a
      where a.ip = visitor_ip and a.attempted_at > now() - interval '15 minutes') >= 10 then
    return false;
  end if;
  select s.value into hashed from arbre.settings s where s.key = 'family_password';
  if hashed is null or coalesce(password, '') = '' or extensions.crypt(password, hashed) <> hashed then
    insert into arbre.login_attempts (ip) values (visitor_ip);
    perform pg_sleep(1);
    return false;
  end if;
  return true;
end
$$;

-- Nombre de photos de chaque personne, ajouté à l'arbre (champ « galleryCount ») : la fiche sait
-- ainsi s'il y a une galerie à charger, sans charger les photos elles-mêmes.
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
        'death', case when p.death_date is null and p.death_place is null then null
                      else json_build_object('date', p.death_date, 'place', p.death_place) end,
        'photo', p.photo,
        'bio', p.bio,
        'videos', coalesce((
          select json_agg(json_build_object(
            'provider', v.provider, 'id', v.ref, 'title', v.title, 'recordedAt', v.recorded_at
          ) order by v.position, v.id)
          from videos v where v.person_id = p.id), '[]'::json),
        'galleryCount', (select count(*) from photos ph where ph.person_id = p.id)
      ) order by p.seq)
      from persons p), '[]'::json),
    'unions', coalesce((
      select json_agg(json_build_object(
        'id', u.id,
        'partners', coalesce((
          select json_agg(up.person_id order by up.position)
          from union_partners up where up.union_id = u.id), '[]'::json),
        'date', u.date
      ) order by u.seq)
      from unions u), '[]'::json),
    'children', coalesce((
      select json_agg(json_build_object('unionId', c.union_id, 'personId', c.person_id) order by c.seq)
      from union_children c), '[]'::json)
  )
$$;

-- Vignettes de la galerie d'une personne : [{ id, thumb }], ou { error } sans droit de lecture.
create function public.person_photos(target_id text, password text default null) returns json
language plpgsql volatile security definer
set search_path = arbre, public
as $$
begin
  if not arbre.can_read(password) then
    return json_build_object('error', 'wrong_password');
  end if;
  return coalesce((
    select json_agg(json_build_object('id', id, 'thumb', thumb) order by position, id)
    from photos where person_id = target_id), '[]'::json);
end
$$;

-- Grande version d'une photo : { id, full }, ou { error }.
create function public.photo_full(photo_id bigint, password text default null) returns json
language plpgsql volatile security definer
set search_path = arbre, public
as $$
declare
  result json;
begin
  if not arbre.can_read(password) then
    return json_build_object('error', 'wrong_password');
  end if;
  select json_build_object('id', id, 'full', full_image) into result from photos where id = photo_id;
  return coalesce(result, json_build_object('error', 'not_found'));
end
$$;

-- Ajoute une photo à la galerie (administrateurs acceptés). Renvoie { id, thumb }.
create function public.add_photo(target_id text, thumb text, full_image text) returns json
language plpgsql volatile security definer
set search_path = arbre, public
as $$
declare
  new_id bigint;
begin
  perform arbre.require_editor();
  if not exists (select 1 from persons where id = target_id) then
    raise exception 'Personne introuvable dans l''arbre : %', target_id;
  end if;
  if thumb !~ '^data:image/' or full_image !~ '^data:image/' then
    raise exception 'Ce fichier n''est pas une image.';
  end if;
  insert into photos (person_id, thumb, full_image, position)
  values (target_id, thumb, full_image,
          coalesce((select max(position) + 1 from photos where person_id = target_id), 0))
  returning id into new_id;
  return json_build_object('id', new_id, 'thumb', thumb);
end
$$;

-- Supprime une photo de la galerie (administrateurs acceptés).
create function public.delete_photo(photo_id bigint) returns json
language plpgsql volatile security definer
set search_path = arbre, public
as $$
begin
  perform arbre.require_editor();
  delete from photos where id = photo_id;
  if not found then
    raise exception 'Photo introuvable.';
  end if;
  return json_build_object('deleted', photo_id);
end
$$;

-- Sauvegarde complète des galeries (propriétaire) : [{ personId, thumb, full }].
create function public.admin_export_photos() returns json
language plpgsql stable security definer
set search_path = arbre, public
as $$
begin
  perform arbre.require_owner();
  return coalesce((
    select json_agg(json_build_object('personId', person_id, 'thumb', thumb, 'full', full_image)
                    order by person_id, position, id)
    from photos), '[]'::json);
end
$$;

-- La restauration reprend aussi les photos de galerie (champ « photos » de la sauvegarde, facultatif).
create or replace function public.admin_import(doc jsonb) returns json
language plpgsql volatile security definer
set search_path = arbre, public
as $$
begin
  perform arbre.require_owner();
  perform arbre.import_family(doc);   -- vide aussi les galeries (suppression en cascade)
  insert into photos (person_id, thumb, full_image, position)
  select ph ->> 'personId', ph ->> 'thumb', ph ->> 'full', (ord - 1)::int
  from jsonb_array_elements(coalesce(doc -> 'photos', '[]'::jsonb)) with ordinality as e(ph, ord)
  where exists (select 1 from persons where id = ph ->> 'personId')
    and ph ->> 'thumb' ~ '^data:image/' and ph ->> 'full' ~ '^data:image/';
  return json_build_object('persons', (select count(*) from persons),
                           'photos', (select count(*) from photos));
end
$$;

-- ---------- Droits d'exécution ----------
revoke execute on function arbre.can_read(text) from public, anon, authenticated;
revoke execute on function
  public.person_photos(text, text), public.photo_full(bigint, text),
  public.add_photo(text, text, text), public.delete_photo(bigint),
  public.admin_export_photos(), public.admin_import(jsonb)
from public, anon, authenticated;

grant execute on function public.person_photos(text, text), public.photo_full(bigint, text) to anon, authenticated;
grant execute on function
  public.add_photo(text, text, text), public.delete_photo(bigint),
  public.admin_export_photos(), public.admin_import(jsonb)
to authenticated;
