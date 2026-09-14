# Pla de migració — simulador de sortida d'aparcament

## Context

Hi ha un prototip funcional en un sol fitxer, `legac-engine.html` (1132 línies,
JS vanilla, canvas 2D). El motor és correcte i s'hi han arreglat dos bugs reals,
però viu barrejat amb el DOM i el CSS: no es pot provar sense navegador, i
qualsevol canvi al planificador o a la col·lisió es valida a ull.

L'objectiu és separar el motor del DOM, posar-hi tests headless que corrin en
segons (inclosos dos tests de regressió pels bugs ja trobats), publicar-ho com a
lloc estàtic a GitHub Pages, i deixar la base preparada per afegir-hi després el
mode de conducció manual.

**He llegit el fitxer sencer.** El que segueix està verificat contra el codi, no
contra la descripció del prompt. Les divergències que he trobat estan marcades
amb ⚠.

---

## Verificació del punt de partida

Tot això ho he comprovat al fitxer, no ho he donat per suposat:

| Peça | On és | Estat |
|---|---|---|
| `Ro = L - B - Fo`, `track = W - 0.20`, `Rc = sqrt((D/2)² - B²) - track/2`, `dmax = atan(B/Rc)` | `spec()`, L266-277 | ✅ tal com el prompt diu |
| `FLEET` amb 4 genèrics + 4 cotxes reals | L254-263 | ✅ |
| Cel·la 0,5 m contra OBB (SAT) | `cellHitsOBB` L375 | ✅ |
| Segment exacte contra OBB (Liang-Barsky) | `segHitsOBB` L356 | ✅ |
| OBB contra OBB (SAT) | `obbHitsOBB` L387 | ✅ |
| Hybrid A* (x, y, θ), endavant/enrere, `GEAR_COST=1.2`, `REV_COST=0.5` | `plan()` L503 | ✅ |
| Escalfament Dijkstra en graella | `exitField()` L400 | ✅ |
| Evacuació per rondes + diagnòstic | `runSim()` L579 | ✅ 5 causes: `blocked`, `geometry`, `embedded`, `tight`, `budget` |
| **Bug 1 — fix aplicat** | `Float64Array` a L403 i L505 | ✅ ja arreglat al prototip |
| **Bug 2 — fix aplicat** | `XYBIN=0.15`, `NTH=36`, `STEP=0.22`, 7 angles L530 | ✅ ja arreglat al prototip |

Els dos fixos **ja hi són**. El que falta són els tests que impedeixin que tornin
a entrar.

### ⚠ Tres coses que no quadren i com les resolc

1. **El fitxer es diu `legac-engine.html`**, no `legacy-engine.html`. El migro
   a `legacy/legacy-engine.html` (es queda al repo com a referència i com a font
   de la línia base de la migració).

2. **Condició de sortida: el codi i el text de la UI no diuen el mateix.**
   `plan()` L539-540 comprova `cellTypeAt(centreFromRear(...))` — és el **centre
   geomètric del cotxe**, no el centre de l'eix posterior. El text de "Què
   comprova i què no" (L206) diu "el centre del seu eix posterior".
   → **Conservo el comportament del codi** (centre del cos) i corregeixo el text.
   Canviar-ho mouria el llindar de sortida mig cotxe i invalidaria els resultats
   que ja has vist. Si volies el de l'eix posterior, digue-m'ho i ho canvio: és
   una línia, però llavors els resultats de referència canvien.

3. **Epsilon del bug 1: `exitField` fa servir `1e-9` (L412, L419) però el closed
   set de `plan()` fa servir `1e-6` (L538, L562)**, no `1e-9` als dos com deia el
   prompt. No afecta el fix (Float64 als dos), però el test de regressió l'escric
   contra el comportament real, no contra l'epsilon suposat.

---

## Decisions d'eines

**Sense bundler. Sense Vite. Sense cap dependència.**

L'app són mòduls ES nadius servits tal qual. Node 24 ja porta `node --test`. Això
elimina d'una tacada:

- el pas de build i el `dist/`,
- **el problema del `base` de Vite**: sense build, totes les rutes són relatives
  (`./src/app.js`) i funcionen igual a l'arrel que dins de `/garage-planner/`.
  El bug que et preocupava no pot existir perquè no hi ha cap ruta absoluta.
- **el workflow d'Actions contra la branca `gh-pages`**: cap dels dos. GitHub
  Pages → *Deploy from a branch* → `main` / `/ (root)`. Cada push a `main` és
  viu en ~30 s. Zero fitxers de CI.

`package.json` amb zero dependències:
```json
"scripts": { "test": "node --test test/", "dev": "python -m http.server 8000" }
```

**JS pla, no TypeScript.** TS obligaria a un pas de compilació just al lloc on
l'hem tret. Tipus als límits del motor via JSDoc, que l'editor ja entén.

