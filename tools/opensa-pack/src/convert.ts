import type { AssetFileSystem } from '@opensa/renderware';

import {
  buildOspak,
  encodeOswire,
  OSCELL_VERTEX_STRIDE,
  oscellSections,
  type OspakInput,
  type OspakManifest,
} from '@opensa/engine-formats';
import { breakableModelsFromText } from '@opensa/renderware/breakable/models';
import { OPEN_SCRIPT_IPL, resolveMap } from '@opensa/renderware/map/resolve-map';
import { buildWorldGrid, cellKey } from '@opensa/renderware/map/world-grid';
import { MeshoptEncoder } from 'meshoptimizer';
/**
 * District conversion orchestrator (plan 074/03): resolve the map → world grid → for every cell in the rect,
 * weld HD + LOD levels → build texture arrays → deterministic pak + manifest + the measurement report the
 * plan docs consume.
 */
import { deflateRawSync } from 'node:zlib';

import type { WaterHeightGrid } from './height-grid';

import { AO_MAX_DISTANCE, bakeAo, type BakeAoReport, buildOccluderBvh } from './ao';
import { bakeCellsPooled, defaultBakeWorkers } from './bake-pool';
import { bakeSunVis, type BakeSunVisReport, SUNVIS_MAX_DISTANCE } from './sunvis';
import { TexturePlanner } from './textures';
import {
  assembleCell,
  createUvAnimRegistry,
  uvAnimList,
  type UvAnimRegistry,
  WELD_ROW,
  weldCellParts,
  type WeldedCell,
  type WeldStats,
} from './weld';

export interface ConvertOptions {
  /** Bake per-vertex AO/skyVis (074/07); on by default, `--no-ao` skips it. */
  ao?: boolean;
  /** Bake pool size (074/14 A2); 1 = the serial in-process path. Default: a quarter of the cores. */
  bakeWorkers?: number;
  cellSize?: number;
  /** Chunk side in cells (074/14 A2 chunked welding); the full map cannot hold one welded heap. */
  chunkCells?: number;
  /** Shared overlay TXDs (basenames, no extension) searched when a def's own txdp chain misses. */
  fallbackTxds?: readonly string[];
  /** Progress sink (chunk/bake/assembly lines with an ETA); silent when absent — tests stay quiet. */
  log?: (message: string) => void;
  /** Inclusive GTA cell-coordinate rect [x0, y0, x1, y1]. */
  rect: readonly [number, number, number, number];
  /** Curated stochastic de-tiling texture names, lowercased (074/12). */
  stochasticNames?: ReadonlySet<string>;
  /** Bake per-vertex sun visibility (074/07); on by default, `--no-sunvis` skips it. */
  sunVis?: boolean;
  /** Sea-level height sink (074/06 row 12 v3): welded triangles near sea level rasterize into it — the
   *  water bake then computes TRUE depth. Costs a linear pass per chunk, no rays. */
  waterHeights?: WaterHeightGrid;
}

export interface ConvertReport {
  /** IDE-anim instances welded at bind pose (frozen — no runtime animation yet). */
  /** Placements whose moving frames left the bundle for the host to animate (B7·b). */
  animatedObjects: number;
  animatedStatic: number;
  ao: (BakeAoReport & { ms: number }) | null;
  /** Smashable placements recorded (B7·a). */
  breakables: number;
  cells: { groups: number; indices: number; kbytes: number; key: string; vertices: number }[];
  pakBytes: number;
  /** ObjectTable entries across cells (074/06 row 9: timed windows / props). */
  /** 2dfx PARTICLE emitters welded into the pak (B6). */
  particles: number;
  skippedTimed: number;
  sunVis: (BakeSunVisReport & { ms: number }) | null;
  textures: TexturePlanner['report'] & { arrays: number };
  timedObjects: number;
  uvAnimations: number;
  /** UV-scroll draws welded (B7·c) + distinct animations registered map-wide. */
  uvAnimObjects: number;
}

