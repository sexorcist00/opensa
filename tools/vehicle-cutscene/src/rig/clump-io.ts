/**
 * Clump-level DFF surgery over rw-codec's byte-faithful chunk tree: read a clump into frames (with names
 * + HAnim), atomics (with their extension chunks verbatim) and geometry chunks (verbatim bytes), and
 * write the same shape back. Geometry, material and atomic-extension bytes are never re-encoded — the
 * mod-installer principle — only the frame list, the HAnim plugins and the atomic indices are ours.
 *
 * Binary facts this file encodes were measured on the vanilla cutscene fleet (probe 2026-08-12, plan 002
 * step 2): clump struct is 12 B (atomics/lights/cameras), frame-list rows are 56 B, every frame gets an
 * Extension chunk (empty on the unnamed top frame), the HAnim hierarchy sits on the skeleton root with
 * `flags 0` / `keyFrameSize 36`, and the clump-level Extension of every vanilla cs model is EMPTY (no
 * embedded collision — a converted mod's COL3 is deliberately dropped).
 */
import {
  readRw,
  RW_CLUMP,
  RW_EXTENSION,
  RW_GEOMETRY,
  RW_GEOMETRY_LIST,
  RW_STRUCT,
  type RwChunk,
  writeRw,
} from '@opensa/rw-codec/chunk';

export const RW_ATOMIC = 0x14;
export const RW_FRAME_LIST = 0x0e;
export const RW_FRAME_NAME = 0x253f2fe;
export const RW_HANIM = 0x11e;

const FRAME_ROW_BYTES = 56;
const HANIM_VERSION = 0x100;
const HANIM_KEYFRAME_SIZE = 36;

export interface ClumpAtomic {
  /** The atomic's Extension chunk, verbatim (matfx flag / right-to-render / SA pipeline plugins). */
  extension: null | RwChunk;
  flags: number;
  frameIndex: number;
  geometryIndex: number;
}

export interface ClumpFrame {
  boneId?: number;
  /** Frame-list matrix-flags word (vanilla: `0x20003` on the top frame, `3` everywhere else). */
  flags: number;
  hierarchy?: HierarchyNode[];
  name: string;
  parentIndex: number;
  position: [number, number, number];
  rotation: number[];
}

export interface ClumpModel {
  atomics: ClumpAtomic[];
  frames: ClumpFrame[];
  /** Geometry chunks, verbatim — serialized back byte-for-byte. */
  geometries: RwChunk[];
  version: number;
}

/** One node row of the skeleton root's HAnim hierarchy table. */
export interface HierarchyNode {
  /** `2` = more siblings follow (push), `1` = leaf (pop), `3` = both, `0` = neither — measured rule,
   *  reproduced verbatim across all five vanilla cutscene rig styles. */
  flags: number;
  id: number;
  index: number;
}

/** Parse a DFF's clump into the editable model. Throws on a non-clump file. */
export function readClump(bytes: Uint8Array): ClumpModel {
  const clump = readRw(bytes).chunks.find((chunk) => chunk.type === RW_CLUMP);
  if (!clump?.children) {
    throw new Error('not a DFF: no clump chunk');
  }
  const frameList = clump.children.find((chunk) => chunk.type === RW_FRAME_LIST);
  const geometryList = clump.children.find((chunk) => chunk.type === RW_GEOMETRY_LIST);
  if (!frameList?.data || !geometryList?.children) {
    throw new Error('clump has no frame list / geometry list');
  }

  return {
    atomics: clump.children.filter((chunk) => chunk.type === RW_ATOMIC).map(readAtomic),
    frames: readFrames(frameList.data),
    geometries: geometryList.children.filter((chunk) => chunk.type === RW_GEOMETRY),
    version: clump.version,
  };
}

/** Serialize the model back to DFF bytes (clump-level Extension emitted EMPTY, like vanilla cs). */
export function writeClump(model: ClumpModel): Uint8Array {
  const children: RwChunk[] = [
    structChunk(clumpStructBody(model), model.version),
    frameListChunk(model),
    geometryListChunk(model),
    ...model.atomics.map((atomic) => atomicChunk(atomic, model.version)),
    { children: [], type: RW_EXTENSION, version: model.version },
  ];

  return writeRw({ chunks: [{ children, type: RW_CLUMP, version: model.version }], trailing: new Uint8Array(0) });
}

function atomicChunk(atomic: ClumpAtomic, version: number): RwChunk {
  const struct = new Uint8Array(16);
  const view = new DataView(struct.buffer);
  view.setUint32(0, atomic.frameIndex, true);
  view.setUint32(4, atomic.geometryIndex, true);
  view.setUint32(8, atomic.flags, true);
  const body = [
    chunkBytes(structChunk(struct, version)),
    chunkBytes(atomic.extension ?? { children: [], type: RW_EXTENSION, version }),
  ];

  return { data: concat(body), type: RW_ATOMIC, version };
}

function chunkBytes(chunk: RwChunk): Uint8Array {
  return writeRw({ chunks: [chunk], trailing: new Uint8Array(0) });
}

function clumpStructBody(model: ClumpModel): Uint8Array {
  const body = new Uint8Array(12);
  new DataView(body.buffer).setUint32(0, model.atomics.length, true);

  return body;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
}

