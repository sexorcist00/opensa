# 002 — Plate material binding in buildVehicle

Part of the [vehicle license plates chain](../../readme.md). Depends on [001](001-plate-texture-generation.md) (the baked plate raster). Delivers a vehicle whose plate faces show a given text — text/city selection still hardcoded until [003](003-config-city-seeding.md).

## Context

Vehicle DFFs mark plate faces with two specially-named material textures:

- `carplate` — the plate face; SA swaps its texture for the generated raster
- `carpback` — the plate's back side; SA swaps it for the city's `plateback*`

`buildMaterial` (`packages/renderware/src/three/build-clump.ts`) already resolves material textures by lowercased name and stamps `material.name = rw.texture?.name` — the same name-matching seam `tagHeadlights` (`build-vehicle.ts`) uses. Plate faces can be part of ANY atomic, including damageable `_ok`/`_dam` variants (bumpers) — which is exactly why we retexture materials in place instead of adding meshes: the plate then automatically rides visibility swaps, door swings, and detach physics for free.

## Decisions

1. **Detect at material level, not mesh level.** During `buildVehicle`, collect every material whose RW texture name is `carplate` or `carpback` (case-insensitive), across ALL atomics — body, `_ok`, `_dam`, doors, extras. Expose them on `BuiltVehicle` as `plateMaterials: { face: MeshStandardMaterial[]; back: MeshStandardMaterial[] }` (naming to match the existing `reflectiveMaterials` precedent).
2. **Materials must not be shared across vehicles.** Verify `buildVehicleMaterial` clones per vehicle (it applies per-vehicle carcol paint, so it should) — if any caching shares material instances between two spawned cars, plate texture swap on one would leak to the other. Add a regression test.
3. **Apply is a dumb setter.** `applyPlate(built, texture, backTexture)` assigns `map` on the collected materials + `needsUpdate`. No knowledge of text/city here — that's plan 003's job. Vehicles with no `carplate` material (bikes, boats, RC) → no-op.
4. **`carpback` gets the city background raster as-is** (no text) — matches SA.

## Design

- `packages/renderware/src/three/build-vehicle.ts`
  - extend `BuiltVehicle` with `plateMaterials`
  - collect during the existing material walk (same pass as `tagHeadlights` — one traversal, not a second)
- `packages/renderware/src/three/build-plate.ts` (from 001)
  - add `applyPlate(plateMaterials, faceTexture, backTexture): void`

Test fixture: `tests/original` already ships `dff/vehicle/admiral.dff` + `vehicles/admiral.txd` + `models/generic/vehicle.txd` — check whether admiral carries `carplate`; if not, find a stock vehicle that does (most cars do) and add it to the `scripts/test-fixtures.ts` MANIFEST (then `npm run test:fixtures`).

## Tasks

- [ ] Confirm which fixture vehicle carries `carplate`/`carpback` materials (admiral first; else extend the fixture manifest).
- [ ] Collect `plateMaterials` in `buildVehicle` (single traversal, case-insensitive, all atomics incl. `_dam` variants). Type on `BuiltVehicle`.
- [ ] Regression test: two `buildVehicle` calls from the same clump → disjoint material instances (no cross-vehicle plate leak).
- [ ] `applyPlate` setter + no-op path for plateless vehicles.
- [ ] Integration test (real fixture): build vehicle, apply a generated plate, assert every `carplate` material (including the `_dam` mesh's) now maps the generated `DataTexture`.
- [ ] Lint/tsc; run only the touched test files.

## Verification

- `node node_modules/vitest/vitest.mjs run packages/renderware/src/three/build-vehicle.test.ts packages/renderware/src/three/build-plate.test.ts`
- Visual: spawn a car via the debug menu with a hardcoded plate — text readable, back side shows the background, `_dam` bumper (after a hit) still wears the same plate.

## Measurements

_(record after implementation)_

- vehicles in stock IDE set carrying `carplate`: …
- extra build-time per vehicle from the material walk: …
