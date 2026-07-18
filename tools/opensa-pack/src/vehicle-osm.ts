/**
 * Vehicle → `.osm` (plan opensa-pack/003 phase 2). The OPTIMIZED half of the optimized/unoptimized split:
 * everything the game currently does at SPAWN time — parse the DFF, build the model, walk the chunk tree
 * for the embedded COL, map faces into indices, derive half-extents — happens here instead, once, offline.
 *
 * The builder is the SAME code the runtime uses (`buildVehicleModel`, browser-and-node callable), so the
 * optimized asset cannot drift from what the unoptimized path would have produced.
 *
 * Textures are NOT packed here: a model's dictionary is a `.ostex` beside it in the archive.
 */
import type { AssetFileSystem } from '@opensa/renderware/archive/asset-fs';
import type { VehicleFixture, VehicleModelData } from '@opensa/renderware/vehicle/types';

import { encodeOsm, encodeOsmCollision, type OsmCollision, OsmSectionTag } from '@opensa/engine-formats';
import { parseDff } from '@opensa/renderware';
import { parseDffCollision } from '@opensa/renderware/parsers/binary/col';
import { buildVehicleModel } from '@opensa/renderware/vehicle/build-vehicle-model';
import { VehicleTextures } from '@opensa/renderware/vehicle/textures';

/** Half-extents when a DFF carries no collision — the runtime's own fallback (`gta-sa-world.adapter.ts`). */
const DEFAULT_HALF_EXTENTS: [number, number, number] = [1.2, 2.5, 0.7];

export interface VehicleOsm {
  /** The `.osm` bytes: `DESC` (fixture JSON) + `GEOM` (buffers) + `COLL` (baked collision). */
  bytes: Uint8Array;
  fixture: VehicleFixture;
  /** True when the source DFF carried collision (false = the fallback box was baked). */
  hasCollision: boolean;
  texture: VehicleModelData['texture'];
}

export interface VehicleOsmOptions {
  /** `vehicles.ide` wheelScale as [front, rear]. */
  wheelScale?: readonly [number, number];
}

/** Build one vehicle's `.osm` from the game archives. Throws when the model is absent. */
export function buildVehicleOsm(fs: AssetFileSystem, model: string, options: VehicleOsmOptions = {}): VehicleOsm {
  const name = model.toLowerCase();
  const dff = fs.get(`${name}.dff`);
  if (!dff) {
    throw new Error(`${name}.dff not found`);
  }
  // The runtime's own chain: the model's own dict, then the shared generic set.
  const txds = [`${name}.txd`, 'vehicle.txd', 'models/generic/vehicle.txd']
    .map((txd) => fs.get(txd))
    .filter((bytes): bytes is ArrayBuffer => bytes !== null && bytes !== undefined);

  const built = buildVehicleModel(parseDff(dff), new VehicleTextures(txds), {
    ...(options.wheelScale ? { wheelScale: options.wheelScale } : {}),
  });
  const { bin, fixture } = packVehicleFixture(name, built);
  const collision = collisionOf(dff);

  return {
    bytes: encodeOsm([
      { bytes: new TextEncoder().encode(JSON.stringify(fixture)), tag: OsmSectionTag.DESC },
      { bytes: bin, tag: OsmSectionTag.GEOM },
      { bytes: encodeOsmCollision(collision.collision), tag: OsmSectionTag.COLL },
    ]),
    fixture,
    hasCollision: collision.present,
    texture: built.texture,
  };
}

/**
 * Pack a built model into the fixture pair (JSON header + one binary blob of typed sections) — the layout
 * the lab's `vehicle.json`/`vehicle.bin` already use, so `DESC`/`GEOM` need no second convention.
 *
 * Textures are excluded: they leave as a `.ostex`.
 */
export function packVehicleFixture(
  name: string,
  built: VehicleModelData,
): { bin: Uint8Array; fixture: VehicleFixture } {
  const align4 = (value: number): number => Math.ceil(value / 4) * 4;
  let at = 0;
  const reserve = (bytes: number): number => {
    const offset = at;
    at = align4(at + bytes);

    return offset;
  };
  const layout = { colors: 0, indices: 0, meta: 0, normals: 0, positions: 0, reflect: 0, uvs: 0 };
  layout.positions = reserve(built.positions.byteLength);
  layout.normals = reserve(built.normals.byteLength);
  layout.uvs = reserve(built.uvs.byteLength);
  layout.colors = reserve(built.colors.byteLength);
  layout.meta = reserve(built.meta.byteLength);
  layout.reflect = reserve(built.reflect.byteLength);
  layout.indices = reserve(built.indices.byteLength);

  const bin = new Uint8Array(at);
  bin.set(bytesOf(built.positions), layout.positions);
  bin.set(bytesOf(built.normals), layout.normals);
  bin.set(bytesOf(built.uvs), layout.uvs);
  bin.set(built.colors, layout.colors);
  bin.set(built.meta, layout.meta);
  bin.set(built.reflect, layout.reflect);
  bin.set(bytesOf(built.indices), layout.indices);

  return {
    bin,
    fixture: {
      doors: [...built.doors],
      dummies: [...built.dummies],
      indexCount: built.indices.length,
      layout,
      name,
      parts: [...built.parts],
      submeshes: [...built.submeshes],
      textures: {
        height: built.texture.height,
        names: built.texture.names,
        offset: 0, // the layers live in the sibling `.ostex`, not in GEOM
        width: built.texture.width,
      },
      vertexCount: built.positions.length / 3,
      wheels: [...built.wheels],
    },
  };
}

function bytesOf(array: Float32Array | Uint16Array | Uint32Array): Uint8Array {
  return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
}

/** The embedded COL, mapped into the engine's collider shape — or the fallback box when there is none. */
function collisionOf(dff: ArrayBuffer): { collision: OsmCollision; present: boolean } {
  const col = parseDffCollision(dff);
  if (!col) {
    return {
      collision: {
        boxes: [],
        halfExtents: DEFAULT_HALF_EXTENTS,
        indices: new Uint32Array(0),
        spheres: [],
        vertices: new Float32Array(0),
      },
      present: false,
    };
  }

  const indices = new Uint32Array(col.faces.length * 3);
  col.faces.forEach((face, index) => {
    indices[index * 3] = face.a;
    indices[index * 3 + 1] = face.b;
    indices[index * 3 + 2] = face.c;
  });

  return {
    collision: {
      boxes: col.boxes.map((box) => ({ max: box.max, min: box.min })),
      halfExtents: [
        Math.max(Math.abs(col.bounds.min[0]), Math.abs(col.bounds.max[0])),
        Math.max(Math.abs(col.bounds.min[1]), Math.abs(col.bounds.max[1])),
        Math.max(Math.abs(col.bounds.min[2]), Math.abs(col.bounds.max[2])),
      ],
      indices,
      spheres: col.spheres.map((sphere) => ({ center: sphere.center, radius: sphere.radius })),
      vertices: col.vertices,
    },
    present: true,
  };
}
