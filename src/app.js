/* Cablejat del DOM: events, panells, HUD, animacio de resultats. Cap logica
   de motor viu aqui — nomes crida als moduls i pinta el que retornen. */

import { VOID, ASPH, SPOT, EXIT, ENTRANCE, CELL } from "./geometry.js";
import { newWorld, setCell, resize as resizeWorld, hasExit, hasEntrance, makeCars, presets } from "./scene.js";
import { evacuate, arrive, checkBothWays, summariseManeuvers } from "./planner.js";
import { FLEET, spec, specOf } from "./vehicle.js";
import { makeView, draw } from "./render.js";
import { listSaves, saveGarage, loadGarage, deleteSave } from "./storage.js";

const $ = (id) => document.getElementById(id);

/* Estat de l'app: `world`+`cars` son les dades del motor; la resta es UI. */
const S = {
  world: newWorld(56, 36),
  cars: makeCars(),
  tool: "asphalt",
  brush: 10,               // en cel·les; sincronitzat amb el llisquet en cm
  angle: 270,
  mode: "exit",             // "exit" | "entry" | "both" — vegeu #mode
  veh: 1,                 // index a FLEET del "model seleccionat" al panell
  sel: -1,
  results: null,
  playing: null,
  anim: null,
  hover: null,
};

/* L'edicio manual del panell nomes toca `car.override`, mai FLEET. Es
   deliberat (vegeu PLAN.md): al prototip original, editar un camp mutava
   l'entrada compartida i canviava tots els cotxes d'aquell model alhora. */
function curEntry() {
  const car = S.cars.find((c) => c.id === S.sel);
  return car?.override ?? FLEET[car?.t ?? S.veh] ?? FLEET[S.veh];
}
function curSpec() { return spec(curEntry()); }

/* ----------------------------------------------------------------- canvas - */
const cv = $("cv");
const V = makeView(cv);
function redraw() {
  draw(V, S.world, S.cars, {
    sel: S.sel, play: S.playing, hover: S.hover, tool: S.tool,
    curSpec: S.tool === "car" ? curSpec() : null,
    previewTh: S.angle * Math.PI / 180,
    statusOf,
  });
}
function fit() { V.fitView(S.world); redraw(); }

function statusOf(id) {
  if (!S.results) return null;
  if (S.results.stuck.includes(id)) {
    const k = S.results.diag[id]?.kind;
    return (k === "blocked" || k === "tight" || k === "budget") ? "amber" : "red";
  }
  return "ok";
}

/* --------------------------------------------------------------- pintura -- */
const MATERIAL = { asphalt: ASPH, spot: SPOT, wall: VOID, entrance: ENTRANCE, exit: EXIT };
function paintAt(p, forceType) {
  const type = forceType ?? MATERIAL[S.tool];
  if (type === undefined) return;
  const c0 = Math.floor(p.x / CELL), r0 = Math.floor(p.y / CELL);
  const half = (S.brush - 1) / 2;
  let changed = false;
  for (let r = Math.round(r0 - half); r <= Math.round(r0 + half); r++)
    for (let c = Math.round(c0 - half); c <= Math.round(c0 + half); c++)
      if (setCell(S.world, c, r, type)) changed = true;
  if (changed) invalidate();
}
function invalidate() {
  S.results = null; S.playing = null;
  if (S.anim) cancelAnimationFrame(S.anim);
  $("results").innerHTML = ""; $("verdict").innerHTML = "";
  $("hudCars").textContent = S.cars.length;
  redraw();
}

/* -------------------------------------------------------------- pointer --- */
function ptr(e) {
  const r = cv.getBoundingClientRect();
  return { x: V.mx(e.clientX - r.left), y: V.my(e.clientY - r.top) };
}
function carAt(x, y) {
  for (let i = S.cars.length - 1; i >= 0; i--) {
    const c = S.cars[i], v = specOf(c);
    const dx = x - c.cx, dy = y - c.cy;
    const u = dx * Math.cos(c.th) + dy * Math.sin(c.th), w = -dx * Math.sin(c.th) + dy * Math.cos(c.th);
    if (Math.abs(u) <= v.L / 2 && Math.abs(w) <= v.W / 2) return i;
  }
  return -1;
}