export async function convertDistrict(
  fs: AssetFileSystem,
  options: ConvertOptions,
): Promise<{ manifest: OspakManifest; pak: Uint8Array; report: ConvertReport }> {
  await MeshoptEncoder.ready;
  const cellSize = options.cellSize ?? 250;
  const defs = resolveMap(fs, { extraIpl: OPEN_SCRIPT_IPL });
  // Smashable props (B7·a): object.dat's smash effects are the second half of the gate (the first is the DFF's
  // own shatter mesh). Absent-tolerant, and the SAME helper the runtime adapter gates with.
  const breakableModels = breakableModelsFromText(fs.getText('data/object.dat'));
  const grid = buildWorldGrid(defs, cellSize);
  const planner = new TexturePlanner(
    fs,
    defs.txdParents ?? new Map<string, string>(),
    options.fallbackTxds ?? [],
    options.stochasticNames ?? new Set(),
  );

  const inputs: OspakInput[] = [];
  const report: ConvertReport = {
    animatedObjects: 0,
    animatedStatic: 0,
    ao: null,
    breakables: 0,
    cells: [],
    pakBytes: 0,
    particles: 0,
    skippedTimed: 0,
    sunVis: null,
    textures: { arrays: 0, colors: 0, dedup: 0, opaquePass: 0, processed: 0 },
    timedObjects: 0,
    uvAnimations: 0,
    uvAnimObjects: 0,
  };
  // UV-scroll (B7·c / plan 074/18): one registry for the whole convert — dict names are global, so every
  // material referencing one shares a slot; only the HD (non-occluder) weld feeds it.
  const uvAnims = createUvAnimRegistry();

  // Phases 1-2, CHUNKED (074/14 A2): weld → bake → encode per chunk of cells, releasing the weld scratch
  // between chunks — the full map cannot hold one welded heap (16 GB held ONE city). The bake ring
  // (2 cells @250) covers the longest bake ray (sun-vis 400 u), so a chunk BVH shadows exactly like the
  // old district BVH; ring cells weld ONLY as occluders (HD, uncounted) and re-weld in their own chunk.
  // NB chunking changes texture-array layer ORDER vs the monolithic path (ring cells plan textures early)
  // — reruns stay byte-identical, which is the determinism contract.
  const ao = options.ao !== false;
  const sunVis = options.sunVis !== false;
  const chunkSide = Math.max(1, options.chunkCells ?? 6);
  const ringCells = ao || sunVis ? Math.ceil(Math.max(AO_MAX_DISTANCE, SUNVIS_MAX_DISTANCE) / cellSize) : 0;
  const workers = options.bakeWorkers ?? defaultBakeWorkers();
  const log = options.log ?? ((): void => undefined);
  const [x0, y0, x1, y1] = normalizedRect(options.rect);

  // Progress accounting (user ask: long converts must say where they are and what's left): the grid knows
  // which cells have content up front, so the ETA weights chunks by their cell counts, not chunk counts.
  const chunks: { cells: number; rect: readonly [number, number, number, number] }[] = [];
  for (let chunkY = y0; chunkY <= y1; chunkY += chunkSide) {
    for (let chunkX = x0; chunkX <= x1; chunkX += chunkSide) {
      const rect = [
        chunkX,
        chunkY,
        Math.min(chunkX + chunkSide - 1, x1),
        Math.min(chunkY + chunkSide - 1, y1),
      ] as const;
      const cells = countRectCells(grid, rect);
      if (cells > 0) {
        chunks.push({ cells, rect });
      }
    }
  }
  const totalCells = chunks.reduce((sum, entry) => sum + entry.cells, 0);
  log(`plan: ${chunks.length} chunks / ${totalCells} grid cells (chunk ${chunkSide}², bake ring ${ringCells})`);
  const startedMs = Date.now();
  let doneCells = 0;

  for (const [chunkIndex, chunk] of chunks.entries()) {
    const tag = `chunk ${chunkIndex + 1}/${chunks.length} [${chunk.rect.join(',')}]`;
    const chunkStarted = Date.now();
    const welded = weldRect(fs, defs, grid, planner, chunk.rect, cellSize, breakableModels, uvAnims);
    if (welded.length === 0) {
      doneCells += chunk.cells;
      continue;
    }
    if (ao || sunVis) {
      // Occluder ring: HD-only welds of the surrounding cells (clipped to the convert rect — geometry
      // outside it never occluded in the monolithic path either).
      const ring = weldRing(fs, defs, grid, planner, chunk.rect, [x0, y0, x1, y1], ringCells, cellSize);
      const cellsOnly = welded.map((entry) => entry.cell);
      const bvh = buildOccluderBvh([...cellsOnly, ...ring]);
      // Bucket rows, not stats (stats.vertices only fills during the later encode pass).
      const verts = cellsOnly.reduce(
        (sum, cell) => sum + cell.buckets.reduce((rows, bucket) => rows + bucket.vertices.length / WELD_ROW, 0),
        0,
      );
      log(`${tag}: welded ${welded.length} entries (${(verts / 1e6).toFixed(2)} M verts), baking …`);
      await bakeChunk(cellsOnly, bvh, { ao, sunVis, workers }, report);
    }
    if (options.waterHeights) {
      collectWaterHeights(options.waterHeights, welded);
    }
    for (const entry of welded) {
      const bytes = assembleCell(entry.cell);
      inputs.push(wireCompress({ bytes, key: entry.key, kind: 'cell' }));
      accumulate(report, entry.key, bytes.byteLength, entry.cell.stats);
    }
    doneCells += chunk.cells;
    const elapsed = (Date.now() - startedMs) / 1000;
    const eta = doneCells > 0 ? (elapsed * (totalCells - doneCells)) / doneCells : 0;
    log(
      `${tag}: done in ${((Date.now() - chunkStarted) / 1000).toFixed(1)}s — ` +
        `${doneCells}/${totalCells} cells (${((doneCells / totalCells) * 100).toFixed(0)} %), ` +
        `elapsed ${elapsed.toFixed(0)}s, eta ~${eta.toFixed(0)}s`,
    );
  }

  log('encoding texture arrays …');
  for (const array of planner.build()) {
    inputs.push(wireCompress({ bytes: array.bytes, key: `array-${array.ref}`, kind: 'texture', meta: array.meta }));
    report.textures.arrays += 1;
  }
  Object.assign(report.textures, planner.report, { arrays: report.textures.arrays });
  log(`assembling pak (${inputs.length} entries) …`);

  const timecyc24 = fs.getText('data/timecyc_24h.dat');
  const timecyc = timecyc24 ?? fs.getText('data/timecyc.dat') ?? undefined;
  const uvAnimations = uvAnimList(uvAnims);
  report.uvAnimations = uvAnimations.length;
  const { manifest, pak } = buildOspak(inputs, {
    cellSize,
    uvAnimations, // buildOspak drops the key when the list is empty
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
  report.animatedStatic += stats.animatedStatic;
  report.animatedObjects += stats.animatedObjects;
  report.skippedTimed += stats.skippedTimed;
  report.particles += stats.particles;
  report.timedObjects += stats.timedObjects;
  report.uvAnimObjects += stats.uvAnimObjects;
  report.breakables += stats.breakables;
}

/** Bake one chunk's cells (pooled when workers > 1) and fold the counters into the report. */
async function bakeChunk(
  cells: WeldedCell[],
  bvh: ReturnType<typeof buildOccluderBvh>,
  options: { ao: boolean; sunVis: boolean; workers: number },
  report: ConvertReport,
): Promise<void> {
  const started = Date.now();
  if (options.workers > 1) {
    // Pooled path: both bakes run interleaved per cell across the pool — the wall time is one shared
    // number, attributed to both report rows.
    const pooled = await bakeCellsPooled(cells, bvh, options);
    mergeBakeReports(report, pooled.ao, pooled.sunVis, Date.now() - started);

    return;
  }
  const aoBake = options.ao ? bakeAo(cells, { bvh }) : null;
  const aoMs = Date.now() - started;
  const sunStarted = Date.now();
  const sunBake = options.sunVis ? bakeSunVis(cells, bvh) : null;
  mergeBakeReports(report, aoBake, sunBake, aoMs, Date.now() - sunStarted);
}

/** Feed HD welded triangles into the sea-level height grid (074/06 row 12 v3). Cell-local ENGINE coords →
 *  GTA: gx = ox+px, gy = −(oz+pz), gz = oy+py. LOD entries skip — they duplicate the HD ground. */
function collectWaterHeights(gridSink: WaterHeightGrid, welded: readonly { cell: WeldedCell; key: string }[]): void {
  for (const { cell } of welded) {
    if (cell.lod) {
      continue;
    }
    const [ox, oy, oz] = cell.origin;
    for (const bucket of cell.buckets) {
      const rows = bucket.vertices;
      const gta = (index: number): [number, number, number] => {
        const at = index * WELD_ROW;

        return [ox + rows[at], -(oz + rows[at + 2]), oy + rows[at + 1]];
      };
      for (let tri = 0; tri + 2 < bucket.indices.length; tri += 3) {
        const a = gta(bucket.indices[tri]);
        const b = gta(bucket.indices[tri + 1]);
        const c = gta(bucket.indices[tri + 2]);
        gridSink.addTriangle(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      }
    }
  }
}

/** Grid cells with content inside a rect — the progress/ETA weight (cheap: pure map lookups). */
function countRectCells(
  grid: ReturnType<typeof buildWorldGrid>,
  rect: readonly [number, number, number, number],
): number {
  let count = 0;
  for (let cy = rect[1]; cy <= rect[3]; cy += 1) {
    for (let cx = rect[0]; cx <= rect[2]; cx += 1) {
      if (grid.has(cellKey(cx, cy))) {
        count += 1;
      }
    }
  }

  return count;
}

/** Fold one chunk's bake counters into the report (ms accumulates; both pooled rows share one wall time). */
function mergeBakeReports(
  report: ConvertReport,
  aoBake: BakeAoReport | null,
  sunBake: BakeSunVisReport | null,
  aoMs: number,
  sunMs = aoMs,
): void {
  if (aoBake) {
    const prev = report.ao ?? { ms: 0, rays: 0, triangles: 0, uniqueVertices: 0, vertices: 0 };
    report.ao = {
      ms: prev.ms + aoMs,
      rays: prev.rays + aoBake.rays,
      // Ring occluders overlap between chunks — the sum overcounts shared border triangles.
      triangles: prev.triangles + aoBake.triangles,
      uniqueVertices: prev.uniqueVertices + aoBake.uniqueVertices,
      vertices: prev.vertices + aoBake.vertices,
    };
  }
  if (sunBake) {
    const prev = report.sunVis ?? { ms: 0, rays: 0, uniqueVertices: 0, vertices: 0 };
    report.sunVis = {
      ms: prev.ms + sunMs,
      rays: prev.rays + sunBake.rays,
      uniqueVertices: prev.uniqueVertices + sunBake.uniqueVertices,
      vertices: prev.vertices + sunBake.vertices,
    };
  }
}

function normalizedRect(rect: readonly [number, number, number, number]): [number, number, number, number] {
  return [
    Math.min(rect[0], rect[2]),
    Math.min(rect[1], rect[3]),
    Math.max(rect[0], rect[2]),
    Math.max(rect[1], rect[3]),
  ];
}

function weldRect(
  fs: AssetFileSystem,
  defs: ReturnType<typeof resolveMap>,
  grid: ReturnType<typeof buildWorldGrid>,
  planner: TexturePlanner,
  rect: readonly [number, number, number, number],
  cellSize: number,
  breakableModels: ReadonlySet<string>,
  uvAnimRegistry: UvAnimRegistry,
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
        const parts = weldCellParts(fs, defs, cell, lod, planner, origin, breakableModels, uvAnimRegistry);
        if (parts) {
          welded.push({ cell: parts, key: `${cx},${cy},${lod ? 'lod' : 'hd'}` });
        }
      }
    }
  }

  return welded;
}

