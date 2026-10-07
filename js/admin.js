// Mode administrateur :
//  - fenêtre « Mode administrateur » : demander un lien de connexion, voir où en est sa demande ;
//  - espace d'administration (propriétaire) : accepter / refuser / retirer des adresses,
//    changer le mot de passe de la famille, sauvegarder ou restaurer l'arbre.

import { rpc, familyJson, escapeHtml } from './data.js';
import { signIn, signUp, sendPasswordReset, updatePassword, signOut, MIN_PASSWORD } from './auth.js';

function makeDialog(className) {
  const d = document.createElement('dialog');
  d.className = `person-form ${className}`;
  d.setAttribute('aria-labelledby', `${className}-title`);
  document.body.append(d);
  d.addEventListener('click', e => { if (e.target === d) d.close(); });
  return d;
}

let loginDialog, spaceDialog;

const STATUS_TEXT = {
  pending: "Votre demande est <strong>en attente</strong> : le propriétaire du site doit l'accepter. Revenez plus tard : vous serez alors administrateur en vous reconnectant.",
  refused: "Votre demande a été <strong>refusée</strong> par le propriétaire du site.",
  approved: "Vous êtes <strong>administrateur</strong> : utilisez le crayon en bas à droite pour modifier l'arbre.",
};

const passwordFields = (label = 'Mot de passe') => `
  <label class="field"><span>${label} <small>(${MIN_PASSWORD} caractères minimum)</small></span>
    <input name="password" type="password" autocomplete="new-password" required></label>
  <label class="field"><span>Confirmer le mot de passe</span>
    <input name="confirm" type="password" autocomplete="new-password" required></label>`;

// Contenu de chaque écran de la fenêtre « Mode administrateur ».
const VIEWS = {
  login: () => `
    <header><h2 id="admin-login-title">Mode administrateur</h2>
      <p>Connectez-vous avec votre compte pour modifier l'arbre.</p></header>
    <div class="form-body">
      <label class="field"><span>Adresse e-mail</span>
        <input name="email" type="email" autocomplete="email" required placeholder="prenom.nom@exemple.fr"></label>
      <label class="field"><span>Mot de passe</span>
        <input name="password" type="password" autocomplete="current-password" required></label>
      <p class="admin-links">
        <button type="button" class="link-btn" data-view="forgot">Mot de passe oublié ?</button>
        <span aria-hidden="true">·</span>
        <button type="button" class="link-btn" data-view="signup">Créer un compte</button>
      </p>
    </div>`,
  signup: () => `
    <header><h2 id="admin-login-title">Créer un compte</h2>
      <p>Un e-mail vous sera envoyé <strong>une seule fois</strong> pour vérifier votre adresse. Ensuite, votre demande
        sera transmise au propriétaire du site, qui devra l'accepter.</p></header>
    <div class="form-body">
      <label class="field"><span>Adresse e-mail</span>
        <input name="email" type="email" autocomplete="email" required placeholder="prenom.nom@exemple.fr"></label>
      ${passwordFields()}
      <p class="admin-links"><button type="button" class="link-btn" data-view="login">J'ai déjà un compte</button></p>
    </div>`,
  forgot: () => `
    <header><h2 id="admin-login-title">Mot de passe oublié</h2>
      <p>Vous allez recevoir un lien pour choisir un nouveau mot de passe. Ouvrez-le dans ce même navigateur.</p></header>
    <div class="form-body">
      <label class="field"><span>Adresse e-mail</span>
        <input name="email" type="email" autocomplete="email" required placeholder="prenom.nom@exemple.fr"></label>
      <p class="admin-links"><button type="button" class="link-btn" data-view="login">Retour à la connexion</button></p>
    </div>`,
  recovery: () => `
    <header><h2 id="admin-login-title">Nouveau mot de passe</h2>
      <p>Choisissez votre nouveau mot de passe.</p></header>
    <div class="form-body">${passwordFields('Nouveau mot de passe')}</div>`,
};

const SUBMIT_LABEL = {
  login: 'Se connecter', signup: 'Créer mon compte', forgot: 'Recevoir le lien', recovery: 'Enregistrer',
};

