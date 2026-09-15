/* Evacuation and the 5 "no exit" diagnoses: blocked, embedded, tight,
   geometry, budget.

   Each scenario was found empirically (see the comment on each test) and then
   checked to give the expected diagnosis reliably, not just once. No scenario
   uses more than a couple of cars or a large floor plan, to keep the test
   suite under 5 seconds. */

import test from "node:test";
import assert from "node:assert/strict";
import { newWorldM, fillRectM, makeCars, ASPH, EXIT, presets } from "../src/scene.js";
import { mkSeg } from "../src/geometry.js";
import { evacuate, freeAt, obstaclesFor, rearAxle } from "../src/planner.js";
import { specOf } from "../src/vehicle.js";

const OPTS = { margin: 0.15, maxMan: 14, allowRev: true };

/* ------------------------------------------------------ independent check */
/* "tandem" (see scene.js): four bays at the back (ids 1-4) and two cars parked
   in front (ids 5,6), right in the way of the middle ones (2 and 3) — not of
   the outer ones (1 and 4, which have a clear run to the side). evacuate()
   never assumes 5 or 6 have already left: with everyone parked where they are,
   2 and 3 come out "blocked" (they would fit on their own, but 5/6 are in the
   way), while 1, 4, 5 and 6 get out anyway. No car "gets out" merely because
   another one was moved first. */
test("evacuation: every car is checked with all the others parked, none assumed gone", async () => {
  for (const name of ["tandem", "bays", "narrow"]) {
    const { world, cars } = presets[name]();
    const r = await evacuate(world, cars, OPTS);
    assert.ok(r.out.length > 0, `${name}: some car should get out`);

    /* The property, measured again from OUTSIDE the search: every pose of
       every route has to be free with ALL the other cars parked where they
       are. If some route were only valid assuming another car had already
       left, it would show up here.

       This used to be written as "cars 2 and 3 of the tandem must come out
       blocked": a list of indices that stopped meaning anything as soon as the
       search improved (with NTH=72 the tandem goes from 4/6 to 6/6, and the
       new routes are valid — verified right here). The property does not
       depend on how good the search is; the list did. */
    for (const o of r.out) {
      const car = cars.find((c) => c.id === o.id), v = specOf(car);
      const others = cars.map((c) => c.id).filter((id) => id !== o.id);
      const obs = obstaclesFor(world, cars, o.id, others);
      for (const p of o.path) {
        assert.ok(freeAt(world, obs, p.x, p.y, p.th, v, OPTS.margin),
          `${name}: car ${o.id} passes through (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) and someone is there`);
      }
    }
  }
});

/* ------------------------------------------------------------- embedded --- */
/* A car placed with its centre on top of a wall: it does not fit even with
   margin 0. Everything in metres (newWorldM/fillRectM/addM), not in cells: so
   the scenario does not depend on CELL and survives a change of grid
   resolution. */
test("diagnosis: embedded (placed on top of a wall)", async () => {
  const world = newWorldM(10, 10);
  fillRectM(world, 0, 0, 10, 10, ASPH);
  fillRectM(world, 2.5, 2.5, 4.0, 4.0, 0);   // VOID = wall, in the middle of the roadway
  fillRectM(world, 0, 0, 1.0, 1.0, EXIT);
  const cars = makeCars();
  const car = cars.addM(3.0, 3.0, 0, 1);     // centre right on the wall
  const r = await evacuate(world, cars, OPTS);
  assert.equal(r.stuck.length, 1);
  assert.equal(r.diag[car.id]?.kind, "embedded");
});

/* ----------------------------------------------------------------- tight --- */
/* Exact walls (segments, not grid) separated by a computed gap: with margin 0
   the car fits by a whisker; with the configured margin (0.15) it no longer
   does. */
test("diagnosis: tight (fits with margin 0, not with 0.15)", async () => {
  const world = newWorldM(10, 5);
  fillRectM(world, 0, 0, 10, 5, ASPH);
  fillRectM(world, 0, 0, 1.0, 1.0, EXIT);
  const cars = makeCars();
  const car = cars.addM(5.0, 2.5, 0, 1);     // Compact: W=1.79 -> hw=0.895
  const hw = specOf(car).W / 2;
  const gap = 0.08;                          // < 0.15 (the margin) and > 0
  world.segs = [
    mkSeg(0, car.cy - hw - gap, 10, car.cy - hw - gap),
    mkSeg(0, car.cy + hw + gap, 10, car.cy + hw + gap),
  ];
  // direct freeAt check at both margins, before trusting evacuate()
  const v = specOf(car), obs = obstaclesFor(world, cars, -1, []);
  const st = rearAxle(car, v);
  assert.equal(freeAt(world, obs, st.x, st.y, st.th, v, 0), true, "with margin 0 it should fit");
  assert.equal(freeAt(world, obs, st.x, st.y, st.th, v, 0.15), false, "with margin 0.15 it should not fit");

  const r = await evacuate(world, cars, OPTS);
  assert.equal(r.stuck.length, 1);
  assert.equal(r.diag[car.id]?.kind, "tight");
});

