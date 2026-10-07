// Accès au site :
//  - mot de passe de la famille (mémorisé sur l'appareil si on le souhaite) ;
//  - mode administrateur : connexion par lien envoyé par e-mail, puis validation par le propriétaire.

import { supabase, rpc } from './data.js';

const PASSWORD_KEY = 'arbre-mot-de-passe';

// ---------- Mot de passe de la famille ----------

const store = remember => (remember ? localStorage : sessionStorage);

export function savedPassword() {
  try {
    return localStorage.getItem(PASSWORD_KEY) || sessionStorage.getItem(PASSWORD_KEY) || '';
  } catch {
    return '';   // navigation privée stricte : on redemandera simplement le mot de passe
  }
}

export function savePassword(password, remember) {
  try {
    forgetPassword();
    store(remember).setItem(PASSWORD_KEY, password);
  } catch { /* idem */ }
}

export function forgetPassword() {
  try {
    localStorage.removeItem(PASSWORD_KEY);
    sessionStorage.removeItem(PASSWORD_KEY);
  } catch { /* idem */ }
}

// ---------- Mode administrateur ----------
// Compte personnel : adresse e-mail + mot de passe. Un seul e-mail à la création du compte
// (pour vérifier l'adresse), puis connexion directe ; un e-mail aussi en cas de mot de passe oublié.

export const MIN_PASSWORD = 8;

// Marqueur ajouté à l'adresse de retour du lien « mot de passe oublié ».
export const RECOVERY_FLAG = 'nouveau-mot-de-passe';

const siteUrl = () => location.origin + location.pathname;

function cleanEmail(email) {
  const clean = String(email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error("Cette adresse e-mail n'est pas valide.");
  return clean;
}

function checkPassword(password, confirm) {
  if (String(password ?? '').length < MIN_PASSWORD) {
    throw new Error(`Le mot de passe doit contenir au moins ${MIN_PASSWORD} caractères.`);
  }
  if (confirm !== undefined && password !== confirm) throw new Error('Les deux mots de passe sont différents.');
}

// Messages de Supabase traduits en français.
function authError(error) {
  const m = error?.message ?? String(error);
  if (/invalid login credentials/i.test(m)) return new Error('Adresse e-mail ou mot de passe incorrect.');
  if (/email not confirmed/i.test(m)) return new Error("Confirmez d'abord votre adresse avec le lien reçu par e-mail lors de la création du compte.");
  if (/already registered|already exists/i.test(m)) return new Error('Un compte existe déjà avec cette adresse : connectez-vous, ou utilisez « Mot de passe oublié ».');
  if (/rate|limit|seconds|too many/i.test(m)) return new Error("Trop de demandes en peu de temps. Patientez un moment avant de réessayer.");
  if (/should be different/i.test(m)) return new Error("Le nouveau mot de passe doit être différent de l'ancien.");
  if (/password should be|weak/i.test(m)) return new Error(`Ce mot de passe est trop faible : au moins ${MIN_PASSWORD} caractères.`);
  return new Error(m);
}

// Connexion avec un compte existant : aucun e-mail envoyé.
export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail(email), password });
  if (error) throw authError(error);
}

// Création du compte : un e-mail de confirmation est envoyé une seule fois.
export async function signUp(email, password, confirm) {
  const clean = cleanEmail(email);
  checkPassword(password, confirm);
  const { data, error } = await supabase.auth.signUp({
    email: clean, password, options: { emailRedirectTo: siteUrl() },
  });
  if (error) throw authError(error);
  // Adresse déjà utilisée : Supabase ne le dit pas (pour la confidentialité) mais ne renvoie aucune identité.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw authError({ message: 'already registered' });
  }
  return clean;
}

// Mot de passe oublié : envoie un lien pour en choisir un nouveau.
export async function sendPasswordReset(email) {
  const clean = cleanEmail(email);
  const url = new URL(siteUrl());
  url.searchParams.set(RECOVERY_FLAG, '1');
  const { error } = await supabase.auth.resetPasswordForEmail(clean, { redirectTo: url.href });
  if (error) throw authError(error);
  return clean;
}

// Choisir ou changer son mot de passe (il faut être connecté).
export async function updatePassword(password, confirm) {
  checkPassword(password, confirm);
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw authError(error);
}

// Statut de la personne connectée : null si personne n'est connecté, sinon
// { email, status: 'pending' | 'approved' | 'refused', role: 'owner' | 'editor' }.
// La première connexion d'une adresse inconnue crée la demande, en attente de validation.
export async function adminStatus() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  if (!data.session) return null;
  try {
    return await rpc('my_admin_status');
  } catch (err) {
    console.warn('Statut administrateur indisponible :', err.message);
    return null;
  }
}

export async function signOut() {
  await supabase?.auth.signOut();
}

// Après le clic sur un lien reçu par e-mail, l'adresse contient « ?code=… » : une fois la connexion
// établie, on le retire pour garder une adresse propre (et partageable).
export async function finishLoginRedirect() {
  if (!supabase) return;
  const url = new URL(location.href);
  if (!url.searchParams.has('code') && !url.searchParams.has('error_description')) return;
  const failure = url.searchParams.get('error_description');
  // supabase-js échange le code tout seul au chargement ; on attend qu'il ait fini.
  await supabase.auth.getSession();
  url.searchParams.delete('code');
  url.searchParams.delete('error');
  url.searchParams.delete('error_code');
  url.searchParams.delete('error_description');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  if (failure) throw new Error(`Le lien reçu par e-mail n'a pas fonctionné (${failure}). Il a peut-être expiré : recommencez.`);
}
