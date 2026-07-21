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

**→ Promoted to working plans (2026-07-19): [docs/plans/082-vehicle-plates/](../../plans/082-vehicle-plates/readme.md)** —
rethought for the own engine (the three-era material-swap mechanism no longer exists; per-instance
plates now ride a shared plate ATLAS array + a per-instance slot, with flagged plate submeshes emitted
by opensa-pack). The idea's original sub-plan docs were absorbed there and deleted.

## Rendering overhaul ("modern lighting" fork)

Full rework of vanilla rendering toward modern-game visuals while preserving the SA prelit/night-vertex vibe — the T3 fork plan 038 left out of scope. Real building shadows (CSM + LOD shadow proxies), PBR sky with a 512×1 horizon LUT feeding fog/water, fog that actually cuts the horizon, realistic water, real headlight/street-lamp lights (coronas demoted to distant impostors), glowing tobj/night-vertex emissives, and an opensa-native asset step in perfect-map-builder (meshopt/KTX2 + baked sun-visibility/AO channels — no longer bound to DFF/TXD). Every stage lands behind a toggle with measured frame budgets; the default flips only at the end.

**→ Promoted to working plans (2026-07-10): [docs/plans/062 — Rendering overhaul](../../plans/062-rendering-overhaul/readme.md)** — the chain overview + the ten stage plans now live as `docs/plans/062–072` (foundations 063, hybrid lighting 064, shadows 065, pmb asset step 066, sky 067, fog 068, water 069, local lights 070, night 071, tiers/default-flip 072). Statuses tracked there.

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

Phase 2 — a second engine fix on the same framework: the **2dfx particle-emitter leak on LODs** ([lod-2dfx-particles.md](../../../docs/open-issues/fixed/lod-2dfx-particles.md)). Cloned-LOD emitters never unload → pool exhaustion → new-game crash (`0x004AA3A1`); we currently strip particles at build time, ProperFixes fixes the lifecycle in-engine. RE it, patch it in our asi, then let the pipeline keep distant smoke/fire on LODs (the issue's remaining goal) with a LOD-range emitter budget against overdraw.

| #   | Plan                                                                                                                 | Delivers                                                                                             | Status |
| --- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------ |
| 7   | [007 — Reproduce the 2dfx emitter-leak crash](../../../asi/perfect-map/docs/plans/007-2dfx-reproduce.md)             | **first Phase-2 task** — deterministic un-stripped-emitter repro of `0x004AA3A1` + leak/crash oracle | idea   |
| 8   | [008 — 2dfx emitter lifecycle: RE & root cause](../../../asi/perfect-map/docs/plans/008-2dfx-emitter-re.md)          | why cloned-LOD emitters leak; PF's patch located; catalogue rows                                     | idea   |
| 9   | [009 — 2dfx emitter-lifecycle patch](../../../asi/perfect-map/docs/plans/009-2dfx-emitter-patch.md)                  | the fix in our asi; new-game crash gone with particle 2dfx present + emitters actually unload        | idea   |
| 10  | [010 — Pipeline: keep 2dfx on LODs + far-view budget](../../../asi/perfect-map/docs/plans/010-pipeline-keep-2dfx.md) | stop stripping (opensa-asi target); LOD-range rate/sprite budgets kill overdraw                      | idea   |

## Basic CLEO support

Run compiled GTA:SA CLEO `.cs` scripts inside the browser engine, starting from the two real Junior_Djjr "spin an object" mods in `NO_COMMIT/1/` (Wind Farm, Rotating Ferris Wheel), on a deliberately extensible architecture. Answers the three open questions: parse `.cs` via an SCM decoder driven by the Sanny Builder opcode DB; give scripts an API through a `CleoHost` handler registry bridged to engine primitives; ship it as a **separate runtime module** (`packages/cleo`) attached via `game.addSystem` — following the `game/mods` precedent, not the renderware-free core, not a rendering plugin. Cooperative thread VM, per-frame instruction budget, memory-op boundary for the future, script tracer + opcode-coverage tooling.

**→ Promoted to working plans (2026-07-19): [docs/plans/083-cleo-basic/](../../plans/083-cleo-basic/readme.md)** —
rethought for the own engine (the language core survived; the world bridge now rides the rigid-model
`.osm` path instead of three's `Object3D`/`streamingRoot`, and the decoder lifts the existing CLEO
`0x014B` car-generator operand reading into a shared SCM grammar). The idea's original sub-plan docs
were absorbed there and deleted.

## LOD generators, extended — MOVED to 0.5.0 (2026-07-19)

Two generator upgrades (LODs carry full 2dfx; biome-aware procobj density), both gated on the
opensa-asi chain. Moved with the cycle re-scope:
[../0.5.0/plans/07-lod-generators-extended/readme.md](../0.5.0/plans/07-lod-generators-extended/readme.md).

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

Driving feel rebuilt on Rapier: handling.cfg as the tuning source of truth (centreOfMass fixes rollover
at the root), anti-roll bars + anti-dive (fixes brake nose-lift), drivetrain/brake identity, tyre/steering
feel with a measured own-controller gate. Telemetry harness + scripted test track FIRST — nothing tuned blind.

**→ Promoted to working plans (2026-07-19): [docs/plans/081-vehicle-physics/](../../plans/081-vehicle-physics/readme.md)**
— rethought against the own engine (DRCVC is production since plan 018; 080 maps the real current state).
The idea's sub-plan folder was absorbed there and deleted.
