/* L'entrada (ENTRANCE) es com un forat en un mur: transitable, pero el
   cotxe que hi passa no pot tocar els brancals (els VOID que la flanquegen)
   ni cap altre cotxe aparcat al forat mateix — exactament les mateixes
   regles que qualsevol altre pas estret. No calia cap codi nou al
   planificador per a aixo (freeAt() ja tracta ENTRANCE com "no es VOID",
   igual que ASPH/SPOT/EXIT): aquests tests ho deixen provat, no assumit. */

import test from "node:test";
import assert from "node:assert/strict";
import { newWorldM, fillRectM, makeCars, ASPH, EXIT, ENTRANCE } from "../src/scene.js";
import { evacuate } from "../src/planner.js";

const OPTS = { margin: 0.15, maxMan: 14, allowRev: true };

function doorwayWorld(gapM) {
  const world = newWorldM(12, 10);
  fillRectM(world, 0, 0, 12, 10, ASPH);
  fillRectM(world, 0, 0, 1.0, 1.0, EXIT);
  fillRectM(world, 0, 4.9, 12, 5.1, 0);          // mur horitzontal, y=5
  fillRectM(world, 6 - gapM / 2, 4.9, 6 + gapM / 2, 5.1, ENTRANCE);
  return world;
}

test("entrada: un forat massa estret bloqueja el cotxe (toca els brancals)", async () => {
  const world = doorwayWorld(1.8);              // Compacte W=1.79 + 2*marge=0.3 => cal 2.09m
  const cars = makeCars();
  const car = cars.addM(6, 8, 270, 1);
  const r = await evacuate(world, cars, OPTS);
  assert.equal(r.out.length, 0, "el forat es mes estret que el cotxe amb marge, no hauria de sortir");
});

test("entrada: prou ampla, el cotxe hi passa net", async () => {
  const world = doorwayWorld(2.5);
  const cars = makeCars();
  const car = cars.addM(6, 8, 270, 1);
  const r = await evacuate(world, cars, OPTS);
  assert.equal(r.out.length, 1, "amb marge de sobres, hauria de sortir");
});

test("entrada: un cotxe aparcat al forat bloqueja el que en surt", async () => {
  const world = doorwayWorld(3.0);               // el forat sol es de sobres
  const cars = makeCars();
  const a = cars.addM(6, 8, 270, 1);              // ha de creuar el forat
  cars.addM(6, 5.0, 0, 1);                        // pero hi ha un altre cotxe parat dins
  const r = await evacuate(world, cars, OPTS);
  assert.equal(r.out.length, 0, "el cotxe del forat hauria de tapar el pas");
  assert.equal(r.diag[a.id]?.kind, "blocked");
});
