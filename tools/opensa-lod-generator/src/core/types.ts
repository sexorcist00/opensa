/**
 * Game-agnostic types for the LOD generator. The world is bucketed into square **cells** (matching the engine's
 * streaming grid); each cell's HD instances are baked into one merged LOD mesh + atlas (plan 002). Kept
 * game-neutral so a future game plugs in via a {@link LodAdapter} without touching the core. The merged-mesh types
 * live in the shared `@opensa/sa-lod` pipeline.
 */

import type { MergedMesh } from '@opensa/lod-common/mesh';

/**
 * The baked output for one cell — a merged, decimated LOD mesh + its texture atlas + placement. The concrete
 * shape (geometry buffers, atlas raster, IPL entry) is defined as plan 002 lands its phases; for now the core
 * only needs the cell coordinate to drive `finalize`.
 */
export interface BakedCell {
  cx: number;
  cy: number;
  /** Ready 2dfx section payload (light entries in cell space) — the cell's distant coronas, or absent. */
  effects?: Uint8Array;
  /** The cell's merged geometry (Phase 1). Decimation + atlas refine this in place as later phases land. */
  mesh: MergedMesh;
}

/** A square grid cell and the HD instances whose origin falls in it. */
export interface Cell {
  cx: number;
  cy: number;
  instances: CellInstance[];
}

/** One HD instance placed in the world (model + world transform), assigned to a cell. */
export interface CellInstance {
  model: string;
  position: Vec3;
  rotation: Quat;
}

/** Run configuration (the "what/where" knobs). */
export interface LodConfig {
  /**
   * Square cell size in world units. **Must equal the engine's streaming `cellSize`** so one baked LOD maps to
   * exactly one engine cell (see plan 002 "Engine fit").
   */
  cellSize: number;
  /**
   * Budget-checked QEM decimation (plan 003 tail): per cell, the most aggressive triangle target whose own
   * render stays within this mean pixel-diff budget wins (0.01 = 1 %); cells that can't decimate cleanly keep
   * their triangles. 0 disables the pass.
   */
  decimateBudget: number;
  /**
   * Model names (lowercased, HD **and** LOD) owned by sibling generators — lod-trees/lod-procobj in the
   * perfect-map pipeline. These are neither baked into cells nor stripped, so opensa-lod never re-processes another
   * tool's finished LODs/impostors. See the pipeline's `collectGeneratedModels`.
   */
  excludeItems?: readonly string[];
  /**
   * The engine's `Config.streaming.hdDrawDistance` — the closest distance a cell renders as LOD (past it the
   * cell flips HD→LOD). The screen-size cull judges "worth keeping in a LOD" at this pessimistic distance.
   */
  hdDrawDistance: number;
  /**
   * Visibility pass (plan 003, Track 2): raycast every face against deterministic cameras at `hdDrawDistance`.
   * `'cull'` drops faces no camera sees + orients/masks the rest; `'orient'` never drops (holes impossible —
   * unseen faces stay two-sided) but still wins the single-siding; `'off'` skips the pass (blanket two-sided).
   */
  hiddenFaces: 'cull' | 'off' | 'orient';
  /** Draw distance (world units) for emitted cell-LOD IDE defs — the original game's visibility gate. */
  lodDrawDistance: number;
  /** Max texture dimension (px) in a per-cell LOD TXD; sources are downscaled to it (plan 002, Phase 2). */
  lodTextureSize: number;
  /**
   * Coplanar remesh (plan 003, Track 3): re-triangulate flat same-texture clusters from their (byte-exact)
   * boundary, deleting the dense interior — roads/roofs/terrain tiling shrink with zero visual change (clusters
   * whose UV/prelit aren't affine over the plane are left untouched).
   */
  mergeCoplanar: boolean;
  /**
   * Screen-size cull (plan 003, Track 1): an instance whose bounding diameter covers fewer pixels than this at
   * `hdDrawDistance` is dropped from the cell whole — a sub-pixel object can't hole the far view.
   */
  minLodPixels: number;
  /**
   * Transparent-group cull (plan 003, Track 1): a texture group whose opaque coverage (alpha ≥ 128 texels) is
   * below this fraction is dropped from the cell mesh — chain-link/grates/wires are sub-pixel noise at LOD range.
   */
  minOpaqueCoverage: number;
  /** Output directory for the baked drop-in (the CLI passes `--out <path>`). */
  out?: string;
  /** Bake worker threads (the two hot stages — visibility-cull + decimate — are 96 % of the run and perfectly
   *  per-cell parallel). Default: **half** the cores (keeps the machine usable); `1` forces the in-process
   *  sequential path. */
  workers?: number;
}

export type Quat = readonly [number, number, number, number];

export type Vec3 = readonly [number, number, number];
