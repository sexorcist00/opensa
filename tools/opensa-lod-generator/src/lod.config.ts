import type { LodConfig } from './core/types';

/**
 * Default run config. `cellSize` is the GAME-side grid (`GAME_CELL_SIZE`, 256) — the one the world adapter
 * streams collision and scatters procobj on, so one baked impostor stands for one game cell of instances.
 *
 * It is NOT the engine's RENDER grid: opensa-pack welds its `.oscell` blobs on `CELL_SIZE` (250) and ships
 * that in the manifest. This comment used to claim the two must match; they never have, and nothing breaks
 * because an impostor is a placement like any other and welds into whichever render cell it falls in.
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
