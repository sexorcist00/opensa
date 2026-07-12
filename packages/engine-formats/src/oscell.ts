/**
 * `.oscell` — one streamed cell (HD or LOD level) in the final GPU layout (plan 074/02). The runtime "codec"
 * is a header parse + `queue.writeBuffer`: vertex/index payloads upload verbatim.
 *
 * Vertex layout v0 — interleaved, stride 36 B (all offsets 4-aligned where WebGPU requires):
 *   0  position  float32x3   cell-local (header carries the cell origin)
 *   12 normal    snorm8x4    .w = baked sunVis 0..1 (074/07; meaningful only with the SUN_VIS channel bit)
 *   16 uv        float32x2   GTA UVs tile far outside [0,1]
 *   24 dayPrelit unorm8x4    RGB day prelight, A = beam/cone alpha where used
 *   28 nightPrelit unorm8x4  RGB night set, A = sway weight (wind)
 *   32 layerChannels uint16x2  [0] = texture-array layer, [1] = aoSkyVis | emissive << 8 (unpacked in WGSL)
 */
import { ByteReader, ByteWriter } from './binary';

export const OSCELL_MAGIC = 0x3143534f; // 'OSC1' little-endian
export const OSCELL_VERSION_MAJOR = 0;
export const OSCELL_VERSION_MINOR = 1;
export const OSCELL_VERTEX_STRIDE = 36;

/** Header `flags` bits. */
export const OscellFlag = {
  /** Index buffer is uint16 (default uint32). */
  INDEX16: 1 << 0,
} as const;

/** `channelMask` bits — which OPTIONAL vertex data is meaningful (absent ⇒ zeros are placeholders). */
export const OscellChannel = {
  AO_SKY_VIS: 1 << 2,
  EMISSIVE: 1 << 3,
  NIGHT_PRELIT: 1 << 0,
  SUN_VIS: 1 << 4,
  SWAY: 1 << 1,
} as const;

export interface Oscell {
  bounds: readonly [number, number, number, number];
  channelMask: number;
  groups: OscellGroup[];
  index16: boolean;
  indexCount: number;
  /** uint16 or uint32 raw index payload (see `index16`). */
  indexData: Uint8Array;
  lights: OscellLight[];
  objects: OscellObject[];
  origin: readonly [number, number, number];
  vertexCount: number;
  /** Interleaved vertex payload, stride {@link OSCELL_VERTEX_STRIDE}. */
  vertexData: Uint8Array;
}

/** One GPU draw (the unit of offline merging — plan 074/02). */
export interface OscellGroup {
  /** Bounding sphere [x, y, z, r] in cell-local space (sub-cell culling without a format change). */
  bounds: readonly [number, number, number, number];
  indexCount: number;
  indexOffset: number;
  /** 0 opaque | 1 cutout (A2C) | 2 blend | 3 beam. */
  pipelineClass: number;
  /** 0 front-side | 1 double-sided. */
  side: number;
  /** Which `.ostex` array this group samples (manifest index). */
  textureArrayRef: number;
}

/** A 2dfx light/corona anchor (transplanted by the existing LOD chain). */
export interface OscellLight {
  color: readonly [number, number, number, number];
  farClip: number;
  position: readonly [number, number, number];
  size: number;
}

/** An unmergeable object (rendered OUTSIDE the cell bundle): timed/breakable/animated/roadsign. */
export interface OscellObject {
  groupCount: number;
  groupStart: number;
  /** 0 timed | 1 breakable | 2 animated | 3 roadsign. */
  kind: number;
  /** kind-specific packed params (timed: onHour | offHour << 8). */
  params: number;
  /** Row-major 3×4 affine transform (cell-local). */
  transform: readonly number[];
}

const GROUP_RECORD_BYTES = 32;
const OBJECT_RECORD_BYTES = 64;
const LIGHT_RECORD_BYTES = 24;

