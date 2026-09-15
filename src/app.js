/* DOM wiring: events, panels, HUD, result animation. No engine logic lives
   here — it only calls the modules and paints what they return. */

import { VOID, ASPH, SPOT, EXIT, ENTRANCE, GATE, CELL } from "./geometry.js";
import {
  newWorld, setCell, resize as resizeWorld, hasExit, hasEntrance, makeCars, presets,
  addLine, setLineLength, lineLength,
} from "./scene.js";
import { evacuate, arrive, checkBothWays, summariseManeuvers } from "./planner.js";
import { FLEET, spec, specOf } from "./vehicle.js";
import { makeView, draw } from "./render.js";
import { listSaves, saveGarage, loadGarage, deleteSave } from "./storage.js";

const $ = (id) => document.getElementById(id);

/* App state: `world`+`cars` are the engine's data; the rest is UI. */
const S = {
  world: newWorld(56, 36),
  cars: makeCars(),
  tool: "asphalt",
  brush: 10,               // in cells; kept in sync with the slider in cm
  angle: 270,
  mode: "exit",             // "exit" | "entry" | "both" — see #mode
  veh: 1,                 // FLEET index of the "selected model" in the panel
  sel: -1,
  results: null,
  playing: null,
  anim: null,
  hover: null,
  linePreview: null,       // {x1,y1,x2,y2} while the Line tool is being dragged
};

/* Hand-editing in the panel only touches `car.override`, never FLEET. That is
   deliberate (see PLAN.md): in the original prototype, editing a field mutated
   the shared entry and changed every car of that model at once. */
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
    previewLine: S.linePreview,
    statusOf,
  });
}
function fit() { V.fitView(S.world); redraw(); }

function statusOf(id) {
  if (!S.results) return null;
  if (S.results.stuck.includes(id)) {
    return AMBER_KINDS.has(S.results.diag[id]?.kind) ? "amber" : "red";
  }
  return "ok";
}

