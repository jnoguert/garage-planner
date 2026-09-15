/* The bugs we have already found, turned into tests.

   Any future change to the planner or to the collision has to get through here
   before it counts as good. */

import test from "node:test";
import assert from "node:assert/strict";
import { presets, newWorldM, fillRectM, makeCars, ASPH } from "../src/scene.js";
import { VOID, EXIT, CELL, idx, inBounds } from "../src/geometry.js";
import { specOf } from "../src/vehicle.js";
import { exitField, obstaclesFor, plan, evacuate } from "../src/planner.js";

const OPTS = { margin: 0.15, maxMan: 14, allowRev: true };
const D8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
            [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];

/* ================================================================ BUG 1 ====
   The distance-to-exit field and the closed set of the Hybrid A* compared
   costs with a tiny epsilon over a Float32Array. Float32 rounding (~1e-7 at
   these magnitudes) exceeds the epsilon, so the SAME relaxation is accepted
   again every time and the queue never empties.

   Measured on this code: with Float64Array each cell comes off the queue ~1.0
   times. With Float32Array, 1389x the number of cells on the "bays" preset and
   2069x on "narrow" without finishing — it is not that it is slow, it is that
   it does not finish.

   That is why the test does not use the clock (it would be flaky and, besides,
   a hang cannot be timed): it counts how many times each cell comes off the
   queue. It is deterministic and fails instantly.                           */

for (const name of ["bays", "narrow", "tandem"]) {
  test(`bug 1: exitField("${name}") does not refill the queue`, () => {
    const { world } = presets[name]();
    const stats = {};
    const d = exitField(world, EXIT, stats);
    const N = world.cols * world.rows;

    assert.ok(d instanceof Float64Array,
      "exitField has to use Float64Array: with Float32Array the queue never empties");

    // Deliberately wide margin: the healthy value is ~1.0x and the sick one >1000x.
    assert.ok(stats.pops < 3 * N,
      `the queue refilled: ${stats.pops} pops for ${N} cells ` +
      `(${(stats.pops / N).toFixed(1)}x). The healthy value is ~1.0x. Did someone put Float32Array back?`);
  });

  test(`bug 1: exitField("${name}") really converges`, () => {
    // The field has to be a genuine fixed point of Dijkstra: no relaxable edge.
    // With float32 this property breaks long before it does with float64.
    const { world } = presets[name]();
    const d = exitField(world);
    let worst = 0, on = null;
    for (let r = 0; r < world.rows; r++) for (let c = 0; c < world.cols; c++) {
      const i = idx(world, c, r);
      if (world.grid[i] === VOID || !isFinite(d[i])) continue;
      for (const [dc, dr, w] of D8) {
        const nc = c + dc, nr = r + dr;
        if (!inBounds(world, nc, nr)) continue;
        const j = idx(world, nc, nr);
        if (world.grid[j] === VOID) continue;
        const slack = d[j] - (d[i] + w * CELL);
        if (slack > worst) { worst = slack; on = `(${c},${r})->(${nc},${nr})`; }
      }
    }
    assert.ok(worst < 1e-9, `edges still relaxable: ${worst.toExponential(2)} at ${on}`);
  });
}

/* The closed set of plan() has to be a Float64Array too, for the same reason.
   Here float32 does NOT show up as a hang but as WORSE results: on the
   "tandem" preset it gets fewer cars out than fit. So what guards it is the
   result, not the counter. */
test("bug 1: the closed set does not degrade the result (tandem)", async () => {
  /* With the closed set in float32 the rounding exceeds the comparison epsilon
     and the search degrades: fewer cars get out than can. That is what this
     test watches for.

     Assertion: ALL of them have to get out. That is the maximum possible, so
     it is not a figure that needs tweaking every time the search improves (it
     used to say "4 of the 6" and went stale when NTH went up to 72); any
     degradation of the search, on the other hand, breaks it immediately. */
  const { world, cars } = presets.tandem();
  const r = await evacuate(world, cars, OPTS);
  assert.equal(r.out.length, cars.length, "tandem: every car fits, none should be lost to the search");
  assert.equal(r.stuck.length, 0);
});

/* ================================================================ BUG 2 ====
   Invariant: a LARGER safety margin can never make leaving easier. It is pure
   geometry — the fattened car fits everywhere the thin one did. If the planner
   says "gets out" at margin m, it has to say "gets out" for every m' < m.

   A violation of this is ALWAYS a bug in the search (discretisation of the
   (x, y, angle) space), never in the geometry.                              */

