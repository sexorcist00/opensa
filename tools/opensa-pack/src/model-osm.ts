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
import type { RWClump } from '@opensa/renderware/parsers/binary/types';
import type { VehicleFixture, VehicleModelData } from '@opensa/renderware/vehicle/types';

import { encodeOsm, encodeOsmTextures, type OsmSection, OsmSectionTag } from '@opensa/engine-formats';
import { parseDff } from '@opensa/renderware';
import { getTxdChain } from '@opensa/renderware/archive/asset-cache';
import { buildVehicleModel } from '@opensa/renderware/vehicle/build-vehicle-model';
import { VehicleTextures } from '@opensa/renderware/vehicle/textures';

import { packModelOstex } from './model-ostex';
import { planModelSlots, planModelTextures, remapModelLayers } from './model-textures';
import { type TexturePlanner } from './textures';

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
  /**
   * Sections beyond `DESC`/`GEOM`/`TEXS` — collision for a vehicle, a hull for a topple prop.
   *
   * The raw CLUMP is passed as well as the built model on purpose: a runtime consumer that walks the clump
   * (the topple hull does) must be baked from the clump, not from the built positions, or the two disagree
   * wherever the builder bakes a frame transform.
   */
  extraSections?: (built: VehicleModelData, dff: ArrayBuffer, clump: RWClump) => OsmSection[];
  /**
   * Plan the dictionary from the RAW TXD rather than from the builder's decoded array — what a MAP OBJECT
   * needs, because the builder dropped its mip chain (95 % of the modded map textures carry one). The result
   * is one array per (size, format, mip count), so the submeshes come out carrying an `array` index and
   * `meta` is remapped onto the planned layers.
   */
  rawDictionary?: { preferCutout?: boolean; txdParents: Map<string, string> };
  /**
   * Shared dictionaries appended AFTER the model's own, lowest priority — the vehicle path's generic set.
   * Ordinary map models have none.
   */
  sharedTxds?: readonly string[];
  /** The def's txd name; defaults to the model name, which is what stock SA uses for most assets. */
  txd?: string;
  /** `vehicles.ide` wheelScale as [front, rear]. */
  wheelScale?: readonly [number, number];
  /**
   * Plan into the SHARED WORLD dictionary instead of a private one — what a map object does. The submeshes
   * then carry GLOBAL array refs and the `.osm` gets no `TEXS` at all: the arrays it points into are the
   * ones the welded cells already ship, so a texture used by a hundred models is stored once, not a
   * hundred times (measured: 3 674 MB of per-model dictionaries vs 380 MB of geometry).
   */
  worldDictionary?: { planner: TexturePlanner; preferCutout?: boolean };
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

  const clump = parseDff(dff);
  const dictionary = new VehicleTextures(txds);
  const built = buildVehicleModel(clump, dictionary, {
    ...(options.wheelScale ? { wheelScale: options.wheelScale } : {}),
  });
  // The raw-TXD dictionary rewrites the per-vertex layers, so it must run BEFORE the fixture is packed —
  // and the per-submesh array must be read BEFORE the remap, while `meta` still holds builder layers.
  const planned = options.rawDictionary
    ? planModelTextures(
        fs,
        options.rawDictionary.txdParents,
        built.texture.names,
        options.txd ?? name,
        options.rawDictionary.preferCutout,
        dictionary.empty,
        name,
      )
    : null;
  const shared = options.worldDictionary
    ? planModelSlots(
        options.worldDictionary.planner,
        built.texture.names,
        options.txd ?? name,
        options.worldDictionary.preferCutout,
        dictionary.empty,
        name,
      )
    : null;
  const slots = planned?.slots ?? shared;
  const arrays = slots ? submeshArrays(name, built, slots) : null;
  if (slots) {
    remapModelLayers(built.meta, slots);
  }
  const { bin, fixture } = packVehicleFixture(name, built);
  if (arrays) {
    fixture.submeshes = fixture.submeshes.map((submesh, index) => ({ ...submesh, array: arrays[index] }));
  }
  if (shared) {
    // The arrays are the WORLD's, not this file's — the runtime must bind the streamed cell arrays rather
    // than look for a dictionary that is deliberately absent.
    fixture.textureSource = 'world';
  }
  // Without a raw dictionary the builder bucketed everything into ONE array, so `TEXS` carries a single
  // entry; peds and map objects are the classes whose textures disagree on size and need more.
  const ostex = shared ? new Uint8Array(0) : planned ? planned.arrays[0] : packModelOstex(built.texture);
  const sections: OsmSection[] = [
    { bytes: new TextEncoder().encode(JSON.stringify(fixture)), tag: OsmSectionTag.DESC },
    { bytes: bin, tag: OsmSectionTag.GEOM },
    ...(shared
      ? []
      : [{ bytes: encodeOsmTextures({ arrays: planned ? planned.arrays : [ostex] }), tag: OsmSectionTag.TEXS }]),
    ...(options.extraSections?.(built, dff, clump) ?? []),
  ];

  return {
    built,
    bytes: encodeOsm(sections),
    fixture,
    ostex,
    sections,
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
  const layout = { colors: 0, indices: 0, meta: 0, night: 0, normals: 0, positions: 0, reflect: 0, uvs: 0 };
  layout.positions = reserve(built.positions.byteLength);
  layout.normals = reserve(built.normals.byteLength);
  layout.uvs = reserve(built.uvs.byteLength);
  layout.colors = reserve(built.colors.byteLength);
  layout.meta = reserve(built.meta.byteLength);
  layout.night = reserve(built.night.byteLength);
  layout.reflect = reserve(built.reflect.byteLength);
  layout.indices = reserve(built.indices.byteLength);

  const bin = new Uint8Array(at);
  bin.set(bytesOf(built.positions), layout.positions);
  bin.set(bytesOf(built.normals), layout.normals);
  bin.set(bytesOf(built.uvs), layout.uvs);
  bin.set(built.colors, layout.colors);
  bin.set(built.meta, layout.meta);
  bin.set(built.night, layout.night);
  bin.set(built.reflect, layout.reflect);
  bin.set(bytesOf(built.indices), layout.indices);

  return {
    bin,
    fixture: {
      doors: [...built.doors],
      dummies: [...built.dummies],
      // The builder narrows the index array to the model (uint32 past 65 536 verts), so the width has to
      // travel with the fixture — the reader cannot infer it from a byte blob.
      index16: built.indices.BYTES_PER_ELEMENT === 2,
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

/**
 * Which texture ARRAY each submesh samples, read from the builder's per-vertex layers BEFORE they are
 * remapped. A submesh is one material, so every one of its vertices must land in the same array — and this
 * checks all of them rather than trusting the first: SA geometries do sometimes share a vertex between two
 * material groups, and the builder's last writer wins, which would leave a submesh straddling two arrays.
 * That model cannot be drawn by one bind group, so it throws and the caller falls back to the DFF.
 */
function submeshArrays(name: string, built: VehicleModelData, slots: readonly { array: number }[]): number[] {
  return built.submeshes.map((submesh) => {
    let array = -1;
    for (let at = submesh.indexOffset; at < submesh.indexOffset + submesh.indexCount; at += 1) {
      const slot = slots[built.meta[built.indices[at] * 4]];
      if (!slot) {
        throw new Error(`${name}: vertex layer ${built.meta[built.indices[at] * 4]} has no planned slot`);
      }
      if (array === -1) {
        array = slot.array;
      } else if (array !== slot.array) {
        throw new Error(`${name}: a submesh straddles texture arrays ${array} and ${slot.array}`);
      }
    }

    return array === -1 ? 0 : array;
  });
}
