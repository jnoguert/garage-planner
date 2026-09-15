/* Planner and evacuation. No DOM, no global state: everything arrives as a
   parameter, which is why this can be tested under Node without a browser. */

import {
  VOID, EXIT, ENTRANCE, GATE, CELL, idx, inBounds,
  segHitsOBB, cellHitsOBB, obbHitsOBB, wallField, MinHeap,
} from "./geometry.js";
import { specOf } from "./vehicle.js";

/* GATE counts as EXIT and as ENTRANCE at the same time (a single door used in
   both directions) — everywhere a cell is compared against
   `goalType`/`targetType`, GATE has to be accepted too. */
function isGoalCell(cellValue, goalType) { return cellValue === goalType || cellValue === GATE; }

/* Orientation sectors in the closed set. This was 36 (10 degrees) for a long
   time and it was the main cause of "this car fits perfectly and the simulator
   says it does not": two poses in the same x/y bin but 9 degrees apart counted
   as the SAME state, and the search kept only the cheaper of the two — even
   when that was precisely the one that could not continue afterwards.
   Measured on the "narrow" preset (16 cars in a tight aisle):

     NTH=36 (10 degrees) -> 5/16 get out, and moving one car by 1 cm makes it 6
     NTH=72  (5 degrees) -> 16/16 get out, stable when moved +-2 cm
     NTH=144 (2.5 degrees) -> same as 72, but the suite goes from 7 s to 20 s

   72 is where the gain runs out: it doubles the search time and in exchange it
   stops discarding exits that do exist. The search is still incomplete (bug 2
   in the README) — it just happens far less often. */
export const NTH = 72;          // orientation sectors (5 degrees)
export const XYBIN = 0.15;      // search resolution in plan view (m)
export const STEP = 0.22;       // metres per arc step
export const GEAR_COST = 1.2;   // penalty for a gear change
export const REV_COST = 0.5;    // extra cost per metre driven in reverse
export const MAX_EXPAND = 260000;

/* NTH, XYBIN, STEP and the 7 steering angles are the fix for the monotonicity
   bug: at the original resolution (0.25 m / 24 sectors / 5 angles) the search
   gave results that were not monotonic in the margin — a car got out with 0.25
   but not with 0.35. A larger margin can never make leaving easier, so that
   could only be the search, not the geometry. test/planner-regression.test.js
   guards it: lowering this resolution has to make the tests fail. */

/* ---------------------------------------------------------- reference ----- */

/* The planner works with the centre of the rear axle; drawing and collision
   work with the centre of the body. These two bridge the gap. */
export function rearAxle(car, v) {
  const off = v.L / 2 - v.Ro;
  return { x: car.cx - Math.cos(car.th) * off, y: car.cy - Math.sin(car.th) * off, th: car.th };
}
export function centreFromRear(x, y, th, v) {
  const off = v.L / 2 - v.Ro;
  return { cx: x + Math.cos(th) * off, cy: y + Math.sin(th) * off, th };
}

/* The obstacle set for one particular car: the walls of the `world` (grid and
   segments alike) plus the other cars still present. The planner does not know
   which source a wall came from. */
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

/* ----------------------------------------------------------- collision --- */

/* x,y = centre of the rear axle. True if the car fits there touching nothing. */
export function freeAt(world, obs, x, y, th, v, margin) {
  const co = Math.cos(th), si = Math.sin(th);
  const off = v.L / 2 - v.Ro;
  const cx = x + co * off, cy = y + si * off;
  const hl = v.L / 2 + margin, hw = v.W / 2 + margin;
  const ex = Math.abs(co) * hl + Math.abs(si) * hw;
  const ey = Math.abs(si) * hl + Math.abs(co) * hw;
  // The centre may not leave the floor plan. The body may stick out of it:
  // outside the drawing is the street, and that is how the car crosses the exit.
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

/* ----------------------------------------------------------- heuristic --- */

/* Plan-view distance from any cell to the nearest cell of `targetType` (EXIT to
   leave, ENTRANCE to arrive): it warms up the Hybrid A*. Dijkstra over the
   8-neighbourhood of the drawing grid.

   Float64Array, not Float32Array: with float32 the rounding (~1e-7 at these
   magnitudes) exceeds the 1e-9 epsilon below, the same cell is queued again
   indefinitely and the queue never empties. That is bug 1. */
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
  // With Float64 each cell is settled ~once. If anyone puts Float32 back here,
  // this climbs to hundreds of times N and never finishes:
  // test/planner-regression.test.js watches for it.
  if (stats) stats.pops = pops;
  return d;
}

/* ------------------------------------------------------------- planner --- */

