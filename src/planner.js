/* Planificador i evacuacio. Cap DOM, cap estat global: tot arriba per
   parametre, i per aixo es pot provar amb Node sense navegador. */

import {
  VOID, EXIT, CELL, idx, inBounds,
  segHitsOBB, cellHitsOBB, obbHitsOBB, wallField, MinHeap,
} from "./geometry.js";
import { specOf } from "./vehicle.js";

export const NTH = 36;          // sectors d'orientacio (10 graus)
export const XYBIN = 0.15;      // resolucio de la cerca en planta (m)
export const STEP = 0.22;       // metres per pas d'arc
export const GEAR_COST = 1.2;   // penalitzacio per canvi de marxa
export const REV_COST = 0.5;    // sobrecost del metre en marxa enrere
export const MAX_EXPAND = 260000;

/* NTH, XYBIN, STEP i els 7 angles de direccio son el fix del bug de monotonia:
   amb la resolucio original (0,25 m / 24 sectors / 5 angles) el cercador donava
   resultats no monotons respecte del marge — sortia amb 0,25 i no amb 0,35. Un
   marge mes gran no pot facilitar mai la sortida, aixi que aixo nomes podia ser
   el cercador, no la geometria. Ho guarda test/planner-regression.test.js:
   abaixar aquesta resolucio ha de fer fallar els tests. */

/* --------------------------------------------------------- referencies ---- */

/* El planificador treballa amb el centre de l'eix posterior; el dibuix i la
   colisio, amb el centre del cos. Aquestes dues fan el pont. */
export function rearAxle(car, v) {
  const off = v.L / 2 - v.Ro;
  return { x: car.cx - Math.cos(car.th) * off, y: car.cy - Math.sin(car.th) * off, th: car.th };
}
export function centreFromRear(x, y, th, v) {
  const off = v.L / 2 - v.Ro;
  return { cx: x + Math.cos(th) * off, cy: y + Math.sin(th) * off, th };
}

/* Conjunt d'obstacles per a un cotxe concret: els murs del `world` (graella i
   segments alhora) mes els altres cotxes que encara hi son. El planificador no
   sap quina font ve d'on. */
export function obstaclesFor(world, allCars, excludeId, presentIds) {
  const set = new Set(presentIds);
  const cars = []; let carHd = 0;
  for (const c of allCars) {
    if (c.id === excludeId || !set.has(c.id)) continue;
    const sp = specOf(c), hl = sp.L / 2, hw = sp.W / 2;
    cars.push({ cx: c.cx, cy: c.cy, co: Math.cos(c.th), si: Math.sin(c.th), hl, hw });
    carHd = Math.max(carHd, Math.hypot(hl, hw));
  }
  return { wall: wallField(world), cars, carHd, segs: world.segs };
}

/* ------------------------------------------------------------- colisio ---- */