function frameExtension(frame: ClumpFrame, version: number): RwChunk {
  const children: RwChunk[] = [];
  if (frame.boneId !== undefined) {
    children.push({ data: hanimBody(frame), type: RW_HANIM, version });
  }
  if (frame.name !== '') {
    children.push({ data: new TextEncoder().encode(frame.name), type: RW_FRAME_NAME, version });
  }

  return { children, type: RW_EXTENSION, version };
}

function frameListChunk(model: ClumpModel): RwChunk {
  const struct = new Uint8Array(4 + model.frames.length * FRAME_ROW_BYTES);
  const view = new DataView(struct.buffer);
  view.setUint32(0, model.frames.length, true);
  model.frames.forEach((frame, index) => {
    const base = 4 + index * FRAME_ROW_BYTES;
    frame.rotation.forEach((value, at) => view.setFloat32(base + at * 4, value, true));
    frame.position.forEach((value, at) => view.setFloat32(base + 36 + at * 4, value, true));
    view.setInt32(base + 48, frame.parentIndex, true);
    view.setUint32(base + 52, frame.flags, true);
  });
  const body = [
    chunkBytes(structChunk(struct, model.version)),
    ...model.frames.map((frame) => chunkBytes(frameExtension(frame, model.version))),
  ];

  return { data: concat(body), type: RW_FRAME_LIST, version: model.version };
}

function geometryListChunk(model: ClumpModel): RwChunk {
  const struct = new Uint8Array(4);
  new DataView(struct.buffer).setUint32(0, model.geometries.length, true);

  return {
    children: [structChunk(struct, model.version), ...model.geometries],
    type: RW_GEOMETRY_LIST,
    version: model.version,
  };
}

function hanimBody(frame: ClumpFrame): Uint8Array {
  const nodes = frame.hierarchy ?? [];
  const body = new Uint8Array(12 + (nodes.length > 0 ? 8 + nodes.length * 12 : 0));
  const view = new DataView(body.buffer);
  view.setUint32(0, HANIM_VERSION, true);
  view.setUint32(4, frame.boneId ?? 0, true);
  view.setUint32(8, nodes.length, true);
  if (nodes.length > 0) {
    view.setUint32(16, HANIM_KEYFRAME_SIZE, true);
    nodes.forEach((node, at) => {
      view.setUint32(20 + at * 12, node.id, true);
      view.setUint32(24 + at * 12, node.index, true);
      view.setUint32(28 + at * 12, node.flags, true);
    });
  }

  return body;
}

function readAtomic(chunk: RwChunk): ClumpAtomic {
  const body = readRw(chunk.data ?? new Uint8Array(0));
  const struct = body.chunks.find((child) => child.type === RW_STRUCT);
  if (!struct?.data || struct.data.length < 12) {
    throw new Error('atomic missing struct');
  }
  const view = new DataView(struct.data.buffer, struct.data.byteOffset, struct.data.byteLength);

  return {
    extension: body.chunks.find((child) => child.type === RW_EXTENSION) ?? null,
    flags: view.getUint32(8, true),
    frameIndex: view.getUint32(0, true),
    geometryIndex: view.getUint32(4, true),
  };
}

function readFramePlugins(extension: RwChunk, frame: ClumpFrame): void {
  for (const plugin of extension.children ?? []) {
    if (plugin.type === RW_FRAME_NAME && plugin.data) {
      frame.name = new TextDecoder().decode(plugin.data);
    }
    if (plugin.type === RW_HANIM && plugin.data && plugin.data.length >= 12) {
      readHAnim(plugin.data, frame);
    }
  }
}

function readFrames(frameListBody: Uint8Array): ClumpFrame[] {
  const body = readRw(frameListBody);
  const struct = body.chunks[0];
  if (struct?.type !== RW_STRUCT || !struct.data) {
    throw new Error('frame list missing struct');
  }
  const view = new DataView(struct.data.buffer, struct.data.byteOffset, struct.data.byteLength);
  const frames: ClumpFrame[] = [];
  for (let index = 0; index < view.getUint32(0, true); index++) {
    const base = 4 + index * FRAME_ROW_BYTES;
    frames.push({
      flags: view.getUint32(base + 52, true),
      name: '',
      parentIndex: view.getInt32(base + 48, true),
      position: [view.getFloat32(base + 36, true), view.getFloat32(base + 40, true), view.getFloat32(base + 44, true)],
      rotation: Array.from({ length: 9 }, (_, at) => view.getFloat32(base + at * 4, true)),
    });
  }
  body.chunks.slice(1).forEach((extension, index) => {
    const frame = frames[index];
    if (extension.type === RW_EXTENSION && frame) {
      readFramePlugins(extension, frame);
    }
  });

  return frames;
}

function readHAnim(data: Uint8Array, frame: ClumpFrame): void {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  frame.boneId = view.getUint32(4, true);
  const numNodes = view.getUint32(8, true);
  if (numNodes === 0) {
    return;
  }
  frame.hierarchy = Array.from({ length: numNodes }, (_, at) => ({
    flags: view.getUint32(28 + at * 12, true),
    id: view.getUint32(20 + at * 12, true),
    index: view.getUint32(24 + at * 12, true),
  }));
}

function structChunk(body: Uint8Array, version: number): RwChunk {
  return { data: body, type: RW_STRUCT, version };
}
