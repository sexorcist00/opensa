# Concept: WebGPU migration

**Question:** can moving the OpenSA renderer from WebGL2 to WebGPU break the CPU draw-call wall and turn OpenSA
into a genuinely AAA-capable browser engine?

**Status:** Phase 0 spike **ran → ✅ GO** (2026-07-11). Render bundles cut per-frame draw submission ~6× and move
the heavy per-draw material cost to record-time; WebGPU *without* bundles regresses vs WebGL (bundles are the whole
win). Numbers + full verdict in [phase-0-spike-checklist.md](phase-0-spike-checklist.md). Next: Phase 1, gated on
proving per-cell bundle invalidation stays smooth during streaming.

---

## TL;DR — honest verdict up front

| | |
|---|---|
| **Does it target the real bottleneck?** | **Yes.** The wall is CPU draw-call submission (65 ms/frame, 92 %). WebGPU render bundles + lower driver overhead attack it directly, without touching the art. Nothing else we tried does. |
| **Expected upside** | Realistically **2–4×** frame-rate on the CPU-bound scenes (≈13 fps → ≈30–50 fps), by collapsing the ~65 ms submission cost to single-digit ms. Then we become GPU-bound (~32 fps floor today) — which further work (fewer triangles, cheaper post-FX) can lift. |
| **Cost** | **Large.** A near-total rewrite of the rendering layer: renderer swap, **all custom shaders → TSL** (~2 300 lines of GLSL across 7 files, 5 `onBeforeCompile` patch sites), and the **entire post-FX stack** (currently the WebGL-only `postprocessing` lib) rebuilt on three's WebGPU node post-processing. Estimate: **many weeks, plausibly 2–3 months** of focused work. |
| **Biggest risks** | (1) three.js WebGPU **render-bundle** maturity / whether it auto-applies to a streaming scene; (2) TSL re-implementation of the complex `world-material` (sun/CSM/night/fog/emissive) being pixel-faithful; (3) no drop-in WebGPU replacement for **god-rays / SSAO / SMAA** from `postprocessing`. |
| **Recommendation** | **Worth a time-boxed spike, not a blind commit.** Do [Phase 0](04-migration-plan.md#phase-0--the-spike-1-2-weeks) first: a throwaway branch that renders the *static world only* (one TSL material, no post-FX) under WebGPU with render bundles, and **measure the draw-submission ms**. If it collapses as predicted → green-light the full migration. If render bundles don't deliver in three 0.177 → stop, cheap. |

This is the only direction in the whole investigation that both **fixes the problem at its root** and **doesn't
require sacrificing visual quality**. But it is a real engine rewrite — go in with the spike, eyes open.

---

## The documents

1. [01-bottleneck.md](01-bottleneck.md) — the measured problem: what exactly is eating the frame, and why asset-side fixes can't touch it.
2. [02-current-render-stack.md](02-current-render-stack.md) — full inventory of what we'd have to port (renderer, materials, shaders, post-FX, shadows).
3. [03-webgpu-mechanism.md](03-webgpu-mechanism.md) — how WebGPU / three.js WebGPURenderer / TSL / render bundles actually remove the wall.
4. [04-migration-plan.md](04-migration-plan.md) — the phased, step-by-step plan (spike first, then material-by-material).
5. [05-risks-and-verdict.md](05-risks-and-verdict.md) — every risk, what would kill the project, and the final honest go/no-go.
6. [06-bake-vs-pass.md](06-bake-vs-pass.md) — fixed decision: which effects bake into the format, which shade in the material, which stay a fullscreen pass.
7. [phase-0-spike-checklist.md](phase-0-spike-checklist.md) — the actionable Phase-0 spike: concrete tasks, the exact numbers to capture, and the GO/NO-GO criteria.
