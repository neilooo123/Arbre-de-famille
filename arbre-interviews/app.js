"use strict";

const arbreEl = document.getElementById("arbre");
const fiche = document.getElementById("fiche");
const ficheContenu = document.getElementById("fiche-contenu");

document.getElementById("fermer").addEventListener("click", () => fiche.close());
fiche.addEventListener("click", (e) => { if (e.target === fiche) fiche.close(); });
fiche.addEventListener("close", () => { ficheContenu.textContent = ""; }); // coupe la vidéo

/* ---------- Outils ---------- */
function el(tag, attrs = {}, ...enfants) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const e of enfants) if (e) n.append(e);
  return n;
}

function initiales(nom) {
  return nom.split(/\s+/).filter(Boolean).slice(0, 2).map((m) => m[0].toUpperCase()).join("");
}

function dates(p) {
  if (p.naissance && p.deces) return `${p.naissance} – ${p.deces}`;
  if (p.naissance) return `né(e) en ${p.naissance}`;
  return "";
}

// Accepte un identifiant YouTube ou une URL complète
function idYoutube(valeur) {
  if (!valeur) return null;
  const m = String(valeur).match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/);
  if (m) return m[1];
  return /^[\w-]{11}$/.test(valeur) ? valeur : null;
}

function avatar(p) {
  const a = el("div", { class: "avatar" });
  if (p.photo) a.append(el("img", { src: p.photo, alt: "", loading: "lazy" }));
  else a.textContent = initiales(p.nom);
  return a;
}

/* ---------- Arbre ---------- */
function carte(p) {
  const n = (p.interviews || []).length;
  const b = el("button", {
    class: "personne " + (n ? "avec" : "sans"),
    type: "button",
    "aria-label": `${p.nom}${n ? `, ${n} interview(s)` : ", interview à venir"}`,
  });
  b.append(
    avatar(p),
    el("span", { class: "nom", text: p.nom }),
    el("span", { class: "dates", text: p.role || dates(p) }),
    el("span", { class: "badge", text: n ? `${n} interview${n > 1 ? "s" : ""}` : "À venir" })
  );
  b.addEventListener("click", () => ouvrirFiche(p));
  return b;
}

function noeud(famille) {
  const li = el("li");
  const couple = el("div", { class: "couple" }, carte(famille.personne));
  if (famille.conjoint) {
    couple.append(el("span", { class: "lien" }), carte(famille.conjoint));
  }
  li.append(couple);
  if (famille.enfants && famille.enfants.length) {
    const ul = el("ul");
    famille.enfants.forEach((e) => ul.append(noeud(e)));
    li.append(ul);
  }
  return li;
}

/* ---------- Fiche ---------- */
function lecteur(interview) {
  const zone = el("div", { class: "lecteur" });
  const yt = idYoutube(interview.youtube);
  if (yt) {
    zone.append(el("iframe", {
      src: `https://www.youtube-nocookie.com/embed/${yt}`,
      title: interview.titre,
      allow: "accelerometer; encrypted-media; picture-in-picture; fullscreen",
      allowfullscreen: "",
      loading: "lazy",
    }));
  } else if (interview.fichier) {
    zone.append(el("video", { src: interview.fichier, controls: "", preload: "metadata" }));
  } else {
    zone.classList.add("lecteur-vide");
    zone.textContent = "Vidéo bientôt disponible.";
  }
  return zone;
}

function ouvrirFiche(p) {
  ficheContenu.textContent = "";

  const tete = el("div", { class: "fiche-tete" }, avatar(p),
    el("div", {},
      el("h2", { text: p.nom }),
      el("div", { class: "meta", text: [p.role, dates(p)].filter(Boolean).join(" · ") })
    )
  );
  ficheContenu.append(tete);
  if (p.bio) ficheContenu.append(el("p", { class: "bio", text: p.bio }));

  const interviews = p.interviews || [];
  if (!interviews.length) {
    ficheContenu.append(el("p", { class: "aucune", text: "L'interview de cette personne n'a pas encore été enregistrée." }));
  } else {
    const emplacement = el("div");
    const liste = el("ul", { class: "liste-videos" });
    const boutons = [];

    const jouer = (i) => {
      emplacement.textContent = "";
      emplacement.append(lecteur(interviews[i]));
      boutons.forEach((b, j) => b.setAttribute("aria-current", String(i === j)));
    };

    interviews.forEach((iv, i) => {
      const b = el("button", { type: "button" },
        el("span", { text: iv.titre }),
        el("span", { class: "duree", text: iv.duree || "" })
      );
      b.addEventListener("click", () => jouer(i));
      boutons.push(b);
      liste.append(el("li", {}, b));
    });

    ficheContenu.append(emplacement);
    if (interviews.length > 1) ficheContenu.append(liste);
    jouer(0);
  }
  fiche.showModal();
}

/* ---------- Chargement ---------- */
fetch("data/famille.json")
  .then((r) => {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  })
  .then((data) => {
    if (data.titre) {
      document.getElementById("titre").textContent = data.titre;
      document.title = data.titre;
    }
    document.getElementById("sous-titre").textContent = data.sous_titre || "";
    const ul = el("ul");
    ul.append(noeud(data.arbre));
    arbreEl.append(ul);
  })
  .catch((err) => {
    arbreEl.append(el("p", {
      class: "aucune",
      text: "Impossible de charger data/famille.json (" + err.message + "). " +
            "En local, lancez un petit serveur : python3 -m http.server",
    }));
  });
