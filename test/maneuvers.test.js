import test from "node:test";
import assert from "node:assert/strict";
import { summariseManeuvers, evacuate } from "../src/planner.js";
import { presets } from "../src/scene.js";

test("summariseManeuvers: recorregut recte, una sola marxa", () => {
  const path = [
    { x: 0, y: 0, th: 0, dir: 0 },
    { x: 1, y: 0, th: 0, dir: 1 },
    { x: 2, y: 0, th: 0, dir: 1 },
    { x: 3, y: 0, th: 0, dir: 1 },
  ];
  const steps = summariseManeuvers(path);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].dir, "endavant");
  assert.equal(steps[0].turn, "recte");
  assert.ok(Math.abs(steps[0].distance - 3) < 1e-9);
});

test("summariseManeuvers: canvi de marxa dona dos trams", () => {
  const path = [
    { x: 0, y: 0, th: 0, dir: 0 },
    { x: 2, y: 0, th: 0, dir: 1 },
    { x: 1, y: 0, th: 0, dir: -1 },
    { x: 0, y: 0, th: 0, dir: -1 },
  ];
  const steps = summariseManeuvers(path);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].dir, "endavant");
  assert.ok(Math.abs(steps[0].distance - 2) < 1e-9);
  assert.equal(steps[1].dir, "enrere");
  assert.ok(Math.abs(steps[1].distance - 2) < 1e-9);
});

test("summariseManeuvers: gir cap a la dreta i cap a l'esquerra es distingeixen", () => {
  // dth>0 = gira a la dreta (vegeu la derivacio al comentari de plan()/spec):
  // amb rumb inicial +x i angle creixent, el cotxe corba cap a +y (avall a
  // la pantalla) — la dreta de qui condueix mirant cap a +x.
  const dreta = [
    { x: 0, y: 0, th: 0, dir: 1 },
    { x: 1, y: 0.1, th: 0.3, dir: 1 },
  ];
  const esquerra = [
    { x: 0, y: 0, th: 0, dir: 1 },
    { x: 1, y: -0.1, th: -0.3, dir: 1 },
  ];
  assert.equal(summariseManeuvers(dreta)[0].turn, "dreta");
  assert.equal(summariseManeuvers(esquerra)[0].turn, "esquerra");
});

test("summariseManeuvers: un tram curt que quasi no es mou es descarta", () => {
  const path = [
    { x: 0, y: 0, th: 0, dir: 0 },
    { x: 1e-9, y: 0, th: 0, dir: 1 },
    { x: 3, y: 0, th: 0, dir: -1 },
  ];
  const steps = summariseManeuvers(path);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].dir, "enrere");
});

/* El nombre de trams menys 1 ha de coincidir amb `man`, el comptador de
   canvis de marxa que ja reporta evacuate() — comprovat contra un
   recorregut real, no nomes contra exemples fabricats a ma. */
test("summariseManeuvers: trams-1 coincideix amb el 'man' d'un recorregut real", async () => {
  const { world, cars } = presets.garatge3();
  const r = await evacuate(world, cars, { margin: 0.15, maxMan: 14, allowRev: true });
  assert.ok(r.out.length > 0, "el preset hauria de fer sortir algun cotxe");
  for (const o of r.out) {
    const steps = summariseManeuvers(o.path);
    assert.equal(steps.length - 1, o.man, `cotxe ${o.id}: ${steps.length - 1} trams-1 vs man=${o.man}`);
  }
});