/* Pose after travelling `armLen` metres of arc at this steering angle `st`
   (0 = straight) and gear `dir`, starting from (cx,cy,cth). It is the same
   formula as the main step of plan(), but parameterised by arc length so that
   it also serves the sub-points of subGoalPose() below. */
function stepPose(cx, cy, cth, dir, st, armLen, v) {
  if (Math.abs(st) < 1e-6) return { x: cx + dir * armLen * Math.cos(cth), y: cy + dir * armLen * Math.sin(cth), th: cth };
  const R = v.B / Math.tan(st);
  const dth = dir * armLen / R;
  const nth = cth + dth;
  return { x: cx - R * Math.sin(cth) + R * Math.sin(nth), y: cy + R * Math.cos(cth) - R * Math.cos(nth), th: nth };
}

/* Whether the arc from (cx,cy,cth) to the full step (STEP) crosses a cell of
   `goalType` at any point — including the full step itself (k=4), so no
   separate landing check is needed. This stops an entrance/exit zone thinner
   than STEP (0.22 m) from being "jumped over": the car would physically pass
   through it, but neither end of the discrete jump would land inside.
   Measured: with an exit that is wide but only 0.1-0.2 m deep in the direction
   of travel, plan() failed (noroute) even though it was trivially straight —
   with this check it gets there. 4 sub-points is fine enough for anything
   drawable (the smallest cell is already 0.1 m). Every sub-point is validated
   with freeAt() too: it is not enough for the full step to be free at both
   ends, an intermediate point might not be in a strange enough geometry. */
function subGoalPose(world, obs, cx, cy, cth, dir, st, v, margin, goalType) {
  for (let k = 1; k <= 4; k++) {
    const sp = stepPose(cx, cy, cth, dir, st, STEP * (k / 4), v);
    if (!freeAt(world, obs, sp.x, sp.y, sp.th, v, margin)) continue;
    const c = centreFromRear(sp.x, sp.y, sp.th, v);
    if (isGoalCell(cellTypeAt(world, c.cx, c.cy), goalType)) return sp;
  }
  return null;
}

/* Hybrid A* over (x, y, angle) with forward and reverse gears, from the car's
   current position to any cell of `goalType` (EXIT by default; ENTRANCE to
   compute — combined with reversePath() — the reversed arrival route, see
   arrive() below).
   Returns {ok, path, man, len, expanded} or {ok:false, reason, expanded}.
   reason: "start" | "noroute" | "budget". */
