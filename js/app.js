// Point d'entrée : accès (mot de passe de la famille ou administrateur), chargement de l'arbre,
// et navigation par lien (#/personne/<id>), pour qu'on puisse partager la fiche de quelqu'un.

import {
  loadFamily, addPerson, linkPerson, updatePerson, deletePerson, setUnionEnded, familyJson, fullName, supabase, AccessError,
  fetchPortrait, savePortraitThumbs, exportPortraits,
  fetchGallery, fetchFullPhoto, addGalleryPhoto, deleteGalleryPhoto, updatePhoto, escapeHtml,
} from './data.js';
import { createTree } from './tree.js';
import { renderProfile } from './profile.js';
import { openPersonForm, confirmDelete, prepareGalleryPhoto, openCaptionDialog, portraitThumb } from './editor.js';
import { openLightbox } from './lightbox.js';
import { createCombobox, personOptions } from './combobox.js';
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
  showProfile(id);
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

// ---------- Galerie de photos ----------

const galleries = new Map();   // personne → vignettes déjà chargées [{ id, thumb }]

// Affiche la fiche, puis charge sa galerie (à part, pour ne pas ralentir l'ouverture).
function showProfile(id) {
  renderProfile(panelBody, family, id, { editing: isEditing(), canAddPhotos: !!supabase });
  if (panelBody.querySelector('[data-gallery]')) loadGallery(id);
}

async function loadGallery(id) {
  const grid = panelBody.querySelector('[data-gallery] .gallery-grid');
  try {
    if (!galleries.has(id)) galleries.set(id, await fetchGallery(id, access));
  } catch (err) {
    if (currentId === id && grid) grid.innerHTML = `<p class="gallery-error">Impossible de charger les photos : ${escapeHtml(err.message)}</p>`;
    return;
  }
  if (currentId !== id || !grid?.isConnected) return;   // on a changé de fiche entre-temps
  const name = fullName(family.get(id));
  renderGalleryGrid(grid, id, name);
}

// Vignettes (avec leur légende) et, en mode édition, les boutons ✎ (légende) et ✕ (supprimer).
// Autres personnes présentes sur une photo (celle qui l'a dans sa galerie + les personnes identifiées),
// sans la personne dont on regarde la fiche.
function photoPeople(ph, id) {
  return [...new Set([ph.owner, ...(ph.tags ?? [])])]
    .filter(p => p && p !== id && family.get(p))
    .map(p => ({ id: p, name: fullName(family.get(p)) }));
}

// Noms en gras, chacun menant à la fiche de la personne.
const peopleLinks = people => people
  .map(p => `<a class="person-link" href="#/personne/${encodeURIComponent(p.id)}">${escapeHtml(p.name)}</a>`)
  .join(', ');

function renderGalleryGrid(grid, id, name) {
  grid.innerHTML = galleries.get(id).map((ph, i) => {
    const label = ph.caption ? 'Modifier la légende' : 'Ajouter une légende';
    const people = photoPeople(ph, id);
    return `
    <figure class="thumb-wrap">
      <div class="thumb-box">
      <button type="button" class="thumb" data-photo-index="${i}"
              aria-label="Agrandir la photo ${i + 1} de ${escapeHtml(name)}${ph.caption ? ` : ${escapeHtml(ph.caption)}` : ''}">
        <img src="${escapeHtml(ph.thumb)}" alt="" loading="lazy">
      </button>
      ${isEditing() ? `
        <button type="button" class="thumb-tool thumb-caption" data-caption-photo="${ph.id}" aria-label="${label}" title="${label}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg></button>
        <button type="button" class="thumb-tool thumb-delete" data-delete-photo="${ph.id}" aria-label="Supprimer cette photo" title="Supprimer cette photo">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>` : ''}
      </div>
      <figcaption>
        ${ph.caption ? `<span class="photo-caption">${escapeHtml(ph.caption)}</span>` : ''}
        ${people.length ? `<span class="photo-people">Avec ${peopleLinks(people)}</span>` : ''}
        ${!ph.caption && !people.length ? '<span class="photo-caption unknown">Sans légende</span>' : ''}
      </figcaption>
    </figure>`;
  }).join('');
}

