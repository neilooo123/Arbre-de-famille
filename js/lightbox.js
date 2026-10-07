// Affiche une photo en grand, au centre de l'écran, par-dessus le site.
// Plusieurs photos : flèches à l'écran, touches ← →, ou glisser du doigt sur téléphone.
// Fermeture : bouton ✕, touche Échap, ou clic à côté de la photo.

import { escapeHtml } from './data.js';

let dialog;

// items : [{ src } ou { thumb, load: async () => src }], avec une légende facultative (caption) ;
// index : photo de départ ; title : nom de la personne.
export function openLightbox({ items, index = 0, title = '' }) {
  if (!items?.length) return;
  dialog ??= createDialog();
  const d = dialog;
  let current = index;
  const cache = new Map();   // grandes versions déjà chargées

  const img = d.querySelector('.lightbox-image');
  const counter = d.querySelector('.lightbox-counter');
  const caption = d.querySelector('.lightbox-title');
  const prev = d.querySelector('.lightbox-prev');
  const next = d.querySelector('.lightbox-next');
  const status = d.querySelector('.lightbox-status');
  const captionText = d.querySelector('.lightbox-caption');
  const people = d.querySelector('.lightbox-people');
  caption.innerHTML = escapeHtml(title);
  prev.hidden = next.hidden = counter.hidden = items.length < 2;

  async function show(i) {
    current = (i + items.length) % items.length;
    const item = items[current];
    counter.textContent = `${current + 1} / ${items.length}`;
    captionText.textContent = item.caption ?? '';
    captionText.hidden = !item.caption;
    people.textContent = item.people?.length ? `Avec : ${item.people.join(', ')}` : '';
    people.hidden = !item.people?.length;
    img.alt = item.caption ?? title;
    status.textContent = '';
    // En attendant la grande version, on affiche la vignette (floue mais immédiate).
    img.src = cache.get(current) ?? item.src ?? item.thumb ?? '';
    img.classList.toggle('loading', !cache.has(current) && !item.src);
    if (item.src || cache.has(current)) return;
    try {
      const full = await item.load();
      cache.set(current, full);
      if (current === items.indexOf(item)) {
        img.src = full;
        img.classList.remove('loading');
      }
    } catch (err) {
      status.textContent = `Impossible de charger la photo : ${err.message}`;
      img.classList.remove('loading');
    }
  }

  d.onkeydown = e => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(current - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); show(current + 1); }
  };
  prev.onclick = e => { e.stopPropagation(); show(current - 1); };
  next.onclick = e => { e.stopPropagation(); show(current + 1); };

  // Glisser du doigt vers la gauche ou la droite pour changer de photo.
  let startX = null;
  d.ontouchstart = e => { startX = e.touches.length === 1 ? e.touches[0].clientX : null; };
  d.ontouchend = e => {
    if (startX === null || items.length < 2) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 50) show(current + (dx < 0 ? 1 : -1));
    startX = null;
  };

  show(index);
  d.showModal();
  d.querySelector('.lightbox-close').focus({ preventScroll: true });
}

function createDialog() {
  const d = document.createElement('dialog');
  d.className = 'lightbox';
  d.setAttribute('aria-label', 'Photo agrandie');
  d.innerHTML = `
    <figure class="lightbox-figure">
      <img class="lightbox-image" alt="">
      <figcaption>
        <span class="lightbox-caption" hidden></span>
        <span class="lightbox-people" hidden></span>
        <span class="lightbox-title"></span>
        <span class="lightbox-counter"></span>
        <span class="lightbox-status" role="status"></span>
      </figcaption>
    </figure>
    <button type="button" class="lightbox-btn lightbox-close" aria-label="Fermer">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
    <button type="button" class="lightbox-btn lightbox-prev" aria-label="Photo précédente">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
    </button>
    <button type="button" class="lightbox-btn lightbox-next" aria-label="Photo suivante">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
    </button>`;
  document.body.append(d);
  d.querySelector('.lightbox-close').addEventListener('click', () => d.close());
  // Clic à côté de la photo (sur le fond) : on ferme.
  d.addEventListener('click', e => {
    if (e.target === d || e.target.classList.contains('lightbox-figure')) d.close();
  });
  return d;
}
