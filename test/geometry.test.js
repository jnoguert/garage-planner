import test from "node:test";
import assert from "node:assert/strict";
import { mkSeg, segHitsOBB, cellHitsOBB, obbHitsOBB } from "../src/geometry.js";

/* ------------------------------------------------------------ obbHitsOBB -- */
test("obbHitsOBB: dos rectangles axis-aligned que se separen just", () => {
  // A centrat a 0, mig ample 1. B a x=2.05, mig ample 1 -> separacio 0.05
  const noHit = obbHitsOBB(0, 0, 1, 0, 1, 1, 2.05, 0, 1, 0, 1, 1);
  assert.equal(noHit, false);
});
test("obbHitsOBB: la mateixa parella, 0.1 mes a prop, toquen", () => {
  const hit = obbHitsOBB(0, 0, 1, 0, 1, 1, 1.95, 0, 1, 0, 1, 1);
  assert.equal(hit, true);
});
test("obbHitsOBB: contacte exacte cantonada contra cantonada (girats 45deg)", () => {
  const c = Math.SQRT1_2;
  // Dos quadrats de costat 2 (hl=hw=1), girats 45 graus: la meitat de la
  // diagonal es sqrt(2). Centres a distancia 2*sqrt(2) toquen just.
  const d = 2 * Math.SQRT2;
  const hit = obbHitsOBB(0, 0, c, c, 1, 1, d - 1e-6, 0, c, c, 1, 1);
  assert.equal(hit, true);
  const noHit = obbHitsOBB(0, 0, c, c, 1, 1, d + 1e-3, 0, c, c, 1, 1);
  assert.equal(noHit, false);
});

/* ------------------------------------------------------------ segHitsOBB -- */
test("segHitsOBB: paret llarga de 19.70m, cotxe lluny no toca", () => {
  const seg = mkSeg(0, 0, 19.70, 0);
  const hit = segHitsOBB(seg, 10, 3, 1, 0, 2.2, 0.9);
  assert.equal(hit, false);
});
test("segHitsOBB: el mateix cotxe, ara fregant la paret", () => {
  const seg = mkSeg(0, 0, 19.70, 0);
  // hw=0.9, centre a y=0.85 -> arriba fins a y=-0.05, toca la paret a y=0
  const hit = segHitsOBB(seg, 10, 0.85, 1, 0, 2.2, 0.9);
  assert.equal(hit, true);
});
test("segHitsOBB: cotxe orientat cap a +x, la punta toca un segment vertical", () => {
  const seg = mkSeg(5, 0, 5, 10);
  // co=1,si=0 (cap a +x), hl=2.2 -> la punta arriba a cx+2.2; el segment es a x=5
  const hit = segHitsOBB(seg, 2.85, 5, 1, 0, 2.2, 0.9);
  assert.equal(hit, true);
  const noHit = segHitsOBB(seg, 2.7, 5, 1, 0, 2.2, 0.9);
  assert.equal(noHit, false);
});
test("segHitsOBB: 4.15m exactes, el motiu pel qual existeixen els segments", () => {
  // Amagatall real del garatge: D1=4.15 no cau a la graella de 0.5m.
  const seg = mkSeg(0, 4.15, 7.65, 4.15);
  const hit = segHitsOBB(seg, 3, 4.05, 1, 0, 2.2, 0.15);
  assert.equal(hit, true, "un cotxe centrat 10cm per sota de 4.15 amb mig ample 0.15 ha de tocar");
  const noHit = segHitsOBB(seg, 3, 3.9, 1, 0, 2.2, 0.15);
  assert.equal(noHit, false, "20cm per sota ja no toca");
});

/* ----------------------------------------------------------- cellHitsOBB -- */
test("cellHitsOBB: cotxe alineat amb els eixos, dins la cel·la del costat", () => {
  // cel·la (2,2) en metres: centre a (1.25,1.25), mig costat 0.25
  const ex = 1.1, ey = 0.5; // hl=1.1,hw=0.5, co=1,si=0
  const hit = cellHitsOBB(2, 2, 1.0, 1.25, 1, 0, 1.1, 0.5, ex, ey);
  assert.equal(hit, true);
});
test("cellHitsOBB: la mateixa cel·la, cotxe massa lluny", () => {
  const hit = cellHitsOBB(2, 2, 5.0, 5.0, 1, 0, 1.1, 0.5, 1.1, 0.5);
  assert.equal(hit, false);
});
test("cellHitsOBB: cotxe girat 45deg fregant la cantonada d'una cel·la", () => {
  const c = Math.SQRT1_2;
  // cel·la (0,0): centre (0.25,0.25), semicostat 0.25. Cotxe hl=hw=0.5 girat 45deg.
  const ex = 0.5 * (c + c), ey = ex;
  const hit = cellHitsOBB(0, 0, 0.8, 0.8, c, c, 0.5, 0.5, ex, ey);
  assert.equal(hit, true);
  const noHit = cellHitsOBB(0, 0, 0.95, 0.95, c, c, 0.5, 0.5, ex, ey);
  assert.equal(noHit, false);
});
