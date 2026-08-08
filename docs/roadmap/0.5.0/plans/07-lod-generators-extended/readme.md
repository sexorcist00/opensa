# 07 — LOD generators, extended

Two generator upgrades for the real-game pipeline, **restructured 2026-08-07 into one folder per TOOL** —
the previous A1–A3 / B0–B4 split cut across tool boundaries, so no single plan mapped to a shippable diff.
Each folder below is one tool's chain; the numbers inside a folder are its order.

- **2dfx on LODs** (`rw-codec` → `lod-common` → the two LOD generators). Today the LOD generators strip
  particle 2dfx and baked cells keep only type-0 lights. Carry the full richness instead: coronas correct and
  consistent everywhere, street-name roadsigns and escalators into baked cells, rate-budgeted particle
  emitters at range.
- **Procobj density** (`lod-procobj-generator`). Scatter is pinned to vanilla density (`lottery < 1`) and
  capped by budgets that exist because of the int16 bug. Make density configurable and biome-aware — denser
  bushes in forest, rocks on mountain slopes, cacti in the desert — and find the ceiling that actually binds.

**How much is "more" is no longer a feeling:** [density-target.md](density-target.md) costs a real shipping
mod's density (ProperFixes 2.2.1, **57 583 placed objects**) against our own build in rows and slots.

## What changed in this restructure

Four findings from re-reading the plan against the code, the restrictions and the ASI chain. Each one moved
a plan's premise, so they are stated here rather than buried:

1. **Baked-cell work is NOT ASI-gated.** The old readme said both parts are "worthless (crash the game) until
   their asi lands". That is false for everything landing on baked cells:
   [`restrictions/sa-target.md`](../../../../restrictions/sa-target.md) records that **opensa-lod-generator
   output is for OpenSA only** — real SA cannot load an uncapped per-cell LOD, so no ASI is involved. The
   roadsign/escalator carry — the most visible item in the whole plan — is **shippable today**.
2. **The FIRST ceiling is slots; the int16 ceiling is the second, and the target clears both.** Measured on
   `build/original/opensa`: **20 146 / 32 767 text rows** but **38 / 40 IPL slots** (build guard 39) — ONE
   free slot, so a stock build can grow the layer by **1.18×** and no further. Re-measured 2026-08-08
   ([`procobj-layer-census.ts`](../../../../../scripts/debug/procobj-layer-census.ts)), the target costs 24 437
   text rows — map-wide **38 096, over the int16 ceiling by 5 329** — in **29 areas** (slots 59 vs 40). The
   half-day-old claim that "the int16 lift is not on the critical path" was priced off a baseline 61 % too
   high; **it is on the path**, and it is the only one of the three that no adjuster can lift.
3. **Folding areas into fewer files cannot buy the target.** [00](lod-procobj-generator/00-limit-route-review.md)
   left this open as the cheap escape. It is now closed with a number: area count is set by the ~4 000-row
   per-area `LoadScene` budget, not by how files are grouped, so fewer files means areas that breach it.
   **On STOCK, again** — see finding 5.
4. **The particle chain's "Task 4, not built" gate is stale — it shipped.**
   [03-asi Phase 2](../../../../../asi/perfect-map/docs/plans/readme.md) 009 landed the emitter-lifecycle
   patch (confirmed in-game) and 010 flipped the pipeline: `sa-lod-generator` **keeps particles on the
   verbatim path by default today**, with `--strip-particles` as the stock-target opt-out. What 010 deferred
   is the far-view overdraw budget. So nothing in this plan is waiting on an unbuilt ASI fix, and the
   remaining particle work is the decimate path plus a measurement nobody has taken.

5. **And then the target install was captured, and two of those ceilings turned out not to exist on it.**
   [`gta-sa-original/reference-install.md`](../../../../gta-sa-original/reference-install.md), declared the
   baseline 2026-08-07: OLA sets **`EntitiesPerIpl = unlimited`** (the 4 096 per-file buffer that
   `AREA_MAX_PAIRS` guards) and **`EntityIpl = unlimited`** (the 40 slots), with `Buildings = 100000`. It
   runs **72 914 permanent rows in files of up to 9 627**. So findings 2 and 3 are the STOCK story and the
   build guards are right to keep enforcing it — but on the install we ship to, the slot and per-file
   ceilings are gone. The one ceiling no adjuster touches is int16, which `perfect-map.asi` already carries
   there at 2.23× the limit.

