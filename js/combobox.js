// Liste déroulante avec recherche, sur le modèle du composant « Combobox » de shadcn/ui.
// Le site n'utilise pas React : même comportement, en JavaScript simple.
//
//  - choix unique (recherche d'une personne) : un bouton qui ouvre une petite fenêtre avec un champ
//    de recherche ;
//  - choix multiple (personnes sur une photo), comme ComboboxChips : les choix sont des étiquettes
//    DANS le champ, et on tape directement à la suite pour chercher.
//
//   options     : [{ value, label, detail?, image?, initials? }]
//   multiple    : plusieurs choix possibles, sinon un seul
//   selected    : valeurs déjà choisies (multiple)
//   placeholder : texte du bouton ; searchPlaceholder : texte du champ de recherche
//   onSelect(value)   : choix unique ; onChange(values) : choix multiple
//
// La liste flotte par-dessus la page (sans agrandir le formulaire) : en dessous du champ s'il y a
// la place, sinon au-dessus.
// Clavier : ↑ ↓ pour se déplacer, Entrée pour choisir, Échap pour fermer, Retour arrière (chips)
// pour retirer la dernière étiquette. Recherche sans tenir compte des accents ni des majuscules.

import { escapeHtml } from './data.js';

const normalize = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
let uid = 0;

const CHECK = '<svg class="combobox-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';
const SEARCH = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';

