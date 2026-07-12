/**
 * Cell welder (plan 074/03): one grid cell (HD or LOD level) → one `.oscell`. Every mergeable model instance
 * is transform-BAKED into cell-local ENGINE coordinates (GTA Z-up → engine Y-up: e = (x, z, −y)) and welded
 * into draw groups keyed by (texture array, pipeline class, side) — the offline batching that IS the thesis.
 * Timed / IDE-anim defs are skipped in M0 (counted in the stats; the objectTable path lands with M2).
 */
import type { Oscell, OscellGroup } from '@opensa/engine-formats';
import type { AssetFileSystem, IplInstance, MapDefinitions } from '@opensa/renderware';

import { encodeOscell, OSCELL_VERTEX_STRIDE, OscellChannel } from '@opensa/engine-formats';
import { getClump } from '@opensa/renderware/archive/asset-cache';
import { cellGroups } from '@opensa/renderware/map/build-cell';
import { type GridCell } from '@opensa/renderware/map/world-grid';
import { isVertexAlphaBeam, prepareClumpAtomics } from '@opensa/renderware/mesh/prepare-clump';
import { IdeFlag } from '@opensa/renderware/parsers/text/index';

import type { TexturePlanner } from './textures';

export interface WeldBucket {
  indices: number[];
  key: string;
  max: [number, number, number];
  min: [number, number, number];
  pipelineClass: number;
  side: number;
  textureArrayRef: number;
  vertices: number[]; // scratch rows: px py pz nx ny nz u v dr dg db da nr ng nb sway layer ao sunVis
}

/** The welded-but-not-yet-encoded cell — the bake stages (074/07) mutate scratch rows between the phases. */
export interface WeldedCell {
  buckets: WeldBucket[];
  hasAo: boolean;
  hasNight: boolean;
  hasSunVis: boolean;
  hasSway: boolean;
  lod: boolean;
  origin: readonly [number, number, number];
  stats: WeldStats;
}

export interface WeldStats {
  groups: number;
  indices: number;
  skippedAnimated: number;
  skippedTimed: number;
  vertices: number;
}

/** Scratch-row layout (floats per welded vertex) + the slots the bakers touch. */
export const WELD_ROW = 19;
export const WELD_AO = 17;
export const WELD_SUNVIS = 18;

/** Synthesized night ambient for geometry without an authored night set (slightly cool, ~SA night level). */
const NIGHT_AMBIENT_R = 0.3;
const NIGHT_AMBIENT_G = 0.32;
const NIGHT_AMBIENT_B = 0.4;

/** Phase 2: encode the (possibly baked) scratch buckets into `.oscell` bytes. */
export function assembleCell(welded: WeldedCell): Uint8Array {
  return assemble(welded.buckets, welded.origin, welded, welded.stats);
}

/** Convert one cell in one shot (weld + encode, no bake) — the tests' and no-bake path. */
export function weldCell(
  fs: AssetFileSystem,
  defs: MapDefinitions,
  cell: GridCell,
  lod: boolean,
  planner: TexturePlanner,
  originEngine: readonly [number, number, number],
): null | { bytes: Uint8Array; stats: WeldStats } {
  const welded = weldCellParts(fs, defs, cell, lod, planner, originEngine);

  return welded ? { bytes: assembleCell(welded), stats: welded.stats } : null;
}

