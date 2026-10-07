// Liste déroulante avec recherche, sur le modèle du composant « Combobox » de shadcn/ui
// (un bouton qui ouvre une petite fenêtre avec un champ de recherche et la liste des choix).
// Le site n'utilise pas React : même comportement, en JavaScript simple.
//
//   options     : [{ value, label, detail?, image?, initials? }]
//   multiple    : plusieurs choix possibles (étiquettes), sinon un seul
//   selected    : valeurs déjà choisies (multiple)
//   placeholder : texte du bouton ; searchPlaceholder : texte du champ de recherche
//   onSelect(value)   : choix unique ; onChange(values) : choix multiple
//
// Clavier : ↑ ↓ pour se déplacer, Entrée pour choisir, Échap pour fermer.
// Recherche sans tenir compte des accents ni des majuscules.

import { escapeHtml } from './data.js';

const normalize = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
let uid = 0;

export function createCombobox({
  options, multiple = false, selected = [], placeholder = 'Choisir…',
  searchPlaceholder = 'Rechercher…', emptyText = 'Aucun résultat.', icon = '', onSelect, onChange,
}) {
  const id = `cbx-${++uid}`;
  const chosen = new Set(selected);
  const root = document.createElement('div');
  root.className = `combobox${multiple ? ' multiple' : ''}`;
  root.innerHTML = `
    <button type="button" class="combobox-trigger" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}-list">
      ${icon}<span class="combobox-label"></span>
      <svg class="combobox-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 15l5 5 5-5M7 9l5-5 5 5"/></svg>
    </button>
    <div class="combobox-popover" hidden>
      <div class="combobox-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
        <input type="text" role="combobox" aria-autocomplete="list" aria-expanded="true"
               aria-controls="${id}-list" placeholder="${escapeHtml(searchPlaceholder)}" autocomplete="off" spellcheck="false">
      </div>
      <ul class="combobox-list" id="${id}-list" role="listbox" ${multiple ? 'aria-multiselectable="true"' : ''}></ul>
      <p class="combobox-empty" hidden>${escapeHtml(emptyText)}</p>
    </div>
    ${multiple ? '<div class="combobox-tags"></div>' : ''}`;

  const trigger = root.querySelector('.combobox-trigger');
  const label = root.querySelector('.combobox-label');
  const popover = root.querySelector('.combobox-popover');
  const input = root.querySelector('input');
  const list = root.querySelector('.combobox-list');
  const empty = root.querySelector('.combobox-empty');
  const tags = root.querySelector('.combobox-tags');
  let active = -1;        // index de l'option surlignée parmi celles affichées
  let visible = [];       // options affichées (après filtrage)

  const avatar = o => o.image
    ? `<img src="${escapeHtml(o.image)}" alt="">`
    : `<span aria-hidden="true">${escapeHtml(o.initials ?? o.label[0] ?? '')}</span>`;

  function renderLabel() {
    if (!multiple) { label.textContent = placeholder; return; }
    label.textContent = chosen.size ? `${chosen.size} personne${chosen.size > 1 ? 's' : ''} choisie${chosen.size > 1 ? 's' : ''}` : placeholder;
    tags.innerHTML = [...chosen].map(v => {
      const o = options.find(x => x.value === v);
      return o ? `<span class="combobox-tag">${escapeHtml(o.label)}
        <button type="button" data-remove="${escapeHtml(v)}" aria-label="Retirer ${escapeHtml(o.label)}">×</button></span>` : '';
    }).join('');
  }

  function renderList() {
    const q = normalize(input.value.trim());
    visible = options.filter(o => !q || normalize(`${o.label} ${o.detail ?? ''} ${o.keywords ?? ''}`).includes(q)).slice(0, 80);
    list.innerHTML = visible.map((o, i) => `
      <li role="option" id="${id}-opt-${i}" data-index="${i}" aria-selected="${chosen.has(o.value)}"
          class="${i === active ? 'active' : ''}">
        <span class="combobox-avatar">${avatar(o)}</span>
        <span class="combobox-text"><span>${escapeHtml(o.label)}</span>${o.detail ? `<small>${escapeHtml(o.detail)}</small>` : ''}</span>
        <svg class="combobox-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>
      </li>`).join('');
    empty.hidden = visible.length > 0;
    input.setAttribute('aria-activedescendant', active >= 0 ? `${id}-opt-${active}` : '');
  }

  function setActive(i) {
    active = visible.length ? (i + visible.length) % visible.length : -1;
    list.querySelectorAll('li').forEach((li, k) => li.classList.toggle('active', k === active));
    list.querySelector('li.active')?.scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', active >= 0 ? `${id}-opt-${active}` : '');
  }

  function open() {
    popover.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    root.classList.add('open');
    input.value = '';
    active = 0;
    renderList();
    input.focus({ preventScroll: true });
    // Liste ouverte dans un formulaire qui défile : on la fait apparaître en entier.
    popover.scrollIntoView({ block: 'nearest' });
  }

  function close({ focusTrigger = true } = {}) {
    if (popover.hidden) return;
    popover.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    root.classList.remove('open');
    if (focusTrigger) trigger.focus({ preventScroll: true });
  }

  function choose(i) {
    const o = visible[i];
    if (!o) return;
    if (multiple) {
      chosen.has(o.value) ? chosen.delete(o.value) : chosen.add(o.value);
      renderLabel();
      renderList();
      setActive(i);
      onChange?.([...chosen]);
    } else {
      close();
      onSelect?.(o.value);
    }
  }

  trigger.addEventListener('click', () => (popover.hidden ? open() : close()));
  input.addEventListener('input', () => { active = 0; renderList(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close({ focusTrigger: false });
  });
  // mousedown plutôt que click : le choix est pris avant que le champ ne perde le focus.
  list.addEventListener('mousedown', e => {
    const li = e.target.closest('li');
    if (!li) return;
    e.preventDefault();
    choose(Number(li.dataset.index));
  });
  list.addEventListener('mousemove', e => {
    const li = e.target.closest('li');
    if (li && Number(li.dataset.index) !== active) setActive(Number(li.dataset.index));
  });
  tags?.addEventListener('click', e => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    chosen.delete(btn.dataset.remove);
    renderLabel();
    if (!popover.hidden) renderList();
    onChange?.([...chosen]);
  });
  // Clic ailleurs : on ferme.
  document.addEventListener('pointerdown', e => { if (!root.contains(e.target)) close({ focusTrigger: false }); });

  renderLabel();
  return {
    element: root,
    open,
    close,
    get values() { return [...chosen]; },
    setOptions(next) { options = next; if (multiple) renderLabel(); if (!popover.hidden) renderList(); },
  };
}

// Les personnes de l'arbre, au format attendu par le combobox.
export function personOptions(family, { exclude = [] } = {}) {
  const skip = new Set(exclude);
  return [...family.persons.values()]
    .filter(p => !skip.has(p.id))
    .map(p => {
      const label = [p.firstName, p.lastName].filter(Boolean).join(' ');
      const years = [p.birth?.date, p.death?.date].filter(Boolean).map(d => String(d).slice(0, 4)).join(' – ');
      return {
        value: p.id, label,
        detail: [years, p.birthName ? `${p.sex === 'M' ? 'né' : 'née'} ${p.birthName}` : ''].filter(Boolean).join(' · '),
        keywords: p.birthName ?? '', image: p.photo,
        initials: [p.firstName, p.lastName].map(s => (s ?? '').trim()[0] ?? '').join('').toUpperCase(),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
}
