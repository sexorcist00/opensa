# Benchmarks, soak & the perf ritual

How the own-engine game is performance-tested: the in-game **bench sweep** (speed), the **soak mode**
(stability over time), and the **headless harness** that runs both without a human at the screen.
Chain context: [074/11 performance testing](../plans/074-opensa-engine/11-performance-testing.md) ·
[074/10 flip criteria](../plans/074-opensa-engine/10-integration-flip.md) · results ledger:
[the series](../benchmarks/opensa-engine/2026-07-18-series.md).

## The standing ritual

**The 6-scene sweep runs after EVERY engine change; deltas drive accept/reject** (user rule,
2026-07-15). Every run becomes a row in
[`docs/benchmarks/opensa-engine/2026-07-18-series.md`](../benchmarks/opensa-engine/2026-07-18-series.md) — date,
label, protocol, numbers, verdict. Regression gate: **>10 % on a comparable column fails silently
nothing — it gets investigated or explicitly accepted in the row's note.** Only compare rows taken the
same way (see the DPR caveat below).

## In-game bench (`?bench=`)

The game host runs deterministic scene flights and prints one JSON report per scene. (Until 074/13
phase 5 a `?engine=three` override booted the old WebGL renderer for side-by-side baselines; that
renderer is deleted, so pre-2026-07-18 prod columns in the series can no longer be reproduced.)

```
http://localhost:5173/?bench=all          # the full 8-scene sweep
http://localhost:5173/?bench=country-dusk # one scene
```

Scenes live in `apps/web/src/bench-scenes.ts` (plan 063 protocol — the camera paths are unchanged from
the WebGL era, which is what makes the historical rows comparable): `ls-noon` · `sf-fog-dawn` · `lv-night` · `country-dusk` · `ocean-horizon` · `ls-rain-night`.
Each scene: teleport to the anchor → streaming ring settles → 1.5 s warmup → 15 s camera flight with
per-frame sampling. **Road cars** (841 across the scenes, from vehicles.ide on the NODES.DAT road
graph) register automatically — the realistic vehicle load every row must share; `?benchcar=`
pins one model.

Report line (the deliverable IS this console line):

```
[bench] {"key":"country-dusk","avgMs":8.33,"p95Ms":9.2,"fps":120,"frames":1801,"avgDrawCalls":443,
         "gpuMs":{"pass":2.36,"post":1.07,"probe":0.32,"submit":0.40},"lateCreates":0,
         "residency":"cellIndex 3 · cellVertex 20 · target 345 · texture 758 · uniform 0"}
```

- `gpuMs.pass` — the world pass; the main per-scene comparison column.
- `gpuMs.post` — the post chain, measured as `postEnd − worldEnd` (the raw span is a Metal TBDR
  overlap artifact — begin timestamps fire at vertex start; the plan-09 fix).
- `gpuMs.probe` — **contaminated by the same Metal begin-overlap; judge the env probe ONLY by on/off
  A/B (`?probe=0`), never by this column** (plan-16 lesson).
- `lateCreates` — streaming honesty (074/21): creates inside the fog cut during the measure window;
  0 in a healthy run.
- `residency` — GPU ledger by category, MB; `texture` is the plan-21 accumulation watch.
- `vehicles` — `{live, meanMs, maxMs}`: the vehicle slice of ONE fixed step (081/07 §3) — the raycast
  controllers plus the vehicle system's own fixed update, apart from the solver (`physicsMs`) and from the
  per-frame visual tick (`vehiclesMs` in the `[slow]` line). `live` is the busiest raycast-vehicle count the
  leg saw, because a cost without its car count says nothing. Frames that ran no fixed step are excluded, or
  a catch-up frame would read as a step that cost double.

## The `[slow]` line (frames over 20 ms)

A frame longer than `SLOW_FRAME_MS` prints its CPU breakdown — the stall arrives as a NUMBER, not a theory.
Every block the loop runs is timed (`fixed` · `collision` · `vehicles` · `ped` · `anim` · `props` · `world` ·
`pose` · `paused` · `stream` · `camera` · `render`), and what `dt` still holds after all of them is `other`.

