/**
 * THE data-loss gate for the `.osm` conversion (plan opensa-pack/003 phase 5).
 *
 * Every other test proves a section round-trips. This one proves the CONVERSION does: for one real model
 * per asset class, what the runtime gets from a converted `.osm` must equal what it would have got from the
 * stock DFF/TXD — field by field, byte for byte, on the real assets. A converted build is very hard to
 * debug in-game, so a lost field has to fail here instead.
 *
 * The single deliberate exception is texture PIXELS: `.ostex` re-encodes to BC1/BC3, a measured ~1/255 mean
 * error (plan ledger, phase 2). Everything describing those textures — size, layer count, per-layer alpha
 * class and name — is still compared exactly.
 */
import type { AssetFileSystem } from '@opensa/renderware';

import { decodeOsm, decodeOsmSkeleton, decodeOstex, osmSection, OsmSectionTag } from '@opensa/engine-formats';
import { readPedOsm } from '@opensa/game/adapters/ped-osm';
import { toRigidModelInit } from '@opensa/game/adapters/vehicle-model-init';
import { readModelOsm } from '@opensa/game/adapters/vehicle-osm';
import { parseDff } from '@opensa/renderware';
import { getClump } from '@opensa/renderware/archive/asset-cache';
import { buildPedModel } from '@opensa/renderware/ped/build-ped-model';
import { buildVehicleModel } from '@opensa/renderware/vehicle/build-vehicle-model';
import { VehicleTextures } from '@opensa/renderware/vehicle/textures';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createModelBundles } from './model-bundle';
import { buildModelOsm } from './model-osm';
import { packAnimObjects } from './pack-anim-objects';
import { buildPedOsm } from './ped-osm';

/** The packers log a summary line; these tests do not care about it. */
const quiet = (): void => undefined;

const FIXTURES = join(process.cwd(), 'tests', 'original');

/** One real model per class, with the TXD its IDE row names. */
const MODELS = [
  { dff: 'vehicles/admiral.dff', kind: 'vehicle', model: 'admiral', txd: 'vehicles/admiral.txd', txdName: 'admiral' },
  {
    dff: 'dff/anim-clump/nt_noddonkbase.dff',
    kind: 'animated object',
    model: 'nt_noddonkbase',
    txd: 'dff/anim-clump/des_xoilfield.txd',
    txdName: 'des_xoilfield',
  },
  {
    dff: 'dff/topple/lamppost1.dff',
    kind: 'topple prop',
    model: 'lamppost1',
    txd: 'dff/topple/dynsigns.txd',
    txdName: 'dynsigns',
  },
  {
    dff: 'dff/breakable/binnt08_la.dff',
    kind: 'breakable',
    model: 'binnt08_la',
    txd: 'dff/breakable/labins01_la.txd',
    txdName: 'labins01_la',
  },
  {
    dff: 'dff/clutter/sjmcacti2.dff',
    kind: 'clutter species',
    model: 'sjmcacti2',
    txd: 'dff/clutter/gta_cactus.txd',
    txdName: 'gta_cactus',
  },
] as const;

