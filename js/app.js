// Point d'entrée : accès (mot de passe de la famille ou administrateur), chargement de l'arbre,
// et navigation par lien (#/personne/<id>), pour qu'on puisse partager la fiche de quelqu'un.

import {
  loadFamily, addPerson, updatePerson, deletePerson, familyJson, fullName, supabase, AccessError,
} from './data.js';
import { createTree } from './tree.js';
import { renderProfile } from './profile.js';
import { openPersonForm, confirmDelete } from './editor.js';
import {
  savedPassword, savePassword, forgetPassword, adminStatus, finishLoginRedirect, RECOVERY_FLAG,
} from './auth.js';
import { openAdminDialog, openAdminSpace } from './admin.js';

let svg = document.getElementById('tree');
const panel = document.getElementById('profile');
const panelBody = document.getElementById('profile-body');
const scrim = document.getElementById('scrim');
const intro = document.getElementById('intro');
const unlockForm = document.getElementById('unlock');
const BASE_TITLE = document.title;

let family, tree, lastFocus = null, currentId = null;
let access = null;     // { password } ou { admin: true } : comment on a obtenu l'arbre
let status = null;     // statut administrateur de la personne connectée (ou null)
let controlsReady = false;

const isWide = () => matchMedia('(min-width: 760px)').matches;
const panelInset = () => (isWide() && panel.classList.contains('open') ? panel.offsetWidth : 0);

