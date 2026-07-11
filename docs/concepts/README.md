# Concepts

Exploratory design docs for large, not-yet-committed directions — research + honest go/no-go before any code.
A concept graduates to `docs/plans/` only once we decide to build it; its research record then MOVES into the
plan folder (concepts holds only live explorations and post-mortems).

## Moved after graduation

- **webgpu-migration** → [docs/plans/073-webgpu-migration-threejs/concept/](../plans/073-webgpu-migration-threejs/concept/README.md) —
  the research record of the three-WebGPU attempt (spikes, Babylon comparison, upstream issue draft, the full
  phase-1 chronology). The chain itself **FAILED on three.js's side**; see the
  [073 readme](../plans/073-webgpu-migration-threejs/readme.md) for the verdict.
- **opensa-engine** → [docs/plans/074-opensa-engine/00-concept.md](../plans/074-opensa-engine/00-concept.md) —
  the own-framework concept (own WebGPU renderer + native formats, 60 fps target), now the
  [074 chain](../plans/074-opensa-engine/readme.md).

## Parked

- [modern-cell-tooling-postmortem](modern-cell-tooling-postmortem.md) — the parked modern-cell tooling experiment
  (no perf/quality gain; code on `backup/tooling-experiment`) + the OPEN strip-lods double-load task.

## Background: how these connect

The 2026-07 **modern-cell tooling experiment** (`docs/plans/066-pmb-modern-tool` + `tools/opensa-lod-generator`
plans 005–010) was parked with no measurable gain — but produced the **diagnosis**
([01-bottleneck](../plans/073-webgpu-migration-threejs/concept/01-bottleneck.md)): the engine is CPU-bound on
draw-call submission, and the wall is the WebGL/three.js per-draw cost, not the art. That spawned the
**webgpu-migration** attempt (073 — failed inside three's WebGPU backend), whose forensic campaign in turn
proved the browser itself is NOT the limit — leading to the **own engine** direction (074), where the 066
format/batching ideas return as the data pillar of a renderer we fully own.
