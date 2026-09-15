# garage-planner

A parking exit simulator. You draw a floor plan (walls, bays, exits) on a 10 cm
grid, place cars with real dimensions and real steering limits, and the engine
works out whether each car can reach the exit — on its own or with other cars in
the way — reversing if it has to, with exact collision against walls and against
the other cars.

A static site, no backend. Try it at
**https://jnoguert.github.io/garage-planner/**.

Contributions are welcome — see [Contributing](#contributing) and
[CONTRIBUTING.md](CONTRIBUTING.md).

## Running it locally

```bash
npm run dev     # or: python -m http.server 8000
```

then open `http://localhost:8000/`. There is no build step and nothing to
install: these are native ES modules served as they are.

## Tests

```bash
npm test
```

`node --test`, no framework and no dependencies. About 57 tests in ~7 s,
including three regression tests for real bugs found in the planner (see
`test/planner-regression.test.js`):

- **Floating-point precision**: the distance-to-exit field and the closed set of
  the Hybrid A* have to use `Float64Array`. With `Float32Array` the rounding
  exceeds the comparison epsilon and the search queue never empties.
- **Safety-margin monotonicity**: a larger margin can never make leaving easier
  — if that happens it is always a bug in the search (the discretisation of
  x/y/angle space), never in the geometry.
- **Entrance/exit zones thinner than one arc step (STEP=0.22 m)**: the car
  physically passed through, but the search jumped over it, landing inside
  neither side of the jump. `plan()` now checks (`subGoalPose`, only once the
  heuristic says we are close, so as not to quadruple the whole search time)
  whether the WHOLE step passes over it, not just the final landing point.

One test is deliberately marked `todo`: the current search resolution (0.15 m
bins, 72 sectors, 7 steering angles) greatly reduced the non-monotonicity but
did not eliminate it on the "narrow" preset — and it can show up on any other
preset or floor plan if the geometry happens to fall just right (it is the same
mechanism, not a new bug). It is an open bug, documented rather than hidden.
**This is the best-understood open problem in the project; see
[CONTRIBUTING.md](CONTRIBUTING.md) if you want to take it on.**

### The angular resolution of the search (NTH)

The closed set of the Hybrid A* indexes (x, y, angle) and for a long time used
36 orientation sectors (10 degrees). That was the main cause of the most
annoying symptom of all: "this car fits perfectly and the simulator says it does
not". Two poses in the same x/y bin but 9 degrees apart counted as the SAME
state, and the search kept only the cheaper one — even when that was precisely
the one that could not continue.

Measured on the "narrow" preset (16 cars in a tight aisle):

| sectors | get out | moving one car +-2 cm | suite |
|---|---|---|---|
| 36 (10 degrees) | 5/16 | flips between 5 and 6 | 3.4 s |
| **72 (5 degrees)** | **16/16** | stable | 7.3 s |
| 144 (2.5 degrees) | 16/16 | stable | 20.5 s |

72 is where the gain runs out. The search is deterministic (same input, same
output — verified), but with 36 sectors it was so sensitive that moving a car by
1 cm changed the verdict, and from the outside that looks exactly like
non-determinism.

## Layout

```
src/geometry.js   collisions (OBB-OBB, segment-OBB, cell-OBB), distance field,
                  priority queue — no DOM
src/vehicle.js    vehicle library -> Rc (turning radius) and maximum steering angle
src/planner.js    Hybrid A*, heuristic and evacuation
src/scene.js      the "world" (grid+segments+cars) and the 6 presets
src/render.js     all the canvas drawing
src/app.js        DOM wiring: events, panels, animation
src/storage.js    saving/loading garages in localStorage, per browser
data/fleet.json   hand-curated vehicle data
test/             node --test
tools/            Python scripts (standard library, no dependencies)
legacy/           the original single-file prototype, as a reference
```

`src/*.js` never touches the DOM except in `app.js` and `render.js`: all the
geometry, the planner and the scene can be tested under Node with no browser.

### Drawing

One pen per material (roadway/bay/wall-pillar/entrance/exit/car) and a universal
eraser: if there is a car under the cursor it removes it, otherwise it turns the
cell into open roadway. "Entrance" (`ENTRANCE` in `geometry.js`) is drivable like
any other cell as far as collision goes, but it has its own meaning to the
planner: it is the goal of "Entry" mode (see below). Walls you draw are labelled
in metres (render.js, `wallBoundaryRuns`), just like the exact segments of an
imported floor plan.

The "Straight line" tool draws horizontal or vertical walls (VOID) only — you
drag from the end that will stay FIXED and it is projected onto whichever axis
(X or Y) you travelled further along. These are kept in `world.lines`
(scene.js), unlike the rest of the freehand drawing: that lets you double-click
their metre label to change the length (`setLineLength()`), keeping the same end
fixed, with no repainting by eye. Only active with the Line tool selected.

The example presets (bays/tandem/narrow/empty) have the entrance immediately
next to the exit, in the same wall — so "Entry" or "Both ways" mode works without
having to draw anything first.

### Exit, entry, or both

The "What it checks" panel picks what gets simulated, always in the worst case
(every car parked, each in its own bay — see the next section):

- **Exit** (`evacuate()`): from each car's bay to the nearest exit.
- **Entry** (`arrive()`): from the nearest entrance to each car's bay. It is not
  a new search: the kinematic model of this engine is reversible (driving an arc
  forwards at a given steering angle and then driving it back at the SAME angle
  returns exactly to the starting point), so `arrive()` runs the same search as
  `evacuate()` but towards `ENTRANCE` instead of `EXIT`, and reverses the route
  it finds (`reversePath()`). You need to have drawn an entrance cell; if there
  is none, the simulator says so instead of computing something meaningless.
- **Both ways** (`checkBothWays()`): a car only counts as accessible if it can do
  both; if only one fails, each direction is diagnosed separately (a car can get
  in fine and only be trapped on the way out, or the other way round).

If your real floor plan has a single door used in both directions, the "Entrance
and exit" tool (`GATE` in `geometry.js`) paints one space that counts as EXIT
and as ENTRANCE at once (`isGoalCell()` in `planner.js`), instead of two
separate zones. The 4 example presets with cars (bays/tandem/narrow/empty)
already use it.

### Saved garages and theme

"Your garages" saves the current floor plan and cars to `localStorage`
(`src/storage.js`) under a name you choose — per browser, with no backend and no
syncing between devices, consistent with "a fully static site".

Light/dark mode follows the system preference by default
(`@media prefers-color-scheme`) and can be switched with the button at the top of
the left-hand panel; an explicit choice is saved and always wins over the system.
The canvas reads the colours with `getComputedStyle` while painting
(`render.js`), so both themes are maintained with the same CSS variables, not
with two different drawing paths.

The `garage`/`garage3` presets (one particular user's real floor plan, with exact
segments and real cars) no longer have a button in the UI — they were too
specific for a general-purpose tool — but they stay in `scene.js` as a test
fixture, which already used them to exercise collision against exact segments.

The results of "Check the exits" include a manoeuvre breakdown for each car
(`summariseManeuvers` in `planner.js`): one run per gear, with the distance and
which way it turns.

When you click a car, the route is not drawn as a line through the centre alone:
it paints the footprint swept by the WHOLE car (L x W, nose and tail included) —
the union of its rectangle at every pose. When turning, the nose sweeps much
further out than the midpoint, and that is exactly what clips the corners; a
ribbon of the car's width around the centre did not show it. The rectangles go
into a single path and are filled in one go: with one fill per pose, hundreds of
overlapping rectangles accumulate ink until they go opaque; with a single one,
the "nonzero" rule merges them. It is done twice, once per gear, because the
footprint is coloured by how the car goes through: **blue forward and yellow in
reverse** (`--fwd` / `--rev`), both in the footprint and in the centreline
stroke.

The animation loops, with a pause each lap. It used to play once and, if you
were looking somewhere else on the screen, you missed it; and with
"prefers-reduced-motion" (on by default on many Windows PCs without anyone
having chosen it) it lasted 450 ms, a blink. With reduced motion it is now
slower and non-looping — which is what the preference actually asks for, less
sudden movement, not invisibility.

Cars diagnosed as `blocked` are clickable too: they show **in red** the route
they would have taken on their own and a cross at the first point where another
car blocks them (`diag[id].path` and `diag[id].hitAt`, which `checkDirection`
computes with the SAME safety margin as the check — with margin 0, a route that
grazes a car by 5 cm at margin 0.15 marked no point at all). The animated car
stops at the cross; the footprint keeps showing the whole route, so you can see
whether it would have ended up using it.

`blocked` is only said once it has been checked. It used to be enough for "alone
yes, together no" to blame the other cars, and that is not the same thing: the
search can fail with more obstacles on the map even when none of them is in the
way (the XYBIN/NTH bins collapse distinct poses and can discard one that was
needed later). `checkDirection` now walks the route the car would take alone,
pose by pose, with all the others parked; if no point is blocked, that route ALREADY
IS a valid exit (the same check the search does) and it is used instead of
writing the car off as trapped. It is a safety net over an incomplete search,
not a cure for bug 2.

### Vehicle data and turning

Every entry in `data/fleet.json` carries an explicit `turningMeasure` field
(`kerb-diameter` | `kerb-radius` | `wall-diameter` | `wall-radius`). A turning
figure on its own is not trustworthy: "turning radius", "turning diameter",
"kerb to kerb" and "wall to wall" are used inconsistently even by the same
source about the same car, and confusing them (radius for diameter, say, which
is 2x) can flip the result in a tight aisle. `src/vehicle.js` throws if the field
is missing — there is no default, because a default is exactly how the error
sneaks in.

There is no open, reliable data source for the dimensions+turning of specific
cars (NHTSA's vPIC does not publish turning figures; the European sources with
good data are paid and have no open API to scrape). That is why the source is a
hand-curated local JSON: a human has checked it, not an API.

`tools/import_plan.py` converts a list of wall segments from a real floor plan
(CSV `x1,y1,x2,y2` in metres) into `mkSeg()` calls to paste into a preset in
`src/scene.js` — which is what you need when the dimensions do not land on the
grid (like the real garage in the example, with a wall at 4.15 m).

## Deployment

GitHub Pages, *Deploy from a branch* (`main` / `/ (root)`) — no build, and every
path is relative, so it works the same at the root as inside `/garage-planner/`.

## What it checks and what it does not

- Each car is modelled as a rectangle steered at the front wheels (kinematic
  bicycle model). The exit trajectory is searched for with forward and reverse
  manoeuvres; if no valid one exists, the car is flagged.
- Each car is checked **independently**, with all the others parked exactly where
  they are now — it is never assumed that some other car has already left to make
  room (see `evacuate()` in `planner.js`). If a car could only get out after
  another one was moved first, it is flagged as having no exit (`blocked`), even
  though that other one can indeed get out. Simultaneous traffic, queues,
  crossings and right of way are not checked.
- Collision is exact: rectangle against rectangle for cars and rectangle against
  segment for the walls of an imported floor plan. Walls you draw by hand, on the
  other hand, are 10 cm cells and get rounded to the grid.
- The front and rear overhangs of each model are an estimate: manufacturers
  publish the length and the wheelbase, but rarely the split.
- A car counts as out when the centre of its **body** reaches an exit cell, not
  when it has fully left the site.
- Everything is flat and 2D: no ramps, slopes, headroom, kerbs or level changes.
- Space to open doors, accessibility and building regulations are not checked.
- "No exit" can mean different things, and the simulator tells them apart:
  blocked by the other cars as they are parked now, would fit if they were moved
  (`blocked`); no room to manoeuvre even alone on the site (`geometry`); search
  budget exhausted (`budget`); or the starting position already touches a wall or
  another car, with the margin (`tight`) or without it (`embedded`).

## Contributing

Issues and pull requests are welcome. The short version:

```bash
git clone https://github.com/jnoguert/garage-planner.git
cd garage-planner
npm test          # must be green: 56 pass, 1 todo (the known open bug)
npm run dev       # http://localhost:8000
```

There is nothing to install — no dependencies, no build step. You need Node 18+
(for `node --test` and JSON import attributes) and, optionally, Python 3 for the
tools and the dev server.

Good places to start:

- **The open monotonicity bug** (`test/planner-regression.test.js`, marked
  `todo`). The best-understood problem in the project, and the one with the most
  impact on results.
- **Vehicle data** (`data/fleet.json`): adding models, with a source and an
  explicit `turningMeasure`.
- **The UI**: it is plain HTML/CSS/canvas in `index.html` and `src/render.js`.

Ground rules, in full in [CONTRIBUTING.md](CONTRIBUTING.md):

1. `npm test` stays green. A change in behaviour that moves the baseline
   (`test/baseline.json`) has to be deliberate and explained in the PR.
2. The engine (`geometry.js`, `vehicle.js`, `planner.js`, `scene.js`) never
   touches the DOM, so it stays testable under Node.
3. No new dependencies, no build step. That constraint is what keeps this a
   static site anyone can fork and host.
4. Non-trivial logic leaves one runnable check behind.
5. Everything in the repository is in English: code, comments, UI, tests and
   docs.

## Licence

MIT — see [LICENSE](LICENSE).
