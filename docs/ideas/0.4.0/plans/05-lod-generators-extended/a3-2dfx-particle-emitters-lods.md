# A3 — Particle emitters through the LOD generators

Part of [05 — LOD generators, extended](readme.md), Part A. Depends on [A1](a1-2dfx-unified-carry.md)/[A2](a2-2dfx-rotation-bearing-cells.md) (unified carry + typed transforms) AND **Task 4** ([03-asi Phase 2](../03-asi/readme.md): the emitter-leak fix) + [03-asi/010](../03-asi/010-pipeline-keep-2dfx.md) (the pipeline flip + far-view budget). Delivers the generator-side capability for distant factory smoke/fire on LODs.

## Context & boundary

[03-asi/010](../03-asi/010-pipeline-keep-2dfx.md) owns the **pipeline decision** (stop stripping particle 2dfx for the asi target) and the **far-view rate budget** (LOD-range emission scaling to kill the smoke-storm overdraw), plus the installer/asi-presence safety. It focuses on the sa-lod strip flip (a single call site). A3 is the **generator plumbing** that makes particle 2dfx ride EVERY LOD representation correctly — specifically the paths 010 doesn't itself build out: the **decimate** and **cell** encoders, where emitters aren't a byte-copy but a rebuilt 2dfx section. The rate-budget model is shared (defined by 010, consumed here).

Today: verbatim keeps particles only if unstripped; decimate re-attaches via `collectClumpEffects` (default drops particles); cells drop everything but type-0. So even with 010's un-strip, decimated and celled LODs still wouldn't carry emitters — A3 fixes that.

## Decisions

1. **Particles become a policy entry `carry-rate-scaled`** (A1's policy) for the asi target across all three paths. Verbatim un-strips (010); decimate includes type-1 in `collectClumpEffects`; cells include type-1 in the widened keep-set with the A2 transform for position.
2. **Rate-scaling is applied in the generator, not the engine.** The particle 2dfx payload names an `effects.fxp` system + parameters; LOD-range emitters need reduced emission (the far-view budget). Two candidate mechanisms — pick by what `effects.fxp` allows without shipping new FX defs:
   - **thin the emitters**: drop a fraction of a model's particle entries on the LOD (e.g. keep 1 of N smoke plumes per stack) — no payload edit, purely which entries carry;
   - **scale the parameters**: if the 2dfx particle payload exposes a rate/multiplier field, scale it down for the LOD copy (typed edit, like A2's codec).
     Start with emitter-thinning (safe, no FX authoring); add parameter-scaling only if thinning isn't enough. Factors come from 010's budget model, tuned in-game.
3. **Per-species tuning.** The 38 particle-bearing models (refinery smoke, Vegas plants, fountains, fire) differ; the scaling config is per-category/per-species with sane defaults (one plume per smokestack at range; fountains maybe dropped entirely at LOD range — they read as noise). Expose as generator config.
4. **Stock target: unchanged** — particles still fully stripped (no engine fix → mandatory). All A3 behaviour is asi-target only.
5. **Correctness = emitters present, positioned, AND budgeted.** A distant refinery shows smoke; the whole-map sum stays within the frame budget (measured via 02-rendering's HUD, per 010); no new-game crash (Task 4).

## Tasks

- [ ] Policy: particles → `carry-rate-scaled` for the asi target in all three paths (verbatim/decimate/cell); stock target still strips.
- [ ] Emitter-thinning in lod-common (keep a configured fraction/cap of a model's type-1 entries on the LOD); per-species/per-category thinning config with defaults.
- [ ] (If needed) typed particle-payload scaling codec in rw-codec (rate field), beside A2's codecs; round-trip tests.
- [ ] Decimate + cell encoders carry the scaled emitters (extend `collectClumpEffects` keep + `collectCellLightEffects`/`build2dfxSection`); positions via existing transforms (A1/A2).
- [ ] Shared budget model with [03-asi/010](../03-asi/010-pipeline-keep-2dfx.md): one config for LOD-range emission factors, consumed by both the pipeline flip and these encoders.
- [ ] In-game (Wine, asi target): refinery/plant smoke visible at LOD range through decimated + celled LODs, new-game boots (Task 4), far-view frame cost within budget (measure). Record per-species factors + fps.
- [ ] Stock-target regression: particles fully stripped, output safe on stock 1.0 (today's verified behaviour).

## Verification

- asi target: emitters ride verbatim, decimate, AND cell LODs; distant smoke visible; boots; frame budget held.
- stock target: byte-identical strip to today.
- Emitter count stays bounded map-wide (thinning works) — no smoke-storm.

## Measurements / notes

_(record after implementation)_

- thinning/scaling factors per category shipped: …
- particle-bearing models re-emitting at LOD range (of 38 / previously 11 cloned): …
- map-wide far-view frame cost with all smokestacks in view: …
