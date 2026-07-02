import type { LodConfig } from './core/types';

/**
 * Default run config. `cellSize` **must match the engine's streaming grid** (`world-grid.ts` / the world
 * adapter's `cellSize`) so each baked LOD maps to exactly one engine cell — see plan 002 "Engine fit". Tune the
 * cell size + (later) decimation/atlas budgets from the Phase-0 report.
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
