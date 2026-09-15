/* The scene: the floor plan drawn, the exact walls and the cars.

   A `world` is {cols, rows, grid, segs} and it is the only thing the planner
   needs to know about the world. `_wall` is the cache of the distance-to-wall
   field; anything that touches the drawing clears it with touch(). */

import { VOID, ASPH, SPOT, EXIT, ENTRANCE, GATE, CELL, mkSeg, idx, inBounds } from "./geometry.js";

export { VOID, ASPH, SPOT, EXIT, ENTRANCE, GATE, CELL };

export function newWorld(cols, rows) {
  return { cols, rows, grid: new Uint8Array(cols * rows).fill(VOID), segs: [], lines: [], _wall: null };
}

/* Metric equivalents of newWorld/fillRect — independent of CELL. For
   describing a floor plan in real dimensions without converting to cells by
   hand (and without a change in drawing resolution breaking the result). */
export function newWorldM(wm, hm) { return newWorld(Math.round(wm / CELL), Math.round(hm / CELL)); }
export function fillRectM(world, x0, y0, x1, y1, type) {
  fillRect(world, Math.round(x0 / CELL), Math.round(y0 / CELL), Math.round(x1 / CELL) - 1, Math.round(y1 / CELL) - 1, type);
}

/* Every change to the drawing has to go through here: otherwise the memoised
   wall field goes stale and freeAt() skips checks it should be making.
   `_staticCache` is the memoised render layer (render.js); it has to be
   cleared too or the drawing stays old. */
export function touch(world) { world._wall = null; world._staticCache = null; }

export function setCell(world, c, r, type) {
  if (!inBounds(world, c, r)) return false;
  const i = idx(world, c, r);
  if (world.grid[i] === type) return false;
  world.grid[i] = type; touch(world);
  return true;
}

export function fillRect(world, c0, r0, c1, r1, type) {
  for (let r = Math.max(0, r0); r <= Math.min(world.rows - 1, r1); r++)
    for (let c = Math.max(0, c0); c <= Math.min(world.cols - 1, c1); c++)
      world.grid[idx(world, c, r)] = type;
  touch(world);
}

/* Resizing keeps whatever is already drawn. */
export function resize(world, cols, rows) {
  const g = new Uint8Array(cols * rows).fill(VOID);
  for (let r = 0; r < Math.min(rows, world.rows); r++)
    for (let c = 0; c < Math.min(cols, world.cols); c++)
      g[r * cols + c] = world.grid[idx(world, c, r)];
  world.cols = cols; world.rows = rows; world.grid = g; world.segs = []; world.lines = [];
  touch(world);
  return world;
}

/* GATE counts for both: a single door that serves as entrance and exit at once
   (see isGoalCell() in planner.js). */
export function hasExit(world) { return world.grid.includes(EXIT) || world.grid.includes(GATE); }
export function hasEntrance(world) { return world.grid.includes(ENTRANCE) || world.grid.includes(GATE); }

/* ---------------------------------------------------------------- lines -- */
/* Orthogonal straight lines (horizontal or vertical) drawn with the "Line"
   tool: they are kept in `world.lines` so that, unlike the rest of the
   freehand drawing, they can be edited afterwards — changing the length
   without having to repaint by eye (see setLineLength).

   ponytail: if part of a line is erased with the eraser or the pen, the entry
   in `world.lines` keeps its old length (it is neither trimmed nor recomputed
   from the grid) — it only changes when explicitly edited with
   setLineLength(). Enough for the use case (draw a straight wall and adjust
   its size), not for every possible combination of edits. */

function paintLineRect(world, line, type) {
  const { x1, y1, x2, y2, halfWidth: hw } = line;
  if (x1 === x2) fillRectM(world, x1 - hw, Math.min(y1, y2), x1 + hw, Math.max(y1, y2), type);
  else fillRectM(world, Math.min(x1, x2), y1 - hw, Math.max(x1, x2), y1 + hw, type);
}

/* (x0,y0) is the end that stays FIXED (where the drag started); (x1,y1) is
   where the user let go, projected onto the horizontal or vertical axis
   depending on which of the two movements was larger. Returns the line
   created, or null if it came out shorter than one cell. */
