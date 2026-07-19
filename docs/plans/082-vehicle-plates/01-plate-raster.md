# 082/01 — Plate raster generation (pure) + sources from the VFS

The pure half, carried over from the idea nearly intact — only the output type changed (raw RGBA
bytes for a texture-array slot upload, not a three `DataTexture`).

## Design

New module `packages/game/src/vehicle/plate-raster.ts` (game layer — it consumes parsed TXD rasters
via the adapter, no engine import):

```ts
export type PlateCity = 'LA' | 'SF' | 'VEGAS';

/** Deterministically expand a mask (`L`/`D`/`*` + literals) into plate text. */
export function generatePlateText(mask: string, seed: number): string;

/** plateback + charset glyphs → one RGBA8 raster sized for the plate atlas slot. */
export function composePlate(text: string, city: PlateCity, sources: PlateSources): Uint8Array;

/** One-time extraction: parse `models/generic/vehicle.txd` from the VFS, decode the 4 rasters. */
export function extractPlateSources(txd: ParsedTxd): PlateSources | null;
```

- **Mask DSL** (from the idea, unchanged): `L` → A–Z, `D` → 0–9, `*` → either, anything else
  passes through. Empty mask → default `LLLD DDL` (eyeball in-game, record the final default here).
- **Seeded PRNG** (mulberry32-style), seed injected — determinism is the caller's contract.
- **Sources**: `platecharset` glyph atlas + `plateback1..3`, decoded to RGBA once at boot via the
  existing TXD parse path (DXT decode already exists — the alpha-pipeline groundwork). The charset
  GRID (cell size, row order, digit cells) is derived empirically in the object viewer and pinned
  as constants here (the `build-roadsign.ts` `ATLAS_ORDER` precedent — that module survived the
  teardown and is the in-repo pattern for glyph atlases).
- **Output**: RGBA8 at the FIXED plate-slot size (plan 03 defines it, first guess 128×64 — plate
  faces are small on screen; record). Compose = background copy + alpha-blit glyphs; resample the
  background if the source TXD is modded to another size (asset-driven-sizes rule: never throw).
- **No cache here** — plan 03's atlas slot allocator IS the cache (`(text, city)` → slot).

## Subtasks

- [ ] Viewer session: derive `platecharset` grid constants + record them here (with a screenshot
      in the PR).
- [ ] `generatePlateText` + tests (determinism, each token class, empty→default).
- [ ] `extractPlateSources` + graceful `null` when textures are missing (modded TXD) — plates
      then stay stock, never crash. Test with the real fixture TXD (`tests/original` ships
      `models/generic/vehicle.txd`; if not, add via the fixtures manifest — one line).
- [ ] `composePlate` + tests on synthetic 4×4 rasters (city→background, glyph placement, alpha,
      resample path).
- [ ] Measure: compose time per plate, bytes per slot (ledger).

## Acceptance

Pure suite green; compose ≤ 0.5 ms per plate (it runs at spawn, off the hot loop); fixture TXD
decodes and the derived grid renders every A–Z/0–9 glyph correctly on a test raster.

## Ledger

_(charset grid constants, slot size decision, compose timings)_
