/**
 * Any rigid model → `.osm` + a sibling `.ostex` (plan opensa-pack/003 phase 5).
 *
 * Vehicles, clutter species, topple props and animated objects all reach the engine the same way at
 * runtime: `getClump` → `buildVehicleModel` → an upload. So they all bake the same way here, and the classes
 * differ only in which EXTRA sections ride along — collision for a vehicle, `SHAT` for a breakable, a
 * skeleton for an animated object.
 *
 * The builder is the runtime's own (`buildVehicleModel`), so an optimized asset cannot drift from what the
 * unoptimized path would have produced.
 */
import type { AssetFileSystem } from '@opensa/renderware/archive/asset-fs';
import type { VehicleFixture, VehicleModelData } from '@opensa/renderware/vehicle/types';

import { encodeOsm, type OsmSection, OsmSectionTag } from '@opensa/engine-formats';
import { parseDff } from '@opensa/renderware';
import { getTxdChain } from '@opensa/renderware/archive/asset-cache';
import { buildVehicleModel } from '@opensa/renderware/vehicle/build-vehicle-model';
import { VehicleTextures } from '@opensa/renderware/vehicle/textures';

import { packModelOstex } from './model-ostex';

export interface ModelOsm {
  built: VehicleModelData;
  /** The `.osm` bytes: `DESC` + `GEOM`, plus whatever `extraSections` the caller added. */
  bytes: Uint8Array;
  fixture: VehicleFixture;
  /** The model's dictionary (`.ostex` payload) — carried as the `TEXS` SECTION, not a sibling file. */
  ostex: Uint8Array;
  /** The sections themselves, so a caller can MERGE them with another class's for the same model. */
  sections: OsmSection[];
}

export interface ModelOsmOptions {
  /** Sections beyond `DESC`/`GEOM` — collision for a vehicle, a skeleton for an animated object. */
  extraSections?: (built: VehicleModelData, dff: ArrayBuffer) => OsmSection[];
  /**
   * Shared dictionaries appended AFTER the model's own, lowest priority — the vehicle path's generic set.
   * Ordinary map models have none.
   */
  sharedTxds?: readonly string[];
  /** The def's txd name; defaults to the model name, which is what stock SA uses for most assets. */
  txd?: string;
  /** `vehicles.ide` wheelScale as [front, rear]. */
  wheelScale?: readonly [number, number];
}

/** Build one model's `.osm`. Throws when the DFF is absent — the caller decides whether that is fatal. */
export function buildModelOsm(fs: AssetFileSystem, model: string, options: ModelOsmOptions = {}): ModelOsm {
  const name = model.toLowerCase();
  const dff = fs.get(`${name}.dff`);
  if (!dff) {
    throw new Error(`${name}.dff not found`);
  }
  // The model's own dictionary AND its `txdp` ancestors, then any shared sets — highest priority first,
  // which is exactly how `VehicleTextures` merges.
  const txds = [
    ...getTxdChain(fs, options.txd ?? name),
    ...(options.sharedTxds ?? [])
      .map((shared) => fs.get(shared))
      .filter((bytes): bytes is ArrayBuffer => bytes !== null && bytes !== undefined),
  ];

  const built = buildVehicleModel(parseDff(dff), new VehicleTextures(txds), {
    ...(options.wheelScale ? { wheelScale: options.wheelScale } : {}),
  });
  const { bin, fixture } = packVehicleFixture(name, built);
  const ostex = packModelOstex(built.texture);
  const sections: OsmSection[] = [
    { bytes: new TextEncoder().encode(JSON.stringify(fixture)), tag: OsmSectionTag.DESC },
    { bytes: bin, tag: OsmSectionTag.GEOM },
    { bytes: ostex, tag: OsmSectionTag.TEXS },
    ...(options.extraSections?.(built, dff) ?? []),
  ];

  return { built, bytes: encodeOsm(sections), fixture, ostex, sections };
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
