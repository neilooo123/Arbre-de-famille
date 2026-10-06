# Arbre des interviews familiales

Un site statique : un arbre généalogique où chaque personne ouvre ses interviews vidéo.

## Contenu du dossier

- `index.html`, `style.css`, `app.js` : le site (rien à modifier).
- `data/famille.json` : **le seul fichier à éditer** (personnes, liens de parenté, vidéos).
- `photos/` (à créer si besoin) : portraits des personnes.
- `videos/` (optionnel) : vidéos hébergées directement dans le dépôt.

## Mettre le site en ligne avec GitHub Pages

1. Créez un compte sur github.com, puis un nouveau dépôt (par exemple `arbre-famille`), en **Public**.
2. Cliquez sur **Add file → Upload files** et glissez tout le contenu de ce dossier (pas le dossier lui-même : `index.html` doit être à la racine du dépôt). Validez avec **Commit changes**.
3. Dans le dépôt : **Settings → Pages**. Sous *Build and deployment*, choisissez *Deploy from a branch*, branche `main`, dossier `/ (root)`, puis **Save**.
4. Après une ou deux minutes, le site est disponible à l'adresse `https://VOTRE-NOM.github.io/arbre-famille/`.

Pour tester sur votre ordinateur avant de publier, ouvrez un terminal dans le dossier et lancez `python3 -m http.server`, puis allez sur http://localhost:8000. (Ouvrir `index.html` d'un double-clic ne fonctionne pas, car le navigateur bloque la lecture du fichier JSON.)

## Où mettre les vidéos ?

**Recommandé : YouTube, en « non répertoriée ».**
Importez chaque interview sur YouTube avec la visibilité *Non répertoriée* : seules les personnes qui ont le lien du site peuvent la trouver. Copiez ensuite l'adresse de la vidéo dans `famille.json` (champ `youtube`, adresse complète ou identifiant de 11 caractères).

**Alternative : fichiers dans le dépôt.**
Placez des fichiers `.mp4` dans `videos/` et indiquez `"fichier": "videos/nom.mp4"`. Limites de GitHub : 100 Mo maximum par fichier envoyé, et environ 1 Go recommandé pour l'ensemble du dépôt. Compressez vos vidéos (HandBrake par exemple, en H.264) ou préférez YouTube.

## Ajouter une personne ou une interview

Dans `data/famille.json`, chaque case de l'arbre a cette forme :

```json
{
  "personne": {
    "nom": "Marie Dupont",
    "naissance": "1939",
    "deces": "",
    "role": "Arrière-grand-mère",
    "photo": "photos/marie.jpg",
    "bio": "Quelques lignes de présentation.",
    "interviews": [
      { "titre": "Son enfance", "youtube": "https://youtu.be/XXXXXXXXXXX", "duree": "12 min" },
      { "titre": "Une autre vidéo", "fichier": "videos/marie-2.mp4", "duree": "7 min" }
    ]
  },
  "conjoint": { "nom": "Henri Dupont", "interviews": [] },
  "enfants": [ ]
}
```

- `conjoint` est facultatif ; `enfants` aussi (liste de cases de la même forme).
- Une personne sans interview s'affiche en gris avec la mention « À venir ».
- Attention aux virgules : une virgule oubliée ou en trop empêche l'affichage. Vous pouvez vérifier votre fichier sur jsonlint.com.

## Vie privée

Un site GitHub Pages gratuit est **public** : toute personne qui trouve l'adresse peut le voir. Avant de publier, demandez l'accord des personnes interviewées (et celui des parents pour les mineurs), et évitez les informations sensibles (adresses, dates de naissance complètes des personnes vivantes). Si vous souhaitez limiter l'accès, gardez les vidéos en « non répertoriée » sur YouTube et ne partagez le lien qu'à la famille.
