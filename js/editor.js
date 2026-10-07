// Formulaires du mode édition, ouverts depuis la fiche de quelqu'un :
//  - ajout d'une personne liée (« + Conjoint », « + Enfant », « + Parent », « + Frère ou sœur ») ;
//  - modification des informations d'une personne ;
//  - confirmation avant suppression.

import { fullName, escapeHtml } from './data.js';
import { youtubeId } from './profile.js';

const TITLES = {
  partner: 'Ajouter un conjoint',
  child: 'Ajouter un enfant',
  parent: 'Ajouter un parent',
  sibling: 'Ajouter un frère ou une sœur',
};

// Accepte « 1932 », « 04/1932 », « 12/04/1932 » ou le format ISO « 1932-04-12 ».
// Renvoie la date au format ISO (éventuellement partielle), '' si vide, ou lève une erreur.
export function parseDate(value, label) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  let y, m, d, match;
  if ((match = s.match(/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/))) [, y, m, d] = match;
  else if ((match = s.match(/^(?:(\d{1,2})[/.])?(\d{1,2})[/.](\d{4})$/))) [, d, m, y] = match;
  else throw new Error(`${label} : écrivez par exemple 1932, 04/1932 ou 12/04/1932.`);
  const pad = n => String(n).padStart(2, '0');
  if (m && (+m < 1 || +m > 12)) throw new Error(`${label} : le mois doit être entre 1 et 12.`);
  if (d) {
    // Vérifie que le jour existe vraiment (pas de 31 février).
    const check = new Date(Date.UTC(+y, +m - 1, +d));
    if (check.getUTCMonth() !== +m - 1 || check.getUTCDate() !== +d) {
      throw new Error(`${label} : le ${d}/${m}/${y} n'existe pas.`);
    }
  }
  return [y, m && pad(m), d && pad(d)].filter(Boolean).join('-');
}

// Inverse de parseDate, pour pré-remplir le formulaire : « 1932-04-12 » → « 12/04/1932 ».
function displayDate(iso) {
  const [y, m, d] = String(iso ?? '').split('-');
  return d ? `${d}/${m}/${y}` : m ? `${m}/${y}` : (y ?? '');
}

let dialog;
let finish = null;   // termine le dialogue en cours : finish(résultat) ou finish(null) pour annuler

function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'person-form';
  dialog.setAttribute('aria-labelledby', 'person-form-title');
  document.body.append(dialog);
  // Clic sur le fond assombri ou touche Échap : on annule.
  dialog.addEventListener('click', e => { if (e.target === dialog) finish?.(null); });
  // Échap pendant l'avertissement « formulaire incomplet » : on revient seulement au formulaire.
  // On intercepte la touche elle-même : Chrome ne laisse pas toujours annuler la fermeture du dialogue.
  dialog.addEventListener('keydown', e => {
    const warning = dialog.querySelector('.form-warning:not([hidden])');
    if (e.key !== 'Escape' || !warning) return;
    e.preventDefault();
    e.stopPropagation();
    warning.querySelector('.complete-form').click();
  });
  dialog.addEventListener('cancel', e => { e.preventDefault(); finish?.(null); });
  // Filet de sécurité si le dialogue est fermé autrement.
  dialog.addEventListener('close', () => finish?.(null));
  return dialog;
}

// Affiche le dialogue et renvoie une promesse résolue par finish(...).
// On ne dépend pas de l'événement « close » pour rendre la main : certains navigateurs
// ne le déclenchent pas tant que la page n'est pas affichée.
function showDialog(d, html, setup) {
  d.innerHTML = html;
  return new Promise(resolve => {
    finish = value => {
      finish = null;
      if (d.open) d.close();
      resolve(value);
    };
    d.querySelector('[value=cancel]').addEventListener('click', () => finish?.(null));
    setup?.();
    d.showModal();
  });
}

