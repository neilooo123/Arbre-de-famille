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

const CALM_ABOVE = 40;   // au-delà de ce nombre de personnes, le vent ne souffle plus en continu (fluidité)
const FAR_SCALE = 0.42;  // en dessous de ce zoom (pixels par unité), noms et feuilles sont masqués

const SVG_NS = 'http://www.w3.org/2000/svg';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// ---------- Disposition ----------

export function layoutTree(family) {
  const pos = new Map();
  const placed = new Set();
  const hasParents = id => !!family.parentUnionOf(id);

  // Un conjoint pas encore placé dont la famille est aussi dans l'arbre : il « relie » deux familles.
  const marriesOut = id => family.partnersOf(id).some(p => !placed.has(p) && hasParents(p));

  // Une personne et tous ses conjoints, actuels ou ex, de proche en proche : par exemple Michel,
  // sa conjointe Christine et l'ex-conjoint de Christine. Ils sont placés côte à côte, sur la même génération.
  const partnerChain = id => {
    const chain = [id];
    for (let i = 0; i < chain.length; i++) {
      for (const p of family.partnersOf(chain[i])) if (!chain.includes(p)) chain.push(p);
    }
    return chain;
  };

  // Place une personne, ses conjoints (toujours à côté d'elle) et toute leur descendance
  // à partir de l'abscisse `left`. Renvoie le bord droit du bloc.
  function place(pid, left, depth, out) {
    placed.add(pid);
    const block = [pid];
    for (let i = 0; i < block.length; i++) {
      for (const p of family.partnersOf(block[i])) {
        if (!placed.has(p)) { placed.add(p); block.push(p); }
      }
    }

    // Enfants du bloc, du plus âgé au plus jeune ; ceux qui épousent quelqu'un d'une autre
    // famille de l'arbre passent en dernier, pour que les deux familles se retrouvent côte à côte.
    const kids = [...new Set(block.flatMap(id => family.childrenOf(id)))].filter(c => !placed.has(c));
    kids.sort((a, b) => marriesOut(a) - marriesOut(b));

    const sub = [];
    let x = left;
    for (const c of kids) {
      if (placed.has(c)) continue;
      if (x > left) x += SIB_GAP;
      x = place(c, x, depth + 1, sub);
    }
    const kidsW = x - left;

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

  // Racines : personnes sans parents connus (sauf si elles seront placées à côté d'un conjoint,
  // ou du conjoint d'un conjoint, qui a des parents dans l'arbre).
  let x = 0;
  const ids = [...family.persons.keys()];
  for (const id of ids) {
    if (placed.has(id) || hasParents(id)) continue;
    if (partnerChain(id).some(hasParents)) continue;
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

const leafTransform = (x, y, angle, sx, sy = sx) =>
  `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${angle.toFixed(1)}deg) scale(${sx.toFixed(2)}, ${sy.toFixed(2)})`;

// Accroche une feuille au bout d'une brindille. `anchor` = { x, y, angle } : la feuille part
// de ce point dans la direction de la brindille. `land(x)` donne l'ordonnée du sol.
function addLeaf(group, anchor, i, rand, land, out) {
  const leaf = el('path', { d: LEAF, class: `leaf leaf-${1 + (i % 3)}` });
  const item = {
    el: leaf, shown: true, x0: anchor.x, y0: anchor.y, angle: anchor.angle,
    s: 0.75 + rand() * 0.5, rand, land,
  };
  pickLanding(item);
  item.a0 = attachedAngle(item);
  leaf.style.transform = leafTransform(item.x0, item.y0, item.a0, item.s);
  group.append(leaf);
  out.push(item);
}

// Orientation d'une feuille accrochée : celle de sa brindille, avec un peu de variété.
const attachedAngle = item => item.angle + (item.rand() - 0.5) * 70;

// Choisit un nouvel endroit où la feuille se posera (différent à chaque chute).
function pickLanding(item) {
  const { rand } = item;
  item.x = item.x0 + (rand() - 0.35) * 180;   // le vent pousse plutôt vers la droite
  item.y = item.land(item.x) + 4 + rand() * 34;
  item.a1 = rand() * 360;
  item.duration = 2600 + rand() * 1800;
  item.sway = 18 + rand() * 22;
}

const groundTransform = item => leafTransform(item.x, item.y, item.a1, item.s, item.s * 0.6); // aplatie : posée au sol
const wait = (item, ms) => item.el.animate(null, { duration: ms }).finished;

// Fait tomber une feuille de sa branche jusqu'au sol, en zigzag comme portée par le vent,
// en passant du vert aux couleurs d'automne.
function fall(item, delay = 0) {
  const final = groundTransform(item);
  item.el.style.transition = `fill ${item.duration}ms ease-in ${delay}ms`;
  item.el.classList.add('fallen');
  const steps = 8, frames = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const wobble = Math.sin(t * Math.PI * 3) * (1 - t);
    frames.push({
      transform: i === steps ? final : leafTransform(
        item.x0 + (item.x - item.x0) * t + wobble * item.sway,
        item.y0 + (item.y - item.y0) * t * t * (3 - 2 * t),
        item.a0 + (item.a1 - item.a0) * t + wobble * 50,
        item.s, item.s * (1 - 0.4 * t)),
    });
  }
  const anim = item.el.animate(frames, { duration: item.duration, delay, easing: 'linear', fill: 'both' });
  return anim.finished.then(() => { item.el.style.transform = final; anim.cancel(); });
}

// Cycle de vie d'une feuille : elle tombe, reste au sol un long moment, s'efface,
// repousse sur sa branche (verte), attend un peu, puis retombe ailleurs. Et ainsi de suite.
async function leafLife(item, firstDelay) {
  const { el: leaf, rand } = item;
  try {
    await fall(item, firstDelay);
    while (leaf.isConnected) {
      await wait(item, 15000 + rand() * 25000);                        // repos au sol : 15 à 40 s
      await leaf.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 2500, easing: 'ease-in', fill: 'forwards' }).finished;

      // Retour sur la branche, en vert, sans transition de couleur.
      leaf.style.transition = 'none';
      leaf.classList.remove('fallen');
      item.a0 = attachedAngle(item);
      leaf.style.transform = leafTransform(item.x0, item.y0, item.a0, item.s);
      leaf.getAnimations().forEach(a => a.cancel());
      pickLanding(item);

      // La feuille « repousse » : elle apparaît en grandissant.
      await leaf.animate([
        { opacity: 0, transform: leafTransform(item.x0, item.y0, item.a0, 0.05) },
        { opacity: 1, transform: leafTransform(item.x0, item.y0, item.a0, item.s) },
      ], { duration: 2200, easing: 'ease-out' }).finished;
      await wait(item, 4000 + rand() * 8000);                          // sur la branche : 4 à 12 s
      await fall(item);
    }
  } catch {
    // Animation annulée (arbre redessiné) : la feuille s'arrête simplement.
  }
}

