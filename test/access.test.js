/* Entrada, sortida i "entrada i sortida", sempre en el pitjor cas: tots els
   cotxes aparcats, cadascun a la seva plaça (mai se suposa que algun ja ha
   sortit, ni que encara no ha arribat) — vegeu planner.js: checkDirection(),
   evacuate(), arrive(), checkBothWays(). */

import test from "node:test";
import assert from "node:assert/strict";
import { newWorldM, fillRectM, makeCars, hasEntrance, ASPH, EXIT, ENTRANCE } from "../src/scene.js";
import { evacuate, arrive, checkBothWays, reversePath, rearAxle } from "../src/planner.js";
import { specOf } from "../src/vehicle.js";

const OPTS = { margin: 0.15, maxMan: 14, allowRev: true };

/* -------------------------------------------------------------- reversePath */
test("reversePath: gira l'ordre i inverteix la marxa de cada tram", () => {
  const path = [
    { x: 0, y: 0, th: 0, dir: 0 },   // inici
    { x: 1, y: 0, th: 0, dir: 1 },   // endavant
    { x: 1, y: 0, th: 0.3, dir: 1 }, // endavant, girant
    { x: 0.5, y: 0, th: 0.1, dir: -1 }, // enrere
  ];
  const rev = reversePath(path);
  assert.equal(rev.length, path.length);
  // el principi del recorregut girat es el final de l'original, i viceversa
  assert.deepEqual([rev[0].x, rev[0].y, rev[0].th], [0.5, 0, 0.1]);
  assert.equal(rev[0].dir, 0, "el primer punt d'un recorregut no porta marxa");
  assert.deepEqual([rev[3].x, rev[3].y, rev[3].th], [0, 0, 0]);
  // cada marxa queda invertida respecte de l'original
  assert.deepEqual(rev.map((p) => p.dir), [0, 1, -1, -1]);
});

test("reversePath: recorrer-lo dues vegades torna al recorregut original", () => {
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

test("arrive(): el recorregut girat acaba EXACTAMENT a la plaça aparcada", async () => {
  const world = entranceWorld();
  const cars = makeCars();
  const car = cars.addM(6, 3, 0, 1);
  const r = await arrive(world, cars, OPTS);
  const o = r.out.find((x) => x.id === car.id);
  assert.ok(o, "hauria de trobar com entrar-hi");
  const last = o.path[o.path.length - 1];
  const st = rearAxle(car, specOf(car));
  assert.ok(Math.abs(last.x - st.x) < 1e-9 && Math.abs(last.y - st.y) < 1e-9 && Math.abs(last.th - st.th) < 1e-9,
    "l'ultim punt del recorregut d'entrada ha de ser la posicio aparcada exacta");
});

test("arrive(): sense cap ENTRANCE dibuixada, cap cotxe hi pot entrar", async () => {
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
/* Escenari asimetric trobat empiricament: cotxe A hi pot entrar pero un
   veí (B) li tapa nomes el cami de sortida; B, al reves, surt sense
   problema pero no troba com tornar-hi a entrar. Prova que checkBothWays()
   combina be els dos sentits per separat — no n'hi ha prou amb "ok" en un
   dels dos. */
test("checkBothWays(): un cotxe pot entrar-hi pero no sortir-ne, i cap dels dos compta com a accessible", async () => {
  /* Passadis amb MURS de veritat a dalt i a baix. Abans era tot calçada i
     la vora del mon feia de paret imaginaria: com que el cos del cotxe si
     que pot sobresortir del dibuix (fora hi ha "el carrer", vegeu freeAt),
     A podia esquivar B per fora i la asimetria que aquest test vol provar
     desapareixia tan bon punt el cercador va millorar. Amb parets, B tapa
     el pas de debo. */
  const world = newWorldM(14, 7);
  fillRectM(world, 0, 0, 14, 7, 0);              // VOID: tot mur
  fillRectM(world, 0, 0.5, 14, 6.5, ASPH);       // passadis de 6 m
  fillRectM(world, 0, 2.5, 1, 4.5, ENTRANCE);
  fillRectM(world, 13, 2.5, 14, 4.5, EXIT);
  const cars = makeCars();
  const a = cars.addM(6, 3.5, 0, 1);
  const b = cars.addM(9.6, 3.5, 90, 1);          // travessat, tapa el pas cap a la sortida

  const [ex, en] = await Promise.all([evacuate(world, cars, OPTS), arrive(world, cars, OPTS)]);
  assert.equal(ex.out.some((o) => o.id === a.id), false, "A: sortida hauria de fallar (B li tapa el pas)");
  assert.equal(en.out.some((o) => o.id === a.id), true, "A: entrada hauria d'anar be");

  const both = await checkBothWays(world, cars, OPTS);
  assert.equal(both.out.length, 0, "cap dels dos hauria de comptar com a accessible en tots dos sentits");
  assert.deepEqual(new Set(both.stuck), new Set([a.id, b.id]));
  assert.equal(both.diag[a.id].entry, "ok");
  assert.notEqual(both.diag[a.id].exit, "ok");
  assert.equal(both.diag[b.id].exit, "ok");
  assert.notEqual(both.diag[b.id].entry, "ok");
});

test("checkBothWays(): un cotxe amb entrada i sortida amples surt a 'out' amb les dues rutes", async () => {
  const world = entranceWorld();
  const cars = makeCars();
  const car = cars.addM(6, 3, 0, 1);
  const r = await checkBothWays(world, cars, OPTS);
  assert.equal(r.out.length, 1);
  assert.ok(r.out[0].exit.path.length > 0);
  assert.ok(r.out[0].entry.path.length > 0);
});
