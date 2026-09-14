/* Evacuacio per rondes i els 5 diagnostics de "sense sortida":
   blocked, embedded, tight, geometry, budget.

   Cada escenari s'ha buscat empiricament (vegeu el comentari de cada test) i
   despres s'ha comprovat que dona el diagnostic esperat de manera fiable, no
   nomes un cop. Cap escenari fa servir mes d'un parell de cotxes ni una planta
   gran, per mantenir el conjunt de tests per sota dels 5 segons. */

import test from "node:test";
import assert from "node:assert/strict";
import { newWorld, fillRect, makeCars, ASPH, EXIT, presets } from "../src/scene.js";
import { mkSeg } from "../src/geometry.js";
import { evacuate, freeAt, obstaclesFor, rearAxle } from "../src/planner.js";
import { specOf } from "../src/vehicle.js";

const OPTS = { margin: 0.15, maxMan: 14, allowRev: true };

/* --------------------------------------------------------------- rondes --- */
/* "tandem" (vegeu scene.js) te un cotxe tapat pels altres: surt a la ronda 2,
   no a la 1 — confirmat contra la linia base a presets.test.js. */
test("evacuacio per rondes: un cotxe tapat surt en una ronda posterior", async () => {
  const { world, cars } = presets.tandem();
  const r = await evacuate(world, cars, OPTS);
  assert.equal(r.out.length, cars.length, "tots haurien de sortir");
  assert.equal(r.stuck.length, 0);
  assert.ok(r.out.some((o) => o.round > 1), "algun cotxe hauria de sortir despres de la ronda 1");
});

/* ------------------------------------------------------------- embedded --- */
/* Cotxe col·locat amb el centre sobre una cel·la de mur: ni amb marge 0 hi cap. */
test("diagnostic: embedded (col·locat sobre un mur)", async () => {
  const world = newWorld(20, 20);
  fillRect(world, 0, 0, 19, 19, ASPH);
  fillRect(world, 5, 5, 7, 7, 0);           // VOID = mur, enmig de la calçada
  fillRect(world, 0, 0, 1, 1, EXIT);
  const cars = makeCars();
  const car = cars.addCell(6, 6, 0, 1);      // centre just sobre el mur
  const r = await evacuate(world, cars, OPTS);
  assert.equal(r.stuck.length, 1);
  assert.equal(r.diag[car.id]?.kind, "embedded");
});

/* ----------------------------------------------------------------- tight --- */
/* Parets exactes (segments, no graella) separades per un buit calculat: amb
   marge 0 el cotxe just hi cap; amb el marge configurat (0.15) ja no. */
test("diagnostic: tight (hi cap just amb marge 0, no amb 0.15)", async () => {
  const world = newWorld(20, 10);
  fillRect(world, 0, 0, 19, 9, ASPH);
  fillRect(world, 0, 0, 1, 1, EXIT);
  const cars = makeCars();
  const car = cars.addCell(10, 5, 0, 1);     // Compacte: W=1.79 -> hw=0.895
  const hw = specOf(car).W / 2;
  const gap = 0.08;                          // < 0.15 (marge) i > 0
  world.segs = [
    mkSeg(0, car.cy - hw - gap, 20, car.cy - hw - gap),
    mkSeg(0, car.cy + hw + gap, 20, car.cy + hw + gap),
  ];
  // comprovacio directa de freeAt als dos marges, abans de confiar en evacuate()
  const v = specOf(car), obs = obstaclesFor(world, cars, -1, []);
  const st = rearAxle(car, v);
  assert.equal(freeAt(world, obs, st.x, st.y, st.th, v, 0), true, "amb marge 0 hi hauria de cabre");
  assert.equal(freeAt(world, obs, st.x, st.y, st.th, v, 0.15), false, "amb marge 0.15 no hi hauria de cabre");

  const r = await evacuate(world, cars, OPTS);
  assert.equal(r.stuck.length, 1);
  assert.equal(r.diag[car.id]?.kind, "tight");
});

