# Migration plan — parking exit simulator

> Historical document. This is the plan that was agreed before the migration
> from the single-file prototype to the module layout the repository has today,
> kept because the code comments still refer to the decisions argued here. Some
> figures were true at the time of writing and have since moved on (notably
> `NTH`, which went from 36 to 72). The README describes the current state.

## Context

There is a working single-file prototype, `legac-engine.html` (1132 lines,
vanilla JS, 2D canvas). The engine is correct and two real bugs have been fixed
in it, but it lives mixed in with the DOM and the CSS: it cannot be tested
without a browser, and any change to the planner or to the collision is
validated by eye.

The goal is to separate the engine from the DOM, add headless tests that run in
seconds (including two regression tests for the bugs already found), publish it
as a static site on GitHub Pages, and leave the base ready for adding the manual
driving mode later.

**I have read the whole file.** What follows is verified against the code, not
against the description in the prompt. The discrepancies I found are marked ⚠.

---

## Verifying the starting point

All of this was checked in the file, not taken for granted:

| Piece | Where | State |
|---|---|---|
| `Ro = L - B - Fo`, `track = W - 0.20`, `Rc = sqrt((D/2)² - B²) - track/2`, `dmax = atan(B/Rc)` | `spec()`, L266-277 | ✅ as the prompt says |
| `FLEET` with 4 generic profiles + 4 real cars | L254-263 | ✅ |
| 0.5 m cell against OBB (SAT) | `cellHitsOBB` L375 | ✅ |
| Exact segment against OBB (Liang-Barsky) | `segHitsOBB` L356 | ✅ |
| OBB against OBB (SAT) | `obbHitsOBB` L387 | ✅ |
| Hybrid A* (x, y, θ), forward/reverse, `GEAR_COST=1.2`, `REV_COST=0.5` | `plan()` L503 | ✅ |
| Dijkstra warm-up on the grid | `exitField()` L400 | ✅ |
| Evacuation in rounds + diagnosis | `runSim()` L579 | ✅ 5 causes: `blocked`, `geometry`, `embedded`, `tight`, `budget` |
| **Bug 1 — fix applied** | `Float64Array` at L403 and L505 | ✅ already fixed in the prototype |
| **Bug 2 — fix applied** | `XYBIN=0.15`, `NTH=36`, `STEP=0.22`, 7 angles L530 | ✅ already fixed in the prototype |

Both fixes **are already there**. What is missing are the tests that stop them
coming back.

### ⚠ Three things that do not add up, and how I resolve them

1. **The file is called `legac-engine.html`**, not `legacy-engine.html`. I
   migrate it to `legacy/legacy-engine.html` (it stays in the repo as a
   reference and as the source of the migration baseline).

2. **Exit condition: the code and the UI text do not say the same thing.**
   `plan()` L539-540 checks `cellTypeAt(centreFromRear(...))` — that is the
   **geometric centre of the car**, not the centre of the rear axle. The text of
   "What it checks and what it does not" (L206) says "the centre of its rear
   axle".
   → **I keep the behaviour of the code** (centre of the body) and fix the text.
   Changing it would move the exit threshold by half a car and invalidate the
   results you have already seen. If you wanted the rear-axle one, say so and I
   will change it: it is one line, but then the reference results change.

3. **Bug 1 epsilon: `exitField` uses `1e-9` (L412, L419) but the closed set of
   `plan()` uses `1e-6` (L538, L562)**, not `1e-9` in both as the prompt said.
   It does not affect the fix (Float64 in both), but I write the regression test
   against the real behaviour, not against the assumed epsilon.

---

## Tooling decisions

**No bundler. No Vite. No dependencies.**

The app is native ES modules served as they are. Node 24 already ships
`node --test`. That removes, in one go:

- the build step and `dist/`,
- **the Vite `base` problem**: with no build, every path is relative
  (`./src/app.js`) and works the same at the root as inside `/garage-planner/`.
  The bug you were worried about cannot exist because there is no absolute path.
- **the Actions workflow against a `gh-pages` branch**: neither of the two.
  GitHub Pages → *Deploy from a branch* → `main` / `/ (root)`. Every push to
  `main` is live in ~30 s. Zero CI files.