const MARGINS = [0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40];

/* Checks monotonicity for each car of a floor plan, with all the other cars
   present. Returns the list of violations found. */
function monotonicityViolations(preset) {
  const { world, cars } = presets[preset]();
  const hf = exitField(world);
  const all = cars.map((c) => c.id);
  const found = [];
  for (const car of cars) {
    const obs = obstaclesFor(world, cars, car.id, all);
    const v = specOf(car);
    const seq = MARGINS.map((m) => plan(world, car, obs, hf, v, { ...OPTS, margin: m }).ok);
    for (let i = 1; i < seq.length; i++) {
      if (seq[i] && !seq[i - 1]) {
        found.push(
          `${preset} car ${cars.indexOf(car)} (${v.name}): ` +
          `margin ${MARGINS[i - 1].toFixed(2)} = NO EXIT but ${MARGINS[i].toFixed(2)} = EXIT ` +
          `[${seq.map((b) => (b ? "1" : "0")).join("")}]`
        );
      }
    }
  }
  return found;
}

for (const name of ["garage", "garage3", "tandem"]) {
  test(`bug 2: a larger margin does not make leaving easier ("${name}")`, () => {
    const v = monotonicityViolations(name);
    assert.deepEqual(v, [], `monotonicity broken:\n  ${v.join("\n  ")}`);
  });
}

/* ⚠ OPEN BUG, not a regression.

   The 0.15 m bins and the move from 36 to 72 sectors (10 -> 5 degrees) have
   greatly reduced this problem, but they have NOT eliminated it: the "narrow"
   preset still shows it. With 36 sectors there were 4 violations and only 5 of
   the 16 cars got out; with 72, 16 of 16 get out and 3 violations remain, all
   at large margins (0.20 and up), where the aisle is already so tight that a
   couple of centimetres decide it:

     narrow car 3:  margin 0.20 NO EXIT / 0.25 EXIT
     narrow car 6:  margin 0.30 NO EXIT / 0.35 EXIT
     narrow car 12: margin 0.35 NO EXIT / 0.40 EXIT

   The failures are "noroute" with ~1400 expansions, against ~2800 when there
   is an exit: the queue emptied early. With the budget untouched and a route
   that exists both at a smaller margin and at a larger one, it can only be
   that the closed set is discarding states that were needed — the classic
   Hybrid A* discretisation artefact, not the geometry.

   It is marked `todo` so as not to hide it: it shows up on every test run, and
   the day someone fixes it, this test will start passing.                   */
test("bug 2: monotonicity on \"narrow\" (OPEN BUG, still failing)", { todo: "the finer resolution reduced it but did not eliminate it; see the comment" }, () => {
  const v = monotonicityViolations("narrow");
  assert.deepEqual(v, [], `monotonicity broken:\n  ${v.join("\n  ")}`);
});

/* ================================================================ BUG 3 ====
   An entrance/exit zone thinner than STEP (0.22 m) in the direction of travel
   was being "jumped over": the car would physically pass through it (no
   collision, no wall), but the discrete step landed just before and the next
   one just after, with neither falling inside the goal zone — plan() ended in
   "noroute" even though a trivially straight route existed.

   Reproduced with an open room and an EXIT strip only 0.1-0.15 m deep in the
   middle of the way: it always failed before the fix, and now it gets there
   with a stable number of expansions (it does not vary with the depth, a sign
   that it no longer depends on whether a landing point "falls nicely").

   Fix: subGoalPose() (planner.js) checks, for each candidate step, whether the
   ARC passes over the zone at any of 4 sub-points — not only whether the final
   landing point falls inside — and only when the heuristic already says we are
   close (hh < STEP*1.5), because calling it always quadrupled the whole search
   time while gaining nothing the vast majority of the time, when there is no
   goal zone nearby. */
test("bug 3: an entrance/exit zone thinner than STEP is not jumped over", async () => {
  for (const depth of [0.1, 0.15, 0.2]) {
    const world = newWorldM(20, 10);
    fillRectM(world, 0, 0, 20, 10, ASPH);
    fillRectM(world, 10, 4, 10 + depth, 6, EXIT);   // thin strip in the middle of the open
    const cars = makeCars();
    cars.addM(2.5, 5.0, 0, 1);
    const res = await evacuate(world, cars, OPTS);
    assert.equal(res.out.length, 1, `depth ${depth}m: it should find a trivially straight route`);
  }
});
