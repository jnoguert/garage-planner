/* Linia base de la migracio.

   baseline.json es va generar executant el motor del prototip original
   (legacy/legacy-engine.html, L217-576) amb Node, abans de tocar res. Aquest
   test exigeix que els moduls nous donin EXACTAMENT els mateixos numeros per
   als 6 presets: 49 cotxes, amb la ronda, les maniobres i la llargada del
   recorregut al centimetre.

   Si aquest test falla, la refactoritzacio ha canviat el comportament del
   motor, encara que "sembli" que va be a la pantalla. */

import test from "node:test";
import assert from "node:assert/strict";
import baseline from "./baseline.json" with { type: "json" };
import { presets } from "../src/scene.js";
import { evacuate } from "../src/planner.js";
import { specOf } from "../src/vehicle.js";

const OPTS = baseline._opts;

for (const name of Object.keys(baseline).filter((k) => !k.startsWith("_"))) {
  test(`preset "${name}" reprodueix el motor original`, async () => {
    const exp = baseline[name];
    const { world, cars } = presets[name]();

    assert.equal(world.cols, exp.cols, "amplada de la planta");
    assert.equal(world.rows, exp.rows, "fondaria de la planta");
    assert.equal(world.segs.length, exp.segs, "nombre de segments de paret");
    assert.equal(cars.length, exp.cars.length, "nombre de cotxes");

    const r = await evacuate(world, cars, OPTS);

    for (const want of exp.cars) {
      const car = cars[want.i];
      const got = r.out.find((o) => o.id === car.id);
      const on = `${name} cotxe ${want.i} (${want.model})`;

      assert.equal(specOf(car).name, want.model, `${on}: model`);

      if (want.ok) {
        assert.ok(got, `${on}: hauria de sortir i no surt`);
        assert.equal(got.round, want.round, `${on}: ronda`);
        assert.equal(got.man, want.man, `${on}: maniobres`);
        assert.equal(+got.len.toFixed(2), want.len, `${on}: llargada del recorregut`);
      } else {
        assert.ok(!got, `${on}: no hauria de sortir i surt`);
        assert.equal(r.diag[car.id]?.kind, want.kind, `${on}: diagnostic`);
      }
    }
  });
}
