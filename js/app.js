// Point d'entrée : charge les données, dessine l'arbre et gère la navigation
// par lien (#/personne/<id>), pour qu'on puisse partager la fiche de quelqu'un.

import { loadFamily, addPerson, updatePerson, deletePerson, familyJson, fullName } from './data.js';
import { createTree } from './tree.js';
import { renderProfile } from './profile.js';
import { openPersonForm, confirmDelete } from './editor.js';

let svg = document.getElementById('tree');
const panel = document.getElementById('profile');
const panelBody = document.getElementById('profile-body');
const scrim = document.getElementById('scrim');
const BASE_TITLE = document.title;

let family, tree, lastFocus = null, currentId = null;

const isWide = () => matchMedia('(min-width: 760px)').matches;
const panelInset = () => (isWide() && panel.classList.contains('open') ? panel.offsetWidth : 0);

function personFromHash() {
  const m = location.hash.match(/^#\/personne\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

function openProfile(id) {
  if (!family.get(id)) { closeProfile(); return; }
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
  tree.select(null);
  tree.setInset(0);
  lastFocus?.focus?.({ preventScroll: true });
}

function route() {
  const id = personFromHash();
  id ? openProfile(id) : closeProfile();
}

// ---------- Page d'accueil ----------

const intro = document.getElementById('intro');
const isIntro = () => document.body.classList.contains('intro-active');

function enter() {
  if (!isIntro()) return;
  document.body.classList.remove('intro-active');
  // Une fois le fondu terminé, l'accueil est retiré de la page : ses petites animations
  // obligeraient sinon le navigateur à redessiner l'arbre en permanence (très lent sur un grand arbre).
  setTimeout(() => { intro.hidden = true; }, 1000);
  tree?.fit({ animate: false });
  tree?.dropLeaves();
}

function setupIntro() {
  // Lien direct vers une fiche (#/personne/…) : on saute l'accueil.
  if (personFromHash()) { document.body.classList.remove('intro-active'); intro.hidden = true; return; }
  intro.addEventListener('click', enter);
  document.addEventListener('keydown', e => {
    if (!isIntro() || ['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    enter();
  }, { capture: true });
  intro.focus({ preventScroll: true });
}

// ---------- Mode édition (base locale Docker uniquement) ----------

const EDIT_KEY = 'arbre-mode-edition';
const editToggle = document.getElementById('edit-toggle');
const editBanner = document.getElementById('edit-banner');
const isEditing = () => document.body.classList.contains('editing');

function setEditing(on) {
  document.body.classList.toggle('editing', on);
  editToggle.setAttribute('aria-pressed', String(on));
  editBanner.hidden = !on;
  try { localStorage.setItem(EDIT_KEY, on ? '1' : ''); } catch { /* navigation privée : sans gravité */ }
  if (currentId) renderProfile(panelBody, family, currentId, { editing: on });
}

function setupEditing() {
  editToggle.hidden = !family.canEdit;
  if (!family.canEdit) return;
  let saved = false;
  try { saved = localStorage.getItem(EDIT_KEY) === '1'; } catch { /* idem */ }
  setEditing(saved);
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

// Recharge les données et redessine l'arbre, puis ouvre la fiche de `focusId`.
async function reload(focusId) {
  family = await loadFamily();
  buildTree();
  tree.dropLeaves();
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
}

const goTo = id => { location.hash = `/personne/${encodeURIComponent(id)}`; };
const goHome = () => { if (personFromHash()) location.hash = '/'; };

async function start() {
  setupIntro();
  try {
    family = await loadFamily();
  } catch (err) {
    const local = location.protocol === 'file:';
    document.getElementById('error').hidden = false;
    document.getElementById('error-text').textContent = local
      ? "Le site doit être servi par un petit serveur web : ouvrir index.html directement ne fonctionne pas. Voir le README (« Tester sur ton ordinateur »)."
      : err.message;
    console.error(err);
    return;
  }

  buildTree();
  if (!isIntro()) tree.dropLeaves();
  setupEditing();

  document.getElementById('zoom-in').addEventListener('click', () => tree.zoomBy(1.3));
  document.getElementById('zoom-out').addEventListener('click', () => tree.zoomBy(1 / 1.3));
  document.getElementById('zoom-fit').addEventListener('click', () => tree.fit({ rightInset: panelInset() }));
  panel.querySelector('.close').addEventListener('click', goHome);
  scrim.addEventListener('click', goHome);
  document.addEventListener('keydown', e => {
    // Échap dans le formulaire ferme seulement le formulaire.
    if (e.key === 'Escape' && !document.querySelector('dialog[open]')) goHome();
  });
  window.addEventListener('hashchange', () => { enter(); route(); });

  route();
}

start();