let drag = null;
cv.addEventListener("pointerdown", (e) => {
  cv.setPointerCapture(e.pointerId); cv.focus();
  const p = ptr(e);
  if (S.tool === "car") {
    const hit = carAt(p.x, p.y);
    if (hit >= 0 && e.shiftKey === false && S.sel === S.cars[hit].id) { drag = { mode: "rot", id: S.cars[hit].id }; return; }
    if (hit >= 0) {
      S.sel = S.cars[hit].id; S.veh = S.cars[hit].t ?? S.veh;
      $("preset").value = S.veh; writeFields(); updateHud();
      drag = { mode: "rot", id: S.sel }; redraw(); return;
    }
    // Cotxe nou: es planta amb l'angle ja triat (llisquet o tecles R/E,
    // vegeu el fantasma que ja el mostrava abans de clicar) — un sol clic
    // el col·loca, no cal arrossegar per orientar-lo despres. Per canviar
    // l'angle d'un cotxe ja plantat, torna-hi a clicar i arrossega.
    const car = S.cars.addM(p.x, p.y, S.angle, S.veh);
    S.sel = car.id;
    invalidate(); return;
  }
  if (S.tool === "erase") {
    // goma universal: si hi ha un cotxe sota el cursor, el treu; si no,
    // converteix la cel·la en calçada oberta (mur, plaça, entrada i sortida
    // son tots "alguna cosa dibuixada aqui" — esborrar-ho es tornar a obert).
    const hit = carAt(p.x, p.y);
    if (hit >= 0) { S.cars.splice(hit, 1); invalidate(); drag = { mode: "erase" }; return; }
    drag = { mode: "eraseCell" }; paintAt(p, ASPH); return;
  }
  drag = { mode: "paint" }; paintAt(p);
});
cv.addEventListener("pointermove", (e) => {
  const p = ptr(e);
  S.hover = p;
  if (!drag) { if (S.tool === "car") redraw(); return; }
  if (drag.mode === "paint") paintAt(p);
  else if (drag.mode === "eraseCell") paintAt(p, ASPH);
  else if (drag.mode === "erase") { const h = carAt(p.x, p.y); if (h >= 0) { S.cars.splice(h, 1); invalidate(); } }
  else if (drag.mode === "rot") {
    const car = S.cars.find((c) => c.id === drag.id); if (!car) return;
    const d = Math.hypot(p.x - car.cx, p.y - car.cy);
    if (d > 0.45) {
      let a = Math.atan2(p.y - car.cy, p.x - car.cx) * 180 / Math.PI;
      a = Math.round(a / 15) * 15; car.th = a * Math.PI / 180;
      S.angle = ((a % 360) + 360) % 360; $("angle").value = S.angle; $("angleVal").textContent = S.angle + "°";
      invalidate();
    }
  }
});
const endDrag = () => { drag = null; };
cv.addEventListener("pointerup", endDrag);
cv.addEventListener("pointercancel", endDrag);
cv.addEventListener("pointerleave", () => { S.hover = null; redraw(); });

cv.addEventListener("keydown", (e) => {
  if (e.key === "Delete" || e.key === "Backspace") {
    const i = S.cars.findIndex((c) => c.id === S.sel);
    if (i >= 0) { S.cars.splice(i, 1); S.sel = -1; invalidate(); e.preventDefault(); }
  }
  if (e.key === "r" || e.key === "R" || e.key === "e" || e.key === "E") {
    const d = (e.key === "r" || e.key === "R") ? 15 : -15;
    const car = S.cars.find((c) => c.id === S.sel);
    S.angle = (((S.angle + d) % 360) + 360) % 360;
    $("angle").value = S.angle; $("angleVal").textContent = S.angle + "°";
    if (car) car.th = S.angle * Math.PI / 180;
    invalidate();
  }
});

/* --------------------------------------------------------------- panells -- */
$("tools").addEventListener("click", (e) => {
  const b = e.target.closest(".tool"); if (!b) return;
  S.tool = b.dataset.tool; S.sel = -1;
  document.querySelectorAll(".tool").forEach((t) => t.setAttribute("aria-pressed", t === b ? "true" : "false"));
  redraw();
});
/* El llisquet es en centimetres (coincideix amb la mida de cel·la, 10cm, i
   es mes concret que metres per a un pinzell d'aquesta escala); S.brush es
   el nombre de cel·les que fa servir paintAt, derivat aqui. */
