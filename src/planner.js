/* Planificador i evacuacio. Cap DOM, cap estat global: tot arriba per
   parametre, i per aixo es pot provar amb Node sense navegador. */

import {
  VOID, EXIT, ENTRANCE, GATE, CELL, idx, inBounds,
  segHitsOBB, cellHitsOBB, obbHitsOBB, wallField, MinHeap,
} from "./geometry.js";
import { specOf } from "./vehicle.js";

/* GATE val per EXIT i per ENTRANCE alhora (una sola porta que s'usa en
   tots dos sentits) — a tot arreu on es compara una cel·la contra
   `goalType`/`targetType`, cal acceptar tambe GATE. */
function isGoalCell(cellValue, goalType) { return cellValue === goalType || cellValue === GATE; }

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

/* Distancia en planta des de qualsevol cel·la fins a la cel·la mes propera
   de `targetType` (EXIT per sortir, ENTRANCE per entrar-hi): escalfa el
   Hybrid A*. Dijkstra a 8 veins sobre la graella de dibuix.

   Float64Array, no Float32Array: amb float32 l'arrodoniment (~1e-7 en aquestes
   magnituds) supera l'epsilon d'1e-9 de sota, la mateixa cel·la es torna a
   encuar indefinidament i la cua no es buida mai. Es el bug 1. */
