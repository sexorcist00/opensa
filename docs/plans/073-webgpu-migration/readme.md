# 073 — WebGPU migration (chain umbrella)

**Status: 🚧 ACTIVE (graduated from `docs/concepts/webgpu-migration/` on 2026-07-11).** The concept's make-or-break
bets are field-proven; this chain turns the working spike into a real renderer mode.

## Where we actually are (validated baseline)

Static render bundles **work in the real engine** behind `?webgpu=1&bundle=1` (three 0.185.1 +
`patches/three+0.185.1.patch`): fast initial load, live camera, smooth driving, **render CPU ~13 ms vs the 65 ms
WebGL baseline (5×)** — frozen floor ~5 ms. The composed streaming pipeline: budgeted appearance (`?appear=N`,
default 8; atomic behind the boot veil) → chunked wrap into ≤64-object `BundleGroup`s (one chunk/frame) →
heartbeat keeps shared camera groups uploading. Non-block-aligned DXT decodes to RGBA (WebGPU strictness).
Full chronology: [concept findings](../../concepts/webgpu-migration/phase-1-findings.md).

## Concept audit — what survived, what changed

| Concept doc          | Verdict                                                                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 bottleneck        | ✅ Valid — the diagnosis held exactly (draw submission wall; bundles collapse it).                                                                                                       |
| 02 port surface      | ⚠️ Partially outdated: world material EXISTS in TSL (classic+sun, cached); the rest of the inventory (sky/water/particles/post-FX/dynamics) still accurate — it is this chain's backlog. |
| 03 mechanism         | ✅ Validated, amended: bundles need OUR three patch (needsRefresh order, version-sync, heartbeat) until upstream lands.                                                                  |
| 04 migration plan    | ❌ Superseded by this chain (phases played out differently: bundles came FIRST, materials follow).                                                                                       |
| 05 risks             | ✅ Outcomes recorded; R1 materialized and was beaten by the patch.                                                                                                                       |
| 06 bake-vs-pass      | ✅ Standing decision — drives plan 07 (post-FX) + ties back to the parked 066 tooling (baked AO).                                                                                        |
| 07 Babylon           | ✅ Closed: not justified (global snapshot reset ~50 ms/swap; WebGL 3× worse).                                                                                                            |
| upstream-issue-draft | → action item, plan 01.                                                                                                                                                                  |

## The chain (priority order)

| #   | Plan                                                 | Priority | One-liner                                                                                     |
| --- | ---------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| 01  | [Upstream contribution](01-upstream-contribution.md) | **P0**   | File the three.js issue; keep the patch minimal/maintainable.                                 |
| 02  | [Dynamics materials](02-dynamics-materials.md)       | **P0**   | Player/vehicles are black silhouettes — lit TSL path + night fill.                            |
| 03  | [Sky & ambient](03-sky-and-ambient.md)               | **P0**   | No sky/sun/ambient under WebGPU — the world is dark; also drives the world-material uniforms. |
| 04  | [World-material slices](04-world-material-slices.md) | **P1**   | CSM sampling, unified fog, night emissive, moon, local lights in TSL.                         |
| 05  | [Shadows under WebGPU](05-shadows-under-webgpu.md)   | **P1**   | Sun near map + CSM plugin on WebGPURenderer; interplay with frozen bundles.                   |
| 06  | [Remaining effects](06-remaining-effects.md)         | **P2**   | Water, particles, coronas, uv-anim, wind, vehicle reflection.                                 |
| 07  | [Post-FX](07-post-fx.md)                             | **P2**   | Bloom+tonemap (TSL nodes), god-rays (custom), AO per bake-vs-pass, MSAA vs SMAA.              |
| 08  | [Pipeline sharing](08-pipeline-sharing.md)           | **P2**   | uuid-key neutralization + instanceMatrix capture → lighter cell appearances.                  |
| 09  | [Productionize](09-productionize.md)                 | **P3**   | bundle=1 default, flags→config, fallback policy, bench parity, patch hygiene.                 |

Rule of thumb: P0 makes `?webgpu=1` **playable-looking** (visible dynamics + sky); P1 brings **visual parity**
features; P2 completes parity + perf polish; P3 ships it.
