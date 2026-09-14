/* L'escena: la planta dibuixada, les parets exactes i els cotxes.

   Un `world` es {cols, rows, grid, segs} i es l'unica cosa que el planificador
   necessita saber del mon. `_wall` es la memoria cau del camp de distancies als
   murs; tot el que toca el dibuix la buida amb touch(). */

import { VOID, ASPH, SPOT, EXIT, ENTRANCE, CELL, mkSeg, idx, inBounds } from "./geometry.js";

export { VOID, ASPH, SPOT, EXIT, ENTRANCE, CELL };

export function newWorld(cols, rows) {
  return { cols, rows, grid: new Uint8Array(cols * rows).fill(VOID), segs: [], _wall: null };
}

/* Equivalents en metres de newWorld/fillRect — independents de CELL. Per
   descriure una planta amb mides reals sense haver de convertir a cel·les a
   ma (i sense que un canvi de resolucio del dibuix trenqui el resultat). */
export function newWorldM(wm, hm) { return newWorld(Math.round(wm / CELL), Math.round(hm / CELL)); }
export function fillRectM(world, x0, y0, x1, y1, type) {
  fillRect(world, Math.round(x0 / CELL), Math.round(y0 / CELL), Math.round(x1 / CELL) - 1, Math.round(y1 / CELL) - 1, type);
}

/* Qualsevol canvi al dibuix ha de passar per aqui: si no, el camp de murs
   memoritzat es queda ranci i freeAt() es salta comprovacions que hauria de fer.
   `_staticCache` es la capa de render memoritzada (render.js); tambe cal
   buidar-la o el dibuix es queda vell. */
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

/* Canviar la mida conserva el que ja hi ha dibuixat. */
export function resize(world, cols, rows) {
  const g = new Uint8Array(cols * rows).fill(VOID);
  for (let r = 0; r < Math.min(rows, world.rows); r++)
    for (let c = 0; c < Math.min(cols, world.cols); c++)
      g[r * cols + c] = world.grid[idx(world, c, r)];
  world.cols = cols; world.rows = rows; world.grid = g; world.segs = [];
  touch(world);
  return world;
}

export function hasExit(world) { return world.grid.includes(EXIT); }
export function hasEntrance(world) { return world.grid.includes(ENTRANCE); }

/* ---------------------------------------------------------------- cotxes -- */

/* Un cotxe: {id, t, cx, cy, th, override?}. `t` es l'index a FLEET, `cx/cy` el
   centre del COS en metres, `th` en radians. `override` son cotes entrades a
   ma i valen nomes per a aquest cotxe.

   `existing` (opcional): cotxes ja fets, per exemple recuperats d'un
   garatge desat (storage.js) — `nextId` continua just despres del mes alt
   que ja hi hagi, aixi es pot seguir afegint-ne sense repetir id. */
export function makeCars(existing = []) {
  let nextId = existing.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  const cars = existing.slice();
  cars.addM = (xm, ym, deg, t) => {          // en metres, per a planols reals
    const car = { id: nextId++, t, cx: xm, cy: ym, th: deg * Math.PI / 180 };
    cars.push(car); return car;
  };
  cars.addCell = (cxCells, cyCells, deg, t) => cars.addM(cxCells * CELL, cyCells * CELL, deg, t);
  return cars;
}

/* --------------------------------------------------------------- plantes -- */

/* Indexs de FLEET que fan servir els presets del garatge real. */
const GENERIC = 1, IBIZA = 4, COROLLA_TS = 6, YARIS = 7;

/* Els presets de sota es van escriure en cel·les d'OLD_CELL=0,5 m (la
   resolucio original de dibuix). En comptes de recalcular a ma cada mesura
   per als 0,1 m actuals — 40 literals, facil d'equivocar-se — s'escalen amb
   `fr`/`ac`/`nw`: mateixa fisica, cel·les mes fines. `fr` escala un rang
   INCLUSIU: l'extrem final representa (c1+1)*OLD_CELL, no c1*OLD_CELL, i cal
   arrodonir-ho aixi o el rang queda curt per (U-1) cel·les. */
const OLD_CELL = 0.5;
const U = OLD_CELL / CELL;
function nw(colsOld, rowsOld) { return newWorld(Math.round(colsOld * U), Math.round(rowsOld * U)); }
function fr(world, c0, r0, c1, r1, t) {
  fillRect(world, Math.round(c0 * U), Math.round(r0 * U), Math.round((c1 + 1) * U) - 1, Math.round((r1 + 1) * U) - 1, t);
}
function ac(cars, cOld, rOld, deg, t) { return cars.addCell(cOld * U, rOld * U, deg, t); }

/* Cada preset retorna {world, cars, veh}: `veh` es el model que queda
   seleccionat al panell. */
