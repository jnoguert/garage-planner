/* An entrance (ENTRANCE) is like a hole in a wall: drivable, but a car going
   through it may not touch the jambs (the VOID cells flanking it) nor any
   other car parked in the hole itself — exactly the same rules as any other
   tight spot. No new planner code was needed for this (freeAt() already treats
   ENTRANCE as "not VOID", like ASPH/SPOT/EXIT): these tests leave it proven,
   not assumed. */

import test from "node:test";
import assert from "node:assert/strict";
import { newWorldM, fillRectM, makeCars, ASPH, EXIT, ENTRANCE } from "../src/scene.js";
import { evacuate } from "../src/planner.js";

const OPTS = { margin: 0.15, maxMan: 14, allowRev: true };

function doorwayWorld(gapM) {
  const world = newWorldM(12, 10);
  fillRectM(world, 0, 0, 12, 10, ASPH);
  fillRectM(world, 0, 0, 1.0, 1.0, EXIT);
  fillRectM(world, 0, 4.9, 12, 5.1, 0);          // horizontal wall, y=5
  fillRectM(world, 6 - gapM / 2, 4.9, 6 + gapM / 2, 5.1, ENTRANCE);
  return world;
}

test("entrance: too narrow a hole blocks the car (it touches the jambs)", async () => {
  const world = doorwayWorld(1.8);              // Compact W=1.79 + 2*margin=0.3 => needs 2.09 m
  const cars = makeCars();
  const car = cars.addM(6, 8, 270, 1);
  const r = await evacuate(world, cars, OPTS);
  assert.equal(r.out.length, 0, "the hole is narrower than the car plus margin, it should not get out");
});

test("entrance: wide enough, the car goes through cleanly", async () => {
  const world = doorwayWorld(2.5);
  const cars = makeCars();
  const car = cars.addM(6, 8, 270, 1);
  const r = await evacuate(world, cars, OPTS);
  assert.equal(r.out.length, 1, "with margin to spare, it should get out");
});

test("entrance: a car parked in the hole blocks the one on its way out", async () => {
  const world = doorwayWorld(3.0);               // the hole on its own is ample
  const cars = makeCars();
  const a = cars.addM(6, 8, 270, 1);              // has to cross the hole
  cars.addM(6, 5.0, 0, 1);                        // but another car is stopped inside it
  const r = await evacuate(world, cars, OPTS);
  assert.equal(r.out.length, 0, "the car in the hole should block the way");
  assert.equal(r.diag[a.id]?.kind, "blocked");
});
