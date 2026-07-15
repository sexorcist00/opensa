# Ideas — 0.4.0

Future-work plans for the 0.4.0 cycle. Each feature is a sequential chain of small plans under [plans/](plans/); a plan is implementable on its own and ends with a verification + measurements section (standing rule: record numbers into the plan doc after every phase).

**→ [overview.md](overview.md)** — the cross-chain roadmap: pillars, dependency graph, critical path, suggested execution order, and shared contracts (the `opensa-asi` target flag, the perf harness). Read that first for the big picture; the sections below are the per-chain index.

## Vehicle license plates

Generate per-vehicle license plates from the stock `models/generic/vehicle.txd` assets (`platecharset` glyph atlas + `plateback1/2/3` state backgrounds), driven by masks in the `Game.getInstance` vehicle config:

```ts
vehicle: {
  plates: { ls: '', sf: '', lv: '' } // mask DSL: L = letter, D = digit, * = either, literals pass through
}
```

Bindings: `plateback1` → Los Santos, `plateback2` → San Fierro, `plateback3` → Las Venturas. City is resolved from the SPAWN position; outside the three cities (countryside/desert) one of the three is picked deterministically per vehicle. Plates live on damageable parts and must follow them (deform, swing, detach).

| #   | Plan                                                                                              | Delivers                                                                                      | Status |
| --- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------ |
| 1   | [001 — Plate texture generation](plans/01-plates/001-plate-texture-generation.md)                 | mask DSL + seeded text + charset→raster baking (pure, unit-tested)                            | idea   |
| 2   | [002 — Plate material binding](plans/01-plates/002-plate-material-binding.md)                     | `carplate`/`carpback` detection in `buildVehicle`, `applyPlate`                               | idea   |
| 3   | [003 — Config, city, seeding](plans/01-plates/003-config-city-seeding.md)                         | `vehicle.plates` config, city-by-spawn-position, out-of-city random, LOD-respawn-stable seeds | idea   |
| 4   | [004 — Damage integration & verification](plans/01-plates/004-damage-integration-verification.md) | plates ride `_ok`/`_dam` swap + detach; census of edge-case models; e2e in-game pass          | idea   |

Key insight the chain is built on: plates are baked as a texture swap on the existing `carplate` materials INSIDE the part meshes — so damage/detach/door-swing support falls out of the existing part-pivot architecture instead of needing new attachment code.

## Rendering overhaul ("modern lighting" fork)

Full rework of vanilla rendering toward modern-game visuals while preserving the SA prelit/night-vertex vibe — the T3 fork plan 038 left out of scope. Real building shadows (CSM + LOD shadow proxies), PBR sky with a 512×1 horizon LUT feeding fog/water, fog that actually cuts the horizon, realistic water, real headlight/street-lamp lights (coronas demoted to distant impostors), glowing tobj/night-vertex emissives, and an opensa-native asset step in perfect-map-builder (meshopt/KTX2 + baked sun-visibility/AO channels — no longer bound to DFF/TXD). Every stage lands behind a toggle with measured frame budgets; the default flips only at the end.

**→ Promoted to working plans (2026-07-10): [docs/plans/062 — Rendering overhaul](../../plans/062-rendering-overhaul.md)** — the chain overview + the ten stage plans now live as `docs/plans/062–072` (foundations 063, hybrid lighting 064, shadows 065, pmb asset step 066, sky 067, fog 068, water 069, local lights 070, night 071, tiers/default-flip 072). Statuses tracked there.

## opensa-asi — our own limit-adjuster ASI

Generate our OWN `.asi` engine-patch for real GTA:SA 1.0 that removes the hard limits behind the ghost-barriers bug (int16 `IplDef` pool-index truncation + three more unbounded structures), so perfect-map builds can add unlimited objects instead of staying under the ≤30k-text-row / ≤39-slot work-around. This is the "standing goal — own engine patch to LIFT the limit" recorded in the ghost-barriers post-mortem and memory. `ProperFixes.asi` proves the fix is code-patchable (built on injector + plugin-sdk) but is obfuscated + license-locked — we reverse-engineer it behaviourally and write our own patches from the decompiled engine ground truth. The tool cross-compiles a Win32 PE DLL from macOS (MinGW-w64) and is tested/debugged under Wine.

This chain now lives as its own root project: **[`asi/perfect-map`](../../../asi/perfect-map)** (the repro
oracle shipped separately as **[`tools-debug/sa-int16-repro`](../../../tools-debug/sa-int16-repro)**).

Chain overview, constraints, and references: [../../../asi/perfect-map/docs/plans/readme.md](../../../asi/perfect-map/docs/plans/readme.md)

