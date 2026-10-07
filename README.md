# 🌳 Arbre de famille

Un arbre généalogique en ligne où chaque personne a sa photo, son histoire et, surtout, **son interview vidéo**, pour que ceux qui ne l'ont pas connue puissent un jour l'entendre raconter sa vie.

Site en ligne : **https://neilooo123.github.io/Arbre-de-famille/**

> L'arbre est **privé** : il faut le **mot de passe de la famille** pour le voir. Le site n'est pas référencé par les moteurs de recherche.

---

## Utiliser le site

### Pour la famille : consulter l'arbre
Ouvrir le lien, saisir le **mot de passe de la famille**, puis cliquer ou appuyer sur une touche. On peut cocher « Se souvenir sur cet appareil ».

### Pour les administrateurs : modifier l'arbre
1. En bas de l'accueil (ou avec la clé 🔑 à droite), cliquer sur **Mode administrateur**.
2. La première fois, **Créer un compte** : adresse e-mail et mot de passe personnel. Un e-mail de confirmation est envoyé **une seule fois**. Une fois l'adresse confirmée, la demande arrive chez le propriétaire, qui l'accepte ou la refuse.
3. Ensuite : **Se connecter** avec son adresse et son mot de passe, sans aucun e-mail. On arrive directement dans l'arbre en **mode édition** : sur chaque fiche, **Modifier la fiche**, **Supprimer**, **+ Conjoint**, **+ Enfant**, **+ Parent**, **+ Frère ou sœur**.
4. **Mot de passe oublié ?** envoie un lien pour en choisir un nouveau.

Dans le formulaire, une photo choisie sur l'ordinateur est recadrée en carré, allégée et peut être pivotée. Un champ laissé vide est signalé avant l'enregistrement, et s'affiche ensuite « inconnu ».

### Pour le propriétaire : l'espace d'administration
Bouton **Espace d'administration** (fenêtre « Mode administrateur » ou bandeau du mode édition) :
- **Demandes en attente** : accepter ou refuser ;
- **Administrateurs** : retirer un accès ;
- **Mot de passe de la famille** : le changer (l'ancien cesse aussitôt de fonctionner) ;
- **Sauvegarde** : télécharger l'arbre (`family.json`) ou le restaurer depuis un fichier.

## Ajouter une interview vidéo (YouTube « non répertorié »)

1. Sur YouTube, **Créer → Importer une vidéo**.
2. À l'étape **Visibilité**, choisir **Non répertoriée** : seules les personnes qui ont le lien peuvent la voir.
3. Copier le lien de la vidéo (par ex. `https://youtu.be/XXXXXXXXXXX`) dans le champ **Interview** du formulaire.

Sur l'arbre, une pastille rouge ▶ signale les personnes qui ont une interview.

---

## Comment ça marche

- Le **site** (HTML, CSS, JavaScript, sans compilation) est hébergé gratuitement par **GitHub Pages**. Chaque `git push` sur `main` le met en ligne en une à deux minutes.
- Les **données** sont dans une base **Supabase** (PostgreSQL), jamais dans le dépôt public. Le site n'appelle que des fonctions de la base, qui vérifient chacune les droits : mot de passe de la famille pour lire, administrateur accepté pour modifier, propriétaire pour gérer les accès. Après 10 mauvais mots de passe, une adresse IP est bloquée 15 minutes.
- Les **e-mails** (confirmation de compte, mot de passe oublié) partent par **Brevo**.
- `data/family.json` ne contient qu'une famille fictive d'exemple, utilisée seulement si Supabase n'est pas configuré.

### Faire évoluer la base
La structure de la base est dans `supabase/migrations/` (fichiers SQL numérotés). Pour ajouter une évolution : créer un nouveau fichier de migration, puis l'envoyer avec l'outil Supabase :

```bash
.\tools\supabase.exe db push --linked
```

L'outil (`tools/supabase.exe`) n'est pas dans le dépôt : le télécharger depuis https://github.com/supabase/cli/releases, puis faire une fois `.\tools\supabase.exe login` et `.\tools\supabase.exe link --project-ref <identifiant du projet>`.

### Tester sur son ordinateur

```bash
python -m http.server 8000
```

puis ouvrir http://localhost:8000 : le site utilise alors la même base Supabase que le site en ligne.

---

## Organisation du code

```
index.html               La page unique
css/style.css            Le thème (couleurs en variables, mode sombre automatique)
js/app.js                Démarrage, accès, navigation (#/personne/<id>)
js/config.js             Adresse du projet Supabase et clé publique
js/data.js               Accès aux données (Supabase)
js/auth.js               Mot de passe de la famille et comptes administrateurs
js/admin.js              Fenêtre « Mode administrateur » et espace d'administration
js/tree.js               Disposition et dessin de l'arbre, zoom et déplacement
js/profile.js            Fiche d'une personne et lecteurs vidéo
js/editor.js             Formulaires : ajouter, modifier, supprimer une personne
supabase/migrations/     Structure et fonctions de la base de données
supabase/templates/      E-mails envoyés (en français)
supabase/config.toml     Réglages Supabase (connexion, e-mails)
data/family.json         Famille fictive d'exemple
```

## Et après ?

- **Vidéos privées** : le champ `provider` permet de passer de YouTube à Bunny Stream ou Cloudflare Stream (liens signés).
- **Photos en fichiers** (Supabase Storage) si l'arbre devient très grand.
- **Échange de données** : import et export au format GEDCOM, le standard des logiciels de généalogie.