export function exitField(world, targetType = EXIT, stats) {
  const { cols, rows, grid } = world;
  const N = cols * rows;
  const d = new Float64Array(N).fill(Infinity);
  const pq = new MinHeap();
  for (let i = 0; i < N; i++) if (isGoalCell(grid[i], targetType)) { d[i] = 0; pq.push(0, i); }
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

/* Pose despres de recorrer `armLen` metres d'arc amb aquest angle de volant
   `st` (0 = recte) i marxa `dir`, des de (cx,cy,cth). Es la mateixa formula
   que el pas principal de plan(), pero parametritzada per longitud d'arc
   perque tambe serveix per als sub-punts de subGoalPose() mes avall. */
function stepPose(cx, cy, cth, dir, st, armLen, v) {
  if (Math.abs(st) < 1e-6) return { x: cx + dir * armLen * Math.cos(cth), y: cy + dir * armLen * Math.sin(cth), th: cth };
  const R = v.B / Math.tan(st);
  const dth = dir * armLen / R;
  const nth = cth + dth;
  return { x: cx - R * Math.sin(cth) + R * Math.sin(nth), y: cy + R * Math.cos(cth) - R * Math.cos(nth), th: nth };
}

/* Si l'arc de (cx,cy,cth) fins al pas sencer (STEP) travessa una cel·la de
   `goalType` en algun punt — inclos el pas sencer mateix (k=4), aixi ja no
   cal cap comprovacio d'aterratge per separat — evita que una zona
   d'entrada/sortida mes prima que STEP (0,22 m) quedi "saltada per sobre":
   el cotxe hi passaria fisicament pero cap dels dos extrems del salt
   discret cauria a dins. Mesurat: amb una sortida ampla pero de nomes
   0,1-0,2 m de fondaria en la direccio d'avanc, plan() fallava (noroute)
   tot i ser trivialment recte — amb aquesta comprovacio hi arriba.
   4 sub-punts es prou fi per a qualsevol cosa dibuixable (la cel·la mes
   petita ja es de 0,1 m). Cada sub-punt es valida amb freeAt() tambe: no
   n'hi ha prou que el pas sencer sigui lliure als dos extrems, un punt
   intermedi podria no ser-ho en una geometria prou estranya. */
function subGoalPose(world, obs, cx, cy, cth, dir, st, v, margin, goalType) {
  for (let k = 1; k <= 4; k++) {
    const sp = stepPose(cx, cy, cth, dir, st, STEP * (k / 4), v);
    if (!freeAt(world, obs, sp.x, sp.y, sp.th, v, margin)) continue;
    const c = centreFromRear(sp.x, sp.y, sp.th, v);
    if (isGoalCell(cellTypeAt(world, c.cx, c.cy), goalType)) return sp;
  }
  return null;
}

/* Hybrid A* sobre (x, y, angle) amb marxa endavant i enrere, des de la
   posicio actual del cotxe fins a qualsevol cel·la de `goalType` (EXIT per
   defecte; ENTRANCE per calcular — combinat amb reversePath() — el
   recorregut invers d'entrada, vegeu arrive() mes avall).
   Retorna {ok, path, man, len, expanded} o {ok:false, reason, expanded}.
   reason: "start" | "noroute" | "budget". */
export function plan(world, car, obs, hf, v, opts, goalType = EXIT) {
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
    if (isGoalCell(cellTypeAt(world, ctr.cx, ctr.cy), goalType)) { goal = cur; break; }
    if (++expanded > MAX_EXPAND) return { ok: false, reason: "budget", expanded };

    for (const dir of dirs) {
      for (const st of steers) {
        const { x: nxp, y: nyp, th: nth } = stepPose(cx, cy, cth, dir, st, STEP, v);
        if (!freeAt(world, obs, nxp, nyp, nth, v, opts.margin)) continue;
        const gear = (DIR[cur] !== 0 && DIR[cur] !== dir) ? 1 : 0;
        const man = MAN[cur] + gear;
        if (man > opts.maxMan) continue;
        const hh = hAt(nxp, nyp);
        if (!isFinite(hh)) continue;

        // El tram sencer es lliure (acabem de comprovar-ho): si l'aterratge
        // ja es a prop del objectiu (heuristica < 1,5 STEP — nomes aixo, no
        // cada expansio: subGoalPose fa fins a 4 freeAt() mes i cridar-ho
        // sempre multiplicava per 4 el temps de cerca sencer), mira si en
        // algun punt del tram (l'aterratge inclos) arriba a `goalType` —
        // vegeu subGoalPose per que cal mirar tot el tram i no nomes l'extrem.
        if (hh < STEP * 1.5) {
          const sub = subGoalPose(world, obs, cx, cy, cth, dir, st, v, opts.margin, goalType);
          if (sub) {
            const subLen = Math.hypot(sub.x - cx, sub.y - cy);
            X.push(sub.x); Y.push(sub.y); T.push(sub.th);
            G.push(cg + subLen + (dir < 0 ? subLen * REV_COST : 0) + gear * GEAR_COST);
            P.push(cur); DIR.push(dir); MAN.push(man);
            goal = X.length - 1; break;
          }
        }

        const ng = cg + STEP + (dir < 0 ? STEP * REV_COST : 0) + gear * GEAR_COST;
        const nk = key(nxp, nyp, nth);
        if (nk < 0) continue;
        if (ng >= closed[nk] - 1e-6) continue;
        closed[nk] = ng;
        X.push(nxp); Y.push(nyp); T.push(nth); G.push(ng); P.push(cur); DIR.push(dir); MAN.push(man);
        open.push(ng + hh * 0.9, X.length - 1);
      }
      if (goal >= 0) break;
    }
    if (goal >= 0) break;
  }
  if (goal < 0) return { ok: false, reason: "noroute", expanded };
  const path = [];
  for (let i = goal; i >= 0; i = P[i]) path.push({ x: X[i], y: Y[i], th: T[i], dir: DIR[i] });
  path.reverse();
  return { ok: true, path, man: MAN[goal], len: G[goal], expanded };
}

/* ------------------------------------------------------------ evacuacio --- */

/* El model cinematic d'aquest motor es reversible: recorrer un arc endavant
   amb un angle de volant concret i despres recorrer'l en sentit contrari amb
   el MATEIX angle (marxa enrere en lloc d'endavant) torna exactament al
   punt de partida — es pot comprovar algebraicament amb la formula de l'arc
   de plan() (i test/access.test.js ho fa amb un recorregut real). Aixo vol
   dir que un recorregut trobat "de la plaça cap a X" es, girat, un
   recorregut valid "de X cap a la plaça" amb les marxes intercanviades:
   no cal cap cercador nou per saber com s'hi entra, nomes invertir el que
   ja en sortia. `arrive()` ho explota per no duplicar plan(). */
export function reversePath(path) {
  const n = path.length - 1;
  const out = [];
  for (let i = 0; i <= n; i++) {
    const p = path[n - i];
    out.push({ x: p.x, y: p.y, th: p.th, dir: i === 0 ? 0 : -path[n - i + 1].dir });
  }
  return out;
}

