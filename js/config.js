// Connexion à Supabase : adresse du projet et clé publique (« anon » / « publishable »).
// Ces deux valeurs sont faites pour être dans le site : elles ne donnent accès à rien
// sans le mot de passe de la famille ou une connexion d'administrateur accepté.
// Ne JAMAIS mettre ici la clé « service_role » / « secret ».

// Projet Supabase en ligne (utilisé sur GitHub Pages).
const ONLINE = {
  url: 'https://xbclgoiutjxqtbnukenx.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhiY2xnb2l1dGp4cXRibnVrZW54Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzMjEyNTYsImV4cCI6MjEwNjg5NzI1Nn0.0Z-uck_nqIAO4iTYHw7v7UoOWFTMsk-zd2tJliznQu0',
};

// Copie locale de Supabase lancée avec « supabase start » (dans Docker), pour les tests.
// La clé est affichée par « supabase status ».
const LOCAL = {
  url: 'http://127.0.0.1:54321',
  key: null,
};

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);

// Sur cet ordinateur, on utilise la copie locale si elle est configurée, sinon le projet en ligne.
export const SUPABASE = isLocal && LOCAL.key ? LOCAL : ONLINE;