// Fenêtre « Mode administrateur ».
//  status        : résultat de adminStatus() (null si personne n'est connecté) ;
//  view          : écran de départ quand on n'est pas connecté ('login' par défaut, 'recovery' au retour
//                  du lien « mot de passe oublié ») ;
//  onSignedIn()  : appelé après une connexion réussie, renvoie le nouveau statut ;
//  onSignedOut() : appelé après la déconnexion ;
//  onOpenSpace() : ouvre l'espace d'administration (propriétaire) ;
//  onEditTree()  : retour à l'arbre en mode édition (administrateur accepté).
export function openAdminDialog({ status, view = 'login', onSignedIn, onSignedOut, onOpenSpace, onEditTree }) {
  loginDialog ??= makeDialog('admin-login');
  const d = loginDialog;

  const show = html => {
    d.innerHTML = html;
    d.querySelectorAll('[value=cancel]').forEach(b => b.addEventListener('click', () => d.close()));
    if (!d.open) d.showModal();
    queueMicrotask(() => d.querySelector('input, .btn-primary')?.focus());
  };
  const errorBox = () => d.querySelector('.form-error');
  const fail = err => { const e = errorBox(); e.textContent = err.message; e.hidden = false; };

  // Écrans de connexion, création de compte, mot de passe oublié, nouveau mot de passe.
  function showForm(name) {
    show(`
      <form novalidate>
        ${VIEWS[name]()}
        <p class="form-error" role="alert" hidden></p>
        <footer>
          <button type="button" class="btn-secondary" value="cancel">Fermer</button>
          <button type="submit" class="btn-primary">${SUBMIT_LABEL[name]}</button>
        </footer>
      </form>`);
    const form = d.querySelector('form');
    const submit = form.querySelector('[type=submit]');
    form.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => showForm(b.dataset.view)));

    form.addEventListener('submit', async e => {
      e.preventDefault();
      errorBox().hidden = true;
      submit.disabled = true;
      submit.textContent = '…';
      const v = form.elements;
      try {
        if (name === 'login') {
          await signIn(v.email.value, v.password.value);
          showStatus(await onSignedIn?.());
        } else if (name === 'signup') {
          const email = await signUp(v.email.value, v.password.value, v.confirm.value);
          showMessage('Vérifiez votre adresse',
            `Un e-mail de confirmation a été envoyé à <strong>${escapeHtml(email)}</strong>.
             Cliquez sur le lien qu'il contient, dans ce même navigateur : votre demande sera alors transmise
             au propriétaire du site. Pensez à regarder dans les courriers indésirables.`);
        } else if (name === 'forgot') {
          const email = await sendPasswordReset(v.email.value);
          showMessage('E-mail envoyé',
            `Si un compte existe pour <strong>${escapeHtml(email)}</strong>, un lien pour choisir un nouveau mot de passe
             vient d'y être envoyé. Ouvrez-le dans ce même navigateur.`);
        } else if (name === 'recovery') {
          await updatePassword(v.password.value, v.confirm.value);
          showStatus(await onSignedIn?.(), 'Votre nouveau mot de passe est enregistré.');
        }
      } catch (err) {
        fail(err);
        submit.disabled = false;
        submit.textContent = SUBMIT_LABEL[name];
      }
    });
  }

  function showMessage(title, html) {
    show(`
      <form novalidate>
        <header><h2 id="admin-login-title">${title}</h2></header>
        <div class="form-body"><p class="admin-sent">${html}</p></div>
        <footer><button type="button" class="btn-primary" value="cancel">J'ai compris</button></footer>
      </form>`);
  }

  // Personne connectée : où en est sa demande, son mot de passe, la déconnexion.
  function showStatus(current, notice = '') {
    if (!current) { showForm('login'); return; }
    const isOwner = current.role === 'owner' && current.status === 'approved';
    const canEdit = current.status === 'approved';
    show(`
      <form novalidate>
        <header>
          <h2 id="admin-login-title">Mode administrateur</h2>
          <p>Connecté avec <strong>${escapeHtml(current.email)}</strong></p>
        </header>
        <div class="form-body">
          ${notice ? `<p class="space-note">${escapeHtml(notice)}</p>` : ''}
          <p class="admin-status status-${current.status}">${isOwner
            ? 'Vous êtes le <strong>propriétaire</strong> du site.'
            : STATUS_TEXT[current.status] ?? ''}</p>
          <details class="change-password">
            <summary>Choisir ou changer mon mot de passe</summary>
            <div class="change-password-body">
              ${passwordFields('Nouveau mot de passe')}
              <button type="button" class="btn-secondary save-password">Enregistrer le mot de passe</button>
            </div>
          </details>
        </div>
        <p class="form-error" role="alert" hidden></p>
        <footer>
          <button type="button" class="btn-secondary sign-out">Se déconnecter</button>
          ${isOwner ? '<button type="button" class="btn-secondary open-space">Espace d’administration</button>' : ''}
          ${canEdit ? '<button type="button" class="btn-primary edit-tree">Modifier l’arbre</button>' : ''}
          <button type="button" class="btn-secondary" value="cancel">Fermer</button>
        </footer>
      </form>`);
    d.querySelector('.sign-out').addEventListener('click', async () => {
      await signOut();
      d.close();
      onSignedOut?.();
    });
    d.querySelector('.open-space')?.addEventListener('click', () => { d.close(); onOpenSpace?.(); });
    d.querySelector('.edit-tree')?.addEventListener('click', () => { d.close(); onEditTree?.(); });
    d.querySelector('.save-password').addEventListener('click', async () => {
      const f = d.querySelector('form').elements;
      errorBox().hidden = true;
      try {
        await updatePassword(f.password.value, f.confirm.value);
        showStatus(current, 'Mot de passe enregistré : vous pourrez désormais vous connecter avec.');
      } catch (err) {
        fail(err);
      }
    });
  }

  if (status) showStatus(status);
  else showForm(view);
}