/* Nucli comu a evacuate()/arrive(): cada cotxe es comprova de manera
   independent, amb TOTS els altres aparcats exactament on son — mai se
   suposa que algun altre ja ha sortit (o encara no ha arribat) per fer-li
   lloc. Aixo es deliberat: un cotxe ha de poder sortir/entrar tal com esta
   la planta ara, no nomes en una seqüencia hipotetica en que uns altres es
   mouen primer. (Versio antiga d'evacuate(): "per rondes", on un cotxe que
   nomes podia sortir despres que un altre marxés es donava per bo — es va
   treure perque donava per suposat un ordre que ningu garanteix.)

   `goalType` es EXIT (sortida) o ENTRANCE (pas previ d'arrive(), abans de
   girar el recorregut). `onProgress` es opcional i pot retornar una
   promesa; l'app l'aprofita per cedir el fil i moure la barra. */
async function checkDirection(world, cars, opts, goalType, onProgress) {
  const hf = exitField(world, goalType);
  const allIds = cars.map((c) => c.id);
  const out = [], stuck = [];
  const diag = {};
  const total = cars.length || 1;
  let done = 0;

  for (const car of cars) {
    const others = allIds.filter((id) => id !== car.id);
    const withOthers = obstaclesFor(world, cars, car.id, others);
    const res = plan(world, car, withOthers, hf, specOf(car), opts, goalType);
    if (res.ok) {
      out.push({ id: car.id, path: res.path, man: res.man, len: res.len, present: others });
    } else {
      stuck.push(car.id);
      // Per diagnosticar per que: si tampoc hi cabria sol al recinte, no es
      // culpa dels altres cotxes — distingeix "el tapen" de "no hi ha espai".
      const v = specOf(car);
      const alone = obstaclesFor(world, cars, car.id, []);
      const resAlone = plan(world, car, alone, hf, v, opts, goalType);
      if (resAlone.ok) diag[car.id] = { kind: "blocked" };
      else if (resAlone.reason === "start") {
        const st = rearAxle(car, v);
        diag[car.id] = freeAt(world, alone, st.x, st.y, st.th, v, 0) ? { kind: "tight" } : { kind: "embedded" };
      } else diag[car.id] = resAlone.reason === "budget" ? { kind: "budget" } : { kind: "geometry" };
    }
    done++;
    await onProgress?.(done / total);
  }
  return { out, stuck, diag, order: out.map((o) => o.id) };
}

/* Sortida: de la plaça de cadascu cap a la sortida mes propera. */
export function evacuate(world, cars, opts, onProgress) {
  return checkDirection(world, cars, opts, EXIT, onProgress);
}

/* Entrada: de l'entrada mes propera cap a la plaça de cadascu. Es calcula
   com una "sortida" cap a ENTRANCE (mateix cercador, cap codi nou) i
   despres es giren els recorreguts trobats — vegeu reversePath(). */
export async function arrive(world, cars, opts, onProgress) {
  const r = await checkDirection(world, cars, opts, ENTRANCE, onProgress);
  return { ...r, out: r.out.map((o) => ({ ...o, path: reversePath(o.path) })) };
}

/* Entrada i sortida: cada cotxe ha de poder fer les dues coses, amb tots
   els altres aparcats. Nomes compta com a "surt" (out) si hi arriba en
   totes dues direccions; si en falla alguna, stuck amb el diagnostic de
   cadascuna (una pot anar be i l'altra no: p.ex. cap justet nomes en un
   sentit no es el mateix problema geometric). */
export async function checkBothWays(world, cars, opts, onProgress) {
  const exitR = await checkDirection(world, cars, opts, EXIT, (p) => onProgress?.(p * 0.5));
  const entryR = await arrive(world, cars, opts, (p) => onProgress?.(0.5 + p * 0.5));
  const exitById = new Map(exitR.out.map((o) => [o.id, o]));
  const entryById = new Map(entryR.out.map((o) => [o.id, o]));
  const out = [], stuck = [];
  const diag = {};
  for (const car of cars) {
    const ex = exitById.get(car.id), en = entryById.get(car.id);
    if (ex && en) out.push({ id: car.id, exit: ex, entry: en });
    else {
      stuck.push(car.id);
      diag[car.id] = { exit: ex ? "ok" : exitR.diag[car.id], entry: en ? "ok" : entryR.diag[car.id] };
    }
  }
  return { out, stuck, diag };
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