/* -------------------------------------------------------------- geometry --- */
/* Sol al recinte, sense prou espai per maniobrar cap a la sortida: ni girant
   ni fent marxa enrere hi arriba. No es "start" (hi cap on es) ni "budget"
   (l'espai explorable es petit, s'exhaureix abans del sostre). */
test("diagnostic: geometry (sense espai per maniobrar, ni tot sol)", async () => {
  const world = newWorld(10, 6);
  fillRect(world, 0, 0, 9, 5, ASPH);
  fillRect(world, 0, 0, 0, 0, EXIT);
  const cars = makeCars();
  const car = cars.addCell(7, 2.5, 0, 1);
  const r = await evacuate(world, cars, OPTS);
  assert.equal(r.stuck.length, 1);
  assert.equal(r.diag[car.id]?.kind, "geometry");
});

/* ---------------------------------------------------------------- blocked - */
/* Dues places veines, mateix costat i sentit, passadis de nomes 3 m: sol,
   cada cotxe surt fent l'arc ample de sortida; junts, aquest arc de cada un
   envaeix la plaça del vei i cap dels dos te un moviment inicial vàlid amb
   l'altre present -> la ronda 1 no en treu cap i tots dos queden bloquejats
   per l'altre, no per manca absoluta d'espai (que es exactament el que
   distingeix "blocked" de "geometry"). */
test("diagnostic: blocked (es tapen l'un a l'altre, cap dels dos per manca d'espai)", async () => {
  const cols = 16, rows = Math.round(5 / 0.5) + Math.round(3.0 / 0.5) + 3;
  const world = newWorld(cols, rows);
  fillRect(world, 0, 0, cols - 1, rows - 1, ASPH);
  fillRect(world, 0, Math.floor(rows / 2) - 1, 0, Math.floor(rows / 2), EXIT);
  const cars = makeCars();
  const sdRows = Math.round(5 / 0.5);
  const a = cars.addCell(5, sdRows / 2, 90, 1);
  const b = cars.addCell(5 + 3.5 + 0.3, sdRows / 2, 90, 1);

  const r = await evacuate(world, cars, OPTS);
  assert.equal(r.out.length, 0, "cap dels dos hauria de sortir junts");
  assert.equal(r.stuck.length, 2);
  assert.equal(r.diag[a.id]?.kind, "blocked");
  assert.equal(r.diag[b.id]?.kind, "blocked");
});

/* ----------------------------------------------------------------- budget - */
/* Sala gran oberta (30 x 18 m) connectada a una sortida petita per un
   corredor d'una sola cel·la de 0,5 m: cap cotxe hi cap mai (geometricament
   impossible), pero l'heuristica de graella (que no coneix la mida del
   cotxe) el veu connex i dona una distancia finita. El Hybrid A* explora la
   sala sencera abans de rendir-se i esgota el sostre de MAX_EXPAND en comptes
   de concloure "noroute" de seguida.
   Mesurat sobre aquest codi: ~260 000 expansions, ~0,5-1 s. Es l'unic test
   d'aquest fitxer que triga mes d'uns pocs mil·lisegons. */
test("diagnostic: budget (s'exhaureix el pressupost de cerca)", async () => {
  const cols = 60, rows = 36;
  const world = newWorld(cols, rows);
  fillRect(world, 2, 2, cols - 3, rows - 3, ASPH);
  fillRect(world, 0, Math.floor(rows / 2), 1, Math.floor(rows / 2), ASPH); // corredor d'1 cel·la
  fillRect(world, 0, Math.floor(rows / 2), 0, Math.floor(rows / 2), EXIT);
  const cars = makeCars();
  const car = cars.addCell(cols / 2, rows / 2, 0, 1);

  const r = await evacuate(world, cars, OPTS);
  assert.equal(r.stuck.length, 1);
  assert.equal(r.diag[car.id]?.kind, "budget");
});
