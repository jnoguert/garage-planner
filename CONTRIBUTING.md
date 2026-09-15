# Contributing to garage-planner

Thanks for looking. This is a small project with an unusual property for the web
in 2026: **no dependencies and no build step**. Keeping it that way is the main
constraint on every contribution.

## Getting set up

```bash
git clone https://github.com/jnoguert/garage-planner.git
cd garage-planner
npm test          # ~7 s
npm run dev       # http://localhost:8000
```

There is nothing to install. You need:

- **Node 18+** — for `node --test` and for JSON import attributes
  (`import fleet from "…json" with { type: "json" }`).
- **Python 3** (optional) — for `npm run dev` and for `tools/`. Any other static
  file server works just as well.

`npm test` should print **56 pass, 0 fail, 1 todo**. The `todo` is the known open
bug described below; it is expected to be there.

## What the project is trying to be

An exact-enough answer to one question: *can this car get out of this car park?*
Exact geometry, real vehicle dimensions, honest about what it does not model.
Everything it does not check is listed in the README, and that list is part of
the product — please add to it rather than quietly widening the claims.

## Ground rules

1. **`npm test` stays green.** If a change moves the numbers in
   `test/baseline.json`, that is not automatically wrong — but it has to be
   deliberate, and the PR has to say which behaviour changed and why. Regenerate
   the baseline in the same PR.
2. **The engine never touches the DOM.** `geometry.js`, `vehicle.js`,
   `planner.js` and `scene.js` take everything they need as parameters. Only
   `app.js` and `render.js` may touch the browser. This is the single property
   that makes the whole thing testable in seconds without a headless browser;
   please do not spend it.
3. **No new dependencies, no bundler, no TypeScript.** Not out of purism: with
   no build, every path is relative and the site works identically at a domain
   root and under `/garage-planner/`, which is what lets anyone fork it and host
   it in one click. If you hit a real wall that only a dependency can solve, open
   an issue first and let us talk about it.
4. **Non-trivial logic leaves one runnable check behind.** A branch, a loop, a
   parser, anything with an edge case: the smallest test that fails if the logic
   breaks. No frameworks, no fixtures — `node --test` and `assert`. For Python
   tools, an `assert`-based `--demo` in the same file (see
   `tools/import_plan.py`).
5. **English everywhere**: code, comments, UI strings, test names, commit
   messages and docs.
6. **Comments explain why, not what.** The existing comments are long where the
   reasoning is not obvious from the code (why `Float64Array`, why 72 sectors,
   why the whole arc is checked and not just its end point). That style is
   deliberate; match it when you touch something subtle, and skip it when the
   code already says everything.

## Where the help is most needed

### The open monotonicity bug

`test/planner-regression.test.js`, the test marked `todo`.

**The invariant**: a larger safety margin can never make leaving *easier*. It is
pure geometry — the fattened car fits everywhere the thin one did. So if the
planner says "gets out" at margin 0.25, it must say "gets out" at 0.20.

**The symptom**: on the "narrow" preset, three cars violate it at large margins:

```
narrow car 3:  margin 0.20 NO EXIT / 0.25 EXIT
narrow car 6:  margin 0.30 NO EXIT / 0.35 EXIT
narrow car 12: margin 0.35 NO EXIT / 0.40 EXIT
```

**What is known**: the failures come back as `noroute` with ~1400 expansions,
against ~2800 when there is an exit — so the queue emptied early, with the
budget untouched. With a route that exists at both a smaller and a larger
margin, that can only mean the closed set is discarding states that were needed:
the classic Hybrid A* discretisation artefact. It is not the geometry.

Raising the resolution (`NTH`, `XYBIN`, `STEP` in `planner.js`) shrinks it but
does not remove it, and costs search time proportionally — 144 sectors takes the
suite from 7 s to 20 s and still leaves the same three violations. A real fix
probably lives in how the closed set keys or prunes states, not in a finer grid.

If you take this on, the acceptance criterion is simple: remove the `todo` mark,
keep the suite under ~10 s, and keep every other test green.

### Vehicle data

`data/fleet.json`. New models are welcome, with two conditions:

- an explicit `turningMeasure` (`kerb-diameter` | `kerb-radius` |
  `wall-diameter` | `wall-radius`). There is no default and there never will be:
  a turning figure without its measure is how the error gets in.
- a `source` field naming where the numbers come from, and a `checked` date.

Set `foEstimated: true` unless you have a published front-overhang figure; most
manufacturers publish length and wheelbase but not the split.

### The UI

Plain HTML, CSS and canvas, in `index.html` and `src/render.js`. Both themes come
from the same CSS variables (the canvas reads them with `getComputedStyle` while
painting), so a colour change means touching the variables, not two drawing
paths. Keyboard access and `prefers-reduced-motion` are already handled — please
keep them working.

## Pull requests

- One topic per PR. A rename plus a behaviour change in the same diff is hard to
  review.
- Say what you verified, not just what you changed: the test you ran, the preset
  you opened, the number that moved.
- If you found a bug, a failing test in the same PR is worth more than the
  description.
- Reporting a bug you cannot fix is a genuine contribution — open an issue with
  the floor plan (the saved-garage JSON from `localStorage`, or the preset name),
  the settings, and what you expected.

## Licence

By contributing you agree that your contribution is licensed under the MIT
licence, the same as the rest of the project.
