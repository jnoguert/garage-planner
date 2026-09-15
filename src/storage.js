/* Saves and restores drawn floor plans in localStorage: per browser, no
   backend, no syncing between devices — consistent with "a fully static site"
   (see README/PLAN.md). This touches the DOM/browser (like render.js and
   app.js), it is not engine: no other module depends on it. */

const PREFIX = "gp:save:";

function bytesToB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64ToBytes(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

/* Names of the saved garages, sorted. There is no separate index: the
   localStorage keys carrying the prefix are read directly — a separate index
   could drift out of sync (by forgetting it on save/delete). */
export function listSaves() {
  const names = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(PREFIX)) names.push(k.slice(PREFIX.length));
  }
  return names.sort((a, b) => a.localeCompare(b));
}

export function saveGarage(name, world, cars) {
  const data = {
    v: 1, savedAt: Date.now(),
    cols: world.cols, rows: world.rows,
    grid: bytesToB64(world.grid), segs: world.segs, lines: world.lines,
    cars: cars.map((c) => ({ id: c.id, t: c.t, cx: c.cx, cy: c.cy, th: c.th, override: c.override })),
  };
  localStorage.setItem(PREFIX + name, JSON.stringify(data));
}

/* {world, cars}: `world` already has the shape the other modules use (grid as
   a Uint8Array, _wall/_staticCache empty); `cars` is plain data
   (id/t/cx/cy/th/override) — makeCars(cars) is needed to turn it back into an
   array with addM/addCell that carries on the id numbering. */
export function loadGarage(name) {
  const raw = localStorage.getItem(PREFIX + name);
  if (!raw) return null;
  const data = JSON.parse(raw);
  return {
    world: { cols: data.cols, rows: data.rows, grid: b64ToBytes(data.grid), segs: data.segs ?? [], lines: data.lines ?? [], _wall: null, _staticCache: null },
    cars: data.cars ?? [],
    savedAt: data.savedAt,
  };
}

export function deleteSave(name) {
  localStorage.removeItem(PREFIX + name);
}
