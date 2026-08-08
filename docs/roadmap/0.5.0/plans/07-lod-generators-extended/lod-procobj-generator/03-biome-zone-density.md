# 03 — Biome/zone-aware density (desert, forest, mountain)

Part of [07 — LOD generators, extended](../readme.md). Depends on [02](02-density-model.md) (the density model). Delivers the user's actual ask: density that KNOWS the terrain — more cacti in the desert, more bushes in forest, more rocks on mountain slopes.

**02 is per target now (2026-08-08), so this plan is too**: biome is a third axis on top of category×surface, and a biome profile inherits its target's wall. On `sa-stock` that wall is 1.18×, so "more cacti in the desert" there can only mean cacti INSTEAD of something else — a biome profile that reads as growth belongs to `sa-reference` or `opensa`. Same rule as 02's decision 3: a profile declares its target and the build refuses a mismatch.

## Context

02 gives per-category/per-surface density but no notion of WHERE. Two terrain signals exist at build time but aren't joined to scatter:

- **Surface type** (`surfinfo.dat` → `surfaceNames[face.material]`, e.g. `p_grass_dry`, `p_sand`, rocky surfaces) — already what scatter keys rules on. A partial biome proxy (desert sand vs grass), but a grass surface exists in both LA parks and countryside.
- **Zones** (`info.zon`/`map.zon` → `parseZones` → `MapZone{ name, label, x/y extent, level }`, incl. Bone County = desert) — the real biome map, but **not cross-referenced** by the scatter (no point-in-zone test today).
- **Slope**: no heightmap, but per-face normal `.z` is computed in scatter (`procobj-scatter.ts`) — an ad-hoc slope proxy usable for "rocks on steep faces".

## Decisions

1. **Join zones into scatter.** Add a point-in-zone lookup at build time so each placement knows its zone/biome — from **`parseZones` in `@opensa/renderware`** (`parsers/text/zon.parser`, already a dependency), with the AABB test owned by the tool. Copy the engine's `cityAt` SHAPE if it helps, but do not import `packages/game`: this is build-time code and the engine layer is not its dependency ([restrictions/architecture](../../../../../restrictions/architecture.md)). Classify zones into biomes: **desert** (Bone County), **forest/countryside** (Red County, Flint County vegetation), **city** (LA/SF/LV), **mountain** (Chiliad / high-slope areas). Biome becomes a third density axis on top of 02's category×surface.
2. **Biome × category density profiles.** A small config: e.g. desert → cacti ×3, bushes(dry shrubs) ×2, grass ×0.5; forest → bushes ×2.5, trees(procobj) ×1.5, flowers ×2; mountain → rocks ×3 (slope-gated), everything else ×0.5. Defaults are conservative and tuned in-game; the table is the deliverable.
3. **Slope-gated rocks.** Use the face normal `.z` as a slope proxy: rock categories get a density boost on steep faces (low `normal.z`) and thinning on flat ground — so mountains get scree, plains don't. Cheap, no heightmap needed.
4. **Surface stays the fine filter.** Biome sets the broad multiplier; surface still gates WHICH rules apply (cacti rules are already on sand surfaces). Biome density never places a species on a surface its `procobj.dat` rule forbids — it only scales within allowed surfaces. This keeps authored SA plausibility (no cacti on grass).
5. **Determinism + no runtime cost.** All build-time; the zone lookup is a static AABB test per candidate (cheap). Runtime scatter/preview unchanged.

## Tasks

- [ ] Build-time zone lookup: load `info.zon`, build the AABB set, `biomeAt(x, y)` classifier (zone → biome map, documented); reuse the engine's zone-box logic where possible.
- [ ] Extend 02's `densityFor` to `densityFor(category, surface, biome)`; biome×category profile config with conservative defaults.
- [ ] Slope proxy: expose face `normal.z` to the density decision; slope-gated boost for rock categories (config: slope threshold + boost/thin factors).
- [ ] Unit tests: a placement in the desert AABB gets the desert profile (cacti up, grass down); a steep face boosts rocks; a flat forest face boosts bushes; surface rules still gate species (no cacti on grass).
- [ ] In-game/viewer validation: fly Bone County (denser cacti/shrubs), Red County (denser bushes), Mount Chiliad slopes (rocks) — screenshots; tune the profiles; record final table.
- [ ] Interplay with 02 logging: per-biome placed/dropped counts.

## Verification

- Desert visibly denser in cacti/shrubs, countryside in bushes, mountain slopes in rocks — while cities/plains stay close to vanilla.
- No species appears on a surface its rule forbids (biome scales, never overrides surface gating).
- Deterministic; zone lookup adds negligible build time.

## Measurements / notes

_(record after implementation)_

- zone→biome map + biome×category profile table: …
- slope threshold + rock boost factors: …
- per-biome placement counts: …