$("brush").addEventListener("input", (e) => {
  const cm = +e.target.value;
  S.brush = Math.max(1, Math.round(cm / 100 / CELL));
  $("brushVal").textContent = cm + " cm";
});
$("angle").addEventListener("input", (e) => {
  S.angle = +e.target.value; $("angleVal").textContent = S.angle + "°";
  const car = S.cars.find((c) => c.id === S.sel); if (car) car.th = S.angle * Math.PI / 180;
  redraw();
});

function loadPreset(name) {
  const { world, cars, veh } = presets[name]();
  S.world = world; S.cars = cars; S.veh = veh; S.sel = -1;
  writeFields();
  invalidate(); fit();
}
document.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => loadPreset(b.dataset.preset)));

/* ------------------------------------------------------ garatges desats -- */
/* localStorage, per navegador (storage.js) — cap servidor, cap sincronitzacio. */
function refreshSavedList() {
  const ul = $("savedList"); ul.innerHTML = "";
  for (const name of listSaves()) {
    const li = document.createElement("li");
    const load = document.createElement("button");
    load.className = "load"; load.type = "button"; load.textContent = name;
    load.addEventListener("click", () => {
      const g = loadGarage(name);
      if (!g) { refreshSavedList(); return; }        // algu altre l'ha esborrat mentrestant
      S.world = g.world; S.cars = makeCars(g.cars); S.sel = -1;
      writeFields(); invalidate(); fit();
    });
    const del = document.createElement("button");
    del.className = "del"; del.type = "button"; del.title = `Esborra "${name}"`; del.textContent = "×";
    del.addEventListener("click", () => {
      if (!confirm(`Esborrar el garatge desat "${name}"? No es pot desfer.`)) return;
      deleteSave(name); refreshSavedList();
    });
    li.append(load, del);
    ul.appendChild(li);
  }
}
$("saveGarage").addEventListener("click", () => {
  const name = $("saveName").value.trim();
  if (!name) { $("saveName").focus(); return; }
  saveGarage(name, S.world, S.cars);
  $("saveName").value = "";
  refreshSavedList();
});
$("saveName").addEventListener("keydown", (e) => { if (e.key === "Enter") $("saveGarage").click(); });

$("cols").addEventListener("change", (e) => {
  resizeWorld(S.world, Math.max(16, Math.round(+e.target.value / CELL)), S.world.rows); invalidate(); fit();
});
$("rows").addEventListener("change", (e) => {
  resizeWorld(S.world, S.world.cols, Math.max(16, Math.round(+e.target.value / CELL))); invalidate(); fit();
});

FLEET.forEach((f, i) => {
  const o = document.createElement("option"); o.value = i; o.textContent = f.name;
  $("preset").appendChild(o);
});
$("preset").value = S.veh;
$("preset").addEventListener("change", (e) => {
  S.veh = +e.target.value; writeFields();
  const car = S.cars.find((c) => c.id === S.sel);
  if (car) { car.t = S.veh; delete car.override; }   // torna a la biblioteca, descarta l'edicio manual
  invalidate(); updateHud();
});

/* El panell nomes edita L/W/B/Fo/D (diametre de gir vorera-a-vorera), igual
   que el prototip original — turningMeasure es fixa perque l'entrada manual
   no demana triar-lo. */
function readFields() {
  const car = S.cars.find((c) => c.id === S.sel);
  const entry = { name: "(editat)", L: +$("vL").value, W: +$("vW").value, B: +$("vB").value,
    Fo: +$("vF").value, turning: +$("vD").value, turningMeasure: "diametre-vorera" };
  if (car) car.override = entry;
}
function writeFields() {
  const e = curEntry();
  $("vL").value = e.L; $("vW").value = e.W; $("vB").value = e.B;
  $("vF").value = e.Fo; $("vD").value = e.turning;
}
["vL", "vW", "vB", "vF", "vD"].forEach((id) => $(id).addEventListener("input", () => {
  readFields(); invalidate(); updateHud();
}));