/* -------------------------------------------------------------- painting -- */
const MATERIAL = { asphalt: ASPH, spot: SPOT, wall: VOID, entrance: ENTRANCE, exit: EXIT, gate: GATE };
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
    // New car: it is planted at the angle already chosen (slider or R/E keys,
    // see the ghost that was showing it before the click) — a single click
    // places it, no dragging needed to orient it afterwards. To change the
    // angle of a car already placed, click it again and drag.
    const car = S.cars.addM(p.x, p.y, S.angle, S.veh);
    S.sel = car.id;
    invalidate(); return;
  }
  if (S.tool === "erase") {
    // Universal eraser: if there is a car under the cursor, it is removed; if
    // not, the cell becomes open roadway (wall, bay, entrance and exit are all
    // "something drawn here" — erasing it means going back to open).
    const hit = carAt(p.x, p.y);
    if (hit >= 0) { S.cars.splice(hit, 1); invalidate(); drag = { mode: "erase" }; return; }
    drag = { mode: "eraseCell" }; paintAt(p, ASPH); return;
  }
  if (S.tool === "line") {
    // Only the fixed end is marked here; the line is not planted until release
    // (endDrag), once we know whether it is horizontal or vertical.
    drag = { mode: "line", x0: p.x, y0: p.y };
    S.linePreview = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    redraw(); return;
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
  else if (drag.mode === "line") {
    // Ghost: projected onto whichever axis (horizontal or vertical) has been
    // travelled further from the fixed end — the same criterion as addLine().
    const horiz = Math.abs(p.x - drag.x0) >= Math.abs(p.y - drag.y0);
    S.linePreview = { x1: drag.x0, y1: drag.y0, x2: horiz ? p.x : drag.x0, y2: horiz ? drag.y0 : p.y };
    redraw();
  } else if (drag.mode === "rot") {
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
const endDrag = () => {
  if (drag?.mode === "line" && S.linePreview) {
    const { x1, y1, x2, y2 } = S.linePreview;
    const halfWidth = Math.max(CELL / 2, (S.brush * CELL) / 2);
    if (addLine(S.world, x1, y1, x2, y2, halfWidth, VOID)) invalidate();
  }
  S.linePreview = null;
  drag = null;
};
cv.addEventListener("pointerup", endDrag);
cv.addEventListener("pointercancel", () => { S.linePreview = null; drag = null; redraw(); });
cv.addEventListener("pointerleave", () => { S.hover = null; redraw(); });

/* Double-clicking a line's metre label changes its length, keeping the start
   end fixed (setLineLength already does that). Only active with the Line tool
   selected — that way the two clicks of the double click do not end up
   painting something with another tool before the dblclick arrives (with the
   Line tool, two clicks at almost the same point do not reach one cell and
   addLine() discards them by itself). */
cv.addEventListener("dblclick", (e) => {
  if (S.tool !== "line" || !S.world.lines.length) return;
  const r = cv.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  const s = V.view.s;
  for (const line of S.world.lines) {
    const mx = (line.x1 + line.x2) / 2, my = (line.y1 + line.y2) / 2;
    const horiz = line.y1 === line.y2;
    const ox = horiz ? 0 : s * 0.42, oy = horiz ? -s * 0.30 : 0;
    const tx = V.px(mx) + ox, ty = V.py(my) + oy;
    if (Math.hypot(sx - tx, sy - ty) > 16) continue;
    const input = prompt("New length (m):", lineLength(line).toFixed(2));
    if (input === null) return;
    const val = parseFloat(input.replace(",", "."));
    if (!isFinite(val) || val < CELL) { alert(`Enter a number of at least ${CELL} m.`); return; }
    setLineLength(S.world, line, val);
    invalidate();
    return;
  }
});

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

/* --------------------------------------------------------------- panels -- */
$("tools").addEventListener("click", (e) => {
  const b = e.target.closest(".tool"); if (!b) return;
  S.tool = b.dataset.tool; S.sel = -1;
  document.querySelectorAll(".tool").forEach((t) => t.setAttribute("aria-pressed", t === b ? "true" : "false"));
  redraw();
});
/* The slider is in centimetres (it matches the cell size, 10 cm, and is more
   concrete than metres for a brush at this scale); S.brush is the number of
   cells paintAt uses, derived here. */
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

/* -------------------------------------------------------- saved garages -- */
/* localStorage, per browser (storage.js) — no server, no syncing. */
function refreshSavedList() {
  const ul = $("savedList"); ul.innerHTML = "";
  for (const name of listSaves()) {
    const li = document.createElement("li");
    const load = document.createElement("button");
    load.className = "load"; load.type = "button"; load.textContent = name;
    load.addEventListener("click", () => {
      const g = loadGarage(name);
      if (!g) { refreshSavedList(); return; }        // someone else deleted it meanwhile
      S.world = g.world; S.cars = makeCars(g.cars); S.sel = -1;
      writeFields(); invalidate(); fit();
    });
    const del = document.createElement("button");
    del.className = "del"; del.type = "button"; del.title = `Delete "${name}"`; del.textContent = "×";
    del.addEventListener("click", () => {
      if (!confirm(`Delete the saved garage "${name}"? This cannot be undone.`)) return;
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
  if (car) { car.t = S.veh; delete car.override; }   // back to the library, hand edits discarded
  invalidate(); updateHud();
});

/* The panel only edits L/W/B/Fo/D (kerb-to-kerb turning diameter), just like
   the original prototype — turningMeasure is fixed because the hand-entry form
   does not ask you to choose one. */
function readFields() {
  const car = S.cars.find((c) => c.id === S.sel);
  const entry = { name: "(edited)", L: +$("vL").value, W: +$("vW").value, B: +$("vB").value,
    Fo: +$("vF").value, turning: +$("vD").value, turningMeasure: "kerb-diameter" };
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
  $("hudMsg").textContent = `Maximum steering angle ${(v.dmax * 180 / Math.PI).toFixed(0)}°`;
}

/* ------------------------------------------------------------ simulation - */
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

/* "exit"/"entry"/"both" — always the worst case (every car parked in its own
   bay, see planner.js). Each mode has its own engine function, its own
   button/verdict wording and, for "both", a different result shape (out[]
   carries {exit,entry} instead of {path,man,len}). */
const MODE = {
  exit: { run: evacuate, btn: "Check the exits", verb: "get out",
    needs: (w) => hasExit(w), missing: "No exit yet.", missingSub: "Paint at least one exit cell on the perimeter." },
  entry: { run: arrive, btn: "Check the entrances", verb: "get in",
    needs: (w) => hasEntrance(w), missing: "No entrance yet.", missingSub: "Paint at least one entrance cell on the perimeter." },
  both: { run: checkBothWays, btn: "Check access", verb: "get in and out",
    needs: (w) => hasExit(w) && hasEntrance(w), missing: "No entrance or no exit.", missingSub: "Both are needed to check full access." },
};

async function runSim() {
  const m = MODE[S.mode];
  if (S.cars.length === 0) { setVerdict(null, "No cars yet.", "Pick the Car tool and click on a bay."); return; }
  if (!m.needs(S.world)) { setVerdict(false, m.missing, m.missingSub); return; }

  const btn = $("run"); btn.disabled = true; btn.textContent = "Computing…";
  S.results = null; S.playing = null; redraw();
  const opts = { margin: +$("margin").value, maxMan: +$("maxMan").value, allowRev: $("allowRev").checked };

  const r = await m.run(S.world, S.cars, opts, async (p) => { setProgress(p); await yieldUI(); });
  S.results = { ...r, mode: S.mode };
  renderResults();
  redraw();
  btn.disabled = false; btn.textContent = m.btn;
  setTimeout(() => setProgress(0), 600);
}

/* Runs of the route, one per gear: "Forward 3.40 m, turning right". Comes from
   summariseManeuvers() (planner.js) — pure, no DOM, already tested. */
function maneuverList(path) {
  return summariseManeuvers(path).map((s) => {
    const dir = s.dir === "reverse" ? "Reverse" : "Forward";
    const turn = s.turn === "straight" ? "" : `, turning ${s.turn}`;
    return `<li>${dir} ${s.distance.toFixed(2)} m${turn}</li>`;
  }).join("");
}

const WHY = {
  blocked: "Would fit on its own, but other parked cars are in the way",
  geometry: "Not enough room to manoeuvre, even on its own",
  embedded: "Does not fit: in its bay it already touches a wall or another car",
  tight: "Fits, but only just — not with the current safety margin",
  budget: "No route found within the manoeuvre limit",
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
    setVerdict(true, `All ${out.length} cars can ${m.verb}`, verdictOkSub(out, mode));
  } else {
    setVerdict(false, `${stuck.length} of ${S.cars.length} cannot ${m.verb}`,
      `${out.length} do make it. Click a car to see its route.`);
  }
  const ul = $("results"); ul.innerHTML = "";
  if (mode === "both") renderBothResults(ul, out, stuck, S.results.diag);
  else renderSingleResults(ul, out, stuck, S.results.diag);
  ul.querySelectorAll("[data-id]").forEach((b) => b.addEventListener("click", () => playCar(+b.dataset.id, b.dataset.dir)));
}

function verdictOkSub(out, mode) {
  if (mode === "both") {
    const worst = out.reduce((m2, o) => Math.max(m2, o.exit.man, o.entry.man), 0);
    return `At most ${worst} manoeuvre${worst === 1 ? "" : "s"} in the hardest case (going in or out).`;
  }
  const worst = out.reduce((m2, o) => Math.max(m2, o.man), 0);
  return `At most ${worst} manoeuvre${worst === 1 ? "" : "s"} in the hardest case.`;
}

function renderSingleResults(ul, out, stuck, diag) {
  for (const o of out) {
    const li = document.createElement("li");
    li.innerHTML = `<button class="res" data-id="${o.id}">
      <span class="dot" style="background:var(--green)"></span>
      <span><span class="name">${label(o.id)}</span>
      <span class="why">${o.man} manoeuvre${o.man === 1 ? "" : "s"} · ${o.len.toFixed(1)} m</span></span>
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

/* "both" mode: out[] carries {id,exit,entry} (each with path/man/len) and
   diag[id] carries {exit,entry} with "ok" or the kind of each — a car can fail
   in one direction only. Each row comes with two separate ▶ buttons
   (entry/exit). */
function renderBothResults(ul, out, stuck, diag) {
  for (const o of out) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="name" style="display:block;padding:4px 8px 2px">${label(o.id)}</span>
      <div class="res-pair">
        <button class="res" data-id="${o.id}" data-dir="entry">
          <span class="dot" style="background:var(--focus)"></span>
          <span><span class="dir">In</span>
          <span class="why">${o.entry.man} man. · ${o.entry.len.toFixed(1)} m</span></span></button>
        <button class="res" data-id="${o.id}" data-dir="exit">
          <span class="dot" style="background:var(--green)"></span>
          <span><span class="dir">Out</span>
          <span class="why">${o.exit.man} man. · ${o.exit.len.toFixed(1)} m</span></span></button>
      </div>
      <ol class="maneuvers" id="man-${o.id}"></ol>`;
    ul.appendChild(li);
  }
  for (const id of stuck) {
    const d = diag[id];
    const line = (dir, label2) => d[dir] === "ok" ? null : `${label2}: ${WHY[d[dir]?.kind || "geometry"]}`;
    const lines = [line("entry", "In"), line("exit", "Out")].filter(Boolean);
    const anyAmber = ["entry", "exit"].some((dir) => d[dir] !== "ok" && AMBER_KINDS.has(d[dir]?.kind));
    const li = document.createElement("li");
    li.innerHTML = `<button class="res" data-id="${id}">
      <span class="dot" style="background:var(--${anyAmber ? "amber" : "red"})"></span>
      <span><span class="name">${label(id)}</span>
      ${lines.map((t) => `<span class="why">${t}</span>`).join("")}</span></button>`;
    ul.appendChild(li);
  }
}

/* Runs of the route that has just been played — only in "both" mode, where
   each row has two ▶ (in/out) and the list is shared under both, so it has to
   be updated according to which one was clicked. */
function showManeuversFor(id, path) {
  const ol = document.getElementById(`man-${id}`);
  if (ol) ol.innerHTML = maneuverList(path);
}

/* The route animation is the main way of seeing how the car moves, not
   decoration.

   That is why it does TWO things it did not do before:

   - It loops, with a pause at the end of each lap. It used to play once: if
     you were looking somewhere else on screen you missed it, with no way back
     other than clicking again.
   - It does not obey "prefers-reduced-motion" by shortening itself into
     invisibility. On many Windows PCs that preference is switched on by the
     system without the user having chosen it for anything like this, and it
     left the animation at 450 ms: a blink. With reduced motion we make it
     slower and non-looping, which is what the preference actually asks for
     (less sudden movement), not invisible. */
const HOLD_MS = 900;
function animatePlaying(pathLen) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dur = Math.min(9000, Math.max(1600, 900 + pathLen * 34));
  const t0 = performance.now();
  const tick = (now) => {
    const el = now - t0;
    const p = Math.min(1, el / dur);
    S.playing.t = p * (pathLen - 1);
    redraw();
    if (p < 1) { S.anim = requestAnimationFrame(tick); return; }
    if (reduce) return;                       // a single pass, no looping
    if (el < dur + HOLD_MS) { S.anim = requestAnimationFrame(tick); return; }
    animatePlaying(pathLen);                  // start over
  };
  S.anim = requestAnimationFrame(tick);
}

/* For a stuck car diagnosed as "blocked", the engine already knows which route
   it would have taken on its own and where it hits another car (see
   checkDirection in planner.js) — in "both" mode we have to pick which
   direction to show (whichever has one, preferring the exit). */
function blockedPathFor(id, dir) {
  const d = S.results?.diag?.[id];
  if (!d) return null;
  if (S.results?.mode === "both") {
    const pick = (dir && d[dir]?.path) ? d[dir] : (d.exit?.path ? d.exit : d.entry);
    return pick?.path ? pick : null;
  }
  return d.path ? d : null;
}

function playCar(id, dir) {
  const both = S.results?.mode === "both";
  const found = S.results?.out.find((x) => x.id === id);
  const o = both ? found?.[dir] : found;
  document.querySelectorAll(".res").forEach((b) => b.setAttribute("aria-current", (+b.dataset.id === id && (!dir || b.dataset.dir === dir)) ? "true" : "false"));
  if (S.anim) cancelAnimationFrame(S.anim);
  if (!o) {
    const blocked = blockedPathFor(id, dir);
    if (!blocked) { S.playing = { id, path: null, present: S.cars.map((c) => c.id), t: 0 }; redraw(); return; }
    if (both) showManeuversFor(id, blocked.path);
    S.playing = { id, path: blocked.path, present: S.cars.map((c) => c.id), t: 0, fail: true, hitAt: blocked.hitAt };
    // The stroke and the footprint show the whole route it would have taken
    // (to see whether it would have ended up using it), but the animated car
    // stops exactly at the point of contact — there is no sense in drawing it
    // driving through the other car as if it were not there.
    const hitIdx = blocked.hitAt ? blocked.path.indexOf(blocked.hitAt) : -1;
    animatePlaying(hitIdx >= 0 ? hitIdx + 1 : blocked.path.length);
    return;
  }
  if (both) showManeuversFor(id, o.path);
  S.playing = { id, path: o.path, present: o.present, t: 0 };
  animatePlaying(o.path.length);
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

/* ----------------------------------------------------------------- theme - */
/* Light/dark: by default it follows the system (@media in the CSS, nothing to
   do here — see the script in <head> that avoids the flash). The button stores
   an explicit choice in localStorage, which always wins. The canvas reads the
   colours with getComputedStyle while painting (render.js: css()), so a theme
   change is only visible if it is redrawn — hence the redraw() calls. */
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
  // only if the user has not explicitly chosen — if they have, their choice
  // wins over the system.
  if (!document.documentElement.hasAttribute("data-theme")) redraw();
});

/* --------------------------------------------------------------- start --- */
writeFields();
loadPreset("empty");
updateHud();
refreshSavedList();