/* x,y = centre de l'eix posterior. Cert si el cotxe hi cap sense tocar res. */
export function freeAt(world, obs, x, y, th, v, margin) {
  const co = Math.cos(th), si = Math.sin(th);
  const off = v.L / 2 - v.Ro;
  const cx = x + co * off, cy = y + si * off;
  const hl = v.L / 2 + margin, hw = v.W / 2 + margin;
  const ex = Math.abs(co) * hl + Math.abs(si) * hw;
  const ey = Math.abs(si) * hl + Math.abs(co) * hw;
  // El centre no pot sortir de la planta. El cos si que pot sobresortir-ne:
  // fora del dibuix hi ha el carrer, i es per on el cotxe travessa la sortida.
  if (cx < 0 || cy < 0 || cx > world.cols * CELL || cy > world.rows * CELL) return false;
  const hd = Math.hypot(hl, hw);

  const cc = (cx / CELL) | 0, cr = (cy / CELL) | 0;
  if (obs.wall[cr * world.cols + cc] < hd) {
    const c0 = Math.max(0, ((cx - ex) / CELL) | 0), c1 = Math.min(world.cols - 1, ((cx + ex) / CELL) | 0);
    const r0 = Math.max(0, ((cy - ey) / CELL) | 0), r1 = Math.min(world.rows - 1, ((cy + ey) / CELL) | 0);
    for (let r = r0; r <= r1; r++) {
      const base = r * world.cols;
      for (let c = c0; c <= c1; c++) {
        if (world.grid[base + c] !== VOID) continue;
        if (cellHitsOBB(c, r, cx, cy, co, si, hl, hw, ex, ey)) return false;
      }
    }
  }
  const segs = obs.segs;
  for (let i = 0; i < segs.length; i++)
    if (segHitsOBB(segs[i], cx, cy, co, si, hl, hw)) return false;

  const cars = obs.cars, lim = (hd + obs.carHd) * (hd + obs.carHd);
  for (let i = 0; i < cars.length; i++) {
    const o = cars[i], dx = o.cx - cx, dy = o.cy - cy;
    if (dx * dx + dy * dy > lim) continue;
    if (obbHitsOBB(cx, cy, co, si, hl, hw, o.cx, o.cy, o.co, o.si, o.hl, o.hw)) return false;
  }
  return true;
}

export function cellTypeAt(world, x, y) {
  const c = Math.floor(x / CELL), r = Math.floor(y / CELL);
  if (!inBounds(world, c, r)) return VOID;
  return world.grid[idx(world, c, r)];
}

/* ----------------------------------------------------------- heuristica --- */

/* Distancia en planta des de qualsevol cel·la fins a la sortida mes propera:
   escalfa el Hybrid A*. Dijkstra a 8 veins sobre la graella de dibuix.

   Float64Array, no Float32Array: amb float32 l'arrodoniment (~1e-7 en aquestes
   magnituds) supera l'epsilon d'1e-9 de sota, la mateixa cel·la es torna a
   encuar indefinidament i la cua no es buida mai. Es el bug 1. */