export const presets = {
  /* Dues fileres en bateria de 2,5 x 5,0 m, passadis central de 6 m i 2,5 m de
     gir lliure als dos extrems del passadis. */
  bateria() {
    const world = nw(60, 36), cars = makeCars();
    fr(world, 0, 2, 59, 33, ASPH);
    for (let i = 0; i < 10; i++) {
      fr(world, 5 + i * 5, 2, 9 + i * 5, 11, SPOT);
      fr(world, 5 + i * 5, 24, 9 + i * 5, 33, SPOT);
      ac(cars, 7.5 + i * 5, 7.0, 270, GENERIC);
      ac(cars, 7.5 + i * 5, 29.0, 90, GENERIC);
    }
    fr(world, 0, 16, 2, 21, EXIT);
    return { world, cars, veh: GENERIC };
  },

  /* Pati tancat: quatre places al fons i dos cotxes aparcats al davant. */
  tandem() {
    const world = nw(40, 34), cars = makeCars();
    fr(world, 0, 0, 39, 33, ASPH);
    fr(world, 2, 0, 8, 1, EXIT);
    for (let i = 0; i < 4; i++) {
      fr(world, 3 + i * 9, 24, 7 + i * 9, 33, SPOT);
      ac(cars, 5.5 + i * 9, 29.0, 90, GENERIC);
    }
    fr(world, 12, 14, 16, 23, SPOT); ac(cars, 14.5, 18.5, 90, GENERIC);
    fr(world, 21, 14, 25, 23, SPOT); ac(cars, 23.5, 18.5, 90, GENERIC);
    return { world, cars, veh: GENERIC };
  },

  /* Les mateixes places, pero amb un passadis de nomes 4,5 m. */
  estret() {
    const world = nw(50, 29), cars = makeCars();
    fr(world, 0, 0, 49, 28, ASPH);
    for (let i = 0; i < 8; i++) {
      fr(world, 5 + i * 5, 0, 9 + i * 5, 9, SPOT);
      fr(world, 5 + i * 5, 19, 9 + i * 5, 28, SPOT);
      ac(cars, 7.5 + i * 5, 5.0, 270, GENERIC);
      ac(cars, 7.5 + i * 5, 24.0, 90, GENERIC);
    }
    fr(world, 0, 12, 2, 16, EXIT);
    return { world, cars, veh: GENERIC };
  },

  /* Planta real (garatge d'un usuari concret): L de 19,70 x 4,15 m amb bloc
     esquerre de 7,65 x 8,01 m, porta a l'extrem dret. Les parets van com a
     SEGMENTS exactes perque 4,15 m no cau a la quadricula (ni a 0,5 m ni als
     0,1 m actuals); la graella nomes s'hi ajusta per sobre, mai per dins. Es
     exactament el cas per al qual existeix segHitsOBB().
     No es un preset de l'aplicacio (no hi ha boto a la UI: es una planta
     d'una persona concreta, no un exemple generic) — es queda nomes com a
     fixture dels tests, que ja el fan servir per provar segments exactes i
     folgances real·les. Per desar la teva propia planta, vegeu storage.js. */
  garatge() {
    const world = nw(54, 18), cars = makeCars();
    fr(world, 0, 0, 39, 8, ASPH);      // brac superior, y 0-4,15
    fr(world, 0, 8, 15, 16, ASPH);     // bloc esquerre, y 4,15-8,01
    fr(world, 39, 0, 53, 8, ASPH);     // repla exterior (fora de la porta)
    fr(world, 41, 0, 42, 8, EXIT);     // fora del tot, passat el llindar
    const W = 19.70, D1 = 4.15, D2 = 8.01, LX = 7.65;
    world.segs = [
      mkSeg(0, 0, W, 0), mkSeg(W, D1, LX, D1), mkSeg(LX, D1, LX, D2),
      mkSeg(LX, D2, 0, D2), mkSeg(0, D2, 0, 0),
    ];
    // Filera de quatre, morro cap a la porta, folgances iguals de 48 cm.
    // Col·locats amb el Corolla llarg (Touring Sports).
    cars.addM(2.805, 2.075, 0, COROLLA_TS);
    cars.addM(7.935, 2.075, 0, COROLLA_TS);
    cars.addM(12.770, 2.075, 0, IBIZA);
    cars.addM(17.250, 2.075, 0, YARIS);
    return { world, cars, veh: COROLLA_TS };
  },

  /* Variant amb tres cotxes: tots tres a la sala de l'esquerra, en tres
     carrils, i el passadis lliure. El Corolla ha d'anar al carril del mig. */
  garatge3() {
    const { world } = presets.garatge();
    const cars = makeCars();
    cars.addM(3.00, 1.555, 0, IBIZA);
    cars.addM(3.00, 4.005, 0, COROLLA_TS);
    cars.addM(3.00, 6.455, 0, YARIS);
    return { world, cars, veh: COROLLA_TS };
  },

  buit() {
    const world = nw(60, 36), cars = makeCars();
    fr(world, 3, 2, 57, 33, ASPH);
    fr(world, 0, 16, 2, 21, EXIT);
    return { world, cars, veh: GENERIC };
  },
};

export const PRESET_NAMES = Object.keys(presets);
