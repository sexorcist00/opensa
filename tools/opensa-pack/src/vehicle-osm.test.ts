/**
 * The `.osm` ROUND TRIP on a real car (opensa-pack 003 phase 3): opensa-pack writes it, the runtime's
 * `readVehicleOsm` reads it back. Writer and reader are in different packages and can only drift silently,
 * so the contract is pinned here, on a stock `admiral.dff`/`admiral.txd` rather than a hand-built blob —
 * the strides, the section split and the collision shape all come from the real asset.
 */
import type { AssetFileSystem } from '@opensa/renderware';

import { GtaSaWorldAdapter } from '@opensa/game/adapters/gta-sa-world.adapter';
import { readVehicleOsm } from '@opensa/game/adapters/vehicle-osm';
import { withModloader } from '@opensa/modloader';
import { parseDff, parseVehicleDefs } from '@opensa/renderware';
import { parseDffCollision } from '@opensa/renderware/parsers/binary/col';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildVehicleOsm } from './vehicle-osm';

const FIXTURES = join(process.cwd(), 'tests', 'original');

/** A committed real-asset fixture as a fresh ArrayBuffer. */
function fileOf(relative: string): ArrayBuffer {
  const data = readFileSync(join(FIXTURES, relative));

  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

const fs = fsFrom(
  new Map<string, ArrayBuffer>([
    ['admiral.dff', fileOf('vehicles/admiral.dff')],
    ['admiral.txd', fileOf('vehicles/admiral.txd')],
    ['models/generic/vehicle.txd', fileOf('models/generic/vehicle.txd')],
  ]),
);

/** Built ONCE: the real admiral takes seconds under coverage instrumentation, and rebuilding it per
 *  assertion pushed the file past vitest's per-test timeout (a flaky test is worse than no test). */
let cached: null | ReturnType<typeof buildVehicleOsm> = null;
const built = (): ReturnType<typeof buildVehicleOsm> =>
  (cached ??= buildVehicleOsm(fs, 'admiral', { wheelScale: [0.7, 0.7] }));

describe('readVehicleOsm', () => {
  describe('negative cases', () => {
    it('throws when a section is missing rather than returning a half-model', () => {
      const truncated = built().bytes.subarray(0, 16);

      expect(() => readVehicleOsm('admiral', truncated)).toThrow();
    });
  });

  describe('positive cases', () => {
    it('recovers the geometry the writer packed, buffer for buffer', () => {
      const source = built();
      const read = readVehicleOsm('admiral', source.bytes);
      const model = read.model;

      expect(model.vertexCount).toBe(source.fixture.vertexCount);
      expect(model.indexCount).toBe(source.fixture.indexCount);
      // The strides are the reader's own constants — if either side changes one, these lengths diverge.
      expect(model.positions.byteLength).toBe(model.vertexCount * 12);
      expect(model.normals.byteLength).toBe(model.vertexCount * 12);
      expect(model.uvs.byteLength).toBe(model.vertexCount * 8);
      expect(model.colors.byteLength).toBe(model.vertexCount * 4);
      expect(model.indices.byteLength).toBe(model.indexCount * 2);
    });

    it('carries the texture dictionary in the container, uncompressed by nobody', () => {
      const source = built();
      const read = readVehicleOsm('admiral', source.bytes);

      expect(read.model.textures[0].kind).toBe('ostex');
      expect(read.model.textures[0].kind === 'ostex' && read.model.textures[0].bytes).toEqual(source.ostex);
    });

    it('bakes the collision the runtime would otherwise parse at spawn', () => {
      const source = built();
      const read = readVehicleOsm('admiral', source.bytes);
      const col = parseDffCollision(fs.get('admiral.dff')!)!;

      expect(source.hasCollision).toBe(true);
      expect(read.colliders).not.toBeNull();
      expect(read.colliders?.shape.vertices).toEqual(col.vertices);
      expect(read.colliders?.shape.indices.length).toBe(col.faces.length * 3);
      expect(read.colliders?.shape.spheres.length).toBe(col.spheres.length);
    });

    it('keeps the articulation the handle animates (doors, wheels, submeshes)', () => {
      const source = built();
      const read = readVehicleOsm('admiral', source.bytes);

      expect(read.rig.submeshes).toEqual(source.fixture.submeshes);
      expect(read.rig.doors).toEqual(source.fixture.doors);
      expect(read.wheels.length).toBe(source.fixture.wheels.length);
      expect(read.wheels.every((wheel) => wheel.radius > 0)).toBe(true);
    });

    it('agrees with the unoptimized build it replaces — same vertices, same submeshes', () => {
      const source = built();
      const read = readVehicleOsm('admiral', source.bytes);
      const clump = parseDff(fs.get('admiral.dff')!);

      // The writer used the runtime's own builder, so a drift here means the FORMAT lost something.
      expect(clump.atomics.length).toBeGreaterThan(0);
      expect(read.model.parts.length).toBe(source.fixture.parts.length);
      expect(read.model.submeshes.length).toBe(source.fixture.submeshes.length);
    });

    it('carries the pop-up headlight pod through the format — the DESC is where it survives', () => {
      const zr350 = fsFrom(
        new Map<string, ArrayBuffer>([
          ['models/generic/vehicle.txd', fileOf('models/generic/vehicle.txd')],
          ['zr350.dff', fileOf('vehicles/zr350.dff')],
          ['zr350.txd', fileOf('vehicles/zr350.txd')],
        ]),
      );
      const source = buildVehicleOsm(zr350, 'zr350', { wheelScale: [0.7, 0.7] });

      const read = readVehicleOsm('zr350', source.bytes);

      expect(source.fixture.popUpLights).toBeDefined();
      expect(read.rig.popUpLights).toEqual(source.fixture.popUpLights);
      expect(read.rig.parts[read.rig.popUpLights!.part].name).toBe('misc_a');
    });

    it('carries the license-plate tags through the format (082/02)', () => {
      const read = readVehicleOsm('admiral', built().bytes);
      const plates = read.model.submeshes.filter((submesh) => submesh.plate);

      // After conversion the material NAME is gone and the texture layer is model-local, so this tag is
      // the only thing that can still say "this quad is a plate" — it has to survive the DESC round trip.
      expect(new Set(plates.map((submesh) => submesh.plate))).toEqual(new Set(['back', 'face']));
      expect(new Set(plates.map((submesh) => submesh.indexCount))).toEqual(new Set([6]));
    });
  });
});

/**
 * The phase-3 GATE, end-to-end through the real adapter: a converted build spawns a car with NO `.dff`
 * anywhere, and the two paths agree on everything the game consumes.
 *
 * This lives in opensa-pack rather than in `packages/game`'s own integration test because the test needs
 * the WRITER, and the nx boundary (`type:engine` may not depend on `type:tool`) forbids that direction —
 * correctly: the runtime must never reach for the converter.
 */
describe('a converted vehicle through GtaSaWorldAdapter', () => {
  describe('positive cases', () => {
    it('spawns from .osm/.ostex with no DFF present at all, matching the unoptimized load', async () => {
      const stock = await new GtaSaWorldAdapter({ cellSize: 250, fs: adapterFs() }).loadVehicleData('admiral');
      const converted = await new GtaSaWorldAdapter({ cellSize: 250, fs: adapterFs(true) }).loadVehicleData('admiral');

      expect(adapterFs(true).get('admiral.dff')).toBeNull(); // nothing a DFF parser could be handed
      expect(converted.model.textures[0].kind).toBe('ostex');
      expect(stock.model.textures[0].kind).toBe('rgba');
      // What the game actually consumes must be identical across the two paths.
      expect(converted.model.vertexCount).toBe(stock.model.vertexCount);
      expect(converted.model.indexCount).toBe(stock.model.indexCount);
      expect(converted.model.positions).toEqual(stock.model.positions);
      expect(converted.model.submeshes).toEqual(stock.model.submeshes);
      expect(converted.halfExtents).toEqual(stock.halfExtents);
      expect(converted.handling).toEqual(stock.handling);
      expect(converted.seat).toEqual(stock.seat);
      expect(converted.wheels).toEqual(stock.wheels);
      expect(converted.colliders?.shape.vertices).toEqual(stock.colliders?.shape.vertices);
    });

    it('lets a modloader DFF beat our .osm — the mod wins, as UNOPTIMIZED', async () => {
      const files = convertedFiles();
      files.set('modloader/mycar/admiral.dff', fileOf('vehicles/admiral.dff'));

      const fs = withModloader(fsFrom(files));
      const vehicle = await new GtaSaWorldAdapter({ cellSize: 250, fs }).loadVehicleData('admiral');

      expect(vehicle.model.textures[0].kind).toBe('rgba'); // parsed at runtime, not our baked atlas
    });

    it('takes the optimized side of a half-modded car and names the file it ignored', async () => {
      // The mixing rule: a retexture-only mod cannot be honoured, because `.osm` indexes its atlas by
      // baked layer index rather than by texture name.
      const files = convertedFiles();
      files.set('modloader/retexture/admiral.txd', fileOf('vehicles/admiral.txd'));
      const warnings: string[] = [];

      const fs = withModloader(fsFrom(files));
      const vehicle = await new GtaSaWorldAdapter({
        cellSize: 250,
        fs,
        onAssetWarning: (message): void => {
          warnings.push(message);
        },
      }).loadVehicleData('admiral');

      expect(vehicle.model.textures[0].kind).toBe('ostex');
      expect(warnings).toEqual(["ignoring modded admiral.txd — 'admiral' is an optimized model"]);
    });
  });
});

/** An adapter-ready file system: the stock fixture set, or the same set after conversion. */
function adapterFs(converted = false): AssetFileSystem {
  return fsFrom(converted ? convertedFiles() : baseFiles());
}

function baseFiles(): Map<string, ArrayBuffer> {
  return new Map<string, ArrayBuffer>([
    ['admiral.dff', fileOf('vehicles/admiral.dff')],
    ['admiral.txd', fileOf('vehicles/admiral.txd')],
    ['data/carcols.dat', fileOf('data/carcols.dat')],
    ['data/handling.cfg', fileOf('data/handling.cfg')],
    ['data/vehicles.ide', fileOf('data/vehicles.ide')],
    ['models/generic/vehicle.txd', fileOf('models/generic/vehicle.txd')],
  ]);
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** The archives as opensa-pack leaves them: the `.dff`/`.txd` deleted, the converted pair in their place. */
function convertedFiles(): Map<string, ArrayBuffer> {
  const files = baseFiles();
  // The def drives the build exactly as `packVehicles` does — hardcoding a wheelScale here made the two
  // paths disagree on wheel RADIUS, which is the test catching a fixture lie rather than a product bug.
  const def = parseVehicleDefs(new TextDecoder().decode(files.get('data/vehicles.ide'))).get('admiral')!;
  const osm = buildVehicleOsm(fsFrom(files), 'admiral', { txd: def.txd.toLowerCase(), wheelScale: def.wheelScale });
  files.delete('admiral.dff');
  files.delete('admiral.txd');
  files.set('admiral.osm', bufferOf(osm.bytes)); // the dictionary rides inside, in `TEXS`

  return files;
}

function fsFrom(files: Map<string, ArrayBuffer>): AssetFileSystem {
  return {
    get: (name: string): ArrayBuffer | null => files.get(name.toLowerCase()) ?? null,
    getText: (name: string): null | string => {
      const file = files.get(name.toLowerCase());

      return file ? new TextDecoder().decode(file) : null;
    },
    has: (name: string): boolean => files.has(name.toLowerCase()),
    names: [...files.keys()],
  };
}