export function exitField(world, stats) {
  const { cols, rows, grid } = world;
  const N = cols * rows;
  const d = new Float64Array(N).fill(Infinity);
  const pq = new MinHeap();
  for (let i = 0; i < N; i++) if (grid[i] === EXIT) { d[i] = 0; pq.push(0, i); }
  const D8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
              [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
  let pops = 0;
  while (pq.size) {
    pops++;
    const [dist, i] = pq.pop();
    if (dist > d[i] + 1e-9) continue;
    const c = i % cols, r = (i / cols) | 0;
    for (const [dc, dr, w] of D8) {
      const nc = c + dc, nr = r + dr;
      if (!inBounds(world, nc, nr)) continue;
      const j = idx(world, nc, nr);
      if (grid[j] === VOID) continue;
      const nd = dist + w * CELL;
      if (nd < d[j] - 1e-9) { d[j] = nd; pq.push(nd, j); }
    }
  }
  // Amb Float64 cada cel·la s'estableix ~1 cop. Si algu hi torna a posar
  // Float32, aixo s'enfila a centenars de vegades N i no acaba mai:
  // test/planner-regression.test.js ho vigila.
  if (stats) stats.pops = pops;
  return d;
}

/* --------------------------------------------------------- planificador --- */

/* Hybrid A* sobre (x, y, angle) amb marxa endavant i enrere.
   Retorna {ok, path, man, len, expanded} o {ok:false, reason, expanded}.
   reason: "start" | "noroute" | "budget". */
export function plan(world, car, obs, hf, v, opts) {
  const nx = Math.ceil(world.cols * CELL / XYBIN), ny = Math.ceil(world.rows * CELL / XYBIN);
  // Float64Array tambe aqui, i pel mateix motiu que a exitField(): amb float32
  // el cost arrodonit supera l'epsilon d'1e-6 i el closed set deixa de tancar.
  const closed = new Float64Array(nx * ny * NTH).fill(Infinity);
  const X = [], Y = [], T = [], G = [], P = [], DIR = [], MAN = [];
  const start = rearAxle(car, v);
  if (!freeAt(world, obs, start.x, start.y, start.th, v, opts.margin))
    return { ok: false, reason: "start", expanded: 0 };

  const key = (x, y, th) => {
    const ix = Math.floor(x / XYBIN), iy = Math.floor(y / XYBIN);
    if (ix < 0 || iy < 0 || ix >= nx || iy >= ny) return -1;
    let it = Math.floor(((th % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / (2 * Math.PI / NTH));
    if (it >= NTH) it = 0;
    return (iy * nx + ix) * NTH + it;
  };
  const hAt = (x, y) => {
    const c = Math.floor(x / CELL), r = Math.floor(y / CELL);
    if (!inBounds(world, c, r)) return Infinity;
    return hf[idx(world, c, r)];
  };
  const h0 = hAt(start.x, start.y);
  if (!isFinite(h0)) return { ok: false, reason: "noroute", expanded: 0 };

  X.push(start.x); Y.push(start.y); T.push(start.th);
  G.push(0); P.push(-1); DIR.push(0); MAN.push(0);
  const open = new MinHeap();
  open.push(h0 * 0.9, 0);
  const k0 = key(start.x, start.y, start.th); if (k0 >= 0) closed[k0] = 0;

  const steers = [-1, -0.68, -0.34, 0, 0.34, 0.68, 1].map((f) => f * v.dmax);
  const dirs = opts.allowRev ? [1, -1] : [1];
  let expanded = 0, goal = -1;

  while (open.size) {
    const [, cur] = open.pop();
    const cx = X[cur], cy = Y[cur], cth = T[cur], cg = G[cur];
    const kk = key(cx, cy, cth);
    if (kk >= 0 && cg > closed[kk] + 1e-6) continue;
    const ctr = centreFromRear(cx, cy, cth, v);
    if (cellTypeAt(world, ctr.cx, ctr.cy) === EXIT) { goal = cur; break; }
    if (++expanded > MAX_EXPAND) return { ok: false, reason: "budget", expanded };

    for (const dir of dirs) {
      for (const st of steers) {
        let nxp, nyp, nth;
        if (Math.abs(st) < 1e-6) {
          nxp = cx + dir * STEP * Math.cos(cth); nyp = cy + dir * STEP * Math.sin(cth); nth = cth;
        } else {
          const R = v.B / Math.tan(st);
          const dth = dir * STEP / R;
          nth = cth + dth;
          nxp = cx - R * Math.sin(cth) + R * Math.sin(nth);
          nyp = cy + R * Math.cos(cth) - R * Math.cos(nth);
        }
        if (!freeAt(world, obs, nxp, nyp, nth, v, opts.margin)) continue;
        const gear = (DIR[cur] !== 0 && DIR[cur] !== dir) ? 1 : 0;
        const man = MAN[cur] + gear;
        if (man > opts.maxMan) continue;
        const ng = cg + STEP + (dir < 0 ? STEP * REV_COST : 0) + gear * GEAR_COST;
        const nk = key(nxp, nyp, nth);
        if (nk < 0) continue;
        if (ng >= closed[nk] - 1e-6) continue;
        const hh = hAt(nxp, nyp);
        if (!isFinite(hh)) continue;
        closed[nk] = ng;
        X.push(nxp); Y.push(nyp); T.push(nth); G.push(ng); P.push(cur); DIR.push(dir); MAN.push(man);
        open.push(ng + hh * 0.9, X.length - 1);
      }
    }
  }
  if (goal < 0) return { ok: false, reason: "noroute", expanded };
  const path = [];
  for (let i = goal; i >= 0; i = P[i]) path.push({ x: X[i], y: Y[i], th: T[i], dir: DIR[i] });
  path.reverse();
  return { ok: true, path, man: MAN[goal], len: G[goal], expanded };
}

/* ------------------------------------------------------------ evacuacio --- */

/* Evacuacio per rondes: a cada ronda s'intenta plan() per a tots els que
   queden, en surten els que troben sortida, i es repeteix. Si una ronda no en
   treu cap, la resta queden bloquejats i es diagnostica per que.

   `onProgress` es opcional i pot retornar una promesa; l'app l'aprofita per
   cedir el fil i moure la barra. Els tests no la passen. */
export async function evacuate(world, cars, opts, onProgress) {
  const hf = exitField(world);
  let remaining = cars.map((c) => c.id);
  const out = [], stuck = [];
  let round = 0, done = 0;
  const total = cars.length || 1;

  while (remaining.length) {
    round++;
    const before = remaining.length;
    const snapshot = remaining.slice();
    const leaving = [];
    for (const id of snapshot) {
      const car = cars.find((c) => c.id === id);
      const res = plan(world, car, obstaclesFor(world, cars, id, snapshot), hf, specOf(car), opts);
      if (res.ok) leaving.push({ id, path: res.path, man: res.man, len: res.len, round, present: snapshot.slice() });
      await onProgress?.((done + leaving.length) / total * 0.9);
    }
    if (!leaving.length) { stuck.push(...remaining); break; }
    out.push(...leaving);
    done += leaving.length;
    const gone = new Set(leaving.map((l) => l.id));
    remaining = remaining.filter((id) => !gone.has(id));
    if (remaining.length === before) break;
  }

  // Per als bloquejats, distingir "el tapen" de "no hi cap de cap manera".
  const diag = {};
  for (const id of stuck) {
    const car = cars.find((c) => c.id === id);
    const v = specOf(car);
    const alone = obstaclesFor(world, cars, id, []);      // sol al recinte
    const res = plan(world, car, alone, hf, v, opts);
    if (res.ok) diag[id] = { kind: "blocked", man: res.man };
    else if (res.reason === "start") {
      // La placa es massa justa de debo, o nomes amb el marge demanat?
      const st = rearAxle(car, v);
      diag[id] = freeAt(world, alone, st.x, st.y, st.th, v, 0) ? { kind: "tight" } : { kind: "embedded" };
    } else diag[id] = res.reason === "budget" ? { kind: "budget" } : { kind: "geometry" };
    await onProgress?.(0.95);
  }
  await onProgress?.(1);
  return { out, stuck, diag, order: out.map((o) => o.id) };
}

/* --------------------------------------------------------- maniobres ------ */

function wrapAngle(a) { let d = a % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; }

/* Desglossa un `path` (el que retorna plan()/evacuate() a `out[].path`) en
   maniobres: trams seguits en la mateixa marxa, amb la distancia recorreguda
   i cap a quin costat giren en conjunt. El nombre de trams menys 1 es
   exactament `man` (el comptador de canvis de marxa que ja fa servir la UI).

   ponytail: "turn" es el gir NET del tram (suma dels increments d'angle,
   no el gir instantani) — un tram que corba a la dreta i despres a
   l'esquerra en la mateixa marxa pot sortir "recte" si els dos es
   compensen. Prou per a un resum llegible; si algun dia cal el detall
   exacte, ja hi ha el `path` sencer per dibuixar-lo punt a punt. */
export function summariseManeuvers(path) {
  if (!path || path.length < 2) return [];
  const steps = [];
  let i = 1;
  while (i < path.length) {
    const dir = path[i].dir;
    let j = i, dist = 0, dth = 0;
    while (j < path.length && path[j].dir === dir) {
      dist += Math.hypot(path[j].x - path[j - 1].x, path[j].y - path[j - 1].y);
      dth += wrapAngle(path[j].th - path[j - 1].th);
      j++;
    }
    if (dist > 1e-6) {
      steps.push({
        dir: dir < 0 ? "enrere" : "endavant",
        distance: dist,
        turn: Math.abs(dth) < 0.08 ? "recte" : (dth > 0 ? "dreta" : "esquerra"),
      });
    }
    i = j;
  }
  return steps;
}
