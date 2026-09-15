import test from "node:test";
import assert from "node:assert/strict";
import { FLEET, TURNING_MEASURES, rcFromTurning, spec, specOf } from "../src/vehicle.js";

test("FLEET holds the 4 generic profiles + the 4 real cars", () => {
  assert.equal(FLEET.length, 8);
  const names = FLEET.map((f) => f.name);
  for (const n of ["Seat Ibiza 2017", "Corolla hatchback 2023", "Corolla Touring Sports 23", "Toyota Yaris 2023"])
    assert.ok(names.includes(n), `missing ${n}`);
});

test("turningMeasure is required: without it, it throws", () => {
  assert.throws(() => rcFromTurning({ B: 2.6, W: 1.8, Fo: 0.9, turning: 10.9 }), /turningMeasure/);
});
test("unknown turningMeasure: it throws", () => {
  assert.throws(() => rcFromTurning({ B: 2.6, W: 1.8, Fo: 0.9, turning: 10.9, turningMeasure: "radius" }), /unknown/);
});

test("all 4 turning measures compute without throwing", () => {
  const base = { B: 2.6, W: 1.8, Fo: 0.9 };
  for (const turningMeasure of TURNING_MEASURES) {
    const Rc = rcFromTurning({ ...base, turning: 11, turningMeasure });
    assert.ok(Rc > 0 && isFinite(Rc), `${turningMeasure} -> invalid Rc`);
  }
});

test("the same turning figure labelled kerb vs wall gives clearly different Rc", () => {
  const base = { B: 2.6, W: 1.8, Fo: 0.9, turning: 11.0 };
  const rcKerb = rcFromTurning({ ...base, turningMeasure: "kerb-diameter" });
  const rcWall = rcFromTurning({ ...base, turningMeasure: "wall-diameter" });
  // Kerb measures out to the WHEEL (arm B), wall out to the corner of the
  // bodywork (arm B+Fo, larger): for the same diameter, wall implies a smaller
  // Rc. The difference has to be large, not a rounding artefact.
  assert.ok(rcWall < rcKerb, `wall (${rcWall}) should give a smaller Rc than kerb (${rcKerb})`);
  assert.ok(rcKerb - rcWall > 0.3, `difference too small to not be a conversion bug: ${rcKerb - rcWall}`);
});

test("radius and diameter of the same measure give the same Rc", () => {
  const base = { B: 2.6, W: 1.8, Fo: 0.9 };
  const rcDiam = rcFromTurning({ ...base, turning: 11.0, turningMeasure: "kerb-diameter" });
  const rcRad = rcFromTurning({ ...base, turning: 5.5, turningMeasure: "kerb-radius" });
  assert.ok(Math.abs(rcDiam - rcRad) < 1e-9);
});

test("spec(): Ro = L - B - Fo, and dmax = atan(B/Rc)", () => {
  const entry = { L: 4.37, W: 1.79, B: 2.64, Fo: 0.94, turning: 10.4, turningMeasure: "kerb-diameter" };
  const s = spec(entry);
  assert.ok(Math.abs(s.Ro - (4.37 - 2.64 - 0.94)) < 1e-9);
  assert.ok(Math.abs(s.dmax - Math.atan(s.B / s.Rc)) < 1e-9);
});

test("specOf(): a car with no override uses FLEET[t]", () => {
  const s = specOf({ t: 5 }); // Corolla hatchback 2023
  assert.equal(s.name, "Corolla hatchback 2023");
});

test("specOf(): an override belongs to THAT car only, it does not mutate FLEET", () => {
  const before = spec(FLEET[5]);
  const s = specOf({ t: 5, override: { name: "Tweaked Corolla", L: 5, W: 1.79, B: 2.64, Fo: 0.94, turning: 10.4, turningMeasure: "kerb-diameter" } });
  assert.equal(s.L, 5);
  const after = spec(FLEET[5]);
  assert.equal(after.L, before.L, "FLEET must not be mutated");
});
