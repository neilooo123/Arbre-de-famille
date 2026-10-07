-- ping() doit lire le schéma arbre (fermé aux visiteurs) : elle s'exécute avec les droits de son propriétaire.
alter function public.ping() security definer;