`other` is **not** untimed loop work — since plan 091 the loop times all of it. It is the time BETWEEN
frames: `dt` runs rAF-start to rAF-start, so a frame's length includes every promise continuation, worker
handler and GC pause since the last loop returned. That half reports itself through named spans, drained at
the top of the frame that paid for it, and the line prints the breakdown in brackets:

```
other 223.6 (cell-collision-read 20.3 · vehicle-model:tampa 4.9 · vehicle-osm:tampa 1.2 · unattributed 163.8)
```

Spans today: `vehicle-osm:<model>` (the `.osm` section read + parse) · `vehicle-model:<model>` (the GPU
upload) · `vehicle-spawn:<model>` (the physics body, rig and plate) · `cell-collision-read` (COL parse) ·
`cell-collision-bodies` (Rapier static colliders). **`unattributed` is always printed** — it is GC plus
anything nobody wrapped, and a run that hides it is reporting only the half it can see. To add a span, read
the two rules in [`restrictions/architecture.md`](../restrictions/architecture.md) first.

Full knob reference: [query-parameters.md](query-parameters.md). Useful A/B knobs while measuring: `?scale=0.75` (the ONE perf tier knob), `?aces=0`, `?bloom=0|N`,
`?probe=0`, `?sky=preetham`, `?clouds=N`, `?draw=800..1600` (LOD ring; fog cap follows), `?hour=N`,
`?soak=` (below). The prod host honours the same `?bench=` protocol for side-by-side baselines.

## Soak mode (`?soak=`)

The stability half (074/10 pre-flip ③; criteria from 074/05): does a LONG session stay flat?

```
http://localhost:5173/?soak=30   # minutes; cycles all 6 bench scenes until the deadline
```

Each scene leg (settle + warmup outside the window, 15 s steady flight inside) prints a `[soak]` JSON
line: frames/avg/p95/slow, heap MB (Chromium only), residency + texture MB, cells, late creates, long
tasks (>50 ms, Chromium only). At the deadline a final line carries the **self-judged verdict** — all
checks are relative to the run itself (first vs last quarter), so the verdict is display- and
browser-independent:

| Check              | Fails when                                                           |
| ------------------ | -------------------------------------------------------------------- |
| `coverage`         | fewer than 8 legs (run too short to judge)                           |
| `heapFlat`         | last-quarter heap mean grows past max(200 MB, +25 %)                 |
| `residencyFlat`    | the run's residency peak sits in the last quarter (monotonic growth) |
| `textureFlat`      | same signature on the texture bucket (the LRU must plateau)          |
| `lateBounded`      | late creates exceed ~minutes/5                                       |
| `longTasksBounded` | steady-leg long tasks exceed ~minutes/5                              |
| `frameStable`      | last-quarter p95 median drifts >1.5× the first quarter's             |
| `slowBounded`      | slow frames (>20 ms) exceed 0.5 % of all measured frames             |

The verdict also lands on the debug HUD (`SOAK VERDICT: PASS — …`), which is the **Safari flow**: open
the tab with `?soak=30`, come back in half an hour, read the line (heap/longtask checks report
"skipped" there — the probes are Chromium-only). Judge logic is pure and unit-tested:
`apps/web/src/ui/soak.ts`; the bench/soak leg mechanics are shared in
`apps/web/src/ui/engine-perf-runs.ts`.

## Headless harness (`tools-debug/bench-harness/`)

Runs all of the above in headless Chromium — no human, no screenshots from the user. Two pieces:

The served dir must be an **opensa-pack `--out`**, not a raw game: since opensa-pack plan 003 the engine
host loads the player by name and refuses to boot without it (`player model male01.osm not found — run
opensa-pack over the game dir`).