// Formulaire d'ajout (relation + relativeId) ou de modification (editId).
// `onSubmit(request)` enregistre (promesse) et renvoie l'id de la personne.
// Renvoie une promesse résolue avec cet id, ou null si on annule.
export function openPersonForm({ family, relativeId, relation, editId, onSubmit }) {
  const d = ensureDialog();
  const editing = !!editId;
  const current = editing ? family.get(editId) : null;
  const relative = family.get(editing ? editId : relativeId);
  const partners = editing ? [] : family.partnersOf(relativeId);

  // Valeurs de départ : la fiche existante, ou des suggestions pour un ajout.
  const youtubeIndex = (current?.videos ?? []).findIndex(v => (v.provider ?? 'youtube') === 'youtube');
  const start = current ? {
    firstName: current.firstName, lastName: current.lastName, birthName: current.birthName, sex: current.sex ?? '',
    birthDate: displayDate(current.birth?.date), birthPlace: current.birth?.place,
    deathDate: displayDate(current.death?.date), deathPlace: current.death?.place,
    bio: current.bio, photo: current.photo, video: youtubeIndex >= 0 ? current.videos[youtubeIndex].id : '',
  } : {
    // Un enfant, un frère ou une sœur porte souvent le même nom : on le propose.
    lastName: ['child', 'sibling'].includes(relation) ? relative.lastName : '', sex: '',
  };
  const val = name => escapeHtml(start[name] ?? '');
  const sexRadio = (value, label) =>
    `<label><input type="radio" name="sex" value="${value}" ${start.sex === value ? 'checked' : ''}> ${label}</label>`;

  const otherParentField = relation === 'child' ? `
    <label class="field">
      <span>Autre parent</span>
      <select name="otherParentId">
        ${partners.map((id, i) => `<option value="${escapeHtml(id)}" ${i === 0 ? 'selected' : ''}>${escapeHtml(fullName(family.get(id)))}</option>`).join('')}
        <option value="">Non renseigné</option>
      </select>
    </label>` : '';

  const unionField = relation === 'partner' ? `
    <label class="field">
      <span>Date de l'union <small>(mariage, PACS… facultatif)</small></span>
      <input name="unionDate" inputmode="numeric" placeholder="1956 ou 14/07/1956">
    </label>` : '';

  const submitLabel = editing ? 'Enregistrer' : "Ajouter à l'arbre";

  const html = `
    <form method="dialog" novalidate>
      <header>
        <h2 id="person-form-title">${editing ? 'Modifier la fiche' : TITLES[relation]}</h2>
        <p>${editing ? '' : 'de '}<strong>${escapeHtml(fullName(relative))}</strong></p>
      </header>

      <div class="form-body">
        <div class="row">
          <label class="field"><span>Prénom <b aria-hidden="true">*</b></span>
            <input name="firstName" value="${val('firstName')}" required autocomplete="off"></label>
          <label class="field"><span>Nom</span>
            <input name="lastName" value="${val('lastName')}" autocomplete="off"></label>
        </div>
        <div class="row">
          <label class="field"><span>Nom de naissance <small>(si différent)</small></span>
            <input name="birthName" value="${val('birthName')}" autocomplete="off"></label>
          <fieldset class="field sex">
            <legend>Sexe</legend>
            ${sexRadio('F', 'Femme')}${sexRadio('M', 'Homme')}${sexRadio('', 'Non précisé')}
          </fieldset>
        </div>

        ${otherParentField}${unionField}

        <div class="row">
          <label class="field"><span>Naissance</span>
            <input name="birthDate" value="${val('birthDate')}" inputmode="numeric" placeholder="1932 ou 12/04/1932"></label>
          <label class="field"><span>Lieu de naissance</span>
            <input name="birthPlace" value="${val('birthPlace')}"></label>
        </div>
        <div class="row">
          <label class="field"><span>Décès <small>(laisser vide si vivant)</small></span>
            <input name="deathDate" value="${val('deathDate')}" inputmode="numeric" placeholder="2019 ou 03/11/2019"></label>
          <label class="field"><span>Lieu du décès</span>
            <input name="deathPlace" value="${val('deathPlace')}"></label>
        </div>

        <label class="field"><span>Son histoire</span>
          <textarea name="bio" rows="4" placeholder="Métier, passions, souvenirs… Une ligne vide sépare deux paragraphes.">${val('bio')}</textarea></label>

        <div class="field">
          <span>Photo</span>
          <div class="photo-picker">
            <div class="photo-preview" aria-hidden="true"></div>
            <div class="photo-actions">
              <div class="photo-buttons">
                <button type="button" class="btn-secondary pick-photo">Choisir une photo…</button>
                <span class="photo-rotate" hidden>
                  <button type="button" class="icon-btn rotate-left" aria-label="Pivoter la photo de 90° vers la gauche" title="Pivoter vers la gauche">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7v5h5"/><path d="M4.5 12A8 8 0 1 0 7 6.3L3 10"/></svg>
                  </button>
                  <button type="button" class="icon-btn rotate-right" aria-label="Pivoter la photo de 90° vers la droite" title="Pivoter vers la droite">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 7v5h-5"/><path d="M19.5 12A8 8 0 1 1 17 6.3L21 10"/></svg>
                  </button>
                </span>
                <button type="button" class="link-btn remove-photo" hidden>Retirer</button>
              </div>
              <small>Ou glissez une image ici. Elle sera recadrée en carré et allégée automatiquement.</small>
            </div>
            <input type="file" accept="image/*" class="photo-file" hidden>
            <input type="hidden" name="photo">
          </div>
        </div>

        <label class="field"><span>Interview <small>(lien YouTube)</small></span>
          <input name="video" type="url" value="${val('video')}" placeholder="https://youtu.be/…"></label>
      </div>

      <p class="form-error" role="alert" hidden></p>

      <div class="form-warning" hidden>
        <div class="warning-box" role="alertdialog" aria-modal="true" aria-describedby="warning-text">
          <svg class="warning-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17v.5"/></svg>
          <p id="warning-text"></p>
          <div class="warning-buttons">
            <button type="button" class="btn-secondary complete-form">Compléter le formulaire</button>
            <button type="button" class="btn-primary confirm-incomplete">Valider quand même</button>
          </div>
        </div>
      </div>

      <footer>
        <button type="button" class="btn-secondary" value="cancel">Annuler</button>
        <button type="submit" class="btn-primary">${submitLabel}</button>
      </footer>
    </form>`;

  let form, error, submit, warning;
  let acceptIncomplete = false;   // « Valider quand même » a été choisi
  const showError = message => {
    error.textContent = message;
    error.hidden = false;
    error.scrollIntoView({ block: 'nearest' });
  };

  return showDialog(d, html, () => {
    form = d.querySelector('form');
    error = d.querySelector('.form-error');
    submit = d.querySelector('[type=submit]');
    warning = d.querySelector('.form-warning');
    setupPhotoPicker(form, start.photo, showError);

    const hideWarning = () => { warning.hidden = true; };
    // Clic à côté de l'avertissement : retour au formulaire.
    warning.addEventListener('click', e => { if (e.target === warning) warning.querySelector('.complete-form').click(); });
    // Dès qu'on modifie le formulaire, l'avertissement n'est plus à jour.
    form.addEventListener('input', () => { acceptIncomplete = false; hideWarning(); });
    warning.querySelector('.complete-form').addEventListener('click', () => {
      const first = missingFields(form)[0];
      hideWarning();
      (form.elements[first?.name] instanceof RadioNodeList ? form.elements[first.name][0] : form.elements[first?.name])?.focus();
      if (first?.name === 'photo') form.querySelector('.pick-photo').focus();
    });
    warning.querySelector('.confirm-incomplete').addEventListener('click', () => {
      acceptIncomplete = true;
      hideWarning();
      form.requestSubmit();
    });

    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!finish || submit.disabled) return;   // déjà envoyé ou formulaire fermé
      error.hidden = true;
      let request;
      try {
        request = buildRequest(new FormData(form), { relation, relativeId, current, youtubeIndex });
      } catch (err) {
        showError(err.message);
        return;
      }

      // Champs laissés vides : on prévient et on demande confirmation (ils s'afficheront « inconnu »).
      const missing = missingFields(form);
      if (missing.length && !acceptIncomplete) {
        warning.querySelector('p').innerHTML =
          `Le formulaire est incomplet. Vous n'avez pas renseigné : ` +
          missing.map(m => `<strong>${escapeHtml(m.label)}</strong>`).join(', ') +
          '. Voulez-vous quand même valider ?';
        warning.hidden = false;
        warning.querySelector('.confirm-incomplete').focus();
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Enregistrement…';
      try {
        const id = await onSubmit(request);
        finish?.(id);
      } catch (err) {
        showError(err.message);
      } finally {
        submit.disabled = false;
        submit.textContent = submitLabel;
      }
    });
    queueMicrotask(() => form.elements.firstName.focus());
  });
}