// Ajoute les photos choisies une par une, en affichant l'avancement.
async function uploadPhotos(id, files) {
  const status = panelBody.querySelector('.gallery-status');
  const button = panelBody.querySelector('[data-add-photos]');
  const images = [...files].filter(f => f.type.startsWith('image/'));
  if (!images.length) return;
  button.disabled = true;
  const failures = [];

  // 1. Préparation des photos (recadrage, réduction), pour pouvoir les montrer avec leur légende.
  const prepared = [];
  for (const [i, file] of images.entries()) {
    if (status) status.textContent = `Préparation de la photo ${i + 1} sur ${images.length}…`;
    try {
      prepared.push({ ...(await prepareGalleryPhoto(file)), name: file.name });
    } catch (err) {
      failures.push(`${file.name} : ${err.message}`);
    }
  }
  if (status) status.textContent = '';

  // 2. Une légende pour chacune (facultative).
  const captions = prepared.length ? await openCaptionDialog({
    photos: prepared, family, ownerId: id,
    title: prepared.length > 1 ? `Ajouter ${prepared.length} photos` : 'Ajouter une photo',
    intro: 'Pour chaque photo : une légende (qui, où, quand…) et les personnes qu’on y voit.',
    submitLabel: prepared.length > 1 ? 'Ajouter les photos' : 'Ajouter la photo',
  }) : [];
  if (!captions) {   // annulé
    button.disabled = false;
    return;
  }

  // 3. Envoi, une photo à la fois.
  for (const [i, photo] of prepared.entries()) {
    if (status) status.textContent = `Ajout de la photo ${i + 1} sur ${prepared.length}…`;
    try {
      await addGalleryPhoto(id, { ...photo, ...captions[i] }, access);
    } catch (err) {
      failures.push(`${photo.name} : ${err.message}`);
    }
  }
  await reload(id);
  const note = panelBody.querySelector('.gallery-status');
  if (note) note.textContent = failures.length
    ? `${images.length - failures.length} photo(s) ajoutée(s). Non ajoutées — ${failures.join(' ; ')}`
    : `${images.length} photo(s) ajoutée(s).`;
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
  updateSearch();
  makeMissingThumbs();
  setupControls();
  updateEditing();
  setIntroState('ready');
}

// Recharge les données et redessine l'arbre, puis ouvre la fiche de `focusId`.
async function reload(focusId) {
  family = await loadFamily(access);
  galleries.clear();
  buildTree();
  updateSearch();
  updateEditing();
  if (focusId && focusId !== personFromHash()) goTo(focusId);
  else {
    // Même fiche (après une modification) : on force son rafraîchissement.
    if (focusId) closeProfile();
    route();
  }
}

// Portraits enregistrés avant l'optimisation : un administrateur fabrique leur vignette légère,
// une fois pour toutes, en arrière-plan. Les visites suivantes chargent alors l'arbre bien plus vite.
async function makeMissingThumbs() {
  if (!family?.canEdit) return;
  const todo = family.raw.persons.filter(p => p.photoThumbMissing && p.photo);
  if (!todo.length) return;
  await new Promise(r => (window.requestIdleCallback ?? setTimeout)(r));
  const items = [];
  for (const p of todo) {
    try { items.push({ id: p.id, thumb: await portraitThumb(p.photo) }); } catch (err) { console.warn(p.id, err); }
  }
  try {
    const res = await savePortraitThumbs(items);
    console.info(`Vignettes de portrait créées : ${res.updated}`);
  } catch (err) {
    console.warn('Vignettes de portrait non enregistrées :', err.message);
  }
}

// ---------- Recherche d'une personne (combobox en haut de l'écran) ----------

let search = null;

function updateSearch() {
  const options = personOptions(family);
  if (search) { search.setOptions(options); return; }
  search = createCombobox({
    options,
    placeholder: 'Rechercher une personne…',
    searchPlaceholder: 'Prénom ou nom…',
    emptyText: 'Personne ne correspond.',
    icon: '<svg class="combobox-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    onSelect: id => {
      if (isIntro()) enter();
      if (personFromHash() === id) tree.focus(id, { rightInset: panelInset() });
      else goTo(id);
    },
  });
  search.element.classList.add('person-search');
  document.getElementById('person-search').replaceWith(search.element);
  // Ctrl+K (ou Cmd+K) : ouvrir la recherche depuis n'importe où.
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && family && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      search.open();
    }
  });
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
  if (currentId && family) showProfile(currentId);
}