6. **And the layer's own baseline was wrong, which flipped finding 5's conclusion (2026-08-08).** "The
   density target needs no ceiling lifted at all" held only while the layer was believed to place 24 552
   objects; it places **15 286** — the old figure was the generated streams' RECORD count (HD + the unlinked
   LOD of every short species + 467 tree impostors sharing the areas). At the true 3.77× the target's rows
   clear int16, so on the reference install the target is **gated on our own asi** rather than free. The
   census is a script now, and it checks itself: [density-target.md](density-target.md) has the arithmetic,
   the two intermediate walls (1.18× slots, 2.95× int16) and the re-derivation command.

## Priorities

Ordered by *what unblocks the most for the least*, not by plan number.

| P | Plan | Why here |
| --- | --- | --- |
| **P0** | [lod-procobj-generator/00 — limit route review](lod-procobj-generator/00-limit-route-review.md) | A decision, no code. Nothing in the density chain can SHIP until it says which ceiling we lift and who lifts it. Now has a target to cost and a real 57.6k-row corpus to test against. |
| ~~P1~~ **→ P2, behind 02** | [lod-procobj-generator/01 — species floor](lod-procobj-generator/01-species-representation-floor.md) | **SIZED 2026-08-08.** Neither build-time cap can zero a species (MINDIST provably keeps the first of every batch; `procObjMax` does not even fire at 15 286/20 000) — so the plan's whole Context described the wrong site. The RUNTIME cell cap zeroes species in **19.8 % of stock clutter cells** (worst: 14 of 25 placed), but in the shipping build only 8 underwater rules still scatter and **none is lost**. Real, currently latent here, and it comes back when [02](lod-procobj-generator/02-density-model.md) raises density — so it follows 02 rather than leading. |
| ~~P1~~ | [rw-codec/01 — typed 2dfx codecs](../../../../../tools/rw-codec/docs/plans/001-typed-2dfx-payload-codecs.md) | **SHIPPED 2026-08-07** and moved into the tool. Pure codec, no behaviour change; it unblocked every transform below it. |
| ~~P1~~ | [lod-common/01 — keep policy](../../../../../tools/lod-common/docs/plans/005-2dfx-keep-policy.md) → [02 — entry transform](../../../../../tools/lod-common/docs/plans/006-2dfx-entry-transform.md) | **SHIPPED 2026-08-07** as lod-common `005` + `006`. Stock output is unchanged, and the census says why: no stock model carrying 2dfx hangs it off a rotating frame. |
| ~~P1~~ | [opensa-lod-generator/01 — adopt](../../../../../tools/opensa-lod-generator/docs/plans/005-adopt-2dfx-policy.md) | **SHIPPED 2026-08-07** as opensa-lod-generator `005` and moved into the tool. |
| ~~MOVED~~ | opensa-lod-generator/02 — rotation-bearing 2dfx on cells | **Died, then revived the same day into [plan 100](../../../../plans/100-2dfx-at-lod-range/readme.md)** — its research is that chain's step 00. Widened by the user's call: both generators bake 0 light, 1 particle and 7 roadsign, and `cell-weld` starts reading the cell bake's section. |
| ~~MOVED~~ | [sa-lod-generator/01 — adopt](sa-lod-generator/01-adopt-2dfx-policy.md) | **Superseded by [plan 100 step 05](../../../../../tools/sa-lod-generator/docs/plans/007-clone-2dfx-policy.md)**, which does the same adoption plus the carrying half of `02`. The file stays as the record of how it was scoped here. |
| **P2** | [lod-procobj-generator/02 — density model](lod-procobj-generator/02-density-model.md) → [03 — biome density](lod-procobj-generator/03-biome-zone-density.md) | Buildable and testable now at today's totals; SHIPPING raised density waits on P0's route. |
| **P2** | [lod-procobj-generator/04 — slot economy & budgets](lod-procobj-generator/04-slot-economy-and-budgets.md) | Reshaped by P0. Where perf replaces int16 as the limiter. |
| **P3** | [lod-common/03 — emitter thinning](lod-common/03-emitter-thinning.md) → [sa-lod-generator/02 — particle emitters](sa-lod-generator/02-particle-emitters.md) | The far-view emitter RATE BUDGET, the only 2dfx work still filed here. **Its gate is open** — [100/04](../../../../plans/100-2dfx-at-lod-range/04-authored-cull-distance.md) shipped, so emitters draw to their authored distance (smoke to the world edge). **Start with the measurement, not the mechanism**: 100/04 found the emitter system below the noise floor with a positive control, so the budget may have nothing to buy. Both generators now CARRY type-1, so thinning changes live output. |