export function decodeOscell(bytes: Uint8Array): Oscell {
  const r = new ByteReader(bytes);
  const magic = r.u32();
  if (magic !== OSCELL_MAGIC) {
    throw new Error(`not an .oscell (magic 0x${magic.toString(16)})`);
  }
  const major = r.u16();
  r.u16(); // minor — additive only
  if (major !== OSCELL_VERSION_MAJOR) {
    throw new Error(`unsupported .oscell major ${major} (reader supports ${OSCELL_VERSION_MAJOR})`);
  }
  const flags = r.u32();
  const channelMask = r.u32();
  const bounds = [r.f32(), r.f32(), r.f32(), r.f32()] as const;
  const origin = [r.f32(), r.f32(), r.f32()] as const;
  r.f32(); // pad
  const vertexCount = r.u32();
  const indexCount = r.u32();
  const groupCount = r.u32();
  const objectCount = r.u32();
  const lightCount = r.u32();
  const vertexOffset = r.u32();
  const indexOffset = r.u32();
  const tableOffset = r.u32();

  const index16 = (flags & OscellFlag.INDEX16) !== 0;
  r.seek(vertexOffset);
  const vertexData = r.raw(vertexCount * OSCELL_VERTEX_STRIDE);
  r.seek(indexOffset);
  const indexData = r.raw(indexCount * (index16 ? 2 : 4));

  r.seek(tableOffset);
  const groups: OscellGroup[] = [];
  for (let index = 0; index < groupCount; index += 1) {
    const pipelineClass = r.u8();
    const side = r.u8();
    const textureArrayRef = r.u16();
    const groupIndexOffset = r.u32();
    const groupIndexCount = r.u32();
    const groupBounds = [r.f32(), r.f32(), r.f32(), r.f32()] as const;
    r.u32(); // pad
    groups.push({
      bounds: groupBounds,
      indexCount: groupIndexCount,
      indexOffset: groupIndexOffset,
      pipelineClass,
      side,
      textureArrayRef,
    });
  }
  const objects: OscellObject[] = [];
  for (let index = 0; index < objectCount; index += 1) {
    const kind = r.u8();
    r.u8();
    r.u16();
    const params = r.u32();
    const groupStart = r.u32();
    const groupCountOwn = r.u32();
    const transform: number[] = [];
    for (let component = 0; component < 12; component += 1) {
      transform.push(r.f32());
    }
    objects.push({ groupCount: groupCountOwn, groupStart, kind, params, transform });
  }
  const lights: OscellLight[] = [];
  for (let index = 0; index < lightCount; index += 1) {
    const position = [r.f32(), r.f32(), r.f32()] as const;
    const color = [r.u8(), r.u8(), r.u8(), r.u8()] as const;
    const size = r.f32();
    const farClip = r.f32();
    lights.push({ color, farClip, position, size });
  }

  return {
    bounds,
    channelMask,
    groups,
    index16,
    indexCount,
    indexData,
    lights,
    objects,
    origin,
    vertexCount,
    vertexData,
  };
}

export function encodeOscell(cell: Oscell): Uint8Array {
  if (cell.vertexData.byteLength !== cell.vertexCount * OSCELL_VERTEX_STRIDE) {
    throw new Error(
      `vertexData ${cell.vertexData.byteLength} B ≠ vertexCount ${cell.vertexCount} × stride ${OSCELL_VERTEX_STRIDE}`,
    );
  }
  const indexBytesPer = cell.index16 ? 2 : 4;
  if (cell.indexData.byteLength !== cell.indexCount * indexBytesPer) {
    throw new Error(`indexData ${cell.indexData.byteLength} B ≠ indexCount ${cell.indexCount} × ${indexBytesPer}`);
  }
  const w = new ByteWriter(cell.vertexData.byteLength + cell.indexData.byteLength + 4096);
  w.u32(OSCELL_MAGIC);
  w.u16(OSCELL_VERSION_MAJOR);
  w.u16(OSCELL_VERSION_MINOR);
  w.u32(cell.index16 ? OscellFlag.INDEX16 : 0);
  w.u32(cell.channelMask);
  for (const value of cell.bounds) {
    w.f32(value);
  }
  for (const value of cell.origin) {
    w.f32(value);
  }
  w.f32(0); // pad
  w.u32(cell.vertexCount);
  w.u32(cell.indexCount);
  w.u32(cell.groups.length);
  w.u32(cell.objects.length);
  w.u32(cell.lights.length);
  const vertexOffsetSlot = w.reserveU32();
  const indexOffsetSlot = w.reserveU32();
  const tableOffsetSlot = w.reserveU32();

  w.align(4);
  w.patchU32(vertexOffsetSlot, w.offset);
  w.raw(cell.vertexData);
  w.align(4);
  w.patchU32(indexOffsetSlot, w.offset);
  w.raw(cell.indexData);
  w.align(4);
  w.patchU32(tableOffsetSlot, w.offset);
  for (const group of cell.groups) {
    w.u8(group.pipelineClass);
    w.u8(group.side);
    w.u16(group.textureArrayRef);
    w.u32(group.indexOffset);
    w.u32(group.indexCount);
    for (const value of group.bounds) {
      w.f32(value);
    }
    w.u32(0); // pad to GROUP_RECORD_BYTES
  }
  for (const object of cell.objects) {
    w.u8(object.kind);
    w.u8(0);
    w.u16(0);
    w.u32(object.params);
    w.u32(object.groupStart);
    w.u32(object.groupCount);
    if (object.transform.length !== 12) {
      throw new Error(`object transform must be 12 floats (3×4), got ${object.transform.length}`);
    }
    for (const value of object.transform) {
      w.f32(value);
    }
  }
  for (const light of cell.lights) {
    for (const value of light.position) {
      w.f32(value);
    }
    for (const value of light.color) {
      w.u8(value);
    }
    w.f32(light.size);
    w.f32(light.farClip);
  }

  return w.bytes();
}

/** Record sizes exported for the tool's budget math. */
export const OSCELL_RECORD_BYTES = {
  group: GROUP_RECORD_BYTES,
  light: LIGHT_RECORD_BYTES,
  object: OBJECT_RECORD_BYTES,
} as const;
