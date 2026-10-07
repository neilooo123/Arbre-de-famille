-- Données de test pour la copie locale de Supabase (lancée par « supabase start », dans Docker).
-- Rejouées à chaque « supabase db reset ». Ce fichier n'est JAMAIS envoyé sur le Supabase en ligne.
--
--   Mot de passe de la famille (local) : famille-test
--   Propriétaire (local)               : proprietaire@example.com
--   E-mails reçus en local             : http://127.0.0.1:54324 (boîte de réception de test)

select arbre.import_family($famille${
  "persons": [
    {
      "id": "jean-moreau-1932",
      "firstName": "Jean",
      "lastName": "Moreau",
      "sex": "M",
      "birth": {
        "date": "1932-04-12",
        "place": "Annecy"
      },
      "death": {
        "date": "2019-11-03",
        "place": "Annecy"
      },
      "photo": null,
      "bio": "Personne fictive d'exemple.\n\nMenuisier de métier, Jean passait ses dimanches en montagne. Il disait que le bois « se travaille dans le sens du vent ».",
      "videos": []
    },
    {
      "id": "marie-lefevre-1935",
      "firstName": "Marie",
      "lastName": "Moreau",
      "sex": "F",
      "birthName": "Lefèvre",
      "birth": {
        "date": "1935-09-02",
        "place": "Chambéry"
      },
      "death": null,
      "photo": null,
      "bio": "Personne fictive d'exemple.\n\nInstitutrice pendant quarante ans, Marie connaît le nom de chaque arbre du jardin.",
      "videos": []
    },
    {
      "id": "paul-moreau-1958",
      "firstName": "Paul",
      "lastName": "Moreau",
      "sex": "M",
      "birth": {
        "date": "1958",
        "place": "Annecy"
      },
      "death": null,
      "photo": null,
      "bio": "Personne fictive d'exemple.",
      "videos": []
    },
    {
      "id": "claire-dubois-1960",
      "firstName": "Claire",
      "lastName": "Moreau",
      "sex": "F",
      "birthName": "Dubois",
      "birth": {
        "date": "1960-06",
        "place": "Lyon"
      },
      "death": null,
      "photo": null,
      "bio": "Personne fictive d'exemple.",
      "videos": []
    },
    {
      "id": "anne-moreau-1962",
      "firstName": "Anne",
      "lastName": "Moreau",
      "sex": "F",
      "birth": {
        "date": "1962-02-20",
        "place": "Annecy"
      },
      "death": null,
      "photo": null,
      "bio": "Personne fictive d'exemple.",
      "videos": []
    },
    {
      "id": "lucas-moreau-1988",
      "firstName": "Lucas",
      "lastName": "Moreau",
      "sex": "M",
      "birth": {
        "date": "1988",
        "place": "Lyon"
      },
      "death": null,
      "photo": null,
      "bio": "Personne fictive d'exemple.",
      "videos": []
    },
    {
      "id": "emma-moreau-1991",
      "firstName": "Emma",
      "lastName": "Moreau",
      "sex": "F",
      "birth": {
        "date": "1991",
        "place": "Lyon"
      },
      "death": null,
      "photo": null,
      "bio": "Personne fictive d'exemple.",
      "videos": []
    }
  ],
  "unions": [
    {
      "id": "u-jean-marie",
      "partners": [
        "jean-moreau-1932",
        "marie-lefevre-1935"
      ],
      "date": "1956"
    },
    {
      "id": "u-paul-claire",
      "partners": [
        "paul-moreau-1958",
        "claire-dubois-1960"
      ],
      "date": "1986"
    }
  ],
  "children": [
    {
      "unionId": "u-jean-marie",
      "personId": "paul-moreau-1958"
    },
    {
      "unionId": "u-jean-marie",
      "personId": "anne-moreau-1962"
    },
    {
      "unionId": "u-paul-claire",
      "personId": "lucas-moreau-1988"
    },
    {
      "unionId": "u-paul-claire",
      "personId": "emma-moreau-1991"
    }
  ]
}$famille$::jsonb);

insert into arbre.settings (key, value)
values ('family_password', extensions.crypt('famille-test', extensions.gen_salt('bf')));

insert into arbre.admins (email, role, status, decided_at)
values ('proprietaire@example.com', 'owner', 'approved', now());
