/* All the canvas drawing. No engine logic lives here: it only reads `world`,
   `cars` and the playback/selection state app.js hands it.

   The "ground" is not drawn as decorative texture: roadway/bay/exit already
   mark out the space, and whatever lies outside is simply background. */

import { VOID, SPOT, EXIT, ENTRANCE, GATE, CELL, idx, inBounds } from "./geometry.js";
import { centreFromRear } from "./planner.js";
import { specOf } from "./vehicle.js";

export const PALETTE = ["#93a6b3", "#b57a63", "#7a9a76", "#9789b4", "#c2a45c", "#6f9aa8", "#b0798f", "#849070"];

export function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
/* `--xxx-rgb` is defined in the CSS as an "r,g,b" triplet (not "rgba(...)")
   purely for this: building a colour with whatever alpha each case needs,
   without hardcoding the same RGB twice (once in --xxx and again here) or
   having to keep two themes in sync by hand. */
export function cssRgba(n, alpha) { return `rgba(${css(n + "-rgb")},${alpha})`; }

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

/* -------------------------------------------------------------------- car - */
/* Top-down car silhouette: body, darker roof/cabin, translucent windscreen
   and rear window, wing mirrors and wheels at the four corners. All vector
   (paths on the canvas), no raster image — that way each car is painted in its
   own colour (PALETTE) without having to keep a variant per colour. */
export function drawCar(V, pose, v, color, num, selected, status, moving) {
  const { ctx, px, py, view: { s } } = V;
  ctx.save();
  ctx.translate(px(pose.cx), py(pose.cy));
  ctx.rotate(pose.th);
  const L = v.L * s, W = v.W * s, rr = Math.min(L, W) * 0.22;

  // wheels: peeking out slightly past the body, at the four corners
  const wheelL = L * 0.20, wheelW = W * 0.11;
  ctx.fillStyle = "rgba(10,11,13,.9)";
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const wx = sx * (L * 0.30) - wheelL / 2, wy = sy * (W / 2) - wheelW / 2;
    ctx.beginPath(); roundRect(ctx, wx, wy, wheelL, wheelW, wheelW * 0.4); ctx.fill();
  }

  // body
  ctx.beginPath(); roundRect(ctx, -L / 2, -W / 2, L, W, rr);
  ctx.fillStyle = color; ctx.fill();

  // soft shading on bonnet and boot (gives volume without needing an image)
  const grad = ctx.createLinearGradient(-L / 2, 0, L / 2, 0);
  grad.addColorStop(0, "rgba(0,0,0,.16)"); grad.addColorStop(0.28, "rgba(0,0,0,0)");
  grad.addColorStop(0.72, "rgba(0,0,0,0)"); grad.addColorStop(1, "rgba(0,0,0,.16)");
  ctx.beginPath(); roundRect(ctx, -L / 2, -W / 2, L, W, rr);
  ctx.fillStyle = grad; ctx.fill();

  // roof / cabin: darker rectangle, stopping short of the ends (there is a
  // bonnet and a boot on either side)
  const cabinL = L * 0.5, cabinX = -L * 0.03;
  ctx.beginPath(); roundRect(ctx, cabinX - cabinL / 2, -W / 2 + W * 0.09, cabinL, W - W * 0.18, rr * 0.7);
  ctx.fillStyle = "rgba(0,0,0,.22)"; ctx.fill();

  // windscreen (front) and rear window (back): translucent trapezoids
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

  // wing mirrors
  ctx.fillStyle = "rgba(10,11,13,.75)";
  for (const sy of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(wsX - L * 0.02, sy * (W / 2 + W * 0.05), L * 0.025, W * 0.045, 0, 0, 7);
    ctx.fill();
  }

  // headlights: two light dots at the nose
  ctx.fillStyle = "rgba(255,244,214,.9)";
  for (const sy of [-1, 1]) {
    ctx.beginPath(); ctx.arc(L / 2 - L * 0.05, sy * (W * 0.28), Math.max(0.6, W * 0.05), 0, 7); ctx.fill();
  }

  // outline: green/amber/red depending on the result, or just a thin stroke
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

