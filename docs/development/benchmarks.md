# Benchmarks, soak & the perf ritual

How the own-engine game is performance-tested: the in-game **bench sweep** (speed), the **soak mode**
(stability over time), and the **headless harness** that runs both without a human at the screen.
Chain context: [074/11 performance testing](../plans/074-opensa-engine/11-performance-testing.md) ·
[074/10 flip criteria](../plans/074-opensa-engine/10-integration-flip.md) · results ledger:
[bench/series.md](../plans/074-opensa-engine/bench/series.md).

## The standing ritual

**The 6-scene sweep runs after EVERY engine change; deltas drive accept/reject** (user rule,
2026-07-15). Every run becomes a row in
[`docs/plans/074-opensa-engine/bench/series.md`](../plans/074-opensa-engine/bench/series.md) — date,
label, protocol, numbers, verdict. Regression gate: **>10 % on a comparable column fails silently
nothing — it gets investigated or explicitly accepted in the row's note.** Only compare rows taken the
same way (see the DPR caveat below).

## In-game bench (`?bench=`)

The game host runs deterministic scene flights and prints one JSON report per scene. (Until 074/13
phase 5 a `?engine=three` override booted the old WebGL renderer for side-by-side baselines; that
renderer is deleted, so pre-2026-07-18 prod columns in the series can no longer be reproduced.)

```
http://localhost:5173/?bench=all          # the full 6-scene sweep
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

```bash
# 1. serve a game install (the play profile) with Range + CORS
node tools-debug/bench-harness/game-server.js /path/to/NO_COMMIT/optimized 8787

# 2. vite dev server at the repo root
npm run dev

# 3. drive a sweep (DPR=2 = retina-equivalent render targets)
DPR=2 NODE_PATH=$PWD/node_modules node tools-debug/bench-harness/drive.js \
  "http://localhost:5173/?bench=all" http://localhost:8787 sweep 600000 6

# a soak run: TAG switches the captured protocol, expect count is bypassed by the verdict line
DPR=2 TAG='[soak]' NODE_PATH=$PWD/node_modules node tools-debug/bench-harness/drive.js \
  "http://localhost:5173/?soak=30" http://localhost:8787 soak30 2700000 999

# boot-gate checks (074/10): canvas→WebGPU context present, no-WebGPU→sorry screen
node tools-debug/bench-harness/gate-check.js canvas "http://localhost:5173/" http://localhost:8787 gate
node tools-debug/bench-harness/gate-check.js sorry  "http://localhost:5173/" http://localhost:8787 sorry
```

How it works: `drive.js` replaces `window.showDirectoryPicker` with a fake directory-handle tree built
from the server's `/__index`; file `slice()` maps to HTTP Range reads (the 1.3 GB gta3.img is never
buffered). WebGPU needs `--enable-unsafe-webgpu --enable-features=WebGPU --use-angle=metal` (already in
the scripts). It also swallows the IndexedDB `DataCloneError` from persisting the fake handle.

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

## Unit / e2e lanes

- `npm test` — Vitest units (node, headless, no assets). Perf-relevant suites: `soak.test.ts` (the
  judge), `bench.test.ts`, `perf-monitor.test.ts`, `webgpu-gate.test.ts`. Cost rule: run only the
  affected test file for small changes.
- `npm run test:fixtures` — regenerates real-asset fixtures from a GTA copy (see
  [test-coverage.md](test-coverage.md)); a real asset becomes a one-line manifest entry — never
  hand-build fake DFF/TXD.
- `npm run e2e` — the Playwright browser lane, separate from `npm test` (see [e2e.md](e2e.md)).
