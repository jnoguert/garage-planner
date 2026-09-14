/* Els bugs que ja hem trobat, convertits en tests.

   Qualsevol canvi futur al planificador o a la col·lisio ha de passar per aqui
   abans de donar-se per bo. */

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
   El camp de distancies a la sortida i el closed set del Hybrid A* comparaven
   costos amb un epsilon minuscul sobre Float32Array. L'arrodoniment de float32
   (~1e-7 en aquestes magnituds) supera l'epsilon, de manera que la MATEIXA
   relaxacio es torna a acceptar cada vegada i la cua no es buida mai.

   Mesurat sobre aquest codi: amb Float64Array cada cel·la surt de la cua ~1,0
   cops. Amb Float32Array, 1389x el nombre de cel·les al preset "bateria" i
   2069x a "estret" sense acabar — no es que vagi lent, es que no acaba.

   Per aixo el test no fa servir el rellotge (seria inestable i, a mes, un
   penjament no es pot cronometrar): compta quantes vegades surt cada cel·la de
   la cua. Es determinista i falla a l'instant.                              */

for (const name of ["bateria", "estret", "tandem"]) {
  test(`bug 1: exitField("${name}") no reomple la cua`, () => {
    const { world } = presets[name]();
    const stats = {};
    const d = exitField(world, EXIT, stats);
    const N = world.cols * world.rows;

    assert.ok(d instanceof Float64Array,
      "exitField ha de fer servir Float64Array: amb Float32Array la cua no es buida mai");

    // Marge ample a proposit: el valor sa es ~1,0x i el malalt >1000x.
    assert.ok(stats.pops < 3 * N,
      `la cua s'ha reomplert: ${stats.pops} extraccions per a ${N} cel·les ` +
      `(${(stats.pops / N).toFixed(1)}x). El valor sa es ~1,0x. Algu hi ha posat Float32Array?`);
  });

  test(`bug 1: exitField("${name}") convergeix de debo`, () => {
    // El camp ha de ser un punt fix real de Dijkstra: cap aresta relaxable.
    // Amb float32 aquesta propietat es trenca molt abans que amb float64.
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
    assert.ok(worst < 1e-9, `arestes encara relaxables: ${worst.toExponential(2)} a ${on}`);
  });
}

/* El closed set de plan() tambe ha de ser Float64Array, pel mateix motiu. Aqui
   el float32 NO es manifesta com un penjament sino com a resultats PITJORS: al
   preset "tandem" en fa sortir menys dels que hi caben. Per tant el que el
   guarda es el resultat, no el comptador. */
test("bug 1: el closed set no degrada el resultat (tandem)", async () => {
  /* Amb el closed set en float32 l'arrodoniment supera l'epsilon de
     comparacio i la cerca es degrada: surten menys cotxes dels que poden.
     Aixo es el que vigila aquest test.

     Assercio: han de sortir-ne TOTS. Es el maxim possible, o sigui que no es
     una xifra que calgui anar retocant cada cop que el cercador millora
     (abans hi deia "4 dels 6" i va quedar obsoleta en pujar NTH a 72); en
     canvi qualsevol degradacio de la cerca la trenca de seguida. */
  const { world, cars } = presets.tandem();
  const r = await evacuate(world, cars, OPTS);
  assert.equal(r.out.length, cars.length, "tandem: tots els cotxes hi caben, no se n'ha de perdre cap per la cerca");
  assert.equal(r.stuck.length, 0);
});

/* ================================================================ BUG 2 ====
   Invariant: un marge de seguretat MES GRAN no pot facilitar mai la sortida.
   Es geometria pura — el cotxe engreixat cap a tot arreu on hi cabia el prim.
   Si el planificador diu "surt" amb marge m, ha de dir "surt" per a tot m' < m.

   Una violacio d'aixo es SEMPRE un bug del cercador (discretitzacio de l'espai
   (x, y, angle)), mai de la geometria.                                      */

const MARGES = [0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40];

/* Comprova la monotonia per a cada cotxe d'una planta, amb tots els altres
   cotxes presents. Retorna la llista de violacions trobades. */