export function createCombobox({
  options, multiple = false, selected = [], placeholder = 'Choisir…',
  searchPlaceholder = 'Rechercher…', emptyText = 'Aucun résultat.', icon = '', onSelect, onChange,
}) {
  const id = `cbx-${++uid}`;
  const chips = multiple;   // choix multiple : étiquettes dans le champ
  const chosen = new Set(selected);
  const root = document.createElement('div');
  root.className = `combobox${multiple ? ' multiple' : ''}${chips ? ' chips' : ''}`;

  const listHtml = `
    <ul class="combobox-list" id="${id}-list" role="listbox" ${multiple ? 'aria-multiselectable="true"' : ''}></ul>
    <p class="combobox-empty" hidden>${escapeHtml(emptyText)}</p>`;
  root.innerHTML = chips ? `
    <div class="combobox-chips-field">
      <span class="combobox-chip-list"></span>
      <input type="text" class="combobox-chips-input" role="combobox" aria-autocomplete="list" aria-expanded="false"
             aria-controls="${id}-list" placeholder="${escapeHtml(searchPlaceholder)}" autocomplete="off" spellcheck="false">
    </div>
    <div class="combobox-popover" hidden>${listHtml}</div>` : `
    <button type="button" class="combobox-trigger" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}-list">
      ${icon}<span class="combobox-label"></span>
      <svg class="combobox-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 15l5 5 5-5M7 9l5-5 5 5"/></svg>
    </button>
    <div class="combobox-popover" hidden>
      <div class="combobox-search">
        ${SEARCH}
        <input type="text" role="combobox" aria-autocomplete="list" aria-expanded="true"
               aria-controls="${id}-list" placeholder="${escapeHtml(searchPlaceholder)}" autocomplete="off" spellcheck="false">
      </div>
      ${listHtml}
    </div>`;

  const anchor = root.querySelector(chips ? '.combobox-chips-field' : '.combobox-trigger');
  const trigger = root.querySelector('.combobox-trigger');
  const label = root.querySelector('.combobox-label');
  const popover = root.querySelector('.combobox-popover');
  const input = root.querySelector('input');
  const list = root.querySelector('.combobox-list');
  const empty = root.querySelector('.combobox-empty');
  const tags = root.querySelector('.combobox-chip-list');
  let active = -1;        // index de l'option surlignée parmi celles affichées
  let visible = [];       // options affichées (après filtrage)

  const avatar = o => o.image
    ? `<img src="${escapeHtml(o.image)}" alt="">`
    : `<span aria-hidden="true">${escapeHtml(o.initials ?? o.label[0] ?? '')}</span>`;

  function renderLabel() {
    if (label) label.textContent = placeholder;
    if (!tags) return;
    tags.innerHTML = [...chosen].map(v => {
      const o = options.find(x => x.value === v);
      return o ? `<span class="combobox-tag">${escapeHtml(o.label)}
        <button type="button" data-remove="${escapeHtml(v)}" aria-label="Retirer ${escapeHtml(o.label)}">×</button></span>` : '';
    }).join('');
    input.placeholder = chosen.size ? '' : searchPlaceholder;
  }

  function renderList() {
    const q = normalize(input.value.trim());
    visible = options.filter(o => !q || normalize(`${o.label} ${o.detail ?? ''} ${o.keywords ?? ''}`).includes(q)).slice(0, 80);
    list.innerHTML = visible.map((o, i) => `
      <li role="option" id="${id}-opt-${i}" data-index="${i}" aria-selected="${chosen.has(o.value)}"
          class="${i === active ? 'active' : ''}">
        <span class="combobox-avatar">${avatar(o)}</span>
        <span class="combobox-text"><span>${escapeHtml(o.label)}</span>${o.detail ? `<small>${escapeHtml(o.detail)}</small>` : ''}</span>
        ${CHECK}
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

  // La liste flotte par-dessus la page : sous le champ s'il y a la place, sinon au-dessus.
  function place() {
    if (popover.hidden) return;
    const r = anchor.getBoundingClientRect();
    const margin = 8, gap = 6;
    const below = innerHeight - r.bottom - gap - margin;
    const above = r.top - gap - margin;
    const openBelow = below >= 240 || below >= above;
    const room = Math.max(120, Math.min(340, openBelow ? below : above));
    const width = Math.min(Math.max(r.width, 280), innerWidth - 2 * margin);
    popover.style.left = `${Math.max(margin, Math.min(r.left, innerWidth - width - margin))}px`;
    popover.style.width = `${width}px`;
    popover.style.top = openBelow ? `${r.bottom + gap}px` : '';
    popover.style.bottom = openBelow ? '' : `${innerHeight - r.top + gap}px`;
    popover.classList.toggle('above', !openBelow);
    const search = popover.querySelector('.combobox-search')?.offsetHeight ?? 0;
    list.style.maxHeight = `${room - search - 10}px`;
  }
  const onViewportChange = () => place();

  function open() {
    if (!popover.hidden) return;
    popover.hidden = false;
    (trigger ?? input).setAttribute('aria-expanded', 'true');
    root.classList.add('open');
    if (!chips) input.value = '';
    active = 0;
    renderList();
    place();
    input.focus({ preventScroll: true });
    // Le formulaire qui défile, ou la fenêtre qui change de taille : la liste suit le champ.
    addEventListener('scroll', onViewportChange, true);
    addEventListener('resize', onViewportChange);
  }

  function close({ focusTrigger = true } = {}) {
    if (popover.hidden) return;
    popover.hidden = true;
    (trigger ?? input).setAttribute('aria-expanded', 'false');
    root.classList.remove('open');
    removeEventListener('scroll', onViewportChange, true);
    removeEventListener('resize', onViewportChange);
    if (chips) input.value = '';
    else if (focusTrigger) trigger.focus({ preventScroll: true });
  }

  function choose(i) {
    const o = visible[i];
    if (!o) return;
    if (multiple) {
      chosen.has(o.value) ? chosen.delete(o.value) : chosen.add(o.value);
      const typed = chips && input.value;
      if (typed) input.value = '';   // chips : après un choix, on repart d'une recherche vide
      renderLabel();
      renderList();
      setActive(typed ? visible.findIndex(x => x.value === o.value) : i);
      place();   // le champ a pu changer de hauteur (nouvelle ligne d'étiquettes)
      onChange?.([...chosen]);
    } else {
      close();
      onSelect?.(o.value);
    }
  }

  function remove(value) {
    chosen.delete(value);
    renderLabel();
    if (!popover.hidden) { renderList(); place(); }
    onChange?.([...chosen]);
  }

  if (trigger) trigger.addEventListener('click', () => (popover.hidden ? open() : close()));
  if (chips) {
    // Un clic n'importe où dans le champ : on tape à la suite des étiquettes.
    anchor.addEventListener('mousedown', e => {
      if (e.target.closest('[data-remove]')) return;
      if (e.target !== input) e.preventDefault();
      input.focus();
      open();
    });
    input.addEventListener('focus', open);
  }
  input.addEventListener('input', () => { if (popover.hidden) open(); active = 0; renderList(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); open(); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (!popover.hidden) choose(active); }
    else if (e.key === 'Escape') { if (!popover.hidden) { e.preventDefault(); e.stopPropagation(); close(); } }
    else if (e.key === 'Tab') close({ focusTrigger: false });
    else if (e.key === 'Backspace' && chips && !input.value && chosen.size) remove([...chosen].at(-1));
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
  tags?.addEventListener('mousedown', e => { if (e.target.closest('[data-remove]')) e.preventDefault(); });
  tags?.addEventListener('click', e => {
    const btn = e.target.closest('[data-remove]');
    if (btn) remove(btn.dataset.remove);
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
