# A2 — Rotation-bearing 2dfx on baked cells (roadsigns & escalators)

Part of [05 — LOD generators, extended](readme.md), Part A. Depends on [A1](a1-2dfx-unified-carry.md) (the unified policy). Delivers the "и прочее" — 2dfx types that today can't ride a baked cell because they carry orientation, not just a position.

## Context

`opensa-lod` cells drop everything but type-0 because "rotation-bearing types can't ride a raw transplant" (`merge.ts:11`). The cell bake merges many instances into one cell-centre-relative mesh and repositions each 2dfx via `instanceTransform` — but it only rewrites the entry's **position** (`build2dfxSection` overwrites the first 12 bytes). Roadsign (type 7: plate size + **rotation** + text) and escalator (type 10: bottom/top/end **vec3s** + direction) encode orientation/geometry in their payload that a position-only transplant leaves pointing the wrong way. sa-lod's verbatim/decimate paths keep these correctly because they inherit the model's own frame — only the CELL path has the gap.

## Decisions

1. **Re-transform the orientation payload, per type.** Extend the transplant from "rewrite position" to "rewrite the type's spatial fields through the same `instanceTransform`":
   - **roadsign (7)**: rotate the plate rotation vector by the instance rotation; reposition the plate. (Runtime decoder fields known: plate size, rotation, flags, 4×16 text — `packages/renderware/src/parsers/binary/dff.ts`.)
   - **escalator (10)**: transform the bottom/top/end points and the direction vector by the instance transform (they're world-ish offsets that must move + rotate with the merged instance).
     This requires DECODING these two payloads (not just byte-verbatim), transforming, and re-encoding — a small typed codec in rw-codec beside `build2dfxSection`.
2. **Scope to types worth having at LOD range.** Roadsigns (distant street-name plates) and escalators are the sensible cell-carry additions; undecoded orientation types stay dropped on cells (policy from A1). Don't build codecs for types nobody sees at range.
3. **sa-lod already correct** — no change there; this plan is cell-path only. But the typed transform lives in lod-common so any path can opt in.
4. **Fidelity bar**: a baked-cell roadsign faces the same way and sits in the same place as the HD one; an escalator's implied motion line matches. Verified against fixtures with known roadsign/escalator 2dfx.

## Tasks

- [ ] rw-codec: typed decode/encode for roadsign(7) + escalator(10) 2dfx payloads (fields from the runtime parser); round-trip tests (decode→encode = identity on real entries).
- [ ] lod-common: a `transform2dfxEntry(entry, transform)` that position-rewrites verbatim types (today's behaviour) and orientation-rewrites the two typed ones; used by `collectCellLightEffects` (widened past `LIGHT_2DFX`).
- [ ] opensa-lod cells: extend the keep-policy (A1) to include 7/10 for the asi target; wire the typed transform in `merge.ts`/`index.ts`.
- [ ] Fixtures: models carrying a roadsign and an escalator 2dfx → bake a cell → assert plate orientation/position and escalator points match the HD-instance-transformed expectation.
- [ ] Stock-target regression: cells still carry only type-0 (no roadsign/escalator) — unchanged.
- [ ] Visual check in the map viewer: a distant baked cell shows correctly-oriented street-name signs.

## Verification

- Baked-cell roadsign/escalator orientation + position match HD (fixture math + viewer).
- Round-trip codec is byte-identity on unmodified entries (no corruption of the payload we now decode).
- Stock target unchanged.

## Measurements / notes

_(record after implementation)_

- roadsign orientation error vs HD: …
- types now carried on cells (asi target): …