// Champs dont l'absence est signalée avant d'enregistrer. Le décès (vide = personne vivante),
// le nom de naissance (seulement s'il diffère) et la date d'union ne sont pas concernés.
const CHECKED_FIELDS = [
  { name: 'lastName', label: 'nom' },
  { name: 'sex', label: 'sexe' },
  { name: 'birthDate', label: 'date de naissance' },
  { name: 'birthPlace', label: 'lieu de naissance' },
  { name: 'bio', label: 'histoire' },
  { name: 'photo', label: 'photo' },
  { name: 'video', label: 'interview' },
];

function missingFields(form) {
  const data = new FormData(form);
  return CHECKED_FIELDS.filter(({ name }) => !String(data.get(name) ?? '').trim());
}

// Légendes des photos de galerie : un champ par photo (ajout de plusieurs photos, ou modification
// d'une seule). photos : [{ thumb, caption }]. Renvoie la liste des légendes, ou null si on annule.
export function openCaptionDialog({ photos, title, intro = '', submitLabel = 'Enregistrer' }) {
  const d = ensureDialog();
  const html = `
    <form method="dialog" class="captions" novalidate>
      <header>
        <h2 id="person-form-title">${escapeHtml(title)}</h2>
        ${intro ? `<p>${escapeHtml(intro)}</p>` : ''}
      </header>
      <div class="form-body">
        ${photos.map((ph, i) => `
          <div class="caption-row">
            <img src="${escapeHtml(ph.thumb)}" alt="">
            <label class="field"><span>Légende${photos.length > 1 ? ` de la photo ${i + 1}` : ''} <small>(facultative)</small></span>
              <input name="caption-${i}" maxlength="300" value="${escapeHtml(ph.caption ?? '')}"
                     placeholder="Ex. : Mariage de Jean et Marie, 1956" autocomplete="off"></label>
          </div>`).join('')}
      </div>
      <footer>
        <button type="button" class="btn-secondary" value="cancel">Annuler</button>
        <button type="submit" class="btn-primary">${escapeHtml(submitLabel)}</button>
      </footer>
    </form>`;

  return showDialog(d, html, () => {
    const form = d.querySelector('form');
    form.addEventListener('submit', e => {
      e.preventDefault();
      finish?.(photos.map((_, i) => form.elements[`caption-${i}`].value.trim()));
    });
    queueMicrotask(() => form.elements['caption-0']?.focus());
  });
}