/** HD-only occluder welds of the ring around `inner` (clipped to the convert rect, inner cells excluded). */
function weldRing(
  fs: AssetFileSystem,
  defs: ReturnType<typeof resolveMap>,
  grid: ReturnType<typeof buildWorldGrid>,
  planner: TexturePlanner,
  inner: readonly [number, number, number, number],
  rect: readonly [number, number, number, number],
  ring: number,
  cellSize: number,
): WeldedCell[] {
  const cells: WeldedCell[] = [];
  for (let cy = Math.max(inner[1] - ring, rect[1]); cy <= Math.min(inner[3] + ring, rect[3]); cy += 1) {
    for (let cx = Math.max(inner[0] - ring, rect[0]); cx <= Math.min(inner[2] + ring, rect[2]); cx += 1) {
      if (cx >= inner[0] && cx <= inner[2] && cy >= inner[1] && cy <= inner[3]) {
        continue;
      }
      const cell = grid.get(cellKey(cx, cy));
      if (!cell) {
        continue;
      }
      const origin: [number, number, number] = [(cx + 0.5) * cellSize, 0, -(cy + 0.5) * cellSize];
      const parts = weldCellParts(fs, defs, cell, false, planner, origin);
      if (parts) {
        cells.push(parts);
      }
    }
  }

  return cells;
}

