/* Tot el dibuix a canvas. Cap logica de motor viu aqui: nomes llegeix `world`,
   `cars` i l'estat de reproduccio/seleccio que li passa app.js. */

import { VOID, SPOT, EXIT, CELL, idx, inBounds } from "./geometry.js";
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

/* pose: {cx,cy,th} centre del cos. status: null|"ok"|"amber"|"red". */
export function drawCar(V, pose, v, color, num, selected, status, moving) {
  const { ctx, px, py, view: { s } } = V;
  ctx.save();
  ctx.translate(px(pose.cx), py(pose.cy));
  ctx.rotate(pose.th);
  const L = v.L * s, W = v.W * s, rr = Math.min(L, W) * 0.18;
  ctx.beginPath(); roundRect(ctx, -L / 2, -W / 2, L, W, rr);
  ctx.fillStyle = color; ctx.fill();
  ctx.beginPath(); roundRect(ctx, L / 2 - L * 0.24, -W / 2 + W * 0.14, L * 0.19, W * 0.72, rr * 0.6);
  ctx.fillStyle = "rgba(0,0,0,.30)"; ctx.fill();
  ctx.beginPath(); roundRect(ctx, -L / 2 + L * 0.10, -W / 2 + W * 0.16, L * 0.14, W * 0.68, rr * 0.6);
  ctx.fillStyle = "rgba(0,0,0,.18)"; ctx.fill();
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

/* `play`: null, o {id, path|null, present:[ids], t}. `hover`: {x,y} en metres,
   nomes quan tool==="car". `statusOf(id)`: "ok"|"amber"|"red"|null. */
export function draw(V, world, cars, { sel, play, hover, tool, curSpec, statusOf } = {}) {
  const { ctx, px, py, view } = V;
  const w = ctx.canvas.clientWidth, h = ctx.canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = css("--void"); ctx.fillRect(0, 0, w, h);
  const s = view.s, cs = CELL * s;

  for (let r = 0; r < world.rows; r++) for (let c = 0; c < world.cols; c++) {
    const t = world.grid[idx(world, c, r)];
    if (t === VOID) continue;
    ctx.fillStyle = t === SPOT ? css("--asphalt-lit") : t === EXIT ? "rgba(53,160,106,.30)" : css("--asphalt");
    ctx.fillRect(px(c * CELL), py(r * CELL), cs + .6, cs + .6);
  }

  ctx.strokeStyle = "rgba(255,255,255,.035)"; ctx.lineWidth = 1; ctx.beginPath();
  for (let c = 0; c <= world.cols; c += 2) { ctx.moveTo(px(c * CELL), py(0)); ctx.lineTo(px(c * CELL), py(world.rows * CELL)); }
  for (let r = 0; r <= world.rows; r += 2) { ctx.moveTo(px(0), py(r * CELL)); ctx.lineTo(px(world.cols * CELL), py(r * CELL)); }
  ctx.stroke();

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

  ctx.strokeStyle = "rgba(140,150,160,.45)"; ctx.lineWidth = Math.max(1, s * 0.06); ctx.beginPath();
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

  if (world.segs.length) {
    ctx.strokeStyle = "rgba(190,200,210,.85)"; ctx.lineWidth = Math.max(1.6, s * 0.10);
    ctx.lineCap = "round"; ctx.beginPath();
    for (const g of world.segs) { ctx.moveTo(px(g.x1), py(g.y1)); ctx.lineTo(px(g.x2), py(g.y2)); }
    ctx.stroke(); ctx.lineCap = "butt";
  }

  if (play?.path) {
    ctx.strokeStyle = css("--route"); ctx.lineWidth = Math.max(1.6, s * 0.09);
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
    drawCar(V, { cx: hover.x, cy: hover.y, th: hover.th ?? 0 }, curSpec, "#cfd6dc", null, false, null, false);
    ctx.globalAlpha = 1;
  }
}