/* ------------------------------------------------------------ dimensions - */
/* Runs of edge between a wall cell (VOID) and a drivable neighbour, merged
   into straight segments — the same criterion the "kerb" drawing already uses
   (interior edges only, never the map frame). It labels hand-drawn walls in
   metres, just as mkSeg already allows for the exact segments of an imported
   floor plan. */
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

/* Clear width of each entrance opening drawn (or combined entrance+exit,
   GATE): a connected component of `matchType` cells, width = the LONG side of
   its bounding box, not the short one. A hole in a wall is always thinner in
   the direction that crosses the wall (the wall thickness, usually a few cm)
   than in the direction the car drives through (the real width that matters);
   the short side only says how thick a wall was punched through, not whether
   the car fits. Real bug found (and fixed): with Math.min() instead of max(),
   the "bays" preset (a real 6.00 m opening) showed "1.50 m" — it looked
   impossible to understand why a car could get through. This is the real
   safety-relevant measurement (an entrance is a hole in a wall — see
   test/entrance.test.js: if it is too narrow, the car touches the jambs just
   like at any other tight spot). Different from wallBoundaryRuns: that one
   labels the length of WALL runs, not the width of the gap. */
function entranceOpenings(world, minLen, matchType) {
  const { cols, rows, grid } = world;
  const seen = new Uint8Array(cols * rows);
  const openings = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i0 = idx(world, c, r);
    if (grid[i0] !== matchType || seen[i0]) continue;
    let minC = c, maxC = c, minR = r, maxR = r;
    const stack = [i0]; seen[i0] = 1;
    while (stack.length) {
      const cur = stack.pop();
      const cc = cur % cols, cr = (cur / cols) | 0;
      minC = Math.min(minC, cc); maxC = Math.max(maxC, cc);
      minR = Math.min(minR, cr); maxR = Math.max(maxR, cr);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = cc + dc, nr = cr + dr;
        if (!inBounds(world, nc, nr)) continue;
        const ni = idx(world, nc, nr);
        if (grid[ni] === matchType && !seen[ni]) { seen[ni] = 1; stack.push(ni); }
      }
    }
    const wM = (maxC - minC + 1) * CELL, hM = (maxR - minR + 1) * CELL;
    const width = Math.max(wM, hM);
    if (width < minLen) continue;
    openings.push({ cx: (minC + maxC + 1) / 2 * CELL, cy: (minR + maxR + 1) / 2 * CELL, width, horiz: wM >= hM });
  }
  return openings;
}

/* The dimension-label chip is always dark with light text, regardless of the
   page's light/dark theme: underneath it there may be roadway, a bay or an
   exit in any colour, and one fixed high-contrast chip reads well over all of
   them — simpler than making it depend on the theme. */
const DIM_CHIP_BG = "rgba(18,20,23,.82)";
const DIM_CHIP_TEXT = "#c7ccd2";
const DIM_CHIP_ENTRANCE_TEXT = "#8ecdf0";

function drawDimensions(V, world) {
  const { ctx, px, py, view: { s } } = V;
  if (s < 14) return;                    // too far out to read anything
  const minLen = Math.max(0.3, 20 / s);  // in screen metres, not world metres
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
    ctx.fillStyle = DIM_CHIP_BG;
    ctx.fillRect(tx - tw / 2 - 4, ty - s * 0.15, tw + 8, s * 0.30);
    ctx.fillStyle = DIM_CHIP_TEXT;
    ctx.fillText(label, tx, ty);
  }

  ctx.font = `600 ${Math.max(9, s * 0.24)}px "Barlow",sans-serif`;
  const openings = [...entranceOpenings(world, minLen, ENTRANCE), ...entranceOpenings(world, minLen, GATE)];
  for (const o of openings) {
    const label = "↔ " + o.width.toFixed(2) + " m";
    const tw = ctx.measureText(label).width;
    const tx = px(o.cx) + (o.horiz ? 0 : s * 0.5), ty = py(o.cy) + (o.horiz ? s * 0.34 : 0);
    ctx.fillStyle = DIM_CHIP_BG;
    ctx.fillRect(tx - tw / 2 - 4, ty - s * 0.15, tw + 8, s * 0.30);
    ctx.fillStyle = DIM_CHIP_ENTRANCE_TEXT;
    ctx.fillText(label, tx, ty);
  }
}

