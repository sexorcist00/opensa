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

## Tool map

Which package a plan's diff actually lands in — several plans touch a package that is not the tool they are
filed under, and that is worth knowing before estimating one.

| Folder | Tool | Also touches |
| --- | --- | --- |
| [rw-codec/](rw-codec/) | `tools/rw-codec` | — |
| [lod-common/](lod-common/) | `tools/lod-common` | `tools/rw-codec` (typed payloads) |
| [sa-lod-generator/](sa-lod-generator/) | `tools/sa-lod-generator` | `tools/lod-common`, `asi/perfect-map` (02 only) |
| [opensa-lod-generator/](opensa-lod-generator/) | `tools/opensa-lod-generator` | `tools/lod-common` |
| [lod-procobj-generator/](lod-procobj-generator/) | `tools/lod-procobj-generator` (the CLI + `config.ts`) | **`tools/map-placement`** (`procobj/convert.ts`, `streamed-areas.ts`) and **`packages/renderware`** (`map/procobj-scatter.ts`) hold most of the code; `tools/perfect-map-builder` holds the guards |

## Chains

### 2dfx on LODs

| Plan | Delivers | Gate | Status |
| --- | --- | --- | --- |
| [rw-codec/01](rw-codec/01-typed-2dfx-payload-codecs.md) | typed decode/encode for roadsign(7), escalator(10), particle(1) payloads; round-trip identity | none | idea |
| [lod-common/01](lod-common/01-2dfx-keep-policy.md) | ONE declared keep-policy replacing three ad-hoc keep-sets | none | idea |
| [lod-common/02](lod-common/02-2dfx-entry-transform.md) | `transform2dfxEntry` — position for verbatim types, orientation for the typed ones | rw-codec/01 | idea |
| [lod-common/03](lod-common/03-emitter-thinning.md) | LOD-range emitter thinning / rate budget — 03-asi/010's deferred half | none | idea |
| [sa-lod-generator/01](sa-lod-generator/01-adopt-2dfx-policy.md) | verbatim + decimate paths routed through the policy, output byte-identical | lod-common/01 | idea |
| [sa-lod-generator/02](sa-lod-generator/02-particle-emitters.md) | emitters on the DECIMATE path + the far-view budget (verbatim already ships) | none | idea |
| [opensa-lod-generator/01](opensa-lod-generator/01-adopt-2dfx-policy.md) | cell bake routed through the policy (replaces the `LIGHT_2DFX` literal) | lod-common/01 | idea |
| [opensa-lod-generator/02](opensa-lod-generator/02-rotation-bearing-2dfx-on-cells.md) | roadsigns & escalators survive into baked cells, correctly oriented | lod-common/02 | idea |

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
  them (`roadsign/glyph-quads.ts`, `fx/bake-fx.ts`).
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