/** Phase 1: weld into scratch buckets; returns null when the cell contains nothing mergeable. */
export function weldCellParts(
  fs: AssetFileSystem,
  defs: MapDefinitions,
  cell: GridCell,
  lod: boolean,
  planner: TexturePlanner,
  originEngine: readonly [number, number, number],
): null | WeldedCell {
  const buckets = new Map<string, WeldBucket>();
  const stats: WeldStats = { groups: 0, indices: 0, skippedAnimated: 0, skippedTimed: 0, vertices: 0 };
  const flags = { hasNight: false, hasSway: false };

  const groups = [...cellGroups(defs, cell, lod).values()].sort((a, b) => (a.def.modelName < b.def.modelName ? -1 : 1));
  for (const group of groups) {
    const def = group.def;
    if (def.anim !== undefined) {
      stats.skippedAnimated += group.instances.length;
      continue;
    }
    if (def.time !== undefined) {
      stats.skippedTimed += group.instances.length;
      continue;
    }
    weldGroup(fs, group.def, group.instances, buckets, planner, originEngine, flags);
  }

  const ordered = [...buckets.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  if (ordered.length === 0) {
    return null;
  }

  return {
    buckets: ordered,
    hasAo: false,
    hasNight: flags.hasNight,
    hasSunVis: false,
    hasSway: flags.hasSway,
    lod,
    origin: originEngine,
    stats,
  };
}

/** Bake one instance of one part into the bucket (GTA→engine axes + cell-local offset). */
function appendInstance(
  bucket: WeldBucket,
  atomic: ReturnType<typeof prepareClumpAtomics>[number],
  index: Uint16Array | Uint32Array,
  instance: IplInstance,
  layer: number,
  origin: readonly [number, number, number],
): void {
  // GTA IPL quaternions are the conjugate of the usual convention (parity with build-region).
  const [qx, qy, qz, qw] = [-instance.rotation[0], -instance.rotation[1], -instance.rotation[2], instance.rotation[3]];
  const m = quatToMat3(qx, qy, qz, qw);
  const base = bucket.vertices.length / WELD_ROW;
  const used = new Map<number, number>(); // source vertex → welded row (per instance/part)
  const remap = (source: number): number => {
    const existing = used.get(source);
    if (existing !== undefined) {
      return existing;
    }
    const px = atomic.positions[source * 3];
    const py = atomic.positions[source * 3 + 1];
    const pz = atomic.positions[source * 3 + 2];
    // world (GTA) = R·v + t → engine (Y-up) = (x, z, −y) → cell-local.
    const gx = m[0] * px + m[1] * py + m[2] * pz + instance.position[0];
    const gy = m[3] * px + m[4] * py + m[5] * pz + instance.position[1];
    const gz = m[6] * px + m[7] * py + m[8] * pz + instance.position[2];
    const ex = gx - origin[0];
    const ey = gz - origin[1];
    const ez = -gy - origin[2];
    const nx = atomic.normals[source * 3];
    const ny = atomic.normals[source * 3 + 1];
    const nz = atomic.normals[source * 3 + 2];
    const gnx = m[0] * nx + m[1] * ny + m[2] * nz;
    const gny = m[3] * nx + m[4] * ny + m[5] * nz;
    const gnz = m[6] * nx + m[7] * ny + m[8] * nz;
    const colorSize = atomic.color?.itemSize ?? 3;
    const dayR = atomic.color ? atomic.color.array[source * colorSize] : 1;
    const dayG = atomic.color ? atomic.color.array[source * colorSize + 1] : 1;
    const dayB = atomic.color ? atomic.color.array[source * colorSize + 2] : 1;
    const dayA = atomic.color && colorSize === 4 ? atomic.color.array[source * colorSize + 3] : 1;
    bucket.vertices.push(
      ex,
      ey,
      ez,
      gnx,
      gnz,
      -gny,
      atomic.uv ? atomic.uv[source * 2] : 0,
      atomic.uv ? atomic.uv[source * 2 + 1] : 0,
      dayR,
      dayG,
      dayB,
      dayA,
      // No authored night set → synthesize night = day × ambient (074/06 row 1: one blend formula for the
      // whole world; the weather-reactive ambient of the old dual-tint path is a later refinement).
      atomic.nightColor ? atomic.nightColor[source * 3] : dayR * NIGHT_AMBIENT_R,
      atomic.nightColor ? atomic.nightColor[source * 3 + 1] : dayG * NIGHT_AMBIENT_G,
      atomic.nightColor ? atomic.nightColor[source * 3 + 2] : dayB * NIGHT_AMBIENT_B,
      atomic.sway ? atomic.sway.weights[source] : 0,
      layer,
      // aoSkyVis + sunVis defaults = fully open; the bake stages (074/07) overwrite HD rows in place.
      1,
      1,
    );
    bucket.min[0] = Math.min(bucket.min[0], ex);
    bucket.min[1] = Math.min(bucket.min[1], ey);
    bucket.min[2] = Math.min(bucket.min[2], ez);
    bucket.max[0] = Math.max(bucket.max[0], ex);
    bucket.max[1] = Math.max(bucket.max[1], ey);
    bucket.max[2] = Math.max(bucket.max[2], ez);
    const row = base + used.size;
    used.set(source, row);

    return row;
  };
  // Axis flip (x, z, −y) mirrors handedness once — triangle order stays (parity with the −90°X root, which
  // also never re-wound); engine pipelines cull ccw-front like three did.
  for (let tri = 0; tri < index.length; tri += 3) {
    bucket.indices.push(remap(index[tri]), remap(index[tri + 1]), remap(index[tri + 2]));
  }
}

function assemble(
  ordered: WeldBucket[],
  origin: readonly [number, number, number],
  channels: { hasAo: boolean; hasNight: boolean; hasSunVis: boolean; hasSway: boolean },
  stats: WeldStats,
): Uint8Array {
  let vertexCount = 0;
  let indexCount = 0;
  for (const bucket of ordered) {
    vertexCount += bucket.vertices.length / WELD_ROW;
    indexCount += bucket.indices.length;
  }
  const index16 = vertexCount <= 0xffff;
  const vertexData = new Uint8Array(vertexCount * OSCELL_VERTEX_STRIDE);
  const view = new DataView(vertexData.buffer);
  const indexArray = index16 ? new Uint16Array(indexCount) : new Uint32Array(indexCount);
  const groups: OscellGroup[] = [];
  const cellMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const cellMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  let vertexBase = 0;
  let indexBase = 0;
  for (const bucket of ordered) {
    const bucketVertices = bucket.vertices.length / WELD_ROW;
    for (let vertex = 0; vertex < bucketVertices; vertex += 1) {
      const row = vertex * WELD_ROW;
      const at = (vertexBase + vertex) * OSCELL_VERTEX_STRIDE;
      view.setFloat32(at, bucket.vertices[row], true);
      view.setFloat32(at + 4, bucket.vertices[row + 1], true);
      view.setFloat32(at + 8, bucket.vertices[row + 2], true);
      view.setInt8(at + 12, snorm(bucket.vertices[row + 3]));
      view.setInt8(at + 13, snorm(bucket.vertices[row + 4]));
      view.setInt8(at + 14, snorm(bucket.vertices[row + 5]));
      // normal.w carries baked sunVis (074/07) — snorm, only 0..127 used; gated by the SUN_VIS channel bit.
      view.setInt8(at + 15, snorm(Math.max(0, Math.min(1, bucket.vertices[row + WELD_SUNVIS]))));
      view.setFloat32(at + 16, bucket.vertices[row + 6], true);
      view.setFloat32(at + 20, bucket.vertices[row + 7], true);
      view.setUint8(at + 24, unorm(bucket.vertices[row + 8]));
      view.setUint8(at + 25, unorm(bucket.vertices[row + 9]));
      view.setUint8(at + 26, unorm(bucket.vertices[row + 10]));
      view.setUint8(at + 27, unorm(bucket.vertices[row + 11]));
      view.setUint8(at + 28, unorm(bucket.vertices[row + 12]));
      view.setUint8(at + 29, unorm(bucket.vertices[row + 13]));
      view.setUint8(at + 30, unorm(bucket.vertices[row + 14]));
      view.setUint8(at + 31, unorm(bucket.vertices[row + 15]));
      view.setUint16(at + 32, bucket.vertices[row + 16], true);
      // channels u16 = aoSkyVis | emissive << 8 (074/02); emissive mask is a later bake.
      view.setUint16(at + 34, unorm(bucket.vertices[row + WELD_AO]), true);
    }
    for (let entry = 0; entry < bucket.indices.length; entry += 1) {
      indexArray[indexBase + entry] = bucket.indices[entry] + vertexBase;
    }
    const center: [number, number, number] = [
      (bucket.min[0] + bucket.max[0]) / 2,
      (bucket.min[1] + bucket.max[1]) / 2,
      (bucket.min[2] + bucket.max[2]) / 2,
    ];
    const radius = Math.hypot(bucket.max[0] - center[0], bucket.max[1] - center[1], bucket.max[2] - center[2]);
    groups.push({
      bounds: [center[0], center[1], center[2], radius],
      indexCount: bucket.indices.length,
      indexOffset: indexBase,
      pipelineClass: bucket.pipelineClass,
      side: bucket.side,
      textureArrayRef: bucket.textureArrayRef,
    });
    for (let axis = 0; axis < 3; axis += 1) {
      cellMin[axis] = Math.min(cellMin[axis], bucket.min[axis]);
      cellMax[axis] = Math.max(cellMax[axis], bucket.max[axis]);
    }
    vertexBase += bucketVertices;
    indexBase += bucket.indices.length;
  }

  stats.groups = groups.length;
  stats.vertices = vertexCount;
  stats.indices = indexCount;
  const center: [number, number, number] = [
    (cellMin[0] + cellMax[0]) / 2,
    (cellMin[1] + cellMax[1]) / 2,
    (cellMin[2] + cellMax[2]) / 2,
  ];
  const cell: Oscell = {
    bounds: [
      center[0],
      center[1],
      center[2],
      Math.hypot(cellMax[0] - center[0], cellMax[1] - center[1], cellMax[2] - center[2]),
    ],
    channelMask:
      (channels.hasNight ? OscellChannel.NIGHT_PRELIT : 0) |
      (channels.hasSway ? OscellChannel.SWAY : 0) |
      (channels.hasAo ? OscellChannel.AO_SKY_VIS : 0) |
      (channels.hasSunVis ? OscellChannel.SUN_VIS : 0),
    groups,
    index16,
    indexCount,
    indexData: new Uint8Array(indexArray.buffer),
    lights: [],
    objects: [],
    origin,
    vertexCount,
    vertexData,
  };

  return encodeOscell(cell);
}

function bucketFor(
  buckets: Map<string, WeldBucket>,
  arrayRef: number,
  pipelineClass: number,
  side: number,
): WeldBucket {
  const key = `${String(arrayRef).padStart(4, '0')}|${pipelineClass}|${side}`;
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = {
      indices: [],
      key,
      max: [-Infinity, -Infinity, -Infinity],
      min: [Infinity, Infinity, Infinity],
      pipelineClass,
      side,
      textureArrayRef: arrayRef,
      vertices: [],
    };
    buckets.set(key, bucket);
  }

  return bucket;
}

