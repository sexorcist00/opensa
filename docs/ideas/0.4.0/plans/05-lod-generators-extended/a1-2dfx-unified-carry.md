# A1 — Unified 2dfx carry across all LOD paths

Part of [05 — LOD generators, extended](readme.md), Part A. The foundation: make the 2dfx carry policy ONE thing, applied identically and correctly across the three LOD representations, before adding new entry types (A2) or emitters (A3).

## Context

2dfx carry is currently inconsistent across the three paths (from the code grounding):

- **sa-lod verbatim** (`finalize.ts:203`): byte-copies HD, drops only particles → keeps coronas/roadsigns/escalators implicitly.
- **sa-lod decimate** (`finalize.ts:197`): `build2dfxSection(collectClumpEffects(hdDff, clump))` — default keep = all-but-particle, positions mapped through frame transforms.
- **opensa-lod cells** (`merge.ts:12`): `LIGHT_2DFX = new Set([0])` — ONLY type-0 lights; roadsigns/escalators dropped.

So a corona survives all three, but a roadsign survives verbatim/decimate and vanishes on cells; and there's no single declared policy — the keep-set is spelled differently in three places. Before enriching LODs we make the policy explicit and the light/corona carry provably correct and consistent everywhere (positions right at LOD range, no doubles, no drift).

## Decisions

1. **One declared keep-policy** in `@opensa/lod-common` — a single `LOD_2DFX_POLICY` (per entry type: carry / carry-rate-scaled / drop) consumed by all three paths, replacing the three ad-hoc keep-sets. Default (stock target) reproduces today's behaviour exactly; the asi target widens it (A2/A3).
2. **Correctness pass on lights/coronas** — verify the carried type-0 entries land at the right world position on decimated LODs AND baked cells (cells reposition via `instanceTransform`; decimate via `clumpFrameTransforms`). Fixture-level checks that a known corona ends up where the HD one is. This is the baseline the richer types build on.
3. **No behaviour change on the stock target.** A1 is a refactor + policy unification + test hardening; the shipped stock LODs are byte-comparable to today (regression fixtures). New capability is dormant behind the policy until A2/A3 flip entries on for the asi target.
4. **Keep the byte-verbatim transplant model.** `extract2dfxEntries`/`build2dfxSection` already preserve unknown types verbatim — the policy decides which types to _carry_, never decodes/re-encodes their payload (except A2's rotation re-transform). Undecoded types (sun glare 4, enex 6, etc.) get an explicit policy entry too (default drop on LODs — they're not wanted at range) instead of today's implicit survival on the verbatim path.

## Tasks

- [ ] Define `LOD_2DFX_POLICY` in lod-common (type → carry/scale/drop) + a `keepTypesFor(target)` helper; unit-test the policy resolves to today's sets for the stock target.
- [ ] Route all three paths through it: sa-lod verbatim (currently implicit-keep — make it policy-driven, so undecoded types can be dropped deliberately), sa-lod decimate (`collectClumpEffects` keepTypes from policy), opensa-lod cells (replace `LIGHT_2DFX` literal).
- [ ] Corona/light correctness tests: real fixtures with known light 2dfx (refinery chimney `refchimny01`, a streetlamp model) → assert carried entry world positions match HD on decimate + cell paths (reuse `collectClumpEffects`/`collectCellLightEffects` transforms).
- [ ] Stock-target regression: shipped LOD bytes for a sample set are unchanged vs current generator output (golden-file compare) — proves the refactor is behaviour-preserving.
- [ ] Docs: a short "2dfx on LODs" section in lod-common docs describing the policy as the single source of truth.

## Verification

- Stock target: LOD output byte-identical (or provably equivalent) to today across the sample set.
- Coronas verified in-position on decimate + cell LODs (fixtures) — no drift/doubles.
- Policy is the only place a type's LOD fate is decided (grep: no residual `LIGHT_2DFX`/implicit keep).

## Measurements / notes

_(record after implementation)_

- policy table (type → stock / asi fate): …
- corona position error on cells vs HD (should be ~0): …