["margin", "maxMan", "allowRev"].forEach((id) => $(id).addEventListener("input", () => { S.results = null; renderClear(); }));
function renderClear() { $("results").innerHTML = ""; $("verdict").innerHTML = ""; S.playing = null; redraw(); }

function updateHud() {
  const v = curSpec();
  $("hudR").textContent = v.Rc.toFixed(2) + " m";
  $("hudOh").textContent = v.Fo.toFixed(2) + " m";
  $("hudCars").textContent = S.cars.length;
  $("hudMsg").textContent = `Angle de direccio maxim ${(v.dmax * 180 / Math.PI).toFixed(0)}°`;
}

/* ------------------------------------------------------------ simulacio -- */
const yieldUI = () => new Promise((r) => setTimeout(r, 0));
function setProgress(p) { $("progBar").style.width = (p * 100).toFixed(0) + "%"; }
function setVerdict(ok, title, sub) {
  const el = $("verdict");
  el.className = "verdict" + (ok === true ? " ok" : ok === false ? " bad" : "");
  el.innerHTML = `<span class="big"></span><span class="small"></span>`;
  el.querySelector(".big").textContent = title;
  el.querySelector(".small").textContent = sub;
  $("results").innerHTML = "";
}

/* "exit"/"entry"/"both" — sempre en el pitjor cas (tots aparcats a la seva
   plaça, vegeu planner.js). Cada mode te la seva funcio de motor, el seu
   text de botó/verdicte i, per a "both", una forma de resultat diferent
   (out[] porta {exit,entry} en comptes de {path,man,len}). */
const MODE = {
  exit: { run: evacuate, btn: "Comprova les sortides", verb: "sortir", verbInf: "sortir-ne",
    needs: (w) => hasExit(w), missing: "Falta una sortida.", missingSub: "Pinta almenys una cel·la de sortida al perimetre." },
  entry: { run: arrive, btn: "Comprova les entrades", verb: "entrar-hi", verbInf: "entrar-hi",
    needs: (w) => hasEntrance(w), missing: "Falta una entrada.", missingSub: "Pinta almenys una cel·la d'entrada al perimetre." },
  both: { run: checkBothWays, btn: "Comprova l'accés", verb: "entrar i sortir", verbInf: "entrar-hi i sortir-ne",
    needs: (w) => hasExit(w) && hasEntrance(w), missing: "Falta una entrada o una sortida.", missingSub: "Calen totes dues per comprovar l'accés complet." },
};

async function runSim() {
  const m = MODE[S.mode];
  if (S.cars.length === 0) { setVerdict(null, "Encara no hi ha cap cotxe.", "Tria l'eina Cotxe i clica sobre una plaça."); return; }
  if (!m.needs(S.world)) { setVerdict(false, m.missing, m.missingSub); return; }

  const btn = $("run"); btn.disabled = true; btn.textContent = "Calculant…";
  S.results = null; S.playing = null; redraw();
  const opts = { margin: +$("margin").value, maxMan: +$("maxMan").value, allowRev: $("allowRev").checked };

  const r = await m.run(S.world, S.cars, opts, async (p) => { setProgress(p); await yieldUI(); });
  S.results = { ...r, mode: S.mode };
  renderResults();
  redraw();
  btn.disabled = false; btn.textContent = m.btn;
  setTimeout(() => setProgress(0), 600);
}

/* Trams del recorregut, un per marxa: "Endavant 3,40 m, girant a la dreta".
   Ve de summariseManeuvers() (planner.js) — pura, sense DOM, ja provada. */
function maneuverList(path) {
  return summariseManeuvers(path).map((s, i) => {
    const dir = s.dir === "enrere" ? "Marxa enrere" : "Endavant";
    const turn = s.turn === "recte" ? "" : `, girant a ${s.turn === "dreta" ? "la dreta" : "l'esquerra"}`;
    return `<li>${dir} ${s.distance.toFixed(2)} m${turn}</li>`;
  }).join("");
}

