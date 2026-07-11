# 074·07 — Baked channels (static shadows, AO/skyVis, emissive mask)

[← chain](readme.md) · prev: [06 effects](06-world-effects-parity.md) · next: [08 dynamics](08-dynamics.md)

The [066/03](../066-pmb-modern-tool/03-baked-sun-occlusion-shadows.md) and
[066/04](../066-pmb-modern-tool/04-ambient-emissive-channels.md) specs executed against the NEW target: the
bakers land in `opensa-pack` (03), the consumers in the world WGSL (06), the storage in the `.oscell` channels
reserved since v0 (02 — no format bump). 066 stays the spec source; this doc only records what changes.

## What transfers, what changes

| 066 spec                                                                           | Here                                                                                                                                                 |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baked static→static sun occlusion (kills CSM static casters, fixes angular/jitter) | same math; output = per-vertex sun-visibility term(s) written into the reserved channel; consumed by the hybrid-sun WGSL (06·3) as the shadow factor |
| Dynamic-only near cascade stays for cars/peds                                      | becomes THE only runtime shadow map (08 renders casters; world samples it near-field)                                                                |
| AO/skyVis per vertex (replaces SSAO prepass)                                       | `aoSkyVis` channel (02); modulates indirect term                                                                                                     |
| Emissive mask (replaces luma-delta heuristic)                                      | `emissive` channel; 06·8 switches from heuristic to mask when this lands                                                                             |
| pmb integration                                                                    | NOT pmb — the bakers are `opensa-pack` stages (the tool owns all NEW bake kinds; ground rule from the concept)                                       |

## Bake mechanics (decisions to make here, measured)

- Occlusion source geometry: the MERGED cell groups themselves (post-weld — the tool already holds
  world-space triangles); raycasts via a BVH built per district at convert time.
- Sun visibility: sample the sun arc at K elevations (066/03's analytic-vs-sampled decision — resolve with a
  quality/size table; start K=4 packed into one unorm8x4 reuse of the reserved space).
- Bake cost is offline and parallel (worker pool per cell); budget = converter wall-time ledger.

## Tasks

- [ ] District BVH + raycaster in the tool (reuse collision BVH code where it fits).
- [ ] Sun-vis bake (K-sample) + channel writer + WGSL consumer swap in 06·3; A/B vs runtime CSM screenshots
      (the original 066 complaint — angular/jittery — is the acceptance test).
- [ ] skyVis/AO bake + consumer; compare vs SSAO prepass visually and in GPU ms (SSAO pass should DIE here).
- [ ] Emissive mask bake (night-window detection from the existing night-prelit data) + 06·8 swap.
- [ ] Ledger: bake wall-time, channel bytes, GPU ms saved (CSM casters + SSAO pass removed).

## Measurement ledger

(per bake: tool time, bytes, GPU Δ, screenshot verdicts)