`package.json` with zero dependencies:
```json
"scripts": { "test": "node --test test/", "dev": "python -m http.server 8000" }
```

**Plain JS, not TypeScript.** TS would force a compilation step back into
exactly the place we removed it from. Types at the engine boundaries via JSDoc,
which the editor already understands.

### Python: in the tools, not in the engine

I measured this before deciding, with the **same** `segHitsOBB` in both
languages and the same result (940000 hits):

| | calls/s |
|---|---|
| Node 24 | 66,700,000 |
| Python 3.14 | 1,660,000 |

**40× slower** in the hot loop, and the planner is nothing but that loop: one
evacuation of `garage3` would go from ~2 s to over a minute, and the test suite
from "a couple of seconds" to a minute and a half. On top of that, Python only
gets into the browser via Pyodide (~8 MB of wasm per page load), on top of the
40×. The manual driving mode, which has to recompute the distance to the nearest
obstacle every frame, would suffer most.

So the engine and its tests stay in JS, and **Python does everything else**,
which is where it is pleasant to write:

- `tools/serve.py` → already free: `python -m http.server` (that is `npm run dev`).
- `tools/fleet_propose.py` → the vehicle-data proposal script, if it is ever needed.
- `tools/import_plan.py` → converting the dimensions of a real floor plan into
  `mkSeg` segments, which today are written by hand (see the `garage` preset,
  L1044-1046).
- `tools/baseline.py` no: the baseline has to be generated by running the old
  engine, which is JS. That goes with Node.

No `requirements.txt` and no virtualenv: standard library only. If some script
ever does need a dependency, then yes.

<!-- ponytail: no bundler. Add Vite when an npm dependency is needed in the
     browser, or minification, or TypeScript. Then: base:'/garage-planner/'
     and an Actions workflow. Today none of that is needed. -->

---

## Layout

```
index.html                 ← shell: the prototype's CSS and markup, <script type=module src=./src/app.js>
README.md                  ← what it is, how to run the tests, how to serve it, the caveats
.gitignore                 ← node_modules, __pycache__, .venv, .DS_Store, Thumbs.db
tools/                     ← Python, standard library only
src/
  geometry.js              ← mkSeg, segHitsOBB, cellHitsOBB, obbHitsOBB, edt1d, wallField, MinHeap
  vehicle.js               ← loading fleet.json, spec() and the turning conversions
  planner.js               ← freeAt, exitField, plan, evacuate  (no DOM)
  scene.js                 ← world {cols,rows,grid,segs,cars} + the 6 presets
  render.js                ← all the canvas drawing
  app.js                   ← DOM wiring, events, async progress
data/fleet.json            ← hand-curated vehicle library
test/*.test.js
legacy/legacy-engine.html  ← the prototype, untouched, as a reference
```

Six modules. `evacuate()` goes inside `planner.js` (it is 60 lines and it is the
same piece: the solver). There is no `core/` folder, no `utils/`, and no
`index.js` re-exporting anything.

### The real refactor: killing the globals

Today `freeAt`, `exitField`, `plan` and `obstaclesFor` read `S.grid`, `S.cols`,
`S.rows`, `S.cars`, `S.segs` and `wallCache` from the global closure. That is
the only reason the engine cannot be tested without a browser.

The change is mechanical: pass a `world = {cols, rows, grid, segs}` object as
the first parameter. `wallField(world)` caches into `world._wall`, and the
mutators in `scene.js` clear it. No other change of logic.

Two things I delete along the way:

- **`vcache` (L265-277) goes.** `spec()` is one `sqrt` and one `atan`; it is not
  in the hot loop (`plan()` receives `v` once). The cache only existed to avoid
  recomputing after `readFields()` mutated `FLEET` in place.
- ⚠ **`readFields()` (L281) mutates the shared `FLEET` entry.** Today, editing
  the length in the panel changes *every* car of that model at once. With
  `fleet.json` as read-only data that stops making sense: hand editing becomes
  `car.override = {...}`, **for the selected car only**. It is a deliberate
  behaviour change and it is the minimum necessary; the hand entry you asked for
  is kept in full.

---

## Vehicle data

**There is no better source than the one you describe.** I confirm that, and add
what I ruled out so you do not take it up later:

