# Concepts

Exploratory design docs for large, not-yet-committed directions — research + honest go/no-go before any code.
A concept graduates to `docs/plans/` only once we decide to build it.

## Parked

- [webgpu-migration](webgpu-migration/) — move the renderer off WebGL2 onto WebGPU to break the CPU draw-call wall.
  **Parked 2026-07-11:** the synthetic spikes said GO, but three r185's WebGPU renderer failed the real streaming
  workload (bundle transform baking + per-InstancedMesh pipeline compiles). Yielded the three 0.185 upgrade + WebGL
  shadow fixes. Resume conditions in [webgpu-migration/phase-1-findings.md](webgpu-migration/phase-1-findings.md).
- [modern-cell-tooling-postmortem](modern-cell-tooling-postmortem.md) — the parked modern-cell tooling experiment
  (no perf/quality gain; code on `backup/tooling-experiment`) + the OPEN strip-lods double-load task.

## Background: why these exist

The 2026-07 **modern-cell tooling experiment** (native `.cell` format, baked shadows, static batching / atlas —
`docs/plans/066-pmb-modern-tool` + `tools/opensa-lod-generator` plans 005–010) was **parked with no measurable
perf or quality gain**. It is preserved on the `backup/tooling-experiment` git branch, not deleted.

The experiment's real value was the **diagnosis** it produced (see [webgpu-migration/01-bottleneck.md](webgpu-migration/01-bottleneck.md)):
the engine is **CPU-bound on draw-call submission**, and no amount of asset-side work (batching, atlasing, LOD
merging) moves that wall — because the wall is the WebGL/three.js submission cost per draw, not the art. The only
lever that attacks it at the root is a **rendering-API change**, which is what `webgpu-migration` researches.
