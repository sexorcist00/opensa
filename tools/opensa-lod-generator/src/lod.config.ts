import type { LodConfig } from './core/types';

/**
 * Default run config. `cellSize` is the GAME-side grid (`GAME_CELL_SIZE`, 256) — collision streaming and
 * procobj scatter run on it, and plan 002 sized the bake to the STREAMING grid of the three era, which was
 * this same 256. The engine pak now streams on 250 (opensa-pack `CELL_SIZE`), so the two grids partition
 * the plane differently; plan 087 measured the consequence (a slot's lod footprint ≠ its hd footprint —
 * swap gaps at the HD ring, gostown lod spill mean 141 u / p90 215 u). Re-aligning the bake to 250 was
 * tried and ROLLED BACK the same day (user 2026-07-23): 256 stays deliberate until the bridge-model row
 * of plan 087 is closed and the mismatch question is decided on field evidence.
 */
export const config: LodConfig = {
  cellSize: 256,
  decimateBudget: 0.01,
  // Engine streaming HD ring (apps/web canvas-host Config.streaming.hdDrawDistance) — the closest a LOD is seen.
  hdDrawDistance: 300,
  hiddenFaces: 'cull',
  lodDrawDistance: 1500,
  lodTextureSize: 64,
  mergeCoplanar: true,
  minLodPixels: 2,
  // 0.05, not 0.15: the Phase-4 harness measured 0.15 deleting whole visible objects (8.6% pixel diff — e.g. a
  // lone fence instance vanishing entirely); at 0.05 the cull is visually free (0.07%) and still kills wire mesh.
  minOpaqueCoverage: 0.05,
};
