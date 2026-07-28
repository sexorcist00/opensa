import type * as Renderware from '@opensa/renderware';

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { GtaSaWorldAdapter } from './gta-sa-world.adapter';

/** Read a committed fixture as a fresh ArrayBuffer. */
function buffer(path: string): ArrayBuffer {
  const data = readFileSync(path);

  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

// Real pipeline end-to-end: keep every builder/parser real; only the map resolution is stubbed (one
// washer placement). Everything else is read from a fixture-backed AssetFileSystem passed in config.
vi.mock('@opensa/renderware', async (importActual) => {
  const actual = await importActual<typeof Renderware>();

  return {
    ...actual,
    resolveMap: (): Renderware.MapDefinitions => ({
      catalog: new Map([[1, { drawDistance: 300, flags: 0, id: 1, modelName: 'washer', txdName: 'junk' }]]),
      imgDirs: [],
      instances: [{ id: 1, interior: 0, lod: -1, modelName: 'washer', position: [10, 10, 0], rotation: [0, 0, 0, 1] }],
    }),
  };
});

/** The fixture-backed file map: bare model/txd names + loose data paths, as the build packs them. */
function baseFiles(): Map<string, ArrayBuffer | string> {
  return new Map<string, ArrayBuffer | string>([
    // Assets keyed by their BARE names only (no loose folders) — exactly how the build packs them.
    ['anim/ped.ifp', buffer('tests/original/dff/anim-clump/counxref.ifp')],
    ['bmypol1.dff', buffer('tests/original/character/bmypol1.dff')],
    ['bmypol1.txd', buffer('tests/original/character/bmypol1.txd')],
    ['data/carcols.dat', readFileSync('tests/original/data/carcols.dat', 'utf8')],
    ['data/handling.cfg', readFileSync('tests/original/data/handling.cfg', 'utf8')],
    ['data/peds.ide', readFileSync('tests/original/data/peds.ide', 'utf8')],
    ['data/timecyc.dat', readFileSync('tests/original/data/timecyc.dat', 'utf8')],
    ['data/vehicles.ide', readFileSync('tests/original/data/vehicles.ide', 'utf8')],
    ['junk.txd', buffer('tests/original/txd/junk.txd')],
    ['models/generic/vehicle.txd', buffer('tests/original/models/generic/vehicle.txd')],
    ['washer.dff', buffer('tests/original/dff/building/washer.dff')],
  ]);
}

function cfg(): ConstructorParameters<typeof GtaSaWorldAdapter>[0] {
  return { cellSize: 250, fs: fakeFs() };
}

function fakeFs(): Renderware.AssetFileSystem {
  return fsFrom(baseFiles());
}

/** Wrap a fixture file map as an AssetFileSystem (case-insensitive keys). */
function fsFrom(files: Map<string, ArrayBuffer | string>): Renderware.AssetFileSystem {
  return {
    get(name: string): ArrayBuffer | null {
      const file = files.get(name.toLowerCase());
      if (file === undefined) {
        return null;
      }

      return typeof file === 'string' ? new TextEncoder().encode(file).buffer : file;
    },
    getText(name: string): null | string {
      const file = files.get(name.toLowerCase());

      return typeof file === 'string' ? file : null;
    },
    has: (name: string): boolean => files.has(name.toLowerCase()),
    names: [...files.keys()],
  };
}

describe('GtaSaWorldAdapter integration', () => {
  describe('positive cases', () => {
    // First in the file on purpose: the renderware parse caches are module-level, and this test
    // needs the cell's model to be UNCACHED so the preparse path actually sends it to the parser.

    it('loads the timecyc as 24h weather table from the real timecyc.dat', async () => {
      const result = await new GtaSaWorldAdapter(cfg()).loadTimecyc();
      expect(result.weathers).toHaveLength(21);
      expect(result.weathers[0].name).toBe('EXTRASUNNY_LA');
      expect(result.weathers[0].hours).toHaveLength(24);
    });

    it('loads from an authored timecyc_24h.dat with NO vanilla timecyc.dat present', async () => {
      // Dropping the mandatory file proves the 24h branch is taken (it throws otherwise), and the
      // result matches the conversion of the vanilla file — the shipped 24h fixture IS that conversion.
      const files = baseFiles();
      files.set('data/timecyc_24h.dat', readFileSync('tests/original/data/timecyc_24h.dat', 'utf8'));
      const converted = await new GtaSaWorldAdapter(cfg()).loadTimecyc();
      files.delete('data/timecyc.dat');

      const authored = await new GtaSaWorldAdapter({ cellSize: 250, fs: fsFrom(files) }).loadTimecyc();

      expect(authored.weathers[0].hours).toHaveLength(24);
      expect(authored.weathers[0].hours).toEqual(converted.weathers[0].hours);
    });
  });
});
