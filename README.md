# 🌳 Arbre de famille

Un arbre généalogique en ligne où chaque personne a sa photo, son histoire et, surtout, **son interview vidéo**, pour que ceux qui ne l'ont pas connue puissent un jour l'entendre raconter sa vie.

Site en ligne : **https://neilooo123.github.io/Arbre-de-famille/**

> Le site est public mais n'est pas référencé par les moteurs de recherche (balise `noindex`). Ne partage le lien qu'avec la famille. Un vrai accès protégé est prévu pour plus tard (voir « Et après ? »).

---

## Ajouter ou modifier une personne

Tout se passe dans un seul fichier : [`data/family.json`](data/family.json). Il contient trois listes.

### 1. `persons` : les personnes

```json
{
  "id": "jean-moreau-1932",
  "firstName": "Jean",
  "lastName": "Moreau",
  "sex": "M",
  "birthName": null,
  "birth": { "date": "1932-04-12", "place": "Annecy" },
  "death": { "date": "2019-11-03", "place": "Annecy" },
  "photo": "images/personnes/jean-moreau.jpg",
  "bio": "Premier paragraphe.\n\nDeuxième paragraphe.",
  "videos": [
    { "provider": "youtube", "id": "https://www.youtube.com/watch?v=XXXXXXXXXXX", "title": "Interview de Jean", "recordedAt": "2018-07-14" }
  ]
}
```