- **NHTSA vPIC** (`vpic.nhtsa.dot.gov`): free, official, no key. But it is US VIN
  decoding and **it does not publish turning radius or diameter**. Useless for
  what we need.
- **Wikidata**: has the odd car with length/wheelbase, very sparse, and the
  turning diameter is almost never there.
- **European certificate of conformity (CoC)**: has the dimensions but not the
  turning figure, and it is not a queryable dataset.

Conclusion: a hand-curated local JSON, just as you said. The reliable source is
that a human has checked it.

### ⚠ The enum you proposed still has the trap inside it

You asked for `"kerb-diameter" | "wall-diameter" | "radius"`. But `"radius"` on
its own is exactly the ambiguity you were warning against: the radius **of
what**, kerb or wall? I propose four values, with no ambiguous combination:

```
"kerb-diameter" | "kerb-radius" | "wall-diameter" | "wall-radius"
```

And it is not cosmetic: **kerb and wall lead to different formulas**, not to a
correction factor.

- *Kerb to kerb* measures the outer front wheel, at distance `B` from the rear
  axle and `track/2` from the axis of the car:
  `Rkerb = sqrt((Rc + track/2)² + B²)`  →  `Rc = sqrt(Rkerb² - B²) - track/2`
  (which is exactly what `spec()` does today, L274 ✅)

- *Wall to wall* measures the **outer front corner of the bodywork**, at
  distance `B + Fo` from the rear axle and `W/2` from the axis:
  `Rwall = sqrt((Rc + W/2)² + (B + Fo)²)`  →  `Rc = sqrt(Rwall² - (B+Fo)²) - W/2`

Each JSON entry:

```json
{ "id": "corolla-hatch-2023", "name": "Corolla hatchback 2023",
  "L": 4.37, "W": 1.79, "B": 2.64, "Fo": 0.94,
  "turning": 10.4, "turningMeasure": "kerb-diameter",
  "foEstimated": true,
  "source": "Toyota ES spec sheet", "checked": "2026-09-14" }
```

`turning` can never be read without `turningMeasure` next to it. `vehicle.js`
throws if the field is missing — there is no default, because a default is
precisely how the error sneaks in.

`foEstimated` records that the overhangs are an estimate (you already say so in
the UI text, L205 and L251-253); that way the UI can flag it rather than hide it.

### Automatic download: I am not building it

There are 8 hand-curated vehicles. A script to propose values for them is more
code than the data it manages. The design, when it is needed, is the one you
have already described and I agree with it: a manual Actions workflow
(`workflow_dispatch`), key as a secret, writes `data/fleet.proposed.json`, opens
a PR, you review it like any normal diff, it never touches production. Zero keys
in the client — which with static Pages is mandatory.

→ **We add it when the library grows beyond what one person wants to maintain by
hand.** We are not there today.

---

## Tests

`node --test`. No framework, no fixtures, no mocks. Target for the whole suite:
**under 5 s**. If a planning scenario runs slowly, I shrink it; the test budget
is not negotiable.

### `test/planner-regression.test.js` — the two bugs

**Bug 1 (float32).** I do not use the clock: a timing test is flaky. I use the
property that float32 breaks.

- `exitField()` returns a `Float64Array` and the field is a genuine fixed point
  of Dijkstra: for every pair of neighbouring drivable cells,
  `d[j] <= d[i] + w·CELL + 1e-12`. With `Float64Array` it holds; with
  `Float32Array` the rounding (~1e-7 at these magnitudes) breaks it straight
  away and the queue refills. It fails instantly and deterministically.
- `plan()` also starts returning `expanded` (the counter already exists at L533,
  it only needs exposing — and it is useful in the UI). The test runs it on
  `garage3` and checks `expanded < MAX_EXPAND` and that it is within a
  reasonable order of magnitude. With the closed set in float32 it blew up.

**Bug 2 (margin monotonicity).** Invariant: a larger margin can never make
leaving easier.

- A small fixed layout (I shrink the scenario until the test runs fast).
- Margins 0.10 → 0.40 in steps of 0.05.
- Assert: the sequence of `res.ok` is **monotonically non-decreasing**. A single
  `false` followed by a `true` fails the test, printing both margins.
