/* Evacuacio per rondes i els 5 diagnostics de "sense sortida":
   blocked, embedded, tight, geometry, budget.

   Cada escenari s'ha buscat empiricament (vegeu el comentari de cada test) i
   despres s'ha comprovat que dona el diagnostic esperat de manera fiable, no
   nomes un cop. Cap escenari fa servir mes d'un parell de cotxes ni una planta
   gran, per mantenir el conjunt de tests per sota dels 5 segons. */

import test from "node:test";
import assert from "node:assert/strict";
import { newWorldM, fillRectM, makeCars, ASPH, EXIT, presets } from "../src/scene.js";
import { mkSeg } from "../src/geometry.js";
import { evacuate, freeAt, obstaclesFor, rearAxle } from "../src/planner.js";
import { specOf } from "../src/vehicle.js";

const OPTS = { margin: 0.15, maxMan: 14, allowRev: true };

/* -------------------------------------------------- comprovacio independent */
/* "tandem" (vegeu scene.js): quatre places al fons (ids 1-4) i dos cotxes
   aparcats al davant (ids 5,6), just al camí dels del mig (2 i 3) — no dels
   de les puntes (1 i 4, que hi tenen via lliure de costat). evacuate() no
   suposa mai que 5 o 6 ja han marxat: amb tots aparcats on son, 2 i 3
   queden "blocked" (hi cabrien sols, pero els tapen 5/6), mentre que 1, 4,
   5 i 6 surten igualment. Cap cotxe "surt" nomes perque un altre s'hagi
   tret abans del mig. */
test("evacuacio: cada cotxe es comprova amb tots els altres aparcats, no en suposa cap fora", async () => {
  for (const name of ["tandem", "bateria", "estret"]) {
    const { world, cars } = presets[name]();
    const r = await evacuate(world, cars, OPTS);
    assert.ok(r.out.length > 0, `${name}: algun cotxe hauria de sortir`);

    /* La propietat, mesurada de nou des de FORA del cercador: cada pose de
       cada recorregut ha de ser lliure amb TOTS els altres cotxes aparcats
       on son. Si algun recorregut nomes fos valid suposant que un altre
       cotxe ja ha marxat, aqui sortiria.

       Abans aixo s'escrivia com "els cotxes 2 i 3 del tandem han de quedar
       blocked": una llista d'indexs que deixava de voler dir res tan bon
       punt el cercador millorava (amb NTH=72 el tandem passa de 4/6 a 6/6,
       i els recorreguts nous son valids — comprovat aqui mateix). La
       propietat no depen de com de bo sigui el cercador; la llista, si. */
    for (const o of r.out) {
      const car = cars.find((c) => c.id === o.id), v = specOf(car);
      const others = cars.map((c) => c.id).filter((id) => id !== o.id);
      const obs = obstaclesFor(world, cars, o.id, others);
      for (const p of o.path) {
        assert.ok(freeAt(world, obs, p.x, p.y, p.th, v, OPTS.margin),
          `${name}: el cotxe ${o.id} passa per (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) i alli hi ha algu`);
      }
    }
  }
});

/* ------------------------------------------------------------- embedded --- */
/* Cotxe col·locat amb el centre sobre un mur: ni amb marge 0 hi cap.
   Tot en metres (newWorldM/fillRectM/addM), no en cel·les: aixi l'escenari
   no depen de CELL i sobreviu a un canvi de resolucio de la graella. */
test("diagnostic: embedded (col·locat sobre un mur)", async () => {
  const world = newWorldM(10, 10);
  fillRectM(world, 0, 0, 10, 10, ASPH);
  fillRectM(world, 2.5, 2.5, 4.0, 4.0, 0);   // VOID = mur, enmig de la calçada
  fillRectM(world, 0, 0, 1.0, 1.0, EXIT);
  const cars = makeCars();
  const car = cars.addM(3.0, 3.0, 0, 1);     // centre just sobre el mur
  const r = await evacuate(world, cars, OPTS);
  assert.equal(r.stuck.length, 1);
  assert.equal(r.diag[car.id]?.kind, "embedded");
});

/* ----------------------------------------------------------------- tight --- */
/* Parets exactes (segments, no graella) separades per un buit calculat: amb
   marge 0 el cotxe just hi cap; amb el marge configurat (0.15) ja no. */