// Demande confirmation avant de supprimer quelqu'un. `onConfirm()` supprime (promesse).
// Renvoie une promesse résolue avec true si la personne a été supprimée.
export function confirmDelete({ family, id, onConfirm }) {
  const d = ensureDialog();
  const person = family.get(id);
  const kin = [
    ...family.parentsOf(id), ...family.partnersOf(id), ...family.childrenOf(id),
  ].map(k => fullName(family.get(k)));
  const html = `
    <form method="dialog" class="confirm" novalidate>
      <header>
        <h2 id="person-form-title">Supprimer ${escapeHtml(fullName(person))} ?</h2>
      </header>
      <div class="form-body">
        <p>Sa fiche, sa photo et ses interviews seront <strong>définitivement supprimées</strong> de l'arbre.</p>
        ${kin.length ? `<p>Ses proches restent dans l'arbre, seul le lien avec cette personne disparaît :
          ${kin.map(escapeHtml).join(', ')}.</p>` : ''}
      </div>
      <p class="form-error" role="alert" hidden></p>
      <footer>
        <button type="button" class="btn-secondary" value="cancel">Annuler</button>
        <button type="submit" class="btn-danger">Supprimer définitivement</button>
      </footer>
    </form>`;

  return showDialog(d, html, () => {
    const form = d.querySelector('form');
    const error = d.querySelector('.form-error');
    const submit = d.querySelector('[type=submit]');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!finish || submit.disabled) return;
      submit.disabled = true;
      submit.textContent = 'Suppression…';
      try {
        await onConfirm();
        finish?.(true);
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        submit.disabled = false;
        submit.textContent = 'Supprimer définitivement';
      }
    });
    // Par prudence, le bouton actif par défaut est « Annuler ».
    queueMicrotask(() => d.querySelector('[value=cancel]').focus());
  });
}

