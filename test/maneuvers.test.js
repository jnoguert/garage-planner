import test from "node:test";
import assert from "node:assert/strict";
import { summariseManeuvers, evacuate } from "../src/planner.js";
import { presets } from "../src/scene.js";

test("summariseManeuvers: a straight route, a single gear", () => {
  const path = [
    { x: 0, y: 0, th: 0, dir: 0 },
    { x: 1, y: 0, th: 0, dir: 1 },
    { x: 2, y: 0, th: 0, dir: 1 },
    { x: 3, y: 0, th: 0, dir: 1 },
  ];
  const steps = summariseManeuvers(path);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].dir, "forward");
  assert.equal(steps[0].turn, "straight");
  assert.ok(Math.abs(steps[0].distance - 3) < 1e-9);
});

test("summariseManeuvers: a gear change gives two runs", () => {
  const path = [
    { x: 0, y: 0, th: 0, dir: 0 },
    { x: 2, y: 0, th: 0, dir: 1 },
    { x: 1, y: 0, th: 0, dir: -1 },
    { x: 0, y: 0, th: 0, dir: -1 },
  ];
  const steps = summariseManeuvers(path);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].dir, "forward");
  assert.ok(Math.abs(steps[0].distance - 2) < 1e-9);
  assert.equal(steps[1].dir, "reverse");
  assert.ok(Math.abs(steps[1].distance - 2) < 1e-9);
});

test("summariseManeuvers: turning right and turning left are told apart", () => {
  // dth>0 = turns right (see the derivation in the plan()/spec comments): with
  // an initial heading of +x and an increasing angle, the car curves towards
  // +y (down the screen) — the driver's right when facing +x.
  const right = [
    { x: 0, y: 0, th: 0, dir: 1 },
    { x: 1, y: 0.1, th: 0.3, dir: 1 },
  ];
  const left = [
    { x: 0, y: 0, th: 0, dir: 1 },
    { x: 1, y: -0.1, th: -0.3, dir: 1 },
  ];
  assert.equal(summariseManeuvers(right)[0].turn, "right");
  assert.equal(summariseManeuvers(left)[0].turn, "left");
});

test("summariseManeuvers: a short run that barely moves is dropped", () => {
  const path = [
    { x: 0, y: 0, th: 0, dir: 0 },
    { x: 1e-9, y: 0, th: 0, dir: 1 },
    { x: 3, y: 0, th: 0, dir: -1 },
  ];
  const steps = summariseManeuvers(path);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].dir, "reverse");
});

/* The number of runs minus 1 has to match `man`, the gear-change counter
   evacuate() already reports — checked against a real route, not only against
   hand-made examples. */
test("summariseManeuvers: runs-1 matches the 'man' of a real route", async () => {
  const { world, cars } = presets.garage3();
  const r = await evacuate(world, cars, { margin: 0.15, maxMan: 14, allowRev: true });
  assert.ok(r.out.length > 0, "the preset should get some car out");
  for (const o of r.out) {
    const steps = summariseManeuvers(o.path);
    assert.equal(steps.length - 1, o.man, `car ${o.id}: ${steps.length - 1} runs-1 vs man=${o.man}`);
  }
});
