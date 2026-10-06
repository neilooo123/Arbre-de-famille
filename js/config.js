// Adresse de l'API de la base locale (Docker, voir docker-compose.yml).
// Utilisée seulement quand le site est ouvert sur cet ordinateur : sur GitHub Pages,
// le site lit simplement data/family.json et l'ajout de personnes est désactivé.
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);

export const API_URL = LOCAL ? 'http://localhost:3000' : null;
