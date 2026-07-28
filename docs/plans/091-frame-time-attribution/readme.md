# 091 — Frame-time attribution: giving `other` a name

**Status: SHIPPED 2026-07-28 (all three phases).** No fix was written — the plan only makes the frame's
unaccounted time say what it is, and phase 3 names the next step from the numbers rather than assuming it.

## Why

Slow frames of 19–225 ms have been reported since 2026-07-27 with the whole cost landing in one bucket:

```
other = dt*1000 − (fixed + collision + anim + vehicles + ped + stream + camera + render + blob)
```

`apps/web/src/ui/engine-canvas-host.tsx` — a **residual**, not a measurement. Its own comment admitted it: *"it
used to be most of a slow frame's length with nothing to name it"*.

The leading suspect used to be `vehicle-model-builder`, whose promise resolved straight out of a worker
`onmessage`. **That suspect no longer exists** — the builder and its worker were deleted with the runtime DFF
fallback ([postmortem](../../postmortem/runtime-modloader-overlay.md)), for correctness reasons, not because
anything was measured. **The spikes remained** (measured below), so the deletion answered nothing about them.

The standing rule this plan exists to obey: **measure first, fix second** — fixing the unmeasured cost a whole
session in 081/02.

## The finding that shapes the whole plan

`dt` is wall-clock between the **starts** of consecutive rAF callbacks. So `other` contains two very
different things:

1. untimed work **inside** the loop — small, and closable;
2. everything the browser did **between** frames — GC, worker `onmessage`, promise continuations, upload
   callbacks, event handlers.

**No timer placed inside the loop can see (2).** It is outside the region any in-loop timer spans. Since (2)
is where a resolved spawn is paid, a phase-1-only plan would produce a tidy breakdown that is silent about the
actual hole. Both phases were needed; phase 2 is the one that answered the question.

## Restrictions checked (per `CLAUDE.md`)

- [`restrictions/architecture.md`](../../restrictions/architecture.md) — the recorder is `type:engine`
  (`packages/engine`), so `apps/web` (`type:app`) may import it and so may the game layer. **This plan added a
  restriction of its own** to that file: a span may only wrap SYNCHRONOUS work that runs BETWEEN frames.
- The recorder is CPU-side only; nothing here touches WGSL, so
  [`restrictions/gpu-and-shaders.md`](../../restrictions/gpu-and-shaders.md) does not apply.
- `CLAUDE.md`: every figure produced went into
  [`docs/benchmarks/opensa-engine/2026-07-28-headless-091-frame-attribution.json`](../../benchmarks/opensa-engine/2026-07-28-headless-091-frame-attribution.json)
  before it was analysed, with the pak build recorded.

## Phase 1 — close the in-loop gaps ✅

Four named groups in `engine-canvas-host.tsx`: `props` (felled props), `world` (weather / environment driver /
zones / city / the time emit), `pose` (`viewOf`, the seated/riding lookups, the render-pose lerp) and `paused`
(the pause housekeeping).

**Measured, headless `?bench=all`, 2026-07-28:** all four are **0.00–0.20 ms** on every slow frame in the run,
including the 576 ms boot frame. They were never the residual — which is what phase 1 exists to establish.

**Two defects in the line itself came out of this phase, both of which had to be fixed before `other` meant
anything:**