// ---------- Photo choisie sur l'ordinateur ----------

const PHOTO_SIZE = 600;      // côté du carré final, en pixels
const PHOTO_QUALITY = 0.85;  // qualité JPEG (0 à 1)

async function readImage(blob) {
  if (blob.type && !blob.type.startsWith('image/')) throw new Error("Ce fichier n'est pas une image.");
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    // Typiquement le format HEIC des iPhone, que les navigateurs ne savent pas lire.
    throw new Error("Impossible de lire cette image. Essayez une photo au format JPG ou PNG.");
  }
}

// Recadre l'image en carré (centré), la réduit et la fait pivoter de `angle` degrés
// (multiple de 90). Renvoie une « data URL » JPEG, enregistrée telle quelle dans la base.
// On repart toujours de l'image d'origine : pivoter plusieurs fois ne dégrade pas la photo.
export function renderPhoto(source, angle = 0) {
  const side = Math.min(source.width, source.height);
  const size = Math.min(PHOTO_SIZE, side);
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';                       // fond blanc pour les PNG transparents
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(size / 2, size / 2);
  ctx.rotate(angle * Math.PI / 180);
  ctx.drawImage(source, (source.width - side) / 2, (source.height - side) / 2, side, side,
                -size / 2, -size / 2, size, size);
  return canvas.toDataURL('image/jpeg', PHOTO_QUALITY);
}

// Photo de galerie : une vignette carrée (300 px) pour la galerie, et une grande version
// (1600 px maximum de côté, sans recadrage) affichée quand on agrandit la photo.
export async function prepareGalleryPhoto(file) {
  const source = await readImage(file);
  try {
    const thumbSide = Math.min(source.width, source.height);
    const thumb = Object.assign(document.createElement('canvas'), { width: 300, height: 300 });
    const tctx = thumb.getContext('2d');
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(source, (source.width - thumbSide) / 2, (source.height - thumbSide) / 2, thumbSide, thumbSide, 0, 0, 300, 300);

    const scale = Math.min(1, 1600 / Math.max(source.width, source.height));
    const full = Object.assign(document.createElement('canvas'), {
      width: Math.round(source.width * scale), height: Math.round(source.height * scale),
    });
    const fctx = full.getContext('2d');
    fctx.fillStyle = '#fff';
    fctx.fillRect(0, 0, full.width, full.height);
    fctx.imageSmoothingQuality = 'high';
    fctx.drawImage(source, 0, 0, full.width, full.height);

    return { thumb: thumb.toDataURL('image/jpeg', 0.8), full: full.toDataURL('image/jpeg', 0.82) };
  } finally {
    source.close?.();
  }
}