| #   | Plan                                                                                                          | Delivers                                                                                                                               | Status |
| --- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| —   | [Reproduce the ghost-barriers bug](../../../tools-debug/sa-int16-repro/docs/reproducing-the-int16-bug.md)     | **prerequisite — SHIPPED** as `tools-debug/sa-int16-repro`: the repro dial + detection oracle (the pass/fail gate for the whole chain) | done   |
| 1   | [001 — Reverse-engineering & patch catalogue](../../../asi/perfect-map/docs/plans/001-reverse-engineering.md) | RE of ProperFixes + decompiled engine → verified address/byte/change table                                                             | idea   |
| 2   | [002 — Toolchain & architecture](../../../asi/perfect-map/docs/plans/002-toolchain-architecture.md)           | macOS→Win32 cross-compile, ASI skeleton, hook/patch primitives, repo layout                                                            | idea   |
| 3   | [003 — Patch framework](../../../asi/perfect-map/docs/plans/003-patch-framework.md)                           | declarative patch table, exe fingerprint gate, original-byte verify, FLA/OLA coexistence                                               | idea   |
| 4   | [004 — Limit-lift patches](../../../asi/perfect-map/docs/plans/004-limit-patches.md)                          | the payload: int16→int32 IplDef + array relocations; ghost-barriers repro clean                                                        | idea   |
| 5   | [005 — Build, debug & test harness](../../../asi/perfect-map/docs/plans/005-build-debug-test.md)              | macOS byte-level tests, Wine boot ladder, logging, winedbg recipe, CI                                                                  | idea   |
| 6   | [006 — Pipeline integration & budget lift](../../../asi/perfect-map/docs/plans/006-pipeline-integration.md)   | ship the asi from pmb; relax `checkTextIplSlotBudget` in opensa-asi target mode                                                        | idea   |