function personFromHash() {
  const m = location.hash.match(/^#\/personne\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

// ---------- Fiche ----------

function openProfile(id) {
  if (!family?.get(id)) { closeProfile(); return; }
  if (!panel.classList.contains('open')) lastFocus = document.activeElement;
  currentId = id;
  renderProfile(panelBody, family, id, { editing: isEditing() });
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  panel.removeAttribute('inert');
  scrim.classList.add('visible');
  panelBody.scrollTop = 0;
  document.title = `${fullName(family.get(id))} · ${BASE_TITLE}`;
  tree.select(id);
  tree.focus(id, { rightInset: panelInset() });
  panel.querySelector('.close').focus({ preventScroll: true });
}

function closeProfile() {
  if (!panel.classList.contains('open')) return;
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  panel.setAttribute('inert', '');
  scrim.classList.remove('visible');
  // Coupe la vidéo en cours de lecture.
  panelBody.innerHTML = '';
  currentId = null;
  document.title = BASE_TITLE;
  tree?.select(null);
  tree?.setInset(0);
  lastFocus?.focus?.({ preventScroll: true });
}

function route() {
  if (!family) return;
  const id = personFromHash();
  id ? openProfile(id) : closeProfile();
}

const goTo = id => { location.hash = `/personne/${encodeURIComponent(id)}`; };
const goHome = () => { if (personFromHash()) location.hash = '/'; };

// ---------- Page d'accueil ----------

const isIntro = () => document.body.classList.contains('intro-active');
const setIntroState = state => { intro.dataset.state = state; };

function enter() {
  if (!isIntro() || !family) return;
  document.body.classList.remove('intro-active');
  // Une fois le fondu terminé, l'accueil est retiré de la page : ses petites animations
  // obligeraient sinon le navigateur à redessiner l'arbre en permanence (très lent sur un grand arbre).
  setTimeout(() => { if (!isIntro()) intro.hidden = true; }, 1000);
  tree?.fit({ animate: false });
  tree?.dropLeaves();
  route();
}

function setupIntro() {
  // Une fois l'arbre chargé : un clic n'importe où ou une touche pour entrer.
  intro.addEventListener('click', e => {
    if (intro.dataset.state === 'ready' && !e.target.closest('button, a, input, label')) enter();
  });
  document.addEventListener('keydown', e => {
    if (!isIntro() || intro.dataset.state !== 'ready') return;
    if (['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key) || document.querySelector('dialog[open]')) return;
    if (e.target.closest?.('button, input')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    enter();
  }, { capture: true });

  // Mot de passe de la famille
  unlockForm.addEventListener('submit', async e => {
    e.preventDefault();
    const password = unlockForm.elements.password.value;
    const button = unlockForm.querySelector('button');
    showUnlockError('');
    button.disabled = true;
    button.textContent = '…';
    try {
      await open({ password });
      savePassword(password, unlockForm.elements.remember.checked);
      unlockForm.reset();
      enter();
    } catch (err) {
      showUnlockError(err.message);
      unlockForm.classList.remove('shake');
      void unlockForm.offsetWidth;   // relance l'animation
      unlockForm.classList.add('shake');
      unlockForm.elements.password.select();
    } finally {
      button.disabled = false;
      button.textContent = 'Entrer';
    }
  });
}

function showUnlockError(message) {
  const p = unlockForm.querySelector('.unlock-error');
  p.textContent = message;
  p.hidden = !message;
}

// Affiche le champ « Mot de passe de la famille » sur l'accueil.
function lock(message = '') {
  family = null;
  closeProfile();
  document.body.classList.add('intro-active');
  intro.hidden = false;
  setIntroState('locked');
  showUnlockError(message);
  setTimeout(() => unlockForm.elements.password.focus(), 50);
}

// ---------- Chargement de l'arbre ----------

// Charge l'arbre avec ces droits d'accès et le dessine. Lève une erreur si l'accès est refusé.
async function open(newAccess) {
  family = await loadFamily(newAccess);
  access = newAccess;
  buildTree();
  setupControls();
  updateEditing();
  setIntroState('ready');
}

// Recharge les données et redessine l'arbre, puis ouvre la fiche de `focusId`.
async function reload(focusId) {
  family = await loadFamily(access);
  buildTree();
  updateEditing();
  if (focusId && focusId !== personFromHash()) goTo(focusId);
  else {
    // Même fiche (après une modification) : on force son rafraîchissement.
    if (focusId) closeProfile();
    route();
  }
}

function buildTree() {
  // Un SVG neuf à chaque fois : l'ancien garde ses écouteurs d'événements.
  if (tree) {
    const fresh = svg.cloneNode(false);
    svg.replaceWith(fresh);
    svg = fresh;
  }
  tree = createTree(svg, family, { onSelect: goTo });
  if (!isIntro()) tree.dropLeaves();
}

// ---------- Mode édition (administrateurs acceptés) ----------

const EDIT_KEY = 'arbre-mode-edition';
const editToggle = document.getElementById('edit-toggle');
const editBanner = document.getElementById('edit-banner');
const isEditing = () => document.body.classList.contains('editing');

function setEditing(on) {
  document.body.classList.toggle('editing', on);
  editToggle.setAttribute('aria-pressed', String(on));
  editBanner.hidden = !on;
  try { localStorage.setItem(EDIT_KEY, on ? '1' : ''); } catch { /* navigation privée : sans gravité */ }
  if (currentId && family) renderProfile(panelBody, family, currentId, { editing: on });
}

// Affiche ou masque le crayon selon les droits de la personne.
function updateEditing() {
  editToggle.hidden = !family?.canEdit;
  document.getElementById('banner-admin-space').hidden = !(status?.role === 'owner' && status?.status === 'approved');
  if (!family?.canEdit) {
    document.body.classList.remove('editing');
    editBanner.hidden = true;
    return;
  }
  let saved = false;
  try { saved = localStorage.getItem(EDIT_KEY) === '1'; } catch { /* idem */ }
  setEditing(saved);
}

// Les commandes ne sont branchées qu'une fois, au premier chargement de l'arbre.
function setupControls() {
  if (controlsReady) return;
  controlsReady = true;

  document.getElementById('zoom-in').addEventListener('click', () => tree.zoomBy(1.3));
  document.getElementById('zoom-out').addEventListener('click', () => tree.zoomBy(1 / 1.3));
  document.getElementById('zoom-fit').addEventListener('click', () => tree.fit({ rightInset: panelInset() }));
  panel.querySelector('.close').addEventListener('click', goHome);
  scrim.addEventListener('click', goHome);
  document.addEventListener('keydown', e => {
    // Échap dans un formulaire ferme seulement le formulaire.
    if (e.key === 'Escape' && !document.querySelector('dialog[open]')) goHome();
  });
  window.addEventListener('hashchange', () => { if (!isIntro()) route(); });

  editToggle.addEventListener('click', () => setEditing(!isEditing()));

  // Boutons de la fiche : « Modifier la fiche », « Supprimer », « + Conjoint », « + Enfant »…
  panelBody.addEventListener('click', async e => {
    const btn = e.target.closest('[data-add], [data-action]');
    if (!btn || !currentId) return;
    const id = currentId;

    if (btn.dataset.add) {
      const newId = await openPersonForm({
        family, relativeId: id, relation: btn.dataset.add, onSubmit: addPerson,
      });
      if (newId) await reload(newId);
    } else if (btn.dataset.action === 'edit') {
      const saved = await openPersonForm({
        family, editId: id, onSubmit: request => updatePerson(id, request.person),
      });
      if (saved) await reload(id);
    } else if (btn.dataset.action === 'delete') {
      const deleted = await confirmDelete({ family, id, onConfirm: () => deletePerson(id) });
      if (deleted) {
        goHome();
        await reload(null);
      }
    }
  });

  document.getElementById('export-json').addEventListener('click', () => {
    const blob = new Blob([familyJson(family)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'family.json' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}

// ---------- Mode administrateur ----------

// Après une connexion réussie : statut à jour, et l'arbre en mode administrateur si accepté.
// Un administrateur accepté arrive directement dans l'arbre, en mode édition.
async function afterSignIn() {
  status = await adminStatus();
  if (status?.status === 'approved') await editTree();
  return status;
}

// Ouvre l'arbre en mode édition (en le rechargeant avec les droits d'administrateur si besoin).
async function editTree() {
  if (!access?.admin || !family?.canEdit) await open({ admin: true });
  setEditing(true);
  if (isIntro()) enter();
  else route();
}

const openSpace = () => openAdminSpace({ family, onImported: () => reload(null) });

function openAdmin(view) {
  if (!supabase) {
    alert('Le mode administrateur nécessite la base de données en ligne (voir js/config.js).');
    return;
  }
  openAdminDialog({
    status,
    view,
    onSignedIn: afterSignIn,
    onOpenSpace: openSpace,
    onEditTree: editTree,
    onSignedOut: async () => {
      status = null;
      if (!access?.admin) { updateEditing(); return; }
      // L'arbre avait été ouvert en tant qu'administrateur : on repasse à l'accès « famille ».
      const password = savedPassword();
      try {
        if (!password) throw new AccessError('need_password');
        await open({ password });
        route();
      } catch {
        lock();
      }
    },
  });
}

function setupAdmin() {
  document.getElementById('banner-admin-space').addEventListener('click', openSpace);
  document.querySelectorAll('[data-admin-open]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    openAdmin();
  }));
}

// ---------- Démarrage ----------

async function start() {
  setupIntro();
  setupAdmin();

  // Retour d'un lien reçu par e-mail (confirmation du compte, ou mot de passe oublié) ?
  const params = new URL(location.href).searchParams;
  const fromLoginLink = params.has('code');
  const recovering = params.has(RECOVERY_FLAG);
  if (recovering) {
    const url = new URL(location.href);
    url.searchParams.delete(RECOVERY_FLAG);
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  let loginError = '';
  try {
    await finishLoginRedirect();
  } catch (err) {
    loginError = err.message;
  }

  try {
    status = await adminStatus();
    if (status?.status === 'approved') {
      await open({ admin: true });
    } else {
      const password = savedPassword();
      if (!supabase || password) await open({ password });
      else lock(loginError);
    }
  } catch (err) {
    if (err instanceof AccessError) {
      if (err.code === 'wrong_password') forgetPassword();
      lock(err.code === 'wrong_password' || err.code === 'need_password' ? loginError : err.message);
    } else {
      console.error(err);
      lock(location.protocol === 'file:'
        ? "Le site doit être ouvert par un petit serveur web (voir le README, « Tester sur ton ordinateur »)."
        : `Impossible de charger l'arbre : ${err.message}`);
    }
  }

  // Lien direct vers une fiche (#/personne/…) : on saute l'accueil dès que l'arbre est chargé.
  if (family && personFromHash()) enter();

  // Juste après le clic sur un lien reçu par e-mail : choisir le nouveau mot de passe,
  // ou voir où en est la demande.
  if (recovering && status) openAdminDialog({ status: null, view: 'recovery', onSignedIn: afterSignIn });
  else if (fromLoginLink && status) openAdmin();
}

start();
