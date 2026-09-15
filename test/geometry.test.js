import test from "node:test";
import assert from "node:assert/strict";
import { mkSeg, segHitsOBB, cellHitsOBB, obbHitsOBB, CELL } from "../src/geometry.js";

/* ------------------------------------------------------------ obbHitsOBB -- */
test("obbHitsOBB: two axis-aligned rectangles that just clear each other", () => {
  // A centred at 0, half-width 1. B at x=2.05, half-width 1 -> 0.05 apart
  const noHit = obbHitsOBB(0, 0, 1, 0, 1, 1, 2.05, 0, 1, 0, 1, 1);
  assert.equal(noHit, false);
});
test("obbHitsOBB: the same pair, 0.1 closer, they touch", () => {
  const hit = obbHitsOBB(0, 0, 1, 0, 1, 1, 1.95, 0, 1, 0, 1, 1);
  assert.equal(hit, true);
});
test("obbHitsOBB: exact corner-to-corner contact (rotated 45deg)", () => {
  const c = Math.SQRT1_2;
  // Two squares of side 2 (hl=hw=1), rotated 45 degrees: half the diagonal is
  // sqrt(2). Centres 2*sqrt(2) apart touch exactly.
  const d = 2 * Math.SQRT2;
  const hit = obbHitsOBB(0, 0, c, c, 1, 1, d - 1e-6, 0, c, c, 1, 1);
  assert.equal(hit, true);
  const noHit = obbHitsOBB(0, 0, c, c, 1, 1, d + 1e-3, 0, c, c, 1, 1);
  assert.equal(noHit, false);
});

/* ------------------------------------------------------------ segHitsOBB -- */
test("segHitsOBB: a 19.70 m long wall, a car far away does not touch it", () => {
  const seg = mkSeg(0, 0, 19.70, 0);
  const hit = segHitsOBB(seg, 10, 3, 1, 0, 2.2, 0.9);
  assert.equal(hit, false);
});
test("segHitsOBB: the same car, now grazing the wall", () => {
  const seg = mkSeg(0, 0, 19.70, 0);
  // hw=0.9, centre at y=0.85 -> reaches y=-0.05, touches the wall at y=0
  const hit = segHitsOBB(seg, 10, 0.85, 1, 0, 2.2, 0.9);
  assert.equal(hit, true);
});
test("segHitsOBB: car facing +x, its nose touches a vertical segment", () => {
  const seg = mkSeg(5, 0, 5, 10);
  // co=1,si=0 (facing +x), hl=2.2 -> the nose reaches cx+2.2; the segment is at x=5
  const hit = segHitsOBB(seg, 2.85, 5, 1, 0, 2.2, 0.9);
  assert.equal(hit, true);
  const noHit = segHitsOBB(seg, 2.7, 5, 1, 0, 2.2, 0.9);
  assert.equal(noHit, false);
});
test("segHitsOBB: exactly 4.15 m, the reason segments exist at all", () => {
  // The real catch in the garage: D1=4.15 does not land on the grid, whatever
  // the resolution (0.5 m or today's 0.1 m: 4.15/0.1=41.5, not an integer).
  const seg = mkSeg(0, 4.15, 7.65, 4.15);
  const hit = segHitsOBB(seg, 3, 4.05, 1, 0, 2.2, 0.15);
  assert.equal(hit, true, "a car centred 10 cm below 4.15 with half-width 0.15 has to touch");
  const noHit = segHitsOBB(seg, 3, 3.9, 1, 0, 2.2, 0.15);
  assert.equal(noHit, false, "20 cm below it no longer touches");
});

/* ----------------------------------------------------------- cellHitsOBB -- */
test("cellHitsOBB: axis-aligned car, inside the neighbouring cell", () => {
  // cell (2,2): centre at ((2.5)*CELL,(2.5)*CELL), independent of CELL.
  const cc = 2.5 * CELL;
  const ex = 1.1, ey = 0.5; // hl=1.1,hw=0.5, co=1,si=0
  const hit = cellHitsOBB(2, 2, cc - 0.3, cc, 1, 0, 1.1, 0.5, ex, ey);
  assert.equal(hit, true);
});
test("cellHitsOBB: the same cell, car too far away", () => {
  const hit = cellHitsOBB(2, 2, 5.0, 5.0, 1, 0, 1.1, 0.5, 1.1, 0.5);
  assert.equal(hit, false);
});
test("cellHitsOBB: car rotated 45deg grazing the corner of a cell", () => {
  const c = Math.SQRT1_2;
  // cell (0,0): centre at ((0.5)*CELL,(0.5)*CELL). Car hl=hw=0.5 rotated 45deg.
  const ex = 0.5 * (c + c), ey = ex;
  const hit = cellHitsOBB(0, 0, 0.45, 0.45, c, c, 0.5, 0.5, ex, ey);
  assert.equal(hit, true);
  const noHit = cellHitsOBB(0, 0, 0.55, 0.55, c, c, 0.5, 0.5, ex, ey);
  assert.equal(noHit, false);
});