// ---------- Espace d'administration (propriétaire) ----------

const formatDay = iso => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

// `family` : l'arbre chargé (pour la sauvegarde) ; `onImported()` : appelé après une restauration.
export function openAdminSpace({ family, onImported }) {
  spaceDialog ??= makeDialog('admin-space');
  const d = spaceDialog;
  d.innerHTML = `
    <div class="space">
      <header>
        <h2 id="admin-space-title">Espace d'administration</h2>
        <p>Qui peut modifier l'arbre, et comment on y accède.</p>
      </header>
      <div class="form-body">
        <section aria-labelledby="space-requests"><h3 id="space-requests">Demandes en attente</h3><div class="list" data-list="pending"></div></section>
        <section aria-labelledby="space-admins"><h3 id="space-admins">Administrateurs</h3><div class="list" data-list="approved"></div></section>
        <section aria-labelledby="space-refused"><h3 id="space-refused">Demandes refusées</h3><div class="list" data-list="refused"></div></section>

        <section aria-labelledby="space-password">
          <h3 id="space-password">Mot de passe de la famille</h3>
          <form class="password-form" novalidate>
            <div class="row">
              <label class="field"><span>Nouveau mot de passe <small>(8 caractères minimum)</small></span>
                <input name="pw1" type="password" autocomplete="new-password"></label>
              <label class="field"><span>Confirmer</span>
                <input name="pw2" type="password" autocomplete="new-password"></label>
            </div>
            <button type="submit" class="btn-primary">Changer le mot de passe</button>
            <p class="space-note" role="status"></p>
          </form>
        </section>

        <section aria-labelledby="space-backup">
          <h3 id="space-backup">Sauvegarde</h3>
          <p class="admin-hint">Téléchargez régulièrement une copie de l'arbre. La restauration <strong>remplace tout l'arbre</strong> par le contenu du fichier choisi.</p>
          <div class="backup-buttons">
            <button type="button" class="btn-secondary download">Télécharger family.json</button>
            <button type="button" class="btn-secondary restore">Restaurer depuis un fichier…</button>
            <input type="file" accept="application/json,.json" class="restore-file" hidden>
          </div>
          <p class="space-note backup-note" role="status"></p>
        </section>
      </div>
      <p class="form-error" role="alert" hidden></p>
      <footer><button type="button" class="btn-secondary" value="cancel">Fermer</button></footer>
    </div>`;

  const error = d.querySelector('.form-error');
  const fail = err => { error.textContent = err.message; error.hidden = false; };

  async function refresh() {
    error.hidden = true;
    let rows;
    try {
      rows = await rpc('admin_list');
    } catch (err) {
      fail(err);
      return;
    }
    for (const status of ['pending', 'approved', 'refused']) {
      const list = d.querySelector(`[data-list="${status}"]`);
      const items = rows.filter(r => r.status === status);
      list.innerHTML = items.length ? items.map(r => `
        <div class="admin-row" data-email="${escapeHtml(r.email)}">
          <div>
            <strong>${escapeHtml(r.email)}</strong>${r.role === 'owner' ? ' <span class="tag">propriétaire</span>' : ''}
            <small>${status === 'pending' ? 'demande du' : 'décision du'} ${formatDay(r.decidedAt ?? r.requestedAt)}</small>
          </div>
          <div class="row-actions">
            ${r.role === 'owner' ? '' : status === 'pending'
              ? '<button type="button" class="btn-primary" data-do="accept">Accepter</button><button type="button" class="btn-secondary" data-do="refuse">Refuser</button>'
              : status === 'approved'
              ? '<button type="button" class="btn-secondary danger" data-do="remove">Retirer</button>'
              : '<button type="button" class="btn-secondary" data-do="accept">Accepter</button><button type="button" class="btn-secondary danger" data-do="remove">Supprimer</button>'}
          </div>
        </div>`).join('')
        : `<p class="empty">${{ pending: 'Aucune demande en attente.', approved: 'Aucun administrateur.', refused: 'Aucune demande refusée.' }[status]}</p>`;
    }
  }

  d.querySelector('.form-body').addEventListener('click', async e => {
    const btn = e.target.closest('[data-do]');
    if (!btn) return;
    const email = btn.closest('.admin-row').dataset.email;
    if (btn.dataset.do === 'remove' && !confirm(`Retirer ${email} ? Cette adresse ne pourra plus modifier l'arbre.`)) return;
    btn.disabled = true;
    try {
      if (btn.dataset.do === 'remove') await rpc('admin_remove', { target_email: email });
      else await rpc('admin_decide', { target_email: email, accept: btn.dataset.do === 'accept' });
      await refresh();
    } catch (err) {
      fail(err);
      btn.disabled = false;
    }
  });

  const pwForm = d.querySelector('.password-form');
  pwForm.addEventListener('submit', async e => {
    e.preventDefault();
    const note = pwForm.querySelector('.space-note');
    const { pw1, pw2 } = pwForm.elements;
    error.hidden = true;
    note.textContent = '';
    if (pw1.value.length < 8) return fail(new Error('Le mot de passe doit contenir au moins 8 caractères.'));
    if (pw1.value !== pw2.value) return fail(new Error('Les deux mots de passe sont différents.'));
    try {
      await rpc('set_family_password', { new_password: pw1.value });
      pwForm.reset();
      note.textContent = 'Mot de passe changé. Communiquez-le à la famille : l\'ancien ne fonctionne plus.';
    } catch (err) {
      fail(err);
    }
  });

  d.querySelector('.download').addEventListener('click', () => {
    const blob = new Blob([familyJson(family)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `arbre-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  const fileInput = d.querySelector('.restore-file');
  d.querySelector('.restore').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    const note = d.querySelector('.backup-note');
    error.hidden = true;
    try {
      const doc = JSON.parse(await file.text());
      if (!Array.isArray(doc.persons) || !Array.isArray(doc.unions) || !Array.isArray(doc.children)) {
        throw new Error("Ce fichier n'est pas une sauvegarde de l'arbre (family.json).");
      }
      if (!confirm(`Remplacer tout l'arbre actuel par ce fichier (${doc.persons.length} personnes) ? Cette action est définitive.`)) return;
      const res = await rpc('admin_import', { doc });
      note.textContent = `Arbre restauré : ${res.persons} personnes.`;
      onImported?.();
    } catch (err) {
      fail(err instanceof SyntaxError ? new Error("Ce fichier n'est pas un JSON valide.") : err);
    }
  });

  d.querySelector('[value=cancel]').addEventListener('click', () => d.close());
  d.showModal();
  refresh();
}
