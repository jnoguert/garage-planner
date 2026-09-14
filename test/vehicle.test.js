import test from "node:test";
import assert from "node:assert/strict";
import { FLEET, TURNING_MEASURES, rcFromTurning, spec, specOf } from "../src/vehicle.js";

test("FLEET te els 4 genèrics + els 4 cotxes reals de l'usuari", () => {
  assert.equal(FLEET.length, 8);
  const names = FLEET.map((f) => f.name);
  for (const n of ["Seat Ibiza 2017", "Corolla hatchback 2023", "Corolla Touring Sports 23", "Toyota Yaris 2023"])
    assert.ok(names.includes(n), `falta ${n}`);
});

test("turningMeasure obligatori: sense ell, llanca", () => {
  assert.throws(() => rcFromTurning({ B: 2.6, W: 1.8, Fo: 0.9, turning: 10.9 }), /turningMeasure/);
});
test("turningMeasure desconegut: llanca", () => {
  assert.throws(() => rcFromTurning({ B: 2.6, W: 1.8, Fo: 0.9, turning: 10.9, turningMeasure: "radi" }), /desconegut/);
});

test("les 4 mesures de gir son totes calculables sense llancar", () => {
  const base = { B: 2.6, W: 1.8, Fo: 0.9 };
  for (const turningMeasure of TURNING_MEASURES) {
    const Rc = rcFromTurning({ ...base, turning: 11, turningMeasure });
    assert.ok(Rc > 0 && isFinite(Rc), `${turningMeasure} -> Rc invalid`);
  }
});

test("el mateix numero de gir etiquetat vorera vs paret dona Rc clarament diferents", () => {
  const base = { B: 2.6, W: 1.8, Fo: 0.9, turning: 11.0 };
  const rcVorera = rcFromTurning({ ...base, turningMeasure: "diametre-vorera" });
  const rcParet = rcFromTurning({ ...base, turningMeasure: "diametre-paret" });
  // Vorera mesura fins a la roda (braç B), paret fins a la cantonada de
  // carrosseria (braç B+Fo, mes gran): a igualtat de diametre, paret implica
  // un Rc mes petit. La diferencia ha de ser gran, no un arrodoniment.
  assert.ok(rcParet < rcVorera, `paret (${rcParet}) hauria de donar un Rc mes petit que vorera (${rcVorera})`);
  assert.ok(rcVorera - rcParet > 0.3, `diferencia massa petita per no ser un bug de conversio: ${rcVorera - rcParet}`);
});

test("radi i diametre de la mateixa mesura donen el mateix Rc", () => {
  const base = { B: 2.6, W: 1.8, Fo: 0.9 };
  const rcDiam = rcFromTurning({ ...base, turning: 11.0, turningMeasure: "diametre-vorera" });
  const rcRadi = rcFromTurning({ ...base, turning: 5.5, turningMeasure: "radi-vorera" });
  assert.ok(Math.abs(rcDiam - rcRadi) < 1e-9);
});

test("spec(): Ro = L - B - Fo, i dmax = atan(B/Rc)", () => {
  const entry = { L: 4.37, W: 1.79, B: 2.64, Fo: 0.94, turning: 10.4, turningMeasure: "diametre-vorera" };
  const s = spec(entry);
  assert.ok(Math.abs(s.Ro - (4.37 - 2.64 - 0.94)) < 1e-9);
  assert.ok(Math.abs(s.dmax - Math.atan(s.B / s.Rc)) < 1e-9);
});

test("specOf(): un cotxe sense override fa servir FLEET[t]", () => {
  const s = specOf({ t: 5 }); // Corolla hatchback 2023
  assert.equal(s.name, "Corolla hatchback 2023");
});

test("specOf(): l'override es NOMES d'aquest cotxe, no muta FLEET", () => {
  const before = spec(FLEET[5]);
  const s = specOf({ t: 5, override: { name: "Corolla trucat", L: 5, W: 1.79, B: 2.64, Fo: 0.94, turning: 10.4, turningMeasure: "diametre-vorera" } });
  assert.equal(s.L, 5);
  const after = spec(FLEET[5]);
  assert.equal(after.L, before.L, "FLEET no s'ha de mutar");
});
