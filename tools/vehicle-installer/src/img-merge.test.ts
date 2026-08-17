import { createImg, openImg, writeImgFile } from '@opensa/tool-kit/archive/img';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sharedVehicleFiles, stageVehicleImg } from './img-merge';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vehicle-img-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** A vehicle folder with the given files, plus a settings file that must be ignored by the IMG merge. */
function vehicleFolder(files: Record<string, Uint8Array>): string {
  const folder = mkdtempSync(join(dir, 'alpha-'));
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(join(folder, name), bytes);
  }
  writeFileSync(join(folder, 'alpha.settings.txt'), 'not an asset');

  return folder;
}

describe('stageVehicleImg', () => {
  describe('negative cases', () => {
    it('returns no names and skips a folder with no dff/txd', () => {
      const folder = mkdtempSync(join(dir, 'empty-'));
      writeFileSync(join(folder, 'readme.txt'), 'x');
      expect(stageVehicleImg(folder, createImg())).toEqual([]);
    });

    it('stages WITHOUT writing — the caller owns the archive and writes it once', () => {
      // The whole point of the batch fix: one rebuild per run, not one per car. A stage that wrote would put
      // the 2 GiB ceiling back on every car.
      const imgPath = join(dir, 'gta3.img');
      const img = createImg();

      stageVehicleImg(vehicleFolder({ 'alpha.dff': Uint8Array.of(1) }), img);

      expect(img.has('alpha.dff')).toBe(true);
      expect(() => readFileSync(imgPath)).toThrow(); // nothing on disk yet
    });
  });

  describe('positive cases', () => {
    it('stages the dff + every txd (incl. extra numbered ones), ignoring the settings file', () => {
      const folder = vehicleFolder({
        'alpha1.txd': Uint8Array.of(3),
        'alpha2.txd': Uint8Array.of(4),
        'alpha.dff': Uint8Array.of(1),
        'alpha.txd': Uint8Array.of(2),
      });
      const imgPath = join(dir, 'gta3.img');
      const staged = createImg();

      expect(stageVehicleImg(folder, staged).sort()).toEqual(['alpha.dff', 'alpha.txd', 'alpha1.txd', 'alpha2.txd']);
      writeImgFile(staged, imgPath);

      const img = openImg(new Uint8Array(readFileSync(imgPath)));
      expect(img.has('alpha.dff')).toBe(true);
      expect(img.has('alpha.txd')).toBe(true);
      expect(img.has('alpha1.txd')).toBe(true);
      expect(img.has('alpha2.txd')).toBe(true);
      expect(img.has('alpha.settings.txt')).toBe(false);
    });

    it('replaces an existing entry by name, keeping the others', () => {
      const imgPath = join(dir, 'gta3.img');
      const base = createImg();
      base.set('alpha.dff', Uint8Array.of(9)); // stock
      base.set('stock.dff', Uint8Array.of(7));
      writeFileSync(imgPath, base.build());

      const staged = openImg(new Uint8Array(readFileSync(imgPath)));
      stageVehicleImg(vehicleFolder({ 'alpha.dff': Uint8Array.of(1) }), staged);
      writeImgFile(staged, imgPath);

      const img = openImg(new Uint8Array(readFileSync(imgPath)));
      expect(new Uint8Array(img.get('alpha.dff')!)[0]).toBe(1); // overridden (VER2 pads the rest of the sector)
      expect(img.has('stock.dff')).toBe(true); // preserved
    });

    it('reads a staged file only when the write pulls it — the mod set stays on disk', () => {
      // Staging N cars must cost N paths, not N buffers: the fix would otherwise trade 212 archive rewrites
      // for 3 GB of resident vehicle bytes.
      const folder = vehicleFolder({ 'alpha.dff': Uint8Array.of(1) });
      const img = createImg();
      stageVehicleImg(folder, img);
      writeFileSync(join(folder, 'alpha.dff'), Uint8Array.of(42)); // changed AFTER staging

      expect(new Uint8Array(img.get('alpha.dff')!)[0]).toBe(42);
    });
  });
});

describe('sharedVehicleFiles', () => {
  describe('negative cases', () => {
    it('reports nothing when every folder ships its own names, whatever the case', () => {
      const a = vehicleFolder({ 'alpha.dff': Uint8Array.of(1), 'Alpha.txd': Uint8Array.of(2) });
      const b = vehicleFolder({ 'beta.dff': Uint8Array.of(1), 'beta.txd': Uint8Array.of(2) });

      expect(
        sharedVehicleFiles([
          { folder: a, name: 'a' },
          { folder: b, name: 'b' },
        ]).size,
      ).toBe(0);
    });

    it('ignores the settings file and anything that is not a dff/txd', () => {
      const a = vehicleFolder({ 'readme.txt': Uint8Array.of(1) });
      const b = vehicleFolder({ 'readme.txt': Uint8Array.of(1) });

      expect(
        sharedVehicleFiles([
          { folder: a, name: 'a' },
          { folder: b, name: 'b' },
        ]).size,
      ).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('names a part two folders ship, owners in install order, matched case-insensitively', () => {
      // The voodoo re-uses the blade's `rbmp_lr_bl1` slot with its own geometry (2026-08-17).
      const blade = vehicleFolder({ 'blade.dff': Uint8Array.of(1), 'rbmp_lr_bl1.dff': Uint8Array.of(2) });
      const voodoo = vehicleFolder({ 'RBMP_LR_BL1.dff': Uint8Array.of(3), 'voodoo.dff': Uint8Array.of(1) });

      const shared = sharedVehicleFiles([
        { folder: blade, name: 'blade - x' },
        { folder: voodoo, name: 'voodoo - y' },
      ]);

      expect([...shared]).toEqual([['rbmp_lr_bl1.dff', ['blade - x', 'voodoo - y']]]);
    });
  });
});
