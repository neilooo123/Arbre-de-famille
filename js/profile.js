// Fiche d'une personne : photo, dates, description, interviews et liens de parenté.

import { fullName, initials, formatDate, escapeHtml } from './data.js';

// Accepte un identifiant YouTube (11 caractères) ou un lien complet copié depuis YouTube.
export function youtubeId(value) {
  const s = String(value ?? '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([\w-]{11})/);
  return m ? m[1] : null;
}

// Un lecteur par hébergeur : ajouter un hébergeur = ajouter une entrée ici.
const players = {
  youtube(video, title) {
    const id = youtubeId(video.id ?? video.url);
    if (!id) return `<p class="video-error">Lien YouTube non reconnu : ${escapeHtml(video.id ?? video.url)}</p>`;
    return `<iframe src="https://www.youtube-nocookie.com/embed/${id}?rel=0" title="${escapeHtml(title)}"
      loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
  },
  file(video, title) {
    return `<video controls preload="metadata" src="${escapeHtml(video.url)}" title="${escapeHtml(title)}"></video>`;
  },
};

function renderVideo(video, person) {
  const title = video.title || `Interview de ${fullName(person)}`;
  const player = players[video.provider ?? 'youtube'];
  const meta = [video.recordedAt && `Enregistrée le ${formatDate(video.recordedAt)}`].filter(Boolean).join(' · ');
  return `
    <figure class="video">
      <div class="video-frame">${player ? player(video, title) : `<p class="video-error">Hébergeur inconnu : ${escapeHtml(video.provider)}</p>`}</div>
      <figcaption><strong>${escapeHtml(title)}</strong>${meta ? `<span>${escapeHtml(meta)}</span>` : ''}</figcaption>
    </figure>`;
}

const unknown = text => `<span class="unknown">${text}</span>`;

// Naissance ou décès. Avec `always`, la ligne est affichée même vide, en indiquant ce qui est inconnu
// (pour le décès, une ligne vide veut simplement dire que la personne est vivante).
function eventLine(label, ev, { always = false } = {}) {
  const date = ev?.date, place = ev?.place;
  if (!date && !place && !always) return '';
  // « le 12 avril 1932 » pour une date complète, « en juin 1960 » / « en 1958 » sinon.
  const when = date && `${String(date).split('-').length === 3 ? 'le' : 'en'} ${formatDate(date)}`;
  const where = place && `à ${escapeHtml(place)}`;
  const text = when && where ? `${when} ${where}`
    : when ? `${when}, ${unknown('lieu inconnu')}`
    : where ? `${unknown('date inconnue')}, ${where}`
    : unknown('date et lieu inconnus');
  return `<div><dt>${label}</dt><dd>${text}</dd></div>`;
}

function chips(title, ids, family) {
  if (!ids.length) return '';
  const items = ids.map(id => {
    const p = family.get(id);
    const avatar = p.photo
      ? `<img src="${escapeHtml(p.photo)}" alt="">`
      : `<span aria-hidden="true">${escapeHtml(initials(p))}</span>`;
    return `<li><a class="chip" href="#/personne/${encodeURIComponent(id)}">${avatar}${escapeHtml(fullName(p))}</a></li>`;
  }).join('');
  return `<section class="kin"><h3>${title}</h3><ul>${items}</ul></section>`;
}

function partnerLabel(ids, family, prefix = '') {
  const sex = family.get(ids[0])?.sex;
  const word = ids.length > 1 ? 'conjoints' : sex === 'F' ? 'conjointe' : sex === 'M' ? 'conjoint' : 'conjoint·e';
  // « Conjoint », ou « Ex-conjoint » (majuscule seulement au début)
  const label = prefix + word;
  return label[0].toUpperCase() + label.slice(1);
}

// Conjoints actuels et ex-conjoints, en deux groupes. En mode édition, un bouton par conjoint
// permet de marquer le couple comme séparé, ou de nouveau actuel.
function partnerSections(family, id, editing) {
  const links = family.partnerLinks(id);
  const group = (ended, title) => {
    const ids = links.filter(l => l.ended === ended).map(l => l.id);
    if (!ids.length) return '';
    const items = ids.map(pid => {
      const p = family.get(pid);
      const avatar = p.photo
        ? `<img src="${escapeHtml(p.photo)}" alt="">`
        : `<span aria-hidden="true">${escapeHtml(initials(p))}</span>`;
      const toggle = editing ? `
        <button type="button" class="union-toggle" data-union-partner="${escapeHtml(pid)}" data-union-ended="${ended ? '0' : '1'}">
          ${ended ? 'Marquer comme actuel' : 'Marquer comme ex'}</button>` : '';
      return `<li><a class="chip" href="#/personne/${encodeURIComponent(pid)}">${avatar}${escapeHtml(fullName(p))}</a>${toggle}</li>`;
    }).join('');
    return `<section class="kin${ended ? ' former' : ''}"><h3>${partnerLabel(ids, family, title)}</h3><ul>${items}</ul></section>`;
  };
  return group(false, '') + group(true, 'Ex-');
}

// Boutons d'ajout (mode édition). Certains liens sont impossibles : on explique pourquoi.
function addSection(family, id) {
  const parents = family.parentsOf(id).length;
  const hasParentUnion = !!family.parentUnionOf(id);
  const button = (relation, label, disabledReason = '') => `
    <button type="button" class="add-btn" data-add="${relation}" ${disabledReason ? `disabled title="${escapeHtml(disabledReason)}"` : ''}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>${label}
    </button>`;
  return `
    <div class="person-actions">
      <button type="button" class="action-btn" data-action="edit">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg>Modifier la fiche
      </button>
      <button type="button" class="action-btn danger" data-action="delete">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>Supprimer
      </button>
    </div>
    <section class="add-kin" aria-label="Ajouter une personne liée">
      <h3>Ajouter à l'arbre</h3>
      <div class="add-buttons">
        ${button('partner', 'Conjoint')}
        ${button('child', 'Enfant')}
        ${button('parent', 'Parent', parents >= 2 ? 'Cette personne a déjà deux parents.' : '')}
        ${button('sibling', 'Frère ou sœur', hasParentUnion ? '' : "Ajoutez d'abord un parent.")}
      </div>
    </section>`;
}

// Galerie : les vignettes sont chargées à part (voir app.js), on prépare ici leur emplacement.
// canAdd : ajout de photos possible (toute la famille) ; editing : outils des administrateurs.
function gallerySection(p, canAdd) {
  const count = p.galleryCount ?? 0;
  const placeholders = Array.from({ length: Math.min(count, 12) }, () => '<span class="thumb placeholder"></span>').join('');
  return `
    <section class="gallery" aria-labelledby="gallery-title" data-gallery>
      <h3 id="gallery-title">Photos${count ? ` <small>(${count})</small>` : ''}</h3>
      ${count ? '<div class="gallery-tabs" role="tablist" aria-label="Galeries"></div>' : ''}
      <div class="gallery-grid">${placeholders}</div>
      ${count ? '' : `<p class="gallery-empty">${unknown('Aucune photo pour le moment.')}</p>`}
      ${canAdd ? `
        <button type="button" class="add-btn" data-add-photos>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Ajouter des photos
        </button>
        <input type="file" accept="image/*" multiple hidden data-photo-input>
        <p class="gallery-status" role="status"></p>` : ''}
    </section>`;
}

export function renderProfile(container, family, id, { editing = false, canAddPhotos = false } = {}) {
  const p = family.get(id);
  const sexClass = p.sex === 'F' ? ' female' : p.sex === 'M' ? ' male' : '';
  const name = fullName(p);
  const feminine = p.sex === 'F';
  const born = p.sex ? (feminine ? 'Née' : 'Né') : 'Naissance';
  const died = p.sex ? (feminine ? 'Décédée' : 'Décédé') : 'Décès';

  const bio = (p.bio ?? '').split(/\n\s*\n/).filter(Boolean)
    .map(par => `<p>${escapeHtml(par).replace(/\n/g, '<br>')}</p>`).join('');

  const videos = p.videos?.length
    ? p.videos.map(v => renderVideo(v, p)).join('')
    : `<div class="video-empty">
         <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h11v10H4zM15 10l5-3v10l-5-3"/></svg>
         <p>L'interview de ${escapeHtml(p.firstName ?? name)} n'a pas encore été enregistrée.</p>
       </div>`;

  container.innerHTML = `
    <header class="profile-head">
      ${p.photo
        ? `<button type="button" class="portrait zoomable${sexClass}" data-zoom-portrait
             aria-label="Agrandir le portrait de ${escapeHtml(name)}" title="Agrandir la photo">
             <img src="${escapeHtml(p.photo)}" alt="Portrait de ${escapeHtml(name)}"></button>`
        : `<div class="portrait${sexClass}"><span aria-hidden="true">${escapeHtml(initials(p))}</span></div>`}
      <div>
        <h2 id="profile-title">${escapeHtml(name)}</h2>
        ${p.birthName ? `<p class="birthname">${born} ${escapeHtml(p.birthName)}</p>` : ''}
        ${p.lastName ? '' : `<p class="birthname">${unknown('Nom de famille inconnu')}</p>`}
      </div>
    </header>
    <dl class="facts">
      ${eventLine(born, p.birth, { always: true })}${eventLine(died, p.death, { always: p.deceased })}
      ${p.sex ? '' : `<div><dt>Sexe</dt><dd>${unknown('inconnu')}</dd></div>`}
    </dl>
    ${editing ? addSection(family, id) : ''}
    <section class="videos" aria-label="Interviews">${videos}</section>
    ${p.galleryCount || canAddPhotos ? gallerySection(p, canAddPhotos) : ''}
    <section class="bio">${bio || `<p>${unknown('Histoire inconnue.')}</p>`}</section>
    ${chips('Parents', family.parentsOf(id), family)}
    ${partnerSections(family, id, editing)}
    ${chips('Frères et sœurs', family.siblingsOf(id), family)}
    ${chips('Enfants', family.childrenOf(id), family)}
  `;
}
