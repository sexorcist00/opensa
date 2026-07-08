# 001 — Plate texture generation (charset atlas → baked plate raster)

Part of the [vehicle license plates chain](../../readme.md). No dependencies — pure texture work, fully unit-testable without the game.

## Context

`models/generic/vehicle.txd` ships four stock textures the engine currently ignores:

- `platecharset` — the glyph atlas (letters + digits) SA blits plate text from
- `plateback1` — Los Santos plate background
- `plateback2` — San Fierro plate background
- `plateback3` — Las Venturas plate background

Real SA (`CCustomCarPlateMgr`) generates one small raster per vehicle: the city's `plateback*` as the base, glyphs from `platecharset` blitted on top, and swaps that raster onto the vehicle's `carplate` material. We reproduce exactly that. This plan builds the **pure generation module**; wiring into vehicles/config comes in plans 002/003.

The merged texture map passed to `buildVehicle` already contains the generic dictionary (`gta-sa-world.adapter.ts` `loadGenericVehicleTextures()` merges `models/generic/vehicle.txd` under the car's own TXD), so `platecharset`/`plateback1..3` are already reachable by name at build time — no new loading.

## Decisions

1. **Bake, don't overlay.** One generated raster per unique `(text, city)` pair, swapped onto the existing `carplate` material map. The model's `carplate` UVs already map the plate face 0..1, so a baked texture needs zero geometry work — and it automatically lives inside the damageable part's mesh (the key to plan 004's damage requirement). The alternative (quad-per-glyph overlay like `build-roadsign.ts`) needs new meshes attached per plate and re-solves damage/detach for nothing.
2. **Compose on CPU into a `DataTexture`** (precedent: `buildDataTexture` in `packages/renderware/src/three/build-texture.ts`). Source pixels come from the already-decoded TXD rasters; compositing is a straight per-pixel copy with alpha — no DOM canvas dependency, works in workers/tests.
3. **Mask DSL** for plate text generation (used by the config in plan 003):
   - `L` → random letter `A–Z`
   - `D` → random digit `0–9`
   - `*` → random letter or digit
   - any other character (space, dash, literals) → passes through verbatim
   - Default mask when the config value is empty: `LLLD DDL` — visually close to SA's stock random plates; final default to be eyeballed in-game and recorded here.
4. **Deterministic randomness.** `generatePlateText(mask, seed)` takes an explicit numeric seed (mulberry32-style PRNG); no `Math.random()`. The seed comes from the spawn placement (plan 003), so the same parked car always wears the same plate across LOD unload/respawn and page reloads.
5. **Cache by `(text, background)`.** Traffic will re-use plate rasters rarely, but parked-car respawn re-requests the same pair constantly; an LRU-less plain `Map` is enough (rasters are ~8 KB; a full city of unique plates is a few MB worst case — measure and record below).

## Design

New module `packages/renderware/src/three/build-plate.ts`:

```ts
export type PlateCity = 'LA' | 'SF' | 'VEGAS';

/** Deterministically expand a mask (`L`/`D`/`*` + literals) into plate text. */
export function generatePlateText(mask: string, seed: number): string;

/** Compose plateback + charset glyphs into a plate raster; cached by (text, city). */
export function buildPlateTexture(
  text: string,
  city: PlateCity,
  sources: PlateSources, // the three plateback rasters + platecharset raster, pre-decoded RGBA
): DataTexture;

/** One-time extraction of the raw RGBA sources from the merged vehicle texture map. */
export function extractPlateSources(textures: ReadonlyMap<string, Texture>): PlateSources | null;
```

Glyph atlas geometry: the exact `platecharset` grid (glyph cell size, row order, which cells hold digits) must be derived empirically from the real texture in the asset viewer — mirror how `build-roadsign.ts` declares `ATLAS_ORDER`/`ATLAS_COLS`/`ATLAS_ROWS`. Record the derived constants in this doc when known.

City → background binding (fixed, per the stock data):

| texture      | city                   |
| ------------ | ---------------------- |
| `plateback1` | Los Santos (`LA`)      |
| `plateback2` | San Fierro (`SF`)      |
| `plateback3` | Las Venturas (`VEGAS`) |

## Tasks

- [ ] Inspect `platecharset` / `plateback1..3` in the asset viewer: dimensions, glyph grid, glyph order, blank cells. Record the constants here (Measurements).
- [ ] `generatePlateText(mask, seed)`: seeded PRNG, mask DSL (`L`/`D`/`*`/literal). Unit tests: determinism (same seed → same text), each mask token class, empty mask → default mask.
- [ ] `extractPlateSources(textures)`: pull the four rasters out of the merged map, decode to RGBA once (reuse the TXD→RGBA path that `buildDataTexture` consumes). Returns `null` when any texture is missing (modded TXDs) — plates then stay stock (no swap), never crash.
- [ ] `buildPlateTexture(text, city, sources)`: per-pixel compose (background copy + glyph blit with alpha), `DataTexture` with the same colour-space/filter setup other vehicle textures get; `(text, city)` cache.
- [ ] Unit tests on synthetic 4×4 rasters: background chosen per city, glyph pixels land at expected cells, cache returns the identical texture instance.
- [ ] Barrel exports + lint/tsc.

## Verification

- `node node_modules/vitest/vitest.mjs run packages/renderware/src/three/build-plate.test.ts`
- Visual: standalone harness page or viewer hook rendering a generated plate quad for each city (screenshot in PR).

## Measurements

_(record after implementation — standing rule)_

- `platecharset` grid: …
- plate raster size / bytes per plate: …
- generation time per plate: …