export function addLine(world, x0, y0, x1, y1, halfWidth, type = VOID) {
  const horiz = Math.abs(x1 - x0) >= Math.abs(y1 - y0);
  const line = {
    id: world.lines.reduce((m, l) => Math.max(m, l.id), 0) + 1,
    x1: x0, y1: y0,
    x2: horiz ? x1 : x0, y2: horiz ? y0 : y1,
    halfWidth, type,
  };
  if (Math.hypot(line.x2 - line.x1, line.y2 - line.y1) < CELL) return null;
  paintLineRect(world, line, type);
  world.lines.push(line);
  return line;
}

/* Repaints the line at a new length, keeping the first end FIXED (x1,y1 —
   where the original drag started): it erases the old rectangle (back to open
   roadway, like the eraser) and paints a new one of the requested length in
   the same direction. */
export function setLineLength(world, line, newLen) {
  const horiz = line.y1 === line.y2;
  const dir = Math.sign((horiz ? line.x2 - line.x1 : line.y2 - line.y1)) || 1;
  paintLineRect(world, line, ASPH);
  if (horiz) line.x2 = line.x1 + dir * newLen;
  else line.y2 = line.y1 + dir * newLen;
  paintLineRect(world, line, line.type);
}

export function lineLength(line) { return Math.hypot(line.x2 - line.x1, line.y2 - line.y1); }
export function lineMidpoint(line) { return { x: (line.x1 + line.x2) / 2, y: (line.y1 + line.y2) / 2 }; }

/* ----------------------------------------------------------------- cars -- */

/* A car: {id, t, cx, cy, th, override?}. `t` is the index into FLEET, `cx/cy`
   the centre of the BODY in metres, `th` in radians. `override` holds
   hand-entered dimensions and applies to this car only.

   `existing` (optional): cars that already exist, for instance restored from a
   saved garage (storage.js) — `nextId` carries on right after the highest one
   already there, so more can be added without repeating an id. */
export function makeCars(existing = []) {
  let nextId = existing.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  const cars = existing.slice();
  cars.addM = (xm, ym, deg, t) => {          // in metres, for real floor plans
    const car = { id: nextId++, t, cx: xm, cy: ym, th: deg * Math.PI / 180 };
    cars.push(car); return car;
  };
  cars.addCell = (cxCells, cyCells, deg, t) => cars.addM(cxCells * CELL, cyCells * CELL, deg, t);
  return cars;
}

/* ----------------------------------------------------------- floor plans -- */

/* FLEET indices used by the real-garage presets. */
const GENERIC = 1, IBIZA = 4, COROLLA_TS = 6, YARIS = 7;

/* The presets below were written in cells of OLD_CELL=0.5 m (the original
   drawing resolution). Rather than recompute every measurement by hand for
   today's 0.1 m — 40 literals, easy to get wrong — they are scaled with
   `fr`/`ac`/`nw`: same physics, finer cells. `fr` scales an INCLUSIVE range:
   the far end represents (c1+1)*OLD_CELL, not c1*OLD_CELL, and it has to be
   rounded that way or the range comes up (U-1) cells short. */
const OLD_CELL = 0.5;
const U = OLD_CELL / CELL;
function nw(colsOld, rowsOld) { return newWorld(Math.round(colsOld * U), Math.round(rowsOld * U)); }
function fr(world, c0, r0, c1, r1, t) {
  fillRect(world, Math.round(c0 * U), Math.round(r0 * U), Math.round((c1 + 1) * U) - 1, Math.round((r1 + 1) * U) - 1, t);
}
function ac(cars, cOld, rOld, deg, t) { return cars.addCell(cOld * U, rOld * U, deg, t); }

/* Each preset returns {world, cars, veh}: `veh` is the model left selected in
   the panel. */
