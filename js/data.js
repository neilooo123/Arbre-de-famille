// Couche d'accès aux données : le seul fichier qui sait d'où viennent les données.
// Aujourd'hui elles sont lues dans data/family.json. Plus tard, loadFamily() pourra
// interroger une API (Supabase…) sans toucher au reste du site, tant qu'elle renvoie
// la même structure (voir indexFamily).

const DATA_URL = 'data/family.json';

export async function loadFamily() {
  const res = await fetch(DATA_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Impossible de charger ${DATA_URL} (HTTP ${res.status}).`);
  let raw;
  try {
    raw = await res.json();
  } catch (err) {
    throw new Error(`Le fichier ${DATA_URL} n'est pas un JSON valide : ${err.message}`);
  }
  return indexFamily(raw);
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