### Python: a les eines, no al motor

Ho vaig mesurar abans de decidir-ho, amb el **mateix** `segHitsOBB` als dos
llenguatges i el mateix resultat (940000 impactes):

| | crides/s |
|---|---|
| Node 24 | 66.700.000 |
| Python 3.14 | 1.660.000 |

**40× més lent** al bucle calent, i el planificador no és res més que aquest
bucle: una evacuació de `garatge3` passaria de ~2 s a més d'un minut, i el
conjunt de tests de "un parell de segons" a minut i mig. A sobre, al navegador
Python només hi entra via Pyodide (~8 MB de wasm per càrrega de pàgina), damunt
del 40×. El mode de conducció manual, que ha de recalcular la distància a
l'obstacle més proper a cada fotograma, seria el més perjudicat.

Així que el motor i els seus tests es queden en JS, i **Python fa tota la resta**,
que és on es fa agradable d'escriure:

- `tools/serve.py` → ja hi és de franc: `python -m http.server` (és el `npm run dev`).
- `tools/fleet_propose.py` → l'script de proposta de dades de vehicles, quan calgui.
- `tools/import_plan.py` → convertir mides d'un plànol real a segments `mkSeg`,
  que ara es fan a mà (vegeu el preset `garatge`, L1044-1046).
- `tools/baseline.py` no: la línia base l'he de generar executant el motor antic,
  que és JS. Va amb Node.

Sense `requirements.txt` ni entorn virtual: només biblioteca estàndard. Si algun
script arriba a necessitar una dependència, llavors sí.

<!-- ponytail: sense bundler. Afegir Vite quan calgui una dependència npm al
     navegador, minificació, o TypeScript. Llavors: base:'/garage-planner/'
     i workflow d'Actions. Avui res d'això fa falta. -->

---

## Estructura

```
index.html                 ← shell: CSS i marcatge del prototip, <script type=module src=./src/app.js>
README.md                  ← què és, com passar els tests, com servir-ho, les advertències
.gitignore                 ← node_modules, __pycache__, .venv, .DS_Store, Thumbs.db
tools/                     ← Python, només biblioteca estàndard
src/
  geometry.js              ← mkSeg, segHitsOBB, cellHitsOBB, obbHitsOBB, edt1d, wallField, MinHeap
  vehicle.js               ← càrrega de fleet.json, spec() i conversions de gir
  planner.js               ← freeAt, exitField, plan, evacuate  (cap DOM)
  scene.js                 ← món {cols,rows,grid,segs,cars} + els 6 presets
  render.js                ← tot el dibuix a canvas
  app.js                   ← cablejat del DOM, events, progrés async
data/fleet.json            ← biblioteca de vehicles curada a mà
test/*.test.js
legacy/legacy-engine.html  ← el prototip, intacte, com a referència
```

Sis mòduls. `evacuate()` va dins de `planner.js` (són 60 línies i és la mateixa
peça: el solucionador). No hi ha carpeta `core/`, ni `utils/`, ni `index.js`
que reexporti res.

### El refactor de debò: matar els globals

Avui `freeAt`, `exitField`, `plan` i `obstaclesFor` llegeixen `S.grid`, `S.cols`,
`S.rows`, `S.cars`, `S.segs` i `wallCache` del tancament global. Aquest és
l'únic motiu pel qual el motor no es pot provar sense navegador.

El canvi és mecànic: passar un objecte `world = {cols, rows, grid, segs}` com a
primer paràmetre. `wallField(world)` desa la memòria cau a `world._wall`, i els
mutadors de `scene.js` la buiden. Cap altre canvi de lògica.

Dues coses que esborro pel camí:

- **`vcache` (L265-277) fora.** `spec()` és un `sqrt` i un `atan`; no és al bucle
  calent (`plan()` rep `v` un sol cop). La memòria cau només existia per evitar
  recalcular després que `readFields()` mutés `FLEET` in situ.
- ⚠ **`readFields()` (L281) muta l'entrada compartida de `FLEET`.** Avui, editar
  la llargada al panell canvia *tots* els cotxes d'aquell model alhora. Amb
  `fleet.json` com a dada de només lectura això deixa de tenir sentit: l'edició
  manual passa a ser `car.override = {...}`, **només del cotxe seleccionat**.
  És un canvi de comportament deliberat i és el mínim necessari; l'entrada manual
  que demanaves es conserva sencera.

---

## Dades de vehicles

**No hi ha millor font que la que descrius.** Ho confirmo, i afegeixo el que he
descartat perquè no ho donis per bo més endavant:

