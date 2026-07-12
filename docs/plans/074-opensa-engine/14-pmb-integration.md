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
- [ ] meshopt + brotli wire stage (+ worker-side decode); size ledger raw vs wire.
- [ ] BC α-subset encode (after the size ledger says how much it still matters).
- [ ] Wind/stochastic/subdivision data moved into pmb config; `--wind` CLI removed.
- [ ] Full-profile conversions (non-modified, anderius, carcer, gostown) + the final bench matrix.

## Measurement ledger

_(per profile: pak raw/wire MB, convert minutes, verts, bench matrix rows; the 60 fps verdict)_