**Suggested first slice:** P0 (a review, cheap) in parallel with the `rw-codec/01 → lod-common/01+02 →
opensa-lod-generator/01+02` line, which ships a visible improvement without touching a single limit.
**That line is finished** (2026-08-07): `rw-codec/01`, `lod-common/01`, `lod-common/02` and
`opensa-lod-generator/01` shipped and moved into their tools, and `opensa-lod-generator/02` **died and was
revived the same day as [plan 100](../../../../plans/100-2dfx-at-lod-range/readme.md)**, widened to both
generators plus the consumer that has to read them. `sa-lod-generator/01` and the carrying half of `02` went
with it (plan 100 step 05); what stays here is the far-view emitter RATE BUDGET — `lod-common/03` +
`sa-lod-generator/02` — a measurement nobody has taken.

## Working rules while this plan runs

1. **A full rebuild is judged by what it CAPTURES, not by when it is allowed** (the 2026-08-07 ban on
   rebuilding until this plan finished was lifted 2026-08-08, on the user's call — it had made
   [plan 100](../../../../plans/100-2dfx-at-lod-range/readme.md)'s owed field check a hostage of a chain it
   has nothing to do with, while [04](lod-procobj-generator/04-slot-economy-and-budgets.md)'s perf
   calibration needed a build of its own).

   What the ban was protecting is still true and is now the rule instead: **a step is judged on tool-level
   verification** — unit tests, fixture round-trips, single-model or single-cell runs — because a pak built
   mid-chain carries several steps at once and its contents cannot be attributed to any of them. A rebuild
   settles questions only a whole map can answer; it is not a step's evidence.

   And a rebuild only counts if it is captured, so every full run carries this manifest. Nothing on it can be
   gathered from the tree afterwards, so a missed item costs the run:

   | For | Capture | 2026-08-08 run |
   | --- | --- | --- |
   | plan 100/03 | 2dfx alive at LOD range — a chimney smoking past the HD boundary | **done** — LV plant stacks plume at 600 u |
   | plan 100/03 | plates survive to LOD range | **done, by COUNT** — `.oscell` minor 8 + HUD `signs N`; LOD level carries the HD level's quads exactly |
   | plan 100/03 | nothing DOUBLES at the transition band | **done** — one plume per stack at 300/400/440/600 u |
   | plan 100/04 | the look verdict for both `docs/hacks/` entries | **smoke done**, `insects`/floor not framed |
   | 07/04 | the streaming + frame baseline at TODAY's density, so a later density arm has a before | **done** — 8-scene sweep |
   | 07/00 | `procobj-layer-census.ts` and `ipl-row-census.ts` on the fresh tree | **done** — reproduced exactly |
   | standing | which pak build every figure was read from, into `docs/benchmarks/` BEFORE anything is analysed | **done** — buildTime in the note |

   **What the run taught about the manifest itself:** two of its rows were written as if a screenshot could
   answer anything a human eye could. Angular size decides that, not the build — a 2.4 m plate at LOD range
   is ~8 px, and no rebuild changes it. A capture item should name the INSTRUMENT, not just the sight. The
   plate row was then closed by BUILDING that instrument (`.oscell` minor 8, a roadsign quad count summed
   over visible cells), which cost less than the rounds spent squinting at a smudge would have.

   Keep the run re-usable with **`--keep-work`** — it is what leaves `<out>/.work` behind on a FULL run, so a
   second question can be asked of the same build instead of buying another one. `--until <stage>` also keeps
   it, but it is a stop point rather than a speed-up: `--until pack` still runs everything up to `pack`.
   What makes a RE-run cheap is `--exclude`, which leaves the excluded stage's previous output in place
   (only `.work` is cleared). **No flag makes a full rebuild fast** — budget it as a full rebuild.
2. **A finished step's plan doc MOVES into the tool it landed in.** Each tool keeps its own chain at
   `tools/<tool>/docs/plans/NNN-<name>.md` — when a step here ships, its file leaves this folder for the
   next free number in that tool's chain (its Measurements section filled in), and the row above is updated
   to point at the new home. This folder holds only what is still unbuilt.

## Tool map

Which package a plan's diff actually lands in — several plans touch a package that is not the tool they are
filed under, and that is worth knowing before estimating one.

