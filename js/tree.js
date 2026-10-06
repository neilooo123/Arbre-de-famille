// Disposition et rendu SVG de l'arbre, avec zoom et déplacement.
// L'arbre pousse vers le ciel : les ancêtres sont en bas, près des racines,
// et chaque génération suivante monte d'un étage.

import { fullName, initials, lifeSpan } from './data.js';

const NODE_W = 140;      // largeur réservée à une personne
const COUPLE_GAP = 24;   // écart entre deux conjoints
const SIB_GAP = 48;      // écart entre deux frères et sœurs
const TREE_GAP = 120;    // écart entre deux familles sans lien
const GEN_H = 240;       // hauteur d'une génération
const R = 44;            // rayon du médaillon
const TRUNK_H = 190;     // hauteur du tronc sous la première génération

const SVG_NS = 'http://www.w3.org/2000/svg';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// ---------- Disposition ----------

export function layoutTree(family) {
  const pos = new Map();
  const placed = new Set();
  const hasParents = id => !!family.parentUnionOf(id);

  // Place une personne, ses conjoints « venus d'ailleurs » et toute sa descendance
  // à partir de l'abscisse `left`. Renvoie le bord droit du bloc.
  function place(pid, left, depth, out) {
    placed.add(pid);
    const partners = family.partnersOf(pid).filter(p => !placed.has(p) && !hasParents(p));
    partners.forEach(p => placed.add(p));

    const sub = [];
    let x = left;
    for (const c of family.childrenOf(pid)) {
      if (placed.has(c)) continue;
      if (x > left) x += SIB_GAP;
      x = place(c, x, depth + 1, sub);
    }
    const kidsW = x - left;

    const block = [pid, ...partners];
    const blockW = block.length * NODE_W + (block.length - 1) * COUPLE_GAP;
    const width = Math.max(kidsW, blockW);

    const shift = (width - kidsW) / 2;
    if (shift) sub.forEach(id => { pos.get(id).x += shift; });

    let bx = left + (width - blockW) / 2 + NODE_W / 2;
    for (const id of block) {
      pos.set(id, { x: bx, y: -depth * GEN_H, depth });
      out.push(id);
      bx += NODE_W + COUPLE_GAP;
    }
    out.push(...sub);
    return left + width;
  }

  // Racines : personnes sans parents connus, qui ne seront pas placées
  // à côté d'un conjoint qui, lui, a des parents dans l'arbre.
  let x = 0;
  const ids = [...family.persons.keys()];
  for (const id of ids) {
    if (placed.has(id) || hasParents(id)) continue;
    if (family.partnersOf(id).some(hasParents)) continue;
    if (x > 0) x += TREE_GAP;
    x = place(id, x, 0, []);
  }
  // Filet de sécurité : tout ce qui n'a pas pu être rattaché.
  for (const id of ids) {
    if (placed.has(id)) continue;
    if (x > 0) x += TREE_GAP;
    x = place(id, x, 0, []);
  }
  return pos;
}

// ---------- Rendu ----------

