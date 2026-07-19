# 082 — Vehicle license plates (per-vehicle, city-correct, damage-riding)

**Status: PLANNED 2026-07-19.** Supersedes the idea chain `docs/ideas/0.4.0/plans/01-plates/`
(2026-07-12) — rethought for the own WebGPU engine; the idea was written against the deleted
three-WebGL path (`MeshStandardMaterial.map` swap in `buildVehicle`, `DataTexture`) and its central
mechanism no longer exists.

**Goal:** every spawned vehicle wears a generated license plate — text from a mask DSL in config,
background by the city it SPAWNED in (`plateback1/2/3` = LS/SF/LV), deterministic per placement
(same parked car → same plate across LOD respawns and reloads), and the plate rides damage: deform
swap, door swing, part detach. Vanilla SA does exactly this (`CCustomCarPlateMgr`); stock assets
ship the glyph atlas (`platecharset`) and the three backgrounds in `models/generic/vehicle.txd`.

## What survives from the idea, and what had to be rethought

**Survives (pure/game-layer):** the mask DSL (`L`/`D`/`*`/literals, default `LLLD DDL`), seeded
deterministic text (placement-hash seed), city-at-spawn-position via `cityAt` (`zones/city.ts`),
out-of-city deterministic pick, config shape `vehicle.plates = { ls, sf, lv }`, the CPU compose
(background + glyph blit — pure RGBA work), and the core insight that **plate faces live INSIDE
part meshes**, so damage/detach/door support falls out of part architecture rather than new
attachment code.

**Rethought (the engine is different):**

1. **There are no per-vehicle materials to retexture.** A vehicle is a converted `.osm`
   (opensa-pack 003): `createVehicleModel(VehicleModelInit)` uploads texture ARRAYS shared by
   every instance of that model; submeshes reference `array` + per-vertex layer (`meta.x`)
   (`packages/engine/src/engine.ts:315-360`). Swapping a layer in the model's array would change
   ALL instances of that model at once. **Per-instance plates therefore need a different carrier.**
2. **The carrier: one shared PLATE ATLAS texture array + a per-instance slot index.** The engine
   already has per-instance rows next to the matrix buffer — paint (64 B/row) and lamps (16 B/row,
   with two spare components, `engine.ts` `LAMP_ROW_BYTES` comment). A plate slot index rides the
   same mechanism; plate-tagged geometry samples the plate atlas at that slot instead of the model
   array. Runtime-generated plates upload into free atlas slots (fixed capacity + LRU, the
   texture-LRU precedent from plan 21).
3. **Plate faces must be identifiable AFTER conversion.** The DFF marks them with material texture
   names `carplate`/`carpback`; opensa-pack's vehicle builder must split them into their OWN
   submeshes and tag them (the `MaterialClass`-in-`meta.w`-nibble precedent from 074/16) — at
   runtime names are gone.
4. **Plate sources come from the game VFS at boot** (parse `generic/vehicle.txd` once — RW parsers
   are permanent runtime code per opensa-pack 003), BUT the pack's `.txd` deletion rule may have
   deleted it. **Phase-0 check with a keep-rule fix if needed** (plan 02).
5. **Spawn choke points multiplied**: parked/`carGeneratorPlacements`, popcycle road cars, the 841
   bench road cars, the F2 debug spawner — all flow through the host's `spawnVehicle`
   (`engine-vehicles.ts:211-293`), which stays the single wiring point.

## Sub-plans

| #   | Plan                                                   | One-liner                                                                                                |
| --- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 01  | [Plate raster generation](01-plate-raster.md)          | Pure module: mask DSL + seeded text + charset→RGBA compose; sources from the VFS TXD.                    |
| 02  | [Converter: plate submeshes](02-converter-tagging.md)  | opensa-pack tags `carplate`/`carpback` into own flagged submeshes; keep-rule for the source TXD; census. |
| 03  | [Engine: plate atlas + slot](03-engine-plate-atlas.md) | Shared plate atlas array, per-instance slot row, WGSL sample override, slot LRU.                         |
| 04  | [Config, seeding, damage](04-config-seeding-damage.md) | `vehicle.plates` config + city/seed resolution at spawn + damage/detach verification.                    |

Order + rationale: [priority.md](priority.md).

## Ground rules

1. Pure modules first (raster gen, plate resolution) — unit-tested headless; engine/converter
   changes are thin and each carries a fake-device or fixture test (the 077 seam).
2. **A reconvert is required after plan 02** (submesh split changes `.osm` GEOM) — batch it with
   other pending converter work if possible; old paks/osm without the flag render exactly as today
   (plates simply stay stock — graceful degradation is a format rule).
3. Determinism: no `Math.random()`; seeds derive from placement (model + position hash).
4. Measurements ledger per plan (standing rule): atlas memory, slots used on a full-map drive,
   spawn-time overhead, census numbers.
5. Field verification uses the engine-lab vehicle look bench (`?vmodel`) for close-ups and a city
   drive for distribution; feel/look verdicts freeze defaults.