/* -------------------------------------------------------------- geometry --- */
/* Alone on the site, with not enough room to manoeuvre towards the exit:
   neither turning nor reversing gets it there. It is not "start" (it fits
   where it is) nor "budget" (the explorable space is small, it runs out before
   the ceiling).

   The site has to have real WALLS (VOID) around it, not simply end. Outside
   the drawing is "the street" and the car's body may deliberately stick out
   into it (see freeAt) — only the centre has to stay inside. This test used to
   fill the whole world with ASPH and assume the edge acted as a wall: the car
   could poke its nose outside and reach the corner exit by a legal route that
   the older, coarser search could not find. With NTH=72 it does find it, and
   the test "failed", showing that the floor plan was not the one it meant to
   test. */
test("diagnosis: geometry (no room to manoeuvre, even alone)", async () => {
  const world = newWorldM(7, 4);
  fillRectM(world, 0.5, 0.5, 6.5, 3.0, ASPH);   // walls (VOID) all round
  fillRectM(world, 0.5, 0.5, 1.1, 1.1, EXIT);   // exit tucked into the corner
  const cars = makeCars();
  const car = cars.addM(4.0, 1.75, 0, 1);       // aisle too narrow to turn in
  const r = await evacuate(world, cars, OPTS);
  assert.equal(r.stuck.length, 1);
  assert.equal(r.diag[car.id]?.kind, "geometry");
});

/* ---------------------------------------------------------------- blocked - */
/* Two neighbouring bays, same side and same heading, narrow aisle: alone, each
   car gets out by swinging wide; together, each one's arc invades the
   neighbour's bay and neither has a valid first move with the other present ->
   neither gets out, and both are blocked by the other rather than by an
   absolute lack of room (which is exactly what tells "blocked" from
   "geometry"). */
test("diagnosis: blocked (they block each other, neither for lack of room)", async () => {
  const world = newWorldM(8, 9.5);
  fillRectM(world, 0, 0, 8, 9.5, ASPH);
  fillRectM(world, 0, 4.0, 0.5, 5.0, EXIT);
  const cars = makeCars();
  const a = cars.addM(2.5, 2.5, 90, 1);
  const b = cars.addM(4.4, 2.5, 90, 1);

  const r = await evacuate(world, cars, OPTS);
  assert.equal(r.out.length, 0, "neither should get out together");
  assert.equal(r.stuck.length, 2);
  assert.equal(r.diag[a.id]?.kind, "blocked");
  assert.equal(r.diag[b.id]?.kind, "blocked");
});

/* ----------------------------------------------------------------- budget - */
/* A large open room (32 x 20 m) connected to a small exit by a corridor one
   cell wide: no car ever fits through (geometrically impossible), but the grid
   heuristic (which knows nothing about the size of the car) sees it as
   connected and gives a finite distance. The Hybrid A* explores the whole room
   before giving up and exhausts the MAX_EXPAND ceiling instead of concluding
   "noroute" straight away.
   The room size that triggers this is sensitive (found empirically: 30x18 does
   not get there, 32x20 does) — it is not a clean threshold, it is the size
   from which the grid heuristic misleads the search enough.
   It is the only test in this file that takes more than a few milliseconds. */
test("diagnosis: budget (the search budget runs out)", async () => {
  const world = newWorldM(32, 20);
  fillRectM(world, 1.0, 1.0, 31.0, 19.0, ASPH);
  fillRectM(world, 0, 10.0, 1.0, 10.5, ASPH);   // corridor one cell wide
  fillRectM(world, 0, 10.0, 0.5, 10.5, EXIT);
  const cars = makeCars();
  const car = cars.addM(16.0, 10.0, 0, 1);

  const r = await evacuate(world, cars, OPTS);
  assert.equal(r.stuck.length, 1);
  assert.equal(r.diag[car.id]?.kind, "budget");
});
