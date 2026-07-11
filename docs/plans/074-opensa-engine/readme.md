# 074 — OpenSA engine (own WebGPU framework + native formats) — chain umbrella

**Goal: 60 fps on M3-class hardware with the FULL current WebGL effect set, on the same world data.**
Graduated from the [00-concept](00-concept.md) research record after the
[073 three-WebGPU migration](../073-webgpu-migration-threejs/readme.md) FAILED on three's side. Every design
decision below traces to a 073 field measurement — this chain exists because we now know exactly what the
browser can do (Babylon snapshot 0.12 ms CPU @ 15k draws; vanilla SA 100+ fps on this GPU) and exactly what
killed the framework attempt (per-object pipelines, lazy compiles, naga codegen traps, retained-memory
pressure, black-box GPU time).

**WebGPU only.** No WebGL backend, no abstraction tax. The intact three-WebGL prod path IS the fallback for
non-WebGPU browsers during the whole build-out (additive, no flag day — the 066 ground rule).

## The chain

| #   | Plan                                                   | One-liner                                                                                  |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 01  | [Framework architecture](01-framework-architecture.md) | The renderer design: module map, bind model, frame graph, shader system, extension points. |
| 02  | [Native formats](02-native-formats.md)                 | `.oscell` / `.ostex` / `.ospak` — GPU-ready, versioned, batching + texture arrays + alpha. |
| 03  | [Converter tool](03-converter-tool.md)                 | `tools/opensa-pack`: game-ready set → native pak; the ALPHA PIPELINE lives here (early).   |
| 04  | [Engine lab + P0 gate](04-engine-lab-p0.md)            | `apps/engine-lab`: the vertical-slice spike, bench parity, numeric gates, Safari check.    |
| 05  | [Streaming runtime](05-streaming-runtime.md)           | Cell lifecycle, worker IO, range reads, GPU residency/eviction — the memory model.         |
| 06  | [World effects parity](06-world-effects-parity.md)     | Effect-by-effect WGSL ledger: sun/fog/sky/lights/emissives/wind/water, each measured.      |
| 07  | [Baked channels](07-baked-channels.md)                 | Static shadows + AO/skyVis + emissive mask — 066/03-04 executed against the new target.    |
| 08  | [Dynamics](08-dynamics.md)                             | Skinning (EARLY probe), character + IFP, vehicles, particles, procobj instancing.          |
| 09  | [Post-FX & AA](09-postfx-aa.md)                        | MSAA+A2C, bloom, ACES, god-rays; render-scale tiers.                                       |
| 10  | [Integration & flip](10-integration-flip.md)           | Boundary refactor, game-app integration, flip criteria, 073-flags cleanup decision.        |

## Roadmap — vertical slices with numeric gates (plans ≠ phases; each milestone cuts across plans)

| Milestone                          | Cuts through                                                                                                                                                            | Gate (numbers, not vibes)                                                                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0 — vertical slice** (~1–2 wks) | 01+02+03+04 minimal: format v0 (batching + texture arrays + alpha pipeline), converter for ONE district, renderer core (opaque + cutout + flat sky), HUD+GPU timestamps | district @2× retina **<5 ms GPU, <1 ms submit**; **alpha fringe visually dead** (vgsebushes/fences); boots in Safari TP                             |
| **M1 — streaming proof**           | 04+05 full: worker IO, range reads, cell lifecycle, stress harness                                                                                                      | ls-noon flythrough (SAME camera path as the WebGL bench): **no frame >20 ms during swaps**, cold start < WebGL prod, **JS heap flat** while driving |
| **M2 — world parity**              | 06+07: all world effects + baked channels                                                                                                                               | bench scenes visually ≥ WebGL prod (screenshot compare); **fps ≥ 2× WebGL prod** on every scene                                                     |
| **M3 — dynamics**                  | 08: character walks/drives in the lab                                                                                                                                   | playable; skinning ≤1 ms CPU+GPU                                                                                                                    |
| **M4 — ship**                      | 09+10: post chain, integration, tiers                                                                                                                                   | **60 fps ls-noon @2× retina M3 Pro**; better than WebGL prod on EVERY bench scene → default flip                                                    |

An M0 failure is a cheap, honest answer — that is the point of gating first.

## Ground rules (carried from 066 + hard 073 lessons)

1. **Additive.** New app (`apps/engine-lab`), new package (`packages/engine`), new tool (`tools/opensa-pack`);
   the prod web app and its tool chain are untouched. `packages/engine` must not import from `packages/game`
   or three — the boundary is enforced by nx tags from day one.
2. **The converter consumes the FINAL game-ready set** (post map-optimizer / lod-generator / installer — the
   exact files the prod web app loads). Existing tools never learn about the new format.
3. **No lazy anything on the hot path.** Every pipeline compiles behind the load veil; every buffer/texture is
   created at cell load; the steady-state frame allocates zero (JS and GPU). Cold-start storms and GC-vs-GPU
   ambiguity are 073 wounds — designed out, not fixed later.
4. **Measure or it didn't happen.** GPU timestamp queries + the frame-segment HUD land in M0 before the first
   effect. Every plan doc keeps a measurement ledger (the standing rule).
5. **Format versioned from day one** (magic + version + optional-channel bitmask); v0 is explicitly throwaway;
   readers reject unknown majors loudly.
6. **Budget guards in the tool** (bytes/draws per cell, determinism with fixed seeds) — pmb spirit.
7. **Effects are uniform-gated where possible, variants where necessary** — the `uPipelineMix` pattern worked;
   variant explosion is the enemy (pipelines stay enumerable, target: dozens).

## What we reuse (nothing starts from zero)

- **Parsers**: `@opensa/renderware` (DFF/TXD/COL/IPL/IDE/IFP) — the converter is mostly composition.
- **Bake stack**: map-optimizer prelight (day+night), opensa-lod-generator cell-LODs (QEM chain, prelit/2dfx
  transplant), lod-trees/procobj atlases — all feed the converter unchanged.
- **Math already ported in 073**: world material (classic+modern), fog, moon, pool-as-texture, sky-lite arcs.
- **Streaming design**: rings/hysteresis/atomic-swap semantics (plan 060) — reimplemented thin, three-free.
- **Instrumentation**: the 073 HUD (frame/fixed/update/unaccounted/heap/longtasks) + bench scenes/paths.
- **The alpha-edge groundwork**: dilation BFS + DXT software decode exist from the
  [open issue](../../open-issues/alpha-edge.md).

## Decision log

- 2026-07-11 — chain created; WebGPU-only; texture ARRAYS over atlases (GTA UVs tile — measured −7 % on atlases);
  two-level LOD system kept as-is (already cell-based; the converter only re-groups its output).
