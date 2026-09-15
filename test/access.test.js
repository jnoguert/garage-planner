/* Entry, exit and "both ways", always the worst case: every car parked, each
   one in its own bay (it is never assumed that one has already left, or that
   one has not arrived yet) — see planner.js: checkDirection(), evacuate(),
   arrive(), checkBothWays(). */

import test from "node:test";
import assert from "node:assert/strict";
import { newWorldM, fillRectM, makeCars, hasEntrance, ASPH, EXIT, ENTRANCE } from "../src/scene.js";
import { evacuate, arrive, checkBothWays, reversePath, rearAxle } from "../src/planner.js";
import { specOf } from "../src/vehicle.js";

const OPTS = { margin: 0.15, maxMan: 14, allowRev: true };

/* -------------------------------------------------------------- reversePath */
test("reversePath: flips the order and inverts the gear of each run", () => {
  const path = [
    { x: 0, y: 0, th: 0, dir: 0 },   // start
    { x: 1, y: 0, th: 0, dir: 1 },   // forward
    { x: 1, y: 0, th: 0.3, dir: 1 }, // forward, turning
    { x: 0.5, y: 0, th: 0.1, dir: -1 }, // reverse
  ];
  const rev = reversePath(path);
  assert.equal(rev.length, path.length);
  // the start of the reversed route is the end of the original, and vice versa
  assert.deepEqual([rev[0].x, rev[0].y, rev[0].th], [0.5, 0, 0.1]);
  assert.equal(rev[0].dir, 0, "the first point of a route carries no gear");
  assert.deepEqual([rev[3].x, rev[3].y, rev[3].th], [0, 0, 0]);
  // every gear is inverted with respect to the original
  assert.deepEqual(rev.map((p) => p.dir), [0, 1, -1, -1]);
});

test("reversePath: applying it twice returns the original route", () => {
  const path = [
    { x: 0, y: 0, th: 0, dir: 0 },
    { x: 2, y: 1, th: 0.5, dir: 1 },
    { x: 1, y: 2, th: -0.2, dir: -1 },
  ];
  const roundTrip = reversePath(reversePath(path));
  assert.deepEqual(roundTrip, path);
});

/* ----------------------------------------------------------------- arrive - */
function entranceWorld() {
  const world = newWorldM(10, 6);
  fillRectM(world, 0, 0, 10, 6, ASPH);
  fillRectM(world, 0, 2, 1, 4, ENTRANCE);
  fillRectM(world, 9, 2, 10, 4, EXIT);
  return world;
}

test("arrive(): the reversed route ends EXACTLY at the parked bay", async () => {
  const world = entranceWorld();
  const cars = makeCars();
  const car = cars.addM(6, 3, 0, 1);
  const r = await arrive(world, cars, OPTS);
  const o = r.out.find((x) => x.id === car.id);
  assert.ok(o, "it should find a way in");
  const last = o.path[o.path.length - 1];
  const st = rearAxle(car, specOf(car));
  assert.ok(Math.abs(last.x - st.x) < 1e-9 && Math.abs(last.y - st.y) < 1e-9 && Math.abs(last.th - st.th) < 1e-9,
    "the last point of the arrival route has to be the exact parked position");
});

test("arrive(): with no ENTRANCE drawn, no car can get in", async () => {
  const world = newWorldM(10, 6);
  fillRectM(world, 0, 0, 10, 6, ASPH);
  fillRectM(world, 9, 2, 10, 4, EXIT);
  assert.equal(hasEntrance(world), false);
  const cars = makeCars();
  cars.addM(6, 3, 0, 1);
  const r = await arrive(world, cars, OPTS);
  assert.equal(r.out.length, 0);
});

/* ------------------------------------------------------------ checkBothWays */
/* An asymmetric scenario found empirically: car A can get in but a neighbour
   (B) blocks only its way out; B, the other way round, gets out without
   trouble but cannot find a way back in. It proves that checkBothWays()
   combines the two directions separately — "ok" in one of them is not
   enough. */
test("checkBothWays(): a car can get in but not out, and neither counts as accessible", async () => {
  /* An aisle with real WALLS above and below. It used to be all roadway, with
     the edge of the world acting as an imaginary wall: since the car's body
     may stick out of the drawing (outside is "the street", see freeAt), A
     could dodge B round the outside and the asymmetry this test is after
     disappeared as soon as the search improved. With walls, B really does
     block the way. */
  const world = newWorldM(14, 7);
  fillRectM(world, 0, 0, 14, 7, 0);              // VOID: all wall
  fillRectM(world, 0, 0.5, 14, 6.5, ASPH);       // 6 m aisle
  fillRectM(world, 0, 2.5, 1, 4.5, ENTRANCE);
  fillRectM(world, 13, 2.5, 14, 4.5, EXIT);
  const cars = makeCars();
  const a = cars.addM(6, 3.5, 0, 1);
  const b = cars.addM(9.6, 3.5, 90, 1);          // across the aisle, blocking the way to the exit

  const [ex, en] = await Promise.all([evacuate(world, cars, OPTS), arrive(world, cars, OPTS)]);
  assert.equal(ex.out.some((o) => o.id === a.id), false, "A: the exit should fail (B is in the way)");
  assert.equal(en.out.some((o) => o.id === a.id), true, "A: the entry should be fine");

  const both = await checkBothWays(world, cars, OPTS);
  assert.equal(both.out.length, 0, "neither should count as accessible in both directions");
  assert.deepEqual(new Set(both.stuck), new Set([a.id, b.id]));
  assert.equal(both.diag[a.id].entry, "ok");
  assert.notEqual(both.diag[a.id].exit, "ok");
  assert.equal(both.diag[b.id].exit, "ok");
  assert.notEqual(both.diag[b.id].entry, "ok");
});

test("checkBothWays(): a car with a wide entrance and exit lands in 'out' with both routes", async () => {
  const world = entranceWorld();
  const cars = makeCars();
  const car = cars.addM(6, 3, 0, 1);
  const r = await checkBothWays(world, cars, OPTS);
  assert.equal(r.out.length, 1);
  assert.ok(r.out[0].exit.path.length > 0);
  assert.ok(r.out[0].entry.path.length > 0);
});