/** Part → `.oscell` pipelineClass: beam (3) wins; else the texture's alpha class decides. */
function classOf(beam: boolean, alphaClass: 'cutout' | 'opaque' | 'softBlend'): number {
  if (beam) {
    return 3;
  }

  return alphaClass === 'cutout' ? 1 : alphaClass === 'softBlend' ? 2 : 0;
}

function quatToMat3(x: number, y: number, z: number, w: number): number[] {
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - w * z),
    2 * (x * z + w * y),
    2 * (x * y + w * z),
    1 - 2 * (x * x + z * z),
    2 * (y * z - w * x),
    2 * (x * z - w * y),
    2 * (y * z + w * x),
    1 - 2 * (x * x + y * y),
  ];
}

function snorm(value: number): number {
  return Math.max(-127, Math.min(127, Math.round(value * 127)));
}

function unorm(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value * 255)));
}

/** Weld every atomic part × instance of one model group into the shared buckets. */
function weldGroup(
  fs: AssetFileSystem,
  def: NonNullable<ReturnType<MapDefinitions['catalog']['get']>>,
  instances: readonly IplInstance[],
  buckets: Map<string, WeldBucket>,
  planner: TexturePlanner,
  originEngine: readonly [number, number, number],
  flags: { hasNight: boolean; hasSway: boolean },
): void {
  const clump = getClump(fs, def.modelName);
  const atomics = prepareClumpAtomics(clump);
  const doubleSided = (def.flags & IdeFlag.DISABLE_BACKFACE_CULLING) !== 0 ? 1 : 0;
  for (const atomic of atomics) {
    const geometry = clump.geometries[atomic.geometryIndex];
    if (!geometry) {
      continue;
    }
    for (const part of atomic.parts) {
      const material = geometry.materials[part.materialIndex] ?? {
        color: [255, 255, 255, 255] as const,
        texture: null,
        textured: false,
      };
      const beam = isVertexAlphaBeam(material, geometry);
      const resolved = planner.resolve(def.txdName, material.texture?.name ?? null, material.color);
      const bucket = bucketFor(buckets, resolved.arrayRef, classOf(beam, resolved.alphaClass), doubleSided);
      for (const instance of instances) {
        appendInstance(bucket, atomic, part.index, instance, resolved.layer, originEngine);
        flags.hasNight ||= atomic.nightColor !== null;
        flags.hasSway ||= atomic.sway !== null;
      }
    }
  }
}
