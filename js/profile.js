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

function eventLine(label, ev) {
  if (!ev || (!ev.date && !ev.place)) return '';
  // « le 12 avril 1932 » pour une date complète, « en juin 1960 » / « en 1958 » sinon.
  const when = ev.date && `${String(ev.date).split('-').length === 3 ? 'le' : 'en'} ${formatDate(ev.date)}`;
  const parts = [when, ev.place && `à ${escapeHtml(ev.place)}`].filter(Boolean);
  return `<div><dt>${label}</dt><dd>${parts.join(' ')}</dd></div>`;
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

function partnerLabel(ids, family) {
  if (ids.length > 1) return 'Conjoints';
  const sex = family.get(ids[0])?.sex;
  return sex === 'F' ? 'Conjointe' : sex === 'M' ? 'Conjoint' : 'Conjoint·e';
}

export function renderProfile(container, family, id) {
  const p = family.get(id);
  const name = fullName(p);
  const feminine = p.sex === 'F';
  const born = feminine ? 'Née' : 'Né';
  const died = feminine ? 'Décédée' : 'Décédé';

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
      <div class="portrait">${p.photo
        ? `<img src="${escapeHtml(p.photo)}" alt="Portrait de ${escapeHtml(name)}">`
        : `<span aria-hidden="true">${escapeHtml(initials(p))}</span>`}</div>
      <div>
        <h2 id="profile-title">${escapeHtml(name)}</h2>
        ${p.birthName ? `<p class="birthname">${born} ${escapeHtml(p.birthName)}</p>` : ''}
      </div>
    </header>
    <dl class="facts">${eventLine(born, p.birth)}${eventLine(died, p.death)}</dl>
    <section class="videos" aria-label="Interviews">${videos}</section>
    ${bio ? `<section class="bio">${bio}</section>` : ''}
    ${chips('Parents', family.parentsOf(id), family)}
    ${chips(partnerLabel(family.partnersOf(id), family), family.partnersOf(id), family)}
    ${chips('Frères et sœurs', family.siblingsOf(id), family)}
    ${chips('Enfants', family.childrenOf(id), family)}
  `;
}
