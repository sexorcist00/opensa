import { buildArchiveBuffer, openArchive } from '@opensa/renderware/archive/img-archive';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectImgEntries, combinedModelSource, layerCostLine, swapFolder } from './build';

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

describe('collectImgEntries', () => {
  describe('negative cases', () => {
    it('emits NOTHING when there is no HD swap — the layer ships no assets of its own (plan 014)', () => {
      // Before 014 this returned the shared `lod_procobj.txd`/`.col` even with no species: the LOD twin is gone,
      // so the placement layer adds text rows and a raised draw distance, and touches gta3.img only to swap HD.
      expect(collectImgEntries(new Map(), new Map()).size).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('carries the swapped HD DFFs and the TXDs their retxd produced', () => {
      const swap = new Map([['cedar1_po.dff', bytes(20)]]);
      const retxdTxds = new Map([['vegetation.txd', bytes(30)]]);

      const entries = collectImgEntries(swap, retxdTxds);

      expect([...entries.keys()].sort()).toEqual(['cedar1_po.dff', 'vegetation.txd']);
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

describe('layerCostLine', () => {
  describe('negative cases', () => {
    it('reports no price when nothing was converted (a TC with no matching species)', () => {
      expect(layerCostLine('sa', 1, null)).toBeNull();
    });

    it('does not divide by zero when the layer placed nothing', () => {
      expect(layerCostLine('sa', 1, { objects: 0, rows: 0 })).toContain('0.000 rows/object');
    });
  });

  describe('positive cases', () => {
    it('names the int16 budget the permanent rows are spent on for the sa host', () => {
      const line = layerCostLine('sa', 1, { objects: 15286, rows: 6487 });

      expect(line).toContain('15286 objects · 6487 permanent text rows · 0.424 rows/object');
      expect(line).toMatch(/int16/);
    });

    it('reports the same price for opensa but no row ceiling with it', () => {
      const line = layerCostLine('opensa', 1, { objects: 15286, rows: 6487 });

      expect(line).toContain('0.424 rows/object');
      expect(line).not.toMatch(/int16/);
      expect(line).toContain('no SA row ceiling');
    });

    it('states the density it was built at, so a capture is not identified by memory', () => {
      expect(layerCostLine('opensa', 2.5, { objects: 10, rows: 4 })).toContain('density 2.5');
    });

    it('says CAP DROPPED when procObjMax bound — a capped run measures the cap, not the density', () => {
      const line = layerCostLine('opensa', 3, { dropped: 812, objects: 20000, rows: 8000 });

      expect(line).toContain('CAP DROPPED 812');
      expect(line).toMatch(/procObjMax binds/);
    });

    it('says nothing about the cap when it did not bind', () => {
      expect(layerCostLine('opensa', 1, { dropped: 0, objects: 10, rows: 4 })).not.toMatch(/CAP DROPPED/);
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
