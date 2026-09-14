/* Geometria i col·lisions. Sense DOM i sense estat global: tot el que cal
   arriba per paràmetre.

   Un `world` és {cols, rows, grid, segs}: la graella de cel·les de CELL metres
   i els segments de paret exactes. Les dues fonts de mur conviuen — el
   planificador no sap quina ve d'on. */

export const VOID = 0, ASPH = 1, SPOT = 2, EXIT = 3, ENTRANCE = 4;
export const CELL = 0.1;                    // metres per cel·la de dibuix

/* ENTRANCE es nomes informatiu: per al planificador i per exitField() es
   transitable exactament com ASPH/SPOT (tot el que no es VOID ni EXIT es
   "terra"). No cal cap comprovacio especial enlloc mes. */

export const idx = (world, c, r) => r * world.cols + c;
export const inBounds = (world, c, r) => c >= 0 && r >= 0 && c < world.cols && r < world.rows;

/* ------------------------------------------------------------- segments --- */

export function mkSeg(x1, y1, x2, y2) {
  return { x1, y1, x2, y2,
    minx: Math.min(x1, x2), maxx: Math.max(x1, x2),
    miny: Math.min(y1, y2), maxy: Math.max(y1, y2) };
}

/* Segment de paret contra rectangle orientat: retallat de Liang-Barsky al
   sistema de referència del cotxe. Exacte a qualsevol mida — és el que permet
   plantes importades amb cotes com 4,15 m que no cauen a la graella. */
export function segHitsOBB(sg, cx, cy, co, si, hl, hw) {
  const rad = hl + hw;
  if (sg.minx > cx + rad || sg.maxx < cx - rad || sg.miny > cy + rad || sg.maxy < cy - rad) return false;
  const ax = sg.x1 - cx, ay = sg.y1 - cy, bx = sg.x2 - cx, by = sg.y2 - cy;
  const u1 = ax * co + ay * si, v1 = -ax * si + ay * co;
  const u2 = bx * co + by * si, v2 = -bx * si + by * co;
  const du = u2 - u1, dv = v2 - v1;
  let t0 = 0, t1 = 1;
  const P = [-du, du, -dv, dv], Q = [u1 + hl, hl - u1, v1 + hw, hw - v1];
  for (let i = 0; i < 4; i++) {
    if (P[i] === 0) { if (Q[i] < 0) return false; continue; }
    const r = Q[i] / P[i];
    if (P[i] < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else          { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}

/* Cel·la quadrada de la graella contra rectangle orientat (eixos separadors).
   ex/ey són la mitja envolupant alineada als eixos del rectangle; les rep fetes
   perquè qui crida això les reaprofita per acotar el rang de cel·les. */
export function cellHitsOBB(c, r, cx, cy, co, si, hl, hw, ex, ey) {
  const qx = (c + 0.5) * CELL - cx, qy = (r + 0.5) * CELL - cy;
  const h = CELL / 2;
  if (Math.abs(qx) > h + ex) return false;
  if (Math.abs(qy) > h + ey) return false;
  const p = h * (Math.abs(co) + Math.abs(si));
  if (Math.abs(qx * co + qy * si) > hl + p) return false;
  if (Math.abs(-qx * si + qy * co) > hw + p) return false;
  return true;
}

/* Rectangle orientat contra rectangle orientat (cotxe contra cotxe). */
export function obbHitsOBB(ax, ay, aco, asi, ahl, ahw, bx, by, bco, bsi, bhl, bhw) {
  const dx = bx - ax, dy = by - ay;
  const axes = [[aco, asi], [-asi, aco], [bco, bsi], [-bsi, bco]];
  for (const [ux, uy] of axes) {
    const pa = ahl * Math.abs(aco * ux + asi * uy) + ahw * Math.abs(-asi * ux + aco * uy);
    const pb = bhl * Math.abs(bco * ux + bsi * uy) + bhw * Math.abs(-bsi * ux + bco * uy);
    if (Math.abs(dx * ux + dy * uy) > pa + pb) return false;   // eix separador trobat
  }
  return true;
}

/* ------------------------------------------------- camp de distàncies ----- */

/* Transformada de distància exacta 1D (Felzenszwalb & Huttenlocher). */
function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -1e20; z[1] = 1e20;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = 1e20;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}

/* Distància (m) de cada cel·la al mur més proper, subestimada de manera
   conservadora. Només serveix per saltar-se la comprovació cel·la a cel·la quan
   el cotxe és clarament en obert: mai pot dir "lliure" si no ho és.
   Es memoritza al mateix `world`; scene.js la invalida en tocar el dibuix. */
export function wallField(world) {
  if (world._wall) return world._wall;
  const { cols, rows, grid } = world;
  const n = cols * rows, sq = new Float64Array(n), INF = 1e15;
  for (let i = 0; i < n; i++) sq[i] = grid[i] === VOID ? 0 : INF;
  const maxn = Math.max(cols, rows);
  const f = new Float64Array(maxn), d = new Float64Array(maxn);
  const vv = new Int32Array(maxn), zz = new Float64Array(maxn + 1);
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) f[y] = sq[y * cols + x];
    edt1d(f, rows, d, vv, zz);
    for (let y = 0; y < rows; y++) sq[y * cols + x] = d[y];
  }
  for (let y = 0; y < rows; y++) {
    const off = y * cols;
    for (let x = 0; x < cols; x++) f[x] = sq[off + x];
    edt1d(f, cols, d, vv, zz);
    for (let x = 0; x < cols; x++) sq[off + x] = d[x];
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.max(0, Math.sqrt(sq[i]) * CELL - CELL * 1.415);
  world._wall = out;
  return out;
}

/* --------------------------------------------------------------- cua ------ */

export class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v; k.push(key); v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1; if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]]; i = p;
    }
  }
  pop() {
    const k = this.k, v = this.v, n = k.length;
    const top = [k[0], v[0]];
    const lk = k.pop(), lv = v.pop();
    if (n > 1) {
      k[0] = lk; v[0] = lv; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]]; i = m;
      }
    }
    return top;
  }
}
