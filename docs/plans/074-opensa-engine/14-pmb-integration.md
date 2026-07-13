# 074·14 — perfect-map-builder integration + the final modded-map measurement

[← chain](readme.md) · prev: [13 cleanup](13-cleanup.md) · relates: the parked
[066-pmb-modern-tool](../066-pmb-modern-tool/) chain (its data thesis ships THROUGH this engine)

`opensa-pack` grew up as a standalone converter; its real home is a stage inside the perfect-map-builder
pipeline, where the full modded game (the actual product) is assembled. This plan embeds it and closes the
loop with the measurement the whole 074 chain exists for: **the user's full modded map, through pmb, on the
own engine, benchmarked**.

## Part A — embed the converter into the pmb pipeline

- `opensa-pack` becomes a pmb stage (the standing decisions land here):
  - **wind-adapted vegetation** supplied by the pipeline itself — the `--wind` overlay CLI dies
    (user decision, 074/06 row 10 note);
  - **stochastic list** curated in pmb data (+ the `stochastic-candidates.ts` area scan as a pipeline
    report; the skygfx texdb import stays an input option) — plan 12 stays default-off until its
    histogram-preserving pass regardless;
  - **receiver-mesh densification hook** — the prerequisite recorded in
    [ideas/0.5.0/03-baked-directional-shadows](../../ideas/0.5.0/plans/03-baked-directional-shadows/readme.md);
    pmb owns mesh surgery, so the subdivision stage belongs here even if the shadows v2 lands later;
  - pmb's existing bakes (prelight/night sets) run BEFORE the converter so the pak carries final colours.
- **Full-map conversion engineering** (the measured blockers from the plan-10 ledger):
  - chunked welding (region-sized scratch with an overlap margin for the bake BVH — 16 GB held one city;
    the full map will not fit);
  - bake worker pool (bakes were 91 % of convert time and are per-cell parallel);
  - meshopt wire compression of cell payloads + brotli (geometry = 82 % of the pak; the top size lever),
    decode in the pak worker;
  - BC-encode of the processed α-subset (third priority, after the two above).
- Determinism + content hashes stay non-negotiable (pmb reruns must produce byte-identical paks for
  unchanged inputs — the incremental-build enabler).

## Part B — the final measurement (the chain's exit exam)

- Convert the FULL map from the user's modded profiles (`game-src/anderius`, `carcer`, `gostown` — the
  stress inputs pinned in plan 11) with everything on: HD vegetation, all pmb mods, all bakes.
- Ledger per profile: pak size (raw / wire-compressed), convert wall-time (chunked + pooled), verts/draws,
  and the bench matrix: `city` + `drive` + `orbit` + night runs, all against the plan-11 gates.
- The headline row the project has been building toward: **full modded SA, 2× retina M3, own engine —
  fps/CPU/GPU vs the three-WebGL prod line (65 ms CPU / ~31 ms GPU / 14 454 draws)**.
- Acceptance: 60 fps floor on every scene of every profile (the user's original bar — "60 fps with the
  full effect set and this data volume", recorded verbatim in the 00 concept).

## Tasks

- [ ] pmb stage wrapper around `convertDistrict` (config in pmb, no CLI flags in the pipeline path).
- [ ] Chunked welding + bake worker pool (unblocks full-map; measure on one full profile).
- [x] meshopt wire stage (+ worker-side decode) — 2026-07-13, see ledger. Brotli deliberately NOT taken:
      `DecompressionStream` has no brotli, a WASM brotli decoder would outweigh its gain over
      meshopt+deflate, and static hosting can still serve `Content-Encoding: br` transparently.
- [ ] BC α-subset encode (after the size ledger says how much it still matters).
- [ ] Wind/stochastic/subdivision data moved into pmb config; `--wind` CLI removed.
- [ ] Full-profile conversions (non-modified, anderius, carcer, gostown) + the final bench matrix.

## Measurement ledger

_(per profile: pak raw/wire MB, convert minutes, verts, bench matrix rows; the 60 fps verdict)_

**2026-07-13 — meshopt wire stage (A1 stage 2) landed.** Cells travel as an `.oswire` container
(header/tables verbatim, vertex payload = meshopt vertex stream @ stride 36, index payload = meshopt index
stream) with deflate-raw on top; entry `enc: 'oswire-deflate-raw'`; the pak worker inflates + meshopt-decodes
and hands the main thread the exact raw `.oscell` (old `deflate-raw` paks still readable). The meshopt index
codec canonicalizes per-triangle cyclic rotation (order + winding survive) — safe because the only
flat-interpolated attribute (texture layer) is per-material-uniform within a triangle; the wire test asserts
rotation-normalized equality.

| Metric (ls-bench rect, wind overlay, full bakes)      | deflate-only (12 Jul) | meshopt+deflate (13 Jul)                 |
| ----------------------------------------------------- | --------------------- | ---------------------------------------- |
| pak total                                             | 93.9 MB               | **68.9 MB** (−27 %)                      |
| cell geometry raw → wire                              | 147.5 → 60 MB (~2.4×) | 147.5 → **34.9 MB (4.23×)**              |
| worst-cell decode (9,-7,hd, 14 MB raw, Node ≈ worker) | inflate 24.9 ms       | inflate 12.7 + meshopt 6.0 = **18.7 ms** |
| convert wall                                          | 145.1 s               | 143.8 s (encode cost noise-level)        |

Decode is WORKER-side (blob latency, not frame time) and NET FASTER than the old path — deflate now inflates
the smaller meshopt streams. All 40 entries verified decodable in Node against the real pak (rawLength +
structure checks). **Full-LS measured: 497.5 → 311.2 MB (A1 ≤ ~400 MB gate CLOSED)**; `pak-sf` 52.3 → 40.9 MB.
Same day: bakes went OPT-IN (`--bakes`, see plan 03) — the bakeless full-LS iteration convert is **31.8 s**
(vs 939 s with bakes; bakes don't change pak size — their channels live in reserved vertex bytes).
