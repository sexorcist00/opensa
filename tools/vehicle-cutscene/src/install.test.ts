import { createImg, openImg, writeImgFile } from '@opensa/tool-kit/archive/img';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installCutscene } from './install';
import { readClump } from './rig/clump-io';

const CS_BOBCAT = new Uint8Array(readFileSync('tests/original/dff/cutscene/csbobcat92.dff'));
const BOBCAT = new Uint8Array(readFileSync('tests/original/dff/cutscene/bobcat.dff'));

const VEHICLES_IDE = [
  'cars',
  '422, bobcat, bobcat, car, BOBCAT, BOBCAT, null, worker, 10, 0, 0, -1, 0.7, 0.7, 0',
  '510, mtbike, mtbike, bmx, MTB, MTBIKE, mtb, bicycle, 7, 0, 0, 23, 0.68, 0.68, -1',
  '597, copcarsf, copcarsf, car, POLICE_SF, POLICAR, null, ignore, 10, 0, 0, -1, 0.7, 0.7, -1',
  'end',
].join('\n');

/** The stock file's shape, R*'s `csopcarla` typo row included. */
const TXDCUT_IDE = ['txdp', 'csopcarla, copcarla', 'csbobcat92, bobcat', 'csmtbike92, mtbike', 'end'].join('\n');

let dir: string;
let gamePath: string;
let inPath: string;
let outPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vehicle-cutscene-install-'));
  gamePath = join(dir, 'game');
  inPath = join(dir, 'mods');
  outPath = join(dir, 'out');

  mkdirSync(join(gamePath, 'data'), { recursive: true });
  mkdirSync(join(gamePath, 'models'), { recursive: true });
  writeFileSync(join(gamePath, 'data', 'vehicles.ide'), VEHICLES_IDE);
  writeFileSync(join(gamePath, 'data', 'txdcut.ide'), TXDCUT_IDE);
  const img = createImg();
  img.set('csbobcat92.dff', CS_BOBCAT);
  img.set('csbobcat92.txd', new Uint8Array(16));
  img.set('csmtbike92.dff', new Uint8Array(8));
  img.set('csmtbike92.txd', new Uint8Array(8));
  img.set('cscopcarsf.dff', CS_BOBCAT); // stands in for the SFPD cutscene rig
  img.set('cscopcarsf.txd', new Uint8Array(8));
  img.set('csbarrel.dff', new Uint8Array(8)); // a prop the tool must leave alone
  writeImgFile(img, join(gamePath, 'models', 'cutscene.img'));

  mkdirSync(join(inPath, 'bobcat - some truck - author'), { recursive: true });
  writeFileSync(join(inPath, 'bobcat - some truck - author', 'bobcat.dff'), BOBCAT);
  writeFileSync(join(inPath, 'bobcat - some truck - author', 'bobcat.txd'), new Uint8Array(16));
  mkdirSync(join(inPath, 'mtbike - a bike - author'), { recursive: true });
  writeFileSync(join(inPath, 'mtbike - a bike - author', 'mtbike.dff'), new Uint8Array(8));
  writeFileSync(join(inPath, 'mtbike - a bike - author', 'mtbike.txd'), new Uint8Array(8));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe('installCutscene', () => {
  describe('negative cases', () => {
    it('refuses an --out that equals --game', () => {
      expect(() => installCutscene({ gamePath, inPath, outPath: gamePath })).toThrow('--out must differ');
    });

    it('collects a conversion error instead of aborting the run', () => {
      writeFileSync(join(inPath, 'bobcat - some truck - author', 'bobcat.dff'), new Uint8Array([1, 2, 3]));
      const summary = installCutscene({ gamePath, inPath, outPath });
      expect(summary.converted).toEqual([]);
      expect(summary.errors).toHaveLength(1);
      expect(summary.errors[0].csName).toBe('csbobcat92');
      expect(summary.errors[0].message).toContain('not a DFF');
    });
  });

  describe('positive cases', () => {
    it('converts the ready car, skips the pending branches, leaves props alone', () => {
      const summary = installCutscene({ gamePath, inPath, outPath });

      expect(summary.converted).toEqual(['csbobcat92']);
      expect(summary.skipped).toEqual([
        { csName: 'cscopcarsf', reason: 'no mod' },
        { csName: 'csmtbike92', reason: 'bike branch pending (plan 002 step 8/9)' },
      ]);
      expect(summary.errors).toEqual([]);

      const img = openImg(new Uint8Array(readFileSync(join(outPath, 'models', 'cutscene.img'))));
      const converted = readClump(img.get('csbobcat92.dff')!);
      expect(converted.frames[1].name).toBe('bobcat_dummy');
      expect(converted.geometries).toHaveLength(12); // rebuilt (shared wheel, adopted glass), not copied
      // IMG VER2 pads entries to 2 048-byte sectors — presence + one-sector size says "untouched".
      expect(img.get('csbarrel.dff')?.byteLength).toBe(2048);
      expect(img.get('csbobcat92.txd')?.byteLength).toBe(2048); // vanilla TXDs stay until step 6
    });

    it('patches txdcut.ide: fixes the csopcarla typo, appends the rows R* left out', () => {
      installCutscene({ gamePath, inPath, outPath });
      const text = readFileSync(join(outPath, 'data', 'txdcut.ide'), 'utf8');
      expect(text).toContain('cscopcarla, copcarla');
      expect(text).not.toMatch(/^csopcarla,/m);
      expect(text).toContain('cscopcarsf, copcarsf');
      expect(text.trim().endsWith('end')).toBe(true);
    });

    it('honours --only, converting nothing else', () => {
      const summary = installCutscene({ gamePath, inPath, only: new Set(['mtbike']), outPath });
      expect(summary.converted).toEqual([]);
      expect(summary.skipped).toHaveLength(1);
      const img = openImg(new Uint8Array(readFileSync(join(outPath, 'models', 'cutscene.img'))));
      expect(img.get('csbobcat92.dff')).toHaveLength(CS_BOBCAT.length); // untouched
    });
  });
});