export function plan(world, car, obs, hf, v, opts, goalType = EXIT) {
  const nx = Math.ceil(world.cols * CELL / XYBIN), ny = Math.ceil(world.rows * CELL / XYBIN);
  // Float64Array here too, and for the same reason as in exitField(): with
  // float32 the rounded cost exceeds the 1e-6 epsilon and the closed set stops
  // closing.
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

        // The whole step is free (we just checked): if the landing point is
        // already close to the goal (heuristic < 1.5 STEP — only then, not on
        // every expansion: subGoalPose costs up to 4 more freeAt() calls and
        // calling it always quadrupled the whole search time), look at whether
        // any point along the step (landing included) reaches `goalType` — see
        // subGoalPose for why the whole step matters and not just its end.
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

/* ---------------------------------------------------------- evacuation --- */

/* The kinematic model of this engine is reversible: driving an arc forwards at
   a given steering angle and then driving it back at the SAME angle (in
   reverse instead of forwards) returns exactly to the starting point — it can
   be checked algebraically with the arc formula in plan() (and
   test/access.test.js does it with a real route). That means a route found
   "from the bay towards X" is, reversed, a valid route "from X towards the
   bay" with the gears swapped: no new search is needed to know how a car gets
   in, only reversing the one that got it out. `arrive()` exploits this so it
   does not have to duplicate plan(). */
export function reversePath(path) {
  const n = path.length - 1;
  const out = [];
  for (let i = 0; i <= n; i++) {
    const p = path[n - i];
    out.push({ x: p.x, y: p.y, th: p.th, dir: i === 0 ? 0 : -path[n - i + 1].dir });
  }
  return out;
}

/* Core shared by evacuate()/arrive(): every car is checked independently, with
   ALL the others parked exactly where they are — it is never assumed that some
   other car has already left (or has not arrived yet) to make room. That is
   deliberate: a car has to be able to leave/arrive with the floor plan as it
   stands now, not only in some hypothetical sequence where others move first.
   (The old version of evacuate() worked "in rounds", where a car that could
   only leave after another one had gone was counted as fine — it was dropped
   because it assumed an order nobody guarantees.)

   `goalType` is EXIT (leaving) or ENTRANCE (the intermediate step of arrive(),
   before the route is reversed). `onProgress` is optional and may return a
   promise; the app uses it to yield the thread and move the progress bar. */
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
      // To diagnose why: if it would not fit in the empty floor plan either,
      // the other cars are not to blame — this separates "they block it" from
      // "there is not enough room".
      const v = specOf(car);
      const alone = obstaclesFor(world, cars, car.id, []);
      const resAlone = plan(world, car, alone, hf, v, opts, goalType);
      if (resAlone.ok) {
        // It fits on its own. This used to be labelled directly as "the other
        // cars block it", but that was NEVER checked anywhere: it was merely
        // inferred from "alone yes, with others no". And those are not the same
        // thing. Walk the route it would take alone and see whether some car
        // really does block it.
        //
        // The margin is the one the check was run with (opts.margin), not 0:
        // what decides the verdict is not just physical contact but also
        // passing closer than the requested safety margin.
        let hitAt = null;
        for (const pose of resAlone.path) {
          if (!freeAt(world, withOthers, pose.x, pose.y, pose.th, v, opts.margin)) { hitAt = pose; break; }
        }
        if (!hitAt) {
          // No point is blocked: this very route is still valid with all the
          // other cars parked (the same pose-by-pose check the search itself
          // does). So the car CAN get out — what happened is that the search
          // could not find the route again with more obstacles on the map (the
          // XYBIN/NTH bins collapse distinct poses and may discard one that was
          // needed later). This used to be reported as "the other cars block
          // it", blaming a car that had nothing to do with it; now the route is
          // used, since we already have it in hand and it is verified. The
          // search is still incomplete (see bug 2 in the README): this is a
          // safety net, not the cure.
          out.push({ id: car.id, path: resAlone.path, man: resAlone.man, len: resAlone.len, present: others });
          done++;
          await onProgress?.(done / total);
          continue;
        }
        stuck.push(car.id);
        diag[car.id] = { kind: "blocked", path: resAlone.path, hitAt };
      }
      else if (resAlone.reason === "start") {
        stuck.push(car.id);
        const st = rearAxle(car, v);
        diag[car.id] = freeAt(world, alone, st.x, st.y, st.th, v, 0) ? { kind: "tight" } : { kind: "embedded" };
      } else {
        stuck.push(car.id);
        diag[car.id] = resAlone.reason === "budget" ? { kind: "budget" } : { kind: "geometry" };
      }
    }
    done++;
    await onProgress?.(done / total);
  }
  return { out, stuck, diag, order: out.map((o) => o.id) };
}

/* Leaving: from each car's bay to the nearest exit. */
export function evacuate(world, cars, opts, onProgress) {
  return checkDirection(world, cars, opts, EXIT, onProgress);
}

/* Arriving: from the nearest entrance to each car's bay. It is computed as an
   "exit" towards ENTRANCE (same search, no new code) and then the routes found
   are reversed — see reversePath(). */
export async function arrive(world, cars, opts, onProgress) {
  const r = await checkDirection(world, cars, opts, ENTRANCE, onProgress);
  const diag = {};
  for (const id in r.diag) diag[id] = r.diag[id].path ? { ...r.diag[id], path: reversePath(r.diag[id].path) } : r.diag[id];
  return { ...r, out: r.out.map((o) => ({ ...o, path: reversePath(o.path) })), diag };
}

/* In and out: every car has to manage both, with all the others parked. It
   only counts as "gets through" (out) if it makes it in both directions; if
   either fails, it goes to stuck with a diagnosis for each one (one direction
   can be fine and the other not: e.g. a squeeze in one direction only is not
   the same geometric problem). */
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

/* --------------------------------------------------------- manoeuvres ---- */

function wrapAngle(a) { let d = a % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; }

/* Breaks a `path` (what plan()/evacuate() return in `out[].path`) down into
   manoeuvres: runs driven in the same gear, with the distance covered and
   which way they turn overall. The number of runs minus 1 is exactly `man`
   (the gear-change counter the UI already uses).

   ponytail: "turn" is the NET turn of the run (the sum of the angle
   increments, not the instantaneous turn) — a run that curves right and then
   left in the same gear can come out as "straight" if the two cancel. Good
   enough for a readable summary; if the exact detail is ever needed, the full
   `path` is there to draw point by point. */
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
        dir: dir < 0 ? "reverse" : "forward",
        distance: dist,
        turn: Math.abs(dth) < 0.08 ? "straight" : (dth > 0 ? "right" : "left"),
      });
    }
    i = j;
  }
  return steps;
}
