/* Tot el dibuix a canvas. Cap logica de motor viu aqui: nomes llegeix `world`,
   `cars` i l'estat de reproduccio/seleccio que li passa app.js.

   El "terra" no es dibuixa com una textura decorativa: la calçada/plaça/
   sortida ja marquen l'espai, i el que hi ha fora es simplement fons. */

import { VOID, SPOT, EXIT, ENTRANCE, CELL, idx, inBounds } from "./geometry.js";
import { centreFromRear } from "./planner.js";
import { specOf } from "./vehicle.js";

export const PALETTE = ["#93a6b3", "#b57a63", "#7a9a76", "#9789b4", "#c2a45c", "#6f9aa8", "#b0798f", "#849070"];

export function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

export function makeView(cv) {
  const ctx = cv.getContext("2d");
  let view = { s: 1, ox: 0, oy: 0 };
  function fitView(world) {
    const w = cv.clientWidth, h = cv.clientHeight;
    const dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = world.cols * CELL, H = world.rows * CELL;
    const pad = 24;
    const s = Math.min((w - pad * 2) / W, (h - pad * 2) / H);
    view = { s, ox: (w - W * s) / 2, oy: (h - H * s) / 2 };
  }
  const px = (x) => view.ox + x * view.s, py = (y) => view.oy + y * view.s;
  const mx = (X) => (X - view.ox) / view.s, my = (Y) => (Y - view.oy) / view.s;
  return { ctx, get view() { return view; }, fitView, px, py, mx, my };
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export function angDiff(a, b) { let d = (a - b) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; }

/* ------------------------------------------------------------------ cotxe - */
/* Silueta de cotxe vist des de dalt: carrosseria, sostre/habitacle mes
   fosc, parabrisa i lluna posterior translucides, retrovisors i rodes als
   quatre cantons. Tot vectorial (Path2D sobre el canvas), no cap imatge
   raster — aixi cada cotxe es pinta del seu color (PALETTE) sense haver de
   mantenir una variant per color. */
export function drawCar(V, pose, v, color, num, selected, status, moving) {
  const { ctx, px, py, view: { s } } = V;
  ctx.save();
  ctx.translate(px(pose.cx), py(pose.cy));
  ctx.rotate(pose.th);
  const L = v.L * s, W = v.W * s, rr = Math.min(L, W) * 0.22;

  // rodes: peeking una mica per fora de la carrosseria, als quatre cantons
  const wheelL = L * 0.20, wheelW = W * 0.11;
  ctx.fillStyle = "rgba(10,11,13,.9)";
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const wx = sx * (L * 0.30) - wheelL / 2, wy = sy * (W / 2) - wheelW / 2;
    ctx.beginPath(); roundRect(ctx, wx, wy, wheelL, wheelW, wheelW * 0.4); ctx.fill();
  }

  // carrosseria
  ctx.beginPath(); roundRect(ctx, -L / 2, -W / 2, L, W, rr);
  ctx.fillStyle = color; ctx.fill();

  // ombra suau del capot i el maleter (dona volum sense necessitar una imatge)
  const grad = ctx.createLinearGradient(-L / 2, 0, L / 2, 0);
  grad.addColorStop(0, "rgba(0,0,0,.16)"); grad.addColorStop(0.28, "rgba(0,0,0,0)");
  grad.addColorStop(0.72, "rgba(0,0,0,0)"); grad.addColorStop(1, "rgba(0,0,0,.16)");
  ctx.beginPath(); roundRect(ctx, -L / 2, -W / 2, L, W, rr);
  ctx.fillStyle = grad; ctx.fill();

  // sostre / habitacle: rectangle mes fosc, no arriba als extrems (hi ha
  // capot i maleter a banda i banda)
  const cabinL = L * 0.5, cabinX = -L * 0.03;
  ctx.beginPath(); roundRect(ctx, cabinX - cabinL / 2, -W / 2 + W * 0.09, cabinL, W - W * 0.18, rr * 0.7);
  ctx.fillStyle = "rgba(0,0,0,.22)"; ctx.fill();

  // parabrisa (davant) i lluna posterior (darrere): trapezis translúcids
  ctx.fillStyle = "rgba(210,228,235,.55)";
  ctx.beginPath();
  const wsX = cabinX + cabinL / 2;
  ctx.moveTo(wsX, -W / 2 + W * 0.12); ctx.lineTo(wsX + L * 0.08, -W / 2 + W * 0.22);
  ctx.lineTo(wsX + L * 0.08, W / 2 - W * 0.22); ctx.lineTo(wsX, W / 2 - W * 0.12);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  const rwX = cabinX - cabinL / 2;
  ctx.moveTo(rwX, -W / 2 + W * 0.12); ctx.lineTo(rwX - L * 0.06, -W / 2 + W * 0.24);
  ctx.lineTo(rwX - L * 0.06, W / 2 - W * 0.24); ctx.lineTo(rwX, W / 2 - W * 0.12);
  ctx.closePath(); ctx.fill();

  // retrovisors
  ctx.fillStyle = "rgba(10,11,13,.75)";
  for (const sy of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(wsX - L * 0.02, sy * (W / 2 + W * 0.05), L * 0.025, W * 0.045, 0, 0, 7);
    ctx.fill();
  }

  // fars: dos punts clars al morro
  ctx.fillStyle = "rgba(255,244,214,.9)";
  for (const sy of [-1, 1]) {
    ctx.beginPath(); ctx.arc(L / 2 - L * 0.05, sy * (W * 0.28), Math.max(0.6, W * 0.05), 0, 7); ctx.fill();
  }

  // contorn: verd/ambre/vermell segons el resultat, o just un traç fi
  ctx.beginPath(); roundRect(ctx, -L / 2, -W / 2, L, W, rr);
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.strokeStyle = status === "red" ? css("--red") : status === "amber" ? css("--amber")
                  : status === "ok" ? "rgba(53,160,106,.85)" : "rgba(0,0,0,.4)";
  if (status) ctx.lineWidth = Math.max(1.8, s * 0.09);
  ctx.stroke();
  if (selected) {
    ctx.strokeStyle = css("--paint"); ctx.setLineDash([s * 0.2, s * 0.16]);
    ctx.lineWidth = Math.max(1.4, s * 0.07); ctx.beginPath();
    roundRect(ctx, -L / 2 - s * 0.12, -W / 2 - s * 0.12, L + s * 0.24, W + s * 0.24, rr);
    ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.restore();
  if (num != null && s > 9 && !moving) {
    ctx.fillStyle = "rgba(20,23,26,.75)";
    ctx.beginPath(); ctx.arc(px(pose.cx), py(pose.cy), s * 0.26, 0, 7); ctx.fill();
    ctx.fillStyle = css("--paint");
    ctx.font = `600 ${Math.max(9, s * 0.32)}px "Barlow Semi Condensed",sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(num, px(pose.cx), py(pose.cy) + s * 0.02);
  }
}

/* --------------------------------------------------------------- mesures - */
/* Trams de vora entre una cel·la de mur (VOID) i una cel·la transitable
   veïna, fusionats en segments rectes — el mateix criteri que ja fa servir
   el dibuix de la "vorada" (nomes vores interiors, mai la del marc del
   mapa). Serveix per etiquetar en metres les parets que es dibuixen a mà,
   igual que mkSeg ja ho permet per als segments exactes d'un plànol importat. */
function wallBoundaryRuns(world, minLen) {
  const { cols, rows, grid } = world;
  const isWall = (c, r) => grid[idx(world, c, r)] === VOID;
  const runs = [];

  for (let r = 1; r < rows; r++) {
    let start = -1;
    for (let c = 0; c <= cols; c++) {
      const edge = c < cols && isWall(c, r - 1) !== isWall(c, r);
      if (edge && start < 0) start = c;
      if (!edge && start >= 0) {
        const len = (c - start) * CELL;
        if (len >= minLen) runs.push({ x1: start * CELL, y1: r * CELL, x2: c * CELL, y2: r * CELL, len });
        start = -1;
      }
    }
  }
  for (let c = 1; c < cols; c++) {
    let start = -1;
    for (let r = 0; r <= rows; r++) {
      const edge = r < rows && isWall(c - 1, r) !== isWall(c, r);
      if (edge && start < 0) start = r;
      if (!edge && start >= 0) {
        const len = (r - start) * CELL;
        if (len >= minLen) runs.push({ x1: c * CELL, y1: start * CELL, x2: c * CELL, y2: r * CELL, len });
        start = -1;
      }
    }
  }
  return runs;
}

function drawDimensions(V, world) {
  const { ctx, px, py, view: { s } } = V;
  if (s < 14) return;                    // massa lluny per llegir-hi res
  const minLen = Math.max(0.3, 20 / s);  // en metres de pantalla, no en el mon
  const runs = [...wallBoundaryRuns(world, minLen), ...world.segs.filter((g) => g.len ?? Math.hypot(g.x2 - g.x1, g.y2 - g.y1) >= minLen)];

  ctx.font = `500 ${Math.max(9, s * 0.24)}px "Barlow",sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const g of runs) {
    const len = g.len ?? Math.hypot(g.x2 - g.x1, g.y2 - g.y1);
    const mx = (g.x1 + g.x2) / 2, my = (g.y1 + g.y2) / 2;
    const horiz = Math.abs(g.x2 - g.x1) >= Math.abs(g.y2 - g.y1);
    const ox = horiz ? 0 : s * 0.42, oy = horiz ? -s * 0.30 : 0;
    const label = len.toFixed(2) + " m";
    const tw = ctx.measureText(label).width;
    const tx = px(mx) + ox, ty = py(my) + oy;
    ctx.fillStyle = "rgba(20,23,26,.72)";
    ctx.fillRect(tx - tw / 2 - 4, ty - s * 0.15, tw + 8, s * 0.30);
    ctx.fillStyle = css("--ink-dim");
    ctx.fillText(label, tx, ty);
  }
}

/* ------------------------------------------------------- capa estatica --- */
/* Tot el que nomes depen del `world` (superficie, vores, marques de plaça,
   sortides/entrades, segments exactes, mesures) es dibuixa un sol cop a un
   canvas apart i es memoritza — nomes es refà quan es toca el dibuix
   (scene.js invalida `_staticCache` a touch()) o quan canvia el zoom. Sense
   aixo, a la graella de 10cm (fins a 25x mes cel·les que abans) cada frame
   hauria de recorrer-les totes, i mentre s'arrossega el llapis aixo es cada
   frame. */
function buildStaticLayer(world, view) {
  const canvas = document.createElement("canvas");
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = world.cols * CELL, H = world.rows * CELL;
  canvas.width = Math.max(1, Math.round(W * view.s * dpr));
  canvas.height = Math.max(1, Math.round(H * view.s * dpr));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const s = view.s, cs = CELL * s;
  const px = (x) => x * s, py = (y) => y * s;
  const Vlocal = { ctx, px, py, view: { s, ox: 0, oy: 0 } };

  for (let r = 0; r < world.rows; r++) for (let c = 0; c < world.cols; c++) {
    const t = world.grid[idx(world, c, r)];
    if (t === VOID) continue;
    ctx.fillStyle = t === SPOT ? css("--asphalt-lit") : t === EXIT ? "rgba(53,160,106,.30)"
                  : t === ENTRANCE ? "rgba(111,183,216,.22)" : css("--asphalt");
    ctx.fillRect(px(c * CELL), py(r * CELL), cs + .6, cs + .6);
  }

  ctx.strokeStyle = css("--paint"); ctx.lineWidth = Math.max(1.4, s * 0.11); ctx.beginPath();
  for (let r = 0; r < world.rows; r++) for (let c = 0; c < world.cols; c++) {
    if (world.grid[idx(world, c, r)] !== SPOT) continue;
    const x = px(c * CELL), y = py(r * CELL);
    const nb = (dc, dr) => inBounds(world, c + dc, r + dr) && world.grid[idx(world, c + dc, r + dr)] === SPOT;
    if (!nb(0, -1)) { ctx.moveTo(x, y); ctx.lineTo(x + cs, y); }
    if (!nb(0, 1)) { ctx.moveTo(x, y + cs); ctx.lineTo(x + cs, y + cs); }
    if (!nb(-1, 0)) { ctx.moveTo(x, y); ctx.lineTo(x, y + cs); }
    if (!nb(1, 0)) { ctx.moveTo(x + cs, y); ctx.lineTo(x + cs, y + cs); }
  }
  ctx.stroke();

  ctx.strokeStyle = "rgba(140,150,160,.55)"; ctx.lineWidth = Math.max(1, s * 0.06); ctx.beginPath();
  for (let r = 0; r < world.rows; r++) for (let c = 0; c < world.cols; c++) {
    if (world.grid[idx(world, c, r)] !== VOID) continue;
    const x = px(c * CELL), y = py(r * CELL);
    const op = (dc, dr) => inBounds(world, c + dc, r + dr) && world.grid[idx(world, c + dc, r + dr)] !== VOID;
    if (op(0, -1)) { ctx.moveTo(x, y); ctx.lineTo(x + cs, y); }
    if (op(0, 1)) { ctx.moveTo(x, y + cs); ctx.lineTo(x + cs, y + cs); }
    if (op(-1, 0)) { ctx.moveTo(x, y); ctx.lineTo(x, y + cs); }
    if (op(1, 0)) { ctx.moveTo(x + cs, y); ctx.lineTo(x + cs, y + cs); }
  }
  ctx.stroke();

  ctx.fillStyle = css("--green");
  for (let r = 0; r < world.rows; r++) for (let c = 0; c < world.cols; c++) {
    if (world.grid[idx(world, c, r)] !== EXIT) continue;
    if (((c + r) & 1) === 0) continue;
    const x = px(c * CELL) + cs * 0.5, y = py(r * CELL) + cs * 0.5, k = cs * 0.28;
    ctx.beginPath(); ctx.arc(x, y, k, 0, 7); ctx.fill();
  }
  ctx.fillStyle = css("--focus");
  for (let r = 0; r < world.rows; r++) for (let c = 0; c < world.cols; c++) {
    if (world.grid[idx(world, c, r)] !== ENTRANCE) continue;
    if (((c + r) & 1) === 0) continue;
    const x = px(c * CELL) + cs * 0.5, y = py(r * CELL) + cs * 0.5, k = cs * 0.28;
    ctx.beginPath(); ctx.arc(x, y, k, 0, 7); ctx.fill();
  }

  if (world.segs.length) {
    ctx.strokeStyle = "rgba(190,200,210,.85)"; ctx.lineWidth = Math.max(1.6, s * 0.10);
    ctx.lineCap = "round"; ctx.beginPath();
    for (const g of world.segs) { ctx.moveTo(px(g.x1), py(g.y1)); ctx.lineTo(px(g.x2), py(g.y2)); }
    ctx.stroke(); ctx.lineCap = "butt";
  }

  drawDimensions(Vlocal, world);
  return canvas;
}

function staticLayer(world, view) {
  const c = world._staticCache;
  if (c && c.s === view.s && c.cols === world.cols && c.rows === world.rows && c.segsN === world.segs.length) return c.canvas;
  const canvas = buildStaticLayer(world, view);
  world._staticCache = { canvas, s: view.s, cols: world.cols, rows: world.rows, segsN: world.segs.length };
  return canvas;
}

/* `play`: null, o {id, path|null, present:[ids], t}. `hover`: {x,y} en
   metres, nomes quan tool==="car". `previewTh`: angle (rad) del fantasma de
   col·locacio. `statusOf(id)`: "ok"|"amber"|"red"|null. */
export function draw(V, world, cars, { sel, play, hover, tool, curSpec, previewTh, statusOf } = {}) {
  const { ctx, px, py, view } = V;
  const w = ctx.canvas.clientWidth, h = ctx.canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = css("--void"); ctx.fillRect(0, 0, w, h);

  const W = world.cols * CELL, H = world.rows * CELL;
  ctx.drawImage(staticLayer(world, view), px(0), py(0), W * view.s, H * view.s);

  if (play?.path) {
    ctx.strokeStyle = css("--route"); ctx.lineWidth = Math.max(1.6, view.s * 0.09);
    ctx.globalAlpha = .85; ctx.beginPath();
    const v = specOf(cars.find((c) => c.id === play.id) || {});
    for (let i = 0; i < play.path.length; i++) {
      const p = play.path[i], cc = centreFromRear(p.x, p.y, p.th, v);
      i ? ctx.lineTo(px(cc.cx), py(cc.cy)) : ctx.moveTo(px(cc.cx), py(cc.cy));
    }
    ctx.stroke(); ctx.globalAlpha = 1;
  }

  const hidden = new Set();
  if (play) cars.forEach((c) => { if (!play.present.includes(c.id)) hidden.add(c.id); });
  cars.forEach((car, i) => {
    if (hidden.has(car.id)) return;
    const vc = specOf(car);
    let pose = car, moving = false;
    if (play?.path && car.id === play.id) {
      const t = play.t, i0 = Math.floor(t), i1 = Math.min(play.path.length - 1, i0 + 1), f = t - i0;
      const a = play.path[i0], b = play.path[i1];
      const th = a.th + angDiff(b.th, a.th) * f;
      pose = centreFromRear(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, th, vc);
      moving = true;
    }
    drawCar(V, pose, vc, PALETTE[i % PALETTE.length], i + 1, car.id === sel, statusOf?.(car.id) ?? null, moving);
  });

  if (hover && tool === "car" && curSpec) {
    ctx.globalAlpha = .45;
    drawCar(V, { cx: hover.x, cy: hover.y, th: previewTh ?? 0 }, curSpec, "#cfd6dc", null, false, null, false);
    ctx.globalAlpha = 1;
  }
}
