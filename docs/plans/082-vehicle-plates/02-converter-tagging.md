# 082/02 — Converter: plate submeshes + source-TXD keep rule + census

The offline half: after conversion, material names are gone — the `.osm` must carry the plate
information structurally. All work in `tools/opensa-pack` (`vehicle-osm.ts` / the vehicle builder).

## 1. Plate submesh split + flag

- During vehicle conversion, a material whose RW texture name is `carplate` or `carpback`
  (case-insensitive) emits its triangles into a SEPARATE submesh (the builder already emits
  vertices per material group since the 003 straddle fix — this is a grouping tweak, not a new
  pass), flagged in the submesh record: `plate: 'face' | 'back'` in DESC (extend the submesh
  serialization; absent = not a plate — old `.osm` readers unaffected, new reader of old files
  sees no flag → stock look).
- The flag must survive across ALL parts — body, `_ok`/`_dam` variants, doors, extras and vehicle
  LOD atomics (the idea's plan-004 edge cases) — the split runs wherever material groups are
  emitted, so this is by construction; the census (below) verifies it.
- The plate submesh KEEPS its stock texture layers too (the converted `carplate` texture stays in
  the model's array): a car whose plate was never assigned renders the stock placeholder — the
  graceful-degradation rule, and the reason the WGSL override (plan 03) is per-instance, not
  per-model.

## 2. `generic/vehicle.txd` keep rule (phase-0 check)

- opensa-pack 003's deletion rule removes a `.txd` when every model naming it converted. Verify
  what happened to `models/generic/vehicle.txd` in a converted game dir: if deleted, add a keep
  rule (named exception next to the txdp-parent rule, with a comment pointing here) — the runtime
  parses it for plate sources (plan 01). If kept (likely — it is loaded per-car as a merged
  generic dictionary, not "named" by models), record that and move on.

## 3. Census (the idea's plan-004 sweep, now offline in the converter)

- A convert-time report (or a small standalone sweep over the stock vehicle set): per model —
  carries `carplate`? `carpback`? in `_dam` variants? in LOD atomics? any plate face in an atomic
  whose frame parent differs from the co-located damage part (the "standalone plate atomic" edge
  case — if hits exist, reparent at conversion into the part, and record the models).
- The census drives plan 04's verification scope and answers "which vehicles get plates" with a
  number instead of "most cars".

## Subtasks

- [ ] Submesh split + DESC flag + reader support (`VehicleSubmesh` gains optional `plate`);
      no-data-loss test extended (the anchor test pattern).
- [ ] Fixture test: a real plated car fixture (admiral or another census-confirmed model) converts
      to an `.osm` whose plate submeshes are flagged, including `_dam`.
- [ ] `generic/vehicle.txd` fate check + keep rule if needed + test pinning it survives a convert.
- [ ] Census sweep + report + ledger numbers; reparent fix if the edge case is real.
- [ ] Reconvert note: batch with the next planned reconvert; verify old-osm graceful path renders
      unchanged (fake-device assertion).

## Acceptance

- Converted plated fixture carries flagged plate submeshes on all variants; suite + no-data-loss
  green; census numbers in the ledger; `generic/vehicle.txd` guaranteed present in a converted dir.

## Ledger

_(census: models with carplate/carpback/both, dam/LOD coverage, standalone-atomic hits; TXD fate)_