/* --------------------------------------------------------- static layer --- */
/* Everything that depends only on the `world` (surface, edges, bay markings,
   exits/entrances, exact segments, dimensions) is drawn once onto a separate
   canvas and memoised — it is only rebuilt when the drawing is touched
   (scene.js invalidates `_staticCache` in touch()) or when the zoom changes.
   Without this, on the 10 cm grid (up to 25x more cells than before) every
   frame would have to walk all of them, and while the pen is being dragged
   that means every frame. */
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
    ctx.fillStyle = t === SPOT ? css("--asphalt-lit") : t === EXIT ? cssRgba("--green", .30)
                  : t === ENTRANCE ? cssRgba("--focus", .22) : t === GATE ? cssRgba("--amber", .28)
                  : css("--asphalt");
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

  ctx.strokeStyle = css("--wall-edge"); ctx.lineWidth = Math.max(1, s * 0.06); ctx.beginPath();
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
  ctx.fillStyle = css("--amber");
  for (let r = 0; r < world.rows; r++) for (let c = 0; c < world.cols; c++) {
    if (world.grid[idx(world, c, r)] !== GATE) continue;
    if (((c + r) & 1) === 0) continue;
    const x = px(c * CELL) + cs * 0.5, y = py(r * CELL) + cs * 0.5, k = cs * 0.28;
    ctx.beginPath(); ctx.arc(x, y, k, 0, 7); ctx.fill();
  }

  if (world.segs.length) {
    ctx.strokeStyle = css("--wall"); ctx.lineWidth = Math.max(1.6, s * 0.10);
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

/* `play`: null, or {id, path|null, present:[ids], t}. `hover`: {x,y} in
   metres, only when tool==="car". `previewTh`: angle (rad) of the placement
   ghost. `previewLine`: {x1,y1,x2,y2} in metres while the Line tool is being
   dragged. `statusOf(id)`: "ok"|"amber"|"red"|null. */
export function draw(V, world, cars, { sel, play, hover, tool, curSpec, previewTh, previewLine, statusOf } = {}) {
  const { ctx, px, py, view } = V;
  const w = ctx.canvas.clientWidth, h = ctx.canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = css("--void"); ctx.fillRect(0, 0, w, h);

  const W = world.cols * CELL, H = world.rows * CELL;
  ctx.drawImage(staticLayer(world, view), px(0), py(0), W * view.s, H * view.s);

  if (play?.path) {
    const v = specOf(cars.find((c) => c.id === play.id) || {});
    const hw = v.W / 2, hl = v.L / 2;
    const pts = play.path.map((p) => centreFromRear(p.x, p.y, p.th, v));
    // Step 0 is the start, still without a gear (DIR=0): it counts as forward.
    const isRev = (i) => play.path[i].dir < 0;

    /* The swept footprint: the WHOLE car (L x W, nose and tail included), not
       a ribbon of its width around the centre — when turning, the nose sweeps
       much further out than the midpoint, and that is exactly what clips the
       corners. It is the union of the rectangle at every pose.

       One path and one fill PER GEAR: with a fill per rectangle, the hundreds
       of overlapping poses accumulate ink until they go opaque; with a single
       one, the "nonzero" rule merges them and the union comes out an even
       tone. Two passes (forward and reverse) rather than one because they are
       different colours. */
    for (const rev of [false, true]) {
      ctx.fillStyle = cssRgba(rev ? "--rev" : "--fwd", .17);
      ctx.beginPath();
      let any = false;
      for (let i = 0; i < play.path.length; i++) {
        if (isRev(i) !== rev) continue;
        any = true;
        const p = play.path[i], c = pts[i];
        const co = Math.cos(p.th), si = Math.sin(p.th);
        // corners: centre +- (hl along) +- (hw across)
        const ax = co * hl, ay = si * hl, bx = -si * hw, by = co * hw;
        ctx.moveTo(px(c.cx + ax + bx), py(c.cy + ay + by));
        ctx.lineTo(px(c.cx + ax - bx), py(c.cy + ay - by));
        ctx.lineTo(px(c.cx - ax - bx), py(c.cy - ay - by));
        ctx.lineTo(px(c.cx - ax + bx), py(c.cy - ay + by));
        ctx.closePath();
      }
      if (any) ctx.fill();
    }

    // The centreline stroke, run by run according to the gear: blue forward,
    // yellow reverse. Each run is painted with the gear of its end point,
    // which is the one the car is in while driving it.
    ctx.lineWidth = Math.max(1.6, view.s * 0.09); ctx.globalAlpha = .9;
    for (const rev of [false, true]) {
      ctx.strokeStyle = css(rev ? "--rev" : "--fwd");
      ctx.beginPath();
      for (let i = 1; i < pts.length; i++) {
        if (isRev(i) !== rev) continue;
        ctx.moveTo(px(pts[i - 1].cx), py(pts[i - 1].cy));
        ctx.lineTo(px(pts[i].cx), py(pts[i].cy));
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* `play.present` are the cars that were there while the route was computed;
     the rest are not drawn. The one that is MOVING is never in that list
     (present = "all the others"), which is why it ended up hidden: you saw the
     stroke and no car — the animation looked like it was not there. It is
     always drawn, naturally. */
  const hidden = new Set();
  if (play) cars.forEach((c) => {
    if (c.id !== play.id && !play.present.includes(c.id)) hidden.add(c.id);
  });
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

  /* The exact point where the route is blocked by another car (only the
     "blocked" diagnosis carries it — see checkDirection in planner.js). It
     goes AFTER the cars deliberately: the animated car stops right here, and
     drawn before, the car covered it completely. */
  if (play?.fail && play.hitAt) {
    const v = specOf(cars.find((c) => c.id === play.id) || {});
    const hc = centreFromRear(play.hitAt.x, play.hitAt.y, play.hitAt.th, v);
    const hx = px(hc.cx), hy = py(hc.cy), k = Math.max(7, view.s * 0.3);
    ctx.lineCap = "round";
    ctx.strokeStyle = css("--paint-ink"); ctx.lineWidth = Math.max(5, view.s * 0.19);
    ctx.beginPath();
    ctx.moveTo(hx - k * .6, hy - k * .6); ctx.lineTo(hx + k * .6, hy + k * .6);
    ctx.moveTo(hx + k * .6, hy - k * .6); ctx.lineTo(hx - k * .6, hy + k * .6);
    ctx.stroke();
    ctx.strokeStyle = css("--red"); ctx.lineWidth = Math.max(2.5, view.s * 0.11);
    ctx.beginPath(); ctx.arc(hx, hy, k, 0, 7); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(hx - k * .6, hy - k * .6); ctx.lineTo(hx + k * .6, hy + k * .6);
    ctx.moveTo(hx + k * .6, hy - k * .6); ctx.lineTo(hx - k * .6, hy + k * .6);
    ctx.stroke(); ctx.lineCap = "butt";
  }

  if (hover && tool === "car" && curSpec) {
    ctx.globalAlpha = .45;
    drawCar(V, { cx: hover.x, cy: hover.y, th: previewTh ?? 0 }, curSpec, css("--ghost"), null, false, null, false);
    ctx.globalAlpha = 1;
  }

  if (previewLine) {
    const { x1, y1, x2, y2 } = previewLine;
    const len = Math.hypot(x2 - x1, y2 - y1);
    ctx.save();
    ctx.strokeStyle = css("--ghost"); ctx.lineWidth = Math.max(2, view.s * 0.09);
    ctx.setLineDash([view.s * 0.15, view.s * 0.1]); ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(px(x1), py(y1)); ctx.lineTo(px(x2), py(y2)); ctx.stroke();
    ctx.restore();
    if (len > 1e-6) {
      const label = len.toFixed(2) + " m";
      const horiz = y1 === y2;
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const tx = px(mx) + (horiz ? 0 : view.s * 0.42), ty = py(my) + (horiz ? -view.s * 0.30 : 0);
      ctx.font = `600 ${Math.max(10, view.s * 0.26)}px "Barlow",sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = DIM_CHIP_BG; ctx.fillRect(tx - tw / 2 - 4, ty - view.s * 0.16, tw + 8, view.s * 0.32);
      ctx.fillStyle = css("--ghost"); ctx.fillText(label, tx, ty);
    }
  }
}