| Folder | Tool | Also touches |
| --- | --- | --- |
| ~~rw-codec/~~ (shipped, [moved](../../../../../tools/rw-codec/docs/plans/)) | `tools/rw-codec` | — |
| [lod-common/](lod-common/) (01+02 shipped, [moved](../../../../../tools/lod-common/docs/plans/); 03 left) | `tools/lod-common` | `tools/rw-codec` (typed payloads), `packages/renderware` (the roadsign rotation convention) |
| [sa-lod-generator/](sa-lod-generator/) | `tools/sa-lod-generator` | `tools/lod-common`, `asi/perfect-map` (02 only) |
| ~~opensa-lod-generator/~~ (01 shipped, [moved](../../../../../tools/opensa-lod-generator/docs/plans/); 02 → [plan 100](../../../../plans/100-2dfx-at-lod-range/readme.md)) | `tools/opensa-lod-generator` | `tools/lod-common`; **02's real home turned out to be `packages/cell-weld`, and that route is closed** |
| [lod-procobj-generator/](lod-procobj-generator/) | `tools/lod-procobj-generator` (the CLI + `config.ts`) | **`tools/map-placement`** (`procobj/convert.ts`, `streamed-areas.ts`) and **`packages/renderware`** (`map/procobj-scatter.ts`) hold most of the code; `tools/perfect-map-builder` holds the guards |

## Chains

### 2dfx on LODs

| Plan | Delivers | Gate | Status |
| --- | --- | --- | --- |
| [rw-codec/01](../../../../../tools/rw-codec/docs/plans/001-typed-2dfx-payload-codecs.md) | typed decode/encode for roadsign(7), escalator(10), particle(1) payloads; round-trip identity | none | **SHIPPED** — `@opensa/rw-codec/two-d-effect`; the stock census lives in its Measurements |
| [lod-common/01](../../../../../tools/lod-common/docs/plans/005-2dfx-keep-policy.md) | ONE declared keep-policy replacing three ad-hoc keep-sets | none | **SHIPPED** — `@opensa/lod-common/two-dfx-policy` + [`docs/2dfx-policy.md`](../../../../../tools/lod-common/docs/2dfx-policy.md) |
| [lod-common/02](../../../../../tools/lod-common/docs/plans/006-2dfx-entry-transform.md) | `transform2dfxEntry` — position for verbatim types, orientation for the typed ones | rw-codec/01 | **SHIPPED** — both existing call sites rerouted, output unchanged |
| [lod-common/03](lod-common/03-emitter-thinning.md) | LOD-range emitter thinning / rate budget — 03-asi/010's deferred half | none | idea |
| [sa-lod-generator/01](sa-lod-generator/01-adopt-2dfx-policy.md) | verbatim + decimate paths routed through the policy, output byte-identical | lod-common/01 | **MOVED** → [plan 100/05](../../../../../tools/sa-lod-generator/docs/plans/007-clone-2dfx-policy.md) |
| [sa-lod-generator/02](sa-lod-generator/02-particle-emitters.md) | emitters on the DECIMATE path + the far-view budget (verbatim already ships) | none | **SPLIT** — the carry went to [plan 100/05](../../../../../tools/sa-lod-generator/docs/plans/007-clone-2dfx-policy.md); the far-view BUDGET stays here |
| [opensa-lod-generator/01](../../../../../tools/opensa-lod-generator/docs/plans/005-adopt-2dfx-policy.md) | cell bake routed through the policy (replaces the `LIGHT_2DFX` literal) | lod-common/01 | **SHIPPED** |
| opensa-lod-generator/02 | roadsigns & escalators survive into baked cells, correctly oriented | lod-common/02 | **MOVED** → [plan 100](../../../../plans/100-2dfx-at-lod-range/readme.md) (revived and widened; escalators stay out — no consumer) |

### Procobj density

| Plan | Delivers | Gate | Status |
| --- | --- | --- | --- |
| [lod-procobj-generator/00](lod-procobj-generator/00-limit-route-review.md) | **go/no-go: which ceiling do we lift, and who lifts it** | none | review |
| [lod-procobj-generator/01](lod-procobj-generator/01-species-representation-floor.md) | every eligible species survives the cap — no silently missing type | 02 (it is the RUNTIME cell cap only, and raised density is what makes it bite again) | **sized** — defect real on stock (19.8 % of clutter cells), latent in the shipping build |
| [lod-procobj-generator/02](lod-procobj-generator/02-density-model.md) | build-time configurable density per category/surface | none to build | idea |
| [lod-procobj-generator/03](lod-procobj-generator/03-biome-zone-density.md) | zone × scatter join + slope proxy: desert cacti, forest bushes, mountain rocks | 02 | idea |
| [lod-procobj-generator/04](lod-procobj-generator/04-slot-economy-and-budgets.md) | raise the int16-era budgets; perf becomes the limiter; in-game validation | **00's decision** | idea |

