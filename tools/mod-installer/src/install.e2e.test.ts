import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { createImg, openImg } from '@opensa/tool-kit/archive/img';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { install } from './install';
import { pngToTextureNative } from './png-texture';
import { buildTxd, encodePng, solidRgba } from './test-utils';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mod-installer-e2e-'));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

function write(path: string, content: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

describe('install (end-to-end)', () => {
  describe('negative cases', () => {
    it('fails the install when a *.merge target does not exist', () => {
      const game = join(root, 'game');
      const mods = join(root, 'mods');
      const out = join(root, 'out');

      write(join(game, 'data', 'stub.txt'), 'base');
      write(join(mods, 'a_mod', 'data', 'missing.ide.merge'), 'add to "objs":\n1, a, b, 100, 0\n');

      expect(() => install({ gamePath: game, inPath: mods, outPath: out })).toThrow(/\.merge target does not exist/);
    });
  });

  describe('positive cases', () => {
    it('copies the base, overlays mods alphabetically, and merges gta3_img into gta3.img', () => {
      const game = join(root, 'game');
      const mods = join(root, 'mods');
      const out = join(root, 'out');

      // Base game: two data files + a gta3.img with one entry.
      write(join(game, 'data', 'keep.txt'), 'base');
      write(join(game, 'data', 'conf.txt'), 'base');
      const baseImg = createImg();
      baseImg.set('base.dff', Uint8Array.from([1]));
      write(join(game, 'models', 'gta3.img'), baseImg.build());

      // a_mod (applied first): a new file, a conf override, and a gta3_img entry.
      write(join(mods, 'a_mod', 'data', 'new.txt'), 'a-new');
      write(join(mods, 'a_mod', 'data', 'conf.txt'), 'a');
      write(join(mods, 'a_mod', 'gta3_img', 'x.dff'), Uint8Array.from([2, 2]));

      // b_mod (applied last): another conf override → wins.
      write(join(mods, 'b_mod', 'data', 'conf.txt'), 'b');

      install({ gamePath: game, inPath: mods, outPath: out });

      expect(readFileSync(join(out, 'data', 'keep.txt'), 'utf8')).toBe('base'); // untouched base file
      expect(readFileSync(join(out, 'data', 'new.txt'), 'utf8')).toBe('a-new'); // added by a_mod
      expect(readFileSync(join(out, 'data', 'conf.txt'), 'utf8')).toBe('b'); // b_mod applied after a_mod → wins
      expect(existsSync(join(out, 'gta3_img'))).toBe(false); // gta3_img is merged, never copied as a folder

      const img = openImg(new Uint8Array(readFileSync(join(out, 'models', 'gta3.img'))));
      expect(img.has('base.dff')).toBe(true); // base archive entry preserved
      expect(img.has('x.dff')).toBe(true); // merged from a_mod/gta3_img
    });

    it('merges gta_int_img into models/gta_int.img, seeding the archive when the base has none', () => {
      const game = join(root, 'game');
      const mods = join(root, 'mods');
      const out = join(root, 'out');

      write(join(game, 'data', 'keep.txt'), 'base'); // minimal base — no gta_int.img on purpose
      write(join(mods, 'a_mod', 'gta_int_img', 'int.dff'), Uint8Array.from([3, 3, 3]));

      install({ gamePath: game, inPath: mods, outPath: out });

      expect(existsSync(join(out, 'gta_int_img'))).toBe(false); // merged, never copied as a folder
      const img = openImg(new Uint8Array(readFileSync(join(out, 'models', 'gta_int.img'))));
      expect(img.has('int.dff')).toBe(true);
    });

    it('applies a *.merge data edit onto the installed file instead of copying it', () => {
      const game = join(root, 'game');
      const mods = join(root, 'mods');
      const out = join(root, 'out');

      write(join(game, 'data', 'maps', 'generic', 'multiobj.ide'), 'objs\n1682, radar, tex, 100, 2097152\nend\n');
      write(
        join(mods, 'a_mod', 'data', 'maps', 'generic', 'multiobj.ide.merge'),
        'remove from "objs":\n1682, radar, tex, 100, 2097152\n\nadd to "anim":\n1682, radar, tex, radar, 600, 0\n',
      );

      install({ gamePath: game, inPath: mods, outPath: out });

      const ide = readFileSync(join(out, 'data', 'maps', 'generic', 'multiobj.ide'), 'utf8');
      expect(existsSync(join(out, 'data', 'maps', 'generic', 'multiobj.ide.merge'))).toBe(false); // never copied
      expect(ide).not.toMatch(/objs\n1682/); // moved out of objs
      expect(ide).toContain('anim\n1682, radar, tex, radar, 600, 0\nend'); // into anim
    });

    it('applies a *.merge after the mod own-file overlay (the shipped target is edited)', () => {
      const game = join(root, 'game');
      const mods = join(root, 'mods');
      const out = join(root, 'out');

      write(join(game, 'data', 'stub.txt'), 'base');
      // The mod ships BOTH the target file and a merge editing it — the merge must see the shipped copy.
      write(join(mods, 'a_mod', 'data', 'custom.ide'), 'objs\n7001, radar, tex, 100, 0\nend\n');
      write(join(mods, 'a_mod', 'data', 'custom.ide.merge'), 'add to "anim":\n7002, dish, tex, spin, 300, 0\n');

      install({ gamePath: game, inPath: mods, outPath: out });

      const ide = readFileSync(join(out, 'data', 'custom.ide'), 'utf8');
      expect(ide).toContain('7001, radar, tex, 100, 0'); // the mod's own copy survived
      expect(ide).toContain('anim\n7002, dish, tex, spin, 300, 0\nend'); // and was edited by its merge
    });

    it('merges a mod PNG folder into a loose .txd matching its name (nested), not copying the folder', () => {
      const version = 0x1803ffff;
      const game = join(root, 'game');
      const mods = join(root, 'mods');
      const out = join(root, 'out');

      // Base ships a loose models/generic/vehicle.txd with one texture.
      write(
        join(game, 'models', 'generic', 'vehicle.txd'),
        buildTxd([pngToTextureNative('stock', png(8, [10, 10, 10, 255]), version)], version),
      );

      // The mod ships models/generic/vehicle/ as a PNG folder (replace `stock`, add `decal`).
      write(join(mods, 'paint', 'models', 'generic', 'vehicle', 'stock.png'), png(16, [20, 20, 20, 255]));
      write(join(mods, 'paint', 'models', 'generic', 'vehicle', 'decal.png'), png(4, [30, 30, 30, 128]));

      install({ gamePath: game, inPath: mods, outPath: out });

      // The folder is consumed by the merge — never copied as a directory.
      expect(existsSync(join(out, 'models', 'generic', 'vehicle'))).toBe(false);

      const textures = parseTxd(
        Uint8Array.from(readFileSync(join(out, 'models', 'generic', 'vehicle.txd'))).buffer,
      ).textures;
      const byName = new Map(textures.map((t) => [t.name, t]));
      expect([...byName.keys()].sort()).toEqual(['decal', 'stock']);
      expect(byName.get('stock')?.width).toBe(16); // replaced (was 8)
      expect(byName.get('decal')?.format).toBe('dxt5'); // added, alpha
    });

    it('routes each mod by kind: a loader mod is baked (gta.dat + gta3.img), a plain mod overlays', () => {
      const game = join(root, 'game');
      const mods = join(root, 'mods');
      const out = join(root, 'out');

      // Base: gta.dat + a stock IDE + a seeded gta3.img.
      write(join(game, 'data', 'gta.dat'), 'IDE DATA\\MAPS\\stock.ide\n');
      write(join(game, 'data', 'maps', 'stock.ide'), 'objs\nend\n');
      const baseImg = createImg();
      baseImg.set('base.dff', Uint8Array.from([1]));
      write(join(game, 'models', 'gta3.img'), baseImg.build());

      // a_loader: a Modloader mod (loader.txt registers a new IDE + a scattered dff) → BAKED.
      write(join(mods, 'a_loader', 'loader.txt'), 'IDE data/maps/extra.ide');
      write(join(mods, 'a_loader', 'files', 'extra.ide'), 'objs\n5000, ext, exttxd, 1500, 0\nend\n');
      write(join(mods, 'a_loader', 'deep', 'extra.dff'), Uint8Array.from([7, 7]));

      // b_plain: a plain mod (file overlay + gta3_img/) → OVERLAID.
      write(join(mods, 'b_plain', 'data', 'extra-note.txt'), 'plain');
      write(join(mods, 'b_plain', 'gta3_img', 'plain.dff'), Uint8Array.from([8]));

      install({ gamePath: game, inPath: mods, outPath: out });

      // a_loader baked: gta.dat gained the new IDE (canonicalised), the IDE is on disk, the dff is in gta3.img.
      const gtaDat = readFileSync(join(out, 'data', 'gta.dat'), 'utf8');
      expect(gtaDat).toContain('IDE DATA\\MAPS\\extra.ide');
      expect(readFileSync(join(out, 'data', 'maps', 'extra.ide'), 'utf8')).toContain('5000, ext');
      expect(existsSync(join(out, 'loader.txt'))).toBe(false); // loader parsed, never copied
      // b_plain overlaid: its file copied, its gta3_img/ merged (not copied as a folder).
      expect(readFileSync(join(out, 'data', 'extra-note.txt'), 'utf8')).toBe('plain');
      expect(existsSync(join(out, 'gta3_img'))).toBe(false);
      // both mods' assets + the base coexist in gta3.img.
      const img = openImg(new Uint8Array(readFileSync(join(out, 'models', 'gta3.img'))));
      expect(img.has('base.dff')).toBe(true);
      expect(img.has('extra.dff')).toBe(true); // baked (a_loader, scattered)
      expect(img.has('plain.dff')).toBe(true); // overlaid (b_plain, gta3_img/)
    });

    it('applies a mod-shipped .txd file before merging its sibling PNG folder (files-first)', () => {
      const version = 0x1803ffff;
      const game = join(root, 'game');
      const mods = join(root, 'mods');
      const out = join(root, 'out');

      write(join(game, 'data', 'gta.dat'), 'x'); // a base so --out isn't empty (no pre-existing skin.txd)

      // The SAME mod ships both `models/skin.txd` (a file with `orig`) and `models/skin/` (a PNG folder adding
      // `patch`). Only if the file is copied first does the folder find a `skin.txd` to merge into.
      write(
        join(mods, 'a', 'models', 'skin.txd'),
        buildTxd([pngToTextureNative('orig', png(8, [9, 9, 9, 255]), version)], version),
      );
      write(join(mods, 'a', 'models', 'skin', 'patch.png'), png(8, [7, 7, 7, 255]));

      install({ gamePath: game, inPath: mods, outPath: out });

      expect(existsSync(join(out, 'models', 'skin'))).toBe(false); // folder consumed, not copied
      const names = parseTxd(Uint8Array.from(readFileSync(join(out, 'models', 'skin.txd'))).buffer)
        .textures.map((t) => t.name)
        .sort();
      expect(names).toEqual(['orig', 'patch']); // the mod's own .txd + the folder merged into it
    });
  });
});

const png = (size: number, color: [number, number, number, number]): Uint8Array =>
  encodePng(solidRgba(size, size, color), size, size);