const WHY = {
  blocked: "Hi cabria sol, pero altres cotxes aparcats el tapen",
  geometry: "No hi ha prou espai per maniobrar, ni tot sol",
  embedded: "No hi cap: a la plaça ja toca un mur o un altre cotxe",
  tight: "Hi cap justet, pero no amb el marge de seguretat actual",
  budget: "No s'ha trobat sortida dins del limit de maniobres",
};
const AMBER_KINDS = new Set(["blocked", "tight", "budget"]);
const label = (id) => {
  const i = S.cars.findIndex((c) => c.id === id);
  return `${i + 1}. ${specOf(S.cars[i]).name}`;
};

function renderResults() {
  const { out, stuck, mode } = S.results;
  const m = MODE[mode];
  if (!stuck.length) {
    setVerdict(true, `Tots ${out.length} cotxes poden ${m.verb}`, verdictOkSub(out, mode));
  } else {
    setVerdict(false, `${stuck.length} de ${S.cars.length} no poden ${m.verb}`,
      `${out.length} si que hi arriben. Clica un cotxe per veure'n el recorregut.`);
  }
  const ul = $("results"); ul.innerHTML = "";
  if (mode === "both") renderBothResults(ul, out, stuck, S.results.diag);
  else renderSingleResults(ul, out, stuck, S.results.diag);
  ul.querySelectorAll("[data-id]").forEach((b) => b.addEventListener("click", () => playCar(+b.dataset.id, b.dataset.dir)));
}

function verdictOkSub(out, mode) {
  if (mode === "both") {
    const worst = out.reduce((m2, o) => Math.max(m2, o.exit.man, o.entry.man), 0);
    return `Com a maxim calen ${worst} maniobra${worst === 1 ? "" : "s"} en el cas mes dificil (entrant o sortint).`;
  }
  const worst = out.reduce((m2, o) => Math.max(m2, o.man), 0);
  return `Com a maxim calen ${worst} maniobra${worst === 1 ? "" : "s"} en el cas mes dificil.`;
}

function renderSingleResults(ul, out, stuck, diag) {
  for (const o of out) {
    const li = document.createElement("li");
    li.innerHTML = `<button class="res" data-id="${o.id}">
      <span class="dot" style="background:var(--green)"></span>
      <span><span class="name">${label(o.id)}</span>
      <span class="why">${o.man} maniobre${o.man === 1 ? "" : "s"} · ${o.len.toFixed(1)} m</span></span>
      <span class="num">▶</span></button>
      <ol class="maneuvers">${maneuverList(o.path)}</ol>`;
    ul.appendChild(li);
  }
  for (const id of stuck) {
    const k = diag[id]?.kind || "geometry";
    const li = document.createElement("li");
    li.innerHTML = `<button class="res" data-id="${id}">
      <span class="dot" style="background:var(--${AMBER_KINDS.has(k) ? "amber" : "red"})"></span>
      <span><span class="name">${label(id)}</span>
      <span class="why">${WHY[k]}</span></span></button>`;
    ul.appendChild(li);
  }
}

/* Mode "both": out[] porta {id,exit,entry} (cadascun amb path/man/len) i
   diag[id] porta {exit,entry} amb "ok" o el kind de cadascun — un cotxe pot
   fallar nomes en un dels dos sentits. Cada fila be amb dos botons ▶
   separats (entrada/sortida). */