function fileOf(relative: string): ArrayBuffer {
  const data = readFileSync(join(FIXTURES, relative));

  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

/** Both sides built ONCE per model — under coverage each build costs seconds, and rebuilding them per
 *  assertion is what pushes a file past vitest's per-test timeout. */
const conversions = new Map<
  string,
  { osm: ReturnType<typeof buildModelOsm>; stock: ReturnType<typeof buildVehicleModel> }
>();
function conversionOf(entry: (typeof MODELS)[number]): {
  osm: ReturnType<typeof buildModelOsm>;
  stock: ReturnType<typeof buildVehicleModel>;
} {
  let pair = conversions.get(entry.model);
  if (!pair) {
    const fs = fsFor(entry);
    pair = {
      osm: buildModelOsm(fs, entry.model, { txd: entry.txdName }),
      stock: buildVehicleModel(
        parseDff(fs.get(`${entry.model}.dff`)!),
        new VehicleTextures([fs.get(`${entry.txdName}.txd`)!]),
      ),
    };
    conversions.set(entry.model, pair);
  }

  return pair;
}

function fsFor(entry: (typeof MODELS)[number]): AssetFileSystem {
  const files = new Map<string, ArrayBuffer>([
    [`${entry.model}.dff`, fileOf(entry.dff)],
    [`${entry.txdName}.txd`, fileOf(entry.txd)],
  ]);

  return {
    get: (name: string): ArrayBuffer | null => files.get(name.toLowerCase()) ?? null,
    getText: () => null,
    has: (name: string): boolean => files.has(name.toLowerCase()),
    names: [...files.keys()],
  };
}

describe('the .osm conversion loses nothing', () => {
  describe('positive cases', () => {
    it.each(MODELS)('$kind: $model keeps every geometry buffer, byte for byte', (entry) => {
      const pair = conversionOf(entry);
      const stock = toRigidModelInit(pair.stock);

      const { model } = readModelOsm(entry.model, pair.osm.bytes);

      expect(model.vertexCount).toBe(stock.vertexCount);
      expect(model.indexCount).toBe(stock.indexCount);
      expect(model.positions).toEqual(stock.positions);
      expect(model.normals).toEqual(stock.normals);
      expect(model.uvs).toEqual(stock.uvs);
      expect(model.colors).toEqual(stock.colors);
      expect(model.meta).toEqual(stock.meta);
      expect(model.reflect).toEqual(stock.reflect);
      expect(model.indices).toEqual(stock.indices);
    });

    it.each(MODELS)(
      '$kind: $model keeps every structural field (parts, submeshes, doors, dummies, wheels)',
      (entry) => {
        const pair = conversionOf(entry);
        const stock = pair.stock;

        const { fixture } = readModelOsm(entry.model, pair.osm.bytes);

        expect(fixture.parts).toEqual(stock.parts);
        expect(fixture.submeshes).toEqual(stock.submeshes);
        expect(fixture.doors).toEqual(stock.doors);
        expect(fixture.dummies).toEqual(stock.dummies);
        expect(fixture.wheels).toEqual(stock.wheels);
      },
    );

    it.each(MODELS)('$kind: $model keeps the dictionary shape (pixels are BC, by design)', (entry) => {
      const pair = conversionOf(entry);
      const stock = pair.stock;

      const { model } = readModelOsm(entry.model, pair.osm.bytes);
      const dictionary = decodeOstex(model.textures[0].kind === 'ostex' ? model.textures[0].bytes : new Uint8Array());

      expect(dictionary.width).toBe(stock.texture.width);
      expect(dictionary.height).toBe(stock.texture.height);
      expect(dictionary.layers).toHaveLength(stock.texture.layers);
      // The layer INDEX is what `meta.x` addresses — a reordered dictionary silently retextures the model.
      expect(dictionary.layers).toHaveLength(stock.texture.names.length);
    });

    it('an animated object keeps its whole frame tree, verbatim — through the real packer', () => {
      const entry = MODELS[1];
      const fs = fsFor(entry);
      const bundles = createModelBundles();
      const defs = {
        catalog: new Map([
          [1, { anim: 'counxref', drawDistance: 300, flags: 0, id: 1, modelName: entry.model, txdName: entry.txdName }],
        ]),
      };

      const report = packAnimObjects(fs, defs, bundles, quiet);
      const insert = bundles.inserts().find((entry_) => entry_.name === `${entry.model}.osm`)!;
      const section = osmSection(decodeOsm(insert.bytes), OsmSectionTag.SKEL)!;
      const baked = decodeOsmSkeleton(section).frames;
      const raw = getClump(fs, entry.model).frames;

      expect(report.models).toBe(1);
      expect(baked).toHaveLength(raw.length);
      expect(baked).toEqual(
        raw.map((frame) => ({
          boneId: frame.boneId ?? -1,
          name: frame.name,
          parentIndex: frame.parentIndex,
          position: [frame.position[0], frame.position[1], frame.position[2]],
          rotation: [...frame.rotation],
        })),
      );
    });

    it('an animated object that another class already bundled gains ONLY its skeleton', () => {
      const entry = MODELS[1];
      const fs = fsFor(entry);
      const bundles = createModelBundles();
      const defs = {
        catalog: new Map([
          [1, { anim: 'counxref', drawDistance: 300, flags: 0, id: 1, modelName: entry.model, txdName: entry.txdName }],
        ]),
      };
      // Pretend the clutter/prop pass already contributed the rigid sections.
      bundles.add(entry.model, { sections: buildModelOsm(fs, entry.model, { txd: entry.txdName }).sections });

      expect(() => packAnimObjects(fs, defs, bundles, quiet)).not.toThrow();

      const insert = bundles.inserts().find((entry_) => entry_.name === `${entry.model}.osm`)!;
      const sections = decodeOsm(insert.bytes);
      expect(osmSection(sections, OsmSectionTag.SKEL)).not.toBeNull();
      expect(osmSection(sections, OsmSectionTag.GEOM)).not.toBeNull();
    });
  });
});

/**
 * The ped gate. A ped's `.osm` has its own shape (no colours/meta/reflect; joints, weights, a skin-order
 * skeleton with real inverse binds, a posed `minZ`), so it needs its own comparison against the builder.
 */
describe('the ped conversion loses nothing', () => {
  const MODEL = 'bmypol1';
  const TXD = 'bmypol1';

  const pedFs = (): AssetFileSystem => {
    const files = new Map<string, ArrayBuffer>([
      [`${MODEL}.dff`, fileOf('character/bmypol1.dff')],
      [`${TXD}.txd`, fileOf('character/bmypol1.txd')],
    ]);

    return {
      get: (name: string): ArrayBuffer | null => files.get(name.toLowerCase()) ?? null,
      getText: () => null,
      has: (name: string): boolean => files.has(name.toLowerCase()),
      names: [...files.keys()],
    };
  };

  describe('positive cases', () => {
    it('keeps every skinned buffer, byte for byte', () => {
      const fs = pedFs();
      const stock = buildPedModel(parseDff(fs.get(`${MODEL}.dff`)!), [fs.get(`${TXD}.txd`)!])!;

      const read = readPedOsm(MODEL, buildPedOsm(fs, MODEL, TXD).bytes);

      expect(read.fixture.vertexCount).toBe(stock.positions.length / 3);
      expect(read.fixture.indexCount).toBe(stock.indices.length);
      expect(new Float32Array(read.geometry.positions.slice().buffer)).toEqual(stock.positions);
      expect(new Float32Array(read.geometry.normals.slice().buffer)).toEqual(stock.normals);
      expect(new Float32Array(read.geometry.uvs.slice().buffer)).toEqual(stock.uvs);
      expect(new Uint16Array(read.geometry.indices.slice().buffer)).toEqual(stock.indices);
      expect(read.geometry.joints).toEqual(stock.joints);
      expect(read.geometry.weights).toEqual(stock.weights);
    });

    it('keeps the whole skeleton — skin order, parents, bone ids and inverse binds', () => {
      const fs = pedFs();
      const stock = buildPedModel(parseDff(fs.get(`${MODEL}.dff`)!), [fs.get(`${TXD}.txd`)!])!;

      const read = readPedOsm(MODEL, buildPedOsm(fs, MODEL, TXD).bytes);

      expect(read.fixture.bones).toEqual(stock.bones);
      expect(read.fixture.minZ).toBe(stock.minZ);
    });

    it('carries EVERY texture, resolving each submesh to an (array, layer) slot', () => {
      const fs = pedFs();
      const stock = buildPedModel(parseDff(fs.get(`${MODEL}.dff`)!), [fs.get(`${TXD}.txd`)!])!;

      const built = buildPedOsm(fs, MODEL, TXD);
      const read = readPedOsm(MODEL, built.bytes);
      const layers = read.textureArrays.reduce((sum, array) => sum + decodeOstex(array).layers.length, 0);

      // Not one texture lost, however much their sizes disagree.
      expect(layers).toBe(stock.textures.length);
      expect(read.fixture.submeshes).toHaveLength(stock.submeshes.length);
      read.fixture.submeshes.forEach((submesh, index) => {
        expect(submesh.indexCount).toBe(stock.submeshes[index].indexCount);
        expect(submesh.indexOffset).toBe(stock.submeshes[index].indexOffset);
        expect(submesh.texture).toBe(stock.submeshes[index].texture);
        expect(read.textureArrays[submesh.array]).toBeDefined();
        expect(decodeOstex(read.textureArrays[submesh.array]).layers.length).toBeGreaterThan(submesh.layer);
      });
    });
  });
});