| Champ | À savoir |
|---|---|
| `id` | Identifiant unique, **sans espace ni accent**, qui ne change plus jamais (il sert dans les liens). Modèle conseillé : `prenom-nom-annee`. |
| `sex` | `"M"` ou `"F"`, pour accorder « Né / Née ». Facultatif. |
| `birthName` | Nom de naissance s'il est différent (affiché « Née Dubois »). Sinon `null`. |
| `birth`, `death` | `date` au format `"1932"`, `"1932-04"` ou `"1932-04-12"`. Mettre `"death": null` si la personne est vivante. |
| `photo` | Chemin vers la photo, ou `null` (les initiales s'affichent alors). |
| `bio` | Texte libre. `\n\n` sépare deux paragraphes. |
| `videos` | Liste d'interviews, éventuellement vide : `[]`. Pour `id`, tu peux coller **le lien YouTube complet**. |

### 2. `unions` : les couples

```json
{ "id": "u-jean-marie", "partners": ["jean-moreau-1932", "marie-lefevre-1935"], "date": "1956" }
```

### 3. `children` : qui est l'enfant de quel couple

```json
{ "unionId": "u-jean-marie", "personId": "paul-moreau-1958" }
```

Pour un parent seul, crée une union avec un seul partenaire : `"partners": ["jean-moreau-1932"]`.

⚠️ **Attention aux virgules** : en JSON, chaque élément d'une liste est suivi d'une virgule, **sauf le dernier**. En cas de doute, colle le fichier sur https://jsonlint.com pour le vérifier.

---

## Ajouter une photo

**Depuis le site (mode édition)** : dans le formulaire, clique sur **Choisir une photo…** ou glisse une image sur la zone prévue. Elle est recadrée en carré (centré), réduite à 600 × 600 pixels et enregistrée avec la personne : rien d'autre à faire. Les photos HEIC d'iPhone ne sont pas lisibles par les navigateurs : utilise du JPG ou du PNG.

**À la main, dans `family.json`** :

1. Recadre la photo en carré autour du visage.
2. Réduis-la à environ **800 × 800 pixels** (avec https://squoosh.app par exemple), au format JPG.
3. Dépose-la dans `images/personnes/`, avec un nom sans espace ni accent : `jean-moreau.jpg`.
4. Dans `family.json`, indique `"photo": "images/personnes/jean-moreau.jpg"`.

## Ajouter une interview vidéo (YouTube « non répertorié »)

1. Sur YouTube, clique sur **Créer → Importer une vidéo**.
2. À l'étape **Visibilité**, choisis **Non répertoriée** : seules les personnes qui ont le lien (donc ce site) peuvent la voir.
3. Copie le lien de la vidéo (par ex. `https://youtu.be/XXXXXXXXXXX`).
4. Ajoute-le dans `videos` :
   ```json
   "videos": [ { "provider": "youtube", "id": "https://youtu.be/XXXXXXXXXXX", "title": "Interview de Jean", "recordedAt": "2026-08-15" } ]
   ```

Sur la page, une pastille rouge ▶ signale les personnes qui ont une interview.

---

## Tester sur ton ordinateur

Ouvrir `index.html` en double-cliquant dessus **ne fonctionne pas** : le navigateur bloque la lecture de `family.json`. Dans un terminal, depuis le dossier du projet, lance :

```bash
python -m http.server 8000
```

puis ouvre http://localhost:8000.

## Ajouter des personnes depuis le site (base locale Docker)

Sur ton ordinateur, le site peut s'appuyer sur une vraie base de données (PostgreSQL) qui tourne dans Docker. On ajoute alors les personnes directement depuis l'arbre, sans toucher au JSON.

1. Installe **Docker Desktop** : https://www.docker.com/products/docker-desktop/ (redémarrage demandé).
2. Dans le dossier du projet, démarre la base (la première fois, elle est remplie avec `data/family.json`) :
   ```bash
   docker compose up -d
   ```
3. Lance le site (`python -m http.server 8000`) et ouvre http://localhost:8000.
4. Clique sur le **crayon** en bas à droite pour passer en mode édition. Sur la fiche d'une personne apparaissent :
   - **Modifier la fiche** : nom, dates, histoire, photo, interview (l'identifiant de la personne ne change pas, même si son nom change) ;
   - **Supprimer** : après confirmation, la personne disparaît ; ses parents, conjoints et enfants restent dans l'arbre ;
   - **+ Conjoint**, **+ Enfant**, **+ Parent**, **+ Frère ou sœur** : un formulaire, et la nouvelle personne est placée dans l'arbre selon son lien de parenté.

   Dans le formulaire, une photo choisie peut être pivotée d'un quart de tour à gauche ou à droite.
5. Pour publier les ajouts sur GitHub Pages : clique sur **Télécharger family.json** (bandeau du haut), remplace `data/family.json` par ce fichier, puis publie.

Commandes utiles :

| Commande | Effet |
|---|---|
| `docker compose down` | arrête la base (les données sont conservées) |
| `docker compose down -v` | efface la base, qui sera recréée depuis `data/family.json` au prochain démarrage |

⚠️ Les scripts de `db/init/` ne s'exécutent qu'à la **création** de la base. Si on les modifie, il faut d'abord télécharger `family.json` (pour garder les ajouts), le copier dans `data/`, puis faire `docker compose down -v` et `docker compose up -d`.

Si la base n'est pas démarrée, le site lit simplement `data/family.json` et le crayon n'apparaît pas. Sur GitHub Pages, le site est toujours en lecture seule.

L'API (PostgREST, port 3000) est la même que celle de Supabase : pour permettre à toute la famille d'ajouter des personnes en ligne, il suffira de recréer ces tables sur Supabase, d'y ajouter des comptes et de changer l'adresse dans `js/config.js`.

## Publier

Chaque modification envoyée (`git push`) sur la branche `main` met le site en ligne automatiquement en une à deux minutes (GitHub Pages).

---

## Organisation du code

```
index.html          La page unique
css/style.css       Le thème (couleurs en variables, mode sombre automatique)
js/app.js           Démarrage et navigation (#/personne/<id>)
js/data.js          Lecture des données (seul fichier à changer pour passer à une base de données)
js/tree.js          Disposition et dessin de l'arbre, zoom et déplacement
js/profile.js       Fiche d'une personne et lecteurs vidéo
js/editor.js        Formulaire d'ajout d'une personne
js/config.js        Adresse de l'API de la base locale
data/family.json    Les données de la famille
docker-compose.yml  Base de données locale (PostgreSQL + API PostgREST)
db/init/            Structure de la base, API (ajout de personnes) et import de family.json
images/personnes/   Les photos
```

## Et après ?

Le prototype est pensé pour pouvoir évoluer sans tout réécrire :

- **Base de données** (Supabase / Postgres) : les tables `persons`, `unions`, `union_children` et `media` reprennent la structure de `family.json`. Seul `js/data.js` change.
- **Accès réservé à la famille** : connexion par lien magique envoyé par e-mail (Supabase Auth), avec des rôles lecteur / éditeur / administrateur.
- **Vidéos privées** : le champ `provider` permet de passer de YouTube à Bunny Stream ou Cloudflare Stream (liens signés).
- **Édition en ligne** : un formulaire d'administration avec envoi des photos.
- **Échange de données** : import et export au format GEDCOM, le standard des logiciels de généalogie.
