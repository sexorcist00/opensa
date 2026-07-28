# 091 — Frame-time attribution: giving `other` a name

**Status: authored 2026-07-28, unstarted.** No code, no fix — this plan only makes the frame's unaccounted
time say what it is. Whether anything needs fixing afterwards is a question this plan is not allowed to
answer in advance.

## Why

Slow frames of 19–225 ms have been reported since 2026-07-27 with the whole cost landing in one bucket:

```
other = dt*1000 − (fixed + collision + anim + vehicles + ped + stream + camera + render + blob)
```

`apps/web/src/ui/engine-canvas-host.tsx` — a **residual**, not a measurement. Its own comment admits it: *"it
used to be most of a slow frame's length with nothing to name it"*.

The leading suspect used to be `vehicle-model-builder`, whose promise resolved straight out of a worker
`onmessage`. **That suspect no longer exists** — the builder and its worker were deleted with the runtime DFF
fallback ([postmortem](../../postmortem/runtime-modloader-overlay.md)), for correctness reasons, not because
anything was measured. So the spikes may or may not remain, and there is now one fewer hypothesis and still
zero data. `docs/benchmarks/opensa-engine/2026-07-27-ingame-after-texture-upload-fix.json` still names the
builder as the suspect; that note is historical.

The standing rule this plan exists to obey: **measure first, fix second** — fixing the unmeasured cost a whole
session in 081/02.

## The finding that shapes the whole plan

`dt` is wall-clock between the **starts** of consecutive rAF callbacks. So `other` contains two very
different things:

1. untimed work **inside** the loop — small, and closable;
2. everything the browser did **between** frames — GC, worker `onmessage`, promise continuations, upload
   callbacks, event handlers.

**No timer placed inside the loop can see (2).** It is outside the region any in-loop timer spans. Since (2)
is where a resolved spawn is paid — the standing worker-handoff rule says work from a worker is paid in the
frame loop, not in the handler — a phase-1-only plan would produce a tidy breakdown that is silent about the
actual hole. Both phases are needed; phase 2 is the one that answers the question.

## Restrictions checked (per `CLAUDE.md`)

- [`restrictions/architecture.md`](../../restrictions/architecture.md) — the recorder is `type:engine`
  (`packages/engine`), so `apps/web` (`type:app`) may import it and so may the engine itself. It must NOT
  live in `apps/web` if engine-internal work (cell create, texture upload) is to report into it.
- The recorder is CPU-side only; nothing here touches WGSL, so
  [`restrictions/gpu-and-shaders.md`](../../restrictions/gpu-and-shaders.md) does not apply.
- `CLAUDE.md`: every figure produced goes into `docs/benchmarks/` **before** it is analysed, and the pak build
  it was read against is recorded. The vehicle slice repeats to ±5 % — a single pair of numbers is not a
  finding.

## Phase 1 — close the in-loop gaps

Make `other` mean exactly one thing ("time between frames") by timing what the loop still does untimed.
Named groups, in `engine-canvas-host.tsx`:

| Group | What it covers | Lines today |
| --- | --- | --- |
| `props` | `props.update()` — felled props following their bodies | 1291 |
| `world` | `weatherTransition.tick`, `environmentDriver.apply`, `clearMapViewerFog`, `zoneSystem`, `citySystem`, the `time` emit | 1298–1312 |
| `pose` | `viewOf()`, `activeVehicle()`/`ridingVehicle()`, the render-pose lerp | 1317–1329 |
| `paused` | `onPaused()` | 1314 |

Expect these to be small. That is the point: phase 1 is not a hunt, it is removing the excuse that the
residual might be in-loop work.

**Verification.** The `[slow]` line prints the four new groups; on a healthy frame their sum is under a
millisecond. **Record the before/after shape of `other` on the same scene** into the plan.

## Phase 2 — named spans for out-of-loop work

A small recorder in `packages/engine`: async work opens a named span, the frame loop **drains** it at the top
of the next frame and attributes the total to the frame that actually paid for it.

Spans to open (the work that runs outside the loop today):

- `vehicle-spawn:<model>` — `loadVehicleData` → `.osm` read → `createVehicleModel`
- `ped-load` — the ped equivalent
- `cell-create` — the streaming driver's cell build
- `texture-upload` — the resumable array upload drain
- `pak-read` — the pak worker's range reads

The `[slow]` line becomes:

```
other 225 (vehicle-spawn:previon 180 · cell-create 31 · unattributed 14)
```

**`unattributed` stays, always.** It is GC plus anything nobody wrapped. If it is still holding 200 ms after
all five spans exist, the answer is "GC" — and that is an answer, not a failure.

**Verification.** Boot the harness (`tools-debug/bench-harness`, `?loader=http-dir`) on a scene that spawns a
NEW vehicle type, and capture the `[slow]` lines. Numbers into `docs/benchmarks/` with the pak build recorded,
then into this plan.

## Phase 3 — decide, having measured

Only now: is there anything to fix? Possible outcomes, none of them assumed —

- the spikes are gone with the builder (then this plan closes as an instrument, which is a fine outcome);
- they are one named span (then that span gets its own plan, with a number in hand);
- they are `unattributed`/GC (then the question is allocation, not scheduling).

**Do not pre-write the fix.** The plan is finished when the numbers exist and the next step is named by them.

## Out of scope

- Any change to how work is scheduled. This plan adds measurement and nothing else.
- The GPU-side timings (`gpuPassMs`/`gpuPostMs`/`gpuProbeMs`) — already reported and not part of the residual.