// Affiche ou masque le crayon selon les droits de la personne.
function updateEditing() {
  editToggle.hidden = !family?.canEdit;
  // Espace d'administration et sauvegarde : réservés au propriétaire du site.
  const isOwner = status?.role === 'owner' && status?.status === 'approved';
  document.getElementById('banner-admin-space').hidden = !isOwner;
  document.getElementById('export-json').hidden = !isOwner;
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
    const btn = e.target.closest('[data-add], [data-action], [data-zoom-portrait], [data-photo-index], [data-delete-photo], [data-caption-photo], [data-add-photos], [data-union-partner]');
    if (!btn || !currentId) return;
    const id = currentId;
    const person = family.get(id);

    if (btn.dataset.zoomPortrait !== undefined) {
      // La vignette s'affiche tout de suite, le portrait en grand se charge par-dessus.
      openLightbox({ items: [{ thumb: person.photo, load: () => fetchPortrait(id, access) }], title: fullName(person) });
      return;
    }
    if (btn.dataset.photoIndex !== undefined) {
      openLightbox({
        items: (galleries.get(id) ?? []).map(ph => ({
          thumb: ph.thumb, caption: ph.caption, load: () => fetchFullPhoto(ph.id, access),
          people: photoPeople(ph, id),
        })),
        index: Number(btn.dataset.photoIndex),
        title: fullName(person),
      });
      return;
    }
    if (btn.dataset.addPhotos !== undefined) {
      const input = panelBody.querySelector('[data-photo-input]');
      input.onchange = () => uploadPhotos(id, input.files);
      input.click();
      return;
    }
    if (btn.dataset.unionPartner) {
      btn.disabled = true;
      try {
        await setUnionEnded(id, btn.dataset.unionPartner, btn.dataset.unionEnded === '1');
        await reload(id);
      } catch (err) {
        btn.disabled = false;
        alert(`Le changement n'a pas pu être enregistré : ${err.message}`);
      }
      return;
    }
    if (btn.dataset.captionPhoto) {
      const photo = galleries.get(id)?.find(ph => String(ph.id) === btn.dataset.captionPhoto);
      if (!photo) return;
      const owner = photo.owner ?? id;
      const captions = await openCaptionDialog({
        photos: [photo], title: 'Légende et personnes de la photo', family, ownerId: owner,
      });
      if (!captions) return;
      try {
        await updatePhoto(photo.id, captions[0]);
        await reload(id);   // la photo peut apparaître ou disparaître d'autres galeries
      } catch (err) {
        alert(`Les changements n'ont pas pu être enregistrés : ${err.message}`);
      }
      return;
    }
    if (btn.dataset.deletePhoto) {
      const photo = galleries.get(id)?.find(ph => String(ph.id) === btn.dataset.deletePhoto);
      const others = [photo?.owner, ...(photo?.tags ?? [])].filter(p => p && p !== id && family.get(p)).map(p => fullName(family.get(p)));
      if (!confirm(others.length
        ? `Supprimer définitivement cette photo ? Elle disparaîtra aussi de la galerie de : ${others.join(', ')}.`
        : 'Supprimer définitivement cette photo de la galerie ?')) return;
      btn.disabled = true;
      try {
        await deleteGalleryPhoto(Number(btn.dataset.deletePhoto));
        await reload(id);
      } catch (err) {
        btn.disabled = false;
        alert(`La photo n'a pas pu être supprimée : ${err.message}`);
      }
      return;
    }

    if (btn.dataset.add) {
      const newId = await openPersonForm({
        family, relativeId: id, relation: btn.dataset.add,
        // Nouvelle personne, ou personne déjà dans l'arbre à relier.
        onSubmit: request => (request.mode === 'link' ? linkPerson(request) : addPerson(request)),
      });
      if (newId) await reload(newId);
    } else if (btn.dataset.action === 'edit') {
      const saved = await openPersonForm({
        family, editId: id, onSubmit: request => updatePerson(id, request.person),
        loadPortrait: () => fetchPortrait(id, access),
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

  document.getElementById('export-json').addEventListener('click', async () => {
    // Sauvegarde complète : avec les portraits en grand (l'arbre n'en a que les vignettes).
    let portraits = {};
    try { portraits = await exportPortraits(); } catch (err) { console.warn(err); }
    const blob = new Blob([familyJson(family, portraits)], { type: 'application/json' });
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

// Boîte à outils : l'onglet à clé à molette ouvre ou ferme la colonne d'outils (Échap la ferme).
function setupToolbox() {
  const box = document.getElementById('toolbox');
  const tab = document.getElementById('toolbox-tab');
  const setOpen = open => {
    box.classList.toggle('open', open);
    tab.setAttribute('aria-expanded', String(open));
    tab.setAttribute('aria-label', open ? 'Fermer les outils' : 'Outils');
  };
  tab.addEventListener('click', () => setOpen(!box.classList.contains('open')));
  box.addEventListener('keydown', e => {
    if (e.key === 'Escape' && box.classList.contains('open')) { setOpen(false); tab.focus(); }
  });
}

// Onglet sous le titre : le titre remonte hors de l'écran, ou redescend (choix retenu sur l'appareil).
function setupHeaderToggle() {
  const header = document.querySelector('.site-header');
  const tab = document.getElementById('header-tab');
  const setCollapsed = collapsed => {
    header.classList.toggle('collapsed', collapsed);
    tab.setAttribute('aria-expanded', String(!collapsed));
    // Titre masqué : la bulle invite à rouvrir la recherche (sur téléphone, elle reste affichée sous la flèche).
    tab.setAttribute('aria-label', collapsed ? 'Afficher le titre et la recherche' : 'Masquer le titre');
    tab.dataset.tip = collapsed ? 'Rechercher une personne' : 'Masquer le titre';
    try { localStorage.setItem('header-collapsed', collapsed ? '1' : ''); } catch {}
  };
  tab.addEventListener('click', () => setCollapsed(!header.classList.contains('collapsed')));
  let saved = false;
  try { saved = localStorage.getItem('header-collapsed') === '1'; } catch {}
  if (saved) setCollapsed(true);
}

async function start() {
  setupIntro();
  setupAdmin();
  setupToolbox();
  setupHeaderToggle();

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
