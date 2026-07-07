import { createImg, openImg } from '@opensa/tool-kit/archive/img';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mergeImgDir } from './img-merge';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mod-installer-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** Write a loose IMG folder with the given `name → bytes` entries; returns its path. */
function imgDir(entries: Record<string, Uint8Array>): string {
  const path = join(dir, 'gta3_img');
  mkdirSync(path, { recursive: true });
  for (const [name, bytes] of Object.entries(entries)) {
    writeFileSync(join(path, name), bytes);
  }

  return path;
}

describe('mergeImgDir', () => {
  describe('negative cases', () => {
    it('does nothing for an empty IMG folder', () => {
      const path = join(dir, 'gta3_img');
      mkdirSync(path, { recursive: true });

      expect(mergeImgDir(path, join(dir, 'models', 'gta3.img'))).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('seeds a fresh archive when the target img does not exist', () => {
      const imgPath = join(dir, 'models', 'gta3.img');
      const merged = mergeImgDir(imgDir({ 'a.dff': Uint8Array.from([1, 2, 3, 4]) }), imgPath);

      const img = openImg(new Uint8Array(readFileSync(imgPath)));
      expect(merged).toBe(1);
      expect(img.has('a.dff')).toBe(true);
      // IMG VER2 pads entries to 2048-byte sectors, so compare the leading bytes.
      expect([...img.get('a.dff')!.slice(0, 4)]).toEqual([1, 2, 3, 4]);
    });

    it('replaces an existing entry by name and keeps the others', () => {
      const imgPath = join(dir, 'gta3.img');
      const base = createImg();
      base.set('a.dff', Uint8Array.from([9, 9]));
      base.set('keep.dff', Uint8Array.from([7]));
      writeFileSync(imgPath, base.build());

      mergeImgDir(imgDir({ 'a.dff': Uint8Array.from([1, 1, 1, 1]) }), imgPath);

      const img = openImg(new Uint8Array(readFileSync(imgPath)));
      expect([...img.get('a.dff')!.slice(0, 4)]).toEqual([1, 1, 1, 1]); // replaced
      expect(img.has('keep.dff')).toBe(true); // untouched
    });

    it('deletes entries named in a "Remove original/" subfolder (contents irrelevant), warning on absentees', () => {
      const imgPath = join(dir, 'gta3.img');
      const base = createImg();
      base.set('ferris01_law2.dff', Uint8Array.from([9]));
      base.set('keep.dff', Uint8Array.from([7]));
      writeFileSync(imgPath, base.build());

      const path = imgDir({ 'ferriswheel_wheel.dff': Uint8Array.from([1]) });
      mkdirSync(join(path, 'Remove original'));
      writeFileSync(join(path, 'Remove original', 'ferris01_LAw2.dff'), Uint8Array.from([9])); // old copy, ignored
      writeFileSync(join(path, 'Remove original', 'ghost.dff'), Uint8Array.from([0])); // not in the img → warns

      const applied = mergeImgDir(path, imgPath);

      const img = openImg(new Uint8Array(readFileSync(imgPath)));
      expect(applied).toBe(3); // 1 add + 2 removal ops
      expect(img.has('ferris01_law2.dff')).toBe(false); // retired
      expect(img.has('ferriswheel_wheel.dff')).toBe(true); // added
      expect(img.has('keep.dff')).toBe(true); // untouched
    });
  });
});
