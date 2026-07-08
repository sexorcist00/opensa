# 004 — Damage integration & end-to-end verification

Part of the [vehicle license plates chain](../../readme.md). Depends on [001](001-plate-texture-generation.md)–[003](003-config-city-seeding.md). Closes the user requirement: _plates sit on damageable parts — when the part moves, deforms, or detaches, the plate must follow._

## Context

The damage pipeline (already shipped):

- `buildVehicle` builds damageable parts as `ok` + `dam` mesh pairs under a per-part `pivot: Group` (`addPanel`/`addDoor`, `packages/renderware/src/three/build-vehicle.ts`); `dam` starts `visible = false`.
- `VehicleDamageSystem` (`packages/game/src/vehicle/vehicle-damage.system.ts`): first strong hit → swap `ok.visible/dam.visible`; second hit → `detach()` reparents the `pivot` to the world and animates it falling.
- Doors swing via `vehicle-door.ts` / `vehicle-rig.ts` — the door mesh (with its materials) rotates under its hinge pivot.

Because plan 002 retextures the `carplate`/`carpback` materials **inside the part meshes themselves** (both `_ok` and `_dam` variants), the plate inherently follows every transform: swing, deform-swap, detach-fall. This plan is therefore mostly VERIFICATION plus the known edge cases — no new architecture is expected. If verification finds a case where the plate is its own atomic (not part of a damageable part's geometry) parented outside the moving pivot, fixing its parenting is in scope here.

## Edge cases to hunt

1. **Plate as a standalone atomic.** Some models may carry the plate face in a separate non-`_ok/_dam` atomic positioned over the bumper. If its frame parent differs from the bumper's, a detached bumper would leave the plate floating. Detection: dump frame parents of atomics containing `carplate` materials across the stock vehicle set (offline script over `vehicles.ide` models); reparent at build time to the co-located part pivot if hits exist.
2. **`_dam` variant missing the plate material.** If the damaged bumper mesh has no `carplate` material, the swap silently loses the plate — acceptable (SA behaves likewise); just confirm no crash.
3. **Detached part material lifetime.** `detach()` later removes the fallen part — verify the generated `DataTexture` is not disposed while still referenced by the (cached, shared) `(text, city)` entry; and conversely that vehicle unload doesn't dispose the shared cache texture. Decide ownership: cache owns textures, vehicles never dispose plate maps — document it in `build-plate.ts`.
4. **LOD meshes.** Vehicle LOD atomics may also reference `carplate` — confirm plan 002's collection covers them (it walks all atomics) so far-away cars don't show the stock placeholder text.

## Tasks

- [ ] Offline sweep: script over stock vehicle DFFs — per model, list atomics/materials named `carplate`/`carpback`, their frame parents, and whether they sit inside `_ok`/`_dam` geometry. Record the census here (how many standalone-atomic plates exist, if any).
- [ ] Fix parenting for standalone-plate models if the census finds them (attach to the co-located part pivot in `buildVehicle`).
- [ ] Texture-lifetime rules in `build-plate.ts` (cache owns; add a `disposePlateCache()` for full teardown paths if the engine has one).
- [ ] Integration test: build fixture vehicle → apply plate → simulate part swap (`ok.visible=false; dam.visible=true`) → assert the visible mesh's `carplate` material carries the generated map; simulate `detach`-style reparent → plate material still on the detached subtree.
- [ ] In-game session (real bumper physics): ram a plated car — deformed bumper keeps the plate; second hit — falling bumper carries the plate to the ground; door with a plate (if any model has one) swings correctly.
- [ ] Chain wrap-up: update the [chain readme](../../readme.md) statuses; record all Measurements sections; consider promoting these docs from `ideas/` to `docs/plans/` numbering when implementation starts.

## Verification

- `node node_modules/vitest/vitest.mjs run packages/renderware/src/three/build-vehicle.test.ts packages/game/src/vehicle/vehicle-damage.system.test.ts` (touched files only)
- In-game damage session per above; screenshots in the PR.

## Measurements

_(record after implementation)_

- standalone-plate-atomic models found: …
- plate census (models with carplate / carpback / both): …
