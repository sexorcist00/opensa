# 2dfx particle emitters on generated LODs — new-game crash + far-view overdraw

**Status: 🟡 solved by stripping, not the end state (2026-07-02, verified in-game).** Policy shipped
across the LOD pipeline: **particle 2dfx never rides into a LOD; corona/light 2dfx (type 0) is kept**
(distant night lights are wanted). Reported fixed in the Proper Fixes compilation too — see the last
section.

**Remaining goal (2026-07-07): eventually make particle effects WORK on LODs** instead of stripping
them — distant factory smoke/fire visible at LOD range without the emitter-leak. That means solving
the actual leak (why cloned-LOD emitters never unload — engine-side lifecycle, possibly the same
class ProperFixes.asi patches) and the far-view overdraw (LOD-range emitters likely need reduced
rates/sprite budgets, not verbatim HD parameters). Nothing in the current pipeline blocks this: the
strip is a single call site per target, and `build2dfxSection` already re-attaches arbitrary entries.

## Symptom

Running the full perfect-map pipeline (mods + trees + procobj + sa-lod) in **real SA**:

1. **Crash starting a NEW game** — `0x004AA3A1`, AV on `[null+0x1B]` via
   `CFileLoader::LoadObjectInstance`: the first world-load instantiation reads a null model-info.
2. **Far-view overdraw / lag** — big translucent smoke sprites from every refinery/plant LOD rendering
   across the whole map at once (LODs have large draw distances, so _all_ of them emit simultaneously).

## Root cause

`sa-lod-generator` clones the **HD DFF verbatim** into the LOD slot (Phase-1 clone + hole-fill). The
verbatim copy carries the geometry's **2dfx section**, so any model with a **particle emitter** (2dfx
entry type 1 → an `effects.fxp` system: factory smoke `smoke30m`/`smoke50lit`/`ws_factorysmoke`,
`fire`, `water_fountain`, `vent`) re-emits from the far LOD as well. Unlike plain geometry, the cloned
LODs' **effect emitters do not unload from memory**; stacked on the rest of the pipeline's payload they
exhausted the streaming/model pool → null model-info on the first instantiation → the new-game crash.
Stripping the emitters from the clones removed the crash (confirmed in-game).

Scale: map-wide, 211 models carry light coronas and 38 carry particles; sa-lod cloned 88 of them
(11 particle + 77 corona — refinery chimneys, Vegas plants, fountains, fire).

Investigation gotcha: 2dfx lives on **each geometry** (`clump.geometries[i].particles/.lights`), NOT on
the clump — scanning `clump.particles` is always undefined, which hid the whole problem at first.

## The fix (both targets)

- **sa (`sa-lod-generator`)** — `stripParticleEffects(bytes)` in `@opensa/rw-codec/dff` removes **only**
  type-1 (particle) entries from every geometry's 2dfx section, keeping type-0 coronas/lights, road
  signs, escalators and all geometry byte-faithful (identity return when no particles). Wrapped around
  every clone: `finalize.ts` (Phase-1 clone) and `fill-holes.ts` (hole-fill clone). Decimated clones
  rebuild their 2dfx from lights via `build2dfxSection` — same lights-only policy.
- **opensa (`opensa-lod-generator`)** — structurally immune: the cell bake (`mergeCell`) rebuilds
  meshes from geometry only, so 2dfx is dropped by construction. Plan-003 Phase 5 then re-adds **only
  type-0 light entries** (`LIGHT_2DFX = new Set([0])` in `merge.ts`, `collectCellLightEffects`) as a
  byte-verbatim transplant with repositioned coordinates — cells gain distant night city lights, never
  emitters.

Verified: every smokestack LOD clone lost its emitter with coronas and tri counts intact
(`refchimny01` smoke30lit → none, 3 lights kept, 892 tris unchanged); HD keeps its smoke up close;
the new-game crash is gone.

Details + verification tables: [`tools/sa-lod-generator/docs/plans/005-strip-clone-particle-fx.md`](../../tools/sa-lod-generator/docs/plans/005-strip-clone-particle-fx.md).

## Proper Fixes (MixMods)

The Proper Fixes compilation (Junior_Djjr / MixMods) reportedly fixes this class of problem at the
code level — most likely inside **`ProperFixes.asi`** (the asi is obfuscated, so which exact patch
handles LOD-carried effect emitters is unverified). This matches its role in the
[ghost-barriers](ghost-barriers.md) investigation: PF patches engine-side what we instead fix at
build time. As there, our builds deliberately do **not** depend on it — the generators strip the
emitters from the data itself, so the output stays safe on stock SA 1.0 with no runtime dependency;
PF remains a user-side escape hatch for stacks that clone LODs without stripping.