- **NHTSA vPIC** (`vpic.nhtsa.dot.gov`): gratuïta, oficial, sense clau. Però és
  descodificació de VIN dels EUA i **no publica radi ni diàmetre de gir**. Inútil
  per al que ens fa falta.
- **Wikidata**: té algun cotxe amb llargada/batalla, molt esparsa, i el diàmetre
  de gir pràcticament no hi surt mai.
- **Certificat de conformitat europeu (CoC)**: té les mides però no el gir, i no
  és un dataset consultable.

Conclusió: JSON local curat a mà, tal com deies. La font fiable és que un humà ho
ha comprovat.

### ⚠ L'enum que proposaves encara té el parany a dins

Demanaves `"diametre-vorera" | "diametre-paret" | "radi"`. Però `"radi"` sol és
exactament l'ambigüitat contra la qual avisaves: radi **de què**, de vorera o de
paret? Proposo quatre valors, sense cap combinació ambigua:

```
"diametre-vorera" | "radi-vorera" | "diametre-paret" | "radi-paret"
```

I no és cosmètic: **vorera i paret porten a fórmules diferents**, no a un factor
de correcció.

- *Vorera a vorera* mesura la roda davantera exterior, a distància `B` de l'eix
  posterior i `track/2` de l'eix del cotxe:
  `Rkerb = sqrt((Rc + track/2)² + B²)`  →  `Rc = sqrt(Rkerb² - B²) - track/2`
  (és exactament el que fa `spec()` avui, L274 ✅)

- *Paret a paret* mesura la **cantonada davantera exterior de la carrosseria**, a
  distància `B + Fo` de l'eix posterior i `W/2` de l'eix:
  `Rwall = sqrt((Rc + W/2)² + (B + Fo)²)`  →  `Rc = sqrt(Rwall² - (B+Fo)²) - W/2`

Cada entrada del JSON:

```json
{ "id": "corolla-hatch-2023", "name": "Corolla hatchback 2023",
  "L": 4.37, "W": 1.79, "B": 2.64, "Fo": 0.94,
  "turning": 10.4, "turningMeasure": "diametre-vorera",
  "foEstimated": true,
  "source": "fitxa Toyota ES", "checked": "2026-09-14" }
```

`turning` no es pot llegir mai sense `turningMeasure` al costat. `vehicle.js`
llança si falta el camp — no hi ha valor per defecte, perquè un valor per defecte
és precisament com es cola l'error.

`foEstimated` deixa constància que les volades són una estimació (ja ho dius al
text de la UI, L205 i L251-253); així la UI ho pot marcar en comptes d'amagar-ho.

### Descàrrega automàtica: no la construeixo

Són 8 vehicles curats a mà. Un script per proposar-ne valors és més codi que les
dades que gestiona. El disseny, quan calgui, és el que ja has descrit i hi estic
d'acord: workflow d'Actions manual (`workflow_dispatch`), clau com a secret,
escriu `data/fleet.proposed.json`, obre PR, tu la revises com un diff normal, mai
toca producció. Zero claus al client — que amb Pages estàtic és obligatori.

→ **Ho afegim quan la biblioteca creixi més enllà del que una persona vol
mantenir a mà.** Avui no hi som.

---

## Tests

`node --test`. Sense framework, sense fixtures, sense mocks. Objectiu del conjunt
sencer: **per sota de 5 s**. Si un escenari de planificació va lent, l'encongeixo;
el pressupost del test no es toca.

### `test/planner-regression.test.js` — els dos bugs

**Bug 1 (float32).** No faig servir el rellotge: un test de temps és inestable.
Faig servir la propietat que el float32 trenca.

- `exitField()` retorna un `Float64Array` i el camp és un punt fix real de
  Dijkstra: per a tota parella de cel·les veïnes transitables,
  `d[j] <= d[i] + w·CELL + 1e-12`. Amb `Float64Array` es compleix; amb
  `Float32Array` l'arrodoniment (~1e-7 en aquestes magnituds) el trenca de seguida
  i la cua es reomple. Falla instantàniament i de manera determinista.
- `plan()` passa a retornar també `expanded` (el comptador ja existeix a L533,
  només cal exposar-lo — i és útil a la UI). El test l'executa sobre `garatge3` i
  comprova `expanded < MAX_EXPAND` i que està dins d'un ordre de magnitud
  raonable. Amb el closed set en float32 explotava.

**Bug 2 (monotonia del marge).** Invariant: un marge més gran no pot facilitar
mai la sortida.

