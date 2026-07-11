# 074·10 — Integration into the game & the flip

[← chain](readme.md) · prev: [09 post-FX](09-postfx-aa.md)

The lab proved the renderer; this plan puts the GAME on it. The boundary work is the known debt called out in
the concept: today's gameplay code touches three types in places — decouple where the seam is thin, adapt where
it is not.

## Boundary inventory (the seams, known today)

| Seam                                               | State                                                      | Plan                                                                               |
| -------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| StreamingSystem                                    | three-`Object3D`-shaped (roots, containers, GpuHooks)      | superseded by the 05 driver; prod keeps its own for WebGL                          |
| Game loop / systems                                | framework-agnostic already (fixed step, SystemRegistry)    | reuse as-is                                                                        |
| Physics / collision (rapier + BVH)                 | three math types only                                      | reuse as-is                                                                        |
| Character/vehicle gameplay                         | mixes logic with three objects (mesh refs, AnimationMixer) | logic extracted in 08 (sampler, part flattening); entity handles replace mesh refs |
| Picking/debug tools (map viewer, hidden-instances) | three raycaster                                            | engine-side ray query vs cell BVH (we bake BVHs in 07 anyway — reuse)              |
| UI/HUD (React, GXT, fonts)                         | renderer-independent (DOM/canvas overlay)                  | reuse as-is                                                                        |
| Config surface (graphics.\*)                       | plain data                                                 | same config drives engine tiers/effects                                            |

## The flip — criteria agreed in advance (no vibes)

1. **60 fps ls-noon @2× retina on M3 Pro**, and ≥ WebGL-prod fps on EVERY bench scene (night included).
2. Visual parity sign-off per bench scene (noon/dusk/night screenshot sets archived).
3. Stress matrix (05) green in Chrome + Safari; 30-min soak clean.
4. Prod fallback: non-WebGPU browsers keep the three-WebGL path untouched; the loader picks per capability.
5. **073 flags & code disposition executed** (the promise from the 073 park): once the new engine is default,
   decide keep/fold/delete for `?webgpu/bundle/mat04/...` and the three patch — a dedicated cleanup PR with the
   user, per the agreement.

## Tasks

- [ ] Boundary inventory verified against code (the table above audited item by item when M3 lands).
- [ ] Entity-handle adapter for character/vehicle gameplay; remove three mesh refs from logic paths.
- [ ] Engine-side ray query (picking + the map-inspector tools).
- [ ] Capability-gated loader in the web app (native pak + WebGPU → new engine; else three-WebGL).
- [ ] Bench + soak + parity sweeps; the flip decision doc with all ledgers linked.
- [ ] Post-flip cleanup: 073 flags/patch disposition PR (discussed with the user first — standing agreement).

## Measurement ledger

(final matrix: every bench scene × both engines × fps/CPU/GPU; the flip verdict)