test("diagnostic: tight (hi cap just amb marge 0, no amb 0.15)", async () => {
  const world = newWorldM(10, 5);
  fillRectM(world, 0, 0, 10, 5, ASPH);
  fillRectM(world, 0, 0, 1.0, 1.0, EXIT);
  const cars = makeCars();
  const car = cars.addM(5.0, 2.5, 0, 1);     // Compacte: W=1.79 -> hw=0.895
  const hw = specOf(car).W / 2;
  const gap = 0.08;                          // < 0.15 (marge) i > 0
  world.segs = [
    mkSeg(0, car.cy - hw - gap, 10, car.cy - hw - gap),
    mkSeg(0, car.cy + hw + gap, 10, car.cy + hw + gap),
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
   (l'espai explorable es petit, s'exhaureix abans del sostre).

   El recinte ha de tenir MURS de veritat (VOID) al voltant, no nomes acabar-
   se. Fora del dibuix hi ha "el carrer" i el cos del cotxe hi pot sobresortir
   a proposit (vegeu freeAt) — nomes el centre ha de quedar dins. Aquest test
   omplia tot el mon d'ASPH i es pensava que la vora feia de paret: el cotxe
   podia treure el morro fora i arribar a la sortida de la cantonada per un
   camí legal que la cerca d'abans, mes gruixuda, no trobava. Amb NTH=72 si
   que el troba, i el test "fallava" ensenyant que la planta no era la que
   volia provar. */
test("diagnostic: geometry (sense espai per maniobrar, ni tot sol)", async () => {
  const world = newWorldM(7, 4);
  fillRectM(world, 0.5, 0.5, 6.5, 3.0, ASPH);   // murs (VOID) tot al voltant
  fillRectM(world, 0.5, 0.5, 1.1, 1.1, EXIT);   // sortida arraconada a dalt
  const cars = makeCars();
  const car = cars.addM(4.0, 1.75, 0, 1);       // passadis massa estret per girar
  const r = await evacuate(world, cars, OPTS);
  assert.equal(r.stuck.length, 1);
  assert.equal(r.diag[car.id]?.kind, "geometry");
});

/* ---------------------------------------------------------------- blocked - */
/* Dues places veines, mateix costat i sentit, passadis estret: sol, cada
   cotxe surt fent l'arc ample de sortida; junts, aquest arc de cada un
   envaeix la plaça del vei i cap dels dos te un moviment inicial vàlid amb
   l'altre present -> la ronda 1 no en treu cap i tots dos queden bloquejats
   per l'altre, no per manca absoluta d'espai (que es exactament el que
   distingeix "blocked" de "geometry"). */
test("diagnostic: blocked (es tapen l'un a l'altre, cap dels dos per manca d'espai)", async () => {
  const world = newWorldM(8, 9.5);
  fillRectM(world, 0, 0, 8, 9.5, ASPH);
  fillRectM(world, 0, 4.0, 0.5, 5.0, EXIT);
  const cars = makeCars();
  const a = cars.addM(2.5, 2.5, 90, 1);
  const b = cars.addM(4.4, 2.5, 90, 1);

  const r = await evacuate(world, cars, OPTS);
  assert.equal(r.out.length, 0, "cap dels dos hauria de sortir junts");
  assert.equal(r.stuck.length, 2);
  assert.equal(r.diag[a.id]?.kind, "blocked");
  assert.equal(r.diag[b.id]?.kind, "blocked");
});

/* ----------------------------------------------------------------- budget - */
/* Sala gran oberta (32 x 20 m) connectada a una sortida petita per un
   corredor d'una sola cel·la ample: cap cotxe hi cap mai (geometricament
   impossible), pero l'heuristica de graella (que no coneix la mida del
   cotxe) el veu connex i dona una distancia finita. El Hybrid A* explora la
   sala sencera abans de rendir-se i esgota el sostre de MAX_EXPAND en comptes
   de concloure "noroute" de seguida.
   La mida de sala que ho dispara es sensible (provat empiricament: 30x18 no
   hi arriba, 32x20 si) — no es un llindar net, es la mida a partir de la
   qual l'heuristica de graella enganya prou el cercador.
   Es l'unic test d'aquest fitxer que triga mes d'uns pocs mil·lisegons. */
test("diagnostic: budget (s'exhaureix el pressupost de cerca)", async () => {
  const world = newWorldM(32, 20);
  fillRectM(world, 1.0, 1.0, 31.0, 19.0, ASPH);
  fillRectM(world, 0, 10.0, 1.0, 10.5, ASPH);   // corredor d'una sola cel·la
  fillRectM(world, 0, 10.0, 0.5, 10.5, EXIT);
  const cars = makeCars();
  const car = cars.addM(16.0, 10.0, 0, 1);

  const r = await evacuate(world, cars, OPTS);
  assert.equal(r.stuck.length, 1);
  assert.equal(r.diag[car.id]?.kind, "budget");
});