- Disposició fixa i petita (redueixo l'escenari fins que el test vagi de pressa).
- Marges 0.10 → 0.40 de 0.05 en 0.05.
- Assert: la seqüència de `res.ok` és **monòtona no creixent**. Un sol
  `false` seguit d'un `true` fa fallar el test amb els dos marges impresos.
- El mateix cotxe i la mateixa llavor als 7 casos; l'única variable és el marge.

### La resta

- `geometry.test.js` — `obbHitsOBB`, `segHitsOBB`, `cellHitsOBB` amb casos
  coneguts: contacte aresta amb aresta, contacte cantonada, fregada justa,
  separació justa, i el cas de 4,15 m que no cau a la graella (el motiu pel qual
  existeixen els segments).
- `vehicle.test.js` — les quatre conversions de `turningMeasure`. Cas clau: el
  **mateix cotxe amb el mateix número** etiquetat `diametre-vorera` i
  `diametre-paret` ha de donar `Rc` clarament diferents. Més: `turningMeasure`
  absent → llança.
- `evacuation.test.js` — rondes i els 5 diagnòstics: `blocked` (cotxe tapat per
  un altre que tampoc surt), `embedded` (col·loca't dins d'un mur), `tight`
  (passa amb marge 0 i no amb 0,25), `geometry`, `budget`.
- `presets.test.js` — línia base de la migració, vegeu a sota.

### Línia base de la migració (com sé que no he trencat res)

Les funcions del motor del prototip (L217-576) **ja no toquen el DOM** —
`$()` només apareix a `readFields`/`writeFields`, que no formen part del càlcul.
Així que:

1. Abans de tocar res, extrec L217-576 + els presets a un fitxer d'un sol ús al
   *scratchpad*, l'executo amb Node i abordo els 6 presets, desant per a cada
   cotxe `{ok, reason, man, len.toFixed(2)}` a `test/baseline.json`.
2. `presets.test.js` executa els mòduls nous contra `baseline.json` i exigeix
   coincidència exacta.

Si la migració canvia cap resultat, el test m'ho diu — no ho decideix el meu ull.

---

## Desplegament

El repositori ja existeix: **`https://github.com/jnoguert/garage-planner.git`**,
i **ja té un commit a `main`** (`28ae40f` — el README i el .gitignore que va
generar GitHub). Ho he comprovat amb `git ls-remote`. Per tant no faig
`git init` a seques, que em deixaria dues històries sense avantpassat comú i
m'obligaria a forçar el push:

1. `git init` + `git remote add origin …` + `git fetch origin` +
   `git checkout -b main --track origin/main`.
   Així el commit de GitHub queda com a base i **no es força res mai**.
2. Commit de `PLAN.md` **sol**, sense codi. Push.
3. Commit de la migració, amb el README i el `.gitignore` reescrits
   (substitueixen els generats, en el mateix commit).
4. **Tu**: Settings → Pages → *Deploy from a branch* → `main` / `/ (root)`.
   Això no ho puc fer jo sense `gh` ni token.
5. Jo: verifico el **desplegat, no el build local** — descarrego
   `https://jnoguert.github.io/garage-planner/` i cada `./src/*.js` i
   `./data/fleet.json`, i comprovo 200 + `Content-Type: text/javascript`
   (un 404 o un `text/plain` en un mòdul és l'error clàssic de Pages).
   El que no puc comprovar jo és que el canvas pinti: **això l'obres tu i
   m'ho confirmes.** No donaré la migració per acabada fins llavors.

⚠ Si `git push` demana credencials i no en tens de configurades a aquesta
màquina, **m'aturo i t'ho dic** — no ho intento per cap altra via.

Res es puja fins que aprovis aquest pla.

---

## Fases

| # | Què | Commit |
|---|---|---|
| 0 | `git init` + remot + fetch de `28ae40f`, després `PLAN.md` sol | 1 |
| 1 | Línia base amb el motor antic → `test/baseline.json` | — |
| 2 | `geometry.js`, `vehicle.js` + `fleet.json`, els seus tests | 2 |
| 3 | `planner.js` (freeAt/exitField/plan/evacuate) + tests de regressió | 2 |
| 4 | `scene.js`, `render.js`, `app.js`, `index.html` | 2 |
| 5 | `presets.test.js` verd contra la línia base | 2 |
| 6 | README, `.gitignore`, `tools/` | 2 |
| 7 | Push, Pages, verificació en viu | — |

**Aquí m'aturo i t'aviso.** El mode de conducció manual (fletxes contínues,
distància mínima en viu amb punt de contacte, rastre de l'envolupant, desfés,
comptador de canvis de marxa comparable amb el del planificador) és una feina a
part i el planifiquem quan la migració estigui desplegada i verificada.

---

## Verificació

```bash
npm test                    # < 5 s, tot verd, inclosos els dos tests de regressió
python -m http.server 8000  # http://localhost:8000 — els 6 presets, "Comprova les sortides"
```

A mà, un cop desplegat: obrir els 6 presets, `garatge` i `garatge3` han de donar
el mateix veredicte que el prototip, i clicar un resultat ha d'animar el
recorregut.
