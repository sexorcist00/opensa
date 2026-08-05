# 099/01 — Bake the animation through (builder → fixture → `.osm` → reader)

The data exists at every stage except the rigid builder's output. This step threads it through
without touching the engine: after it, a rebaked `ferriswheel_lights.osm` SAYS it animates, and the
runtime reader hands the engine everything it will need in 02.

## Decisions

1. **The model owns its animations** (unlike the world, where the pak manifest owns a global list and
   cells index into it): `VehicleModelData.uvAnimations: RWUvAnimation[]` carries only the entries the
   model's materials actually reference, and each submesh gets an optional `uvAnim: number` — an index
   into THAT list (not a global slot). A script object streams in and out on its own; a global
   registry would leak names across models for nothing.
2. **Binding resolves at BUILD time, by the world's own rule**: material
   `effects.uvAnim.names[0]` → `clump.uvAnimations` by name (mirror `resolveUvAnim`,
   `packages/cell-weld/src/weld.ts:904` — an unknown name or empty keyframes = no animation, static
   geometry, never an error). Channel mask beyond UV0 is out of scope (the world lane ignores it too).
3. **DESC fixture: optional field, old files unchanged.** `VehicleFixture` gains
   `uvAnimations?: { duration, keyframes, name }[]` and submesh rows gain `uvAnim?: number` — the
   "absent on old fixtures" pattern (`bounds`/`center` precedent, engine.ts:374). No version bump, no
   migration; an old `.osm` decodes to "none".

## Subtasks

- [ ] `build-vehicle-model.ts`: resolve material → dict entry in `appendGeometry`'s material walk;
      thread the model-local animation list into `VehicleModelData` + the submesh records.
- [ ] `VehicleFixture` (renderware vehicle types) + `tools/opensa-pack/src/model-osm.ts` (the fixture
      is serialized as-is — verify nothing strips unknown fields) + `readModelOsm`
      (`packages/game/src/adapters/vehicle-osm.ts`) + `toRigidModelInit` → `VehicleModelInit`.
- [ ] Tests (builder): a synthetic clump whose material references a dict entry → submesh carries the
      slot and the model carries the keyframes; an unknown name → no slot; a clump with a dict but no
      referencing material → empty list (negative cases first, per the house test structure).
- [ ] Tests (round-trip): encode a fixture with animations → `readModelOsm` returns them; an old
      fixture without the field → none.
- [ ] Rebake the ferris models through the normal pipeline; `scripts/debug/dump-osm.ts
      ferriswheel_lights` prints the animation row (extend the dump to show it — it is the check).

## Verification

`dump-osm.ts ferriswheel_lights` shows `uvAnimations: f13d (13 steps × 0.225 s, loop 29.25 s)` and the
`Frames` submesh flagged with its slot; every OTHER model's dump is byte-identical to before the
change (the builder emits the field only when a material references a dict). Record the fixture size
delta in the ledger.

## Ledger

_(numbers on completion)_
