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
data/family.json    Les données de la famille
images/personnes/   Les photos
```

## Et après ?

Le prototype est pensé pour pouvoir évoluer sans tout réécrire :

- **Base de données** (Supabase / Postgres) : les tables `persons`, `unions`, `union_children` et `media` reprennent la structure de `family.json`. Seul `js/data.js` change.
- **Accès réservé à la famille** : connexion par lien magique envoyé par e-mail (Supabase Auth), avec des rôles lecteur / éditeur / administrateur.
- **Vidéos privées** : le champ `provider` permet de passer de YouTube à Bunny Stream ou Cloudflare Stream (liens signés).
- **Édition en ligne** : un formulaire d'administration avec envoi des photos.
- **Échange de données** : import et export au format GEDCOM, le standard des logiciels de généalogie.