const el = (name, attrs = {}) => {
  const n = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

const LEAF = 'M0,0 C5,-7 15,-8 22,0 C15,8 5,7 0,0 Z';

// Petit générateur pseudo-aléatoire stable, pour que les feuilles ne bougent pas d'un chargement à l'autre.
function seeded(seed) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function leafCluster(group, x, y, rand, count = 3) {
  for (let i = 0; i < count; i++) {
    const angle = Math.round(rand() * 360);
    const scale = (0.7 + rand() * 0.6).toFixed(2);
    const leaf = el('path', {
      d: LEAF,
      class: `leaf leaf-${1 + (i % 3)}`,
      transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${angle}) scale(${scale})`,
    });
    leaf.style.animationDelay = `${(-rand() * 6).toFixed(2)}s`;
    group.append(leaf);
  }
}

function branchPath(x1, y1, x2, y2) {
  const my = (y1 + y2) / 2;
  return `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
}

export function createTree(svg, family, { onSelect } = {}) {
  const pos = layoutTree(family);
  const rand = seeded(7);
  svg.replaceChildren();

  // Dégradé « bois » pour le cadre des médaillons.
  const defs = el('defs');
  defs.innerHTML = `
    <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="var(--wood-light)"/>
      <stop offset="0.45" stop-color="var(--wood)"/>
      <stop offset="0.55" stop-color="var(--wood-light)"/>
      <stop offset="1" stop-color="var(--bark)"/>
    </linearGradient>
    <clipPath id="medallion"><circle r="${R - 6}"/></clipPath>`;
  svg.append(defs);

  const scene = el('g', { class: 'scene' });
  const ground = el('g', { class: 'ground' });
  const branches = el('g', { class: 'branches' });
  const leaves = el('g', { class: 'leaves' });
  const nodes = el('g', { class: 'nodes' });
  scene.append(ground, branches, leaves, nodes);
  svg.append(scene);

  const unionPoint = u => {
    const pts = u.partners.map(id => pos.get(id)).filter(Boolean);
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: Math.min(...pts.map(p => p.y)),
      depth: Math.min(...pts.map(p => p.depth)),
    };
  };

  // Tronc et racines sous chaque famille de la première génération.
  const xs = [...pos.values()].map(p => p.x);
  const groundY = TRUNK_H;
  const minX = Math.min(...xs) - NODE_W, maxX = Math.max(...xs) + NODE_W;
  ground.append(el('ellipse', {
    class: 'hill', cx: (minX + maxX) / 2, cy: groundY + 40,
    rx: (maxX - minX) / 2 + 160, ry: 70,
  }));

  const trunkBases = new Set();
  for (const id of pos.keys()) {
    if (pos.get(id).depth !== 0) continue;
    const u = family.unionsOf(id)[0];
    const base = u ? unionPoint(u) : pos.get(id);
    const key = Math.round(base.x);
    if (trunkBases.has(key)) continue;
    trunkBases.add(key);
    const w = 26;
    branches.append(el('path', {
      class: 'trunk',
      d: `M${base.x - w / 2},${groundY + 10} C${base.x - w / 2 + 4},${groundY - 60} ${base.x - 6},${base.y + 40} ${base.x - 4},${base.y}
          L${base.x + 4},${base.y} C${base.x + 6},${base.y + 40} ${base.x + w / 2 - 4},${groundY - 60} ${base.x + w / 2},${groundY + 10} Z`,
    }));
    for (const dx of [-70, -30, 35, 75]) {
      branches.append(el('path', {
        class: 'root',
        d: `M${base.x + dx * 0.15},${groundY} Q${base.x + dx * 0.6},${groundY + 10} ${base.x + dx},${groundY + 34}`,
      }));
    }
  }

  // Branches : entre conjoints, puis de chaque couple vers ses enfants.
  for (const u of family.unions.values()) {
    const pts = u.partners.map(id => pos.get(id)).filter(Boolean);
    if (!pts.length) continue;
    const up = unionPoint(u);
    const width = Math.max(3, 11 - up.depth * 3);

    if (pts.length === 2) {
      const [a, b] = pts;
      branches.append(el('path', {
        class: 'branch couple', 'stroke-width': Math.max(3, width - 2),
        d: a.y === b.y
          ? `M${a.x},${a.y} Q${(a.x + b.x) / 2},${a.y + 18} ${b.x},${b.y}`
          : branchPath(a.x, a.y, b.x, b.y),
      }));
      leafCluster(leaves, up.x - 6, up.y + 12, rand, 4);
    }

    for (const c of u.children) {
      const cp = pos.get(c);
      if (!cp) continue;
      branches.append(el('path', {
        class: 'branch', 'stroke-width': width,
        d: branchPath(up.x, up.y + 10, cp.x, cp.y + R + 66),
      }));
      leafCluster(leaves, (up.x + cp.x) / 2, (up.y + cp.y) / 2 + 20, rand, 2);
    }
  }

  // Personnes.
  const nodeById = new Map();
  for (const [id, p] of pos) {
    const person = family.get(id);
    const g = el('g', {
      class: 'node', transform: `translate(${p.x} ${p.y})`,
      tabindex: 0, role: 'button', 'data-id': id,
      'aria-label': `${fullName(person)} ${lifeSpan(person)}`.trim(),
    });
    const sway = el('g', { class: 'sway' });
    sway.style.animationDelay = `${(-rand() * 8).toFixed(2)}s`;

    sway.append(el('circle', { class: 'halo', r: R + 7 }));
    sway.append(el('circle', { class: 'frame', r: R }));
    sway.append(el('circle', { class: 'inner', r: R - 6 }));
    if (person.photo) {
      sway.append(el('image', {
        href: person.photo, x: -(R - 6), y: -(R - 6), width: 2 * (R - 6), height: 2 * (R - 6),
        'clip-path': 'url(#medallion)', preserveAspectRatio: 'xMidYMid slice',
      }));
    } else {
      const t = el('text', { class: 'initials', 'text-anchor': 'middle', dy: '0.35em' });
      t.textContent = initials(person);
      sway.append(t);
    }
    if (person.videos?.length) {
      const badge = el('g', { class: 'video-badge', transform: `translate(${R * 0.72} ${-R * 0.72})` });
      badge.append(el('circle', { r: 13 }), el('path', { d: 'M-4,-6 L7,0 L-4,6 Z' }));
      badge.append(Object.assign(el('title'), { textContent: 'Interview disponible' }));
      sway.append(badge);
    }
    const name = el('text', { class: 'name', y: R + 24, 'text-anchor': 'middle' });
    name.textContent = person.firstName ?? '';
    const last = el('text', { class: 'lastname', y: R + 42, 'text-anchor': 'middle' });
    last.textContent = person.lastName ?? '';
    const years = el('text', { class: 'years', y: R + 60, 'text-anchor': 'middle' });
    years.textContent = lifeSpan(person);
    sway.append(name, last, years);

    g.append(sway);
    g.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(id); }
    });
    nodes.append(g);
    nodeById.set(id, g);
  }

  // ---------- Zoom & déplacement (via le viewBox) ----------

  const bounds = (() => {
    const ys = [...pos.values()].map(p => p.y);
    return {
      x: minX - 60, y: Math.min(...ys) - R - 40,
      w: maxX - minX + 120, h: groundY + 90 - (Math.min(...ys) - R - 40),
    };
  })();
  let vb = { ...bounds };
  const apply = () => svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);

  const rect = () => svg.getBoundingClientRect();
  // On garde toujours le même rapport largeur/hauteur que l'élément SVG : pas de déformation.
  const fitAspect = () => {
    const r = rect();
    if (!r.width || !r.height) return;
    const cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2;
    vb.h = vb.w * (r.height / r.width);
    vb.x = cx - vb.w / 2; vb.y = cy - vb.h / 2;
  };
  const toSvg = (clientX, clientY) => {
    const r = rect();
    return { x: vb.x + ((clientX - r.left) / r.width) * vb.w, y: vb.y + ((clientY - r.top) / r.height) * vb.h };
  };
  const minW = 320, maxW = () => Math.max(bounds.w, bounds.h) * 4;

  function zoomAt(px, py, factor) {
    const w = Math.min(maxW(), Math.max(minW, vb.w / factor));
    const k = w / vb.w;
    vb = { x: px - (px - vb.x) * k, y: py - (py - vb.y) * k, w, h: vb.h * k };
    apply();
  }

  let anim = 0;
  function animateTo(target, duration = 450) {
    cancelAnimationFrame(anim);
    if (reducedMotion.matches) { vb = target; apply(); return; }
    const from = { ...vb }, t0 = performance.now();
    const ease = t => 1 - Math.pow(1 - t, 3);
    const step = now => {
      const t = Math.min(1, (now - t0) / duration), e = ease(t);
      vb = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e,
             w: from.w + (target.w - from.w) * e, h: from.h + (target.h - from.h) * e };
      apply();
      if (t < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }

  let fitted = false;
  function fit({ rightInset = 0, animate = true } = {}) {
    const r = rect();
    if (!r.width || !r.height) return; // pas encore affiché : le ResizeObserver refera le cadrage
    fitted = true;
    const area = visibleArea(r, rightInset);
    const pad = 1.06;
    // Unités SVG par pixel écran : assez pour que tout l'arbre tienne dans la zone libre.
    const s = Math.max(bounds.w * pad / area.w, bounds.h * pad / area.h, minW / r.width);
    const target = viewCenteredOn(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2, s, r, area);
    animate ? animateTo(target) : (vb = target, apply());
  }

  // Centre une personne dans la zone visible (sous l'en-tête, à gauche du panneau s'il est ouvert).
  function focus(id, { rightInset = 0 } = {}) {
    const p = pos.get(id);
    const r = rect();
    if (!p || !r.width || !r.height) return;
    const area = visibleArea(r, rightInset);
    const wanted = Math.max(NODE_W * 5 / area.w, GEN_H * 2.4 / area.h);
    const s = Math.min(vb.w / r.width, wanted);
    animateTo(viewCenteredOn(p.x, p.y + 20, s, r, area));
  }

  // Zone de l'écran réellement libre : on retire l'en-tête, la barre d'aide et le panneau.
  function visibleArea(r, rightInset) {
    const top = r.height > 500 ? 96 : 80, bottom = 48;
    return { left: 0, top, w: Math.max(1, r.width - rightInset), h: Math.max(1, r.height - top - bottom) };
  }

  function viewCenteredOn(cx, cy, s, r, area) {
    return {
      x: cx - (area.left + area.w / 2) * s,
      y: cy - (area.top + area.h / 2) * s,
      w: r.width * s,
      h: r.height * s,
    };
  }

  function select(id) {
    for (const [nid, g] of nodeById) g.classList.toggle('selected', nid === id);
  }

  // Pointeurs : un doigt ou la souris déplace, deux doigts zooment, un appui court sélectionne.
  const pointers = new Map();
  let drag = null;

  svg.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const node = e.target.closest?.('.node');
    drag = { startX: e.clientX, startY: e.clientY, moved: false, nodeId: pointers.size === 1 ? node?.dataset.id : null };
    cancelAnimationFrame(anim);
  });

  svg.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    const cur = { x: e.clientX, y: e.clientY };

    if (pointers.size === 1) {
      if (!drag.moved && Math.hypot(cur.x - drag.startX, cur.y - drag.startY) < 6) return;
      if (!drag.moved) { drag.moved = true; svg.setPointerCapture(e.pointerId); svg.classList.add('dragging'); }
      const r = rect();
      vb.x -= ((cur.x - prev.x) / r.width) * vb.w;
      vb.y -= ((cur.y - prev.y) / r.height) * vb.h;
      apply();
    } else if (pointers.size === 2) {
      drag.moved = true;
      const [other] = [...pointers].filter(([pid]) => pid !== e.pointerId).map(([, p]) => p);
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(cur.x - other.x, cur.y - other.y);
      const mid = toSvg((cur.x + other.x) / 2, (cur.y + other.y) / 2);
      if (before > 0) zoomAt(mid.x, mid.y, after / before);
    }
    pointers.set(e.pointerId, cur);
  });

  const endPointer = e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      if (e.type === 'pointerup' && drag && !drag.moved && drag.nodeId) onSelect?.(drag.nodeId);
      svg.classList.remove('dragging');
      drag = null;
    }
  };
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);

  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const p = toSvg(e.clientX, e.clientY);
    zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
  }, { passive: false });

  new ResizeObserver(() => {
    if (!fitted) fit({ animate: false });
    else { fitAspect(); apply(); }
  }).observe(svg);

  apply();
  fit({ animate: false });

  return {
    fit,
    focus,
    select,
    zoomBy(factor) {
      zoomAt(vb.x + vb.w / 2, vb.y + vb.h / 2, factor);
    },
  };
}