export const presets = {
  /* Two rows of 2.5 x 5.0 m bays, a 6 m central aisle and 2.5 m of free
     turning space at each end of the aisle. */
  bays() {
    const world = nw(60, 36), cars = makeCars();
    fr(world, 0, 2, 59, 33, ASPH);
    for (let i = 0; i < 10; i++) {
      fr(world, 5 + i * 5, 2, 9 + i * 5, 11, SPOT);
      fr(world, 5 + i * 5, 24, 9 + i * 5, 33, SPOT);
      ac(cars, 7.5 + i * 5, 7.0, 270, GENERIC);
      ac(cars, 7.5 + i * 5, 29.0, 90, GENERIC);
    }
    fr(world, 0, 16, 2, 27, GATE);        // combined entrance and exit, a single space
    return { world, cars, veh: GENERIC };
  },

  /* Enclosed yard: four bays at the back and two cars parked in front. */
  tandem() {
    const world = nw(40, 34), cars = makeCars();
    fr(world, 0, 0, 39, 33, ASPH);
    fr(world, 2, 0, 15, 1, GATE);         // combined entrance and exit, a single space
    for (let i = 0; i < 4; i++) {
      fr(world, 3 + i * 9, 24, 7 + i * 9, 33, SPOT);
      ac(cars, 5.5 + i * 9, 29.0, 90, GENERIC);
    }
    fr(world, 12, 14, 16, 23, SPOT); ac(cars, 14.5, 18.5, 90, GENERIC);
    fr(world, 21, 14, 25, 23, SPOT); ac(cars, 23.5, 18.5, 90, GENERIC);
    return { world, cars, veh: GENERIC };
  },

  /* The same bays, but with an aisle of only 4.5 m. */
  narrow() {
    const world = nw(50, 29), cars = makeCars();
    fr(world, 0, 0, 49, 28, ASPH);
    for (let i = 0; i < 8; i++) {
      fr(world, 5 + i * 5, 0, 9 + i * 5, 9, SPOT);
      fr(world, 5 + i * 5, 19, 9 + i * 5, 28, SPOT);
      ac(cars, 7.5 + i * 5, 5.0, 270, GENERIC);
      ac(cars, 7.5 + i * 5, 24.0, 90, GENERIC);
    }
    fr(world, 0, 12, 2, 21, GATE);        // combined entrance and exit, a single space
    return { world, cars, veh: GENERIC };
  },

  /* A real floor plan (one particular user's garage): an L of 19.70 x 4.15 m
     with a left-hand block of 7.65 x 8.01 m and the door at the right-hand
     end. The walls go in as exact SEGMENTS because 4.15 m does not land on the
     grid (neither at 0.5 m nor at today's 0.1 m); the grid only wraps around
     them, never inside. This is exactly the case segHitsOBB() exists for.
     It is not an application preset (no button in the UI: it is one specific
     person's floor plan, not a generic example) — it stays only as a test
     fixture, which already used it to exercise exact segments and real
     clearances. To save your own floor plan, see storage.js. */
  garage() {
    const world = nw(54, 18), cars = makeCars();
    fr(world, 0, 0, 39, 8, ASPH);      // upper arm, y 0-4.15
    fr(world, 0, 8, 15, 16, ASPH);     // left-hand block, y 4.15-8.01
    fr(world, 39, 0, 53, 8, ASPH);     // outside landing (beyond the door)
    fr(world, 41, 0, 44, 8, GATE);      // combined entrance and exit, right outside
    const W = 19.70, D1 = 4.15, D2 = 8.01, LX = 7.65;
    world.segs = [
      mkSeg(0, 0, W, 0), mkSeg(W, D1, LX, D1), mkSeg(LX, D1, LX, D2),
      mkSeg(LX, D2, 0, D2), mkSeg(0, D2, 0, 0),
    ];
    // A row of four, nose towards the door, equal 48 cm clearances.
    // Laid out with the long Corolla (Touring Sports).
    cars.addM(2.805, 2.075, 0, COROLLA_TS);
    cars.addM(7.935, 2.075, 0, COROLLA_TS);
    cars.addM(12.770, 2.075, 0, IBIZA);
    cars.addM(17.250, 2.075, 0, YARIS);
    return { world, cars, veh: COROLLA_TS };
  },

  /* Variant with three cars: all three in the left-hand room, in three lanes,
     with the aisle clear. The Corolla has to go in the middle lane. */
  garage3() {
    const { world } = presets.garage();
    const cars = makeCars();
    cars.addM(3.00, 1.555, 0, IBIZA);
    cars.addM(3.00, 4.005, 0, COROLLA_TS);
    cars.addM(3.00, 6.455, 0, YARIS);
    return { world, cars, veh: COROLLA_TS };
  },

  empty() {
    const world = nw(60, 36), cars = makeCars();
    fr(world, 3, 2, 57, 33, ASPH);
    fr(world, 0, 16, 2, 27, GATE);        // combined entrance and exit, a single space
    return { world, cars, veh: GENERIC };
  },
};

export const PRESET_NAMES = Object.keys(presets);
