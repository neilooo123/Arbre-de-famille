-- Remplit la base, à sa création, avec le contenu de data/family.json
-- (monté dans le conteneur sous /seed/family.json par docker-compose.yml).

do $$
declare
  doc jsonb := pg_read_file('/seed/family.json')::jsonb;
begin
  insert into arbre.persons (id, first_name, last_name, birth_name, sex, birth_date, birth_place,
                             death_date, death_place, photo, bio)
  select p ->> 'id', p ->> 'firstName', p ->> 'lastName', p ->> 'birthName', p ->> 'sex',
         p -> 'birth' ->> 'date', p -> 'birth' ->> 'place',
         p -> 'death' ->> 'date', p -> 'death' ->> 'place',
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
