// Point d'entrée : charge les données, dessine l'arbre et gère la navigation
// par lien (#/personne/<id>), pour qu'on puisse partager la fiche de quelqu'un.

import { loadFamily, fullName } from './data.js';
import { createTree } from './tree.js';
import { renderProfile } from './profile.js';

const svg = document.getElementById('tree');
const panel = document.getElementById('profile');
const panelBody = document.getElementById('profile-body');
const scrim = document.getElementById('scrim');
const BASE_TITLE = document.title;

let family, tree, lastFocus = null;

const isWide = () => matchMedia('(min-width: 760px)').matches;
const panelInset = () => (isWide() && panel.classList.contains('open') ? panel.offsetWidth : 0);

function personFromHash() {
  const m = location.hash.match(/^#\/personne\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

function openProfile(id) {
  if (!family.get(id)) { closeProfile(); return; }
  if (!panel.classList.contains('open')) lastFocus = document.activeElement;
  renderProfile(panelBody, family, id);
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
  document.title = BASE_TITLE;
  tree.select(null);
  lastFocus?.focus?.({ preventScroll: true });
}

function route() {
  const id = personFromHash();
  id ? openProfile(id) : closeProfile();
}

const goTo = id => { location.hash = `/personne/${encodeURIComponent(id)}`; };
const goHome = () => { if (personFromHash()) location.hash = '/'; };

async function start() {
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

  tree = createTree(svg, family, { onSelect: goTo });

  document.getElementById('zoom-in').addEventListener('click', () => tree.zoomBy(1.3));
  document.getElementById('zoom-out').addEventListener('click', () => tree.zoomBy(1 / 1.3));
  document.getElementById('zoom-fit').addEventListener('click', () => tree.fit({ rightInset: panelInset() }));
  panel.querySelector('.close').addEventListener('click', goHome);
  scrim.addEventListener('click', goHome);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') goHome(); });
  window.addEventListener('hashchange', route);

  route();
}

start();
