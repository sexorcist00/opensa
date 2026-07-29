/**
 * Cells into the engine, welded IN THE BROWSER (plan 094, decision 1). The same `weldCell` the converter runs
 * offline produces the `.oscell` bytes, the same `TexturePlanner` produces the `.ostex` arrays, and both go
 * straight into `engine.cells.load` / `engine.textures.load` — no pak, no `.oswire`, no bakes. What the viewer
 * draws is therefore what the game would draw for these files.
 *
 * **The whole set is re-welded on every change**, and deliberately so: the texture plan GROWS as cells weld,
 * and a texture array that is already on the GPU cannot gain layers under the render bundles that were
 * recorded against it. Rebuilding is the one honest way to keep the plan and the bundles in step; making it
 * incremental is a phase-2 problem to solve with numbers in hand, not an assumption to bake in now.
 */
import type { Engine } from '@opensa/engine';

import { CELL_SIZE, TexturePlanner, weldCell } from '@opensa/cell-weld';
import { cellKey, cellModelNames } from '@opensa/renderware';

import type { LoadedMap } from '../source/map-source';

export interface CellCoord {
  cx: number;
  cy: number;
}

/** What one `setCells` cost and produced — the phase-1 measurement. */
export interface CellLoadStats {
  /** Arrays uploaded. */
  arrays: number;
  /** Source bytes read for the models/textures this call needed (0 once they are resident). */
  assetBytes: number;
  cells: number;
  /** Wall time of the per-cell model/texture reads. */
  fetchMs: number;
  indices: number;
  /** Wall time of `TexturePlanner.build()` + the uploads. */
  textureMs: number;
  /** Total `.ostex` bytes uploaded. */
  textures: number;
  vertices: number;
  /** Wall time of the welds alone. */
  weldMs: number;
}

const EMPTY: CellLoadStats = {
  arrays: 0,
  assetBytes: 0,
  cells: 0,
  fetchMs: 0,
  indices: 0,
  textureMs: 0,
  textures: 0,
  vertices: 0,
  weldMs: 0,
};

export class CellRenderer {
  private readonly loadedArrays = new Set<number>();
  private readonly loadedCells = new Set<string>();

  constructor(
    private readonly engine: Engine,
    private readonly map: LoadedMap,
  ) {}

  /** Drop everything currently resident (cells first — their bundles reference the arrays). */
  clear(): void {
    for (const key of this.loadedCells) {
      this.engine.cells.unload(key);
    }
    this.loadedCells.clear();
    for (const ref of this.loadedArrays) {
      this.engine.textures.unload(ref);
    }
    this.loadedArrays.clear();
  }

  /** Make exactly `coords` resident at one level. Returns what it cost. */
  async setCells(coords: readonly CellCoord[], lod: boolean): Promise<CellLoadStats> {
    this.clear();
    const planner = new TexturePlanner(this.map.fs, this.map.defs.txdParents ?? new Map<string, string>());
    const stats = { ...EMPTY };

    // The welder reads synchronously — every model a cell places has to be in the VFS before it runs.
    const fetchStarted = performance.now();
    for (const { cx, cy } of coords) {
      stats.assetBytes += await this.map.assets.ensure(cellModelNames(this.map.defs, this.map.grid, cx, cy, lod));
    }
    stats.fetchMs = Math.round(performance.now() - fetchStarted);

    const weldStarted = performance.now();
    const welded: { bytes: Uint8Array; key: string }[] = [];
    for (const { cx, cy } of coords) {
      const cell = this.map.grid.get(cellKey(cx, cy));
      if (!cell) {
        continue;
      }
      // Cell origin in ENGINE coords: GTA cell centre (x, y) → engine (x, 0, −y) — the converter's own line.
      const origin: [number, number, number] = [(cx + 0.5) * CELL_SIZE, 0, -(cy + 0.5) * CELL_SIZE];
      const result = weldCell(this.map.fs, this.map.defs, cell, lod, planner, origin);
      if (!result) {
        continue;
      }
      welded.push({ bytes: result.bytes, key: `${cx},${cy},${lod ? 'lod' : 'hd'}` });
      stats.indices += result.stats.indices;
      stats.vertices += result.stats.vertices;
    }
    stats.weldMs = Math.round(performance.now() - weldStarted);

    // Arrays BEFORE cells: a cell's render bundle bakes in the bind groups of the arrays its draws sample.
    const textureStarted = performance.now();
    for (const array of planner.build()) {
      this.engine.textures.load(array.ref, array.bytes);
      this.loadedArrays.add(array.ref);
      stats.arrays += 1;
      stats.textures += array.bytes.byteLength;
    }
    stats.textureMs = Math.round(performance.now() - textureStarted);

    for (const { bytes, key } of welded) {
      this.engine.cells.load(key, bytes);
      this.loadedCells.add(key);
      stats.cells += 1;
    }

    return stats;
  }
}

/** The cell a GTA ground position falls in — the render grid, not the game's streaming one. */
export function cellAt(gta: readonly [number, number]): CellCoord {
  return { cx: Math.floor(gta[0] / CELL_SIZE), cy: Math.floor(gta[1] / CELL_SIZE) };
}

/** The centre of the map's occupied cells, in GTA coords — where the viewer opens without an `?at`. */
export function mapCenterGta(map: LoadedMap): [number, number] {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const cell of map.grid.values()) {
    x0 = Math.min(x0, cell.cx);
    x1 = Math.max(x1, cell.cx);
    y0 = Math.min(y0, cell.cy);
    y1 = Math.max(y1, cell.cy);
  }
  if (!Number.isFinite(x0)) {
    return [0, 0];
  }

  return [((x0 + x1) / 2 + 0.5) * CELL_SIZE, ((y0 + y1) / 2 + 0.5) * CELL_SIZE];
}
