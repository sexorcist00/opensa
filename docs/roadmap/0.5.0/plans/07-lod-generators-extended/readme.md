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
2. **The binding procobj ceiling is SLOTS, not the int16 row ceiling.** Measured 2026-08-07 on
   `build/original/opensa`: **20 146 / 32 767 text rows** but **38 / 40 IPL slots** (build guard 39) — ONE
   free slot. Reaching the density target costs ~16 312 text rows (fits, 29 504 against the 30 000 guard)
   and **>= 19 areas against the 9 we ship** (does not fit, by ~10 slots). The int16 lift our ASI uniquely
   provides is **not** on the critical path; the per-area `LoadScene` budget and the slot array are.
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
   build guards are right to keep enforcing it — but on the install we ship to, **the density target needs
   no ceiling lifted at all**, and the limiter is memory and frame time. The one ceiling no adjuster touches
   is int16, which `perfect-map.asi` already carries there at 2.23× the limit.

## Priorities

Ordered by *what unblocks the most for the least*, not by plan number.

| P | Plan | Why here |
| --- | --- | --- |
| **P0** | [lod-procobj-generator/00 — limit route review](lod-procobj-generator/00-limit-route-review.md) | A decision, no code. Nothing in the density chain can SHIP until it says which ceiling we lift and who lifts it. Now has a target to cost and a real 57.6k-row corpus to test against. |
| **P1** | [lod-procobj-generator/01 — species floor](lod-procobj-generator/01-species-representation-floor.md) | A real fairness defect at TODAY's density; costs zero rows and zero slots, so it is gated on nothing. |
| ~~P1~~ | [rw-codec/01 — typed 2dfx codecs](../../../../../tools/rw-codec/docs/plans/001-typed-2dfx-payload-codecs.md) | **SHIPPED 2026-08-07** and moved into the tool. Pure codec, no behaviour change; it unblocked every transform below it. |
| ~~P1~~ | [lod-common/01 — keep policy](../../../../../tools/lod-common/docs/plans/005-2dfx-keep-policy.md) → [02 — entry transform](../../../../../tools/lod-common/docs/plans/006-2dfx-entry-transform.md) | **SHIPPED 2026-08-07** as lod-common `005` + `006`. Stock output is unchanged, and the census says why: no stock model carrying 2dfx hangs it off a rotating frame. |
| ~~P1~~ | [opensa-lod-generator/01 — adopt](../../../../../tools/opensa-lod-generator/docs/plans/005-adopt-2dfx-policy.md) | **SHIPPED 2026-08-07** as opensa-lod-generator `005` and moved into the tool. |
| ~~DEAD~~ | [opensa-lod-generator/02 — rotation-bearing 2dfx on cells](../../../../postmortem/07-2dfx-on-baked-cells.md) | **DIED 2026-08-07 before any code** → postmortem. Both premises failed measurement (world-space sign coords 489/489; nothing reads a cell LOD's 2dfx section), the real gap is a 560-unit band in `cell-weld`, and the user closed that route: no glyphs in the LOD level. |
| **P1** | [sa-lod-generator/01 — adopt](sa-lod-generator/01-adopt-2dfx-policy.md) | Behaviour-preserving adoption; the regression fixture that proves the refactor. |
| **P2** | [lod-procobj-generator/02 — density model](lod-procobj-generator/02-density-model.md) → [03 — biome density](lod-procobj-generator/03-biome-zone-density.md) | Buildable and testable now at today's totals; SHIPPING raised density waits on P0's route. |
| **P2** | [lod-procobj-generator/04 — slot economy & budgets](lod-procobj-generator/04-slot-economy-and-budgets.md) | Reshaped by P0. Where perf replaces int16 as the limiter. |
| **P3** | [lod-common/03 — emitter thinning](lod-common/03-emitter-thinning.md) → [sa-lod-generator/02 — particle emitters](sa-lod-generator/02-particle-emitters.md) | Not blocked (finding 4) — last because two thirds of it already shipped and the rest starts with a measurement of what is already running, not with code. |

**Suggested first slice:** P0 (a review, cheap) in parallel with the `rw-codec/01 → lod-common/01+02 →
opensa-lod-generator/01+02` line, which ships a visible improvement without touching a single limit.
**That line is finished** (2026-08-07): `rw-codec/01`, `lod-common/01`, `lod-common/02` and
`opensa-lod-generator/01` shipped and moved into their tools, and `opensa-lod-generator/02` **died into a
[postmortem](../../../../postmortem/07-2dfx-on-baked-cells.md)** — the section it would widen is read by no
consumer we ship, and the route that would have fixed the real gap (welding glyphs into the LOD level in
`cell-weld`) is closed by decision. What is left of the 2dfx chain is `sa-lod-generator/01` and the P3
emitter pair.

## Working rules while this plan runs

1. **No full map rebuild through `perfect-map-builder` until this plan is finished** (decided 2026-08-07).
   Every plan here changes what a LOD carries, so a rebuild taken mid-chain is a pak whose contents nobody
   can attribute to a step. Tool-level verification (unit tests, fixture round-trips, single-model or
   single-cell runs) is what each step is judged on; the map is rebuilt once, at the end, and THAT is the
   run whose numbers go to `docs/benchmarks/`.
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
| ~~opensa-lod-generator/~~ (01 shipped, [moved](../../../../../tools/opensa-lod-generator/docs/plans/); 02 [died](../../../../postmortem/07-2dfx-on-baked-cells.md)) | `tools/opensa-lod-generator` | `tools/lod-common`; **02's real home turned out to be `packages/cell-weld`, and that route is closed** |
| [lod-procobj-generator/](lod-procobj-generator/) | `tools/lod-procobj-generator` (the CLI + `config.ts`) | **`tools/map-placement`** (`procobj/convert.ts`, `streamed-areas.ts`) and **`packages/renderware`** (`map/procobj-scatter.ts`) hold most of the code; `tools/perfect-map-builder` holds the guards |

## Chains

### 2dfx on LODs

| Plan | Delivers | Gate | Status |
| --- | --- | --- | --- |
| [rw-codec/01](../../../../../tools/rw-codec/docs/plans/001-typed-2dfx-payload-codecs.md) | typed decode/encode for roadsign(7), escalator(10), particle(1) payloads; round-trip identity | none | **SHIPPED** — `@opensa/rw-codec/two-d-effect`; the stock census lives in its Measurements |
| [lod-common/01](../../../../../tools/lod-common/docs/plans/005-2dfx-keep-policy.md) | ONE declared keep-policy replacing three ad-hoc keep-sets | none | **SHIPPED** — `@opensa/lod-common/two-dfx-policy` + [`docs/2dfx-policy.md`](../../../../../tools/lod-common/docs/2dfx-policy.md) |
| [lod-common/02](../../../../../tools/lod-common/docs/plans/006-2dfx-entry-transform.md) | `transform2dfxEntry` — position for verbatim types, orientation for the typed ones | rw-codec/01 | **SHIPPED** — both existing call sites rerouted, output unchanged |
| [lod-common/03](lod-common/03-emitter-thinning.md) | LOD-range emitter thinning / rate budget — 03-asi/010's deferred half | none | idea |
| [sa-lod-generator/01](sa-lod-generator/01-adopt-2dfx-policy.md) | verbatim + decimate paths routed through the policy, output byte-identical | lod-common/01 | idea |
| [sa-lod-generator/02](sa-lod-generator/02-particle-emitters.md) | emitters on the DECIMATE path + the far-view budget (verbatim already ships) | none | idea |
| [opensa-lod-generator/01](../../../../../tools/opensa-lod-generator/docs/plans/005-adopt-2dfx-policy.md) | cell bake routed through the policy (replaces the `LIGHT_2DFX` literal) | lod-common/01 | **SHIPPED** |
| [opensa-lod-generator/02](../../../../postmortem/07-2dfx-on-baked-cells.md) | roadsigns & escalators survive into baked cells, correctly oriented | lod-common/02 | **DEAD** — [postmortem](../../../../postmortem/07-2dfx-on-baked-cells.md); residue: the cell LOD's 2dfx section is dead weight |

### Procobj density

| Plan | Delivers | Gate | Status |
| --- | --- | --- | --- |
| [lod-procobj-generator/00](lod-procobj-generator/00-limit-route-review.md) | **go/no-go: which ceiling do we lift, and who lifts it** | none | review |
| [lod-procobj-generator/01](lod-procobj-generator/01-species-representation-floor.md) | every eligible species survives the cap — no silently missing type | none | idea |
| [lod-procobj-generator/02](lod-procobj-generator/02-density-model.md) | build-time configurable density per category/surface | none to build | idea |
| [lod-procobj-generator/03](lod-procobj-generator/03-biome-zone-density.md) | zone × scatter join + slope proxy: desert cacti, forest bushes, mountain rocks | 02 | idea |
| [lod-procobj-generator/04](lod-procobj-generator/04-slot-economy-and-budgets.md) | raise the int16-era budgets; perf becomes the limiter; in-game validation | **00's decision** | idea |

Dependencies: `rw-codec/01 → lod-common/02 → opensa-lod-generator/02`; `lod-common/01 → {sa-lod/01,
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
- procobj scatter (`packages/renderware/src/map/procobj-scatter.ts`): `PROC_OBJ_MAX_DENSITY = 3`, count
  `= area/spacing × density`, per-placement `lottery`; build-time cutoff hardcoded `lottery < 1`
  (`map-placement/src/procobj/convert.ts`). `procObjCategory(model, surface)` →
  bushes/cacti/flowers/grass/rocks/trees already exists; surface names from `surfinfo.dat`; zones parseable
  (`parseZones`, info.zon) but **not joined to scatter**.
- Budget guards in play: `AREA_MAX_PAIRS = 2000` / `STREAM_MAX_INST = 512` (`streamed-areas.ts`),
  `procObjMax = 20000` (`config.ts`), `TEXT_ROW_CAP = 30000` (`pipeline.ts`), `PROC_OBJ_MAX_DENSITY`.
