/* Desa i recupera plantes dibuixades a localStorage: per navegador, sense
   backend, sense sincronitzar entre dispositius — coherent amb "lloc
   totalment estatic" (vegeu README/PLAN.md). Toca el DOM/navegador (com
   render.js i app.js), no es motor: cap altre modul en depen. */

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

/* Noms dels garatges desats, ordenats. No hi ha cap index a part: es
   llegeixen directament les claus de localStorage que porten el prefix —
   un index apart es podria desincronitzar (oblidar-lo en desar/esborrar). */
export function listSaves() {
  const names = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(PREFIX)) names.push(k.slice(PREFIX.length));
  }
  return names.sort((a, b) => a.localeCompare(b, "ca"));
}

export function saveGarage(name, world, cars) {
  const data = {
    v: 1, savedAt: Date.now(),
    cols: world.cols, rows: world.rows,
    grid: bytesToB64(world.grid), segs: world.segs,
    cars: cars.map((c) => ({ id: c.id, t: c.t, cx: c.cx, cy: c.cy, th: c.th, override: c.override })),
  };
  localStorage.setItem(PREFIX + name, JSON.stringify(data));
}

/* {world, cars}: `world` ja te la forma que fan servir la resta de moduls
   (grid com Uint8Array, _wall/_staticCache buits); `cars` son dades planes
   (id/t/cx/cy/th/override) — cal makeCars(cars) per tornar-los a fer un
   array amb addM/addCell que continui la numeracio d'id. */
export function loadGarage(name) {
  const raw = localStorage.getItem(PREFIX + name);
  if (!raw) return null;
  const data = JSON.parse(raw);
  return {
    world: { cols: data.cols, rows: data.rows, grid: b64ToBytes(data.grid), segs: data.segs ?? [], _wall: null, _staticCache: null },
    cars: data.cars ?? [],
    savedAt: data.savedAt,
  };
}

export function deleteSave(name) {
  localStorage.removeItem(PREFIX + name);
}
