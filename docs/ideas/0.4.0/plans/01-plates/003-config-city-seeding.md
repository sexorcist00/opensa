# 003 — Config API, city binding, per-vehicle seeding

Part of the [vehicle license plates chain](../../readme.md). Depends on [001](001-plate-texture-generation.md) + [002](002-plate-material-binding.md). Delivers the user-facing feature: masks in `Game.getInstance` config, city-correct backgrounds, stable per-vehicle plates.

## Context

- `Config.vehicle` (`packages/game/src/interfaces/config.interface.ts`, `VehicleConfig`) today holds only LOD distances — the natural home for the new `plates` block.
- City is already tracked: `City = 'COUNTRYSIDE' | 'DESERT' | 'LA' | 'SF' | 'VEGAS'` (`packages/game/src/zones/city.ts`), `cityAt(x, y, boxes)` AABB lookup, `Game.getCity()` live value, `orderedCityBoxes` wired in `canvas-host.tsx`.
- All vehicles pass through one choke point: `spawnVehicle(placement, anchor?)` in `apps/web/src/ui/canvas-host.tsx`, fed by parked.json, IPL car generators (`carGeneratorPlacements`), and the debug menu.
- `VehicleLodSystem` unloads distant cars and respawns them from the stored `VehiclePlacement` — any plate state kept only on the spawned object dies at respawn.

## Decisions

1. **Config shape** (as requested):

   ```ts
   type VehiclePlatesConfig = {
     readonly ls: string; // mask for Los Santos plates
     readonly sf: string; // mask for San Fierro plates
     readonly lv: string; // mask for Las Venturas plates
   };
   // VehicleConfig gains: plates: VehiclePlatesConfig
   ```

   Mask DSL from plan 001 (`L`/`D`/`*`/literals). Empty string → plan 001's default mask. Follow the `VehicleReflectionConfig` precedent for defaults + a `setVehiclePlates`-style setter beside `setVehicleReflection` (`game.ts`), broadcasting through the existing `configChanged` path.

2. **City is decided at SPAWN POSITION, not camera city.** A car parked in San Fierro must wear an SF plate even when first streamed in from far away — use `cityAt(placement.position, orderedCityBoxes)`, not `Game.getCity()` (which tracks the player).
3. **Outside the three cities (COUNTRYSIDE / DESERT) — pick one of the three at random** (user decision). Random must be DETERMINISTIC per vehicle: seed from the placement (see 4), so a country parked car keeps one plate across LOD respawns/reloads.
4. **Seed = hash of placement.** `seed = hash(model, position.x, position.y, position.z)` (any cheap integer hash). Derives BOTH the text (`generatePlateText(mask, seed)`) and the out-of-city region pick (`seed % 3`). No new persisted field needed for map cars — the placement itself is the identity. `VehiclePlacement` gains an optional `plate?: { text: string; city: PlateCity }` override for callers that want explicit plates (debug menu, future missions); absent → derived from hash.
5. **Config changes apply to NEW spawns only.** Already-spawned vehicles keep their plates (matches how LOD-distance config behaves); documenting this beats retexturing the live fleet for a debug-facing knob.

## Design

- `packages/game/src/interfaces/config.interface.ts` — `VehiclePlatesConfig`, default `{ ls: '', sf: '', lv: '' }`.
- `packages/game/src/vehicle/vehicle-plates.ts` (new, small): `resolvePlate(placement, platesConfig, cityBoxes): { text, city }` — city lookup → mask pick → seeded text; out-of-city random pick. Pure, unit-testable.
- `apps/web/src/ui/canvas-host.tsx` `spawnVehicle`: after `loadVehicle`, `resolvePlate(...)` → `buildPlateTexture(...)` → `applyPlate(built.plateMaterials, ...)`. One extra call site, no new system.
- `packages/game/src/game.ts`: setter + config plumb (mirror `setVehicleReflection`).
- Map city keys: config `ls`/`sf`/`lv` ↔ engine `City` `'LA'/'SF'/'VEGAS'` ↔ textures `plateback1/2/3` — keep the mapping in ONE place (`vehicle-plates.ts`).

## Tasks

- [ ] `VehiclePlatesConfig` + default in config interface; `plates` field on `VehicleConfig`.
- [ ] `vehicle-plates.ts`: placement hash, `resolvePlate` (city AABB → mask; COUNTRYSIDE/DESERT → seeded pick of LA/SF/VEGAS). Unit tests: each city box → its mask+background; countryside placement → stable pick across calls; explicit `placement.plate` override wins.
- [ ] `spawnVehicle` wiring in canvas-host (parked, generators, debug menu all flow through it — verify no second spawn path).
- [ ] `Game` setter + `configChanged` broadcast; docs in the config reference (wherever `VehicleConfig` fields are documented).
- [ ] Optional `plate` on `VehiclePlacement`; debug menu: spawn action exposes a plate text input (small, optional).
- [ ] LOD respawn test: placement respawned via `VehicleLodSystem` produces an identical plate (hash determinism end-to-end).
- [ ] Lint/tsc; run only touched test files.

## Verification

- Unit: `vehicle-plates.test.ts`, config default tests.
- In-game: drive LS→SF→LV checking parked plates match district; countryside cars show a stable mixed distribution; set custom masks via console `game.setConfig(...)` and spawn — new mask applied.

## Measurements

_(record after implementation)_

- plate cache size after a full-map drive: …
- spawn-time overhead per vehicle: …
