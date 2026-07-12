/**
 * District conversion orchestrator (plan 074/03): resolve the map → world grid → for every cell in the rect,
 * weld HD + LOD levels → build texture arrays → deterministic pak + manifest + the measurement report the
 * plan docs consume.
 */
import type { AssetFileSystem } from '@opensa/renderware';

import { buildOspak, type OspakInput, type OspakManifest } from '@opensa/engine-formats';
import { OPEN_SCRIPT_IPL, resolveMap } from '@opensa/renderware/map/resolve-map';
import { buildWorldGrid, cellKey } from '@opensa/renderware/map/world-grid';

import { TexturePlanner } from './textures';
import { weldCell, type WeldStats } from './weld';

export interface ConvertOptions {
  cellSize?: number;
  /** Inclusive GTA cell-coordinate rect [x0, y0, x1, y1]. */
  rect: readonly [number, number, number, number];
}

export interface ConvertReport {
  cells: { groups: number; indices: number; kbytes: number; key: string; vertices: number }[];
  pakBytes: number;
  skippedAnimated: number;
  skippedTimed: number;
  textures: TexturePlanner['report'] & { arrays: number };
}

export function convertDistrict(
  fs: AssetFileSystem,
  options: ConvertOptions,
): { manifest: OspakManifest; pak: Uint8Array; report: ConvertReport } {
  const cellSize = options.cellSize ?? 250;
  const defs = resolveMap(fs, { extraIpl: OPEN_SCRIPT_IPL });
  const grid = buildWorldGrid(defs, cellSize);
  const planner = new TexturePlanner(fs, defs.txdParents ?? new Map<string, string>());

  const [x0, y0, x1, y1] = options.rect;
  const inputs: OspakInput[] = [];
  const report: ConvertReport = {
    cells: [],
    pakBytes: 0,
    skippedAnimated: 0,
    skippedTimed: 0,
    textures: { arrays: 0, colors: 0, dedup: 0, opaquePass: 0, processed: 0 },
  };

  for (let cx = Math.min(x0, x1); cx <= Math.max(x0, x1); cx += 1) {
    for (let cy = Math.min(y0, y1); cy <= Math.max(y0, y1); cy += 1) {
      const cell = grid.get(cellKey(cx, cy));
      if (!cell) {
        continue;
      }
      // Cell origin in ENGINE coords: GTA cell centre (x, y) → engine (x, 0, −y).
      const origin: [number, number, number] = [(cx + 0.5) * cellSize, 0, -(cy + 0.5) * cellSize];
      for (const lod of [false, true]) {
        const welded = weldCell(fs, defs, cell, lod, planner, origin);
        if (!welded) {
          continue;
        }
        const key = `${cx},${cy},${lod ? 'lod' : 'hd'}`;
        inputs.push({ bytes: welded.bytes, key, kind: 'cell' });
        accumulate(report, key, welded.bytes.byteLength, welded.stats);
      }
    }
  }

  for (const array of planner.build()) {
    inputs.push({ bytes: array.bytes, key: `array-${array.ref}`, kind: 'texture', meta: array.meta });
    report.textures.arrays += 1;
  }
  Object.assign(report.textures, planner.report, { arrays: report.textures.arrays });

  const { manifest, pak } = buildOspak(inputs, { cellSize });
  report.pakBytes = pak.byteLength;

  return { manifest, pak, report };
}

function accumulate(report: ConvertReport, key: string, bytes: number, stats: WeldStats): void {
  report.cells.push({
    groups: stats.groups,
    indices: stats.indices,
    kbytes: Math.round(bytes / 1024),
    key,
    vertices: stats.vertices,
  });
  report.skippedAnimated += stats.skippedAnimated;
  report.skippedTimed += stats.skippedTimed;
}
