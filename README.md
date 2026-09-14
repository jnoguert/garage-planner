# garage-planner

Simulador de sortida d'aparcament. Dibuixes una planta (parets, places,
sortides) en una graella de 10 cm, hi col·loques cotxes amb mides i angles de
gir reals, i el motor calcula si cada cotxe pot arribar a la sortida — sol o
amb altres cotxes pel mig — fent marxa enrere si cal, amb col·lisio exacta
contra parets i altres cotxes.

Lloc estatic, sense backend. Prova'l a
**https://jnoguert.github.io/garage-planner/**.

## Fer-ho anar en local

```bash
python -m http.server 8000
```

i obre `http://localhost:8000/`. No cal build ni instal·lar res: son moduls
ES nadius servits tal qual.

## Tests

```bash
npm test
```

`node --test`, sense framework ni dependencies. Uns 47 tests en ~3 s,
inclosos dos de regressio per als bugs reals que hem trobat al planificador
(vegeu `test/planner-regression.test.js`):

- **Precisio de coma flotant**: el camp de distancies a la sortida i el
  closed set del Hybrid A* han de fer servir `Float64Array`. Amb
  `Float32Array` l'arrodoniment supera l'epsilon de comparacio i la cua de
  cerca no es buida mai.
- **Monotonia del marge de seguretat**: un marge mes gran no pot facilitar
  mai la sortida — si es dona el cas, es sempre un bug del cercador (la
  discretitzacio de l'espai x/y/angle), mai de la geometria.

Un test queda marcat `todo` a proposit: la resolucio de cerca actual
(bins de 0,15 m, 36 sectors, 7 angles de direccio) va reduir molt la
no-monotonia pero no la va eliminar del tot al preset "estret". Es un bug
obert, documentat en comptes d'amagat.

## Estructura

```
src/geometry.js   colisions (OBB-OBB, segment-OBB, cel·la-OBB), camp de
                  distancies, cua de prioritat — sense DOM
src/vehicle.js    biblioteca de vehicles -> Rc (radi de gir) i angle maxim
src/planner.js    Hybrid A*, heuristica i evacuacio per rondes
src/scene.js      el "world" (graella+segments+cotxes) i els 6 presets
src/render.js     tot el dibuix a canvas
src/app.js        cablejat del DOM: events, panells, animacio
src/storage.js    desar/carregar garatges a localStorage, per navegador
data/fleet.json   dades de vehicles curades a ma
test/             node --test
tools/            scripts Python (biblioteca estandard, sense dependencies)
legacy/           el prototip original d'un sol fitxer, com a referencia
```

`src/*.js` no toca mai el DOM excepte `app.js` i `render.js`: tota la
geometria, el planificador i l'escena es poden provar amb Node sense
navegador.

### Dibuix

Un llapis per material (calçada/plaça/mur-pilar/entrada/sortida/cotxe) i una
goma universal: si hi ha un cotxe sota el cursor l'esborra, si no converteix
la cel·la en calçada oberta. "Entrada" es un tipus de cel·la purament
informatiu (transitable com qualsevol altra, vegeu `ENTRANCE` a
`geometry.js`). Els murs que dibuixes queden acotats en metres (render.js,
`wallBoundaryRuns`), igual que els segments exactes d'un plànol importat.

### Garatges desats i tema

"Els teus garatges" desa la planta i els cotxes actuals a `localStorage`
(`src/storage.js`) sota un nom que tu tries — per navegador, sense backend
ni sincronitzacio entre dispositius, coherent amb "lloc totalment estatic".

El mode clar/fosc segueix la preferencia del sistema per defecte
(`@media prefers-color-scheme`) i es pot canviar amb el boto de dalt de tot
del panell esquerre; la tria explicita es desa i guanya sempre per sobre
del sistema. El canvas llegeix els colors amb `getComputedStyle` en pintar
(`render.js`), aixi que els dos temes es mantenen amb les mateixes variables
CSS, no amb dos dibuixos diferents.

Els presets `garatge`/`garatge3` (la planta real d'un usuari concret, amb
segments exactes i cotxes reals) ja no tenen boto a la UI — eren massa
especifics per a una eina d'us general — pero es queden a `scene.js` com a
fixture dels tests, que ja els feien servir per provar la col·lisio contra
segments exactes.

Els resultats de "Comprova les sortides" inclouen el desglossament de
maniobres de cada cotxe (`summariseManeuvers` a `planner.js`): un tram per
marxa, amb la distancia i cap a quin costat gira.

### Dades de vehicles i el gir

Cada entrada de `data/fleet.json` porta un camp `turningMeasure` explicit
(`diametre-vorera` | `radi-vorera` | `diametre-paret` | `radi-paret`). Una
xifra de gir sola no es fiable: "radi de gir", "diametre de gir", "vorera a
vorera" i "paret a paret" es fan servir de manera inconsistent fins i tot
per la mateixa font sobre el mateix cotxe, i confondre'ls (per exemple
radi amb diametre, que es 2x) pot capgirar el resultat en un passadis just.
`src/vehicle.js` llanca si falta aquest camp — no hi ha valor per defecte,
perque un valor per defecte es exactament com s'hi cola l'error.

No hi ha cap font de dades oberta i fiable per a mides+gir de cotxes
concrets (vPIC de la NHTSA no publica gir; les fonts europees amb bones
dades son de pagament i sense API oberta per raspat). Per aixo la font es
un JSON local curat a ma: un humà ho ha comprovat, no una API.

`tools/import_plan.py` converteix una llista de segments de paret d'un
plànol real (CSV `x1,y1,x2,y2` en metres) a crides `mkSeg()` per enganxar a
un preset de `src/scene.js` — es el que fa falta quan les cotes no cauen a
la graella (com el garatge real de l'exemple, amb una paret a
4,15 m).

## Despleg

GitHub Pages, *Deploy from a branch* (`main` / `/ (root)`) — sense build,
totes les rutes son relatives, aixi que funcionen igual a l'arrel que dins
de `/garage-planner/`.

## Que comprova i que no

- Cada cotxe es modela com un rectangle amb direccio a les rodes davanteres
  (model de bicicleta cinematica). La trajectoria de sortida es busca amb
  maniobres endavant i enrere; si no n'hi ha cap de valida, el cotxe queda
  marcat.
- Els cotxes surten **d'un en un** i en l'ordre que el simulador troba. No
  es comprova el transit simultani, les cues, els encreuaments ni les
  preferencies de pas.
- La col·lisio es exacta: rectangle contra rectangle per als cotxes i
  rectangle contra segment per a les parets del planol importat. Les
  parets que dibuixes a ma, en canvi, son cel·les de 10 cm i queden
  arrodonides a la graella.
- Les volades davantera i posterior de cada model son una estimacio: els
  fabricants publiquen la llargada i la batalla, pero rarament el
  repartiment.
- Un cotxe es considera fora quan el centre del **cos** arriba a una
  cel·la de sortida, no quan ha sortit del tot del recinte.
- Tot es pla i en 2D: no hi ha rampes, pendents, gàlib en alçada, vorades
  ni desnivells.
- No es comprova l'espai per obrir portes, ni l'accessibilitat, ni cap
  normativa.
- «Sense sortida» pot voler dir coses diferents, i el simulador les
  distingeix (vegeu `src/planner.js`, `evacuate()`): tapat per altres
  cotxes (`blocked`), sense espai per maniobrar encara que fos sol
  (`geometry`), pressupost de cerca exhaurit (`budget`), o la posicio
  inicial ja toca un mur o un altre cotxe, amb marge (`tight`) o sense
  (`embedded`).