- **The breakdown mixed two intervals.** `dt` is the interval that ENDED at this frame's start (the previous
  body plus the gap after it), while every block timer was this frame's. On steady frames the two are
  interchangeable; on the frames that matter they are not. It printed a **25.1 ms `stream` block inside a
  21.6 ms frame, and a residual of −7.2 ms**. The line now describes ONE interval: a `past` snapshot of the
  previous body, the spans drained at the top of this frame (that gap's own work), and this frame's blob time
  (the worker handler ran in that same gap).
- **`dt` is clamped at 250 ms** (`Math.min(0.25, …)` — the simulation must not integrate a hitch), and the line
  printed the clamp. The worst frame in the whole record read `250.0` when it was **576.1 ms**: a third of it
  was hidden inside a number that looked merely bad. The line now prints the real elapsed interval and names
  the clamp (`frame 576.1 (sim dt 250)`).

## Phase 2 — named spans for out-of-loop work ✅

`packages/engine/src/debug/frame-spans.ts` — a shared recorder (`frameSpans`): async work times its
SYNCHRONOUS segments into a named span, and the loop **drains** the totals at the top of the next frame, which
is the frame that paid for them. Nested spans keep their own self-time so nothing is counted twice; a span
that throws is still recorded.

The spans that exist, and where they had to be opened:

| Span | Where | What it is |
| --- | --- | --- |
| `vehicle-osm:<model>` | `GtaSaWorldAdapter.loadVehicleData` | the `.osm` section read + parse |
| `vehicle-model:<model>` | `engine-vehicles.buildModel` | `createVehicleModel` — the GPU upload |
| `vehicle-spawn:<model>` | `engine-vehicles.spawnVehicle` | the per-instance tail: physics body, rig, plate |
| `cell-collision-read` | `GtaSaWorldAdapter.loadCellColliders` | the cell's COL parse + procobj colliders |
| `cell-collision-bodies` | `CollisionStreamingSystem.load` | `createStaticColliders` in the `.then()` |

Two entries from the plan's original list are **not** there, deliberately: `cell-create` and `texture-upload`
run INSIDE `driver.update()` and are already inside `stream`; a span there would be subtracted twice. `pak-read`
is already timed as `blob` (the worker handler times itself, since 2026-07-27). `ped-load` has no runtime path
at all — peds are not streamed; the player's model is built once at boot.

The line now reads (a class with more than one member collapses to its total and its worst member — a boot
frame opens ninety spans and ninety names is a line nobody reads; nothing is dropped):

```
other 482.8 (vehicle-model ×43 97.9 (worst sadler 7.2) · cell-collision-read 78.3 ·
             vehicle-osm ×43 63.2 (worst vincent 7.8) · cell-collision-bodies 21.2 · unattributed 222.2)
```

### Measured — before / after, same pak (`buildTime 08:41 24-07-2026`), same host

| Frame | before 091 | after 091 |
| --- | --- | --- |
| boot | `frame 250.0 · other 223.6` — one anonymous number | `frame 576.1 (sim dt 250) · other 482.8` = model 97.9 + COL 78.3 + osm 63.2 + bodies 21.2 + **unattributed 222.2** |
| teleport (lv-night) | not decomposable | `frame 222.1 · other 194.8` = osm 59.2 + model 30.2 + COL 19.0 + bodies 7.5 + **unattributed 78.9** |
| boot settle | `other 14.7` | `other 12.2` = `vehicle-spawn ×49 8.2` + unattributed 4.0 |

The intermediate run with only three spans left **163.8 ms unattributed** on the boot frame; adding the two
adapter-side spans (`vehicle-osm`, `cell-collision-read`) took it to 49.0 on the equivalent frame. That is the
whole method in one line: every span was written because the previous run said where the hole was.

All three runs — before, intermediate, after — are recorded in the benchmark file (`priorRuns` carries the
first two), same pak and host, so the progression is checkable rather than narrated. **`250.0` in the before
row and `576.1` in the after row are the SAME frame**: the first printed the clamp.

| Run | boot-frame `other` | named | `unattributed` |
| --- | --- | --- | --- |
| before (no spans) | 223.6 (of a frame reported as 250.0) | — | all of it |
| three spans | 223.6 | 59.8 | 163.8 |
| five spans (final) | 482.8 (of the real 576.1) | 260.6 | 222.2 |

**The averages of the same sweep**: all eight scenes at the headless 120 Hz cap (8.33 avgMs, p95 9.2–9.3,
`lateCreates` 0), gpu pass at or below the 07-27 row — the instrumentation costs nothing measurable.

## Phase 3 — decide, having measured ✅

**1. The spikes are NOT the deleted builder.** They survived its removal unchanged; the plan's premise held.

**2. The gameplay-relevant cost is per NEW CAR TYPE, and it has two halves**, both one-off per type:

- `vehicle-osm` — reading and parsing the `.osm`: typical 0.4–2 ms, **worst single 20.5 ms (`bus`)**
- `vehicle-model` — the GPU upload: typical 0.5–2 ms, **worst single 18.2 ms (`tahoma`)**

A single unlucky type can therefore cost ~25 ms in one frame — a visible hitch, on a frame budget of 8.3.
That is the actionable number this plan was written to produce.

**3. The teleport/boot shape (27–43 types at once, 200–576 ms) is a BENCH shape**, not a play shape: the sweep
changes city in one frame. Its usefulness is as an amplifier — it is where the per-type costs were measured.

**4. `unattributed` is still 40–55 % of a spike** (78.9–222.2 ms), and it is **100 %** of the two frames that
FOLLOW a teleport (68.2 and 38.9 ms with no span open at all). Nothing is running there that the game asked
for — that is the GC signature, paid after ~30 car models and a city of cells were allocated and freed. It is
an answer, as the plan said it would be, not a failure.

### What the numbers name as the next step (not started, not pre-written)

- **If the field says a new car type hitches**: the lever is a BUDGET on the per-type work, the same shape the
  texture-upload fix took (`UPLOAD_BUDGET_MS`) — spread `vehicle-osm` + `vehicle-model` over frames instead of
  paying a whole type in one. The numbers say the ceiling is ~25 ms for the worst type, ~4 ms for a typical one.
- **If the GC tail is what is felt**: the question is allocation, not scheduling — what a spawn and a cell
  create allocate per unit — and it needs an allocation profile, not another span.
- **Neither is worth doing on a bench frame alone.** The measured windows of all eight scenes are clean
  (p95 9.2–9.3 ms, `lateCreates` 0). The next input is a FIELD verdict on a drive that meets new car types.

## Out of scope (held)

- Any change to how work is scheduled. This plan added measurement and nothing else.
- The GPU-side timings (`gpuPassMs`/`gpuPostMs`/`gpuProbeMs`) — already reported and not part of the residual.

## Harness note

`tools-debug/bench-harness/drive.js` clicked its run button before React had rendered the menu, so `count()`
read 0, the click was silently skipped and the run timed out 240 s later on a canvas nobody had asked for.
It now waits for the button. Any harness run before 2026-07-28 that "hung at boot" was probably this.
