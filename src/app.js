/* Cablejat del DOM: events, panells, HUD, animacio de resultats. Cap logica
   de motor viu aqui — nomes crida als moduls i pinta el que retornen. */

import { VOID, ASPH, SPOT, EXIT, CELL } from "./geometry.js";
import { newWorld, setCell, resize as resizeWorld, hasExit, makeCars, presets } from "./scene.js";
import { evacuate } from "./planner.js";
import { FLEET, spec, specOf } from "./vehicle.js";
import { makeView, draw } from "./render.js";

const $ = (id) => document.getElementById(id);

/* Estat de l'app: `world`+`cars` son les dades del motor; la resta es UI. */
const S = {
  world: newWorld(56, 36),
  cars: makeCars(),
  tool: "asphalt",
  brush: 2,
  angle: 270,
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
function paintAt(p) {
  const type = { asphalt: ASPH, spot: SPOT, wall: VOID, exit: EXIT }[S.tool];
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
    const car = S.cars.addM(p.x, p.y, S.angle, S.veh);
    S.sel = car.id; drag = { mode: "rot", id: car.id };
    invalidate(); return;
  }
  if (S.tool === "erase") {
    const hit = carAt(p.x, p.y);
    if (hit >= 0) { S.cars.splice(hit, 1); invalidate(); }
    drag = { mode: "erase" }; return;
  }
  drag = { mode: "paint" }; paintAt(p);
});
cv.addEventListener("pointermove", (e) => {
  const p = ptr(e);
  S.hover = p;
  if (!drag) { if (S.tool === "car") redraw(); return; }
  if (drag.mode === "paint") paintAt(p);
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
$("brush").addEventListener("input", (e) => { S.brush = +e.target.value; $("brushVal").textContent = S.brush; });
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

async function runSim() {
  if (S.cars.length === 0) { setVerdict(null, "Encara no hi ha cap cotxe.", "Tria l'eina Cotxe i clica sobre una plaça."); return; }
  if (!hasExit(S.world)) { setVerdict(false, "Falta una sortida.", "Pinta almenys una cel·la de sortida al perimetre."); return; }

  const btn = $("run"); btn.disabled = true; btn.textContent = "Calculant…";
  S.results = null; S.playing = null; redraw();
  const opts = { margin: +$("margin").value, maxMan: +$("maxMan").value, allowRev: $("allowRev").checked };

  const r = await evacuate(S.world, S.cars, opts, async (p) => { setProgress(p); await yieldUI(); });
  S.results = r;
  renderResults();
  redraw();
  btn.disabled = false; btn.textContent = "Comprova les sortides";
  setTimeout(() => setProgress(0), 600);
}

function renderResults() {
  const { out, stuck, diag } = S.results;
  if (!stuck.length) {
    const worst = out.reduce((m, o) => Math.max(m, o.man), 0);
    setVerdict(true, `Tots ${out.length} cotxes poden sortir`,
      `Com a maxim calen ${worst} maniobre${worst === 1 ? "" : "s"} en el cas mes dificil.`);
  } else {
    setVerdict(false, `${stuck.length} de ${S.cars.length} no poden sortir`,
      `${out.length} si que hi arriben. Clica un cotxe per veure'n el recorregut.`);
  }
  const ul = $("results"); ul.innerHTML = "";
  const label = (id) => {
    const i = S.cars.findIndex((c) => c.id === id);
    return `${i + 1}. ${specOf(S.cars[i]).name}`;
  };
  for (const o of out) {
    const li = document.createElement("li");
    li.innerHTML = `<button class="res" data-id="${o.id}">
      <span class="dot" style="background:var(--green)"></span>
      <span><span class="name">${label(o.id)}</span>
      <span class="why">Surt a la tanda ${o.round} · ${o.man} maniobre${o.man === 1 ? "" : "s"} · ${o.len.toFixed(1)} m</span></span>
      <span class="num">▶</span></button>`;
    ul.appendChild(li);
  }
  const why = {
    blocked: "Tapat per altres cotxes que tampoc no poden sortir",
    geometry: "No hi ha prou espai per maniobrar, ni tot sol",
    embedded: "No hi cap: a la plaça ja toca un mur o un altre cotxe",
    tight: "Hi cap justet, pero no amb el marge de seguretat actual",
    budget: "No s'ha trobat sortida dins del limit de maniobres",
  };
  for (const id of stuck) {
    const k = diag[id]?.kind || "geometry";
    const li = document.createElement("li");
    li.innerHTML = `<button class="res" data-id="${id}">
      <span class="dot" style="background:var(--${(k === "blocked" || k === "tight" || k === "budget") ? "amber" : "red"})"></span>
      <span><span class="name">${label(id)}</span>
      <span class="why">${why[k]}</span></span></button>`;
    ul.appendChild(li);
  }
  ul.querySelectorAll(".res").forEach((b) => b.addEventListener("click", () => playCar(+b.dataset.id)));
}

function playCar(id) {
  const o = S.results?.out.find((x) => x.id === id);
  document.querySelectorAll(".res").forEach((b) => b.setAttribute("aria-current", (+b.dataset.id === id) ? "true" : "false"));
  if (S.anim) cancelAnimationFrame(S.anim);
  if (!o) { S.playing = { id, path: null, present: S.cars.map((c) => c.id), t: 0 }; redraw(); return; }
  S.playing = { id, path: o.path, present: o.present, t: 0 };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) { S.playing.t = o.path.length - 1; redraw(); return; }
  const dur = Math.min(6000, 700 + o.path.length * 22);
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
addEventListener("resize", fit);

/* --------------------------------------------------------------- arrenc -- */
writeFields();
loadPreset("garatge");
updateHud();