Phase 2 — a second engine fix on the same framework: the **2dfx particle-emitter leak on LODs** ([lod-2dfx-particles.md](../../../docs/open-issues/lod-2dfx-particles.md)). Cloned-LOD emitters never unload → pool exhaustion → new-game crash (`0x004AA3A1`); we currently strip particles at build time, ProperFixes fixes the lifecycle in-engine. RE it, patch it in our asi, then let the pipeline keep distant smoke/fire on LODs (the issue's remaining goal) with a LOD-range emitter budget against overdraw.

| #   | Plan                                                                                                                 | Delivers                                                                                             | Status |
| --- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------ |
| 7   | [007 — Reproduce the 2dfx emitter-leak crash](../../../asi/perfect-map/docs/plans/007-2dfx-reproduce.md)             | **first Phase-2 task** — deterministic un-stripped-emitter repro of `0x004AA3A1` + leak/crash oracle | idea   |
| 8   | [008 — 2dfx emitter lifecycle: RE & root cause](../../../asi/perfect-map/docs/plans/008-2dfx-emitter-re.md)          | why cloned-LOD emitters leak; PF's patch located; catalogue rows                                     | idea   |
| 9   | [009 — 2dfx emitter-lifecycle patch](../../../asi/perfect-map/docs/plans/009-2dfx-emitter-patch.md)                  | the fix in our asi; new-game crash gone with particle 2dfx present + emitters actually unload        | idea   |
| 10  | [010 — Pipeline: keep 2dfx on LODs + far-view budget](../../../asi/perfect-map/docs/plans/010-pipeline-keep-2dfx.md) | stop stripping (opensa-asi target); LOD-range rate/sprite budgets kill overdraw                      | idea   |

## Basic CLEO support

Run compiled GTA:SA CLEO `.cs` scripts inside the browser engine, starting from the two real Junior_Djjr "spin an object" mods in `NO_COMMIT/1/` (Wind Farm, Rotating Ferris Wheel), on a deliberately extensible architecture. Answers the three open questions: parse `.cs` via an SCM decoder driven by the Sanny Builder opcode DB; give scripts an API through a `CleoHost` handler registry bridged to engine primitives; ship it as a **separate runtime module** (`packages/cleo`) attached via `game.addSystem` — following the `game/mods` precedent, not the renderware-free core, not a rendering plugin. Cooperative thread VM, per-frame instruction budget, memory-op boundary for the future, script tracer + opcode-coverage tooling.

Chain overview, CLEO primer, and the three answered questions: [plans/04-cleo-basic/readme.md](plans/04-cleo-basic/readme.md)

| #   | Plan                                                                                           | Delivers                                                                                             | Status |
| --- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------ |
| 1   | [001 — SCM/CLEO decoding & opcode model](plans/04-cleo-basic/001-scm-decoding.md)              | `.cs` binary decoder + Sanny-library opcode DB; the two scripts disassembled → opcode whitelist      | idea   |
| 2   | [002 — Script VM & thread scheduler](plans/04-cleo-basic/002-script-vm.md)                     | cooperative thread engine, vars, wait/yield, control flow, opcode-handler registry (engine-agnostic) | idea   |
| 3   | [003 — Engine API bridge](plans/04-cleo-basic/003-engine-api-bridge.md)                        | `CleoHost` facade + `loadModelByName` seam; object-spawn/rotate handlers; coordinate/units           | idea   |
| 4   | [004 — Module, packaging, config & wiring](plans/04-cleo-basic/004-module-packaging-wiring.md) | `packages/cleo` runtime module, `CleoConfig`, canvas-host wiring; the two mods run                   | idea   |
| 5   | [005 — Extensibility, debugging & maintenance](plans/04-cleo-basic/005-extensibility-debug.md) | tracer, opcode-coverage tool, unimplemented/memory-op policy, "add an opcode" flow                   | idea   |

## LOD generators, extended

Two generator upgrades, each unlocked by an ASI engine fix above. **Part A** (needs Task 4 / 03-asi Phase 2): LOD generators carry the full 2dfx richness — coronas everywhere, roadsigns & escalators into baked cells, rate-budgeted particle emitters (distant factory smoke/fire). **Part B** (needs Task 3 / 03-asi Phase 1): procobj scatter gets configurable, biome-aware density (denser forest bushes, mountain-slope rocks, desert cacti) with the int16-era caps lifted for the asi target. Both keep the stock target byte-identical to today.

Chain overview + code grounding + boundary vs 03-asi: [plans/05-lod-generators-extended/readme.md](plans/05-lod-generators-extended/readme.md)

| #   | Plan                                                                                                 | Delivers                                                                     | Status |
| --- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------ |
| A1  | [2dfx unified carry](plans/05-lod-generators-extended/a1-2dfx-unified-carry.md)                      | one keep-policy across verbatim/decimate/cell; coronas correct everywhere    | idea   |
| A2  | [rotation-bearing 2dfx on cells](plans/05-lod-generators-extended/a2-2dfx-rotation-bearing-cells.md) | roadsigns & escalators into baked cells (re-transform orientation)           | idea   |
| A3  | [particle emitters on LODs](plans/05-lod-generators-extended/a3-2dfx-particle-emitters-lods.md)      | rate-budgeted emitters through decimate/cell encoders (with 03-asi/010)      | idea   |
| B1  | [procobj density model](plans/05-lod-generators-extended/b1-procobj-density-model.md)                | build-time per-category/per-surface density, replaces vanilla cutoff         | idea   |
| B2  | [biome/zone density](plans/05-lod-generators-extended/b2-biome-zone-density.md)                      | zone×scatter join + slope proxy: desert cacti, forest bushes, mountain rocks | idea   |
| B3  | [budget lift & integration](plans/05-lod-generators-extended/b3-budget-lift-integration.md)          | raise int16-era caps for the asi target; perf becomes the new limiter        | idea   |

## Normals & smoothing groups in map-optimizer — SHIPPED (2026-07-15, idea plan deleted)

Graduated and built as map-optimizer plans
[020](../../../tools/map-optimizer/docs/plans/020-preserve-authored-normals.md) (preserve authored normals,
sanity-gated) · [021](../../../tools/map-optimizer/docs/plans/021-angle-weighted-normals.md) (corner-angle
weighting) · [022](../../../tools/map-optimizer/docs/plans/022-two-sided-smooth-groups.md) (two-sided
twin-quad smoothing) · [023](../../../tools/map-optimizer/docs/plans/023-crease-weld-robustness.md)
(per-model crease overrides + neighbour-cell weld), plus the opensa-pack
[001 missing-normals guard](../../../tools/opensa-pack/docs/plans/001-missing-normals-guard.md).
**Leftover, unowned:** HD→LOD normal transfer (decimated LODs sample nearest-surface normals from their HD
source instead of recomputing on the coarse mesh) — belongs to the `@opensa/lod-common` chain when someone
picks it up.

## Vehicle driving physics overhaul (THE priority gameplay task)

Driving feel rebuilt on Rapier: raycast-vehicle model (Rapier's DynamicRayCastVehicleController or own),
handling.cfg as the tuning source of truth (centreOfMass fixes rollover at the root), load transfer +
anti-dive (fixes brake nose-lift), anti-roll bars, slip-curve tyres, rate-limited speed-sensitive steering.
Telemetry harness + scripted test track FIRST — nothing tuned blind. Renderer-agnostic: survives the 074
flip untouched. Full plan: [plans/07-vehicle-physics/readme.md](plans/07-vehicle-physics/readme.md).
