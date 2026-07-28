# 07 — LOD generators, extended

Two independent generator upgrades, each **unlocked by an ASI engine fix** from the [03-asi chain](../../../../../asi/perfect-map/docs/plans/readme.md). Both are worthless (crash the game) until their asi lands, so each plan is gated on the `opensa-asi` build target and keeps the stock-target behaviour byte-identical to today.

- **Part A — LODs carry 2dfx & more.** Unlocked by [03-asi Phase 2](../../../../../asi/perfect-map/docs/plans/readme.md) (the 2dfx emitter-leak fix, Task 4). Today the LOD generators strip particle 2dfx and cells keep only type-0 lights. With the emitter lifecycle fixed in-engine we can carry the FULL 2dfx richness onto LODs — distant coronas everywhere (already), plus street-name roadsigns, escalators, and rate-budgeted particle emitters (factory smoke/fire at range).
- **Part B — procobj density & biomes.** Today procobj scatter is pinned to vanilla density (`lottery < 1`) and capped by budgets that exist because of the int16 bug. With the ceiling lifted we can place far more clutter and control density by biome — denser bushes in forest, rocks on mountain slopes, cacti/shrubs in the desert. **Which ceiling has to be lifted, and by whom, is now an open question** — see [B0](lod-procobj-generator/b0-limit-lift-need-review.md): the measured binding constraint is the 40-slot `IplEntityIndexArrays` limit (37 used), which FLA lifts and [03-asi Phase 1](../../../../../asi/perfect-map/docs/plans/readme.md) does not.

## Grounding (current code)

- Three LOD generators share `@opensa/lod-common` (`hdToLod`, `MeshBuilder`, `LodModifier` chain, `collectClumpEffects`, `encodeLodDff`): **sa-lod** (per-object verbatim/decimate clone, `tools/sa-lod-generator`), **opensa-lod** (cell bake, `tools/opensa-lod-generator`), **lod-procobj** (`tools/lod-procobj-generator` + `@opensa/map-placement`).
- 2dfx codec is `@opensa/rw-codec/dff`: `extract2dfxEntries(bytes, keepTypes?)` / `build2dfxSection(entries)` preserve any entry type **byte-verbatim**; `stripParticleEffects` drops only type-1. Types: 0 light/corona, 1 particle, 7 roadsign, 10 escalator (others survive verbatim but aren't decoded).
- 2dfx today: sa-lod verbatim path keeps all-but-particle; decimate path re-attaches via `collectClumpEffects` (all-but-particle); **cells keep only `LIGHT_2DFX = {0}`** — rotation-bearing types (roadsign/escalator) are dropped because a raw transplant repositions but doesn't re-rotate (`merge.ts:11`).
- procobj scatter (`packages/renderware/src/map/procobj-scatter.ts`): `PROC_OBJ_MAX_DENSITY = 3`, count `= area/spacing × density`, per-placement `lottery`; build-time cutoff hardcoded `lottery < 1` (`map-placement/src/procobj/convert.ts`). `procObjCategory(model, surface)` → bushes/cacti/flowers/grass/rocks/trees already exists; surface names from `surfinfo.dat`; zones parseable (`parseZones`, info.zon) but **not joined to scatter**.
- Budget guards to lift for Part B: `AREA_MAX_PAIRS = 2000` / `STREAM_MAX_INST = 512` (`streamed-areas.ts`), `procObjMax = 20000` (`config.ts`), `TEXT_ROW_CAP = 30000` (`pipeline.ts`), `PROC_OBJ_MAX_DENSITY`.

## Boundary vs the 03-asi chain

[03-asi/010](../../../../../asi/perfect-map/docs/plans/010-pipeline-keep-2dfx.md) is the **engine-integration flip** for particle 2dfx (stop stripping for the asi target + a far-view rate budget, gated on the emitter fix). Part A here is the **generator-side capability**: carrying a complete, correctly-transformed 2dfx set through every LOD representation (verbatim, decimate, AND baked cells incl. rotation-bearing types), of which particles are one case. A3 implements the emitter carry through the cell/decimate encoders and shares the budget model with 010.

## Chains

### Part A — LODs carry 2dfx & more (needs Task 4)

| #   | Plan                                                                   | Delivers                                                                                              | Status |
| --- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------ |
| A1  | [a1-2dfx-unified-carry.md](a1-2dfx-unified-carry.md)                   | one complete keep-policy across verbatim/decimate/cell paths; coronas correct & consistent everywhere | idea   |
| A2  | [a2-2dfx-rotation-bearing-cells.md](a2-2dfx-rotation-bearing-cells.md) | roadsigns & escalators survive into baked cells (re-transform rotation, not just position)            | idea   |
| A3  | [a3-2dfx-particle-emitters-lods.md](a3-2dfx-particle-emitters-lods.md) | rate-budgeted particle emitters through the cell/decimate encoders (with 03-asi/010)                  | idea   |

### Part B — procobj density & biomes ([lod-procobj-generator/](lod-procobj-generator/))

All of Part B belongs to one mechanism, so it lives in its own subfolder.

| #   | Plan                                                                                       | Delivers                                                                                                  | Status |
| --- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------ |
| B0  | [b0-limit-lift-need-review.md](lod-procobj-generator/b0-limit-lift-need-review.md)         | **go/no-go: do we need our own limit lift at all, or is FLA enough?** Runs BEFORE B3 and can change it    | review |
| B1  | [b1-procobj-density-model.md](lod-procobj-generator/b1-procobj-density-model.md)           | build-time configurable density (per-category/per-surface multipliers), replaces hardcoded vanilla cutoff | idea   |
| B2  | [b2-biome-zone-density.md](lod-procobj-generator/b2-biome-zone-density.md)                 | zone×scatter join + slope proxy: desert cacti, forest bushes, mountain rocks                              | idea   |
| B3  | [b3-budget-lift-integration.md](lod-procobj-generator/b3-budget-lift-integration.md)       | raise the int16-era budgets; perf becomes the new limiter; in-game validation — **premise pending B0**    | idea   |
| B4  | [b4-species-representation.md](lod-procobj-generator/b4-species-representation.md)         | every eligible species survives the cap — no silently missing type                                        | idea   |

Dependencies: A1 → A2 → A3 (A3 also needs Task 4 + 03-asi/010). **B0 gates B3** (it questions B3's "needs our ASI" framing). B1 → B2 → B3. B4 is independent of all of them — it is a fairness defect present at TODAY's density, not something raised density introduces. Parts A and B are independent of each other.

**Part B's ASI gating is under review.** The readme above says Part B is "unlocked by Task 3 (the int16 limit lift)". Measured 2026-07-28: the build sits at 25 461/32 767 text rows but **37/40 IPL slots** — the binding constraint is slots, which our ASI does not lift and FLA does. B0 carries the numbers and the decision.
