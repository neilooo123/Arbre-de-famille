#!/bin/sh
# Rôles utilisés par l'API (PostgREST) :
#   authenticator : le compte avec lequel l'API se connecte ;
#   web_anon      : les droits accordés aux visiteurs (ici : lire l'arbre et ajouter des personnes).
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
     -v pw="$AUTHENTICATOR_PASSWORD" <<'EOSQL'
create role web_anon nologin;
create role authenticator noinherit login password :'pw';
grant web_anon to authenticator;
EOSQL