Dependencies (as originally scoped; the 2dfx half now lives in plan 100): `rw-codec/01 → lod-common/02 →
opensa-lod-generator/02`; `lod-common/01 → {sa-lod/01,
opensa-lod/01}`; `lod-common/03 → sa-lod/02`. `00 gates 04`; `02 → 03`. **01 is independent of
everything** — it is a defect at today's density, not one raised density introduces. The two chains are
independent of each other.

## Boundary vs the 03-asi chain

[03-asi/010](../../../../../asi/perfect-map/docs/plans/010-pipeline-keep-2dfx.md) is the **engine-integration
flip** for particle 2dfx: it **shipped** the un-strip (a single sa-lod call site — particles are kept by
default today) and **deferred** the far-view rate budget. This plan's `lod-common/03` +
`sa-lod-generator/02` are the **generator-side capability** 010 did not cover: carrying a complete,
correctly-transformed 2dfx set through every LOD representation — the decimate path it never touched, and the
budget it left open.

## Grounding (current code, verified 2026-08-07)

- Three LOD generators share `@opensa/lod-common` (`hdToLod`, `MeshBuilder`, `LodModifier` chain,
  `collectClumpEffects`, `encodeLodDff`): **sa-lod** (per-object verbatim/decimate clone,
  `tools/sa-lod-generator`), **opensa-lod** (cell bake, `tools/opensa-lod-generator`), **lod-procobj**
  (`tools/lod-procobj-generator` + `@opensa/map-placement`).
- 2dfx codec is `@opensa/rw-codec/dff`: `extract2dfxEntries(bytes, keepTypes?)` / `build2dfxSection(entries)`
  preserve any entry type **byte-verbatim**; `stripParticleEffects` drops only type-1. Types: 0 light/corona,
  1 particle, 7 roadsign, 10 escalator (others survive verbatim but are not decoded). The runtime parser
  (`packages/renderware/src/parsers/binary/dff.ts`) already decodes all four, and the OpenSA engine consumes
  them (`roadsign/glyph-quads.ts`, `fx/bake-fx.ts`). **Since `rw-codec/01`, `@opensa/rw-codec/two-d-effect`
  also decodes/encodes the roadsign, escalator and particle payloads themselves** (byte-identical round trip)
  — that is what `lod-common/02` transforms with. Stock corpus: 489 roadsign entries in 207 models, 5
  escalators in 4, 64 particles in 43; every type has exactly one payload size map-wide.
- 2dfx today: sa-lod verbatim keeps all-but-particle; decimate re-attaches via `collectClumpEffects`
  (all-but-particle); **cells keep only `LIGHT_2DFX = new Set([0])`**
  (`opensa-lod-generator/src/adapters/gta-sa/merge.ts:12`) — rotation-bearing types are dropped because a raw
  transplant repositions but does not re-rotate.
- procobj scatter (`packages/renderware/src/map/procobj-scatter.ts`): `PROC_OBJ_MAX_DENSITY = 3`, candidate
  count `= area / rule.spacing × PROC_OBJ_MAX_DENSITY`, and `lottery = random() × PROC_OBJ_MAX_DENSITY` —
  **uniform, with no per-species term**; a species' density is its `spacing` and is spent on the candidate
  count. (Read wrong for a fortnight — see [01](lod-procobj-generator/01-species-representation-floor.md).)
  Build-time cutoff hardcoded `lottery < 1`
  (`map-placement/src/procobj/convert.ts`). `procObjCategory(model, surface)` →
  bushes/cacti/flowers/grass/rocks/trees already exists; surface names from `surfinfo.dat`; zones parseable
  (`parseZones`, info.zon) but **not joined to scatter**.
- Budget guards in play: `AREA_MAX_PAIRS = 2000` / `STREAM_MAX_INST = 512` (`streamed-areas.ts`),
  `procObjMax = 20000` (`config.ts`), `TEXT_ROW_CAP = 30000` (`pipeline.ts`), `PROC_OBJ_MAX_DENSITY`.