function branchPath(x1, y1, x2, y2) {
  const my = (y1 + y2) / 2;
  return `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
}

// Point et direction (en degrés) le long de la courbe dessinée par branchPath, pour t entre 0 et 1.
function alongBranch(x1, y1, x2, y2, t) {
  const my = (y1 + y2) / 2, u = 1 - t;
  const x = u * u * u * x1 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x2;
  const y = u * u * u * y1 + 3 * u * u * t * my + 3 * u * t * t * my + t * t * t * y2;
  const dx = 6 * u * t * (x2 - x1);
  const dy = 3 * u * u * (my - y1) + 3 * t * t * (y2 - my);
  return { x, y, angle: Math.atan2(dy, dx) * 180 / Math.PI };
}

// Petite branche décorative partant de (x, y) dans la direction `angle` (degrés), avec parfois
// une fourche. Renvoie les points où accrocher des feuilles (bouts de la brindille et de la fourche).
function twig(group, x, y, angle, length, rand) {
  const rad = a => a * Math.PI / 180;
  const bend = (rand() - 0.5) * 30;
  const end = { x: x + Math.cos(rad(angle)) * length, y: y + Math.sin(rad(angle)) * length };
  const ctrl = { x: x + Math.cos(rad(angle + bend)) * length * 0.55, y: y + Math.sin(rad(angle + bend)) * length * 0.55 };
  group.append(el('path', {
    class: 'twig', 'stroke-width': (2.2 + rand() * 1.3).toFixed(1),
    d: `M${x.toFixed(1)},${y.toFixed(1)} Q${ctrl.x.toFixed(1)},${ctrl.y.toFixed(1)} ${end.x.toFixed(1)},${end.y.toFixed(1)}`,
  }));
  const anchors = [{ ...end, angle: angle + bend * 0.5 }];

  if (rand() < 0.7) {
    const fx = x + (end.x - x) * 0.55, fy = y + (end.y - y) * 0.55;
    const fa = angle + (rand() < 0.5 ? -1 : 1) * (30 + rand() * 20);
    const fl = length * (0.35 + rand() * 0.2);
    const fe = { x: fx + Math.cos(rad(fa)) * fl, y: fy + Math.sin(rad(fa)) * fl };
    group.append(el('path', {
      class: 'twig', 'stroke-width': '1.5',
      d: `M${fx.toFixed(1)},${fy.toFixed(1)} L${fe.x.toFixed(1)},${fe.y.toFixed(1)}`,
    }));
    anchors.push({ ...fe, angle: fa });
  }
  return anchors;
}

// Balancement d'un médaillon survolé, comme une feuille dans le vent : trois oscillations de
// périodes différentes (qui ne se répètent donc jamais à l'identique), modulées par des rafales
// lentes. Le mouvement s'installe en douceur à l'arrivée de la souris et s'apaise à son départ.
function windSway(target) {
  const phase = Array.from({ length: 4 }, () => Math.random() * Math.PI * 2);
  let energy = 0, wanted = 0, t = 0, last = 0, frame = 0;

  const step = now => {
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    t += dt;
    // Monte en ~0,4 s, retombe en ~0,9 s.
    energy += (wanted - energy) * (1 - Math.exp(-dt / (wanted ? 0.4 : 0.9)));
    const gust = 0.6 + 0.4 * Math.sin(t * 2 * Math.PI / 4.3 + phase[3]);
    const angle = energy * gust * (
      2.6 * Math.sin(t * 2 * Math.PI / 1.9 + phase[0]) +
      1.4 * Math.sin(t * 2 * Math.PI / 1.13 + phase[1]) +
      0.6 * Math.sin(t * 2 * Math.PI / 0.61 + phase[2]));
    target.style.rotate = `${angle.toFixed(2)}deg`;
    target.style.translate = `${(angle * 0.35).toFixed(2)}px 0`;
    if (wanted || energy > 0.01) frame = requestAnimationFrame(step);
    else stop();
  };
  const stop = () => {
    cancelAnimationFrame(frame); frame = 0;
    target.style.rotate = target.style.translate = '';
    target.classList.remove('gusting');
  };
  return {
    start() {
      if (reducedMotion.matches) return;
      wanted = 1;
      target.classList.add('gusting');
      if (!frame) { last = performance.now(); frame = requestAnimationFrame(step); }
    },
    release() { wanted = 0; },
  };
}

// Classe CSS selon le sexe : la couleur du médaillon en dépend (voir --female / --male).
const sexClass = p => (p.sex === 'F' ? ' female' : p.sex === 'M' ? ' male' : '');

// Petite colombe en vol, une fleur dans le bec, sous la vignette d'une personne décédée.
function dove(y) {
  const g = el('g', { class: 'dove', transform: `translate(-2 ${y}) scale(1.5)` });
  g.innerHTML = `
    <title>Décédé(e)</title>
    <path class="dove-tail" d="M-10 2 L-15 -2 L-14.5 4 Z"/>
    <path class="dove-body" d="M-11 2 C-6 4 -1 2 2 -1 C5 -4 7 -6 10 -6 C12 -6 13 -5 13.5 -4 L16.5 -3.6 L13.5 -2.4 C12.5 2 8.5 5.5 2 6.2 C-4 6.8 -9 5.5 -11 2 Z"/>
    <path class="dove-wing" d="M-2 0 C-5 -5 -3 -11 4 -13 C2.5 -8.5 4.5 -4.5 1.5 0 Z"/>
    <circle class="dove-eye" cx="10.5" cy="-4" r="0.7"/>
    <path class="dove-stem" d="M16 -3.4 C17.5 -1.6 18.2 0.5 18 2.6"/>
    <path class="dove-leaf" d="M17.4 0 C18.8 -0.8 20 -0.4 20.4 0.4 C19.2 0.9 18.2 0.7 17.4 0 Z"/>
    <g class="dove-flower" transform="translate(18.1 4)">
      <circle cx="0" cy="-1.5" r="1.25"/><circle cx="1.45" cy="-0.45" r="1.25"/><circle cx="0.9" cy="1.25" r="1.25"/>
      <circle cx="-0.9" cy="1.25" r="1.25"/><circle cx="-1.45" cy="-0.45" r="1.25"/>
    </g>
    <circle class="dove-flower-heart" cx="18.1" cy="4" r="0.85"/>`;
  return g;
}

export function createTree(svg, family, { onSelect } = {}) {
  // Hauteur, sous le centre d'une vignette, où vient s'accrocher la branche qui monte vers elle
  // (plus bas quand la colombe est affichée sous le nom).
  const attachBelow = id => R + (family.get(id)?.deceased ? 98 : 66);
  const pos = layoutTree(family);
  const rand = seeded(7);
  svg.replaceChildren();
  svg.classList.toggle('calm', pos.size > CALM_ABOVE);

  // Dégradé « bois » pour le cadre des médaillons.
  const defs = el('defs');
  defs.innerHTML = `
    <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="var(--wood-light)"/>
      <stop offset="0.45" stop-color="var(--wood)"/>
      <stop offset="0.55" stop-color="var(--wood-light)"/>
      <stop offset="1" stop-color="var(--bark)"/>
    </linearGradient>
    <clipPath id="medallion"><circle r="${R - 6}"/></clipPath>
    <radialGradient id="hill-wash" cx="0.5" cy="0.45" r="0.5">
      <stop offset="0" class="hill-wash-stop" stop-opacity="0.55"/>
      <stop offset="0.65" class="hill-wash-stop" stop-opacity="0.38"/>
      <stop offset="1" class="hill-wash-stop" stop-opacity="0"/>
    </radialGradient>`;
  svg.append(defs);

  const scene = el('g', { class: 'scene' });
  const ground = el('g', { class: 'ground' });
  const branches = el('g', { class: 'branches' });
  const leaves = el('g', { class: 'leaves' });
  const nodes = el('g', { class: 'nodes' });
  scene.append(ground, branches, leaves, nodes);
  svg.append(scene);

  // Éléments masqués quand ils sortent de l'écran (indispensable pour les grands arbres).
  const cullable = [];

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
  const hill = { cx: (minX + maxX) / 2, cy: groundY + 40, rx: (maxX - minX) / 2 + 160, ry: 70 };
  ground.append(el('ellipse', { class: 'hill', ...hill }));
  // Ordonnée du haut de la colline à l'abscisse x (là où se posent les feuilles).
  const land = x => {
    const u = Math.min(1, Math.abs(x - hill.cx) / hill.rx);
    return hill.cy - hill.ry * Math.sqrt(1 - u * u);
  };
  const fallingLeaves = [];
  const twigs = el('g', { class: 'twigs' });
  const anchors = [];          // bouts de brindilles où accrocher les feuilles
  let leafBudget = 0;          // nombre de feuilles de l'ancien dessin, augmenté ensuite de 20 %

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
    // Deux brindilles sur le tronc, une de chaque côté.
    const trunkTop = base.y, trunkLen = groundY - base.y;
    anchors.push(...twig(twigs, base.x - 5, trunkTop + trunkLen * 0.42, -150 + rand() * 20, 38 + rand() * 14, rand));
    anchors.push(...twig(twigs, base.x + 5, trunkTop + trunkLen * 0.62, -30 - rand() * 20, 34 + rand() * 14, rand));
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
        // Ex-conjoints : branche en pointillés.
        class: `branch couple${u.ended ? ' former' : ''}`, 'stroke-width': Math.max(3, width - 2),
        d: a.y === b.y
          ? `M${a.x},${a.y} Q${(a.x + b.x) / 2},${a.y + 18} ${b.x},${b.y}`
          : branchPath(a.x, a.y, b.x, b.y),
      }));
      leafBudget += 4;
    }

    for (const c of u.children) {
      const cp = pos.get(c);
      if (!cp) continue;
      branches.append(el('path', {
        class: 'branch', 'stroke-width': width,
        d: branchPath(up.x, up.y + 10, cp.x, cp.y + attachBelow(c)),
      }));
      leafBudget += 2;

      // Deux brindilles par branche, de part et d'autre, orientées vers le haut et l'extérieur.
      const bx1 = up.x, by1 = up.y + 10, bx2 = cp.x, by2 = cp.y + attachBelow(c);
      for (const [t, side] of [[0.3 + rand() * 0.1, 1], [0.62 + rand() * 0.1, -1]]) {
        const p = alongBranch(bx1, by1, bx2, by2, t);
        anchors.push(...twig(twigs, p.x, p.y, p.angle + side * (38 + rand() * 22), 30 + rand() * 26, rand));
      }
    }
  }
  branches.append(twigs);

  // Feuilles : 20 % de plus qu'avant, réparties tour à tour sur les bouts de brindilles.
  const leafCount = anchors.length ? Math.round(leafBudget * 1.2) : 0;
  for (let i = 0; i < leafCount; i++) {
    addLeaf(leaves, anchors[i % anchors.length], i, rand, land, fallingLeaves);
  }

  // Les feuilles finissent au sol : c'est là qu'on les cherche pour le masquage hors écran.
  cullable.push(...fallingLeaves);

  // Personnes.
  const nodeById = new Map();
  for (const [id, p] of pos) {
    const person = family.get(id);
    const g = el('g', {
      class: `node${sexClass(person)}`, transform: `translate(${p.x} ${p.y})`,
      tabindex: 0, role: 'button', 'data-id': id,
      'aria-label': `${fullName(person)} ${lifeSpan(person)}`.trim(),
    });
    const sway = el('g', { class: 'sway' });
    sway.style.animationDelay = `${(-rand() * 8).toFixed(2)}s`;

    sway.append(el('circle', { class: 'halo', r: R + 7 }));
    sway.append(el('circle', { class: 'shadow', r: R, cy: 3 }));
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
    if (person.deceased) sway.append(dove(R + 82));

    g.append(sway);
    const wind = windSway(sway);
    g.addEventListener('pointerenter', wind.start);
    g.addEventListener('pointerleave', wind.release);
    g.addEventListener('focus', wind.start);
    g.addEventListener('blur', wind.release);
    g.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(id); }
    });
    nodes.append(g);
    nodeById.set(id, g);
    cullable.push({ el: g, x: p.x, y: p.y, shown: true });
  }

  // ---------- Zoom & déplacement ----------

  const bounds = (() => {
    const ys = [...pos.values()].map(p => p.y);
    return {
      x: minX - 60, y: Math.min(...ys) - R - 40,
      w: maxX - minX + 120, h: groundY + 90 - (Math.min(...ys) - R - 40),
    };
  })();
  let vb = { ...bounds };
  let far = null;
  // La vue (vb) est appliquée en déplaçant/agrandissant le groupe « scene » dans un viewBox
  // en pixels : beaucoup plus rapide que de modifier le viewBox, qui force le navigateur
  // à tout recalculer (x4 sur un arbre de 500 personnes).
  let viewBoxSize = '';
  const applyNow = () => {
    const W = svg.clientWidth, H = svg.clientHeight;
    if (!W || !H) return;
    const size = `0 0 ${W} ${H}`;
    if (size !== viewBoxSize) svg.setAttribute('viewBox', (viewBoxSize = size));
    const k = W / vb.w;
    scene.setAttribute('transform', `translate(${-vb.x * k} ${-vb.y * k}) scale(${k})`);
    // Niveau de détail : de loin, les noms seraient illisibles ; on les masque pour rester fluide.
    const isFar = svg.clientWidth / vb.w < FAR_SCALE;
    if (isFar !== far) svg.classList.toggle('far', (far = isFar));
    cull();
  };

  // Ne dessine que ce qui est à l'écran (avec une marge d'une personne autour).
  function cull() {
    const m = NODE_W;
    const x0 = vb.x - m, x1 = vb.x + vb.w + m, y0 = vb.y - m, y1 = vb.y + vb.h + m;
    for (const item of cullable) {
      const inView = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
      // Une feuille peut être au sol (x, y) ou sur sa branche (x0, y0).
      const show = inView(item.x, item.y) || (item.x0 !== undefined && inView(item.x0, item.y0));
      if (show !== item.shown) {
        item.el.style.display = show ? '' : 'none';
        item.shown = show;
      }
    }
  }
  // Les événements souris/doigt peuvent arriver plusieurs fois par image : on ne redessine qu'une fois.
  let frame = 0;
  const apply = () => {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; applyNow(); });
  };

  // Taille réelle, sans les transformations CSS (l'arbre est légèrement réduit pendant l'animation d'entrée).
  const rect = () => {
    const b = svg.getBoundingClientRect();
    return { left: b.left, top: b.top, width: svg.clientWidth || b.width, height: svg.clientHeight || b.height };
  };
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
  const minW = 320;
  let inset = 0; // largeur du panneau de fiche qui recouvre l'arbre, en pixels

  // Unités SVG par pixel écran pour que tout l'arbre tienne dans la zone libre.
  function fitScale(r, rightInset = inset) {
    const area = visibleArea(r, rightInset);
    const pad = 1.06;
    return Math.max(bounds.w * pad / area.w, bounds.h * pad / area.h, minW / r.width);
  }

  // On ne peut pas dézoomer au-delà de la vue « tout l'arbre ».
  function zoomAt(px, py, factor) {
    const r = rect();
    const maxW = r.width ? r.width * fitScale(r) : Infinity;
    const w = Math.min(maxW, Math.max(minW, vb.w / factor));
    const k = w / vb.w;
    vb = { x: px - (px - vb.x) * k, y: py - (py - vb.y) * k, w, h: vb.h * k };
    apply();
  }

  let anim = 0;
  function animateTo(target, duration = 450) {
    cancelAnimationFrame(anim);
    cancelAnimationFrame(frame); frame = 0;
    if (reducedMotion.matches) { vb = target; applyNow(); return; }
    const from = { ...vb }, t0 = performance.now();
    const ease = t => 1 - Math.pow(1 - t, 3);
    const step = now => {
      const t = Math.min(1, (now - t0) / duration), e = ease(t);
      vb = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e,
             w: from.w + (target.w - from.w) * e, h: from.h + (target.h - from.h) * e };
      applyNow();
      if (t < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }

  let fitted = false;
  function fit({ rightInset = 0, animate = true } = {}) {
    const r = rect();
    if (!r.width || !r.height) return; // pas encore affiché : le ResizeObserver refera le cadrage
    fitted = true;
    inset = rightInset;
    const target = viewCenteredOn(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2,
      fitScale(r), r, visibleArea(r, rightInset));
    animate ? animateTo(target) : (vb = target, applyNow());
  }

  // Centre une personne dans la zone visible (sous l'en-tête, à gauche du panneau s'il est ouvert).
  function focus(id, { rightInset = 0 } = {}) {
    const p = pos.get(id);
    const r = rect();
    if (!p || !r.width || !r.height) return;
    inset = rightInset;
    const area = visibleArea(r, rightInset);
    const wanted = Math.max(NODE_W * 5 / area.w, GEN_H * 2.4 / area.h);
    const s = Math.min(vb.w / r.width, wanted);
    animateTo(viewCenteredOn(p.x, p.y + 20, s, r, area));
  }

  // Zone de l'écran réellement libre : on retire l'en-tête, la barre d'aide, les boutons
  // de zoom (colonne de droite) et le panneau de fiche s'il est ouvert.
  function visibleArea(r, rightInset) {
    const top = r.height > 500 ? 96 : 80, bottom = 48, controls = 72;
    const right = Math.max(rightInset, controls);
    return { left: 0, top, w: Math.max(1, r.width - right), h: Math.max(1, r.height - top - bottom) };
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
      if (!drag.moved) {
        drag.moved = true;
        svg.classList.add('dragging');
        try { svg.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché : sans gravité */ }
      }
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
    else { fitAspect(); applyNow(); }
  }).observe(svg);

  applyNow();
  fit({ animate: false });

  // Les feuilles commencent à tomber quand l'arbre apparaît, puis repoussent et retombent sans fin.
  // Sur un grand arbre (ou si l'utilisateur préfère moins d'animations), elles restent posées au sol.
  let dropped = false;
  function dropLeaves() {
    if (dropped) return;
    dropped = true;
    const animate = !reducedMotion.matches && pos.size <= CALM_ABOVE;
    for (const item of fallingLeaves) {
      if (animate) leafLife(item, 600 + item.rand() * 2600);
      else { item.el.style.transform = groundTransform(item); item.el.classList.add('fallen'); }
    }
  }

  return {
    fit,
    focus,
    dropLeaves,
    select,
    setInset(px) { inset = px; },
    zoomBy(factor) {
      zoomAt(vb.x + vb.w / 2, vb.y + vb.h / 2, factor);
    },
  };
}