function renderBothResults(ul, out, stuck, diag) {
  for (const o of out) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="name" style="display:block;padding:4px 8px 2px">${label(o.id)}</span>
      <div class="res-pair">
        <button class="res" data-id="${o.id}" data-dir="entry">
          <span class="dot" style="background:var(--focus)"></span>
          <span><span class="dir">Entrada</span>
          <span class="why">${o.entry.man} man. · ${o.entry.len.toFixed(1)} m</span></span></button>
        <button class="res" data-id="${o.id}" data-dir="exit">
          <span class="dot" style="background:var(--green)"></span>
          <span><span class="dir">Sortida</span>
          <span class="why">${o.exit.man} man. · ${o.exit.len.toFixed(1)} m</span></span></button>
      </div>
      <ol class="maneuvers" id="man-${o.id}"></ol>`;
    ul.appendChild(li);
  }
  for (const id of stuck) {
    const d = diag[id];
    const line = (dir, label2) => d[dir] === "ok" ? null : `${label2}: ${WHY[d[dir]?.kind || "geometry"]}`;
    const lines = [line("entry", "Entrada"), line("exit", "Sortida")].filter(Boolean);
    const anyAmber = ["entry", "exit"].some((dir) => d[dir] !== "ok" && AMBER_KINDS.has(d[dir]?.kind));
    const li = document.createElement("li");
    li.innerHTML = `<button class="res" data-id="${id}">
      <span class="dot" style="background:var(--${anyAmber ? "amber" : "red"})"></span>
      <span><span class="name">${label(id)}</span>
      ${lines.map((t) => `<span class="why">${t}</span>`).join("")}</span></button>`;
    ul.appendChild(li);
  }
}

/* Trams del recorregut que s'acaba de reproduir — nomes en mode "both", on
   cada fila te dos ▶ (entrada/sortida) i la llista es compartida sota els
   dos, aixi que cal actualitzar-la segons quin s'ha clicat. */
function showManeuversFor(id, path) {
  const ol = document.getElementById(`man-${id}`);
  if (ol) ol.innerHTML = maneuverList(path);
}

function playCar(id, dir) {
  const both = S.results?.mode === "both";
  const found = S.results?.out.find((x) => x.id === id);
  const o = both ? found?.[dir] : found;
  document.querySelectorAll(".res").forEach((b) => b.setAttribute("aria-current", (+b.dataset.id === id && (!dir || b.dataset.dir === dir)) ? "true" : "false"));
  if (S.anim) cancelAnimationFrame(S.anim);
  if (!o) { S.playing = { id, path: null, present: S.cars.map((c) => c.id), t: 0 }; redraw(); return; }
  if (both) showManeuversFor(id, o.path);
  S.playing = { id, path: o.path, present: o.present, t: 0 };
  // "prefers-reduced-motion" saltava directament al fotograma final — a
  // molts PC amb Windows aquesta preferencia esta activada pel sistema
  // (estalvi d'energia, accessibilitat) sense que l'usuari ho hagi triat
  // expressament per a aquesta animacio, que es la manera principal de
  // veure el recorregut, no decoracio. La reduim (mes curta i sense
  // requestAnimationFrame per fotograma), no l'eliminem.
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dur = reduce ? 450 : Math.min(6000, Math.max(900, 700 + o.path.length * 22));
  const t0 = performance.now();
  const tick = (now) => {
    const p = Math.min(1, (now - t0) / dur);
    S.playing.t = p * (o.path.length - 1);
    redraw();
    if (p < 1) S.anim = requestAnimationFrame(tick);
  };
  S.anim = requestAnimationFrame(tick);
}

$("run").addEventListener("click", runSim);
$("mode").addEventListener("click", (e) => {
  const b = e.target.closest(".seg-btn"); if (!b) return;
  S.mode = b.dataset.mode;
  document.querySelectorAll(".seg-btn").forEach((t) => t.setAttribute("aria-pressed", t === b ? "true" : "false"));
  $("run").textContent = MODE[S.mode].btn;
  S.results = null; renderClear();
});
addEventListener("resize", fit);

/* ------------------------------------------------------------------ tema - */
/* Clar/fosc: per defecte segueix el sistema (@media al CSS, sense fer res
   aqui — vegeu l'script al <head> que evita el flaix). El boto guarda una
   tria explicita a localStorage, que sempre guanya. El canvas llegeix els
   colors amb getComputedStyle en pintar (render.js: css()), aixi que un
   canvi de tema nomes es veu si es torna a dibuixar — d'aqui els redraw(). */
function effectiveTheme() {
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit === "light" || explicit === "dark") return explicit;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
$("themeToggle").addEventListener("click", () => {
  const next = effectiveTheme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("gp:theme", next);
  redraw();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  // nomes si l'usuari no ha triat res expressament — si ho ha fet, la seva
  // tria mana per sobre del sistema.
  if (!document.documentElement.hasAttribute("data-theme")) redraw();
});

/* --------------------------------------------------------------- arrenc -- */
writeFields();
loadPreset("buit");
updateHud();
refreshSavedList();