- The same car and the same seed in all 7 cases; the only variable is the margin.

### The rest

- `geometry.test.js` — `obbHitsOBB`, `segHitsOBB`, `cellHitsOBB` with known
  cases: edge-to-edge contact, corner contact, a near graze, a near miss, and
  the 4.15 m case that does not land on the grid (the reason segments exist).
- `vehicle.test.js` — the four `turningMeasure` conversions. Key case: the
  **same car with the same number** labelled `kerb-diameter` and `wall-diameter`
  has to give clearly different `Rc`. Plus: `turningMeasure` missing → throws.
- `evacuation.test.js` — rounds and the 5 diagnoses: `blocked` (a car blocked by
  another that cannot get out either), `embedded` (placed inside a wall),
  `tight` (passes with margin 0 and not with 0.25), `geometry`, `budget`.
- `presets.test.js` — the migration baseline, see below.

### The migration baseline (how I know I have not broken anything)

The prototype's engine functions (L217-576) **no longer touch the DOM** — `$()`
only appears in `readFields`/`writeFields`, which are not part of the
computation. So:

1. Before touching anything, I extract L217-576 + the presets into a one-shot
   file in the *scratchpad*, run it with Node and sweep the 6 presets, saving
   `{ok, reason, man, len.toFixed(2)}` for each car into `test/baseline.json`.
2. `presets.test.js` runs the new modules against `baseline.json` and demands an
   exact match.

If the migration changes any result, the test tells me — it is not decided by my
eye.

---

## Deployment

The repository already exists: **`https://github.com/jnoguert/garage-planner.git`**,
and **it already has a commit on `main`** (`28ae40f` — the README and the
.gitignore GitHub generated). I checked with `git ls-remote`. So I do not do a
bare `git init`, which would leave me with two histories with no common ancestor
and force me to force-push:

1. `git init` + `git remote add origin …` + `git fetch origin` +
   `git checkout -b main --track origin/main`.
   That way GitHub's commit is the base and **nothing is ever forced**.
2. Commit `PLAN.md` **on its own**, with no code. Push.
3. Commit the migration, with the README and the `.gitignore` rewritten (they
   replace the generated ones, in the same commit).
4. **You**: Settings → Pages → *Deploy from a branch* → `main` / `/ (root)`.
   I cannot do that without `gh` or a token.
5. Me: I verify the **deployed site, not the local build** — I download
   `https://jnoguert.github.io/garage-planner/` and each `./src/*.js` and
   `./data/fleet.json`, and check 200 + `Content-Type: text/javascript`
   (a 404 or a `text/plain` on a module is the classic Pages failure).
   What I cannot check myself is that the canvas paints: **you open it and
   confirm that.** I will not call the migration done until then.

⚠ If `git push` asks for credentials and you have none configured on this
machine, **I stop and tell you** — I do not try any other route.

Nothing is pushed until you approve this plan.

---

## Phases

| # | What | Commit |
|---|---|---|
| 0 | `git init` + remote + fetch of `28ae40f`, then `PLAN.md` alone | 1 |
| 1 | Baseline from the old engine → `test/baseline.json` | — |
| 2 | `geometry.js`, `vehicle.js` + `fleet.json`, their tests | 2 |
| 3 | `planner.js` (freeAt/exitField/plan/evacuate) + regression tests | 2 |
| 4 | `scene.js`, `render.js`, `app.js`, `index.html` | 2 |
| 5 | `presets.test.js` green against the baseline | 2 |
| 6 | README, `.gitignore`, `tools/` | 2 |
| 7 | Push, Pages, live verification | — |

**This is where I stop and check in.** The manual driving mode (continuous
arrow-key driving, live minimum distance with a contact point, envelope trail,
undo, a gear-change counter comparable with the planner's) is a separate job and
we plan it once the migration is deployed and verified.

---

## Verification

```bash
npm test                    # < 5 s, all green, including the two regression tests
python -m http.server 8000  # http://localhost:8000 — the 6 presets, "Check the exits"
```

By hand, once deployed: open the 6 presets, `garage` and `garage3` have to give
the same verdict as the prototype, and clicking a result has to animate the
route.