function violacionsDeMonotonia(preset) {
  const { world, cars } = presets[preset]();
  const hf = exitField(world);
  const all = cars.map((c) => c.id);
  const found = [];
  for (const car of cars) {
    const obs = obstaclesFor(world, cars, car.id, all);
    const v = specOf(car);
    const seq = MARGES.map((m) => plan(world, car, obs, hf, v, { ...OPTS, margin: m }).ok);
    for (let i = 1; i < seq.length; i++) {
      if (seq[i] && !seq[i - 1]) {
        found.push(
          `${preset} cotxe ${cars.indexOf(car)} (${v.name}): ` +
          `marge ${MARGES[i - 1].toFixed(2)} = NO SURT pero ${MARGES[i].toFixed(2)} = SURT ` +
          `[${seq.map((b) => (b ? "1" : "0")).join("")}]`
        );
      }
    }
  }
  return found;
}

for (const name of ["garatge", "garatge3", "tandem"]) {
  test(`bug 2: un marge mes gran no facilita la sortida ("${name}")`, () => {
    const v = violacionsDeMonotonia(name);
    assert.deepEqual(v, [], `monotonia trencada:\n  ${v.join("\n  ")}`);
  });
}

/* ⚠ BUG OBERT, no una regressio.

   Els bins de 0,15 m i el pas de 36 a 72 sectors (10 -> 5 graus) han reduit
   molt aquest problema, pero NO l'han eliminat: el preset "estret" encara el
   dona. Amb 36 sectors hi havia 4 violacions i nomes en sortien 5 dels 16
   cotxes; amb 72 en surten 16 de 16 i queden 3 violacions, totes a marges
   grans (0,20 en amunt), alla on el passadis ja va tan just que un parell de
   centimetres decideixen:

     estret cotxe 3:  marge 0.20 no SURT / 0.25 SURT
     estret cotxe 6:  marge 0.30 no SURT / 0.35 SURT
     estret cotxe 12: marge 0.35 no SURT / 0.40 SURT

   Els fracassos son "noroute" amb ~1400 expansions, contra ~2800 quan te exit:
   la cua s'ha buidat d'hora. Amb el pressupost intacte i una ruta que existeix
   tant amb un marge mes petit com amb un de mes gran, nomes pot ser que el
   closed set descarti estats que calien — l'artefacte classic de discretitzacio
   del Hybrid A*, no la geometria.

   Queda marcat com a `todo` per no amagar-lo: surt a cada execucio dels tests i
   el dia que algu ho arregli, aquest test comencara a passar.                */
test("bug 2: monotonia a \"estret\" (BUG OBERT, encara falla)", { todo: "la resolucio mes fina ho va reduir pero no ho va eliminar; vegeu el comentari" }, () => {
  const v = violacionsDeMonotonia("estret");
  assert.deepEqual(v, [], `monotonia trencada:\n  ${v.join("\n  ")}`);
});

/* ================================================================ BUG 3 ====
   Una zona d'entrada/sortida mes prima que STEP (0,22 m) en la direccio
   d'avanc quedava "saltada per sobre": el cotxe hi passaria fisicament
   (cap col·lisio, cap paret), pero el pas discret ateria just abans i el
   seguent just despres, sense que cap dels dos caigues a dins de la zona
   objectiu — plan() acabava en "noroute" tot i que un recorregut recte i
   trivial existia.

   Reproduit amb una sala oberta i una franja EXIT de nomes 0,1-0,15 m de
   fondaria enmig del pas: fallava sempre abans del fix, ara hi arriba amb
   un nombre d'expansions estable (no varia amb la fondaria, senyal que ja
   no depen de si un aterratge "cau be" o no).

   Fix: subGoalPose() (planner.js) comprova, per a cada tram candidat, si
   l'ARC hi passa per sobre en algun dels 4 sub-punts — no nomes si
   l'aterratge final hi cau a dins — nomes quan l'heuristica ja diu que
   som a prop (hh < STEP*1,5), perque cridar-ho sempre multiplicava per 4
   el temps de cerca sencer sense guanyar res la immensa majoria de cops
   que no hi ha cap zona objectiu a prop. */
test("bug 3: una zona d'entrada/sortida mes prima que STEP no queda saltada", async () => {
  for (const depth of [0.1, 0.15, 0.2]) {
    const world = newWorldM(20, 10);
    fillRectM(world, 0, 0, 20, 10, ASPH);
    fillRectM(world, 10, 4, 10 + depth, 6, EXIT);   // franja prima enmig de l'obert
    const cars = makeCars();
    cars.addM(2.5, 5.0, 0, 1);
    const res = await evacuate(world, cars, OPTS);
    assert.equal(res.out.length, 1, `fondaria ${depth}m: hauria de trobar un recorregut recte i trivial`);
  }
});
