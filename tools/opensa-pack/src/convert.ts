/**
 * District conversion orchestrator (plan 074/03): resolve the map → world grid → for every cell in the rect,
 * weld HD + LOD levels → build texture arrays → deterministic pak + manifest + the measurement report the
 * plan docs consume.
 */
import type { AssetFileSystem } from '@opensa/renderware';

import { buildOspak, type OspakInput, type OspakManifest } from '@opensa/engine-formats';
import { OPEN_SCRIPT_IPL, resolveMap } from '@opensa/renderware/map/resolve-map';
import { buildWorldGrid, cellKey } from '@opensa/renderware/map/world-grid';

import { bakeAo, type BakeAoReport, buildOccluderBvh } from './ao';
import { bakeSunVis, type BakeSunVisReport } from './sunvis';
import { TexturePlanner } from './textures';
import { assembleCell, weldCellParts, type WeldedCell, type WeldStats } from './weld';

export interface ConvertOptions {
  /** Bake per-vertex AO/skyVis (074/07); on by default, `--no-ao` skips it. */
  ao?: boolean;
  cellSize?: number;
  /** Inclusive GTA cell-coordinate rect [x0, y0, x1, y1]. */
  rect: readonly [number, number, number, number];
  /** Bake per-vertex sun visibility (074/07); on by default, `--no-sunvis` skips it. */
  sunVis?: boolean;
}

export interface ConvertReport {
  ao: (BakeAoReport & { ms: number }) | null;
  cells: { groups: number; indices: number; kbytes: number; key: string; vertices: number }[];
  pakBytes: number;
  skippedAnimated: number;
  skippedTimed: number;
  sunVis: (BakeSunVisReport & { ms: number }) | null;
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

  const inputs: OspakInput[] = [];
  const report: ConvertReport = {
    ao: null,
    cells: [],
    pakBytes: 0,
    skippedAnimated: 0,
    skippedTimed: 0,
    sunVis: null,
    textures: { arrays: 0, colors: 0, dedup: 0, opaquePass: 0, processed: 0 },
  };

  // Phase 1 — weld every cell into scratch buckets (kept in memory: the bake needs the whole district).
  const welded = weldRect(fs, defs, grid, planner, options.rect, cellSize);

  // Phase 2 — bake AO/skyVis + sun visibility against ONE district BVH (074/07), then encode.
  if (options.ao !== false || options.sunVis !== false) {
    const cellsOnly = welded.map((entry) => entry.cell);
    const bvh = buildOccluderBvh(cellsOnly);
    if (options.ao !== false) {
      const aoStarted = Date.now();
      const bake = bakeAo(cellsOnly, { bvh });
      report.ao = { ...bake, ms: Date.now() - aoStarted };
    }
    if (options.sunVis !== false) {
      const sunStarted = Date.now();
      const bake = bakeSunVis(cellsOnly, bvh);
      report.sunVis = { ...bake, ms: Date.now() - sunStarted };
    }
  }
  for (const entry of welded) {
    const bytes = assembleCell(entry.cell);
    inputs.push({ bytes, key: entry.key, kind: 'cell' });
    accumulate(report, entry.key, bytes.byteLength, entry.cell.stats);
  }

  for (const array of planner.build()) {
    inputs.push({ bytes: array.bytes, key: `array-${array.ref}`, kind: 'texture', meta: array.meta });
    report.textures.arrays += 1;
  }
  Object.assign(report.textures, planner.report, { arrays: report.textures.arrays });

  const timecyc24 = fs.getText('data/timecyc_24h.dat');
  const timecyc = timecyc24 ?? fs.getText('data/timecyc.dat') ?? undefined;
  const { manifest, pak } = buildOspak(inputs, {
    cellSize,
    ...(timecyc !== undefined ? { timecyc, timecyc24: timecyc24 !== null } : {}),
  });
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

function weldRect(
  fs: AssetFileSystem,
  defs: ReturnType<typeof resolveMap>,
  grid: ReturnType<typeof buildWorldGrid>,
  planner: TexturePlanner,
  rect: readonly [number, number, number, number],
  cellSize: number,
): { cell: WeldedCell; key: string }[] {
  const [x0, y0, x1, y1] = rect;
  const welded: { cell: WeldedCell; key: string }[] = [];
  for (let cx = Math.min(x0, x1); cx <= Math.max(x0, x1); cx += 1) {
    for (let cy = Math.min(y0, y1); cy <= Math.max(y0, y1); cy += 1) {
      const cell = grid.get(cellKey(cx, cy));
      if (!cell) {
        continue;
      }
      // Cell origin in ENGINE coords: GTA cell centre (x, y) → engine (x, 0, −y).
      const origin: [number, number, number] = [(cx + 0.5) * cellSize, 0, -(cy + 0.5) * cellSize];
      for (const lod of [false, true]) {
        const parts = weldCellParts(fs, defs, cell, lod, planner, origin);
        if (parts) {
          welded.push({ cell: parts, key: `${cx},${cy},${lod ? 'lod' : 'hd'}` });
        }
      }
    }
  }

  return welded;
}