function setupPhotoPicker(form, initialPhoto, showError) {
  const picker = form.querySelector('.photo-picker');
  const file = picker.querySelector('.photo-file');
  const value = form.elements.photo;
  const preview = picker.querySelector('.photo-preview');
  const pick = picker.querySelector('.pick-photo');
  const rotate = picker.querySelector('.photo-rotate');
  const remove = picker.querySelector('.remove-photo');

  let source = null;   // image d'origine (pour pivoter sans perte)
  let angle = 0;

  const show = dataUrl => {
    value.value = dataUrl ?? '';
    preview.style.backgroundImage = dataUrl ? `url("${dataUrl}")` : '';
    preview.classList.toggle('has-photo', !!dataUrl);
    pick.textContent = dataUrl ? 'Changer de photo…' : 'Choisir une photo…';
    rotate.hidden = remove.hidden = !dataUrl;
  };
  const busy = on => picker.querySelectorAll('button').forEach(b => { b.disabled = on; });

  const load = async f => {
    if (!f) return;
    busy(true);
    try {
      const bitmap = await readImage(f);
      source?.close?.();
      source = bitmap;
      angle = 0;
      show(renderPhoto(source, angle));
    } catch (err) {
      showError(err.message);
    } finally {
      busy(false);
      file.value = '';
    }
  };

  const turn = async delta => {
    busy(true);
    try {
      // Photo déjà enregistrée (modification d'une fiche) : on la relit une première fois.
      if (!source) source = await readImage(await (await fetch(value.value)).blob());
      angle = (angle + delta + 360) % 360;
      show(renderPhoto(source, angle));
    } catch (err) {
      showError(err.message);
    } finally {
      busy(false);
    }
  };

  pick.addEventListener('click', () => file.click());
  preview.addEventListener('click', () => file.click());
  picker.querySelector('.rotate-left').addEventListener('click', () => turn(-90));
  picker.querySelector('.rotate-right').addEventListener('click', () => turn(90));
  remove.addEventListener('click', () => { source = null; angle = 0; show(null); });
  file.addEventListener('change', () => load(file.files[0]));
  picker.addEventListener('dragover', e => { e.preventDefault(); picker.classList.add('drop'); });
  picker.addEventListener('dragleave', () => picker.classList.remove('drop'));
  picker.addEventListener('drop', e => {
    e.preventDefault();
    picker.classList.remove('drop');
    load(e.dataTransfer.files[0]);
  });

  show(initialPhoto || null);
}

// ---------- Construction de la requête ----------

function buildRequest(data, { relation, relativeId, current, youtubeIndex }) {
  const text = name => String(data.get(name) ?? '').trim();
  const firstName = text('firstName');
  if (!firstName) throw new Error('Le prénom est obligatoire.');

  const birthDate = parseDate(text('birthDate'), 'Naissance');
  const deathDate = parseDate(text('deathDate'), 'Décès');
  if (birthDate && deathDate && deathDate.slice(0, 4) < birthDate.slice(0, 4)) {
    throw new Error('La date de décès est antérieure à la naissance.');
  }

  const videoLink = text('video');
  if (videoLink && !youtubeId(videoLink)) {
    throw new Error("Le lien de l'interview n'est pas un lien YouTube reconnu.");
  }

  // Le formulaire ne gère qu'un lien YouTube : en modification, les autres vidéos sont conservées
  // telles quelles, et celle modifiée garde son titre et sa date si le lien n'a pas changé.
  const others = [...(current?.videos ?? [])];
  const previous = youtubeIndex >= 0 ? others.splice(youtubeIndex, 1)[0] : null;
  const edited = !videoLink ? null
    : previous && previous.id === videoLink ? previous
    : { provider: 'youtube', id: videoLink, title: previous?.title || `Interview de ${firstName}` };
  const videos = edited ? (youtubeIndex >= 0 ? [...others.slice(0, youtubeIndex), edited, ...others.slice(youtubeIndex)] : [edited, ...others]) : others;

  const event = (date, place) => (date || place ? { date: date || null, place: place || null } : null);
  return {
    relation,
    relativeId,
    otherParentId: data.get('otherParentId') || null,
    unionDate: relation === 'partner' ? parseDate(text('unionDate'), "Date de l'union") || null : null,
    person: {
      firstName,
      lastName: text('lastName') || null,
      birthName: text('birthName') || null,
      sex: data.get('sex') || null,
      birth: event(birthDate, text('birthPlace')),
      death: event(deathDate, text('deathPlace')),
      photo: text('photo') || null,
      bio: text('bio') || null,
      videos,
    },
  };
}
