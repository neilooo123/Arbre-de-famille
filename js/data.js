// Couche d'accès aux données : le seul fichier qui sait d'où viennent les données.
//  - Avec Supabase (voir js/config.js) : l'arbre n'est donné qu'avec le mot de passe de la famille,
//    ou à un administrateur connecté et accepté ; seuls ces derniers peuvent le modifier.
//  - Sans Supabase configuré (tests rapides) : lecture de data/family.json, en lecture seule.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE } from './config.js';

const DATA_URL = 'data/family.json';

export const supabase = SUPABASE.url && SUPABASE.key
  ? createClient(SUPABASE.url, SUPABASE.key, {
      // Le lien de connexion reçu par e-mail revient avec « ?code=… » (et non « #… »,
      // qui entrerait en conflit avec les adresses des fiches « #/personne/… »).
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

// Erreur d'accès à l'arbre : code = 'wrong_password' | 'too_many_attempts' | 'need_password'.
export class AccessError extends Error {
  constructor(code) {
    super({
      wrong_password: 'Mot de passe incorrect.',
      too_many_attempts: "Trop d'essais. Réessayez dans un quart d'heure.",
      need_password: 'Le mot de passe de la famille est nécessaire.',
    }[code] ?? code);
    this.code = code;
  }
}

// Appelle une fonction de la base (voir supabase/migrations/) et renvoie son résultat.
export async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

// Charge l'arbre. `access` : { password } pour la famille, ou { admin: true } pour un administrateur.
// Renvoie la famille indexée, plus :
//   canEdit : true pour un administrateur accepté
//   raw     : les données brutes (pour l'export en family.json)
export async function loadFamily(access = {}) {
  if (!supabase) {
    const res = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Impossible de charger ${DATA_URL} (HTTP ${res.status}).`);
    const raw = await res.json();
    return { ...indexFamily(raw), raw, canEdit: false };
  }
  if (access.admin) {
    const raw = await rpc('family_admin');
    return { ...indexFamily(raw), raw, canEdit: true };
  }
  if (!access.password) throw new AccessError('need_password');
  const raw = await rpc('family', { password: access.password });
  if (raw?.error) throw new AccessError(raw.error);
  return { ...indexFamily(raw), raw, canEdit: false };
}

// Ajoute une personne et la relie à l'arbre. `request` : voir add_person dans supabase/migrations/.
// Renvoie l'identifiant de la nouvelle personne.
export async function addPerson(request) {
  const res = await rpc('add_person', { payload: request });
  return res.id;
}

// Marque un couple comme séparé (ex-conjoints : ended = true) ou de nouveau actuel.
export async function setUnionEnded(personA, personB, ended) {
  await rpc('set_union_ended', { person_a: personA, person_b: personB, ended });
}

// Relie une personne déjà présente dans l'arbre (conjoint, enfant, parent, frère ou sœur).
// request = { relation, relativeId, targetId, unionDate }. Renvoie l'identifiant de la personne reliée.
export async function linkPerson(request) {
  const res = await rpc('link_person', { payload: request });
  return res.id;
}

// Modifie les informations d'une personne (même format que request.person d'addPerson).
export async function updatePerson(id, person) {
  await rpc('update_person', { target_id: id, changes: person });
  return id;
}

// Supprime une personne ; ses proches restent dans l'arbre.
export async function deletePerson(id) {
  await rpc('delete_person', { target_id: id });
}

// ---------- Galerie de photos (chargée à l'ouverture d'une fiche) ----------

// Vignettes de la galerie d'une personne : [{ id, thumb, caption }].
export async function fetchGallery(personId, access = {}) {
  if (!supabase) return [];
  const res = await rpc('person_photos', { target_id: personId, password: access.password ?? null });
  if (res?.error) throw new AccessError(res.error);
  return res;
}

// Grande version d'une photo de galerie (data URL).
export async function fetchFullPhoto(photoId, access = {}) {
  const res = await rpc('photo_full', { photo_id: photoId, password: access.password ?? null });
  if (res?.error) throw new AccessError(res.error);
  return res.full;
}

// Ajoute une photo (déjà préparée : vignette + grande version), avec sa légende facultative.
// `tags` : identifiants des personnes identifiées sur la photo (elle apparaîtra aussi dans leur galerie).
export async function addGalleryPhoto(personId, { thumb, full, caption = '', tags = [] }) {
  return rpc('add_photo', { target_id: personId, thumb, full_image: full, caption, tags });
}

// Modifie la légende et les personnes identifiées d'une photo.
export async function updatePhoto(photoId, { caption = '', tags = [] }) {
  return rpc('update_photo', { photo_id: photoId, caption, tags });
}

export async function updatePhotoCaption(photoId, caption) {
  return rpc('update_photo_caption', { photo_id: photoId, caption });
}

export async function deleteGalleryPhoto(photoId) {
  await rpc('delete_photo', { photo_id: photoId });
}

// ---------- Portraits : vignette dans l'arbre, grand format à la demande ----------

// Portrait en grand d'une personne (data URL), pour l'agrandir ou le modifier.
export async function fetchPortrait(personId, access = {}) {
  if (!supabase) return null;
  const res = await rpc('person_portrait', { target_id: personId, password: access.password ?? null });
  if (res?.error) throw new AccessError(res.error);
  return res.photo;
}

// Enregistre des vignettes fabriquées dans le navigateur : [{ id, thumb }].
export async function savePortraitThumbs(items) {
  return rpc('set_portrait_thumbs', { items });
}

// Portraits en grand de tout l'arbre ({ id: photo }), pour une sauvegarde complète.
export async function exportPortraits() {
  return supabase ? rpc('export_portraits') : {};
}

// Contenu de family.json (sauvegarde). `portraits` : portraits en grand, sinon les vignettes de l'arbre.
export function familyJson(family, portraits = {}) {
  const prune = obj => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));
  const raw = family.raw;
  return JSON.stringify({
    persons: raw.persons.map(({ photoThumbMissing, galleryCount, ...p }) => prune({
      ...p,
      photo: portraits[p.id] ?? p.photo,
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
    // « deceased » : coché dans le formulaire, ou déduit d'une date/d'un lieu de décès (anciens fichiers).
    persons.set(p.id, { videos: [], ...p, deceased: p.deceased ?? !!(p.death?.date || p.death?.place) });
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
    // Conjoints avec l'état du couple : [{ id, ended }] (ended = ex-conjoints).
    partnerLinks: id => unionsOf(id).flatMap(u => u.partners.filter(p => p !== id).map(p => ({ id: p, ended: !!u.ended }))),
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
  if (b && p.deceased) return `${b} – ?`;   // décédé, date inconnue
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