```bash
# 1. serve the canonical build (an opensa-pack --out under ./build) with Range + CORS + a /__index listing
npm run serve:static      # port 3001, mounts /build → build/

# 2. vite dev server at the repo root
npm run dev

# 3. drive a sweep (DPR=2 = retina-equivalent render targets). ?loader=http-dir reads the served build —
#    the REAL load path (no fake picker); the app loads straight from ?src, no folder step.
SRC="http://localhost:3001/build/original/opensa"
DPR=2 NODE_PATH=$PWD/node_modules node tools-debug/bench-harness/drive.js \
  "http://localhost:5173/?loader=http-dir&src=$SRC&bench=all" sweep 600000 8

# a soak run: TAG switches the captured protocol, expect count is bypassed by the verdict line
DPR=2 TAG='[soak]' NODE_PATH=$PWD/node_modules node tools-debug/bench-harness/drive.js \
  "http://localhost:5173/?loader=http-dir&src=$SRC&soak=30" soak30 2700000 999

# boot-gate checks (074/10): canvas→WebGPU context present, no-WebGPU→sorry screen
node tools-debug/bench-harness/gate-check.js canvas "http://localhost:5173/?loader=http-dir&src=$SRC" gate
node tools-debug/bench-harness/gate-check.js sorry  "http://localhost:5173/" sorry
```

How it works (plan 079 phase 3): `?loader=http-dir&src=<served build>` runs the game through the REAL
load path — `fetchInstallSource` reads the served dir's `/__index` + files over HTTP Range, exactly as
`serve-static` exposes them, so the harness exercises the shipping loader instead of a fake
`showDirectoryPicker` (the surrogate that once shadowed a whole class of load bug). WebGPU needs
`--enable-unsafe-webgpu --enable-features=WebGPU --use-angle=metal` (already in the scripts).

**Gotchas** (learned the hard way, keep them):

- **Headless 1× is NOT pass-comparable to the user's 2× retina display rows** — and a 1× A/B once
  missed a 30–40 % display-only night cost (the plan-16 SSR lesson — that feature was rolled back). `DPR=2` closes the render-target
  gap (verify: screenshot is 2880×1800, HUD `target` ~345 MB vs 92 at 1×), but **user-display rows
  remain the sign-off standard** for per-pixel features.
- The engine honours `?hour=`; prod ignores it (F2 menu there). The in-game clock keeps running — read
  the corner clock on screenshots.
- Scene-teleport frames (physics catch-up giants in `[slow]` logs) sit OUTSIDE the measured windows —
  the known settle pattern, not a regression.
- Screenshot metering: no PIL/numpy on the Mac python — use ImageMagick (`magick` in /opt/homebrew/bin)
  crop + `-resize 1x1!` grid averages; compare channels, not just luma.
- **Do not edit anything in the Vite module graph while a run is in flight.** Saving a file under
  `apps/` (a `.test.ts` counts) reloads the page, and the harness ends the run wherever it got to — with
  exit code 0 and no `run complete` line, so the log looks like a short run rather than a broken one. Cost
  a 12-scene 096/08 measurement that stopped at 4. Edit between runs, or read the log for `run complete`
  before trusting a count.
- **A run that straddles a machine SLEEP is void.** Every frame time across the gap is wall clock, not
  work, and the run continues afterwards as if nothing happened. Kill it (`pkill -f bench-harness/drive.js`)
  and start again — there is no way to repair the numbers, and the served/dev servers do survive, so only
  the run has to be restarted.
- **`expectReports` must equal the number of protocol lines the run will actually emit.** Set it higher
  and the harness waits out its whole timeout after the run has finished; a `[video]` run emits one line
  per scene AND repeats them all in the end-of-run dump, so dedupe by scene when reading.
- **macOS has no `timeout(1)`.** Wrapping a run in it — `timeout 900 node …/drive.js …` — does not cap
  anything: the shell fails with `command not found` and exit 127 before the harness ever starts, which
  reads exactly like the harness dying at launch. Use `drive.js`'s own budget argument (the millisecond
  value after the tag) instead; there is nothing to wrap.

## Unit / e2e lanes

- `npm test` — Vitest units (node, headless, no assets). Perf-relevant suites: `soak.test.ts` (the
  judge), `bench.test.ts`, `perf-monitor.test.ts`, `webgpu-gate.test.ts`. Cost rule: run only the
  affected test file for small changes.
- `npm run test:fixtures` — regenerates real-asset fixtures from a GTA copy (see
  [test-coverage.md](test-coverage.md)); a real asset becomes a one-line manifest entry — never
  hand-build fake DFF/TXD.
- `npm run e2e` — the Playwright browser lane, separate from `npm test` (see [e2e.md](e2e.md)).
