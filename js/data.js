// Couche d'accès aux données : le seul fichier qui sait d'où viennent les données.
//  - En local, si la base Docker tourne (voir docker-compose.yml), on lit et on écrit via son API.
//  - Sinon (et toujours sur GitHub Pages), on lit data/family.json, en lecture seule.
// Passer plus tard à Supabase ne demandera de modifier que ce fichier : c'est la même API (PostgREST).

import { API_URL } from './config.js';

const DATA_URL = 'data/family.json';

async function fetchJson(url, { timeout = 0, ...options } = {}) {
  const ctrl = new AbortController();
  const timer = timeout ? setTimeout(() => ctrl.abort(), timeout) : 0;
  try {
    const res = await fetch(url, { cache: 'no-cache', ...options, signal: ctrl.signal });
    const body = await res.text();
    const data = body ? JSON.parse(body) : null;
    // PostgREST renvoie { message, ... } en cas d'erreur
    if (!res.ok) throw new Error(data?.message || `Erreur HTTP ${res.status} sur ${url}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// Renvoie la famille indexée, plus :
//   source  : 'api' ou 'json'
//   canEdit : true si on peut ajouter des personnes
//   raw     : les données brutes (pour l'export en family.json)
export async function loadFamily() {
  if (API_URL) {
    try {
      const raw = await fetchJson(`${API_URL}/rpc/family`, { timeout: 2500 });
      return { ...indexFamily(raw), raw, source: 'api', canEdit: true };
    } catch (err) {
      console.info(`Base locale indisponible (${err.message}) : lecture de ${DATA_URL}.`);
    }
  }
  let raw;
  try {
    raw = await fetchJson(DATA_URL);
  } catch (err) {
    throw new Error(err instanceof SyntaxError
      ? `Le fichier ${DATA_URL} n'est pas un JSON valide : ${err.message}`
      : `Impossible de charger ${DATA_URL} (${err.message}).`);
  }
  return { ...indexFamily(raw), raw, source: 'json', canEdit: false };
}

// Ajoute une personne et la relie à l'arbre. `request` : voir api.add_person dans db/init/02-api.sql.
// Renvoie l'identifiant de la nouvelle personne.
export async function addPerson(request) {
  const res = await rpc('add_person', { payload: request });
  return res.id;
}

const rpc = (name, args) => fetchJson(`${API_URL}/rpc/${name}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(args),
});

// Modifie les informations d'une personne (même format que request.person d'addPerson).
export async function updatePerson(id, person) {
  await rpc('update_person', { target_id: id, changes: person });
  return id;
}

// Supprime une personne ; ses proches restent dans l'arbre.
export async function deletePerson(id) {
  await rpc('delete_person', { target_id: id });
}

// Contenu à jour de data/family.json (pour publier les ajouts sur GitHub Pages).
export function familyJson(family) {
  const prune = obj => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));
  const raw = family.raw;
  return JSON.stringify({
    persons: raw.persons.map(p => prune({
      ...p,
      birth: p.birth ? prune(p.birth) : null,
      death: p.death ? prune(p.death) : null,
      videos: (p.videos ?? []).map(prune),
    })),
    unions: raw.unions.map(prune),
    children: raw.children,
  }, null, 2) + '\n';
}

// Transforme les trois listes à plat (persons / unions / children) en index pratiques.
export function indexFamily(raw) {
  const persons = new Map();
  for (const p of raw.persons ?? []) {
    if (persons.has(p.id)) console.warn(`Identifiant en double : ${p.id}`);
    persons.set(p.id, { videos: [], ...p });
  }

  const unions = new Map();
  const unionsByPerson = new Map();
  for (const u of raw.unions ?? []) {
    const partners = (u.partners ?? []).filter(id => {
      if (persons.has(id)) return true;
      console.warn(`Union ${u.id} : personne inconnue « ${id} »`);
      return false;
    });
    const union = { ...u, partners, children: [] };
    unions.set(u.id, union);
    for (const id of partners) {
      if (!unionsByPerson.has(id)) unionsByPerson.set(id, []);
      unionsByPerson.get(id).push(union);
    }
  }

  const parentUnionByPerson = new Map();
  for (const link of raw.children ?? []) {
    const union = unions.get(link.unionId);
    if (!union) { console.warn(`Enfant ${link.personId} : union inconnue « ${link.unionId} »`); continue; }
    if (!persons.has(link.personId)) { console.warn(`Union ${link.unionId} : enfant inconnu « ${link.personId} »`); continue; }
    union.children.push(link.personId);
    parentUnionByPerson.set(link.personId, union);
  }

  // Les enfants sont rangés du plus âgé au plus jeune.
  const birthKey = id => persons.get(id).birth?.date ?? '9999';
  for (const u of unions.values()) u.children.sort((a, b) => birthKey(a).localeCompare(birthKey(b)));

  const unionsOf = id => unionsByPerson.get(id) ?? [];
  const parentUnionOf = id => parentUnionByPerson.get(id) ?? null;

  return {
    persons,
    unions,
    get: id => persons.get(id),
    unionsOf,
    parentUnionOf,
    parentsOf: id => parentUnionOf(id)?.partners ?? [],
    partnersOf: id => unionsOf(id).flatMap(u => u.partners.filter(p => p !== id)),
    childrenOf: id => unionsOf(id).flatMap(u => u.children),
    siblingsOf: id => (parentUnionOf(id)?.children ?? []).filter(c => c !== id),
  };
}

// ---- Petits utilitaires d'affichage, partagés par l'arbre et la fiche ----

export function fullName(p) {
  return [p.firstName, p.lastName].filter(Boolean).join(' ');
}

export function initials(p) {
  return [p.firstName, p.lastName].map(s => (s ?? '').trim()[0] ?? '').join('').toUpperCase();
}

const year = d => d?.date ? String(d.date).slice(0, 4) : null;

// « 1932 – 2019 », « née en 1935 », ou « » si on ne sait rien.
export function lifeSpan(p) {
  const b = year(p.birth), d = year(p.death);
  if (b && d) return `${b} – ${d}`;
  if (d) return `† ${d}`;
  if (b) return `${b}`;
  return '';
}

// Accepte « 1932 », « 1932-04 » ou « 1932-04-12 ».
export function formatDate(value) {
  if (!value) return '';
  const [y, m, d] = String(value).split('-').map(Number);
  if (!m) return String(y);
  const date = new Date(Date.UTC(y, m - 1, d || 1));
  const opts = d ? { day: 'numeric', month: 'long', year: 'numeric' } : { month: 'long', year: 'numeric' };
  return date.toLocaleDateString('fr-FR', { ...opts, timeZone: 'UTC' });
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
