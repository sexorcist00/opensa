import { buildArchiveBuffer, openArchive } from '@opensa/renderware/archive/img-archive';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectImgEntries, combinedModelSource, swapFolder } from './build';

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

describe('collectImgEntries', () => {
  describe('negative cases', () => {
    it('emits only the shared lod_procobj.txd/col when there are no LODs or swaps', () => {
      const entries = collectImgEntries([], bytes(1), bytes(2), new Map(), new Map());

      expect([...entries.keys()].sort()).toEqual(['lod_procobj.col', 'lod_procobj.txd']);
      expect(entries.get('lod_procobj.txd')).toEqual(bytes(1));
      expect(entries.get('lod_procobj.col')).toEqual(bytes(2));
    });
  });

  describe('positive cases', () => {
    it('keys each LOD by `<alias>.dff` and includes the swapped HD DFFs + custom TXDs', () => {
      const lods = [
        { alias: 'lpo0', dff: bytes(10) },
        { alias: 'lodcedar1_po', dff: bytes(11) },
      ];
      const swap = new Map([['cedar1_po.dff', bytes(20)]]);
      const retxdTxds = new Map([['vegetation.txd', bytes(30)]]);

      const entries = collectImgEntries(lods, bytes(1), bytes(2), swap, retxdTxds);

      expect([...entries.keys()].sort()).toEqual([
        'cedar1_po.dff',
        'lod_procobj.col',
        'lod_procobj.txd',
        'lodcedar1_po.dff',
        'lpo0.dff',
        'vegetation.txd',
      ]);
      expect(entries.get('lpo0.dff')).toEqual(bytes(10));
      expect(entries.get('lodcedar1_po.dff')).toEqual(bytes(11));
      expect(entries.get('cedar1_po.dff')).toEqual(bytes(20));
      expect(entries.get('vegetation.txd')).toEqual(bytes(30));
    });
  });
});

const WASHER = 'tests/original/dff/building/washer.dff';
const BUSH = 'tests/original/world/sm_bush_large_1.dff';

describe.skipIf(!existsSync(WASHER) || !existsSync(BUSH))('combinedModelSource', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lod-procobj-modelsrc-'));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  describe('negative cases', () => {
    it('falls back to the archive for a model the pack does not ship (and null when nowhere)', () => {
      const archive = openArchive(
        buildArchiveBuffer([{ data: new Uint8Array(readFileSync(BUSH)), name: 'stockbush.dff' }]),
      );
      const source = combinedModelSource(dir, archive); // empty pack dir
      expect(source.load('stockbush')).not.toBeNull(); // archive fallback
      expect(source.load('ghost')).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('prefers the pack DFF over the archive model of the same name (the HD-swap source)', () => {
      // Pack ships `plant.dff` = washer geometry; the archive carries a DIFFERENT `plant.dff` (the bush).
      writeFileSync(join(dir, 'plant.dff'), readFileSync(WASHER));
      const archive = openArchive(
        buildArchiveBuffer([{ data: new Uint8Array(readFileSync(BUSH)), name: 'plant.dff' }]),
      );
      const source = combinedModelSource(dir, archive);

      const fromPack = source.load('plant')!;
      const stock = openArchive(buildArchiveBuffer([{ data: new Uint8Array(readFileSync(WASHER)), name: 'w.dff' }]));
      const washerVerts = combinedModelSource(dir, stock).load('w')!.geometries[0].positions.length;
      expect(fromPack.geometries[0].positions.length).toBe(washerVerts); // the pack's geometry, not the bush's
    });
  });
});

describe('swapFolder', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'procobj-swap-'));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  describe('negative cases', () => {
    it('treats an absent folder as no swap — pmb passes `<mods-src>/procobj` whether or not it exists', () => {
      expect(swapFolder(join(dir, 'nope'))).toBeUndefined();
    });

    it('treats a folder with no .dff as no swap', () => {
      writeFileSync(join(dir, 'readme.txt'), 'not a model');

      expect(swapFolder(dir)).toBeUndefined();
    });

    it('passes `undefined` straight through', () => {
      expect(swapFolder(undefined)).toBeUndefined();
    });
  });

  describe('positive cases', () => {
    it('keeps a folder that ships models', () => {
      writeFileSync(join(dir, 'plant.dff'), readFileSync(WASHER));

      expect(swapFolder(dir)).toBe(dir);
    });

    it('keeps a single-file pick', () => {
      const file = join(dir, 'plant.dff');
      writeFileSync(file, readFileSync(WASHER));

      expect(swapFolder(file)).toBe(file);
    });
  });
});
