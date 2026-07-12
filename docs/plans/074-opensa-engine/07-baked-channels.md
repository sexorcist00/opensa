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

- [x] District BVH + raycaster in the tool (`bvh.ts`: median-split over triangle AABBs, iterative any-hit
      Möller–Trumbore; occlusion queries only).
- [x] Sun-vis bake v1 (scalar, 066/03 v1) + channel writer + WGSL consumer in 06·3. No runtime CSM exists in
      this engine to A/B against — the acceptance test becomes "under-bridge/canyon direct sun dies, smooth
      under camera motion". The directional (moving-sun) representation stays the 066/03 v2 follow-up.
- [x] skyVis/AO bake + consumer (v1 — see decisions below). SSAO never existed in this engine, so the
      "SSAO dies" comparison is against the WebGL prod pass when plan 10's A/B lands.
- [x] Emissive mask bake (night-window detection from the existing night-prelit data) + 06·8 swap.
      2026-07-12: the luma-delta detection moved OFFLINE into the welder (high byte of `layerChannels` +
      `EMISSIVE` channel bit; refinable later without engine changes); the WGSL glow uses the baked mask
      when the cell carries it (per-cell flag bits in `cell.origin.w`: bit 0 sunVis, bit 1 emissive) and
      falls back to the runtime heuristic for old paks. LS rect: 77,601 masked verts across 20/20 HD cells.
- [x] Ledger: bake wall-time + ray counts recorded below (GPU Δ = per-vertex attribute, expected ≈ free;
      confirmed by the ritual bench after reconvert).

## v1 decisions (AO/skyVis, 2026-07-12)

- Two-phase convert: `weldCellParts` (scratch rows, `WELD_ROW` grew 17→18 with an `ao` slot defaulting open)
  → `bakeAo` mutates rows in place → `assembleCell` encodes. `weldCell` keeps the one-shot no-bake path.
- Occluders = HD opaque+cutout groups only; blend glass and beam cones never darken the sky.
- Only HD vertices are baked. LOD keeps the fully-open default: LOD verts sit NEAR but not ON the HD surfaces
  (self-occlusion noise), and LOD is viewed from ≥380 units — revisit only if the HD↔LOD swap pops visibly.
- 12 cosine-weighted rays (fixed golden-ratio fan — deterministic, no RNG), 60-unit reach, origins pushed
  0.08 off the surface. Unique-(pos,normal) dedup cache cuts repeat rays (~10 % on LS — GTA verts are
  already heavily split).
- Storage: low byte of the `layerChannels` u16 (074/02, no format bump) + `AO_SKY_VIS` channel bit.
  WGSL treats byte 0 as UNBAKED → fully open, so pre-bake paks render unchanged.
- Consumer: modulates ONLY the indirect (prelit) term — `env.aoStrength` (default 0.6; SA prelit already
  carries baked darkening, full strength double-darkens). Lab A/B: `?ao=<float>`, `?ao=0` disables.
- `--no-ao` CLI flag skips the bake; `report.json` gains the `ao` block (ms, rays, verts, tris).

## v1 decisions (sun-vis, 2026-07-12)

- Scalar sunVis (066/03 v1): elevation-weighted average visibility over the day arc — kills the direct term
  where the sun NEVER reaches (bridges, canyons); does not track the moving sun (v2 = directional).
- The arc mirrors the lab drivers: azimuth FIXED (0.35, e, 0.25), e = sin((hour−6)/12·π) → only 5 unique
  elevations {0.259, 0.5, 0.707, 0.866, 1} (the parametric arc is noon-symmetric). **When the arc gains real
  azimuth traversal, the bake table must follow + reconvert.**
- 2 disc-jittered rays per elevation (±0.03 elevation → baked penumbra), 400-unit reach. Arc samples behind
  the face are SKIPPED (N·L zeroes them at runtime) — halves the rays; a never-lit vertex costs none.
- Storage: `normal.w` (snorm8, 0..127 used) + `SUN_VIS` channel bit; the ENGINE gates per cell via
  `cell.origin.w` (set from channelMask at load) — **no in-data sentinel**, the AO byte-0 lesson applied.
- Consumer: `sunNdl ×= mix(1, sunVis, cell.origin.w × sunVisStrength)` — direct term only. Default strength
  1 (a shadow is a shadow); lab A/B `?sunvis=N`. One district BVH shared by both bakes.

## Measurement ledger

| Date       | What                              | Numbers                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-12 | AO/skyVis bake, ls-bench rect     | convert 23.4 s total, bake 20.6 s — 1,157,279 verts (1,044,940 unique), 12.5 M rays vs 738,880 tris, pak 99.5 MB (unchanged — the byte was reserved)                                                                                                                                                                                                                                                                             |
| 2026-07-12 | Baked distribution sanity         | cell 9,-7 hd: full 0..255 spread (27.8 k fully-occluded verts = undersides/interiors), channel bit set; lod: all 255, bit absent                                                                                                                                                                                                                                                                                                 |
| 2026-07-12 | **GOTCHA: sentinel collision**    | field report "no darkening under bridges" — fully-occluded verts encode byte 0 = the WGSL "unbaked" sentinel → the DARKEST verts rendered fully OPEN. District-wide: 262 k verts (23 %!) were byte-0. Fix: bake floors visibility at 1/255. Second cause is expected v1 behaviour: at noon the DIRECT sun term dominates an up-facing road — AO modulates indirect only; under-bridge sun darkness arrives with the sun-vis bake |
| 2026-07-12 | drive bench (+AO, pinned profile) | bench/series row 07·AO — BASELINE RESET to `game-src/non-modified` (earlier rows ran the user's modded pak); AO GPU cost ≈ free (one per-vertex mix)                                                                                                                                                                                                                                                                             |
| 2026-07-12 | sun-vis bake v1, ls-bench rect    | bake 9.0 s (backface skip halves rays: 5.59 M actual vs 10.4 M theoretical), convert total 35.1 s with both bakes on ONE shared BVH; pak 99.5 MB (normal.w was reserved)                                                                                                                                                                                                                                                         |
| 2026-07-12 | sunVis distribution sanity        | cell 9,-7 hd: bimodal as expected — 63.3 k fully lit / 18.9 k in permanent shade / penumbra tail between; SUN_VIS bit set; lod: all open, bit absent                                                                                                                                                                                                                                                                             |
| 2026-07-12 | **FIELD VERDICT: sun-vis v1 ✅**  | user: under-bridge/canyon shadows look right ("looks good"); bench row 07·sunVis accepted (GPU avg +0.13 ms). Dark palm canopies A/B-checked with `?sunvis=0` → UNCHANGED = source low-poly prelit, NOT the bakes; expected to be fixed by the pmb prelight pipeline, not here                                                                                                                                                   |