/** Per-entry wire compression (074/10 A1 + 074/14 stage 2): cells go meshopt (vertex + index streams in an
 *  `.oswire` container) then deflate-raw; everything else plain deflate-raw — natively inflatable in the pak
 *  worker via `DecompressionStream`. Skipped when it doesn't pay (already-compressed payloads). */
function wireCompress(input: OspakInput): OspakInput {
  if (input.kind === 'cell') {
    const sections = oscellSections(input.bytes);
    // The meshopt index codec is triangle-list-only; every welded cell is one (guard stays for safety).
    // NB the codec canonicalizes each triangle's cyclic rotation (order + winding preserved, provoking
    // vertex not) — safe here because the only flat-interpolated attribute is the texture layer, and a
    // triangle never mixes layers (vertex dedup keys the full 36-byte content; one triangle = one material).
    if (sections.indexCount % 3 === 0 && sections.vertexCount > 0 && sections.indexCount > 0) {
      const vertexBlock = MeshoptEncoder.encodeVertexBuffer(
        input.bytes.subarray(
          sections.vertexOffset,
          sections.vertexOffset + sections.vertexCount * OSCELL_VERTEX_STRIDE,
        ),
        sections.vertexCount,
        OSCELL_VERTEX_STRIDE,
      );
      const indexBlock = MeshoptEncoder.encodeIndexBuffer(
        input.bytes.subarray(sections.indexOffset, sections.tailOffset),
        sections.indexCount,
        sections.indexElemSize,
      );
      const container = encodeOswire(input.bytes, vertexBlock, indexBlock);
      const wire = deflateRawSync(container, { level: 6 });
      if (wire.byteLength < input.bytes.byteLength * 0.95) {
        return { ...input, bytes: wire, enc: 'oswire-deflate-raw', rawLength: input.bytes.byteLength };
      }
    }
  }
  const wire = deflateRawSync(input.bytes, { level: 6 });
  if (wire.byteLength >= input.bytes.byteLength * 0.95) {
    return input;
  }

  return { ...input, bytes: wire, enc: 'deflate-raw', rawLength: input.bytes.byteLength };
}
